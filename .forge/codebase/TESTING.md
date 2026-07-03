---
last_mapped_commit: 9de05a1ee9f11c92f58807adeff3dcc2cab63550
mapped: 2026-07-03
---

# 테스트 패턴

## 백엔드 — pytest

- 위치: `backend/tests/` (**105개 파일, 1092 테스트** collected). 실행: `cd backend && .venv/bin/python -m pytest`.
- `backend/tests/conftest.py`: ① `sys.path`에 `backend/` 추가, ② `main.app`에 `app.dependency_overrides[get_current_user] = lambda: "test-user-id"` 전역 오버라이드, ③ `client` fixture = `TestClient(app)`, ④ autouse `_clear_quote_cache` — 매 테스트 전 `cache_svc.invalidate_quote()`로 quote TTL 캐시 교차오염 방지.

### 앱 구성 2패턴 + 무인증 검증

1. **conftest `client`** (main.app 기반): auth는 `get_current_user`만 오버라이드됨.
2. **자체-app** (예: `backend/tests/test_stocks_router.py`, `test_recommendation_endpoint.py`, `test_consensus_router.py`): 모듈 상단에서 `FastAPI()` 생성 → `include_router` → 필요한 auth 의존성 전부 직접 오버라이드(`get_current_user_or_api_key`, `require_admin_or_api_key`, `require_admin` 등). **엔드포인트에 auth Depends를 추가하면 그 경로를 부르는 자체-app 테스트를 전수 grep해 오버라이드 추가**(task#108).
3. **무인증 거부 검증**: `backend/tests/test_security_auth_gaps.py` — 오버라이드 없는 fresh app으로 401/403 단언.

### query-mock 패턴과 그 블라인드 스팟

- 표준: 서비스 모듈의 `query`/`execute`를 patch — `patch("services.consensus.query", side_effect=[mart_rows, hist_rows])` + `mock_q.call_count` 단언으로 쿼리 횟수까지 고정(`backend/tests/test_consensus_asof_batch.py`). 행은 dict 리스트로 흉내(`_mart_row(...)` 헬퍼).
- `execute_many` 헬퍼 자체는 `backend/tests/test_db_execute_many.py`가 커버 — `get_connection`/`execute_batch`를 patch해 "단일 커넥션 + execute_batch 1회"·"빈 리스트 no-op(커넥션 미획득)"을 단언.
- **블라인드 스팟(task#135)**: query-mock은 SQL *문자열*을 실행하지 않으므로 라이브 정합을 못 잡는다 — ① uuid 컬럼 `= ANY(%s)`에 str 리스트(→ `uuid = text` 라이브 즉사, `ANY(%s::uuid[])` 필요), ② `VALUES ((a,b),(c,d))` 이중괄호(N행이 아니라 record 1행). 둘 다 pytest green 상태의 배포-즉사 버그였다. 완화책: **SQL 문자열 형태 자체를 단언**(`test_consensus_asof_batch.py::test_values_placeholder_shape`가 `_values_placeholder` 출력 `"(%s,%s::date), (%s,%s::date)"`를 고정) + **신규/개작 SQL 슬라이스는 배포 후 라이브 스모크를 DoD에 포함**.

### mock 관례

- 라우터 경로 patch: `patch("routers.stocks.storage.get_full_portfolio", ...)`; 서비스 객체 patch: `patch.object(analysis_service.yf, "Ticker", ...)` (`test_nan_serialization_guards.py`).
- **다중 호출 시퀀스는 `call_args_list[i].kwargs` + `call_count`로 못박기** — `mock.call_args`는 *마지막* 호출이라 additive 호출 추가 시 조용히 오염됨(task#66·67). `backend/tests/test_recommendation_endpoint.py`:
  ```python
  discovery_kwargs = mock_read.call_args_list[0].kwargs   # 호출 인덱스 명시
  assert mock_read.call_count == 2                        # 시퀀스 고정
  ```
  `backend/tests/test_market_kr.py`: `regulars = [c.kwargs.get("regular") for c in kb.call_args_list]`.
- **patch 타깃 심볼 제거 시 파일 불문 전수 grep**(task#136): `services.digest_service`에서 `yf` import가 제거되자 주 테스트(`test_digest_service.py`)는 마이그레이션됐지만 **다른 파일** `test_disclosure_endpoint_digest.py`가 `services.digest_service.yf.Ticker`를 patch하고 있어 파손. 현재 그 파일은 `patch("services.digest_service.get_quotes_batch", ...)`·`patch("services.digest_service._get_usdkrw", ...)`로 이행됨. 규칙: `grep -rn "모듈경로.심볼" backend/tests/`.

### 배치 id count/set 하드코딩 단언 — 4파일 분산

- `batch_registry.BATCHES`에 id를 추가/제거하면 **exact-count/exact-set 단언이 흩어진 파일을 전수 갱신**(task#136에서 `us_sector_fetch` 추가 시 1파일만 인지 → 나머지 3파일 파손):
  - `backend/tests/test_macro_signals_batch.py:37` — `assert len(batch_registry.BATCHES) == 27`
  - `backend/tests/test_batch_market_split.py:52` — `assert len(batch_registry.BATCHES) == 27`
  - `backend/tests/test_batches_router.py:26,45-46` — `EXPECTED_IDS` 집합 + `len(data) == 27` + set 대조
  - `backend/tests/test_scheduler_seed.py` — `BATCHES`의 `editable` id 목록 순회(간접 의존)
- grep 커맨드: `grep -rn "BATCHES) ==\|len(data) ==\|EXPECTED_IDS" backend/tests/`. id *은퇴* 시엔 옛 id를 단언하던 테스트도 grep 대상(깨진 동작을 고정해 green이 회귀를 못 잡음).

### API 문서 drift 자동검출 — `backend/tests/test_api_doc_sync.py`

- 라이브 ground-truth = `main.app`의 `app.routes`(데코레이터 파싱 아님), 문서 정본 = `API_SPEC.md`/`CLAUDE_COWORK_API.md`의 `` ### `METHOD /path` `` 헤더. path param은 `{ticker}`→`{}` 정규화(`_norm`)로 철자 차이 무시.
- 테스트 3종: ① 라이브 − API_SPEC == `KNOWN_UNDOCUMENTED` (exact — 새 drift와 stale allowlist 양방향 단언), ② API_SPEC의 stale(삭제 누락) 검출, ③ COWORK(부분집합)의 stale 검출.
- **`KNOWN_UNDOCUMENTED = frozenset()` — task#100에서 23개 전수 문서화 완료로 현재 빈 베이스라인.** 새 엔드포인트를 문서 없이 추가하면 즉시 실패; 의도적 유예면 여기 추가, 문서화하면 제거(self-maintaining).
- 한계: *존재*(method+path)만 검증 — 요청/응답 스키마·인증 게이팅 동기는 수동 DoD.

### fixture-pass-live-fail 함정 (외부소스 파싱 = 라이브 스모크 DoD)

반복 확인된 가족 — mock/fixture green인데 라이브에서만 죽거나 조용히 None:
- **yfinance 라벨 이원화**: `get_cashflow()` *메서드*(무공백 `OperatingCashFlow`) vs `.cash_flow` *프로퍼티*(공백 `Operating Cash Flow`) — exact 매칭 `_yf_val`이 조용히 None(task#117).
- **DART**: `fnlttSinglAcntAll`은 요청 `fs_div` 필수 + 응답 행에 `fs_div` 미echo(필터하면 전 행 스킵), 계정은 `account_id`(XBRL)로 매칭(task#117).
- **tz 정렬**: KR 키움 tz-naive ↔ yfinance tz-aware `concat` TypeError를 broad except가 삼켜 KR beta가 조용히 None — 단위테스트는 라이브 미모킹이라 미포착(task#116).
- **% 스케일**: yfinance 퍼센트 필드는 소수분수 — 렌더 ×100을 단위테스트가 단언 안 해 못 잡음. fixture 예시값도 분수 스케일로(task#122·123).
- **Decimal**: DB NUMERIC 재현 fixture는 float 아닌 **Decimal**로 만들어야 라이브 `float/Decimal` TypeError를 재현(대시보드 배당 사례).
- **SQL query-mock**(위 절) — 같은 가족의 SQL판.
- 대응: **외부소스 파싱·신규 SQL 슬라이스는 라이브 1종목 추출 대조/배포 후 엔드포인트 스모크를 DoD에 포함.** 외부데이터 증상 진단도 라이브 프로브 선행(`docker exec -i portfolion-backend-1 python -`, task#126).

### TDD 규율

- 버그 수정은 **재현 테스트 먼저 red 확인 후** 수정으로 green (forge `fg-tdd` 설정 연동).
- additive 호출 추가 시 기존 단언은 `call_args_list[i]`로 마이그레이션, 신규 호출은 입력 비면 생략(`if <조건>:`)해 기존 테스트 보존.

## 프론트 — vitest (ADR-0019)

- 위치: `frontend/src/test/`(페이지 레벨 — `recommendations-s3s4.test.jsx` 10개, `smoke.test.js` 1개) + `frontend/src/hooks/`(훅 co-locate — `useStockManagement.test.js` 19개, `useReportFilters.test.js` 16개, `usePortfolioData.test.js` 5개). 현재 **5파일 51 테스트**.
- 실행: `cd frontend && npm run test` (`vitest run`). 설정은 `frontend/vite.config.js`의 `test:` 키 — `environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.js'`(`@testing-library/jest-dom` 로드).
- mock: `vi.mock('../api', () => ({ default: { get: vi.fn(), ... } }))` → `api.get.mockImplementation(...)` / `api.get.mock.calls.find(...)`. 훅 테스트는 `renderHook`+`act`(@testing-library/react).
- 렌더된 % 표시는 단위테스트가 스케일 트랩(소수분수 ×100)을 못 잡음 — % 필드별 스케일 검증 필요(task#122·123).
- 라이브 UAT: Playwright 디바이스 에뮬레이션(테스트 계정 test@portfolion.com) — 프론트 표시 버그(색 반전·스케일)는 단위테스트가 아닌 라이브 UAT가 잡아온 이력.

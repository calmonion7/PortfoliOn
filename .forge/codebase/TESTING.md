---
last_mapped_commit: 44629f27cfb796dbd2120b7002a99e3d82f7c725
mapped: 2026-07-24
---

# TESTING

PortfoliOn 테스트 프레임워크·구조·모킹·커버리지. 구현 사실만 다룬다.

---

## 1. 백엔드 — pytest

- 실행: `cd backend && .venv/bin/python -m pytest` (로컬 `.venv`는 Python 3.9.6 — `CONVENTIONS.md` §1 참조).
- 위치: `backend/tests/` (123개 `test_*.py` 파일). 수집 규모 **1299 테스트**.
- fixtures: `backend/tests/fixtures/`, 공유 설정: `backend/tests/conftest.py`.
- 로컬 pytest가 배포 게이트다 — 배포 전 로컬 스위트 통과가 필수. 여러 count/set 하드코딩 단언이 파일에 흩어져 있어(예: `BATCHES` 개수), id 추가/삭제 시 전 파일 전수 grep이 필요하다.

### 1.1 conftest — 공유 fixture와 autouse 가드

`backend/tests/conftest.py`:
- `client` fixture — `main.app`을 감싼 `TestClient`.
- `app.dependency_overrides[get_current_user] = lambda: "test-user-id"` — `main.app`의 인증을 모듈 로드 시 전역 override(테스트 계정 고정).
- `_clear_quote_cache`(autouse) — `get_quote`의 종목 단위 TTL 캐시를 매 테스트 전 `cache.invalidate_quote()`로 비워 교차 오염 방지.
- **`_block_real_db`(autouse) — 실 DB 접근 차단 가드(task#169).** `monkeypatch.setattr(services.db, "_get_pool", ...)`로 `_get_pool`이 `RuntimeError`를 던지게 한다. 로컬 `DATABASE_URL`이 도커 postgres(=라이브 DB)를 가리켜, 가드 전엔 `generate_report` end-to-end 테스트의 스냅샷 INSERT가 prod `snapshots`에 그대로 커밋되는 사고가 났다(fixture-writes-live). **DB가 필요한 테스트는 `services.db`의 `query`/`execute`를 테스트 계층에서 mock해야 한다** — 가드가 raise하면 그 테스트가 실 DB에 닿고 있다는 뜻이므로, 가드를 풀지 말고 mock을 추가한다.

### 1.2 self-app 테스트 — 라우터별 격리 앱

다수 라우터 테스트가 conftest의 `client`가 아니라 **모듈 상단에서 `FastAPI()`를 직접 만들고 `include_router(router)` + `dependency_overrides`로 auth를 우회**한다(약 35개 파일: `test_stocks_router.py`·`test_consensus_router.py`·`test_admin_router.py`·`test_portfolio_router.py` 등). 예(`test_consensus_router.py`):

```python
app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
client = TestClient(app)
```

- **conftest는 `main.app`의 `get_current_user`만 override**하므로 self-app 테스트엔 안 걸린다. 엔드포인트에 auth `Depends`(`get_current_user`/`require_admin`/`require_admin_or_api_key`)를 추가/변경하면 **그 경로를 호출하는 self-app 테스트를 전수 grep해 새 의존성의 override를 추가**해야 한다(안 하면 401/403으로 깨짐).
- **무인증 거부(401/403)는 override 없는 fresh app으로 별도 검증**한다: `backend/tests/test_security_auth_gaps.py` 패턴 — 테스트마다 `FastAPI()` + `include_router`만 하고 override 없이 실제 auth 의존성을 태워 status_code 401을 단언.

### 1.3 모킹 규약

- 라이브러리: `unittest.mock`의 `patch`/`MagicMock`/`monkeypatch`.
- **DB는 서비스 계층에서 patch**: 서비스가 import한 심볼 기준으로 patch(예: `patch("services.storage.portfolio.query", return_value=[...])`, `patch("services.storage.portfolio.execute", ...)`). SQL 형태 단언은 `mock_execute.call_args[0]`로 `(sql, params)`를 꺼내 검증.
- **additive read/외부호출 추가 시 `mock.call_args`(마지막 호출) 단언이 조용히 오염된다.** additive는 호출 시퀀스도 늘리므로, 기존 단언은 호출별 `mock.call_args_list[i].kwargs`로 마이그레이션(인덱스로 해당 호출 명시)하고, 신규 테스트는 `mock.call_count`로 시퀀스를 못박는다. 신규 호출은 `if <조건>:`로 입력이 비면 생략해 기존 테스트를 보존. 참조: `test_recommendation_endpoint.py`(`call_args_list[0].kwargs`가 discovery 호출을 명시, `call_count == 1` 단언).
- **심볼을 제거/개명하면 그 심볼을 patch하는 테스트를 파일 불문 전수 grep**: `grep -rn "모듈경로.심볼" backend/tests/`. mock 타깃은 "주 테스트 파일"에만 있지 않다(`digest_service`에서 `yf` import 제거 시 다른 파일이 `services.digest_service.yf.Ticker`를 patch하고 있어 `ModuleNotFoundError`로 파손된 사례).
- **reload 패턴 테스트 주의**: `importlib.reload(module)`을 쓰는 테스트에서 모듈 자체 정의 심볼 patch는 reload로 무효화된다 — 하위 모듈 속성(`services.db.execute`·`_naver_get` 등)을 patch한다.

### 1.4 fixture-pass-live-fail 계열 — 라이브 대조 DoD

단위 테스트(mock/fixture)가 통과해도 라이브 실데이터에서만 드러나는 버그 계열이 반복됐다. 이 슬라이스들은 **배포 후 라이브 대조/스모크를 DoD에 포함**한다:

- **외부소스 파싱**(yfinance index 라벨·Naver row·DART `account_id`·KIS output 봉투): fixture가 라벨/봉투 불일치를 못 잡는다 — 라이브 1종목 추출 대조 필수. 라이브 프로브는 fetch 200뿐 아니라 응답 봉투(output vs output1/2/3) 파싱까지 확인해야 완성.
- **신규/개작 SQL**(단건→배치 ANY 배열화·VALUES 조인): query-mock 테스트는 라이브 정합(uuid 캐스트·record 형태)을 못 잡는다 — 배포 후 해당 엔드포인트 라이브 스모크 필수.
- **tz 정렬**(키움 tz-naive ↔ yfinance tz-aware): fixture는 라이브 지수를 안 모킹해 못 잡는다 — broad `except`가 삼키면 조용히 None. 회귀 테스트는 실구조(테이블·컬럼·Decimal·tz)를 단언한다.
- **프론트 % 표시 스케일**(yfinance 소수분수 ×100): 단위 테스트는 렌더 %를 단언 안 해 못 잡는다 — API_SPEC 예시값·fixture도 분수 스케일로 적는다.
- 외부데이터 증상은 **라이브 프로브 선행**(`docker exec -i portfolion-backend-1 python -`로 행수/값 확인) — fetch 실패인지 히스토리 부족인지 등을 코드 버그로 단정하기 전에 확인.

### 1.5 API 문서 동기 테스트

`backend/tests/test_api_doc_sync.py` — 라이브 `main.app`의 `app.routes`(데코레이터 파싱 아님)와 두 문서의 `### `METHOD /path`` 헤더를 대조한다.

- `test_api_spec_documents_all_live_endpoints`: 라이브 − `API_SPEC.md` == `KNOWN_UNDOCUMENTED`(정확히). 현재 `KNOWN_UNDOCUMENTED = frozenset()`(전부 문서화됨) — 새 엔드포인트를 `API_SPEC.md`에 안 적으면 실패.
- `test_api_spec_has_no_stale_endpoints` / `test_cowork_api_has_no_stale_endpoints`: 문서가 라이브에 없는(삭제된) 엔드포인트를 문서화하지 않는지 검증.
- 테스트는 엔드포인트 **존재**만 검증한다(prose 파싱 안 함) — 요청/응답 스키마·인증 게이팅 동기는 수동 DoD.

## 2. 프론트 — Vitest (ADR-0019)

- 실행: `cd frontend && npm run test` (`"test": "vitest run"`).
- 러너: **Vitest**, 환경 `jsdom`, 라이브러리 `@testing-library/react`(+`@testing-library/jest-dom` 매처). 설정은 별도 파일 없이 `frontend/vite.config.js`의 `test` 블록(`environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.js'`) — Vite 설정·플러그인·alias 재사용.
- `frontend/src/test/setup.js`는 `import '@testing-library/jest-dom'` 한 줄(jest-dom 매처 등록).
- 위치: 소스 옆 콜로케이트(`*.test.js`/`*.test.jsx`) + `frontend/src/test/`(통합/스모크). 16개 파일, 약 **99 테스트**.
  - 콜로케이트 예: `frontend/src/hooks/usePortfolioData.test.js`·`useReportFilters.test.js`·`useStockManagement.test.js`, `frontend/src/components/PermissionPanel.test.jsx`, `frontend/src/components/reports/reportUtils.test.js`·`Sections.test.jsx`.
  - `frontend/src/test/` 예: `smoke.test.js`, `masthead.test.jsx`, `route-redirects.test.jsx`, `global-search-tracked.test.jsx`, `recommendations-s3s4.test.jsx`, `compare-race.test.jsx`.
- **도입 범위(ADR-0019)**: R4 훅 추출 대상(`useReportFilters`/`useStockManagement`)으로 시작 — 프론트 전체 테스트 백필은 별건. 자동 회귀 커버리지 공백은 여전히 존재하며, 색 의미·시각 회귀는 vitest·빌드가 블라인드라 Playwright 스팟 재캡처로 보완한다(reference-frontend-uat, `scripts/`의 디바이스 에뮬레이션 수동 UAT — 테스트 계정 `test@portfolion.com`).

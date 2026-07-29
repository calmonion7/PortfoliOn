---
last_mapped_commit: 91bac67ddb3ca7277a850fa6840a0fce0f7344cf
mapped: 2026-07-30
---

# TESTING — 테스트·검증 지도

**구현 사실**만 담는다. 코드 스타일·로깅·문서 동기 규약은 형제 문서
`.forge/codebase/CONVENTIONS.md`를 본다(이 문서는 그 §4·§11을 자주 인용한다).

---

## §1 프레임워크·실행

| 계층 | 도구 | 실행 | 규모 |
|---|---|---|---|
| 백엔드 | pytest | `cd backend && .venv/bin/python -m pytest` | `backend/tests/test_*.py` **127파일 / 테스트 함수 1370개** |
| 프론트 | vitest 4 (jsdom) | `cd frontend && npm test` (= `vitest run`) | `frontend/src/**/*.test.{js,jsx}` **25파일** |
| 라이브 UAT | Playwright 1.50 (`scripts/package.json`) | `node scripts/uatNNN-*.mjs` | `scripts/*.mjs` **87개** |
| 라이브 감사 | 순수 python | `cd backend && .venv/bin/python ../scripts/audit_unauth_endpoints.py` | `scripts/audit_unauth_endpoints.py` |

- pytest 설정은 `backend/pytest.ini` 2줄이 전부다: `testpaths = tests`, `pythonpath = .`.
  마커 정의·플러그인 설정 없음. `@pytest.mark.parametrize`가 8곳뿐이고 커스텀 마커는 없다.
- vitest 설정은 `frontend/vite.config.js`의 `test` 블록: `environment: 'jsdom'`,
  `globals: true`, `setupFiles: './src/test/setup.js'`.
  `frontend/src/test/setup.js`는 `import '@testing-library/jest-dom'` 1줄이다.
- **CI에 테스트가 없다.** `.github/workflows/deploy.yml`(16줄)은 `git reset --hard origin/main`
  후 `bash deploy.sh` 한 스텝뿐이고, `deploy.sh:25`는 프론트 `npm install && npm run build`만
  돌린다. lint/pytest/vitest 잡도, PR 트리거 워크플로도, `.husky/`·비-sample git hook도 없다.
  → **모든 게이트는 로컬 수동 실행**이며, 그래서 "배포 전에 전체 스위트를 돌렸는가"가 실질 DoD다.
- 로컬 인터프리터는 **Python 3.9.6**, 배포 컨테이너는 3.12(CONVENTIONS §3.3).
  로컬에 `lxml`이 없어 HTML 파싱 테스트는 `BeautifulSoup(html, "html.parser")`를 쓴다.

---

## §2 테스트 파일 배치

### 백엔드 — `backend/tests/` 평탄 구조
- 명명 `test_<주제>.py`. 주제는 라우터(`test_stocks_router.py`), 서비스(`test_dividends.py`),
  회귀 클러스터(`test_empty_result_overwrite_guards.py`), 규약 가드(`test_no_print.py`)로 섞인다.
- `backend/tests/__init__.py`는 빈 파일(패키지화 목적 — `from tests._routes import ...`를 위해).
- 공유 헬퍼는 `backend/tests/_routes.py`의 `walk_routes(routes)` 하나뿐이다(§5.4).
- 실데이터 fixture는 `backend/tests/fixtures/backlog/*.html` **10개**(실 DART `document.xml` 표
  HTML). 소비처는 `backend/tests/test_backlog_extract.py:16`(`FIX` 상수)와
  `backend/tests/test_backlog.py:413`.

### 프론트 — 콜로케이션 + 교차관심사 디렉터리 2원 구조
- 콜로케이션(16개): 소스 옆 `Foo.test.jsx`. 예 `frontend/src/pages/GuruAllocation.test.jsx`,
  `frontend/src/hooks/useReportFilters.test.js`, `frontend/src/components/PermissionPanel.test.jsx`.
- 교차관심사(9개): `frontend/src/test/`에 **kebab-case** —
  `route-redirects.test.jsx`, `compare-race.test.jsx`, `compare-sector-group.test.jsx`,
  `global-search-tracked.test.jsx`, `masthead.test.jsx`, `recommendations-s3s4.test.jsx`,
  `reports-deep-link-navkey.test.jsx`, `smoke.test.js`(러너 동작 확인용 스모크).
- 확장자 규칙: JSX를 렌더하면 `.test.jsx`, 순수 로직이면 `.test.js`
  (`frontend/src/components/reports/reportUtils.test.js`, `frontend/src/hooks/usePortfolioData.test.js`).

### 라이브 프로브 — `scripts/`
- 명명 `uat<taskNo>-<주제>.mjs`(예 `scripts/uat241-guru-allocation.mjs`), 인증 스모크는
  `smoke<taskNo>-auth.mjs`. 출력 스크린샷은 리포지토리 루트 `screenshots-uat<taskNo>/`
  (전부 untracked). 파이썬/CJS 프로브도 소수 있다 — `scripts/contrast_probe.py`,
  `scripts/probe239-guru-activity.py`, `scripts/check-permissions.js`, `scripts/screenshot.js`.

---

## §3 `conftest.py` 가드 픽스처

`backend/tests/conftest.py`(38줄)가 전부다. 세 가지를 한다.

1. **전역 인증 우회** — `:10` `app.dependency_overrides[get_current_user] = lambda: "test-user-id"`.
   대상은 `main.app` **하나뿐**이다(§4.1의 self-app 함정의 원인).
   `:13-15` `client` 픽스처가 `TestClient(app)`를 준다.
2. **`_clear_quote_cache`(autouse)** — `:18-23`. `get_quote`가 종목 단위 TTL 캐시를 쓰므로
   매 테스트 전에 `cache_svc.invalidate_quote()`로 교차 오염을 끊는다.
3. **`_block_real_db`(autouse)** — `:26-37`. `services.db._get_pool`을
   `RuntimeError("tests must not touch the real DB — mock services.db.query/execute")`로
   monkeypatch한다. 주석 `:28-31`이 사고 경위를 남긴다 — 로컬 `DATABASE_URL`이 도커 postgres
   (=라이브 DB)를 가리켜 `generate_report` end-to-end 테스트의 INSERT가 **prod `snapshots`를
   fixture 값으로 덮었고**, admin 삭제 테스트가 prod `calendar_cache`를 전부 DELETE했다.

**함의**
- DB를 타는 테스트는 **반드시** `services.db`의 `query`/`execute`(또는 그 상위)를 mock한다.
  가드가 raise하면 그 테스트가 실 DB에 닿고 있다는 뜻이니 **가드를 풀지 말고 mock을 추가**한다.
- 오염은 *선택적*이었다 — 가짜 티커(`TEST`)는 FK로 실패해 무해해 *보이고* 실존 티커만 오염됐다.
  라이브 값이 지나치게 라운드(정확히 `70000.0`, 정확히 400조)면 **피드 글리치보다 테스트 오염을
  먼저 의심**한다.
- **가드는 DB만 막고 파일 write는 막지 않는다.** 파일 캐시를 건드리는 테스트는 `tmp_path`로
  경로를 돌린다 — 모범 사례가
  `backend/tests/test_empty_result_guards_exports_krsector.py`의 `exports_mod` 픽스처
  (`_DATA_DIR`·`_EXPORTS_CACHE`를 `tmp_path`로 monkeypatch + `KITA_API_KEY` 제거).
  과거 전체 스위트가 `backend/data/sp500_tickers.json`·`kospi_tickers.json`을 오염시켰는데
  (`_block_real_db`로 `_mc_load`가 None → 캐시 미스 → 라이브 스크레이프 → 파일 write),
  그 티커 캐시는 `market_cache`(키 `sp500_tickers`/`kospi_tickers`)로 이전됐고 파일은
  **read-only 시드**로 격하됐다(`backend/services/market_indicators/earnings.py:27-30,82,96-107` —
  `_SP500_SEED`/`_KOSPI_SEED`는 `open()` read, 저장은 `_mc_save`).
  **그래도 전체 스위트 실행 후 `git status`로 부수효과를 확인하는 습관은 유지**할 것(다른 write
  경로가 생길 수 있고, 파일 mtime을 TTL 기준으로 쓰면 덮어쓴 직후 신선해져 증상이 스스로 숨는다).

---

## §4 백엔드 모킹 패턴과 함정

### 4.1 self-app 패턴이 지배형 — conftest `client`는 거의 안 쓴다
- 모듈 상단에서 `FastAPI()`를 직접 만들고 라우터를 include한 뒤 override를 심는 파일이 **38개**,
  conftest `client` 픽스처를 쓰는 파일은 **2개**뿐이다.
- override 집계: `get_current_user` 38 / `require_admin` 22 / `get_current_user_or_api_key` 11 /
  `require_admin_or_api_key` 6.
- 표준형(`backend/tests/test_batches_router.py:8-18`)은 **일반 앱 + admin 앱 2개**를 만들어
  비-admin 403 경로까지 같은 파일에서 검증한다. 4개 인증 의존성을 전부 override한 예는
  `backend/tests/test_report_router.py:24-30`.
- 무인증 거부(401/403)는 **override 없는 fresh app**으로 별도 검증한다 —
  `backend/tests/test_security_auth_gaps.py:22-27`의 `_client(*routers)` 헬퍼
  (docstring `:4-5`가 "conftest override는 `main.app` 한정이라 여기 fresh app엔 안 걸린다"를 명시).
  admin 게이트 검증 다른 형태: `backend/tests/test_batches_router.py:231-236`이
  `require_admin`을 override하지 않은 앱에서 `auth.auth_service.get_user_by_id`를 patch해 403을 본다.
- **함정**: 엔드포인트에 auth `Depends`를 추가하면 그 경로를 호출하는 self-app 테스트가
  401/403으로 깨진다. **다만 선제적으로 전수 override를 추가하지 말 것** — 형제 read가 먼저
  인증돼 있으면 그 앱이 이미 override를 등록해 둔 경우가 많다(계획이 4·5·14파일을 지목했는데
  실제 변경은 3·0·0파일이었던 3연속 사례). **순서: 의존성을 붙인 뒤 전체 스위트를 먼저 돌리고
  실제로 깨지는 것만 고친다.** grep은 "어디를 볼지"를 좁히는 용도이고 게이트는 스위트다.

### 4.2 patch 타깃은 "실제 조회 경로"
- `unittest.mock.patch`를 쓰는 파일 82개, `monkeypatch`를 쓰는 파일 50개(혼용 흔함).
- **지연 import된 심볼은 원 모듈을 patch한다.**
  `backend/tests/test_us_supply_empty_guard.py:13-15` 주석:
  *"`fetch_all_us_supply`는 함수 내부에서 `from services.db import query as db_query`로 지연
  import하므로 `services.db.query`를 patch해야 한다(`svc.query`가 아님)."*
- **`importlib.reload` 패턴 테스트는 모듈 자체 정의 심볼 patch를 무효화한다.**
  `backend/tests/test_market.py`(8곳)·`backend/tests/test_report_generator.py`(20곳 이상)가
  reload를 쓰므로, 이 파일들에서는 하위 모듈 속성(`services.db.execute`, `_naver_get` 등)을
  patch해야 한다.
- **모듈에서 심볼을 제거·개명하면 그 심볼을 patch하는 테스트를 *파일 불문* 전수 grep**
  (`grep -rn "모듈경로.심볼" backend/tests/`). mock 타깃은 그 기능의 주 테스트 파일에만 있지 않다
  (`digest_service`에서 `yf` import를 제거했을 때 `test_disclosure_endpoint_digest.py`가
  `services.digest_service.yf.Ticker`를 patch하고 있어 `ModuleNotFoundError`로 파손).
- **additive read/외부호출 추가는 `mock.call_args`(마지막 호출) 단언을 조용히 오염시킨다.**
  대응: ① 기존 단언을 **호출별 `call_args_list[i].kwargs`**로 마이그레이션
  ② 신규 호출은 입력이 비면 `if` 로 생략해 기존 테스트를 보존 ③ 신규 테스트가 `call_count`로
  시퀀스를 못박는다.

### 4.3 "red 조건"을 call_count로 관측한다 — 빈 결과 가드 계열
빈 결과 가드는 "옛 구현이 *실제로* 저장 함수를 호출했다"를 관측해야 red가 성립한다.
그래서 이 계열은 반환값이 아니라 **저장 mock의 `call_count`/`call_args`**를 단언한다.

| 파일 | 덮는 것 |
|---|---|
| `backend/tests/test_empty_result_overwrite_guards.py` | task#242 5곳 — 구루 매니저(`save_guru_managers` + `routers.guru._run_crawl` + `scheduler.jobs._run_guru_crawl`), 원자재·국채(요청경로), M7·KR Top2 실적(배치 force 경로). `mock_exec.assert_not_called()` / `mock_save.call_count == 1` |
| `backend/tests/test_empty_result_guards_exports_krsector.py` | task#243 2곳 — KR 수출(예외만 가드해 "성공-but-빈응답"이 통과했던 G2: `stale` 마커·파일캐시 미생성까지 단언), KR 업종 역인덱스(같은 payload의 `index`가 빠졌던 G3: `save.call_args[0]`으로 `sectors`는 신규·`index`는 직전값임을 단언) + admin 응답의 `saved` 플래그 정직성 |
| `backend/tests/test_rankings_empty_guard.py` | 빈 quotes/비-dict 응답 → `RuntimeError` 전파 |
| `backend/tests/test_us_supply_empty_guard.py` | yfinance `t.info == {}` "성공-but-빈응답"이 upsert를 타지 않는지 |
| `backend/tests/test_fx_partial_failure.py`, `backend/tests/test_public_api_empty_items.py`, `backend/tests/test_kospi_futures.py` | 부분 실패·빈 items·KIS 빈 output 폴백 |

**중요**: 이 경로를 실제로 치려면 **예외 `side_effect`가 아니라 "값이 None/빈인 반환"을 모킹**해야
한다(예외 가드는 이미 통과하는 경로다).

### 4.4 `caplog`·autouse 스텁
- 로그 단언은 `caplog`(6파일). 관용구:
  `with caplog.at_level(logging.WARNING): ...` → `assert any("빈 결과" in r.message for r in caplog.records)`
  (`backend/tests/test_empty_result_overwrite_guards.py`, `..._exports_krsector.py`).
  `capsys`는 1파일만 남아 있다 — **`print`→`logger` 전환 스윕 때 `capsys` 테스트를 미리 찾아
  마이그레이션할 것**(CONVENTIONS §4.1).
- 백그라운드 워커의 `job_runs.record` 계측이 테스트 DB를 건드리지 않게 autouse로 no-op
  컨텍스트매니저를 심는 패턴: `backend/tests/test_report_router.py:12-21`.

### 4.5 스케줄러·라우트 열거 테스트
- `backend/tests/test_batches_router.py:38-41` 관용구: `job_runs.recent`·
  `storage.get_batch_schedule`을 patch하고 `patch.object(__import__("scheduler"), "_scheduler")`로
  APScheduler 싱글톤을 MagicMock으로 갈아끼운다.
- 날짜 의존 분기는 실행일 무관하게 결정적으로 만든다 —
  `backend/tests/test_batches_router.py:239-268`이 `_FOMC_DATES`를
  `date.today() ± timedelta`로 patch해 양 브랜치를 못박는다(주석 `:239-241`이 "라이브로는 소진
  임박 상태를 만들 수 없으므로"를 명시).

---

## §5 규약을 강제하는 테스트 (개별)

### 5.1 `backend/tests/test_no_print.py` — 앱 코드 zero-print
`main.py`·`routers`·`services`·`scheduler`·`middleware`를 `rglob("*.py")`로 훑어 **AST로
`print()` 호출 노드만** 탐지한다(`:23-36`) → 문자열·주석·`pprint` 오탐 없음.
`tests/`·`scripts/`·`data/`는 대상 외(`:6`). 실패 메시지가 `CONVENTIONS §4`를 인용한다.

### 5.2 `backend/tests/test_no_bare_today.py` — bare `today()` 금지
같은 AST 스윕 형태로 `.today()` 속성 호출을 잡는다(`:24-38`). 컨테이너가 UTC라 00~09 KST에
하루 어긋나므로 앱 코드는 `services.utils.today_kst()`(`backend/services/utils.py:11`)를 쓴다.
docstring/주석에서 규약을 설명하는 문구는 오탐 없음.

### 5.3 `backend/tests/test_no_public_reads.py` — ADR-0029 인증 게이트
- 라이브 `app` 배선을 본다(AST/데코레이터 파싱 아님): 엔드포인트 함수 파라미터 default가
  `Depends(...)`이고 그 dependency가 4개 인증 의존성 중 하나인지 + 라우트 수준
  `dependencies=[...]`도 함께 검사(`:41-56`). 핸들러를 실행하지 않아 DB에 닿지 않는다.
- `ALLOWED_PUBLIC`(`:28-38`)은 `auth.py` 공개 9개. **양방향 exact-match** —
  새 무인증이 생기면 실패(`:84`), 목록에 있는데 인증이 걸렸거나 사라져도 실패(`:93`).
- **`test_route_walk_is_not_silently_empty`(`:72-81`)가 이 파일의 핵심 안전장치**다:
  `/api` 라우트가 100개 초과인지 단언해 "라우트 0개를 세며 조용히 통과"를 차단한다
  (감사 스크립트가 실제로 그렇게 거짓 통과했다 — §5.4).

### 5.4 `backend/tests/_routes.py` — 버전차 흡수 헬퍼
`walk_routes(routes)`가 `routes`·`original_router`를 **재귀 하강**해 `.path`를 가진 라우트만
yield한다. 이유(docstring `:1-10`): 로컬 `.venv`(FastAPI 0.128.x)는 `include_router`로 들어온
라우트를 `app.routes`에 평탄하게 넣지만, 배포 이미지(0.138+)는 `_IncludedRouter`로 감싸
`.path`도 `.routes`도 노출하지 않고 `original_router`만 준다. 평탄 순회는 **후자에서 0개를 센다**.
`backend/requirements.txt`가 핀 없는 `fastapi>=0.104.0`이라 이 발산은 계속된다.
→ **라우트를 열거하는 테스트/스크립트는 전부 이 헬퍼(또는 동형 `_walk`)를 거쳐야 한다.**
현재 소비처: `test_no_public_reads.py:17`, `test_api_doc_sync.py:11`,
`scripts/audit_unauth_endpoints.py:61-73`(자체 `_walk` 복제).

### 5.5 `backend/tests/test_api_doc_sync.py` — API 문서 drift
라이브 ground-truth = `walk_routes(app.routes)`, 문서 canonical = `### \`METHOD /path\`` 헤더
정규식(`:18`). 경로 정규화(`:21-24`)로 path param 철자(`{ticker}`→`{}`)·쿼리스트링·끝 슬래시 차이를 무시.
3개 단언: ① 라이브 − `API_SPEC.md` == `KNOWN_UNDOCUMENTED`(현재 **빈 frozenset** `:50`)
② `API_SPEC.md` − 라이브 == ∅ ③ `CLAUDE_COWORK_API.md` − 라이브 == ∅.
**검출 범위는 엔드포인트 *존재*뿐** — 스키마·인증 게이팅 산문은 못 본다(§9.7).

### 5.6 배치 레지스트리 count/set 단언 4곳
`backend/tests/test_batches_router.py:26-34`(`EXPECTED_IDS` 29개 집합) + `:45-46`(`len(data) == 29`),
`backend/tests/test_batch_market_split.py:54`(`len(batch_registry.BATCHES) == 29`),
`backend/tests/test_macro_signals_batch.py:37`(동일),
`backend/tests/test_scheduler_seed.py:82`(`editable` 목록 파생).
`backend/tests/test_batches_router.py:52-65`는 전 배치가 비어있지 않은 `source: list[str]`를
갖는지도 단언한다. **배치를 추가·은퇴시키면 이 4파일을 함께 고쳐야 스위트가 green이 된다**
(`grep -rn "BATCHES) ==\|len(data) ==\|EXPECTED_IDS" backend/tests/`).

### 5.7 그 외 규약 가드
- `backend/tests/test_nan_serialization_guards.py` — 제로분산 corr NaN → `json.dumps(result,
  allow_nan=False)` 통과 + 엔드포인트 응답 직렬화(`:32`).
- `backend/tests/test_consensus_asof_batch.py:111` `test_values_placeholder_shape` — `VALUES`
  행 나열 형태 고정(바깥 괄호 금지).
- `backend/tests/test_db_execute_many.py` — 단일 커넥션 획득 + `execute_batch` 1회.
- `backend/tests/test_ticker_validation.py`, `test_schedule_spec.py` — 입력 검증 규약.

---

## §6 프론트 vitest 패턴

관용구는 `frontend/src/pages/GuruAllocation.test.jsx`(최근 추가, task#241·#244)와
`frontend/src/test/masthead.test.jsx`가 가장 잘 보여준다.

1. **api 모듈을 통째 vi.mock** — `vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))`
   (`GuruAllocation.test.jsx:5`), 그 후 `api.get.mockImplementation((url) => ...)`로 URL별 분기(`:28-34`).
2. **jsdom 결손 우회** — `matchMedia`가 없으므로 `vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))`
   로 PC 고정(`:6-7` 주석이 이유를 적어둔다).
3. **토스트는 spy로 가로챈다** — `vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: showToastSpy }) }))`
   (`:8-10`), 단언은 `expect(showToastSpy).toHaveBeenCalledWith(expect.any(String), 'error')`(`:147`).
   컴포넌트가 실제 `ToastProvider`를 필요로 하면 대신 감싼다(`masthead.test.jsx:19-22`).
4. **라우터 컨텍스트는 `MemoryRouter`로 감싼다**(`GuruAllocation.test.jsx:43`).
5. **컨텍스트는 훅 모듈 mock으로 주입** — `vi.mock('../contexts/AuthContext', () => ({ useAuth: () => authMock() }))`
   + 테스트별 `authMock.mockReturnValue({ menuPermissions, role, loading })`
   (`masthead.test.jsx:5-8,28`).
6. **관측점은 클래스 셀렉터 + 개수**다 — `container.querySelectorAll('.guru-stat-row').length`
   (`GuruAllocation.test.jsx:36`), 비동기 진입은 `await screen.findByText('TCK1')`.
   텍스트가 지표마다 반복되면 `getByText`가 다중 매치로 깨지므로 `getAllByText(...).length`를 쓴다.
   아이콘 `<title>`이 라벨과 같은 텍스트를 낼 때는 `{ selector: 'span' }`으로 좁힌다
   (`masthead.test.jsx:32` 주석).
7. **드리프트 방지용 공유 상수**를 테스트가 직접 import한다 —
   `frontend/src/test/route-redirects.test.jsx:4`가 `frontend/src/routes.js`의 `REDIRECTS`를 읽는다
   (손복사 목록을 없앤 조치).
8. **에러 정직성 단언**(task#244 계열) — fetch reject 시 "불러오지 못했습니다"가 뜨고
   빈 상태 문구("크롤링을 먼저 실행")는 **뜨지 않는지**를 함께 단언한다
   (`GuruAllocation.test.jsx:123-139`). `.then().finally()`가 rejection을 잡지 않아
   `loading=false·data=null`이 되고 그 결과 *잘못된 행동 지시*가 떴던 버그의 회귀 가드다.
9. `beforeEach(() => vi.clearAllMocks())`가 표준(`GuruAllocation.test.jsx:38`).
   테스트 파일 안 `console.*` 호출은 0건이다.

---

## §7 라이브 UAT 프로브 (Playwright)

### 7.1 표준 하니스
`scripts/uat241-guru-allocation.mjs`가 현재 기준형이다.

- 대상은 **라이브 배포** `https://portfolion.taebro.com`.
- 인증: `POST /api/auth/login`으로 `test@portfolion.com` / `test1234` 토큰을 받아
  `page.evaluate`로 `localStorage`에 `access_token`·`refresh_token`(+`theme`)을 심고 재진입한다
  (`:23-27,66-74`). **테스트 계정은 비-admin**이다.
- API ground-truth를 프로브가 직접 fetch해 DOM과 대조한다(`:26-28` → `:88-91` "상위3 DOM=API").
- 브라우저 안 측정기 `measure()`를 `page.evaluate`로 넘긴다 — 전부
  `getBoundingClientRect()` 기반(`:32-59`).
- 결과는 `results` 배열 + `P(ok, tag, msg)` 헬퍼에 모으고, 끝에서 `PASS/FAIL` 줄을 전부 출력한 뒤
  `✅ ALL PASS / 단언 N건`을 찍고 `process.exit(failed.length ? 1 : 0)`.
- 두 뷰포트를 같은 루프로 돈다 — PC `{width:1440,height:1000}` / 모바일 `devices['iPhone 13']`
  (`:80-84`). **한 면을 고치는 변경은 반대 뷰포트도 캡처**한다.
- 마지막에 `page.screenshot`으로 **육안 확인용 캡처**를 남긴다(`:130` 주석: "프로브 PASS 후에도
  이게 유일한 시각 포착 수단").

### 7.2 하니스 함정
- **Service Worker가 `/api/*`를 가로채므로 `page.route` 응답 인터셉트가 안 먹는다.**
  응답 주입 기반 UAT는 컨텍스트를 `serviceWorkers: 'block'`으로 만든다
  (`scripts/uat226-guru-detail.mjs:24-25` 주석 + 12개 프로브가 이 옵션을 쓴다).
- **recharts 커스텀 `label`은 `.recharts-pie-labels` 밖에 있고, recharts는 내용 없는
  `.recharts-pie-label-text` placeholder를 남긴다.** 그 셀렉터로 잡으면 실제 라벨 0개 + 빈 노드만
  걸려 헛수치가 나온다. 안전한 관용구는 **`.recharts-surface text` + 내용 있는 것만 필터**.
- 구루 목록 기본 정렬이 `종목수 ↑`라 `.guru-card` first에는 배지가 없다 →
  `filter({ has: span[title] })`로 고른다(`title` 속성이 셀렉터로 load-bearing).
- 대기는 `page.waitForFunction(...행 수 > 0).catch(() => {})` + `waitForTimeout` 조합
  (`scripts/uat241-guru-allocation.mjs:62-65`). 렌더 미완을 "데이터 0"으로 오해하지 않도록
  §7.3 ⓑ를 함께 볼 것.

### 7.3 프로브 신뢰성 4규칙 (실패만 기록하는 프로브의 `ALL PASS`는 "아무것도 안 본 것"과 구별되지 않는다)
ⓐ **커버리지를 출력한다** — 계열별 검사 수 카운터.
  구현 예: `scripts/uat240-guru-activity.mjs:95`의 `checks` 객체 →
  `:212-213`에서 `검사 내역: overflow 1372 · line-visible 1179 · mobile-row 38` 형태로 출력.
  (`ALL PASS — 단언 1건`을 찍은 사고가 있었다.)
ⓑ **총계가 재실행 간 조용히 줄면 통과가 아니라 측정 실패다** — 표본 스킵은 id 명시 + 1회 재시도 후
  FAIL로 처리하고 집계 수치를 재실행 간 비교한다.
ⓒ **판정 범위를 좁힌다** — `document.querySelectorAll('a[href="/guru"]')`처럼 문서 전체를 세면
  전역 내비·마스트헤드가 섞여 정상 구현이 거짓 FAIL한다. 범위를 `main.page-wrap` 본문으로 한정하고,
  FAIL이면 완화 전에 부모 체인을 덤프해 정체를 실측한다.
ⓓ **육안 확인은 거짓 *경보*도 낸다** — 되돌리기 전에 `elementFromPoint` 등으로 기각한다
  (둥근 모서리·투명 영역·`pointerEvents:none` 때문에 **bbox 교차 ≠ 클릭 차단**).
  형제 표면(`/reports`의 `.fab` 등)과 대조하면 신규 회귀와 기존 성질이 갈린다.
  캡처 전 `scrollIntoView` — 대상이 프레임 밖이면 육안 확인이 무의미하다.

**기준 상자도 추정하지 않는다.** 비교 상대(토스트·탭바·헤더)의 좌표도
`getBoundingClientRect()`로 얻거나 실제 스타일을 재현해 측정한다(토스트 영역을 "중앙 ±130px"로
가정해 거짓 FAIL을 낸 사례). **판정 단언은 리터럴이 아니라 불변식**으로 쓴다 —
`cols === 3`이 아니라 `cols === (chips <= 3 ? chips : 2)`(`scripts/uat225-polish.mjs`).
`auto-fill` 다열에서 "값 right가 행마다 동일"은 정상 구현도 FAIL이므로 **열 그룹(row.left)으로
묶어** 잰다(`scripts/uat241-guru-allocation.mjs:112-124`).

### 7.4 API/구성 감사 프로브
- `scripts/audit_unauth_endpoints.py` — `test_no_public_reads.py`와 동형 로직의 스크립트판.
  종료코드 0/1. **처음에 평탄 `app.routes`를 순회해 컨테이너에서 `전체 0 / 무인증 0`을 내며 거짓
  통과처럼 보였고**, 그래서 `_walk`(`:61-73`)를 갖게 됐다.
  → **"라이브 게이트"를 자칭하는 스크립트는 배포 환경에서도 돌려 *숫자가 실제로 나오는지*
  확인해야 완성**이다(0/빈 결과를 성공으로 읽는 게이트는 게이트가 아니다).
- 컨테이너 안 라이브 프로브는 `docker exec -i portfolion-backend-1 python - < probe.py` 형태로
  돌린다("다른 지표는 다 나오는데 하나만 빔" 같은 외부데이터 증상은 코드 버그로 단정하기 전에
  히스토리 행수·fetch 성공 여부를 이렇게 먼저 가른다).

### 7.5 admin 전용 표면은 라이브 UAT가 원리적으로 불가
UAT 계정이 비-admin이라 admin 화면·`require_admin` 엔드포인트는 Playwright로 열 수 없다
(4회 반복해 계획을 되돌린 이력). 착수 전에 셋 중 하나를 고르고 DoD에 적는다:
① 게이트를 `require_admin_or_api_key`로 열어 **API 키로 positive 검증**(Cowork-facing 쓰기
컨벤션과 맞을 때만 — `require_admin`은 API 키를 **거부**하므로 게이트를 실제로 바꿔야 하고
self-app 테스트엔 그 의존성별 override를 따로 넣어야 한다)
② vitest + 기능경로 API로 닫고 **버튼 렌더는 사용자 화면 확인으로 이월**(`run.md`에 남긴다)
③ admin 크레덴셜을 사용자에게서 받는다.

---

## §8 검증 계층의 역할 분담

| 확인 대상 | 게이트 |
|---|---|
| 함수·분기 로직, SQL 구조, 응답 shape | pytest (query mock) |
| 컴포넌트 렌더·상태 전이·에러 정직성·주변 DOM 텍스트 | vitest (jsdom) |
| 레이아웃 수치·겹침·정렬·잘림·차트 시각 속성 | 라이브 Playwright 프로브 (`getBoundingClientRect`, `scrollWidth`) |
| 색 의미·"보기에 깨졌는가" | **스크린샷 육안 확인 1장** (다른 어떤 계층도 못 본다) |
| 라이브 SQL 타입·외부소스 실데이터 파싱·박제 값 | 배포 후 엔드포인트 라이브 스모크 / 컨테이너 프로브 |
| 인증 게이팅·문서 존재·배치 id·print/today 규약 | 규약 가드 테스트 (§5) |

---

## §9 테스트 스위트가 **원리적으로** 못 보는 것

각 항목에 "무엇이 보완하는가"를 함께 적는다.

1. **recharts는 jsdom에서 렌더되지 않는다.** `ResponsiveContainer`가 0크기라 축·틱·마커·막대·
   조각이 전혀 나오지 않으므로 `"2026(E)"` 같은 **틱 텍스트 단언은 구조적으로 불가능**하다.
   코드베이스가 이 사실을 테스트 주석으로 4곳에 남겨뒀다 —
   `frontend/src/pages/AnalystReport.test.jsx:59`,
   `frontend/src/pages/GuruDetail.test.jsx:204,238`.
   → vitest에서는 범례 텍스트·캡션·데이터 유무 분기·표 부재만 단언하고,
   **겹침·위치·색 대조는 라이브 프로브**가 게이트다.
   부수: 데이터가 비어 차트가 아예 안 그려지는 표본에서 조기 return하면 그 표본의 KPI 단언까지
   사라지므로, 프로브는 공통 측정치를 먼저 모으고 분기한다.
2. **jsdom은 레이아웃을 계산하지 않는다.** 2줄→1줄 여부, 좌우 배치·폭(CSS 미디어쿼리),
   `position: fixed` 좌표가 전부 블라인드다(`frontend/src/pages/GuruDetail.test.jsx:87,267,285`가
   그 한계를 주석으로 명시하고 "라이브 실측이 게이트"라고 적어둔다).
   `getComputedTextLength`도 jsdom에 없으므로 **문자폭 실측 코드에는 추정 폴백을 반드시 남긴다**
   (`frontend/src/pages/GuruDetail.jsx`의 숨은 0×0 SVG 측정기 — 폴백을 지우면 기존 단위테스트가
   통째 깨진다). → 라이브 `getBoundingClientRect()` 프로브.
3. **색 의미는 vitest·빌드 모두 블라인드**다. 공용 배지 variant의 색 의미를 바꾸면
   가격 배지(`ChangeBadge`)가 서구식으로 반전되는 차단급 회귀가 통과한다.
   → **소비처 전수 grep 선행 + 스팟 시각 재캡처**가 유일한 포착 수단이었다.
4. **`text-overflow: ellipsis`·`line-clamp` 잘림은 `overflow` 검사에 원리적으로 안 잡힌다** —
   박스를 넘는 게 아니라 박스 안에서 내용을 지우기 때문이다(프로브 26단언 ALL PASS인데 PC
   메타줄이 상위50 중 38행에서 수치를 통째로 잃은 사례).
   → **`scrollWidth > clientWidth`(세로면 `scrollHeight > clientHeight`)를 별도 축으로** 잰다
   (`scripts/uat241-guru-allocation.mjs:48-51`의 `numClipped`).
   구현 쪽 짝: 줄어도 되는 것만 ellipsis 상자에 넣고, 줄면 안 되는 수치는 `flex-shrink: 0`
   형제 span으로 고정한다.
5. **query-mock SQL 테스트는 라이브 SQL 타입/문법 오류를 못 잡는다.** pytest green 상태의
   배포-즉사 버그 2종이 실제로 났다 — uuid 컬럼에 `= ANY(%s)`로 str 리스트(→`uuid = text`),
   `VALUES`를 바깥 괄호로 감싸 record 1행화. → **신규/단건→배치 개작 SQL은 배포 후
   해당 엔드포인트 라이브 스모크를 DoD에 포함**(형태만 고정하는 가드는
   `test_consensus_asof_batch.py::test_values_placeholder_shape`).
6. **외부소스 파싱은 fixture로 통과하고 실데이터에서 실패한다**(fixture-pass-live-fail).
   yfinance `get_income_stmt()`(무공백 라벨) vs `.income_stmt`(공백 라벨) 불일치는 예외 없이
   조용히 None을 반환하고, DART `account_id` 매칭·`fs_div` 요청/응답 규칙, Naver row 구조도
   같은 부류다. mock은 응답을 그대로 돌려주므로 라벨 불일치를 못 본다.
   → **라이브 1종목 추출 대조를 DoD에 넣는다.** 프로브도 fetch 200만 보지 말고
   **응답 봉투 파싱**까지 확인해야 완성이다(KIS 선물 `output` vs `output1/2/3`을 잘못 읽고
   "코드/파라미터 오류"로 오진한 사례).
7. **문서 산문 drift는 자동 검출되지 않는다.** `test_api_doc_sync.py`는 method+path *존재*만
   본다 → 요청/응답 스키마, `**Auth:**` 표기, README 절은 수동 DoD다(CONVENTIONS §10).
8. **환경 발산이 결과를 뒤집는다.** 로컬 `.venv` 3.9.6 / FastAPI 0.128.x vs 배포 3.12 /
   FastAPI 0.138+, `lxml` 로컬 부재. 라우트 열거는 `walk_routes`로 흡수했지만(§5.4),
   **패키지 유무·버전차는 계속 새 발산을 만든다** — 라이브 게이트 스크립트는 배포 환경에서도 돌린다.
9. **프론트 로깅·탭 이원화·라우트 순서·`_migrate` 쌍에는 자동 가드가 없다**
   (CONVENTIONS §11 하단 목록). `RESEARCH_TABS` ↔ `SECTIONS.research.items`의 등가성을
   단언하는 테스트는 존재하지 않는다.
10. **CI가 없으므로 "테스트를 돌렸다"가 구조적으로 보장되지 않는다**(§1). 배포는 push 즉시
    일어나고 테스트는 그 경로에 없다.
11. **완료기준 자체가 축을 빠뜨릴 수 있다.** 프로브 ALL PASS 30건인데 화면이 깨져 있던 사례의
    원인은 ⓐ 라벨 **중심** 반지름만 재 접선 방향 넘침이 판정에 없었고 ⓑ 문자폭을 라틴 기준
    (`6.2px/자`)으로 추정해 한글 전각(~10px)을 14% 과소평가한 것이었다.
    실천: 완료기준을 쓸 때 **"이 단언이 통과하면서도 깨질 수 있는 방식"을 한 줄 적어보고**
    (빠진 축이 드러난다), 박스가 곡면/사선 영역 안인지 볼 때는 **중심이 아니라 네 모서리**를 재고,
    CJK를 라틴 문자폭으로 재지 않는다. 그리고 **시각 변경은 프로브 PASS 후에도 스크린샷 1장
    육안 확인을 완료기준에 넣는다**(두 사례에서 그것이 유일한 포착 수단이었다).
12. **적대적 리뷰 0건은 게이트가 아니다.** 6렌즈·effort high로 0건을 받은 변경에서
    "슬라이스 범위 임의 축소(계획 미준수)"를 리뷰가 놓치고 메인 세션의 표적 검증이 잡았다.
    CSS 이전·토큰 제거·범위 축소가 섞인 변경이면 리뷰와 **별개로** 표적 검증을 돌린다.
    축소 여부는 슬라이스 문구가 아니라 **DoD의 *목적*으로 판정**한다.
13. **폴백 경로만 UAT하고 실데이터 경로를 이월하면 두 경로의 필드 집합 차이가 결함을 숨긴다**
    (폴백 `top10`엔 한글명이 있고 실경로 `holdings`엔 없어 "범례는 한글·목록은 영문"으로 회귀).
    이월할 땐 두 경로의 소스 필드 차이를 미리 대조한다.

---

## §10 실행 시 주의사항

- **전체 스위트 실행 후 `git status`로 부수효과를 확인**한다(§3). 추적 파일이 modified로 뜨면
  그 write 경로를 찾아 `tmp_path`로 격리하거나 read-only로 격하한다.
- 메인 체크아웃에서는 2분 폴러가 `LOCAL != origin/main`이면 `git reset --hard origin/main`을
  돌린다 — **커밋 안 한 tracked 편집과 push 안 한 로컬 커밋이 소실**된다.
  테스트/문서 변경도 `commit && git push origin main`을 묶어 즉시 반영한다.
  `.forge/` 등 untracked는 reset 대상이 아니라 안전하다.
- `pytest`는 실 DB에 닿지 않지만(§3) **라이브 배포 API를 때리는 프로브는 실데이터를 바꿀 수 있다** —
  프로브는 read + 자기 계정 토글 수준으로 유지하고, admin 쓰기는 §7.5의 경로를 쓴다.

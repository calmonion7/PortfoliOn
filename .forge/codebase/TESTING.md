---
last_mapped_commit: 8e37e2ca03c09e76a31dd227d4c252f19246a11a
mapped: 2026-07-14
---

# TESTING

PortfoliOn 테스트 프레임워크·구조·모킹·커버리지. 백엔드 pytest + 프론트 vitest 2계층.

## 1. Backend — pytest

### 1.1 실행·구성

- **러너**: `cd backend && .venv/bin/python -m pytest`(macOS). Windows는 `.venv/Scripts/python`.
- **구성 `backend/pytest.ini`**: `testpaths = tests`, `pythonpath = .`(그래서 테스트가 `from main import app`·`from routers.stocks import router`를 루트 기준 import).
- **규모**: `backend/tests/*.py` 약 **123개 파일**, `def test_`(및 `async def test_`) 약 **1,254개**. fixture 데이터는 `backend/tests/fixtures/`(예: `backlog/`).

### 1.2 `conftest.py` — autouse 가드 3종

`backend/tests/conftest.py`:

- **`client` fixture + 전역 auth override**: 모듈 로드 시 `from main import app` 후 `app.dependency_overrides[get_current_user] = lambda: "test-user-id"`. `client` fixture는 `TestClient(app)`. **main.app을 타는 테스트만** 이 override 적용.
- **`_clear_quote_cache`(autouse)**: 매 테스트 전 `cache.invalidate_quote()` — `get_quote`의 종목 단위 TTL 캐시 교차 오염 방지.
- **`_block_real_db`(autouse) — 가장 중요한 가드(task#169)**: `monkeypatch.setattr(services.db, "_get_pool", ...)`로 실 DB 접근을 raise 시킨다(`RuntimeError("tests must not touch the real DB — mock services.db.query/execute")`). 로컬 `DATABASE_URL`이 도커 postgres(=라이브 DB)를 가리켜, 가드 전엔 `generate_report` end-to-end 테스트의 스냅샷 INSERT가 prod에 커밋됐다(005930 클로버). **DB를 타는 테스트는 반드시 `services.db`의 `query`/`execute`/`execute_many` 또는 그 상위를 mock**한다. 가드가 raise하면 그 테스트가 실 DB에 닿는다는 뜻 — 가드를 풀지 말고 mock을 추가한다.

### 1.3 두 가지 앱 테스트 패턴

- **main.app 패턴(conftest `client`)**: `client` fixture로 `main.app`을 통째 호출. 전역 auth override가 이미 걸려 있음.
- **self-app 패턴(모듈 상단 `FastAPI()` 직접 생성)**: 많은 라우터 테스트가 `app = FastAPI(); app.include_router(router)` 후 필요한 auth 의존성을 개별 override(`test_stocks_router.py:9-15`가 전형 — `get_current_user`·`get_current_user_or_api_key`·`require_admin_or_api_key`를 각각 lambda로 override). **conftest override는 main.app 한정이라 self-app엔 안 걸린다** → 엔드포인트에 새 auth 의존성을 추가하면 self-app 테스트를 전수 grep해 override를 추가해야 401/403로 안 깨진다(CONVENTIONS §8). self-app 사용 파일 다수(`test_portfolio_router.py`·`test_watchlist_router.py`·`test_batch_endpoints.py`·`test_us_supply.py`·`test_macro_signals_batch.py` 등).
- **무인증 거부 검증은 override 없는 fresh app**: `backend/tests/test_security_auth_gaps.py`의 `_client(*routers)` 헬퍼가 override 없이 `FastAPI()`를 만들어 실제 auth 의존성을 태우고 `.status_code == 401`을 단언.

### 1.4 모킹 패턴

- **DB 레이어 mock**: `monkeypatch.setattr(svc, "query", fake_query)` / `"execute"` / `"execute_many"`(`test_disclosures.py`·`test_insider_digest_batch.py`). 문자열 경로 형식도 사용: `monkeypatch.setattr("services.db.query", lambda *a, **k: [])`(`test_job_runs_instrumentation.py`). `fake_query`가 SQL 문자열을 분기해 상황별 행을 반환하는 스타일.
- **외부 소스 mock**: `unittest.mock.patch("routers.stocks.storage.get_full_portfolio", return_value=...)`(`test_stocks_router.py`) — 서비스 함수를 호출 시점에 patch.
- **호출 시퀀스 단언**: read/외부호출 additive 추가 시 `mock.call_args`(마지막 호출) 대신 `call_args_list[i].kwargs`·`call_count`로 못박는다(`test_consensus_asof_batch.py`·`test_insider_digest_batch.py` 등, CONVENTIONS §8).
- **reload 패턴의 함정**: `importlib.reload(report_generator)`를 쓰는 테스트(`test_report_generator.py`·`test_report_price_gate.py`·`test_market.py`)는 **모듈 자체 정의 심볼 patch가 reload로 무효화**되니 하위 모듈 속성(`services.db.execute`·`_naver_get` 등)을 patch해야 한다(task#169).

### 1.5 규약 가드 테스트(스위트에 상주)

- **`test_no_print.py`**: `ast`로 앱 코드(`main.py`·`routers`·`services`·`scheduler`·`middleware`)의 `print()` 호출을 탐지, 신규 `print`를 차단(CONVENTIONS §4.1).
- **`test_api_doc_sync.py`**: 라이브 `app.routes` ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md` 헤더 대조로 엔드포인트 존재 drift 검출(CONVENTIONS §6).
- **배치 정합 테스트(exact-count/set)**: `test_batch_market_split.py`·`test_macro_signals_batch.py`가 `len(batch_registry.BATCHES) == 29`, `test_batches_router.py`가 `EXPECTED_IDS` set 동일 + `len(data) == 29`를 단언 — 배치 id 추가/삭제 시 이 3파일을 함께 고쳐야 스위트 통과(CONVENTIONS §11).
- **`test_batch_resilience.py`·`test_job_runs*.py`**: 배치 실패 graceful·`job_runs.record` 계측 검증.
- **SQL 형태 가드**: `test_db_execute_many.py`·`test_consensus_*`가 배치 SQL(ANY 배열 캐스트·VALUES placeholder 형태)을 단언. 단, query-mock 테스트는 라이브 SQL 정합(uuid 캐스트 등)을 못 잡으므로 SQL 신규/개작 슬라이스는 라이브 스모크를 별도 DoD로 둔다.

## 2. Frontend — vitest

### 2.1 실행·구성

- **러너**: `npm run --prefix frontend test`(= `vitest run`, `frontend/package.json:9`) 또는 `npx vitest run`.
- **구성은 `frontend/vite.config.js`의 `test` 블록**(`vite.config.js:88-91`): `environment: 'jsdom'`, `globals: true`(describe/it/expect 전역), `setupFiles: './src/test/setup.js'`. 별도 `vitest.config.*` 파일 없음.
- **setup `frontend/src/test/setup.js`**: `import '@testing-library/jest-dom'` 한 줄(matcher 확장).
- **의존성**: `@testing-library/react`·`@testing-library/jest-dom`·`vitest`(`package.json`).
- **규모**: 테스트 파일 **13개**, `it()`/`test()` 약 **79개**. 위치는 두 곳 — 공통 `frontend/src/test/`(`smoke.test.js`·`sidebar.test.jsx`·`route-redirects.test.jsx`·`compare-*.test.jsx`·`recommendations-s3s4.test.jsx`·`global-search-tracked.test.jsx`) + 소스 곁(`frontend/src/hooks/*.test.js`·`frontend/src/components/**/*.test.jsx`).

### 2.2 모킹 패턴

- **API 모듈 mock**: `vi.mock('../api', () => ({ default: { get: vi.fn(), delete: vi.fn() } }))` 후 `api.get.mockImplementation((url) => ...)`로 URL 분기 응답 반환(`usePortfolioData.test.js:4-22`). `beforeEach(() => { vi.clearAllMocks(); ... })`로 기본 응답 재설정.
- **훅 테스트**: `renderHook(() => useXxx())` + `act`/`waitFor`(`@testing-library/react`). 상태 전이(`listLoading`·`hasFetched`·`dashboardError`)를 `await waitFor(...)`로 단언(`usePortfolioData.test.js`).
- **Toast/useToast mock**: `vi.mock('./Toast', () => ({ useToast: () => ({ showToast: showToastMock }) }))`로 토스트 훅을 스텁(`PermissionPanel.test.jsx:8`). API mock도 같은 파일에서 `default: { get, put }` 형태로.
- **컴포넌트/라우팅 테스트**: `.test.jsx`에서 `@testing-library/react` render + jsdom.

### 2.3 커버리지 초점

- 훅의 에러 경로(fetch reject → loading false·error state 전파)를 명시 검증(`usePortfolioData.test.js` S1/S2 케이스).
- 라우트 리다이렉트·사이드바 필터·검색 트래킹 등 상호작용을 `frontend/src/test/`에서 통합 검증.
- **프론트엔드 로깅 규약(§4.2)에 대응하는 자동 테스트는 없다** — eslint `no-console`이 빌드/CI에 미배선이라 마커 준수는 리뷰 의존.

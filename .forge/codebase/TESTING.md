---
last_mapped_commit: 23c5cadc945073d41ee8b114fad293af35d774e5
mapped: 2026-07-12
---

# 테스트 패턴

백엔드는 **pytest**(`backend/tests/`, 121개 파일·1,277개 테스트 수집), 프론트엔드는 **Vitest + Testing Library**(`frontend/src/`, 11개 파일). 백엔드 테스트 다수가 *특정 버그 재발 방지 회귀·가드 테스트*(파일 docstring/함수명이 `task#N` 근거를 명시).

---

## 1. 프레임워크 & 실행

**백엔드:** pytest(`requirements.txt`의 `pytest>=7.4.0`). 설정 `backend/pytest.ini`:
```ini
[pytest]
testpaths = tests
pythonpath = .
```
어설션은 순수 `assert`. 모킹은 `unittest.mock`(patch/MagicMock)과 pytest `monkeypatch`.

```bash
cd backend && .venv/bin/python -m pytest                       # 전체
cd backend && .venv/bin/python -m pytest tests/test_no_print.py -q   # 단일 파일
```

**프론트엔드:** Vitest 4(`frontend/package.json`, `npm run test` = `vitest run`). 설정은 별도 파일 없이 `frontend/vite.config.js`의 `test` 블록(`environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.js'`). 렌더링은 `@testing-library/react`(^16)+`@testing-library/jest-dom`(^6), `jsdom`(^29). `frontend/src/test/setup.js`는 `import '@testing-library/jest-dom'` 한 줄.

```bash
cd frontend && npm run test     # vitest run (1회)
cd frontend && npx vitest       # watch 모드
```

커버리지 임계 게이트는 백엔드·프론트 둘 다 미도입.

---

## 2. 파일 조직

**백엔드 — 별도 디렉터리, co-located 아님:** 전부 `backend/tests/test_*.py`. 네이밍: 라우터=`test_<name>_router.py`, 서비스/기능=`test_<feature>.py`, 배치=`test_<feature>_batch.py`, 가드/회귀=의도명(`test_no_print.py`·`test_no_bare_today.py`·`test_api_doc_sync.py`·`test_nan_serialization_guards.py`). 대형 실데이터 픽스처는 `backend/tests/fixtures/`(`fixtures/backlog/` — DART 원문 HTML `005930.html` 등 11개).

**프론트엔드 — 혼합:** 훅 테스트는 **co-located** `hooks/<name>.test.js`(`usePortfolioData.test.js`·`useStockManagement.test.js`·`useReportFilters.test.js`). 컴포넌트/통합·스모크는 `src/test/`(`compare-race.test.jsx`·`global-search-tracked.test.jsx`·`recommendations-s3s4.test.jsx`·`route-redirects.test.jsx`·`sidebar.test.jsx`·`smoke.test.js`). `components/reports/`에 co-located 2종: `reportUtils.test.js`·`KeyResourceChart.test.js`. 확장자: JSX 렌더는 `.test.jsx`, 순수 로직/훅은 `.test.js`(예 `KeyResourceChart.test.js`는 `KeyResourceChart.jsx`에서 export한 순수 헬퍼 `groupMetricsByUnit`/`splitMetricsForRender`/`buildChartData`만 직접 import해 렌더 없이 검증).

---

## 3. 테스트 구조 (백엔드 — 3가지 스타일 공존)

**1. conftest `client` 픽스처** (`main.app` 전체 앱, `backend/tests/conftest.py`):
```python
from main import app
from auth import get_current_user
app.dependency_overrides[get_current_user] = lambda: "test-user-id"

@pytest.fixture
def client():
    return TestClient(app)
```
`from main import app`를 직접 쓰는 파일은 `test_api_doc_sync.py` 정도 — 나머지는 self-app.

**2. self-app 패턴** (모듈 상단에서 격리 앱 조립, 다수 파일). 최근 갱신된 `test_portfolio_router.py`·`test_watchlist_router.py`도 이 패턴:
```python
app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
client = TestClient(app)
```
`test_stocks_router.py`는 여기에 더해 `get_current_user_or_api_key`·`require_admin_or_api_key`까지 override한다.
**함정:** conftest는 `main.app`의 `get_current_user`만 override하므로, self-app 테스트는 자기 앱에서 **필요한 모든 auth 의존성을 직접 override**해야 한다 — 엔드포인트에 새 `Depends(require_admin...)`를 추가하면 그 경로를 호출하는 self-app 테스트를 전수 grep해 override 추가. 무인증 거부(401/403)는 override 없는 fresh app으로 별도 검증(`test_security_auth_gaps.py`).

**3. 함수 직접 호출 + patch 패턴** (라우터/앱 없이 서비스 함수 단위, 예 `test_storage.py`):
```python
from services import storage
with patch("services.storage.portfolio.query", return_value=[{"ticker": "AAPL"}]), \
     patch("services.storage.portfolio.execute", return_value=1):
    result = storage.enrich_stock("AAPL", {"moat": "wide"})
```
`test_report_generator.py`는 `contextlib.ExitStack`으로 외부 호출을 일괄 patch(소비 모듈 이름공간 `services.report_generator.mkt.get_quote` 등)한 뒤 `importlib.reload(report_generator)` → `generate_report(stock, tmp_path)`를 **tmp_path로** 실행(실 스냅샷 미접근). reload가 다수 케이스에서 반복 사용된다.

**공유 autouse 픽스처(conftest):**
```python
@pytest.fixture(autouse=True)
def _clear_quote_cache():
    from services import cache as cache_svc
    cache_svc.invalidate_quote()
    yield

@pytest.fixture(autouse=True)
def _block_real_db(monkeypatch):
    from services import db as db_svc
    def _no_real_db(*_a, **_k):
        raise RuntimeError("tests must not touch the real DB — mock services.db.query/execute")
    monkeypatch.setattr(db_svc, "_get_pool", _no_real_db)
```
**`_block_real_db`는 매우 중요(task#169)**: 로컬 `DATABASE_URL`이 도커 postgres(=라이브 DB)를 가리켜, 이 가드 이전엔 `generate_report` 류 end-to-end 테스트가 **prod `snapshots`/`calendar_cache`를 실제로 오염**시켰다(005930 스냅샷 클로버 사례). 가드는 커넥션풀 진입점 `db._get_pool`을 monkeypatch로 막아, DB에 닿는 순간 `RuntimeError`를 던진다. **DB를 타는 신규/기존 테스트는 반드시 `services.db`의 `query`/`execute`(또는 그 상위 소비 모듈, 예 `services.storage.portfolio.query`)를 mock할 것** — 가드가 `RuntimeError`를 던지면 그 테스트가 실 DB에 닿고 있다는 신호이며, 가드를 우회하지 말고 mock을 추가한다. `importlib.reload(module)` 패턴 테스트는 reload가 모듈 자체 심볼 patch를 무효화하므로 하위 모듈 속성(`services.db.execute` 등)을 patch할 것.

**프론트엔드:** Vitest `describe`/`it`/`expect` + `beforeEach(vi.clearAllMocks)`. 훅은 `renderHook`/`act`/`waitFor`. 컴포넌트는 `render`/`screen`/`fireEvent`/`waitFor`, 라우터 의존 컴포넌트는 `<MemoryRouter>`로 감싼다. `useNavigate`만 가로채려면 `vi.mock('react-router-dom', async (importOriginal) => ({ ...await importOriginal(), useNavigate: () => navigateMock }))`.

---

## 4. 모킹

**백엔드:**
- **외부 소스/서비스 호출을 `patch`로 대체**하는 게 표준. 대상은 **호출 지점의 이름공간**(`patch("routers.portfolio.storage.get_holdings", ...)`, 소비 모듈 기준 — 정의 모듈 아님).
- yfinance는 `patch("...yf.Ticker", MagicMock(...))` 또는 `patch.object(module.yf, "Ticker", FakeTicker)`로 가짜 치환.
- **지연 import는 patch 경로가 다르다**: 함수 본문에서 늦게 `from services.db import query`하는 코드는 **원 모듈** `services.db.query`를 patch(소비 모듈 속성이 아님).
- **모킹 함정**: 심볼 patch 대상은 "그 기능의 주 테스트 파일"에만 있지 않다 — import 제거/개명 시 `grep -rn "모듈경로.심볼" backend/tests/`로 전 파일 확인. additive read 추가 시 `mock.call_args`(마지막 호출) 단언 테스트는 `call_args_list[i].kwargs`로 마이그레이션.

**프론트엔드:** `vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() } }))`로 axios 인스턴스 모킹, `api.get.mockImplementation((url) => ...)`로 URL별 응답 분기(`useStockManagement.test.js`는 `api.post` 등을 mockResolvedValue로 세팅해 저장 흐름 검증). Context/Toast/훅/자식 컴포넌트도 `vi.mock`으로 통째 대체. 순수 로직 훅(`useReportFilters.test.js`)은 api mock 없이 술어 함수를 props로 주입해 합성만 characterize.

**무엇을 모킹하나:** 외부 I/O(DB·yfinance·DART·키움/KIS·Naver HTTP·axios). **무엇을 모킹 안 하나:** 순수 계산·정규화·직렬화(`sanitize`·지표 계산·SQL placeholder 형태 검증·프론트 순수 헬퍼)는 실제 실행.

---

## 5. 픽스처 & fixture-pass-live-fail 함정

- 백엔드는 **모듈 상수 dict**를 인라인 픽스처로(`SAMPLE_STOCK`/`SAMPLE_HOLDINGS`/`SAMPLE_FULL` 등). 대형 실데이터는 `backend/tests/fixtures/backlog/`(DART 원문 HTML).
- 프론트는 **팩토리 함수**(`const makeArgs = (over={}) => ({...})`·`const makeRecData = (market) => ({...})`).
- **query-mock/fixture는 라이브 정합을 못 잡는다(반복 재발 가족)**: 외부소스 파싱·신규/개작 SQL 슬라이스는 fixture 단위 테스트 외에 **배포 후 라이브 스모크/1종목 추출 대조를 DoD에 포함**. 회귀 fixture는 실구조 반영 필수(DB NUMERIC은 float 아닌 **Decimal**로 시드). 값-수준 실패(성공응답의 빈/None)를 재현하려면 예외 `side_effect`가 아니라 **빈 값을 반환하는 mock**이어야 그 경로를 실제로 친다. `_block_real_db`가 fixture-writes-live(테스트가 실 DB를 fixture로 덮음)를 원천 차단한다(§3).

---

## 6. 주목할 가드·회귀 테스트

- **`test_no_print.py`** — `main.py`·`routers`·`services`·`scheduler`·`middleware`를 ast walk, `print()` 호출 노드 0건 단언(CONVENTIONS §4).
- **`test_no_bare_today.py`** — bare `date.today()`/`datetime.today()` ast 스윕(CONVENTIONS §9). 앱 코드는 KST 헬퍼 사용해야 통과.
- **`test_api_doc_sync.py`** — 라이브 `main.app.routes`(method+path) ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md`의 `### \`METHOD /path\`` 헤더 exact-match 대조. `KNOWN_UNDOCUMENTED` 베이스라인으로 신규 미문서화를 즉시 검출.
- **`test_nan_serialization_guards.py`** — NaN/inf가 `allow_nan=False` 500을 안 내는지, corr가 None으로 가드되는지.
- **`test_security_auth_gaps.py`** — override 없는 fresh app으로 무인증 401/403 검증.
- **count/set 하드코딩 단언(4파일 흩어짐)** — `test_scheduler_seed.py`·`test_batch_market_split.py`·`test_batches_router.py`·`test_macro_signals_batch.py`가 배치 id 개수/집합을 exact-match로 단언. 배치 id 추가/제거 시 4파일 전수 갱신 필요.
- **단건→배치 SQL 개작 함정** — `test_upsert_disclosures_batch.py`·`test_upsert_trend_batch.py`·`test_db_execute_many.py`(`ANY(%s::uuid[])` 캐스트, VALUES placeholder 형태) 회귀.
- **KR 시세 다수결/게이트** — `test_kr_quote_degenerate_reuse.py`·`test_kr_quote_escalation_isolation.py`·`test_report_price_gate.py`가 독립피드 교차검증·박제 스킵 로직 고정.
- **빈/부분 실패 last-good 가드** — `test_fx_partial_failure.py`·`test_kospi_futures.py`·`test_us_supply_empty_guard.py`·`test_rankings_empty_guard.py`·`test_public_api_empty_items.py`가 성공응답의 빈 output이 캐시를 클로버하지 않는지 단언.
- **원자성** — `test_rec_store_atomic.py`·`test_consensus_backfill_atomic.py`가 DELETE+INSERT 단일 트랜잭션 실행을 단언.
- **프론트 race/추적/IA 가드** — `compare-race.test.jsx`(비교 페이지 늦은 응답이 최신 선택을 안 덮음), `global-search-tracked.test.jsx`(전역 검색 추적), `route-redirects.test.jsx`(라우트 리다이렉트), `sidebar.test.jsx`(사이드바 IA — ADR-0025).
- **프론트 순수 헬퍼 characterize** — `KeyResourceChart.test.js`(단위그룹핑·차트/표 분할·distinct 분기 폴백), `useReportFilters.test.js`(서브탭 분기·시장 카운트·정렬), `reportUtils.test.js`.

---

## 7. 흔한 패턴

**프론트 async 전이(훅):**
```js
const { result } = renderHook(() => usePortfolioData())
expect(result.current.listLoading).toBe(true)
await waitFor(() => expect(result.current.listLoading).toBe(false))
```

**프론트 훅 액션 검증(`useStockManagement`):**
```js
await act(async () => { await result.current.handleSave({ ticker: 'NVDA' }) })
expect(api.post).toHaveBeenCalledWith('/api/portfolio', { ticker: 'NVDA' })
```

**백엔드 HTTP 상태·바디 단언:**
```python
resp = client.get("/api/portfolio")
assert resp.status_code == 200
assert resp.json()["stocks"][0]["ticker"] == "NFLX"
```

**직렬화 안전 단언:** 응답 dict를 `json.dumps(result, allow_nan=False)`로 감싸 NaN/inf 500 회귀를 직접 재현.

**단일 트랜잭션 단언:** `get_connection`을 가짜 컨텍스트매니저로 monkeypatch해 DELETE/INSERT가 같은 커서에서 실행되는지 단언(`test_rec_store_atomic.py`).

---

## 8. 프론트 UAT (Playwright 스크립트)

정식 테스트 스위트와 별개로, **루트 `scripts/`에 1회성 Playwright UAT 스크립트**(약 40개, `uat*.mjs`/`uat-*.js` — task 번호를 파일명에 박음, 예 `scripts/uat181-dividend-regions.mjs`·`uat182.mjs`). `scripts/package.json`에 playwright 의존성 별도 관리.
- 용도: 배포 후 라이브 화면 검증·스크린샷 캡처(`scripts/screenshot.js`·`capture-ux.js`·`capture-report-detail.js`) — 폰 없이 디바이스 에뮬레이션. 테스트 계정·격리 하니스는 `reference-frontend-uat.md`(메모리) 참조.
- gitignore 대상 아니지만 untracked 관례(회귀 스위트가 아니라 일회성 검증 도구, 결과 스크린샷은 `screenshots-uat*/`에 저장).

---

*테스트 갱신 근거: 2026-07-12(HEAD 23c5cadc). 직전 지도(b52f0f5e, 2026-07-12) 대비: 백엔드 파일 수 정정(121파일·1,277개 수집), 프론트 10→11파일(`components/reports/KeyResourceChart.test.js` 추가 — 순수 헬퍼 characterize), 최근 갱신 백엔드 파일 반영(`test_portfolio_router`·`test_watchlist_router`=self-app, `test_storage`=함수+patch, `test_report_generator`=ExitStack+reload+tmp_path). `_block_real_db` autouse 가드(conftest) 구조 확정. 구조·모킹·가드 패턴은 안정.*

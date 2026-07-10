---
last_mapped_commit: 1e8da3bc525d61545c6c374b1f91a04238dabf30
mapped: 2026-07-10
---

# 테스트 패턴

**분석 기준일:** 2026-07-10

백엔드는 **pytest**(`backend/tests/`, 121개 파일·1,256개 테스트 수집 확인), 프론트엔드는 **Vitest + Testing Library**(`frontend/src/`, 7개 파일). 백엔드 테스트가 압도적으로 두터우며, 상당수가 *특정 버그 재발을 막는 회귀·가드 테스트*다(각 파일 상단 docstring이 `task#N`/헌트 근거를 명시).

---

## 1. 테스트 프레임워크

**백엔드:**
- Runner: **pytest**(`requirements.txt`의 `pytest>=7.4.0`). 설정 `backend/pytest.ini`:
  ```ini
  [pytest]
  testpaths = tests
  pythonpath = .
  ```
- 어설션: 순수 `assert`(pytest 재작성).
- 모킹: 표준 `unittest.mock`(`patch`·`MagicMock`·`patch.object`)와 pytest `monkeypatch`.

**프론트엔드:**
- Runner: **Vitest 4**(`frontend/package.json`, `vitest run`). 설정은 별도 파일이 아니라 `frontend/vite.config.js`의 `test` 블록:
  ```js
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
  }
  ```
- 렌더링: `@testing-library/react`(+`@testing-library/jest-dom` matcher). 환경 `jsdom`.
- setup 파일 `frontend/src/test/setup.js`는 `import '@testing-library/jest-dom'` 한 줄(matcher 등록).

**실행 커맨드:**
```bash
# 백엔드 (프로젝트 루트에서)
cd backend && .venv/bin/python -m pytest            # 전체
cd backend && .venv/bin/python -m pytest tests/test_no_print.py -q   # 단일 파일

# 프론트엔드
cd frontend && npm run test                          # vitest run (1회)
cd frontend && npx vitest                             # watch 모드
```
- 커버리지 임계 설정 없음(강제 커버리지 게이트 미도입).

---

## 2. 테스트 파일 조직

**백엔드 — 별도 디렉터리:**
- 전부 `backend/tests/test_*.py`. co-located 아님. `tests/__init__.py` 존재.
- 네이밍은 대상별 접미사: 라우터=`test_<name>_router.py`(`test_stocks_router.py`·`test_report_router.py`), 서비스/기능=`test_<feature>.py`(`test_dividends.py`·`test_backlog.py`), 배치=`test_<feature>_batch.py`, 가드/회귀=의도명(`test_no_print.py`·`test_no_bare_today.py`·`test_api_doc_sync.py`·`test_nan_serialization_guards.py`·`test_security_auth_gaps.py`).
- 데이터 픽스처 파일은 `backend/tests/fixtures/`(현재 `fixtures/backlog/` — DART 원문 등 대형 입력).

**프론트엔드 — 혼합:**
- 훅 테스트는 **co-located** `hooks/<name>.test.js`(`usePortfolioData.test.js`·`useStockManagement.test.js`·`useReportFilters.test.js`).
- 컴포넌트/통합·스모크는 `src/test/`(`recommendations-s3s4.test.jsx`·`compare-race.test.jsx`·`global-search-tracked.test.jsx`·`smoke.test.js`) + setup(`src/test/setup.js`).
- 확장자: JSX 렌더 테스트는 `.test.jsx`, 순수 로직/훅은 `.test.js`.

---

## 3. 테스트 구조

**백엔드 — 두 가지 TestClient 스타일이 공존한다(중요):**

1. **conftest `client` 픽스처**(`main.app` 전체 앱 사용). `backend/tests/conftest.py`:
   ```python
   from main import app
   from auth import get_current_user
   app.dependency_overrides[get_current_user] = lambda: "test-user-id"

   @pytest.fixture
   def client():
       return TestClient(app)

   @pytest.fixture(autouse=True)
   def _clear_quote_cache():   # 테스트 간 시세 TTL 캐시 교차오염 방지
       from services import cache as cache_svc
       cache_svc.invalidate_quote()
       yield
   ```
   → `from main import app`을 직접 쓰는 테스트 파일은 `test_api_doc_sync.py` 하나뿐(+conftest). 나머지는 아래 self-app.

2. **self-app 패턴**(모듈 상단에서 격리 앱을 직접 조립, 35개 파일). `test_stocks_router.py` 대표 예:
   ```python
   from fastapi import FastAPI
   from fastapi.testclient import TestClient
   from routers.stocks import router
   from auth import get_current_user, get_current_user_or_api_key, require_admin_or_api_key

   app = FastAPI()
   app.include_router(router)
   app.dependency_overrides[get_current_user] = lambda: "test-user-id"
   app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
   app.dependency_overrides[require_admin_or_api_key] = lambda: "test-user-id"
   client = TestClient(app)
   ```
   → **함정(CLAUDE.md에도 명시):** conftest는 `main.app`의 `get_current_user`만 override하므로, self-app 테스트는 자기 앱에서 **필요한 모든 auth 의존성을 직접 override**해야 한다. 엔드포인트에 새 `Depends(require_admin ...)`를 추가하면 그 경로를 호출하는 self-app 테스트를 전수 grep해 override를 추가할 것. 무인증 거부(401/403)는 **override 없는 fresh app**으로 별도 검증(`tests/test_security_auth_gaps.py` 패턴).

- 상태를 가진 인메모리 캐시를 건드리는 테스트는 **autouse 픽스처로 테스트 간 캐시를 비운다**(conftest `_clear_quote_cache`, `test_report_list_user_cache.py`의 `_clear_list_cache`가 `cache_svc.invalidate_list()` 호출).
- 어설션은 `resp.status_code` + `resp.json()` 필드 단언 위주. 테스트 함수명은 서술형(`test_get_stocks_returns_flat_list_with_type`, `test_clear_cache_deletes_user_scoped_calendar_cache_rows`).
- 클래스 그룹핑은 드묾 — 대체로 모듈 레벨 함수 나열.

**프론트엔드:**
- Vitest `describe`/`it`/`expect` + `beforeEach(vi.clearAllMocks)`.
- 훅: `renderHook`/`act`/`waitFor`(`@testing-library/react`)로 상태 전이 단언(`usePortfolioData.test.js`).
- 컴포넌트: `render`/`screen`/`fireEvent`/`waitFor`, 라우터 의존 컴포넌트는 `<MemoryRouter>`로 감싼다(`recommendations-s3s4.test.jsx`). `useNavigate`만 가로채려면 `vi.mock('react-router-dom', async (importOriginal) => ({ ...await importOriginal(), useNavigate: () => navigateMock }))` 패턴(`global-search-tracked.test.jsx`).

---

## 4. 모킹

**백엔드:**
- **외부 소스/서비스 호출을 `patch`로 대체**하는 게 표준(unittest.mock/patch를 76개 파일이 사용, `monkeypatch`는 46개 파일). 대상은 **호출 지점의 이름공간**을 가리킨다: `patch("routers.stocks.storage.enrich_stock", return_value=True)`, `patch("routers.recommendations.storage.get_full_portfolio", ...)`.
  ```python
  with patch("routers.stocks.storage.enrich_stock", side_effect=mock_enrich):
      resp = client.put("/api/stocks/enrich/batch", json=[...])
  ```
- `patch.object(module.yf, "Ticker", FakeTicker)`로 yfinance를 가짜 클래스로 치환(`test_nan_serialization_guards.py`의 `_ConstTicker`가 제로분산 종가 → NaN corr 유발).
- **지연 import는 patch 경로가 다르다**: 함수 본문 안에서 `from services.db import query as db_query`처럼 늦게 import하는 코드는 `services.db.query`(원 모듈)를 patch해야 한다 — 소비 모듈 속성(`svc.query`)을 patch하면 안 걸린다(`test_us_supply_empty_guard.py`가 이 주의를 주석으로 명시).
- **모킹 함정(CLAUDE.md):** 심볼을 patch할 때 대상은 "그 기능의 주 테스트 파일"에만 있지 않다 — import를 제거/개명하면 `grep -rn "모듈경로.심볼" backend/tests/`로 patch 경로를 전수 확인(task#167에서 `routers/calendar._CACHE_DIR` 제거 시 `test_calendar_router.py`의 patch 10곳을 함께 제거한 실사례). 엔드포인트에 read/외부호출을 additive로 추가하면 `mock.call_args`(마지막 호출)를 단언하던 기존 테스트가 오염되므로 `call_args_list[i].kwargs`로 마이그레이션.

**프론트엔드:**
- **`vi.mock('../api', ...)`로 axios 인스턴스를 모킹**하는 게 표준:
  ```js
  vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
  import api from '../api'
  ...
  api.get.mockImplementation((url) => { if (url === '/api/portfolio') return Promise.resolve({ data: {...} }) ... })
  ```
- Context/Toast/훅/자식 컴포넌트도 `vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))`, `vi.mock('../hooks/usePortfolioData', ...)`처럼 통째 대체(`compare-race.test.jsx`·`global-search-tracked.test.jsx`).

**무엇을 모킹하나:** 외부 I/O(DB·yfinance·DART·키움/KIS·Naver HTTP·axios). **무엇을 모킹 안 하나:** 순수 계산·정규화·직렬화 로직은 실제 실행(예 `sanitize`·지표 계산·SQL placeholder 형태 검증).

---

## 5. 픽스처와 팩토리

- 백엔드는 **모듈 상수 dict**를 인라인 픽스처로 쓴다(`SAMPLE_PORTFOLIO = {"stocks": [...], "watchlist": [...]}` in `test_stocks_router.py`). 대형 실데이터 입력은 `backend/tests/fixtures/backlog/` 파일로 둔다.
- 프론트는 **팩토리 함수**로 케이스별 데이터를 만든다(`const makeRecData = (market) => ({ discovery: [...], ... })`, `makeRecDataWithWatchlist()` in `recommendations-s3s4.test.jsx`).
- **픽스처-통과·라이브-실패 함정(반복 재발, CLAUDE.md):** query-mock/fixture는 라이브 정합을 못 잡는다. 외부소스 파싱·신규/개작 SQL 슬라이스는 fixture 단위 테스트 외에 **배포 후 라이브 스모크/1종목 추출 대조를 DoD에 포함**. 회귀 fixture는 실구조를 반영해야 한다(예 DB NUMERIC은 float가 아니라 **Decimal**로 시드해야 `float/Decimal` TypeError를 잡는다). 값-수준 실패(성공응답의 빈/None 반환)를 재현하려면 예외 `side_effect`가 아니라 **빈 값을 반환하는 mock**이어야 그 경로를 실제로 친다.

---

## 6. 주목할 가드·회귀 테스트

이 프로젝트의 테스트 다수는 특정 버그의 재발 방지 가드다. 코드 변경 시 어떤 테스트가 무엇을 못박는지 알아야 한다.

- **`tests/test_no_print.py`** — 로깅 규약 가드(CONVENTIONS §4). `main.py`·`routers`·`services`·`scheduler`·`middleware`를 ast로 walk해 `print()` 호출 노드가 있으면 실패(문자열/주석/pprint 오탐 없음). `tests/`·`scripts/`·`data/`는 대상 외. 신규 `print(`를 넣으면 즉시 실패한다.
- **`tests/test_no_bare_today.py`** — bare `date.today()`/`datetime.today()` ast 스윕 가드(task#157/#165, CONVENTIONS §8). 같은 앱 코드 대상 범위에서 `.today()` 호출 노드를 탐지 — 앱 코드는 `services.utils.today_kst()`를 써야 통과.
- **`tests/test_api_doc_sync.py`** — 엔드포인트 존재 drift 자동검출(task#99). 라이브 `main.app.routes`(method+path) ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md`의 `### \`METHOD /path\`` 헤더를 대조. path param 철자·쿼리스트링·끝 슬래시는 정규화(`{ticker}`→`{}`). 미문서화 기존 엔드포인트는 `KNOWN_UNDOCUMENTED` 베이스라인으로 동결(문서화하면 거기서 빼야 통과).
- **`tests/test_nan_serialization_guards.py`** — NaN/inf가 응답을 오염시켜 starlette `allow_nan=False` 500을 내지 않는지 검증(task#109). `json.dumps(result, allow_nan=False)`가 통과하고 corr가 None으로 가드됨을 단언.
- **`tests/test_security_auth_gaps.py`** — override 없는 fresh app으로 무인증 401/403을 검증(self-app override와 분리).
- **count/set 하드코딩 단언(4파일 흩어짐)** — `test_scheduler_seed.py`·`test_batch_market_split.py`·`test_batches_router.py`·`test_macro_signals_batch.py`가 배치 id 개수/집합을 exact-match로 단언. 배치 id를 추가/제거하면 이 4파일을 전수 갱신해야 스위트가 통과.
- **`tests/test_upsert_disclosures_batch.py`·`test_upsert_trend_batch.py`·`test_db_execute_many.py`** — 단건→배치 SQL 개작 함정(`= ANY(%s::uuid[])` 캐스트, VALUES placeholder 형태)을 못박는 회귀.
- **KR 시세 다수결/게이트** — `test_kr_quote_degenerate_reuse.py`·`test_kr_quote_escalation_isolation.py`·`test_report_price_gate.py`가 독립피드 교차검증·박제 스킵 로직을 고정.
- **헌트164(task#165~166) 신규 가드 5종:**
  - `tests/test_report_list_user_cache.py` — `GET /api/report/list` 캐시의 user_id별 키 분리(교차 사용자 캐시 유출 회귀, `cache.get_list(user_id, loader)`).
  - `tests/test_rec_store_atomic.py` — `recommendation.store.replace_recommendations`의 delete+insert 단일 커넥션/트랜잭션(중단 시 rollback으로 기존 행 보존).
  - `tests/test_us_supply_empty_guard.py` — yfinance "성공-but-빈응답"(`t.info=={}`)을 `_is_all_empty` 가드가 upsert 스킵(last-good 클로버 방지).
  - `tests/test_fx_partial_failure.py` — FX 부분 실패 시 실패 심볼만 직전 저장값으로 보전(성공 심볼은 갱신).
  - `tests/test_calendar_cache_invalidation.py` — 종목 mutation 시 `calendar_cache` DB 테이블(라이브 저장소)이 user_id 스코프로 무효화되는지(`clear_cache` → `DELETE FROM calendar_cache WHERE user_id = %s`). ※ task#167에서 캘린더 파일 캐시(`_CACHE_DIR`)가 제거되어 `test_calendar_router.py`의 관련 patch도 함께 삭제됨.
- **프론트 race/추적 가드** — `frontend/src/test/compare-race.test.jsx`(비교 페이지 늦은 응답이 최신 선택을 덮지 않음), `frontend/src/test/global-search-tracked.test.jsx`(전역 검색 선택 동작). 스모크는 `frontend/src/test/smoke.test.js`.

---

## 7. 흔한 패턴

**async/전이 테스트(프론트 훅):**
```js
const { result } = renderHook(() => usePortfolioData())
expect(result.current.listLoading).toBe(true)
await waitFor(() => expect(result.current.listLoading).toBe(false))
```

**에러 경로 테스트(reject → 상태 방어):**
```js
api.get.mockImplementation((url) =>
  url === '/api/portfolio' ? Promise.reject(new Error('network error')) : Promise.resolve({ data: {} }))
// listLoading이 false로 떨어지고 hasFetched는 false 유지되는지 단언
```

**HTTP 상태·바디 단언(백엔드):**
```python
resp = client.put("/api/stocks/LLY/enrich", json={"moat": "x"})
assert resp.status_code == 200
assert set(resp.json()["updated"]) == {"moat", "growth_plan"}
```

**직렬화 안전 단언(백엔드):** 응답 dict를 `json.dumps(result, allow_nan=False)`로 감싸 NaN/inf 500 회귀를 직접 재현.

**단일 트랜잭션 단언(백엔드):** `get_connection`을 가짜 컨텍스트매니저로 monkeypatch해 DELETE와 INSERT가 같은 커서에서 실행되는지, INSERT 중 예외 시 커밋이 없는지를 단언(`test_rec_store_atomic.py`).

---

## 8. 프론트 UAT (Playwright 스크립트)

- 정식 테스트 스위트와 별개로, **루트 `scripts/`에 1회성 Playwright UAT 스크립트**를 둔다(`scripts/uat-79.js`·`uat146-shot.mjs`·`uat153-reverify.mjs` 등 — task 번호를 파일명에 박음). `scripts/package.json`에 playwright 의존성.
- 용도: 배포 후 라이브 화면 검증·스크린샷 캡처(`scripts/screenshot.js`·`capture-ux.js`) — 폰 없이 디바이스 에뮬레이션으로 검증. 테스트 계정은 memory(`reference-frontend-uat.md`) 참조.
- 이 스크립트들은 gitignore 대상이 아니지만 untracked로 남는 관례(회귀 스위트가 아니라 일회성 검증 도구).

---

*테스트 분석: 2026-07-10 (HEAD 1e8da3b 재검증 — 직전 지도 ad7f85c 대비: 테스트 117→121파일/≈1,207→1,256개, 프론트 5→7파일, 헌트164 가드 5종 + `test_no_bare_today.py` 추가, 캘린더 `_CACHE_DIR` patch 제거)*

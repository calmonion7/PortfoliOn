---
last_mapped_commit: ad7f85c68bdc80f3037212cf4b368c201a48054e
mapped: 2026-07-09
---

# 테스트 패턴

**분석 기준일:** 2026-07-09

백엔드는 **pytest**(`backend/tests/`, 117개 파일·≈1,207개 테스트), 프론트엔드는 **Vitest + Testing Library**(`frontend/src/`, 5개 파일). 백엔드 테스트가 압도적으로 두터우며, 상당수가 *특정 버그 재발을 막는 회귀·가드 테스트*다(각 파일 상단 docstring이 `task#N` 근거를 명시).

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
- 네이밍은 대상별 접미사: 라우터=`test_<name>_router.py`(`test_stocks_router.py`·`test_report_router.py`), 서비스/기능=`test_<feature>.py`(`test_dividends.py`·`test_backlog.py`), 배치=`test_<feature>_batch.py`, 가드/회귀=의도명(`test_no_print.py`·`test_api_doc_sync.py`·`test_nan_serialization_guards.py`·`test_security_auth_gaps.py`).
- 데이터 픽스처 파일은 `backend/tests/fixtures/`(현재 `fixtures/backlog/` — DART 원문 등 대형 입력).

**프론트엔드 — 혼합:**
- 훅 테스트는 **co-located** `hooks/<name>.test.js`(`usePortfolioData.test.js`·`useStockManagement.test.js`·`useReportFilters.test.js`).
- 컴포넌트/통합·스모크는 `src/test/`(`recommendations-s3s4.test.jsx`·`smoke.test.js`) + setup(`src/test/setup.js`).
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
   → `from main import app`을 쓰는 테스트는 **2개뿐**. 나머지는 아래 self-app.

2. **self-app 패턴**(모듈 상단에서 격리 앱을 직접 조립, ≈34개 파일). `test_stocks_router.py` 대표 예:
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

- 어설션은 `resp.status_code` + `resp.json()` 필드 단언 위주. 테스트 함수명은 서술형(`test_get_stocks_returns_flat_list_with_type`, `test_enrich_single_stock_returns_404_when_not_found`).
- 클래스 그룹핑은 드묾 — 대체로 모듈 레벨 함수 나열.

**프론트엔드:**
- Vitest `describe`/`it`/`expect` + `beforeEach(vi.clearAllMocks)`.
- 훅: `renderHook`/`act`/`waitFor`(`@testing-library/react`)로 상태 전이 단언(`usePortfolioData.test.js`).
- 컴포넌트: `render`/`screen`/`fireEvent`/`waitFor`, 라우터 의존 컴포넌트는 `<MemoryRouter>`로 감싼다(`recommendations-s3s4.test.jsx`).

---

## 4. 모킹

**백엔드:**
- **외부 소스/서비스 호출을 `patch`로 대체**하는 게 표준(unittest.mock을 100개 파일이 import). 대상은 **호출 지점의 이름공간**을 가리킨다: `patch("routers.stocks.storage.enrich_stock", return_value=True)`, `patch("routers.recommendations.storage.get_full_portfolio", ...)`.
  ```python
  with patch("routers.stocks.storage.enrich_stock", side_effect=mock_enrich):
      resp = client.put("/api/stocks/enrich/batch", json=[...])
  ```
- `patch.object(module.yf, "Ticker", FakeTicker)`로 yfinance를 가짜 클래스로 치환(`test_nan_serialization_guards.py`의 `_ConstTicker`가 제로분산 종가 → NaN corr 유발).
- `monkeypatch`(44개 파일) — 모듈 속성/함수 교체에 사용.
- **모킹 함정(CLAUDE.md):** 심볼을 patch할 때 대상은 "그 기능의 주 테스트 파일"에만 있지 않다 — import를 제거/개명하면 `grep -rn "모듈경로.심볼" backend/tests/`로 patch 경로를 전수 확인. 엔드포인트에 read/외부호출을 additive로 추가하면 `mock.call_args`(마지막 호출)를 단언하던 기존 테스트가 오염되므로 `call_args_list[i].kwargs`로 마이그레이션.

**프론트엔드:**
- **`vi.mock('../api', ...)`로 axios 인스턴스를 모킹**하는 게 표준:
  ```js
  vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
  import api from '../api'
  ...
  api.get.mockImplementation((url) => { if (url === '/api/portfolio') return Promise.resolve({ data: {...} }) ... })
  ```
- Context/Toast도 `vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))`처럼 대체.

**무엇을 모킹하나:** 외부 I/O(DB·yfinance·DART·키움/KIS·Naver HTTP·axios). **무엇을 모킹 안 하나:** 순수 계산·정규화·직렬화 로직은 실제 실행(예 `sanitize`·지표 계산·SQL placeholder 형태 검증).

---

## 5. 픽스처와 팩토리

- 백엔드는 **모듈 상수 dict**를 인라인 픽스처로 쓴다(`SAMPLE_PORTFOLIO = {"stocks": [...], "watchlist": [...]}` in `test_stocks_router.py`). 대형 실데이터 입력은 `backend/tests/fixtures/backlog/` 파일로 둔다.
- 프론트는 **팩토리 함수**로 케이스별 데이터를 만든다(`const makeRecData = (market) => ({ discovery: [...], ... })`, `makeRecDataWithWatchlist()` in `recommendations-s3s4.test.jsx`).
- **픽스처-통과·라이브-실패 함정(반복 재발, CLAUDE.md):** query-mock/fixture는 라이브 정합을 못 잡는다. 외부소스 파싱·신규/개작 SQL 슬라이스는 fixture 단위 테스트 외에 **배포 후 라이브 스모크/1종목 추출 대조를 DoD에 포함**. 회귀 fixture는 실구조를 반영해야 한다(예 DB NUMERIC은 float가 아니라 **Decimal**로 시드해야 `float/Decimal` TypeError를 잡는다).

---

## 6. 주목할 가드·회귀 테스트

이 프로젝트의 테스트 다수는 특정 버그의 재발 방지 가드다. 코드 변경 시 어떤 테스트가 무엇을 못박는지 알아야 한다.

- **`tests/test_no_print.py`** — 로깅 규약 가드(§CONVENTIONS §4). `main.py`·`routers`·`services`·`scheduler`·`middleware`를 ast로 walk해 `print()` 호출 노드가 있으면 실패(문자열/주석/pprint 오탐 없음). `tests/`·`scripts/`·`data/`는 대상 외. 신규 `print(`를 넣으면 즉시 실패한다.
- **`tests/test_api_doc_sync.py`** — 엔드포인트 존재 drift 자동검출(task#99). 라이브 `main.app.routes`(method+path) ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md`의 `### \`METHOD /path\`` 헤더를 대조. path param 철자·쿼리스트링·끝 슬래시는 정규화(`{ticker}`→`{}`). 미문서화 기존 엔드포인트는 `KNOWN_UNDOCUMENTED` 베이스라인으로 동결(문서화하면 거기서 빼야 통과).
- **`tests/test_nan_serialization_guards.py`** — NaN/inf가 응답을 오염시켜 starlette `allow_nan=False` 500을 내지 않는지 검증(task#109). `json.dumps(result, allow_nan=False)`가 통과하고 corr가 None으로 가드됨을 단언.
- **`tests/test_security_auth_gaps.py`** — override 없는 fresh app으로 무인증 401/403을 검증(self-app override와 분리).
- **count/set 하드코딩 단언(4파일 흩어짐)** — `test_scheduler_seed.py`·`test_batch_market_split.py`·`test_batches_router.py`·`test_macro_signals_batch.py`가 배치 id 개수/집합을 exact-match로 단언. 배치 id를 추가/제거하면 이 4파일을 전수 갱신해야 스위트가 통과.
- **`tests/test_upsert_disclosures_batch.py`·`test_upsert_trend_batch.py`·`test_db_execute_many.py`** — 단건→배치 SQL 개작 함정(`= ANY(%s::uuid[])` 캐스트, VALUES placeholder 형태)을 못박는 회귀.
- **KR 시세 다수결/게이트** — `test_kr_quote_degenerate_reuse.py`·`test_kr_quote_escalation_isolation.py`·`test_report_price_gate.py`가 독립피드 교차검증·박제 스킵 로직을 고정.
- **프론트 스모크** — `frontend/src/test/smoke.test.js`가 기본 렌더/부팅 회귀를 잡는다.

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

---

*테스트 분석: 2026-07-09*

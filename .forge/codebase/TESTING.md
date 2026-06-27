---
last_mapped_commit: 74f5ca940c42a3ee866a45ccccfe24ac701a04d9
mapped: 2026-06-27
---

# 테스트 패턴

**분석일:** 2026-06-27

백엔드는 pytest, 프론트엔드는 vitest를 쓴다(프론트 하니스는 ADR-0019, `.forge/adr/0019-frontend-test-harness-vitest.md`). 백엔드 테스트가 본진(약 80개 파일)이고, 프론트는 로직 훅 위주의 경량 하니스다.

## 테스트 프레임워크

### 백엔드 — pytest

- **러너:** pytest. 설정 `backend/pytest.ini`:

```ini
[pytest]
testpaths = tests
pythonpath = .
```

- **클라이언트:** FastAPI `TestClient`(`fastapi.testclient`). HTTP 단언으로 라우터를 검증.
- **모킹:** stdlib `unittest.mock`(`patch`, `MagicMock`) + pytest `monkeypatch` 둘 다 사용(약 48개 파일이 `unittest.mock`, 약 33개 파일이 `monkeypatch`).

**실행 명령:**

```bash
# 전체 (프로젝트 루트에서)
cd backend && .venv/bin/python -m pytest

# 특정 파일
cd backend && .venv/bin/python -m pytest tests/test_stocks_router.py

# 특정 테스트
cd backend && .venv/bin/python -m pytest tests/test_api_doc_sync.py::test_api_spec_documents_all_live_endpoints -v
```

> macOS 가상환경은 `backend/.venv/bin/python`, Windows는 `backend/.venv/Scripts/python`.
> **로컬 `.venv` ≠ Docker 의존성:** `lxml`은 Docker 이미지엔 있지만 로컬 `.venv`엔 없다. 로컬 pytest로 검증할 HTML 파싱은 `BeautifulSoup(html, "html.parser")`(stdlib)를 쓴다 — `"lxml"`을 쓰면 로컬에서만 깨진다.

### 프론트엔드 — vitest

- **러너:** vitest 4 + jsdom. 설정은 `frontend/vite.config.js`의 `test` 블록:

```js
test: {
  environment: 'jsdom',
  globals: true,
  setupFiles: './src/test/setup.js',
},
```

- **컴포넌트/훅 테스트:** `@testing-library/react`(`renderHook`, `act`) + `@testing-library/jest-dom`. 셋업 `frontend/src/test/setup.js`는 `import '@testing-library/jest-dom'` 한 줄.
- **모킹:** vitest `vi`(`vi.mock`, `vi.fn`, `vi.spyOn`, `vi.clearAllMocks`).

**실행 명령:**

```bash
cd frontend && npm test        # vitest run (1회 실행, package.json scripts.test)
cd frontend && npx vitest       # watch 모드
cd frontend && npm run lint      # eslint (테스트 아님, 함께 돌리는 게 관행)
```

## 테스트 파일 구성

### 백엔드

- **위치:** 전부 `backend/tests/`에 평평하게 둔다(`backend/tests/__init__.py` 존재 — 패키지). `pytest.ini`의 `testpaths = tests`로 수집.
- **네이밍:** `test_<대상>.py`. 라우터=`test_<name>_router.py`(`test_stocks_router.py`, `test_watchlist_router.py`, `test_portfolio_router.py`), 서비스=`test_<service>.py`(`test_dividends.py`, `test_disclosures.py`, `test_market_kr.py`), 배치/스케줄러=`test_scheduler_*.py`·`test_*_batch.py`.
- **공유 설정:** `backend/tests/conftest.py` — sys.path 주입, 인증 의존성 오버라이드, `client` fixture, quote 캐시 정리 autouse fixture(아래 §테스트 격리).
- **픽스처 데이터:** `backend/tests/fixtures/`(예: 수주잔고 DART 원문 파싱용).

### 프론트엔드

- **위치:** co-located — 소스 옆에 `*.test.js`를 둔다. 예: `frontend/src/hooks/useStockManagement.test.js`, `frontend/src/hooks/useReportFilters.test.js`. 스모크는 `frontend/src/test/smoke.test.js`.
- **네이밍:** `<module>.test.js`(훅·로직 위주). 컴포넌트 렌더 테스트는 현재 거의 없고, 로직이 분리된 훅을 직접 검증한다.

## 테스트 격리

`backend/tests/conftest.py`:

```python
app.dependency_overrides[get_current_user] = lambda: "test-user-id"

@pytest.fixture
def client():
    return TestClient(app)

@pytest.fixture(autouse=True)
def _clear_quote_cache():
    # get_quote는 종목 단위 TTL 캐시를 쓰므로, 테스트 간 교차 오염을 막기 위해 매 테스트 전 비운다.
    from services import cache as cache_svc
    cache_svc.invalidate_quote()
    yield
```

- **인증 우회:** `app.dependency_overrides[get_current_user]`로 고정 user id를 주입해 토큰 없이 보호 엔드포인트를 호출한다.
- **인메모리 캐시 정리:** autouse fixture로 quote 캐시를 매 테스트 전 무효화 — TTL 캐시가 테스트 간 누수되면 거짓통과가 난다(`CONVENTIONS.md` 캐시 무효화 참조).
- 일부 라우터 테스트는 conftest의 공유 app 대신 **자체 `FastAPI()` + `include_router`**로 격리된 앱을 만든다(`backend/tests/test_watchlist_router.py` 상단). 이때도 동일하게 `dependency_overrides`로 인증을 우회한다.

## 모킹 패턴

### 백엔드 — `patch`로 storage/외부호출 차단

라우터 테스트는 `with patch(...)` 컨텍스트로 storage 함수와 DB/외부호출을 대체한다(`backend/tests/test_watchlist_router.py`):

```python
def test_add_watchlist_stock_saves_ticker_and_stock_data():
    with patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.save_stocks") as mock_save_stocks, \
         patch("routers.watchlist.storage.save_watchlist_tickers") as mock_save_watchlist, \
         patch("routers.watchlist.db_query", return_value=[]):
        resp = client.post("/api/watchlist", json={"ticker": "TSLA", "name": "Tesla", ...})
    assert resp.status_code == 201
    saved_tickers = mock_save_watchlist.call_args[0][1]   # positional arg 단언
    assert "TSLA" in saved_tickers
```

- **patch 타깃은 사용처 기준** — `routers.watchlist.storage.X`처럼 *임포트된 곳*을 패치한다(정의된 모듈이 아니라).
- 외부 API(yfinance, 키움/KIS/Naver, DART, FRED 등)는 항상 mock 한다 — 테스트는 네트워크를 타지 않는다.

### 호출 시퀀스 단언: `call_args_list` / `call_count`

additive read/외부호출이 호출 시퀀스를 늘릴 수 있으므로(`CONVENTIONS.md` additive 규율 참조), 단일 호출 전제의 `mock.call_args`(=마지막 호출) 단언은 깨지기 쉽다. 호출별로 단언한다(`backend/tests/test_recommendation_endpoint.py`):

```python
# 마지막(call_args)이 아닌 첫 호출을 인덱스로 명시
discovery_kwargs = mock_read.call_args_list[0].kwargs
assert sorted(discovery_kwargs.get("exclude_tickers")) == ["005930", "AAPL"]

# 두 번째 이후 호출 전수 검증
for call in mock_read.call_args_list[1:]:
    assert call.kwargs.get("exclude_low_liquidity", False) is False

# 시퀀스를 call_count로 못박음
assert mock_read.call_count == 1
```

- `call_args_list`를 쓰는 파일: `test_recommendation_endpoint.py`, `test_market_kr.py`, `test_stocks_router.py`, `test_job_runs.py`, `test_kis_quote.py`, `test_batch_resilience.py`, `test_storage.py`. `call_count`로 시퀀스 고정: `test_watchlist_router.py`, `test_portfolio_router.py`, `test_market.py`, `test_admin_router.py` 등.
- side_effect 함수로 호출 인자에 따라 다른 응답을 돌려주는 패턴도 흔하다 — `def _read(*args, **kwargs): ... if kwargs.get("only_tickers"): ...`.

### 프론트엔드 — `vi.mock` + `renderHook`

훅 테스트는 axios 모듈을 mock하고 `renderHook`/`act`로 훅을 구동한다(`frontend/src/hooks/useStockManagement.test.js`):

```js
vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
import api from '../api'

beforeEach(() => { vi.clearAllMocks(); window.confirm = vi.fn() })

it('추가×보유: portfolio POST', async () => {
  api.post.mockResolvedValue({ data: {} })
  const { result } = renderHook(() => useStockManagement(makeArgs({ activeTab: 'holdings' })))
  await act(async () => { await result.current.handleSave({ ticker: 'NVDA' }) })
  expect(api.post).toHaveBeenCalledWith('/api/portfolio', { ticker: 'NVDA' })
})
```

- `beforeEach`에서 `vi.clearAllMocks()`로 mock 초기화, `window.confirm`/`setInterval` 등 브라우저 전역도 `vi.fn()`/`vi.spyOn`으로 스텁(`vi.spyOn(globalThis, 'setInterval')`).
- 인자 빌더 헬퍼(`makeArgs(over = {})`)로 기본 args를 만들고 케이스별로 override.
- 거부 케이스는 `await expect(promise).rejects.toBeTruthy()`로 단언.
- `useReportFilters.test.js`는 characterization 테스트 — 원본 로직(predicate)을 미러로 두고 추출된 훅이 동일하게 합성하는지 검증.

## API 문서 동기 테스트

`backend/tests/test_api_doc_sync.py` (task#99) — 라이브 라우터와 문서의 엔드포인트(method+path) *존재* drift를 자동 검출한다. 새 엔드포인트를 문서화하지 않으면 CI가 실패한다.

- ground-truth는 `main.app`의 `app.routes`(데코레이터 파싱이 아니라 실제 등록된 라우트).
- 문서의 canonical 정의는 `### \`METHOD /path\`` 헤더(정규식 `_HEADER_RE`). `API_SPEC.md`(전체)와 `CLAUDE_COWORK_API.md`(부분집합) 둘 다 대조.
- path param은 `{ticker}`→`{}`로 정규화(`_norm`), 쿼리스트링·끝 슬래시 제거. FastAPI util 경로(`/openapi.json`, `/docs` 등)는 제외.
- 세 테스트: `test_api_spec_documents_all_live_endpoints`(라이브−문서 == `KNOWN_UNDOCUMENTED`), `test_api_spec_has_no_stale_endpoints`(문서−라이브 == ∅), `test_cowork_api_has_no_stale_endpoints`.
- `KNOWN_UNDOCUMENTED = frozenset()` — 미문서 엔드포인트 동결 베이스라인(현재 0, exact-match). 의도적으로 미문서로 둘 땐 여기 추가, 문서화하면 제거(self-maintaining).
- **한계:** 엔드포인트 *존재*만 검증. 요청/응답 스키마·인증 게이팅 동기는 여전히 수동 DoD(prose는 파싱하지 않음).

## 테스트 타입

- **라우터(통합) 테스트:** `TestClient`로 HTTP 왕복 + storage mock. 대다수가 여기에 속한다(`test_*_router.py`).
- **서비스(단위) 테스트:** 서비스 함수를 직접 호출하고 외부 의존을 mock(`test_dividends.py`, `test_market_kr.py`, `test_ranking_service.py`, `test_supply_score.py`).
- **배치/스케줄러 테스트:** 시드/리질리언스/시장분리/job_runs 기록을 검증(`test_scheduler_seed.py`, `test_batch_resilience.py`, `test_batch_market_split.py`, `test_job_runs_instrumentation.py`).
- **계약/회귀 가드:** `test_api_doc_sync.py`(문서 drift), `test_ticker_validation.py`, `test_market_split_report.py`.
- **프론트 로직 훅 테스트 + 스모크:** vitest 하니스(`smoke.test.js` + `use*.test.js`). E2E는 vitest 범위 밖 — 프론트 UAT는 Playwright 디바이스 에뮬레이션(테스트계정 `test@portfolion.com`)으로 별도 수행.

## 회귀 검증 관행

- **데이터 파싱 변경(수주잔고 등)은 fixture 단위 테스트 통과 후에도 배포 후 전 종목 재적재 UAT 필수** — fixture에 없던 실데이터 케이스(외화 단위, 캡션 줄바꿈, 연결 전 분기 회사컬럼)를 잡아낸다.
- **TDD green이 회귀를 못 잡는 함정:** 옛 동작/옛 id를 단언하던 테스트는 깨진 동작을 고정한다. 배치 id 은퇴·additive 추가 시 기존 테스트도 grep 대상에 포함해 갱신한다(`CONVENTIONS.md` additive 규율 참조).

## 커버리지

- 강제 커버리지 임계치 설정은 없다(`pytest.ini`에 coverage 옵션 없음, `pytest-cov` 미설정). 회귀 가드는 라우터/서비스 단위 테스트의 폭과 계약 테스트(`test_api_doc_sync.py`)로 확보한다.

---

*테스트 분석: 2026-06-27*

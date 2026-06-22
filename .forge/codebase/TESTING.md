---
last_mapped_commit: b6193c3837f4125a41930c36a2b3ae2ef198dc3c
mapped: 2026-06-22
---

# TESTING

PortfoliOn 테스트 전략. 백엔드는 pytest + 무거운 `unittest.mock.patch`, 프론트는 vitest + Testing Library. 모든 사실은 실제 파일/실행 결과에서 확인됨.

## Backend — pytest

### 실행

```bash
cd backend && .venv/bin/python -m pytest
```

- 테스트 디렉터리: `backend/tests/` (약 70개 파일)
- **876 tests collected** (`pytest --collect-only -q` 기준, b6193c3 시점)
- `backend/tests/conftest.py`가 `sys.path.insert(0, ...)`로 backend 루트를 path에 추가하고 `from main import app`을 import

### conftest.py 공통 픽스처

`backend/tests/conftest.py`:
- `app.dependency_overrides[get_current_user] = lambda: "test-user-id"` — 인증 우회(모듈 레벨, 전역)
- `client` 픽스처: `TestClient(app)`
- `_clear_quote_cache` (autouse): 매 테스트 전 `cache_svc.invalidate_quote()` — `get_quote`의 종목 단위 TTL 캐시가 테스트 간 교차 오염되는 것을 방지

### 라우터 테스트 — mini-app + dependency_overrides

라우터 단위 테스트는 별도 `FastAPI()` 인스턴스에 해당 라우터만 마운트하고 인증을 오버라이드. 예: `backend/tests/test_stocks_router.py`

```python
app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
client = TestClient(app)
```

라우터 내부 의존성은 import 경로로 patch: `patch("routers.stocks.storage.get_full_portfolio", ...)`, `patch("routers.stocks.market.get_quotes_batch", ...)`, `patch("routers.stocks.query", return_value=[])`, `patch("routers.stocks.SNAPSHOTS_DIR", Path("/nonexistent"))`(파일 폴백 차단).

### 무거운 `unittest.mock.patch`

외부 I/O(yfinance/키움/KIS/Naver/DART/DB)는 전부 patch로 차단. 동시에 여러 소스를 패치하는 `with patch(...), patch(...), ...` 스택이 표준.

- `mock.assert_called_once()` / `mock.assert_not_called()`로 호출/미호출(lazy short-circuit, 폴백 미발화)을 단언
- 호출 시퀀스 단언은 `mock.call_args_list`로 인덱싱(additive 호출이 끼면 `call_args`(마지막)는 깨짐 — CLAUDE.md gotcha). 예: `test_market_kr.py:test_get_quote_kr_default_fetches_krx_ref`가 `[c.kwargs.get("regular") for c in kb.call_args_list] == [True, False]`로 단언
- `call_count`로 콜 수 고정: `assert kb.call_count == 2`

### `regular`-aware side_effect mock — KR 시세 테스트

키움 quote가 `regular` 플래그에 따라 KRX/NXT 다른 값을 반환하는 것을 `side_effect` 클로저로 모킹. `backend/tests/test_market_kr.py`:

```python
def kq_side(ticker, regular=False):
    return krx_norm if regular else kiwoom_norm
... patch("services.kiwoom.quote.get_quote", side_effect=kq_side)
```

또는 `_kr_basic_kiwoom` 레벨에서 직접 side_effect:

```python
def kiwoom_side(ticker, regular=False):
    return (354000.0, ...) if regular else (350500.0, ...)
... patch("services.market.kr._kr_basic_kiwoom", side_effect=kiwoom_side)
```

이로써 다수결 시나리오(NXT≈KRX 합의, KRX-poison, NXT 전체오염, 단일 글리치 degenerate)를 분기별로 검증. `_corroborated_pick`은 순수 함수라 직접 호출 단위테스트도 있음(`test_corroborated_pick_*`).

### `_patch_yf()` 헬퍼 — yfinance 보강 블록 차단

`backend/tests/test_market_kr.py:_patch_yf()`:

```python
def _patch_yf():
    m = MagicMock()
    m.history.return_value = pd.DataFrame({"Close": []})
    m.info = {}
    return patch("services.market.yf.Ticker", return_value=m)
```

`get_quote_kr`는 키움 변동률 실패 시 yfinance(sector/industry 보강)로 폴백하므로, KR 시세 테스트는 항상 `with _patch_yf(), ...`로 감싸 네트워크를 타지 않게 함.

### cache-invalidation-in-test 패턴

대시보드/시세는 TTL/LRU 캐시를 쓰므로 테스트 본문에서 명시적으로 캐시 무효화. 약 24곳에서 사용:

```python
import services.cache as cache_svc
cache_svc.invalidate_dashboard()
```

대시보드 테스트(`test_stocks_router.py`의 `test_dashboard_*`) 다수가 본문 첫 줄에서 호출. conftest의 autouse `invalidate_quote()`와 별개로, dashboard 캐시는 테스트가 직접 비워야 결과가 격리됨.

### reload × direct-import patch footgun

모듈을 `importlib.reload`로 다시 로드하는 테스트가 다수 존재(`test_market.py`, `test_report_generator.py`, `test_report_price_gate.py`). reload 시 모듈의 re-import 바인딩은 새 객체로 교체되므로, **patch 대상은 re-import 사이트가 아니라 source 모듈이어야 함**.

- `test_report_price_gate.py:_run`: `with contextlib.ExitStack()`으로 patch들을 enter한 **상태에서** `importlib.reload(report_generator)` 호출 → reload가 patch된 source를 다시 바인딩하게 함
- DB 쓰기 단언은 source인 `"services.db.execute"`를 patch (re-import 바인딩 `services.report_generator.something` 아님), 그 mock에 `.assert_not_called()` / `.assert_called()`
- 외부 fetch는 re-import 사이트(`"services.report_generator.mkt.get_quote"` 등)를 patch — report_generator가 그 이름으로 호출하기 때문
- `test_market.py`의 `get_financials`/`get_analyst_data`/`get_quote` 테스트들도 `import importlib; importlib.reload(market)`를 patch 컨텍스트 안에서 호출

핵심: **patch는 호출이 실제로 일어나는 이름에 걸고, reload는 patch가 활성인 동안 수행**해야 한다. `services.market`은 패키지(`services/market/__init__.py`)가 `services.market.kr`/`us`를 re-export하므로, KR 헬퍼는 source인 `services.market.kr._kr_basic_naver` 등을 patch.

### local `.venv`에 `lxml` 없음 → `html.parser`

`lxml`은 `requirements.txt`/Docker엔 있으나 로컬 `backend/.venv`엔 없음. HTML 파싱은 stdlib `BeautifulSoup(html, "html.parser")` 사용(로컬·프로덕션 양쪽 동작):

- `services/backlog_parser.py`(주석 "document.xml 원문은 XML이지만 html.parser로 파싱하므로(lxml 로컬 미설치)"), `services/scraper.py`, `services/guru_scraper.py`, `services/market_indicators/earnings.py`
- 테스트 `tests/test_backlog_extract.py`도 `BeautifulSoup(html, "html.parser")`

### Notable 테스트 파일

- `test_market_kr.py` — KR 시세 다수결 가드(`regular`-aware side_effect, `_patch_yf`, `_corroborated_pick` 순수함수, 키움→KIS→Naver 폴백 체인, 합법 하한가 false-reject 방지)
- `test_api_doc_sync.py` — API 문서 ↔ 라이브 라우터 drift 자동검출. `app.routes`(데코레이터 파싱 아님)에서 `(method, path)` 집합을 만들고 `API_SPEC.md`/`CLAUDE_COWORK_API.md`의 `### `METHOD /path`` 헤더와 exact-match 비교. path param은 `{}`로 정규화. `KNOWN_UNDOCUMENTED = frozenset()`(현재 0). 새 엔드포인트를 문서 없이 추가하면 즉시 실패
- `test_report_price_gate.py` — bake-time independent-feed gate(reload+ExitStack patch, `services.db.execute` 미저장 단언, KRX 자기일관 글리치 스킵, US 미적용)
- `test_stocks_router.py` — 대시보드 graceful 빌드(holdings=N→N카드, 카드 실패→최소카드 폴백, 일괄시세 실패→price None, KRW 환산 totals, `_latest_snapshots` 배치 헬퍼)

## Frontend — vitest

### 실행

```bash
cd frontend && npm test   # = vitest run
```

- **31 tests passed (3 files)** (b6193c3 시점, `vitest run` 실행 확인)
- 설정: `frontend/vite.config.js`의 `test` 블록 — `environment: 'jsdom'`, `setupFiles: './src/test/setup.js'`
- `frontend/src/test/setup.js`: `import '@testing-library/jest-dom'`
- devDependencies: `vitest ^4.1.9`, `@testing-library/react ^16.3.2`, `@testing-library/jest-dom ^6.9.1`, `jsdom ^29.1.1`

### 패턴 — 훅 characterization 테스트

테스트는 주로 추출된 커스텀 훅을 `renderHook`/`act`로 검증. 컴포넌트 렌더 단위테스트보다 로직 훅 단위테스트가 중심.

- `frontend/src/hooks/useReportFilters.test.js` — `import { describe, it, expect } from 'vitest'` + `import { renderHook, act } from '@testing-library/react'`. 정렬/필터/서브탭 분기를 fixture 데이터로 characterize. 의존 술어(`_targetPct`, `_hasWarning`)를 테스트가 미러해 주입
- `frontend/src/hooks/useStockManagement.test.js`
- `frontend/src/test/smoke.test.js`

(과거 메모는 "프론트 단위테스트 프레임워크 없음 / UAT는 Playwright 디바이스 에뮬레이션"이라 기록했으나, 현재는 vitest가 도입돼 훅 단위테스트가 존재함. Playwright 기반 라이브 UAT는 별개 트랙으로 병행.)

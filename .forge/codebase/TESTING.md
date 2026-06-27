---
last_mapped_commit: f1839804fa84342f9e30cc6dc919d5e5abba7b8d
mapped: 2026-06-28
---

# 테스트 패턴 — PortfoliOn

이 문서는 백엔드(pytest)·프론트(vitest) 테스트의 프레임워크·위치·반복 패턴을 매핑한다. 도메인 용어는 정의하지 않는다.

## 1. 프레임워크 · 위치 · 실행

- 백엔드: **pytest**. 테스트는 `backend/tests/`에 위치(현재 `test_*.py` 83개 + `conftest.py` + `fixtures/`).
- 설정은 `backend/pytest.ini`:
  ```
  [pytest]
  testpaths = tests
  pythonpath = .
  ```
  (`pythonpath = .`로 `backend/`가 import 루트 → `from main import app`, `from routers.stocks import router`, `from services import ...`이 동작. 일부 테스트는 `from backend.services.market.kr import ...`처럼 `backend.` 접두 import도 쓴다 — 두 import 스타일이 공존한다.)
- 실행: 프로젝트 루트에서 `cd backend && .venv/bin/python -m pytest`.
- 픽스처 디렉터리: `backend/tests/fixtures/`(현재 `backlog/` 하위 — 수주잔고 DART 원문 등 외부 응답 픽스처).
- 외부 의존: `unittest.mock`(`patch`, `MagicMock`)로 외부호출/DB를 모킹. `pandas`로 yfinance history DataFrame을 흉내내는 테스트가 있다.

## 2. 두 가지 app 빌드 방식 — conftest `client` vs 자체-app

테스트가 FastAPI app을 얻는 경로가 두 갈래다. **인증 게이팅 변경 시 이 차이가 핵심 함정**이다.

### (a) conftest `client` — `main.app` 공유
`backend/tests/conftest.py`:
```python
sys.path.insert(0, str(Path(__file__).parent.parent))   # backend/ 를 import 루트로
from main import app
from auth import get_current_user
app.dependency_overrides[get_current_user] = lambda: "test-user-id"

@pytest.fixture
def client():
    return TestClient(app)

@pytest.fixture(autouse=True)
def _clear_quote_cache():            # 매 테스트 전 quote TTL 캐시 비움(교차 오염 방지)
    from services import cache as cache_svc
    cache_svc.invalidate_quote()
    yield
```
conftest는 `main.app`의 `get_current_user`만 override 한다. 따라서 이 override는 자체-app 테스트엔 **안 걸린다**. `client` fixture를 인자로 받는 테스트가 이 경로를 쓴다.

### (b) 자체-app — 모듈 상단에서 `FastAPI()` 직접 생성
다수 라우터 테스트가 conftest의 `client`를 쓰지 않고, 모듈 상단에서 라우터만 마운트한 독립 app을 만들어 `dependency_overrides`로 auth를 우회한다. 예 `backend/tests/test_stocks_router.py`:
```python
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routers.stocks import router
from auth import get_current_user, get_current_user_or_api_key, require_admin_or_api_key

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
app.dependency_overrides[require_admin_or_api_key] = lambda: "test-user-id"   # task#108
client = TestClient(app)
```
같은 패턴: `test_consensus_router.py`(`get_current_user` override), `test_nan_serialization_guards.py`(`rec_router` + `get_current_user` override).

**함정(CLAUDE.md gotcha)**: 엔드포인트에 auth `Depends`를 추가/변경하면 그 경로를 호출하는 자체-app 테스트들이 401/403로 깨진다(conftest override는 `main.app` 한정이라 자체-app엔 안 걸림). 대응: 그 경로를 호출하는 자체-app 테스트를 전수 grep 해 새 의존성 override를 추가(`app.dependency_overrides[require_admin_or_api_key] = lambda: "test-user-id"` 등).

## 3. 무인증 거부 검증 — fresh app (override 없음)

`backend/tests/test_security_auth_gaps.py`는 **dependency override 없는** fresh app을 만들어 실제 auth 의존성을 태운다(401 검증). 헬퍼:
```python
def _client(*routers):
    app = FastAPI()
    for r in routers:
        app.include_router(r)
    return TestClient(app)

def test_enrich_batch_requires_auth():
    r = _client(stocks_router).put("/api/stocks/enrich/batch", json=[{"ticker": "AAPL", "moat": "x"}])
    assert r.status_code == 401
```
이 파일은 mutation 엔드포인트(refresh-analyst·consensus backfill·dashboard cache delete·refresh-market·enrich single/batch)가 무인증이면 401을 내는지 + refresh token 1회용 회전을 검증(`auth_service.consume_refresh_token`을 `patch.object`로 query/execute 모킹). **인증 강제 검증과 우회 검증을 분리**하는 패턴이다.

## 4. 외부 소스 모킹

- 서비스 함수를 `patch`로 가로채는 위치는 **그 함수가 import된 모듈 경로** 기준: `patch("routers.stocks.storage.get_full_portfolio", ...)`, `patch("routers.stocks.storage.enrich_stock", side_effect=...)`, `patch("routers.recommendations.recommendation.read_recommendations", ...)`.
- KR 재무는 Naver 응답 dict 픽스처(`financeInfo.rowList` index 기반)를 `patch("backend.services.market.kr._naver_get", return_value=...)`로 주입(`test_financials_kr.py`). DART는 `patch("backend.services.market.kr.requests.get")`로 `MagicMock().json.return_value` 응답을 흉내내고, `os.environ.get`을 `side_effect`로 패치해 `DART_API_KEY` 유무를 시뮬레이트, corp_code 맵은 `patch("services.backlog._get_corp_code_map", ...)`(`test_financials_kr_cashflow.py`).
- NaN 직렬화 테스트는 yfinance를 stub 클래스로 교체(`patch.object(analysis_service.yf, "Ticker", _ConstTicker)` — `history()`가 상수 종가 DataFrame을 반환해 제로분산 corr=NaN 유발) 후 `json.dumps(result, allow_nan=False)`로 직렬화 통과를 단언(`test_nan_serialization_guards.py`).
- 리포트 박제-시 게이트는 `report_generator`가 import한 외부 함수들(`mkt.get_quote`, `mkt.get_history_df`, `indicators.get_timeframe_rsi` 등)을 dict로 일괄 `patch`(`test_report_price_gate.py`).

## 5. additive-mock 함정 (call_args / call_count)

엔드포인트에 read/외부호출을 additive로 *추가*하면 마지막 호출(`mock.call_args`)을 단언하는 기존 테스트가 조용히 오염된다(호출 시퀀스가 늘어 마지막 호출이 신규 호출로 바뀜). 대응 패턴:
- 기존 단언은 호출별 `mock.call_args_list[i].kwargs`로 인덱스 명시 마이그레이션.
- 신규 호출은 입력이 비면 `if <조건>:`으로 생략해 기존 시퀀스 보존.
- 신규 테스트는 `call_count`로 시퀀스를 못박음.
- 회귀 가드 예: `test_financials_kr_cashflow.py`의 `assert mock_req.call_args.kwargs["params"].get("fs_div") in ("CFS", "OFS")`(fnlttSinglAcntAll이 `fs_div`를 요청 필수값으로 받는지 단언).

## 6. API 문서 동기 테스트 — `backend/tests/test_api_doc_sync.py`

엔드포인트(method+path) *존재* drift를 자동검출한다(스키마·인증 게이팅은 수동 DoD, prose는 파싱 안 함).
- 라이브 ground-truth: `main.app`의 `app.routes`(데코레이터 파싱 아님). 문서 정의: 두 문서의 ``### `METHOD /path``` 헤더(`_HEADER_RE`).
- `_norm(path)`로 path param `{ticker}`→`{}` 정규화, 쿼리스트링·끝 슬래시 제거.
- 테스트 3종: `test_api_spec_documents_all_live_endpoints`(라이브 − API_SPEC == `KNOWN_UNDOCUMENTED` 정확히 일치 — exact-match라 미문서 엔드포인트 추가 시 즉시 실패), `test_api_spec_has_no_stale_endpoints`(API_SPEC에 라이브에 없는 엔드포인트 없음), `test_cowork_api_has_no_stale_endpoints`(CLAUDE_COWORK_API.md 부분집합 검증).
- `KNOWN_UNDOCUMENTED = frozenset()`(현재 0 — task#100에서 23개 전수 문서화). 의도적 미문서 엔드포인트는 여기 추가, 문서화하면 제거(self-maintaining).

## 7. 순수 유닛 테스트 (네트워크 없음)

비율/포맷 헬퍼는 네트워크 없이 직접 단언한다:
- `test_financials_us_ratios.py` — `from services.market.format import _safe_pct`로 0/None/inf 분모, 음수, 정상값을 단언.
- `test_financials_us_cashflow.py` — `_safe_ratio` 단언 + FCF=OCF+CapEx(yfinance CapEx 음수) 산술 불변식, 음수 FCF 미클램프.

## 8. 최근 추가된 재무 테스트 (이번 매핑 시점 존재 확인)

- `test_financials_kr.py` — Naver 16-row 픽스처로 KR 재무비율 6종 row→지표 매핑 고정(index 드리프트 검출), row `-` graceful None.
- `test_financials_kr_cashflow.py` — KR 연간 FCF·이자보상(DART). `account_nm`을 일부러 변형해 `account_id` 기반 매칭만 동작함을 증명. DART 키 없음/status≠000 graceful 케이스 포함.
- `test_financials_us_cashflow.py` — US FCF·`_safe_ratio` 순수 유닛(네트워크 없음).
- `test_financials_us_ratios.py` — `_safe_pct` 순수 유닛.
- `test_nan_serialization_guards.py` — macro-correlation 제로분산 corr=NaN, recommendations NaN price가 500을 안 내고 None으로 가드되는지(task#109).
- `test_security_auth_gaps.py` — 무인증 mutation 401 + refresh token 1회용 회전(task#108).

## 9. 프론트엔드 vitest 하니스

- 프레임워크: **vitest**(`frontend/package.json`: `"test": "vitest run"`, deps `vitest ^4.1.9`, `@testing-library/react ^16.3.2`, `@testing-library/jest-dom ^6.9.1`). ADR-0019로 도입.
- 설정: `frontend/vite.config.js`의 `test` 블록 — `environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.js'`. setup 파일은 `import '@testing-library/jest-dom'` 한 줄.
- 테스트 파일은 소스 옆에 co-located(`*.test.js`): `frontend/src/test/smoke.test.js`(러너 동작 스모크), `frontend/src/hooks/useStockManagement.test.js`, `frontend/src/hooks/useReportFilters.test.js`(`renderHook`/`act`로 훅 characterization — 원본 컴포넌트의 술어를 미러해 추출 훅이 올바로 합성하는지 검증).

## 10. 커버되지 않는 것 (NOT covered)

- **라이브 외부소스 파싱은 단위테스트가 못 잡는다 — 운영에서만 드러난다**. 단위테스트는 응답을 mock 하므로 yfinance get_* 메서드 vs 프로퍼티의 index 라벨 불일치(`_yf_val` exact 매칭이 조용히 None 반환), KR Naver row index 드리프트, DART account_id 매칭 같은 실데이터 케이스를 fixture가 통과시켜도 라이브에서 실패한다(task#111/#117 반복). → 외부소스 파싱 슬라이스는 **라이브 1종목 추출 대조를 DoD**에 넣는다.
- **수주잔고/데이터 파싱은 fixture 통과해도 배포 후 전 종목 재적재 UAT 필수** — fixture에 없던 외화·단위 캡션 줄바꿈 분리·다중엔티티 표를 운영 재적재가 잡아낸다.
- **프론트 UAT는 자동 테스트 밖** — Playwright 디바이스 에뮬레이션으로 수동 검증(테스트계정 test@portfolion.com). vitest는 훅·순수 로직 단위만 커버, 화면 행동(헤더↔그리드 모순, silent catch 등)은 라이브 UAT에서만 포착됨.
- doc-sync 테스트는 엔드포인트 *존재*만 검증 — 요청/응답 스키마·인증 게이팅 동기는 수동 DoD다.

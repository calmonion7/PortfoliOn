---
last_mapped_commit: 27346baec719306d5c2be8f259cc448ca4f64f4a
mapped: 2026-06-13
---

# TESTING

PortfoliOn의 테스트 프레임워크·구조·모킹·실행·커버리지 사실 정리. 모든 경로는 실제 파일이다.

## 프레임워크 & 실행

- **백엔드: pytest**, 테스트는 `backend/tests/`에 위치. 가상환경은 `backend/.venv/`.
- 실행:
  ```bash
  cd backend && .venv/bin/python -m pytest
  ```
  (조용히 카운트만: `cd backend && .venv/bin/python -m pytest -q`)
- **현재 테스트 수: 466 passed (6 warnings, 약 12.7s)** — `27346bae` HEAD 기준 실측. 테스트 파일은 `backend/tests/test_*.py` 38개.
- **프론트엔드: 컴포넌트 테스트 프레임워크 없음.** `frontend/package.json`의 scripts는 `dev`/`build`/`lint`/`preview`뿐이며 vitest·jest·@testing-library 의존성이 전혀 없다. 프론트의 유일한 사실상 검증 게이트는 `npm run build`(`vite build`). (수동 UAT는 Playwright 디바이스 에뮬레이션으로 수행 — 코드 테스트 프레임워크는 아님.)

## 구조

- `backend/tests/conftest.py` — 공유 픽스처/세팅.
- `backend/tests/__init__.py` — 패키지 마커.
- `backend/tests/fixtures/backlog/` — 수주잔고 파서용 실 DART 표 HTML fixture(`*.html`). 로딩은 `Path(__file__).parent / "fixtures" / "backlog"`(`test_backlog_extract.py:16`).
- 테스트 파일은 라우터/서비스 단위로 나뉜다: `test_<router>_router.py`(report/stocks/portfolio/watchlist/admin/calendar/digest/guru/events/analytics/analysis/investor/rankings/batches), `test_<service>.py`(storage/market/cache/indicators/leverage_service/investor_service/ranking_service/digest_service/...), 도메인 단위(`test_consensus_asof.py`, `test_backlog_extract.py`, `test_schedule_spec.py`) 등.

## conftest 및 경로 부트스트랩 (`backend/tests/conftest.py`)

```python
sys.path.insert(0, str(Path(__file__).parent.parent))   # backend/ 를 import 경로에 추가
app.dependency_overrides[get_current_user] = lambda: "test-user-id"

@pytest.fixture
def client():
    return TestClient(app)
```

- `sys.path.insert`로 `backend/`를 루트로 잡아 `from main import app`, `from auth import ...`, `from routers.X import router`가 가능. 일부 단위 테스트는 conftest에 의존하지 않고 자기 파일 안에서 `sys.path.insert`를 직접 한다(`test_backlog_extract.py:14`).
- conftest의 `client` 픽스처는 `main.py`의 전체 `app`을 쓰며 `get_current_user`를 전역 오버라이드.

## FastAPI TestClient 사용 + 인증 모킹

대다수 라우터 테스트는 **전체 앱이 아니라 단일 라우터만 마운트한 가벼운 `FastAPI()`**를 만든다(`test_stocks_router.py:9-13`, `test_report_router.py:24-30`):

```python
app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
client = TestClient(app)
```

인증은 **실제 JWT 검증 대신 `app.dependency_overrides`로 의존성을 람다 치환**한다. report 라우터는 네 가지 인증 의존성을 모두 오버라이드(`test_report_router.py:26-29`): `get_current_user`, `require_admin`, `get_current_user_or_api_key`, `require_admin_or_api_key`. `dependency_overrides`를 쓰는 테스트 파일은 17개.

## DB `query` 모킹

DB는 실제로 연결하지 않고 **모듈에 임포트된 `query`/`execute` 심볼을 `unittest.mock.patch`로 가로챈다**. 핵심: **임포트된 위치 기준으로 패치**한다 — 라우터가 `from services.db import query`로 받았으면 `routers.X.query`를, 서비스가 자기 모듈에서 쓰면 `services.X.query`를 패치.

- 라우터 DB: `patch("routers.report.query", side_effect=[date_rows, summary_rows])`(`test_report_router.py:52`) — 호출 순서대로 다른 결과를 돌려줄 땐 `side_effect` 리스트.
- 컨센서스 정본: `patch("services.consensus.query", ...)`(`test_report_router.py:53`, `test_consensus_asof.py:19`). `consensus.py`가 `from services.db import query`로 받으므로 `services.consensus.query`를 패치해야 가로채진다.
- 실측 분포(테스트 코드 내 `patch(...query...)` 빈도): `routers.report.query`·`services.consensus.query` 각 20, `services.storage.query` 9, `routers.calendar.query` 7, `routers.admin.query`·`services.investor_service.query`·`services.db.query` 등.

`apply_asof`/`get_asof` 단위 테스트(`test_consensus_asof.py`)는 DB를 `patch("services.consensus.query", return_value=...)` 또는 `side_effect=[[], hist_row]`(마트 미스→히스토리 폴백 시뮬레이션, `:31`)로만 제어하고 mart-hit/history-fallback/no-op/target-null-preserve/원본-불변 5경로를 검증한다.

서비스 외부 의존(yfinance·requests·storage·cache·job_runs)은 `patch("routers.stocks.storage.enrich_stock", return_value=True)`(`test_stocks_router.py:40`)처럼 임포트 경로 기준으로 패치. 인메모리 캐시 우회는 `patch("routers.report.cache_svc.get_list", side_effect=lambda f: f())`(`test_report_router.py:56`).

## 백그라운드 작업 / 계측 스텁

report 라우터 테스트는 `job_runs.record` 계측이 테스트 DB를 건드리지 않도록 `autouse` 픽스처로 no-op 컨텍스트매니저 치환:

```python
@pytest.fixture(autouse=True)
def _stub_job_runs(monkeypatch):
    @contextmanager
    def _noop(job_id, trigger):
        yield 1
    monkeypatch.setattr(job_runs, "record", _noop)
```
(`test_report_router.py:12-21`) — `monkeypatch`로 모듈 함수를 직접 대체하는 패턴.

## 중요 로컬 함정: lxml 미설치 → `html.parser`

로컬 `backend/.venv`에는 `lxml`이 **없다**(`requirements.txt`엔 있고 Docker 이미지엔 설치됨). 따라서 로컬 pytest로 도는 HTML 파싱 코드/테스트는 `BeautifulSoup(html, "lxml")`이 아니라 **stdlib `BeautifulSoup(html, "html.parser")`**를 써야 로컬·프로덕션 모두 통과한다.

- `backend/services/backlog.py:382,445,466` — 전부 `BeautifulSoup(html, "html.parser")`. `:30` 주석: "document.xml 원문은 XML이지만 html.parser로 파싱하므로(lxml 로컬 미설치)".
- `backend/tests/test_backlog_extract.py:25,131,134` — fixture 파싱도 `"html.parser"`.

## 커버리지

전용 커버리지 도구(`pytest-cov`/`coverage`) 설정은 없으며 카운트는 `pytest -q`의 통과 수로 가늠한다. 라우터·핵심 서비스(consensus/storage/market/cache/indicators/backlog/leverage/investor/ranking/digest/schedule_spec/job_runs)·스케줄러 시드·배치 회복력 단위까지 테스트가 존재하나, 프론트엔드에는 자동화 테스트가 없다(빌드 + 수동 UAT만).

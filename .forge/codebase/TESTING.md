---
last_mapped_commit: f835958b49b4a4d7ce30254fd610ed6362462311
mapped: 2026-06-22
---

# TESTING

PortfoliOn 테스트 프레임워크·구조·모킹·커버리지 관찰 기록.

## Framework & 실행

- **pytest** (`backend/requirements.txt`: `pytest>=7.4.0`, `httpx>=0.25.0`).
- 설정은 `backend/pytest.ini`:
  ```
  [pytest]
  testpaths = tests
  pythonpath = .
  ```
  `pythonpath = .`로 `from main import app`, `from services import ...`, `from routers.report import router`가 모듈 루트 기준으로 동작.
- 실행 명령 (macOS): `cd backend && .venv/bin/python -m pytest` (CLAUDE.md / 프로젝트 노트). 현재 약 863개 테스트 통과.
- 테스트 디렉터리: `backend/tests/` — `test_*.py` 77개 파일 + `__init__.py` + `conftest.py` + `fixtures/`.
- **프론트엔드 단위 테스트 프레임워크 없음.** UAT는 Playwright 디바이스 에뮬레이션으로 수행(테스트계정 `test@portfolion.com` / `test1234`, 격리 하니스 `vite uat.html`) — MEMORY.md `reference-frontend-uat.md`.

## conftest.py — 공유 fixture

`backend/tests/conftest.py`:
- `sys.path.insert(0, ...)`로 backend 루트를 path에 추가.
- `from main import app` + FastAPI 의존성 오버라이드를 모듈 로드 시점에 적용: `app.dependency_overrides[get_current_user] = lambda: "test-user-id"`. 인증을 전역으로 우회.
- `client` fixture: `TestClient(app)` 반환 (`fastapi.testclient`).
- `_clear_quote_cache` (autouse): 매 테스트 전 `cache_svc.invalidate_quote()` 호출. `get_quote`가 종목 단위 TTL 캐시를 쓰므로 테스트 간 교차 오염 방지.

## 모킹 — `unittest.mock.patch` 중심

대부분의 테스트가 `from unittest.mock import patch, MagicMock`을 쓰고, `with patch(...)` 컨텍스트 매니저를 중첩(`\` 줄바꿈)해 외부 의존성을 차단한다.

### Patch 대상 = import된 위치

- DB 헬퍼는 **사용처 모듈 경로**로 패치: `patch("services.storage.portfolio.query", ...)` (`test_storage.py:5-13`), `patch("routers.report.query", ...)` (`test_report_router.py:52`), `patch("services.consensus.query", ...)`. `services.db.query`가 아니라 import한 네임스페이스를 패치.
- `side_effect`로 호출 순서별 다른 반환값: `patch("routers.report.query", side_effect=[date_rows, summary_rows])` — 같은 함수의 1·2번째 호출에 서로 다른 데이터 (`test_report_router.py:52,104`). 호출 시퀀스가 늘어나면 `call_args_list[i].kwargs`로 호출별 단언(additive read gotcha, CLAUDE.md).
- 캐시는 함수를 통과시키는 패치: `patch("routers.report.cache_svc.get_list", side_effect=lambda f: f())`로 캐시 래퍼가 빌더를 그대로 호출하게 함 (`test_report_router.py:56`). 인메모리 캐시 dict 자체를 패치하기도: `patch("routers.report.cache_svc._snapshots", {})`, `patch("routers.report.cache_svc._list_cache", {"data": None, "ts": 0.0})` (`test_report_router.py:124-125`).
- 스토리지 함수도 라우터 네임스페이스로 패치: `patch("routers.report.storage.get_full_portfolio", return_value=...)`.

### 라우터 테스트 — 의존성 오버라이드

- 일부 라우터 테스트는 `conftest`의 전역 client 대신 **로컬 FastAPI 앱**을 만들어 인증을 직접 오버라이드: `app = FastAPI(); app.include_router(router)`에 `app.dependency_overrides[require_admin] = lambda: "test-user-id"` 등을 붙이고 `TestClient(app)` (`test_report_router.py:24-30`).
- 403 경로 테스트는 `require_admin` 오버라이드를 **뺀 별도 앱**(`_nonadmin_app`/`_nonadmin_client`)을 만들고 `patch("auth.auth_service.get_user_by_id", return_value={"role": "user"})`로 비관리자 시뮬레이션 (`test_report_router.py:314-340`).
- 백그라운드 워커의 `job_runs.record` 계측이 테스트 DB를 건드리지 않게 autouse fixture로 no-op `@contextmanager` 주입: `_stub_job_runs` (`monkeypatch.setattr(job_runs, "record", _noop)`, `test_report_router.py:12-21`).

### KR quote 테스트 — `_patch_yf()` + `regular`-aware `side_effect`

`backend/tests/test_market_kr.py` — `get_quote_kr` 다중소스 폴백/발산가드 검증.
- `_patch_yf()` 헬퍼 (`test_market_kr.py:6-11`): yfinance 보강 블록이 네트워크를 타지 않게 빈 히스토리로 mock. `MagicMock()`에 `m.history.return_value = pd.DataFrame({"Close": []})`, `m.info = {}`를 세팅하고 `patch("services.market.yf.Ticker", return_value=m)` 반환. 거의 모든 테스트가 `with _patch_yf(), ...`로 시작.
- 소스 어댑터를 사용처 경로로 patch: `patch("services.kiwoom.client.configured", return_value=True)`, `patch("services.kiwoom.quote.get_quote", ...)`, `patch("services.kis.client.configured", ...)`, `patch("services.kis.quote.get_quote_kr", ...)`, `patch("services.market.kr._naver_get", ...)`.
- **`regular`-aware `side_effect`** 패턴: 키움 quote가 정규장(KRX)/NXT 두 코드로 다른 값을 반환하는 걸 모사하기 위해 인자에 `regular`를 받는 side_effect 함수를 정의:
  ```python
  def kq_side(ticker, regular=False):
      return krx_norm if regular else kiwoom_norm
  patch("services.kiwoom.quote.get_quote", side_effect=kq_side)
  ```
  (`test_market_kr.py:117-122`). `_kr_basic_kiwoom` 레벨에서 patch할 때도 동일: `def kiwoom_side(ticker, regular=False): ... patch("services.market.kr._kr_basic_kiwoom", side_effect=kiwoom_side)` (`test_market_kr.py:170-178,270-276,290-297,310-317`).
- 일봉 참조 mock: `patch("services.market.kr._kr_closes_kiwoom", return_value=[350000.0, 352000.0, 354000.0])` (`test_market_kr.py:120,136,191`).
- 호출 시퀀스/횟수 단언: `kis_call.assert_called_once()`, `naver_call.assert_not_called()` (lazy short-circuit 검증, `:71-72,87-88`), `kb.call_count == 1` / `== 2` (`:337,350`), `kb.call_args.kwargs.get("regular") is True` (regular 전파 검증, `:214-215`), `regulars = [c.kwargs.get("regular") for c in kb.call_args_list]` (호출별 인자, `:351-352`).
- 순수 함수는 직접 import해 단위 테스트: `from services.market.kr import _corroborated_pick` 후 입력 리스트로 다수결 로직 검증 (`test_market_kr.py:236-266`), 헬퍼 `_basic(price, name="X")`로 튜플 생성 (`:232-233`).

### Storage / 서비스 단위 테스트

- 서비스 함수를 직접 import 후 DB 헬퍼만 patch: `from services import storage; with patch("services.storage.portfolio.query", return_value=[...]): storage.get_watchlist_tickers(...)` (`test_storage.py:4-15`). 쓰기 검증은 `with patch("services.storage.schedule.execute") as ex:` 후 `ex.call_args.args[0]`로 SQL 단언 (`test_storage.py:65-70`).

## Fixtures (HTML 등 데이터)

- `backend/tests/fixtures/backlog/` — DART `document.xml` 표 HTML fixture (`<ticker>.html`). 파일 첫 줄 주석에서 단위(`조원|억원|...`)를 정규식으로 추출 (`test_backlog_extract.py:19-26`).
- **로컬 `.venv`에 `lxml` 없음** (확인됨: `backend/.venv/.../site-packages`에 lxml 미설치; `requirements.txt`/Docker엔 있음). 따라서 로컬 pytest로 도는 HTML 파싱 테스트는 `BeautifulSoup(html, "html.parser")`(stdlib)를 쓴다 — `BeautifulSoup(html, "lxml")` 아님 (`test_backlog_extract.py:25`, CLAUDE.md gotcha).
- 파일 시스템 폴백 경로 테스트는 pytest `tmp_path` fixture + `patch("routers.report.SNAPSHOTS_DIR", tmp_path)`로 디렉터리 주입 (`test_report_router.py:116-160`).

## 커버리지 — 무엇을 테스트하나

테스트 파일은 라우터·서비스·배치·스케줄러를 폭넓게 커버 (`backend/tests/` 77개). 대표:
- 라우터: `test_report_router.py`, `test_stocks_router.py`, `test_watchlist_router.py`, `test_portfolio_router.py`, `test_admin_router.py`, `test_analysis_router.py`, `test_analytics_router.py`, `test_batch_endpoints.py`, `test_rankings_router.py`, `test_events_router.py`, `test_guru_router.py`, `test_digest_router.py`, `test_calendar_router.py`, `test_consensus_router.py`, `test_investor_router.py`.
- 시세/시장: `test_market_kr.py`, `test_market.py`, `test_market_us_kis.py`, `test_market_indicators.py`, `test_market_cache.py`, `test_market_history_routing.py`, `test_macro_signals.py`.
- 외부 어댑터: `test_kiwoom_quote.py`, `test_kiwoom_chart.py`, `test_kiwoom_investor.py`, `test_kiwoom_sector.py`, `test_kis_client.py`, `test_kis_quote.py`.
- 도메인 서비스: `test_storage.py`, `test_backlog.py`, `test_backlog_extract.py`, `test_disclosures.py`, `test_dividends.py`, `test_insider_trades.py`, `test_consensus_asof.py`, `test_leverage_service.py`, `test_ranking_service.py`, `test_kr_sector_*.py`, `test_recommendation_*.py` (다수).
- 배치/스케줄러/계측: `test_batch_market_split.py`, `test_batch_resilience.py`, `test_job_runs.py`, `test_job_runs_instrumentation.py`, `test_scheduler_*.py`, `test_macro_signals_batch.py`, `test_disclosure_batch.py`.
- 인증/검증/캐시: `test_auth.py`, `test_auth_me.py`, `test_ticker_validation.py`, `test_cache.py`, `test_schedule_spec.py`.

테스트 스타일: 한국어 docstring/주석으로 의도와 근거(ADR 번호, task 번호)를 남기는 것이 일반적 (`test_market_kr.py`, `test_report_router.py` 전반). 단언은 동작(반환 dict의 키/값)과 호출 시퀀스(`call_count`, `assert_not_called`) 양쪽을 검증.

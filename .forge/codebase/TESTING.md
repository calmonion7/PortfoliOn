---
last_mapped_commit: 7f3aec7d6aab5b2ed9837f9aada7405f9505ae6b
mapped: 2026-06-17
---

# 테스트 패턴

**분석 일자:** 2026-06-17

테스트는 **백엔드(pytest)에만** 존재한다. 프론트엔드는 자동화 단위 테스트가 없고, 수동/Playwright UAT로 검증한다.

---

## 테스트 프레임워크

- **러너:** `pytest` (`requirements.txt`의 `pytest>=7.4.0`).
- **설정:** `backend/pytest.ini` — `testpaths = tests`, `pythonpath = .` (이 두 줄이 전부; 마커·커버리지 강제 없음).
- **HTTP 테스트:** `fastapi.testclient.TestClient` (`from fastapi.testclient import TestClient`).
- **assertion:** 표준 `assert` (pytest 내장). 별도 assertion 라이브러리 없음.

### 실행 명령

```bash
# 전체 테스트 (프로젝트 루트에서)
cd backend && .venv/bin/python -m pytest

# 단일 파일
cd backend && .venv/bin/python -m pytest tests/test_portfolio_router.py

# 키워드 필터
cd backend && .venv/bin/python -m pytest -k backlog
```

- macOS venv 경로: `backend/.venv/bin/python`. Windows: `backend/.venv/Scripts/python`.
- 반드시 `backend/`에서 실행(`pythonpath = .`가 `backend/`를 sys.path에 넣어 `from main import app`·`from services import ...`가 동작).

---

## 로컬 `.venv` ≠ Docker 의존성 함정 (중요)

- `lxml`은 `requirements.txt`에 있고 **Docker 이미지엔 설치되지만 로컬 `backend/.venv`엔 없다**.
- 로컬 pytest로 검증할 코드/테스트에서 HTML 파싱은 `BeautifulSoup(html, "lxml")` 대신 **stdlib `BeautifulSoup(html, "html.parser")`**를 쓸 것(로컬·프로덕션 둘 다 동작).
- 실제 적용 사례: `backend/tests/test_backlog_extract.py:25` (`BeautifulSoup(html, "html.parser")`).
- 로컬에서 굳이 `lxml`이 필요하면 `.venv`에 직접 설치.

---

## 테스트 파일 위치 & 명명

- **위치:** 전부 `backend/tests/` 한 폴더에 평면 배치(소스와 co-locate 안 함).
- **명명:** `test_<대상>.py`. router 테스트는 `test_<name>_router.py`, service 테스트는 `test_<name>_service.py`(또는 `test_<name>.py`).
- 테스트 함수: `test_<동작>_<기대>` 형태의 서술형 (예: `test_add_duplicate_ticker_returns_400`).
- `backend/tests/__init__.py` 존재(패키지). `backend/tests/conftest.py`가 공유 fixture·import path 설정.

### 현재 테스트 파일 (66개, `backend/tests/test_*.py`)

router: `test_admin_router.py`, `test_analysis_router.py`, `test_analytics_router.py`, `test_batches_router.py`, `test_calendar_router.py`, `test_consensus_router.py`, `test_digest_router.py`, `test_events_router.py`, `test_guru_router.py`, `test_investor_router.py`, `test_portfolio_router.py`, `test_rankings_router.py`, `test_report_router.py`, `test_stocks_router.py`, `test_watchlist_router.py`

service/로직: `test_auth.py`, `test_auth_me.py`, `test_backlog.py`, `test_backlog_extract.py`, `test_cache.py`, `test_consensus_asof.py`, `test_digest_service.py`, `test_disclosures.py`, `test_disclosure_batch.py`, `test_disclosure_endpoint_digest.py`, `test_dividends.py`, `test_event_tracker.py`, `test_guru_stats.py`, `test_indicators.py`, `test_investor_service.py`, `test_investor_service_kiwoom.py`, `test_leverage_service.py`, `test_market.py`, `test_market_cache.py`, `test_market_history_routing.py`, `test_market_indicators.py`, `test_market_kr.py`, `test_market_us_kis.py`, `test_report_generator.py`, `test_storage.py`, `test_ticker_validation.py`, `test_supply_score.py`

외부 API 클라이언트(kiwoom/kis): `test_kis_client.py`, `test_kis_quote.py`, `test_kiwoom_chart.py`, `test_kiwoom_investor.py`, `test_kiwoom_quote.py`, `test_kiwoom_sector.py`

배치/스케줄러: `test_batch_endpoints.py`, `test_batch_market_split.py`, `test_batch_resilience.py`, `test_job_runs.py`, `test_job_runs_instrumentation.py`, `test_macro_signals.py`, `test_macro_signals_batch.py`, `test_market_split_report.py`, `test_schedule_spec.py`, `test_scheduler_investor.py`, `test_scheduler_kr_sector_seed.py`, `test_scheduler_rankings.py`, `test_scheduler_seed.py`

KR 섹터/랭킹: `test_analysis_sector_kr.py`, `test_kr_sector_batch.py`, `test_kr_sector_mapping.py`, `test_kr_sector_momentum.py`, `test_ranking_service.py`

---

## 공유 Fixture (`backend/tests/conftest.py`)

```python
sys.path.insert(0, str(Path(__file__).parent.parent))   # backend/ 를 path에 추가
app.dependency_overrides[get_current_user] = lambda: "test-user-id"   # 전역 인증 우회

@pytest.fixture
def client():
    return TestClient(app)

@pytest.fixture(autouse=True)
def _clear_quote_cache():
    # get_quote는 종목 단위 TTL 캐시를 쓰므로 테스트 간 교차 오염을 막기 위해 매 테스트 전 비운다.
    from services import cache as cache_svc
    cache_svc.invalidate_quote()
    yield
```

- `get_current_user` 의존성을 전역 override해 인증을 우회(모든 테스트가 `"test-user-id"`로 동작).
- `autouse` fixture로 매 테스트 전 quote 캐시 무효화 → TTL 캐시 교차 오염 방지.

---

## TestClient 사용 패턴

router 테스트는 두 가지 스타일이 공존한다.

1. **conftest의 `client` fixture 재사용** — 전체 `app`을 띄움.
2. **테스트 파일에서 미니 app 직접 조립** — 해당 router만 mount (`backend/tests/test_portfolio_router.py:1`):

```python
app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
client = TestClient(app)
```

- 의존 service는 전부 mock하고 HTTP 상태코드 + 응답 JSON 단언 (`assert resp.status_code == 201`).

---

## Mocking

- 프레임워크: stdlib `unittest.mock` (`from unittest.mock import patch, MagicMock`). 외부 mock 라이브러리 없음.
- **mock 타깃은 "사용처 모듈 경로"로 patch** — 정의 모듈이 아니라 import한 router/service 경로. 예: `patch("routers.portfolio.storage.get_holdings", ...)` (router가 import한 심볼을 가로챔).
- 다중 mock은 `with ... , \` 줄바꿈 연쇄 (`backend/tests/test_portfolio_router.py:34`).
- 호출 검증: `mock.assert_called_once_with(...)`, `mock.assert_not_called()`, `mock.call_args[0][1]`(positional 인자 인덱싱).
- 외부 API/네트워크는 항상 mock. 예: yfinance는 `patch("services.market.yf.Ticker", return_value=MagicMock(...))`로 빈 히스토리 주입 (`backend/tests/test_market_kr.py:6`); 키움/KIS는 `client.configured`/`quote.get_quote`를 patch.
- 순환참조/패치 우선순위 때문에 **테스트 함수 안에서 대상 모듈을 지연 import**하는 패턴 흔함 (`from services import market`을 `with patch(...)` 블록 안에서).

### Mock하는 것 / 안 하는 것

- **Mock한다:** DB(`db_query`/`storage.*`), 외부 API(yfinance·키움·KIS·Naver·DART·FRED), 시간 의존(스케줄러), 캐시 무효화.
- **Mock 안 한다:** 순수 정규화/계산 로직(`_num`, `normalize_basic`, `_parse_susu_table`, `sanitize`)은 실제 함수를 직접 호출해 입출력 단언.

---

## Fixture 데이터 / Factory

- **인라인 샘플 상수:** 테스트 파일 상단에 `SAMPLE_STOCKS`, `SAMPLE_HOLDINGS`, `SAMPLE_FULL` 같은 dict/list 리터럴 (`backend/tests/test_portfolio_router.py:13`).
- **파일 fixture (실데이터 HTML):** `backend/tests/fixtures/backlog/*.html` — 실제 DART document.xml 표 HTML을 종목코드 파일명으로 저장(`005930.html`, `034020.html` 등). 첫 줄 주석에 단위 캡션을 담아 파서가 추출 (`backend/tests/test_backlog_extract.py:19` `_load`).
- **파라미터화:** `@pytest.mark.parametrize("tk,expected_eok", [...])`로 종목별 기대값 표 테스트 (`test_backlog_extract.py:41`).
- 정상 케이스 + 엣지/None 케이스(빈셀·외화·다중엔티티·검산 실패)를 함께 단언해 "wrong < missing" 게이트를 고정.

---

## 비동기 / 에러 테스트

- 엔드포인트는 동기 함수 + `TestClient`(내부에서 ASGI 처리)라 async test 마커 불필요.
- 에러 케이스는 HTTP 상태코드로 단언 (`assert resp.status_code == 404` / `== 400`).
- 외부 API 장애는 `side_effect=RuntimeError(...)`로 주입해 폴백 체인을 검증 (`test_market_kr.py:46` 키움 장애 → Naver 폴백).
- `BackgroundTasks` 트리거는 `report_generator.generate_report`를 mock하고 `mock_gen.assert_called_once()` / `assert_not_called()`로 호출 여부 단언.

---

## 커버리지 현황 (실측)

커버리지 도구는 강제되지 않는다(`pytest.ini`에 cov 옵션 없음). 파일 존재 기준 정성 평가:

**잘 커버됨:**
- router 계층 대부분(portfolio·watchlist·stocks·report·analytics·analysis·digest·guru·admin·events·calendar·consensus·rankings·batches).
- 외부 API 정규화 로직(키움·KIS quote/sector/investor/chart, market KR/US 폴백 체인).
- 배치/스케줄러(시장 분리·resilience·job_runs 계측·seed·schedule spec).
- 도메인 파싱(backlog 추출+검산, disclosures, dividends, consensus, supply_score).
- 유틸(ticker 검증, cache, indicators, storage).

**커버 안 됨 / 갭:**
- **프론트엔드 전체** — 단위/컴포넌트 테스트 0개. Vitest/Jest/RTL 미설치(`frontend/package.json`에 test script 없음).
- **실 DB 통합 테스트 없음** — 모든 DB 호출이 mock. 실제 PostgreSQL 대상 통합 테스트는 없다(스키마·쿼리 회귀는 운영에서만 노출).
- **실 외부 API 계약 테스트 없음** — 키움/KIS/DART/FRED 응답 스키마 변경은 fixture 갱신 없이는 못 잡는다. CLAUDE.md gotcha: "수주잔고/데이터 파싱 변경은 배포 후 전 종목 재적재 UAT 필수"(fixture 단위 테스트 통과해도 실데이터 케이스를 놓침).

---

## 프론트엔드 검증 (UAT)

- 자동 단위 테스트 없음. **Playwright 디바이스 에뮬레이션으로 수동 UAT** (폰 없이 모바일 검증).
- 테스트 계정: `test@portfolion.com` / `test1234`.
- 격리 UAT 하니스(`frontend/uat.html`)는 **현재 리포지토리에 없다**(과거 존재했으나 제거됨). 검증은 라이브 배포 환경 또는 `npm run dev` 대상으로 수행.
- 색/배지 같은 시각 회귀는 변수 토큰 실제값(KR 빨강=상승) 기준으로 라이브 대조해야 함(CONVENTIONS.md "KR 색 관례 함정" 참조).

---

*테스트 분석: 2026-06-17*

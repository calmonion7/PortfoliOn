---
last_mapped_commit: 6d95dcb9610a1b3c68075b0f587169989f6d8e10
mapped: 2026-06-19
---

# TESTING

PortfoliOn의 테스트 프레임워크·위치·실행·모킹 관례. 실제 `backend/tests/` 내용에서 추출.

## 프레임워크 / 실행

- **pytest** (`requirements.txt`: `pytest>=7.4.0`, `httpx>=0.25.0` — FastAPI `TestClient`용). 프론트엔드 단위 테스트 프레임워크는 없음(아래 UAT 절 참고).
- 설정 `backend/pytest.ini`:
  ```
  [pytest]
  testpaths = tests
  pythonpath = .
  ```
- 실행 (프로젝트 루트 기준):
  ```bash
  cd backend && .venv/bin/python -m pytest
  ```
  macOS는 `backend/.venv/bin/python`, Windows는 `backend/.venv/Scripts/python`.
- **로컬 `.venv` ≠ Docker 의존성**: `lxml`은 `requirements.txt`/Docker엔 있으나 로컬 `.venv`엔 없을 수 있음. 로컬 pytest로 돌릴 HTML 파싱은 `BeautifulSoup(html, "lxml")` 대신 stdlib `BeautifulSoup(html, "html.parser")`를 쓸 것.

## 테스트 위치 / 구성

- 모든 백엔드 테스트는 `backend/tests/`. 현재 **74개 `test_*.py`** 파일. 함수명 `test_*`, 클래스 없이 모듈-레벨 함수 위주.
- `backend/tests/__init__.py` (빈 파일), `backend/tests/conftest.py`, `backend/tests/fixtures/` (예: `fixtures/backlog/*.html` — DART 원문 HTML fixture, ticker별).
- `conftest.py`가 하는 일:
  - `sys.path.insert(0, <backend>)`로 `main`/`auth`/`services` import 가능하게 함(개별 테스트 파일 상단에도 동일 부트스트랩 반복 — 예 `test_recommendation_endpoint.py`).
  - `app.dependency_overrides[get_current_user] = lambda: "test-user-id"`로 인증 전역 우회.
  - `@pytest.fixture def client(): return TestClient(app)` 제공.
  - `@pytest.fixture(autouse=True) _clear_quote_cache` — 매 테스트 전 `cache.invalidate_quote()`로 TTL 시세 캐시 교차오염 방지.

## TestClient / 인증 패턴

- 두 가지 앱 구성 방식이 공존:
  1. `conftest`의 `client` 픽스처 + `from main import app` 전체 앱 (라우터 통합 테스트).
  2. 라우터 단위 미니 앱: `app = FastAPI(); app.include_router(router)` 후 `app.dependency_overrides[...]` (`test_recommendation_endpoint.py`).
- 인증 우회: `app.dependency_overrides[get_current_user] = lambda: "test-user-id"`, admin 경로는 `app.dependency_overrides[require_admin] = lambda: "admin-id"`. `dependency_overrides`는 25개 테스트, `require_admin` 우회는 10여 개 파일에서 사용.

## 모킹 패턴 (`unittest.mock`)

- `from unittest.mock import patch, MagicMock`. 외부 I/O(DB·yfinance·외부 API)는 전부 patch.
- **patch 타깃은 사용처 기준**: 패키지 분리 후 심볼이 실제 정의된 서브모듈을 패치한다. 예 `patch("services.storage.portfolio.query", ...)`, `patch("services.storage.schedule.execute")`, `patch("services.market.kr._naver_get", ...)`, `patch("services.market.yf.Ticker", ...)`. 라우터 단위는 라우터 네임스페이스로 패치(`patch("routers.recommendations.recommendation.read_recommendations", ...)`).
- 인자 단언 위계 (CLAUDE.md 규율과 일치):
  - 단일 호출: `mock.call_args.args[0]` / `mock.call_args.kwargs` 또는 `_, kwargs = mock.call_args`.
  - **다중 호출 시 `call_args_list[i].kwargs`로 호출별 인덱스 명시** — 마지막 호출(`call_args`)에 의존하면 additive 호출 추가 시 깨짐. `test_recommendation_endpoint.py`가 모범: discovery 단언은 `call_args_list[0].kwargs`, 후속 watchlist/holdings는 `call_args_list[1:]` 루프로 단언.
  - **호출 시퀀스 못박기는 `call_count`**: `assert mock_read.call_count == 1` / `== 2` (`test_recommendation_endpoint.py`), `test_market.py`의 `assert mk.call_count == 1`(TTL 캐시 히트 검증). `call_count`는 portfolio/watchlist/job_runs/batch_resilience/admin/market_indicators 등 9개 파일에서 사용.
- SQL 단언: `ex.call_args.args[0]`(sql 문자열)에 `"INSERT INTO ..."`/`"ON CONFLICT ..."` 부분문자열 포함을 단언, `ex.call_args.args[1]`(params)로 값 검증 (`test_storage.py`의 `test_save_batch_schedule_upsert`, `test_save_stocks_*`).
- DB 커서 모킹: contextmanager 흉내 — `mock_conn.cursor.return_value.__enter__.return_value = mock_cur` 후 `gc.return_value.__enter__.return_value = mock_conn` (`test_storage.py` `_capture_save_stocks` 헬퍼). `execute.call_args_list`를 순회해 원하는 INSERT를 찾는 식.
- yfinance 모킹: `MagicMock`에 `.info`/`.history()`/`.quarterly_income_stmt`/`.analyst_price_targets`/`.recommendations_summary`를 pandas DataFrame으로 세팅 (`test_market.py`의 `_make_mock_ticker`). `mock.history.side_effect = Exception(...)`로 에러 경로 검증.
- 모듈 재로드: 패키지 import 캐시로 패치가 안 먹는 경우 `import importlib; importlib.reload(market)` (`test_market.py`에서 2회). 드물게만 사용.

## 픽스처 / 헬퍼

- 테스트 데이터는 모듈-레벨 헬퍼 함수로 생성: `_scored_rows()`, `_portfolio(stocks, watchlist)`, `_make_mock_ticker(...)`, `_capture_save_stocks(...)`. 공유 픽스처보다 파일별 헬퍼 우세.
- HTML fixture는 `backend/tests/fixtures/backlog/<ticker>.html` (DART 원문 파싱 회귀 — `test_backlog.py`, `test_backlog_extract.py`).

## 무엇이 커버되는가

- **서비스 단위**: storage(portfolio/schedule/names/dates 분리분), market(quote/financials/analyst, KR/US 분기, 배치, 캐시 TTL), market_indicators, cache, indicators, consensus, dividends, disclosures, backlog(+extract), leverage, investor, ranking, supply_score, insider_trades, kiwoom(quote/chart/investor/sector), kis(client/quote), kr_sector(mapping/momentum), recommendation(scoring/funnel/store/universe), job_runs, schedule_spec.
- **라우터 단위**: portfolio, watchlist, stocks, report, guru, calendar, digest, market_indicators, analytics, analysis, admin, events, batches, rankings, investor, consensus, recommendation, auth(+me).
- **배치/스케줄러**: `batch_registry` 시장 분리(`test_batch_market_split.py`), 스케줄러 시드(`test_scheduler_seed.py`, `test_scheduler_kr_sector_seed.py`, `test_scheduler_rankings.py`), 회복력(`test_batch_resilience.py`), job_runs 인스트루먼테이션(`test_job_runs_instrumentation.py`).
- **회귀 고정 주의점**: 은퇴한 배치 id를 단언하던 테스트는 깨진 동작을 고정해 TDD green이 회귀를 못 잡음 — id 변경 시 테스트도 grep 대상(daily_report 시장분리 재발 교훈).

## 무엇이 커버되지 않는가

- 외부 API 실제 호출(yfinance/Naver/키움/KIS/DART/FRED/KOFIA)은 전부 모킹 — 라이브 응답 shape 드리프트는 테스트가 못 잡음. 데이터 파싱 변경(수주잔고 등)은 **배포 후 전 종목 재적재 UAT 필수**(fixture에 없던 실데이터 케이스: 외화 USD천, 단위 캡션 줄바꿈, 회사컬럼 표 등).
- 실제 PostgreSQL 연동·마이그레이션·트랜잭션 무결성은 단위 테스트 대상 아님(DB는 모킹).
- 프론트엔드 단위/컴포넌트 자동화 테스트 없음(아래).

## 프론트엔드 검증 (UAT)

- 자동화 단위 테스트 프레임워크 없음. `frontend/package.json` scripts는 `dev`/`build`/`lint`(eslint)/`preview`만. lint는 `eslint .` (eslint-plugin-react-hooks 포함).
- 프론트 동작 검증은 **Playwright 디바이스 에뮬레이션 UAT**(폰 없이): 테스트계정 `test@portfolion.com` / `test1234`. 격리 하니스로 `vite` 임시 `uat.html`을 띄워 우회 (사용자 메모리 `reference-frontend-uat`). 현 시점 리포지토리에 Playwright 설정/`uat.html`이 커밋돼 있지는 않음 — 검증 시 ad-hoc로 생성.
- 검증 원칙: **프로덕션 쓰기·읽기·settings 자가권한은 분류기 차단** → 사용자 `!` 실행 또는 admin 엔드포인트 경유, 최종 확인은 사용자 화면(라이브 UAT). 자동배포 환경이라 변경 검증은 main 머지·배포 후에 가능.

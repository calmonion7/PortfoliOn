---
last_mapped_commit: 1bbea86804f93c6f544092809ff8ed13977e5975
mapped: 2026-06-06
---

# 테스트 가이드

PortfoliOn 테스트의 프레임워크·구조·모킹·실행 방법과, 무엇이 테스트되고 무엇이 안 되는지를 실제 파일 기준으로 정리한다.

## 요약

- **백엔드**: pytest 기반, `backend/tests/`에 31개 테스트 파일·총 284개 테스트 함수. `pytest --co`로 수집 검증 완료(Python 3.9, `backend/.venv`).
- **프론트엔드**: 테스트 없음. Vitest/Jest 등 테스트 프레임워크 미설치, 테스트 파일 0건(아래 상세).

---

## 백엔드 테스트

### 프레임워크 및 설정

- 프레임워크는 **pytest**다. `backend/requirements*.txt`에 `pytest>=7.4.0`만 명시돼 있고, 별도 플러그인(pytest-cov, pytest-mock 등)은 없다 — 모킹은 표준 라이브러리 `unittest.mock`을 직접 쓴다.
- 설정 파일 `backend/pytest.ini`:
  ```ini
  [pytest]
  testpaths = tests
  pythonpath = .
  ```
  `pythonpath = .`로 `backend/`를 import 루트로 잡아 `from main import app`, `from routers.portfolio import router`가 동작한다.
- 커버리지 측정 설정·도구는 없다(coverage 의존성 없음). 커버리지 리포트를 생성하는 구성은 발견되지 않았다.

### 실행 방법

```bash
cd backend && .venv/bin/python -m pytest
```

(CLAUDE.md 명시 명령. Windows는 `backend/.venv/Scripts/python`.) 특정 파일만: `cd backend && .venv/bin/python -m pytest tests/test_portfolio_router.py`.

### 테스트 위치 및 구조

- 모든 테스트는 `backend/tests/` 한 디렉터리에 평면 배치, 파일명은 `test_*.py` 컨벤션.
- 명명 규칙: `test_<router>_router.py`(라우터 통합 테스트)와 `test_<service>.py`/`test_<service>_service.py`(서비스 단위 테스트)로 나뉜다.
- 테스트 함수명은 행동 서술형 `test_<동작>_<기대결과>`. 예: `test_add_duplicate_ticker_returns_400`, `test_delete_nonexistent_ticker_returns_404`, `test_add_stock_triggers_report_when_no_snapshot` (`backend/tests/test_portfolio_router.py`).
- 일부 테스트는 한국어 docstring으로 의도를 설명한다. 예: `test_update_stock_updates_holdings_and_preserves_structured_analysis`의 `"""수정 시 수량/평단은 갱신하고 name·competitors만 마스터에 반영하되, 구조화된 moat/growth_plan 등은 덮어쓰지 않고 보존해야 한다."""` (`backend/tests/test_portfolio_router.py:62`).

### 공통 픽스처 (`backend/tests/conftest.py`)

```python
sys.path.insert(0, str(Path(__file__).parent.parent))
app.dependency_overrides[get_current_user] = lambda: "test-user-id"

@pytest.fixture
def client():
    return TestClient(app)
```

- `sys.path` 삽입으로 `backend/` import 보장(개별 서비스 테스트도 파일 상단에서 같은 삽입을 반복하는 경우가 있다, 예: `backend/tests/test_ranking_service.py:1-3`, `test_leverage_service.py:1-3`).
- 전역 인증 우회: `app.dependency_overrides[get_current_user] = lambda: "test-user-id"`로 `main.app`의 인증 의존성을 고정 user_id로 대체한다.

### 라우터 테스트 패턴

두 가지 앱 진입 방식이 공존한다.

1. **conftest의 전역 `app`/`client`** — `from main import app` 전체 앱을 쓰고 `client` 픽스처를 주입받음.
2. **라우터 단독 마운트** — 테스트 파일 내에서 독립 `FastAPI()`를 만들고 해당 라우터만 `include_router` 후 의존성 오버라이드. 예 (`backend/tests/test_portfolio_router.py:8-11`):
   ```python
   app = FastAPI()
   app.include_router(router)
   app.dependency_overrides[get_current_user] = lambda: "test-user-id"
   client = TestClient(app)
   ```
   요청은 `starlette` `TestClient`로 `client.get/post/put/delete(...)` 호출 후 `resp.status_code`/`resp.json()` 단언.

### 모킹 접근

DB·외부 API·yfinance 같은 부수효과는 전부 모킹한다. 실제 PostgreSQL/네트워크에 의존하지 않는다.

- **`unittest.mock.patch`** (지배적) — 대상 함수를 **import된 위치**에서 패치한다. 모듈 import 컨벤션 덕에 `patch("routers.portfolio.storage.get_holdings", return_value=[])`처럼 라우터가 참조하는 심볼을 정확히 가로챈다. 호출 인자는 `mock_save_holdings.call_args[0][1]`로 검증, 호출 여부는 `assert_called_once_with(...)`/`assert_not_called()`로 검증 (`backend/tests/test_portfolio_router.py:33-105`).
- **`MagicMock` + `patch`로 외부 HTTP 모킹** — `requests.get` 응답 객체를 `MagicMock`으로 만들어 `mock_resp.json.return_value = ...`, `mock_resp.raise_for_status = lambda: None`로 세팅 후 `patch("services.leverage_service.requests.get", return_value=mock_resp)` (`backend/tests/test_leverage_service.py:31-35`). KOFIA 응답 같은 외부 페이로드는 `_kofia_response(items)` 같은 헬퍼 빌더로 합성한다(`:9`).
- **`monkeypatch`** (일부) — `test_market_indicators.py`, `test_leverage_service.py`, `test_ranking_service.py`, `test_event_tracker.py`, `test_scheduler_*.py`, `test_digest_service.py`, `test_cache.py`, `test_auth.py` 등에서 사용.
- **순수 함수 단위 테스트** — 파서/포매터 등 부수효과 없는 헬퍼는 모킹 없이 직접 단언. 예: `_parse_int`/`_parse_float`/`_is_etf`/`_kr_row`/`_top_n_by` (`backend/tests/test_ranking_service.py:23-70`), 부동소수 비교는 `pytest.approx` 사용.
- 테스트 데이터는 모듈 상단 `SAMPLE_*` 상수(`backend/tests/test_portfolio_router.py:13-23`)나 팩토리 함수(`_kr_stock(...)`, `backend/tests/test_ranking_service.py:8`)로 만든다.

### 무엇이 테스트되는가 (커버 영역)

`backend/tests/`에 존재하는 테스트 파일 기준:

- **라우터(통합)**: portfolio, watchlist, stocks, report, consensus, calendar, analytics, analysis, admin, digest, guru, events, rankings, investor.
  - `test_portfolio_router.py`, `test_watchlist_router.py`, `test_stocks_router.py`, `test_report_router.py`, `test_consensus_router.py`, `test_calendar_router.py`, `test_analytics_router.py`, `test_analysis_router.py`, `test_admin_router.py`, `test_digest_router.py`, `test_guru_router.py`, `test_events_router.py`, `test_rankings_router.py`, `test_investor_router.py`.
- **서비스(단위)**: market, indicators, market_indicators, market_cache, leverage_service, lending(=market_indicators 내), ranking_service, investor_service, report_generator, digest_service, guru_stats, storage, cache.
  - `test_market.py`, `test_indicators.py`, `test_market_indicators.py`(가장 큰 24KB), `test_market_cache.py`, `test_leverage_service.py`, `test_ranking_service.py`, `test_investor_service.py`, `test_report_generator.py`, `test_digest_service.py`, `test_guru_stats.py`, `test_storage.py`, `test_cache.py`.
- **인증**: `test_auth.py`(토큰/인증 로직), `test_auth_me.py`(`/api/auth/me`).
- **미들웨어/스케줄러**: `test_event_tracker.py`(`middleware/event_tracker.py`), `test_scheduler_rankings.py`, `test_scheduler_investor.py`(스케줄러 잡 등록/동작).

### 무엇이 테스트되지 않는가 (갭)

- 다음 라우터/서비스에 대응하는 전용 테스트 파일이 없다: `auth_service`(엔드포인트 `test_auth*`로 간접 커버되나 서비스 단위 테스트는 없음), `consensus`/`consensus_pipeline`(라우터 테스트는 있으나 파이프라인 서비스 단독 테스트 없음), `report_generator` 외의 `report` 비즈니스 로직 일부, `charts`, `scraper`, `guru_scraper`, `backlog`, `analysis_service`(라우터 `test_analysis_router.py`로 간접 커버), `db.py`(직접 단위 테스트 없음 — 모든 DB 접근이 모킹되므로), `auth.py`의 `require_admin_or_api_key`.
- 통합/엔드투엔드(실제 PostgreSQL·실제 외부 API) 테스트는 없다. 모든 외부 의존성은 모킹된다.
- 부하/동시성, DB 마이그레이션(`auth_schema.sql`/`app_schema.sql`) 검증 테스트는 없다.

---

## 프론트엔드 테스트

**프론트엔드에는 테스트가 전혀 없다.** 다음으로 확인했다:

- `*.test.js(x)` / `*.spec.js(x)` 파일 검색 결과 0건 (`frontend/src/` 전체).
- `frontend/package.json`에 `test` 스크립트 없음. `scripts`는 `dev`/`build`/`lint`/`preview`만 존재.
- `devDependencies`에 Vitest·Jest·@testing-library·Cypress·Playwright 등 테스트 도구가 하나도 없다. 품질 도구는 ESLint(`eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`)뿐이며 `npm run lint`로 실행한다.
- `vitest.config.*` / `jest.config.*` 설정 파일도 없다.

프론트엔드 검증은 현재 ESLint 정적 분석과 수동/배포 후 확인에 의존한다.

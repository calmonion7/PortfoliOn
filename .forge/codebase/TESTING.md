---
last_mapped_commit: 163c29cbd89d9b1d2aa5a101670e9fa34ceb21c4
mapped: 2026-06-19
---

# TESTING

PortfoliOn 테스트 스위트를 실제 파일에서 귀납한 사실. 모든 경로는 프로젝트 루트 기준. 백엔드만 자동화 테스트가 존재한다(프론트는 없음).

## 1. 프레임워크·실행

- **pytest** 단일 프레임워크. 백엔드 전용(`backend/tests/`).
- 실행: `cd backend && .venv/bin/python -m pytest` (macOS venv 경로). 설정은 `backend/pytest.ini`:
  ```
  [pytest]
  testpaths = tests
  pythonpath = .
  ```
- `pythonpath = .`로 `backend/`를 import 루트에 두지만, 그와 별개로 거의 모든 테스트 파일이 상단에서 `sys.path.insert(0, str(Path(__file__).parent.parent))`를 직접 한다(예: `tests/test_recommendation_endpoint.py:2-4`, `tests/test_insider_trades.py:1-4`).
- 현재 **835개 테스트 수집**(`pytest --collect-only` 기준). 전부 green 상태가 목표.
- 테스트 파일 76개(`tests/test_*.py`). `tests/__init__.py` 존재(패키지).
- 프론트엔드 테스트 없음: `frontend/package.json`에 test 스크립트·테스트 러너(vitest/jest) 의존성 없고, `frontend/src`에 `*.test.*`/`*.spec.*` 파일 0개. UAT는 별도(메모리 `reference-frontend-uat.md` — Playwright 에뮬레이션, 테스트계정).

## 2. 네이밍·구조

- 파일: `tests/test_<대상>.py`. 대상 단위로 분리됨 — 라우터(`test_stocks_router.py`, `test_report_router.py` ...), 서비스(`test_insider_trades.py`, `test_leverage_service.py` ...), 기능 단면(`test_batch_market_split.py`, `test_macro_signals.py`, `test_recommendation_scoring.py` ...).
- 한 기능이 여러 파일로 쪼개짐: recommendation은 `test_recommendation_endpoint.py`(라우터), `_batch.py`/`_funnel.py`/`_scoring.py`/`_store.py`/`_universe.py`/`_actions.py`로 레이어별 분할.
- 테스트 함수: `def test_<동작>_<조건>():`. docstring/이름이 한국어(예: `test_get_recommendations_excludes_caller_tracked`, docstring `"""watchlist 종목 중 점수 있는 것 → ..."""`).
- 모듈/함수 docstring·인라인 주석은 **한국어 위주**이며 ADR·task 번호를 인용(예: `test_recommendation_batch.py:1` `"""S5: recommendation_kr/us 배치 본문 + registry 확정 (.forge/adr/0015)."""`).
- 테스트 내부 헬퍼는 `_`-접두 모듈 함수: `_scored_rows()`, `_portfolio()`(`test_recommendation_endpoint.py:22,36`), `_u()`/`_ohlc()`(`test_recommendation_batch.py:23,28`), `_FakeJsonResp` 클래스(`test_insider_trades.py:7`).

## 3. 두 갈래 모킹 방식

스위트는 테스트 대상에 따라 두 모킹 스타일을 명확히 나눠 쓴다.

### 3.1 라우터/엔드포인트 → `unittest.mock.patch` + FastAPI `TestClient`

- 28개 파일이 `TestClient`, 45개가 `unittest.mock`(`patch`/`MagicMock`) 사용.
- 두 가지 클라이언트 구성이 공존:
  - **모듈-레벨 미니 앱**(라우터 단위 격리): `app = FastAPI(); app.include_router(router); app.dependency_overrides[...]; client = TestClient(app)`를 모듈 상단에 직접 둠(`test_recommendation_endpoint.py:15-19`, `test_stocks_router.py:9-13`).
  - **`tests/conftest.py`의 공용 `client` fixture**: 실제 `main.app`을 import해 `client()` fixture로 제공. `app.dependency_overrides[get_current_user] = lambda: "test-user-id"`로 인증을 전역 오버라이드.
- 인증 게이팅은 `app.dependency_overrides`로 우회: `get_current_user`→`"test-user-id"`, `require_admin`→`"admin-id"`, `get_current_user_or_api_key`→`"test-user-id"`(`test_recommendation_endpoint.py:17-18`, `test_stocks_router.py:11-12`).
- 의존 함수는 **import 경로 문자열로 patch**(라우터가 import한 이름 기준): `patch("routers.recommendations.storage.get_full_portfolio", return_value=...)`, `patch("routers.recommendations.recommendation.read_recommendations", ...)`, `patch("routers.recommendations._latest_snapshots", ...)`. with-블록 다중 patch를 `\` 줄바꿈으로 묶는 스타일(`test_recommendation_endpoint.py:41-43`).
- 검증: `resp.status_code` + `resp.json()` 구조/값 단언.

### 3.2 서비스/순수 로직 → `monkeypatch`

- 33개 파일이 pytest `monkeypatch` fixture 사용. 서비스 모듈을 직접 import해 외부 의존(`requests.get`, `db.query`/`execute`, 다른 서비스 함수)을 교체.
- 예(`test_insider_trades.py`): `monkeypatch.setattr(svc.requests, "get", fake_get)`로 HTTP 교체, `monkeypatch.setattr(svc, "query", fake_query)`로 DB 교체, `monkeypatch.setattr(svc, "execute", lambda sql, params: calls.append(...))`로 쓰기 캡처.
- 가짜 HTTP 응답은 `_FakeJsonResp`(`.json()`만 구현, `:7-12`) 또는 람다. 인자/SQL 캡처는 클로저 `captured = {}`/`cap = {}` dict에 적재 후 단언(`test_insider_trades.py:122-134`, `:183-195`).
- `patch.object(module, "name", ...)`도 서비스 레이어에서 혼용(`test_recommendation_batch.py:43` `patch.object(F, "_fetch_history", return_value=df)`).

### 3.3 자료형 픽스처

- pandas DataFrame을 OHLC 픽스처로 생성하는 헬퍼(`test_recommendation_batch.py:28` `_ohlc(closes, volumes)` → `pd.date_range` 인덱스 + Open/High/Low/Close/Volume 컬럼).
- HTML 파싱 테스트(backlog 등)는 `tests/fixtures/backlog/<ticker>.html` 실파일 픽스처를 읽음(`005930.html`, `207940.html` 등 다수). **주의**: 로컬 `.venv`엔 `lxml` 미설치이므로 파싱은 stdlib `BeautifulSoup(html, "html.parser")`를 써야 로컬 pytest가 통과(CLAUDE.md gotcha).

## 4. additive read 오염 가토 — `call_args` vs `call_args_list[i].kwargs`

이 스위트의 핵심 모킹 규범. 엔드포인트에 read/외부호출을 **additive로 추가**하면 호출 *시퀀스*가 늘어, `mock.call_args`(마지막 호출)를 단언하던 기존 테스트가 조용히 오염된다(마지막 호출이 신규 호출로 바뀜).

대응 3종이 `test_recommendation_endpoint.py`에 실제로 적용돼 있다:

1. **호출별 인덱스 단언으로 마이그레이션** — 단일 호출 전제 단언을 `call_args_list[i].kwargs`로 명시. 예: discovery read가 첫 호출임을 못박아 `mock_read.call_args_list[0].kwargs`로 `exclude_tickers`를 단언(`:77-78`, `:102-103`), 이후 호출은 루프로 검증(`:105-106` `for call in mock_read.call_args_list[1:]:`).
2. **신규 호출은 입력 비면 생략** — 라우터가 `if wl_tickers:`/`if holdings_tickers:`로 빈 입력 시 추가 read를 안 해, 빈 portfolio 테스트(`:40-61`)는 여전히 마지막 호출=discovery라 `call_args`(`:60,115`)가 유효하게 보존됨.
3. **`call_count`/`assert_*`로 시퀀스 못박기** — `mock_batch.assert_not_called()`로 요청경로 라이브 배치 호출 0을 단언(`:138`). 스위트 전반에서 `call_count`·`assert_called`·`assert_not_called`가 19개 파일에서 사용.

`side_effect` 함수로 호출 인자에 따라 분기 반환하는 패턴도 흔함(`test_recommendation_endpoint.py:88,150` `def _read(*args, **kwargs): if kwargs.get("only_tickers"): ...`).

`call_args_list`를 명시적으로 쓰는 파일: `test_recommendation_endpoint.py`, `test_job_runs.py`, `test_kis_quote.py`, `test_batch_resilience.py`, `test_storage.py`, `test_stocks_router.py`.

## 5. 공용 fixture (`tests/conftest.py`)

- `_clear_quote_cache`(`autouse=True`): 매 테스트 전 `services.cache.invalidate_quote()`를 호출해 종목 단위 TTL 캐시 교차 오염 방지(`conftest.py`).
- `client`: `main.app` 기반 `TestClient` fixture.
- 그 외 테스트별 fixture는 `@pytest.fixture`로 파일 내 정의(스위트 19개 파일에 pytest 마커/fixture/raises 사용).

## 6. 단언 대상 경향

- **시퀀스 불변식**: 요청경로에서 외부 fetch 0(`assert_not_called`), 배치만 외부 호출(`test_recommendation_batch.py` 헤더 "요청·기동 경로 라이브 호출 0").
- **응답 shape**: 키 집합(`set(data.keys()) >= {...}`), additive 필드 존재/부재(`assert "base_date" not in first`), 정렬(score DESC) 단언.
- **방어적 정규화**: 부호 보존(`_num("-500") == -500`), 파싱 불가→`None`/skip(기본값 폴백 금지 — `test_insider_trades.py:78` "기본값 폴백 금지"), NaN 제외.
- **멱등성/dedup**: row_hash 결정성(`test_insider_trades.py:146`), `ON CONFLICT ... DO UPDATE` SQL 단언(`:173`), 2회 적재 시 동일 해시.
- **DDL/마이그레이션**: `main._migrate()`가 발행하는 SQL을 캡처해 `CREATE TABLE IF NOT EXISTS ...`·인덱스·PK 단언(`test_insider_trades.py:289-298`).
- **배치 id 4표면 일관**: registry read·market 분류·`job_runs.record`(auto+manual)·테스트가 같은 id를 쓰는지 검증(`test_recommendation_batch.py:3` 주석, `test_batch_market_split.py`).

## 7. 커버리지 경향

- 측정 도구(`pytest-cov`)는 설정에 없음 — 커버리지 수치 추적은 안 함. "약 800+ green"이 사실상의 건강 지표.
- 커버리지는 **새 기능마다 동반 신설**되는 경향(최근 추가: `test_recommendation_*.py` 7파일, `test_insider_trades.py`, `test_disclosure_*.py`, `test_kis_*.py`, `test_kiwoom_*.py`, `test_kr_sector_*.py`). 한 기능을 라우터/서비스/배치/스케줄러 레이어로 나눠 다중 파일로 덮음.
- 외부 의존(DART/yfinance/키움/KIS/KOFIA/FRED HTTP, PostgreSQL)은 전부 모킹 — 실 네트워크·실 DB 의존 테스트 없음(`requests.get`·`db.query`/`execute`를 monkeypatch, 라우터 의존은 patch).

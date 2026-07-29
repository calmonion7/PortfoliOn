---
last_mapped_commit: 4bb49ff0402c150884f2fa9c80dfed8dff1945d5
mapped: 2026-07-29
---

# CONVENTIONS — PortfoliOn 코딩 관례

이 문서는 **구현된 사실**만 기록한다(용어 정의는 `CONTEXT.md`, 부채·버그는 `CONCERNS.md` 영역).
섹션 번호는 코드가 인용하는 앵커다 — 특히 **§4 로깅 방출 규약**은 `backend/main.py:_configure_logging()`
docstring과 `backend/tests/test_no_print.py`가 "CONVENTIONS §4"로 참조하므로 번호를 바꾸지 말 것.

---

## 1. 백엔드 파이썬 스타일

### 1.1 모듈 레이아웃
- `backend/main.py` — 앱 배선(라우터 include·미들웨어·CORS·기동 마이그레이션·로깅 배선). 라우터 21개를 `include_router`로만 붙이고 `prefix` 인자는 쓰지 않는다(최종 경로 = 원 라우터의 prefix).
- `backend/routers/<도메인>.py` — HTTP 계층만(검증·의존성·응답 형태). 도메인 로직은 서비스로.
- `backend/services/` — 도메인 로직 + 외부 IO. 커진 모듈은 **패키지로 분해**: `services/storage/`, `services/market/`, `services/market_indicators/`, `services/recommendation/`, `services/kiwoom/`, `services/kis/`.
- `backend/scheduler/` — 루트 레벨 패키지(`__init__.py` 배선 + `jobs.py` + `schedule.py` + `_state.py`). `services/` 하위가 아니다.
- `backend/middleware/` — `event_tracker.py` 등 ASGI 미들웨어.

### 1.2 패키지 분해 시 re-export 규약
단일 파일 → 패키지로 쪼갤 때 **`__init__.py`에서 공개+내부 심볼을 전부 re-export**해 기존
모듈 속성 조회 표면(`storage.X`, `scheduler.X`)을 보존한다.
- `backend/services/storage/__init__.py` — `portfolio`/`names`/`dates`/`schedule` 서브모듈 심볼 + `services.db`의 `query`/`execute`/`get_connection`까지 재노출.
- `backend/scheduler/__init__.py` — `_in_market`·`_generate_kr` 같은 **underscore 심볼도 명시 re-export**(`import *`가 underscore를 건너뛰므로).
- 공유 상태·상수는 leaf 모듈(`scheduler/_state.py`)에 두어 부분초기화 순환을 회피한다.

### 1.3 타입 어노테이션과 로컬 3.9 제약
- `from __future__ import annotations`를 파일 상단에 두는 것이 다수 관례(앱 파이썬 102개 중 66개). 그 파일에서는 `dict | None`, `list[dict]` 같은 PEP604/제네릭을 자유롭게 쓴다 — 예 `backend/services/db.py`(`_pool: ThreadedConnectionPool | None`, `def query(...) -> list[dict]`).
- **런타임 평가되는 어노테이션 자리에는 `Optional[X]`/`Dict[...]`를 쓴다** — Pydantic 모델 필드, FastAPI 핸들러 시그니처. 로컬 `backend/.venv`는 Python 3.9.6(Docker는 3.12)이라 `float | None`이 로컬 pytest에서 `TypeError`가 된다. 예 `backend/routers/portfolio.py:168` `Dict[str, Optional[float]] = Body(...)`, `backend/auth.py` `Optional[HTTPAuthorizationCredentials]`.
- 반환형은 강제되지 않는다(서비스는 `-> dict`/`-> list[dict]`를 자주 붙이고 라우터 핸들러는 대개 생략).

### 1.4 그 밖
- private 헬퍼는 `_` 접두사, 모듈 상수는 `_UPPER_SNAKE`(`_FX_SYMBOLS`, `_API_KEY_HEADER`, `_KST`).
- 순환참조는 **함수 내부 지연 import**로 회피(`main._migrate()`가 함수 안에서 `from services.db import execute`, `services/storage` → `services/cache`).
- docstring·주석은 한국어로 "왜"를 남기고 근거를 `task#157`·`ADR-0013`·`CONCERNS §4` 형태로 인용한다. 규약을 어기고 싶어지는 지점(예: `routers/watchlist.py:169` promote가 DELETE를 피하는 이유)에 반드시 이유를 적는다.
- 서드파티 표준: FastAPI + Pydantic v2 + psycopg2(생 SQL, ORM 없음) + APScheduler + pandas/yfinance + BeautifulSoup(파서는 `"html.parser"` — 로컬 `.venv`에 lxml 없음).

---

## 2. 프론트엔드 스타일

- React 19 함수 컴포넌트 + 훅만 사용(클래스 컴포넌트 0). 파일당 기본 export 1개가 주 컴포넌트, 관련 보조 컴포넌트는 named export(`components/ui/Badge.jsx`의 `MarketBadge`/`ChangeBadge`).
- **plain CSS — TailwindCSS 없음.** `frontend/src/index.css`가 `styles/tokens.css` → `styles/pc.css` → `styles/mobile.css` → `styles/guru.css`를 `@import`하고, 컴포넌트 전용 CSS는 co-located 후 컴포넌트가 직접 import(`components/ui/Badge.jsx`의 `import './Badge.css'`). CSS 파일 총 23개.
- **색·타이포·간격은 `frontend/src/styles/tokens.css`의 CSS 변수(149개)를 쓴다**(하드코딩 금지). 주요 축:
  - 가격 방향 `--up`/`--down`(+`--up-soft`/`--down-soft`) — KR 관례(상승=빨강).
  - 의미 상태 `--color-success`/`--color-error`(=`--color-danger`)/`--warn`/`--color-info` — 통념(Western)대로.
  - 데이터 팔레트 `--data-1`~`--data-5`, 버튼 채움 `--btn-primary-bg`/`--btn-danger-bg`, 상관 `--corr-pos`/`--corr-neg`.
  - light가 기본 테마, dark는 오버라이드.
- CSS 클래스는 BEM-ish: 블록 `badge`, 변형 `badge--neutral`/`badge--up`, 엘리먼트 `badge__icon`. 컴포넌트는 `['badge', variantClass[variant], `badge--${size}`, className].join(' ')` 식으로 조립하고 `className` prop을 마지막에 합친다.
- 인라인 `style={{}}`도 정식으로 쓰인다(`components/reports/DetailTab.jsx` 116곳, `components/reports/Sections.jsx` 88곳). 경계: **재사용되는 시각 요소는 CSS 클래스+토큰, 1회성 레이아웃/차트 배치는 인라인**.
- 사용자 문자열·라벨·주석은 한국어.
- HTTP 호출은 `frontend/src/api.js`의 axios 인스턴스만 사용 — 요청 인터셉터가 `localStorage.access_token`을 Bearer로 붙이고, 응답 인터셉터가 401에서 토큰을 지우고 `/`로 보낸다. `baseURL`은 `VITE_API_BASE_URL`(미설정 시 상대경로 → Vite dev proxy `/api` → `localhost:8000`).
- 차트는 recharts 3(`manualChunks`에서 `charts` 청크로 분리, `frontend/vite.config.js`). Vite 8(rolldown)이므로 `manualChunks`는 **함수 형식만**.

---

## 3. 네이밍

### 3.1 백엔드
- 라우터: `router = APIRouter(prefix="/api/<도메인>", tags=["<도메인>"])`, 파일명 = 도메인. 주의 — `backend/routers/market_indicators.py`의 prefix는 `/api/market`(`/api/market-indicators`는 존재하지 않는다).
- 핸들러 함수는 동사_목적어 스네이크(`add_watchlist_stock`, `promote_to_holdings`, `set_rebalance_targets`).
- 서비스 함수: 읽기 `get_*`, 저장 `save_*`/`replace_*`/`upsert_*`, 외부 수집 `fetch_*`/`_fetch_*`, 캐시 무효화 `invalidate_*`, 기동 시드 `_seed_*_if_empty`, 계산 `calc_*`/`evaluate_*`/`_build_*`.
- 배치: `backend/services/batch_registry.py`의 `BATCHES[].id` 문자열이 **스케줄러 잡 id 및 `services.job_runs.record(id, trigger)` 호출 id와 동일**해야 한다(`daily_report_kr`, `macro_signals_fetch`).
- 시장 분기 접미사는 `_kr`/`_us`(`_generate_kr`, `earnings_us`, `_kr_basic_kis`).

### 3.2 프론트엔드
- 페이지 `frontend/src/pages/<Pascal>.jsx`, 컴포넌트 `frontend/src/components/**/<Pascal>.jsx`(도메인 폴더 `market/`·`portfolio/`·`reports/`·`recommendations/`·`ui/`), 재사용 프리미티브는 `components/ui/`에 모으고 `components/ui/index.js`가 배럴 export.
- 훅 `frontend/src/hooks/use<Pascal>.js`, 기본 export 함수명 = 파일명.
- 유틸 `frontend/src/utils/<camel>.js`, JSX를 포함한 유틸은 `.jsx`(`components/market/marketUtils.jsx`, `components/reports/reportUtils.jsx`).
- **하위탭 목록은 두 곳에 이원화**: 모바일 seg nav `frontend/src/pages/ResearchShell.jsx`의 `RESEARCH_TABS`/`SCHEDULE_TABS`, PC 마스트헤드 `frontend/src/components/Masthead.jsx`의 `SECTIONS[].items`. 탭 추가·개명·삭제는 **항상 쌍으로**(`grep -rn "RESEARCH_TABS\|SECTIONS" frontend/src/`).
- 라이브 프로브용 셀렉터는 `data-testid="kebab-case"`(현재 8종·4파일 — 프로브가 재는 요소에만 부여).

---

## 4. 로깅 방출 규약

### 4.1 백엔드
- 모듈 상단에 `logger = logging.getLogger(__name__)`를 두고 그것만 쓴다. **앱 코드 `print()` 신규 금지** — `backend/tests/test_no_print.py`가 ast로 `main.py`·`routers/`·`services/`·`scheduler/`·`middleware/`를 훑어 0건을 단언한다(`tests/`·`scripts/`·`data/`는 대상 외).
- 루트 로거는 `backend/main.py:_configure_logging()`이 기동 시 1회 배선한다:
  `basicConfig(level=INFO, format="%(levelname)s %(name)s: %(message)s")` + `urllib3`/`yfinance`/`apscheduler`/`asyncio`를 WARNING으로 억제 + `uvicorn`/`uvicorn.error`/`uvicorn.access`의 `propagate=False`(root 핸들러 중복 emit 방지). **이 배선이 없으면 root lastResort가 WARNING+만 내보내 `logger.info`가 `docker logs`에 안 뜬다.**
- 포맷: `logger.<level>(f"[Component] <무엇> (<식별자>): {e}")`.
  - `[Component]`는 PascalCase **개념명**이고 개념당 1스펠링을 유지한다. 포매터에 프리픽스가 없으므로 메시지 안의 이 마커가 유일한 grep 앵커다.
  - 실제 사용 마커 예: `[Scheduler]`(가장 많음), `[Report]`, `[Migrate]`, `[Cache]`, `[FX]`, `[Digest]`, `[Funnel]`, `[Financials]`, `[Backlog]`, `[Consensus]`, `[Dividends]`, `[KrSector]`, `[KISQuote]`, `[AGM]`.
- 레벨 의미:
  - `warning` — graceful degrade 담화(외부 fetch 실패·직전값 폴백·박제 스킵·마이그레이션 실패). 압도적 다수.
  - `error` — 예상치 못함/데이터 손실. 아껴 쓴다.
  - `info` — 배치·라이프사이클(잡 시작/완료·시드 적재).
- **삼킴 금지**: 외부 IO를 `except: pass`로 감싸면 기능이 조용히 꺼진다. 최소한 warning을 남긴다 — 예 `backend/services/market_indicators/fx.py:75` `logger.warning(f"[FX] 갱신 실패, 직전 저장값 유지: {failed}")`.

### 4.2 프론트엔드
- `console.warn` = graceful(부가 조회 실패 → 섹션 숨김/폴백), `console.error` = 예상외(쓰기 실패 등). 현재 warn 13·error 7.
- 마커는 백엔드의 개념명이 아니라 **소스 모듈/훅 실명**: `[usePortfolioData]`, `[useReportList]`, `[Reports]`, `[AnalystReports]`, `[AdminAnalytics]`, `[PermissionPanel]`, `[GuruDetail]`.
- 형식 `console.warn('[모듈] <무엇>(<엔드포인트>) 실패', e)`.
- 자동 가드 없음(eslint에 연결돼 있지 않다) — 규약 준수는 리뷰 몫.
- 예외: 폴링처럼 다음 틱에 자연 복구되는 루프는 의도적으로 무음(`hooks/usePortfolioData.js:71` `catch {}` + 이유 주석). 무음으로 둘 땐 **이유를 주석으로 남긴다**.

---

## 5. 반복 패턴

### 5.1 엔드포인트 정의 · 의존성 주입 · auth 게이팅
표준형(`backend/routers/watchlist.py`가 교과서):
```python
router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])

class WatchlistStock(BaseModel):
    ticker: str
    @field_validator("ticker")
    @classmethod
    def _validate_ticker(cls, v: str) -> str: ...   # services.utils.is_valid_ticker

@router.post("", status_code=201)
def add_watchlist_stock(stock: WatchlistStock, background_tasks: BackgroundTasks,
                        user_id: str = Depends(get_current_user)):
```
- `user_id: str = Depends(...)`가 **마지막 파라미터** 관례.
- 인증 의존성 4종(`backend/auth.py`): `get_current_user`(JWT Bearer) · `get_current_user_or_api_key`(JWT 또는 `X-API-Key` = Cowork) · `require_admin`(admin JWT 전용, **API 키를 거부**) · `require_admin_or_api_key`. 무인증 허용은 `routers/auth.py`의 로그인/OAuth 9개뿐(ADR-0029; `backend/tests/test_no_public_reads.py`가 exact-match로 고정).
- bare `list`/`dict`/`Dict[...]` 본문은 **`Body(...)` 명시 필수**(`routers/report.py:582`, `routers/batches.py:77`, `routers/portfolio.py:168`·`325`의 `Body(..., embed=True)`).
- 라우트 등록 순서: 정적 경로가 path-param 경로보다 먼저(`PUT /api/stocks/enrich/batch` → `PUT /api/stocks/{ticker}/enrich`).
- 티커는 응답·저장에서 `.upper()` 정규화.
- 오래 걸리는 후처리는 `BackgroundTasks`로 밀어낸다(`watchlist._generate_with_consensus`).
- 쓰기 후 캐시 무효화: `cache_svc.invalidate_portfolio_caches(user_id)`(dashboard/correlation/sector/macro/list/calendar 일괄).

### 5.2 서비스의 외부 fetch + 캐시 폴백 관용구
2계층 캐시가 표준이다.
- **프로세스 인메모리**: `backend/services/cache.py`의 `TTLCache` — snapshot(LRU 50)·list(60s)·dashboard/correlation/sector/macro/rebalance/exposure(300s)·quote(60s)·live_prices(15s). API는 `get_<X>(user_id, loader)` + `invalidate_<X>(user_id=None)` 쌍.
- **DB 영구 캐시**: `backend/services/market_indicators/cache.py` — `_get_cache/_set_cache`(TTL) → `_mc_load/_mc_save`(PostgreSQL `market_cache`) → 라이브 fetch. 증분 병합은 `_merge_history`·`_yf_close_history`(마지막 날짜 이후만 조회) + `_filter_outliers`.
- `get_or_refresh(key, fetch_fn, ttl)`는 "**저장값이 있으면 fetch를 스킵**"만 한다 — fetch 실패 시 직전값 폴백은 하지 않는다(실패를 전파). 취약한 소스는 **수동 폴백**을 쓴다(`market_indicators/fx.py:get_vix`):
  1. `_get_cache` 히트면 반환 → 2. `_mc_load`로 직전값 확보 → 3. try fetch → 성공 시 `_mc_save`+`_set_cache`+반환 → 4. 실패 시 직전값 반환(없으면 `None`/빈 dict).
- **빈/all-None 결과를 캐시에 박제하지 않는다**: `market_indicators/indices.py:143` `if any(v is not None for v in indices.values()): _mc_save(...)`. 외부 API가 예외 없이 성공응답+빈 output을 줄 수 있으므로 **예외뿐 아니라 값 수준**을 가드한다.
- delete-rewrite(replace) store는 fetch 실패 시 **delete 자체를 스킵**하고 delete+insert를 단일 트랜잭션으로(`services/dividends.py:replace_schedule`).
- 병렬 fetch는 `ThreadPoolExecutor` + `services/parallel.py`, 동시성은 DB 풀(maxconn 20) 이하로.

### 5.3 DB 접근
- `backend/services/db.py`의 `query`/`execute`/`execute_many`만 사용(`ThreadedConnectionPool(minconn=1, maxconn=20)`, `get_connection()` 컨텍스트 매니저가 commit/rollback/putconn). 생 SQL + `%s` 파라미터 바인딩, ORM 없음.
- 업서트는 `INSERT ... ON CONFLICT (...) DO UPDATE SET`(미언급 컬럼 보존이 필요하면 DELETE+INSERT 대신 이걸 쓴다 — `routers/watchlist.py:169` 주석).
- uuid 컬럼 배열 조건은 `= ANY(%s::uuid[])`로 **캐스트를 명시**(str 리스트는 text[]가 된다). `VALUES` 행 나열은 바깥 괄호 없이 `(a,b), (c,d)`.
- **신규 컬럼/테이블은 두 파일 쌍**: `backend/app_schema.sql`(신규 설치용) + `backend/main.py:_migrate()`의 `ADD COLUMN IF NOT EXISTS`/`CREATE TABLE IF NOT EXISTS`(라이브 DB는 기동 idempotent 마이그레이션만 탄다, ADR-0006). 각 DDL은 개별 `try/except` + `logger.warning(f"[Migrate] ...")`.

### 5.4 프론트 데이터 페칭 훅
`frontend/src/hooks/usePortfolioData.js`가 표준형이다.
- 상태(`useState`) + fetch 함수(`useCallback`)를 훅에 모아 객체로 반환(`{ stocks, dashboardCards, dashboardLoading, dashboardError, fetchAll, fetchDashboard, refreshLivePrices }`). 페이지는 훅을 조합만 한다.
- 모든 fetch를 `try/catch`(또는 `.catch()`)로 감싸 **부가 섹션 실패가 페이지를 죽이지 않게** 하고 `console.warn` 마커 로그를 남긴다. 실패를 상태로도 노출(`dashboardError`)해 화면이 "빈 상태"와 "로딩 스켈레톤"을 구분할 수 있게 한다.
- 로딩 플래그는 `finally`에서 내린다.
- 폴링은 `setInterval` + `document.hidden` 가드 + 장시간 분기(`utils/marketHours.js`의 `isKrMarketOpen`/`isUsMarketOpen`), 15초 베이스에 US는 4틱마다.
- 훅 간 관심사 분리: 목록/시세 `usePortfolioData`, 종목 CRUD `useStockManagement`, 리포트 목록/필터 `useReportList`·`useReportFilters`, 생성 `useReportGeneration`.

### 5.5 액션 버튼 단일 소스
리포트 카드/사이드바의 관리 버튼(수정·승격·삭제)은 `frontend/src/components/reports/StockActions.jsx` 한 곳에만 있고 `layout="card"|"list"` prop으로 분기한다(`StockCard.jsx`·`TickerListItem.jsx`가 공유). 가시성 게이트는 `is_mine` 기준.

---

## 6. 에러 처리

- 도메인 HTTP 에러는 `backend/services/errors.py`의 팩토리를 `raise`: `errors.not_found(ticker, "watchlist")`(404) / `errors.already_exists(ticker, "holdings")`(400). 그 밖은 `HTTPException(status_code=..., detail="<한국어 또는 영문 메시지>")`.
- 422 검증 에러는 `backend/main.py:253`의 커스텀 `RequestValidationError` 핸들러가 처리 — detail을 `sanitize(jsonable_encoder(exc.errors()))`로 감싸 입력 NaN echo로 인한 500을 앱 전역에서 막는다.
- **부분 실패는 500이 아니라 graceful degrade**: `routers/stocks.py:_build_all`은 일괄시세 try/except + 카드당 `_safe`→최소카드 폴백으로 "holdings=N → 항상 N카드" 불변식을 지킨다. 배치 계측 `services/job_runs.record`는 관측 전용으로 본문을 절대 깨뜨리지 않는다(쓰기 실패 시 `run_id=None`으로 진행).
- **wrong < missing**: 외부 파싱/검증 실패 시 "안전한 기본값"을 넣지 말고 누락으로 둔다(pending/`None`, 박제 스킵) + loud warning 로그.
- 외부 소스 예외는 좁게 잡고, 삼킨 자리에는 이유를 남긴다(§4.1).

---

## 7. 수치·시간 안전 관례

- **출력 NaN/inf 금지** — starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 NaN/inf가 있으면 500. 두 겹으로 막는다: ① 소스에서 `math.isfinite` 가드(`market_indicators/indices.py`, `_usdkrw_rate`) ② 응답 반환을 `services.utils.sanitize()`로 감싸 NaN/inf→None(`routers/portfolio.py:131`·`164`·`208`, `routers/stocks.py:317`·`673`, `routers/analyst_reports.py`).
- **입력 NaN 금지** — Pydantic v2 float은 기본 `allow_inf_nan=True`이므로 필드에 명시한다: `Field(..., allow_inf_nan=False)`(`routers/analyst_reports.py:29`·`42`·`43`). NaN 비교는 항상 False이므로 범위 검증 전에 배제.
- **Decimal/float 혼합 금지** — DB NUMERIC(`avg_cost`, `quantity`, `beta`)은 psycopg2가 Decimal로 준다. 외부 float(배당 등)과 산술하기 전 양변을 `float()`로 정규화(`routers/stocks.py:549-551`).
- **퍼센트 스케일** — yfinance의 `shortPercentOfFloat`·`pctHeld`·`dividendYield` 등은 소수분수(0.0098 = 0.98%). 표시 시 ×100, 문서·fixture 예시값도 분수로 적는다.
- **KR 시장-날짜는 `services.utils.today_kst()`** — 컨테이너가 UTC라 bare `date.today()`/`datetime.today()`는 00~09시 KST에 하루 어긋난다. `backend/tests/test_no_bare_today.py`가 ast로 앱 코드 0건을 단언.
- **tz 정렬** — 키움 일봉(tz-naive) ↔ yfinance(tz-aware)를 `pd.concat`하기 전에 한쪽을 `tz_localize(None)`.
- **yfinance 심볼 정규화** — `backend/services/market/format.py:_yf_sym(ticker, market, exchange)`(KR은 `.KS`/`.KQ` 접미사, US는 `.`→`-`). raw ticker로 `yf.Ticker`를 호출하면 KR이 통째 0건.
- **금액 포맷** — 억/조는 `frontend/src/components/market/marketUtils.jsx`의 `krFmt`(입력 단위 **억원** 가정; 원은 `/1e8` 후 전달). 주(count) 등 다른 단위엔 전용 포매터.

---

## 8. 문서 동기화 DoD

한 PR에서 코드와 함께 갱신해야 하는 문서들:

| 변경 | 갱신 대상 | 자동 검출 |
|------|-----------|-----------|
| 엔드포인트 추가/삭제/개명 | `API_SPEC.md`(전체 REST 정본) | `backend/tests/test_api_doc_sync.py` — 라이브 `app.routes` ↔ `### \`METHOD /path\`` 헤더 exact-match(현재 `KNOWN_UNDOCUMENTED = frozenset()`) |
| Cowork(enrich/backlog) 소비 대상 엔드포인트 | `CLAUDE_COWORK_API.md`도 함께 | stale 문서화만 검출 |
| 요청/응답 스키마·인증 게이팅 산문 | 위 문서의 해당 절 | **없음(수동 DoD)** — 인증을 바꾸면 착수 시 `grep -n '\*\*Auth:\*\* 불필요' API_SPEC.md` |
| 화면 구성·env 키·기술 스택·아키텍처(router/service/table)·배치 | `README.md` 해당 절(overview 수준, 엔드포인트 세부 중복 금지) | 없음 |
| 배치 추가/은퇴/출처 변경 | `backend/services/batch_registry.py`의 `source`(fetch 출처)·`usage`(소비 UI)·`market`·`default_schedule` | `test_batches_router.py`·`test_batch_market_split.py`·`test_macro_signals_batch.py`가 id 집합/개수 단언 |
| 결정·회고 | `.forge/adr/`·`.forge/retro/` | 없음 |
| 키움/KIS API 표면 | `KIWOOM_API.md`/`KIS_API.md` | 없음 |

- **비밀값은 문서·코드·테스트에 넣지 않는다.** 환경변수는 **이름만** 문서화하고 값은 `backend/.env.docker`(gitignored)와 루트 `.env`에 둔다. 사용 중인 키 이름: `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, `COWORK_API_KEY`, `FRONTEND_URL`, `FRED_API_KEY`, `KOFIA_API_KEY`, `DART_API_KEY`, `KITA_API_KEY`, `KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`, `KIS_APP_KEY`/`KIS_APP_SECRET`/`KIS_BASE_URL`, `VITE_API_BASE_URL`.
- 키 미설정이 **안전 기본값**이어야 한다(`configured()`가 False면 그 소스는 휴면하고 기존 동작 무변화 — `services/kis/client.py` 패턴).
- **비-additive 응답 변경**(배열→객체 등)은 `grep -rn '<엔드포인트 경로>' frontend/src/`로 소비처를 전수 감사한다(독립 fetcher가 있다). 가능하면 additive를 선호.

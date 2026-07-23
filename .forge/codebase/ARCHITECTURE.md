---
last_mapped_commit: 44629f27cfb796dbd2120b7002a99e3d82f7c725
mapped: 2026-07-24
---

# ARCHITECTURE

PortfoliOn은 FastAPI(백엔드, port 8000) + React 19/Vite(프론트, port 5173) 2-티어다.
Mac 로컬 Docker 4-컨테이너(nginx·backend·postgres·certbot)로 배포되며 저장소는 Docker PostgreSQL이다.

## 1. 백엔드 레이어

`backend/routers/`(HTTP 표면) → `backend/services/`(도메인 로직) → `services/db.py`(PostgreSQL) 3계층.
라우터는 얇고, 도메인 로직은 서비스에, DB 접근은 `services/db.py`의 `query`/`execute`/`get_connection`로 단일화한다.

### 엔트리포인트 — `backend/main.py` (259줄)

- `_configure_logging()` (16–25): 루트 로거 1회 배선. `basicConfig(level=INFO)` + urllib3/yfinance/apscheduler/asyncio를 WARNING으로 억제 + uvicorn 로거 `propagate=False`(중복 emit 방지). **모듈 최상단에서 즉시 호출**(28) — config 부재 시 root lastResort가 WARNING+만 내보내 `logger.info`가 docker logs에 안 뜨는 문제 해소.
- `_migrate()` (57–212): 기동 시 idempotent 추가 마이그레이션. 전부 `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`이며 각 블록이 개별 try/except로 warning 로깅(한 마이그레이션 실패가 다른 것을 막지 않음). `app_schema.sql`(신규 설치용)과 **쌍으로** 유지해야 함 — 라이브 DB는 이 마이그레이션만 탄다.
- `lifespan()` (215–221): `_migrate()` → `sched.start()` → `_warm_market_cache()`를 daemon 스레드로 → (종료 시) `sched.stop()`.
- `app = FastAPI(..., lifespan=lifespan)` (224): 미들웨어 `SessionMiddleware`(OAuth 세션)·`EventTrackerMiddleware`(사용자 행동 로그)·`CORSMiddleware`(localhost:3000/5173 + `FRONTEND_URL`) 등록.
- `include_router` 18개 (237–254): auth·portfolio·report·watchlist·stocks·guru·calendar·digest·market_indicators·analytics·analysis·events·rankings·investor·short_sell·batches·recommendations·admin.
- `_warm_market_cache()` (48–54): FRED 경제지표·KR 수출을 기동 시 미리 채움(graceful).

### 라우터 (`backend/routers/`, 19개)

`portfolio.py`·`watchlist.py`·`stocks.py`(보유/관심/종목마스터·대시보드·enrich), `report.py`(리포트 목록·상세·backlog·disclosures·agm·analyst refresh), `calendar.py`·`digest.py`, `market_indicators.py`(FX/VIX/원자재/국채/경제/M7/KR수출/macro-signals/indices/futures/sentiment), `analysis.py`(섹터 모멘텀·매크로 상관), `analytics.py`(상관관계), `rankings.py`·`investor.py`·`short_sell.py`(수급/랭킹), `recommendations.py`(추천), `guru.py`, `auth.py`, `admin.py`(교차사용자 admin 동작·권한), `events.py`(행동로그), `batches.py`(배치 현황).

### 서비스 (`backend/services/`)

패키지로 분리된 큰 도메인:
- `storage/` — 앱 데이터 CRUD 패키지(`portfolio.py`·`names.py`·`schedule.py`·`dates.py`). `__init__.py`가 전 심볼을 루트로 re-export(외부는 `storage.X` 모듈속성 조회, ADR-0017). `services.db`의 `query`/`execute`/`get_connection`도 표면 보존 re-export.
- `market/` — 시세/재무 패키지(`format.py` 포맷·심볼 헬퍼, `kr.py` 키움→KIS→Naver 체인·DART 재무, `us.py` yfinance→KIS). `__init__.py`가 서브모듈 심볼을 루트로 re-export.
- `market_indicators/` — 시장지표 패키지. `cache.py`(`_mc_load`/`_mc_save`로 `market_cache` 읽기/쓰기), `fx.py`·`commodities.py`·`earnings.py`·`econ.py`·`exports.py`·`macro.py`·`indices.py`·`kospi_signal.py`·`kospi_futures.py`·`sentiment.py`. 각 서브모듈이 `_merge_history`/`_yf_close_history`로 yfinance 증분 fetch.
- `kiwoom/` — 키움 REST(KR 읽기전용 시세). `client.py`(토큰·`request`), `quote.py`·`chart.py`·`sector.py`·`investor.py`·`shortsell.py` (조회 TR만, ADR-0009).
- `kis/` — 한국투자증권 REST(KR+US 백업 시세). `client.py`·`quote.py`·`futures.py` (ADR-0011).
- `recommendation/` — 추천 엔진(ADR-0015). `universe.py`·`scoring.py`·`funnel.py`·`store.py`·`actions.py`. 배치가 점수 사전계산→`stock_recommendations` 저장, 요청은 저장값만 read. **LLM 0**.

단일 모듈 서비스: `report_generator.py`(시장 데이터 스냅샷 생성 — **LLM 호출 없음**), `consensus.py`(목표가·의견수 as-of read, ADR-0008)·`consensus_pipeline.py`(opinion→5점 표준화 저장), `scraper.py`(guru 웹크롤), `cache.py`(인메모리 캐시 6종), `db.py`(ThreadedConnectionPool), `job_runs.py`(배치 실행로그 job_id별 최근 20건), `batch_registry.py`(배치 메타 정본), `digest_service.py`, `analysis_service.py`, `auth_service.py`, `dividends.py`·`backlog.py`·`disclosures.py`·`agm.py`·`insider_trades.py`·`beta.py`·`leverage_service.py`·`lending_service.py`·`short_sell_service.py`·`investor_service.py`·`ranking_service.py`·`kr_sector_service.py`·`us_sector_service.py`·`us_supply.py`·`supply_score.py`·`exposure.py`·`rebalance.py`·`guru_scraper.py`·`guru_stats.py`, `utils.py`(NaN/inf sanitize·`today_kst`), `errors.py`·`parallel.py`·`progress.py`·`schedule_spec.py`·`indicators.py`.

### 스케줄러 패키지 (`backend/scheduler/`)

APScheduler(`AsyncIOScheduler`) 설정 **루트 레벨 패키지**(services 아님):
- `_state.py` — 공유 `_scheduler` 인스턴스·상수(`_DIGEST_JOB_ID`·`_VALID_DAYS`). leaf 모듈(순환 회피).
- `jobs.py` — 잡 함수 전체(`_generate_kr`/`_generate_us`/`_run_digest`/`_fetch_*` 등)와 `_JOB_FUNCS`(job_id→함수 매핑) 딕셔너리. `_seed_*_if_empty`(기동 시 빈 캐시 시드).
- `schedule.py` — `_build_trigger`(CronTrigger)·`_reschedule_job`·`_seed_batch_schedules`·`_check_missed_report`(시장별 누락복구). `misfire_grace_time` None 주입 금지(APScheduler가 무제한으로 해석).
- `__init__.py` — 위 심볼을 명시 re-export + `start()`/`stop()`/`reload(job_id)` 공개 API. `start()`는 시드→편집가능 배치 리스케줄→누락복구→시드 순.

### 배치 레지스트리 (`backend/services/batch_registry.py`)

배치 현황 허브가 노출하는 배치들의 정적 메타(`BATCHES` 리스트, 각 `id`/`label`/`category`/`source`/`usage`/`editable`/`market`/`default_schedule` 등). `id`는 스케줄러 잡 id 및 `job_runs.record(id, ...)` 호출 id와 **반드시 일치**. `source`=데이터 fetch 출처, `usage`=소비 UI(반대 방향). daily_report는 시장별 `daily_report_kr`/`daily_report_us` 분리, 실적·월간도 `earnings_kr`/`earnings_us`·`monthly_kr`/`monthly_us` 분리(ADR-0012/0013).

## 2. 프론트엔드 레이어

React 19 + Vite(rolldown 번들러) + plain CSS(no Tailwind). 데이터는 `frontend/src/api.js`(axios 인스턴스, `access_token` Bearer 자동 주입·401 시 토큰 제거).

### 엔트리포인트 — `frontend/src/App.jsx`

- `App()`: 테마(`useTheme`)·세션 부트스트랩. `useEffect`가 URL의 `oauth`/`token`/`refresh` 파라미터를 처리(OAuth 콜백·토큰 저장). 세션 없으면 `<LoginPage />`, 있으면 `ToastProvider` → `AuthProvider` → `BrowserRouter` → `AppShell`.
- `AppShell({theme,setTheme,setSession})`: `Masthead`(PC 좌측 사이드바 nav) + 모바일 헤더(브랜드·GlobalSearch·MobileTopActions·테마토글·로그아웃) + `<main class="page-wrap">` + `MobileNav`(하단). 라우트 전환 페이드는 `key={location.pathname}`의 `.anim-fade`(transform 없는 fade만 — fixed 자손 컨테이닝 블록 함정, task#195).
- `<Routes>`: `REDIRECTS`(routes.js) 리다이렉트 → 리서치 7라우트(ResearchShell 래핑)·portfolio·market 2탭·guru·settings·admin-analytics·dev/showcase.
- `ReportsRoute()`: 리포트 상세 딥링크(`location.state.ticker`)를 같은 라우트 재네비게이션에도 반영(task#131).

### 라우트 맵 — `frontend/src/routes.js`

`REDIRECTS` 배열: 구 URL→신규 라우트(`/`→`/reports`, `/research`→`/reports`, `/market`→`/market/indicators`, `/analysis`→`/portfolio`). App.jsx와 `route-redirects` 테스트가 공유(ADR-0025).

### 페이지 허브 (`frontend/src/pages/`)

- **Research 허브** = `ResearchShell.jsx`가 children을 감싸는 얇은 래퍼. PC는 Masthead가 nav 담당(래퍼는 children만 렌더), 모바일은 seg 필 nav(리서치: 리포트/추천/랭킹/비교, 일정·인컴: 캘린더/배당/다이제스트 — 경로별 groupLabel 분리, ADR-0026/task#178). 실 탭 컴포넌트: `Reports`·`Recommendations`·`Ranking`·`Compare`·`Calendar`·`Dividends`·`Digest`.
- **MarketHub.jsx** = 시장지표/수급지표 2탭(`/market/indicators`·`/market/flow`), 내부는 `Market.jsx`를 `tab` prop으로 렌더.
- **Portfolio.jsx** = 대시보드·분석 전용(독립 라우트, 허브 아님).
- 기타: `Guru`·`Settings`·`AdminAnalytics`(admin)·`Showcase`(dev). 탭용 서브페이지: `SectorTab`·`MacroTab`·`ExposureTab`·`RebalanceTab`·`ReportManualGen`·`GuruCrawlNow`·`GuruManagers`·`GuruStats`·`ConsensusSettings`·`LeverageBackfillSettings`.

### 컴포넌트 / 훅 / 컨텍스트

- `components/` — 도메인별 서브폴더(`ui/`·`reports/`·`market/`·`portfolio/`·`recommendations/`·`sketches/`) + 공용(Masthead·MobileNav·GlobalSearch·StockModal·PromoteModal·Toast·Permission* 등).
- `hooks/` — 데이터 훅(`usePortfolioData`·`useStockManagement`·`useReportList`·`useReportFilters`·`useReportGeneration`), UI 훅(`useTheme`·`useIsMobile`·`useReveal`·`useCountUp`·`usePriceFlash`·`useBodyScrollLock`), `useAuth`(AuthContext re-export).
- `contexts/AuthContext.jsx` — `AuthProvider`가 로그인 시 `GET /api/auth/me`로 `role`·`menu_permissions` 로드. Masthead가 `menuPermissions`로 nav 섹션 필터링.

### 좌측 사이드바 nav 5섹션 — `components/Masthead.jsx`

`SECTIONS`: research(리포트/추천/랭킹/비교)·portfolio·market(시장지표/수급지표)·schedule=일정·인컴(캘린더/배당/다이제스트)·guru. 각 섹션은 `perm`으로 게이트(AuthContext `menuPermissions`와 대조). admin은 설정·행동 링크 추가.

## 3. 데이터 흐름 (핵심 패턴)

**배치 사전계산 → 요청은 저장값 read.** 외부 API(키움·yfinance·FRED·DART·KOFIA 등) fetch는 스케줄러 배치가 수행해 `market_cache` 또는 전용 테이블(`stock_recommendations`·`market_leverage_indicators`·`stock_dividends` 등)에 저장하고, 요청 경로는 저장값만 읽는다(요청당 라이브 fetch 회피 — 지연·rate-limit 방지). 예: `rankings` 라우터→`ranking_service.read_rankings`(저장값), 추천→`recommendation.read_recommendations`(저장값), market_indicators GET→`_mc_load`(저장값).

- 시장지표 일부(fx/vix/commodities/indices/futures)는 **요청경로 증분** 패턴(TTL 캐시→`_mc_load`→라이브 fetch→`_mc_save`+폴백)이라 배치 미등록.
- 외부 fetch 실패/빈응답은 **직전 저장값 폴백**(wrong<missing) — 빈/all-None을 캐시에 박제 금지.
- 인메모리 캐시(`cache.py`): snapshot(LRU 200)·list(TTL 5s)·dashboard/correlation/sector/macro(TTL 300s). 종목 변경 시 자동 무효화.

**enrich = 외부 Cowork가 AI 텍스트 작성.** 백엔드 `report_generator`는 시장 데이터 스냅샷만 만든다 — **백엔드에 LLM/Anthropic 호출 없음**(`requirements.txt`에 anthropic 없음). AI 분석 텍스트는 외부 Claude Cowork 클라이언트가 enrich API(`CLAUDE_COWORK_API.md`)로 `tickers` 테이블 컬럼에 기록한다(`enriched_at` 정본=`tickers` 컬럼).

## 4. 저장소

Docker PostgreSQL이 기본. 스키마 `auth_schema.sql`(users·refresh_tokens) → `app_schema.sql`(tickers·user_stocks·snapshots·schedules·guru_*·digests·consensus_history·calendar_cache·market_cache·user_menu_permissions·user_events·market_leverage_indicators·market_lending_balance 등) 순. 로컬 JSON 파일(`backend/data/consensus/`)은 런타임 캐시 용도.

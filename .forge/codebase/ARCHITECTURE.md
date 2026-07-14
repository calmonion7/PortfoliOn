---
last_mapped_commit: 8e37e2ca03c09e76a31dd227d4c252f19246a11a
mapped: 2026-07-14
---

# ARCHITECTURE

PortfoliOn은 **FastAPI 백엔드 + React SPA 프론트엔드**의 2티어 구조이며, Mac 로컬 Docker 4-컨테이너(postgres/backend/nginx/certbot)로 배포된다. 백엔드는 고전적 **라우터 → 서비스 → DB/외부소스** 계층형이고, 배치 스케줄러가 별도 패키지로 상주해 외부 데이터를 사전계산해 DB에 적재한다. 프론트는 React Router 기반 SPA로, 요청은 전부 nginx `/api/*` 프록시를 거쳐 백엔드로 간다.

## 아키텍처 패턴 개요

- **패턴**: 계층형(Layered) + 배치 사전계산(precompute-to-store). 요청 경로는 저장값만 읽고(라이브 외부 호출 최소화), 스케줄러 배치가 외부 API를 호출해 DB/`market_cache`에 적재한다.
- **저장소**: Docker PostgreSQL 16이 정본. 로컬 JSON 파일은 런타임 캐시 용도(`backend/data/`).
- **인증**: HS256 JWT(access + refresh). 프론트는 localStorage 토큰을 axios 인터셉터로 실어 보내고, 백엔드는 `backend/auth.py`의 `Depends`(`get_current_user`/`require_admin`/`require_admin_or_api_key`)로 게이팅한다.
- **외부 데이터 소스**: yfinance, Naver, 키움(REST), KIS(한국투자증권 REST), DART, FRED, KOFIA/금융위, 관세청/UN Comtrade, dataroma, FnGuide/Finviz.

## Backend 계층

### 앱 엔트리 — `backend/main.py`

임포트 시점에 `_configure_logging()`(L16-28)이 루트 로거를 1회 배선한다: `basicConfig(level=INFO)` + urllib3/yfinance/apscheduler/asyncio를 WARNING으로 억제 + uvicorn 로거 `propagate=False`(중복 emit 방지). config 부재 시 `logger.info`가 docker logs에 안 뜨던 문제 해소용.

앱 객체는 `app = FastAPI(title=..., lifespan=lifespan)`(L214). `lifespan`(L205-211) 순서:
1. `_migrate()` — 기동 idempotent 마이그레이션. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` DDL만(신규 컬럼/테이블은 `app_schema.sql`과 이 함수 **쌍으로** 추가해야 라이브 반영).
2. `sched.start()` — 스케줄러 기동.
3. `_warm_market_cache()`를 데몬 스레드로(econ/kr_exports 예열).
4. (종료 시) `sched.stop()`.

미들웨어(L216-225): `SessionMiddleware`(SESSION_SECRET) → `EventTrackerMiddleware`(`backend/middleware/event_tracker.py`) → `CORSMiddleware`(origins: localhost:3000/5173 + `FRONTEND_URL`).

라우터 마운트(L227-244): `include_router`로 18개 라우터 등록(auth, portfolio, report, watchlist, stocks, guru, calendar, digest, market_indicators, analytics, analysis, events, rankings, investor, short_sell, batches, recommendations, admin). `/health`(L247) GET/HEAD.

### 라우터 계층 — `backend/routers/`

각 라우터는 `APIRouter(prefix=...)`로 접두사를 갖고, 서비스만 호출한다(비즈니스 로직·SQL은 서비스에 위임). 인증은 `from auth import ...` `Depends`로 주입.

| 파일 | prefix | 역할 |
|------|--------|------|
| `auth.py` | `/api/auth` | 로그인/OAuth/토큰 |
| `portfolio.py` | `/api/portfolio` | 보유 목록·헤더·`/prices` 라이브 시세 |
| `watchlist.py` | `/api/watchlist` | 관심 종목 CRUD |
| `stocks.py` | `/api/stocks` | 종목 추가/수정/삭제·`/dashboard`(대시보드 카드+totals)·enrich·배당·수급 |
| `report.py` | `/api` | 리포트 목록/상세/생성·수주잔고·공시·주총·US supply |
| `guru.py` | `/api/guru` | 구루 관리자·크롤·통계 |
| `calendar.py` | `/api` | 캘린더 이벤트(`calendar_cache`) |
| `digest.py` | `/api` | 일일 다이제스트 |
| `market_indicators.py` | `/api/market` | FX/VIX/원자재/국채/경제지표/실적/수출/매크로/지수/F&G/선물 |
| `analytics.py` | `/api/analytics` | 상관관계 등 분석 |
| `analysis.py` | `/api/analysis` | 섹터 모멘텀·매크로 상관 |
| `events.py` | `/api/events` | 사용자 행동 이벤트 수집 |
| `rankings.py` | `/api` | 거래대금/거래량/등락률 랭킹 |
| `investor.py` | `/api` | 수급 추이 |
| `short_sell.py` | `/api` | 공매도 추이 |
| `batches.py` | `/api` | 배치 현황(`GET /api/batches`)·스케줄 편집 |
| `recommendations.py` | `/api/recommendations` | 추천 점수(발굴 유니버스) |
| `admin.py` | `/api/admin` | 관리자 전용(권한·배치 refresh·교차 사용자 삭제) |

인증 의존성 정본: `backend/auth.py` — `get_current_user`(L18), `get_current_user_or_api_key`(L37), `require_admin`(L61), `require_admin_or_api_key`(L68).

### 서비스 계층 — `backend/services/`

핵심 인프라:
- `db.py` — `psycopg2` `ThreadedConnectionPool`(minconn=1, **maxconn=20** — calendar 15·analysis 11 워커 초과 대비, PoolError 방지). `get_connection()` 컨텍스트매니저(commit/rollback/putconn), `query()`(RealDictCursor → dict 리스트), `execute()`(rowcount), `execute_many()`(execute_batch).
- `cache.py` — `TTLCache` 클래스 + 스냅샷 LRU(`_snapshots`, MAX=50) + list/dashboard/correlation TTL 캐시. `invalidate(ticker)`가 스냅샷·list·dashboard·correlation·sector·macro를 일괄 무효화.
- `utils.py` — `sanitize`(NaN/inf→None, 직렬화 500 안전망), `today_kst`.
- `job_runs.py` — 배치 실행 이력 기록(`record(id, lane)` 컨텍스트매니저, `job_runs` 테이블).
- `parallel.py`·`progress.py`·`errors.py`·`schedule_spec.py`(cron trigger kwargs 빌드).

패키지형 서비스(ADR-0017 표면 보존 re-export):
- `storage/` — `__init__.py`가 `portfolio.py`(user_stocks·tickers·enrich)·`names.py`(종목명 dual-source 동기화)·`schedule.py`(스케줄·구루·batch_schedules)·`dates.py`(시장별 기대 리포트 날짜)를 re-export.
- `market/` — `__init__.py`가 `format.py`(정규화·`_yf_sym`)·`kr.py`(키움→KIS→Naver 시세 체인, 다수결 corroboration)·`us.py`(yfinance→KIS)를 re-export. `get_quote()`는 TTL 캐시(regular 키 포함).
- `market_indicators/` — `__init__.py`가 서브모듈 facade: `fx.py`·`commodities.py`·`earnings.py`·`econ.py`·`exports.py`·`macro.py`·`kospi_signal.py`·`indices.py`·`sentiment.py`(F&G)·`kospi_futures.py`·`cache.py`(`_mc_load`/`_mc_save` = `market_cache` 테이블 R/W).
- `kiwoom/` — 키움 REST(KR 읽기전용 시세): `client.py`(토큰·요청)·`quote.py`·`chart.py`·`investor.py`·`sector.py`·`shortsell.py`.
- `kis/` — 한국투자증권 REST(KR+US 백업 시세): `client.py`·`quote.py`·`futures.py`.
- `recommendation/` — `funnel.py`(2단 깔때기)·`scoring.py`·`store.py`·`universe.py`·`actions.py`.

리포트/데이터 서비스: `report_generator.py`(`generate_report`·`generate_report_with_retry`·`backfill_ticker` — 시장 데이터 스냅샷 생성, **LLM 호출 없음**), `consensus.py`·`consensus_pipeline.py`, `digest_service.py`, `backlog.py`·`backlog_parser.py`(DART document.xml), `disclosures.py`·`agm.py`(DART), `dividends.py`, `beta.py`, `insider_trades.py`·`us_supply.py`, `investor_service.py`·`short_sell_service.py`·`supply_score.py`, `ranking_service.py`·`kr_sector_service.py`·`us_sector_service.py`, `leverage_service.py`·`lending_service.py`(KOFIA/금융위), `analysis_service.py`, `exposure.py`·`rebalance.py`, `guru_scraper.py`·`guru_stats.py`·`scraper.py`, `indicators.py`, `auth_service.py`.

### 스케줄러 패키지 — `backend/scheduler/`

`services`가 아닌 **루트 레벨 패키지**(단일 `scheduler.py` 아님):
- `__init__.py` — 잡 배선 + `start()`/`stop()`/`reload()`. `start()`는 `_seed_batch_schedules()` → 편집 배치별 `_reschedule_job()` → `_check_missed_report()` → 랭킹·KR/US 섹터 시드 → `_scheduler.start()`. 서브모듈 심볼을 명시 re-export(외부가 `scheduler.X` 속성 조회).
- `jobs.py` — 배치 잡 함수 전체 + `_JOB_FUNCS`(job_id → 함수 dict, 28개). 각 함수는 `with job_runs.record(id, "auto")`로 감싸 실행 이력 기록. 외부 fetch 실패는 로깅(silent except 금지), all-None/빈 결과 박제 금지 패턴. ThreadPool은 `max_workers ≤ 8`(DB 풀 초과 방지).
- `schedule.py` — `_build_trigger`(APScheduler CronTrigger)·`_reschedule_job`·`_seed_spec_for`·`_seed_batch_schedules`(기동 idempotent 마이그레이션)·`_check_missed_report[_for]`(시장별 당일 미생성 리포트 복구).
- `_state.py` — 공유 `_scheduler`(APScheduler 인스턴스)·상수(`_DIGEST_JOB_ID`·`_VALID_DAYS`).

`backend/services/batch_registry.py` — `BATCHES` 리스트(29개 배치의 정적 메타데이터: id/label/category/schedule_desc/usage/source/editable/trigger_kinds/manual_endpoint/timezone/market/default_schedule). `job_id`는 스케줄러 잡 id 및 `job_runs.record` id와 일치. `consensus`는 자체 스케줄러 잡 없음(`daily_report_kr/us`에 내장, `scheduler_job_id=None`). 일일 리포트/실적/월간은 시장별 분리(`_kr`/`_us`). `get_batch(job_id)` 조회.

### 요청 → 캐시 → DB → 외부소스 흐름

1. **요청 경로**(사용자 화면): 라우터 → 서비스 → 인메모리 캐시(`cache.py` TTL/LRU) 히트 시 반환, 미스 시 → `db.py`(PostgreSQL) 저장값 read. 배치-백킹 뷰(랭킹·섹터 모멘텀 등)는 요청 경로에서 라이브 외부 호출을 하지 않고 저장값만 읽는다.
2. **라이브 시세**: `get_quote`/`get_quotes_batch`는 종목 TTL 캐시로 외부 호출을 상한. KR은 키움→KIS→Naver 체인 + 독립 피드 다수결(corroboration).
3. **배치 경로**(스케줄러): `jobs.py` 잡 → 서비스 fetch(외부 API) → `market_cache`/도메인 테이블에 적재(`_mc_save`/upsert/replace). 실패 시 직전 양호값 보존.
4. **직렬화 안전망**: 시세/합산을 응답에 싣는 엔드포인트는 `services.utils.sanitize` 또는 소스 `math.isfinite` 가드로 NaN/inf→None(starlette `allow_nan=False` 직렬화 500 방지).

## Frontend 계층

### 엔트리 & 라우팅 — `frontend/src/App.jsx`

`ToastProvider` → `AuthProvider` → `BrowserRouter` 중첩. 초기 `useEffect`가 URL의 OAuth `code`/`token`/`refresh`를 처리해 localStorage에 토큰 저장. 미로그인 시 `<LoginPage>`.

레이아웃: `Sidebar`(PC) + `MobileNav`(모바일) + util-bar(GlobalSearch·새로고침·테마·로그아웃). 라우트(L139-158):
- `/` → `/reports` 리다이렉트. `/reports`·`/recommend`·`/ranking`·`/compare`·`/calendar`·`/dividends`·`/digest`는 `<ResearchShell>`로 감싼다.
- `/portfolio`(단독), `/market` → `/market/indicators`, `/market/indicators`·`/market/flow` → `<MarketHub tab=...>`, `/analysis` → `/portfolio`, `/guru`, `/settings`, `/admin-analytics`, `/dev/showcase`.
- `ReportsRoute`(L44-51)는 `location.state.ticker` 딥링크를 `<Reports>`로 전달.

### 허브 & 셸

- `pages/ResearchShell.jsx` — 리서치 7하위 라우트 공용 얇은 래퍼. `RESEARCH_TABS`(리포트/추천/랭킹/비교) + `SCHEDULE_TABS`(캘린더/배당/다이제스트). 모바일은 seg 필 nav(현재 섹션 하위만 노출), PC는 사이드바가 nav 담당(필 숨김) + page-head. children으로 실제 탭 컴포넌트 렌더.
- `pages/MarketHub.jsx` — `tab`("indicators"/"flow") prop을 받아 `<Market tab=...>`를 렌더. 모바일 seg 2필(시장지표/수급지표).
- `components/Sidebar.jsx` — IA(ADR-0025) 5섹션(research/portfolio/market/schedule/guru), 섹션당 `perm` 1개. `useAuth().menuPermissions`로 nav 필터링, admin은 `/admin-analytics` 추가 노출.

### API 레이어 — `frontend/src/api.js`

axios 인스턴스(baseURL = `VITE_API_BASE_URL || ''`). 요청 인터셉터가 localStorage `access_token`을 `Authorization: Bearer`로 실음. 응답 인터셉터가 401 시 토큰 제거 + `/`로 리다이렉트.

### 훅 — `frontend/src/hooks/`

- `usePortfolioData.js` — `/api/portfolio`(목록) + `/api/portfolio/prices`(시세) + `/api/stocks/dashboard`(카드+totals) + `/api/market/fx` + `/api/digest/latest`. 장중 자동 폴링(15초 베이스, KR 개장 매 틱·US만 개장 매 4틱·숨김탭 휴지), 가격 플래시 틱.
- `useReportList.js` — `/api/report/list` + `/api/guru/stats/popularity`. 보유/관심 카운트·경고·미생성 종목 계산. `last_scheduled_date`는 `{KR, US}` 객체.
- 그 외: `useAuth.js`·`useIsMobile.js`·`usePriceFlash.js`·`useReportFilters.js`·`useReportGeneration.js`·`useStockManagement.js`·`useTheme.js`.

### 컴포넌트 — `frontend/src/components/`

도메인별 하위 디렉터리: `market/`(FxSection·VixSection·IndexSection·KospiFuturesSection·MacroSignalsSection 등 지표 섹션 + `marketUtils.jsx`), `reports/`(StockCard·TickerListItem·StockActions·ConsensusChart·FinancialsChart·ReportDetailTabs·각종 Section + `reportUtils.jsx`), `portfolio/`(DashboardCard·FlashValue·PriceFreshness), `ui/`(Badge·Button·Card·Stat·Input·Skeleton·SupplyBadge·InsiderBadge·icons + `index.js`), `recommendations/`(RecCard). 최상위: Sidebar·MobileNav·MobileTopActions·GlobalSearch·StockModal·PromoteModal·PermissionManager/Panel·Toast·InstallPrompt.

`contexts/AuthContext.jsx`가 로그인 시 메뉴 권한·role을 로드. `utils/`(analytics·marketHours·priceFlash·pwa), `styles/`(tokens.css·pc.css·mobile.css).

### 프론트 기술 스택

React 19 + react-router-dom 7 + axios + recharts. Vite 8(**rolldown** 번들러 — `manualChunks`는 함수형만). vite-plugin-pwa. 개발 시 Vite가 `/api/*`를 `localhost:8000`으로 프록시. 배포 시 nginx가 `frontend/dist`를 직접 서빙(`:ro` 볼륨).

## 배포 토폴로지

`docker-compose.yml` 4서비스: `postgres`(16-alpine, pgdata 볼륨, init SQL로 `auth_schema.sql`→`app_schema.sql`), `backend`(FastAPI 이미지, `.env.docker`), `nginx`(80/443, `frontend/dist` + `nginx.conf` + certbot 인증서 마운트), `certbot`(HTTPS 갱신 루프). Cloudflare Tunnel(cloudflared, launchd)이 외부 도메인을 localhost:80으로 연결. 자동 배포 = GitHub Actions self-hosted 러너(주) + 폴러(폴백).

---
last_mapped_commit: 1e8da3bc525d61545c6c374b1f91a04238dabf30
mapped: 2026-07-10
---

# STRUCTURE

디렉터리 레이아웃, 주요 파일 위치, 네이밍 규칙. 모든 경로는 리포지토리 루트 `/Users/calmonion/Project/PortfoliOn` 기준.

## 최상위

```
backend/          FastAPI 앱 (Python)
frontend/         React 19 + Vite (JS)
.forge/           forge 워크플로우 상태·ADR·retro·codebase 맵
API_SPEC.md       전체 REST API 레퍼런스 (엔드포인트 정본)
CLAUDE_COWORK_API.md  외부 Cowork용 enrich/backlog API
KIWOOM_API.md / KIS_API.md  키움·KIS API 카탈로그
README.md         프로젝트 overview
CLAUDE.md         프로젝트 지침
start.sh / start.bat / stop.sh / stop.bat   양 서버 기동/종료
deploy.sh         백엔드 컨테이너 재생성 스크립트
docker-compose.yml / nginx/ / certbot/      배포 스택
scripts/          배포 폴러·UAT/스크린샷 스크립트(Playwright)
```

## 백엔드 `backend/`

### 진입·설정
- `main.py` — FastAPI 앱. `_configure_logging()`(import 시 1회, 루트 로거 INFO 배선), `_migrate()`(기동 idempotent 마이그레이션), lifespan, 라우터 배선 18개.
- `auth.py` — 인증 헬퍼(get_current_user 등).
- `auth_schema.sql` → `app_schema.sql` — DB 스키마(auth 먼저 실행).
- `.env` / `.env.docker` — 환경변수(후자에 시크릿; POSTGRES_PASSWORD·JWT_SECRET·OAuth·FRED_API_KEY·KOFIA_API_KEY·KIWOOM/KIS 키·DART_API_KEY).
- `Dockerfile` / `Procfile` / `requirements.txt` / `pytest.ini`.
- `run_backfill.py` — 백필 스크립트.
- `migrations/` — 참조용 SQL 마이그레이션(`001_user_events.sql`, `002_backlog_history.sql`); 라이브 반영은 `main._migrate`가 담당.
- `middleware/` — `event_tracker.py`(EventTrackerMiddleware, user_events 로깅).

### `backend/routers/` (HTTP 엔드포인트, prefix `/api/...`)
`admin.py` `analysis.py` `analytics.py` `auth.py` `batches.py` `calendar.py` `digest.py` `events.py` `guru.py` `investor.py` `market_indicators.py` `portfolio.py` `rankings.py` `recommendations.py` `report.py` `short_sell.py` `stocks.py` `watchlist.py`

- `portfolio.py` — `/api/portfolio`. 포트폴리오 조회·CRUD·리밸런스·노출·배당(`GET /api/portfolio/dividends`). 리밸런스/노출은 `cache.get_rebalance`/`get_exposure` TTL 캐시 경유(task#166).
- `stocks.py` — `/api/stocks`. 대시보드 빌드(`_build_all`)·enrich·이름 백필. **주의: `PUT /api/stocks/enrich/batch`를 `PUT /api/stocks/{ticker}/enrich`보다 먼저 등록**.
- `report.py` — 리포트 목록/상세/생성, backlog/disclosures/agm refresh. 목록은 `cache.get_list(user_id, ...)` per-user 캐시.
- `calendar.py` — 캘린더 이벤트. 라이브 캐시 = **PostgreSQL `calendar_cache` 테이블**(user_id+month), `clear_cache(user_id)`가 DB 행 삭제. 파일 캐시는 task#167에서 제거됨. `_FOMC_DATES` 하드코딩(+`fomc_coverage_status` 소진 경고).

### `backend/services/` (비즈니스 로직)
루트 모듈:
`agm.py` `analysis_service.py` `auth_service.py` `backlog.py` `backlog_parser.py` `batch_registry.py` `beta.py` `cache.py` `consensus.py` `consensus_pipeline.py` `db.py` `digest_service.py` `disclosures.py` `dividends.py` `errors.py` `exposure.py` `guru_scraper.py` `guru_stats.py` `indicators.py` `insider_trades.py` `investor_service.py` `job_runs.py` `kr_sector_service.py` `lending_service.py` `leverage_service.py` `parallel.py` `progress.py` `ranking_service.py` `rebalance.py` `report_generator.py` `schedule_spec.py` `scraper.py` `short_sell_service.py` `supply_score.py` `us_sector_service.py` `us_supply.py` `utils.py`

- `cache.py` — 인메모리 캐시 10종(snapshot LRU 50 / list 60s per-user / dashboard·correlation·sector·macro·rebalance·exposure 300s / quote 60s / live_prices 15s) + `invalidate_portfolio_caches`.
- `utils.py` — `today_kst`(KST 날짜, bare `date.today()` 금지)·`sanitize`(NaN/inf→None)·티커 검증.
- `db.py` — psycopg2 `ThreadedConnectionPool`(minconn=1, maxconn=20), `query`/`execute` 헬퍼.
- `batch_registry.py` — `BATCHES` 29개 배치 정적 메타(id·market·source·usage·default_schedule).

서브패키지:
- `storage/` — `__init__.py`(전 심볼 re-export, ADR-0017), `portfolio.py`(get/save_stocks·holdings·watchlist·enrich), `names.py`(종목명 dual-source 동기), `schedule.py`(schedules·guru·batch_schedules), `dates.py`(expected_report_date 등).
- `market/` — `__init__.py`(get_quote·get_quotes_batch·get_history_df·resolve_name), `kr.py`(키움→KIS→Naver 체인·`_kr_pick_*` 다수결), `us.py`(yfinance→KIS), `format.py`(`_yf_sym`·정규화 헬퍼).
- `market_indicators/` — `cache.py`(`_mc_load`/`_mc_save` market_cache I/O), `fx.py`(FX+VIX) `commodities.py` `earnings.py` `econ.py` `exports.py` `macro.py`(FRED 매크로 신호) `indices.py`(지수 레벨+CAPE) `kospi_futures.py` `kospi_signal.py` `sentiment.py`(CNN Fear&Greed).
- `kiwoom/` — `client.py`(토큰·`integrated_code(regular)`·`request`), `quote.py`(ka10001), `chart.py`(일봉 ka10081), `sector.py`(업종), `investor.py`, `shortsell.py`. KR 전용 읽기전용(ADR-0009).
- `kis/` — `client.py`(토큰·`request`), `quote.py`(국내 FHKST01010100·해외), `futures.py`(국내선물 output1/2/3). KR+US 읽기전용 백업(ADR-0011).
- `recommendation/` — `universe.py`(시장 분리, task#166) `scoring.py` `funnel.py` `store.py`(stock_recommendations 저장/조회) `actions.py`. 배치 precompute→read(ADR-0015).

### `backend/scheduler/` (패키지, 단일 파일 아님)
- `__init__.py` — `start()`/`stop()`/`reload()`, 잡·심볼 배선·re-export.
- `jobs.py` — 잡 함수 실체(`_fetch_*`·`_generate_*`·`_refresh_*`·`_seed_*`), `_JOB_FUNCS`.
- `schedule.py` — 트리거 빌드·리스케줄·시드·누락복구(KST `ZoneInfo`).
- `_state.py` — 공유 `_scheduler` 인스턴스·상수.

### 데이터·스냅샷·테스트
- `data/` — 정적 참조(`sp500_tickers.json`·`kospi_tickers.json`) + 런타임 파일캐시(`consensus/`·`digest/`) + 레거시 JSON(`holdings.json`·`stocks.json`·`watchlist.json` 등). `data/calendar/`는 dead 잔존 디렉터리(task#167 이후 코드 미참조).
- `snapshots/` — per-ticker/date 리포트 JSON(gitignored).
- `reports/` — 레거시 리포트(read-only 폴백).
- `tests/` — pytest 스위트 124파일(`test_*.py` + `conftest.py` + `fixtures/`). 예: `test_api_doc_sync.py`(엔드포인트 문서 drift 검출), `test_scheduler_seed.py`·`test_batch_market_split.py`·`test_batches_router.py`(배치 count/set 단언), 가드 테스트 `test_no_print.py`(앱 코드 print 금지)·`test_no_bare_today.py`(bare date.today() 금지), `test_report_list_user_cache.py`·`test_calendar_cache_invalidation.py`.

## 프론트엔드 `frontend/src/`

### 진입·공통
- `main.jsx` — 앱 부트스트랩. `App.jsx` — 라우팅(`BrowserRouter`)·전역 nav·테마.
- `api.js` — axios 인스턴스(Bearer 토큰 인터셉터·401 리다이렉트). `utils.js` — 공통 유틸.
- `contexts/AuthContext.jsx` — 로그인·권한 상태.
- `styles/` — `tokens.css`(디자인 토큰; `--up`=빨강/`--down`=파랑 KR 색관례), `pc.css`, `mobile.css`.
- `utils/` — `analytics.js`(trackEvent), `marketHours.js`, `priceFlash.js`, `pwa.js`.
- `test/` — vitest 하니스(ADR-0019): `setup.js` `smoke.test.js` `recommendations-s3s4.test.jsx` `compare-race.test.jsx` `global-search-tracked.test.jsx`.

### `frontend/src/pages/` (허브 + 탭용 개별 페이지)
허브 3종: `Research.jsx`(홈), `Portfolio.jsx`, `MarketHub.jsx`(→ `Market.jsx`).
- Research 탭 컴포넌트: `Reports.jsx` `Recommendations.jsx` `Ranking.jsx` `Compare.jsx` `Digest.jsx` `Calendar.jsx` `Dividends.jsx`.
- Portfolio 분석 하위탭: `SectorTab.jsx` `MacroTab.jsx` `Analytics.jsx` `RebalanceTab.jsx` `ExposureTab.jsx`.
- Market 섹션 조립: `Market.jsx`가 시장지표/수급지표 2탭으로 `components/market/*Section`들을 조립.
- 그 외: `Settings.jsx` `Guru.jsx`(+`GuruCrawlNow.jsx`·`GuruManagers.jsx`·`GuruStats.jsx`) `ConsensusSettings.jsx` `LoginPage.jsx` `Showcase.jsx` `AdminAnalytics.jsx` `LeverageBackfillSettings.jsx` `ReportManualGen.jsx`.

### `frontend/src/components/`
- 루트: `StockModal.jsx` `PromoteModal.jsx` `PermissionManager.jsx` `PermissionPanel.jsx` `MobileNav.jsx` `Toast.jsx` `GlobalSearch.jsx` `StockSearchBox.jsx` `InstallPrompt.jsx` `LoadingSpinner.jsx` `BatchScheduleEditor.jsx`.
- `market/` — 시장지표 섹션 15종: `IndexSection` `KospiFuturesSection` `KospiSignalSection` `TreasurySection` `FxSection` `VixSection` `FearGreedSection` `CommoditiesSection` `EconIndicatorsSection` `MacroSignalsSection` `M7EarningsSection` `KrTop2Section` `KrExportsSection` `LeverageSection` `LendingSection` + `marketUtils.jsx`.
- `reports/` — `StockCard` `TickerListItem` `StockActions`(액션버튼 단일 소스, layout="card"|"list") `ReportDetailTabs`/`ReportDetailHeader` `DetailTab` `HistoryTab` `Sections` `ConsensusChart` `FinancialsChart` `BacklogChart` `SupplySection` `ShortSellSection` `InsiderTradesSection`/`UsInsiderSection` `InvestorTrendSection` `LatestDisclosuresSection` `GuruHoldersSection` `UsSupplySection` `ReportFilters` + `reportUtils.jsx`.
- `portfolio/` — `DashboardCard` `FlashValue` `PriceFreshness`(+ .css).
- `recommendations/` — `RecCard.jsx`.
- `ui/` — 원자 컴포넌트: `Badge` `Button` `Card` `Stat` `Input` `Skeleton` `SupplyBadge` `InsiderBadge` `icons.jsx` `index.js`. (의미 배지는 가격 토큰 미사용 전용 색.)

### `frontend/src/hooks/`
`usePortfolioData` `useReportList` `useReportFilters` `useReportGeneration` `useStockManagement` `useAuth` `useTheme` `useIsMobile` `usePriceFlash`. `.test.js`가 병치(vitest — `usePortfolioData.test.js`·`useReportFilters.test.js`·`useStockManagement.test.js`).

## 네이밍 규칙

- **백엔드**: 라우터 파일 = 리소스명(`portfolio.py`), 라우터 객체 `router = APIRouter(prefix="/api/...")`. 서비스 파일 = 도메인명(`dividends.py`). 배치 잡 함수는 `_fetch_*`/`_generate_*`/`_refresh_*`(스케줄러 private), `job_id`는 `<도메인>_<동작>`(예: `dividend_fetch`·`kr_rankings_fetch`) — `batch_registry.BATCHES[].id`·`job_runs.record(id)`와 3중 일치 필수.
- **로깅**: 모듈 상단 `logger = logging.getLogger(__name__)`, `print` 신규 금지. 포맷 `logger.x(f"[Component] <무엇> (<ids>): {e}")`, `[Component]`는 PascalCase 1스펠링(전체 규약 `.forge/codebase/CONVENTIONS.md` §4).
- **DB 테이블**: snake_case 복수/역할명(`user_stocks`·`stock_dividend_schedule`·`market_leverage_indicators`). 신규 컬럼은 `app_schema.sql` + `main._migrate` 쌍으로.
- **프론트**: 페이지/컴포넌트 PascalCase `.jsx`, 훅 `use*.js`(camelCase), CSS는 같은 이름 `.css` 병치. 섹션 컴포넌트는 `*Section.jsx`.
- **market_cache 키**: 지표별 문자열 키(`macro_signals` 등), `_mc_load`/`_mc_save`로 접근.
- **테스트**: 백엔드 `backend/tests/test_<대상>.py`(가드 테스트는 `test_no_*.py`), 프론트는 훅 병치 `.test.js` + 통합류 `frontend/src/test/*.test.jsx`.

---
last_mapped_commit: 78750ecc2c96d71a9e3a3f225a56aea99db71db5
mapped: 2026-07-01
---

# Structure

Repo root: `/Users/calmonion/Project/PortfoliOn`. Two top-level apps: `backend/` (Python/FastAPI) and `frontend/` (React 19 + Vite). Docs and contracts live at the root.

## Top-level

- `backend/` — FastAPI app, services, scheduler, schemas, tests.
- `frontend/` — Vite React app.
- `API_SPEC.md` — full REST API reference (source of truth for endpoints).
- `CLAUDE_COWORK_API.md` — external Cowork enrich API.
- `KIWOOM_API.md`, `KIS_API.md` — broker API catalogs / roadmaps.
- `README.md`, `CLAUDE.md` — overview + project instructions.
- `start.sh` / `start.bat` / `stop.bat`, `deploy.sh`, `docker-compose.yml`, `nginx.conf` — run/deploy.
- `.forge/` — forge state (ADRs in `.forge/adr/`, retros in `.forge/retro/`, this map in `.forge/codebase/`).

## Backend layout (`backend/`)

- `main.py` — app entry: `_migrate()` (idempotent startup DDL), `lifespan` (migrate → `sched.start()` → `_warm_market_cache` daemon thread), middleware + router wiring, `/health`.
- `auth.py` — `get_current_user`, `require_admin`, `require_admin_or_api_key` dependencies.
- `auth_schema.sql` — PostgreSQL auth schema (`users`, `refresh_tokens`); run BEFORE `app_schema.sql`.
- `app_schema.sql` — PostgreSQL app schema (tickers, user_stocks, snapshots, schedules, guru_*, digests, consensus_history, calendar_cache, market_cache, user_menu_permissions, user_events, market_leverage_indicators, market_lending_balance, etc.). Startup `_migrate()` adds newer tables idempotently (see ARCHITECTURE.md).
- `Dockerfile`, `Procfile`, `requirements.txt`, `pytest.ini`, `.env.docker` (+ `.example`), `.env`.
- `run_backfill.py` — backfill CLI/entry.
- `.venv/` — local Python venv (macOS: `.venv/bin/python`). NOTE: `lxml` is NOT in the local venv though it is in Docker — use `BeautifulSoup(html, "html.parser")` for code run under local pytest.

### `backend/routers/` (one module per HTTP surface)
`admin.py`, `analysis.py`, `analytics.py`, `auth.py`, `batches.py`, `calendar.py`, `digest.py`, `events.py`, `guru.py`, `investor.py`, `market_indicators.py`, `portfolio.py`, `rankings.py`, `recommendations.py`, `report.py`, `short_sell.py`, `stocks.py`, `watchlist.py`. Each defines `router = APIRouter(...)`; `main.py` imports and `include_router`s all of them.

### `backend/services/`
Mix of single modules and packages.

- **Packages**:
  - `market/` — quote/financials façade: `__init__.py` (re-exports + `get_quote`/`resolve_name`/`_get_quote_uncached`), `format.py` (symbol/value/price helpers), `kr.py` (KR quote chain 키움→KIS→Naver, Naver/FnGuide fetch), `us.py` (US quote yfinance→KIS, annual financials).
  - `market_indicators/` — `cache.py` (PostgreSQL `market_cache` r/w), `fx.py`, `commodities.py`, `earnings.py`, `econ.py` (FRED), `exports.py` (KR exports), `macro.py` (FRED macro signals), `indices.py` (index levels + S&P500 CAPE).
  - `kiwoom/` — Kiwoom REST: `client.py`, `quote.py`, `chart.py`, `investor.py`, `sector.py`, `shortsell.py`.
  - `kis/` — KIS REST: `client.py`, `quote.py`.
  - `storage/` — persistence façade: `__init__.py` (flat re-export), `portfolio.py`, `names.py`, `schedule.py`, `dates.py`.
  - `recommendation/` — funnel: `__init__.py`, `universe.py`, `scoring.py`, `funnel.py`, `store.py`, `actions.py`.
- **Single-module services** (notable): `agm.py` (AGM meeting-date extraction → `stock_disclosures.meeting_date`), `us_supply.py` (one-pass yfinance → `us_supply_snapshot` + insider), `backlog.py` + `backlog_parser.py` (DART order backlog), `disclosures.py` (DART disclosure feed), `dividends.py` (US/KR dividends → `stock_dividends`), `supply_score.py` (KR supply band), `insider_trades.py` (DART 5%/insider → `stock_insider_trades`), `short_sell_service.py`, `investor_service.py`, `ranking_service.py`, `kr_sector_service.py`, `leverage_service.py`, `lending_service.py`, `consensus.py`, `consensus_pipeline.py`, `report_generator.py`, `digest_service.py`, `analysis_service.py`, `guru_scraper.py`, `guru_stats.py`, `scraper.py`, `indicators.py`, `batch_registry.py`, `job_runs.py`, `schedule_spec.py`, `cache.py`, `db.py`, `utils.py`, `errors.py`, `parallel.py`, `progress.py`, `auth_service.py`.

### `backend/scheduler/` (a PACKAGE, not a single `scheduler.py`)
- `__init__.py` — public `start()`/`stop()`/`reload()`, re-exports of job funcs + `_JOB_FUNCS` and schedule helpers.
- `_state.py` — shared APScheduler instance + constants (leaf module).
- `jobs.py` — job-body functions + `_JOB_FUNCS` map.
- `schedule.py` — trigger building, rescheduling, schedule seeding/migration, missed-report recovery.

### Other backend dirs
- `middleware/` — `event_tracker.py` (`EventTrackerMiddleware`), `__init__.py`.
- `migrations/` — one-off SQL (`001_user_events.sql`, `002_backlog_history.sql`). NOTE: the live idempotent migrations are in `main.py:_migrate()`, not here.
- `data/` — static reference data + local file caches (`calendar/`, `consensus/`, gitignored).
- `snapshots/` — generated per-ticker JSON snapshots (gitignored).
- `reports/` — legacy read-only JSON fallback.
- `tests/` — pytest suite (`test_*.py`).
- `scripts/`, `auth.py`, `supabase_schema.sql` (legacy).

## Frontend layout (`frontend/src/`)

- `main.jsx` — React entry (`createRoot`, mounts `<App/>`).
- `App.jsx` — router + nav + auth bootstrap.
- `api.js` — shared axios instance (Bearer-token interceptor, 401 → clear tokens). `utils.js` — misc helpers.
- `pages/` — route screens: `Research.jsx` (home `/`), `Portfolio.jsx`, `MarketHub.jsx` (+ `Market.jsx`), `Guru.jsx` (+ `GuruCrawlNow.jsx`, `GuruManagers.jsx`, `GuruStats.jsx`), `Settings.jsx`, `ConsensusSettings.jsx`, `LeverageBackfillSettings.jsx`, `LoginPage.jsx`, `AdminAnalytics.jsx`, `Showcase.jsx`, `Recommendations.jsx`, `Reports.jsx`, `Ranking.jsx`, `Calendar.jsx`, `Digest.jsx`, `Analytics.jsx`, `SectorTab.jsx`, `MacroTab.jsx`, `ReportManualGen.jsx`.
- `components/` — top-level: `StockModal.jsx`, `PromoteModal.jsx`, `PermissionManager.jsx`, `PermissionPanel.jsx`, `LoadingSpinner.jsx`, `MobileNav.jsx`, `Toast.jsx`, `InstallPrompt.jsx`, `BatchScheduleEditor.jsx`.
  - `components/reports/` — report list + detail widgets: `ReportDetailTabs.jsx` (tab shell), `ReportDetailHeader.jsx`, `DetailTab.jsx`, `HistoryTab.jsx`, `Sections.jsx`, `ReportFilters.jsx`, `reportUtils.jsx`, `StockActions.jsx`, `StockCard.jsx`, `TickerListItem.jsx`, charts (`ConsensusChart.jsx`, `FinancialsChart.jsx`, `BacklogChart.jsx`), and section widgets `SupplySection.jsx`, `ShortSellSection.jsx`, `InvestorTrendSection.jsx`, `LatestDisclosuresSection.jsx`. **US-only sections in the 기술·수급 sub-tab** (gated `market !== 'KR'` in `ReportDetailTabs.jsx`): `UsSupplySection.jsx`, `UsInsiderSection.jsx`, `GuruHoldersSection.jsx`.
  - `components/market/` — Market Hub sections: `FxSection`, `VixSection`, `CommoditiesSection`, `TreasurySection`, `EconIndicatorsSection`, `M7EarningsSection`, `KrTop2Section`, `KrExportsSection`, `LeverageSection`, `LendingSection`, `MacroSignalsSection`, `IndexSection`, `marketUtils.jsx`.
  - `components/portfolio/` — `DashboardCard.jsx`, `FlashValue.jsx`, `PriceFreshness.jsx` (+ CSS).
  - `components/recommendations/` — `RecCard.jsx`.
  - `components/ui/` — primitives: `Badge`, `Button`, `Card`, `Stat`, `Input`, `Skeleton`, `icons.jsx`, `index.js`, plus semantic badges `InsiderBadge.jsx`, `SupplyBadge.jsx` (use explicit colors, not price-direction `success`/`danger` tokens).
- `contexts/` — `AuthContext.jsx` (auth + `menuPermissions` + `role`).
- `hooks/` — `useAuth`, `useTheme`, `useIsMobile`, `usePortfolioData`, `usePriceFlash`, `useReportFilters` (+ test), `useReportGeneration`, `useReportList`, `useStockManagement` (+ test).
- `utils/` — `analytics.js`, `marketHours.js`, `priceFlash.js`, `pwa.js`.
- `styles/` — `tokens.css` (CSS custom-property design tokens; KR color convention `--up`=red/`--down`=blue). `test/` — Vitest harness.

## Naming conventions

- **Backend**: `snake_case` modules/functions; private helpers prefixed `_` (`_migrate`, `_get_events`, `_kr_basic_*`, `_fetch_*`). Scheduler job bodies are `_fetch_<x>` / `_refresh_<x>` / `_generate_<x>`; the public job id (in `batch_registry`, `_JOB_FUNCS`, and `job_runs.record`) is the SAME string across all three (e.g. `us_supply_fetch`, `agm_fetch`) — keep them in lockstep.
- **Services are packages when split** ("god-file split via package re-export", ADR-0017): the package `__init__.py` re-exports the prior flat public surface (incl. externally-referenced `_private` symbols) so `from services.X import Y` and `services.X.Y` both keep working.
- **Frontend**: `PascalCase.jsx` for components/pages, `camelCase.js` for hooks/utils; hooks prefixed `use`. Plain CSS (no Tailwind); co-located `*.css` per component. Section widgets named `<Domain>Section.jsx`.
- **SQL**: tables `snake_case`; idempotent DDL uses `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`.

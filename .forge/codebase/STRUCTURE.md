---
last_mapped_commit: 6b1c06b514d7ca9511360a7263b14cf97d783d18
mapped: 2026-06-28
---

# PortfoliOn — Structure

Repo root: `/Users/calmonion/Project/PortfoliOn`. Two top-level apps: `backend/` (Python/FastAPI) and `frontend/` (React/Vite). Deployment, docs, and ops files at root.

## Top-level layout

- `backend/` — FastAPI app, services, schema, snapshots.
- `frontend/` — React 19 + Vite SPA.
- `API_SPEC.md` — full REST API reference (source of truth for endpoints).
- `CLAUDE_COWORK_API.md` — external enrich API for the Cowork client.
- `KIWOOM_API.md`, `KIS_API.md` — broker API catalogs.
- `README.md`, `CLAUDE.md` — overview + agent guidelines.
- `docker-compose.yml`, `nginx.conf`, `deploy.sh`, `start.sh`/`start.bat`/`stop.bat` — infra/run scripts.
- `.forge/` — forge workflow state (ADRs in `.forge/adr/`, this map in `.forge/codebase/`).

## Backend — `backend/`

Top-level modules:
- `main.py` — app entry, router mounts, `_migrate()` startup migrations, `lifespan`.
- `auth.py` — auth dependencies (`get_current_user`, `require_admin`, `get_current_user_or_api_key`).
- `app_schema.sql` — full app schema (tickers, snapshots, user_stocks, batch_schedules, job_runs, market_*, stock_*, daily_consensus_mart, etc.).
- `auth_schema.sql` — auth schema (users, refresh_tokens); run before `app_schema.sql`.
- `supabase_schema.sql` — legacy (Supabase removed).
- `requirements.txt`, `Dockerfile`, `Procfile`, `pytest.ini`.
- `run_backfill.py` — standalone backfill script.

### `backend/scheduler/` — PACKAGE (not a single file; no `scheduler.py` exists)
- `__init__.py` — re-exports + public `start()`/`stop()`/`reload()`.
- `_state.py` — shared `_scheduler` (`AsyncIOScheduler`), `_DIGEST_JOB_ID`, `_VALID_DAYS`.
- `jobs.py` — all job functions + `_JOB_FUNCS` dict (job_id → function) + startup seeders.
- `schedule.py` — `CronTrigger` building, `_reschedule_job`, schedule-seeding migration, missed-report recovery.

### `backend/routers/` — one `APIRouter` per file
`__init__.py` (empty), `admin.py`, `analysis.py`, `analytics.py`, `auth.py`, `batches.py`, `calendar.py`, `digest.py`, `events.py`, `guru.py`, `investor.py`, `market_indicators.py`, `portfolio.py`, `rankings.py`, `recommendations.py`, `report.py`, `short_sell.py`, `stocks.py`, `watchlist.py`.

### `backend/services/` — business logic + persistence
DB & infra: `db.py` (connection pool, `query`/`execute`), `cache.py` (6 in-memory caches), `job_runs.py` (batch execution log), `batch_registry.py` (`BATCHES`), `schedule_spec.py` (4 schedule spec types), `parallel.py`, `progress.py`, `errors.py`, `utils.py` (NaN/inf `sanitize`).

Domain modules: `report_generator.py` (snapshots), `consensus.py`, `consensus_pipeline.py`, `analysis_service.py`, `auth_service.py`, `digest_service.py`, `scraper.py`, `indicators.py`, `guru_scraper.py`, `guru_stats.py`, `leverage_service.py`, `lending_service.py`, `ranking_service.py`, `investor_service.py`, `short_sell_service.py`, `supply_score.py`, `insider_trades.py`, `kr_sector_service.py`, `backlog.py`, `backlog_parser.py`, `disclosures.py`, `dividends.py`, `agm.py`.

Sub-packages (each `__init__.py` re-exports its public surface, per ADR-0017):
- `market/` — `__init__.py` (quote/financials/history dispatch), `format.py`, `kr.py`, `us.py`.
- `market_indicators/` — `__init__.py`, `cache.py` (`market_cache` read/write), `fx.py`, `commodities.py`, `earnings.py`, `econ.py`, `exports.py`, `indices.py`, `macro.py`.
- `kiwoom/` — `__init__.py`, `client.py`, `quote.py`, `chart.py`, `sector.py`, `investor.py`, `shortsell.py` (KR read-only quote/chart source).
- `kis/` — `__init__.py`, `client.py`, `quote.py` (KR+US read-only backup quote source).
- `storage/` — `__init__.py`, `portfolio.py`, `names.py`, `schedule.py`, `dates.py`.
- `recommendation/` — `__init__.py`, `actions.py`, `funnel.py`, `scoring.py`, `store.py`, `universe.py`.

### Other backend dirs
- `middleware/` — `__init__.py`, `event_tracker.py`.
- `migrations/` — numbered SQL files (`001_user_events.sql`, `002_backlog_history.sql`); additive runtime DDL also lives in `main.py:_migrate()`.
- `data/` — static reference data (`sp500_tickers.json`, `kospi_tickers.json`) + gitignored runtime caches: `calendar/` (`YYYY-MM.json`), `consensus/` (per-ticker), `digest/`, `guru_managers.json`, plus legacy JSON stores.
- `snapshots/` — generated per-ticker/date JSON snapshots (gitignored; DB `snapshots` table is canonical).
- `reports/` — legacy read-only report directory (JSON fallback for old snapshots).
- `tests/` — pytest suite (~90 files, `test_*.py`); includes `test_api_doc_sync.py` (endpoint doc drift), `conftest.py`.
- `scripts/` — currently empty.
- `.venv/` — virtualenv (macOS: `.venv/bin/python`). NB: `lxml` is in `requirements.txt`/Docker but NOT in local `.venv` — use `BeautifulSoup(html, "html.parser")`.

## Frontend — `frontend/src/`

- `main.jsx` — React root, imports `styles/tokens.css` + `index.css`.
- `App.jsx` — top nav, OAuth/session bootstrap, `BrowserRouter` routes, context providers.
- `api.js`, `utils.js` — fetch helpers / shared utilities.
- `index.css`, `App.css`.

### `frontend/src/pages/`
`AdminAnalytics.jsx`, `Analytics.jsx`, `Calendar.jsx`, `ConsensusSettings.jsx`, `Digest.jsx`, `Guru.jsx`, `GuruCrawlNow.jsx`, `GuruManagers.jsx`, `GuruStats.jsx`, `LeverageBackfillSettings.jsx`, `LoginPage.jsx`, `MacroTab.jsx`, `Market.jsx`, `MarketHub.jsx`, `Portfolio.jsx`, `Ranking.jsx`, `Recommendations.jsx`, `ReportManualGen.jsx`, `Reports.jsx`, `Research.jsx` (home hub), `SectorTab.jsx`, `Settings.jsx`, `Showcase.jsx`.

Hub pages compose tab/sub-pages: `Research.jsx` (home `/`) hosts Reports/Ranking/Digest/Calendar; `MarketHub.jsx` (`/market`) hosts Market + leverage tabs; `Settings.jsx` routes to `ConsensusSettings` etc.

### `frontend/src/components/`
Top-level: `BatchScheduleEditor.jsx`, `InstallPrompt.jsx`, `LoadingSpinner.jsx`, `MobileNav.jsx`, `PermissionManager.jsx`, `PermissionPanel.jsx`, `PromoteModal.jsx`, `StockModal.jsx`, `Toast.jsx`.

Sub-folders:
- `market/` — `FxSection`, `VixSection`, `CommoditiesSection`, `TreasurySection`, `EconIndicatorsSection`, `M7EarningsSection`, `KrTop2Section`, `KrExportsSection`, `LeverageSection`, `LendingSection`, `IndexSection`, `MacroSignalsSection`, `marketUtils.jsx`.
- `reports/` — `BacklogChart`, `ConsensusChart`, `DetailTab`, `FinancialsChart`, `HistoryTab`, `InsiderTradesSection`, `InvestorTrendSection`, `LatestDisclosuresSection`, `ReportDetailHeader`, `ReportDetailTabs`, `ReportFilters`, `Sections`, `ShortSellSection`, `StockActions`, `StockCard`, `SupplySection`, `TickerListItem`, `reportUtils.jsx`.
- `portfolio/` — `DashboardCard`, `FlashValue`, `PriceFreshness` (+ CSS).
- `recommendations/` — `RecCard.jsx`.
- `ui/` — design-system primitives: `Badge`, `Button`, `Card`, `Input`, `Stat`, `Skeleton`, `InsiderBadge`, `SupplyBadge`, `icons.jsx`, `index.js` (+ matching CSS).

### Other frontend dirs
- `contexts/` — `AuthContext.jsx`.
- `hooks/` — `useAuth.js`, `useIsMobile.js`, `usePortfolioData.js`, `usePriceFlash.js`, `useReportFilters.js`, `useReportGeneration.js`, `useReportList.js`, `useStockManagement.js`, `useTheme.js` (+ `*.test.js` for some — Vitest, ADR-0019).
- `utils/` — `analytics.js`, `marketHours.js`, `priceFlash.js`, `pwa.js`.
- `styles/` — `tokens.css` (CSS custom props; KR price colors `--up`=red/`--down`=blue), `pc.css`, `mobile.css`.
- `test/`, `assets/`.

## Naming conventions

- **Backend**: snake_case modules/functions. Routers named for their domain; services suffixed `_service` for the heavier ones (`leverage_service`, `ranking_service`) but not all. Private helpers prefixed `_`. Packages re-export their public + externally-referenced private surface from `__init__.py`.
- **Batch ids**: a single string (e.g. `daily_report_kr`, `kr_rankings_fetch`) is used identically as the APScheduler job id, the `batch_registry` `id`, the `job_runs.record(id, ...)` id, and the `_JOB_FUNCS` key — they must stay in sync.
- **SQL**: lowercase table/column names, raw parameterized SQL via `db.query`/`db.execute`; idempotent DDL uses `IF NOT EXISTS`.
- **Frontend**: PascalCase `.jsx` components (one component per file, co-located `.css`); camelCase hooks prefixed `use`; `utils/*.js` lowercase. Tests are `*.test.js[x]` beside source.
- **API**: routes under `/api`, kebab-ish path segments; documented in `API_SPEC.md` + `CLAUDE_COWORK_API.md` (kept in sync, enforced for endpoint existence by `backend/tests/test_api_doc_sync.py`).

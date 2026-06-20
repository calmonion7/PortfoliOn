---
last_mapped_commit: 6793157d58f56e2b8392cfbe725de186d9f95e0d
mapped: 2026-06-20
---

# Architecture

PortfoliOn is a two-tier app: a Python/FastAPI backend (port 8000) over Docker PostgreSQL,
and a React 19 + Vite frontend (port 5173). nginx serves `frontend/dist` and proxies `/api/*`
to the backend.

## Backend pattern: routers → services → storage/db

```
HTTP → routers/<area>.py → services/<area>_service.py → services/storage/* + services/db.py → PostgreSQL
                                          ↑ services/cache.py (in-memory) short-circuits hot reads
```

- **Entry point** — `backend/main.py`. `lifespan()` runs `_migrate()` (idempotent
  `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` DDL inline), starts the scheduler
  (`scheduler.start()`), then warms calendar + market caches on daemon threads. Mounts 17 routers
  via `app.include_router(...)` plus `/health`. Middleware: `SessionMiddleware`,
  `middleware/event_tracker.py:EventTrackerMiddleware`, CORS.
- **Routers** (`backend/routers/`) — thin HTTP layer, one module per area. Registered in
  `main.py`: auth, portfolio, report, watchlist, stocks, guru, calendar, digest,
  market_indicators, analytics, analysis, events, rankings, investor, short_sell, batches,
  recommendations, admin.
- **Services** (`backend/services/`) — business logic. DB access goes through `services/db.py`
  (`get_connection`/`query`/`execute`) and the `services/storage/` package. No ORM; raw SQL.
- **Storage package** (`backend/services/storage/`, ADR-0017) — split from a single file into
  `portfolio.py` (holdings/watchlist/stocks), `dates.py` (expected report dates per market),
  `names.py` (dual-source name reconcile), `schedule.py`. `__init__.py` re-exports the full
  surface so external callers keep using `storage.X` module-attribute lookups.
- **No backend LLM** — `report_generator` only builds market-data snapshots; AI analysis text is
  written by an external Cowork client via enrich APIs (`CLAUDE_COWORK_API.md`).

## Scheduler: batches precompute → tables → request reads stored-only

`backend/scheduler/` is a package (not a single file): `__init__.py` re-exports the job functions
and `_JOB_FUNCS`; `jobs.py` holds the APScheduler job callables (`_generate_kr`/`_generate_us`,
`_run_guru_crawl`, `_fetch_leverage`/`_fetch_lending`/`_fetch_backlog`, `_refresh_*`, `_run_digest`,
etc.); `schedule.py` + `_state.py` hold scheduling config/shared state. `services/batch_registry.py`
(`BATCHES`) is the catalog (each batch carries `market` KR/US/공통 + `source`/`usage`), surfaced via
`GET /api/batches`; `services/job_runs.py` records run history.

**Core invariant**: batches sub-precompute external-API data (Kiwoom/KIS/yfinance/FRED/DART/KOFIA)
into `market_cache` / dedicated tables, and **request paths read only stored values** — they do not
make live external calls on the request/startup hot path. Empty / all-None fetch results are never
persisted (last good value is kept); startup seeding is `_seed_*_if_empty`.

## Key abstractions

- **In-memory caches** — `services/cache.py` holds 6 caches: snapshot (LRU 200), list (TTL 5s),
  dashboard / correlation / sector / macro (TTL 300s). Invalidated on stock add/edit/remove;
  storage→cache uses lazy import to avoid a cycle.
- **Market-indicators package** — `backend/services/market_indicators/`: `cache.py`
  (`_mc_load`/`_mc_save` over PostgreSQL `market_cache`), `fx.py`, `commodities.py`, `earnings.py`,
  `econ.py` (FRED), `exports.py` (KR exports), `macro.py` (FRED macro signals). Each submodule does
  incremental yfinance fetch (`_merge_history`/`_yf_close_history`, only after last stored date).
- **Quote source chains** — `services/market/kr.py` resolves KR quotes via **Kiwoom → KIS → Naver**;
  `services/market/us.py` resolves US via **yfinance → KIS**. Provider clients live in
  `services/kiwoom/` (`client.py` token singleton, `quote.py` ka10001, plus `sector.py`/`investor.py`/
  `chart.py`/`shortsell.py`) and `services/kis/` (`client.py`, `quote.py`). Missing keys = dormant
  (safe default; existing behavior unchanged). Boundaries: ADR-0009 (Kiwoom), ADR-0011 (KIS).
- **Recommendation package** — `backend/services/recommendation/`: `universe.py`, `scoring.py`,
  `actions.py`, `funnel.py`, `store.py` (batch-backed, read-from-`stock_recommendations`).
- **NaN/inf guarding** — starlette `JSONResponse` is `allow_nan=False`; float-bearing endpoints
  guard at the source (`services/utils.py` sanitizers, `math.isfinite` checks).

## Frontend pattern: pages → hooks → components

- **Entry points** — `frontend/src/main.jsx` mounts `<App/>` under `StrictMode`; `App.jsx` wraps
  `ToastProvider → AuthProvider → BrowserRouter` and defines routes. Top-level routes: `/` and
  `/research` (Research hub), `/portfolio`, `/market` (MarketHub), `/guru`, `/settings`,
  `/admin-analytics`, `/dev/showcase`; `/analysis` redirects to `/portfolio`. Nav items are filtered
  by `menuPermissions` from `contexts/AuthContext.jsx`.
- **Hub pages compose tabs** — `pages/Research.jsx` (57 lines) and `pages/MarketHub.jsx` (26 lines)
  are thin shells that mount tab pages (Reports/Ranking/Recommendations/Calendar/Digest;
  Market/Leverage etc.).
- **Hook-extraction pattern** — pages delegate derived logic to custom hooks in
  `frontend/src/hooks/`. `pages/Reports.jsx` (312 lines) is now an orchestrator consuming:
  `useReportList.js` (list fetch + counts/guruMap + ungenerated derivation),
  `useReportFilters.js` (filter/sort state, colocated `useReportFilters.test.js`),
  `useStockManagement.js` (add/edit/delete/promote handlers, colocated `useStockManagement.test.js`),
  `useReportGeneration.js` (generate one/batch + progress), `usePortfolioData.js` (holdings/watchlist
  fetch). Other hooks: `useAuth.js`, `useTheme.js`, `useIsMobile.js`, `usePriceFlash.js`.
- **API client** — `frontend/src/api.js` (axios instance, attaches JWT, `VITE_API_BASE_URL` base).
- **Components** — presentational, grouped by area under `frontend/src/components/`
  (`reports/`, `market/`, `portfolio/`, `recommendations/`, `ui/`). Event tracking via
  `frontend/src/utils/analytics.js:trackEvent`.

## Request/data-flow examples

- **Report list** — `GET /api/report/list` → `routers/report.py` → `cache.get_list` (TTL 5s) →
  `storage` + `snapshots`. Frontend `useReportList` fetches and `applyList` normalizes
  `data.stocks ?? data` (+ `last_scheduled_date` object `{KR,US}`).
- **Dashboard / P&L** — `GET /api/stocks/dashboard` reads stored dividends/FX (live calls 0),
  computes per-holding `yield_on_cost` and KRW-normalized `totals`; cached (dashboard TTL 300s).
- **KR sector momentum** — `kr_sector_fetch` batch precomputes via Kiwoom into `market_cache`;
  `GET /api/analysis/sector?market=KR` reads stored only.

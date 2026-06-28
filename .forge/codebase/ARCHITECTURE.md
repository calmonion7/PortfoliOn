---
last_mapped_commit: 6b1c06b514d7ca9511360a7263b14cf97d783d18
mapped: 2026-06-28
---

# PortfoliOn — Architecture

Stock portfolio manager. Python/FastAPI backend (port 8000) + React 19/Vite SPA (port 5173), PostgreSQL 16 store. No backend LLM calls; AI analysis text is written externally via an enrich API.

## Overall pattern

Backend is a layered **router → service → db** stack:

- **Routers** (`backend/routers/*.py`) — thin HTTP layer. Each module defines an `APIRouter` (mostly `prefix="/api"`), validates input, calls services, returns JSON. Auth via `Depends(get_current_user)` / `require_admin` / `get_current_user_or_api_key` from `backend/auth.py`.
- **Services** (`backend/services/`) — all business logic, external API calls, computation, persistence. Routers hold no domain logic.
- **DB access** — funnelled through `backend/services/db.py`, a single psycopg2 `ThreadedConnectionPool` (minconn=1, maxconn=20) with two helpers: `query(sql, params) -> list[dict]` (RealDictCursor) and `execute(sql, params) -> int`. `get_connection()` is a context manager that commits on success / rolls back on exception. There is no ORM — raw SQL throughout.

Frontend is a **pages + components** React SPA: `react-router-dom` routes render page components, which compose reusable components and call the backend through `fetch`/`frontend/src/api.js`.

## Backend entry point — `backend/main.py`

- Loads `.env` via `dotenv`, constructs `app = FastAPI(..., lifespan=lifespan)`.
- Middleware: `SessionMiddleware` (`SESSION_SECRET`), `EventTrackerMiddleware` (`backend/middleware/event_tracker.py`), `CORSMiddleware` (origins `localhost:3000`, `localhost:5173`, `FRONTEND_URL`).
- `include_router(...)` mounts ~17 routers: `auth, portfolio, report, watchlist, stocks, guru, calendar, digest, market_indicators, analytics, analysis, events, rankings, investor, short_sell, batches, recommendations, admin`.
- `/health` route (GET/HEAD).
- **`_migrate()`** — idempotent startup migration run inside `lifespan`. A series of `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` statements (each wrapped in try/except + log) covering `backlog_history.segments`, `batch_schedules`, `market_short_sell`, `stock_disclosures` (+`meeting_date`), `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`. This makes deploys self-applying for additive DDL; the full base schema lives in `backend/app_schema.sql` (run after `backend/auth_schema.sql`).
- **`lifespan`** ordering: `_migrate()` → `sched.start()` → background daemon threads `_warm_calendar_cache()` and `_warm_market_cache()`; on shutdown `sched.stop()`.

## Scheduler — `backend/scheduler/` (PACKAGE, not a single file)

Confirmed a package: there is no `backend/scheduler.py`. `main.py` does `import scheduler as sched`.

- `backend/scheduler/_state.py` — leaf module holding the shared `_scheduler = AsyncIOScheduler()` (APScheduler asyncio), plus `_DIGEST_JOB_ID`, `_VALID_DAYS`. Kept separate to avoid partial-init circular imports.
- `backend/scheduler/jobs.py` — all job functions (`_generate_kr`/`_generate_us`, `_run_guru_crawl`, `_refresh_earnings_kr/us`, `_refresh_monthly_kr/us`, `_refresh_macro_signals`, `_run_digest`, `_fetch_leverage`/`_fetch_lending`/`_fetch_backlog`/`_fetch_disclosures`/`_fetch_agm`/`_fetch_insider`/`_fetch_dividends`, `_fetch_kr/us_rankings`, `_fetch_investor_trend`, `_fetch_short_sell`, `_fetch_supply_score`, `_fetch_recommendation_kr/us`, `_fetch_kr_sector`) and the **`_JOB_FUNCS` dict** mapping each `job_id` → its function. Also the startup seeders `_seed_rankings_if_empty` / `_seed_kr_sector_if_empty` and worker helpers. Heavy service imports are deferred (function-local) to keep package import light.
- `backend/scheduler/schedule.py` — trigger/scheduling logic: `_build_trigger` (wraps `services.schedule_spec.build_trigger_kwargs` → APScheduler `CronTrigger`), `_reschedule_job` (reads `storage.get_batch_schedule(job_id)`, removes/re-adds the APScheduler job, honours `misfire_grace_time`), `_seed_spec_for` / `_seed_batch_schedules` (idempotent migration of legacy `schedules`/`guru_schedules` into the unified `batch_schedules`), and `_check_missed_report` / `_check_missed_report_for` (on startup, regenerate any per-market snapshots missed since the scheduled time).
- `backend/scheduler/__init__.py` — re-exports the symbols above (private names explicitly listed) and defines the public API: `start()` (seed schedules → reschedule every editable batch → check missed reports → seed rankings/kr_sector → `_scheduler.start()`), `stop()`, `reload(job_id)`.

## Batch / scheduler model

- **Registry** — `backend/services/batch_registry.py` holds `BATCHES`, a static list of ~26 batch metadata dicts. Each entry: `id` (== APScheduler job id == `job_runs.record` id), `label`, `category` (`report`/`market`/`guru`), `usage`, `source`, `editable`, `trigger_kinds` (`auto`/`manual`), `manual_endpoint`, `scheduler_job_id`, `timezone`, optional `misfire_grace_time`, `market` (`KR`/`US`/`공통`, classified by source country), and `default_schedule`. `get_batch(job_id)` looks up by id via `_BY_ID`.
- **Schedule spec** — `backend/services/schedule_spec.py` validates and builds triggers for 4 spec types: `daily`, `weekly`, `monthly`, `interval`. Persisted per-batch as rows in the `batch_schedules` table (one row per `job_id`, JSONB) via `storage.get_batch_schedule` / `save_batch_schedule`.
- **Lanes** — `services.job_runs.record(job_id, trigger)` is a context manager that records executions into the `job_runs` table (status `running`→`success`/`failed`, keeps latest 20 per job_id). The `trigger` arg distinguishes lanes: `"auto"` (scheduler jobs in `jobs.py`), `"manual"` (admin-triggered via each batch's `manual_endpoint`), and `"backfill"` (historical re-runs). Instrumentation is graceful-degrade: if the `job_runs` write fails, the batch body still runs (`run_id=None` sentinel). NB: `failed` is only recorded when the body re-raises — many jobs swallow internal exceptions and so record `success` even on partial failure.
- **Hub API** — `backend/routers/batches.py` exposes `GET /api/batches` (registry + next_run + recent runs), `GET/PUT /api/batches/{job_id}/schedule`. The generic editor on the frontend is `frontend/src/components/BatchScheduleEditor.jsx`.
- **Daily report split** — a single conceptual "daily report" is two batches: `daily_report_kr` (default 20:30 KST) and `daily_report_us` (default 07:00 KST). `_generate_all(market, job_id)` in `jobs.py` partitions stocks (`_in_market`: KR == `market=="KR"`, US == everything else) and calls `report_generator.generate_report_with_retry` per stock, then runs the consensus pipeline. `consensus` has no scheduler job of its own (embedded in the daily report runs; `next_run` is null).

## Report-snapshot model

- **`backend/services/report_generator.py`** — `generate_report(stock, ...)` builds a per-ticker market-data snapshot dict (price, history-derived volume profile / RSI targets, financials, analyst/consensus, etc.; no AI text), `_sanitize`s it (NaN/inf → None, since starlette `JSONResponse` is `allow_nan=False`), writes a JSON file to `backend/snapshots/{ticker}/{date}.json`, and **upserts into the `snapshots` table** (`INSERT ... ON CONFLICT (ticker, date) DO UPDATE`). `generate_report_with_retry` wraps it with one retry; `backfill_ticker` regenerates N historical days.
- KR snapshots use **KRX regular-session prices** (`regular=True`), distinct from the live dashboard which uses NXT (`regular=False`) — see quote chain below. Before persisting a KR snapshot, an **independent-feed gate** cross-checks `price` and the last daily-bar close against an independent reference feed (Naver retry-once → KIS fallback); if no ref is available, or the values diverge beyond a 2× band, the snapshot write is **skipped** (prior good snapshot retained, "wrong < missing").
- Reads: `GET /api/report/{ticker}/{date_str}` (and `.../history`, `.../list`) in `backend/routers/report.py`. Old snapshots fall back to JSON in `backend/reports/` / `backend/snapshots/`. The `tickers` master + `snapshots.data.name` are dual-source for display names.

## Calendar event model — `backend/routers/calendar.py`

Per-user, per-month event aggregation cached in the `calendar_cache` table (and warmed into `backend/data/calendar/YYYY-MM.json` files). `_get_events(month, user_id)` assembles events of these types:

- **earnings** — `_collect_earnings` from yfinance `t.calendar` "Earnings Date".
- **dividend** — `_collect_dividend` from yfinance `t.calendar` "Ex-Dividend Date" (US only).
- **econ** — `_get_econ_events` from FRED `/fred/releases/dates`, filtered to a curated set (`_FRED_RELEASES`: CPI, Employment, GDP, PPI). Requires `FRED_API_KEY`.
- **agm** — `_get_agm_events` reads `stock_disclosures.meeting_date` (KR only, batch-populated by `agm_fetch`); read-only, no live call.
- **holiday** (`holiday_us` / `holiday_kr`) — `_get_holidays` via `exchange_calendars` (XNYS / XKRX) by diffing trading sessions from business days.

Per-stock yfinance fetches are parallelized (ThreadPoolExecutor, max 15). Cache is invalidated on stock add/remove/promote; manual clear via `DELETE /api/calendar/cache`.

## Market quote source chain — `backend/services/market/`

`backend/services/market/` is a package (`__init__.py` re-exports the public surface) split into `format.py` (symbol/number helpers), `kr.py`, `us.py`.

- **`get_quote(ticker, market, exchange, _t, regular)`** — entry point, wraps `_get_quote_uncached` in a per-ticker TTL cache (cache key includes `regular` so KRX-regular and NXT quotes don't mix).
- **KR chain** (`get_quote_kr` in `kr.py`): independent price feeds — Kiwoom NXT (`_AL`), KIS, Naver, Kiwoom KRX — combined by a corroboration/majority-vote scheme (`_corroborated_pick`). Default lazy path: 키움 NXT + 키움 KRX (2 calls); on disagreement it escalates to KIS + Naver and discards outliers. Priority order 키움→KIS→Naver. `regular=True` (report snapshots) uses 키움 KRX→KIS→Naver first-valid. Outage/degenerate cases self-check against prev_close ±30%.
- **US chain** (`_get_quote_uncached` US branch): **yfinance → KIS** fallback (`_us_quote_kis`), else `_us_none_quote`. Batch dashboard prices use `yf.download` (1 call) via `get_quotes_batch`.
- History/charts use a separate path (`get_history_df`): KR via Kiwoom (ka10081/82/83) preferred, yfinance fallback; this is a different TR than the quote, so KR quote scale and chart scale can diverge.

## Frontend entry point & router

- `frontend/src/main.jsx` — `createRoot(...).render(<StrictMode><App/></StrictMode>)`, imports `styles/tokens.css` + `index.css`.
- `frontend/src/App.jsx` — top-level component. Handles OAuth callback / token bootstrap from URL params and `localStorage`, gates on session (else `LoginPage`). Wraps the tree in `ToastProvider` → `AuthProvider` (`frontend/src/contexts/AuthContext.jsx`, loads `menuPermissions`/`role`) → `BrowserRouter`. Routes:
  - `/` and `/research` → `Research` (home hub)
  - `/portfolio` → `Portfolio`
  - `/market` → `MarketHub`
  - `/analysis` → redirect to `/portfolio`
  - `/guru` → `Guru`, `/settings` → `Settings`
  - `/admin-analytics` → `AdminAnalytics` (admin only)
  - `/dev/showcase` → `Showcase`
- Nav (`TopNav` in `App.jsx`, mobile via `frontend/src/components/MobileNav.jsx`) filters tabs by `menuPermissions` keys (`research`, `portfolio`, `market`, `guru`, `settings`) + an admin-only `analytics` item.

## Key abstractions / data flow

- **Request data flow**: HTTP → router (`Depends` auth) → service → `db.query/execute` (PostgreSQL) → JSON response. Hot read endpoints serve precomputed batch output (e.g. rankings, KR sector momentum, recommendations, supply score) rather than calling external APIs on the request path.
- **Service-package re-export pattern** (ADR-0017): god-files were split into packages (`market/`, `storage/`, `recommendation/`, `scheduler/`, `market_indicators/`) whose `__init__.py` re-exports the full public + externally-referenced surface, so `module.X` attribute access by callers/tests keeps working.
- **In-memory caches** — `backend/services/cache.py` holds 6 caches (snapshot LRU + list/dashboard/correlation/sector/macro TTLs), invalidated on stock mutations.
- **Sanitize boundary** — `backend/services/utils.py` `sanitize()` scrubs NaN/inf from any response dict that carries external quote/aggregate floats (starlette serialization is `allow_nan=False`).

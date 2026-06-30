---
last_mapped_commit: 78750ecc2c96d71a9e3a3f225a56aea99db71db5
mapped: 2026-07-01
---

# Architecture

PortfoliOn is a two-tier app: a Python/FastAPI backend (port 8000) and a React 19 + Vite frontend (port 5173). Persistence is Docker PostgreSQL; local JSON files are runtime caches.

## Overall pattern

- **Backend**: `routers/` (HTTP layer, FastAPI `APIRouter`) → `services/` (business logic, external fetch, persistence) → `services/db.py` (raw SQL via psycopg2 pool). No ORM; SQL is written inline in services.
- **Frontend**: `pages/` (route screens) compose `components/` (presentational + section widgets); `hooks/` hold data-fetching/state logic; `contexts/AuthContext.jsx` holds auth/permission state; `api.js` is the shared axios instance.

## Layers (backend)

1. **Entry / app wiring** — `backend/main.py` builds the `FastAPI` app, installs middleware, and `include_router`s every router. A `lifespan` async context manager runs startup/shutdown.
2. **Routers** (`backend/routers/`) — one module per surface; each exposes `router = APIRouter(...)`. Auth gating via `Depends(get_current_user)` / `require_admin` (`backend/auth.py`).
3. **Services** (`backend/services/`) — fetch from external sources, compute, read/write PostgreSQL. Several are packages (see STRUCTURE.md). External calls live here, never in routers.
4. **Persistence** — `backend/services/db.py` exposes `query(sql, params) -> list[dict]` and `execute(sql, params) -> int` over a module-global `ThreadedConnectionPool` (`maxconn=20`, `RealDictCursor`). The pool size is intentionally larger than the max ThreadPool concurrency used by batches (calendar 15 / analysis 11) to avoid `PoolError`.
5. **Scheduling** — `backend/scheduler/` package drives APScheduler (see below).

## Entry points

### `backend/main.py`
- `_migrate()` — idempotent startup DDL (all wrapped in try/except + `print` on failure, so a failed migration never blocks boot). Uses `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`. Tables/columns created here include: `backlog_history.segments`, `batch_schedules`, `market_short_sell`, `stock_disclosures` (+ `meeting_date` column), `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations` (+ `low_liquidity`, `exchange` columns), and **`us_supply_snapshot`** (+ `insider_transactions`, `insider_net` columns).
- `lifespan` — calls `_migrate()`, then `sched.start()`, then spawns a daemon `threading.Thread(target=_warm_market_cache)`. On shutdown calls `sched.stop()`.
- `_warm_market_cache()` — warms econ indicators + KR exports caches in the background thread. **NOTE: there is no `_warm_calendar_cache`** (a prior calendar warm-up was removed; calendar is computed lazily on cache-miss inside `routers/calendar.py`).
- Middleware: `SessionMiddleware` (secret from `SESSION_SECRET`), `EventTrackerMiddleware` (`backend/middleware/event_tracker.py`), `CORSMiddleware` (origins `localhost:3000`, `localhost:5173`, and `FRONTEND_URL`).
- `/health` route (GET/HEAD).

### `backend/scheduler/` (a PACKAGE, not a single file)
- `__init__.py` — re-exports job functions and the `_JOB_FUNCS` map from `jobs.py`, and the scheduling helpers from `schedule.py`. Public API: `start()`, `stop()`, `reload(job_id)`.
  - `start()` seeds batch schedules (`_seed_batch_schedules`), reschedules every `editable` batch (`_reschedule_job`), runs missed-report recovery (`_check_missed_report`), seeds rankings/KR-sector caches if empty (`_seed_rankings_if_empty`, `_seed_kr_sector_if_empty`), then starts the APScheduler instance.
- `_state.py` — shared `_scheduler` (APScheduler instance), `_DIGEST_JOB_ID`, `_VALID_DAYS` constants. Leaf module to avoid circular import.
- `jobs.py` — all job-body functions (`_generate_kr`, `_generate_us`, `_run_guru_crawl`, `_refresh_*`, `_fetch_*`, `_supply_score_work`, `_recommendation_work`, `_fetch_us_supply`, `_fetch_kr_sector`, etc.) plus the `_JOB_FUNCS` dict mapping `job_id -> callable`. Each job body wraps its work in `with job_runs.record(job_id, "auto"):`. `_in_market(stock, market)` partitions stocks (KR = `market=="KR"`, US = everything else).
- `schedule.py` — `_build_trigger` (CronTrigger from spec), `_reschedule_job` (loads stored spec, removes+re-adds the APScheduler job; honors per-batch `misfire_grace_time`), `_seed_spec_for` / `_seed_batch_schedules` (idempotent migration of stored schedules, incl. legacy `daily_report`/`earnings_refresh`/`monthly_refresh` succession), and `_check_missed_report` / `_check_missed_report_for` (per-market startup recovery: regenerates only the snapshots actually missing for today).

### `backend/services/batch_registry.py`
- `BATCHES` — the static list of batch metadata (28 entries) exposed via `GET /api/batches`. Each entry: `id` (must match scheduler job id AND `job_runs.record` id), `label`, `category` (report/market/guru), `usage`, `source` (fetch origin), `editable`, `trigger_kinds` (auto/manual), `manual_endpoint`, `scheduler_job_id`, `timezone`, `market` (KR/US/공통), `default_schedule`. Includes **`us_supply_fetch`** (weekly Sun 06:00, US, yfinance) and **`agm_fetch`** (daily 08:00, KR, DART). `consensus` has `scheduler_job_id: None` (runs inside `daily_report_kr`/`daily_report_us`). `get_batch(job_id)` looks up by id.

### `frontend/src/main.jsx`
- Imports `styles/tokens.css` + `index.css`, mounts `<App/>` in `<StrictMode>` via `createRoot`.
- `frontend/src/App.jsx` — owns auth bootstrap (OAuth-code exchange, token storage from URL params), wraps the tree in `ToastProvider` → `AuthProvider` → `BrowserRouter`. `TopNav` filters nav items by `menuPermissions` from `useAuth()`; admin gets an extra `/admin-analytics` tab. Routes: `/`+`/research`→Research, `/portfolio`→Portfolio, `/market`→MarketHub, `/guru`→Guru, `/settings`→Settings, `/admin-analytics`→AdminAnalytics, `/dev/showcase`→Showcase, `/analysis`→redirect to `/portfolio`.

## Batch / scheduler model (auto + manual + backfill, job_runs)

- **Single source of metadata**: `batch_registry.BATCHES`. Editable batches get an APScheduler job (id == batch id) built from a stored schedule spec in the `batch_schedules` table (read via `storage.get_batch_schedule`). Schedule edits go through `PUT` on `routers/batches.py` and call `scheduler.reload(job_id)`.
- **Three trigger lanes, one ledger**: every execution path — `auto` (scheduler), `manual` (admin POST to `manual_endpoint`), and `backfill` (`backend/run_backfill.py` / dedicated endpoints) — records into the `job_runs` table via `services/job_runs.py`'s `record(job_id, trigger)` context manager. `record` INSERTs a `running` row, prunes to the latest `KEEP=20` per job_id, then UPDATEs to `success`/`failed` on exit. **Instrumentation is observation-only**: a DB failure in `record` degrades gracefully (run_id=None) and never breaks the job body. Caveat: `failed` is only recorded when the body *raises* — many jobs swallow internal exceptions and so log `success` even on partial failure.
- `GET /api/batches` (`routers/batches.py`) joins registry metadata with `job_runs.recent_map()` to render the batch hub. Manual run endpoints record under the same id so manual/backfill runs appear in the same history (avoiding the "retired id → run disappears" regression).

## Report-snapshot model

- `services/report_generator.py` — `generate_report(stock, ...)` builds a per-ticker, per-date market-data snapshot (no LLM; AI text comes from external Cowork enrich API). It fetches quote, financials (quarterly + annual), analyst data, RSI, Finviz consensus (US), news, competitor quotes/valuations — most in a `ThreadPoolExecutor(max_workers=8)`; `yf.Ticker.info`/`.history` are called serially (not thread-safe). Writes the sanitized summary to `snapshots/{ticker}/{date}.json` AND UPSERTs into the `snapshots` table. `generate_report_with_retry` retries once on transient fetch failure.
- **Quote basis split** (ADR-0020): report snapshots use **KRX regular-session** prices (`regular=True` → KR daily_df and `get_quote` opt-in), whereas the live dashboard uses NXT (`regular=False`, default). The two bases can differ ~1% for the same KR stock by design.
- **KR independent-feed gate** (`generate_report`, KR only; ADR-0020 + task#101/#118): before persisting, it fetches an independent reference price — **Naver retry-once, then KIS fallback** (`_kr_basic_naver` / `_kr_basic_kis`). If NO ref is available it **skips persistence** (`raise ValueError`, keeping the prior good snapshot — "wrong < missing"). If a ref exists, both `summary["price"]` and the daily-bar last close are cross-checked to be within 2× ([0.5, 2.0]) of the ref; a glitch outside that band also skips persistence. This catches KRX self-consistent glitches that the regular-session basis alone cannot.

## Calendar event model (`routers/calendar.py`, `_get_events`)

`GET /api/calendar?month=YYYY-MM` returns events for one month. Caching: per-`(user_id, month)` row in `calendar_cache` (read first; computed and written on miss). `DELETE /api/calendar/cache` clears a month; `clear_cache()` wipes the local file cache. Event sources merged in `_get_events`:

- **earnings** (`_collect_earnings`) — per holding/watchlist stock, from `yf.Ticker(sym).calendar["Earnings Date"]`. Fetched in a `ThreadPoolExecutor(max_workers≤15)`, sharing one `t.calendar` per ticker with dividend.
- **dividend** (`_collect_dividend`) — exact US ex-dividend date from `t.calendar["Ex-Dividend Date"]` (US only; KR skipped).
- **econ** (`_get_econ_events`) — two sub-sources, both `stock_type:"market"` (market-wide): (1) curated FRED release dates (`_FRED_RELEASES` set: CPI, Employment Situation, GDP, PPI) fetched live from `/fred/releases/dates` at cache-miss (requires `FRED_API_KEY`); (2) **FOMC policy-decision dates from a static `_FOMC_DATES` list** (always included regardless of FRED key; ~2027 coverage, manually refreshed annually).
- **agm** (`_get_agm_events`) — AGM meeting dates read from `stock_disclosures.meeting_date` (batch-populated by `services/agm.py` `agm_fetch`; KR-only, so US tickers return nothing). Read-only; no live fetch.
- **holiday** (`_get_holidays`) — NYSE (`XNYS`) and KRX (`XKRX`) exchange closures via `exchange_calendars`, `stock_type:"market"`.

## US supply model (`services/us_supply.py`)

- `fetch_us_supply(ticker, exchange)` — **one `yf.Ticker` pass** reads `t.info` (short stats: shortPercentOfFloat, shortRatio, sharesShort, dateShortInterest), `t.institutional_holders`, `t.insider_transactions`, and `t.insider_purchases`, all with NaN/inf guards (`_finite`). Returns `{"short", "institutional", "insider":{"transactions","net"}}` or `None` on yfinance error.
- `upsert_us_supply` writes the whole record (incl. insider columns) to the **`us_supply_snapshot`** table (ticker PK upsert).
- `get_us_supply(ticker)` / `get_us_insider(ticker)` read from `us_supply_snapshot` only (live yfinance = 0 on request path). KR tickers return `None`.
- `fetch_all_us_supply()` is the batch entry (joins `tickers`×`user_stocks` where `market != 'KR'`).
- Surfaced via `GET /api/report/{ticker}/us-supply` and `GET /api/report/{ticker}/us-insider` (both registered before the catch-all `/report/{ticker}/{date_str}` in `routers/report.py`). Batch `us_supply_fetch` / manual `POST /api/report/us-supply/refresh`.

## Quote chains

- **KR** (`services/market/kr.py` `get_quote_kr` → `_kr_pick_basic`): the trusted source chain is **키움 → KIS → Naver**. For the live dashboard (`regular=False`) it uses a corroboration model (`_corroborated_pick`): a feed is trusted only if it agrees within 2× with another independent feed; lazy escalation calls 키움 NXT + 키움 KRX first, escalating to KIS/Naver only on disagreement, then majority-votes. Report snapshots (`regular=True`) use `_kr_pick_regular` (KRX-priority chain 키움KRX→KIS→Naver with prev-close ±30% / daily-bar 2× self-check). Degenerate path (`_kr_pick_degenerate_lazy`) when feeds can't corroborate.
- **US** (`services/market/__init__.py` `_get_quote_uncached` → `services/market/us.py`): **yfinance → KIS** fallback. yfinance (`t.info` + `t.history`) is primary; on exception or empty price it falls back to `_us_quote_kis` (KIS overseas current price, ADR-0011), else returns an error dict. KIS keys absent = dormant (no behavior change).
- `get_quote(...)` wraps `_get_quote_uncached` in a per-`(ticker, market, exchange, regular)` TTL cache (`services/cache.py`) to bound external rate-limited calls.

## Key abstractions

- `services/storage/` — the persistence façade for portfolio/watchlist/snapshots/schedules/names (package; re-exports a flat API). Routers and jobs call `storage.*` rather than writing SQL.
- `services/job_runs.py` `record()` — the batch instrumentation context manager (graceful-degrade ledger).
- `services/utils.py` `sanitize()` — recursively replaces NaN/inf floats with None before JSON responses (starlette `JSONResponse` uses `allow_nan=False`).
- `services/cache.py` — in-memory caches (snapshot LRU, list/dashboard/correlation/sector/macro TTL) with invalidation on stock mutations.
- `services/recommendation/` — funnel package (`universe`→`scoring`→`funnel.run_recommendation_batch`→`store`→`actions`) precomputing scores into `stock_recommendations`.
- `services/consensus_pipeline.py` — standardizes opinion strings to a 5-point score and writes `consensus_history`; `run_daily()` is invoked at the tail of the daily-report jobs.

## Data flow (request path principle)

Batch-backed surfaces (rankings, KR sector momentum, recommendations, US supply, supply score, macro signals) are **read-only on the request path**: a scheduled batch precomputes and stores into `market_cache`/dedicated tables, and the GET endpoint reads stored values only — no live external fetch at request or startup time (startup seeds empty caches once via `_seed_*_if_empty`). FX/VIX/commodities/indices use request-path incremental fetch with TTL cache + DB fallback (no batch).

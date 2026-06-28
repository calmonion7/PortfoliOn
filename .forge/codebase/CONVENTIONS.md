---
last_mapped_commit: 6b1c06b514d7ca9511360a7263b14cf97d783d18
mapped: 2026-06-28
---

# CONVENTIONS

Code style and recurring patterns in PortfoliOn. Backend = Python/FastAPI; frontend = React 19 + Vite, plain CSS. Facts verified against source; file paths in backticks.

## Backend

### Layering: routers → services → db

- **Routers** (`backend/routers/*.py`) are thin: parse request, call into a service, shape the JSON response. App entry `backend/main.py` mounts each router. Domain logic lives in `backend/services/`.
- **Services** (`backend/services/*.py`, plus packages `services/market/`, `services/market_indicators/`, `services/storage/`, `services/kiwoom/`, `services/kis/`, `services/recommendation/`) hold all data fetching, parsing, and computation.
- **DB access is centralized in `backend/services/db.py`** — no raw `psycopg2` in routers/services. Two primitives:
  - `query(sql, params) -> list[dict]` — SELECT, returns `RealDictCursor` rows as dicts.
  - `execute(sql, params) -> int` — INSERT/UPDATE/DELETE, returns rowcount.
  - `get_connection()` is a `@contextmanager` that commits on success / rolls back on exception, drawn from a module-level `ThreadedConnectionPool` (`minconn=1, maxconn=20`, lazily built under a `threading.Lock`). The pool is sized **above** max ThreadPool concurrency on purpose: psycopg2 raises `PoolError` (not blocks) on exhaustion (see `CONCERNS.md` §4).
- SQL is parameterized (`%s` placeholders + a params tuple) — no string interpolation of user values.

### JSON serialization safety: NaN/inf must be guarded

Starlette `JSONResponse` uses `allow_nan=False`, so any `NaN`/`inf` in a response dict raises a 500 (`Out of range float values are not JSON compliant`). Two complementary guard styles, both used:

- **Output sanitize** — `sanitize(obj)` in `backend/services/utils.py` recursively walks dicts/lists and maps any non-finite float to `None`. Used as a final safety net before returning, e.g. `routers/stocks.py` `_build_all()` wraps its return in `sanitize({...})`; also imported in `routers/recommendations.py`, `routers/report.py`, `services/report_generator.py`, `services/lending_service.py`, `services/leverage_service.py`, `services/market_indicators/indices.py`.
- **Source `math.isfinite` guards** — preferred where practical (cleaner than blanket sanitize): check finiteness at the source and treat non-finite as "no data". `backend/services/market/format.py` shows the idiom in `_safe_ratio`/`_safe_pct` (return `None` if denominator falsy/zero/non-finite or result non-finite, wrapped in `try/except (TypeError, ValueError)`).
- Rule of thumb (per `CLAUDE.md`): any endpoint putting external-quote-derived floats (yfinance Close, FX) into the response needs one of these. Postgres rejects `NaN` in a `json` column while Python `json.dumps` defaults `allow_nan=True`, so the DB-vs-file fallback split can mask the bug.

### Graceful external-fetch fallback — "wrong < missing"

External fetches (yfinance, Naver, DART, Kiwoom, KIS, FRED, KOFIA) fail or return partial data routinely. The convention:

- On fetch failure, prefer omitting/skipping (`None`, skip the ticker, keep the prior good value) over writing a fabricated/default value. Comments tag this `wrong<missing`. Example in `backend/services/report_generator.py` (~lines 279–317): the report-snapshot writer cross-validates KR `price` against an independent ref feed (Naver retry-once → KIS fallback) and **skips persisting that ticker** when no ref exists, keeping the last good snapshot, with a loud `print("[Report] ...")`.
- Batch-fetch convention (per `CLAUDE.md`): never silently swallow fetch errors (log them) and never persist an all-`None`/empty result to cache (skip the save, keep prior good value) — guard the *failure class*, not a suspected trigger.

### yfinance symbol normalization: `_yf_sym`

`_yf_sym(ticker, market="US", exchange="") -> str` in `backend/services/market/format.py` is the single place that maps an internal ticker to a yfinance symbol: KR → `{ticker}.{exchange or "KS"}`; US → `ticker.replace(".", "-")` (e.g. `BRK.B` → `BRK-B`). Re-exported via `services/market/__init__.py` and used by `services/market/us.py` and the package facade. yfinance row-label lookups go through `_yf_val(src, key, col)` which exact-matches `key` in the frame index/columns and returns `None` on miss or NaN (no exception) — see `CLAUDE.md` gotcha on yfinance `get_*()` method vs `.property` label mismatch.

### Lazy (in-function) imports to break circular refs

When module A needs B but B already imports A, the dependency is imported **inside the function**, not at module top. Canonical example: `backend/services/storage/names.py` `_invalidate_name_caches()` does `from services import cache as cache_svc` inside the function (`storage ↔ cache` cycle), wrapped in `try/except: pass`. Same idiom appears elsewhere for storage→cache invalidation.

### Per-card / per-item resilience (`_safe`, `_minimal_card`)

Endpoints that build N items from N external lookups isolate per-item failure so one bad item never 500s the whole response. `routers/stocks.py` `_build_all()` runs cards through a `ThreadPoolExecutor`, each card wrapped by `_safe(stock)` which on throw falls back to `_minimal_card(stock, quote)`; the batch quote call is `try/except → {}`. Invariant (per `CLAUDE.md`): `holdings=N → always N cards`.

### Errors

- HTTP errors via small factory helpers in `backend/services/errors.py`: `not_found(ticker, context="")` → `HTTPException(404)`, `already_exists(ticker, context="")` → `HTTPException(400)`. Routers raise these rather than constructing `HTTPException` inline.
- Background/batch instrumentation (`backend/services/job_runs.py` `record(job_id, trigger)`) logs failures via the stdlib `logging` module (`log.warning(..., exc_info=True)`) and **never lets instrumentation failure break the job body** — the body runs uninstrumented if recording fails.
- Ticker validation: `is_valid_ticker(ticker)` in `services/utils.py` (regex `^[A-Za-z0-9.\-]{1,15}$` after strip/upper).

### Startup migrations: idempotent DDL in `main.py`

`backend/main.py` `_migrate()` runs additive, idempotent DDL on startup — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` — each in its own `try/except` that `print`s `[migrate] ... 실패` on error so one failure doesn't block the rest. Base schema lives in `backend/auth_schema.sql` then `backend/app_schema.sql`; `_migrate()` carries deltas applied automatically on deploy.

### Naming & idioms

- snake_case functions/vars; leading underscore for module-private helpers (`_yf_sym`, `_safe`, `_migrate`, `_norm_sector`).
- `from __future__ import annotations` at the top of newer modules; `X | None` union types.
- Comments and docstrings are predominantly **Korean**; match that when editing.
- Money/unit normalization helpers live in `services/market/format.py`: `_to_won` (억원→원), `_fmt_price`/`_fmt_market_cap` (KR `₩…억/조` vs US `$…B`), `_norm_sector` (yfinance sector → canonical).

## Frontend

### React function components, no TailwindCSS

- All components are function components (React 19) under `frontend/src/components/` and pages under `frontend/src/pages/`. JSX files use `.jsx`.
- Styling is **plain CSS**: design tokens + component CSS files, plus **inline `style={{...}}`** for dynamic/computed values. No utility-class framework.

### Design tokens — `frontend/src/styles/tokens.css`

CSS custom properties on `:root` (with a `[data-theme="dark"]` override block). Spacing (`--space-1..6`), radius (`--radius-*`), shadows, font stacks, and color tokens. Components reference `var(--token)` rather than hard-coding values. Other global stylesheets: `frontend/src/styles/pc.css`, `frontend/src/styles/mobile.css`, plus `frontend/src/index.css` / `frontend/src/App.css`.

### KR color convention + the success/danger badge inversion

- **`--up` = red `#d83a3a` (상승), `--down` = blue `#2864e8` (하락)** — Korean market coloring, the inverse of Western convention. Defined in `tokens.css`.
- Consequence in `frontend/src/components/ui/Badge.css`: `.badge--success` maps to `--up` (red), `.badge--danger` maps to `--down` (blue). So the `success`/`danger` Badge variants are **price-direction** colors, not Western good/bad. `frontend/src/components/ui/Badge.jsx` `ChangeBadge` correctly uses `value >= 0 ? 'success' : 'danger'` (gain → red, loss → blue).
- **Gotcha (live-UAT-caught):** semantic state badges (e.g. supply/demand bands) must NOT reuse `success`/`danger` or they invert against Western intent. `frontend/src/components/ui/SupplyBadge.jsx` instead specifies explicit colors inline (우호=green, 중립=gray via `neutral`, 경계=orange) and never uses the price tokens. UI review must compare against the actual token value, not the variant name's connotation. (`warning` variant is effectively unusable — its `--color-warning`/`--warning-tint` tokens are undefined.)

### Finite-guarded formatters

User-facing number formatting always guards against `null`/non-finite and falls back to a dash:

- `fmtPrice(val, market)` in `frontend/src/utils.js`: `if (val == null || !Number.isFinite(Number(val))) return '—'`; KR → `₩` + `toLocaleString('ko-KR')`, US → `$` + `toFixed(2)`.
- KR unit formatters live in `frontend/src/components/market/marketUtils.jsx` (억/조 thresholds) — input assumed in 억원; raw 원/주 must be converted first (see `CLAUDE.md` "35조경원" gotcha).
- `frontend/src/utils.js` is the small shared formatter module; component-local `fmt` helpers follow the same null/finite-guard-then-dash shape.

### Other frontend conventions

- API calls go through `frontend/src/api.js` (axios); Vite proxies `/api/*` to `http://localhost:8000` in dev, or `VITE_API_BASE_URL` in deploy.
- Vite 8 = rolldown bundler — `build.rollupOptions.output.manualChunks` in `frontend/vite.config.js` must be the **function** form (`manualChunks(id)` switching on `node_modules` substrings); the object form breaks the build.
- Korean is the primary UI language; comments are Korean. Match existing style.

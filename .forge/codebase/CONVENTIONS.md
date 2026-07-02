---
last_mapped_commit: 40662f153ae0d9e86f1c77de85e9c7ecf509225c
mapped: 2026-07-02
---

# CONVENTIONS

Coding conventions and recurring patterns for PortfoliOn (Python/FastAPI backend + React 19/Vite frontend, plain CSS). Implementation facts only — for term definitions see `.forge/CONTEXT.md`.

## Backend (Python / FastAPI)

### Service-layer separation
Routers (`backend/routers/`) hold HTTP/validation only and delegate data work to `backend/services/`. Routers import services at the top, e.g. `routers/watchlist.py` does `from services import storage, errors, cache as cache_svc, report_generator, ...` and `from services.db import query as db_query`. Business logic, external fetches, and persistence live in services; routers wire them to endpoints.

### DB access — `services.db`
All SQL goes through `backend/services/db.py`:
- `query(sql, params) -> list[dict]` for SELECT (uses `RealDictCursor`, returns dict rows).
- `execute(sql, params) -> int` for INSERT/UPDATE/DELETE (returns rowcount).
- `get_connection()` is a context manager that commits on success / rolls back on exception, drawing from a module-level `ThreadedConnectionPool` (`minconn=1`, `maxconn=20`). The pool max (20) is deliberately set **above** the largest `ThreadPoolExecutor` worker count (calendar 15, analysis 11) because psycopg2's pool raises `PoolError` rather than blocking when exhausted.

### NaN/inf JSON-500 safety (mandatory for value-bearing responses)
starlette `JSONResponse` is `allow_nan=False`, so any `NaN`/`inf` in a response dict serializes to a **500** (`Out of range float values are not JSON compliant`). Two guard layers, used together:
- **Source guard** — `math.isfinite(...)` checks where external values enter (preferred; cleaner than blanket output sanitization). Used across `routers/stocks.py`, `routers/recommendations.py`, `services/digest_service.py`, `services/indicators.py`, `services/report_generator.py`, `services/analysis_service.py`, `services/us_supply.py`, `services/recommendation/funnel.py`, `services/market_indicators/indices.py`, `services/market/format.py`.
- **Output sanitize** — `services.utils.sanitize(obj)` (`backend/services/utils.py`) recursively walks dicts/lists and maps any non-finite float to `None`. Wrap a whole response dict before returning when NaN could enter from many places (e.g. the `_build_all` dashboard build). Consumers: `routers/stocks.py`, `routers/recommendations.py`, `routers/report.py`, `services/report_generator.py`, `services/leverage_service.py`, `services/lending_service.py`, `services/market_indicators/indices.py`.

Storage trap: PostgreSQL rejects `NaN` in a `json` column (save fails), but Python `json.dumps` defaults to `allow_nan=True` so a **file fallback silently succeeds** — DB-fail / file-pass / response-serialize-fail produces split symptoms. Guard at the source.

### DB NUMERIC → Decimal: coerce `float()` before float arithmetic
psycopg2 returns SQL `NUMERIC` columns as Python `Decimal`. Mixing `Decimal` with `float` (external quotes, ratios, FX) raises `TypeError`. Always `float()`-coerce DB-sourced numerics before arithmetic with floats/external values. See `routers/stocks.py`:
```python
yield_on_cost = round(float(annual_div) / float(avg_cost) * 100, 2)   # line 385
expected_income = round(float(annual_div) * float(qty), 2)            # line 387
total_value += float(price) * float(qty) * fx                         # line 457
```
(The dashboard `yield_on_cost` bug came from omitting this coercion.)

### yfinance percent fields are 0-1 fractions → ×100 at display
yfinance `t.info` percent fields (`dividendYield`, etc.) are returned as **fractions (0-1)**, not whole percents. Multiply by `100` at display, and keep the scale consistent with the documented/fixture value (match doc/fixture scale). `services/dividends.py` notes the current yfinance scale inline; the cross-cutting rule is to verify the live scale and `×100` at presentation, never store a half-converted value. Related label trap: yfinance `get_income_stmt()`/`get_balance_sheet()`/`get_cashflow()` *methods* use no-space index labels (`OperatingCashFlow`) while the `.income_stmt`/`.cash_flow` *properties* use spaced labels (`Operating Cash Flow`); `format._yf_val` does exact matching and returns `None` silently on mismatch, so `services/market/us.py` must use the `get_*` methods consistently.

### Module logger + de-silenced broad excepts
Near-universal convention across `backend/services/` and `backend/routers/`: a module logger declared at the top —
```python
import logging
logger = logging.getLogger(__name__)
```
34 backend service/router files now carry it (`grep -rl "logging.getLogger(__name__)" backend/services backend/routers | wc -l`). Broad fallback handlers **log before falling back** rather than swallowing silently:
```python
except Exception as e:
    logger.warning(f"[Tag] <what failed> ({ctx}): {e}")
    return None   # or skip / keep last-good — fallback unchanged
```
The warning message carries a `[Tag]` prefix + Korean context + `{e}` (see `services/market/kr.py`, `services/agm.py`, `services/disclosures.py`). This is **log-only**: control flow is byte-identical — the `except` block still returns its fallback; only a `logger.warning` line was prepended. **Narrow value-coercion excepts (`ValueError`/`TypeError`/`KeyError`) are deliberately left un-logged** — they are the expected path (parse/coerce miss), not a diagnosable failure. Retry/re-raise blocks were also left as-is.

Not everything routes through the logger: several deliberate `print(...)` diagnostics survive unchanged (e.g. `routers/stocks.py:499` `... 최소카드 폴백: {e}` to `sys.stderr`, and `report_generator.py`'s `[Report]`/`[Backfill]` stamping lines) — these are load-bearing grep anchors and intentional stdout/stderr diagnostics, not converted.

### Graceful external-fetch — "wrong < missing"
External fetches (yfinance, DART, KOFIA, Naver, FRED, Kiwoom, KIS) must fail gracefully: a fetch failure yields `None`/skip, never a fabricated default. A wrong default (e.g. assuming "억원" units when a caption parse fails → ×100 over-store) is worse than a missing value. Extraction failures resolve to pending/`None`, not a guessed value. Do **not** silently swallow fetch exceptions — log them via the module logger (see above; the "silent `except` defeats diagnosis" aspiration is now largely realized backend-side — broad fetch excepts log before their fallback). And do **not** persist empty/all-`None` batch results into the cache (skip the save, keep the last good value). (The remaining silent-swallow surface is frontend — e.g. `frontend/src/hooks/usePortfolioData.js` `.catch(() => {})` / `// silent`, where a failed fetch is tolerated ephemerally and retried next tick.)

### `_yf_sym` for yfinance symbols
`backend/services/market/format.py:_yf_sym(ticker, market, exchange)` builds the yfinance symbol: KR → `f"{ticker}.{suffix}"` (suffix from exchange, default `KS`); US → `ticker.replace(".", "-")` (e.g. BRK.B → BRK-B). Used throughout `services/market/__init__.py` and `services/market/us.py`. Companion helpers in the same file: `_yf_val` (exact index/column match — silently returns `None` on label mismatch), `_safe_pct` / `_safe_ratio` (finite-guarded division), `_to_won`, `_fmt_price`, `_fmt_market_cap`.

### No live external calls at request-time
Batch-backed views (rankings, KR sector momentum, market indicators) must **not** call external APIs on the request or startup path. Batches precompute into `market_cache` / tables; requests read stored values only. (Per-request serial fetches add seconds of latency and re-fetch on every cache expiry.)

### Lazy imports for circular references
When two modules import each other (notably `storage` ↔ `cache`), defer the import inside the function. Example — `services/storage/names.py`:
```python
def ...:
    """storage↔cache 순환참조 회피용 지연 import."""
    from services import cache as cache_svc
```

### Route ordering — register specific paths BEFORE catch-all `/report/{ticker}/{date_str}`
In `backend/routers/report.py` the catch-all `@router.get("/report/{ticker}/{date_str}")` (line 437) matches any two-segment path, so every more-specific `/report/{ticker}/<word>` route (`/us-supply`, `/backlog`, `/disclosures`, `/insider-trades`, `/us-insider`) must be **declared before** it — otherwise the literal segment (e.g. `backlog`) is captured as `date_str` and the snapshot read fails. Inline comments at lines 374/395/404/412/421 document this. (Same class of bug as the `PUT /api/stocks/enrich/batch` before `/enrich` ordering in `routers/stocks.py`.)

## Frontend (React 19 / Vite, plain CSS)

### Function components + inline styles + tokens
Components are plain function components. Styling is a mix of inline `style={{...}}` objects and shared CSS-variable tokens defined in `frontend/src/styles/tokens.css`. Reusable inline style objects are exported from util modules (e.g. `components/reports/reportUtils.jsx` exports `TH`/`TD`/`MetricCard`/`SectionTitle`; `components/market/marketUtils.jsx` exports `CARD_STYLE`/`SECTION_STYLE`/`SectionCard`). No TailwindCSS.

### KR color convention — `--up` = red, `--down` = blue (and the badge inversion gotcha)
`frontend/src/styles/tokens.css`: `--up: #d83a3a` (red = 상승/up), `--down: #2864e8` (blue = 하락/down) — the Korean market convention, inverted from Western. **Gotcha:** `components/ui/Badge.css` wires `.badge--success` → `var(--up)` (red) and `.badge--danger` → `var(--down)` (blue). So a `success`/`danger` *semantic* badge renders in the KR *price* colors, inverting the Western good=green / warning=red intent. For non-price semantic state badges use a dedicated-color component (e.g. `ui/SupplyBadge.jsx`), never `success`/`danger` variants. `.badge--warning` references undefined `--color-warning`/`--warning-tint` and is currently broken — unusable for caution.

### US-only / KR-only section guards on `market`
KR-specific report sections gate on `market === 'KR'` and US-only sections gate on `market !== 'KR'` (returning `null` early). Examples in `frontend/src/components/reports/`: `DetailTab.jsx` (lines 642/648 — backlog KR-only), `InsiderTradesSection.jsx`, `LatestDisclosuresSection.jsx` (KR-only), `GuruHoldersSection.jsx` (US-only via `market === 'KR'` → return), `ConsensusChart.jsx`, `FinancialsChart.jsx` (`const isKR = market === 'KR'`).

### `fmtPrice` / `fmt` are finite-guarded
`frontend/src/utils.js` `fmtPrice(val, market)` returns `'—'` when `val == null || !Number.isFinite(Number(val))`; KR formats `₩` with `toLocaleString('ko-KR')` (0 fraction digits), US formats `$` with `.toFixed(2)`. Other formatters follow the same null/finite-guard-then-format shape (`components/reports/reportUtils.jsx:fmtN`, `components/market/marketUtils.jsx:krFmt`). `krFmt` assumes **억원** input (10,000억 = 1조 threshold) — convert won via `/1e8` first; raw won/share counts misformat by 1e8.

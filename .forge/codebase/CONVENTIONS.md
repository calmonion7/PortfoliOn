---
last_mapped_commit: fd8dd650ede08d103b907ac4d87955f669ce3298
mapped: 2026-06-15
---

# PortfoliOn Conventions

## Backend — Python Services Architecture

### Module Structure
- **Location**: `backend/services/` (29 modules)
- **Pattern**: Module-level functions only (no classes mostly), one concern per module
  - `market.py` — quote fetching & normalization (_norm_sector, _naver_get, _fnguide_market_cap, get_quote_kr, get_quote_us, get_financials_kr)
  - `kr_sector_service.py` — KR sector momentum (momentum_from_closes, load_momentum, refresh)
  - `job_runs.py` — batch instrumentation (record context manager, recent, recent_map)
  - `cache.py` — TTLCache, snapshot/dashboard/sector/macro caches (get_snapshot, invalidate, get_dashboard)
  - `kiwoom/`, `kis/` — KR market data sources (lazy imports to avoid circular deps)

### Import Pattern: Lazy Inside Functions
- External service imports placed inside function bodies, not at module top
  - Example: `from services.kiwoom import client, quote as kq` inside `_kr_basic_kiwoom()`
  - Prevents circular dependencies between storage↔cache, market↔kiwoom
- Standard imports (json, os, re, logging) remain at module top

### Data Normalization Helpers
- `_num(val: str) → float | None` — Convert numeric string with commas/signs to float; None on invalid/empty/'-'/'+'
- `_to_won(val) → int | None` — Convert 억원 (100M KRW) to 원 (KRW); handles both 억원 and absolute values (threshold 1e10)
- KIS quote responses use 억원 for market_cap (hts_avls field); normalized to won via `_to_won()` or `× 1e8`
- Naver/KIS return sign-included strings; parsed as `_num()` or explicit string handling (e.g., prdy_ctrt)

### External API Calls & Error Handling
- **Failure mode**: Log warnings, don't silently swallow (backlog.py logs via logger.warning)
- **Cache poisoning**: Never store empty results; e.g., kr_sector_service.refresh() skips save if all sectors None
- **Graceful degrade**: TTL cache (cache.py) auto-prunes expired; job_runs.record continues if DB unavailable (run_id=None sentinel)
- **HTTP error propagation**: Naver 409 (상폐=delisted) surfaces in get_quote_kr; KIS/Kiwoom failures raise for caller polyfill

### Batch-Backed View Pattern
- **Storage**: `market_cache` table (key, data JSON, fetched_at)
- **Access**: `_mc_load(key: str) → dict | None`, `_mc_save(key: str, data: dict) → None`
  - Both gracefully handle DB exceptions (log warning, no-op on failure)
- **Request path**: Live API calls forbidden from request handlers; use pre-computed batch results (kr_sector_service.load_momentum, load_sector_index)
- **Refresh**: Batch scheduler (_fetch_kr_sector) runs daily, records via job_runs.record context manager

### Job Instrumentation via job_runs.record
- **Context manager** wrapping batch execution:
  - Enter: INSERT job_runs (running), prune to keep 20 per job_id
  - Exit (success): UPDATE status=success
  - Exit (exception): UPDATE status=failed with error string, then re-raise
  - DB unavailable: Log warning, continue with run_id=None, no UPDATE on exit
- **Observability-only**: Never breaks batch body (all DB ops gracefully degrade)
- **Note**: success flag doesn't guarantee partial success; check batch body logs (many jobs catch internal exceptions)

### Ticker Normalization
- `is_valid_ticker()` — Format check: strip, upper, 1–15 chars, alphanumeric + '.' + '-' only
- `find_ticker()`, `ticker_exists_in()` — Case-insensitive lookup via upper()
- KR tickers: 6-digit code optionally with .KS/.KQ suffix (exchange); US: symbol + optional exchange hint

## Frontend — React 19 Components

### Rendering Pattern
- **React 19 function components** with hooks (useState, useEffect, custom hooks)
- **No build-time framework** (no Next, no Remix); client-side only
- **Verification**: `npm run build` compiles to static assets (no unit tests; visual QA in browser)

### Styling & Layout
- **No Tailwind** — Plain CSS files in `frontend/src/styles/`
- **CSS variables**: `--bg`, `--bg-elev`, `--text`, `--text-3`, `--accent-soft`, `--border`, `--shadow-sm`
- **Responsive**: Media queries in `.tabs`, `.topnav-tab.is-active`, `.filter-chip.is-active`

### Tab & Toggle Patterns
- **Local state**: `const [tab, setTab] = useState('holdings')`
- **CSS class toggle**: `className={tab === 'holdings' ? 'is-active' : ''}`
- **Segment pattern**: `.tabs > button.is-active` applies background/highlight
- **Analytics**: trackEvent() on user actions (Portfolio.jsx)

### API Integration
- **HTTP client**: axios instance (`import api from '../api'`)
- **Endpoint pattern**: `/api/*` (portfolio, watchlist, stocks, analysis/sector, batches, etc.)
- **Error handling**: err.response?.data?.detail for server messages; fallback strings

### Components & Composition
- **DashboardCard** — Holdings grid item rendering (current_price, quantity, sector)
- **StockModal** — Add/edit form with search via `/api/stocks/search`
- **PriceFreshness** — Market hours label display (krFreshnessLabel utility)
- **FlashValue** — Animate value changes (visual feedback on price updates)
- **LoadingSpinner** — Centered spinner with custom label
- **Toast** — useToast hook for notifications (success/warning/error)

### Hooks & State Management
- **usePortfolioData()** — Fetch holdings, watchlist, price tick, fx, last updated
- **useIsMobile()** — Responsive detection
- **Custom hooks**: Encapsulate side effects, cache fetches (with pollfn for report generation)

### Common Props/Utils
- **fmt utility**: Format numbers per market (USD: $, KRW: ₩)
- **Icons**: Search, Plus, Spark, MarketBadge (icon set from ui/icons)
- **Market detection**: market field ('US' or 'KR') drives price format, API path selection

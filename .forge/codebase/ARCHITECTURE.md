---
last_mapped_commit: 504b6e098488b3d8bdd2c2ebdf69a9c9151df32f
mapped: 2026-06-16
---

# PortfoliOn Architecture

## System Overview

PortfoliOn is a multi-user stock portfolio management and analysis SPA. Users track KR (Korean) and US stocks, view market indicators, access research reports, and monitor watchlists.

**Tech Stack:**
- Backend: Python FastAPI (single-process) + APScheduler
- Frontend: React 18 + Vite SPA
- Database: PostgreSQL
- Infrastructure: Docker Compose (backend + frontend + PostgreSQL)
- External APIs: yfinance, Naver Stock API, FnGuide, FRED, DART, Cowork (AI text generation)

## Architectural Layers

### 1. Request Path (HTTP API → DB)

**Entry:** `backend/main.py` mounts 18 routers via FastAPI:
- `routers/{portfolio,report,watchlist,stocks,guru,calendar,digest,analytics,analysis,market_indicators,auth,admin,events,rankings,investor,short_sell,batches}`

**Pattern:** Router → Service → PostgreSQL
- Routers (`routers/*.py`) handle HTTP contracts, auth, input validation
- Services (`services/*.py`) hold business logic, external API calls, DB queries
- Storage (`services/storage.py`) abstracts user-specific & global portfolio operations
- DB (`services/db.py`) provides connection pooling + query/execute helpers

**Example flow:**
```
POST /api/portfolio/stocks (router)
  → storage.get_all_stocks(user_id) [service call]
    → query("SELECT * FROM tickers WHERE ticker IN (...)") [db.py]
      → PostgreSQL result → JSON response
```

### 2. Batch Scheduler (APScheduler)

**Entry:** `backend/scheduler.py` starts APScheduler on app lifespan.

**Batch Registry:** `services/batch_registry.py` defines 20 static batch entries (metadata: id, label, category, schedule, market field, editable status).

**Batch Categories:**
1. **Report Generation** (4 batches)
   - `daily_report_kr` (20:30 KST, KR stocks)
   - `daily_report_us` (07:00 KST, US stocks)
   - `disclosure_fetch` (07:30 KST, KR public notices—DART API)
   - `consensus` (inline during report generation, no standalone job)

2. **Market Data Refresh** (12 batches)
   - Earnings: `earnings_kr` (KR Top2), `earnings_us` (M7)
   - Monthly indicators: `monthly_kr` (KR exports), `monthly_us` (FRED econ)
   - Supply/demand: `leverage_fetch`, `lending_fetch`, `investor_trend_fetch`, `short_sell_fetch`
   - Rankings: `kr_rankings_fetch`, `us_rankings_fetch`
   - Macro signals: `macro_signals_fetch` (FRED 4-series: T10Y2Y, HY OAS, M2, DFF)
   - Dividends: `dividend_fetch` (yfinance US + DART KR)

3. **Analysis & Admin** (4 batches)
   - `kr_sector_fetch` (KR sector momentum)
   - `daily_digest` (morning market summary)
   - `backlog_fetch` (order backlog data for KR)
   - `guru_crawl` (fund manager profile scraping)

**Job Execution Model:**
- Editable batches (16/20): schedule stored in `batch_schedules` table; can be modified via Settings UI
- Fixed batches (4/20): hardcoded default schedule (consensus, digest, backlog, sector momentum)
- Each batch logs execution start/end/status to `job_runs` table (20-row rotating keep)

**On startup:**
1. `_seed_batch_schedules()`: Migrate legacy `schedules` table into unified `batch_schedules`
2. `_check_missed_report()`: If current market's report was missed, regenerate now
3. `_seed_rankings_if_empty()`: Pre-seed empty rankings to avoid blank tab on startup
4. APScheduler jobs registered for all enabled batches

### 3. Report Generation Data Flow

**Trigger:** Batch scheduler calls `_generate_kr()` / `_generate_us()` at scheduled times.

**Execution:**
1. Query all user-owned stocks filtered by market (KR vs US)
2. For each stock:
   - `report_generator.generate_report_with_retry(stock)` fetches yfinance quote, financials, analyst data, RSI, news, finviz consensus (US only)
   - Creates JSON snapshot in `backend/snapshots/{ticker}/{date}.json`
   - Stores metadata in `snapshots` PostgreSQL table
3. `consensus_pipeline.run_daily(stocks)` normalizes analyst opinions (KR: FnGuide/Naver Research; US: finviz) into 5-point scale, upserts `consensus` table

**Data Precomputation:**
- `report_generator.generate_report()` calls services in parallel (ThreadPoolExecutor, max_workers=8):
  - `market.get_quote()`: yfinance or Naver API
  - `market.get_financials()`: income stmt, balance sheet, cash flow
  - `market.get_analyst_data()`: target price, P/E ratios, consensus
  - `indicators.get_timeframe_rsi()`: RSI at daily/weekly/monthly
  - `scraper.scrape_finviz_consensus()`: finviz scraper (US)
  - `scraper.get_news()`: news headlines
  - Competitors analyst data fetched from storage

**External Enrichment:**
- Cowork API (`/api/cowork/...`) generates AI text (analyst_summary, etc.) — called by frontend on report view, NOT backend
- Backend stores NO AI-generated text; snapshots hold only market data & metadata

### 4. Market Data Cache & Batch-Precompute Pattern

**Core Principle:** External APIs (키움/DART/FRED/yfinance) are fetched **ONLY in batches**, never on request path. Request path reads stored values from cache/tables.

**Precomputed Batches (read from cache, NOT on-demand):**
- **KR Exports** (monthly, `market_indicators/kr_exports` table) — KOSTAT
- **US Econ Indicators** (FRED: unemployment, inflation, 10Y yield, etc.)
- **KR Top2 Earnings** (Samsung, SK Hynix quarterly results) — Naver API
- **M7 Earnings** (Apple, Microsoft, etc. quarterly) — yfinance
- **Macro Signals** (FRED 4-series — T10Y2Y yield curve inversion, HY OAS credit stress, M2, DFF) → signals computed (inverted, credit_stress)
- **Stock Dividends** (KR: DART alotMatter.json annual dividend per share + yield; US: yfinance dividendRate/Yield) → stored in `stock_dividends` table
- **Stock Disclosures** (KR: DART list.json core types A/B/C/D) → stored in `stock_disclosures` table
- **KR Leverage/Shortselling** (신용거래, 공매도 추이) — Kiwoom
- **KR Lending Balance** (대차잔고) — monthly
- **Rankings** (KR: 거래량/상승률 intraday; US: 52w high/low)
- **KR Sector Momentum** (업종별 수익률)
- **Investor Trend** (foreign/institutional/retail supply/demand by ticker) — Kiwoom ka10033

**Cache Invalidation:** No explicit invalidation; batches re-run on schedule → data refreshed in-place.

**Access Pattern:**
- Frontend queries `/api/market/indicators/{category}`, `/api/report/{ticker}/disclosures`, `/api/stocks/dashboard` → reads cache tables
- If cache empty on first load, batch runs automatically (see scheduler startup)

### 5. User/Auth Layer

**Entry:** `routers/auth.py` + `services/auth_service.py`

**Multi-User Model:**
- OAuth2 (Google/Naver) → JwtBearer tokens (access + refresh)
- Session-based fallback (SessionMiddleware for form-based auth)
- User scoped to `user_id` (UUID or email); all portfolio/stock data belongs to user

**Admin Operations:**
- `routers/admin.py`: batch schedule edits, permission management
- `routers/events.py`: user activity tracking (for analytics)
- `AdminAnalytics` page: daily/weekly user aggregates (signups, report views, portfolio changes)

## Key Abstractions

### 1. Batch Registry (20 Batches)

Each batch has a `market` field (KR/US/공통):
- **KR-only:** daily_report_kr, earnings_kr, monthly_kr, leverage_fetch, lending_fetch, kr_rankings_fetch, investor_trend_fetch, short_sell_fetch, kr_sector_fetch, backlog_fetch, disclosure_fetch
- **US-only:** daily_report_us, earnings_us, monthly_us, us_rankings_fetch, macro_signals_fetch
- **공통 (shared):** consensus, daily_digest, guru_crawl, dividend_fetch

### 2. Portfolio Models

**User Portfolio:**
- `user_stocks` table: (user_id, ticker, type, quantity, avg_cost)
- Type: 'holding' (owns) or 'watchlist' (tracks)

**Global Portfolio:**
- `tickers` table: (ticker, name, market, exchange, competitors, moat, growth_plan, risks, recent_disclosures, insights, is_etf)

### 3. Snapshot & Report Model

**Snapshot:**
- File: `backend/snapshots/{ticker}/{YYYY-MM-DD}.json`
- Contents: Quote, financials, analyst data, RSI, news, consensus opinion
- DB link: `snapshots` table stores metadata (ticker, date, user_id, views, created_at)

**Report Detail:**
- Frontend fetches snapshot + consensus + analyst profile → renders dashboard

### 4. Disclosure & Dividend Tables

**`stock_disclosures` (KR-only, DART):**
- Columns: rcept_no (PK), ticker, rcept_dt, report_nm, pblntf_ty (A/B/C/D), corp_name, fetched_at
- Upserted daily by `disclosure_fetch` batch (07:30 KST)
- Accessed via `GET /api/report/{ticker}/disclosures`

**`stock_dividends` (both KR & US):**
- Columns: ticker (PK), annual_dividend_per_share, dividend_yield, currency (KRW/USD), source (dart/yfinance), fetched_at
- Upserted weekly by `dividend_fetch` batch (05:00 KST)
- Joined by dashboard when computing yield_on_cost

### 5. Macro Signals Table

**`market_macro_signals` (US macro data):**
- Stores FRED 4-series time-series + derived signals (inverted yield curve, credit stress)
- Accessed via `GET /api/market/macro-signals`
- Signals computed by `macro.evaluate_signals()` (pure function on time-series)

### 6. Cowork Integration (NO LLM in Backend)

- **Entry:** Frontend calls `POST /api/cowork/generate-text` with (stockObj, reportType, tone)
- **Backend role:** None — Cowork is frontend-only, generates analyst_summary/sentiment async
- **Reasoning:** Avoids backend latency for external API; frontend can stream/cancel; no cache needed (stateless generation)

## Data Flow Summaries

### Daily Report Generation
```
Scheduler → scheduler.py:_generate_kr()
  → storage.get_all_stocks(user_id, market='KR')
    → report_generator.generate_report_with_retry(stock)
      → (parallel ThreadPool, max_workers=8):
         • market.get_quote()
         • market.get_financials()
         • market.get_analyst_data()
         • indicators.get_timeframe_rsi()
         • scraper.scrape_finviz_consensus()
         • scraper.get_news()
      → snapshot saved: backend/snapshots/{ticker}/{date}.json
      → snapshots table: upsert(ticker, user_id, date, ...)
  → consensus_pipeline.run_daily(all_stocks)
    → (FnGuide/Naver/finviz scrape if cache miss)
    → consensus table: upsert(ticker, buy, hold, sell, target_mean)
  → job_runs table: log success
```

### Disclosure Fetch Batch
```
Scheduler → scheduler.py:_fetch_disclosures()
  → services.disclosures.fetch_all_disclosures()
    → query: user_stocks ∩ tickers WHERE market='KR' AND type IN ('holding', 'watchlist')
    → for each ticker:
       → _corp_code(ticker) [backlog cache map]
       → for each core type (A/B/C/D):
          → DART list.json(corp_code, pblntf_ty=type, bgn_de=30d_ago)
          → parse items → {rcept_dt, report_nm, pblntf_ty, rcept_no, corp_name}
       → upsert_disclosures(ticker, rows)
          → INSERT INTO stock_disclosures ON CONFLICT (rcept_no) DO UPDATE
  → job_runs table: log {total, ok, failed}
```

### Dividend Fetch Batch
```
Scheduler → scheduler.py:_fetch_dividends()
  → services.dividends.fetch_all_dividends()
    → query: user_stocks ∩ tickers WHERE type IN ('holding', 'watchlist')
    → for each (ticker, market):
       → market == 'KR':
            → fetch_kr_dividend(ticker)
              → _corp_code(ticker)
              → DART alotMatter.json(corp_code, reprt_code=11011[annual], year=recent_biz_year)
              → parse '주당 현금배당금(원)' + '현금배당수익률(%)' for common stock (보통주)
              → return {annual_dividend_per_share, dividend_yield, currency='KRW', source='dart'}
       → else (US):
            → fetch_us_dividend(ticker)
              → yfinance Ticker(ticker).info
              → extract dividendRate, dividendYield
              → return {annual_dividend_per_share, dividend_yield, currency='USD', source='yfinance'}
       → if result not None: upsert_dividend(ticker, d)
          → INSERT INTO stock_dividends ON CONFLICT (ticker) DO UPDATE
  → job_runs table: log {total, ok, failed}
```

### Macro Signals Fetch Batch
```
Scheduler → scheduler.py:_refresh_macro_signals()
  → services.market_indicators.macro._fetch_and_save_macro_signals()
    → FRED_API_KEY from environment
    → stored = _mc_load("macro_signals") [get previous cache]
    → for each series (yield_curve=T10Y2Y, hy_spread=BAMLH0A0HYM2, m2=M2SL, fed_funds=DFF):
       → prev_start = last_date from stored[key] or default_start (3Y ago)
       → _fetch_series(series_id, api_key, start=prev_start)
          → GET https://api.stlouisfed.org/fred/series/observations
          → parse {date, value} tuples, skip missing ('.')
       → _merge_history(prev, new_pts) → concat, dedup by date
    → merged["signals"] = evaluate_signals(merged)
       → inverted = (T10Y2Y < 0) ? True : False [recession warning]
       → credit_stress = (HY_OAS >= 5.0%) ? True : False [stress signal]
    → _mc_save("macro_signals", merged)
       → store to market_cache/macro_signals JSON file
  → job_runs table: log execution
```

### Request: GET /api/report/{ticker}/disclosures
```
routers.report.get_disclosures(ticker)
  → services.disclosures.get_disclosures(ticker, limit=20)
    → query stock_disclosures WHERE ticker = ? ORDER BY rcept_dt DESC
    → for each row:
       → append dart_url = _DART_VIEWER.format(rcept_no=rcept_no)
    → return [{rcept_no, rcept_dt, report_nm, pblntf_ty, corp_name, dart_url}]
  → JSON → frontend LatestDisclosuresSection renders
```

### Request: GET /api/market/macro-signals
```
routers.market_indicators.macro_signals()
  → services.market_indicators.get_macro_signals()
    → stored = _mc_load("macro_signals")
    → if stored: return stored["data"]
    → else: return {yield_curve: [], hy_spread: [], m2: [], fed_funds: [], signals: {}}
  → JSON → frontend MacroSignalsSection renders charts + signal alerts
```

### Request: GET /api/stocks/dashboard
```
routers.stocks.dashboard(user_id)
  → storage.get_all_stocks(user_id)
    → query user_stocks JOIN tickers
    → for each holding:
       → get_quote(ticker, market) [cache or yfinance/Naver]
       → get_financials(ticker, market)
       → get_consensus(ticker)
       → dividends.get_dividend(ticker) [read stock_dividends]
       → compute yield_on_cost = (annual_dividend_per_share / avg_cost) * 100
    → return {holdings: [{...holding, annual_dividend_per_share, dividend_yield, yield_on_cost}], totals: {...}}
  → JSON → frontend DashboardCard renders with dividend stats
```

## No LLM in Backend

PortfoliOn backend contains **no language model integration**. All AI-powered text generation (analyst_summary, sentiment, stock_outlook) is handled by **Cowork API called from frontend**:

- Frontend detects `recent_disclosures` field is empty/null → calls `POST /api/cowork/generate-text` (Cowork is external SaaS)
- Backend **cannot** call Cowork; it only stores/retrieves pre-generated data
- Snapshots are pure market data (quote, financials, news, analyst consensus) — no synthetic text

This architecture ensures:
- Backend stays lightweight & non-blocking (no external LLM latency)
- Frontend can handle streaming/cancellation
- All text generation is stateless & cached client-side

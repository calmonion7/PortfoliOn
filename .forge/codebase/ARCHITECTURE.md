---
last_mapped_commit: fd8dd650ede08d103b907ac4d87955f669ce3298
mapped: 2026-06-15
---

# PortfoliOn Architecture

## System Overview

PortfoliOn is a multi-user stock portfolio management and analysis SPA. Users track KR (Korean) and US stocks, view market indicators, access research reports, and monitor watchlists.

**Tech Stack:**
- Backend: Python FastAPI (single-process) + APScheduler
- Frontend: React 18 + Vite SPA
- Database: PostgreSQL
- Infrastructure: Docker Compose (backend + frontend + PostgreSQL)
- External APIs: yfinance, Naver Stock API, FnGuide, FRED, Cowork (AI text generation)

## Architectural Layers

### 1. Request Path (HTTP API → DB)

**Entry:** `backend/main.py` mounts 14 routers via FastAPI:
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

**Batch Registry:** `services/batch_registry.py` defines 17 static batch entries (metadata: id, label, category, schedule, market field, editable status).

**Batch Categories:**
1. **Report Generation** (3 batches)
   - `daily_report_kr` (20:30 KST, KR stocks)
   - `daily_report_us` (07:00 KST, US stocks)
   - `consensus` (inline during report generation, no standalone job)

2. **Market Data Refresh** (10 batches)
   - Earnings: `earnings_kr`, `earnings_us`
   - Monthly indicators: `monthly_kr` (KR exports), `monthly_us` (FRED econ)
   - Supply/demand: `leverage_fetch`, `lending_fetch`, `investor_trend_fetch`, `short_sell_fetch`
   - Rankings: `kr_rankings_fetch`, `us_rankings_fetch`

3. **Analysis & Admin** (3 batches)
   - `kr_sector_fetch` (KR sector momentum)
   - `daily_digest` (morning market summary)
   - `backlog_fetch` (order backlog data for KR)
   - `guru_crawl` (fund manager profile scraping)

**Job Execution Model:**
- Editable batches (13/17): schedule stored in `batch_schedules` table; can be modified via Settings UI
- Fixed batches (4/17): hardcoded default schedule (consensus, digest, backlog, sector momentum)
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

### 4. Market Data Cache

**Precomputed Batches (read from cache, NOT on-demand):**
- KR exports (monthly, `market_indicators/kr_exports` table)
- US econ indicators (FRED: unemployment, inflation, 10Y yield, etc.)
- KR Top2 earnings (Samsung, SK Hynix quarterly results)
- M7 earnings (Apple, Microsoft, etc. quarterly)
- KR leverage/shortselling (신용거래, 공매도 추이)
- KR lending balance (대차잔고)
- Rankings (KR: 거래량/상승률 intraday; US: 52w high/low)
- KR sector momentum (업종별 수익률)
- Investor trend (foreign/institutional/retail supply/demand by ticker)

**Cache Invalidation:** No explicit invalidation; batches re-run on schedule → data refreshed in-place.

**Access Pattern:**
- Frontend queries `/api/market/indicators/{category}` → reads cache tables
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

### 1. Batch Registry (17 Batches)

Each batch has a `market` field (KR/US/공통):
- **KR-only:** daily_report_kr, earnings_kr, monthly_kr, leverage_fetch, lending_fetch, kr_rankings_fetch, investor_trend_fetch, short_sell_fetch, kr_sector_fetch, backlog_fetch
- **US-only:** daily_report_us, earnings_us, monthly_us, us_rankings_fetch
- **공통 (shared):** consensus, daily_digest, guru_crawl

### 2. Portfolio Models

**User Portfolio:**
- `user_stocks` table: (user_id, ticker, type, quantity, avg_cost)
- Type: 'holding' (owns) or 'watchlist' (tracks)

**Global Portfolio:**
- `tickers` table: (ticker, name, market, exchange, competitors, moat, growth_plan, risks, recent_disclosures, insights, is_etf)
- Shared across all users (write-once, read-many for analyst metadata)

**Analytics:**
- `portfolio_snapshots` (user_id, date, total_value, daily_change, sector_allocation)
- `holdings_history` (user_id, ticker, date, quantity, cost_value, market_value)

### 3. Report Snapshots

**Location:** `backend/snapshots/{ticker}/{YYYY-MM-DD}.json` (file system) + indexed in `snapshots` table (ticker, date, data JSONB)

**Fields:** price, quote, financials (P/E, ROE, debt), analyst_data (targets, consensus), rsi, news, volume_profile, recent_disclosures

**Immutability:** Snapshots are write-once; used by report detail views and charting.

### 4. Consensus Pipeline

**Opinion Normalization:**
- KR opinions mapped to 5-point scale: 강력매수(5) → 매수(4) → 중립(3) → 비중축소(2) → 매도(1)
- US opinions: Strong Buy(5) → Buy/Outperform(4) → Hold(3) → Underperform(2) → Sell(1)

**Sources:**
- KR: FnGuide (우선), fallback Naver Research
- US: finviz scraper

**Storage:** `consensus` table (ticker, report_date, analyst_count, avg_score, target_mean, buy/hold/sell counts)

### 5. External Service Clients

**Services/Subpackages:**
- `services/kiwoom/` (키움 증권 API client) — KR historical data, investor trend, short-sell data
- `services/kis/` (한투 KIS API client) — KR quote, order backlog
- `services/market_indicators/` (economic data)
  - `earnings.py` (M7, KR Top2 earnings)
  - `econ.py` (FRED econ indicators)
  - `exports.py` (KR monthly exports)
  - `commodities.py`, `fx.py`, `cache.py`

## Data Flow Summary

```
User Action (Frontend)
  ↓
HTTP Router (/api/...)
  ↓
Service Layer (business logic + external APIs)
  ↓
PostgreSQL (user portfolio, snapshots, cache tables)
  ↓
JSON Response → Frontend

---

Batch Scheduler (APScheduler)
  ↓
Job Function (_generate_kr, _fetch_leverage, etc.)
  ↓
Service Layer (report_generator, market_indicators, etc.)
  ↓
External APIs (yfinance, Naver, FRED, Kiwoom, KIS)
  ↓
PostgreSQL INSERT/UPDATE (snapshots, consensus, leverage, etc.)
  ↓
Cache ready for next request
```

## No LLM in Backend

- AI text generation (analyst_summary, report commentary) **only** via Cowork API, called by **frontend** on report view
- Backend stores precomputed market data + structured metadata
- Frontend renders market data + calls Cowork on-demand for text

## Performance & Reliability

- **Parallelization:** ThreadPoolExecutor in report_generator (max_workers=8), investor_trend_fetch, short_sell_fetch
- **Connection pooling:** psycopg2 pool (maxconn=10) managed by db.py
- **Graceful degradation:** job_runs instrumentation never breaks batch execution; failed DB writes logged, not raised
- **Idempotent batches:** All batch jobs can be re-run (via manual endpoint or auto-retry); upserts prevent duplicates
- **Startup optimizations:** Calendar cache warm-up, market cache pre-load, missed-report recovery

## Deployment

- Docker Compose: `backend` (Uvicorn on port 8000), `frontend` (Vite dev server), `db` (PostgreSQL 13)
- Environment: `.env` file (SESSION_SECRET, DB credentials, API keys)
- Lifespan: FastAPI lifespan hook manages scheduler start/stop, migrations

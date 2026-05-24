<!-- generated-by: gsd-doc-writer -->
# Architecture

## System Overview

PortfoliOn is a personal stock portfolio management application with a Python/FastAPI backend and a React 18 frontend. Users manage a combined holdings and watchlist, view AI-generated analyst reports per ticker, track earnings calendars, monitor market indicators (FX, VIX, commodities, treasury yields, economic data), and view portfolio correlation analytics. The backend exposes a REST API; the frontend communicates exclusively through that API via Vite's `/api/*` proxy.

## Component Diagram

```
┌──────────────────────────────────────────────────────────┐
│  Browser (React 18 + Vite, port 5173)                    │
│  App.jsx → Pages (Portfolio, Reports, Market, Analytics, │
│            Calendar, Digest, Guru, Settings)             │
└──────────────────────┬───────────────────────────────────┘
                       │  HTTP /api/* (Vite proxy)
┌──────────────────────▼───────────────────────────────────┐
│  FastAPI (port 8000)                                     │
│  main.py — mounts routers, starts scheduler/lifespan     │
│                                                          │
│  Routers                Services                         │
│  ─────────────────       ────────────────────────────    │
│  stocks            →    storage, market, cache           │
│  portfolio         →    storage, cache                   │
│  watchlist         →    storage                          │
│  report            →    storage, report_generator,       │
│                         consensus, cache                 │
│  calendar          →    market (yfinance), file cache    │
│  market_indicators →    market_indicators_service        │
│  analytics         →    storage, cache (correlation)     │
│  digest            →    digest_service                   │
│  guru              →    guru_scraper, guru_stats,        │
│                         storage                          │
│                                                          │
│  scheduler.py (APScheduler)                              │
│    daily_report job → report_generator + consensus       │
│    guru_crawl job   → guru_scraper                       │
│    daily_digest job → digest_service (08:00 KST)         │
└──────────────────────┬───────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   backend/data/   backend/        External APIs
   (JSON files)    snapshots/      (yfinance, Naver,
                   (per-ticker/    FRED, Anthropic,
                    date JSON)     Telegram)
```

## Backend Layer

### Routers (`backend/routers/`)

| Router | Prefix | Responsibility |
|---|---|---|
| `stocks.py` | `/api/stocks` | CRUD for unified stock list, ticker search (yfinance + Naver), dashboard data, snapshot reads |
| `portfolio.py` | `/api/portfolio` | Holdings CRUD (quantity, avg cost) |
| `watchlist.py` | `/api/watchlist` | Watchlist ticker management |
| `report.py` | `/api/report` | AI report generation per ticker (Anthropic), schedule config |
| `calendar.py` | `/api/calendar` | Earnings calendar with file-based cache; parallelized yfinance calls |
| `market_indicators.py` | `/api/market` | FX rates, VIX, commodities, treasury yields, FRED economic indicators |
| `analytics.py` | `/api/analytics` | Portfolio correlation matrix (90-day returns) |
| `digest.py` | `/api/digest` | Daily digest generation and retrieval |
| `guru.py` | `/api/guru` | Guru manager data, crawl settings, stats |

### Services (`backend/services/`)

| Service | Role |
|---|---|
| `storage.py` | All reads/writes to `backend/data/*.json`; single source of truth for stocks, schedule, guru data |
| `market.py` | yfinance + Naver Finance API calls for price/financial data; used by multiple routers |
| `cache.py` | In-memory caching layer (see Caching Strategy section) |
| `report_generator.py` | Generates per-ticker analyst snapshots using Anthropic Claude; writes to `backend/snapshots/` |
| `consensus.py` | Collects and caches per-ticker consensus data in `backend/data/consensus/` |
| `market_indicators_service.py` | Fetches treasury yields (yfinance), FX, VIX, commodities, FRED economic data; own TTL cache dict |
| `digest_service.py` | Builds daily portfolio digest; sends via Telegram |
| `guru_scraper.py` | Scrapes guru manager data |
| `guru_stats.py` | Computes stats from guru manager data |
| `indicators.py` | Technical indicator calculations (e.g., RSI) |
| `charts.py` | Chart data preparation |
| `scraper.py` | General web scraping utilities |
| `utils.py` | NaN/Inf sanitization for JSON serialization |

## Frontend Layer

### Pages (`frontend/src/pages/`)

| Page | Route | Purpose |
|---|---|---|
| `Portfolio.jsx` | `/` | Holdings and watchlist management; stock add/remove/promote |
| `Reports.jsx` | `/reports` | Per-ticker AI analyst report viewer |
| `Calendar.jsx` | `/calendar` | Earnings event calendar |
| `Digest.jsx` | `/digest` | Daily digest display |
| `Market.jsx` | `/market` | Market indicators dashboard (FX, VIX, treasuries, commodities, FRED) |
| `Analytics.jsx` | `/analytics` | Correlation heatmap (SVG) for holdings |
| `Guru.jsx` | `/guru` | Guru manager data and sub-pages |
| `Settings.jsx` | `/settings` | Report schedule, guru crawl schedule, app settings |

Sub-pages rendered within Guru: `GuruManagers.jsx`, `GuruStats.jsx`, `GuruCrawlSettings.jsx`, `ReportSchedule.jsx`.

### Components (`frontend/src/components/`)

| Component | Purpose |
|---|---|
| `StockModal.jsx` | Add/edit stock modal |
| `PromoteModal.jsx` | Promote watchlist ticker to holding |
| `reports/ConsensusChart.jsx` | Consensus data chart |
| `reports/FinancialsChart.jsx` | Financials chart |
| `reports/DetailTab.jsx` | Report detail tab view |
| `reports/HistoryTab.jsx` | Report history tab view |
| `reports/Sections.jsx` | Report section renderers |
| `reports/reportUtils.jsx` | Shared report rendering utilities |

## Data Flow

### Typical request: view dashboard

1. Browser calls `GET /api/stocks/dashboard` via Vite proxy.
2. `stocks` router calls `cache_svc.get_dashboard(loader)`.
3. If cache hit (TTL 300s), returns cached list immediately.
4. If miss, loader calls `storage._get_unified()` → reads `backend/data/stocks.json`, then calls `market.py` for live prices in parallel, passes through `utils.sanitize` to strip NaN/Inf, writes result to dashboard cache.
5. JSON response returned to React page.

### Typical mutation: add stock

1. `POST /api/portfolio` or `PUT /api/watchlist`.
2. Router calls `storage.save_holdings()` or `storage.save_watchlist_tickers()` → writes `stocks.json`.
3. Router calls `cache_svc.invalidate(ticker)` → clears snapshot LRU, list TTL, dashboard TTL, and correlation TTL caches.

### Scheduled report generation

1. APScheduler fires `daily_report` job at configured cron time.
2. `_generate_all()` iterates all holdings from `storage.get_full_portfolio()`.
3. For each holding: `report_generator.generate_report(stock)` → calls Anthropic API → writes JSON to `backend/snapshots/{TICKER}/{YYYY-MM-DD}.json`.
4. Also calls `consensus_svc.collect(ticker)` → writes to `backend/data/consensus/{ticker}.json`.

## Caching Strategy

All caching lives in `backend/services/cache.py`. There are four independent caches:

| Cache | Type | TTL / Size | Invalidated by |
|---|---|---|---|
| `_snapshots` | LRU dict (`OrderedDict`) | Max 200 entries | `cache.invalidate(ticker)` on stock mutations |
| `_list_cache` | `TTLCache` | 5 seconds | Same as above |
| `_dashboard_cache` | `TTLCache` | 300 seconds | Same as above; manual `DELETE /api/stocks/dashboard/cache` |
| `_correlation_cache` | `TTLCache` | 300 seconds | Same as above |

`market_indicators_service.py` maintains its own separate in-process dict cache with per-key TTL (not shared with `cache.py`).

`backend/data/calendar/` holds file-based cache per month (`YYYY-MM.json`). This cache is invalidated on stock add/remove/promote operations and can be cleared manually via `DELETE /api/calendar/cache?month=YYYY-MM`.

## Scheduler

`backend/scheduler.py` uses APScheduler (`AsyncIOScheduler`) with three registered jobs:

| Job ID | Trigger | Action |
|---|---|---|
| `daily_report` | Configurable cron (day-of-week + time, from `schedule.json`) | Generate AI reports + collect consensus for all holdings |
| `guru_crawl` | Configurable cron (one day-of-week + time, from `guru_schedule.json`) | Scrape guru manager data; write to `guru_managers.json` |
| `daily_digest` | Every day at 08:00 KST | Generate daily digest; send via Telegram |

The scheduler starts in `main.py`'s `lifespan` context manager alongside a daemon thread that pre-warms the calendar file cache for the current and next month.

## Directory Structure

```
PortfoliOn/
├── backend/
│   ├── main.py              # App entry: router mounts, lifespan, CORS
│   ├── scheduler.py         # APScheduler jobs (not a service)
│   ├── routers/             # FastAPI route handlers
│   ├── services/            # Business logic and external API clients
│   ├── data/                # JSON file storage (stocks.json, schedule.json, etc.)
│   │   ├── calendar/        # File-based calendar cache (gitignored)
│   │   └── consensus/       # Per-ticker consensus cache (gitignored)
│   ├── snapshots/           # AI report snapshots (TICKER/YYYY-MM-DD.json)
│   └── reports/             # Legacy read-only report fallback
└── frontend/
    ├── src/
    │   ├── App.jsx          # Router, nav, theme switcher
    │   ├── pages/           # Top-level route components
    │   └── components/      # Shared modal and report sub-components
    └── vite.config.*        # Proxies /api/* → localhost:8000
```

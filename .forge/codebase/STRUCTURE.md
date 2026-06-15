---
last_mapped_commit: 504b6e098488b3d8bdd2c2ebdf69a9c9151df32f
mapped: 2026-06-16
---

# PortfoliOn Directory Structure

## Backend (`backend/`)

### Root Entry Points
- `main.py` (143 lines): FastAPI app initialization, lifespan hook (_migrate creates `batch_schedules`, `market_short_sell`, `stock_disclosures`, `stock_dividends` tables), middleware setup, router mounting
- `scheduler.py` (478 lines): APScheduler lifecycle, 20 batch job functions (_fetch_disclosures, _fetch_dividends, _refresh_macro_signals added), startup idempotent migrations

### Routers (`backend/routers/`) — 18 HTTP endpoints
Each router is a FastAPI APIRouter with prefix `/api/{domain}`.

| File | Endpoint | Purpose |
|------|----------|---------|
| `portfolio.py` | `/api/portfolio` | Get/save user holdings, portfolio analytics, dashboard |
| `watchlist.py` | `/api/watchlist` | Manage watched stocks, watch/unwatch operations |
| `stocks.py` | `/api/stocks` | Ticker master (search, add, edit analyst notes); dividends refresh endpoint |
| `report.py` | `/api/report` | Generate, list, detail reports; backfill snapshots; disclosures endpoint |
| `guru.py` | `/api/guru` | Fund manager profiles, holdings, performance stats |
| `calendar.py` | `/api/calendar` | Market event calendar (earnings, splits, etc.) |
| `digest.py` | `/api/digest` | Daily market digest generation & distribution |
| `analytics.py` | `/api/analytics` | Portfolio performance, sector allocation charts |
| `analysis.py` | `/api/analysis` | Sector momentum, macro analysis tabs |
| `market_indicators.py` | `/api/market` | KR/US econ indicators, earnings, FX, commodities; macro-signals endpoints |
| `auth.py` | `/api/auth` | OAuth2 (Google/Naver), JWT tokens, session |
| `admin.py` | `/api/admin` | Batch schedule edits, permission management |
| `events.py` | `/api/events` | User activity tracking (clicks, views) |
| `rankings.py` | `/api/rankings` | Intraday market rankings (gainers, volume) |
| `investor.py` | `/api/investor` | Foreign/retail/institutional supply/demand trends |
| `short_sell.py` | `/api/short-sell` | Short-selling trend data for KR stocks |
| `batches.py` | `/api/batches` | Batch status hub (execution logs, schedules) |

#### New Endpoints (v3)
- `GET /api/report/{ticker}/disclosures` → `services.disclosures.get_disclosures()` — KR stock latest DART notices
- `POST /api/report/disclosures/refresh` → `services.disclosures.fetch_all_disclosures()` — manual refresh
- `GET /api/stocks/dashboard` response reshaped → includes `holdings[].annual_dividend_per_share`, `dividend_yield`, `yield_on_cost`
- `POST /api/stocks/dividends/refresh` → `services.dividends.fetch_all_dividends()` — manual refresh
- `GET /api/market/macro-signals` → `services.market_indicators.macro.get_macro_signals()` — FRED time-series + signals
- `POST /api/market/refresh-macro-signals` → `services.market_indicators.macro._fetch_and_save_macro_signals()` — manual refresh

### Services (`backend/services/`) — 32 core modules + 4 subpackages

#### Core Service Layer (32 modules)
| File | Purpose |
|------|---------|
| `storage.py` | User portfolio operations (get_stocks, save_stocks, get_holdings, etc.) |
| `db.py` | PostgreSQL connection pooling, query/execute helpers |
| `market.py` | Market data fetching (yfinance, Naver quote, financials, analyst data) |
| `report_generator.py` | Snapshot generation, parallel API calls, TSV export |
| `consensus_pipeline.py` | Analyst opinion normalization (5-point scale), FnGuide/Naver scraping |
| `consensus.py` | Consensus data models & queries |
| `batch_registry.py` | **20 batch** metadata (static, includes disclosure_fetch, dividend_fetch, macro_signals_fetch) |
| `schedule_spec.py` | Cron trigger builder (weekly, monthly, interval) |
| `job_runs.py` | Execution logging (running/success/failed, 20-row keep) |
| `indicators.py` | RSI, timeframe analysis, volume profile |
| `scraper.py` | finviz consensus, news scraping |
| `guru_scraper.py` | Fund manager portfolio scraping |
| `guru_stats.py` | Manager holdings aggregation |
| `analyst_service.py` | Analyst profile & performance |
| `auth_service.py` | JWT/OAuth token generation, user lookup |
| `digest_service.py` | Daily digest content generation, Telegram send |
| `ranking_service.py` | Market rankings (KR/US), intraday fetch, storage |
| `investor_service.py` | Foreign/retail/institutional trend (Kiwoom ka10033) |
| `short_sell_service.py` | Short-sell trend (Kiwoom ka10014) |
| `kr_sector_service.py` | Sector momentum calculation & caching |
| `leverage_service.py` | Margin call ratio, reverse repo ratio (KR) |
| `lending_service.py` | Securities lending balance (monthly) |
| `backlog.py` | Order backlog (수주잔고) for KR stocks; **_get_corp_code_map()** cached here, reused by disclosures/dividends |
| `disclosures.py` | **NEW:** KR DART public notice feed (list.json, core types A/B/C/D) → `stock_disclosures` table |
| `dividends.py` | **NEW:** Dividend tracking (KR: DART alotMatter, US: yfinance) → `stock_dividends` table |
| `cache.py` | Report snapshot caching (in-memory + DB) |
| `charts.py` | Chart data generation (unused in current build) |
| `analysis_service.py` | Sector/macro analysis helpers |
| `utils.py` | Sanitization, normalization |
| `errors.py` | Custom exception types |
| `progress.py` | Progress tracker for long-running tasks |
| `parallel.py` | ThreadPoolExecutor wrapper |

#### Subpackage: `services/kiwoom/` — Kiwoom Securities API Client
| File | Purpose |
|------|---------|
| `__init__.py` | Module exports |
| `client.py` | Kiwoom API connection, request/response handling |
| `quote.py` | KR stock quote (price, volume, bid/ask) |
| `chart.py` | OHLCV historical data (daily/60min/5min) |
| `investor.py` | Foreign/retail/institutional supply/demand (ka10033) |
| `sector.py` | Sector quote & momentum |
| `shortsell.py` | Short-sell trend (ka10014, 252-day cumulative) |

#### Subpackage: `services/kis/` — Korea Investment & Securities API Client
| File | Purpose |
|------|---------|
| `__init__.py` | Module exports |
| `client.py` | KIS REST API connection, auth, request signing |
| `quote.py` | KR stock quote (competitive with Kiwoom) |

#### Subpackage: `services/market_indicators/` — External Economic Data (8 modules)
| File | Purpose |
|------|---------|
| `__init__.py` | Re-exports fetch/save/load functions |
| `cache.py` | In-memory cache for recent indicator fetches |
| `econ.py` | FRED API (unemployment, inflation, 10Y, VIX) |
| `commodities.py` | Commodity prices (oil, gold, copper) |
| `earnings.py` | M7 earnings (yfinance), KR Top2 (Naver) |
| `exports.py` | KR monthly exports (KOSTAT) |
| `fx.py` | KRW/USD, KRW/JPY rates |
| `macro.py` | **NEW:** FRED 4-series (T10Y2Y, BAMLH0A0HYM2, M2SL, DFF) → signals (inverted, credit_stress) |

### Other Backend Files
- `middleware/event_tracker.py`: HTTP request event logging (analytics)
- `auth.py`: Auth dependencies (get_current_user, require_admin, API key validation)
- `tests/`: test_scheduler_*.py, test_*.py (pytest)

### Database Schema (PostgreSQL)

#### New Tables (v3)
- **`stock_disclosures`** (KR-only, DART):
  - PK: `rcept_no` (공시번호)
  - Columns: `ticker, rcept_dt, report_nm, pblntf_ty (A|B|C|D), corp_name, fetched_at`
  - Index: `idx_disclosures_read(ticker, rcept_dt DESC)`
  - Upserted by `disclosure_fetch` batch daily 07:30 KST

- **`stock_dividends`** (both KR & US):
  - PK: `ticker`
  - Columns: `annual_dividend_per_share (NUMERIC), dividend_yield (NUMERIC), currency (TEXT: KRW|USD), source (TEXT: dart|yfinance), fetched_at`
  - Upserted by `dividend_fetch` batch weekly 05:00 KST

#### Existing Key Tables
- `user_stocks` (user_id, ticker, type[holding|watchlist], quantity, avg_cost)
- `tickers` (ticker[PK], name, market[KR|US], exchange, competitors, moat, growth_plan, risks, recent_disclosures, insights, is_etf)
- `snapshots` (ticker, user_id, date[PK], created_at, views)
- `consensus` (ticker[PK], buy, hold, sell, target_mean, consensus_data)
- `batch_schedules` (job_id[PK], data[JSONB])
- `market_short_sell` (ticker, base_date[PK], short_volume, short_value, short_ratio, short_balance, close_price, created_at)
- `market_leverage_indicators`, `market_lending_balance`, `market_indicators_kr_exports`, `market_rankings`, `market_investor_trend`, etc.

## Frontend (`frontend/src/`)

### App Entry
- `App.jsx` (169 lines): Route setup, auth flow (OAuth callback parsing), theme context, top nav with menu permissions

### Pages (`frontend/src/pages/`) — 23 JSX files

#### Main Navigation (6 tabs)
| File | Route | Purpose |
|------|-------|---------|
| `Portfolio.jsx` | `/` | Holdings table, SectorTab/MacroTab analytics, portfolio value chart |
| `Research.jsx` | `/research` | Stock research hub (search, add, list user stocks, snapshot view) |
| `Market.jsx` | `/market` | **NEW (v3):** Market Hub passthrough; includes MacroSignalsSection |
| `Guru.jsx` | `/guru` | Fund manager profiles, holdings, performance |
| `Settings.jsx` | `/settings` | Batch schedule editor, consensus settings, API key mgmt, user preferences |

#### Admin (1 tab)
| File | Route | Purpose |
|------|-------|---------|
| `AdminAnalytics.jsx` | `/admin-analytics` | User activity, batch execution history, export data |

#### Detailed Views & Modals
| File | Purpose |
|------|---------|
| `ReportManualGen.jsx` | Manual report generation UI (backfill wizard) |
| `Reports.jsx` | Report list, snapshot browser, detail panels with LatestDisclosuresSection |
| `Ranking.jsx` | Market rankings (KR/US), live intraday updates |
| `Analytics.jsx` | Performance analytics, holdings history chart |
| `SectorTab.jsx` | Sector allocation pie, momentum grid (KR/US toggle) |
| `MacroTab.jsx` | Macro indicators (interest rates, VIX, FX, commodities) |
| `Calendar.jsx` | Market event calendar (earnings, splits, IPOs) |
| `Digest.jsx` | Daily market digest (summary, top movers) |
| `GuruManagers.jsx` | Fund manager list, edit, delete |
| `GuruStats.jsx` | Manager holdings aggregation, performance |
| `GuruCrawlNow.jsx` | Trigger guru crawl batch |
| `ConsensusSettings.jsx` | Consensus data source & refresh settings |
| `LeverageBackfillSettings.jsx` | Historical leverage data backfill |
| `LoginPage.jsx` | OAuth/form login UI |
| `Showcase.jsx` | Dev component showcase page |

### Components (`frontend/src/components/`) — 41 JSX files

#### Core Components
- `ui/Card.jsx`, `Badge.jsx`, `Chart.jsx` — reusable UI primitives
- `ui/TextInput.jsx`, `Select.jsx`, `Checkbox.jsx`, `Button.jsx`

#### Portfolio Components (`components/portfolio/`)
- `DashboardCard.jsx` | **UPDATED (v3):** Added dividend stats (annual_dividend_per_share, dividend_yield, yield_on_cost)
- `DividendSummary.jsx` | **NEW (v3):** Summary widget showing portfolio dividend income (annual_dividend * quantity)
- `PortfolioChart.jsx`, `SectorChart.jsx`, `PerformanceChart.jsx`
- `FlashValue.jsx` — highlights price updates

#### Report Components (`components/reports/`)
- `ReportDetail.jsx`, `ReportList.jsx` | Snapshot rendering
- `ConsensusChart.jsx` | Buy/hold/sell opinion chart
- `RecentDisclosuresSection.jsx` | Cowork-generated commentary
- `LatestDisclosuresSection.jsx` | **NEW (v3):** Raw DART notices (rcept_dt, report_nm, pblntf_ty badge, dart_url link)
- `AnalystSection.jsx` | Analyst consensus details

#### Market Components (`components/market/`)
- `MacroSignalsSection.jsx` | **NEW (v3):** FRED 4-series charts (yield curve, HY spread, M2, DFF) + signal alerts (inverted, credit_stress)
- `EconomicIndicators.jsx` | Econ data table
- `FXChart.jsx`, `CommoditiesChart.jsx`
- `MarketUtils.jsx` | Shared market UI utilities

#### Analysis Components (`components/analysis/`)
- `SectorMomentum.jsx`, `AnalysisTab.jsx` | Sector/market analysis views

#### Shared Components
- `Header.jsx`, `Navigation.jsx`, `Footer.jsx` | Layout
- `LoadingSpinner.jsx`, `ErrorBoundary.jsx` | Status

### Pages Subdirectory Structure
```
frontend/src/
├── pages/
│   ├── Portfolio.jsx          # Holdings + analytics
│   ├── Research.jsx           # Stock search & snapshot view
│   ├── Reports.jsx            # Report list + detail (includes LatestDisclosuresSection)
│   ├── Market.jsx             # Market Hub (NEW v3, includes MacroSignalsSection)
│   ├── Ranking.jsx            # Live rankings
│   ├── Analytics.jsx          # Performance charts
│   ├── Digest.jsx             # Daily summary
│   ├── Calendar.jsx           # Event calendar
│   ├── SectorTab.jsx          # Sector analysis
│   ├── MacroTab.jsx           # Macro indicators (legacy; MacroSignalsSection is in Market.jsx)
│   ├── Guru*.jsx              # Fund manager UIs
│   ├── Settings.jsx           # Configuration
│   ├── AdminAnalytics.jsx     # Admin dashboards
│   └── ...
├── components/
│   ├── portfolio/
│   │   ├── DashboardCard.jsx  # UPDATED: dividend fields
│   │   ├── DividendSummary.jsx # NEW v3
│   │   └── ...
│   ├── reports/
│   │   ├── LatestDisclosuresSection.jsx # NEW v3: DART list
│   │   ├── RecentDisclosuresSection.jsx # Cowork commentary
│   │   └── ...
│   ├── market/
│   │   ├── MacroSignalsSection.jsx # NEW v3: FRED signals
│   │   └── ...
│   └── ...
└── App.jsx
```

### Styling
- `frontend/src/index.css` — CSS variables (--accent, --bg-elev, --text, etc.)
- `frontend/src/pages/*.jsx` — component-scoped CSS imports
- `frontend/src/components/**/*.css` — utility CSS (flex, grid, responsive)

## Key Files & Naming Conventions

### Backend Naming
- **Services:** snake_case (`disclosures.py`, `dividends.py`, `market_indicators/macro.py`)
- **Functions:** snake_case, verb-first (`fetch_disclosures()`, `upsert_dividend()`, `get_macro_signals()`)
- **Classes:** PascalCase (none in new modules)
- **Constants:** UPPER_CASE (`_DART_BASE`, `_CORE_TYPES`, `HY_STRESS_THRESHOLD`)
- **Routers:** prefix-driven (`GET /api/report/{ticker}/disclosures`, `POST /api/stocks/dividends/refresh`)

### Frontend Naming
- **Pages:** PascalCase (`Portfolio.jsx`, `Reports.jsx`, `Market.jsx`)
- **Components:** PascalCase (`DashboardCard.jsx`, `LatestDisclosuresSection.jsx`, `MacroSignalsSection.jsx`)
- **Props:** camelCase (`ticker`, `market`, `onToggle`, `annual_dividend_per_share`)
- **CSS classes:** kebab-case (`.dashcard__header`, `.disclosures-list`, `.macro-signals-chart`)
- **State:** camelCase (`open`, `data`, `loading`, `error`)

### Database Naming
- **Tables:** snake_case, plural where appropriate (`stock_disclosures`, `stock_dividends`, `market_short_sell`)
- **Columns:** snake_case (`annual_dividend_per_share`, `dividend_yield`, `rcept_no`, `pblntf_ty`)
- **Indexes:** `idx_{table}_{purpose}` (e.g., `idx_disclosures_read`)

## Port Assignments
- Backend FastAPI: `:8000`
- Frontend Vite: `:3000` (dev) or `:5173` (fallback)
- PostgreSQL: `:5432` (Docker Compose internal)
- Redis (if used): `:6379`

## Environment Variables

### Backend (`.env`)
- `DATABASE_URL` — PostgreSQL connection string
- `FRONTEND_URL` — CORS origin
- `SESSION_SECRET` — SessionMiddleware secret
- `DART_API_KEY` — DART public API key (used by disclosures + dividends batches)
- `FRED_API_KEY` — FRED API key (used by macro_signals_fetch batch)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — Digest distribution
- `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` — Naver OAuth & Stock API
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth
- `KIWOOM_API_KEY` — Kiwoom Securities API credentials
- `COWORK_API_KEY` — Cowork (external SaaS for AI generation, frontend-only)

### Frontend (`.env`)
- `VITE_API_URL` — Backend API root (e.g., `http://localhost:8000`)
- `VITE_GOOGLE_CLIENT_ID`, `VITE_NAVER_CLIENT_ID` — OAuth client IDs

## Build & Deployment

### Local Development
```bash
# Backend
cd backend && python -m pip install -r requirements.txt && python -m uvicorn main:app --reload

# Frontend
cd frontend && npm install && npm run dev

# PostgreSQL (Docker Compose)
docker-compose up -d db
```

### Production
- Backend: Gunicorn + uvicorn workers (8–16 workers per CPU)
- Frontend: Vite build → static `dist/` served by nginx
- Database: Managed PostgreSQL (RDS/Supabase)
- Scheduler: Runs inside single-process FastAPI app (NOT separate service)

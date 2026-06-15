---
last_mapped_commit: fd8dd650ede08d103b907ac4d87955f669ce3298
mapped: 2026-06-15
---

# PortfoliOn Directory Structure

## Backend (`backend/`)

### Root Entry Points
- `main.py` (122 lines): FastAPI app initialization, lifespan hook, middleware setup, router mounting
- `scheduler.py` (478 lines): APScheduler lifecycle, 17 batch job functions, startup idempotent migrations

### Routers (`backend/routers/`) — 17 HTTP endpoints
Each router is a FastAPI APIRouter with prefix `/api/{domain}`.

| File | Endpoint | Purpose |
|------|----------|---------|
| `portfolio.py` | `/api/portfolio` | Get/save user holdings, portfolio analytics, dashboard |
| `watchlist.py` | `/api/watchlist` | Manage watched stocks, watch/unwatch operations |
| `stocks.py` | `/api/stocks` | Ticker master (search, add, edit analyst notes) |
| `report.py` | `/api/report` | Generate, list, detail reports; backfill snapshots |
| `guru.py` | `/api/guru` | Fund manager profiles, holdings, performance stats |
| `calendar.py` | `/api/calendar` | Market event calendar (earnings, splits, etc.) |
| `digest.py` | `/api/digest` | Daily market digest generation & distribution |
| `analytics.py` | `/api/analytics` | Portfolio performance, sector allocation charts |
| `analysis.py` | `/api/analysis` | Sector momentum, macro analysis tabs |
| `market_indicators.py` | `/api/market` | KR/US econ indicators, earnings, FX, commodities |
| `auth.py` | `/api/auth` | OAuth2 (Google/Naver), JWT tokens, session |
| `admin.py` | `/api/admin` | Batch schedule edits, permission management |
| `events.py` | `/api/events` | User activity tracking (clicks, views) |
| `rankings.py` | `/api/rankings` | Intraday market rankings (gainers, volume) |
| `investor.py` | `/api/investor` | Foreign/retail/institutional supply/demand trends |
| `short_sell.py` | `/api/short-sell` | Short-selling trend data for KR stocks |
| `batches.py` | `/api/batches` | Batch status hub (execution logs, schedules) |

### Services (`backend/services/`) — 30 core modules + 3 subpackages

#### Core Service Layer (30 modules)
| File | Purpose |
|------|---------|
| `storage.py` | User portfolio operations (get_stocks, save_stocks, get_holdings, etc.) |
| `db.py` | PostgreSQL connection pooling, query/execute helpers |
| `market.py` | Market data fetching (yfinance, Naver quote, financials, analyst data) |
| `report_generator.py` | Snapshot generation, parallel API calls, TSV export |
| `consensus_pipeline.py` | Analyst opinion normalization (5-point scale), FnGuide/Naver scraping |
| `consensus.py` | Consensus data models & queries |
| `batch_registry.py` | 17 batch metadata (static) |
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
| `backlog.py` | Order backlog (수주잔고) for KR stocks |
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

#### Subpackage: `services/market_indicators/` — External Economic Data
| File | Purpose |
|------|---------|
| `__init__.py` | Re-exports fetch/save/load functions |
| `cache.py` | In-memory cache for recent indicator fetches |
| `econ.py` | FRED API (unemployment, inflation, 10Y, VIX) |
| `commodities.py` | Commodity prices (oil, gold, copper) |
| `earnings.py` | M7 earnings (yfinance), KR Top2 (Naver) |
| `exports.py` | KR monthly exports (KOSTAT) |
| `fx.py` | KRW/USD, KRW/JPY rates |

### Other Backend Files
- `middleware/event_tracker.py`: HTTP request event logging (analytics)
- `auth.py`: Auth dependencies (get_current_user, require_admin, API key validation)
- `tests/`: test_scheduler_*.py, test_*.py (pytest)

## Frontend (`frontend/src/`)

### App Entry
- `App.jsx` (169 lines): Route setup, auth flow (OAuth callback parsing), theme context, top nav with menu permissions

### Pages (`frontend/src/pages/`) — 22 JSX files

#### Main Navigation (5 tabs)
| File | Route | Purpose |
|------|-------|---------|
| `Portfolio.jsx` | `/` | Holdings table, SectorTab/MacroTab analytics, portfolio value chart |
| `Research.jsx` | `/research` | Stock research hub (search, add, list user stocks, snapshot view) |
| `MarketHub.jsx` | `/market` | Market indicators hub (passthrough to MarketHub layout) |
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
| `Reports.jsx` | Report list, snapshot browser, detail panels |
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
| `Market.jsx` | Placeholder redirect to MarketHub |

### Components (`frontend/src/components/`) — 38 JSX files

#### Core Components
| File | Purpose |
|------|---------|
| `MobileNav.jsx` | Mobile bottom tab bar |
| `InstallPrompt.jsx` | PWA install prompt |
| `PermissionManager.jsx` | Admin UI for user permission matrix |
| `PermissionPanel.jsx` | Permission group selector |
| `StockModal.jsx` | Add/edit stock modal (ticker, competitors, analyst notes) |
| `BatchScheduleEditor.jsx` | Batch cron editor (days, times, interval config) |
| `PromoteModal.jsx` | Promote watchlist → holding modal |
| `Toast.jsx` | Notification toast (success, error, info) |
| `LoadingSpinner.jsx` | Loading indicator |

#### Subcomponent: `components/portfolio/` (8 JSX)
- Holdings table, position details, cost basis, P&L, sector allocation, dashboard cards

#### Subcomponent: `components/market/` (11 JSX)
- Econ indicators sections (FX, commodities, FRED), earnings tables, lending/leverage charts
- `marketUtils.jsx`: Shared formatters for market data

#### Subcomponent: `components/reports/` (10 JSX)
- Report detail tabs (HistoryTab, FinancialsChart, ConsensusChart, DetailTab)
- Investor trend chart, short-sell section, backlog chart
- `reportUtils.jsx`: Snapshot formatting, consensus scoring

#### Subcomponent: `components/ui/` (8 JSX + CSS)
- `Badge.jsx`, `Button.jsx`, `Card.jsx`, `Stat.jsx` (reusable UI primitives)
- `icons.jsx` (Lucide/SVG icon exports)
- CSS modules for each component

### Hooks & Context (`frontend/src/hooks/`, `frontend/src/contexts/`)
- `useTheme.jsx`: Dark/light mode persistence
- `AuthContext.jsx`: Auth state, user permissions, role (admin/user)
- `useToast.jsx`: Toast notification trigger

### Utilities (`frontend/src/utils/`)
- `analytics.jsx`: trackEvent() → backend event logging
- `api.jsx`: Fetch helpers, base URL, auth headers
- `formatters.jsx`: Number/date formatting, currency

### Static Assets
- `public/favicon.svg`, `public/index.html`

### Styling
- `App.css`: Top nav, page layout, theme variables
- Component-scoped CSS (CSS Modules or inline)

### Build Config
- `vite.config.js`: Vite + React plugin
- `package.json`: Dependencies (react, react-router-dom, lucide-react, axios)

## Database Schema (PostgreSQL)

### User & Auth
- `users`: user_id (PK), email, role, created_at
- `user_stocks`: user_id + ticker (PK), type, quantity, avg_cost, added_at
- `oauth_sessions`: (session_id, provider, user_id, expires_at)

### Portfolio & Market Data
- `tickers`: ticker (PK), name, market, exchange, competitors, moat, growth_plan, risks, recent_disclosures, insights, is_etf
- `snapshots`: ticker + date (PK), data (JSONB), created_at
- `portfolio_snapshots`: user_id + date (PK), total_value, daily_change, sector_allocation
- `holdings_history`: user_id + ticker + date (PK), quantity, cost_value, market_value

### Market Cache Tables
- `consensus`: ticker + report_date (PK), analyst_count, avg_score, target_mean, buy/hold/sell counts
- `market_rankings`: market + ticker (PK), rank, price, change, volume, date
- `market_indicators_*`: (econ_indicators, kr_exports, m7_earnings, kr_top2_earnings, fx_rates, commodities, vix)
- `leverage`: ticker + date (PK), credit_ratio, reverse_repo_ratio
- `lending_balance`: ticker + date (PK), balance_qty, balance_value
- `investor_trend`: ticker + date (PK), foreign, institutional, retail (qty, ratio)
- `market_short_sell`: ticker + date (PK), short_volume, short_ratio, short_balance

### Batch & Admin
- `batch_schedules`: job_id (PK), data (JSONB spec: enabled, type, days, time, etc.)
- `job_runs`: id (PK), job_id, trigger, status, started_at, finished_at, error (20-row rotate)
- `user_events`: id (PK), user_id, event_type, payload, timestamp

### Report Data
- `guru_managers`: id (PK), name, company, portfolio (JSONB), last_updated
- `backlog_items`: ticker + date (PK), value, count

## Code Naming Conventions

### Backend
- Functions: snake_case (e.g., `get_all_stocks`, `_generate_kr`, `fetch_trend`)
- Services: `*_service.py`, `*_client.py`, `*_scraper.py`
- Endpoints: RESTful `/api/{domain}/{resource}/{action}` (e.g., `/api/portfolio/stocks`, `/api/report/refresh-all`)
- Internal functions: `_private_function()`

### Frontend
- Components: PascalCase (e.g., `Portfolio.jsx`, `SectorTab.jsx`)
- Hooks: camelCase with `use` prefix (e.g., `useTheme.jsx`, `useAuth.jsx`)
- Utilities: camelCase (e.g., `formatNumber()`, `trackEvent()`)
- Pages: PascalCase matching route (e.g., `Portfolio` → `/`, `Settings` → `/settings`)

## Key File Locations

| Purpose | Path |
|---------|------|
| App entry (backend) | `backend/main.py` |
| Scheduler logic | `backend/scheduler.py` |
| Batch registry | `backend/services/batch_registry.py` |
| Report generation | `backend/services/report_generator.py` |
| User portfolio | `backend/services/storage.py` |
| Market data fetch | `backend/services/market.py` |
| Consensus aggregation | `backend/services/consensus_pipeline.py` |
| Execution logging | `backend/services/job_runs.py` |
| Kiwoom client | `backend/services/kiwoom/client.py` |
| Market indicators | `backend/services/market_indicators/*.py` |
| App entry (frontend) | `frontend/src/App.jsx` |
| Auth context | `frontend/src/contexts/AuthContext.jsx` |
| Main pages | `frontend/src/pages/*.jsx` |
| UI components | `frontend/src/components/*.jsx` |
| Market components | `frontend/src/components/market/*.jsx` |
| Report components | `frontend/src/components/reports/*.jsx` |
| Report snapshots (file storage) | `backend/snapshots/{ticker}/{YYYY-MM-DD}.json` |

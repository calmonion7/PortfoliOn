---
last_mapped_commit: 6793157d58f56e2b8392cfbe725de186d9f95e0d
mapped: 2026-06-20
---

# Directory Structure

## Backend (`backend/`)

```
backend/
  main.py              # FastAPI app entry: lifespan(_migrate→scheduler.start→cache warm), router mounts, /health
  auth.py              # auth helpers (root-level)
  run_backfill.py      # one-off backfill script
  auth_schema.sql      # PostgreSQL auth schema (run FIRST)
  app_schema.sql       # PostgreSQL app schema (run after auth_schema)
  .venv/               # local Python venv (macOS: .venv/bin/python) — NOT == Docker deps (no lxml locally)
  data/                # static reference data only (sp500_tickers.json, kospi_tickers.json) + gitignored caches
  snapshots/  reports/ # generated/legacy per-ticker JSON (gitignored / read-only fallback)

  routers/             # HTTP layer, one module per area
    admin.py analysis.py analytics.py auth.py batches.py calendar.py digest.py
    events.py guru.py investor.py market_indicators.py portfolio.py rankings.py
    recommendations.py report.py short_sell.py stocks.py watchlist.py

  middleware/
    event_tracker.py   # EventTrackerMiddleware → user_events

  scheduler/           # APScheduler PACKAGE (not a single file)
    __init__.py        # re-exports job fns + _JOB_FUNCS (module-attr surface)
    jobs.py            # job callables (_generate_kr/_us, _run_guru_crawl, _fetch_*, _refresh_*, _run_digest)
    schedule.py  _state.py   # scheduling config + shared state/constants

  services/            # business logic
    db.py              # raw SQL helpers: get_connection / query / execute
    cache.py           # 6 in-memory caches (snapshot LRU200, list/dashboard/correlation/sector/macro TTL)
    batch_registry.py  # BATCHES catalog (market/source/usage) → GET /api/batches
    job_runs.py        # batch run-history record/read
    schedule_spec.py   parallel.py  progress.py  errors.py  utils.py   # cross-cutting helpers
    report_generator.py consensus.py consensus_pipeline.py             # snapshot build + consensus
    scraper.py  charts.py  indicators.py                                # data/chart/indicator helpers
    guru_scraper.py  guru_stats.py  digest_service.py                   # guru + digest
    analysis_service.py  analytics (router-side)  kr_sector_service.py  # sector/macro-correlation
    leverage_service.py  lending_service.py  investor_service.py        # KOFIA / lending / investor flow
    ranking_service.py  short_sell_service.py  supply_score.py          # rankings / shortsell / supply band
    backlog.py  backlog_parser.py  disclosures.py  insider_trades.py    # DART backlog/disclosure/insider
    dividends.py  auth_service.py

    storage/           # PACKAGE (ADR-0017) — __init__ re-exports full surface as storage.X
      portfolio.py  dates.py  names.py  schedule.py

    market/            # quote chains + formatting
      kr.py            # get_quote_kr: Kiwoom → KIS → Naver
      us.py            # get_quote_us: yfinance → KIS
      format.py        # value normalization

    market_indicators/ # PACKAGE — market_cache-backed indicator submodules
      cache.py (_mc_load/_mc_save)  fx.py  commodities.py  earnings.py
      econ.py (FRED)  exports.py (KR)  macro.py (FRED macro signals)

    kiwoom/            # KR read-only quote source (ADR-0009)
      client.py (token singleton)  quote.py (ka10001)  sector.py  investor.py
      chart.py  shortsell.py

    kis/               # KR+US read-only BACKUP quote source (ADR-0011); dormant w/o keys
      client.py  quote.py

    recommendation/    # batch-backed recommendation scoring
      universe.py  scoring.py  actions.py  funnel.py  store.py
```

Root reference docs: `API_SPEC.md`, `CLAUDE_COWORK_API.md`, `KIWOOM_API.md`, `KIS_API.md`,
`CLAUDE.md`. ADRs in `.forge/adr/`, codebase map in `.forge/codebase/`.

## Frontend (`frontend/src/`)

```
frontend/src/
  main.jsx             # createRoot → <StrictMode><App/></StrictMode>; imports styles/tokens.css
  App.jsx              # ToastProvider→AuthProvider→BrowserRouter, TopNav, route table
  api.js               # axios instance (JWT, VITE_API_BASE_URL)
  index.css  App.css  utils.js
  assets/  styles/     # styles/tokens.css = KR color tokens (--up=red, --down=blue)

  contexts/
    AuthContext.jsx    # session, role, menuPermissions (drives nav filtering)

  hooks/               # custom hooks, naming useX.js; colocated tests *.test.js
    useReportList.js   useReportFilters.js (+ .test.js)  useStockManagement.js (+ .test.js)
    useReportGeneration.js  usePortfolioData.js  useAuth.js  useTheme.js
    useIsMobile.js  usePriceFlash.js

  pages/               # route + tab pages
    Research.jsx       # hub at "/" — mounts Reports/Ranking/Recommendations/Calendar/Digest tabs
    MarketHub.jsx      # "/market" hub — Market/Leverage tabs
    Portfolio.jsx  Reports.jsx (312 lines, orchestrator) Ranking.jsx Recommendations.jsx
    Calendar.jsx  Digest.jsx  Market.jsx  Analytics.jsx  SectorTab.jsx  MacroTab.jsx
    Guru.jsx  GuruCrawlNow.jsx  GuruManagers.jsx  GuruStats.jsx
    Settings.jsx  ConsensusSettings.jsx  LeverageBackfillSettings.jsx  ReportManualGen.jsx
    LoginPage.jsx  AdminAnalytics.jsx  Showcase.jsx

  components/          # presentational, grouped by area
    StockModal.jsx  PromoteModal.jsx  MobileNav.jsx  InstallPrompt.jsx  Toast.jsx
    LoadingSpinner.jsx  PermissionManager.jsx  PermissionPanel.jsx  BatchScheduleEditor.jsx
    reports/           # ReportDetailTabs/Header, ReportFilters, StockCard, TickerListItem,
                       # DetailTab, HistoryTab, Sections, ConsensusChart, FinancialsChart,
                       # BacklogChart, Insider/Investor/ShortSell/Disclosures/Supply sections, reportUtils.jsx
    market/            # FxSection, VixSection, CommoditiesSection, TreasurySection,
                       # EconIndicatorsSection, M7EarningsSection, KrTop2Section, KrExportsSection,
                       # LeverageSection, LendingSection, MacroSignalsSection, marketUtils.jsx
    portfolio/         # DashboardCard, FlashValue, PriceFreshness (+ .css)
    recommendations/   # RecCard.jsx
    ui/                # primitives: Badge, Button, Card, Stat, Input, Skeleton, icons.jsx,
                       # SupplyBadge, InsiderBadge, index.js (+ matching .css)

  utils/               # analytics.js (trackEvent), marketHours.js, priceFlash.js, pwa.js

  test/                # NEW — Vitest setup
    setup.js  smoke.test.js
```

## Naming conventions

- **Hooks**: `useX.js` in `frontend/src/hooks/`.
- **Colocated tests**: `*.test.js` next to source (e.g. `useReportFilters.test.js`,
  `useStockManagement.test.js`); shared Vitest setup in `frontend/src/test/setup.js`.
- **Components**: PascalCase `.jsx`, area-grouped subfolders; CSS colocated as `<Name>.css`.
- **Backend routers**: `routers/<area>.py`; matching logic in `services/<area>_service.py` or a
  same-named service package (`storage/`, `market/`, `market_indicators/`, `kiwoom/`, `kis/`,
  `recommendation/`).
- **Packages that were split from single files** re-export their full public surface in
  `__init__.py` so callers keep `module.attr` access (`storage`, `scheduler`).
- **Backend tests**: pytest under `backend/` (`cd backend && .venv/bin/python -m pytest`).

---
last_mapped_commit: b6193c3837f4125a41930c36a2b3ae2ef198dc3c
mapped: 2026-06-22
---

# STRUCTURE

저장소 루트: `/Users/calmonion/Project/PortfoliOn`. 백엔드는 `backend/`, 프론트는 `frontend/`, 인프라/문서는 루트. 런타임 데이터는 Docker PostgreSQL, 로컬 파일은 캐시/폴백.

## 루트 레벨

- `CLAUDE.md` — 프로젝트 컨텍스트·gotcha.
- `API_SPEC.md` — 전체 REST API 레퍼런스(엔드포인트 source of truth).
- `CLAUDE_COWORK_API.md` — 외부 Cowork(AI 분석 작성) API.
- `KIWOOM_API.md`, `KIS_API.md` — 키움/KIS API 카탈로그·대체 로드맵.
- `README.md` — overview(화면·env·스택·아키텍처·배치).
- `start.sh`/`start.bat`/`stop.bat`, `docker-compose`(인프라), `scripts/` — 기동·자동배포 폴러.
- `.forge/` — forge 상태(backlog/done/retro/adr/codebase 등, untracked).

## backend/

```
backend/
  main.py                # FastAPI 앱 entry — lifespan(_migrate/scheduler/캐시워밍), 미들웨어, 18개 라우터 마운트, /health
  auth.py                # 인증 Depends — get_current_user(JWT HS256), get_current_user_or_api_key, require_admin, require_admin_or_api_key, _API_KEY_USER_ID
  auth_schema.sql        # 인증 스키마 (app_schema.sql보다 먼저 실행)
  app_schema.sql         # 앱 스키마
  supabase_schema.sql    # 레거시(미사용)
  requirements.txt       # 의존성 (anthropic 없음 — 백엔드 LLM 호출 없음; lxml은 Docker만, 로컬 .venv엔 없음)
  Dockerfile, Procfile, pytest.ini, run_backfill.py
  .env, .env.docker, .env.docker.example   # POSTGRES_PASSWORD/JWT_SECRET/SESSION_SECRET/OAuth/FRED/KOFIA/KIWOOM/KIS 키
  .venv/                 # macOS: .venv/bin/python
  data/                  # 정적 참조(sp500_tickers.json, kospi_tickers.json) + calendar/·consensus/ 파일캐시(gitignored)
  snapshots/             # per-ticker/date 리포트 JSON (gitignored)
  reports/               # 레거시 리포트(read-only 폴백)
  migrations/            # 001_user_events.sql, 002_backlog_history.sql (수동 적용; main.py:_migrate가 idempotent DDL 보완)
  middleware/            # __init__.py, event_tracker.py (EventTrackerMiddleware → user_events)
```

### backend/routers/ — HTTP 표면 (18개)

```
auth.py  portfolio.py  watchlist.py  stocks.py  report.py  guru.py
calendar.py  digest.py  market_indicators.py  analytics.py  analysis.py
events.py  rankings.py  investor.py  short_sell.py  batches.py
recommendations.py  admin.py
```

- `stocks.py` — `GET /api/stocks/dashboard`(`get_dashboard`/`_build_card`/`_minimal_card`/`_portfolio_totals`/`_build_all`/`_usdkrw_rate`), 종목 검색·뉴스·enrich(`PUT /api/stocks/enrich/batch`는 `PUT /api/stocks/{ticker}/enrich`보다 **먼저** 등록), 배당/수급/이름 백필.
- `report.py` — `list_reports`(`scope=mine|all`, `_mk_entry`로 `is_mine` 마킹), `get_report`, `refresh_analyst`(regular=True 박제), backlog/disclosures/insider/consensus 라우트.
- 라우팅 주의: catch-all `GET /api/report/{ticker}/{date}`가 더 구체적 라우트를 가리지 않게 순서 의존.

### backend/services/ — 도메인 로직

```
db.py                  # ThreadedConnectionPool(maxconn=20) + get_connection/query/execute
cache.py               # TTLCache 7종(snapshot LRU/list/dashboard/correlation/sector/macro/quote/live_prices) + invalidate
report_generator.py    # generate_report(스냅샷 박제), generate_report_with_retry, backfill_ticker, _rsi_block
batch_registry.py      # BATCHES 정적 메타(20개) — job_id/market/source/usage/default_schedule
job_runs.py            # job_runs.record(id, kind) 컨텍스트 — 실행 이력
indicators.py          # RSI/volume_profile 계산
charts.py  scraper.py  consensus.py  consensus_pipeline.py  parallel.py  progress.py  errors.py  utils.py(sanitize)
analysis_service.py    # 섹터 모멘텀·매크로 상관(GET /api/analysis/*)
kr_sector_service.py   # KR 업종 모멘텀 사전계산 → market_cache
auth_service.py  guru_scraper.py  guru_stats.py  digest_service.py
leverage_service.py(KOFIA 신용잔고)  lending_service.py(대차잔고)
dividends.py  disclosures.py  backlog.py  backlog_parser.py  insider_trades.py
investor_service.py  ranking_service.py  short_sell_service.py  supply_score.py
schedule_spec.py       # build_trigger_kwargs (스펙 → CronTrigger kwargs)
storage/  market/  market_indicators/  kiwoom/  kis/  recommendation/   # 하위 패키지(아래)
```

#### services/storage/ (ADR-0017 패키지)
```
__init__.py   # 전 심볼 re-export (storage.X 모듈 속성 표면 보존) + db 헬퍼 재노출
portfolio.py  # get/save_stocks·holdings·watchlist, get_full/all/global_portfolio, enrich_stock, _ENRICH_KEYS; tickers UPSERT 클로버방지 CASE
names.py      # refresh_snapshot_names, reconcile_snapshot_names, set_ticker_name, tickers_missing_name, _invalidate_name_caches
schedule.py   # get/save_schedule·guru_managers·guru_schedule·batch_schedule(들)
dates.py      # expected_report_date(market), expected_report_dates(), _REPORT_BATCH_BY_MARKET, _now_kst
```

#### services/market/ (ADR-0017 패키지)
```
__init__.py   # get_quote/get_quotes_batch/get_history_df/get_financials/get_annual_financials/get_analyst_data/resolve_name; _get_quote_uncached, _changes_from_closes, _closes_from_download, _HISTORY_CFG
format.py     # _yf_sym, _norm_sector, _n, _to_won, _yf_val, _fmt_price, _fmt_market_cap
kr.py         # get_quote_kr + 소스체인(_kr_basic_kiwoom/kis/naver) + 발산가드(_price_sane/_corroborated_pick/_kr_pick_regular/_kr_pick_degenerate_lazy/_kr_pick_basic); get_financials_kr/get_annual_financials_kr/get_analyst_data_kr; Naver/FnGuide 헬퍼
us.py         # get_annual_financials_us, _us_quote_kis(KIS 백업), _us_none_quote
```

#### services/market_indicators/
```
__init__.py(공개 진입점·_fetch_and_save_*)  cache.py(_mc_load/_mc_save → market_cache)
fx.py  commodities.py  earnings.py(M7/KR Top2)  econ.py(FRED)  exports.py(KR 수출)  macro.py(FRED 매크로 신호·evaluate_signals)
```

#### services/kiwoom/ (KR 읽기전용 — ADR-0009)
```
__init__.py  client.py(토큰 싱글톤·request/request_paged·integrated_code(regular)·configured)
quote.py(ka10001 get_quote/normalize_basic)  chart.py(일/주/월봉)  sector.py  investor.py  shortsell.py
```

#### services/kis/ (KR+US 백업 — ADR-0011)
```
__init__.py  client.py(토큰·request·configured)  quote.py(국내 FHKST01010100 get_quote_kr, 해외 get_quote_us)
```

#### services/recommendation/
```
__init__.py  universe.py  scoring.py  funnel.py  store.py  actions.py
```

### backend/scheduler/ (루트 레벨 패키지, services 아님)
```
__init__.py  # start()/stop()/reload() + 서브모듈 심볼 re-export
_state.py    # _scheduler(BackgroundScheduler), _DIGEST_JOB_ID, _VALID_DAYS, _DAY_MAP (leaf — 순환 회피)
jobs.py      # 잡 함수 전체 + _JOB_FUNCS dict(job_id→함수, 23개) + _in_market/_seed_*_if_empty
schedule.py  # _reschedule_job, _build_trigger, _seed_spec_for, _seed_batch_schedules, _check_missed_report(_for)
```

### backend/tests/ — pytest
`conftest.py` + `fixtures/` + 80+개 `test_*.py`. 명명 규칙 `test_<대상>.py`(라우터=`test_*_router.py`, 서비스=`test_<service>.py`). 예: `test_market_kr.py`, `test_report_price_gate.py`, `test_kiwoom_quote.py`, `test_kis_quote.py`, `test_batch_market_split.py`, `test_scheduler_*.py`, `test_recommendation_*.py`, `test_api_doc_sync.py`(명세서 동기 검증). 로컬 실행: `cd backend && .venv/bin/python -m pytest`.

## frontend/ (React 19 + Vite, plain CSS)

```
frontend/src/
  main.jsx  App.jsx(라우팅·TopNav·OAuth 콜백)  api.js(axios 인스턴스)  utils.js  index.css  App.css
  contexts/AuthContext.jsx           # menuPermissions·role 로드, nav 필터링 소스
  hooks/
    usePortfolioData.js              # 포트폴리오 상태 단일소스 — portfolio/prices/dashboard fetch + 15s 라이브폴링 + priceTick
    useReportList.js  useReportFilters.js(+.test.js)  useStockManagement.js(+.test.js)
    useReportGeneration.js  useAuth.js  useTheme.js  useIsMobile.js  usePriceFlash.js
  utils/  analytics.js(trackEvent)  marketHours.js(isKr/UsMarketOpen)  priceFlash.js  pwa.js
  styles/  tokens.css(--up=빨강/--down=파랑 KR 색 관례)  pc.css  mobile.css
  test/                              # 프론트 테스트 하니스
  assets/
```

### frontend/src/pages/ — 화면 (허브 + 하위 페이지)
```
Research.jsx   # 홈 허브('/') — 탭: 리포트(Reports)·추천(Recommendations)·랭킹(Ranking)·캘린더(Calendar)·다이제스트(Digest)
MarketHub.jsx  # 시장 허브('/market') — 시장지표·수급지표 2탭(Market 등)
Portfolio.jsx  # 대시보드·분석('/portfolio'); 종목관리는 리서치 리포트 탭으로 이동
Reports.jsx  Ranking.jsx  Recommendations.jsx  Calendar.jsx  Digest.jsx  Market.jsx  Analytics.jsx
SectorTab.jsx  MacroTab.jsx                     # 섹터/매크로(Portfolio 분석탭에 통합)
Guru.jsx  GuruCrawlNow.jsx  GuruManagers.jsx  GuruStats.jsx
Settings.jsx  ConsensusSettings.jsx  LeverageBackfillSettings.jsx  ReportManualGen.jsx
AdminAnalytics.jsx('/admin-analytics' admin 전용)  LoginPage.jsx  Showcase.jsx('/dev/showcase')
```

### frontend/src/components/
```
StockModal.jsx  PromoteModal.jsx  PermissionManager.jsx  PermissionPanel.jsx
LoadingSpinner.jsx  MobileNav.jsx  Toast.jsx(ToastProvider)  InstallPrompt.jsx  BatchScheduleEditor.jsx
reports/   market/   ui/   portfolio/   recommendations/
```

#### components/reports/
```
StockActions.jsx   # 보유/관심 카드 액션버튼 단일소스(task#103) — StockCard+TickerListItem 공유, is_mine 게이트, layout='card'|'list'
StockCard.jsx      # 그리드 카드 (StockActions layout='card')
TickerListItem.jsx # 사이드바 행 (StockActions layout='list')
DetailTab.jsx  ReportDetailTabs.jsx  ReportDetailHeader.jsx  ReportFilters.jsx  HistoryTab.jsx
ConsensusChart.jsx  FinancialsChart.jsx  BacklogChart.jsx  Sections.jsx  reportUtils.jsx
InsiderTradesSection.jsx  InvestorTrendSection.jsx  LatestDisclosuresSection.jsx  ShortSellSection.jsx  SupplySection.jsx
```

#### components/market/
```
FxSection.jsx  VixSection.jsx  CommoditiesSection.jsx  TreasurySection.jsx
EconIndicatorsSection.jsx  MacroSignalsSection.jsx  M7EarningsSection.jsx  KrTop2Section.jsx  KrExportsSection.jsx
LeverageSection.jsx  LendingSection.jsx  marketUtils.jsx(krFmt — 억/조 포매팅, 입력은 억원 가정)
```

#### components/ui/ (디자인 시스템)
```
Badge.jsx/.css(success=빨강/danger=파랑 — KR 가격색)  Button  Card  Stat  Input  Skeleton
icons.jsx  index.js  SupplyBadge.jsx  InsiderBadge.jsx(의미 배지는 전용색, 가격토큰 미사용)
```

#### components/portfolio/
```
DashboardCard.jsx/.css  FlashValue.jsx  PriceFlash.css  PriceFreshness.jsx/.css
```

## 스키마 파일

- `backend/auth_schema.sql` — `users`(role user|admin), `refresh_tokens`. **반드시 app_schema.sql보다 먼저 실행**.
- `backend/app_schema.sql` — `tickers`, `snapshots`, `user_stocks`, `schedules`, `guru_managers`, `guru_schedules`, `batch_schedules`, `digests`, `consensus_history`, `calendar_cache`, `market_cache`, `user_menu_permissions`, `default_menu_permissions`, `raw_reports`, `daily_consensus_mart`, `user_events`, `market_leverage_indicators`, `market_lending_balance`, `backlog_history`, `market_rankings`, `market_investor_trend`, `market_short_sell`, `stock_disclosures`, `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`, `job_runs`. 실행 순서: `auth_schema.sql` → `app_schema.sql`. 기동 시 `main.py:_migrate()`가 일부 테이블/컬럼을 `IF NOT EXISTS`로 idempotent 보완.

## 명명 규칙

- 백엔드 잡 id: `<도메인>_<주기/시장>`(예: `daily_report_kr`, `monthly_us`, `kr_rankings_fetch`) — 스케줄러 잡 id = `_JOB_FUNCS` 키 = `job_runs.record` id = `batch_registry` id 일치 필수.
- private/내부 심볼은 `_` 접두(`_kr_pick_basic`, `_mc_load`, `_build_card`). 패키지 `__init__.py`가 외부참조 private까지 명시 re-export.
- 프론트 컴포넌트 PascalCase `.jsx`, 훅 camelCase `use*.js`, 테스트 동일 stem `.test.js`.
- ADR 참조는 `.forge/adr/NNNN`(예: ADR-0009 키움 경계, 0011 KIS 백업, 0017 패키지 분리, 0020 시세 기준 이원화).

---
last_mapped_commit: a78576f706579812552909d53642d1ceccb6ff3a
mapped: 2026-06-20
---

# STRUCTURE

디스크 상의 실제 현재 트리(HEAD `a78576f7`). 백엔드 패키지 경로는 `ls`로 확인한 값이다.

## Top level

```
backend/        FastAPI 백엔드
frontend/       React 19 + Vite 프론트
scripts/        배포/유틸 스크립트 (auto-deploy-poll.sh 등)
supabase/        (legacy, untracked)
.forge/          forge 루프 상태/문서
API_SPEC.md, CLAUDE_COWORK_API.md, KIWOOM_API.md, KIS_API.md, README.md, CLAUDE.md
start.sh / start.bat / stop.bat
```

## Backend — `backend/`

```
backend/
  main.py                  앱 진입점, 라우터 마운트 + lifespan(_migrate/scheduler/캐시워밍)
  auth.py                  JWT 인증 유틸 (라우터 아님)
  auth_schema.sql          인증 스키마 (users, refresh_tokens) — app_schema.sql보다 먼저 실행
  app_schema.sql           앱 스키마 (tickers, user_stocks, snapshots, ...)
  supabase_schema.sql      legacy
  requirements.txt, Dockerfile, Procfile, pytest.ini
  run_backfill.py          리포트 백필 스크립트
  .env / .env.docker / .env.docker.example
  .venv/                   로컬 파이썬 가상환경 (.venv/bin/python). lxml 없음(Docker엔 있음)
  routers/                 FastAPI APIRouter 19종
  services/                도메인 서비스 (+ 서브패키지)
  scheduler/               APScheduler 패키지 (구 scheduler.py에서 분리)
  middleware/              event_tracker.py
  migrations/              001_user_events.sql, 002_backlog_history.sql
  data/                    정적 참조 데이터 + 로컬 파일 캐시
  snapshots/               생성된 JSON 스냅샷 (gitignored)
  reports/                 legacy 리포트 디렉터리 (read-only fallback)
  tests/                   pytest
```

### `backend/routers/` (19개 .py)
`admin.py`, `analysis.py`, `analytics.py`, `auth.py`, `batches.py`, `calendar.py`, `digest.py`, `events.py`, `guru.py`, `investor.py`, `market_indicators.py`, `portfolio.py`, `rankings.py`, `recommendations.py`, `report.py`, `short_sell.py`, `stocks.py`, `watchlist.py` (+ `__init__.py`).

모든 라우터는 `APIRouter(prefix="/api", ...)`. 라우트 순서 함정: `/report/{ticker}/backlog`·`/disclosures`·`/insider-trades`는 `/report/{ticker}/{date_str}` catch-all **앞**에 등록(아니면 `backlog`가 date로 매칭). `PUT /api/stocks/enrich/batch`는 `PUT /api/stocks/{ticker}/enrich` 앞에 등록.

### `backend/services/` — 단일 파일 모듈
`analysis_service.py`, `auth_service.py`, `backlog.py`, `backlog_parser.py`(구 backlog.py에서 HTML 파싱 추출), `batch_registry.py`, `cache.py`, `charts.py`, `consensus.py`, `consensus_pipeline.py`, `db.py`, `digest_service.py`, `disclosures.py`, `dividends.py`, `errors.py`, `guru_scraper.py`, `guru_stats.py`, `indicators.py`, `insider_trades.py`, `investor_service.py`, `job_runs.py`, `kr_sector_service.py`, `lending_service.py`, `leverage_service.py`, `parallel.py`, `progress.py`, `ranking_service.py`, `report_generator.py`, `schedule_spec.py`, `scraper.py`, `short_sell_service.py`, `supply_score.py`, `utils.py` (+ `__init__.py`).

### `backend/services/` — 서브패키지 (6개)

**`storage/`** (구 `storage.py` → 패키지, ADR-0017). `__init__.py`가 모든 심볼을 패키지 루트로 re-export(외부는 `storage.X` 모듈 속성으로 조회):
- `portfolio.py` — `get_stocks`/`save_stocks`, `get_holdings`, `get_watchlist_tickers`, `get_full_portfolio`, `get_all_stocks`, `enrich_stock`; `_ANALYST_KEYS`/`_JSON_TEXT_FIELDS`/`_ENRICH_KEYS`/`_parse_json_field`.
- `names.py` — `refresh_snapshot_names`, `set_ticker_name`, `reconcile_snapshot_names`, `tickers_missing_name`, `update_ticker_meta`, `_invalidate_name_caches`.
- `schedule.py` — `get_schedule`, `get_guru_managers`/`save_*`, `get_guru_schedule`, `get_batch_schedule`/`save_*`/`get_all_batch_schedules`.
- `dates.py` — `expected_report_date`, `expected_report_dates`, `_REPORT_BATCH_BY_MARKET`, `_now_kst`.

**`market/`** (구 `market.py` → 패키지, ADR-0017). `__init__.py`가 공개 함수(`get_quote`, `get_quotes_batch`, `get_history_df`, `get_financials`, `get_annual_financials`, `get_analyst_data`, `resolve_name`, `_get_quote_uncached`) 보유 + 서브모듈 re-export:
- `format.py` — 정규화/포매팅(`_norm_sector`, `_n`, `_to_won`, `_yf_val`, `_yf_sym`, `_fmt_price`, `_fmt_market_cap`).
- `kr.py` — KR 시세(`get_quote_kr` 키움→KIS→Naver, `get_financials_kr`, `get_annual_financials_kr`, `get_analyst_data_kr`, `_kr_basic_*`, `_kr_closes_kiwoom`, `_naver_*`, `_fnguide_market_cap`).
- `us.py` — US 시세(`get_annual_financials_us`, `_us_quote_kis`, `_us_none_quote`).

**`market_indicators/`** (시장지표 패키지). `cache.py`(`_mc_load`/`_mc_save` — PostgreSQL `market_cache` 읽기/쓰기), `fx.py`(FX/VIX), `commodities.py`(원자재/국채), `earnings.py`(M7/KR Top2), `econ.py`(FRED 경제지표), `exports.py`(KR 수출), `macro.py`(FRED 매크로 신호 — 금리차/HY/M2/기준금리 + 신호 판정) (+ `__init__.py`).

**`kiwoom/`** (키움 REST, KR 읽기전용 1차 — ADR-0009). `client.py`(토큰/`request`), `quote.py`(ka10001), `chart.py`(일/주/월봉), `investor.py`(수급), `sector.py`(ka20006/ka20002 업종 모멘텀), `shortsell.py`(공매도) (+ `__init__.py`).

**`kis/`** (한국투자증권 REST, KR+US 읽기전용 백업 — ADR-0011). `client.py`(`/oauth2/tokenP` 토큰, `request`), `quote.py`(국내 `FHKST01010100`, 해외 `HHDFS*`) (+ `__init__.py`).

**`recommendation/`** (추천 엔진/발굴, ADR-0015). `universe.py`(`build_universe`), `scoring.py`(`score_stock`/`derive_flags`), `funnel.py`(`run_recommendation_batch`), `store.py`(`replace_recommendations`/`read_recommendations`), `actions.py`(`derive_holding_action`) (+ `__init__.py` 공개 re-export).

### `backend/scheduler/` (구 `scheduler.py` → 패키지)
`__init__.py`(`start`/`stop`/`reload` + 전 잡 함수·헬퍼 re-export), `_state.py`(`_scheduler` AsyncIOScheduler·`_DIGEST_JOB_ID`·`_VALID_DAYS`·`_DAY_MAP`), `jobs.py`(전 잡 함수 + `_JOB_FUNCS` 매핑 + 시드), `schedule.py`(`_build_trigger`/`_reschedule_job`/`_seed_*`/`_check_missed_report*`).

### `backend/data/` (정적 참조 + 로컬 캐시)
정적: `sp500_tickers.json`, `kospi_tickers.json`, `kr_exports.json`. 로컬 파일 캐시(gitignored): `calendar/`(YYYY-MM.json), `consensus/`(per-ticker). legacy JSON: `stocks.json`, `holdings.json`, `watchlist.json`, `guru_managers.json`, `guru_schedule.json`, `schedule.json`, `digest/`.

## Frontend — `frontend/src/`

```
src/
  main.jsx                 React 진입
  App.jsx                  BrowserRouter + Auth/Toast Provider, TopNav, 라우트 정의 (홈 /=Research, /portfolio=Portfolio)
  App.css / index.css
  api.js                   API 베이스 헬퍼
  utils.js
  pages/                   라우트/탭 페이지 (23개 .jsx)
  components/              UI 컴포넌트 (+ 하위 폴더 5개)
  hooks/                   커스텀 훅 (7개)
  contexts/                AuthContext.jsx
  styles/                  tokens.css, pc.css, mobile.css
  utils/                   analytics.js, marketHours.js, priceFlash.js, pwa.js
  assets/
```

### `src/pages/` (23개)
허브/최상위: `Research.jsx`(홈 `/`·`/research`), `Portfolio.jsx`(`/portfolio`), `MarketHub.jsx`, `Market.jsx`, `Guru.jsx`, `Settings.jsx`, `LoginPage.jsx`, `Showcase.jsx`, `AdminAnalytics.jsx`.
허브 내 탭/하위 페이지: `Reports.jsx`, `Ranking.jsx`, `Calendar.jsx`, `Digest.jsx`, `Analytics.jsx`, `Recommendations.jsx`, `SectorTab.jsx`, `MacroTab.jsx`.

페이지 역할(task#76·ADR-0018):
- `Reports.jsx` — Research 허브 리포트 탭. **내 종목 단일 척추**: `useReportList`+`usePortfolioData()`로 리포트 목록에 보유 라이브 P&L을 머지하고, 종목 관리(추가/편집/삭제/승격)·`StockModal`/`PromoteModal`·추가 FAB를 보유한다(종목관리에서 흡수).
- `Portfolio.jsx` — `/portfolio`. **대시보드·분석(섹터/매크로/상관관계) 집계 전용**으로 슬림화(목록·관리 모달·FAB 제거). 상단 KPI·hero 집계는 유지.
Guru 계열: `GuruCrawlNow.jsx`, `GuruManagers.jsx`, `GuruStats.jsx`.
설정/관리: `ConsensusSettings.jsx`, `LeverageBackfillSettings.jsx`, `ReportManualGen.jsx`.

### `src/components/`
최상위: `BatchScheduleEditor.jsx`, `InstallPrompt.jsx`, `LoadingSpinner.jsx`, `MobileNav.jsx`(`ALL_TABS` 순서 리서치 `/` SearchIcon end:true→포트폴리오 `/portfolio` HomeIcon→시장→구루→설정, `App.jsx` TopNav와 동일), `PermissionManager.jsx`, `PermissionPanel.jsx`, `PromoteModal.jsx`, `StockModal.jsx`, `Toast.jsx`.
하위 폴더:
- `market/` — `FxSection`, `VixSection`, `CommoditiesSection`, `TreasurySection`, `EconIndicatorsSection`, `M7EarningsSection`, `KrTop2Section`, `KrExportsSection`, `LeverageSection`, `LendingSection`, `MacroSignalsSection` (+ `marketUtils.jsx` — `krFmt` 억/조 포매터).
- `portfolio/` — `DashboardCard.jsx`(+css), `FlashValue.jsx`, `PriceFreshness.jsx`(+css), `PriceFlash.css`.
- `reports/` — `ConsensusChart`, `DetailTab`, `FinancialsChart`, `HistoryTab`, `Sections`, `ReportDetailTabs`, `BacklogChart`, `InsiderTradesSection`, `InvestorTrendSection`, `LatestDisclosuresSection`, `ShortSellSection`, `SupplySection` (+ `reportUtils.jsx`).
- `recommendations/` — `RecCard.jsx`.
- `ui/` — `Badge`(+css), `Button`(+css), `Card`(+css), `Stat`(+css), `icons.jsx`, `index.js`, `InsiderBadge.jsx`, `SupplyBadge.jsx`(의미 배지는 가격색 토큰 미사용·전용 색).

### `src/hooks/` (7개)
`useAuth.js`, `useIsMobile.js`, `usePortfolioData.js`, `usePriceFlash.js`, `useReportGeneration.js`, `useReportList.js`, `useTheme.js`.

### `src/styles/`
`tokens.css`(KR 색 관례: `--up`=빨강(상승)/`--down`=파랑(하락)), `pc.css`, `mobile.css`.

## Naming conventions

- 백엔드 모듈: snake_case `.py`. 서비스는 도메인명 + `_service.py`(예: `leverage_service.py`, `ranking_service.py`)이거나 도메인명 단독(예: `backlog.py`, `dividends.py`).
- 패키지 분리 시 `__init__.py`가 구 단일 파일의 전 공개 표면을 re-export해 `import` 호환을 보존(`storage`/`market`/`scheduler`/`recommendation`). 외부 소비처는 `storage.X`·`market.X`처럼 모듈 속성으로 조회.
- 프론트 컴포넌트/페이지: PascalCase `.jsx`. 훅: `useXxx.js`. 유틸/API: camelCase `.js`. CSS는 컴포넌트와 동명 파일.
- 배치 `job_id`는 `batch_registry.BATCHES`·스케줄러 잡 id·`job_runs.record` id가 전부 동일 문자열(시장 분리: `daily_report_kr`/`_us`, `earnings_kr`/`_us`, `monthly_kr`/`_us`).

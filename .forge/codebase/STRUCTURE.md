---
last_mapped_commit: 4bb49ff0402c150884f2fa9c80dfed8dff1945d5
mapped: 2026-07-29
---

# STRUCTURE — PortfoliOn 디렉터리 지도

기능에서 파일을 찾아가는 지도. 경로는 모두 리포지토리 루트(`/Users/calmonion/Project/PortfoliOn`) 기준 상대 경로다.

---

## 1. 최상위 레이아웃

```
PortfoliOn/
├── backend/            FastAPI 앱 (Python)
├── frontend/           React 19 + Vite SPA
├── nginx/nginx.conf    HTTP(80)/HTTPS(443) 서빙 + /api/* 프록시
├── certbot/            Let's Encrypt (conf/ 는 gitignored)
├── scripts/            운영 스크립트 + UAT/프로브 (§7)
├── docs/               사람용 산문 문서 (§8)
├── .forge/             forge 상태·결정·회고 (§9)
├── .github/workflows/deploy.yml   self-hosted 러너 배포 잡
├── deploy.sh           배포 스크립트 (프론트 빌드 + 백엔드 이미지 + 컨테이너 교체)
├── docker-compose.yml  postgres / backend / nginx / certbot
├── CLAUDE.md           에이전트 지침 + 프로젝트 컨텍스트 + 가토(gotcha) 정본
├── README.md           사용자·합류자용 개요 (화면·env·스택·아키텍처·배치)
├── API_SPEC.md         전체 REST 레퍼런스 (엔드포인트 정본)
├── CLAUDE_COWORK_API.md 외부 Cowork 전용 API (enrich/backlog/발행 워크플로우)
├── KIWOOM_API.md       키움 REST API 카탈로그·대체 로드맵
├── KIS_API.md          한국투자증권 REST API 카탈로그
├── .env                docker-compose 보간용 (gitignored)
└── screenshots*/       UAT 캡처 산출물 (gitignored: screenshots/, 나머지는 untracked)
```

---

## 2. `backend/`

```
backend/
├── main.py                 앱 엔트리 — 로깅 배선 · _migrate() · lifespan · 미들웨어 · include_router ×19
├── auth.py                 인증/인가 Depends 4종 (get_current_user / _or_api_key / require_admin / _or_api_key)
├── app_schema.sql          앱 스키마 (신규 설치용 · 32 CREATE TABLE)
├── auth_schema.sql         users / refresh_tokens (app_schema.sql보다 먼저 실행)
├── requirements.txt        Docker 의존성 (anthropic 없음 — 백엔드 LLM 호출 0)
├── Dockerfile              python:3.12-slim + uvicorn main:app
├── pytest.ini              testpaths=tests, pythonpath=.
├── run_backfill.py         호스트에서 localhost:5432 postgres에 직접 붙는 독립 백필 스크립트
├── .env / .env.docker      로컬 / 컨테이너 환경변수 (둘 다 gitignored) + .env.docker.example
├── .venv/                  로컬 Python 3.9.6 가상환경 (gitignored)
├── middleware/
│   └── event_tracker.py    _TRACKED 정규식 7종 → user_events 비동기 INSERT
├── routers/                HTTP 계약 (§2.1)
├── services/               도메인 · 외부 어댑터 · 인프라 (§2.2)
├── scheduler/              APScheduler 배선 패키지 (§2.3)
├── tests/                  pytest 127 파일 + conftest.py + fixtures/ + _routes.py
├── migrations/             001_user_events.sql · 002_backlog_history.sql (수동 참고용 이력)
├── data/                   정적 시드 + 런타임 파일 캐시 (§6)
├── snapshots/              per-ticker/date 스냅샷 JSON (gitignored)
├── reports/                레거시 리포트 디렉터리 (read-only 폴백, gitignored)
└── scripts/                (빈 디렉터리)
```

### 2.1 `backend/routers/` — 19개 라우터

| 파일 | prefix | 담당 |
|---|---|---|
| `auth.py` | `/api/auth` | register·login·refresh·logout·me, Google/GitHub OAuth 4엔드포인트, `oauth/token` 코드 교환 |
| `portfolio.py` | `/api/portfolio` | 보유 CRUD·핀, `/prices`, `/dividends`, `/rebalance`+targets, `/exposure` |
| `watchlist.py` | `/api/watchlist` | 관심종목 CRUD, `/{ticker}/promote` |
| `stocks.py` | `/api/stocks` | `/dashboard`(+`/dashboard/cache` DELETE), `/search`, `/compare`, `/{ticker}/news`, `/{ticker}/supply-score`, `/enrich/batch`·`/{ticker}/enrich`, `/names/backfill`, `/dividends/refresh`, `/beta/refresh`, `/supply-score/refresh` |
| `report.py` | `/api` | `/report/generate`·`/list`·`/{ticker}/history`·`/{ticker}/{date}`, backlog·disclosures·insider·us-supply·agm refresh, `/consensus/*` |
| `analyst_reports.py` | `/api/analyst-reports` | 발행물 POST/GET/DELETE (ADR-0027) |
| `recommendations.py` | `/api/recommendations` | 저장 점수 read, `/refresh` |
| `rankings.py` | `/api` | `/rankings`, `/rankings/refresh` |
| `investor.py` | `/api` | `/investor/screening`, `/investor/refresh`, `/stocks/{ticker}/investor-trend` |
| `short_sell.py` | `/api` | `/stocks/{ticker}/short-sell`, `/short-sell/refresh` |
| `market_indicators.py` | `/api/market` | fx·vix·commodities·treasury·econ-indicators·indices·kospi-futures·fear-greed·macro-signals·kospi-signal·leverage(+backfill)·lending + refresh-earnings/monthly/market |
| `analysis.py` | `/api/analysis` | `/sector`(+`refresh-kr`/`refresh-us`), `/macro-correlation` |
| `analytics.py` | `/api/analytics` | `/correlation` |
| `calendar.py` | `/api` | `/calendar`, `/calendar/cache` DELETE, `clear_cache(user_id)` 헬퍼 |
| `digest.py` | `/api` | `/digest/latest`, `/digest/generate`, `/digest/generate-all` |
| `guru.py` | `/api/guru` | `/managers`(+`/{id}`), `/stats/popularity`·`/weighted`, `/crawl`(+`/crawl/progress`) |
| `batches.py` | `/api` | `/batches`, `/batches/fomc-coverage`, `/batches/{job_id}/schedule` GET·PUT |
| `events.py` | `/api/events` | 프론트 이벤트 수집(`VALID_EVENTS` 화이트리스트) |
| `admin.py` | `/api/admin` | `/users`, `/users/{id}/permissions`, `/users/bulk-permissions`, `/default-permissions`, `/stocks/{ticker}` DELETE(전 사용자), `/analytics/*`, `/analyst-targets`, `/cowork/fire` |

**찾을 때 주의**: `/api/stocks/{ticker}/investor-trend`와 `/api/stocks/{ticker}/short-sell`은 `stocks.py`가 아니라 `investor.py`/`short_sell.py`에 있다. `market_indicators.py`의 prefix는 `/api/market` 하나이며 `/api/market-indicators`는 존재하지 않는다.

### 2.2 `backend/services/`

**인프라 (도메인 무지)**
| 파일 | 내용 |
|---|---|
| `db.py` | `ThreadedConnectionPool(minconn=1, maxconn=20)` + `get_connection()`/`query`/`execute`/`execute_many` |
| `cache.py` | `TTLCache` + 캐시 스토어 10종 + `invalidate(ticker)` / `invalidate_portfolio_caches(user_id)` |
| `utils.py` | `sanitize()`(NaN/inf→None), `today_kst()`, `is_valid_ticker()`/`TICKER_RE`, `find_ticker*` |
| `errors.py` | `not_found()` / `already_exists()` HTTPException 팩토리 |
| `parallel.py` | `parallel_map(func, items, max_workers=10)` |
| `progress.py` | `ProgressTracker` (스레드락 dict: running/done/total/current/failed) |
| `job_runs.py` | `record(job_id, trigger)` 컨텍스트 매니저, job_id별 최근 20건 보관 |
| `batch_registry.py` | `BATCHES` 29종 정적 메타 + `get_batch(job_id)`, `_BY_ID` (docstring은 "20개"라 적혀 있으나 stale — 테스트 3곳이 `== 29`를 단언) |
| `schedule_spec.py` | daily/weekly/monthly/interval 4패턴 `validate_schedule_spec` + `build_trigger_kwargs` |

**저장소 — `services/storage/`** (ADR-0017 re-export 패키지)
`__init__.py`(전 심볼 re-export) · `portfolio.py`(보유/관심/enrich/타겟/핀) · `names.py`(종목명 dual-source 동기화) · `schedule.py`(batch_schedules·레거시 schedules·guru_*) · `dates.py`(`expected_report_date(market)`·`_now_kst`)

**시세 소스 — `services/market/`** (re-export 패키지)
`__init__.py`(`get_quote`·`get_quotes_batch`·`get_history_df`·`get_financials`·`get_annual_financials`·`get_analyst_data`·`resolve_name`·`_changes_from_closes`) · `kr.py`(Naver/FnGuide/키움/KIS 피드 + `_corroborated_pick`·`_kr_pick_*` 다수결 + DART 연간재무·R&D) · `us.py`(yfinance 연간재무 + `_us_quote_kis` 백업) · `format.py`(`_yf_sym`·`_yf_val`·`_to_won`·`_fmt_*`·`_norm_sector`)

**증권사 API — `services/kiwoom/`, `services/kis/`**
`kiwoom/`: `client.py`(토큰 싱글톤·throttle·`integrated_code(stk_cd, regular)`) · `quote.py`(ka10001) · `chart.py`(ka10081 일봉) · `investor.py` · `sector.py`(ka20006/ka20002) · `shortsell.py`
`kis/`: `client.py`(`/oauth2/tokenP`·60s 재발급 가드) · `quote.py`(국내 `FHKST01010100` / 해외 `HHDFS*`) · `futures.py`(국내선물 `FHMIF10000000`·`FHKIF03020100`)

**시장지표 — `services/market_indicators/`**
`cache.py`(`_mc_load`/`_mc_save`/`_mc_delete`/`_get_cache`/`_set_cache`/`get_or_refresh`) · `fx.py`(FX·VIX) · `commodities.py`(원자재·국채) · `earnings.py`(M7·KR Top2 + 티커 목록 캐시) · `econ.py`(FRED 경제지표) · `exports.py`(KR 수출) · `macro.py`(FRED 금리차·HY·M2·기준금리 + 신호 판정) · `indices.py`(지수 레벨 + S&P500 Shiller CAPE) · `kospi_futures.py` · `kospi_signal.py` · `sentiment.py`(CNN Fear&Greed)

**리포트 파이프라인**
`report_generator.py`(스냅샷 생성·백필·KR 박제 게이트) · `scraper.py` · `indicators.py`(RSI·EMA·52주·HV·매물대) · `consensus.py`(`get_asof`/`apply_asof`, ADR-0008) · `consensus_pipeline.py`(opinion→5점 `_SCORE_MAP`) · `analyst_reports.py`(발행물 조립·`per_band`)

**외부 데이터 수집**
`disclosures.py`(DART 공시 목록 A·B·C·D 유형별) · `agm.py`(DART no-type + document.xml 회의일 파싱) · `backlog.py`+`backlog_parser.py`(DART document.xml 수주잔고 + 검산) · `dividends.py`(US yfinance / KR DART) · `insider_trades.py` · `us_supply.py` · `leverage_service.py`(KOFIA) · `lending_service.py`(금융위) · `short_sell_service.py` · `investor_service.py` · `ranking_service.py` · `kr_sector_service.py` · `us_sector_service.py` · `guru_scraper.py`(dataroma + Naver US 한글명)

**계산·도메인**
`analysis_service.py`(SECTOR_ETFS·MACRO_TICKERS) · `rebalance.py`(순수) · `exposure.py`(순수, `rebalance.value_holdings_krw` 재사용) · `supply_score.py` · `beta.py` · `guru_stats.py`(`compute_popularity`/`compute_weighted`, 순수) · `digest_service.py` · `auth_service.py`(bcrypt) · `cowork_trigger.py`(루틴 fire POST, ADR-0028) · `recommendation/`(`universe.py`·`funnel.py`·`scoring.py`·`actions.py`·`store.py`)

### 2.3 `backend/scheduler/`

| 파일 | 내용 |
|---|---|
| `_state.py` | `AsyncIOScheduler()` 싱글톤 + `_DIGEST_JOB_ID` + `_VALID_DAYS` (leaf — 부분초기화 순환 회피) |
| `jobs.py` | 잡 함수 전체(`_generate_kr`/`_generate_us`/`_run_guru_crawl`/`_fetch_*`/`_refresh_*`/`_seed_*_if_empty`) + `_JOB_FUNCS` 28개 매핑 |
| `schedule.py` | `_build_trigger`·`_reschedule_job`·`_seed_spec_for`·`_seed_batch_schedules`·`_check_missed_report(_for)` |
| `__init__.py` | `start()`/`stop()`/`reload(job_id)` + 위 심볼 전부 re-export(`import *`가 놓치는 underscore 심볼은 명시 열거) |

**주의**: 단일 `backend/scheduler.py` 파일은 존재하지 않는다(패키지다). 배치를 추가/은퇴할 때 손대야 하는 곳은 `batch_registry.BATCHES` + `jobs.py`의 함수 + `_JOB_FUNCS` + `job_runs.record` 호출처 + 테스트의 count/set 하드코딩(`test_scheduler_seed.py`·`test_batch_market_split.py`·`test_batches_router.py`·`test_macro_signals_batch.py`).

### 2.4 `backend/tests/`

- `conftest.py` — `main.app`의 `get_current_user` override, `client` fixture, autouse `_clear_quote_cache`, autouse **`_block_real_db`**(`db._get_pool` → raise).
- `_routes.py`, `fixtures/` — 공용 라우트 목록·픽스처.
- 네이밍: `test_<라우터|서비스|기능>.py`. 라우터는 `test_*_router.py`, 규약 가드는 `test_no_*.py`(`test_no_print.py`·`test_no_bare_today.py`·`test_no_public_reads.py`), 동기 검사는 `test_api_doc_sync.py`, 보안은 `test_security_auth_gaps.py`.
- 실행: `cd backend && .venv/bin/python -m pytest`.

---

## 3. `frontend/`

```
frontend/
├── index.html            SPA 엔트리 HTML
├── vite.config.js        플러그인(react·VitePWA·sw-cache-bust) + manualChunks(함수형) + test(jsdom)
├── package.json          scripts: dev / build / test(vitest run) / lint / preview
├── public/               정적 자산(favicon.svg 등)
├── dist/                 빌드 산출물 — nginx가 :ro 로 직접 서빙 (gitignored)
└── src/
    ├── main.jsx          createRoot + tokens.css/motion.css/index.css import
    ├── App.jsx           세션 부트스트랩 · Provider 조립 · AppShell · <Routes>
    ├── App.css           앱 셸 레이아웃
    ├── index.css         전역 리셋/베이스
    ├── routes.js         REDIRECTS (구 URL → 신규 라우트, ADR-0025)
    ├── api.js            axios 인스턴스 + Bearer 주입 + 401 인터셉터
    ├── utils.js          fmtPrice(val, market) — 단일 함수 (utils/ 폴더와 별개)
    ├── contexts/AuthContext.jsx   role · menuPermissions · loading
    ├── hooks/            커스텀 훅 (§3.2)
    ├── pages/            화면 (§3.1)
    ├── components/       재사용 컴포넌트 (§3.3)
    ├── styles/           tokens.css · pc.css · mobile.css · motion.css · guru.css
    ├── glossary/         terms.js(용어 데이터) · match.js(longest-match) + match.test.js
    ├── utils/            analytics.js · guruName.js · marketHours.js · priceFlash.js · pwa.js
    ├── assets/           이미지·폰트
    └── test/             교차 화면 통합 테스트 + setup.js (§3.4)
```

### 3.1 `frontend/src/pages/`

| 파일 | 라우트 / 용도 |
|---|---|
| `ResearchShell.jsx` | 리서치·일정 계열 래퍼 — `RESEARCH_TABS` / `SCHEDULE_TABS`(모바일 seg) |
| `Reports.jsx` | `/reports` — 리포트 목록 + 보유/관심 관리(라이브 P&L·편집·삭제·승격·추가) |
| `Recommendations.jsx` | `/recommend` |
| `Ranking.jsx` | `/ranking` |
| `Compare.jsx` (+ `Compare.css`) | `/compare` |
| `AnalystReports.jsx` / `AnalystReport.jsx` | `/analyst-reports`, `/analyst-report/:ticker/:date` |
| `Calendar.jsx` | `/calendar` |
| `Dividends.jsx` | `/dividends` |
| `Digest.jsx` | `/digest` |
| `Portfolio.jsx` | `/portfolio` — 내부 탭 `dash`/`analysis`, analysisTab `sector` 등 |
| `SectorTab.jsx` / `MacroTab.jsx` / `RebalanceTab.jsx` / `ExposureTab.jsx` / `Analytics.jsx` | Portfolio 분석 탭 하위 뷰 |
| `MarketHub.jsx` → `Market.jsx` | `/market/indicators`, `/market/flow` (`TABS`) |
| `Guru.jsx` | `/guru` — `TABS` 평탄화(매니저 목록/인기순/가중치) |
| `GuruManagers.jsx` / `GuruStats.jsx` / `GuruDetail.jsx` / `GuruCrawlNow.jsx` | 구루 하위 화면 (`GuruDetail` = `/guru/:id`) |
| `Settings.jsx` | `/settings` |
| `AdminAnalytics.jsx` | `/admin-analytics` (admin) |
| `ConsensusSettings.jsx` / `LeverageBackfillSettings.jsx` / `ReportManualGen.jsx` | 설정 하위 패널 |
| `LoginPage.jsx` (+ `LoginPage.css`) | 미로그인 시 App이 직접 렌더 |
| `Showcase.jsx` | `/dev/showcase` — UI 토큰·컴포넌트 쇼케이스 |

동일 폴더의 `*.test.jsx`(`AnalystReport`·`AnalystReports`·`GuruDetail`·`GuruManagers`·`GuruStats`)가 그 페이지의 단위 테스트다.

### 3.2 `frontend/src/hooks/`

| 훅 | 역할 |
|---|---|
| `usePortfolioData.js` | `/api/portfolio` 목록 + `/api/portfolio/prices` 폴링 + `/api/stocks/dashboard` + FX + `priceTick` |
| `useStockManagement.js` | 추가·수정·삭제·승격 (콜백 주입식: `fetchList`·`showToast`·`setActiveTab`) |
| `useReportList.js` / `useReportFilters.js` / `useReportGeneration.js` | 리포트 목록·필터·생성 진행률 |
| `useTheme.js` | light/dark + `data-theme` 스탬프 |
| `useIsMobile.js` | 뷰포트 분기 (PC/모바일 셸 선택) |
| `useBodyScrollLock.js` / `usePriceFlash.js` / `useCountUp.js` / `useReveal.js` | 모달 스크롤락 · 가격 플래시 · 카운트업 · 스크롤 리빌 |
| `useAuth.js` | `contexts/AuthContext`의 `useAuth` 재수출(shim) |

`usePortfolioData.test.js`·`useStockManagement.test.js`·`useReportFilters.test.js`가 동일 폴더에 있다.

### 3.3 `frontend/src/components/`

**셸·전역**: `Masthead.jsx`(+`.css`, `SECTIONS` 5섹션) · `MobileNav.jsx`(`ALL_TABS`) · `MobileTopActions.jsx` · `GlobalSearch.jsx` · `Toast.jsx`(ToastProvider) · `LoadingSpinner.jsx` · `InstallPrompt.jsx`(+`.css`, PWA 설치 유도) · `Glossary.jsx`(+`.css`) · `StockModal.jsx` · `PromoteModal.jsx` · `StockSearchBox.jsx` · `BatchScheduleEditor.jsx` · `PermissionManager.jsx` · `PermissionPanel.jsx`(+`.test.jsx`)

**`ui/`** — 프리미티브: `Badge.jsx`(+css, `--up`/`--down`/`success`/`danger`/`warning` 변형) · `Button` · `Card` · `Stat` · `Input` · `Skeleton` · `icons.jsx` · `index.js`(배럴) + 도메인 배지 3종 `GuruActivityBadge.jsx` · `InsiderBadge.jsx` · `SupplyBadge.jsx`

**`reports/`** — 리포트 목록·상세: `StockCard.jsx` · `TickerListItem.jsx` · `StockActions.jsx`(액션버튼 **단일 정본**, `layout="card"|"list"`) · `ReportDetailHeader.jsx` · `ReportDetailTabs.jsx` · `ReportDetail.css` · `ReportFilters.jsx` · `DetailTab.jsx` · `HistoryTab.jsx` · `Sections.jsx`(+test) · `reportUtils.jsx`(+test) · 차트/섹션: `ConsensusChart` · `FinancialsChart` · `BacklogChart` · `KeyResourceChart`(+test) · `InvestorTrendSection` · `ShortSellSection` · `SupplySection` · `InsiderTradesSection` · `UsInsiderSection` · `UsSupplySection` · `LatestDisclosuresSection` · `MarketOutlookSection`(+test) · `GuruHoldersSection`(+test)

**`market/`** — 시장/수급 지표 섹션(1섹션 = 1파일): `FxSection` · `VixSection` · `CommoditiesSection` · `TreasurySection` · `EconIndicatorsSection` · `M7EarningsSection` · `KrTop2Section` · `KrExportsSection` · `IndexSection` · `KospiFuturesSection` · `KospiSignalSection` · `MacroSignalsSection` · `FearGreedSection` · `LeverageSection` · `LendingSection` + `marketUtils.jsx`(`krFmt` — **입력은 '억원' 단위 가정**) + `Market.css`

**`portfolio/`**: `DashboardCard.jsx`(+`.css`) · `FlashValue.jsx` · `PriceFreshness.jsx`(+`.css`) · `PriceFlash.css`
**`recommendations/`**: `RecCard.jsx`
**`sketches/`**: 손그림 SVG 일러스트 + 섹션 아이콘 (`IconResearch`·`IconPortfolio`·`IconMarket`·`IconGuru`·`IconCalendarIncome`, `SketchHero`·`SketchEmpty`·`SketchError`·`SketchNotFound`·`SketchArrowUp`·`SketchCircleMark`·`SketchUnderline`) + `index.js` 배럴

### 3.4 `frontend/src/test/`

교차 화면 통합 테스트: `smoke.test.js` · `route-redirects.test.jsx`(`routes.js`의 REDIRECTS 검증) · `masthead.test.jsx` · `compare-race.test.jsx` · `compare-sector-group.test.jsx` · `global-search-tracked.test.jsx` · `recommendations-s3s4.test.jsx` · `reports-deep-link-navkey.test.jsx` + `setup.js`(vitest setupFiles).
단위 테스트는 대상 파일 옆(`pages/`·`hooks/`·`components/`)에 코로케이트한다.
실행: `cd frontend && npm test`.

---

## 4. 기능 → 파일 지도

| 기능 | 백엔드 | 프론트 |
|---|---|---|
| 로그인·OAuth | `routers/auth.py`, `services/auth_service.py`, `auth.py` | `App.jsx`(부트스트랩), `pages/LoginPage.jsx`, `api.js` |
| 메뉴 권한 | `routers/admin.py`(`ALL_MENUS`), `user_menu_permissions` | `contexts/AuthContext.jsx`, `components/Masthead.jsx`, `components/MobileNav.jsx`, `components/PermissionManager.jsx` |
| 보유/관심 종목 관리 | `routers/portfolio.py`, `routers/watchlist.py`, `services/storage/portfolio.py` | `pages/Reports.jsx`, `hooks/useStockManagement.js`, `components/StockModal.jsx`, `components/PromoteModal.jsx`, `components/reports/StockActions.jsx` |
| 대시보드(라이브 P&L) | `routers/stocks.py`(`/dashboard`, `_build_all`/`_build_card`/`_minimal_card`) | `pages/Portfolio.jsx`, `components/portfolio/DashboardCard.jsx`, `hooks/usePortfolioData.js` |
| 리포트 생성·목록·상세 | `routers/report.py`, `services/report_generator.py`, `services/indicators.py`, `services/scraper.py` | `pages/Reports.jsx`, `components/reports/*` |
| 심층(발행) 리포트 | `routers/analyst_reports.py`, `services/analyst_reports.py`, `analyst_reports` 테이블 | `pages/AnalystReports.jsx`, `pages/AnalystReport.jsx` |
| 컨센서스 | `services/consensus.py`, `services/consensus_pipeline.py`, `daily_consensus_mart` | `components/reports/ConsensusChart.jsx`, `pages/ConsensusSettings.jsx` |
| 추천 | `routers/recommendations.py`, `services/recommendation/*` | `pages/Recommendations.jsx`, `components/recommendations/RecCard.jsx` |
| 랭킹 | `routers/rankings.py`, `services/ranking_service.py`, `market_rankings` | `pages/Ranking.jsx` |
| 수급(투자자 추이·공매도·스코어) | `routers/investor.py`, `routers/short_sell.py`, `services/investor_service.py`·`short_sell_service.py`·`supply_score.py` | `components/reports/InvestorTrendSection.jsx`·`ShortSellSection.jsx`·`SupplySection.jsx`, `components/ui/SupplyBadge.jsx` |
| 시장지표 | `routers/market_indicators.py`, `services/market_indicators/*` | `pages/MarketHub.jsx`→`Market.jsx`, `components/market/*` |
| 신용·대차잔고 | `services/leverage_service.py`, `services/lending_service.py` | `components/market/LeverageSection.jsx`·`LendingSection.jsx`, `pages/LeverageBackfillSettings.jsx` |
| 섹터·매크로 상관 | `routers/analysis.py`, `routers/analytics.py`, `services/analysis_service.py`, `kr_sector_service.py`, `us_sector_service.py` | `pages/SectorTab.jsx`, `pages/MacroTab.jsx`, `pages/Analytics.jsx` |
| 리밸런싱·노출 | `services/rebalance.py`, `services/exposure.py`(둘 다 순수) | `pages/RebalanceTab.jsx`, `pages/ExposureTab.jsx` |
| 캘린더 | `routers/calendar.py`, `services/agm.py`, `calendar_cache` | `pages/Calendar.jsx` |
| 배당 | `services/dividends.py`, `stock_dividends`/`stock_dividend_schedule` | `pages/Dividends.jsx` |
| 다이제스트 | `routers/digest.py`, `services/digest_service.py`, `digests` | `pages/Digest.jsx` |
| 공시·수주잔고·내부자 | `services/disclosures.py`, `services/backlog.py`+`backlog_parser.py`, `services/insider_trades.py` | `components/reports/LatestDisclosuresSection.jsx`·`BacklogChart.jsx`·`InsiderTradesSection.jsx` |
| 구루 | `routers/guru.py`, `services/guru_scraper.py`, `services/guru_stats.py`, `guru_managers` | `pages/Guru.jsx`·`GuruManagers.jsx`·`GuruStats.jsx`·`GuruDetail.jsx`, `utils/guruName.js`, `components/ui/GuruActivityBadge.jsx` |
| 배치 현황·스케줄 편집 | `routers/batches.py`, `services/batch_registry.py`, `services/job_runs.py`, `backend/scheduler/*` | `pages/Settings.jsx`, `components/BatchScheduleEditor.jsx` |
| 행동 분석 | `middleware/event_tracker.py`, `routers/events.py`, `routers/admin.py`(`/analytics/*`) | `utils/analytics.js`, `pages/AdminAnalytics.jsx` |
| 용어집 툴팁 | — (프론트 전용) | `glossary/terms.js`, `glossary/match.js`, `components/Glossary.jsx` |
| PWA·설치 유도 | — | `frontend/vite.config.js`(VitePWA), `utils/pwa.js`, `components/InstallPrompt.jsx` |
| Cowork 연동 | `CLAUDE_COWORK_API.md`, `routers/stocks.py`(enrich), `routers/report.py`, `services/cowork_trigger.py`, `routers/admin.py`(`/cowork/fire`) | — |

---

## 5. 네이밍 관례

### 백엔드 (Python)
- 모듈·함수·변수 `snake_case`, 클래스 `PascalCase`.
- 라우터 파일은 도메인 단수/복수 그대로(`portfolio.py`·`stocks.py`·`rankings.py`), 각 파일에 `router = APIRouter(prefix=..., tags=[...])` 하나.
- 서비스 파일: 외부 소스 어댑터는 `<도메인>_service.py`(`leverage_service.py`·`investor_service.py`·`ranking_service.py`) 또는 도메인 명사(`dividends.py`·`disclosures.py`·`backlog.py`). 여러 파일로 커진 것만 패키지로 승격(`market/`·`storage/`·`market_indicators/`·`recommendation/`·`kiwoom/`·`kis/`).
- **선행 밑줄 `_`는 "모듈 내부용"** 이지만, 패키지 분할 후 `__init__.py`가 외부참조 private 심볼(`_yf_sym`·`_JOB_FUNCS`·`_mc_load`)을 re-export한다 — `_` 접두사가 곧 비공개를 뜻하지 않는다.
- 배치 job_id는 `<도메인>_<동작>` 소문자 스네이크(`disclosure_fetch`·`supply_score_fetch`·`macro_signals_fetch`), 시장 분리 배치는 접미사 `_kr`/`_us`(`daily_report_kr`·`earnings_us`·`recommendation_kr`).
- 로그 마커는 `logger.x(f"[Component] <무엇> (<ids>): {e}")` — `[Component]`는 **PascalCase, 개념당 1스펠링**(`[Migrate]`·`[Scheduler]`·`[Cache]`·`[Report]`). 포맷터에 프리픽스가 없으므로 이 마커가 유일한 grep 앵커다. 신규 `print` 금지(`tests/test_no_print.py`).
- DART XBRL 상수는 `_DART_<약어>`(`_DART_OCF`·`_DART_CAPEX`), 정규식은 `_<이름>_RE`(`_ACTIVITY_RE`·`_TIME_RE`·`_RD_UNIT_RE`).

### 프론트 (JS/JSX)
- 컴포넌트 파일 `PascalCase.jsx`(default export 1개), 훅 파일 `use*.js`(default export), 유틸 `camelCase.js`(named export).
- 페이지=`pages/`, 재사용=`components/`, 도메인 묶음은 `components/<도메인>/`(market·reports·portfolio·recommendations·ui·sketches).
- CSS는 컴포넌트와 같은 이름으로 코로케이트(`DashboardCard.jsx` ↔ `DashboardCard.css`), 전역/토큰만 `styles/`.
- 테스트는 대상 파일 옆 `<대상>.test.js(x)`, 교차 화면만 `src/test/<주제>.test.jsx`.
- 콘솔 마커는 **소스 모듈/훅 실명**(`[usePortfolioData]`) — 백엔드 `[Component]` 개념명과 규칙이 다르다.
- 상수 배열/맵은 파일 상단 `UPPER_SNAKE`(`RESEARCH_TABS`·`SECTIONS`·`ALL_TABS`·`REDIRECTS`·`DONUT_COLORS`·`KIND_DISPLAY`).
- 색·간격은 리터럴 대신 CSS 변수(`var(--up)`·`var(--data-1)`·`var(--semantic-buy)`).

---

## 6. 정적 데이터 vs 런타임 캐시 — 어디에 무엇이 있는가

| 위치 | 성격 | git |
|---|---|---|
| `backend/data/sp500_tickers.json`, `backend/data/kospi_tickers.json` | **read-only 정적 시드**. 캐시 정본은 DB `market_cache`의 `sp500_tickers`/`kospi_tickers`(task#234 이후 파일 write 경로 0) | tracked |
| `backend/data/digest/2026-05-24.json` | 과거 샘플 1건 | tracked |
| `backend/data/consensus/` | per-ticker 컨센서스 로컬 파일 캐시 | ignored |
| `backend/data/calendar/` | 레거시 캘린더 파일 캐시(현행 미사용 — DB `calendar_cache`가 정본) | ignored |
| `backend/data/holdings.json`·`watchlist.json`·`stocks.json`·`schedule.json`·`guru_schedule.json`·`guru_managers.json`·`kr_exports.json` | 레거시/런타임 파일 저장 잔존 | ignored |
| `backend/snapshots/` | per-ticker/date 스냅샷 JSON(DB 스냅샷의 파일 폴백) | ignored |
| `backend/reports/` | 레거시 리포트(read-only 폴백) | ignored |
| PostgreSQL (Docker `pgdata` 볼륨) | **런타임 데이터 정본** — 32+2 테이블 | — |
| 프로세스 메모리 | `services/cache.py` 10종 + `market_indicators/cache.py:_cache` | — |
| `frontend/dist/` | 빌드 산출물(nginx가 직접 서빙) | ignored |
| `certbot/conf/` | 인증서·계정키 | ignored |
| `backend/.env`, `backend/.env.docker`, 루트 `.env` | 비밀값 | ignored (`.env.docker.example`만 tracked) |

**함정**: 전체 pytest 스위트 실행 후 `git status`로 부수효과(tracked 파일 modified)를 확인하는 습관을 유지할 것 — 과거 `backend/data/*_tickers.json`이 테스트 중 라이브 스크레이프 결과로 덮이던 경로가 있었다.

---

## 7. `scripts/` — 운영 스크립트와 프로브 관례

```
scripts/
├── auto-deploy-poll.sh        launchd 2분 폴러 (배포 폴백)
├── start-docker-compose.sh    launchd docker compose 기동
├── ddns_update.sh             DDNS 갱신
├── cowork-fire-listener.py    Cowork 루틴 fire 수신측
├── cowork-routine-prompt.md   루틴 프롬프트 정본
├── audit_unauth_endpoints.py  무인증 엔드포인트 감사 (routes + original_router 재귀 하강)
├── kospi_signal_backtest.py   KOSPI 신호 백테스트
├── repair-005930-snapshots.py 오염 스냅샷 복구 (일회성)
├── contrast_probe.py          대비비 측정
├── check-permissions.js       권한 확인
├── screenshot.js / capture-ux.js / capture-report-detail.js   범용 캡처
├── uat<NNN>-<주제>.mjs        태스크별 라이브 UAT (Playwright)
├── probe<NNN>-<주제>.{mjs,py} 태스크별 진단 프로브
├── smoke<NNN>-auth.mjs        인증 스모크
├── package.json / node_modules/   Playwright 등 (node_modules는 gitignored)
└── screenshots-uat194/        일부 캡처 산출물
```

**관례**
- 파일명에 **태스크 번호**를 박는다: `uat<번호>-<주제>.mjs` / `probe<번호>-<주제>` / `smoke<번호>-*`. 번호로 회고(`.forge/retro/`)와 대조할 수 있다.
- 확장자: 라이브 브라우저 검증은 `.mjs`(ESM, Playwright), 백엔드/DB 프로브는 `.py`. 초기 것들만 `.js`(`uat-79.js`~`uat-81.js`).
- 캡처 산출물은 리포지토리 루트의 `screenshots-uat<번호>/`에 쌓인다(untracked). `screenshots/`만 gitignore에 명시.
- 컨테이너 내부 프로브는 `docker exec -i portfolion-backend-1 python - < probe.py` 패턴을 쓴다.
- 라이브 프로브는 리터럴 임계값이 아니라 **불변식**을 단언하고, 비교 상대의 좌표도 `getBoundingClientRect()`로 실측한다.

---

## 8. `docs/` — 사람용 산문 문서

`docs/ARCHITECTURE.md` · `docs/API.md` · `docs/CONFIGURATION.md` · `docs/DEVELOPMENT.md` · `docs/GETTING-STARTED.md` · `docs/TESTING.md` · `docs/investment-info-gap-analysis.md` · `docs/ops/` · `docs/superpowers/`(ignored).

**주의**: `docs/ARCHITECTURE.md`는 이 파일(`.forge/codebase/ARCHITECTURE.md`)과 별개이며 stale할 수 있다. 엔드포인트 정본은 루트 `API_SPEC.md`, 기능 표면 개요는 루트 `README.md`, 가토·규약 정본은 루트 `CLAUDE.md`다.

---

## 9. `.forge/` 레이아웃

```
.forge/
├── CONTEXT.md          도메인 용어집·개념 정본 (용어 *정의*는 여기에만)
├── config.json         forge 설정 ({"eco": true})
├── adr/                0001~0029 결정 기록 + retired/ (은퇴 ADR)
├── backlog/            그릴링 완료·미실행 계획 (<slug>.md)
├── executed/           실행 완료·회고 대기
├── done/               봉인 완료 (234 디렉터리, <YYYY-MM-DD>-<slug>/)
├── retro/              회고 로그 (204 파일, <YYYY-MM-DD>-<slug>.md)
├── quick/LOG.md        경량 레인 1줄 기록
├── codebase/           ← 이 지도 문서들 (ARCHITECTURE.md · STRUCTURE.md)
└── bug-report.md       임시 버그 노트
```

- 활성 슬롯(`.forge/plan.md`·`run.md`·`STATUS.md`)은 진행 중일 때만 존재한다.
- `.forge/` 전체가 untracked이므로 배포 폴러의 `git reset --hard` 대상이 아니다(안전).
- ADR 번호는 재사용하지 않고, 은퇴 시 `adr/retired/`로 이동한다.

---

## 10. 빠른 참조 — 자주 찾는 진입점

| 찾는 것 | 파일 |
|---|---|
| 엔드포인트 전체 목록 | `API_SPEC.md` (자동 검증: `backend/tests/test_api_doc_sync.py`) |
| Cowork 전용 API | `CLAUDE_COWORK_API.md` |
| DB 테이블 정의 | `backend/app_schema.sql` + `backend/auth_schema.sql` + `backend/main.py:_migrate()` |
| 배치 목록·스케줄 기본값 | `backend/services/batch_registry.py` |
| 배치 함수 배선 | `backend/scheduler/jobs.py`(`_JOB_FUNCS`) |
| 캐시 전종·무효화 | `backend/services/cache.py` |
| 시세 폴백 체인 | `backend/services/market/__init__.py` + `kr.py` |
| 인증 의존성 | `backend/auth.py` |
| 메뉴 권한 목록 | `backend/routers/admin.py`(`ALL_MENUS`) |
| 프론트 라우트 | `frontend/src/App.jsx` + `frontend/src/routes.js` |
| 프론트 nav 목록(4곳) | `components/Masthead.jsx`, `components/MobileNav.jsx`, `pages/ResearchShell.jsx`, `pages/MarketHub.jsx` |
| 디자인 토큰 | `frontend/src/styles/tokens.css` |
| 빌드·청크·PWA·vitest 설정 | `frontend/vite.config.js` |
| 배포 절차 | `deploy.sh` (+ `.github/workflows/deploy.yml`, `scripts/auto-deploy-poll.sh`) |
| 키움/KIS API 카탈로그 | `KIWOOM_API.md`, `KIS_API.md` |

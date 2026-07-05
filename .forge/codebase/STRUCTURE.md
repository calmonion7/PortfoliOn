---
last_mapped_commit: a07e6406ac475d8ef7b5c2b0df2af9c99383cbd5
mapped: 2026-07-04
---

# STRUCTURE — PortfoliOn

디렉터리 레이아웃, 핵심 파일 위치, 명명 규칙. (아키텍처·데이터 흐름은 `ARCHITECTURE.md`.)

## 최상위

```
/Users/calmonion/Project/PortfoliOn/
├── backend/            FastAPI 앱
├── frontend/           React + Vite 앱
├── API_SPEC.md         전체 REST API 레퍼런스 (엔드포인트 정본)
├── CLAUDE_COWORK_API.md 외부 Cowork(AI enrich) API 명세
├── KIWOOM_API.md       키움 REST API 카탈로그
├── KIS_API.md          한국투자증권 REST API 카탈로그
├── README.md           overview (화면·env·스택·아키텍처·배치)
├── CLAUDE.md           프로젝트 지침 + 컨텍스트
├── deploy.sh           정식 배포 스크립트
├── scripts/            auto-deploy-poll.sh 등
├── docker-compose.yml  nginx/backend/postgres/certbot
├── nginx.conf
├── start.sh / start.bat / stop.bat
└── .forge/             forge 상태 (codebase/·adr/·backlog/·retro/ …)
```

## backend/

```
backend/
├── main.py             앱 진입 · 라우터 마운트 · _migrate · lifespan
├── auth.py             인증 의존성 (get_current_user, require_admin, require_admin_or_api_key, API 키)
├── auth_schema.sql     PostgreSQL 인증 스키마 (users, refresh_tokens) — app_schema.sql보다 먼저 실행
├── app_schema.sql      PostgreSQL 앱 스키마 (tickers, user_stocks, snapshots, …)
├── supabase_schema.sql 레거시 (Supabase 시절)
├── requirements.txt    (anthropic 없음 — 백엔드 LLM 호출 없음)
├── Dockerfile · Procfile · pytest.ini
├── run_backfill.py
├── routers/            APIRouter 계층 (아래)
├── services/           도메인 로직·외부 연동·DB (아래)
├── scheduler/          APScheduler 패키지 (아래)
├── middleware/         event_tracker.py (+ __init__.py)
├── migrations/         001_user_events.sql, 002_backlog_history.sql
├── data/               정적 참조 + 로컬 캐시 (아래)
├── snapshots/          gitignored — per-ticker/date 리포트 JSON
├── reports/            gitignored — 레거시 리포트 (read-only 폴백)
└── tests/              pytest (아래)
```

### backend/routers/

`APIRouter` 파일 (파일당 `prefix="/api/..."`). main.py에서 include.

```
routers/
├── auth.py             /api/auth — 로그인·OAuth·토큰
├── portfolio.py        /api/portfolio — 보유 목록·prices 폴링·rebalance(계산·targets 저장)
├── watchlist.py        /api/watchlist — 관심 종목·promote
├── stocks.py           /api/stocks — dashboard·enrich·dividends·supply-score
├── report.py           /api (report) — 리포트 생성·목록·상세·backlog·disclosures·agm
├── recommendations.py  /api/recommendations — 추천 조회·refresh
├── rankings.py         /api/rankings — 거래대금/거래량/등락률 랭킹
├── investor.py         /api/investor — 수급 추이
├── short_sell.py       /api/short-sell — 공매도 추이
├── market_indicators.py /api/market·/api/market-indicators — FX/VIX/원자재/국채/경제/실적/수출/매크로/신용/대차
├── analysis.py         /api/analysis — 섹터 모멘텀·매크로 상관
├── analytics.py        /api/analytics — 보유 종목 상관관계
├── calendar.py         /api/calendar — 캘린더 이벤트 (파일 캐시)
├── digest.py           /api/digest — 일일 다이제스트
├── guru.py             /api/guru — 구루 크롤·통계·스케줄
├── batches.py          /api/batches — 배치 현황 허브
├── events.py           /api/events — 사용자 행동 이벤트
├── admin.py            /api/admin — 사용자·권한·analytics (require_admin)
└── __init__.py
```

### backend/services/

```
services/
├── db.py               ThreadedConnectionPool + query/execute/execute_many
├── batch_registry.py   BATCHES 메타데이터 리스트 + get_batch
├── job_runs.py         배치 실행로그 record/recent/recent_map
├── cache.py            인메모리 캐시 8종 (snapshot LRU + TTL 7종)
├── utils.py            sanitize (NaN/inf → None)
├── errors.py · parallel.py · progress.py · schedule_spec.py
├── report_generator.py 리포트 스냅샷 생성 (generate_report / _with_retry / backfill_ticker)
├── rebalance.py        리밸런싱 순수 계산 (compute_rebalance — DB/외부호출 없음)
├── consensus.py · consensus_pipeline.py  컨센서스 수집·표준화 (run_daily)
├── scraper.py · guru_scraper.py · guru_stats.py  구루 (dataroma)
├── digest_service.py   다이제스트 생성·텔레그램
├── analysis_service.py 섹터 ETF·매크로 상관
├── kr_sector_service.py · us_sector_service.py  업종 모멘텀 (market_cache)
├── ranking_service.py  랭킹 (market_rankings)
├── investor_service.py · short_sell_service.py · supply_score.py  수급
├── us_supply.py        US 공매도·기관 보유
├── leverage_service.py · lending_service.py  KOFIA/금융위 (신용·대차)
├── backlog.py · backlog_parser.py  수주잔고 (DART document.xml)
├── disclosures.py · agm.py · insider_trades.py  DART 공시·주총·지분
├── dividends.py        배당 (yfinance/DART → stock_dividends)
├── indicators.py       RSI·EMA·HV 등 기술 지표
├── auth_service.py     JWT (HS256, jose) · 비밀번호 해시 · OAuth upsert
├── storage/            re-export 패키지 (ADR-0017)
│   ├── __init__.py     portfolio·names·schedule·dates + db 심볼 re-export
│   ├── portfolio.py    get/save_stocks·holdings·watchlist, get_global_portfolio, enrich_stock, set_target_weights (target_weight COALESCE preserve-on-null)
│   ├── names.py        종목명 dual-source 동기 (refresh_snapshot_names, reconcile_snapshot_names)
│   ├── schedule.py     schedules·guru_schedules·batch_schedules 읽기/쓰기
│   └── dates.py        expected_report_date(s) — 시장별 기대 스냅샷 날짜
├── market/             시세 패키지 (ADR-0017)
│   ├── __init__.py     get_quote·get_quotes_batch·get_history_df·get_financials·resolve_name
│   ├── format.py       _yf_sym·_norm_sector·_to_won·_yf_val 등 포매팅
│   ├── kr.py           get_quote_kr (키움→KIS→Naver 다수결) + Naver/FnGuide + KR 재무
│   └── us.py           get_annual_financials_us + KIS US 백업 (_us_quote_kis)
├── market_indicators/  시장지표 패키지
│   ├── __init__.py     get_econ_indicators·get_kr_exports + _fetch_and_save_* (배치)
│   ├── cache.py        _mc_load/_mc_save (market_cache 테이블) + get_or_refresh 증분
│   ├── fx.py · commodities.py  FX/VIX · 원자재/국채 (요청경로 증분)
│   ├── indices.py      시장지수 레벨 + S&P500 Shiller CAPE (multpl 크롤)
│   ├── earnings.py     M7 / KR Top2 (주 1회)
│   ├── econ.py · macro.py · exports.py  FRED 경제지표·매크로 신호·KR 수출
├── recommendation/     추천 엔진 패키지 (ADR-0015)
│   ├── __init__.py     build_universe·score_stock·run_recommendation_batch·read_recommendations·derive_holding_action
│   ├── universe.py · scoring.py · funnel.py · store.py · actions.py
├── kiwoom/             키움 REST (KR 읽기전용 1차 시세, ADR-0009)
│   ├── client.py       토큰·request·integrated_code(regular 플래그)
│   ├── quote.py (ka10001) · chart.py (ka10081/82/83) · sector.py (ka20002/06)
│   ├── investor.py · shortsell.py (ka10014)
├── kis/                한국투자증권 REST (KR+US 읽기전용 백업, ADR-0011)
│   ├── client.py       토큰(60s 재발급 가드)·request
│   └── quote.py        국내 FHKST01010100 + 해외 HHDFS
└── __init__.py
```

### backend/data/

정적 참조(git 추적)와 로컬 캐시(gitignored) 혼재:

```
data/
├── sp500_tickers.json      (추적) US 티커 마스터
├── kospi_tickers.json      (추적) KR 티커 마스터
├── calendar/               gitignored — YYYY-MM.json 캘린더 파일 캐시
├── consensus/              gitignored — per-ticker 컨센서스 JSON
├── digest/                 로컬 다이제스트 캐시
├── holdings.json · watchlist.json · stocks.json · schedule.json
├── guru_managers.json · guru_schedule.json · kr_exports.json   (gitignored 레거시 JSON)
```

### backend/tests/

`pytest` (conftest.py + fixtures/). 파일당 대상 모듈/라우터 대응. 대표:
`test_api_doc_sync.py`(라이브 라우트 ↔ 두 문서 헤더 대조), `test_batches_router.py`·`test_batch_market_split.py`·`test_scheduler_seed.py`(배치 count/set 단언), `test_kr_quote_*`(다수결·escalation·degenerate), `test_financials_kr/us_*`, `test_recommendations_*`, `test_security_auth_gaps.py`.

## frontend/

```
frontend/
├── vite.config.js      rolldown 번들러 · VitePWA · dev proxy /api→localhost:8000 · manualChunks(함수형만)
├── package.json
├── index.html · uat.html
├── public/             favicon.svg 등
├── dist/               빌드 출력 (nginx가 직접 서빙)
└── src/                (아래)
```

### frontend/src/

```
src/
├── main.jsx            React 진입
├── App.jsx             인증 부트스트랩 · Provider 래핑 · 라우트 · TopNav (권한 필터 nav)
├── api.js              axios 인스턴스 (Bearer 주입 · 401 리다이렉트)
├── utils.js · utils/   analytics.js · marketHours.js · priceFlash.js · pwa.js
├── App.css · index.css
├── contexts/
│   └── AuthContext.jsx  role·menu_permissions 로드 (GET /api/auth/me), useAuth()
├── hooks/
│   ├── usePortfolioData.js  /api/portfolio + /prices 폴링 + /stocks/dashboard
│   ├── useStockManagement.js · useReportList.js · useReportFilters.js
│   ├── useReportGeneration.js · useAuth.js · usePriceFlash.js
│   ├── useTheme.js · useIsMobile.js
│   └── *.test.js        (vitest — usePortfolioData·useReportFilters·useStockManagement)
├── pages/              라우트 레벨 + 허브 탭
│   ├── Research.jsx     홈 허브 (/) — Reports·Recommendations·Ranking·Digest·Calendar 탭
│   ├── MarketHub.jsx    시장 허브 — Market(시장지표)·수급지표 탭
│   ├── Portfolio.jsx    대시보드·분석 (섹터/매크로/상관/리밸런싱)
│   ├── Reports.jsx · Ranking.jsx · Recommendations.jsx · Calendar.jsx · Digest.jsx
│   ├── Market.jsx · Analytics.jsx · SectorTab.jsx · MacroTab.jsx · RebalanceTab.jsx
│   ├── Settings.jsx · LoginPage.jsx · Showcase.jsx
│   ├── Guru.jsx · GuruCrawlNow.jsx · GuruManagers.jsx · GuruStats.jsx
│   ├── ConsensusSettings.jsx · LeverageBackfillSettings.jsx · ReportManualGen.jsx
│   └── AdminAnalytics.jsx  (/admin-analytics, admin 전용)
├── components/
│   ├── portfolio/      DashboardCard(.jsx/.css) · FlashValue · PriceFreshness · PriceFlash.css
│   ├── reports/        ReportDetailTabs · DetailTab · HistoryTab · ReportDetailHeader
│   │                   ConsensusChart · FinancialsChart · BacklogChart · Sections
│   │                   StockActions(카드/리스트 공용) · StockCard · TickerListItem
│   │                   SupplySection · ShortSellSection · InsiderTradesSection
│   │                   InvestorTrendSection · LatestDisclosuresSection · GuruHoldersSection
│   │                   UsSupplySection · UsInsiderSection · ReportFilters · reportUtils.jsx
│   ├── market/         FxSection · VixSection · CommoditiesSection · TreasurySection
│   │                   EconIndicatorsSection · M7EarningsSection · KrTop2Section
│   │                   KrExportsSection · IndexSection · MacroSignalsSection
│   │                   LeverageSection · LendingSection · marketUtils.jsx
│   ├── recommendations/ RecCard.jsx
│   ├── ui/             프리미티브 — Badge · Button · Card · Stat · Input · Skeleton
│   │                   SupplyBadge · InsiderBadge · icons.jsx · index.js (+ .css 짝)
│   ├── StockModal.jsx · PromoteModal.jsx · StockSearchBox.jsx · GlobalSearch.jsx
│   ├── PermissionManager.jsx · PermissionPanel.jsx · BatchScheduleEditor.jsx
│   ├── MobileNav.jsx · InstallPrompt.jsx · LoadingSpinner.jsx · Toast.jsx
├── styles/
│   ├── tokens.css      디자인 토큰 — KR 색 관례(--up=빨강 상승, --down=파랑 하락)
│   ├── pc.css · mobile.css
├── test/               setup.js · smoke.test.js · recommendations-s3s4.test.jsx
└── assets/
```

## 명명 규칙

- **백엔드 배치 id**: `<도메인>_<동작>` (`daily_report_kr`·`backlog_fetch`·`recommendation_us`). 시장 분리 배치는 `_kr`/`_us` 접미사. id = 스케줄러 잡 id = `job_runs.record` id로 일치.
- **서비스 private 심볼**: 내부 헬퍼는 `_` prefix. 재-export 패키지는 `__init__.py`에서 private 포함 명시 re-export(`import *`는 underscore를 건너뛰므로).
- **DART 외부 fetch 함수**: `fetch_all_<도메인>` (배치 본문), `_fetch_and_save_<도메인>` (market_indicators 배치).
- **프론트 컴포넌트**: PascalCase `.jsx`, CSS는 동명 `.css` 짝. 훅은 `use<Name>.js`, 테스트는 `<name>.test.js(x)`.
- **KR 색**: 의미 배지에 `success`/`danger` variant 금지(`.badge--success`=빨강·`.badge--danger`=파랑). 의미 상태 배지는 `ui/SupplyBadge.jsx`처럼 전용 색 명시.
- **환경변수 키**(값은 `backend/.env.docker`, gitignored): `POSTGRES_PASSWORD`, `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, `COWORK_API_KEY`, `FRED_API_KEY`, `KOFIA_API_KEY`, `KITA_API_KEY`(관세청), `DART_API_KEY`, `KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`, `KIS_APP_KEY`/`KIS_APP_SECRET`/`KIS_BASE_URL`, OAuth 키, `FRONTEND_URL`, `VITE_API_BASE_URL`(프론트).

## gitignored 런타임 디렉터리

- `backend/snapshots/` — per-ticker/date 리포트 JSON.
- `backend/reports/` — 레거시 리포트(read-only 폴백).
- `backend/data/calendar/` — 월별 캘린더 이벤트 파일 캐시(종목 변경 시 자동 무효화).
- `backend/data/consensus/` — per-ticker 컨센서스 JSON.
- `backend/data/*.json`(holdings·watchlist·stocks·schedule·guru_*·kr_exports) — 레거시 로컬 JSON.
- `backend/.env` · `backend/.env.docker` · 루트 `.env`.

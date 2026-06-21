---
last_mapped_commit: f835958b49b4a4d7ce30254fd610ed6362462311
mapped: 2026-06-22
---

# STRUCTURE

프로젝트 루트: `/Users/calmonion/Project/PortfoliOn`. 모노레포로 `backend/`(Python/FastAPI)와 `frontend/`(React/Vite)가 나란히 있고, 루트에 배포·문서·스크립트 파일이 있다.

## 루트 레벨

- `backend/` — FastAPI 앱
- `frontend/` — React + Vite SPA
- `docker-compose.yml` — 4-컨테이너(nginx/backend/postgres/certbot) 정의
- `nginx/` — nginx 설정(HTTP 서빙 + `/api/*` 프록시)
- `certbot/` — HTTPS 인증서 갱신 컨테이너
- `scripts/` — 배포/운영 스크립트(예: `auto-deploy-poll.sh`)
- `start.bat` / `start.sh` / `stop.bat` / `stop.sh` — 로컬 양쪽 서버 기동/종료
- `deploy.sh` — 배포 스크립트
- `.env` — 루트(docker-compose 보간용)
- `API_SPEC.md` — 전체 REST API 레퍼런스(엔드포인트 source of truth)
- `CLAUDE_COWORK_API.md` — 외부 Cowork 클라이언트용 API 명세
- `KIWOOM_API.md` / `KIS_API.md` — 키움/KIS API 카탈로그·로드맵
- `README.md` · `CLAUDE.md` — 프로젝트 개요 / 작업 가이드
- `.forge/` — forge 워크플로우 상태(backlog/adr/retro/codebase 등)
- `.planning/` · `.superpowers/` · `.github/` — 도구/CI 설정

## backend/

```
backend/
├── main.py                 # FastAPI 앱 entry — 미들웨어·라우터 마운트·lifespan(_migrate/scheduler/캐시워밍)
├── auth.py                 # JWT/API-key 인증 Depends (get_current_user / require_admin / *_or_api_key)
├── auth_schema.sql         # 인증 스키마 (users, refresh_tokens) — app_schema.sql보다 먼저 실행
├── app_schema.sql          # 앱 스키마 (tickers, user_stocks, snapshots, …, job_runs 등 27 테이블)
├── supabase_schema.sql     # 레거시 Supabase 스키마(미사용)
├── requirements.txt        # Python 의존성 (anthropic 없음 — 백엔드 LLM 호출 없음)
├── Dockerfile              # python:3.12-slim, uvicorn main:app
├── pytest.ini              # pytest 설정
├── Procfile                # 프로세스 정의
├── run_backfill.py         # 스냅샷 백필 진입 스크립트
├── routers/                # HTTP 라우터 (APIRouter, prefix="/api")
├── services/               # 비즈니스 로직
├── scheduler/              # APScheduler 패키지
├── middleware/             # event_tracker.py (EventTrackerMiddleware)
├── migrations/             # 001_user_events.sql, 002_backlog_history.sql
├── scripts/                # 백엔드 전용 스크립트
├── tests/                  # pytest 테스트 (~75 파일)
├── data/                   # 정적 참조 + 로컬 런타임 캐시
├── snapshots/              # 생성된 스냅샷 JSON (gitignored, per-ticker/date)
└── reports/                # 레거시 리포트 디렉터리 (read-only JSON 폴백)
```

### backend/routers/ (18 라우터)

`__init__.py` · `admin.py` · `analysis.py` · `analytics.py` · `auth.py` · `batches.py` · `calendar.py` · `digest.py` · `events.py` · `guru.py` · `investor.py` · `market_indicators.py` · `portfolio.py` · `rankings.py` · `recommendations.py` · `report.py` · `short_sell.py` · `stocks.py` · `watchlist.py`

명명 규칙: 파일명 = 도메인. 각 파일이 `router = APIRouter(prefix="/api", tags=[...])`를 export하고 `main.py`가 마운트. 라우팅 순서 주의 — `stocks.py`는 `PUT /api/stocks/enrich/batch`를 `PUT /api/stocks/{ticker}/enrich`보다 **먼저** 등록.

### backend/services/

평면 모듈 + 4개 하위 패키지.

평면 모듈:
`analysis_service.py`(섹터 모멘텀·매크로 상관) · `auth_service.py` · `backlog.py`·`backlog_parser.py`(DART 수주잔고) · `batch_registry.py`(배치 정적 메타 `BATCHES`) · `cache.py`(인메모리 캐시) · `charts.py` · `consensus.py`·`consensus_pipeline.py` · `db.py`(psycopg2 풀, query/execute) · `digest_service.py` · `disclosures.py`(DART 공시) · `dividends.py`(배당) · `errors.py` · `guru_scraper.py`·`guru_stats.py` · `indicators.py`(RSI/매물대) · `insider_trades.py`(DART 임원 매매) · `investor_service.py`(수급) · `job_runs.py`(배치 실행 기록) · `kr_sector_service.py`(KR 업종 모멘텀 사전계산) · `lending_service.py`(대차잔고) · `leverage_service.py`(신용잔고) · `parallel.py`(`parallel_map`) · `progress.py`(`ProgressTracker`) · `ranking_service.py` · `report_generator.py`(스냅샷 생성) · `schedule_spec.py`(cron 트리거 변환) · `scraper.py`(Finviz·뉴스) · `short_sell_service.py` · `supply_score.py`(수급 점수) · `utils.py`(NaN/inf `sanitize`).

하위 패키지(ADR-0017 re-export 패턴):

```
services/storage/          # 포트폴리오/스케줄 영속화 파사드
├── __init__.py            # 서브모듈 심볼 전부 루트로 re-export
├── portfolio.py           # tickers/user_stocks CRUD, enrich, save_holdings/save_stocks
├── names.py               # 종목명 dual-source 동기화 (refresh/reconcile_snapshot_names)
├── schedule.py            # get/save_batch_schedule, guru 스케줄
└── dates.py               # expected_report_date(s) — 시장별 기대 리포트 날짜

services/market/           # 시장 데이터 소스 체인 진입점
├── __init__.py            # get_quote / get_quotes_batch / get_history_df / get_financials / get_analyst_data / resolve_name
├── kr.py                  # get_quote_kr + KR 소스 선택(_kr_pick_basic/_kr_pick_regular/_price_sane/_corroborated_pick), Naver/FnGuide 어댑터
├── us.py                  # US 연간재무, _us_quote_kis(KIS 백업), _us_none_quote
└── format.py              # 정규화 헬퍼 (_yf_sym, _norm_sector, _to_won, _fmt_price 등)

services/kiwoom/           # 키움 REST (KR 읽기전용, ADR-0009)
├── __init__.py
├── client.py              # 토큰 싱글톤, request(api_id, body, category), integrated_code(regular)
├── quote.py               # ka10001 현재가 (get_quote(stk_cd, regular))
├── chart.py               # ka10081/82/83 일·주·월봉 (history_df, daily_closes)
├── sector.py              # ka20006/ka20002 업종 모멘텀
├── investor.py            # 수급(투자자별)
└── shortsell.py           # 공매도

services/kis/              # 한국투자증권 REST (KR+US 읽기전용 백업, ADR-0011)
├── __init__.py
├── client.py              # 토큰 싱글톤(EGW00133 가드), request(tr_id, path, params)
└── quote.py               # get_quote_kr(FHKST01010100) / get_quote_us(EXCD probe)

services/market_indicators/  # 거시·시장지표 (PostgreSQL market_cache 증분 저장)
├── __init__.py            # get_fx/get_vix/get_commodities/... + _fetch_and_save_* re-export
├── cache.py               # _mc_load / _mc_save (market_cache 읽기/쓰기)
├── fx.py                  # FX / VIX
├── commodities.py         # 원자재 / 국채
├── earnings.py            # M7 / KR Top2 실적
├── econ.py                # FRED 경제지표
├── exports.py             # KR 수출
└── macro.py               # FRED 매크로 신호 (금리차/HY/M2/기준금리 + 신호 판정)

services/recommendation/   # 추천 스코어링 파이프라인
├── __init__.py
├── universe.py            # 후보 종목 유니버스
├── scoring.py             # 점수 계산
├── funnel.py              # 필터링 퍼널 (저유동성 등)
├── actions.py             # 추천 액션
└── store.py               # stock_recommendations 적재/조회
```

### backend/scheduler/ (APScheduler 패키지)

```
scheduler/
├── __init__.py            # start() / stop() / reload(job_id) — 기동 시퀀스
├── _state.py              # _scheduler(BackgroundScheduler), _VALID_DAYS, _DAY_MAP 등 공유 상수
├── jobs.py                # 모든 배치 함수 + _JOB_FUNCS 매핑 (_generate_kr/_generate_us/_fetch_* 등)
└── schedule.py            # _build_trigger / _reschedule_job / _seed_batch_schedules / _check_missed_report
```

명명 규칙: 잡 함수는 private `_` prefix(`_generate_kr`, `_fetch_leverage`, `_run_digest` …), job_id 문자열(`daily_report_kr`)은 `batch_registry.BATCHES`·`job_runs.record`·`_JOB_FUNCS` 키와 반드시 일치.

### backend/tests/

`conftest.py` + `fixtures/` + `test_*.py` 약 75개. 명명 규칙 `test_<대상>.py`(라우터는 `test_<name>_router.py`, 서비스는 `test_<service>.py`). 로컬 `.venv`엔 `lxml` 없음 — 테스트 HTML 파싱은 `html.parser` 사용.

### backend/data/

정적 참조 데이터: `sp500_tickers.json`, `kospi_tickers.json`. 로컬 런타임 캐시(gitignored): `consensus/`(per-ticker), `calendar/`(YYYY-MM.json), `digest/`. 레거시 JSON 스토어(holdings/watchlist/stocks/schedule/guru_*.json)도 존재하나 PostgreSQL이 기본 저장소.

### 스키마 파일

- `backend/auth_schema.sql` — `users`, `refresh_tokens`. **반드시 app_schema.sql보다 먼저 실행.**
- `backend/app_schema.sql` — 앱 테이블 27종: `tickers`, `snapshots`, `user_stocks`, `schedules`, `guru_managers`, `guru_schedules`, `batch_schedules`, `digests`, `consensus_history`, `calendar_cache`, `market_cache`, `user_menu_permissions`, `default_menu_permissions`, `raw_reports`, `daily_consensus_mart`, `user_events`, `market_leverage_indicators`, `market_lending_balance`, `backlog_history`, `market_rankings`, `market_investor_trend`, `market_short_sell`, `stock_disclosures`, `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`, `job_runs`.
- 일부 테이블은 `main.py:_migrate()`에서 기동 시 idempotent하게 생성(`CREATE TABLE IF NOT EXISTS`)된다(`market_short_sell`, `stock_disclosures`, `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`).

## frontend/src/

```
frontend/src/
├── main.jsx                # React entry
├── App.jsx                 # 라우팅(BrowserRouter), TopNav, OAuth 부트스트랩, 프로바이더 트리
├── api.js                  # axios 인스턴스 + 토큰 인터셉터
├── App.css / index.css     # 전역 스타일
├── utils.js                # 공용 유틸
├── pages/                  # 화면 (23 .jsx)
├── components/             # UI 컴포넌트 (도메인별 하위 디렉터리)
├── hooks/                  # 데이터/UI 훅
├── contexts/               # AuthContext.jsx
├── utils/                  # analytics.js, marketHours.js, priceFlash.js, pwa.js
├── styles/                 # tokens.css, pc.css, mobile.css
├── assets/                 # 정적 자산
└── test/                   # 프론트 테스트 하니스
```

### frontend/src/pages/ (23)

허브: `Research.jsx`(홈 `/`, Reports/Recommendations/Ranking/Digest/Calendar 탭) · `MarketHub.jsx`(`/market`, Market 래핑).
탭/개별 페이지: `Reports.jsx` · `Ranking.jsx` · `Calendar.jsx` · `Digest.jsx` · `Recommendations.jsx` · `Market.jsx` · `Analytics.jsx` · `SectorTab.jsx` · `MacroTab.jsx`.
독립 라우트: `Portfolio.jsx`(`/portfolio`) · `Guru.jsx`(`/guru`) · `Settings.jsx`(`/settings`) · `AdminAnalytics.jsx`(`/admin-analytics`) · `LoginPage.jsx` · `Showcase.jsx`(`/dev/showcase`).
Guru/설정 보조: `GuruCrawlNow.jsx` · `GuruManagers.jsx` · `GuruStats.jsx` · `ConsensusSettings.jsx` · `LeverageBackfillSettings.jsx` · `ReportManualGen.jsx`.

### frontend/src/components/

공용 루트: `StockModal.jsx` · `PromoteModal.jsx` · `MobileNav.jsx` · `Toast.jsx` · `InstallPrompt.jsx` · `LoadingSpinner.jsx` · `PermissionManager.jsx` · `PermissionPanel.jsx` · `BatchScheduleEditor.jsx`.

하위 디렉터리(도메인별):

```
components/portfolio/   DashboardCard.jsx · FlashValue.jsx · PriceFreshness.jsx (+ .css)
components/reports/     StockCard.jsx · TickerListItem.jsx · ReportDetailTabs.jsx · ReportDetailHeader.jsx
                        DetailTab.jsx · HistoryTab.jsx · Sections.jsx · ReportFilters.jsx · reportUtils.jsx
                        ConsensusChart.jsx · FinancialsChart.jsx · BacklogChart.jsx
                        InvestorTrendSection.jsx · ShortSellSection.jsx · SupplySection.jsx
                        InsiderTradesSection.jsx · LatestDisclosuresSection.jsx
components/market/      FxSection.jsx · VixSection.jsx · CommoditiesSection.jsx · TreasurySection.jsx
                        EconIndicatorsSection.jsx · M7EarningsSection.jsx · KrTop2Section.jsx
                        KrExportsSection.jsx · LeverageSection.jsx · LendingSection.jsx
                        MacroSignalsSection.jsx · marketUtils.jsx
components/recommendations/   (추천 탭 전용 컴포넌트)
components/ui/          Badge · Button · Card · Stat · Input · Skeleton (각 .jsx + .css)
                        SupplyBadge.jsx · InsiderBadge.jsx · icons.jsx · index.js
```

명명 규칙: 컴포넌트는 PascalCase `.jsx`, 도메인 컴포넌트는 `*Section.jsx`, 차트는 `*Chart.jsx`. 스타일은 CSS-co-located(`Badge.jsx`+`Badge.css`) 또는 전역(`styles/`). TailwindCSS 미사용(plain CSS + `styles/tokens.css` 토큰).

### frontend/src/hooks/

`usePortfolioData.js`(포트폴리오+라이브 시세 폴링) · `useReportList.js` · `useReportFilters.js`(+`.test.js`) · `useStockManagement.js`(+`.test.js`) · `useReportGeneration.js` · `usePriceFlash.js` · `useAuth.js` · `useTheme.js` · `useIsMobile.js`.

### frontend/src/contexts/

`AuthContext.jsx` — `AuthProvider`(로그인 시 `GET /api/auth/me`로 role·menu_permissions 로드)와 `useAuth()` 훅.

### frontend/src/styles/

`tokens.css`(디자인 토큰 — KR 색 관례: `--up`=빨강 상승, `--down`=파랑 하락) · `pc.css` · `mobile.css`.

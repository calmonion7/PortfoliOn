---
last_mapped_commit: 27346baec719306d5c2be8f259cc448ca4f64f4a
mapped: 2026-06-13
---

# STRUCTURE

디렉터리 레이아웃, 주요 파일 위치, 명명 규칙. 모든 경로는 프로젝트 루트 `/Users/calmonion/Project/PortfoliOn` 기준.

## 최상위 레이아웃

- `backend/` — Python/FastAPI 앱 (port 8000)
- `frontend/` — React 18 + Vite SPA (port 5173 dev)
- `nginx/nginx.conf` — nginx 서빙·프록시 설정 (HTTP 80, `/api/*`·`/health` → `backend:8000`)
- `docker-compose.yml` — nginx/backend/postgres 컨테이너 정의
- `supabase/` — (레거시) Supabase 관련 파일
- `scripts/` — 운영 스크립트 (`auto-deploy-poll.sh`, `screenshot.js`, `check-permissions.js` 등)
- `API_SPEC.md` — 전체 REST API 레퍼런스 (엔드포인트 정본)
- `CLAUDE_COWORK_API.md` — 외부 Cowork API 명세
- `CLAUDE.md` — 프로젝트 가이드라인·컨텍스트

## backend/ 주석 트리

```
backend/
  main.py                  # FastAPI 진입점: 라우터 마운트 + lifespan(_migrate/start/stop) + 미들웨어 + /health
  auth.py                  # 인증 Depends: get_current_user / require_admin / get_current_user_or_api_key (JWT HS256 + X-API-Key)
  scheduler.py             # APScheduler: _JOB_FUNCS(12 배치), start()/stop()/reload(), _check_missed_report
  run_backfill.py          # 백필 실행 스크립트(엔트리)
  auth_schema.sql          # 인증 스키마(users, refresh_tokens) — app_schema보다 먼저 실행
  app_schema.sql           # 앱 스키마(tickers/snapshots/user_stocks/.../daily_consensus_mart/job_runs 등 전 테이블)
  supabase_schema.sql      # 레거시 Supabase 스키마(참고용)
  migrations/
    001_user_events.sql    # user_events 테이블 마이그레이션
    002_backlog_history.sql # backlog_history 테이블 마이그레이션
  middleware/
    event_tracker.py       # EventTrackerMiddleware — 응답 후 화이트리스트 라우트를 user_events에 기록
  routers/                 # FastAPI 라우터 계층(각각 APIRouter)
    auth.py                # /api/auth — 가입/로그인/리프레시/로그아웃/me/OAuth
    portfolio.py           # /api/portfolio — 보유 종목 CRUD + /prices
    watchlist.py           # /api/watchlist — 관심 종목 CRUD + /{ticker}/promote
    stocks.py              # /api/stocks — 검색/뉴스/enrich(batch 먼저 등록)/dashboard
    report.py              # /api — 리포트 생성/목록/히스토리/단건 + 컨센서스 + 수주잔고 (최대 라우터)
    guru.py                # /api/guru — 구루 데이터/통계/크롤
    calendar.py            # /api — 캘린더(파일 캐시) + 캐시 삭제
    digest.py              # /api — 일일 다이제스트
    market_indicators.py   # /api/market — FX/VIX/원자재/국채/실적/경제지표/수출/레버리지/대차잔고
    analytics.py           # /api/analytics — 상관관계
    analysis.py            # /api/analysis — 섹터 모멘텀 / 매크로 상관관계
    events.py              # /api/events — 사용자 행동 이벤트 수집
    rankings.py            # /api — 거래 랭킹 조회/refresh
    investor.py            # /api — 수급 스크리닝/추이/refresh
    batches.py             # /api/batches — 배치 현황 허브 + 스케줄 조회/수정
    admin.py               # /api/admin — 사용자/권한 관리 + 행동 분석 집계
  services/                # 비즈니스 로직 계층
    db.py                  # ThreadedConnectionPool + query()/execute()/get_connection()
    storage.py             # 종목/스케줄/구루/배치 영속화 래퍼(PostgreSQL)
    market.py              # 시세·재무·애널리스트 수집(yfinance + Naver/FnGuide), KR/US 분기
    consensus.py           # 목표가·의견 정본 조회 get_asof/apply_asof/get_history (ADR-0008)
    consensus_pipeline.py  # _SCORE_MAP, upsert_raw_reports, refresh_mart, run_daily, backfill, get_mart_history
    report_generator.py    # generate_report(병렬 fetch→summary→snapshot 저장), backfill_ticker
    scraper.py             # Finviz 컨센서스 / KR·US 뉴스 스크래핑
    cache.py               # 인메모리 TTLCache 6종(snapshot/list/dashboard/correlation/sector/macro)
    digest_service.py      # 다이제스트 생성 + 텔레그램 발송
    batch_registry.py      # BATCHES 정적 메타데이터(12 배치) + get_batch
    job_runs.py            # job_runs 테이블 기록 record()/recent()/recent_map()
    schedule_spec.py       # 스케줄 스펙 검증/CronTrigger 변환/문구
    auth_service.py        # 비밀번호·JWT·OAuth·기본권한
    guru_scraper.py        # 구루 운용역 크롤링
    guru_stats.py          # popularity/top3/weighted 통계
    analysis_service.py    # 섹터 모멘텀(SECTOR_ETFs) / 매크로 상관관계(MACRO_TICKERS)
    leverage_service.py    # KOFIA 신용잔고·반대매매 → market_leverage_indicators
    lending_service.py     # 금융위 대차잔고 → market_lending_balance
    backlog.py             # 수주잔고 DART document.xml 파싱·검산·억원 정규화(최대 서비스 753L)
    ranking_service.py     # KR/US 거래 랭킹 → market_rankings
    investor_service.py    # 종목별 수급 추이 → market_investor_trend
    indicators.py          # RSI/볼륨프로파일/지지저항 계산
    charts.py              # 매출·RSI 차트 PNG 생성
    errors.py              # 공통 HTTPException 헬퍼
    utils.py               # NaN/Inf sanitize, ticker 조회 헬퍼
    parallel.py            # parallel_map
    progress.py            # ProgressTracker(배치 진행률)
    market_indicators/     # 시장지표 서브패키지
      __init__.py          # 서브모듈 함수 재노출
      cache.py             # market_cache 테이블 _mc_load/_mc_save/clear_cache
      fx.py                # FX/VIX
      commodities.py       # 원자재/국채
      earnings.py          # M7/KR Top2 실적
      econ.py              # FRED 경제지표
      exports.py           # KR 수출
  data/                    # 정적 참조 데이터 + 로컬 캐시(런타임 캐시는 gitignored)
    sp500_tickers.json     # S&P500 종목 마스터(정적)
    kospi_tickers.json     # KOSPI 종목 마스터(정적)
    (stocks/holdings/watchlist/schedule/guru_*.json) # 레거시 JSON
    calendar/              # 월별 캘린더 캐시 YYYY-MM.json (gitignored)
    consensus/             # per-ticker 컨센서스 캐시 (gitignored)
    digest/                # 다이제스트 캐시
  snapshots/               # 생성된 리포트 스냅샷 {ticker}/{date}.json (gitignored)
  reports/                 # 레거시 리포트 디렉터리(read-only 폴백)
  tests/                   # pytest 스위트(아래)
  .venv/                   # Python venv (macOS: .venv/bin/python)
```

### backend/tests/ — `backend/tests/`

`conftest.py`(픽스처) + 라우터별·서비스별 테스트. 라우터: `test_*_router.py`(admin/analysis/analytics/batches/calendar/digest/events/guru/investor/portfolio/rankings/report/stocks/watchlist). 서비스/단위: `test_storage.py`, `test_market.py`, `test_cache.py`, `test_indicators.py`, `test_consensus_router.py`, `test_consensus_asof.py`, `test_report_generator.py`, `test_digest_service.py`, `test_backlog.py`/`test_backlog_extract.py`, `test_leverage_service.py`, `test_investor_service.py`, `test_ranking_service.py`, `test_market_cache.py`/`test_market_indicators.py`, `test_job_runs.py`/`test_job_runs_instrumentation.py`, `test_schedule_spec.py`, `test_batch_endpoints.py`/`test_batch_resilience.py`, `test_scheduler_*.py`(investor/rankings/seed), `test_auth.py`/`test_auth_me.py`, `test_event_tracker.py`/`test_events_router.py`, `test_guru_stats.py`.
실행: `cd backend && .venv/bin/python -m pytest`.

## frontend/src/ 주석 트리

```
frontend/src/
  main.jsx                 # React 진입점(ReactDOM render)
  App.jsx                  # 라우팅 + OAuth 부트스트랩 + TopNav(menuPermissions 필터)
  api.js                   # axios 인스턴스 + Bearer 인터셉터 + 401 리다이렉트
  utils.js                 # 공통 유틸
  App.css / index.css      # 전역 스타일
  pages/                   # 라우트/허브/탭 단위 페이지
    Portfolio.jsx          # / — 보유/관심/대시보드/분석 탭
    Research.jsx           # /research 허브 — 리포트/랭킹/다이제스트/캘린더 탭
    MarketHub.jsx          # /market 허브 — Market 래핑
    Guru.jsx               # /guru
    Settings.jsx           # /settings
    AdminAnalytics.jsx     # /admin-analytics (admin 전용)
    Showcase.jsx           # /dev/showcase
    LoginPage.jsx          # 비로그인 진입
    Reports.jsx Ranking.jsx Digest.jsx Calendar.jsx  # Research 허브 내 탭
    Market.jsx             # MarketHub 내 본문
    Analytics.jsx          # 상관관계(분석 하위탭)
    SectorTab.jsx MacroTab.jsx  # 섹터/매크로(분석 하위탭)
    GuruCrawlNow.jsx GuruManagers.jsx GuruStats.jsx  # 구루 하위
    ConsensusSettings.jsx ReportManualGen.jsx LeverageBackfillSettings.jsx  # 설정 하위
  components/
    StockModal.jsx PromoteModal.jsx                  # 모달
    PermissionManager.jsx PermissionPanel.jsx         # 권한 UI
    LoadingSpinner.jsx MobileNav.jsx Toast.jsx        # 공통 UI(ToastProvider)
    InstallPrompt.jsx BatchScheduleEditor.jsx         # PWA 설치 배너 / 배치 스케줄 편집
    portfolio/
      DashboardCard.jsx DashboardCard.css            # 대시보드 카드
    reports/                                          # 리포트 상세 컴포넌트
      ReportDetailTabs.jsx                            # 리포트 상세 4탭 컨테이너
      DetailTab.jsx HistoryTab.jsx Sections.jsx       # 탭/섹션
      ConsensusChart.jsx FinancialsChart.jsx BacklogChart.jsx  # 차트
      InvestorTrendSection.jsx                        # 수급 추이 섹션
      reportUtils.jsx                                 # 리포트 포매팅 헬퍼
    market/                                           # 시장지표 섹션 컴포넌트
      FxSection.jsx VixSection.jsx CommoditiesSection.jsx TreasurySection.jsx
      EconIndicatorsSection.jsx M7EarningsSection.jsx KrTop2Section.jsx KrExportsSection.jsx
      LeverageSection.jsx LendingSection.jsx
      marketUtils.jsx                                 # krFmt 등 포매팅 헬퍼(억/조 단위)
    ui/                                               # 디자인 시스템 프리미티브
      Badge.jsx Button.jsx Card.jsx Stat.jsx (+ .css) # 컴포넌트 + 스타일
      icons.jsx index.js                              # 아이콘 / 배럴 export
  contexts/
    AuthContext.jsx        # role·menu_permissions 로드(GET /api/auth/me)
  hooks/
    useAuth.js useTheme.js useIsMobile.js             # 인증/테마/반응형
    usePortfolioData.js useReportGeneration.js useReportList.js  # 데이터 훅
  utils/
    analytics.js           # trackEvent(이벤트 수집)
    pwa.js                 # isStandalone/isIOS/isAndroid/install suppress
  styles/
    tokens.css mobile.css pc.css  # 디자인 토큰 / 디바이스별 스타일
```

## 명명 규칙

- **백엔드 라우터**: `backend/routers/<도메인>.py`, 각각 `router = APIRouter(prefix="/api/...")`. 대부분 prefix가 도메인명(`/api/portfolio` 등)이나 `report`/`calendar`/`digest`/`rankings`/`investor`/`batches`는 공통 `/api` prefix를 쓰고 경로에서 분기.
- **백엔드 서비스**: `backend/services/<도메인>_service.py`(외부 통합·도메인 로직) 또는 `<명사>.py`(핵심 추상화: `storage`/`market`/`cache`/`consensus`/`db`). 비공개 헬퍼는 `_` 접두사.
- **배치 식별자**: `batch_registry.BATCHES`의 `id` = `scheduler._JOB_FUNCS` 키 = `job_runs.record` 호출 id가 모두 일치(단일 진실원).
- **SQL 스키마**: 실행 순서 `auth_schema.sql` → `app_schema.sql`. 점진 변경은 `backend/migrations/NNN_*.sql` + `main._migrate()`의 idempotent DDL.
- **테스트**: `backend/tests/test_<대상>.py`(라우터는 `test_<도메인>_router.py`).
- **프론트 페이지**: `frontend/src/pages/<PascalCase>.jsx`. 허브 페이지(`Research`/`MarketHub`/`Portfolio`)는 내부 탭으로 하위 페이지를 조합.
- **프론트 컴포넌트**: `frontend/src/components/` 루트(범용) + 그룹 하위 디렉터리(`reports/`, `market/`, `ui/`, `portfolio/`). 그룹별 포매팅 헬퍼는 `<group>Utils.jsx`.

## 주요 파일 빠른 참조

- 라우터: `backend/routers/`
- 서비스: `backend/services/`
- 시장지표 서브패키지: `backend/services/market_indicators/`
- 프론트 페이지: `frontend/src/pages/` / 컴포넌트: `frontend/src/components/`(+ `market/`, `reports/`, `ui/`)
- SQL 스키마: `backend/auth_schema.sql`, `backend/app_schema.sql`, `backend/migrations/`
- 정적 참조 데이터: `backend/data/sp500_tickers.json`, `backend/data/kospi_tickers.json`
- 테스트: `backend/tests/`
- 배포: `nginx/nginx.conf`, `docker-compose.yml`, `frontend/vite.config.js`(dev 프록시)

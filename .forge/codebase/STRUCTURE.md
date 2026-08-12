---
last_mapped_commit: 20dd46eb829b05025af793b010dfe4efe2925a7d
mapped: 2026-08-10
---

# STRUCTURE — PortfoliOn

디렉터리 레이아웃 · 핵심 위치 · 명명 규약. 흐름과 패턴은 `ARCHITECTURE.md`.

---

## 1. 최상위

```
PortfoliOn/
├── backend/              FastAPI 앱 (Python 3.12 컨테이너 / 로컬 .venv는 3.9.6)
├── frontend/             React 19 + Vite SPA
├── nginx/nginx.conf      리버스 프록시 + 정적 서빙 설정
├── certbot/{conf,www}/   HTTPS 인증서 (conf/는 gitignored)
├── scripts/              라이브 UAT 프로브 · 배포 폴러 · 운영 스크립트 (141개)
├── docs/                 사람이 읽는 문서 (아래 §6)
├── .forge/               forge 워크플로 상태 · 코드베이스 지도 · ADR · 회고
├── .claude/              Claude Code 설정 · 도메인 에이전트 카드
├── docker-compose.yml    4컨테이너(postgres·backend·nginx·certbot)
├── deploy.sh             배포 스크립트 (러너·폴러 공용)
├── .github/workflows/deploy.yml   self-hosted 러너 워크플로
├── start.sh / start.bat / stop.sh / stop.bat   로컬 개발 서버 기동·정지
├── API_SPEC.md           전체 REST 레퍼런스 (엔드포인트 정본)
├── CLAUDE_COWORK_API.md  외부 Cowork 전용 API 명세
├── KIWOOM_API.md / KIS_API.md    증권사 API 카탈로그·대체 로드맵
├── README.md             프로젝트 개요(화면·env·스택·아키텍처·배치)
├── CLAUDE.md             행동 가이드라인 + 프로젝트 컨텍스트 + 가토 모음
├── .env                  docker-compose 보간용(루트, gitignored)
├── screenshots*/         UAT 캡처 산출물 (gitignored)
└── supabase/, .planning/, .superpowers/, .worktrees/   레거시·도구 잔재(gitignored)
```

---

## 2. `backend/`

```
backend/
├── main.py                 앱 진입 — lifespan · _migrate · 미들웨어 · include_router × 20
├── auth.py                 FastAPI 인증 의존성 4종 (get_current_user / _or_api_key /
│                           require_admin / require_admin_or_api_key)
├── Dockerfile              python:3.12-slim + uvicorn
├── requirements.txt        18개 (anthropic 없음 — 백엔드에 LLM 호출 0)
├── pytest.ini              testpaths=tests, pythonpath=.
├── auth_schema.sql         users · refresh_tokens        ← app_schema.sql보다 먼저 실행
├── app_schema.sql          앱 테이블 전부 (신규 설치용)
├── supabase_schema.sql     레거시(Supabase 시절)
├── .env.docker             런타임 시크릿 (gitignored)
├── .env.docker.example     키 목록 템플릿
├── run_backfill.py         일회성 백필 스크립트
├── Procfile                레거시(PaaS 시절)
│
├── routers/                HTTP 표면 (20 모듈, `__init__.py`는 빈 파일)
│   ├── auth.py             로컬 로그인 · 리프레시 · OAuth(구글/깃허브) · /me · /oauth/token
│   ├── portfolio.py        보유 CRUD · /prices · /rebalance · /exposure · /dividends · /{t}/pin
│   ├── watchlist.py        관심 CRUD · /{ticker}/promote
│   ├── stocks.py           검색 · 비교 · /dashboard · enrich · 이름/배당/베타/수급 백필  (최대 파일)
│   ├── report.py           스냅샷 목록·상세·히스토리 · 생성/백필 · 컨센서스 · 수주잔고 ·
│   │                       공시 · 내부자 · US수급 · AGM
│   ├── analyst_reports.py  심층 리포트 발행/조회 (ADR-0027)
│   ├── tech_reports.py     주요기술 리포트 (ADR-0033/0034/0038)
│   ├── recommendations.py  추천 read + refresh
│   ├── rankings.py         /rankings · /rankings/refresh
│   ├── investor.py         수급 추이 · 스크리닝
│   ├── short_sell.py       공매도 추이
│   ├── market_indicators.py 시장지표 15종 + 레버리지 · 대차 (prefix는 /api/market 하나뿐)
│   ├── analysis.py         섹터 모멘텀(US/KR) · 매크로 상관
│   ├── analytics.py        보유 종목 간 상관관계
│   ├── calendar.py         월별 이벤트 + _FOMC_DATES 하드코딩 목록 + fomc_coverage_status
│   ├── digest.py           일일 다이제스트
│   ├── guru.py             매니저 · 통계 3종 · 크롤
│   ├── batches.py          배치 현황 · 스케줄 편집 · FOMC 커버리지
│   ├── events.py           사용자 행동 이벤트 수집 (VALID_EVENTS 화이트리스트)
│   └── admin.py            사용자 · 권한(ALL_MENUS) · analytics · 심층리포트 대상 · Cowork fire
│
├── middleware/
│   └── event_tracker.py    EventTrackerMiddleware — 화이트리스트 (method,path)를 user_events에
│
├── scheduler/              APScheduler 배선 **패키지** (단일 scheduler.py 아님)
│   ├── __init__.py         start()/stop()/reload() + jobs·schedule 심볼 명시 re-export
│   ├── _state.py           _scheduler · _DIGEST_JOB_ID · _VALID_DAYS (leaf, 순환 회피)
│   ├── jobs.py             잡 함수 전부 + _JOB_FUNCS(job_id → 함수) 맵
│   └── schedule.py         _build_trigger · _reschedule_job · _seed_spec_for ·
│                           _seed_batch_schedules · _check_missed_report(_for)
│
└── services/
    ├── db.py               ThreadedConnectionPool(1~20) + query/execute/execute_many/get_connection
    ├── cache.py            인메모리 TTLCache 10종 + invalidate_portfolio_caches
    ├── utils.py            today_kst · sanitize · TICKER_RE · find_ticker*
    ├── errors.py           not_found / already_exists
    ├── parallel.py         parallel_map(max_workers=10)
    ├── progress.py         ProgressTracker (장시간 배치 진행률)
    ├── job_runs.py         record() 컨텍스트매니저 + Run.set_status · recent · recent_map
    ├── batch_registry.py   BATCHES 정적 메타데이터 (배치 정본 목록)
    ├── schedule_spec.py    스펙 검증 · CronTrigger kwargs 변환 · 사람이 읽는 문구
    │
    ├── storage/            ADR-0017 패키지 분할 — __init__.py가 전 심볼 re-export
    │   ├── portfolio.py    get/save_stocks · get/save_holdings · get_full_portfolio ·
    │   │                   get_global_portfolio · enrich_stock · set_target_weights · set_pinned
    │   ├── names.py        refresh_snapshot_names · reconcile_snapshot_names · set_ticker_name
    │   ├── schedule.py     batch_schedules CRUD · guru_managers 저장(통계 반환) · 레거시 스케줄
    │   └── dates.py        expected_report_date(s) — 시장별·시각인지 기대 리포트 날짜
    │
    ├── market/             시세·재무 통합 API
    │   ├── __init__.py     get_quote · get_quotes_batch · get_history_df · get_financials ·
    │   │                   get_annual_financials · get_analyst_data · resolve_name · _HISTORY_CFG
    │   ├── kr.py           키움→KIS→Naver 체인 · 다수결(_kr_pick_basic/_corroborated_pick) ·
    │   │                   DART 연간재무 · R&D 집약도 · FnGuide 시총           (최대 서비스 파일)
    │   ├── us.py           yfinance 연간재무 · KIS 폴백 quote
    │   └── format.py       _n · _to_won · _safe_ratio · _safe_pct · _yf_val · _yf_sym · _fmt_*
    │
    ├── market_indicators/  시장지표 패키지 (요청경로 증분 or 배치 저장)
    │   ├── __init__.py     public + _fetch_and_save_* 명시 __all__
    │   ├── cache.py        _mc_load/_mc_save/_mc_delete · get_or_refresh · _merge_history ·
    │   │                   _yf_close_history · _filter_outliers
    │   ├── fx.py           USD/KRW · VIX (수동 폴백 참조 구현)
    │   ├── commodities.py  원자재 · 국채
    │   ├── indices.py      ^GSPC/^KS11/^KQ11 + S&P500 Shiller CAPE(multpl.com 크롤)
    │   ├── earnings.py     M7 / KR Top2 + 티커 목록 캐시(sp500_tickers·kospi_tickers)
    │   ├── econ.py         FRED 경제지표
    │   ├── macro.py        FRED 매크로 신호 4종 + evaluate_signals
    │   ├── exports.py      KR 수출(관세청 → UN Comtrade 폴백)
    │   ├── sentiment.py    CNN Fear & Greed
    │   ├── kospi_futures.py KIS 국내선물 (output1/2/3 분할 응답)
    │   └── kospi_signal.py  다음날 코스피 신호
    │
    ├── kiwoom/             KR 읽기전용 1차 소스 (ADR-0009)
    │   ├── client.py       토큰 싱글톤 · _throttle · request/request_paged · integrated_code(regular)
    │   ├── quote.py        ka10001 현재가
    │   ├── chart.py        ka10081 일봉 → normalize_bars/history_df/daily_closes
    │   ├── investor.py     수급(flows · foreign_ratio · trend_rows)
    │   ├── sector.py       ka20006/ka20002 업종 종가·종목매핑
    │   └── shortsell.py    ka10014 공매도
    │
    ├── kis/                KR+US 읽기전용 백업 소스 (ADR-0011/0022)
    │   ├── client.py       /oauth2/tokenP · EGW00133 방어(60s 강제 재발급 가드)
    │   ├── quote.py        국내 FHKST01010100 · 해외 HHDFS*(EXCD probe)
    │   └── futures.py      국내선물 최근월물 코드 산출 + 시세/일봉
    │
    ├── recommendation/     추천 엔진 (ADR-0015/0016/0021)
    │   ├── universe.py     KR rows · S&P500 · tracked · guru 티커 병합
    │   ├── funnel.py       2단 깔때기 — 스크리닝 → enrich → run_recommendation_batch
    │   ├── scoring.py      value/momentum/smart_money → score_stock · derive_flags
    │   ├── actions.py      derive_holding_action
    │   └── store.py        replace_recommendations · read_recommendations
    │
    ├── report_generator.py 스냅샷 생성 · 피어 멀티플 가드 · KR 박제-시 독립피드 게이트 · 백필
    ├── consensus_pipeline.py raw_reports 적재 → _MART_SQL → daily_consensus_mart · run_daily · backfill
    ├── consensus.py        as-of 읽기 정본 (get_asof · apply_asof · get_asof_batch)
    ├── indicators.py       RSI · EMA · 52주 · HV · 매물대
    ├── analyst_reports.py  발행물 저장/조회 + per_band · build_data_block · consensus_basis
    ├── tech_reports.py     주요기술 발행물 저장/조회 (slug당 1행)
    ├── cowork_trigger.py   배치 완료 fire (ADR-0028) — daily_text · manual_text · fire
    ├── digest_service.py   일일 다이제스트 생성 · 텔레그램 발송
    ├── dividends.py        US yfinance / KR DART 배당 + 배당 스케줄(replace_schedule)
    ├── beta.py             US/KR 베타 산출·저장
    ├── exposure.py         포트 노출(베타 등)
    ├── rebalance.py        목표비중 대비 리밸런싱
    ├── analysis_service.py 섹터 ETF 모멘텀 · 매크로 상관(TLT/UUP/USO/^VIX)
    ├── us_sector_service.py / kr_sector_service.py   섹터 모멘텀 배치 + market_cache 저장
    ├── ranking_service.py  KR(Naver)·US(yfinance) 랭킹 수집 → market_rankings replace
    ├── investor_service.py 수급 추이 upsert/read/screening
    ├── short_sell_service.py 공매도 추이 upsert/read
    ├── supply_score.py     수급 종합 밴드 산출(ADR-0014)
    ├── us_supply.py        US 공매도·기관보유·내부자
    ├── insider_trades.py   DART 지분공시 신호
    ├── disclosures.py      DART 공시 피드(유형 A·B·C·D 개별 호출)
    ├── agm.py              주총 일시(DART no-type 호출 + document.xml 2전략 파싱)
    ├── backlog.py          수주잔고 수집(document.xml ZIP) + _get_corp_code_map/_get_document_text
    ├── backlog_parser.py   표 파싱 · _expand_grid(rowspan/colspan) · 검산
    ├── leverage_service.py KOFIA 신용잔고·반대매매 + backfill_with_progress
    ├── lending_service.py  금융위 대차잔고
    ├── guru_scraper.py     dataroma 크롤(holdings.php · m_activity.php)
    ├── guru_stats.py       인기 · 가중 · 투자금 집계
    ├── auth_service.py     사용자·토큰 저장 계층
    └── scraper.py          Finviz 컨센서스 · 뉴스(KR/US)

backend/data/          정적 참조 + 런타임 파일 캐시
  ├── sp500_tickers.json / kospi_tickers.json   read-only 시드 (캐시는 market_cache로 이관)
  ├── consensus/                                per-ticker 컨센서스 캐시 (gitignored)
  ├── calendar/                                 레거시 잔재 (빈 디렉터리 — 파일 캐시는 task#167에서 제거,
  │                                             `routers/calendar.py`의 `_get_events` 주석이 명시)
  ├── digest/                                   **살아있는 파일시스템 폴백** — 레거시 아님.
  │                                             `services/digest_service.py`의 `DIGEST_DIR`가 정의하고,
  │                                             DB INSERT 실패 시 `generate`가 `{user_id}-{date}.json`으로 쓰고
  │                                             `get_latest`가 DB read 실패 시 그 glob으로 읽는다.
  │                                             ※ 추적 중인 `2026-05-24.json`은 옛 명명(`{date}.json`)이라
  │                                               현재 glob에 잡히지 않는 죽은 산출물이다.
  └── holdings.json · watchlist.json · stocks.json · schedule.json ·
      guru_managers.json · guru_schedule.json · kr_exports.json     (전부 gitignored 레거시)

backend/snapshots/     per-ticker/date 스냅샷 JSON (gitignored)
backend/reports/       레거시 리포트 디렉터리 (read-only 폴백, gitignored)
backend/.venv/         로컬 가상환경 — Python 3.9.6, lxml 없음
backend/tests/         pytest 141 파일 + conftest.py + _routes.py
```

---

## 3. `frontend/`

```
frontend/
├── index.html            인라인 테마 부트 + OAuth 스플래시 마크업/CSS + 폰트 preconnect
├── vite.config.js        PWA · sw-cache-bust 플러그인 · manualChunks(함수형) · test 블록 · dev proxy
├── package.json          react 19.2 · react-router-dom 7 · recharts 3 · axios / vite 8 · vitest 4
├── eslint.config.js
├── vercel.json           레거시(Vercel 시절)
├── .env                  VITE_API_BASE_URL 등
├── dist/                 빌드 산출물 — **nginx가 직접 서빙(gitignored이지만 배포 실체)**
└── src/
    ├── main.jsx          createRoot + tokens.css · motion.css · index.css import
    ├── App.jsx           라우트 정의 · AppShell · 인증 게이트 · doLogout
    ├── routes.js         REDIRECTS(구 URL → 신규)
    ├── navSections.js    NAV_SECTIONS 5섹션 **단일 소스** + matchesItem/matchesSection/sectionByKey
    ├── api.js            axios 인스턴스 + Bearer 주입 + 401 → replace('/')
    ├── themeBoot.js      THEME_BOOT_JS — index.html 인라인과 바이트 동일
    ├── oauthSplash.js    SPLASH_HTML — index.html 인라인과 바이트 동일
    ├── utils.js          공용 포매터
    ├── index.css         tokens/pc/mobile/guru import + recharts outline 리셋
    ├── App.css
    │
    ├── styles/           tokens.css(디자인 토큰) · pc.css · mobile.css · guru.css · motion.css
    │
    ├── pages/            라우트 페이지 + 허브 하위 탭 (24 jsx)
    │   ├─ 라우트: Portfolio · Reports · Recommendations · Ranking · Compare · Calendar ·
    │   │          Dividends · Digest · AnalystReports · AnalystReport · TechReports ·
    │   │          TechReport · MarketHub · Guru · GuruDetail · Settings · AdminAnalytics ·
    │   │          Showcase · LoginPage(App이 직접) · ResearchShell(래퍼)
    │   ├─ Portfolio 탭:   SectorTab · MacroTab · Analytics · RebalanceTab · ExposureTab
    │   ├─ MarketHub 탭:   Market
    │   ├─ Guru 탭:        GuruManagers · GuruStats · GuruAllocation
    │   └─ Settings 패널:  ReportManualGen · GuruCrawlNow · ConsensusSettings ·
    │                      LeverageBackfillSettings
    │
    ├── components/
    │   ├── (루트 19)     Masthead · MobileNav · MobileTopActions · GlobalSearch · StockModal ·
    │   │                 StockSearchBox · PromoteModal · Toast · LoadingSpinner · Glossary ·
    │   │                 InstallPrompt · PermissionManager · PermissionPanel ·
    │   │                 BatchScheduleEditor · DiagLog
    │   ├── ui/ (17)      Badge(+MarketBadge·ChangeBadge) · Button · Card · Input · Skeleton ·
    │   │                 Stat · icons · GuruActivityBadge · InsiderBadge · SupplyBadge
    │   │                 └ index.js 배럴
    │   ├── reports/ (35) StockCard · TickerListItem · StockActions(액션버튼 단일 소스) ·
    │   │                 ReportDetailHeader · ReportDetailTabs · Sections · DetailTab ·
    │   │                 HistoryTab · ConsensusChart · FinancialsChart · BacklogChart ·
    │   │                 KeyResourceChart · SegmentAnalysisSection · SupplySection ·
    │   │                 ShortSellSection · InvestorTrendSection · InsiderTradesSection ·
    │   │                 UsInsiderSection · UsSupplySection · GuruHoldersSection ·
    │   │                 LatestDisclosuresSection · MarketOutlookSection · ReportFilters ·
    │   │                 reportUtils · segmentUtils · techReportUtils
    │   ├── market/ (17)  Fx · Vix · Commodities · Treasury · EconIndicators · M7Earnings ·
    │   │                 KrTop2 · KrExports · Index · KospiFutures · KospiSignal ·
    │   │                 MacroSignals · FearGreed · Leverage · Lending Section + marketUtils.jsx
    │   ├── tech/ (27)    TechGraph · TechKpiStrip · TechLevelBand · MilestoneTimeline ·
    │   │                 PlayerTable · ShareChart · MarketGrowthChart · MarketEstimates ·
    │   │                 KeyPointCards · ProseSections · VariantTable · WatchItems
    │   │                 (CategoryGroups는 task#301에서 삭제 — 업체 분류 축은 PlayerTable·
    │   │                  ShareChart의 그룹 렌더로 흡수, 헬퍼 groupByCategory는
    │   │                  reports/techReportUtils.js로 이사)
    │   ├── portfolio/(6) DashboardCard · FlashValue · PriceFreshness
    │   ├── sketches/(13) 손그림 SVG 에셋 + 5섹션 아이콘 (index.js 배럴)
    │   └── recommendations/ RecCard
    │
    ├── hooks/            useAuth · useAuthBootstrap · useBfcacheAuthGuard · useSwUpdateReload ·
    │                     useTheme · useIsMobile · useBodyScrollLock · useReveal · useCountUp ·
    │                     usePriceFlash · usePortfolioData · useTrackedStocks · useReportList ·
    │                     useReportFilters · useReportGeneration · useStockManagement
    │
    ├── contexts/         AuthContext (role · menuPermissions · loading)
    ├── glossary/         terms.js · match.js (용어 팝오버)
    ├── utils/            analytics(trackEvent) · diag(logDiag 링버퍼) · oauthHistory ·
    │                     marketHours · priceFlash · pwa · guruName
    ├── assets/           hero.png · react.svg · vite.svg
    └── test/             vitest 전용 스위트 + setup.js
                          (컴포넌트 옆 *.test.jsx와 병존 — 총 63 테스트 파일)
```

---

## 4. `scripts/` (141개)

| 패턴 | 용도 | 예 |
|---|---|---|
| `uat<번호>-<슬러그>.mjs` | 태스크별 라이브 UAT 프로브(Playwright). 번호 = forge task 번호 | `uat289-oauth-callback-latency.mjs` |
| `probe<번호>-<슬러그>.{mjs,py}` | 원인 규명용 일회성 프로브 | `probe246-why-no-bfcache.mjs` |
| `smoke<번호>-<슬러그>.mjs` | 배포 후 스모크 | `smoke232-auth.mjs` |
| `uat-<슬러그>.mjs` | 번호 없는 상시 프로브 | `uat-guru-row-ux.mjs` |
| `audit_*.py` | 정적 감사 | `audit_unauth_endpoints.py` |
| 운영 | 배포·DDNS·리스너 | `auto-deploy-poll.sh` · `ddns_update.sh` · `start-docker-compose.sh` · `cowork-fire-listener.py` |
| 데이터 | 일회성 복구·백테스트 | `repair-005930-snapshots.py` · `kospi_signal_backtest.py` |
| 프롬프트 | 루틴 정의 | `cowork-routine-prompt.md` |

`scripts/package.json`의 유일한 의존성은 `playwright`. 캡처는 프로젝트 루트의
`screenshots-uat<번호>/`에 떨어진다(gitignored).

---

## 5. `.forge/` · `.claude/`

```
.forge/
├── CONTEXT.md          도메인 용어집 (구현 사실 금지 — 여기 문서들과 역할 분리)
├── config.json         forge 설정(eco/tdd 플래그 등)
├── bug-report.md       현재 버그 리포트
├── adr/                0001~0035 아키텍처 결정 기록
├── codebase/           **이 지도** — ARCHITECTURE · STRUCTURE · CONCERNS · CONVENTIONS ·
│                       INTEGRATIONS · STACK · TESTING
├── retro/              태스크별 회고 (266개, `YYYY-MM-DD-<슬러그>.md`)
├── done/               봉인된 태스크 (280개)
├── backlog/ executed/  대기·실행 슬롯 (현재 비어 있음)
├── quick/ dropped/     빠른 레인 · 폐기

.claude/
├── settings.json / settings.local.json
├── agents/             도메인 서브에이전트 카드 7종 — auth-gating · batch-cache-guard ·
│                       doc-sync · frontend-visual · live-forensics · live-uat-prober ·
│                       market-data-integrator
├── projects/…/memory/  세션 간 메모리
├── todo/ · worktrees/
```

---

## 6. `docs/`

`docs/ARCHITECTURE.md` · `API.md` · `TESTING.md` · `DEVELOPMENT.md` · `GETTING-STARTED.md` ·
`CONFIGURATION.md` · `ops/deploy.md` — **사람이 읽는** 문서.
에이전트가 읽는 정본 지도는 `.forge/codebase/`이고 둘은 별개 계보다.
`docs/superpowers/`는 gitignored 도구 잔재.

---

## 7. 명명 규약

**백엔드 파이썬**
- 모듈: `snake_case.py`. 도메인 하나 = 서비스 하나가 기본, 커지면 동명 패키지로 승격하고
  `__init__.py`가 옛 표면을 re-export(ADR-0017).
- private: 모듈 내부 헬퍼는 `_leading_underscore`. 패키지 `__init__.py`가 private까지
  re-export할 때는 **명시 나열**한다(`import *`는 underscore를 건너뛴다).
- 외부소스 어댑터의 값 변환기는 관례적으로 `_num` / `_int` / `_pct` / `_to_date`.
- 저장 계층: `fetch_*`(외부 read) · `upsert_*`/`replace_*`/`save_*`(쓰기) · `read_*`/`get_*`(DB read) ·
  `fetch_all_*`(전 종목 배치 진입점) · `refresh()`(배치 1회분).
- 로그 마커: `[Component]` PascalCase, 개념당 1스펠링(`[Scheduler]` · `[Cache]` · `[Migrate]` · `[Report]`).

**배치 id** — `<도메인>_<동작>` 소문자(`kr_rankings_fetch` · `supply_score_fetch` · `macro_signals_fetch`).
시장 분리 형제는 `_kr`/`_us` 접미(`daily_report_kr` · `earnings_us` · `monthly_kr` · `recommendation_us`).
이 문자열이 **스케줄러 잡 id 겸 `job_runs` 레코드 id**다.

**`market_cache` 키** — 소문자 스네이크, 배치·지표명 그대로
(`fx` · `vix` · `commodities` · `treasury` · `econ_indicators` · `kr_exports` · `m7_earnings` ·
`kr_top2_earnings` · `macro_signals` · `kospi_signal` · `kospi_futures` · `indices` ·
`fear_greed` · `kr_sector_momentum` · `us_sector_momentum` · `sp500_tickers` · `kospi_tickers`).
서비스가 자기 키를 `CACHE_KEY` 상수로 노출하기도 한다(`kr_sector_service` · `us_sector_service`).

**DB 테이블** — 소유 축을 접두로: `user_*`(사용자 스코프) · `stock_*`(티커 스코프) ·
`market_*`(시장 전역) · `guru_*` · 그 외 단수 개념(`tickers` · `snapshots` · `digests` ·
`schedules` · `job_runs` · `analyst_reports` · `tech_reports` · `raw_reports` ·
`daily_consensus_mart` · `backlog_history`).

**엔드포인트** — `/api/<리소스>` kebab-case(`/api/analyst-reports` · `/api/tech-reports` ·
`/api/market/kr-top2-earnings`). 배치 수동 트리거는 `POST …/refresh` 또는 `…/refresh-<대상>`.
장시간 작업은 `status_code=202` + `BackgroundTasks` + 별도 `…/progress` GET.
⚠️ 고정 경로는 path 파라미터보다 **먼저** 등록한다(`PUT /api/stocks/enrich/batch` ≺
`PUT /api/stocks/{ticker}/enrich`).

**프론트엔드**
- 컴포넌트/페이지: `PascalCase.jsx`. 훅: `useXxx.js`. 유틸: `camelCase.js`.
- CSS: 컴포넌트 옆 `PascalCase.css`, 전역은 `styles/*.css`.
- 클래스명은 BEM-ish 소문자(`.oauth-splash__text` · `.masthead-cat` · `.badge--up` ·
  `.seg-pad` · `.page-wrap` · `.is-active`).
- 테스트: 컴포넌트 옆 `X.test.jsx` **또는** 횡단 시나리오는 `src/test/<슬러그>.test.jsx`.
- 이벤트명: `trackEvent('nav_<섹션>' | 'tab_<탭>')` — 백엔드 `events.py`의 `VALID_EVENTS`
  화이트리스트와 문자열이 일치해야 한다(불일치는 요청 성공 + 이벤트 소실).

**테스트 파일**
- pytest: `backend/tests/test_<대상>.py`. 회귀 가드는 대상명 + 성질
  (`test_no_print` · `test_no_bare_today` · `test_no_public_reads` · `test_api_doc_sync` ·
  `test_empty_result_overwrite_guards` · `test_nan_serialization_guards`).
- 마커를 테스트 이름에 심을 때는 네임스페이스 접두를 붙인다(`BH7-` 등) — bare `M1`/`L2`는
  무관한 기존 텍스트와 충돌한다.

---

## 8. "X를 바꾸려면 어디?" 인덱스

| 바꾸려는 것 | 손대는 파일 |
|---|---|
| 앱 부팅·마이그레이션·라우터 마운트 | `backend/main.py` |
| 인증 의존성·API 키 정책 | `backend/auth.py` |
| 메뉴 권한 목록 | `backend/routers/admin.py`의 `ALL_MENUS` |
| 배치 메타데이터(주기·출처·사용처·시장) | `backend/services/batch_registry.py` |
| 배치 잡 함수·시드·누락복구 | `backend/scheduler/jobs.py` · `schedule.py` (+ `__init__.py` re-export) |
| 스케줄 스펙 검증·트리거 변환 | `backend/services/schedule_spec.py` |
| 배치 실행로그 상태 어휘 | `backend/services/job_runs.py` (`Run.set_status`) |
| DB 커넥션 풀 크기 | `backend/services/db.py` (`maxconn`) |
| 인메모리 캐시 TTL·무효화 | `backend/services/cache.py` |
| `market_cache` 읽기/쓰기·증분 병합 | `backend/services/market_indicators/cache.py` |
| KR 시세 소스 우선순위·다수결 | `backend/services/market/kr.py` |
| US 시세 폴백 | `backend/services/market/__init__.py` + `market/us.py` |
| 값 정규화(단위·퍼센트·심볼 접미) | `backend/services/market/format.py` |
| 스냅샷 생성 로직·피어 가드·박제 게이트 | `backend/services/report_generator.py` |
| 목표가·의견수 정본 읽기 | `backend/services/consensus.py` (`apply_asof`) |
| 대시보드 카드 조립·불변식 | `backend/routers/stocks.py` (`get_dashboard` / `_build_card`) |
| FOMC 날짜 목록 | `backend/routers/calendar.py` (`_FOMC_DATES`) |
| 이벤트 화이트리스트 | `backend/routers/events.py` (`VALID_EVENTS`) |
| 신규 테이블·컬럼 | `backend/app_schema.sql` **+** `backend/main.py:_migrate` (쌍) |
| nav 탭 추가·개명·삭제 | `frontend/src/navSections.js` (세 소비처는 파생) |
| 라우트 추가·리다이렉트 | `frontend/src/App.jsx` `<Routes>` · `frontend/src/routes.js` |
| 인증 게이트·OAuth 착지 분기 | `frontend/src/hooks/useAuthBootstrap.js` · `App.jsx` |
| 첫 페인트 테마·스플래시 | `frontend/index.html` **+** `src/themeBoot.js` / `src/oauthSplash.js` (바이트 동일) |
| 401 처리·토큰 주입 | `frontend/src/api.js` |
| 디자인 토큰·색 관례 | `frontend/src/styles/tokens.css` · `components/ui/Badge.css` |
| 종목 액션 버튼(수정·승격·삭제) | `frontend/src/components/reports/StockActions.jsx` (단일 소스) |
| 차트 단위 포매팅 | `frontend/src/components/market/marketUtils.jsx` (`krFmt`) |
| PWA·SW 캐싱·번들 청크 | `frontend/vite.config.js` |
| nginx 캐시 헤더·프록시 | `nginx/nginx.conf` |
| 배포 절차 | `deploy.sh` · `.github/workflows/deploy.yml` · `scripts/auto-deploy-poll.sh` |
| 엔드포인트 명세 | `API_SPEC.md` (+ Cowork 대상이면 `CLAUDE_COWORK_API.md`) |

---

## 9. 런타임 산출물 (gitignored — 저장소에 없지만 배포에는 있다)

| 경로 | 내용 |
|---|---|
| `frontend/dist/` | **nginx가 서빙하는 실체.** 로컬 빌드가 곧 라이브 |
| `frontend/node_modules/` · `scripts/node_modules/` | 의존성 |
| `backend/.venv/` | 로컬 Python 3.9.6 (컨테이너는 3.12 — 버전차가 API 형태를 가른다) |
| `backend/snapshots/` | per-ticker/date 스냅샷 파일 폴백 |
| `backend/reports/` | 레거시 리포트 |
| `backend/data/consensus/` | per-ticker 컨센서스 파일 캐시 |
| `backend/.env.docker` · `.env` | 시크릿 |
| `certbot/conf/` | 인증서·계정키 |
| `screenshots*/` | UAT 캡처 |
| `.worktrees/` · `.planning/` · `.superpowers/` · `docs/superpowers/` | 도구 잔재 |

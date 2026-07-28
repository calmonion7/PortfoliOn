---
last_mapped_commit: a4994f84832f6215ac127c5ef0a645861ab2f857
mapped: 2026-07-28
---

# STRUCTURE

## 1. 최상위

```
/Users/calmonion/Project/PortfoliOn/
├── backend/                  FastAPI 앱 (main.py, routers/, services/, scheduler/, tests/)
├── frontend/                 React 19 + Vite (src/, dist/ ← nginx가 :ro 마운트)
├── nginx/nginx.conf          HTTP(80) 서빙 + /api/* → backend:8000 프록시
├── certbot/{conf,www}/       HTTPS 인증서 볼륨
├── docker-compose.yml        postgres·backend·nginx·certbot 4서비스
├── deploy.sh                 정식 배포 스크립트(프론트빌드→백엔드 이미지→컨테이너 교체→/health)
├── .github/workflows/deploy.yml   push main → self-hosted 러너 → deploy.sh
├── scripts/                  운영·UAT 스크립트 (아래 §7)
├── docs/                     보조 문서
├── .forge/                   forge 상태(adr/·codebase/·backlog/·done/·retro/·quick/)
├── screenshots*/             UAT 캡처 산출물 (gitignored 성격, task별 디렉터리)
├── API_SPEC.md               전체 REST 레퍼런스 (엔드포인트 정본)
├── CLAUDE_COWORK_API.md      외부 Cowork/루틴 전용 API 계약
├── KIWOOM_API.md / KIS_API.md 증권사 API 카탈로그·대체 로드맵
├── README.md / CLAUDE.md     개요 / 프로젝트 규약·가토
├── start.sh|bat, stop.sh|bat 로컬 개발 서버 기동/종료
└── supabase/, .planning/, .superpowers/, .worktrees/   레거시·보조(현행 코드 경로 아님)
```

## 2. `backend/`

```
backend/
├── main.py                   앱 엔트리(로깅 배선·_migrate·lifespan·미들웨어·라우터 19개·/health)
├── auth.py                   인증 Depends 4종 (get_current_user / _or_api_key / require_admin / _or_api_key)
├── auth_schema.sql           users·refresh_tokens (app_schema.sql보다 **먼저** 실행)
├── app_schema.sql            앱 테이블 전체(신규 설치용) — main._migrate와 쌍 유지
├── supabase_schema.sql       레거시(미사용)
├── requirements.txt          fastapi·uvicorn·apscheduler·yfinance·pandas·psycopg2·authlib·jose·bcrypt·lxml… (anthropic 없음, fastapi 버전 핀 없음 — §9 참조)
├── Dockerfile / .dockerignore / Procfile / pytest.ini
├── run_backfill.py           일회성 백필 진입 스크립트
├── middleware/event_tracker.py   경로 매칭 사용자 행동 로그 → user_events
├── migrations/               001_user_events.sql, 002_backlog_history.sql (수동 SQL 아카이브)
├── routers/     (19 파일)    HTTP 표면 — §4 라우팅 맵
├── services/    (39 파일 + 6 서브패키지)  도메인 로직 — §3
├── scheduler/   (4 파일)     APScheduler 패키지: __init__(배선·start/stop/reload)·jobs·schedule·_state
├── tests/       (125 파일)   pytest (conftest.py에 _block_real_db autouse 가드; `_routes.py`가 라우트 순회 공용 헬퍼)
├── data/                     정적 유니버스(read-only 시드) + 일부 파일 캐시 + 레거시 잔존물(§6)
├── snapshots/                per-ticker/per-date 리포트 JSON (gitignored, 파일 폴백)
├── reports/                  레거시 리포트 디렉터리 (read-only 폴백)
└── .env.docker(.example) / .env   시크릿 (읽지 말 것)
```

### `backend/services/` 서브패키지

| 패키지 | 파일 | 비고 |
|---|---|---|
| `services/storage/` | `__init__`(전 심볼 re-export) `portfolio.py`(296) `names.py` `schedule.py` `dates.py` | 소비처는 `storage.X` 모듈 속성 접근 |
| `services/market/` | `__init__`(351, yfinance 공통+re-export) `kr.py`(664) `us.py`(204) `format.py` | KR=키움→KIS→Naver, US=yfinance→KIS |
| `services/market_indicators/` | `cache.py`(market_cache I/O) `fx` `commodities` `earnings` `econ` `exports` `macro` `indices` `sentiment` `kospi_futures` `kospi_signal` | `__init__`이 `get_*`/`_fetch_and_save_*` 공개. `earnings.py`의 티커 7일 캐시는 `market_cache`(키 `sp500_tickers`/`kospi_tickers`) — `backend/data/*.json`엔 write 안 함(task#234) |
| `services/kiwoom/` | `client.py` `quote.py`(ka10001) `chart.py`(ka10081/82/83) `investor.py`(ka10059/ka10008) `sector.py`(ka20006/ka20002) `shortsell.py`(ka10014) | KR 읽기전용(ADR-0009) |
| `services/kis/` | `client.py`(토큰 60s 가드) `quote.py`(FHKST01010100 + US) `futures.py`(FHMIF10000000/FHKIF03020100) | 백업 시세·선물(ADR-0011·0022) |
| `services/recommendation/` | `universe.py` `scoring.py` `funnel.py`(475) `store.py` `actions.py` | 배치 사전계산(ADR-0015/0016) |

## 3. `backend/services/` 단일 파일 (역할 색인)

| 파일 | 역할 |
|---|---|
| `db.py` | psycopg2 풀 + `query`/`execute`/`execute_many`/`get_connection` |
| `cache.py` | 인메모리 캐시 10종 + 무효화 집합 |
| `utils.py` | `sanitize`(NaN/inf→None)·`today_kst`·`TICKER_RE`·ticker 검색 헬퍼 |
| `errors.py` / `parallel.py` / `progress.py` | 공통 에러·병렬 실행·진행률 트래커 |
| `job_runs.py` | 배치 실행 이력(`record` contextmanager, job_id별 20건) |
| `batch_registry.py` | `BATCHES` 29 엔트리 = 배치 메타 정본 + `get_batch(job_id)` |
| `schedule_spec.py` | 통합 스케줄 스펙 검증 + `build_trigger_kwargs` |
| `report_generator.py` | 스냅샷 생산(시세·지표·재무·경쟁사·KR 박제 게이트) |
| `consensus.py` / `consensus_pipeline.py` | as-of 목표가 정본(ADR-0008) / 5점 표준화 저장 파이프라인 |
| `analyst_reports.py` | 발행물 저장·조회 + `build_data_block`·`per_band` |
| `cowork_trigger.py` | 루틴 fire POST (`configured()`/`fire()`) |
| `indicators.py` | RSI·EMA·52주·HV·매물대 계산 |
| `storage`(패키지) 외 | `auth_service.py`(JWT·OAuth·기본권한), `digest_service.py`, `scraper.py`, `guru_scraper.py`, `guru_stats.py` |
| KR 공시 | `backlog.py`+`backlog_parser.py`(수주잔고), `disclosures.py`, `agm.py`, `insider_trades.py` |
| 수급·시장 | `investor_service.py`, `short_sell_service.py`, `supply_score.py`, `leverage_service.py`, `lending_service.py`, `us_supply.py`, `ranking_service.py` |
| 분석 | `analysis_service.py`, `kr_sector_service.py`, `us_sector_service.py`, `beta.py`, `dividends.py`, `rebalance.py`(순수), `exposure.py`(순수) |

## 4. 라우팅 맵 — 백엔드 (라우터 ↔ URL prefix)

정본은 `API_SPEC.md`(+Cowork 범위는 `CLAUDE_COWORK_API.md`). 아래는 파일↔prefix 대응과 표면 요약.
**전 표면 공통(ADR-0029)**: 아래 모든 경로는 4개 인증 `Depends` 중 하나를 건다 — 표에는 반복 표기하지 않는다.
회귀 게이트는 `backend/tests/test_no_public_reads.py`(§ARCHITECTURE §6).

| 라우터 파일 | prefix | 라우트 수 | 주요 경로 |
|---|---|---|---|
| `routers/auth.py` | `/api/auth` | 10 | register·login·refresh·logout(**이 4개만 무인증**)·me·oauth/{google,github}(+callback, 무인증)·oauth/token(무인증) |
| `routers/portfolio.py` | `/api/portfolio` | 10 | `""`·dividends·prices·rebalance(+`PUT /rebalance/targets`)·exposure·`POST ""`·`{ticker}`(PUT/DELETE)·`PATCH {ticker}/pin` |
| `routers/watchlist.py` | `/api/watchlist` | 5 | GET/POST·`{ticker}`(PUT/DELETE)·`POST {ticker}/promote` |
| `routers/stocks.py` | `/api/stocks` | 13 | search·compare·`{ticker}/news`·`{ticker}/supply-score`·`GET ""`·**`PUT enrich/batch`(반드시 `{ticker}/enrich`보다 먼저)**·`PUT {ticker}/enrich`·`DELETE dashboard/cache`·names/backfill·dividends/refresh·beta/refresh·supply-score/refresh·dashboard |
| `routers/report.py` | `/api` | 26 | report/{progress,list,generate,generate/{ticker},backfill}·`{ticker}/history`·backlog·disclosures·agm·insider-trades·us-supply·**catch-all `GET /api/report/{ticker}/{date_str}`**(Cowork 예외로 `get_current_user_or_api_key`)·consensus/{batch,{ticker},{ticker}/backfill} |
| `routers/analyst_reports.py` | `/api/analyst-reports` | 5 | `POST {ticker}`(발행)·`GET ""`(종목당 최신1)·`DELETE {ticker}`(admin)·`GET {ticker}`(전 판)·`GET {ticker}/{published_date}` |
| `routers/recommendations.py` | `/api/recommendations` | 2 | GET·`POST refresh?market=` |
| `routers/rankings.py` | `/api` | 2 | `GET /api/rankings`·`POST /api/rankings/refresh` |
| `routers/investor.py` | `/api` | 3 | investor/screening·investor/refresh·`stocks/{ticker}/investor-trend` |
| `routers/short_sell.py` | `/api` | 2 | `stocks/{ticker}/short-sell`·`short-sell/refresh` |
| `routers/market_indicators.py` | `/api/market` | 25 | fx·vix·treasury·commodities·econ-indicators·indices·kospi-futures·fear-greed·macro-signals·kospi-signal·m7-earnings·kr-top2-earnings·kr-exports·leverage(+coverage/backfill)·lending(+sync)·refresh-* — **prefix는 `/api/market` 하나뿐, `/api/market-indicators`는 존재하지 않는다** |
| `routers/analysis.py` | `/api/analysis` | 4 | sector(+refresh-kr/refresh-us)·macro-correlation |
| `routers/analytics.py` | `/api/analytics` | 1 | correlation |
| `routers/calendar.py` | `/api` | 2 | `GET /api/calendar`·`DELETE /api/calendar/cache` (+`clear_cache()` 헬퍼가 cache.py에서 호출) |
| `routers/digest.py` | `/api` | 3 | digest/latest·digest/generate·digest/generate-all |
| `routers/guru.py` | `/api/guru` | 6 | managers·`managers/{id}`·stats/{popularity,manager-top3,weighted}·crawl(+progress) |
| `routers/batches.py` | `/api` | 4 | batches·batches/fomc-coverage·`{job_id}/schedule`(GET/PUT) |
| `routers/events.py` | `/api/events` | 1 | POST (VALID_EVENTS 화이트리스트) |
| `routers/admin.py` | `/api/admin` | 14 | users(+`{id}/permissions`·bulk-permissions·DELETE)·default-permissions·`DELETE stocks/{ticker}`·analytics/{summary,events,users,users/{id}}·**`GET analyst-targets`**(전역 지정 목록, task#224)·**`PUT analyst-targets/{ticker}`**·**`POST cowork/fire`** |

라우팅 함정: FastAPI는 선언 순서로 매칭하므로 ① `PUT /api/stocks/enrich/batch`를 `{ticker}/enrich`보다 먼저,
② `/api/report`의 catch-all `GET /{ticker}/{date_str}`가 신규 경로를 ticker로 삼키므로 신규 리소스는 별도 prefix
(그래서 발행물은 `/api/analyst-reports` — ADR-0027, `backlog`/`disclosures`/`agm`/`insider-trades`도 이 catch-all보다
먼저 등록해야 하는 동일 클래스 함정).

## 5. 라우팅 맵 — 프론트엔드

`frontend/src/App.jsx` 정의. 리다이렉트는 `frontend/src/routes.js` `REDIRECTS`:
`/`→`/reports`, `/research`→`/reports`, `/market`→`/market/indicators`, `/analysis`→`/portfolio`.

| 경로 | 페이지 | 셸 |
|---|---|---|
| `/reports` | `pages/Reports.jsx`(App의 `ReportsRoute`가 `initialTicker`·`navKey` 주입) | `ResearchShell` |
| `/recommend` | `pages/Recommendations.jsx` | `ResearchShell` |
| `/ranking` | `pages/Ranking.jsx` | `ResearchShell` |
| `/compare` | `pages/Compare.jsx` | `ResearchShell` |
| `/analyst-reports` | `pages/AnalystReports.jsx`(발행물 목록 + admin 대상관리·삭제) | `ResearchShell` |
| `/analyst-report/:ticker/:date` | `pages/AnalystReport.jsx`(문서 페이지 + 이전 판 이력 링크) | `ResearchShell` |
| `/calendar` | `pages/Calendar.jsx` | `ResearchShell` |
| `/dividends` | `pages/Dividends.jsx` | `ResearchShell` |
| `/digest` | `pages/Digest.jsx` | `ResearchShell` |
| `/portfolio` | `pages/Portfolio.jsx` | — |
| `/market/indicators`·`/market/flow` | `pages/MarketHub.jsx tab=` → `pages/Market.jsx` | — |
| `/guru` | `pages/Guru.jsx` | — |
| `/guru/:id` | `pages/GuruDetail.jsx`(매니저 상세, task#226) | — |
| `/settings` | `pages/Settings.jsx` | — |
| `/admin-analytics` | `pages/AdminAnalytics.jsx` (admin) | — |
| `/dev/showcase` | `pages/Showcase.jsx` — **nav 링크 없음**(URL 직접 진입 전용) | — |

### 내비게이션 (권한 필터 = `menuPermissions`)

`components/Masthead.jsx` PC 5섹션(ADR-0026 — ADR-0025 사이드바 대체) / `components/MobileNav.jsx` 하단 5탭 미러:

| 섹션 | perm | 항목 |
|---|---|---|
| 리서치 | `research` | 리포트 `/reports` · 추천 `/recommend` · 랭킹 `/ranking` · 비교 `/compare` · **심층 리포트 `/analyst-reports`** |
| 포트폴리오 | `portfolio` | `/portfolio`(단일 항목 → 헤더=링크) |
| 시장 | `market` | 시장지표 `/market/indicators` · 수급지표 `/market/flow` |
| 일정·인컴 | `research` | 캘린더 `/calendar` · 배당 `/dividends` · 다이제스트 `/digest` |
| 구루 | `guru` | `/guru`(하위 `/guru/:id`는 nav 항목 없음 — 목록에서만 진입) |

마스트헤드 우측 admin 영역: `/settings`(perm `settings`)·`/admin-analytics`(role admin).
모바일은 상단 `components/MobileTopActions.jsx`가 설정·admin 진입, `ResearchShell`이 섹션별 seg 필
(리서치 5 / 일정·인컴 3 — 교차 노출 없음). **`RESEARCH_TABS`(ResearchShell)와 `SECTIONS.research.items`(Masthead)는
별개 하드코딩이라 탭 변경 시 항상 함께 고칠 것** — 구조적 결합 상세는 `ARCHITECTURE.md` §8.

### 페이지 내부 탭 (라우트 없음, state 전환)

| 페이지 | 탭 | 렌더 대상 |
|---|---|---|
| `pages/Portfolio.jsx` | 대시보드 / 분석 | 대시보드=`components/portfolio/DashboardCard.jsx` 그리드 + 배당 요약 |
| ↳ 분석 하위 5 | 섹터·매크로·상관관계·리밸런싱·노출 | `pages/SectorTab.jsx`·`MacroTab.jsx`·`Analytics.jsx`·`RebalanceTab.jsx`·`ExposureTab.jsx` |
| `pages/Market.jsx` | indicators | `components/market/`: Index·KospiFutures·Treasury·Fx·Vix·FearGreed·Commodities·EconIndicators·MacroSignals·KospiSignal·M7Earnings·KrTop2·KrExports |
| ↳ | flow | `LeverageSection`·`LendingSection` |
| `pages/Reports.jsx` | holdings/watchlist/ungenerated/others(admin) | 사이드바 `components/reports/TickerListItem.jsx` + 그리드 `StockCard.jsx` / 상세 `ReportDetailHeader.jsx`+`ReportDetailTabs.jsx` |
| ↳ 상세 4탭 | 요약 / 지표(컨센서스·재무·수주·기술·수급) / 심층분석 / 히스토리 | `components/reports/{DetailTab,Sections,ConsensusChart,FinancialsChart,BacklogChart,HistoryTab,…}.jsx` |
| `pages/Settings.jsx` | 배치 / 권한·계정(admin) | 배치 허브(`components/BatchScheduleEditor.jsx` + `EXTRA` 임베드: `ReportManualGen`·`ConsensusSettings`·`GuruCrawlNow`·`LeverageBackfillSettings`) / `components/PermissionManager.jsx`→`PermissionPanel.jsx` |
| `pages/Guru.jsx` | 매니저 목록 / 인기순 / 가중치(**3탭** — '매니저별 탑3'은 task#227에서 제거됨, top10 배지로 흡수) | `pages/GuruManagers.jsx`(카드 클릭→`/guru/:id`) · `pages/GuruStats.jsx`(`view=`) |
| `pages/Ranking.jsx` | market KR/US × metric 거래대금·거래량·등락률·수급 × 유형 | 카드 + 모달(`ReportDetailTabs`·`InvestorTrendSection`) |

## 6. `frontend/src/`

```
frontend/src/
├── main.jsx  App.jsx  App.css  index.css  api.js  utils.js  routes.js
├── pages/            (29 .jsx + 6 *.test.jsx) 라우트 페이지 + 탭 전용 페이지(SectorTab·MacroTab·ExposureTab·
│                          RebalanceTab·Analytics·Market·ReportManualGen·ConsensusSettings·GuruCrawlNow·
│                          LeverageBackfillSettings·GuruManagers·GuruStats·GuruDetail·Showcase·LoginPage…)
├── components/        (18 최상위 파일 + 6 서브디렉터리)
│   ├── Masthead.jsx(+css)  MobileNav.jsx  MobileTopActions.jsx  GlobalSearch.jsx
│   ├── StockModal.jsx  PromoteModal.jsx  StockSearchBox.jsx  BatchScheduleEditor.jsx
│   ├── PermissionManager.jsx  PermissionPanel.jsx(+test)  Toast.jsx  LoadingSpinner.jsx
│   ├── InstallPrompt.jsx(+css)  Glossary.jsx(+css)
│   ├── ui/            Badge·Button·Card·Input·Stat·Skeleton·icons·InsiderBadge·SupplyBadge (+index.js)
│   ├── market/        (17 파일) 13 섹션 + marketUtils.jsx + Market.css
│   ├── reports/       (28 파일) DetailTab 690·Sections 516·ConsensusChart·FinancialsChart·
│   │                  ReportDetailTabs·ReportDetailHeader·ReportFilters·StockCard·StockActions·
│   │                  TickerListItem·BacklogChart·HistoryTab·reportUtils + 섹션 8종 + ReportDetail.css
│   ├── portfolio/     DashboardCard(+css)·FlashValue·PriceFreshness(+css)·PriceFlash.css
│   ├── recommendations/RecCard.jsx
│   └── sketches/      아이콘·스케치 SVG 12 + index.js
├── hooks/            usePortfolioData·useReportList·useReportGeneration·useReportFilters·
│                     useStockManagement·usePriceFlash·useIsMobile·useTheme·useReveal·
│                     useCountUp·useBodyScrollLock·useAuth (+ *.test.js)
├── contexts/AuthContext.jsx
├── glossary/         terms.js · match.js(+test)
├── utils/            analytics.js · marketHours.js · priceFlash.js · pwa.js
├── styles/           tokens.css · pc.css · mobile.css · motion.css · guru.css(구루 전용, task#227)
├── test/             setup.js + 통합 테스트 8(masthead·route-redirects·compare-race·
│                     recommendations-s3s4·reports-deep-link-navkey·global-search-tracked·smoke…)
└── assets/           hero.png · react.svg · vite.svg
```

`frontend/` 루트: `index.html` · `vite.config.js`(PWA·sw-cache-bust·manualChunks 함수형·vitest jsdom) ·
`eslint.config.js` · `package.json`(react 19·react-router 7·recharts 3·vite 8·vitest 4) · `public/` · `dist/`(빌드 산출·nginx 마운트) · `vercel.json`(레거시).

## 7. `scripts/` · `.forge/`

- `scripts/auto-deploy-poll.sh` — launchd 폴러(2분, `LOCAL != origin/main` → reset+deploy).
- `scripts/cowork-fire-listener.py` — 로컬 fire 리스너(127.0.0.1:8787 → `claude -p`), launchd `com.portfolion.cowork-fire-listener`.
- `scripts/cowork-routine-prompt.md` — 루틴 프롬프트 정본(`{{COWORK_API_KEY}}` 치환 자리).
- `scripts/audit_unauth_endpoints.py` — 무인증 엔드포인트 라이브 프로브. **정본이 아니다** — ADR-0029 회귀 게이트는
  `backend/tests/test_no_public_reads.py`(pytest)로 승격됐고(task#233), 이 스크립트는 컨테이너 ad-hoc 확인용 잔존물.
- 그 외 대다수는 UAT/스크린샷 하니스(`uat*.mjs|js`, `screenshot.js`, `capture-*.js`, `check-permissions.js`,
  `contrast_probe.py`, `repair-005930-snapshots.py`) + `scripts/package.json`(playwright 등 로컬 의존).
- `.forge/codebase/` 7문서(ARCHITECTURE·STRUCTURE·STACK·CONVENTIONS·CONCERNS·INTEGRATIONS·TESTING),
  `.forge/adr/0001~0029`(+`retired/`), `.forge/backlog/`·`executed/`·`done/`·`retro/`·`quick/`.

## 8. DB 테이블 위치

| 파일 | 내용 |
|---|---|
| `backend/auth_schema.sql` | `users`, `refresh_tokens` (**먼저** 실행) |
| `backend/app_schema.sql` | `tickers` `snapshots` `user_stocks` `schedules` `guru_managers` `guru_schedules` `batch_schedules` `digests` `consensus_history` `calendar_cache` `market_cache` `user_menu_permissions` `default_menu_permissions` `raw_reports` `daily_consensus_mart` `user_events` `market_leverage_indicators` `market_lending_balance` `backlog_history` `market_rankings` `market_investor_trend` `market_short_sell` `stock_disclosures` `stock_dividends` `stock_dividend_schedule` `stock_beta` `stock_supply_score` `stock_insider_trades` `stock_recommendations` `job_runs` `us_supply_snapshot` `analyst_reports` |
| `backend/main.py::_migrate` | 위 후반 테이블 + 컬럼 추가(`tickers.{key_resource,competitor_edge,market_outlook,analyst_target}`, `user_stocks.{target_price,stop_price,target_weight,pinned}`, `stock_disclosures.meeting_date`, `stock_recommendations.{low_liquidity,exchange,name}`, `us_supply_snapshot.{insider_transactions,insider_net}`, `backlog_history.segments`) |

**신규 컬럼/테이블은 `app_schema.sql` + `main._migrate` 두 곳에 쌍으로**(ADR-0006 — 라이브 DB는 `_migrate`만 탄다).
`market_cache`의 `key` 값 예시: `macro_signals`·`kr_sector_momentum`·`sp500_tickers`·`kospi_tickers`(task#234 신설,
`earnings.py`의 티커 7일 캐시) 등 — 표는 §ARCHITECTURE §4(b)/§3 참조.

## 9. 명명 규약

**백엔드**
- 파일·모듈: `snake_case.py`. 라우터는 리소스 단수/복수 그대로(`report.py`·`analyst_reports.py`), 서비스는 도메인명(`dividends.py`) 또는 `<도메인>_service.py`(외부 API 오케스트레이션: `investor_service`·`leverage_service`·`kr_sector_service`).
- 서브패키지는 `<도메인>/` + `__init__.py`가 전 심볼 re-export(ADR-0017). 순환 회피용 상태는 leaf `_state.py`.
- 라우터 변수는 항상 `router = APIRouter(prefix="/api/...", tags=[...])`. 라우터 내부 헬퍼는 `_leading_underscore`.
- 배치 id = `<도메인>_<동작>`(`dividend_fetch`·`kr_sector_fetch`) 또는 시장 분리 접미사(`daily_report_kr`·`earnings_us`·`recommendation_kr`). **id는 스케줄러 잡 id·`job_runs.record` id·`_JOB_FUNCS` 키와 동일 문자열**.
- market_cache 키는 소문자 스네이크(`macro_signals`·`kr_sector_momentum`·`sp500_tickers`).
- 로그 마커는 `[Component]` PascalCase, 개념당 1스펠링(`[Scheduler]`·`[AnalystReport]`·`[CoworkTrigger]`·`[Migrate]`·`[Cache]`·`[Earnings]`). `print` 금지(`tests/test_no_print.py`).
- 테스트: `backend/tests/test_<대상>.py`(라우터=`test_<name>_router.py`, 배치=`test_<name>_batch.py`). 라우트 순회가
  필요한 테스트는 `tests/_routes.py:walk_routes()`를 재사용할 것(FastAPI 버전에 따라 `app.routes` 평탄 순회가
  0개를 세는 발산이 있다 — `test_api_doc_sync.py`·`test_no_public_reads.py`가 이미 이 헬퍼를 공유).

**프론트엔드**
- 컴포넌트/페이지: `PascalCase.jsx`(+동명 `PascalCase.css`). 훅: `useXxx.js`. 유틸: `camelCase.js`.
- 라우트 페이지와 탭 전용 페이지가 `pages/`에 섞여 있다 — 라우트 여부는 `App.jsx`가 유일한 판별자
  (`Market.jsx`는 `MarketHub`만이 렌더, `SectorTab`/`MacroTab`/`ExposureTab`/`RebalanceTab`/`Analytics`는 `Portfolio`가 렌더).
- 도메인 컴포넌트는 `components/<도메인>/`(market·reports·portfolio·recommendations), 공통 프리미티브는 `components/ui/`(+`index.js` 배럴).
- 섹션 컴포넌트는 `<주제>Section.jsx`(`FxSection`·`LeverageSection`·`ShortSellSection`), 차트는 `<주제>Chart.jsx`.
- 테스트는 같은 디렉터리 `*.test.jsx|js`(예: `pages/AnalystReport.test.jsx`), 크로스 컴포넌트 통합은 `src/test/`.
- 라우트 경로는 kebab-case(`/analyst-reports`·`/market/indicators`·`/admin-analytics`), 상세는 `/guru/:id`처럼
  목록 라우트 하위 `:param` 세그먼트.
- 도메인 전용 CSS 파일(`styles/guru.css` 등)은 관련 페이지가 모여 있는 영역이 커지면 `styles/`로 분리 이전하는
  패턴(task#227의 구루 사례 — 이전엔 인라인/공용 CSS에 흩어져 있었다).

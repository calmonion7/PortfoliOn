---
last_mapped_commit: 91bac67ddb3ca7277a850fa6840a0fce0f7344cf
mapped: 2026-07-30
---

# STRUCTURE — PortfoliOn

파일이 실제로 어디 있는지, 새 코드를 어디에 두는지, 이름을 어떻게 짓는지. 구현 사실만 기록한다(용어 의미는 `.forge/CONTEXT.md` 관할).

---

## 1. 최상위 레이아웃

```
PortfoliOn/
├── backend/                 FastAPI 앱 (§2)
├── frontend/                React 19 + Vite SPA (§3)
├── nginx/nginx.conf         정적 서빙 + /api 프록시
├── certbot/                 HTTPS 갱신 컨테이너 볼륨 (conf/, www/)
├── docker-compose.yml       postgres / backend / nginx / certbot
├── deploy.sh                프론트빌드 → 백엔드 이미지 → 컨테이너 교체 → /health
├── .github/workflows/deploy.yml   self-hosted 러너 배포
├── scripts/                 운영·UAT 스크립트 110개 (§5)
├── docs/                    2026-05 시점 문서 스냅샷 (stale, 참고용)
├── .forge/                  forge 상태·결정·지도 (§6)
├── screenshots*/            UAT 캡처 산출물 (task 번호별, 40+ 디렉터리)
├── API_SPEC.md              전체 REST 레퍼런스 (정본)
├── CLAUDE_COWORK_API.md     외부 Cowork enrich/backlog API
├── KIWOOM_API.md / KIS_API.md   외부 증권 API 카탈로그
├── CLAUDE.md                아키텍처 사실 + 가토(함정) 누적 문서
├── README.md                overview (화면·env·스택·아키텍처·배치)
├── start.sh / start.bat / stop.sh / stop.bat    로컬 양 서버 기동
└── supabase/ .planning/ .superpowers/ .worktrees/ ...   레거시·도구 디렉터리
```

레거시 잔존: `supabase/`(Supabase 이전 전), `backend/supabase_schema.sql`, `backend/Procfile`, `frontend/vercel.json` — 현재 배포 경로(Mac Docker)에서 쓰이지 않는다.

---

## 2. `backend/`

```
backend/
├── main.py                  앱 진입점 — 로깅 배선·_migrate()·미들웨어·19라우터 마운트·검증핸들러·lifespan
├── auth.py                  FastAPI 인증 의존성 4종 (get_current_user / *_or_api_key / require_admin / require_admin_or_api_key)
├── auth_schema.sql          users, refresh_tokens  ← app_schema보다 먼저 실행
├── app_schema.sql           앱 테이블 30여 개 (신규 설치용)
├── migrations/              001_user_events.sql, 002_backlog_history.sql (초기 수동 마이그레이션 잔존)
├── requirements.txt         Docker 의존성 정본
├── Dockerfile / .dockerignore
├── pytest.ini               testpaths=tests, pythonpath=.
├── .env.docker              배포 env (gitignored, 절대 값 인용 금지)
├── .env.docker.example      키 이름 템플릿
├── .venv/                   로컬 Python 3.9.6 (Docker는 3.12 — 버전차 주의)
├── run_backfill.py          단발 백필 CLI
│
├── routers/                 19개 (§2.1)
├── services/                도메인·어댑터·인프라 (§2.2)
├── scheduler/               APScheduler 패키지 (§2.3)
├── middleware/              event_tracker.py (+ 빈 __init__.py)
├── data/                    정적 시드 + 레거시 JSON (§2.4)
├── snapshots/               리포트 스냅샷 JSON 폴백 (gitignored)
├── reports/                 레거시 리포트 디렉터리 (read-only 폴백)
├── scripts/                 (빈 디렉터리)
└── tests/                   128 테스트 + conftest.py + _routes.py + fixtures/ (§2.5)
```

### 2.1 `backend/routers/` — 라우터 19개

`admin.py` `analysis.py` `analyst_reports.py` `analytics.py` `auth.py` `batches.py` `calendar.py` `digest.py` `events.py` `guru.py` `investor.py` `market_indicators.py` `portfolio.py` `rankings.py` `recommendations.py` `report.py` `short_sell.py` `stocks.py` `watchlist.py`

- prefix 매핑 표는 `ARCHITECTURE.md §4`.
- 파일당 `router = APIRouter(prefix=..., tags=[...])` 하나. `main.py`가 `from routers import X`(모듈) 또는 `from routers.X import router as X_router`(명시 별칭) 두 스타일을 섞어 쓴다.
- 크기순 상위: `stocks.py`(≈30KB) > `report.py`(≈27KB) > `portfolio.py`(≈15KB) > `calendar.py`·`market_indicators.py`(≈10KB).

### 2.2 `backend/services/`

**서브패키지 6개** (내부 파일 개요는 `ARCHITECTURE.md §6`):

| 패키지 | 파일 |
|---|---|
| `storage/` | `__init__.py`(전 심볼 re-export) `portfolio.py` `names.py` `schedule.py` `dates.py` |
| `market/` | `__init__.py` `kr.py` `us.py` `format.py` |
| `market_indicators/` | `__init__.py` `cache.py` `fx.py` `commodities.py` `indices.py` `sentiment.py` `kospi_futures.py` `kospi_signal.py` `earnings.py` `econ.py` `exports.py` `macro.py` |
| `kiwoom/` | `__init__.py` `client.py` `quote.py` `chart.py` `investor.py` `sector.py` `shortsell.py` |
| `kis/` | `__init__.py` `client.py` `quote.py` `futures.py` |
| `recommendation/` | `__init__.py` `universe.py` `scoring.py` `funnel.py` `store.py` `actions.py` |

**플랫 모듈** (41개):

- 인프라: `db.py` `cache.py` `utils.py` `errors.py` `parallel.py` `progress.py` `job_runs.py` `batch_registry.py` `schedule_spec.py`
- 리포트 생산: `report_generator.py` `consensus.py` `consensus_pipeline.py` `analyst_reports.py` `digest_service.py`
- 지표·산출: `indicators.py` `beta.py` `exposure.py` `rebalance.py` `analysis_service.py` `supply_score.py` `guru_stats.py`
- 시장 데이터: `ranking_service.py` `investor_service.py` `short_sell_service.py` `us_supply.py` `us_sector_service.py` `kr_sector_service.py` `leverage_service.py` `lending_service.py` `dividends.py`
- KR 공시 계열: `backlog.py` `backlog_parser.py` `disclosures.py` `agm.py` `insider_trades.py`
- 외부 스크레이퍼: `scraper.py` `guru_scraper.py`
- 기타: `auth_service.py` `cowork_trigger.py`

### 2.3 `backend/scheduler/`
```
__init__.py    배선 + start()/stop()/reload(job_id)  ← 공개 API, private 심볼까지 명시 re-export
_state.py      _scheduler, _DIGEST_JOB_ID, _VALID_DAYS  (leaf — 순환 회피)
jobs.py        잡 함수 전부 + _JOB_FUNCS(28) + _in_market + _seed_*_if_empty(3)
schedule.py    _build_trigger / _reschedule_job / _seed_spec_for / _seed_batch_schedules / _check_missed_report(_for)
```
**단일 `scheduler.py`가 아니고, `services/` 하위도 아니다** — `backend/` 루트 레벨 패키지다.

### 2.4 `backend/data/`
| 항목 | 상태 |
|---|---|
| `sp500_tickers.json`, `kospi_tickers.json` | **read-only 정적 시드**. write 경로 없음(`market_indicators/earnings.py:_read_seed` docstring). 실제 캐시는 `market_cache` 키 `sp500_tickers`·`kospi_tickers` |
| `kr_exports.json` | `market_indicators/exports.py`가 `_mc_save`와 함께 write + 최후 폴백 read — 코드가 write하는 유일한 `data/` 파일 |
| `holdings.json` `watchlist.json` `stocks.json` `guru_managers.json` `guru_schedule.json` `schedule.json` | 코드 참조 0건(grep 확인) — DB 이전 잔존 |
| `consensus/` `calendar/` `digest/` | 코드 참조 0건 — 레거시 파일 캐시 디렉터리 |

### 2.5 `backend/tests/`
- `conftest.py` — `client` fixture + autouse `_clear_quote_cache` + autouse **`_block_real_db`**(`services.db._get_pool` → raise) + 모듈 로드 시 `app.dependency_overrides[get_current_user]`.
- `_routes.py` — 라우트 열거 헬퍼. `fixtures/` — 외부 응답 fixture.
- 파일명 = `test_<대상>.py`. 대상은 라우터(`test_stocks_router.py`), 서비스(`test_dividends.py`), 어댑터(`test_kiwoom_quote.py`), 배치(`test_recommendation_batch.py`), 규약(`test_no_print.py`·`test_no_bare_today.py`·`test_api_doc_sync.py`·`test_no_public_reads.py`), 회귀 시나리오(`test_kr_quote_degenerate_reuse.py`·`test_empty_result_overwrite_guards.py`) 중 하나.

---

## 3. `frontend/`

```
frontend/
├── index.html               SPA 셸
├── vite.config.js           PWA·sw-cache-bust 플러그인·manualChunks·vitest·dev proxy
├── package.json             react 19 / react-router-dom 7 / recharts 3 / axios / vite 8 / vitest 4
├── eslint.config.js
├── .env                     VITE_* 로컬 env
├── public/                  favicon.svg, icons.svg  ← 정적 자산 2개뿐
├── dist/                    nginx가 :ro 마운트로 직접 서빙 (gitignored)
└── src/
    ├── main.jsx             createRoot → <App/>
    ├── App.jsx              인증 게이트 + AppShell + <Routes>
    ├── App.css              셸 레이아웃
    ├── index.css            styles/ 4종 import + recharts outline 리셋
    ├── api.js               axios 인스턴스 + 토큰/401 인터셉터
    ├── routes.js            REDIRECTS (구 URL → 신규 라우트, ADR-0025)
    ├── utils.js             (루트 소품 유틸)
    ├── pages/               40 파일 (§3.1)
    ├── components/          루트 위젯 + 6 서브디렉터리 (§3.2)
    ├── hooks/               15 훅 (§3.3)
    ├── contexts/            AuthContext.jsx
    ├── styles/              tokens.css pc.css mobile.css guru.css motion.css
    ├── utils/               analytics.js guruName.js marketHours.js priceFlash.js pwa.js (+ guruName.test.js)
    ├── glossary/            terms.js match.js (+ match.test.js)
    ├── assets/              이미지·폰트
    └── test/                통합·라우팅 테스트 8 + setup.js (§3.4)
```

### 3.1 `frontend/src/pages/`
세 부류가 한 디렉터리에 섞여 있다.

**A. 라우팅되는 페이지** (`App.jsx`의 `<Route>` 대상)
`Portfolio.jsx` `Reports.jsx` `Recommendations.jsx` `Ranking.jsx` `Compare.jsx` `Calendar.jsx` `Dividends.jsx` `Digest.jsx` `AnalystReports.jsx` `AnalystReport.jsx` `MarketHub.jsx` `Guru.jsx` `GuruDetail.jsx` `Settings.jsx` `AdminAnalytics.jsx` `Showcase.jsx`(`/dev/showcase`) `LoginPage.jsx`

**B. 셸/래퍼**
`ResearchShell.jsx` — 8 리서치·일정 라우트를 감싸는 얇은 래퍼(모바일 seg nav 소유).

**C. 라우팅 안 되는 탭·섹션 컴포넌트** (부모 페이지가 로컬 상태로 스위칭)
| 파일 | 부모 |
|---|---|
| `Market.jsx` | `MarketHub.jsx` (`tab` prop) |
| `SectorTab.jsx` `MacroTab.jsx` `Analytics.jsx` `RebalanceTab.jsx` `ExposureTab.jsx` | `Portfolio.jsx` 분석 탭 |
| `GuruManagers.jsx` `GuruStats.jsx` `GuruAllocation.jsx` | `Guru.jsx` |
| `ConsensusSettings.jsx` `GuruCrawlNow.jsx` `LeverageBackfillSettings.jsx` `ReportManualGen.jsx` | `Settings.jsx` |

`GuruStats.jsx`는 `WatchlistBtn`을 named export로 내보내 `GuruAllocation.jsx`·`GuruDetail.jsx`가 재사용한다.

페이지 CSS는 두 개만 병치돼 있다(`Compare.css`, `LoginPage.css`) — 나머지는 `styles/`의 전역 CSS를 쓴다.
페이지 테스트도 병치된다: `AnalystReport.test.jsx` `AnalystReports.test.jsx` `GuruAllocation.test.jsx` `GuruDetail.test.jsx` `GuruManagers.test.jsx` `GuruStats.test.jsx`.

### 3.2 `frontend/src/components/`
| 위치 | 내용 |
|---|---|
| 루트 | `Masthead.jsx`+`.css` `MobileNav.jsx` `MobileTopActions.jsx` `GlobalSearch.jsx` `StockSearchBox.jsx` `StockModal.jsx` `PromoteModal.jsx` `Toast.jsx` `Glossary.jsx`+`.css` `InstallPrompt.jsx`+`.css` `PermissionManager.jsx` `PermissionPanel.jsx`(+`.test.jsx`) `BatchScheduleEditor.jsx` `LoadingSpinner.jsx` |
| `ui/` | `Badge` `Button` `Card` `Input` `Skeleton` `Stat`(각 `.jsx`+`.css`), `icons.jsx`, `GuruActivityBadge.jsx` `InsiderBadge.jsx` `SupplyBadge.jsx`, `index.js` 배럴 |
| `market/` | `*Section.jsx` 16개(`IndexSection` `KospiFuturesSection` `TreasurySection` `FxSection` `VixSection` `FearGreedSection` `CommoditiesSection` `EconIndicatorsSection` `MacroSignalsSection` `KospiSignalSection` `M7EarningsSection` `KrTop2Section` `KrExportsSection` `LeverageSection` `LendingSection`) + `Market.css` + `marketUtils.jsx` |
| `reports/` | `ReportDetailTabs` `ReportDetailHeader` `ReportFilters` `StockCard` `TickerListItem` **`StockActions`** `DetailTab` `HistoryTab` `Sections` / 차트 `ConsensusChart` `FinancialsChart` `BacklogChart` `KeyResourceChart` / 섹션 `GuruHoldersSection` `InsiderTradesSection` `InvestorTrendSection` `LatestDisclosuresSection` `MarketOutlookSection` `ShortSellSection` `SupplySection` `UsInsiderSection` `UsSupplySection` / `reportUtils.jsx` / `ReportDetail.css` / 병치 테스트 5 |
| `portfolio/` | `DashboardCard`+`.css` `FlashValue.jsx` `PriceFreshness.jsx`+`.css` `PriceFlash.css` |
| `recommendations/` | `RecCard.jsx` |
| `sketches/` | 내비 아이콘 `IconResearch` `IconPortfolio` `IconMarket` `IconCalendarIncome` `IconGuru` + 장식/상태 `SketchHero` `SketchEmpty` `SketchError` `SketchNotFound` `SketchArrowUp` `SketchCircleMark` `SketchUnderline` + `index.js` |

`StockActions.jsx`는 액션 버튼(수정·승격·삭제)의 **단일 소유처**다 — `StockCard`(그리드)와 `TickerListItem`(사이드바)이 `layout="card"|"list"`로 같은 컴포넌트를 쓴다.

### 3.3 `frontend/src/hooks/`
`useAuth.js`(AuthContext 재수출) `usePortfolioData.js` `useReportList.js` `useReportFilters.js` `useStockManagement.js` `useReportGeneration.js` `useIsMobile.js` `useTheme.js` `useBodyScrollLock.js` `useCountUp.js` `useReveal.js` `usePriceFlash.js`
병치 테스트 3: `usePortfolioData.test.js` `useReportFilters.test.js` `useStockManagement.test.js`.

### 3.4 `frontend/src/test/`
`setup.js`(vitest setup) + 통합 테스트 8: `route-redirects.test.jsx` `masthead.test.jsx` `global-search-tracked.test.jsx` `compare-race.test.jsx` `compare-sector-group.test.jsx` `recommendations-s3s4.test.jsx` `reports-deep-link-navkey.test.jsx` `smoke.test.js`.

**규칙**: 단일 컴포넌트/훅 테스트는 대상 옆에 병치, 여러 모듈을 걸치는 통합·라우팅 테스트는 `src/test/`.

---

## 4. 무엇을 어디에 두는가

| 새로 만드는 것 | 위치 | 함께 손대야 하는 것 |
|---|---|---|
| REST 엔드포인트 | 자원에 맞는 `backend/routers/*.py` | `API_SPEC.md`(테스트가 검출) / Cowork 대상이면 `CLAUDE_COWORK_API.md`도 |
| 도메인 계산 로직 | `backend/services/<도메인>.py` | 해당 `backend/tests/test_<도메인>.py` |
| 외부 API 호출 | 어댑터 패키지(`market/`·`kiwoom/`·`kis/`) 또는 신규 `services/<source>.py` | 경계가 새로우면 `.forge/adr/` |
| 시장지표 1종 | `backend/services/market_indicators/<name>.py` + `__init__.py` re-export + `routers/market_indicators.py` GET | 배치면 `batch_registry` + `scheduler/jobs.py` `_JOB_FUNCS` |
| 배치 | `services/batch_registry.py` BATCHES 항목 + `scheduler/jobs.py` 잡함수 + `_JOB_FUNCS` 엔트리 | exact-count/exact-set 단언 테스트 4파일(`test_scheduler_seed` `test_batch_market_split` `test_batches_router` `test_macro_signals_batch`) |
| DB 테이블/컬럼 | `backend/app_schema.sql` **와** `main.py:_migrate()` 둘 다 | 한쪽만 고치면 배포 직후 깨진다 |
| 저장소 접근 함수 | `backend/services/storage/<서브모듈>.py` + `storage/__init__.py` re-export | 소비처는 `storage.X` 모듈 속성으로만 접근 |
| 화면(라우트) | `frontend/src/pages/<Name>.jsx` + `App.jsx` `<Route>` | 하위탭이면 `ResearchShell` + `Masthead` + `MobileNav` **3곳** |
| 하위탭 | 위 3곳 목록 전부 | `grep -rn "RESEARCH_TABS\|SECTIONS\|RESEARCH_PATHS" frontend/src/` |
| UI 프리미티브 | `frontend/src/components/ui/` + `index.js` 배럴 | `ui/*.css` 병치 |
| 시장 화면 섹션 | `frontend/src/components/market/<X>Section.jsx` + `pages/Market.jsx` 삽입 | |
| 리포트 상세 부품 | `frontend/src/components/reports/` | 액션버튼은 `StockActions.jsx` 한 곳만 |
| 디자인 토큰 | `frontend/src/styles/tokens.css` | 배지 variant는 소비처 전수 grep 선행 |
| 라이브 UAT 프로브 | `scripts/uat<N>-<주제>.mjs` | 캡처는 `screenshots-uat<N>/` |

---

## 5. `scripts/`

110개 파일. 이름으로 용도가 갈린다.

| 패턴 | 용도 | 예 |
|---|---|---|
| `uat<N>-<주제>.mjs` | Playwright 라이브 UAT 프로브/캡처(task 번호) | `uat225-polish.mjs` `uat237-*.mjs` `uat241-*.mjs` |
| `smoke<N>-auth.mjs` | 인증 게이팅 스모크 | `smoke230-auth.mjs` `smoke232-auth.mjs` |
| `probe*-*.{mjs,py}` | 단발 진단 프로브 | `probe-appbar-sticky.mjs` `probe239-guru-activity.py` |
| `capture-*.js`, `screenshot.js` | 스크린샷 캡처 | `capture-report-detail.js` `capture-ux.js` |
| `audit_*.py`, `contrast_probe.py`, `check-permissions.js` | 감사 스크립트 | `audit_unauth_endpoints.py` |
| `auto-deploy-poll.sh`, `start-docker-compose.sh`, `ddns_update.sh` | 운영 자동화 | |
| `cowork-fire-listener.py`, `cowork-routine-prompt.md` | ADR-0028 루틴 트리거 수신단 | |
| `repair-*.py`, `kospi_signal_backtest.py` | 단발 데이터 보수·백테스트 | |

자체 `package.json`/`node_modules`(Playwright 등)를 가진다.

---

## 6. `.forge/`

```
.forge/
├── CONTEXT.md          도메인 용어 원장 (이 디렉터리의 codebase/ 와 역할 분리)
├── config.json         forge 설정 (tdd 등)
├── adr/                0001~0029 + retired/
├── backlog/            실행 대기 계획
├── executed/           실행 후 회고 대기
├── done/               봉인 완료 (240+ 디렉터리)
├── retro/              회고 로그 (215+)
├── quick/LOG.md        퀵레인 기록
├── bug-report.md
└── codebase/           ← 이 지도 (ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, CONCERNS.md)
```

---

## 7. 네이밍 규약

### 7.1 백엔드 — 모듈·파일
- 라우터 파일 = 자원 이름 그대로, 대개 복수형(`stocks.py` `rankings.py` `recommendations.py`), 단수도 있음(`report.py` `portfolio.py` `calendar.py` `digest.py`).
- 서비스 파일에 `_service` 접미사는 **일관 규칙이 아니다.** 붙은 쪽(`ranking_service.py` `investor_service.py` `short_sell_service.py` `leverage_service.py` `lending_service.py` `kr_sector_service.py` `us_sector_service.py` `analysis_service.py` `auth_service.py` `digest_service.py`)은 대개 *같은 이름의 라우터가 이미 존재해 충돌을 피한 경우*이고, 충돌이 없으면 접미사 없이 둔다(`dividends.py` `beta.py` `disclosures.py` `agm.py` `backlog.py`).
- 라우터와 서비스가 동명일 수 있다: `routers/analyst_reports.py` ↔ `services/analyst_reports.py`, `routers/market_indicators.py` ↔ `services/market_indicators/`.
- god file 분해는 **패키지 + `__init__.py` 전 심볼 re-export**(ADR-0017). 소비처의 `X.symbol` 모듈 속성 접근을 깨지 않기 위해 private 심볼까지 명시 re-export한다(`services/storage/__init__.py`, `scheduler/__init__.py`).
- 모듈 내부: `_` 접두 = 모듈-private. 배치 잡 함수는 전부 `_`로 시작(`_generate_kr` `_fetch_dividends` `_refresh_macro_signals`)하고 `_JOB_FUNCS`로만 노출된다. 시드 함수는 `_seed_<대상>_if_empty`.
- 시장지표 캐시 헬퍼 접두 `_mc_`(`_mc_load`/`_mc_save`/`_mc_delete`) = `market_cache` 테이블 접근.
- 외부 데이터 fetch+저장 함수는 `_fetch_and_save_<대상>`, 조회는 `get_<대상>`.
- 시계열 store는 `fetch_trend`/`upsert_trend`/`read_series`/`oldest_date` 4종 이름을 여러 서비스가 공유한다(`investor_service.py`, `short_sell_service.py`).
- 통째 교체 저장은 `replace_*`(`replace_market_rankings` `replace_recommendations` `replace_schedule`).

### 7.2 백엔드 — 라우트 경로
- 모두 `/api/` 아래. 다어절 세그먼트는 **kebab-case**: `/api/market/kr-top2-earnings` `/api/market/econ-indicators` `/api/market/macro-signals` `/api/analysis/macro-correlation` `/api/analyst-reports` `/api/short-sell/refresh` `/api/stocks/{ticker}/investor-trend`.
- 수동 배치 트리거는 동사형 POST: `/refresh`, `/refresh-<대상>`, `/sync`, `/generate`, `/generate-all`, `/backfill`.
- 시장 분기는 쿼리 파라미터: `?market=KR|US`(`/api/market/refresh-earnings`, `/api/market/refresh-monthly`, `/api/rankings/refresh`, `/api/recommendations/refresh`) — 단 섹터는 경로로 갈린다(`/api/analysis/sector/refresh-kr` vs `refresh-us`).
- 캐시 무효화는 `DELETE .../cache`(`/api/stocks/dashboard/cache`, `/api/calendar/cache`).
- 리소스 하위 컬렉션은 `/api/stocks/{ticker}/<sub>`(`news` `supply-score` `short-sell` `investor-trend`), 리포트 계열은 `/api/report/{ticker}/<sub>`(`backlog` `disclosures`).

### 7.3 배치 id
- `snake_case`. 관용 형태 3종: `<대상>_fetch`(`dividend_fetch` `backlog_fetch` `us_supply_fetch`), `<대상>_<market>`(`daily_report_kr` `earnings_us` `monthly_kr` `recommendation_us`), 명사형(`consensus` `guru_crawl` `daily_digest`).
- **id 동일성 계약**: `batch_registry.BATCHES[].id` == APScheduler job id == `job_runs.record(id, …)` == `batch_schedules.job_id`.
- 은퇴한 id(`daily_report` `earnings_refresh` `monthly_refresh` `refresh-econ`)는 `scheduler/schedule.py:_seed_spec_for`의 승계 read로만 살아 있다.

### 7.4 로깅
- `logger = logging.getLogger(__name__)`을 모듈 상단에 두고 `print`는 신규 금지(`backend/tests/test_no_print.py`가 단언).
- 메시지 포맷: `logger.<level>(f"[Component] <무엇> (<ids>): {e}")`. `[Component]`는 **PascalCase, 개념당 1스펠링** — formatter에 prefix가 없어 메시지 내 마커가 유일한 grep 앵커다. 실사용 예: `[Scheduler]` `[Migrate]` `[Cache]` `[Earnings]` `[KrExports]` `[GuruStats]` `[Guru]` `[CoworkTrigger]` `[Report]`.
- 레벨: `warning` = graceful 담화(직전값 유지·스킵·부분 실패), `error` = 예상치 못함·데이터 손실, `info` = 배치/라이프사이클.
- 프론트는 `console.warn`(graceful) / `console.error`(예상외) + 마커에 **소스 모듈/훅 실명**(`[usePortfolioData]` `[GuruAllocation]`) — 백엔드의 개념명 규약과 다르다. 자동 가드 없음(lint 미연결).

### 7.5 프론트엔드
- 컴포넌트·페이지 파일 = `PascalCase.jsx`, default export가 동명 함수.
- 훅 = `use<Name>.js`(camelCase 파일).
- 유틸 = camelCase(`guruName.js` `marketHours.js` `priceFlash.js` `analytics.js` `pwa.js`).
- 접미사 관용: `*Section.jsx`(시장·리포트 화면 블록), `*Tab.jsx`(부모가 로컬 상태로 스위칭하는 탭), `*Shell.jsx`(라우트 래퍼), `*Chart.jsx`(recharts), `Icon*`/`Sketch*`(SVG), `*Modal.jsx`.
- CSS: 컴포넌트 전용은 `.jsx` 옆에 동명 `.css` 병치, 전역·화면 계열은 `src/styles/`. `index.css`가 4개(tokens→pc→mobile→guru)를 import.
- 테스트: 단일 대상은 `<대상>.test.jsx|js` 병치, 다중 모듈 통합은 `src/test/<주제>.test.jsx`(kebab-case).
- 배럴 파일(`index.js`)은 `components/ui/`와 `components/sketches/` 두 곳만.
- 상수 목록은 파일 상단 `SCREAMING_SNAKE`(`RESEARCH_TABS` `SCHEDULE_TABS` `SECTIONS` `ALL_TABS` `TABS` `SCOPES` `REDIRECTS` `GLOSSARY`).
- CSS 클래스: 셸·레이아웃은 `masthead-*` `mobile-header` `page-wrap` `page-head` `page-title` `page-sub` `appbar` `seg`/`seg-pad` `m-page` `tabbar`, 애니메이션은 `anim-*`(`anim-fade` `anim-fade-up` `anim-stagger` `sketch-draw`), 구루 화면은 `guru-*`(`styles/guru.css`), 활성 상태는 `is-active`.
- 가격 방향 배지는 `.badge--up`/`.badge--down` **전용 변형**, 의미 상태는 `.badge--success`/`.badge--danger`/`.badge--warning` — 교차 사용 금지(`components/ui/Badge.css`, `styles/tokens.css`).

### 7.6 SQL·DB
- 테이블: `snake_case` 복수형 또는 도메인 접두 그룹 — `market_*`(`market_cache` `market_rankings` `market_investor_trend` `market_short_sell` `market_leverage_indicators` `market_lending_balance`), `stock_*`(`stock_disclosures` `stock_dividends` `stock_dividend_schedule` `stock_beta` `stock_supply_score` `stock_insider_trades` `stock_recommendations`), `user_*`(`user_stocks` `user_events` `user_menu_permissions`), `guru_*`.
- 인덱스: `idx_<대상>_<용도>`(`idx_short_sell_read` `idx_disclosures_read` `idx_recommendations_read`).
- 시계열 키 컬럼은 `base_date`(레버리지·대차·공매도·추천) 또는 `date`(스냅샷·컨센서스), 수집 시각은 `fetched_at`, 갱신은 `updated_at`, 생성은 `created_at`.
- 마이그레이션 DDL은 반드시 idempotent(`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).

### 7.7 ADR·forge 산출물
- `.forge/adr/<NNNN>-<kebab-slug>.md`(4자리 0패딩, 번호 재사용 금지, 은퇴는 `retired/`로 이동).
- UAT 캡처 디렉터리는 저장소 루트에 `screenshots-uat<N>/`(변형 접미사 허용: `-live`, `-fix`).

---

## 8. 빠른 색인

| 찾는 것 | 파일 |
|---|---|
| 앱 진입점·라우터 마운트·기동 마이그레이션 | `backend/main.py` |
| 인증 의존성 | `backend/auth.py` |
| DB 커넥션 풀·query/execute | `backend/services/db.py` |
| 인메모리 캐시 10종·팬아웃 무효화 | `backend/services/cache.py` |
| `market_cache` 읽기/쓰기·증분 머지 | `backend/services/market_indicators/cache.py` |
| 배치 목록·메타데이터 | `backend/services/batch_registry.py` |
| 배치 잡 함수·`_JOB_FUNCS` | `backend/scheduler/jobs.py` |
| 스케줄 등록·시드·누락복구 | `backend/scheduler/schedule.py` |
| 배치 실행로그 | `backend/services/job_runs.py` |
| 포트폴리오 저장소 | `backend/services/storage/portfolio.py` |
| 종목명 이중 저장소 동기화 | `backend/services/storage/names.py` |
| 시장별 기대 리포트 날짜 | `backend/services/storage/dates.py` |
| KR 시세 체인 | `backend/services/market/kr.py` |
| 리포트 스냅샷 생성·백필 | `backend/services/report_generator.py` |
| 대시보드 카드 빌드 | `backend/routers/stocks.py` (`_build_all`/`_build_card`/`_usdkrw_rate`) |
| 스키마 정본 | `backend/auth_schema.sql` → `backend/app_schema.sql` |
| 프론트 라우트 정의 | `frontend/src/App.jsx` (`AppShell`) |
| 구 URL 리다이렉트 | `frontend/src/routes.js` |
| PC 내비 목록 | `frontend/src/components/Masthead.jsx` (`SECTIONS`) |
| 모바일 seg 탭 목록 | `frontend/src/pages/ResearchShell.jsx` (`RESEARCH_TABS`/`SCHEDULE_TABS`) |
| 모바일 하단 탭바 | `frontend/src/components/MobileNav.jsx` (`ALL_TABS`/`RESEARCH_PATHS`) |
| axios 인스턴스·401 처리 | `frontend/src/api.js` |
| 디자인 토큰 | `frontend/src/styles/tokens.css` |
| 액션 버튼 게이트 | `frontend/src/components/reports/StockActions.jsx` |
| PWA·청크·dev 프록시 | `frontend/vite.config.js` |
| 테스트 DB 차단 가드 | `backend/tests/conftest.py` (`_block_real_db`) |

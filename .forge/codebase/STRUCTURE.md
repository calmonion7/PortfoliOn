---
last_mapped_commit: 2a5e4ac00e4ef9ca7421a0958a64e60cd8a3dd2b
mapped: 2026-07-18
---

# STRUCTURE

프로젝트 루트: `/Users/calmonion/Project/PortfoliOn`. 최상위는 `backend/`(FastAPI), `frontend/`(React SPA), 배포 관련(`docker-compose.yml`·`deploy.sh`·`nginx/`·`certbot/`), 문서(`API_SPEC.md`·`CLAUDE_COWORK_API.md`·`README.md`·`KIWOOM_API.md`·`KIS_API.md`·`docs/`), forge 상태(`.forge/`), 운영 스크립트(`scripts/`)로 구성된다.

**이번 매핑 갱신 범위**: 이전 매핑(커밋 `8e37e2c`) 이후 `task#190~195`(ADR-0026, 에디토리얼 매거진 전면개편)로 `frontend/src/` 배치가 바뀌었다. `backend/` 레이아웃은 이 구간 파일 변경 0(`git diff --stat 8e37e2c..HEAD -- backend/` 확인)이라 이전 매핑 그대로.

**추가 갱신(2026-07-18, 커밋 `2a5e4ac`까지)**: `task#198~199`로 `frontend/src/glossary/`(신규 디렉터리)와 `components/Glossary.jsx`/`Glossary.css`(신규 파일)가 추가됐다. 나머지 배치는 무변경.

## 최상위 트리

```
PortfoliOn/
├── backend/            FastAPI 앱 (Python)
├── frontend/           React 19 + Vite SPA
├── scripts/            운영/UAT 스크립트 (Playwright .mjs, python probe 등, gitignored 다수)
├── nginx/              nginx.conf
├── certbot/             HTTPS 인증서 (conf/www)
├── supabase/            레거시 잔재 (.temp/ 링크 메타만 — Supabase는 제거됨)
├── docs/                프로젝트 문서
├── .forge/              forge 루프 상태 (adr/backlog/done/executed/quick/retro/codebase + CONTEXT.md)
├── .github/workflows/   deploy.yml (self-hosted 러너 배포)
├── docker-compose.yml   4-컨테이너 (postgres/backend/nginx/certbot)
├── deploy.sh            정식 배포 스크립트
├── start.sh/start.bat   로컬 양 서버 기동
├── API_SPEC.md          전체 REST 레퍼런스 (엔드포인트 정본)
├── CLAUDE_COWORK_API.md 외부 Cowork enrich API
├── KIWOOM_API.md / KIS_API.md 외부 API 카탈로그
└── README.md / CLAUDE.md
```

## backend/ 레이아웃 (이전 매핑 유지 — 이 구간 무변경)

```
backend/
├── main.py             앱 엔트리 (lifespan·_migrate·_configure_logging·include_router)
├── auth.py             인증 Depends 정본 (get_current_user·require_admin 등)
├── requirements.txt    Python 의존성
├── Dockerfile          backend 이미지 빌드
├── auth_schema.sql     인증 스키마 (users·refresh_tokens) — app_schema보다 먼저 실행
├── app_schema.sql      앱 스키마 (tickers·user_stocks·snapshots·market_cache 등)
├── supabase_schema.sql 레거시 (read-only)
├── run_backfill.py     백필 스크립트
├── migrations/         001_user_events.sql·002_backlog_history.sql (참고용; 라이브는 main._migrate)
├── routers/            HTTP 계층 — 18개 라우터 (아래)
├── services/           비즈니스/데이터 계층 (아래)
├── scheduler/          APScheduler 배치 패키지 (services 아님, 루트 레벨)
├── middleware/          __init__.py·event_tracker.py (EventTrackerMiddleware)
├── data/                정적 참조 + 로컬 파일 캐시 (아래)
├── snapshots/           per-ticker/date 리포트 JSON (gitignored)
├── reports/             레거시 리포트 디렉터리 (read-only 폴백)
├── tests/               pytest 스위트 (conftest.py + test_*.py 다수, fixtures/)
├── scripts/             (현재 비어 있음)
└── .venv/               로컬 가상환경 (macOS: .venv/bin/python)
```

### backend/routers/

파일당 `APIRouter(prefix=...)` 하나. `admin.py`·`analysis.py`·`analytics.py`·`auth.py`·`batches.py`·`calendar.py`·`digest.py`·`events.py`·`guru.py`·`investor.py`·`market_indicators.py`·`portfolio.py`·`rankings.py`·`recommendations.py`·`report.py`·`short_sell.py`·`stocks.py`·`watchlist.py`. `market_indicators.py`는 `from routers.market_indicators import router as market_indicators_router`로 마운트(파일명≠변수명 케이스). `__init__.py` 존재.

접두사 규칙: 도메인 전용은 명시 prefix(`/api/stocks`·`/api/portfolio`·`/api/admin`·`/api/auth`·`/api/guru`·`/api/analysis`·`/api/analytics`·`/api/events`·`/api/watchlist`·`/api/market`·`/api/recommendations`), 나머지는 `/api`(report·calendar·digest·rankings·investor·short_sell·batches)에 개별 경로.

### backend/services/

**단일 모듈**(`*.py`): `db.py`(PostgreSQL 풀·query/execute), `cache.py`(TTL/LRU), `utils.py`(sanitize·today_kst), `job_runs.py`, `parallel.py`, `progress.py`, `errors.py`, `schedule_spec.py`, `batch_registry.py`(BATCHES 29개 메타), `report_generator.py`, `consensus.py`·`consensus_pipeline.py`, `digest_service.py`, `backlog.py`·`backlog_parser.py`, `disclosures.py`·`agm.py`, `dividends.py`·`beta.py`·`insider_trades.py`·`us_supply.py`, `investor_service.py`·`short_sell_service.py`·`supply_score.py`, `ranking_service.py`·`kr_sector_service.py`·`us_sector_service.py`, `leverage_service.py`·`lending_service.py`, `analysis_service.py`, `exposure.py`·`rebalance.py`, `guru_scraper.py`·`guru_stats.py`·`scraper.py`, `indicators.py`, `auth_service.py`.

**패키지**(디렉터리 + `__init__.py` re-export, ADR-0017):
- `storage/` — `portfolio.py`·`names.py`·`schedule.py`·`dates.py`
- `market/` — `format.py`·`kr.py`·`us.py`
- `market_indicators/` — `cache.py`·`fx.py`·`commodities.py`·`earnings.py`·`econ.py`·`exports.py`·`macro.py`·`indices.py`·`kospi_signal.py`·`kospi_futures.py`·`sentiment.py`
- `kiwoom/` — `client.py`·`quote.py`·`chart.py`·`investor.py`·`sector.py`·`shortsell.py`
- `kis/` — `client.py`·`quote.py`·`futures.py`
- `recommendation/` — `funnel.py`·`scoring.py`·`store.py`·`universe.py`·`actions.py`

### backend/scheduler/

`__init__.py`(잡 배선·`start`/`stop`/`reload`)·`jobs.py`(잡 함수 + `_JOB_FUNCS` 28개)·`schedule.py`(트리거·리스케줄·시드·누락복구)·`_state.py`(`_scheduler`·상수). 배치 메타는 `services/batch_registry.py`에 분리.

### backend/data/

정적 참조: `sp500_tickers.json`·`kospi_tickers.json`. 레거시 JSON(런타임은 DB): `holdings.json`·`stocks.json`·`watchlist.json`·`schedule.json`·`guru_managers.json`·`guru_schedule.json`·`kr_exports.json`. 로컬 파일 캐시(gitignored): `consensus/`(per-ticker), `calendar/`, `digest/`.

## frontend/ 레이아웃

```
frontend/
├── index.html          Vite 엔트리 (Google Fonts CDN: Inter + Noto Serif KR)
├── vite.config.js      rolldown manualChunks(함수형) + /api proxy + sw-cache-bust(outDir 인지, task#191)
├── eslint.config.js
├── package.json        React 19·react-router-dom 7·axios·recharts / vite 8·vitest·vite-plugin-pwa (에디토리얼 개편 구간 의존성 변경 없음)
├── vercel.json          레거시 (배포는 nginx)
├── dist/                빌드 산출물 (nginx가 서빙)
└── src/
    ├── App.jsx         라우터·프로바이더·레이아웃(AppShell, 라우트 전환 opacity 페이드)
    ├── api.js          axios 인스턴스 (토큰 인터셉터·401 처리)
    ├── App.css / main.jsx
    ├── pages/          라우트 대상 화면 컴포넌트
    ├── components/     재사용 컴포넌트 (도메인별 하위 디렉터리 + sketches/) + Glossary.jsx/.css(신규)
    ├── glossary/       주식 용어집 정본 (신규, task#198) — terms.js·match.js·match.test.js
    ├── hooks/          커스텀 훅 (+ 신규 useReveal.js·useCountUp.js)
    ├── contexts/       AuthContext.jsx
    ├── utils/          analytics·marketHours·priceFlash·pwa
    ├── styles/         tokens.css·pc.css·mobile.css·motion.css(신규)
    ├── assets/
    └── test/           테스트 setup + 화면/회귀 테스트
```

### frontend/src/pages/

허브/셸: `ResearchShell.jsx`(리서치+일정·인컴 탭 래퍼 — PC는 마스트헤드가 nav를 대신하므로 `page-head` 없이 children만 렌더), `MarketHub.jsx`(시장지표/수급지표). 화면: `Portfolio.jsx`·`Reports.jsx`·`Recommendations.jsx`·`Ranking.jsx`·`Compare.jsx`·`Calendar.jsx`·`Dividends.jsx`·`Digest.jsx`·`Market.jsx`·`Analytics.jsx`·`Guru.jsx`(+`GuruManagers`·`GuruStats`·`GuruCrawlNow`)·`Settings.jsx`·`LoginPage.jsx`(+`LoginPage.css`)·`AdminAnalytics.jsx`·`Showcase.jsx`(`/dev/showcase` — 디자인 시스템 데모: Button/Card/Badge/Stat + 신규 스케치·`useReveal`·`useCountUp` 데모). 탭 컴포넌트: `SectorTab.jsx`·`MacroTab.jsx`·`ExposureTab.jsx`·`RebalanceTab.jsx`. 설정 화면: `ConsensusSettings.jsx`·`LeverageBackfillSettings.jsx`·`ReportManualGen.jsx`.

### frontend/src/components/

최상위 공용: `Masthead.jsx`(+`Masthead.css`, 신규 — PC 상단 마스트헤드, `Sidebar.jsx`/`Sidebar.css` 대체·삭제)·`MobileNav.jsx`·`MobileTopActions.jsx`·`GlobalSearch.jsx`·`StockSearchBox.jsx`·`StockModal.jsx`·`PromoteModal.jsx`·`PermissionManager.jsx`·`PermissionPanel.jsx`·`Toast.jsx`·`InstallPrompt.jsx`·`LoadingSpinner.jsx`·`BatchScheduleEditor.jsx`·`Glossary.jsx`(+`Glossary.css`, 신규 task#198 — 클릭 용어 팝오버·자유텍스트 자동매칭·recharts 범례 어댑터).

도메인 하위 디렉터리:
- `market/` — 지표 섹션들(`FxSection`·`VixSection`·`CommoditiesSection`·`TreasurySection`·`EconIndicatorsSection`·`M7EarningsSection`·`KrTop2Section`·`KrExportsSection`·`LeverageSection`·`LendingSection`·`IndexSection`·`MacroSignalsSection`·`FearGreedSection`·`KospiSignalSection`·`KospiFuturesSection`) + `marketUtils.jsx`
- `reports/` — `StockCard`·`TickerListItem`·`StockActions`(카드/리스트 공용 액션)·`ConsensusChart`·`FinancialsChart`·`BacklogChart`·`KeyResourceChart`·`ReportDetailHeader`·`ReportDetailTabs`·`DetailTab`·`HistoryTab`·`Sections`·`ReportFilters`·각종 Section(공시·내부자·수급·공매도·구루) + `reportUtils.jsx`
- `portfolio/` — `DashboardCard`·`FlashValue`·`PriceFreshness`
- `ui/` — `Badge`·`Button`·`Card`·`Stat`·`Input`·`Skeleton`·`SupplyBadge`·`InsiderBadge`·`icons.jsx` + `index.js` barrel
- `recommendations/` — `RecCard`
- **`sketches/`(신규, task#190, ADR-0026)** — 손그림 잉크 선화 SVG 컴포넌트. 카테고리 아이콘 `IconResearch`·`IconPortfolio`·`IconMarket`·`IconCalendarIncome`·`IconGuru`(Masthead 5섹션 1:1 대응), 빈상태/에러 `SketchEmpty`·`SketchError`·`SketchNotFound`·`SketchHero`, 장식 `SketchUnderline`·`SketchArrowUp`·`SketchCircleMark`. `index.js`가 barrel re-export. 각 SVG `<path>`는 `className="sk-path"`로 `styles/motion.css`의 드로잉 애니메이션과 짝.

### frontend/src/glossary/(신규, task#198~199)

`components/`가 아니라 `src/` 형제 디렉터리 — 정적 데이터 + 순수함수만 담고 UI는 없음(소비 UI는 `components/Glossary.jsx`).

- `terms.js` — `GLOSSARY` 배열(95개 항목, `{term, def, aliases?}`) + `findTerm(key)` 조회. 기술적 지표·밸류에이션/재무·컨센서스·수급·기업 이벤트/기본·거시/시장 6카테고리.
- `match.js` — `matchTerms(text)` — longest-match 우선·용어당 첫 등장만 매칭하는 자유텍스트 세그먼트 분할 순수함수.
- `match.test.js` — vitest, `matchTerms` 매칭 규칙(경계·중복·alias) + `GLOSSARY` 데이터 무결성 검증.

### frontend/src/hooks/

`usePortfolioData.js`·`useReportList.js`·`useAuth.js`·`useIsMobile.js`·`usePriceFlash.js`·`useReportFilters.js`·`useReportGeneration.js`·`useStockManagement.js`·`useTheme.js`(라이트가 신규 기본값). `*.test.js`가 병치(usePortfolioData·useReportFilters·useStockManagement). **신규(task#190)**: `useReveal.js`(IntersectionObserver 1회성 `is-visible` 부여)·`useCountUp.js`(숫자 0→값 1회 rAF 보간, `duration` 옵션).

### frontend/src/styles/

`tokens.css`(라이트 기본 종이/잉크 팔레트 + `[data-theme="dark"]` 야간 인쇄본 오버라이드, `--font-serif` 제목 전용 토큰 추가)·`pc.css`(사이드바 레이아웃 제거 → 세로 flex, `.util-bar`/`.settings-grid` 등 구 골격 CSS 정리)·`mobile.css`(스킨만 갱신)·**`motion.css`(신규, task#190)** — `.anim-fade-up`·`.anim-fade`(라우트 래퍼 전용, transform 없음)·`.anim-stagger`·`.reveal`·`.sketch-draw`, `prefers-reduced-motion` 전면 대응.

### frontend/src/test/

화면·회귀 테스트가 병치: `masthead.test.jsx`(신규, task#191 — 권한별 카테고리 노출·admin 링크·loading 상태 검증, 구 `sidebar.test.jsx`는 삭제), `route-redirects.test.jsx`, `compare-race.test.jsx`, `compare-sector-group.test.jsx`, `global-search-tracked.test.jsx`, `recommendations-s3s4.test.jsx`, `smoke.test.js`, `setup.js`.

## 명명 규칙

- **백엔드**: 라우터/서비스 모두 snake_case `.py`. 패키지는 디렉터리+`__init__.py`가 서브모듈 심볼을 re-export해 `services.X` 속성 접근 표면을 보존(ADR-0017). private/외부참조 심볼은 언더스코어 접두사 + 명시 re-export. 로그 마커는 `[Component]` PascalCase(개념당 1스펠링). 배치 job_id는 kebab 아닌 snake(`daily_report_kr`), 시장 분리 배치는 `_kr`/`_us` 접미사.
- **프론트**: 컴포넌트/페이지 PascalCase `.jsx`, 훅 `useXxx.js`, 유틸 camelCase `.js`. CSS는 컴포넌트 병치(`X.jsx` + `X.css`) 또는 `styles/`(토큰·pc·mobile·motion). 테스트는 `*.test.js(x)` 병치. plain CSS(TailwindCSS·모션 라이브러리 없음), 색/간격/모션 토큰은 `styles/tokens.css`·`styles/motion.css`. 스케치 SVG는 `Sketch*`(장식/빈상태/에러) vs `Icon*`(카테고리 아이콘) 접두사로 구분, `components/sketches/index.js` barrel을 통해서만 import. 정적 도메인 데이터(용어집 등)는 `components/`가 아니라 `src/` 최상위 형제 디렉터리(`glossary/`)로 분리하고 소비 컴포넌트만 `Glossary*` 접두사로 `components/`에 둠.
- **테스트**: `backend/tests/test_<대상>.py`. `conftest.py`가 `_block_real_db` autouse 가드로 실 DB 접근 차단(DB 경유 테스트는 `services.db` mock 필수). 도큐먼트 동기 검증: `test_api_doc_sync.py`(엔드포인트 존재 ↔ 두 명세서).

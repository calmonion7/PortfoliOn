---
last_mapped_commit: 2a5e4ac00e4ef9ca7421a0958a64e60cd8a3dd2b
mapped: 2026-07-18
---

# ARCHITECTURE

PortfoliOn은 **FastAPI 백엔드 + React SPA 프론트엔드**의 2티어 구조이며, Mac 로컬 Docker 4-컨테이너(postgres/backend/nginx/certbot)로 배포된다. 백엔드는 고전적 **라우터 → 서비스 → DB/외부소스** 계층형이고, 배치 스케줄러가 별도 패키지로 상주해 외부 데이터를 사전계산해 DB에 적재한다. 프론트는 React Router 기반 SPA로, 요청은 전부 nginx `/api/*` 프록시를 거쳐 백엔드로 간다.

**이번 매핑 갱신 범위**: 이전 매핑(커밋 `8e37e2c`) 이후 `task#190~195`(ADR-0026)로 프론트엔드 디자인 아이덴티티가 "프로 금융 터미널(다크 기본 + 좌측 사이드바, ADR-0025)"에서 "에디토리얼 매거진(라이트 기본 + 상단 마스트헤드)"로 전면 교체됐다. **백엔드는 이 구간에 파일 변경 0**(`git diff --stat 8e37e2c..HEAD -- backend/` 빈 결과로 확인) — 아래 Backend 절은 이전 매핑 그대로다. Frontend 절만 현행화.

**추가 갱신(2026-07-18, 커밋 `2a5e4ac`까지)**: `task#198~199`로 프론트에 **주식 용어집(Glossary) 모듈**이 신설됐다 — 리포트 본문·차트 범례에 나오는 전문용어를 클릭하면 정의 팝오버가 뜨는 기능. 순수 프론트 정적 데이터 + UI 컴포넌트라 **백엔드 변경 없음**. 아래 Frontend 절의 "용어집" 소절에 반영.

## 아키텍처 패턴 개요

- **패턴**: 계층형(Layered) + 배치 사전계산(precompute-to-store). 요청 경로는 저장값만 읽고(라이브 외부 호출 최소화), 스케줄러 배치가 외부 API를 호출해 DB/`market_cache`에 적재한다.
- **저장소**: Docker PostgreSQL 16이 정본. 로컬 JSON 파일은 런타임 캐시 용도(`backend/data/`).
- **인증**: HS256 JWT(access + refresh). 프론트는 localStorage 토큰을 axios 인터셉터로 실어 보내고, 백엔드는 `backend/auth.py`의 `Depends`(`get_current_user`/`require_admin`/`require_admin_or_api_key`)로 게이팅한다.
- **외부 데이터 소스**: yfinance, Naver, 키움(REST), KIS(한국투자증권 REST), DART, FRED, KOFIA/금융위, 관세청/UN Comtrade, dataroma, FnGuide/Finviz.

## Backend 계층 (이전 매핑 유지 — 이 구간 무변경)

### 앱 엔트리 — `backend/main.py`

임포트 시점에 `_configure_logging()`(L16-28)이 루트 로거를 1회 배선한다: `basicConfig(level=INFO)` + urllib3/yfinance/apscheduler/asyncio를 WARNING으로 억제 + uvicorn 로거 `propagate=False`(중복 emit 방지). config 부재 시 `logger.info`가 docker logs에 안 뜨던 문제 해소용.

앱 객체는 `app = FastAPI(title=..., lifespan=lifespan)`(L214). `lifespan`(L205-211) 순서:
1. `_migrate()` — 기동 idempotent 마이그레이션. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` DDL만(신규 컬럼/테이블은 `app_schema.sql`과 이 함수 **쌍으로** 추가해야 라이브 반영).
2. `sched.start()` — 스케줄러 기동.
3. `_warm_market_cache()`를 데몬 스레드로(econ/kr_exports 예열).
4. (종료 시) `sched.stop()`.

미들웨어(L216-225): `SessionMiddleware`(SESSION_SECRET) → `EventTrackerMiddleware`(`backend/middleware/event_tracker.py`) → `CORSMiddleware`(origins: localhost:3000/5173 + `FRONTEND_URL`).

라우터 마운트(L227-244): `include_router`로 18개 라우터 등록(auth, portfolio, report, watchlist, stocks, guru, calendar, digest, market_indicators, analytics, analysis, events, rankings, investor, short_sell, batches, recommendations, admin). `/health`(L247) GET/HEAD.

### 라우터 계층 — `backend/routers/`

각 라우터는 `APIRouter(prefix=...)`로 접두사를 갖고, 서비스만 호출한다(비즈니스 로직·SQL은 서비스에 위임). 인증은 `from auth import ...` `Depends`로 주입.

| 파일 | prefix | 역할 |
|------|--------|------|
| `auth.py` | `/api/auth` | 로그인/OAuth/토큰 |
| `portfolio.py` | `/api/portfolio` | 보유 목록·헤더·`/prices` 라이브 시세 |
| `watchlist.py` | `/api/watchlist` | 관심 종목 CRUD |
| `stocks.py` | `/api/stocks` | 종목 추가/수정/삭제·`/dashboard`(대시보드 카드+totals)·enrich·배당·수급 |
| `report.py` | `/api` | 리포트 목록/상세/생성·수주잔고·공시·주총·US supply |
| `guru.py` | `/api/guru` | 구루 관리자·크롤·통계 |
| `calendar.py` | `/api` | 캘린더 이벤트(`calendar_cache`) |
| `digest.py` | `/api` | 일일 다이제스트 |
| `market_indicators.py` | `/api/market` | FX/VIX/원자재/국채/경제지표/실적/수출/매크로/지수/F&G/선물 |
| `analytics.py` | `/api/analytics` | 상관관계 등 분석 |
| `analysis.py` | `/api/analysis` | 섹터 모멘텀·매크로 상관 |
| `events.py` | `/api/events` | 사용자 행동 이벤트 수집 |
| `rankings.py` | `/api` | 거래대금/거래량/등락률 랭킹 |
| `investor.py` | `/api` | 수급 추이 |
| `short_sell.py` | `/api` | 공매도 추이 |
| `batches.py` | `/api` | 배치 현황(`GET /api/batches`)·스케줄 편집 |
| `recommendations.py` | `/api/recommendations` | 추천 점수(발굴 유니버스) |
| `admin.py` | `/api/admin` | 관리자 전용(권한·배치 refresh·교차 사용자 삭제) |

인증 의존성 정본: `backend/auth.py` — `get_current_user`(L18), `get_current_user_or_api_key`(L37), `require_admin`(L61), `require_admin_or_api_key`(L68).

### 서비스 계층 — `backend/services/`

핵심 인프라:
- `db.py` — `psycopg2` `ThreadedConnectionPool`(minconn=1, **maxconn=20** — calendar 15·analysis 11 워커 초과 대비, PoolError 방지). `get_connection()` 컨텍스트매니저(commit/rollback/putconn), `query()`(RealDictCursor → dict 리스트), `execute()`(rowcount), `execute_many()`(execute_batch).
- `cache.py` — `TTLCache` 클래스 + 스냅샷 LRU(`_snapshots`, MAX=50) + list/dashboard/correlation TTL 캐시. `invalidate(ticker)`가 스냅샷·list·dashboard·correlation·sector·macro를 일괄 무효화.
- `utils.py` — `sanitize`(NaN/inf→None, 직렬화 500 안전망), `today_kst`.
- `job_runs.py` — 배치 실행 이력 기록(`record(id, lane)` 컨텍스트매니저, `job_runs` 테이블).
- `parallel.py`·`progress.py`·`errors.py`·`schedule_spec.py`(cron trigger kwargs 빌드).

패키지형 서비스(ADR-0017 표면 보존 re-export):
- `storage/` — `__init__.py`가 `portfolio.py`(user_stocks·tickers·enrich)·`names.py`(종목명 dual-source 동기화)·`schedule.py`(스케줄·구루·batch_schedules)·`dates.py`(시장별 기대 리포트 날짜)를 re-export.
- `market/` — `__init__.py`가 `format.py`(정규화·`_yf_sym`)·`kr.py`(키움→KIS→Naver 시세 체인, 다수결 corroboration)·`us.py`(yfinance→KIS)를 re-export. `get_quote()`는 TTL 캐시(regular 키 포함).
- `market_indicators/` — `__init__.py`가 서브모듈 facade: `fx.py`·`commodities.py`·`earnings.py`·`econ.py`·`exports.py`·`macro.py`·`kospi_signal.py`·`indices.py`·`sentiment.py`(F&G)·`kospi_futures.py`·`cache.py`(`_mc_load`/`_mc_save` = `market_cache` 테이블 R/W).
- `kiwoom/` — 키움 REST(KR 읽기전용 시세): `client.py`(토큰·요청)·`quote.py`·`chart.py`·`investor.py`·`sector.py`·`shortsell.py`.
- `kis/` — 한국투자증권 REST(KR+US 백업 시세): `client.py`·`quote.py`·`futures.py`.
- `recommendation/` — `funnel.py`(2단 깔때기)·`scoring.py`·`store.py`·`universe.py`·`actions.py`.

리포트/데이터 서비스: `report_generator.py`(`generate_report`·`generate_report_with_retry`·`backfill_ticker` — 시장 데이터 스냅샷 생성, **LLM 호출 없음**), `consensus.py`·`consensus_pipeline.py`, `digest_service.py`, `backlog.py`·`backlog_parser.py`(DART document.xml), `disclosures.py`·`agm.py`(DART), `dividends.py`, `beta.py`, `insider_trades.py`·`us_supply.py`, `investor_service.py`·`short_sell_service.py`·`supply_score.py`, `ranking_service.py`·`kr_sector_service.py`·`us_sector_service.py`, `leverage_service.py`·`lending_service.py`(KOFIA/금융위), `analysis_service.py`, `exposure.py`·`rebalance.py`, `guru_scraper.py`·`guru_stats.py`·`scraper.py`, `indicators.py`, `auth_service.py`.

### 스케줄러 패키지 — `backend/scheduler/`

`services`가 아닌 **루트 레벨 패키지**(단일 `scheduler.py` 아님):
- `__init__.py` — 잡 배선 + `start()`/`stop()`/`reload()`. `start()`는 `_seed_batch_schedules()` → 편집 배치별 `_reschedule_job()` → `_check_missed_report()` → 랭킹·KR/US 섹터 시드 → `_scheduler.start()`. 서브모듈 심볼을 명시 re-export(외부가 `scheduler.X` 속성 조회).
- `jobs.py` — 배치 잡 함수 전체 + `_JOB_FUNCS`(job_id → 함수 dict, 28개). 각 함수는 `with job_runs.record(id, "auto")`로 감싸 실행 이력 기록. 외부 fetch 실패는 로깅(silent except 금지), all-None/빈 결과 박제 금지 패턴. ThreadPool은 `max_workers ≤ 8`(DB 풀 초과 방지).
- `schedule.py` — `_build_trigger`(APScheduler CronTrigger)·`_reschedule_job`·`_seed_spec_for`·`_seed_batch_schedules`(기동 idempotent 마이그레이션)·`_check_missed_report[_for]`(시장별 당일 미생성 리포트 복구).
- `_state.py` — 공유 `_scheduler`(APScheduler 인스턴스)·상수(`_DIGEST_JOB_ID`·`_VALID_DAYS`).

`backend/services/batch_registry.py` — `BATCHES` 리스트(29개 배치의 정적 메타데이터: id/label/category/schedule_desc/usage/source/editable/trigger_kinds/manual_endpoint/timezone/market/default_schedule). `job_id`는 스케줄러 잡 id 및 `job_runs.record` id와 일치. `consensus`는 자체 스케줄러 잡 없음(`daily_report_kr/us`에 내장, `scheduler_job_id=None`). 일일 리포트/실적/월간은 시장별 분리(`_kr`/`_us`). `get_batch(job_id)` 조회.

### 요청 → 캐시 → DB → 외부소스 흐름

1. **요청 경로**(사용자 화면): 라우터 → 서비스 → 인메모리 캐시(`cache.py` TTL/LRU) 히트 시 반환, 미스 시 → `db.py`(PostgreSQL) 저장값 read. 배치-백킹 뷰(랭킹·섹터 모멘텀 등)는 요청 경로에서 라이브 외부 호출을 하지 않고 저장값만 읽는다.
2. **라이브 시세**: `get_quote`/`get_quotes_batch`는 종목 TTL 캐시로 외부 호출을 상한. KR은 키움→KIS→Naver 체인 + 독립 피드 다수결(corroboration).
3. **배치 경로**(스케줄러): `jobs.py` 잡 → 서비스 fetch(외부 API) → `market_cache`/도메인 테이블에 적재(`_mc_save`/upsert/replace). 실패 시 직전 양호값 보존.
4. **직렬화 안전망**: 시세/합산을 응답에 싣는 엔드포인트는 `services.utils.sanitize` 또는 소스 `math.isfinite` 가드로 NaN/inf→None(starlette `allow_nan=False` 직렬화 500 방지).

## Frontend 계층 (에디토리얼 매거진 재설계 반영, ADR-0026)

디자인 아이덴티티가 "터미널(다크 기본 + 좌측 Sidebar, ADR-0025)"에서 "에디토리얼(라이트 기본 + 상단 Masthead, ADR-0026)"로 교체됐다. **라우트 경로·React Router 트리·컴포넌트 계층 구조·API 레이어·훅은 그대로**이고, 교체 대상은 표시 스킨(골격 컴포넌트·CSS 토큰·모션·아이콘)에 국한된다. `Sidebar.jsx`/`Sidebar.css`는 삭제됐고 `Masthead.jsx`/`Masthead.css`가 그 IA(정보구조)를 그대로 이식했다.

### 엔트리 & 라우팅 — `frontend/src/App.jsx`

`ToastProvider` → `AuthProvider` → `BrowserRouter` → `AppShell` 중첩(구조 무변). 초기 `useEffect`가 URL의 OAuth `code`/`token`/`refresh`를 처리해 localStorage에 토큰 저장. 미로그인 시 `<LoginPage>`.

`AppShell`(L54-104, `useLocation` 필요해 Router 내부 함수로 분리): `.app-pc`(세로 flex, 사이드바 폐지로 `display:flex` 단일 컬럼) 안에 `<Masthead>`(PC) + `.app-main`(`mobile-header` + `<main class="page-wrap">` + `<MobileNav>`)를 렌더. **라우트 전환 페이드**: `<div key={location.pathname} className="anim-fade">`로 `<Routes>`를 감싸 pathname이 바뀔 때마다 리마운트+페이드(`styles/motion.css`). 라우트 목록(L79-96)은 이전 매핑과 **완전히 동일**(`/` → `/reports` 리다이렉트, `/reports`·`/recommend`·`/ranking`·`/compare`·`/calendar`·`/dividends`·`/digest` → `<ResearchShell>`, `/portfolio`, `/market` → `/market/indicators`, `/market/indicators`·`/market/flow` → `<MarketHub tab=...>`, `/analysis` → `/portfolio`, `/guru`, `/settings`, `/admin-analytics`, `/dev/showcase`).

**gotcha(task#195)**: 라우트 래퍼 애니메이션은 `transform`을 쓰지 않는 `.anim-fade`(opacity만)여야 한다. `transform` 애니메이션은 `animation-fill-mode: both`로 종료 후에도 computed matrix가 남아 그 자손 중 `position: fixed` 요소(토스트·FAB·모달)의 containing block을 래퍼 자신으로 바꿔버려 화면에 고정되지 못하고 스크롤과 함께 흘러간다(CSS 스펙: transform이 있는 요소는 fixed 자손의 containing block이 됨). `styles/motion.css`의 `.anim-fade-up`(translateY 포함)은 이 함정 때문에 **라우트 래퍼가 아닌 하위 개별 요소용**으로만 쓴다.

### 허브 & 셸

- `pages/ResearchShell.jsx` — 리서치 7하위 라우트 공용 얇은 래퍼(구조 무변). `RESEARCH_TABS`(리포트/추천/랭킹/비교) + `SCHEDULE_TABS`(캘린더/배당/다이제스트). 모바일은 seg 필 nav 유지. **PC는 마스트헤드가 2행(카테고리)·3행(서브바)으로 이미 nav를 보여주므로 `page-head` 중복 없이 `children`만 `<div className="page">`로 렌더**(이전엔 Sidebar가 nav, ResearchShell이 PC page-head 표시 담당이었음 — 그 역할이 Masthead 3행 서브바로 이동).
- `pages/MarketHub.jsx` — `tab`("indicators"/"flow") prop을 받아 `<Market tab=...>`를 렌더(무변).
- `components/Masthead.jsx`(신규, `Sidebar.jsx` 대체) — `SECTIONS` 배열(research/portfolio/market/schedule/guru, 5섹션 IA는 Sidebar와 동일하게 이식) + 섹션당 `perm` 1개 + `sketches/Icon*` 컴포넌트. `useAuth().menuPermissions`로 카테고리 필터링, `role==='admin'`이면 `/admin-analytics` 링크 추가 노출(`GridIcon`, `/settings`는 `settings` 권한). 1행(제호+유틸: GlobalSearch·새로고침·테마·로그아웃) + 2행(가로 카테고리 nav, `position: sticky`) + 3행(활성 섹션 하위 항목 ≥2개일 때만 서브바). 2·3행을 감싸는 `.masthead-sticky`는 **`.masthead`(header)의 형제**로 둬 `.app-pc`(전체 페이지 높이)를 sticky containing block 삼는다(`.masthead` 자식이면 짧은 header 높이가 containing block이 돼 sticky가 slack 없이 static처럼 동작하는 함정, task#191 주석 명시).

### API 레이어 — `frontend/src/api.js`

axios 인스턴스(baseURL = `VITE_API_BASE_URL || ''`). 요청 인터셉터가 localStorage `access_token`을 `Authorization: Bearer`로 실음. 응답 인터셉터가 401 시 토큰 제거 + `/`로 리다이렉트. (무변)

### 훅 — `frontend/src/hooks/`

기존 훅(`usePortfolioData.js`·`useReportList.js`·`useAuth.js`·`useIsMobile.js`·`usePriceFlash.js`·`useReportFilters.js`·`useReportGeneration.js`·`useStockManagement.js`) 무변 + `useTheme.js`(라이트가 신규 기본값 — `localStorage.getItem('theme') ?? 'light'`, 이전엔 dark 기본).

**신규 모션 훅 2종**(task#190, ADR-0026 §5, CSS 우선 + 최소 JS):
- `useReveal.js` — `IntersectionObserver`로 대상 엘리먼트가 뷰포트에 1회 진입하면 `is-visible` 클래스를 부여하고 observer를 해제(`styles/motion.css` `.reveal`/`.reveal.is-visible`과 짝). `prefers-reduced-motion: reduce`면 관찰 없이 즉시 부여.
- `useCountUp.js` — 값이 처음 유효한 숫자로 도착했을 때만 0→값 `requestAnimationFrame` 보간(1회, `animatedOnce` ref로 이후 값 변경은 즉시 반영). `duration` 기본 800ms. reduced-motion이면 항상 즉시 반영.

둘 다 라이브러리 무의존(순수 React + DOM API) — `frontend/package.json`은 이 구간 변경 없음(모션 라이브러리 미도입, ADR-0026 결정대로).

### 컴포넌트 — `frontend/src/components/`

도메인별 하위 디렉터리 구조는 무변: `market/`·`reports/`·`portfolio/`·`ui/`·`recommendations/`. 최상위 공용 컴포넌트도 `Sidebar.jsx`/`Sidebar.css` 삭제 + `Masthead.jsx`/`Masthead.css` 추가 외엔 무변(`MobileNav.jsx`·`MobileTopActions.jsx`·`GlobalSearch.jsx`·`StockModal.jsx`·`PromoteModal.jsx`·`PermissionManager.jsx`/`Panel.jsx`·`Toast.jsx`·`InstallPrompt.jsx`). `MobileNav.jsx`는 골격 IA는 그대로(5섹션 mirror)이며 아이콘은 여전히 `ui/icons.jsx`의 `HomeIcon`/`SearchIcon`/`ChartIcon`/`GuruIcon`/`CalendarIcon`를 쓴다(스케치 아이콘은 마스트헤드 전용 — "모바일은 스킨만 교체"의 실제 범위는 CSS 토큰 재적용, 아이콘셋 전환은 아님).

**신규 `components/sketches/`**(task#190) — 손그림 잉크 선화 SVG, `index.js`가 barrel re-export:
- 카테고리 아이콘: `IconResearch`·`IconPortfolio`·`IconMarket`·`IconCalendarIncome`·`IconGuru` (Masthead 카테고리에 1:1 대응)
- 빈상태/에러: `SketchEmpty`·`SketchError`·`SketchNotFound`·`SketchHero`
- 장식: `SketchUnderline`·`SketchArrowUp`·`SketchCircleMark`

각 스케치는 SVG `<path>`에 `className="sk-path"`를 달아 `styles/motion.css`의 `.sketch-draw .sk-path`(stroke-dasharray/dashoffset 기반 드로잉 애니메이션, `nth-child` 순차 delay)와 짝을 이루는 관례.

`contexts/AuthContext.jsx`가 로그인 시 메뉴 권한·role을 로드(무변). `utils/`(analytics·marketHours·priceFlash·pwa, 무변), `styles/`(아래 절 참조).

### 용어집(Glossary) — `frontend/src/glossary/` + `components/Glossary.jsx`(task#198~199, 신규)

정적 주식 용어집 정본과 그 소비 UI. 백엔드 API 없음 — 전부 프론트 번들에 박제된 정적 데이터 + 순수함수 + React 컴포넌트.

- `glossary/terms.js` — `GLOSSARY` 배열(항목 95개, `{ term, def, aliases? }`). 기술적 지표·밸류에이션/재무·컨센서스·수급·기업 이벤트/기본·거시/시장 6개 카테고리로 그룹. `findTerm(key)`가 대표 표기(`term`) 또는 `aliases`로 항목을 찾는 `Map` 기반 조회 함수.
- `glossary/match.js` — `matchTerms(text)` 순수함수. 자유 텍스트에서 용어집 키를 찾아 `[{text, entry?}]` 세그먼트 배열로 분할한다. 규칙: ① **longest-match 우선**(키 길이 내림차순 정렬 후 스캔 — "공매도 비중"이 "공매도"보다 먼저 매칭), ② **텍스트당 entry(용어)별 첫 등장만** 매칭(같은 용어 반복 등장해도 1회만 하이라이트), ③ 이미 매칭된 구간과 겹치면 스킵, ④ **라틴 키(영숫자만)는 앞뒤 영숫자 경계 필수**("SUPER" 안의 "PER" 오매칭 방지), 한글 키는 순수 substring(조사가 자연히 흡수됨, 예: "매물대가"→"매물대"). `glossary/match.test.js`(vitest)가 이 규칙들 + `GLOSSARY` 데이터 무결성(항목≥50·키 중복 없음)을 검증.
- `components/Glossary.jsx` + `Glossary.css` — 소비 컴포넌트 4종:
  - `GlossaryTerm({ term, entry, children })` — 클릭 가능한 용어 버튼. 클릭 시 `GlossaryPopover` 토글. 용어집에 없는 키면 평문(`children`)만 렌더.
  - `GlossaryPopover` — `createPortal(document.body)` + `position: fixed` 뷰포트 좌표(앵커의 `getBoundingClientRect()` 기준 상/하 자동 배치) 팝오버. `z-index: 1100`(모달 오버레이 `z:1000`보다 위). **등장 모션은 `opacity`만**(task#195 규칙 — `.anim-fade`와 동일하게 `transform` 금지, fixed 후손의 containing block 오염 방지). 바깥 클릭·Escape·스크롤 시 닫힘이되, **열린 직후 400ms는 스크롤 이벤트를 닫힘이 아니라 위치 재계산으로 처리**(task#198 수정 — 화면 밖 단어를 탭하면 브라우저 포커스 스크롤이 열림 직후 발생해 즉시 닫혀버리던 버그의 유예창).
  - `GlossaryText({ text })` — 자유 텍스트를 `matchTerms`로 매칭해 인라인 `GlossaryTerm`으로 감싼 노드 배열 반환(매칭 없으면 원문 그대로).
  - `GlossaryRechartsLegend({ payload })` — recharts `<Legend content={...}>` 어댑터. 범례 항목 라벨을 `GlossaryText`로 감싸 용어 클릭을 지원.

**배선(task#198~199)**: reports 컴포넌트(`Sections.jsx`의 해자/성장계획/리스크/공시 등 자유 텍스트 전부 `GlossaryText`로 래핑, `DetailTab.jsx`의 지지/저항·목표가/상승여력/투자의견·POC/HVN/RSI/베타/EMA/골든·데드크로스 라벨을 `GlossaryTerm`으로, `FinancialsChart.jsx`는 기존 hover 전용 커스텀 범례 설명(`DESCS`/`hoveredLegend` state)을 제거하고 `GlossaryText` 클릭 팝오버로 대체 — 모바일 탭도 지원, `BacklogChart.jsx` 범례 라벨), market 컴포넌트 다수(`EconIndicatorsSection`·`IndexSection`·`KospiFuturesSection`·`KospiSignalSection`·`KrExportsSection`·`KrTop2Section`·`LendingSection`·`LeverageSection`·`M7EarningsSection`·`MacroSignalsSection`·`TreasurySection`에서 recharts `<Legend wrapperStyle=.../>` → `<Legend content={<GlossaryRechartsLegend />} />`로 스왑 + 라벨 `GlossaryText`), `pages/Analytics.jsx`(버블 산점도에 색-부호 범례 신설, `GlossaryText`로 라벨 매칭), `KospiSignalSection.jsx`(막대 셀 색-신호 범례 신설, 리액트 인라인 스타일 — 이건 용어집이 아니라 셀 색 자체의 범례).

새 의존성 없음(recharts 어댑터도 `Legend`의 `content` prop만 활용) — `package.json` 이 구간 변경 없음.

### 스타일·토큰 — `frontend/src/styles/`

- `tokens.css` — **라이트가 기본 테마**(`:root`, 종이/잉크 팔레트: `--bg #f6f1e7` 크림 종이, `--text #201b13` 웜 잉크, `--accent #1d5f58` 딥 틸), 다크는 `[data-theme="dark"]` 오버라이드("야간 인쇄본", 웜 다크 레이어)로 유지. `--font-serif: 'Noto Serif KR', ...`(제목 전용, 본문/데이터는 여전히 `--font-sans`). KR 가격색 관례(`--up`=빨강/`--down`=파랑) 유지, 채도만 잉크톤으로 재조율. 시맨틱 배지(`--tag-*`/`--cal-*`)·메달(`--medal-*`) 색도 종이 배경 AA 대비 기준으로 재산정.
- `motion.css`(신규, task#190) — `.anim-fade-up`(라우트 아닌 요소용 fade+translateY), `.anim-fade`(라우트 래퍼 전용, transform 없음), `.anim-stagger`(`nth-child` 기반 순차 delay, `--stagger-i` 변수), `.reveal`/`.reveal.is-visible`(useReveal 짝), `.sketch-draw .sk-path`(스케치 드로잉). 전체가 `@media (prefers-reduced-motion: reduce)`로 무력화되는 블록을 포함.
- `pc.css` — 좌측 사이드바 레이아웃(`.app-pc { display:flex }`) 제거 → 세로 flex(`flex-direction: column`)로 교체. `.util-bar`(구 상단 유틸바, Sidebar 시절 PC 전용) 삭제 — 그 역할은 Masthead 1행이 흡수. Settings 페이지의 좌측 nav 레이아웃(`.settings-grid`/`.settings-nav`/`.switch`/`.day-pill`)도 제거되고 단순 섹션 나열(`.settings-section`)로 재구성.
- `index.html`(`frontend/index.html`)이 Google Fonts CDN에서 `Inter`(400/500/600/700) + `Noto Serif KR`(600/700)을 `<link>`로 로드(프로젝트가 폰트 파일을 번들에 포함하지 않음 — 로컬 self-host 서브셋이 아니라 CDN 링크 방식).
- `mobile.css` — 스킨(색상 토큰 참조)만 갱신, 골격(seg 필 nav, tabbar) 무변.

### 프론트 기술 스택

React 19 + react-router-dom 7 + axios + recharts. Vite 8(**rolldown** 번들러 — `manualChunks`는 함수형만). vite-plugin-pwa. 개발 시 Vite가 `/api/*`를 `localhost:8000`으로 프록시. 배포 시 nginx가 `frontend/dist`를 직접 서빙(`:ro` 볼륨). **의존성 변경 없음**(`package.json` 이 구간 diff 0줄) — 에디토리얼 모션·스케치는 CSS + 순수 React 훅으로만 구현(ADR-0026이 명시적으로 모션 라이브러리 도입을 기각).

`vite.config.js`의 `sw-cache-bust` 플러그인(post-build HTML/registerSW.js 캐시버스팅)이 `configResolved`로 실제 `build.outDir`을 읽도록 수정됨(task#191 발견) — 이전엔 `'dist'` 하드코딩이라 `--outDir` 지정한 throwaway 검증 빌드도 라이브 `dist/index.html`을 오염시켰음.

## 배포 토폴로지

`docker-compose.yml` 4서비스: `postgres`(16-alpine, pgdata 볼륨, init SQL로 `auth_schema.sql`→`app_schema.sql`), `backend`(FastAPI 이미지, `.env.docker`), `nginx`(80/443, `frontend/dist` + `nginx.conf` + certbot 인증서 마운트), `certbot`(HTTPS 갱신 루프). Cloudflare Tunnel(cloudflared, launchd)이 외부 도메인을 localhost:80으로 연결. 자동 배포 = GitHub Actions self-hosted 러너(주) + 폴러(폴백). (이 구간 무변경)

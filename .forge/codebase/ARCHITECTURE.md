---
last_mapped_commit: 2bb05053ac83f6f74c1dddb595a4a6df6d2943dc
mapped: 2026-07-11
---

# ARCHITECTURE

PortfoliOn은 FastAPI 백엔드(포트 8000)와 React 19 + Vite 프론트엔드(포트 5173)로 구성되며, Mac 로컬 Docker 4-컨테이너(nginx / backend / postgres / certbot)로 배포된다. 데이터 정본은 Docker PostgreSQL 16이고, 로컬 JSON 파일(`backend/data/`)은 런타임 캐시/정적 참조로만 쓰인다.

## 전체 패턴

```
[React pages/hooks] --HTTP /api/*--> [nginx :80 proxy] --> [FastAPI routers]
                                                              |
                                        routers → services → PostgreSQL + 파일캐시
                                                              |
                              [APScheduler 패키지] → 배치 → tables/market_cache
```

핵심 계층은 3단이다.

1. **Router 계층** (`backend/routers/`) — HTTP 엔드포인트 정의, 인증 `Depends`(get_current_user/require_admin), 요청/응답 스키마. 비즈니스 로직은 services에 위임한다.
2. **Service 계층** (`backend/services/`) — 저장(storage), 외부 시세(market/kiwoom/kis), 지표 계산(indicators/consensus/…), 배치 작업 함수의 실체. 순수 로직·외부연동을 담당하고 라우터/스케줄러가 공유한다.
3. **영속 계층** — Docker PostgreSQL(`services/db.py`의 `ThreadedConnectionPool`, minconn=1/maxconn=20). 스키마는 `backend/auth_schema.sql` → `backend/app_schema.sql` 순 실행. 파일 캐시는 `backend/data/consensus/`·`backend/data/digest/` 및 `backend/snapshots/`(gitignored 폴백). 캘린더 라이브 캐시는 **PostgreSQL `calendar_cache` 테이블**(파일 캐시는 task#167에서 제거 — `backend/data/calendar/`는 코드가 참조하지 않는 dead 잔존물).

## 진입점

### 백엔드 — `backend/main.py`
- **`_configure_logging()`** — 모듈 import 시점(스케줄러/라우터 import 전) 1회 실행. `logging.basicConfig(level=INFO)` + urllib3/yfinance/apscheduler/asyncio는 WARNING 억제 + uvicorn 계열 `propagate=False`(중복 emit 방지). 앱 코드는 `print` 금지, 모듈 `logger` 통일(로깅 방출 규약 task#162/#163, `tests/test_no_print.py`가 단언).
- `app = FastAPI(..., lifespan=lifespan)` 생성. `lifespan`이 기동 시 순서대로: `_migrate()` → `sched.start()` → `_warm_market_cache()`(데몬 스레드).
- **`_migrate()`** — idempotent 기동 마이그레이션(ADR-0006). `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`로 라이브 DB에 신규 컬럼·테이블을 반영한다. `app_schema.sql`은 신규 설치용이라 라이브 DB엔 이 경로만 적용되므로, 신규 컬럼은 두 곳(스키마 파일 + `_migrate`)에 쌍으로 추가해야 한다. 현재 `_migrate`가 관리하는 것: `backlog_history.segments`, `batch_schedules`, `market_short_sell`, `stock_disclosures`(+`meeting_date`), `stock_dividends`, `stock_dividend_schedule`, `stock_beta`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`(+`low_liquidity`/`exchange`/`name`), `us_supply_snapshot`(+`insider_transactions`/`insider_net`), `user_stocks`(+`target_price`/`stop_price`/`target_weight`).
- 미들웨어: `SessionMiddleware`(SESSION_SECRET) → `EventTrackerMiddleware`(`backend/middleware/event_tracker.py`, user_events 로깅) → `CORSMiddleware`(localhost:3000/5173 + `FRONTEND_URL`).
- `include_router(...)` 18개 라우터 배선(auth·portfolio·report·watchlist·stocks·guru·calendar·digest·market_indicators·analytics·analysis·events·rankings·investor·short_sell·batches·recommendations·admin). `/health` GET/HEAD 헬스체크.

### 백엔드 — 스케줄러 패키지 `backend/scheduler/`
단일 `scheduler.py`가 **아니라 루트 레벨 패키지**다.
- `__init__.py` — 잡 배선. `start()`가 `_seed_batch_schedules()` → 편집가능 배치별 `_reschedule_job()` → `_check_missed_report()` → `_seed_rankings_if_empty()`/`_seed_kr_sector_if_empty()`/`_seed_us_sector_if_empty()` → `_scheduler.start()`. jobs/schedule/_state의 심볼을 모듈 속성으로 re-export(`scheduler.X`).
- `jobs.py` — 잡 함수 실체(`_fetch_*`, `_generate_*`, `_refresh_*`, `_seed_*`)와 `_JOB_FUNCS` 매핑. 각 잡은 `with job_runs.record(job_id, "auto"):`로 실행이력을 남긴다.
- `schedule.py` — `_build_trigger`(CronTrigger), `_reschedule_job`, `_seed_batch_schedules`, `_check_missed_report`. KST 시각 판정에 `ZoneInfo("Asia/Seoul")` 사용.
- `_state.py` — 공유 `_scheduler`(APScheduler) 인스턴스·상수(부분초기화 순환 회피용 leaf 모듈).

### 프론트엔드 — `frontend/src/App.jsx`
`BrowserRouter` 라우팅. **PC 골격은 좌측 사이드바 + `.app-main` 컬럼**(상단 가로 nav 폐지 — task#172, ADR-0025). `<div className="app-pc">` 안에 `<Sidebar />`(PC nav) + `<div className="app-main">`이 나란히 놓이고, `app-main`은 `.util-bar`(PC 검색/새로고침/테마/로그아웃) + `.mobile-header`(모바일 브랜드·검색·테마·로그아웃) + `.page-wrap`(라우트 콘텐츠) + `<MobileNav />`(모바일 하단탭)으로 구성된다.

라우트 → 페이지 매핑(개별 URL 라우트로 승격):
- **리서치 그룹** — 각 라우트가 `<ResearchShell>`로 감싼 개별 페이지를 렌더한다: `/reports`(기본)·`/recommend`·`/ranking`·`/compare`·`/calendar`·`/dividends`·`/digest`. 구 URL `/`·`/research`는 `/reports`로 `<Navigate replace>` 리다이렉트.
- `/portfolio` → **Portfolio**(`pages/Portfolio.jsx`) — 대시보드 탭 + 분석 탭(섹터/매크로/상관/리밸런스/노출 하위탭). 구 `/analysis`는 `/portfolio`로 리다이렉트.
- `/market/indicators`(시장지표)·`/market/flow`(수급지표) → **MarketHub**(`pages/MarketHub.jsx`, `tab` prop 전달 → `Market.jsx`). 구 `/market`는 `/market/indicators`로 리다이렉트.
- 그 외: `/guru`, `/settings`, `/admin-analytics`, `/dev/showcase`.
- **딥링크 규약(task#131)**: `App.jsx`의 로컬 `ReportsRoute` 컴포넌트가 `location.state.ticker`를 읽어 `<Reports initialTicker>`로 전달(같은 라우트 재네비게이션도 `useEffect`로 반영). 소비처 `components/GlobalSearch.jsx`·`pages/Recommendations.jsx`가 `navigate('/reports', { state: { ticker } })`로 점프.
- `contexts/AuthContext.jsx`가 로그인·권한(user_menu_permissions)·role을 로드해 nav를 필터링(`{ role, menuPermissions, loading }` 제공). `api.js`(axios)가 Bearer 토큰 주입 + 401 시 로그아웃 리다이렉트.

### 프론트엔드 — 네비게이션 골격 (task#172, ADR-0025)
- **PC 사이드바** (`components/Sidebar.jsx` + `Sidebar.css`) — 5섹션(리서치/포트폴리오/시장/일정·인컴/구루) + 하단(설정·admin 행동). 섹션은 `SECTIONS` 배열로 선언(섹션당 `perm` 1개). 단일항목 섹션은 헤더=링크(`NavLink`), 다항목 섹션은 그룹 헤더 + 하위 `NavLink` 목록. **접기/펼치기** 상태는 `localStorage('sidebar_collapsed')` 영속(축소 시 아이콘만 표시, 활성 하위경로면 하이라이트). 권한 게이팅은 `useAuth().menuPermissions.includes(section.perm)` — 일정·인컴 섹션은 `research` 권한에 매핑(ALL_MENUS 5키 불변). 하단 설정은 `settings` 권한, admin 행동(`/admin-analytics`)은 `role === 'admin'`.
- **모바일 하단탭** (`components/MobileNav.jsx`) — 5탭(리서치→`/reports`·포트폴리오·시장→`/market/indicators`·구루·설정) + admin 행동. 활성표시는 `NavLink` 정확매칭이 아니라 `location.pathname` **prefix 매칭**(`RESEARCH_PATHS` 그룹 중 하나로 시작하면 리서치 탭 활성, `/market/*`면 시장 탭 활성).
- **리서치 하위탭** (`pages/ResearchShell.jsx`) — 7개 리서치 라우트를 감싸는 얇은 래퍼. PC에선 `.page` 컨테이너 + 제목만(사이드바가 nav 담당). 모바일에선 7항목 `.seg` 필 서브nav를 `NavLink`로 렌더(동선 보존). `children`으로 라우트별 실제 탭 컴포넌트를 렌더.
- **시장 서브탭** (`pages/MarketHub.jsx`) — PC는 제목 + `<Market tab>`. 모바일은 2항목(시장지표/수급지표) `.seg` 필 서브nav를 `/market/indicators`·`/market/flow` 라우트 네비게이션으로 렌더. `Market.jsx`는 내부 탭 상태 없이 `tab` prop(`'indicators'|'flow'`)만 받아 섹션을 조립.

## 데이터 흐름 패턴

### 배치-백킹 패턴 (핵심)
외부 API(키움·KIS·FRED·DART·KOFIA 등)를 **요청/기동 경로에서 라이브 호출하지 않는다.** 대신 스케줄러 배치가 사전계산해 테이블 또는 `market_cache`에 저장하고, **요청은 저장값만 읽는다.**
- 배치 함수: `scheduler/jobs.py`의 `_fetch_*`가 서비스를 호출해 결과를 upsert.
- 저장소: 지표류는 `market_cache`(`services/market_indicators/cache.py`의 `_mc_load`/`_mc_save`), 나머지는 전용 테이블(`market_leverage_indicators`, `stock_recommendations`, `daily_consensus_mart` 등).
- 읽기: 라우터가 저장 테이블/캐시만 SELECT → 요청당 외부호출 0, 수초 지연 없음.
- 실패 처리 규율: 빈/all-None 결과를 캐시에 박제 금지(직전 양호값 유지), delete-rewrite store는 fetch 실패 시 DELETE 자체를 스킵(task#160), 외부 fetch 실패는 로깅(silent except 금지). 기동 시 빈 캐시는 `_seed_*_if_empty`로 적재.
- 레지스트리: `services/batch_registry.py`의 `BATCHES`(현재 29개 항목)가 각 배치의 정적 메타(`id`·`market`(KR/US/공통)·`source`·`usage`·`default_schedule`)를 정의하고 `GET /api/batches`로 노출. `job_id`는 스케줄러 잡 id 및 `job_runs.record` 호출 id와 반드시 일치.
- 단, fx/vix/commodities/indices 등 일부 시장지표는 배치 없이 **요청경로 증분 fetch**(TTL캐시→`_mc_load`→라이브 fetch→`_mc_save`+폴백) 패턴을 쓴다. 이때도 "성공-but-빈응답"은 last-good에 박제 금지(값 수준 가드, task#157).

### 시세 소스 체인 (quote-source chain)
`services/market/__init__.py`의 `get_quote(ticker, market, exchange, regular, hist)`가 종목 단위 TTL 캐시(`cache.get_quote_cached`, 캐시 키에 `regular` 포함)를 씌우고 `_get_quote_uncached`로 위임.
- **KR**: 키움 → KIS → Naver 체인. `services/market/kr.py`의 `_kr_basic_kiwoom`(키움 ka10001) → `_kr_basic_kis`(KIS 국내) → `_kr_basic_naver`. 값 정규화 필수(시총 억원·부호포함 문자열).
- **US**: yfinance → KIS. `_get_quote_uncached`가 yfinance 우선, 예외/빈 시세면 `services/market/us.py`의 KIS 해외 백업, 그래도 없으면 none-quote.
- 근거: 키움=KR 전용 읽기전용 1차(ADR-0009), KIS=KR+US 읽기전용 백업(ADR-0011). 키 미설정이면 각 소스는 휴면(안전 기본값).
- 히스토리(`get_history_df`)도 동형: KR은 키움 일봉(ka10081) 우선 → yfinance 폴백, 그 외 yfinance.

### 리포트 스냅샷 vs 라이브 대시보드 — 시세 기준 이원화 (ADR-0020)
같은 KR 종목이라도 시세 기준이 두 갈래다. 분기점은 키움 코드선택 `client.integrated_code(stk_cd, regular=...)`.
- **리포트 스냅샷 = KRX 정규장** — `regular=True`. `services/report_generator.py`의 `generate_report`/`backfill_ticker`가 `get_quote`·`get_history_df`를 `regular=True`로 opt-in(평문 KRX 코드, 정규장 종가). 매물대/고점/RSI 타점이 정규장 종가와 스케일 일치.
- **라이브 대시보드 = NXT** — `regular=False`(기본). `_AL`(SOR 통합코드, NXT 시간외). `get_quotes_batch`·RSI·종목추가·`resolve_name`이 사용.
- 두 기준이 ~1% 다른 현재가를 보일 수 있는 건 의도된 설계. NXT `_AL` 순간 글리치는 라이브 경로에서 독립 피드 다수결(`_kr_pick_basic`→`_corroborated_pick`, 2-of-N corroborate)로 방어하고, 리포트 경로는 박제-시 독립피드 게이트(저장 직전 KRX와 독립 ref로 교차검증→어긋나면 스킵)로 방어한다.

### 캐시 계층 (`services/cache.py`)
인메모리 캐시 10종: snapshot(LRU, `_MAX=50`), list(TTL 60s, **user_id 키** — 리포트 목록 per-user, task#165), dashboard/correlation/sector/macro(TTL 300s; sector는 `user_id:market` 복합키), quote(TTL 60s, 키에 `regular` 포함), live_prices(TTL 15s — 장중 `/api/portfolio/prices` 폴링 상한), rebalance/exposure(TTL 300s — 요청경로 라이브 시세 반복호출 방지, task#166). 종목 추가/수정/삭제 시 `invalidate_portfolio_caches(user_id)`가 list·dashboard·sector·macro·correlation·live_prices·rebalance·exposure를 무효화하고 **`routers/calendar.clear_cache(user_id)`로 `calendar_cache` DB 행까지 삭제**한다(task#166).

## 주요 추상화

- **storage 패키지** (`services/storage/`) — 포트폴리오·종목·스케줄·이름의 DB 접근 파사드. 모든 심볼을 `__init__.py`에서 re-export(`storage.X` 모듈 속성 접근, ADR-0017).
- **market 패키지** (`services/market/`) — 시세/재무/이름의 시장별 분기(kr/us/format). `get_quote`·`get_quotes_batch`·`get_history_df`·`resolve_name`이 공개 표면.
- **market_indicators 패키지** — 시장지표별 서브모듈(fx/commodities/econ/macro/indices/sentiment/kospi_futures/kospi_signal/…), 각자 `market_cache` 증분 fetch.
- **recommendation 패키지** (`services/recommendation/`) — 추천 엔진 funnel(universe→scoring→funnel→store→actions), `stock_recommendations` 테이블에 배치 precompute→read(ADR-0015). universe는 시장 분리(task#166).
- **job_runs** (`services/job_runs.py`) — `record(id, lane)` 컨텍스트매니저로 배치 실행이력 기록(auto/manual/backfill lane).
- **utils** (`services/utils.py`) — `sanitize`(응답 dict의 NaN/inf → None, starlette `allow_nan=False` 직렬화 500 방어망), `today_kst`(KST 시장-날짜 판정 — 컨테이너 UTC라 bare `date.today()` 금지, `tests/test_no_bare_today.py`가 단언, task#165), 티커 검증 헬퍼.
- **프론트 hooks** (`frontend/src/hooks/`) — `usePortfolioData`(대시보드/시세), `useReportList`/`useReportFilters`/`useReportGeneration`(리포트), `useStockManagement`(종목 CRUD), `useAuth`/`useTheme`/`useIsMobile`/`usePriceFlash`. 데이터 fetch·상태를 페이지에서 분리.

## 배포 구조 (요약)
nginx가 `frontend/dist`를 직접 서빙(로컬 `npm run build` 즉시 라이브) + `/api/*` → backend:8000 프록시. Cloudflare Tunnel(portfolion.taebro.com → :80)은 launchd 실행. 자동 배포 = self-hosted GH Actions 러너(주) + `scripts/auto-deploy-poll.sh` 폴러(폴백, `LOCAL != origin/main`이면 `git reset --hard`).
</content>
</invoke>

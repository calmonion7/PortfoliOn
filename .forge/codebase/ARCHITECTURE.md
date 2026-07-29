---
last_mapped_commit: 4bb49ff0402c150884f2fa9c80dfed8dff1945d5
mapped: 2026-07-29
---

# ARCHITECTURE — PortfoliOn

## 0. 한 장 요약

- **백엔드**: Python 3.12(Docker) / FastAPI 단일 앱. `backend/main.py`가 19개 라우터를 `include_router`로 조립하고, 요청은 **router → service → `services/db.py`(psycopg2 풀) → PostgreSQL** 한 방향으로 흐른다.
- **프론트**: React 19 + Vite 8(rolldown) SPA. `frontend/src/main.jsx` → `App.jsx`가 세션 게이트·Provider·라우터를 감싼다. plain CSS(+CSS 변수 토큰), TailwindCSS 없음.
- **배포**: Mac 로컬 Docker. nginx가 `frontend/dist`를 직접 서빙하고 `/api/*`를 backend 컨테이너로 프록시. `deploy.sh`가 프론트 빌드 + 백엔드 이미지 빌드 + 컨테이너 교체를 담당.
- **핵심 규약**: 외부 데이터는 **배치가 사전계산해 저장**하고 **요청 경로는 저장값만 읽는다**(§4). 결측은 잘못된 값보다 낫다(`wrong < missing`).
- **LLM 없음**: 백엔드에 Anthropic/LLM 호출 코드가 없다(`backend/requirements.txt` 확인). AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich/발행 API로 써 넣는다.

---

## 1. 엔트리포인트

| 엔트리포인트 | 파일 | 역할 |
|---|---|---|
| 백엔드 앱 | `backend/main.py` | 로깅 배선 → 라우터 조립 → lifespan(마이그레이션·스케줄러·캐시 warm) |
| 스케줄러 | `backend/scheduler/__init__.py` (`start()`) | 배치 스펙 시드 → 편집가능 배치 리스케줄 → 누락 리포트 복구 → 빈 캐시 시드 → APScheduler 기동 |
| 프론트 앱 | `frontend/src/main.jsx` → `frontend/src/App.jsx` | StrictMode + 토큰/모션 CSS import → 세션 게이트 → Provider/Router |
| 배포 | `deploy.sh` | 프론트 `npm run build` → backend 이미지 build → backend/nginx 컨테이너 stop/rm/run → `/health` 확인 |
| 인프라 정의 | `docker-compose.yml`, `nginx/nginx.conf`, `backend/Dockerfile` | postgres / backend / nginx / certbot 4서비스 |
| CI | `.github/workflows/deploy.yml` (`runs-on: self-hosted`) | push → `git reset --hard origin/main` → `bash deploy.sh` |
| 배포 폴백 | `scripts/auto-deploy-poll.sh` | 2분 주기 launchd. `HEAD != origin/main`이면 `git reset --hard` 후 `deploy.sh` |
| 호스트 백필 | `backend/run_backfill.py` | 컨테이너 밖(호스트)에서 localhost:5432 postgres에 직접 붙는 독립 스크립트 |

### 1.1 `backend/main.py` 기동 순서 (읽는 순서가 곧 의존 순서)

1. `load_dotenv()` — `backend/.env`(로컬) / 컨테이너는 `--env-file backend/.env.docker`.
2. `_configure_logging()` — `basicConfig(level=INFO)`, `urllib3`/`yfinance`/`apscheduler`/`asyncio`를 WARNING으로 억제, `uvicorn*` 로거의 `propagate=False`(중복 emit 차단). **이 배선이 없으면 root lastResort가 WARNING+만 내보내 `logger.info`가 `docker logs`에 안 보인다.**
3. `import scheduler as sched` + 라우터 import.
4. `lifespan`: `_migrate()` → `sched.start()` → `_warm_market_cache()`를 데몬 스레드로 → (종료 시) `sched.stop()`.
5. 예외 핸들러: `RequestValidationError` → `sanitize(jsonable_encoder(exc.errors()))`로 422 본문의 NaN/inf를 null화. **없으면 NaN 입력을 echo한 422가 starlette `allow_nan=False`에서 500이 된다.**
6. 미들웨어: `SessionMiddleware(secret_key=SESSION_SECRET)` → `EventTrackerMiddleware` → `CORSMiddleware`(`localhost:3000`, `localhost:5173`, `FRONTEND_URL`).
7. `include_router` ×19 (auth → portfolio → report → … → admin 순).
8. `GET|HEAD /health`.

### 1.2 `_migrate()` — 기동 idempotent 마이그레이션 (ADR-0006)

`backend/app_schema.sql`은 **신규 설치용**이고, 라이브 DB는 `main.py:_migrate()`의 `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`만 탄다. 각 DDL은 개별 `try/except` + `logger.warning("[Migrate] …")`로 감싸 하나가 실패해도 기동을 막지 않는다.

→ **신규 컬럼/테이블은 `app_schema.sql`과 `main.py:_migrate()`를 반드시 쌍으로 추가**해야 배포에 반영된다.

---

## 2. 백엔드 계층과 의존 방향

```
HTTP
 └─ backend/main.py  (조립 · 미들웨어 · 마이그레이션 · lifespan)
     ├─ backend/auth.py                  ← 인증/인가 Depends 4종
     ├─ backend/middleware/event_tracker.py
     └─ backend/routers/*.py             ← HTTP 계약 (경로·Pydantic·상태코드·Depends)
         └─ backend/services/**          ← 도메인 로직 · 외부 어댑터 · 계산
             ├─ backend/services/storage/    ← 앱 데이터 read/write (portfolio·names·schedule·dates)
             ├─ backend/services/db.py       ← psycopg2 ThreadedConnectionPool (유일한 SQL 실행 지점)
             └─ backend/services/cache.py    ← 프로세스 인메모리 캐시

backend/scheduler/**  ── 같은 services 계층을 호출 (routers를 거치지 않음)
```

**규칙**
- 라우터는 서로를 import하지 않는다. 유일한 예외가 `services/cache.py:invalidate_portfolio_caches()`의 `from routers import calendar as calendar_router`(순환 회피용 함수 내 지연 import).
- SQL은 `services/db.py`의 `query`/`execute`/`execute_many`만 쓴다. 커넥션 풀은 `maxconn=20`으로, 최대 ThreadPool 동시성(calendar 15·analysis 11)보다 크게 잡혀 있다 — psycopg2 풀은 소진 시 블록이 아니라 `PoolError`를 던진다.
- 순환 참조 회피는 **함수 내부 지연 import**로 한다(`storage → cache`, `cache → routers.calendar`, `main._migrate → services.db`).

### 2.1 라우터 목록과 prefix

| 파일 | prefix | 표면 |
|---|---|---|
| `backend/routers/auth.py` | `/api/auth` | register/login/refresh/logout/me + Google·GitHub OAuth + `oauth/token` 코드 교환 |
| `backend/routers/portfolio.py` | `/api/portfolio` | 보유 목록·추가·수정·삭제·핀, `/prices`(폴링), `/dividends`, `/rebalance`(+targets), `/exposure` |
| `backend/routers/watchlist.py` | `/api/watchlist` | 관심종목 CRUD + `/{ticker}/promote` |
| `backend/routers/stocks.py` | `/api/stocks` | `/dashboard`(+cache DELETE), `/search`, `/compare`, `/{ticker}/news`, `/{ticker}/supply-score`, enrich, 백필·refresh 계열 |
| `backend/routers/report.py` | `/api` | `/report/*`(생성·목록·상세·history·backlog·disclosures·insider·us-supply·agm) + `/consensus/*` |
| `backend/routers/analyst_reports.py` | `/api/analyst-reports` | 발행물 누적 리소스(POST 발행 / GET 목록·상세 / DELETE) |
| `backend/routers/recommendations.py` | `/api/recommendations` | 저장된 추천 점수 read + `/refresh` |
| `backend/routers/rankings.py` | `/api` | `/rankings`, `/rankings/refresh` |
| `backend/routers/investor.py` | `/api` | `/investor/screening`, `/investor/refresh`, `/stocks/{ticker}/investor-trend` |
| `backend/routers/short_sell.py` | `/api` | `/stocks/{ticker}/short-sell`, `/short-sell/refresh` |
| `backend/routers/market_indicators.py` | `/api/market` | fx·vix·commodities·treasury·econ·indices·kospi-futures·fear-greed·macro-signals·kospi-signal·leverage·lending + refresh 계열 |
| `backend/routers/analysis.py` | `/api/analysis` | `/sector`(+refresh-kr/-us), `/macro-correlation` |
| `backend/routers/analytics.py` | `/api/analytics` | `/correlation` |
| `backend/routers/calendar.py` | `/api` | `/calendar`, `/calendar/cache` DELETE |
| `backend/routers/digest.py` | `/api` | `/digest/latest`, `/digest/generate`, `/digest/generate-all` |
| `backend/routers/guru.py` | `/api/guru` | `/managers`(목록/상세), `/stats/popularity`·`/weighted`, `/crawl`(+progress) |
| `backend/routers/batches.py` | `/api` | `/batches`, `/batches/fomc-coverage`, `/batches/{job_id}/schedule` GET·PUT |
| `backend/routers/events.py` | `/api/events` | 프론트 행동 이벤트 수집(화이트리스트 검증) |
| `backend/routers/admin.py` | `/api/admin` | 사용자·권한·기본권한, ticker 전사용자 삭제, analytics 집계, analyst-targets, `cowork/fire` |

주의: `report.py`·`calendar.py`·`digest.py`·`rankings.py`·`investor.py`·`short_sell.py`·`batches.py`는 prefix가 `/api` 하나여서 **경로 전체를 데코레이터에 적는다**. `investor.py`/`short_sell.py`는 `/api/stocks/...` 경로를 갖지만 `stocks.py`가 아니라 자기 파일에 있다 — 기능으로 파일을 찾을 때 주의.

라우팅 순서 함정: `PUT /api/stocks/enrich/batch`는 `PUT /api/stocks/{ticker}/enrich` **앞에** 등록돼야 `enrich`가 ticker로 잡히지 않는다.

### 2.2 서비스 계층 분류

| 분류 | 파일 | 성격 |
|---|---|---|
| 인프라 | `db.py`, `cache.py`, `parallel.py`(`parallel_map`, 기본 10워커), `progress.py`(`ProgressTracker`, 스레드락), `errors.py`(`not_found`/`already_exists`), `utils.py`(`sanitize`·`today_kst`·`is_valid_ticker`·TICKER_RE), `job_runs.py`, `schedule_spec.py`, `batch_registry.py` | 도메인 무지 |
| 저장소 | `storage/`(`portfolio.py`·`names.py`·`schedule.py`·`dates.py`) | 앱 데이터 read/write + 캐시 무효화 |
| 리포트 파이프라인 | `report_generator.py`, `scraper.py`, `indicators.py`, `consensus.py`, `consensus_pipeline.py`, `analyst_reports.py` | 스냅샷 생성·기술지표·컨센서스 정본 |
| 계산기(순수 함수) | `rebalance.py`, `exposure.py`, `supply_score.py`, `guru_stats.py`, `beta.py` | DB/외부 호출 없음 |
| 외부 소스 어댑터 | `market/`(KR·US·format), `kiwoom/`, `kis/`, `market_indicators/`, `guru_scraper.py`, `disclosures.py`, `agm.py`, `backlog.py`+`backlog_parser.py`, `dividends.py`, `insider_trades.py`, `us_supply.py`, `leverage_service.py`, `lending_service.py`, `short_sell_service.py`, `investor_service.py`, `ranking_service.py`, `kr_sector_service.py`, `us_sector_service.py`, `analysis_service.py` | 네트워크 I/O |
| 도메인 서비스 | `digest_service.py`, `auth_service.py`, `recommendation/`(`universe`·`funnel`·`scoring`·`actions`·`store`), `cowork_trigger.py` | 조합 로직 |

### 2.3 God-file 분할 패턴 (ADR-0017)

`services/storage`·`services/market`·`services/market_indicators`·`backend/scheduler`는 단일 파일에서 **패키지로 분할**됐고, 각 `__init__.py`가 **공개 + 외부참조 private 심볼을 전부 re-export**해 기존 표면(`storage.X` / `from services.market import X` / `scheduler.X`)을 보존한다. `__init__.py`의 re-export 목록이 그 패키지의 사실상 공개 API 명세다. `import *`는 underscore 심볼을 건너뛰므로 `_JOB_FUNCS`·`_yf_sym` 등은 **명시 열거**돼 있다.

---

## 3. 프론트엔드 아키텍처

### 3.1 조립 순서 (`frontend/src/App.jsx`)

```
main.jsx (StrictMode + styles/tokens.css + styles/motion.css + index.css)
 └─ App()                     ← useTheme, session 부트스트랩(OAuth 코드 교환 / ?token&refresh / localStorage)
     ├─ (미로그인) LoginPage
     └─ ToastProvider → AuthProvider(isLoggedIn) → BrowserRouter → AppShell
         AppShell:  Masthead(PC 좌측) + mobile-header + <Routes> + MobileNav(모바일 하단)
```

- 세션 부트스트랩은 `App()`의 단일 `useEffect`가 담당: `?error` → 초기화, `?oauth=<code>` → `GET /api/auth/oauth/token?code=`로 토큰 교환 후 `/`로 replace, `?token&refresh` → localStorage 저장.
- 토큰은 `localStorage`의 `access_token` / `refresh_token`. 로그아웃은 `doLogout()`이 `POST /api/auth/logout` 후 두 키 제거.
- 라우트 전환 페이드는 `key={location.pathname}`의 `.anim-fade`(transform 미사용 — fixed 자손 containing block 함정 회피).

### 3.2 라우팅

- 라우트 정의는 `App.jsx`의 `<Routes>` 한 곳. 구 URL → 신규 라우트 매핑은 `frontend/src/routes.js`의 `REDIRECTS`(ADR-0025)로 분리돼 있어 `src/test/route-redirects.test.jsx`가 같은 배열을 검증한다.
- 리서치 계열(`/reports` `/recommend` `/ranking` `/compare` `/analyst-reports` `/analyst-report/:ticker/:date` `/calendar` `/dividends` `/digest`)은 `pages/ResearchShell.jsx`로 감싼다.
- `/market/indicators`·`/market/flow`는 같은 `pages/MarketHub.jsx`에 `tab` prop으로 분기.
- 리포트 딥링크는 `App.jsx`의 `ReportsRoute`가 `location.state.ticker` + `location.key`(navKey)를 `Reports`로 넘겨 **같은 라우트 재네비게이션도** 반영한다.

### 3.3 내비게이션 이원화 (변경 시 항상 쌍으로)

| 표면 | 정의 위치 |
|---|---|
| PC 마스트헤드 5섹션 + 하위 항목 | `frontend/src/components/Masthead.jsx`의 `SECTIONS` |
| 모바일 하단 탭바 5개 | `frontend/src/components/MobileNav.jsx`의 `ALL_TABS` (+ `RESEARCH_PATHS`/`SCHEDULE_PATHS`) |
| 모바일 리서치/일정 seg 탭 | `frontend/src/pages/ResearchShell.jsx`의 `RESEARCH_TABS` / `SCHEDULE_TABS` |
| 모바일 시장 seg 탭 | `frontend/src/pages/MarketHub.jsx`의 `TABS` |

세 곳 모두 `menuPermissions`(`AuthContext`)로 필터되며 섹션 key는 백엔드 `ALL_MENUS`(`portfolio`/`research`/`market`/`guru`/`settings`)와 대응한다. `research` 권한이 리서치·일정·인컴 두 섹션을 함께 게이트한다.

### 3.4 상태 관리

- **Context 2개만**: `frontend/src/contexts/AuthContext.jsx`(role + menuPermissions + loading; 로그인 시 `GET /api/auth/me` 1회, 실패 시 `role='user'`/빈 권한으로 degrade), `frontend/src/components/Toast.jsx`의 `ToastProvider`. 전역 스토어(Redux/Zustand) 없음.
- **나머지는 커스텀 훅**이 담당(`frontend/src/hooks/`): `usePortfolioData`(목록·대시보드·FX·폴링 tick), `useStockManagement`(추가/수정/삭제/승격), `useReportList`, `useReportFilters`, `useReportGeneration`, `useTheme`, `useIsMobile`, `useBodyScrollLock`, `usePriceFlash`, `useCountUp`, `useReveal`. 훅은 인자로 콜백(`showToast`·`fetchList`)을 받아 페이지가 배선하는 방식이다.
- **HTTP는 `frontend/src/api.js`의 axios 인스턴스 하나**: 요청 인터셉터가 `Authorization: Bearer`를 붙이고, 응답 인터셉터가 401에서 토큰을 지우고 `/`로 보낸다. `baseURL`은 `VITE_API_BASE_URL || ''`(로컬은 Vite 프록시로 `:8000`).
- 프론트 방어 규약: 실패는 `console.warn`(graceful) / `console.error`(예상외)로 남기되 **silent catch 금지**(대시보드가 조용히 빈 그리드로 죽던 회귀 때문).

### 3.5 스타일·빌드

- 디자인 토큰은 `frontend/src/styles/tokens.css`(ADR-0026 에디토리얼 아이덴티티, light 기본 + dark 변형). 뷰포트별 시트 `pc.css`/`mobile.css`, 모션 `motion.css`, 도메인 `guru.css`.
- 공용 UI는 `frontend/src/components/ui/`(Badge·Button·Card·Stat·Input·Skeleton·icons + `GuruActivityBadge`·`InsiderBadge`·`SupplyBadge`).
- `frontend/vite.config.js`: `manualChunks`는 **함수 형식만**(Vite 8 = rolldown) — `charts`(recharts/d3/victory-vendor)와 `vendor`로 분할. PWA는 `vite-plugin-pwa` + 커스텀 `sw-cache-bust` 플러그인(`config.build.outDir` 기준으로 index.html/registerSW.js 캐시버스팅). vitest는 같은 파일의 `test`(jsdom + `src/test/setup.js`)에 설정.

---

## 4. 데이터 흐름 — 요청 경로 vs 배치 경로

이 프로젝트의 가장 중요한 아키텍처 규약이다.

### 4.1 기본 규약: 배치가 쓰고 요청은 읽는다

배치가 외부 API를 호출해 **테이블/`market_cache`에 사전계산 저장**하고, 요청 경로 엔드포인트는 **저장값만 SELECT**한다(라이브 외부 호출 0). 배치-백킹 표면 예: 랭킹(`market_rankings`), 수급추이(`market_investor_trend`), 공매도(`market_short_sell`), 배당(`stock_dividends`·`stock_dividend_schedule`), 베타(`stock_beta`), 수급 스코어(`stock_supply_score`), 공시(`stock_disclosures`), 내부자(`stock_insider_trades`), 추천(`stock_recommendations`), US 수급(`us_supply_snapshot`), 수주잔고(`backlog_history`), KR/US 섹터 모멘텀(`market_cache`), 매크로 신호(`market_cache`).

배치 fetch의 실패 처리 규약:
- 실패를 **조용히 삼키지 말고 로깅**한다.
- **빈/all-None 결과를 캐시·테이블에 박제하지 않는다**(직전 양호값 유지). 성공 응답(`rt_cd=0`)에 빈 payload가 오는 케이스도 *값 수준*에서 가드해야 한다.
- `DELETE+INSERT`(replace) 갱신 store는 fetch 실패 시 **delete 자체를 스킵**해야 한다(빈 결과 박제보다 파괴적). `services/dividends.py:replace_schedule` 계열.

### 4.2 예외: 요청경로 증분 fetch (배치 없음)

일부 시장지표는 `fx` 패턴 — *TTL 인메모리 캐시 → `_mc_load`(DB 저장값) → 라이브 fetch → `_mc_save` + 폴백* 을 요청 경로에서 수행하고 `batch_registry.BATCHES`에 등록되지 않는다: `services/market_indicators/fx.py`(fx·vix), `commodities.py`, `indices.py`, `kospi_futures.py`, `sentiment.py`.

`services/market_indicators/cache.py`의 두 도구를 구분할 것:
- `get_or_refresh(key, fetch_fn, ttl)` — "저장값이 있으면 fetch를 스킵"만 한다. **fetch 실패 시 직전 저장값으로 폴백하지 않고 예외를 전파**한다. FRED/yfinance처럼 안정적인 소스에만.
- **VIX식 수동 폴백** — `_get_cache → try fetch → 성공 시 _mc_save+반환 / 실패 시 _mc_load 직전값 / 없으면 None`. CNN Fear&Greed처럼 언제든 막히는 소스에 필수.

### 4.3 라이브 시세 경로

- 보유 목록 폴링: 프론트 `usePortfolioData` → `GET /api/portfolio/prices` → `market.get_quotes_batch()`. 서버는 `cache.get_live_prices`(TTL 15s, user당)로 다중 탭 폴링이 단일 자격증명 레이트리밋을 치지 않게 상한한다.
- 대시보드: `GET /api/stocks/dashboard` → `routers/stocks.py:_build_all`이 일괄시세 + 카드당 enrichment(스냅샷·컨센서스·배당·수급·내부자)를 조립하고 `cache.get_dashboard`(TTL 300s)에 저장. 실패 내성: `get_quotes_batch`는 try/except→`{}`, 카드당 `_safe`→`_minimal_card`, 최종 반환은 `services.utils.sanitize`. **holdings=N이면 항상 N카드**가 불변식이다.

### 4.4 스케줄러 · 배치 레지스트리

```
backend/services/batch_registry.py   ← 배치 30종의 정적 메타(id·label·category·market·source·usage·
                                       editable·trigger_kinds·manual_endpoint·timezone·default_schedule)
backend/scheduler/jobs.py            ← 잡 함수 + _JOB_FUNCS: {job_id → 함수} 배선
backend/scheduler/schedule.py        ← _build_trigger / _reschedule_job / _seed_batch_schedules /
                                       _seed_spec_for / _check_missed_report
backend/scheduler/_state.py          ← AsyncIOScheduler 싱글톤 + 상수 (leaf 모듈, 순환 회피)
backend/scheduler/__init__.py        ← start()/stop()/reload(job_id) + 전 심볼 re-export
backend/services/schedule_spec.py    ← 스펙 4패턴 검증 + build_trigger_kwargs
```

- 스케줄 스펙은 DB `batch_schedules(job_id, data jsonb)`에 저장되고 `daily`/`weekly`/`monthly`/`interval` 4패턴만 유효(`validate_schedule_spec`).
- `start()`는 `_seed_batch_schedules()` → `editable` 배치 전부 `_reschedule_job` → `_check_missed_report()` → `_seed_rankings_if_empty()` / `_seed_kr_sector_if_empty()` / `_seed_us_sector_if_empty()` → `_scheduler.start()`.
- `misfire_grace_time`은 레지스트리에 명시된 배치(daily_report_kr/us=82800)만 넘긴다 — `None`을 넘기면 APScheduler가 "유예 무제한"으로 해석하므로 **인자를 빼야** 기본값(1초)이 적용된다.
- 편집 엔드포인트(`PUT /api/batches/{job_id}/schedule`)는 저장 후 `scheduler.reload(job_id)`로 즉시 반영.
- **job_id는 4곳에서 일치해야 한다**: `batch_registry.BATCHES`, `_JOB_FUNCS`, `job_runs.record(id, …)` 호출(auto/manual/backfill **모든 lane**), 그리고 이를 단언하는 테스트.

### 4.5 실행 계측 (`services/job_runs.py`, ADR-0001)

`record(job_id, trigger)` 컨텍스트 매니저가 `job_runs`에 `running` 행을 INSERT하고 종료 시 `success`/`failed`로 UPDATE, job_id별 최근 20건만 prune한다. **계측은 관측 전용** — 기록 실패는 경고만 남기고 `run_id=None`으로 본문을 그대로 실행한다. 반대로 다수 잡 본문이 내부 예외를 try/except로 삼키므로 **`success`를 "내부 오류 없음"으로 읽으면 안 된다**(docstring에 해당 잡 목록이 열거돼 있다).

---

## 5. 핵심 추상

### 5.1 프로세스 인메모리 캐시 — `backend/services/cache.py`

`TTLCache`(만료 기반 dict) 1개 클래스 + 스냅샷 LRU. 현재 캐시 스토어 **10종**:

| 스토어 | 접근자 | TTL / 크기 | 키 |
|---|---|---|---|
| 스냅샷 LRU | `get_snapshot` | maxsize 50 | `TICKER/date` |
| 리포트 목록 | `get_list` | 60s | user_id |
| 대시보드 | `get_dashboard` | 300s | user_id |
| 상관관계 | `get_correlation` | 300s | user_id |
| 섹터 | `get_sector` | 300s | `user_id:market` |
| 매크로 상관 | `get_macro` | 300s | user_id |
| quote | `get_quote_cached` | 60s | `TICKER/market/exchange/regular` |
| 라이브 시세(폴링) | `get_live_prices` | 15s | user_id |
| 리밸런싱 | `get_rebalance` | 300s | user_id |
| 노출 | `get_exposure` | 300s | user_id |

무효화 진입점 2개:
- `invalidate(ticker)` — 해당 티커 스냅샷 + 목록·대시보드·상관·섹터·매크로·라이브시세.
- `invalidate_portfolio_caches(user_id)` — `routers.calendar.clear_cache(user_id)`(DB `calendar_cache` 행 삭제) + 목록·대시보드·섹터·매크로·상관·라이브시세·리밸런싱·노출. 종목 추가/삭제/승격 시 호출.

### 5.2 영구 시장 캐시 — `market_cache` 테이블

`backend/services/market_indicators/cache.py`가 유일한 접근 계층: `_mc_load(key)` / `_mc_save(key, data)` / `_mc_delete` + 프로세스 TTL `_cache`(`_get_cache`/`_set_cache`) + `get_or_refresh`. 키 예: `fx`, `vix`, `commodities`, `treasury`, `econ`, `m7`, `krtop2`, `krexports`, `macro_signals`, `kospi_signal`, `sp500_tickers`, `kospi_tickers`, KR/US 섹터 모멘텀. 서브모듈은 `_merge_history`/`_yf_close_history`로 **마지막 저장 날짜 이후만** 증분 fetch한다.

`sp500_tickers`/`kospi_tickers`는 task#234 이후 `market_cache`가 캐시 정본이고 `backend/data/*.json`은 **read-only 시드**다(파일 write 경로 0).

### 5.3 시세 소스 폴백 체인 — `backend/services/market/`

```
market.get_quote(ticker, market, exchange, regular, hist)      ← TTL 캐시(키에 regular 포함)
 └─ _get_quote_uncached
     ├─ KR → kr.get_quote_kr(ticker, exchange, regular)
     │        피드: _kr_basic_kiwoom(NXT `_AL` / regular=True면 KRX 평문) · _kr_basic_kis · _kr_basic_naver
     │        판정: _kr_pick_basic → _corroborated_pick(독립 피드 2-of-N 다수결, ±2x)
     │              · regular=True → _kr_pick_regular(prev ±30% + 일봉 2x)
     │              · 합의 불가/단일 피드 → _kr_pick_degenerate_lazy (wrong < missing)
     └─ US → yfinance → us._us_quote_kis (KIS 백업, 키 미설정 시 dormant)
```

- 키움(`backend/services/kiwoom/`): KR 읽기전용 1차 소스(ADR-0009). `client.py`(토큰 싱글톤·직렬 throttle·`integrated_code(stk_cd, regular)`), `quote.py`·`chart.py`·`investor.py`·`sector.py`·`shortsell.py`.
- KIS(`backend/services/kis/`): KR·US **백업** 읽기전용(ADR-0011) + 국내선물 시세(ADR-0022). `client.py`(토큰 60s 재발급 가드), `quote.py`, `futures.py`.
- `regular` 플래그로 **시세 기준이 이원화**돼 있다(ADR-0020): 리포트 스냅샷 writer만 `regular=True`(KRX 정규장), 대시보드·RSI·종목추가·`resolve_name`은 기본값(NXT). 같은 종목이 리포트와 대시보드에서 ~1% 다를 수 있는 건 의도된 기준 차다.
- 박제 시점 게이트: `report_generator.generate_report`(KR)가 저장 직전 KRX와 독립인 ref 피드(네이버 retry-once → KIS 폴백)로 price·일봉 기준종가를 2x 교차검증하고, ref 전무면 **박제를 스킵**한다.
- `market/format.py`의 `_yf_sym(ticker, market, exchange)`가 yfinance 심볼 접미사(US=bare, KR=`{ticker}.{KS|KQ}`)를 붙인다 — **raw ticker로 `yf.Ticker`를 부르면 KR은 0건**.

### 5.4 저장소 계층 — `backend/services/storage/`

| 모듈 | 책임 |
|---|---|
| `portfolio.py` | `get_stocks`/`save_stocks`/`get_holdings`/`save_holdings`, `get_watchlist_tickers`, `get_full_portfolio`, `get_global_portfolio`, `enrich_stock`, `set_target_weights`, `set_pinned` + `_ENRICH_KEYS`/`_ANALYST_KEYS`/`_JSON_TEXT_FIELDS` |
| `names.py` | 종목명 dual-source 동기화 — `refresh_snapshot_names`(단건) / `reconcile_snapshot_names`(전체) / `set_ticker_name` / `update_ticker_meta` / `tickers_missing_name` / `_invalidate_name_caches` |
| `schedule.py` | `batch_schedules` read/write + 레거시 `schedules`·`guru_schedules`·`guru_managers` 저장 |
| `dates.py` | 시각인지 기대 리포트 날짜 — `expected_report_date(market)` / `expected_report_dates()` / `_now_kst()`(테스트 monkeypatch 지점) |

종목명이 `tickers.name`(공유 마스터)과 `snapshots.data.name`(리포트 생성 시 박제) **두 곳**에 있어, 이름 변경은 둘 다 갱신 + `cache.invalidate(ticker)`/`invalidate_list()`가 필요하다. `tickers` UPSERT에는 이름 클로버 방지 가드(`EXCLUDED.name`이 NULL/빈값/ticker와 같으면 기존값 보존)가 들어 있다.

### 5.5 NaN/inf 안전망 (3중)

1. **소스**: `math.isfinite` 가드로 비유한값을 None 처리(`_usdkrw_rate`, `_fin_num` 등).
2. **출력**: `services/utils.py:sanitize()`가 dict/list를 재귀 순회해 NaN/inf → None. 응답 조립 마지막에 적용(`_build_all`, `report_generator`).
3. **입력**: Pydantic float 필드에 `allow_inf_nan=False` + `main.py`의 `RequestValidationError` 핸들러가 422 본문을 sanitize.

이유: starlette `JSONResponse`는 `allow_nan=False`라 응답 dict의 NaN이 **500**이 된다. 반면 `json.dumps` 기본값은 NaN을 허용해 파일 폴백만 성공하는 증상 엇갈림이 생긴다.

### 5.6 진행률·병렬

- 장시간 배치/수동 작업의 진행률은 `services/progress.py:ProgressTracker`(스레드락 dict) 인스턴스를 라우터 모듈 레벨에 두고 `GET .../progress`로 노출(`routers/guru.py`의 `_progress`, `routers/report.py`의 생성·백필·컨센서스 트래커).
- 병렬 외부 fetch는 `services/parallel.py:parallel_map`(기본 10워커) 또는 각 모듈의 `ThreadPoolExecutor`. **워커 수는 DB 풀(`maxconn=20`)보다 작게** 유지해야 `PoolError`가 안 난다.

---

## 6. 인증 · 권한 흐름

### 6.1 백엔드 의존성 4종 (`backend/auth.py`)

| Depends | 허용 자격 | 실패 |
|---|---|---|
| `get_current_user` | JWT Bearer(HS256, `JWT_SECRET`) → `payload["sub"]` | 401 |
| `get_current_user_or_api_key` | `X-API-Key == COWORK_API_KEY` → 센티넬 `__api_key__`, 또는 JWT | 401 |
| `require_admin` | JWT + `users.role == 'admin'` (**API 키 거부**) | 401/403 |
| `require_admin_or_api_key` | API 키 센티넬 통과, 또는 admin JWT | 401/403 |

`ADR-0029` = 공개 read 엔드포인트 없음. 예외적으로 인증 불필요한 것은 `routers/auth.py`의 공개 엔드포인트(`GET /api/auth/oauth/token` 등)와 `/health`뿐이며, `backend/tests/test_no_public_reads.py`가 이를 지킨다.

### 6.2 로그인 · OAuth

- 로컬 계정: `POST /api/auth/register|login` → `services/auth_service.py`(bcrypt) → access JWT + `refresh_tokens` 행.
- 소셜: `GET /api/auth/oauth/{google|github}` → provider → `/callback` → 서버가 **1회용 code**를 발급하고 프론트로 리다이렉트 → `App.jsx`가 `GET /api/auth/oauth/token?code=`로 토큰 교환. authlib + `SessionMiddleware` 사용. 만료 code 정리는 `backend/tests/test_oauth_codes_sweep.py`가 검증.
- 프론트는 `localStorage`에 토큰을 두고 `api.js` 인터셉터가 401에서 세션을 파기.

### 6.3 역할 · 메뉴 권한

- `users.role` = `user` | `admin`. admin만 리포트 생성·구루 크롤·배치 refresh 계열 가능.
- 메뉴 권한: `user_menu_permissions(user_id, menu, enabled)` + 신규 사용자 기본값 `default_menu_permissions`. 메뉴 집합은 `backend/routers/admin.py:ALL_MENUS = ["portfolio","research","market","guru","settings"]`.
- `GET /api/auth/me`가 `{role, menu_permissions}`를 주고, `AuthContext`가 이를 들고 `Masthead`/`MobileNav`가 nav를 필터한다. **프론트 게이팅은 표시 제어일 뿐이고 실제 인가는 엔드포인트 Depends가 한다.**
- admin 교차-사용자 동작은 `/api/admin/*`로 분리(예: `DELETE /api/admin/stocks/{ticker}`가 전 사용자 `user_stocks` 삭제, 스냅샷은 고아로 유지). 사용자 화면의 액션 버튼은 `is_mine`으로 게이트하고, 버튼 블록은 `frontend/src/components/reports/StockActions.jsx` 한 곳에 통합돼 있다.

### 6.4 행동 이벤트 수집

- 서버측: `backend/middleware/event_tracker.py`가 `_TRACKED`(method+path 정규식 7종: stock_add/delete/promote, report_generate, guru_crawl)에 매칭되는 요청을 JWT에서 user_id를 뽑아 `user_events`에 비동기 INSERT. 실패는 삼킨다(관측 전용).
- 클라이언트측: `frontend/src/utils/analytics.js:trackEvent()` → `POST /api/events` → `routers/events.py`의 `VALID_EVENTS` 화이트리스트.
- 집계 조회는 `GET /api/admin/analytics*`(admin) → `frontend/src/pages/AdminAnalytics.jsx`.

---

## 7. 구루(Guru) 도메인 흐름 (최근 추가)

```
배치 guru_crawl (scheduler._run_guru_crawl)
 └─ backend/services/guru_scraper.py   ← dataroma 크롤(holdings.php / m_activity.php) + Naver US API 한글명
     · _ACTIVITY_RE / _ACTIVITY_KINDS: dataroma 동사(Add/Reduce/Sell) → 저장 enum(add/reduce/sold_out)
     · 저장값은 locale 독립 — 한글 라벨은 프론트가 붙인다
 └─ storage.save_guru_managers()       ← guru_managers 테이블(전역 단일 행 JSON)

요청 경로 (라이브 크롤 0)
 backend/routers/guru.py
   GET /api/guru/managers            → 저장 JSON에서 _DETAIL_ONLY_KEYS("holdings","sold_out") 제거한 목록
   GET /api/guru/managers/{id}       → 상세(전 종목 포함)
   GET /api/guru/stats/{popularity|weighted} → services/guru_stats.py 순수 계산
   POST /api/guru/crawl (require_admin, BackgroundTasks) + GET /crawl/progress

프론트
 pages/Guru.jsx (탭 평탄화) → pages/GuruManagers.jsx / pages/GuruStats.jsx
 pages/GuruDetail.jsx (/guru/:id) — recharts 도넛 + 전 종목 목록
   · fitsSliceLabel(): 라벨 표시를 고정 임계값이 아니라 실측 기하(호 길이 + 라벨 박스 모서리 반경)로 판정
   · 라벨 폭은 숨은 SVG <text>의 getComputedTextLength()로 마운트당 1회 실측, jsdom엔 없으므로 문자별 추정 폴백 유지
 utils/guruName.js: splitManagerName() — "운용역 - 펀드" | "펀드" 2형태 파싱(백엔드 firm은 표시에 미사용)
 components/ui/GuruActivityBadge.jsx — kind enum → 라벨·기호·색(매수=--semantic-buy / 매도=--semantic-sell)
 components/reports/GuruHoldersSection.jsx — 리포트 상세에서 해당 종목 보유 구루 표시
```

색 규약: 가격 방향 배지는 `.badge--up`/`.badge--down`(KR 관례), 매매 방향은 `--semantic-buy`/`--semantic-sell` 전용 토큰. `GuruActivityBadge`와 `InsiderBadge`가 같은 구조·같은 토큰을 쓴다.

---

## 8. 저장 계층 개요 (DB)

스키마 실행 순서: `backend/auth_schema.sql`(users, refresh_tokens) → `backend/app_schema.sql`(앱 테이블 전체) → 기동 `_migrate()`.

| 그룹 | 테이블 |
|---|---|
| 인증·권한 | `users`, `refresh_tokens`, `user_menu_permissions`, `default_menu_permissions`, `user_events` |
| 종목·포트폴리오 | `tickers`, `user_stocks` |
| 리포트·발행물 | `snapshots`, `raw_reports`, `analyst_reports`, `digests` |
| 컨센서스 | `consensus_history`, `daily_consensus_mart` |
| 종목별 배치 산출 | `stock_disclosures`, `stock_dividends`, `stock_dividend_schedule`, `stock_beta`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`, `us_supply_snapshot`, `backlog_history` |
| 시장 배치 산출 | `market_cache`, `market_rankings`, `market_investor_trend`, `market_short_sell`, `market_leverage_indicators`, `market_lending_balance` |
| 스케줄·운영 | `batch_schedules`, `schedules`(레거시), `guru_schedules`, `guru_managers`, `job_runs`, `calendar_cache` |

파일 폴백: `backend/snapshots/`(per-ticker/date JSON)과 `backend/reports/`(레거시 read-only)는 DB 스냅샷의 보조 경로다. 캘린더 파일 캐시는 task#167에서 제거되어 `calendar_cache` 테이블이 유일하다.

---

## 9. 검증 아키텍처 (테스트가 어디까지 보는지)

| 층 | 위치 | 볼 수 있는 것 / 못 보는 것 |
|---|---|---|
| 백엔드 단위·라우터 | `backend/tests/` (127 파일, `pytest.ini`: `testpaths=tests`) | `conftest.py`가 `main.app`의 `get_current_user`를 override + **`_block_real_db` autouse 가드**로 실 DB 접근 차단(`db._get_pool` → raise). 다수 테스트는 conftest의 `client` 대신 모듈에서 `FastAPI()`를 직접 만들고 `app.dependency_overrides`로 auth를 우회한다 — 엔드포인트에 새 Depends를 붙이면 **그 자체-app 테스트**가 깨진다. |
| 규약 가드 테스트 | `test_no_print.py`(앱 코드 `print(` 0), `test_no_bare_today.py`, `test_api_doc_sync.py`(라이브 `app.routes` ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md` 엔드포인트 *존재* 대조), `test_no_public_reads.py`, `test_security_auth_gaps.py`, `test_nan_serialization_guards.py` | 존재·형태만. 요청/응답 스키마와 auth 산문 동기는 수동 DoD. |
| 프론트 단위 | `frontend/src/**/*.test.js(x)` + `frontend/src/test/` (vitest + jsdom, setup `src/test/setup.js`) | **jsdom에서 recharts는 렌더되지 않는다**(`ResponsiveContainer` 0크기) — 축/틱/막대/라벨 단언 불가. 범례 텍스트·캡션·분기·데이터 유무만. 색 의미·레이아웃 수치에도 블라인드. |
| 라이브 프로브 / UAT | `scripts/uat*.mjs`, `scripts/probe*.mjs|py`, `scripts/smoke*.mjs`, `scripts/audit_unauth_endpoints.py` | Playwright 디바이스 에뮬레이션 + `getBoundingClientRect()` 실측. 시각·레이아웃·라벨 겹침의 **유일한 게이트**. 기준 상자도 추정하지 말고 실측할 것. |

주의: `app.routes`를 순회하는 스크립트는 배포 이미지의 FastAPI 0.138.1에서 `_IncludedRouter` 래핑 때문에 0건을 세므로, `routes`와 `original_router`를 **양쪽 재귀 하강**해야 한다.

---

## 10. 배포 파이프라인과 그 아키텍처적 함의

```
git push origin main
 ├─ (주) self-hosted GH Actions 러너  .github/workflows/deploy.yml → reset --hard → deploy.sh
 └─ (폴백) launchd 2분 폴러          scripts/auto-deploy-poll.sh → HEAD != origin/main이면 reset --hard → deploy.sh

deploy.sh
 1. /tmp/portfolion-deploy.lock 으로 동시 배포 차단(러너 ↔ 폴러)
 2. frontend: npm install && npm run build  → frontend/dist/
 3. backend:  docker build -t portfolion-backend ./backend
 4. portfolion-backend-1 stop/rm/run (--env-file backend/.env.docker, --network portfolion_default)
 5. portfolion-nginx-1  stop/rm/run (nginx.conf + frontend/dist 를 :ro 마운트)
 6. curl localhost/health
```

아키텍처적으로 중요한 결과:
- **프론트는 빌드 즉시 라이브**(nginx가 `frontend/dist`를 볼륨 마운트로 직접 서빙). **백엔드 변경은 재배포 후에만 라이브** — 프론트만 먼저 빌드하면 백엔드 의존 기능이 미동작한다.
- 폴러가 `LOCAL != origin/main`을 **양방향으로** reset하므로, 메인 체크아웃의 미커밋 tracked 편집과 **push하지 않은 로컬 커밋**이 ≤2분 안에 소실된다. `.forge/` 등 untracked는 안전.
- nginx는 `index.html`·`sw.js`·`workbox-*.js`에 `no-store`를 붙인다(해시 없는 파일명 + PWA 캐시 갱신).
- Cloudflare Tunnel(`portfolion.taebro.com` → localhost:80)과 cloudflared는 compose 밖 launchd로 운영.

### 환경변수 (키 이름만)

`backend/.env.docker`: `DATABASE_URL`, `POSTGRES_PASSWORD`, `JWT_SECRET`, `SESSION_SECRET`, `FRONTEND_URL`, `COWORK_API_KEY`, Google/GitHub OAuth 클라이언트 키, `FRED_API_KEY`, `KOFIA_API_KEY`, `KITA_API_KEY`, `DART_API_KEY`, `KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`, `KIS_APP_KEY`/`KIS_APP_SECRET`/`KIS_BASE_URL`, `COWORK_ROUTINE_FIRE_URL`/`COWORK_ROUTINE_FIRE_TOKEN`, (미사용 잔존) `ANTHROPIC_API_KEY`.
루트 `.env`: docker-compose 보간용. 프론트: `VITE_API_BASE_URL`.

외부 키 계열은 **미설정이 안전 기본값**이다 — `configured()` 체크로 해당 기능이 휴면(dormant-safe)하고 기존 동작은 변하지 않는다(`services/kis/client.py`, `services/cowork_trigger.py` 참고).

---

## 11. 로컬 런타임 vs 컨테이너 런타임 (아키텍처 제약)

| 축 | 로컬 `backend/.venv` | Docker 이미지 |
|---|---|---|
| Python | 3.9.6 | 3.12 (`backend/Dockerfile`) |
| 어노테이션 | 런타임 평가 자리에 `X \| None` 금지 → `Optional[X]` | PEP604 가능 |
| lxml | 미설치 → `BeautifulSoup(html, "html.parser")` | 설치됨 |
| FastAPI | 구버전(`app.routes` 평탄) | 0.138.1(`_IncludedRouter` 래핑) |
| TZ | 로컬 TZ | env 미설정 → **UTC**. KR 시장-날짜 판정은 `services/utils.py:today_kst()` 또는 `ZoneInfo("Asia/Seoul")` 필수, bare `date.today()` 금지 |

로컬 pytest가 사실상의 게이트이므로 위 제약은 하드 제약으로 취급한다.

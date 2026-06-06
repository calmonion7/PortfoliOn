---
last_mapped_commit: 1bbea86804f93c6f544092809ff8ed13977e5975
mapped: 2026-06-06
---

# ARCHITECTURE

## 전체 구조 패턴

PortfoliOn은 **FastAPI 백엔드 + React(Vite) SPA 프론트엔드 + PostgreSQL** 조합의 단일 저장소(monorepo) 애플리케이션이다. 배포는 Mac 로컬 Docker 4-컨테이너(nginx / backend / postgres / certbot)로 이루어지며, 외부 접속은 Cloudflare Tunnel을 통한다.

백엔드는 전형적인 **계층 분리** 구조를 따른다.

```
HTTP 요청
  → nginx (정적 서빙 + /api/* 프록시)
    → FastAPI 앱 (backend/main.py)
      → Middleware (SessionMiddleware, EventTrackerMiddleware, CORS)
        → Router (backend/routers/*.py) — 인증 의존성 주입
          → Service (backend/services/*.py) — 도메인 로직, 외부 API 호출
            → Storage / DB (backend/services/storage.py, backend/services/db.py)
              → PostgreSQL  (+ 인메모리/DB 캐시 계층)
```

각 라우터는 얇은 어댑터로, 인증·요청 검증만 담당하고 실제 작업은 서비스로 위임한다. 서비스는 `storage.py`(앱 도메인 테이블 읽기/쓰기)와 `db.py`(저수준 SQL 실행)를 통해 영속성에 접근한다.

## 진입점

### 백엔드 진입점 — `backend/main.py`

- `load_dotenv()`로 환경변수를 먼저 로드한다.
- `app = FastAPI(title="Stock Portfolio Manager", lifespan=lifespan)`로 앱을 생성한다.
- 미들웨어 등록 순서: `SessionMiddleware`(`SESSION_SECRET` 필수) → `EventTrackerMiddleware` → `CORSMiddleware`.
- CORS 허용 오리진: `http://localhost:3000`, `http://localhost:5173`, 그리고 `FRONTEND_URL` 환경변수(설정 시).
- 15개 라우터를 `app.include_router(...)`로 마운트한다. 마운트 순서: `auth → portfolio → report → watchlist → stocks → guru → calendar → digest → market_indicators → analytics → analysis → events → rankings → investor → admin`.
- `@app.api_route("/health", methods=["GET", "HEAD"])` 헬스체크 엔드포인트를 제공한다.

#### lifespan 훅 (`backend/main.py` `lifespan`)

- 시작 시: `sched.start()`로 스케줄러를 가동하고, `_warm_calendar_cache`(이번 달/다음 달 캘린더 캐시 워밍)와 `_warm_market_cache`(경제지표·KR 수출 캐시 워밍)를 각각 데몬 스레드로 백그라운드 실행한다.
- 종료 시: `sched.stop()`으로 스케줄러를 종료한다.

### 프론트엔드 진입점 — `frontend/src/main.jsx` → `frontend/src/App.jsx`

- `App.jsx`가 최상위 컴포넌트로, OAuth 콜백 처리(`?oauth=`, `?token=&refresh=`), 세션 부트스트랩(localStorage의 `access_token`), 미인증 시 `LoginPage` 렌더를 담당한다.
- 인증된 경우 `ToastProvider → AuthProvider → BrowserRouter` 순으로 감싸고, `TopNav`(PC) / `MobileNav`(모바일) 네비게이션과 라우트를 렌더한다.
- 최상위 라우트는 5개 허브로 축소되어 있다: `/`(Portfolio), `/research`(Research), `/market`(MarketHub), `/guru`(Guru), `/settings`(Settings). 추가로 admin 전용 `/admin-analytics`, 개발용 `/dev/showcase`, 그리고 레거시 `/analysis`는 `/`로 리다이렉트된다.

## 요청 생명주기 (Request Lifecycle)

1. **nginx** (`nginx/nginx.conf`)가 포트 80에서 수신한다. `/api/`와 `/health`는 `http://backend:8000`으로 프록시하고, 나머지는 `try_files $uri /index.html`로 SPA 정적 자산을 서빙한다. `index.html`과 서비스워커(`sw.js`, `workbox-*.js`)는 캐시 금지, Vite 해시 파일명 자산(`.js/.css/...`)은 `max-age=31536000, immutable`로 장기 캐시한다.
2. **CORS / Session / EventTracker 미들웨어**가 차례로 적용된다. `EventTrackerMiddleware`(`backend/middleware/event_tracker.py`)는 특정 라우트(`POST /api/portfolio`, `DELETE /api/watchlist/{t}`, `POST /api/report/generate/{t}` 등 `_TRACKED` 목록)에 대해 2xx 응답 시 `Authorization` 헤더의 JWT에서 `sub`를 추출하고, `asyncio.create_task`로 `user_events` 테이블에 비동기 기록한다(응답을 막지 않음).
3. **인증**: 라우터 핸들러는 `Depends(get_current_user)`로 JWT를 검증한다(`backend/auth.py`). `HTTPBearer`로 받은 토큰을 `JWT_SECRET` + HS256으로 디코드하고 `payload["sub"]`를 `user_id`로 반환한다. 외부 Claude Cowork API용 라우트는 `get_current_user_or_api_key`(`X-API-Key` 헤더 또는 JWT)를 사용하고, 관리자 전용은 `require_admin` / `require_admin_or_api_key`로 role을 검사한다.
4. **라우터 → 서비스 위임**: 예) `backend/routers/stocks.py`는 `services.storage`, `services.market`, `services.scraper`, `services.cache`를 조합해 종목 조회/검색/enrich를 처리한다. 스냅샷 조회는 `_latest_snapshot()`이 DB(`snapshots` 테이블)를 먼저 보고, 없으면 파일시스템(`backend/snapshots/`, `backend/reports/`)으로 폴백한다.
5. **영속성**: 서비스는 `services/storage.py`의 도메인 함수(예: `get_stocks(user_id)`, `save_stocks(...)`)를 호출하고, 이들이 `services/db.py`의 `query()`/`execute()`/`get_connection()`을 통해 PostgreSQL과 통신한다.

## 데이터 접근 계층

### `backend/services/db.py`

- `psycopg2.pool.ThreadedConnectionPool`(minconn=1, maxconn=10)을 지연 초기화(lock 보호)한다. DSN은 `DATABASE_URL` 환경변수.
- `get_connection()`은 컨텍스트 매니저로, 정상 종료 시 `commit()`, 예외 시 `rollback()` 후 항상 커넥션을 풀에 반환한다.
- `query(sql, params)`는 `RealDictCursor`로 dict 리스트를 반환, `execute(sql, params)`는 영향 행 수를 반환한다.
- **풀 한계(maxconn=10)는 병렬 작업의 상한을 좌우한다.** 예: `backend/scheduler.py`의 `_fetch_investor_trend`는 워커가 커넥션을 점유하므로 `ThreadPoolExecutor(max_workers ≤ 8)`로 제한한다(PoolError 방지).

### `backend/services/storage.py`

- 앱 도메인 테이블(`tickers`, `user_stocks`, `schedules`, `guru_managers`, `guru_schedules` 등)에 대한 도메인 함수 집합.
- `tickers`는 공유 종목 마스터, `user_stocks`는 user_id별 보유/관심 종목을 매핑(JOIN으로 결합). `moat/growth_plan/risks/recent_disclosures/insights` 등 일부 text 컬럼은 JSON 객체로 저장될 수 있어 `_parse_json_field`로 역파싱한다.

## 핵심 추상화

### 캐싱 계층 (이중 구조)

**1) 인메모리 캐시 — `backend/services/cache.py`**

- `TTLCache` 클래스(생성 시 ttl/maxsize). 만료 항목은 maxsize 초과 시 정리.
- 캐시 인스턴스: 스냅샷 LRU(`_snapshots`, `OrderedDict`, `_MAX=50`), `_list_cache`(TTL 60s), `_dashboard_cache`(TTL 300s), `_correlation_cache`(TTL 300s), `_sector_cache`(TTL 300s), `_macro_cache`(TTL 300s).
- 종목 변경 시 `invalidate(ticker)`가 스냅샷·list·dashboard·correlation·sector·macro 캐시를 일괄 무효화하고, `invalidate_portfolio_caches()`는 캘린더 파일 캐시까지 함께 비운다.

**2) 인메모리 + PostgreSQL 영구 캐시 — `backend/services/market_indicators/cache.py`**

- 시장지표(FX/VIX/원자재/국채/경제지표/실적/수출)용. `_get_cache`/`_set_cache`로 프로세스 내 TTL 캐시를, `_mc_load`/`_mc_save`/`_mc_delete`로 PostgreSQL `market_cache` 테이블(`key, data, fetched_at`, ON CONFLICT upsert)을 다룬다.
- `get_or_refresh(key, fetch_fn, ttl, force)`: 인메모리 → DB(`market_cache`) → `fetch_fn()` 순으로 조회. `fetch_fn`이 저장까지 책임진다.
- `_yf_close_history`/`_merge_history`는 yfinance에서 **마지막 저장 날짜 이후만 incremental fetch**해 기존 시계열과 병합·트림(366일)·아웃라이어 필터링한다. `_filter_outliers`는 중앙값 대비 5배 이탈 제거.

### market_indicators 서브패키지 (`backend/services/market_indicators/`)

`__init__.py`가 퍼사드(facade) 역할로 서브모듈 공개 함수를 재노출한다: `fx.py`(`get_fx`/`get_vix`), `commodities.py`(`get_commodities`/`get_treasury`), `earnings.py`(`get_m7_earnings`/`get_kr_top2_earnings` + `_fetch_and_save_*`), `econ.py`(FRED 경제지표), `exports.py`(KR 수출), `cache.py`. `backend/routers/market_indicators.py`는 이 퍼사드를 통해서만 접근한다.

### 리포트 생성 (`backend/services/report_generator.py`)

- `generate_report(stock, output_base_dir, target_date)`가 핵심 함수. `services.market`(yfinance + Naver), `services.indicators`(RSI 등), `services.scraper`를 조합해 종목별 데이터를 수집하고, `services.utils.sanitize`로 NaN/Inf를 정제한 뒤 `services.db.execute`로 `snapshots` 테이블에 저장한다.
- `backfill_ticker(...)`는 과거 N일 백필용. ThreadPoolExecutor로 병렬화.

## 스케줄러 작업 (`backend/scheduler.py`)

- `AsyncIOScheduler`(APScheduler) 단일 인스턴스. `start()`에서 모든 cron 작업을 등록하고 `_scheduler.start()`. lifespan 시작 시 `main.py`가 호출.
- DB의 설정 행(`schedules`, `guru_schedules`)을 읽어 동적 재스케줄(`_reschedule`, `_reschedule_guru`)한다. `reload()`/`reload_guru()`로 설정 변경 시 외부에서 재적용 가능.
- 기동 보정 로직: `_check_missed_report`(당일 스케줄 시각이 지났는데 `snapshots`에 당일 데이터가 없으면 즉시 `_generate_all` 실행), `_seed_rankings_if_empty`(`market_rankings`가 비어 있으면 즉시 1회 적재).
- 주요 cron 작업:
  - `_generate_all`(daily_report): DB 설정 시각(KST)에 전 사용자 보유 종목 리포트 생성 + `consensus_pipeline.run_daily`. `misfire_grace_time=82800`, `coalesce=True`.
  - `_run_guru_crawl`(guru_crawl): 설정된 요일/시각에 구루 크롤링.
  - `_run_digest`(daily_digest): 매일 08:00 KST 사용자별 다이제스트 생성 + 텔레그램 전송.
  - `_refresh_earnings`: 매주 일 03:00 KST M7/KR Top2 실적 갱신.
  - `_refresh_monthly`: 매월 1일 02:00 KST 경제지표·KR 수출 갱신.
  - `_fetch_leverage`: 매일 07:00 KST 신용잔고/반대매매 적재.
  - `_fetch_lending`: 매월 5일 08:00 KST 대차잔고 적재.
  - `_fetch_kr_rankings`: 장중 09–15시 KST 매 10분 KR 랭킹 갱신.
  - `_fetch_us_rankings`: 장중 09–16시 America/New_York 매 10분 US 랭킹 갱신.
  - `_fetch_investor_trend`: 매일 18:00 KST KR 랭킹 종목 수급 전진 적립 + 종목당 1청크 후진 백필(1년 캡), `ThreadPoolExecutor(max_workers ≤ 8)`.

## 프론트엔드 데이터 흐름

- `frontend/src/api.js`: axios 인스턴스. `baseURL`은 `VITE_API_BASE_URL`(미설정 시 상대경로 — Vite dev proxy가 `/api/*`를 `localhost:8000`으로). 요청 인터셉터가 localStorage `access_token`을 `Authorization: Bearer`로 부착하고, 응답 401 시 토큰을 비우고 `/`로 리다이렉트한다.
- `frontend/src/contexts/AuthContext.jsx`: 로그인 시 `GET /api/auth/me`를 호출해 `role`과 `menu_permissions`를 로드한다. `App.jsx`의 `TopNav`가 `menuPermissions`로 네비게이션 항목을 필터링하고, admin이면 `/admin-analytics`를 추가 노출한다.
- 페이지는 허브 패턴: `Portfolio`, `Research`(리포트·캘린더·다이제스트 탭), `MarketHub`(시장지표·분석 탭), `Guru`, `Settings`. 데이터 페칭은 `frontend/src/hooks/`의 커스텀 훅(`usePortfolioData`, `useReportList`, `useReportGeneration` 등)으로 캡슐화된다.

## 배포 토폴로지

`docker-compose.yml` 기준 4개 서비스:

- **postgres** (`postgres:16-alpine`): DB `portfolion`. 볼륨 `pgdata`로 영속. init 시 `backend/auth_schema.sql` → `backend/app_schema.sql` 순서로 자동 적용(`01-auth.sql`, `02-app.sql`로 마운트). healthcheck `pg_isready`.
- **backend** (`build: ./backend`, `backend/Dockerfile` = python:3.12-slim + uvicorn): postgres healthy 후 기동. `backend/.env.docker`를 env_file로 주입.
- **nginx** (`nginx:alpine`): 포트 80/443. `frontend/dist`(빌드 산출물)와 `nginx/nginx.conf`를 read-only 마운트. backend 의존.
- **certbot**: Let's Encrypt 갱신(현재 nginx.conf의 443 블록은 주석 처리, 외부 접속은 Cloudflare Tunnel `portfolion.taebro.com` → `localhost:80`).

배포는 `git push origin main` 시 자동으로 이루어진다(수동 `docker compose build`/`up` 금지). launchd가 cloudflared + docker compose 자동 실행을 담당한다.

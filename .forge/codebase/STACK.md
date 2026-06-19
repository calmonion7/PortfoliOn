---
last_mapped_commit: 163c29cbd89d9b1d2aa5a101670e9fa34ceb21c4
mapped: 2026-06-19
---

# STACK — 기술 스택 (언어/런타임/프레임워크/의존성/설정)

PortfoliOn은 Python/FastAPI 백엔드 + React/Vite 프론트엔드 + PostgreSQL을 Mac 로컬 Docker 컨테이너로 운영하는 풀스택 앱이다.

## 1. 백엔드 (Python / FastAPI)

### 런타임
- **언어/런타임**: Python. Docker 이미지는 `python:3.12-slim` (`backend/Dockerfile`). 단, 로컬 가상환경 `backend/.venv/`는 **Python 3.9.6** (`backend/.venv/pyvenv.cfg`) — 버전이 다르므로 로컬 검증 시 주의.
- **앱 엔트리**: `backend/main.py` — `FastAPI(title="Stock Portfolio Manager")`. `lifespan` 컨텍스트매니저에서 `_migrate()`(기동 시 idempotent DDL) → `sched.start()`(스케줄러) → 캘린더/마켓 캐시 워밍 스레드 기동.
- **ASGI 서버**: `uvicorn`. Docker `CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8000"]` (`backend/Dockerfile`). `backend/Procfile`에도 `web: uvicorn main:app --host 0.0.0.0 --port $PORT` (레거시 PaaS용).
- **로컬 실행**: `cd backend && python -m uvicorn main:app --reload --port 8000`.

### 주요 의존성 (`backend/requirements.txt`)
- `fastapi>=0.104.0` — 웹 프레임워크
- `uvicorn[standard]>=0.24.0` — ASGI 서버
- `apscheduler>=3.10.4` — 배치 스케줄러 (`backend/scheduler.py`에서 `AsyncIOScheduler` + `CronTrigger` 사용, timezone `Asia/Seoul`)
- `yfinance>=0.2.40` — 미국 시세/배당/컨센서스 데이터 소스
- `pandas>=2.1.0`, `numpy>=1.26.0` — 데이터 처리
- `matplotlib>=3.8.0` — 차트 렌더 (`services/charts.py`)
- `requests>=2.31.0` — 외부 API 호출 (Naver/DART/FRED/KOFIA/관세청/키움/KIS)
- `beautifulsoup4>=4.12.0`, `lxml>=4.9.0` — HTML/XML 파싱. **주의: `lxml`은 Docker엔 설치되나 로컬 `.venv`엔 없음** — 로컬 코드는 `BeautifulSoup(html, "html.parser")`를 써야 함 (`backend/services/backlog.py` 주석 확인).
- `httpx>=0.25.0` — 비동기 HTTP 클라이언트 (OAuth 토큰 교환 등 `backend/routers/auth.py`)
- `exchange_calendars>=4.5` — 거래소 캘린더
- `psycopg2-binary>=2.9.0` — PostgreSQL 드라이버
- `authlib>=1.3.0` — OAuth 처리
- `python-jose[cryptography]>=3.3.0` — JWT 인코딩/디코딩 (`jose.jwt`, HS256)
- `bcrypt>=4.0.0` — 비밀번호 해싱 (`backend/services/auth_service.py`)
- `itsdangerous>=2.0.0` — `SessionMiddleware`용
- `python-dotenv` — `.env` 로드 (`load_dotenv()` in `main.py`)
- `pytest>=7.4.0` — 테스트

> 참고: `requirements.txt`에 **anthropic 라이브러리는 없음** — 백엔드에 LLM 호출 없음. `ANTHROPIC_API_KEY`는 `.env.docker`에 존재하나 코드 미사용.

### 미들웨어 (`backend/main.py`)
- `SessionMiddleware` (starlette, `secret_key=SESSION_SECRET`)
- `EventTrackerMiddleware` (`backend/middleware/event_tracker.py`) — 사용자 행동 이벤트 수집
- `CORSMiddleware` — origin: `http://localhost:3000`, `http://localhost:5173`, `FRONTEND_URL` env

### 라우터 (`backend/routers/`, `main.py`가 include)
auth, portfolio, report, watchlist, stocks, guru, calendar, digest, market_indicators, analytics, analysis, events, rankings, investor, short_sell, batches, recommendations, admin. `/health` 엔드포인트는 `main.py`에 직접 정의.

### 서비스 계층 (`backend/services/`)
storage, market, charts, indicators, report_generator, scraper, consensus, consensus_pipeline, cache, guru_scraper, guru_stats, digest_service, leverage_service, lending_service, analysis_service, auth_service, db, errors, parallel, progress, job_runs, batch_registry, schedule_spec, ranking_service, investor_service, short_sell_service, kr_sector_service, backlog, disclosures, dividends, supply_score, **insider_trades** (신규), utils.
- 패키지: `services/market_indicators/` (cache, fx, commodities, earnings, econ, exports, macro), `services/kiwoom/` (client, quote, chart, sector, investor, shortsell), `services/kis/` (client, quote), **`services/recommendation/`** (신규: universe, scoring, funnel, store, actions).

### DB 접근 (`backend/services/db.py`)
- `psycopg2` `ThreadedConnectionPool` (minconn=1, **maxconn=20** — calendar/analysis ThreadPool 동시성보다 크게). DSN은 `DATABASE_URL` env.
- `query(sql, params)` (RealDictCursor) / `execute(sql, params)` 헬퍼.

### 스케줄러 (`backend/scheduler.py`)
- `apscheduler.schedulers.asyncio.AsyncIOScheduler` + `CronTrigger`, timezone `Asia/Seoul`.
- 배치 정의는 `services/batch_registry.py`의 `BATCHES`, 트리거 빌드는 `services/schedule_spec.py`, 실행 이력은 `services/job_runs.py`(`job_runs` 테이블).
- 마이그레이션: `main.py._migrate()`가 기동 시 `ADD COLUMN IF NOT EXISTS`/`CREATE TABLE IF NOT EXISTS`로 idempotent 적용. 별도 `backend/migrations/` 디렉터리도 존재.

### 테스트
- `pytest`. `backend/pytest.ini`: `testpaths = tests`, `pythonpath = .`. 테스트는 `backend/tests/`.
- 실행: `cd backend && .venv/bin/python -m pytest`.

---

## 2. 프론트엔드 (React 19 / Vite)

### 런타임/빌드
- **React 19** (`react@^19.2.5`, `react-dom@^19.2.5`).
- **Vite 8** (`vite@^8.0.10`) — **rolldown 번들러**. `frontend/vite.config.js`의 `build.rollupOptions.output.manualChunks`는 **함수 형식만** 받음(객체형 미지원). 청크: `charts`(recharts/d3/victory-vendor), `markdown`(react-markdown/remark/rehype 등), `vendor`.
- 플러그인: `@vitejs/plugin-react@^6.0.1`, `vite-plugin-pwa@^1.3.0` (PWA — autoUpdate, workbox runtimeCaching: google-fonts/cdn-fonts/api-cache NetworkFirst).
- 커스텀 빌드 플러그인 `sw-cache-bust` (closeBundle): `index.html`·`registerSW.js`의 SW/manifest URL에 BUILD_DATE 쿼리 부착(캐시 버스팅).
- 스타일: **plain CSS** (TailwindCSS 없음). 토큰: `frontend/src/styles/tokens.css` (KR 색 관례: `--up`=빨강/`--down`=파랑).

### 스크립트 (`frontend/package.json`)
- `dev`: vite (port 5173), `build`: vite build, `lint`: eslint, `preview`: vite preview.
- 로컬 빌드(`npm run build` → `frontend/dist`)는 nginx 볼륨마운트로 즉시 라이브.

### 주요 의존성 (`frontend/package.json`)
- `axios@^1.16.0` — HTTP 클라이언트 (`frontend/src/api.js`, baseURL = `VITE_API_BASE_URL || ''`)
- `react-router-dom@^7.14.2` — 라우팅
- `recharts@^3.8.1` — 차트
- `react-markdown@^10.1.0` + `remark-gfm@^4.0.1` — 마크다운 렌더
- devDeps: eslint 10, `@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `@vite-pwa/assets-generator`, `globals`.

### 개발 서버 프록시 (`frontend/vite.config.js`)
- `server.proxy['/api']` → `http://localhost:8000` (changeOrigin). watch는 usePolling(interval 500).

---

## 3. 인프라 / 배포 (Docker)

### docker-compose (`docker-compose.yml`) — 4 컨테이너
1. **postgres**: `postgres:16-alpine`. DB `portfolion`, user `portfolion`, 비번 `${POSTGRES_PASSWORD}`. port 5432. 볼륨 `pgdata`. 초기화 스크립트 마운트: `auth_schema.sql`→`/docker-entrypoint-initdb.d/01-auth.sql`, `app_schema.sql`→`02-app.sql` (auth 먼저 실행). healthcheck `pg_isready`.
2. **backend**: `build: ./backend`. `depends_on: postgres(healthy)`. `env_file: ./backend/.env.docker`.
3. **nginx**: `nginx:alpine`. port 80/443. 볼륨: `./frontend/dist`(`:ro`, 프론트 서빙), `./nginx/nginx.conf`(`:ro`), certbot conf/www(`:ro`).
4. **certbot**: `certbot/certbot`. entrypoint가 12h마다 `certbot renew` 루프.

> compose 외부: **Cloudflare Tunnel**(`cloudflared`, launchd 실행 — compose 컨테이너 아님), **launchd 자동실행**(cloudflared + docker compose), **자동 배포 폴러**(`scripts/auto-deploy-poll.sh`, launchd `com.portfolion.auto-deploy-poll`, 2분마다 `git reset --hard origin/main`).

### nginx (`nginx/nginx.conf`)
- HTTP(80) 서빙. `/api/` 및 `/health` → `http://backend:8000` 프록시. `/` → `frontend/dist`의 SPA fallback(`try_files $uri /index.html`).
- 캐시 정책: `index.html`·`sw.js`/`workbox-*.js`는 no-cache, 해시 파일명(js/css/이미지/woff)은 1년 immutable.
- 443 ssl 서버 블록은 주석 처리됨(현재 HTTPS는 Cloudflare Tunnel 경유).

### 배포 흐름
- `git push origin main` 시 자동 배포(`docker compose build/up` 수동 금지). 프론트는 로컬 `npm run build`가 즉시 라이브, 백엔드 변경은 폴러 재배포 후 라이브.
- `deploy.sh` (루트), Windows `start.bat`/`stop.bat`, macOS/Linux `start.sh`/`stop.sh` 보조 스크립트.

### 환경변수 (값 아님, **이름만**)
- **`backend/.env.docker`** (운영): `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ANTHROPIC_API_KEY`(미사용), `FRED_API_KEY`, `KITA_API_KEY`, `KOFIA_API_KEY`, `DART_API_KEY`, `FRONTEND_URL`, `COWORK_API_KEY`, `KIWOOM_BASE_URL`, `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY`, `KIS_APP_KEY`, `KIS_APP_SECRET`.
- **`backend/.env.docker.example`**(템플릿): 위 중 일부 + `KIS_APP_KEY`/`KIS_APP_SECRET`. (예제엔 `KOFIA_API_KEY`/`DART_API_KEY`/`COWORK_API_KEY`/`KIWOOM_*`가 빠져 있어 실제 `.env.docker`와 드리프트.)
- **루트 `.env`** (docker-compose 보간): `FRED_API_KEY`, `KITA_API_KEY`.
- **`backend/.env`** (레거시/로컬): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `JWT_SECRET`, `SESSION_SECRET`, `DATABASE_URL` (Supabase 키는 Docker 전환으로 사실상 레거시).
- **프론트엔드**: `VITE_API_BASE_URL` (미설정 시 상대경로) — `frontend/src/api.js`, `App.jsx`, `pages/LoginPage.jsx`.

> 보안: 위는 모두 **변수명**이며 실제 시크릿 값은 본 문서에 미수록.

---
last_mapped_commit: 8e37e2ca03c09e76a31dd227d4c252f19246a11a
mapped: 2026-07-14
---

# STACK

PortfoliOn의 언어·런타임·프레임워크·주요 의존성·빌드/설정을 정리한 기술 스택 지도.

## Backend

- **언어/런타임**: Python 3.12 (`backend/Dockerfile`가 `python:3.12-slim` 기반). 로컬 가상환경 `backend/.venv/`.
- **웹 프레임워크**: FastAPI (`fastapi>=0.104.0`). 앱 진입점 `backend/main.py` — `FastAPI(title="Stock Portfolio Manager", lifespan=lifespan)`. 라우터 17개를 `app.include_router(...)`로 마운트(`routers/` 하위: auth, portfolio, report, watchlist, stocks, guru, calendar, digest, market_indicators, analytics, analysis, events, rankings, investor, short_sell, batches, recommendations, admin).
- **ASGI 서버**: uvicorn (`uvicorn[standard]>=0.24.0`). 컨테이너 CMD `uvicorn main:app --host 0.0.0.0 --port 8000`, 로컬은 `--reload --port 8000`.
- **스케줄러**: APScheduler (`apscheduler>=3.10.4`). `backend/scheduler/` **패키지**(`__init__.py` 잡 배선·`jobs.py` 잡 함수·`schedule.py` 트리거·`_state.py`). `_state.py`가 `AsyncIOScheduler()` 인스턴스 보유, `schedule.py`가 `apscheduler.triggers.cron.CronTrigger`로 `Asia/Seoul` 타임존 크론 배선. `main.py` `lifespan`에서 `sched.start()`/`sched.stop()`.
- **DB 드라이버**: `psycopg2-binary>=2.9.0`. `backend/services/db.py`가 `ThreadedConnectionPool(minconn=1, maxconn=20)`로 커넥션 풀 관리, `query`/`execute`/`execute_many`(psycopg2 `execute_batch`) 헬퍼 제공. DSN은 `DATABASE_URL` env.
- **HTTP 클라이언트**: `requests>=2.31.0`(동기, 외부 시세/API 호출 대부분), `httpx>=0.25.0`(비동기, OAuth 토큰 교환 `routers/auth.py`).
- **데이터 처리**: `pandas>=2.1.0`, `numpy>=1.26.0` (시세 시계열·지표 계산). `exchange_calendars>=4.5`(거래일 판정).
- **HTML 파싱**: `beautifulsoup4>=4.12.0` + `lxml>=4.9.0`. 주의: `lxml`은 Docker 이미지에만 있고 로컬 `.venv`에는 없어 로컬 검증 코드는 `html.parser` 사용.
- **인증 라이브러리**: `python-jose[cryptography]>=3.3.0`(JWT HS256), `bcrypt>=4.0.0`(비밀번호 해시), `authlib>=1.3.0`, `itsdangerous>=2.0.0`(세션 서명), `python-dotenv`(`.env` 로드).
- **테스트**: `pytest>=7.4.0`. 실행 `cd backend && .venv/bin/python -m pytest`. 테스트는 `backend/tests/`, conftest `_block_real_db` autouse 가드가 실 DB 접근 차단.
- **로깅**: 표준 `logging`. `main.py:_configure_logging()`이 기동 시 1회 `basicConfig(level=INFO)` 배선 + urllib3/yfinance/apscheduler/asyncio를 WARNING으로 억제 + uvicorn 로거 `propagate=False`.
- **미들웨어**: `starlette.middleware.sessions.SessionMiddleware`(`SESSION_SECRET`), 커스텀 `middleware/event_tracker.py`의 `EventTrackerMiddleware`, `CORSMiddleware`.

## Frontend

- **프레임워크**: React 19 (`react`/`react-dom` `^19.2.5`). 라우팅 `react-router-dom` `^7.14.2`.
- **빌드 도구**: Vite 8 (`vite` `^8.0.10`) — **rolldown 번들러**. `frontend/vite.config.js`의 `build.rollupOptions.output.manualChunks`는 **함수 형식만** 지원(id substring으로 `charts`(recharts/d3/victory-vendor)·`vendor` 분할). 플러그인 `@vitejs/plugin-react` `^6.0.1`.
- **차트**: `recharts` `^3.8.1`.
- **HTTP 클라이언트**: `axios` `^1.16.0`. `frontend/src/api.js`가 axios 인스턴스 생성(`baseURL: import.meta.env.VITE_API_BASE_URL || ''`), request 인터셉터로 `localStorage`의 `access_token`을 `Authorization: Bearer`로 첨부, response 인터셉터로 401 시 토큰 제거 후 `/`로 리다이렉트.
- **스타일**: plain CSS(TailwindCSS 없음). `frontend/src/styles/`(tokens.css 등), `frontend/src/index.css`, `App.css`. 컴포넌트별 CSS 파일.
- **PWA**: `vite-plugin-pwa` `^1.3.0`. `vite.config.js`에서 `registerType: 'autoUpdate'`, workbox `runtimeCaching`(google-fonts CacheFirst, `/api/*` NetworkFirst 5분, `/api/auth/*` 제외), manifest(name `PortfoliOn`, `display: standalone`, `lang: ko`). 커스텀 `sw-cache-bust` 플러그인이 빌드 후 `index.html`/`registerSW.js`에 `BUILD_DATE` 쿼리스트링 캐시버스팅.
- **테스트**: `vitest` `^4.1.9` + `@testing-library/react`/`jest-dom`, `jsdom` 환경. 설정은 `vite.config.js`의 `test` 블록(`setupFiles: './src/test/setup.js'`). 실행 `npm run test`(`vitest run`).
- **린트**: ESLint (`eslint` `^10.2.1` + react-hooks/react-refresh 플러그인). `npm run lint`.
- **소스 구조**: `frontend/src/` — `pages/`, `components/`, `contexts/`(AuthContext 등), `hooks/`, `styles/`, `utils.js`, `main.jsx`, `App.jsx`, `api.js`.
- **개발 서버**: Vite dev 서버 포트 5173. `vite.config.js`의 `server.proxy`가 `/api` → `http://localhost:8000` 프록시, `watch.usePolling: true`.

## Infra (Docker)

- **구성**: `docker-compose.yml`이 정의하는 컨테이너 — `postgres`(`postgres:16-alpine`), `backend`(`./backend` 빌드), `nginx`(`nginx:alpine`), `certbot`(`certbot/certbot`). CLAUDE.md는 "4-컨테이너"로 지칭.
- **postgres**: DB `portfolion`, 유저 `portfolion`, 비밀번호 `${POSTGRES_PASSWORD}`. `pgdata` 볼륨. 초기화 시 `backend/auth_schema.sql`(01) → `backend/app_schema.sql`(02)을 `/docker-entrypoint-initdb.d/`에 마운트. 포트 5432 노출. `pg_isready` healthcheck.
- **backend**: `./backend` Dockerfile 빌드, `env_file: ./backend/.env.docker`, postgres healthy 조건 의존. (`deploy.sh`는 compose가 아니라 `docker run`으로 `portfolion-backend-1` 컨테이너를 별도 생성 — `docker compose ps`에 안 잡힘.)
- **nginx**: 포트 80/443. `frontend/dist`를 `:ro`로 직접 서빙, `nginx/nginx.conf` 마운트. 설정(`nginx/nginx.conf`): `/api/`·`/health` → `http://backend:8000` 프록시, `index.html`/`sw.js`는 no-cache, Vite 해시 정적자산은 1년 immutable 캐시, SPA fallback `try_files $uri /index.html`. 443 ssl 블록은 현재 주석 처리.
- **certbot**: HTTPS 인증서 자동 갱신(`certbot renew` 12시간 루프). `certbot/conf`·`certbot/www` 볼륨 공유.
- **배포 스크립트**: `deploy.sh` — ① `frontend` npm build → `frontend/dist`, ② `docker build` backend 이미지, ③ backend 컨테이너 stop/rm/run(`--env-file ./backend/.env.docker`), ④ nginx 컨테이너 재생성, 끝에 `curl localhost/health` 확인. 동시 배포 방지 `/tmp/portfolion-deploy.lock`.
- **배포 트리거**: `git push origin main` → self-hosted GitHub Actions 러너(`.github/workflows/deploy.yml`, `runs-on: self-hosted`, `bash deploy.sh` 실행)가 주 경로, `scripts/auto-deploy-poll.sh`(launchd 2분 폴러, `LOCAL != origin/main`이면 `git reset --hard origin/main` 후 `deploy.sh`)가 폴백.
- **프론트 서빙 특성**: nginx가 `frontend/dist`를 직접 서빙하므로 로컬 `npm run build`가 즉시 라이브. 백엔드 변경은 폴러/러너 재배포 후에야 반영.
- **Cloudflare Tunnel**: `portfolion.taebro.com` → `localhost:80`. `cloudflared`는 compose 컨테이너가 아니라 launchd로 실행.
- **launchd 자동실행**: cloudflared, docker compose, 자동배포 폴러(`com.portfolion.auto-deploy-poll`).
- **로컬 실행 스크립트**: `start.bat`/`stop.bat`(Windows), `start.sh`/`stop.sh`(macOS/Linux) — 백/프론트 동시 기동.

## Config files

- **`backend/.env.docker`**: 백엔드 컨테이너 런타임 env(gitignore). 키 이름 — `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`, `ANTHROPIC_API_KEY`(현재 백엔드 미사용), `FRED_API_KEY`, `KITA_API_KEY`, `KOFIA_API_KEY`, `DART_API_KEY`, `FRONTEND_URL`, `COWORK_API_KEY`, `KIWOOM_BASE_URL`/`KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`, `KIS_APP_KEY`/`KIS_APP_SECRET`. 템플릿은 `backend/.env.docker.example`.
- **`backend/.env`**: 로컬 백엔드 env(gitignore) — `DATABASE_URL`(localhost:5432 지향), `JWT_SECRET`, `SESSION_SECRET` 등. (레거시 Supabase 관련 키가 잔존하나 인프라는 Docker로 이전됨.)
- **루트 `.env`**: docker-compose 변수 보간용(`${POSTGRES_PASSWORD}` 등) 및 일부 로컬 API 키.
- **`docker-compose.yml`**: 위 4개 서비스 정의(루트).
- **`frontend/vite.config.js`**: Vite 빌드/PWA/프록시/manualChunks 설정. `VITE_API_BASE_URL`(미설정 시 상대경로)로 배포 환경 API 베이스 제어.
- **`nginx/nginx.conf`**: nginx 서빙/프록시 설정.
- **`backend/Dockerfile`**: `python:3.12-slim` + `pip install -r requirements.txt` + `uvicorn` CMD.
- **`backend/requirements.txt`**: 백엔드 파이썬 의존성.
- **`frontend/package.json`**: 프론트 의존성·스크립트(`dev`/`build`/`test`/`lint`/`preview`).
- **정적 참조 데이터**: `backend/data/`(sp500_tickers.json, kospi_tickers.json 등) — 런타임 데이터는 PostgreSQL.

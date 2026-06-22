---
last_mapped_commit: b6193c3837f4125a41930c36a2b3ae2ef198dc3c
mapped: 2026-06-22
---

# STACK

PortfoliOn은 Python/FastAPI 백엔드와 React 19/Vite 프론트엔드로 구성된 모노레포이며, Mac 로컬 Docker 4-컨테이너로 배포된다.

## Languages & Runtimes

| 영역 | 언어/런타임 | 버전 | 근거 |
|------|------------|------|------|
| Backend | Python | 3.12 (`python:3.12-slim` 베이스) | `backend/Dockerfile` |
| Frontend | JavaScript (ESM, `"type": "module"`) | — | `frontend/package.json` |
| DB | PostgreSQL | 16 (`postgres:16-alpine`) | `docker-compose.yml` |

## Backend — Python / FastAPI

엔트리포인트는 `backend/main.py`로, FastAPI 앱에 라우터·미들웨어·스케줄러를 마운트한다. 서버는 `uvicorn main:app`(포트 8000)으로 기동한다.

### 핵심 의존성 (`backend/requirements.txt`)

| 패키지 | 버전 제약 | 용도 |
|--------|----------|------|
| `fastapi` | >=0.104.0 | 웹 프레임워크 |
| `uvicorn[standard]` | >=0.24.0 | ASGI 서버 |
| `apscheduler` | >=3.10.4 | 배치 스케줄러 (`backend/scheduler.py`) |
| `yfinance` | >=0.2.40 | US 시세·히스토리 1차 소스 |
| `pandas` | >=2.1.0 | 데이터프레임/시계열 |
| `numpy` | >=1.26.0 | 수치 계산 |
| `matplotlib` | >=3.8.0 | 차트 생성 (`backend/services/charts.py`) |
| `requests` | >=2.31.0 | 동기 HTTP (키움/KIS/DART/KOFIA 등 외부 호출) |
| `httpx` | >=0.25.0 | 비동기 HTTP (OAuth 토큰 교환, `backend/routers/auth.py`) |
| `beautifulsoup4` | >=4.12.0 | HTML 파싱 (FnGuide/스크레이퍼) |
| `lxml` | >=4.9.0 | XML/HTML 파서 (Docker 이미지 한정 — 로컬 `.venv` 미설치, `html.parser` 사용) |
| `exchange_calendars` | >=4.5 | 거래소 영업일 계산 |
| `psycopg2-binary` | >=2.9.0 | PostgreSQL 드라이버 (`backend/services/db.py` 풀) |
| `authlib` | >=1.3.0 | OAuth 유틸 |
| `python-jose[cryptography]` | >=3.3.0 | JWT 인코드/디코드 HS256 (`backend/services/auth_service.py`) |
| `bcrypt` | >=4.0.0 | 비밀번호 해시 |
| `itsdangerous` | >=2.0.0 | 세션/서명 (Starlette SessionMiddleware) |
| `python-dotenv` | (제약 없음) | `.env` 로드 |
| `pytest` | >=7.4.0 | 백엔드 테스트 (`backend/tests/`) |

> 주의: `anthropic` 패키지는 `requirements.txt`에 **없다** — 백엔드에 LLM 호출 없음. AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API로 작성한다.

### DB 연결 (`backend/services/db.py`)

`psycopg2` `ThreadedConnectionPool`(minconn=1, maxconn=20), DSN은 `DATABASE_URL` env. `get_connection()` 컨텍스트매니저 + `query`/`execute` 헬퍼.

### 미들웨어 (`backend/main.py`)

- `SessionMiddleware` (Starlette) — `secret_key=SESSION_SECRET`
- `EventTrackerMiddleware` — 사용자 행동 로깅
- `CORSMiddleware` — origins: `localhost:3000`, `localhost:5173`, `FRONTEND_URL` env

마운트된 라우터: auth, portfolio, report, watchlist, stocks, guru, calendar, digest, market_indicators, analytics, analysis, events, rankings, investor, short_sell, batches, recommendations, admin.

### 테스트

`cd backend && .venv/bin/python -m pytest` (`backend/tests/`).

## Frontend — React 19 / Vite

### 의존성 (`frontend/package.json`)

런타임:
| 패키지 | 버전 |
|--------|------|
| `react` / `react-dom` | ^19.2.5 |
| `react-router-dom` | ^7.14.2 |
| `axios` | ^1.16.0 |
| `recharts` | ^3.8.1 (차트) |
| `react-markdown` | ^10.1.0 + `remark-gfm` ^4.0.1 (리포트 텍스트 렌더) |

개발/빌드:
| 패키지 | 버전 |
|--------|------|
| `vite` | ^8.0.10 (rolldown 번들러) |
| `@vitejs/plugin-react` | ^6.0.1 |
| `vite-plugin-pwa` | ^1.3.0 + `@vite-pwa/assets-generator` ^1.0.2 |
| `vitest` | ^4.1.9 + `jsdom` ^29.1.1 |
| `@testing-library/react` | ^16.3.2 + `@testing-library/jest-dom` ^6.9.1 |
| `eslint` | ^10.2.1 + `eslint-plugin-react-hooks` ^7.1.1 + `eslint-plugin-react-refresh` ^0.5.2 |

스크립트: `dev`(vite), `build`(vite build), `test`(vitest run), `lint`(eslint .), `preview`(vite preview). 플레인 CSS (TailwindCSS 미사용).

### 빌드 도구 설정 (`frontend/vite.config.js`)

- **Vite 8 = rolldown** — `build.rollupOptions.output.manualChunks`는 **함수 형식만** 받는다. `manualChunks(id)`가 `node_modules` 경로 substring으로 분기해 `charts`(recharts+d3+victory-vendor) / `markdown`(react-markdown+remark+micromark 등 트랜지티브) / `vendor` 청크로 분리.
- **PWA** — `VitePWA({ registerType: 'autoUpdate' })`. Workbox `runtimeCaching`: google-fonts·cdn-fonts(CacheFirst), `/api/*`(NetworkFirst, `/api/auth/*` 제외). `cacheId`에 빌드 타임스탬프 포함.
- **SW 캐시 버스팅 플러그인** (`sw-cache-bust`, custom) — `closeBundle` 후 `dist/index.html`·`registerSW.js`에 빌드 날짜 쿼리스트링 주입.
- **dev 서버** — 포트 5173, `/api` → `http://localhost:8000` 프록시, 파일워치 `usePolling`.
- **vitest** — `environment: jsdom`, `setupFiles: ./src/test/setup.js`.

배포 환경에서는 `VITE_API_BASE_URL` env로 nginx 직접 호출(미설정 시 상대경로).

## Build / Deploy Tooling

### Docker Compose (`docker-compose.yml`) — 4 컨테이너

| 서비스 | 이미지/빌드 | 내용 |
|--------|------------|------|
| `postgres` | `postgres:16-alpine` | DB `portfolion`. 포트 5432, `pgdata` 볼륨. 초기화 스크립트 `backend/auth_schema.sql`(01) → `backend/app_schema.sql`(02) 순서 마운트. healthcheck `pg_isready`. |
| `backend` | `build: ./backend` | FastAPI. `env_file: ./backend/.env.docker`. postgres healthy 의존. |
| `nginx` | `nginx:alpine` | 포트 80/443. `./frontend/dist`를 `:ro` 직접 서빙, `./nginx/nginx.conf`·certbot 볼륨 마운트. |
| `certbot` | `certbot/certbot` | HTTPS 인증서 자동 갱신 (12h 루프). |

nginx 설정(`nginx/nginx.conf`): 포트 80 서빙, `/api/` 및 `/health` → `http://backend:8000` 프록시, 정적 자산 캐싱, SPA fallback `location /`.

### 배포 자동화

- `git push origin main` 시 launchd `com.portfolion.auto-deploy-poll`(2분 폴, `scripts/auto-deploy-poll.sh`)이 `git reset --hard origin/main` 후 배포.
- 기동: `start.bat`(Windows) / `start.sh`(macOS/Linux), `scripts/start-docker-compose.sh`.
- Cloudflare Tunnel(`cloudflared`)은 compose 외부 launchd로 실행 (portfolion.taebro.com → localhost:80).

## Config Files

| 파일 | 역할 |
|------|------|
| `docker-compose.yml` | 4-컨테이너 오케스트레이션 |
| `backend/Dockerfile` | Python 3.12-slim 백엔드 이미지 |
| `backend/requirements.txt` | Python 의존성 |
| `backend/auth_schema.sql` | 인증 스키마 (users, refresh_tokens) — app_schema보다 먼저 |
| `backend/app_schema.sql` | 앱 스키마 (tickers, user_stocks, snapshots 등) |
| `frontend/package.json` | npm 의존성/스크립트 |
| `frontend/vite.config.js` | Vite 빌드/PWA/dev 프록시/청크 분할 |
| `nginx/nginx.conf` | nginx 라우팅/프록시 |
| `backend/.env.docker` | 백엔드 시크릿/설정 (compose `env_file`) |
| `.env` (루트) | docker-compose 보간용 (`POSTGRES_PASSWORD` 등) |

## Environment Variables — NAMES only (`backend/.env.docker`)

> 값은 절대 복사 금지. 변수 이름만.

- `DATABASE_URL`
- `JWT_SECRET`
- `SESSION_SECRET`
- `FRONTEND_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `DART_API_KEY`
- `FRED_API_KEY`
- `KOFIA_API_KEY`
- `KITA_API_KEY`
- `KIWOOM_APP_KEY`
- `KIWOOM_SECRET_KEY`
- `KIWOOM_BASE_URL`
- `KIS_APP_KEY`
- `KIS_APP_SECRET`
- `COWORK_API_KEY`
- `ANTHROPIC_API_KEY` (현재 백엔드 미사용)

> `.env` (루트, docker-compose 보간): `POSTGRES_PASSWORD` 등. `KIS_BASE_URL`은 코드 기본값 보유(`backend/services/kis/client.py`, 미설정 시 실전 도메인 `:9443`).

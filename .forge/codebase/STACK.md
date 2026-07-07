---
last_mapped_commit: a5fb8bc8fbb92ec9155e7bc20ba681388786bfcd
mapped: 2026-07-07
---

# STACK

PortfoliOn의 언어·런타임·프레임워크·의존성·설정·배포 스택 지도. 구체적 파일 경로 우선.

## Backend — Python / FastAPI

- 런타임: **Python 3.12** (`backend/Dockerfile` = `python:3.12-slim`). 로컬 개발용 가상환경 `backend/.venv/` (macOS 실행기 `backend/.venv/bin/python`, Windows `backend/.venv/Scripts/python`).
- 웹 프레임워크: **FastAPI ≥0.104** + **uvicorn[standard] ≥0.24** (`backend/requirements.txt`). 앱 진입점 `backend/main.py` (`main:app`), Docker CMD `uvicorn main:app --host 0.0.0.0 --port 8000` (`backend/Dockerfile`).
- 앱 배선 (`backend/main.py`): 최상단 `dotenv.load_dotenv()` → 라우터 18종 include (`auth, portfolio, report, watchlist, stocks, guru, calendar, digest, market_indicators, analytics, analysis, events, rankings, investor, short_sell, batches, recommendations, admin`) + `middleware/event_tracker.py`(`EventTrackerMiddleware`) + `starlette.middleware.sessions.SessionMiddleware`(`SESSION_SECRET`) + `CORSMiddleware`. `import scheduler as sched`로 APScheduler 패키지 배선.
- 기동 마이그레이션: `backend/main.py`의 `_migrate()` — idempotent DDL(`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`)을 기동 시 실행 (ADR-0006). 신규 컬럼/테이블은 `app_schema.sql`과 `_migrate` **둘 다** 반영해야 라이브 DB에 적용됨.
- 스케줄러: **APScheduler ≥3.10** (`backend/requirements.txt`). 루트 레벨 패키지 `backend/scheduler/`(`__init__.py` 잡 배선·`jobs.py`·`schedule.py`·`_state.py`) — 단일 파일 아님.
- 주요 의존성 (`backend/requirements.txt`, 전체):
  - 데이터/시세: `yfinance ≥0.2.40`, `pandas ≥2.1`, `numpy ≥1.26`, `exchange_calendars ≥4.5`
  - HTTP/스크래핑: `requests ≥2.31`, `httpx ≥0.25`, `beautifulsoup4 ≥4.12`, `lxml ≥4.9`
  - DB: `psycopg2-binary ≥2.9`
  - 인증: `authlib ≥1.3`(OAuth), `python-jose[cryptography] ≥3.3`(JWT), `bcrypt ≥4.0`, `itsdangerous ≥2.0`(세션 서명)
  - 기타: `python-dotenv`, `pytest ≥7.4`
- **anthropic/LLM 패키지 없음** — 백엔드는 시세 스냅샷만 생성, AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API로 작성. (`ANTHROPIC_API_KEY`는 `.env.docker`에 잔존하나 현재 미사용.)
- **로컬 `.venv` ≠ Docker 의존성**: `lxml`은 Docker 이미지엔 있으나 로컬 `backend/.venv`엔 없음 → 로컬 pytest로 검증할 HTML 파싱은 `BeautifulSoup(html, "html.parser")` 사용.
- 테스트: `cd backend && .venv/bin/python -m pytest` (테스트는 `backend/tests/`).
- 서비스 계층 구조 (`backend/services/`): 단일 파일 다수 + 패키지 — `kiwoom/`(client·quote·chart·investor·sector·shortsell), `kis/`(client·quote), `market/`(format·kr·us), `market_indicators/`(cache·fx·commodities·earnings·econ·exports·indices·macro·**sentiment**), `storage/`, `recommendation/`.

## Frontend — React 19 + Vite

- 런타임/프레임워크: **React 19.2** + **react-dom 19.2** (`frontend/package.json`). 라우팅 **react-router-dom 7.14**.
- 빌드/번들러: **Vite ^8.0.10** (`frontend/package.json`) — Vite 8 = **rolldown 번들러**. `@vitejs/plugin-react ^6`. 개발 포트 5173.
- ⚠️ **rolldown manualChunks는 함수형만 지원** (`frontend/vite.config.js:97` `manualChunks(id)`): `node_modules` substring 분기로 `recharts`/`/d3-`/`victory-vendor`→`charts` 청크, 나머지→`vendor`. rollup식 객체형(`{name:[pkgs]}`) 쓰면 빌드 파손.
- 주요 의존성 (`frontend/package.json`): `axios ^1.16`(HTTP), `recharts ^3.8`(차트 — dual Y-axis 패턴), `react-router-dom ^7.14`.
- **스타일: plain CSS (TailwindCSS 없음)** — `frontend/src/styles/tokens.css`(디자인 토큰, KR 색관례 `--up`=빨강/`--down`=파랑), 컴포넌트별 `.css`.
- PWA: `vite-plugin-pwa ^1.3` (`frontend/vite.config.js` — `registerType: autoUpdate`, workbox 런타임 캐싱: google-fonts/cdn-fonts CacheFirst, `/api/*`(auth 제외) NetworkFirst 5분/10s 타임아웃). `cacheId: portfolion-${BUILD_DATE}` + `sw-cache-bust` 커스텀 플러그인이 `BUILD_DATE`로 `registerSW.js`/`manifest.webmanifest`/`sw.js` 캐시 버스팅.
- 테스트: **Vitest ^4.1** + `@testing-library/react ^16` + `@testing-library/jest-dom ^6` + `jsdom ^29` (ADR-0019 프론트 테스트 하니스). `npm run test` = `vitest run`. 설정은 `frontend/vite.config.js`의 `test` 블록(`environment: jsdom`, `globals: true`, `setupFiles: ./src/test/setup.js`).
- 린트: ESLint ^10 (`@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`).
- 개발 프록시 (`frontend/vite.config.js` `server.proxy`): `/api` → `http://localhost:8000` (`changeOrigin`, `watch.usePolling`). 배포 시 `VITE_API_BASE_URL`(미설정 시 상대경로).

## 설정 파일

- `backend/.env.docker` — 백엔드 런타임 env (docker-compose `env_file`). 키 이름 목록: `DATABASE_URL, JWT_SECRET, SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, ANTHROPIC_API_KEY(현재 미사용), FRED_API_KEY, KITA_API_KEY, KOFIA_API_KEY, DART_API_KEY, FRONTEND_URL, COWORK_API_KEY, KIWOOM_BASE_URL, KIWOOM_APP_KEY, KIWOOM_SECRET_KEY, KIS_APP_KEY, KIS_APP_SECRET`. (`KIS_BASE_URL`은 `.env.docker`에 없고 `kis/client.py`가 기본 실전 도메인을 하드코딩, override 용으로만 읽음. 값은 절대 커밋 금지 — gitignore.)
- `.env` (루트) — docker-compose 변수 보간 및 일부 백엔드 키 보관용. 키 이름: `FRED_API_KEY`, `KITA_API_KEY` (+ compose가 참조하는 `POSTGRES_PASSWORD`는 미설정 시 `docker-compose.yml`의 `:-portfolion` 기본값).
- `frontend/vite.config.js` — Vite/PWA/프록시/청크/테스트 설정.
- `backend/Dockerfile` — `python:3.12-slim`, `WORKDIR /app`, `pip install --no-cache-dir -r requirements.txt`, `COPY . .`, `CMD uvicorn main:app`.
- `docker-compose.yml` — 서비스 정의(아래).
- 스키마: `backend/auth_schema.sql`(01) → `backend/app_schema.sql`(02) 순서 (INITDB 마운트).

## Docker 배포 스택

인프라: Mac 로컬 Docker (Render/Vercel/Supabase 미사용). `docker-compose.yml` 서비스 4종:

1. **postgres** — `postgres:16-alpine`, DB/USER `portfolion`·PASSWORD `${POSTGRES_PASSWORD:-portfolion}`, 포트 5432, `pgdata` 볼륨, `/docker-entrypoint-initdb.d/`에 `auth_schema.sql`(01)·`app_schema.sql`(02) 마운트, healthcheck `pg_isready`.
2. **backend** — `build: ./backend`, `env_file: ./backend/.env.docker`, postgres healthy 후 기동. (실제 라이브는 `deploy.sh`가 `docker run`으로 띄우는 `portfolion-backend-1` — `docker compose ps`에 안 잡힐 수 있음.)
3. **nginx** — `nginx:alpine`, 포트 80/443. `./frontend/dist` `:ro` 직접 서빙(→`npm run build`가 즉시 라이브), `./nginx/nginx.conf`·certbot 인증서(`./certbot/conf`, `./certbot/www`) 마운트. `/api/*` → `backend:8000` 프록시.
4. **certbot** — `certbot/certbot`, 12h마다 `certbot renew` 루프, `./certbot/conf`·`./certbot/www` 볼륨.

- **Cloudflare Tunnel** (`portfolion.taebro.com` → localhost:80): `cloudflared`는 compose 컨테이너가 아니라 **launchd**로 실행.
- **자동 배포**: `git push origin main` → GitHub Actions self-hosted 러너(주, `.github/deploy.yml`, 전용 러너 `~/actions-runner-portfolion`) + 폴러(`scripts/auto-deploy-poll.sh`, 폴백, launchd `com.portfolion.auto-deploy-poll`, 2분마다 `LOCAL != origin/main`이면 `git reset --hard` 후 `deploy.sh`). 정식 재기동 스크립트 = `bash deploy.sh`(프론트 빌드 → 백엔드 이미지 빌드 → 백엔드/nginx 컨테이너 stop/rm/run → `/health` 스모크). ad-hoc `docker compose build/up` 금지.
- 실행 스크립트: `start.bat`/`stop.bat`(Windows), `start.sh`/`stop.sh`(macOS/Linux), `deploy.sh`(배포 재빌드).

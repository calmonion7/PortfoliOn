---
last_mapped_commit: 739c39c3f628376219789fb8b7850076941dc69c
mapped: 2026-07-04
---

# STACK

PortfoliOn의 언어·런타임·프레임워크·의존성·설정·배포 스택 지도. 구체적 파일 경로 우선.

## Backend — Python / FastAPI

- 런타임: **Python 3.12** (`backend/Dockerfile` = `python:3.12-slim`). 로컬 개발용 가상환경은 `backend/.venv/` (macOS 실행기 `backend/.venv/bin/python`, Windows `backend/.venv/Scripts/python`).
- 웹 프레임워크: **FastAPI ≥0.104** + **uvicorn[standard] ≥0.24** (`backend/requirements.txt`). 앱 진입점 `backend/main.py` (`main:app`), Docker 실행 커맨드 `uvicorn main:app --host 0.0.0.0 --port 8000`.
- 앱 배선 (`backend/main.py` 상단): `dotenv.load_dotenv()` → 라우터 include (`portfolio, report, watchlist, stocks, guru, calendar, digest, analytics, market_indicators, analysis, auth, admin, events, rankings, investor, short_sell, batches, recommendations`) + `middleware/event_tracker.py`(`EventTrackerMiddleware`) + `starlette.middleware.sessions.SessionMiddleware` + CORS. `import scheduler as sched`로 APScheduler 패키지 배선.
- 기동 마이그레이션: `backend/main.py`의 `_migrate()` — idempotent DDL (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`)을 기동 시 실행 (ADR-0006). 신규 컬럼/테이블은 `app_schema.sql`과 여기 **둘 다** 반영해야 라이브 DB에 적용됨.
- 스케줄러: **APScheduler ≥3.10** (`backend/requirements.txt`). 루트 레벨 패키지 `backend/scheduler/`(`__init__.py` 잡 배선·`jobs.py`·`schedule.py`·`_state.py`) — 단일 파일 아님.
- 주요 의존성 (`backend/requirements.txt`):
  - 데이터/시세: `yfinance ≥0.2.40`, `pandas ≥2.1`, `numpy ≥1.26`, `exchange_calendars ≥4.5`
  - HTTP/스크래핑: `requests ≥2.31`, `httpx ≥0.25`, `beautifulsoup4 ≥4.12`, `lxml ≥4.9`
  - DB: `psycopg2-binary ≥2.9`
  - 인증: `authlib ≥1.3` (OAuth), `python-jose[cryptography] ≥3.3` (JWT), `bcrypt ≥4.0`, `itsdangerous ≥2.0` (세션 서명)
  - 기타: `python-dotenv`, `pytest ≥7.4`
- **anthropic/LLM 패키지 없음** — 백엔드는 시세 스냅샷만 생성, AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API로 작성.
- **로컬 `.venv` ≠ Docker 의존성**: `lxml`은 Docker 이미지엔 있으나 로컬 `backend/.venv`엔 없음 → 로컬 pytest로 검증할 HTML 파싱은 `BeautifulSoup(html, "html.parser")` 사용.
- 테스트: `cd backend && .venv/bin/python -m pytest` (테스트는 `backend/tests/`).
- 서비스 계층 구조 (`backend/services/`): 단일 파일 다수 + 패키지 4종 — `kiwoom/`(client·quote·chart·investor·sector·shortsell), `kis/`(client·quote), `market/`(format·kr·us), `market_indicators/`(cache·fx·commodities·earnings·econ·exports·indices·macro), `storage/`(dates·names·portfolio·schedule), `recommendation/`.

## Frontend — React 19 + Vite

- 런타임/프레임워크: **React 19.2** + **react-dom 19.2** (`frontend/package.json`). 라우팅 **react-router-dom 7.14**.
- 빌드/번들러: **Vite ^8.0.10** (`frontend/package.json`) — Vite 8 = **rolldown 번들러**. `@vitejs/plugin-react ^6`. 개발 포트 5173.
- ⚠️ **rolldown manualChunks는 함수형만 지원** (`frontend/vite.config.js:97` `manualChunks(id)`): `node_modules` substring 분기로 `recharts`/`/d3-`/`victory-vendor`→`charts` 청크, 나머지→`vendor`. rollup식 객체형(`{name:[pkgs]}`) 쓰면 빌드 파손.
- 주요 의존성: `axios ^1.16` (HTTP), `recharts ^3.8` (차트 — dual Y-axis 패턴), 그 외 라우터.
- **스타일: plain CSS (TailwindCSS 없음)** — `frontend/src/styles/tokens.css`(디자인 토큰, KR 색관례 `--up`=빨강/`--down`=파랑), 컴포넌트별 `.css`.
- PWA: `vite-plugin-pwa ^1.3` (`frontend/vite.config.js` — `registerType: autoUpdate`, workbox 런타임 캐싱: google-fonts/cdn-fonts CacheFirst, `/api/*`(auth 제외) NetworkFirst 5분). `cacheId`·`sw-cache-bust` 플러그인이 `BUILD_DATE`로 캐시 버스팅.
- 테스트: **Vitest ^4.1** + `@testing-library/react ^16` + `jsdom ^29` (ADR-0019 프론트 테스트 하니스). `npm run test` = `vitest run`. 설정은 `frontend/vite.config.js`의 `test` 블록 (`environment: jsdom`, `setupFiles: ./src/test/setup.js`).
- 린트: ESLint ^10 (`@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`).
- 개발 프록시 (`frontend/vite.config.js` `server.proxy`): `/api` → `http://localhost:8000`. 배포 시 `VITE_API_BASE_URL`(미설정 시 상대경로).

## 설정 파일

- `backend/.env.docker` — 백엔드 런타임 env (docker-compose `env_file`). 키 이름 목록: `DATABASE_URL, JWT_SECRET, SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, ANTHROPIC_API_KEY(현재 미사용), FRED_API_KEY, KITA_API_KEY, KOFIA_API_KEY, DART_API_KEY, FRONTEND_URL, COWORK_API_KEY, KIWOOM_BASE_URL, KIWOOM_APP_KEY, KIWOOM_SECRET_KEY, KIS_APP_KEY, KIS_APP_SECRET`. (값은 절대 커밋 금지 — gitignore.)
- `.env` (루트) — docker-compose 변수 보간용. 키: `FRED_API_KEY, KITA_API_KEY` (+ `POSTGRES_PASSWORD` 등 compose가 참조).
- `frontend/vite.config.js` — Vite/PWA/프록시/청크/테스트 설정.
- `backend/Dockerfile` — `python:3.12-slim`, `pip install -r requirements.txt`, `COPY . .`.
- `docker-compose.yml` — 서비스 정의(아래).
- 스키마: `backend/auth_schema.sql` → `backend/app_schema.sql` 순서 (INITDB 마운트).

## Docker 배포 스택

인프라: Mac 로컬 Docker (Render/Vercel/Supabase 미사용). `docker-compose.yml` 서비스:

1. **postgres** — `postgres:16-alpine`, DB/USER/PASSWORD `portfolion`(비번 env 보간), 포트 5432, `pgdata` 볼륨, `/docker-entrypoint-initdb.d/`에 `auth_schema.sql`(01)·`app_schema.sql`(02) 마운트, healthcheck `pg_isready`.
2. **backend** — `build: ./backend`, `env_file: ./backend/.env.docker`, postgres healthy 후 기동. (실제 라이브는 `docker run`으로 뜨는 `portfolion-backend-1` — `docker compose ps`에 안 잡힐 수 있음.)
3. **nginx** — `nginx:alpine`, 포트 80/443. `./frontend/dist` `:ro` 직접 서빙(→`npm run build`가 즉시 라이브), `./nginx/nginx.conf`·certbot 인증서 마운트. `/api/*` → `backend:8000` 프록시.
4. **certbot** — `certbot/certbot`, 12h마다 `certbot renew` 루프, `./certbot/conf`·`./certbot/www` 볼륨.

- **Cloudflare Tunnel** (`portfolion.taebro.com` → localhost:80): `cloudflared`는 compose 컨테이너가 아니라 **launchd**로 실행.
- **자동 배포**: `git push origin main` → GitHub Actions self-hosted 러너(주, `deploy.yml`, 전용 러너 `~/actions-runner-portfolion`) + 폴러(`scripts/auto-deploy-poll.sh`, 폴백, launchd `com.portfolion.auto-deploy-poll`, 2분마다 `LOCAL != origin/main`이면 `git reset --hard` 후 `deploy.sh`). 정식 재기동 스크립트 = `bash deploy.sh` (ad-hoc `docker compose build/up` 금지).
- 실행 스크립트: `start.bat`/`stop.bat`(Windows), `start.sh`(macOS/Linux), `deploy.sh`(배포 재빌드).

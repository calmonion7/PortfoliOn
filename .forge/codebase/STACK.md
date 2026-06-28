---
last_mapped_commit: 6b1c06b514d7ca9511360a7263b14cf97d783d18
mapped: 2026-06-28
---

# STACK

Tech stack, build, and configuration facts for PortfoliOn. (Glossary/domain terms live in CONTEXT.md, not here.)

## Languages & Runtimes

| Layer | Language | Runtime version | Source |
|-------|----------|-----------------|--------|
| Backend | Python | 3.12 (`python:3.12-slim`) | `backend/Dockerfile` |
| Frontend | JavaScript (ESM, `"type": "module"`) | Node (no pinned `.nvmrc`/`engines`) | `frontend/package.json` |
| DB | SQL (PostgreSQL 16) | `postgres:16-alpine` | `docker-compose.yml` |

No `.python-version`, `.nvmrc`, or `engines` field is pinned. Backend venv lives at `backend/.venv/` (local) — note `lxml` is in `requirements.txt`/Docker but NOT in local `.venv`.

## Backend — Python / FastAPI

Entry: `backend/main.py` (FastAPI `app`, mounts routers + scheduler). Run: `uvicorn main:app --host 0.0.0.0 --port 8000`.

Middleware stack (`backend/main.py`): `SessionMiddleware` (starlette, `SESSION_SECRET`), `EventTrackerMiddleware` (custom), `CORSMiddleware`.

Routers mounted in `main.py`: auth, portfolio, report, watchlist, stocks, guru, calendar, digest, market_indicators, analytics, analysis, events, rankings, investor, short_sell, batches, recommendations, admin.

Scheduler is a **package** `backend/scheduler/` (`__init__.py`, `_state.py`, `jobs.py`, `schedule.py`) — APScheduler.

### Key dependencies (`backend/requirements.txt`)

| Package | Constraint | Role |
|---------|-----------|------|
| `fastapi` | >=0.104.0 | web framework |
| `uvicorn[standard]` | >=0.24.0 | ASGI server |
| `apscheduler` | >=3.10.4 | batch scheduling (`backend/scheduler/`) |
| `yfinance` | >=0.2.40 | US/KR market data |
| `pandas` | >=2.1.0 | dataframes |
| `numpy` | >=1.26.0 | numerics |
| `requests` | >=2.31.0 | sync HTTP (most external APIs) |
| `httpx` | >=0.25.0 | async HTTP (OAuth token exchange in `backend/routers/auth.py`) |
| `beautifulsoup4` | >=4.12.0 | HTML parsing (CAPE crawl, FnGuide) |
| `lxml` | >=4.9.0 | HTML/XML parser (Docker only; local uses `html.parser`) |
| `exchange_calendars` | >=4.5 | market calendar / expected report dates |
| `psycopg2-binary` | >=2.9.0 | PostgreSQL driver (`backend/services/db.py`) |
| `authlib` | >=1.3.0 | OAuth |
| `python-jose[cryptography]` | >=3.3.0 | JWT (HS256) |
| `bcrypt` | >=4.0.0 | password hashing |
| `itsdangerous` | >=2.0.0 | session signing |
| `python-dotenv` | (unpinned) | env loading |
| `pytest` | >=7.4.0 | tests (`cd backend && .venv/bin/python -m pytest`) |

No `anthropic` dep — backend does NOT call any LLM (AI analysis is written externally via Cowork enrich API).

### DB access (`backend/services/db.py`)

psycopg2 `ThreadedConnectionPool`, `minconn=1`, `maxconn=20`, DSN from `DATABASE_URL`. `RealDictCursor`. Pool raises `PoolError` (not block) on exhaustion — sized above max ThreadPool concurrency (calendar 15, analysis 11).

## Frontend — React 19 + Vite

Plain CSS (no TailwindCSS). Dev port 5173.

Scripts (`frontend/package.json`): `dev` (vite), `build` (vite build), `test` (vitest run), `lint` (eslint), `preview`.

### Dependencies (`frontend/package.json`)

- Runtime: `react` ^19.2.5, `react-dom` ^19.2.5, `react-router-dom` ^7.14.2, `axios` ^1.16.0, `recharts` ^3.8.1.
- Dev/build: `vite` ^8.0.10 (**rolldown** bundler), `@vitejs/plugin-react` ^6.0.1, `vite-plugin-pwa` ^1.3.0, `vitest` ^4.1.9, `jsdom` ^29.1.1, `@testing-library/react` + `jest-dom`, `eslint` ^10 + `@eslint/js` + react-hooks/react-refresh plugins, `globals`.

### Build config (`frontend/vite.config.js`)

- **Vite 8 = rolldown**: `build.rollupOptions.output.manualChunks` is a **function** (object form unsupported). Splits `charts` chunk (recharts / `/d3-` / `victory-vendor`) vs `vendor` (rest of `node_modules`).
- `VitePWA`: `registerType: 'autoUpdate'`, workbox `runtimeCaching` (google-fonts CacheFirst, jsdelivr CacheFirst, `/api/*` NetworkFirst excluding `/api/auth/*`), manifest (name PortfoliOn, ko, standalone). `cacheId` includes a build-date stamp.
- Custom `sw-cache-bust` plugin: appends build-date query to `registerSW.js`, `manifest.webmanifest`, `sw.js` references in `dist/index.html`.
- Vitest config: `environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.js'`.
- Dev server: port 5173, proxies `/api` → `http://localhost:8000`, watch `usePolling: true`.
- Prod: `VITE_API_BASE_URL` env (unset → relative paths via nginx).

## Containers & Deployment

`docker-compose.yml` services:

| Service | Image / build | Ports | Notes |
|---------|---------------|-------|-------|
| `postgres` | `postgres:16-alpine` | 5432 | `pgdata` volume; init SQL mounted: `backend/auth_schema.sql` → `01-auth.sql`, `backend/app_schema.sql` → `02-app.sql`; healthcheck `pg_isready` |
| `backend` | build `./backend` | (internal 8000) | `env_file: ./backend/.env.docker`; depends on healthy postgres |
| `nginx` | `nginx:alpine` | 80, 443 | mounts `./frontend/dist:ro`, `./nginx/nginx.conf:ro`, certbot conf/www |
| `certbot` | `certbot/certbot` | — | renew loop (`certbot renew` every 12h) |

Note: per CLAUDE.md the live `backend` runs via `docker run` (not `docker compose`), so it does not appear in `docker compose ps`.

### `backend/Dockerfile`

`FROM python:3.12-slim`, `WORKDIR /app`, `pip install -r requirements.txt`, CMD `uvicorn main:app --host 0.0.0.0 --port 8000`.

### `nginx/nginx.conf`

- HTTP `listen 80`. `/api/` and `/health` → `proxy_pass http://backend:8000` (sets X-Real-IP, X-Forwarded-For/Proto).
- ACME challenge at `/.well-known/acme-challenge/` (certbot).
- `/index.html` and service-worker files (`sw.js`, `workbox-*.js`) served `no-cache`; hashed JS/CSS/images served `max-age=31536000, immutable`.
- SPA fallback `try_files $uri /index.html` from `/usr/share/nginx/html`.
- HTTPS `listen 443 ssl` server block is **commented out** (TLS terminated at Cloudflare Tunnel; cert paths reference `portfolion.taebro.com`).

### Frontend serving

nginx mounts `./frontend/dist` read-only and serves directly — `npm run build` is immediately live (independent of git push). Backend changes go live only after deploy (runner/poller).

## Build / config / deploy files (paths)

- `backend/Dockerfile`, `docker-compose.yml`, `nginx/nginx.conf`
- `frontend/vite.config.js`, `frontend/package.json`, `frontend/src/test/setup.js`
- `backend/requirements.txt`
- `backend/auth_schema.sql`, `backend/app_schema.sql` (DB schemas; auth runs first)
- `deploy.sh` (uses `docker run` for backend container), `docs/ops/deploy.md`
- `scripts/auto-deploy-poll.sh` (fallback poller), `scripts/ddns_update.sh`
- Self-hosted GitHub Actions runner deploy: `.github/workflows/deploy.yml` (`runs-on: self-hosted`)
- `start.bat` / `stop.bat` (Windows), `start.sh` (macOS/Linux)

## Environment variables (NAMES ONLY — values never copied)

From `backend/.env.docker` (gitignored; values redacted here):

- `DATABASE_URL`
- `JWT_SECRET`, `SESSION_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- `ANTHROPIC_API_KEY` (present but unused by backend)
- `FRED_API_KEY`
- `KITA_API_KEY` (actually the Korea Customs Service / 관세청 key)
- `KOFIA_API_KEY` (shared by leverage + lending services; public-data portal key)
- `DART_API_KEY`
- `FRONTEND_URL`
- `COWORK_API_KEY`
- `KIWOOM_BASE_URL`, `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY`
- `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_BASE_URL` (`KIS_BASE_URL` is commented out by default → live domain `:9443`)

From root `.env` (docker-compose interpolation): `FRED_API_KEY`, `KITA_API_KEY` (also `POSTGRES_PASSWORD` referenced as `${POSTGRES_PASSWORD:-portfolion}` in `docker-compose.yml`).

CORS origins (`backend/main.py`): `localhost:3000`, `localhost:5173`, and `FRONTEND_URL`.

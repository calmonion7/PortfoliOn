---
last_mapped_commit: 78750ecc2c96d71a9e3a3f225a56aea99db71db5
mapped: 2026-07-01
---

# STACK

Technology stack, runtime versions, dependencies, build/config, and environment variable names.

## Languages & Runtimes

- **Backend**: Python. `backend/Dockerfile` pins `FROM python:3.12-slim`. (Local dev venv at `backend/.venv/`; host `python3` is 3.14.) App entry `backend/main.py` (`from dotenv import load_dotenv` first, then FastAPI app).
- **Frontend**: JavaScript (ESM, `"type": "module"`), React 19 / JSX. No TypeScript at runtime (`@types/*` present for editor tooling only).

## Backend — Python / FastAPI

Dependencies from `backend/requirements.txt` (version floors, not pins):

| Package | Constraint | Role |
|---|---|---|
| `fastapi` | `>=0.104.0` | Web framework (`backend/main.py` mounts routers) |
| `uvicorn[standard]` | `>=0.24.0` | ASGI server (Dockerfile CMD: `uvicorn main:app --host 0.0.0.0 --port 8000`) |
| `apscheduler` | `>=3.10.4` | Job scheduler — `AsyncIOScheduler` + `CronTrigger` (see `backend/scheduler/`) |
| `yfinance` | `>=0.2.40` | US market data + US supply |
| `pandas` | `>=2.1.0` | Dataframe handling |
| `numpy` | `>=1.26.0` | Numerics |
| `requests` | `>=2.31.0` | Synchronous HTTP (most external APIs) |
| `beautifulsoup4` | `>=4.12.0` | HTML parsing (Shiller CAPE crawl, etc.) |
| `lxml` | `>=4.9.0` | BS4 parser backend (Docker only; **not in local `.venv`** — local code uses `html.parser`) |
| `httpx` | `>=0.25.0` | Async HTTP (OAuth token exchange in `backend/routers/auth.py`) |
| `pytest` | `>=7.4.0` | Backend test runner (`backend/tests/`) |
| `exchange_calendars` | `>=4.5` | Market trading-day calendars |
| `psycopg2-binary` | `>=2.9.0` | PostgreSQL driver (pooled — `ThreadedConnectionPool`) |
| `authlib` | `>=1.3.0` | OAuth client support |
| `python-jose[cryptography]` | `>=3.3.0` | JWT encode/decode (HS256) |
| `bcrypt` | `>=4.0.0` | Password hashing |
| `itsdangerous` | `>=2.0.0` | Signed session/state values |
| `python-dotenv` | (unpinned) | `.env` loading at startup |

No `anthropic` dependency — backend makes no LLM calls; AI analysis text arrives via the external Cowork enrich API.

Run command (per `CLAUDE.md`): `cd backend && python -m uvicorn main:app --reload --port 8000`. Tests: `cd backend && .venv/bin/python -m pytest`.

### Scheduler (`backend/scheduler/` package)

APScheduler is configured in the `backend/scheduler/` package (not a single `scheduler.py` — `backend/main.py` does `import scheduler as sched`):
- `backend/scheduler/_state.py` — `from apscheduler.schedulers.asyncio import AsyncIOScheduler`; module-level `_scheduler = AsyncIOScheduler()`.
- `backend/scheduler/schedule.py` — `_build_trigger` returns `CronTrigger(**build_trigger_kwargs(spec), timezone=timezone)`.
- `backend/scheduler/jobs.py`, `backend/scheduler/__init__.py` — job wiring / package surface.

## Frontend — React 19 + Vite

From `frontend/package.json` (`"name": "frontend"`, `"private": true`, ESM). Scripts: `dev` (`vite`), `build` (`vite build`), `test` (`vitest run`), `lint` (`eslint .`), `preview` (`vite preview`).

Dependencies:

| Package | Constraint | Role |
|---|---|---|
| `react` / `react-dom` | `^19.2.5` | UI runtime |
| `react-router-dom` | `^7.14.2` | Routing |
| `axios` | `^1.16.0` | HTTP client |
| `recharts` | `^3.8.1` | Charts (split into `charts` manual chunk with d3/victory-vendor) |

Dev dependencies:

| Package | Constraint | Role |
|---|---|---|
| `vite` | `^8.0.10` | Build tool / dev server (Vite 8 = rolldown bundler — manualChunks must be a **function**) |
| `@vitejs/plugin-react` | `^6.0.1` | React plugin |
| `vite-plugin-pwa` | `^1.3.0` | PWA (service worker, manifest) |
| `vitest` | `^4.1.9` | Test runner (config embedded in `vite.config.js` `test` block) |
| `jsdom` | `^29.1.1` | Test DOM environment |
| `@testing-library/react` | `^16.3.2` | Component testing |
| `@testing-library/jest-dom` | `^6.9.1` | DOM matchers |
| `eslint` | `^10.2.1` | Linter (`frontend/eslint.config.js`) |
| `@eslint/js` | `^10.0.1` | ESLint base config |
| `eslint-plugin-react-hooks` | `^7.1.1` | Hooks lint rules |
| `eslint-plugin-react-refresh` | `^0.5.2` | Fast-refresh lint rules |
| `globals` | `^17.5.0` | ESLint globals |
| `@types/react` / `@types/react-dom` | `^19.2.x` | Editor type hints |

### Vitest harness

Config lives in `frontend/vite.config.js` `test` block (no separate `vitest.config.js`): `environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.js'`. Harness files: `frontend/src/test/setup.js`, `frontend/src/test/smoke.test.js`.

## Build & Config

### `frontend/vite.config.js`
- Plugins: `@vitejs/plugin-react`, `VitePWA` (`registerType: 'autoUpdate'`, `pwaAssets` from `public/favicon.svg`, workbox `cacheId` keyed to a `BUILD_DATE` timestamp, runtime caching for google-fonts / cdn-fonts / `api-cache` NetworkFirst excluding `/api/auth/`), and a custom inline `sw-cache-bust` plugin (`closeBundle`) that appends `?<BUILD_DATE>` to `registerSW.js` / `manifest.webmanifest` / `sw.js`.
- `build.rollupOptions.output.manualChunks(id)` — function form: bundles `recharts`/`/d3-`/`victory-vendor` → `charts`, other `node_modules` → `vendor`.
- `server`: port 5173, proxy `/api` → `http://localhost:8000` (`changeOrigin: true`), `watch.usePolling: true`.

### `backend/Dockerfile`
`python:3.12-slim`, `WORKDIR /app`, `pip install --no-cache-dir -r requirements.txt`, `COPY . .`, `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]`.

### `docker-compose.yml` (version `"3.9"`, 4 services)
- `postgres` — `postgres:16-alpine`, db/user `portfolion`, password from `${POSTGRES_PASSWORD:-portfolion}`, port `5432:5432`, `pgdata` volume, init SQL mounted: `backend/auth_schema.sql` → `01-auth.sql`, `backend/app_schema.sql` → `02-app.sql` (auth before app). Healthcheck `pg_isready`.
- `backend` — `build: ./backend`, `depends_on` postgres healthy, `env_file: ./backend/.env.docker`.
- `nginx` — `nginx:alpine`, ports `80:80` + `443:443`, mounts `frontend/dist` (`:ro`), `nginx/nginx.conf` (`:ro`), `certbot/conf` + `certbot/www` (`:ro`).
- `certbot` — `certbot/certbot` image, renew loop (`certbot renew` every 12h).
- Named volume: `pgdata`.

(Per `CLAUDE.md`: the actual `backend` container is run via `docker run` (not `docker compose`), so it does not appear in `docker compose ps`.)

### `nginx/nginx.conf`
HTTP `:80` server: `/.well-known/acme-challenge/` → certbot webroot; `/health` and `/api/` proxy to `http://backend:8000` (with `X-Forwarded-*` headers on `/api/`); `/index.html` and `sw.js`/`workbox-*.js` served `no-store`; hashed assets (`js|css|png|...|woff2?`) `max-age=31536000, immutable`; SPA fallback `try_files $uri /index.html`. The `:443` SSL server block is present but commented out.

## Environment Variables

Names only (from `backend/.env.docker`; never values). Example template at `backend/.env.docker.example`. Root `.env` exists for docker-compose interpolation. CORS origins (`backend/main.py`): `localhost:3000`, `localhost:5173`, plus `FRONTEND_URL`.

- `DATABASE_URL` — PostgreSQL DSN (`backend/services/db.py` reads `os.environ["DATABASE_URL"]`)
- `POSTGRES_PASSWORD` — postgres container password (compose interpolation)
- `JWT_SECRET` — HS256 signing key (`backend/services/auth_service.py`)
- `SESSION_SECRET` — signed session/state
- `FRONTEND_URL` — OAuth redirect base + CORS origin
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — GitHub OAuth
- `FRED_API_KEY` — FRED (econ/macro/calendar release dates)
- `DART_API_KEY` — OpenDART (backlog, disclosures, AGM, insider trades)
- `KOFIA_API_KEY` — KOFIA / data.go.kr (leverage + lending)
- `KITA_API_KEY` — Korea Customs Service (exports; falls back to UN Comtrade if unset)
- `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY`, `KIWOOM_BASE_URL` — Kiwoom REST (KR quotes/sector/etc.)
- `KIS_APP_KEY`, `KIS_APP_SECRET` — KIS (Korea Investment) backup quote source (`KIS_BASE_URL` read with a default, not necessarily set)
- `COWORK_API_KEY` — external Cowork enrich API key
- `ANTHROPIC_API_KEY` — present in env file but currently unused by the backend

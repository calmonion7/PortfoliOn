---
last_mapped_commit: 6793157d58f56e2b8392cfbe725de186d9f95e0d
mapped: 2026-06-20
---

# Technology Stack

## Languages & Runtimes

| Layer | Language | Runtime |
|-------|----------|---------|
| Backend | Python | 3.12 (Docker image `python:3.12-slim`, `backend/Dockerfile`); local `.venv` is 3.9.6 |
| Frontend | JavaScript (ESM, `"type": "module"`) | Node v24 local; built static assets served by nginx |

## Backend — Python / FastAPI

- Entry: `backend/main.py` (`FastAPI(title="Stock Portfolio Manager")`, lifespan runs `_migrate()` + scheduler start + cache warm threads).
- Served by `uvicorn` on port 8000. Container CMD: `uvicorn main:app --host 0.0.0.0 --port 8000` (`backend/Dockerfile`).
- Routers mounted in `main.py`: auth, portfolio, report, watchlist, stocks, guru, calendar, digest, market_indicators, analytics, analysis, events, rankings, investor, short_sell, batches, recommendations, admin.
- Middleware: `SessionMiddleware` (starlette, `SESSION_SECRET`), custom `EventTrackerMiddleware` (`backend/middleware/event_tracker.py`), `CORSMiddleware`.

### Key backend dependencies (`backend/requirements.txt`)

| Package | Use |
|---------|-----|
| `fastapi>=0.104` / `uvicorn[standard]>=0.24` | web framework + ASGI server |
| `apscheduler>=3.10.4` | batch scheduler (`backend/scheduler/`) |
| `yfinance>=0.2.40` | US market data source |
| `pandas>=2.1`, `numpy>=1.26`, `matplotlib>=3.8` | data/series math, charts |
| `requests>=2.31`, `httpx>=0.25` | external HTTP (DART/FRED/KOFIA/Kiwoom/KIS/Naver) |
| `beautifulsoup4>=4.12`, `lxml>=4.9` | HTML parsing (lxml in Docker only; local uses `html.parser`) |
| `psycopg2-binary>=2.9` | PostgreSQL driver (`backend/services/db.py`) |
| `python-jose[cryptography]>=3.3` | JWT (HS256) encode/decode (`auth_service.py`) |
| `bcrypt>=4.0` | password hashing |
| `authlib>=1.3` | OAuth helper lib |
| `itsdangerous>=2.0` | session signing |
| `python-dotenv` | `.env` loading |
| `exchange_calendars>=4.5` | market calendar logic |
| `pytest>=7.4` | backend tests |

> No `anthropic` package — backend has no LLM calls (AI text comes from external Cowork client via enrich API). `ANTHROPIC_API_KEY` env var present but unused.

## Frontend — React 19 / Vite 8 (rolldown)

- React `^19.2.5` + `react-dom`, routing `react-router-dom@^7`, HTTP `axios@^1.16`.
- Charts `recharts@^3.8`; markdown `react-markdown@^10` + `remark-gfm@^4`.
- Bundler **Vite `^8.0.10`** (rolldown). `manualChunks` MUST be a function (object form breaks build) — splits `charts` (recharts/d3/victory-vendor), `markdown` (remark/rehype/micromark/...), `vendor`.
- PWA via `vite-plugin-pwa@^1.3` + `@vite-pwa/assets-generator` (autoUpdate SW, runtime caching for fonts/cdn/api).
- React plugin `@vitejs/plugin-react@^6`.
- Lint: `eslint@^10` + `@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`.

### Frontend test stack (devDependencies)

| Package | Use |
|---------|-----|
| `vitest@^4.1.9` | test runner (`npm run test` → `vitest run`) |
| `jsdom@^29.1.1` | DOM environment |
| `@testing-library/react@^16.3.2` | component testing |
| `@testing-library/jest-dom@^6.9.1` | DOM matchers |

Vitest config lives in `frontend/vite.config.js` `test` block: `environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.js'`.

## Scripts

| Command | Action |
|---------|--------|
| `npm run dev` | `vite` dev server (port 5173, proxies `/api` → `http://localhost:8000`) |
| `npm run build` | `vite build` → `frontend/dist` (immediately live via nginx `:ro` mount) |
| `npm run test` | `vitest run` |
| `npm run lint` | `eslint .` |
| `npm run preview` | `vite preview` |
| `cd backend && python -m uvicorn main:app --reload --port 8000` | backend dev |
| `cd backend && .venv/bin/python -m pytest` | backend tests |
| `start.bat` / `./start.sh` (+ `stop.bat`/`stop.sh`) | start/stop both servers |

## Configuration Files

| File | Purpose |
|------|---------|
| `frontend/vite.config.js` | Vite plugins, PWA, `test` block, `manualChunks`, dev proxy |
| `docker-compose.yml` | 4 services: postgres, backend, nginx, certbot |
| `backend/.env.docker` | backend runtime env (var names listed in INTEGRATIONS.md) |
| `.env` (root) | docker-compose interpolation vars |
| `backend/Dockerfile` | `python:3.12-slim`, pip install requirements, uvicorn CMD |
| `nginx/nginx.conf` | HTTP(80) serving + `/api/` & `/health` proxy to `backend:8000` |
| `backend/auth_schema.sql`, `backend/app_schema.sql` | Postgres init (auth first, then app) |
| `frontend/eslint.config.js` | ESLint flat config |

## Build & Deploy Tooling

- Static frontend built locally (`npm run build`) → `frontend/dist`, mounted read-only into nginx; build is immediately live.
- `git push origin main` triggers auto-deploy poller (`scripts/auto-deploy-poll.sh`, launchd `com.portfolion.auto-deploy-poll`, every 2 min, `git reset --hard origin/main`).
- `deploy.sh` deploy helper; `docker compose` manages the 4 containers (do not manually rebuild per project rules).
- Package managers: backend `pip` (requirements.txt), frontend `npm` (`package-lock.json`).

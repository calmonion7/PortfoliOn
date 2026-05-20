# PortfoliOn — Claude Code Context

## Commands

```bat
# Start both servers (Windows)
start.bat

# Backend only (from project root)
cd backend && python -m uvicorn main:app --reload --port 8000

# Frontend only
cd frontend && npm run dev

# Backend tests
cd backend && pytest
```

## Architecture

**Backend** — Python/FastAPI (port 8000)
- `backend/main.py` — app entry, mounts routers + scheduler
- `backend/routers/` — portfolio, watchlist, stocks, report
- `backend/services/` — storage, market (yfinance+Naver API), charts, indicators, report_generator, scraper, scheduler
- `backend/data/` — JSON file storage (stocks.json — unified holdings+watchlist+analyst data, schedule.json)
- `backend/snapshots/` — generated JSON snapshots (per-ticker/date, e.g. `LLY/2026-05-20.json`)
- `backend/reports/` — legacy report directory (read-only, JSON fallback for old snapshots)

**Frontend** — React 18 + Vite (port 5173), plain CSS (no TailwindCSS)
- `frontend/src/pages/` — Portfolio, Reports, Settings
- `frontend/src/components/` — StockModal, PromoteModal

## Key Files

- `API_SPEC.md` — full REST API reference (source of truth for endpoints)
- `CLAUDE_COWORK_API.md` — external API for Claude AI to read/write stock analysis
- `backend/venv/` — Python virtual environment (use `backend/venv/Scripts/python` on Windows)

## Data Model

- `holdings.json` and `watchlist.json` are merged into `stocks.json` (use `type: "holding"|"watchlist"` field to distinguish)
- New snapshots write to `backend/snapshots/`, old `reports/` is kept as read-only fallback

## Gotchas

- Data is JSON files in `backend/data/`, not a database. No migrations needed; just edit JSON.
- `PUT /api/stocks/enrich/batch` must be registered **before** `PUT /api/stocks/{ticker}/enrich` in the router to avoid FastAPI routing `enrich` as a ticker value.
- Frontend CORS origins are hardcoded in `backend/main.py`: `localhost:3000` and `localhost:5173`.
- `start.bat` runs both servers in hidden PowerShell windows; use `stop.bat` to kill them.
- ANTHROPIC_API_KEY must be set in the environment for report generation to work.

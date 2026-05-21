# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes, followed by PortfoliOn project context.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# PortfoliOn — Project Context

## Commands

```bash
# Start both servers (Windows)
start.bat

# Start both servers (macOS/Linux)
./start.sh

# Backend only (from project root)
cd backend && python -m uvicorn main:app --reload --port 8000

# Frontend only
cd frontend && npm run dev

# Backend tests
cd backend && .venv/bin/python -m pytest
```

## Architecture

**Backend** — Python/FastAPI (port 8000)

- `backend/main.py` — app entry, mounts routers + scheduler
- `backend/routers/` — portfolio, watchlist, stocks, report, guru, calendar
- `backend/services/` — storage, market (yfinance+Naver API), charts, indicators, report_generator, scraper, consensus, cache, guru_scraper, guru_stats
- `backend/scheduler.py` — APScheduler 설정 (services 아님, 루트 레벨)
- `backend/data/` — JSON file storage (stocks.json — unified holdings+watchlist+analyst data, schedule.json)
- `backend/snapshots/` — generated JSON snapshots (per-ticker/date, e.g. `LLY/2026-05-20.json`)
- `backend/reports/` — legacy report directory (read-only, JSON fallback for old snapshots)

**Frontend** — React 18 + Vite (port 5173), plain CSS (no TailwindCSS)

- `frontend/src/pages/` — Portfolio, Reports, Calendar, Settings, Guru (+ GuruCrawlSettings, GuruManagers, GuruStats, ReportSchedule)
- `frontend/src/components/` — StockModal, PromoteModal

## Key Files

- `API_SPEC.md` — full REST API reference (source of truth for endpoints)
- `CLAUDE_COWORK_API.md` — external API for Claude AI to read/write stock analysis
- `backend/.venv/` — Python virtual environment (macOS: `backend/.venv/bin/python`, Windows: `backend/.venv/Scripts/python`)

## Data Model

- `holdings.json` and `watchlist.json` are merged into `stocks.json` (use `type: "holding"|"watchlist"` field to distinguish)
- `guru_managers.json` — Guru 운용역 데이터 캐시
- New snapshots write to `backend/snapshots/`, old `reports/` is kept as read-only fallback

## Gotchas

- Data is JSON files in `backend/data/`, not a database. No migrations needed; just edit JSON.
- `PUT /api/stocks/enrich/batch` must be registered **before** `PUT /api/stocks/{ticker}/enrich` in the router to avoid FastAPI routing `enrich` as a ticker value.
- Frontend CORS origins are hardcoded in `backend/main.py`: `localhost:3000` and `localhost:5173`.
- `start.bat` runs both servers in hidden PowerShell windows; use `stop.bat` to kill them.
- `ANTHROPIC_API_KEY` must be set in the environment for report generation to work.
- Vite proxies `/api/*` to `http://localhost:8000` — frontend axios calls don't need a base URL.
- `backend/routers/calendar.py` has a 6-hour in-memory cache keyed by month. Restart the backend to clear it during development.
<!-- generated-by: gsd-doc-writer -->
# Development Guide

## Local Setup

```bash
# Clone and enter the project
git clone <repo-url>
cd PortfoliOn

# Install backend dependencies
cd backend && python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Install frontend dependencies
cd ../frontend && npm install

# Copy env file and fill in required values
cp .env.example .env   # if .env.example exists; otherwise create .env manually
```

Required environment variables: `ANTHROPIC_API_KEY` (report generation), `FRED_API_KEY` (economic indicators). See [CONFIGURATION.md](CONFIGURATION.md) for the full variable list.

## Dev Workflow

### Start both servers

```bash
# macOS/Linux
./start.sh

# Windows
start.bat
```

`start.sh` kills any existing processes on ports 8000 and 5173, starts both servers in the background, waits until they are healthy, then opens `http://localhost:5173` in the browser. Logs go to `/tmp/portfolion-backend.log` and `/tmp/portfolion-frontend.log`.

### Start servers individually

```bash
# Backend only (from project root)
cd backend && python -m uvicorn main:app --reload --port 8000

# Frontend only
cd frontend && npm run dev
```

Both servers support hot reload: the backend via uvicorn `--reload`, the frontend via Vite HMR.

## Adding a New Backend Route

Pattern used by every router in `backend/routers/`:

```python
# backend/routers/my_feature.py
from fastapi import APIRouter
from services import storage

router = APIRouter(prefix="/api/my-feature", tags=["my-feature"])

@router.get("")
def get_items():
    return storage.get_full_portfolio()  # or your data source
```

Then mount the router in `backend/main.py`:

```python
from routers import my_feature

# in main.py, after other include_router calls:
app.include_router(my_feature.router)
```

**Route ordering gotcha:** if two routes share the same prefix, register the more-specific one first. Example: `PUT /api/stocks/enrich/batch` must be registered before `PUT /api/stocks/{ticker}/enrich`, otherwise FastAPI will match `enrich` as the `{ticker}` path parameter.

## Adding a New Frontend Page

1. Create `frontend/src/pages/MyPage.jsx`.
2. Import and add a `<Route>` in `frontend/src/App.jsx`:

```jsx
// Add import at top
import MyPage from './pages/MyPage'

// Add inside <Routes>
<Route path="/my-page" element={<MyPage />} />
```

3. Add a nav link to the `NavLink` array in `App.jsx`:

```jsx
['/my-page', '내 페이지']
```

Nav links are rendered from a flat array of `[path, label]` pairs — just append a new entry.

## Data Storage

All persistent data lives in `backend/data/` as JSON files. There is no database and no migration tooling.

| File | Purpose |
|---|---|
| `stocks.json` | Unified holdings + watchlist (`type: "holding"` or `"watchlist"`) |
| `schedule.json` | Report scheduler configuration |
| `guru_managers.json` | Guru manager data cache |
| `calendar/YYYY-MM.json` | Calendar event file cache (gitignored) |
| `consensus/` | Per-ticker consensus JSON cache (gitignored) |

Read and write through `backend/services/storage.py`, which wraps `json.load` / `json.dump`. Direct file edits work for one-off fixes — no restart needed since storage reads from disk on each request.

Snapshots (per-ticker, per-date AI reports) write to `backend/snapshots/{TICKER}/{YYYY-MM-DD}.json`. The legacy `backend/reports/` directory is read-only fallback.

## Cache Invalidation

`backend/services/cache.py` maintains four in-memory caches:

| Cache | Type | TTL |
|---|---|---|
| `snapshot` | LRU (max 200 entries) | none (eviction only) |
| `list` | TTL | 5 s |
| `dashboard` | TTL | 300 s |
| `correlation` | TTL | 300 s |

**Automatic invalidation:** calling `cache_svc.invalidate(ticker)` clears snapshot, list, dashboard, and correlation caches for that ticker. This is triggered by stock add / update / delete operations in `routers/portfolio.py` and `routers/stocks.py`.

**Manual invalidation:**
- Dashboard: `DELETE /api/stocks/dashboard/cache`
- Calendar: `DELETE /api/calendar/cache?month=YYYY-MM` or click the ↺ button in the UI

**Common pitfall:** if you add a new mutation endpoint and forget to call `cache_svc.invalidate_dashboard()` (or the appropriate invalidation function), the dashboard will serve stale data for up to 300 seconds. Always call the relevant invalidation function at the end of any write operation.

## Build Commands

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Production build to `frontend/dist/` |
| `npm run lint` | Run ESLint |
| `npm run preview` | Serve the production build locally |

Backend has no separate build step — Python runs directly from source.

## Code Style

**Backend:** No linter config file detected in the repo. Follow the existing style: 4-space indentation, type hints on function signatures, Pydantic `BaseModel` for request bodies, `from services import x` import style.

**Frontend:** ESLint is configured (`eslint.config.js`). Run `npm run lint` before committing. No Prettier config detected — match the surrounding file's formatting (2-space indentation, single quotes).

**General principles (from project CLAUDE.md):**
- Minimum code that solves the problem — no speculative abstractions.
- Touch only what you must; don't refactor adjacent code.
- Every changed line should trace directly to the task at hand.

## PR Process

No `.github/PULL_REQUEST_TEMPLATE.md` detected. Follow the branch convention visible in recent commits: use prefixes like `feat/`, `fix/`, `docs/` in branch names. Run `npm run lint` and the backend test suite (`cd backend && .venv/bin/python -m pytest`) before submitting.

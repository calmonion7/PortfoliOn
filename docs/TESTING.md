<!-- generated-by: gsd-doc-writer -->
# Testing

## Test Framework and Setup

PortfoliOn uses **pytest** for all backend tests. The frontend has no test suite.

**Requirements:** Python virtual environment installed (see GETTING-STARTED.md).

Configuration is in `backend/pytest.ini`:
- `testpaths = tests` — only the `tests/` directory is scanned
- `pythonpath = .` — the `backend/` directory is added to `sys.path`, so service and router imports work without prefix

No additional setup is needed before running tests — the suite uses `unittest.mock` throughout, so no real network calls or file I/O occur.

## Running Tests

From the project root:

```bash
# Run the full test suite
cd backend && .venv/bin/python -m pytest

# Run a single test file
cd backend && .venv/bin/python -m pytest tests/test_cache.py

# Run a single test function
cd backend && .venv/bin/python -m pytest tests/test_stocks_router.py::test_get_stocks_returns_flat_list_with_type

# Verbose output
cd backend && .venv/bin/python -m pytest -v

# Stop on first failure
cd backend && .venv/bin/python -m pytest -x
```

No coverage threshold is configured. To generate a coverage report:

```bash
cd backend && .venv/bin/python -m pytest --cov=. --cov-report=term-missing
```

## What Is Tested

| File | What it covers |
|---|---|
| `test_cache.py` | In-memory cache: snapshot LRU deduplication, TTL invalidation for list/dashboard/correlation caches |
| `test_storage.py` | `services/storage.py`: read/write of unified `stocks.json`, type splitting (holding vs watchlist), analyst field updates |
| `test_market.py` | `services/market.py`: yfinance quote fields, financials, analyst consensus, exception handling, sector fallback |
| `test_indicators.py` | `services/indicators.py`: RSI range, EMA length, support/resistance keys, volume profile POC/HVN/LVN |
| `test_market_indicators.py` | `services/market_indicators_service.py`: FX, VIX, commodities, FRED economic indicator fetching |
| `test_stocks_router.py` | `GET /api/stocks`: flat list with `type` field, watchlist/holding merging |
| `test_portfolio_router.py` | Portfolio CRUD endpoints |
| `test_watchlist_router.py` | Watchlist CRUD endpoints |
| `test_analytics_router.py` | `GET /api/analytics/correlation`: matrix shape, single-holding edge case, cache usage |
| `test_calendar_router.py` | `GET /api/calendar`: earnings calendar fetching and file-based cache |
| `test_consensus_router.py` | Consensus data endpoints |
| `test_digest_router.py` | `GET /api/digest`: digest retrieval endpoints |
| `test_digest_service.py` | `services/digest_service.py`: digest generation logic |
| `test_guru_router.py` | Guru manager and stats endpoints |
| `test_guru_stats.py` | `services/guru_stats.py`: stats calculation logic |
| `test_report_router.py` | Report endpoints (list, fetch by ticker/date) |
| `test_report_generator.py` | `services/report_generator.py`: Anthropic API call mocking, snapshot writing |

## Fixtures

`backend/tests/conftest.py` adds `backend/` to `sys.path` so all imports resolve correctly. It contains no shared pytest fixtures — each test file sets up its own state using `unittest.mock.patch` and `tmp_path` (a built-in pytest fixture).

Common patterns used across the suite:

- **`tmp_path`** (pytest built-in) — tests that exercise `storage.py` pass a temporary directory to avoid touching `backend/data/stocks.json`
- **`unittest.mock.patch`** — used to replace yfinance calls, file reads, and Anthropic API calls with controlled return values
- **`fastapi.testclient.TestClient`** — router tests create a minimal `FastAPI()` app, mount only the router under test, and use `TestClient` directly

## Adding New Tests

1. Create `backend/tests/test_<module_name>.py`.
2. Add `sys.path.insert(0, str(Path(__file__).parent.parent))` at the top if your imports use bare module names (e.g., `from services.cache import ...`). Many existing files already include this; it is harmless to add it.
3. For router tests, mount only the router under test onto a fresh `FastAPI()` instance — do not import `main.py`.
4. Patch external I/O at the point of use (e.g., `patch("routers.stocks.storage.get_full_portfolio", ...)`), not at the definition site.
5. Use `tmp_path` for any test that reads or writes files, so tests remain isolated and repeatable.

Example skeleton for a new router test:

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.my_router import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)

def test_my_endpoint_returns_expected_shape():
    with patch("routers.my_router.storage.get_full_portfolio", return_value={"stocks": [], "watchlist": []}):
        resp = client.get("/api/my-endpoint")
    assert resp.status_code == 200
```

## CI Integration

No CI/CD pipeline is configured. Tests are run manually before committing.

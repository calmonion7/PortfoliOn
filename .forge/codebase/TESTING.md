---
last_mapped_commit: fd8dd650ede08d103b907ac4d87955f669ce3298
mapped: 2026-06-15
---

# PortfoliOn Testing

## Backend — pytest

### Setup
- **Framework**: pytest (backend/.venv/bin/python -m pytest)
- **Config**: `backend/pytest.ini` — testpaths=tests, pythonpath=.
- **Test location**: `backend/tests/` (20+ test files)
- **Run**: `cd backend && .venv/bin/python -m pytest -q 2>&1 | tail -3` → **631 passed** in 13.39s

### Test Patterns

#### Fixtures
- `conftest.py` registers FastAPI TestClient
  - `@pytest.fixture def client()` — Return TestClient(app)
  - `@pytest.fixture(autouse=True) def _clear_quote_cache()` — Invalidate cache before each test
- Dependency override: `app.dependency_overrides[get_current_user] = lambda: "test-user-id"`

#### Mocking External APIs & DB
- **unittest.mock.patch** for services, external APIs, DB
  - `patch.object(job_runs, "query", return_value=[...])` — Mock DB query
  - `patch.object(job_runs, "execute", return_value=1)` — Mock DB execute
  - `patch("services.market_indicators.cache.yf.Ticker")` — Mock yfinance
  - `monkeypatch.setattr()` — pytest-style fixture attribute override
- **side_effect** for multi-call mocking (conditional logic inside mock function)

#### TDD Pattern (RED → GREEN)
- Write test asserting expected behavior (RED)
- Implement logic to pass test (GREEN)
- Example: `test_record_inserts_running_then_success()` asserts INSERT + UPDATE in job_runs.record

#### Representative Tests

##### Job Instrumentation (test_job_runs.py)
- `test_record_inserts_running_then_success` — Context manager: query INSERT → execute UPDATE
- `test_record_failed_path_records_error_and_reraises` — Exception re-raised after failed UPDATE
- `test_record_insert_failure_still_runs_body_no_reraise` — DB unavailable: body runs, run_id=None
- `test_record_prune_keeps_20` — Prune SQL keeps latest 20 per job_id
- `test_record_exit_update_failure_swallowed` — Exit UPDATE failure doesn't break context manager

##### Batch Scheduling (test_scheduler_seed.py, test_kr_sector_batch.py)
- `test_registry_entry_market_kr_market_category` — batch_registry.get_batch("kr_sector_fetch") returns correct metadata
- `test_default_schedule_builds_valid_trigger` — batch_registry default_schedule → CronTrigger fields match hardcoded
- `test_scheduler_job_func_registered` — scheduler._JOB_FUNCS["kr_sector_fetch"] callable
- `test_batch_func_records_auto` — Batch body calls job_runs.record(job_id, "auto") + refresh()

##### Market Indicators (test_market_indicators.py)
- `test_get_treasury_returns_four_rates` — Cache yfinance, parse 3m/5y/10y/30y yields
- `test_get_treasury_change_bp` — Basis point delta calculation (Δ × 100)
- `test_get_treasury_spread_is_10y_minus_3m` — Term spread computed correctly
- `test_get_treasury_caches_result` — Second call hits cache (yf.Ticker.call_count unchanged)
- `test_get_sp500_tickers_parses_wikipedia` — HTML parsing for S&P500 constituents

##### HTTP Integration (test_portfolio_router.py, test_watchlist_router.py, test_auth.py)
- FastAPI TestClient: POST /api/portfolio, GET /api/watchlist/[ticker], GET /api/auth/me
- Dependency override auth in fixtures; mock DB via patch

### Coverage Notes
- **HTML/XML parsing**: Uses html.parser (lxml not installed locally)
  - backlog.py: `warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)`
  - DART document.xml parsed via BeautifulSoup(text, "html.parser")
- **No integration DB**: All DB ops mocked in tests
- **No external API calls**: yfinance, Naver, KIS, Kiwoom mocked

## Frontend — No Unit Tests

### Verification Strategy
- **Build verification**: `npm run build` compiles JSX → static assets
- **No jest/vitest**: React components tested via manual browser QA
- **Visual regression**: Screenshot testing would be manual (not automated)
- **Entry points**:
  - `/` (Portfolio, sector/macro tabs)
  - `/analytics` (Analytics page with SectorAllocation pie chart)
  - `/market` (Market indicators)
  - `/calendar` (Event calendar)
  - `/settings` (Batch schedule editor, permissions)

### Component Testing (Manual)
- Verify react-hook form integration (StockModal submission)
- Verify axios calls and error toast display
- Verify state/props flow through hooks (usePortfolioData, useIsMobile)
- Verify CSS tab/toggle activation (is-active class applied on state change)

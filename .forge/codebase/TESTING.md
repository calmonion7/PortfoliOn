---
last_mapped_commit: 6793157d58f56e2b8392cfbe725de186d9f95e0d
mapped: 2026-06-20
---

# Testing

Two independent test stacks: **frontend Vitest** (new, ADR-0019) and **backend pytest** (~75 test files, 820+ tests).

## Frontend — Vitest unit harness (NEW, ADR-0019)

The frontend previously had **no** unit-test runner; UI was verified only by manual Playwright UAT (`scripts/`). Vitest was added to enable characterization tests for the R4 hook extractions (`useReportFilters`, `useStockManagement`).

### Stack & config
- `vitest` + `jsdom` + `@testing-library/react` + `@testing-library/jest-dom` (all devDependencies in `frontend/package.json`).
- **Config lives in the `test` block of `frontend/vite.config.js`** (no separate `vitest.config`): `{ environment: 'jsdom', globals: true, setupFiles: './src/test/setup.js' }`.
  - Note: the file imports `defineConfig` from `'vite'` (NOT `'vitest/config'`) — deliberately keeps the production build decoupled from vitest types/plugin.
- Setup file `frontend/src/test/setup.js` just imports `'@testing-library/jest-dom'` (registers matchers like `toBeInTheDocument`).
- Script: `"test": "vitest run"` (single non-watch run). Run from `frontend/`: `npm test`.
- Tests are **colocated** as `*.test.js` next to the source.

### Existing tests
- `frontend/src/test/smoke.test.js` — 1 trivial test confirming the runner works.
- `frontend/src/hooks/useReportFilters.test.js` — 16 **characterization** tests. Mirrors the production predicates inline, drives the hook with `renderHook` + `act`, asserts derived sub-tab/market-count/sort/marketFilter outputs (`result.current.*`). Pure-logic hook → no mocking needed.
- `frontend/src/hooks/useStockManagement.test.js` — 14 tests. Mocks the api module with `vi.mock('../api', () => ({ default: { get/post/put/delete: vi.fn() } }))`, stubs `window.confirm = vi.fn()`, `vi.spyOn(globalThis, 'setInterval')`, and passes spy callbacks (`fetchList`/`fetchAll`/`showToast`) as hook args. `beforeEach(vi.clearAllMocks())`. Async assertions wrapped in `await act(async () => …)`; rejection asserted via `await expect(...).rejects`.

### Scope (intentional)
- Backfill is **scoped to R4 hooks only** — NOT full coverage. Broad component/page coverage (codemap CONCERNS #16) is explicitly out of scope per ADR-0019. Tests live only in CI/local; not bundled into `dist`.

## Backend — pytest

- Run: `cd backend && .venv/bin/python -m pytest` (macOS venv). ~75 `test_*.py` files in `backend/tests/`, 820+ tests.
- Config: `backend/pytest.ini` — `testpaths = tests`, `pythonpath = .`.
- Shared fixtures: `backend/tests/conftest.py`
  - Inserts project root on `sys.path`.
  - Module-level `app.dependency_overrides[get_current_user] = lambda: "test-user-id"` — auth is bypassed globally.
  - `client` fixture → `fastapi.testclient.TestClient(app)`.
  - `autouse` fixture `_clear_quote_cache` invalidates the per-ticker quote TTL cache before each test to avoid cross-test pollution.
- Test fixtures data: `backend/tests/fixtures/backlog/` (sample DART payloads etc.).

### Patterns
- **Router tests** (e.g. `backend/tests/test_portfolio_router.py`): build a minimal `FastAPI()`, `include_router(router)`, override `get_current_user`, then `unittest.mock.patch` the storage/service functions *as imported in the router module* (e.g. `patch("routers.portfolio.storage.get_holdings", return_value=...)`). Assert HTTP status + `resp.json()` + mock call args (`mock_save.call_args[0][1]`). Multiple patches stacked with `\`-continued `with`.
- **Service tests** (e.g. `backend/tests/test_market.py`): build `MagicMock`/`pandas.DataFrame` fixtures (helper `_make_mock_ticker`), `patch("services.market.yf.Ticker", return_value=...)`, then call the service fn directly. Some reload the module (`importlib.reload(market)`) to re-bind patched globals.
- **Call-sequence assertions**: when an endpoint makes multiple service calls, assert `call_count` and per-call `call_args_list[i]` rather than the last-call `call_args` (additive call hops otherwise silently shift the "last call").

### Local env gotcha
- Local `backend/.venv` **lacks `lxml`** (it is in `requirements.txt` / Docker image but not installed locally). For code/tests exercised by local pytest, parse HTML with stdlib `BeautifulSoup(html, "html.parser")`, not `"lxml"` (see `backend/tests/test_backlog_extract.py`, `backend/services/backlog_parser.py` use `html.parser`).

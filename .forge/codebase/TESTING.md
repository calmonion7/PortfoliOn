---
last_mapped_commit: 78750ecc2c96d71a9e3a3f225a56aea99db71db5
mapped: 2026-07-01
---

# TESTING

Test layout, harnesses, and verification gates for PortfoliOn. Implementation facts only — for term definitions see `.forge/CONTEXT.md`.

## Backend — pytest

- Tests live in `backend/tests/` (91 `test_*.py` files, ~957 test functions). Run from the backend dir:
  ```bash
  cd backend && .venv/bin/python -m pytest
  ```
  (`.venv/bin/python` on macOS; `.venv/Scripts/python` on Windows.) Note the local `.venv` lacks `lxml` — HTML parsing in test-covered code must use stdlib `BeautifulSoup(html, "html.parser")`, not `"lxml"`.
- `backend/tests/conftest.py` prepends the backend dir to `sys.path`, imports `main.app`, and globally overrides auth via `app.dependency_overrides[get_current_user] = lambda: "test-user-id"`. It exposes a `client` fixture (`TestClient(app)`) and an `autouse` fixture `_clear_quote_cache` that calls `cache.invalidate_quote()` between tests to prevent TTL-cache cross-contamination.
- `backend/tests/fixtures/` holds static fixture data (e.g. `backlog/`).

### Patterns

- **Fixture mocks** — external/DB calls are patched with `unittest.mock.patch` targeting the router's import path, e.g. `patch("routers.watchlist.storage.get_watchlist_tickers", return_value=...)`. `monkeypatch` is used for module-level swaps (e.g. swapping `main.db_execute` to capture emitted DDL).
- **Self-built `FastAPI()` + `app.dependency_overrides` for auth in router tests** — many router tests do **not** use the conftest `client`. They build a fresh app at module top and override auth on it:
  ```python
  from fastapi import FastAPI
  from routers.watchlist import router
  from auth import get_current_user
  app = FastAPI()
  app.include_router(router)
  app.dependency_overrides[get_current_user] = lambda: "test-user-id"
  client = TestClient(app)
  ```
  (`test_watchlist_router.py`, `test_portfolio_router.py`, `test_batch_endpoints.py`, `test_us_supply.py`, `test_calendar_router.py`, `test_macro_signals_batch.py`, `test_disclosure_batch.py`, `test_job_runs_instrumentation.py`, `test_auth*.py`, etc.) **Consequence:** the conftest only overrides auth on `main.app`, so adding an auth `Depends` (e.g. `require_admin_or_api_key`) to an endpoint breaks every self-built-app test of that path with 401/403 unless that test also overrides the new dependency. Verify the no-auth rejection with a fresh app that has **no** override (`tests/test_security_auth_gaps.py` pattern).
- **`main._migrate` migration tests** — `main._migrate()` runs idempotent additive DDL at startup (`backend/main.py:39`, called at line 151; all DDL is `ADD COLUMN / CREATE TABLE IF NOT EXISTS`). Tests assert the emitted SQL by monkeypatching the execute path and calling `main._migrate()` directly: `test_migrate_creates_stock_disclosures` / `test_migrate_adds_meeting_date_column` (`test_disclosures.py`), `test_migrate_creates_stock_dividends` (`test_dividends.py`), `test_migrate_creates_stock_insider_trades` (`test_insider_trades.py`), `test_migrate_creates_us_supply_snapshot_idempotent` (`test_us_supply.py`).
- **`test_api_doc_sync.py` — endpoint drift detector** — compares the live route set (`main.app.routes`, ground truth) against the `### \`METHOD /path\`` headers in `API_SPEC.md` and `CLAUDE_COWORK_API.md`. `_norm` collapses path params (`{ticker}`→`{}`) and strips query strings/trailing slashes. A frozen `KNOWN_UNDOCUMENTED` baseline (currently empty) is exact-matched, so adding a new endpoint without documenting it in `API_SPEC.md` fails the test; documenting a baselined one requires removing it from the set. Only endpoint *existence* (method+path) is checked — request/response schema and auth gating remain a manual DoD (the test does not parse prose).

### Recurring caution — fixture-pass / live-fail
External-source parsing and numeric scaling are the repeat offenders: unit tests mock the upstream response and therefore **cannot** catch index-label mismatches, unit-scale errors, or echo-field differences that only appear against the real API. Confirmed cases: yfinance method-vs-property label drift (`market/us.py` FCF/CapEx all-`None`), KR Naver financial row labels, DART `account_id`/`fs_div` echo behavior. The rule: for any external-source parsing/scaling slice, include a **live 1-ticker extraction check in the DoD** — fixtures passing is not sufficient evidence the parse works on real data. Data-parsing changes (e.g. backlog) additionally warrant a full re-ingest UAT after deploy, since production hits real-data shapes absent from fixtures.

## Frontend — vitest harness + build/lint/Playwright gate

- A vitest harness exists but is effectively a placeholder. `frontend/vite.config.js` configures the `test` block (`environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.js'`), and `frontend/package.json` defines `"test": "vitest run"`. The only test is `frontend/src/test/smoke.test.js` — a single `expect(1 + 1).toBe(2)` sanity check confirming the runner works (ADR-0019). There is no meaningful unit-test coverage of components.
- The **effective frontend quality gate is therefore: build + lint + Playwright UAT**, not the vitest suite:
  - `npm run build` (`vite build`) — the deploy artifact; nginx serves `frontend/dist` directly, so a successful build is immediately live.
  - `npm run lint` (`eslint .`, with `eslint-plugin-react-hooks` / `eslint-plugin-react-refresh`).
  - Playwright device-emulation UAT for visual/behavioral verification without a physical phone (test account `test@portfolion.com` / `test1234`). This is where KR color-convention regressions, header↔grid mismatches, and other live-only issues are caught.

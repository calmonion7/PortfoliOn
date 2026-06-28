---
last_mapped_commit: 6b1c06b514d7ca9511360a7263b14cf97d783d18
mapped: 2026-06-28
---

# TESTING

How PortfoliOn is tested. Facts verified against source; file paths in backticks.

## Backend — pytest

- **Framework:** pytest, tests under `backend/tests/` (87 `test_*.py` files; **960 tests collected** at this commit).
- **Run:** `cd backend && .venv/bin/python -m pytest` (macOS venv; Windows: `backend/.venv/Scripts/python`). No `pytest.ini`/`conftest`-based markers beyond the shared conftest below.
- **Fixtures dir:** `backend/tests/fixtures/` holds captured external-source payloads (DART XML/JSON, yfinance/Naver rows) used by parser tests.

### Shared conftest (`backend/tests/conftest.py`)

- Inserts the repo root on `sys.path`, imports `from main import app`, and globally overrides auth: `app.dependency_overrides[get_current_user] = lambda: "test-user-id"`.
- `client` fixture = `TestClient(app)` over the real `main.app`.
- Autouse `_clear_quote_cache` fixture invalidates the per-ticker quote TTL cache before each test (`from services import cache; cache_svc.invalidate_quote()`) to prevent cross-test pollution.

### Two router-test styles (important distinction)

1. **Real-app tests** use the `client` fixture (real `main.app`, auth overridden in conftest). Good for end-to-end routing.
2. **Self-built-app tests** construct their own `app = FastAPI()`, `app.include_router(router)`, and set their own `app.dependency_overrides[...]`, then `TestClient(app)` at module scope. ~30 test modules do this (e.g. `backend/tests/test_stocks_router.py`, `test_consensus_router.py`, `test_recommendation_endpoint.py`, `test_nan_serialization_guards.py`, `test_portfolio_router.py`, `test_watchlist_router.py`).
   - **Caveat (per `CLAUDE.md`):** conftest only overrides auth on `main.app`, so self-built apps must override every auth dependency their router uses, or the test 401/403s. `test_stocks_router.py` overrides `get_current_user`, `get_current_user_or_api_key`, **and** `require_admin_or_api_key`. **When you add/change an auth `Depends` on an endpoint, grep the self-built-app tests that hit that path and add the new override.** Verify the unauthenticated-reject path separately with a fresh, un-overridden app — see `backend/tests/test_security_auth_gaps.py`.

### Mocking patterns

- `unittest.mock` `patch`/`MagicMock` to stub service/storage calls at the router boundary, e.g. `with patch("routers.stocks.storage.get_full_portfolio", return_value=...)`. Patch where the symbol is *used*, not where defined.
- `monkeypatch` fixture is also used (~34 test modules) for attribute/env swaps, e.g. `patch.object(analysis_service.yf, "Ticker", _FakeTicker)` in `test_nan_serialization_guards.py`.
- External-source classes are faked with small in-test classes returning canned DataFrames (e.g. `_ConstTicker` producing zero-variance closes to force `corr=NaN`).
- **`call_args` / `call_args_list` caveat (per `CLAUDE.md`):** when an endpoint adds an additive read/external call, tests asserting the *last* call via `mock.call_args` silently break (the last call shifts). Migrate such assertions to indexed `call_args_list[i].kwargs` and pin sequence with `call_count`.

### Notable cross-cutting tests

- **API doc-sync — `backend/tests/test_api_doc_sync.py`** (task#99/#100). Diffs live endpoints (parsed from `main.app.routes`, not decorators) against the `### \`METHOD /path\`` headers in `API_SPEC.md` and `CLAUDE_COWORK_API.md`. Paths are normalized (`{param}`→`{}`, query/trailing-slash stripped). Tests:
  - `test_api_spec_documents_all_live_endpoints` — live − API_SPEC must equal `KNOWN_UNDOCUMENTED` exactly (currently `frozenset()`), so a new undocumented endpoint fails the suite (self-maintaining allowlist).
  - `test_api_spec_has_no_stale_endpoints` / `test_cowork_api_has_no_stale_endpoints` — neither doc may list an endpoint absent from live (catches deletions). Note this checks *existence* drift only — request/response schema and auth-gating sync remain a manual DoD.
- **NaN serialization guards — `backend/tests/test_nan_serialization_guards.py`** (task#109). Forces NaN through endpoints/services and asserts `json.dumps(result, allow_nan=False)` succeeds and the offending floats came back as `None` — guards against the starlette `allow_nan=False` 500 class.
- **Migration / startup-DDL & batch tests:** `test_market_cache.py`, `test_market_history_routing.py`, `test_batch_market_split.py`, `test_batch_resilience.py`, `test_batch_endpoints.py`, `test_batches_router.py`, `test_job_runs_instrumentation.py`, `test_job_runs.py`, `test_disclosure_batch.py`, `test_macro_signals_batch.py`, `test_kr_sector_batch.py`, `test_agm_batch.py` cover batch registration, market-split partitioning, and job-run instrumentation. (No dedicated test for `main._migrate()` idempotent DDL itself.)
- **External-source parser tests** sit in `test_backlog.py`/`test_backlog_extract.py`, `test_disclosures.py`, `test_dividends.py`, `test_financials_kr*.py`, `test_financials_us*.py`, `test_indices.py`, `test_kiwoom_*.py`, `test_kis_*.py`, `test_investor_service*.py`, etc.

### "Fixture-pass / live-fail" caution (recurring, in DoD)

Unit tests mock the external payload, so they cannot catch row-label / `account_id` / `fs_div` mismatches that only surface against the real source (yfinance `get_*()` vs `.property` labels; DART `account_id` vs `account_nm`; Naver row keys). Per `CLAUDE.md` this bit at least at task#111 and task#117. **DoD for any external-source parsing slice: a live 1-ticker extraction cross-check**, not just green fixtures. For data-reload-affecting changes (backlog parsing), a full re-ingest UAT is also required — and extraction failure must degrade to `pending`/missing, never a "safe default" (a wrong unit caption can cause a ×100 mis-store: `wrong < missing`).

## Frontend — vitest (build + smoke only)

- **Harness exists** (added per ADR-0019): `frontend/package.json` has `"test": "vitest run"`, devDeps `vitest@^4`, `@testing-library/react`, `@testing-library/jest-dom`. Config block lives in `frontend/vite.config.js` (`test: { environment: 'jsdom', globals: true, setupFiles: './src/test/setup.js' }`); `frontend/src/test/setup.js` imports `@testing-library/jest-dom`.
- **Coverage is essentially nil:** the only spec is `frontend/src/test/smoke.test.js` (a `1 + 1 === 2` harness-liveness check). There are no component/page tests. In practice the frontend gate is still `npm run build` (and `npm run lint`).
- **UAT instead of unit tests:** frontend behavior is verified via Playwright device emulation against a test account (see project memory `reference-frontend-uat.md`), not automated JS unit tests.

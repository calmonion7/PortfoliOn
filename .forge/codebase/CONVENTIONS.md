---
last_mapped_commit: 6793157d58f56e2b8392cfbe725de186d9f95e0d
mapped: 2026-06-20
---

# Coding Conventions

## Language & comments
- **Comments and commit messages are Korean.** Code identifiers are English; explanatory prose is Korean (see `backend/services/utils.py`, `frontend/src/hooks/usePortfolioData.js` inline notes).
- Backend Python uses `from __future__ import annotations` + typed signatures where it helps (`backend/services/utils.py`).

## Frontend — React 19 + Vite, plain CSS
- **No TailwindCSS.** Styling is plain CSS files (14 `*.css` under `frontend/src/`, e.g. `frontend/src/styles/tokens.css`, `frontend/src/components/ui/Badge.css`). No `@tailwind`/utility-class framework.
- **Design tokens** live in `frontend/src/styles/tokens.css` (`:root` + `[data-theme="dark"]`).
- **KR color convention** (`tokens.css`): `--up` = **red** `#d83a3a` (상승), `--down` = **blue** `#2864e8` (하락). Helper classes `.up`/`.down` map to these.
  - Because `.badge--success`/`.badge--danger` (`ui/Badge.css`) bind to price tokens, **success≈red / danger≈blue** here — do NOT use these variants for semantic (non-price) state badges; use dedicated semantic colors (`--color-success` green / `--color-error` red, defined separately in `tokens.css`, or `ui/SupplyBadge.jsx`). The `warning` variant is broken (no `--color-warning`).
- **Hooks**: named `useX.js`, default-exported, colocated in `frontend/src/hooks/` (`useAuth.js`, `usePortfolioData.js`, `useReportFilters.js`, `useStockManagement.js`, …). Composed of `useState`/`useEffect`/`useCallback`.
- **API client**: single axios instance `frontend/src/api.js` (default export), imported relatively (`from '../api'`, 45 sites). Request interceptor injects `Bearer` from `localStorage`; response interceptor redirects to `/` on 401. Base URL = `VITE_API_BASE_URL || ''` (relative in prod, Vite proxies `/api` → `:8000` in dev).
- **Toasts**: `ToastProvider`/`useToast` from `frontend/src/components/Toast.jsx`; passed down as `showToast(msg, 'error')`.
- **Chunking**: `vite.config.js` `build.rollupOptions.output.manualChunks` is a **function** (Vite 8/rolldown rejects object form) splitting `charts`/`markdown`/`vendor` by `node_modules` path substring.

## Backend — Python / FastAPI
- **Router → service split.** `backend/routers/*.py` (19 routers) own HTTP/validation; `backend/services/*.py` (33 modules) own logic. Routers call services (e.g. `routers.portfolio.storage.*`), never the reverse for HTTP concerns.
- **Naming**: services snake_case module + function names (`get_quote`, `save_holdings`, `resolve_name`). Packages group cohesive concerns (`services/market_indicators/`, `services/kiwoom/`, `services/kis/`).
- **Route ordering matters**: register specific paths before catch-all/`{ticker}` paths (e.g. `PUT /api/stocks/enrich/batch` before `PUT /api/stocks/{ticker}/enrich`; `GET /{ticker}/backlog` must not be shadowed by a catch-all).

## API response patterns
- **Prefer additive changes** (add fields, not reshape). Non-additive reshapes (array→object) require grepping *every* frontend consumer (`grep -rn '<path>' frontend/src/`) — independent fetchers (e.g. `Analytics.jsx` hitting `/api/stocks/dashboard` outside its hook) silently break on old shape. Adding read/side-call hops also pollutes tests asserting `mock.call_args` (last call) — migrate to `call_args_list[i].kwargs`.
- **NaN/inf guard on float-bearing responses.** Starlette `JSONResponse` uses `allow_nan=False` → a `NaN`/`inf` in the dict throws 500. Guard at the source (`math.isfinite`); a generic helper exists at `backend/services/utils.py::sanitize` (recursively maps NaN/inf floats → `None`). Note Python `json.dumps` defaults `allow_nan=True`, so file-fallback hides the bug that DB save + response serialization expose.
- **Dual-source 종목명**: `tickers.name` (shared master, read live by stock-management lists) vs `snapshots.data.name` (frozen at report-gen, read by research list/detail). Rename must update both (`storage.refresh_snapshot_names` / `reconcile_snapshot_names`) and invalidate caches (`cache.invalidate(ticker)` + `invalidate_list()`).

## Error handling
- External-fetch failures (kiwoom/yfinance/DART) must be **logged, not silently swallowed**, and **all-None / empty results must not be persisted** to cache (skip save, keep last good). Extraction failures → `pending`/`None`, never a "safe default" (e.g. backlog unit caption: wrong < missing — a default-억원 fallback causes ×100 over-store).
- Float-tagging external prices: check `math.isfinite` and treat non-finite as "no quote" rather than letting NaN propagate into totals.

## ESLint
- Flat config `frontend/eslint.config.js`: `@eslint/js` recommended + `eslint-plugin-react-hooks` (`flat.recommended`) + `eslint-plugin-react-refresh` (`vite`). Ignores `dist`. Browser globals, JSX enabled. Script: `npm run lint`.
- **Tolerated hook-rule debt** (existing `eslint-disable`, not to be "fixed" opportunistically):
  - `frontend/src/pages/Reports.jsx:120` — `// eslint-disable-next-line react-hooks/exhaustive-deps`
  - `frontend/src/pages/ReportManualGen.jsx:36` — `}, [role]) // eslint-disable-line`
  - The newer `eslint-plugin-react-hooks` flags `set-state-in-effect`; existing effects that set state on fetch are accepted debt — do not refactor unless that is the task.

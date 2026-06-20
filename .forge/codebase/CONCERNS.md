---
last_mapped_commit: 6793157d58f56e2b8392cfbe725de186d9f95e0d
mapped: 2026-06-20
---

# CONCERNS — tech debt, known issues, risk areas

Numbered for continuity. Each cites where it lives. Implementation facts only.

---

## Frontend lint / hooks debt

### #16 — Frontend test harness: PARTIAL (Vitest, R4-scoped only)
Resolved in part by ADR-0019 (`.forge/adr/0019-frontend-test-harness-vitest.md`). Vitest is wired
(`npm test` → `vitest run`), but coverage is only **two R4 hooks + one smoke test**:
- `frontend/src/hooks/useReportFilters.test.js`
- `frontend/src/hooks/useStockManagement.test.js`
- `frontend/src/test/smoke.test.js`

No component/page tests, no coverage for the other ~7 hooks or any `pages/`. Full frontend test backfill is
still outstanding. (Backend by contrast has 75 `test_*.py` under `backend/tests/`, pytest via `backend/pytest.ini`.)

### #18 — react-hooks lint errors are real and growing (90 errors, 3 warnings repo-wide)
`npx eslint src/` reports **93 problems (90 errors, 3 warnings)** — NOT confined to `Reports.jsx`.
Breakdown by rule:
- `react-hooks/set-state-in-effect` — **26** (calling `setState` synchronously in an effect body; new React Compiler rule)
- `no-unused-vars` — **25** (dead imports/locals; see #DC below)
- `react-refresh/only-export-components` — **21**
- `react-hooks/static-components` — **9**
- `no-empty` — **6** (empty `catch {}` / blocks)
- `react-hooks/exhaustive-deps` — **2**
- `react-hooks/immutability` — **2**
- `no-sparse-arrays` — **1**

Worst files: `components/reports/DetailTab.jsx` (12), `market/marketUtils.jsx` (7),
`reports/reportUtils.jsx` (7), `pages/Ranking.jsx` (6).

In `frontend/src/pages/Reports.jsx` specifically (4 problems): two `set-state-in-effect` errors at
lines **106** (detail-fetch effect: `setLoading(true)`) and **122** (ungenerated→holdings auto-switch effect:
`setActiveTab('holdings')`), plus the **stale `eslint-disable-next-line react-hooks/exhaustive-deps`** at line
**120** flagged as "Unused eslint-disable directive (no problems reported)". The `othersData` fetch effect
(lines 93–102) is clean. All tolerated/untouched debt.

**No CI lint gate** — `.github/workflows/deploy.yml` runs only `git reset --hard origin/main` + `deploy.sh`;
`deploy.sh` runs `npm install && npm run build` (no `npm run lint`, no `npm test`, no backend pytest). So these
errors do not block deploy and have accreted unnoticed. Second stale disable: `pages/ReportManualGen.jsx:36`
`// eslint-disable-line`.

### #DC — Pre-existing dead code (frontend)
25 `no-unused-vars` hits are mostly orphaned imports left after refactors. Confirmed examples:
- `components/reports/DetailTab.jsx` — 9 unused recharts imports (`ScatterChart`, `Scatter`, `XAxis`, `YAxis`,
  `CartesianGrid`, `Tooltip`, `ResponsiveContainer`, `ReferenceLine`, `Cell`) + `fmtN`, plus unused `closestKey` (line 351)
- `components/market/TreasurySection.jsx` — `LoadingBox`, `ErrorBox`
- `components/market/EconIndicatorsSection.jsx` — `ErrorBox`; `LendingSection.jsx` — `CARD_STYLE`
- `components/reports/Sections.jsx` — `TH`, `TD`; `FinancialsChart.jsx` — `fmt`; `HistoryTab.jsx` — `dates`
- `pages/GuruManagers.jsx` — `tdStyle`, `badgeErr`, `handleSort`; `StockModal.jsx` — `useCallback`

Per CLAUDE.md §3, do NOT mass-delete pre-existing dead code unless asked — clean up only orphans your own change creates.

---

## Backend — serialization & data-loss traps

### #N1 — NaN/inf JSON serialization 500 risk
starlette `JSONResponse` uses `allow_nan=False`; any `NaN`/`inf` in a response dict → HTTP **500**
(`Out of range float values are not JSON compliant`). Insidious because fallbacks mask it: PostgreSQL rejects
NaN in `json` columns (save fails) but Python `json.dumps` defaults `allow_nan=True` (file fallback passes) →
DB-save-fail + file-success + response-serialize-fail give crossed symptoms. NaN typically flows in from external
quotes (yfinance `Close` NaN, FX `usdkrw` NaN) and contaminates aggregates (`total_value` etc).
- Generic guard: `backend/services/utils.py` `sanitize()` (lines ~29–36) recurses dict/list and nulls non-finite floats.
- Source-level `isfinite`/`isnan` guards present in: `services/digest_service.py`, `services/indicators.py`,
  `services/report_generator.py`, `services/recommendation/funnel.py`, `routers/analytics.py`.
- CLAUDE.md gotcha: guard **at the source** (treat NaN as "no quote") rather than blanket output-sanitize. Any
  new endpoint emitting external-derived floats must guard.

### #N2 — Dual-source 종목명 (stock name) sync trap
A stock name lives in two stores that drift independently:
- `tickers.name` (shared master; 종목관리 list reads live)
- `snapshots.data.name` (frozen at report-gen time; research list/detail read this)

Renaming must update **both** or list↔detail disagree. Sync helpers: `services/storage/names.py`
(`refresh_snapshot_names` single / `reconcile_snapshot_names` full), called from `routers/stocks.py`. DB-only
edits are masked by caches (`cache.get_list`, snapshot LRU) → must `cache.invalidate(ticker)` + `invalidate_list()`.
Real-name resolution: `services/market/__init__.py` `resolve_name` (KR Kiwoom `stk_nm`/Naver, US yfinance shortName).
Clobber guard in `save_holdings`/`save_stocks` (CASE-WHEN preserves existing name when incoming is NULL/blank/==ticker).
Backfill `POST /api/stocks/names/backfill` **silently skips** stocks whose live quote momentarily fails
(`updated:0`) — re-run if result is 0; check `skipped` list (task#77/#88).

### #N3 — Name backfill silent-skip (resolved into observable, still a footgun)
`routers/stocks.py:273` comment marks the spot where `resolve_name` returning ticker-form/blank causes a skip.
A transient quote failure yields a no-op backfill with no retry. Diagnosability was improved (server skip log +
`skipped` in response) but the behavior (skip, don't retry) remains — operator must notice `updated:0` and re-run.

---

## Backend — batch / external-API discipline

### #B1 — Batch-backing views must NOT live-call external APIs on the request/startup path
Rankings, KR sector momentum, market indicators are precomputed by batches into `market_cache`/tables; requests
read stored values only. Live N-call serial fetch on the request path = multi-second latency (task#50). Enforced in:
- `services/kr_sector_service.py`, `services/market_indicators/*` (`cache.py` `_mc_load`/`_mc_save`),
  `services/recommendation/funnel.py`/`store.py`/`universe.py`.

Three sub-rules, each a past bug:
1. **Don't swallow fetch failures silently** — `services/recommendation/funnel.py:9` & `universe.py:118` explicitly
   forbid `except: pass` (task#48: `_fetch_one_sector` swallowed empty closes → all-None enshrined).
2. **Don't enshrine empty/all-None into cache** — if every value is None, skip the save (keep last good).
   `kr_sector_service.py:78` logs `all-None momentum — skipping save (직전값 유지)`; `funnel.py:330` `save 생략(all-None 박제 금지)`.
3. **Guard the failure class (all-None), not the suspected trigger** — re-occurrence prevention without root cause.

Startup empty-cache seeding via `_seed_*_if_empty` (rankings, kr_sector) in `backend/scheduler.py`
(see `backend/tests/test_scheduler_rankings.py`).

### #B2 — Batch-id retirement / source-field drift
Removing a batch id from `batch_registry.BATCHES` requires grepping **all** surfaces: schedule readers,
display strings (`schedule_desc`), every `job_runs.record(id, ...)` lane (auto + manual + backfill), and
asserting tests. A stale id ⇒ stale read or **execution history vanishing from the batch-status card**
(daily_report split, tasks 15/17/45 — recurred). Changing a batch's fetch source (e.g. KR ranking Naver→Kiwoom)
must also update that batch's `source` in `batch_registry` (else the status card shows the wrong origin).
`source` (fetch origin) and `usage` (consuming UI) point opposite ways — don't conflate.

---

## Backend — quote / data-parsing fragility

### #Q1 — Kiwoom signed-string / 억원 unit normalization
`backend/services/kiwoom/quote.py`: ka10001 returns sign-prefixed comma strings and 억원-unit market cap.
`_num()` (lines 10–20) strips signs/commas and maps `""`/`"-"`/`"+"` → None. `normalize_basic` (lines 28–56)
must: take `abs(cur_prc)` for price, derive `prev_close = price − pred_pre`, multiply `mac × 1e8` for KRW market cap.
Any consumer that skips this normalization gets sign-corrupted prices or 1e8-off caps. Quote chain is
Kiwoom→KIS→Naver (`market.get_quote_kr`); US is yfinance→KIS.

### #Q2 — KR chart 억원 formatter misuse (×1e8 mis-display)
`frontend/src/components/market/marketUtils.jsx` `krFmt` assumes input is **억원** (10,000억 = 1조 threshold).
Feeding raw 원 (must `/1e8` first) or counts (shares) → 1e8-off labels (the "35조경원" short-sell chart bug, f9594f2b).
Earnings/export charts (`M7EarningsSection`, `KrTop2Section`, `KrExportsSection`) are dual-Y (left=억/조 or $B, right=%).

### #Q3 — DART backlog parsing: 'wrong < missing'
`backend/services/backlog.py` parses 수주잔고 from raw disclosure XML (`/api/document.xml`, ZIP→decode) — DART has
no structured backlog API. Type-1 tables are extracted via header column mapping (`_expand_grid` rowspan/colspan),
amount 억원-normalized, validated by ~1% cross-check; only then `source='dart'`. Failures (cross-check fail,
multi-entity, foreign currency `USD천`, no-total multi-row) → `source='pending'` (amount=None) for Cowork to fill.
**Critical**: a parse failure must become `pending`, never an "억원 default" fallback — a wrong unit caption
default produces ×100 large mis-saves. ADR-0002/0003/0004/0005 govern this; ADR-0004 = explicitly DO NOT
auto-extract construction backlog. **Any parsing change needs post-deploy full-reload UAT** — fixture tests pass
yet miss real-data cases (foreign currency, split unit captions, pre-consolidation 회사-column tables).
`disclosures.py` shares the corp_code map (`_get_corp_code_map`); note `list.json` does NOT echo `pblntf_ty`, so
each core type A/B/C/D is fetched separately (4 calls/ticker).

### #Q4 — lxml not in local .venv
`lxml` is in `requirements.txt` + Docker image but **absent from `backend/.venv`**. HTML parsing in code/tests
verified locally must use stdlib `BeautifulSoup(html, "html.parser")`, not `"lxml"` — else local pytest breaks
while prod works (silent divergence).

---

## Deploy / operational hazards

### #D1 — Auto-deploy poller `git reset --hard` wipes uncommitted tracked edits
launchd `com.portfolion.auto-deploy-poll` runs `scripts/auto-deploy-poll.sh` every 2 min; if `origin/main` is ahead
of local HEAD it does `git reset --hard origin/main`. **Tracked edits not yet committed (or local ahead of origin,
not pushed) are lost within ≤2 min.** Always bundle commit + `git push origin main` immediately. `.forge/` and other
untracked files are safe (`reset --hard` doesn't touch them). The same `--hard` runs in `.github/workflows/deploy.yml`.
Concurrent deploys (poller + Actions runner) are serialized by `/tmp/portfolion-deploy.lock` in `deploy.sh`.

### #D2 — Frontend lands live before backend on a frontend-only build
nginx serves `frontend/dist` via `:ro` volume mount, so a local `npm run build` is immediately live. But
**backend changes are only live after the poller/Actions redeploy** (image rebuild). Building frontend first for a
feature that depends on new backend code yields a non-functioning feature until backend redeploys. Never run
`docker compose build/up` manually (CLAUDE.md).

### #D3 — Production writes/reads require user mediation
Prod DB/container writes, reads, and self-permission grants are blocked by the command classifier
(memory: reference-prod-writes-need-user). Mutations go through admin endpoints or user-run `!` commands; verify
end-state on the user's screen.

---

## Cross-cutting contract / doc-drift risks

### #C1 — Endpoint reshape must sweep ALL frontend consumers
Changing a response shape (array→object, etc.) non-additively requires `grep -rn '<path>' frontend/src/` for every
independent fetcher (e.g. `Analytics.jsx` fetches `/api/stocks/dashboard` directly, separate from the hook). One
missed consumer silently breaks (task52: dashboard array→`{holdings,totals}` left correlation tab always "no holdings").
Prefer additive field-adds.

### #C2 — Additive endpoint calls pollute `mock.call_args` tests
Adding a read/external call to an endpoint lengthens the *call sequence*, not just the response shape. Tests asserting
the last call via `mock.call_args` (single-call assumption) silently pass/fail wrong. Migrate to
`call_args_list[i].kwargs`, gate new calls behind `if <input non-empty>:`, and pin sequence with `call_count`
(tasks #66/#67).

### #C3 — Triple doc-sync obligation (DoD)
API surface changes must update **both** `API_SPEC.md` and `CLAUDE_COWORK_API.md` (one alone goes stale and misleads
Cowork). Feature-surface changes (nav/screens, env vars, stack, router/service/table, batches) must update the
matching `README.md` section in the same PR. Easy to forget; not enforced by CI.

### #C4 — KR color-token semantic-badge inversion
`frontend/src/styles/tokens.css`: `--up`=red (rise), `--down`=blue (fall). So `.badge--success`=red and
`.badge--danger`=blue (`ui/Badge.css`). Using success/danger on **semantic** (non-price-direction) badges inverts
Western meaning (green=good/red=warn) — the supply-band badge bug (b288f494). Semantic badges must specify explicit
colors (e.g. `ui/SupplyBadge.jsx`). The `warning` variant is currently broken (`--color-warning`/`--warning-tint`
undefined) and unusable as a caution color.

### #C5 — FastAPI route-order fragility
`PUT /api/stocks/enrich/batch` must be registered **before** `PUT /api/stocks/{ticker}/enrich` or FastAPI routes
`enrich` as a ticker value. Any new path-param route near a literal sibling risks the same shadowing
(`GET /{ticker}/backlog` once hid behind a catch-all → 500, fixed 57616211).

---

## Lower-severity / watch items
- **Empty catch blocks** — 6 `no-empty` lint hits indicate `catch {}` swallowing errors in frontend (diagnostic loss).
- **`react-refresh/only-export-components` (21)** — util modules co-export non-components alongside components,
  breaking HMR fast-refresh; concentrated in `marketUtils.jsx`/`reportUtils.jsx`/`icons.jsx`.
- **No backend coverage gate** — 75 test files exist but CI doesn't run pytest; regressions can land via the
  poller without test execution.
- **`ANTHROPIC_API_KEY`** still present in `.env.docker` but unused by backend (no `anthropic` in `requirements.txt`);
  dead config that can mislead (AI text comes from external Cowork via enrich API).

---
last_mapped_commit: 6b1c06b514d7ca9511360a7263b14cf97d783d18
mapped: 2026-06-28
---

# CONCERNS — Tech Debt, Known Bugs, Security, Performance, Fragile Areas

Implementation-level concerns for the PortfoliOn backend (FastAPI) and frontend (React). Each item cites real `file:line` and, where relevant, the retro/ADR that documented it. This is a map of *where the codebase is fragile*, not a glossary (see `CONTEXT.md` for terms).

---

## §1. `_warm_calendar_cache` startup bug — dead guard + live FRED call on every boot (UNFIXED)

**Location:** `backend/main.py:31-42` (the function), `backend/main.py:154` (spawned as a daemon thread at startup).

**The bug (two compounding defects):**

1. **Dead file-exists guard.** `backend/main.py:38` gates the warm with `if not calendar._cache_path(month_str).exists():`. `_cache_path` (`backend/routers/calendar.py:33-34`) returns `_CACHE_DIR / f"{month}.json"` — a *local file*. But calendar caching migrated to the `calendar_cache` *DB table* keyed by `user_id`; `_get_events` only ever writes to DB (`backend/routers/calendar.py:92-99`, guarded `if user_id:`) and **never writes the `.json` file** (the only `json.dumps` at line 98 targets the DB row). So the file never exists → the guard is always true → the warm re-runs every single startup.

2. **`user_id=""` caches nothing AND now triggers a live FRED call.** `_warm_calendar_cache` calls `calendar._get_events(month_str)` with the default `user_id=""` (`backend/routers/calendar.py:54`). With an empty user_id: the DB read is skipped (line 55 `if user_id:`), the portfolio is empty (line 64 → `{"stocks": [], "watchlist": []}`), and the DB write is skipped (line 92 `if user_id:`) — **so the warm caches nothing for anyone**. Worse, since task#119 added `_get_econ_events` to `_get_events` (called unconditionally at `backend/routers/calendar.py:89`), every backend startup now fires a **live FRED HTTP GET** (`backend/routers/calendar.py:191-202`, `requests.get` to `api.stlouisfed.org`) whenever `FRED_API_KEY` is set — violating the project's "no external call at startup" principle. The `_get_holidays` and `_get_agm_events` calls (lines 88, 90) also run pointlessly each boot.

**Status:** Known follow-up, repeatedly deferred. Logged in retros `.forge/retro/2026-06-28-event-calendar-expansion-2of3.md` and `.forge/retro/2026-06-28-event-calendar-expansion-3of3.md` ("후속(누적, 미해결): #119 D4 `_warm_calendar_cache` 기동-FRED 가드(fg-quick)"). A clean fix is fg-quick-sized: either skip the warm entirely (it caches nothing) or guard the FRED call out of the `user_id==""` path. The surrounding `except Exception: pass` (`backend/main.py:41`) means the FRED failure/latency is silent.

---

## §2. DB connection pool contention on cold `/api/stocks/dashboard` — guarded, sizing deferred

**Location:** pool config `backend/services/db.py:16-28`; dashboard build `backend/routers/stocks.py:472-494`.

The dashboard endpoint fans `holdings` cards across a `ThreadPoolExecutor(max_workers=min(len(holdings), 10))` (`backend/routers/stocks.py:490`), and each card does multiple DB reads (snapshot/consensus/dividend/supply-demand/insider). On a cold first call the pool can be starved: psycopg2's `ThreadedConnectionPool` **throws `PoolError` on exhaustion rather than blocking**, so an exhausted pool surfaces as a 500, not a queue.

**Mitigations in place (do not re-introduce the regression):**
- Pool `maxconn` was raised to **20** (`backend/services/db.py:25`) — deliberately above the max concurrent ThreadPool worker count (calendar 15, analysis 11) precisely because the pool throws instead of blocking (comment at `backend/services/db.py:23-24`).
- Per-card `_safe` wrapper (`backend/routers/stocks.py:482-488`) — any card that throws falls back to `_minimal_card` instead of 500-ing the whole response (invariant: holdings=N → always N cards, task#102).
- Whole-response `sanitize(...)` net (`backend/routers/stocks.py:494`) against NaN/inf (see §3).
- The batch-quote call is wrapped try/except→`{}` (`backend/routers/stocks.py:474-478`).
- Frontend bounded self-heal: `frontend/src/pages/Portfolio.jsx:79` retries the dashboard fetch up to 3 times (`dashHealTriesRef.current < 3`) and shows a Skeleton (not an empty state) while `stocks.length > 0` (`frontend/src/pages/Portfolio.jsx:50-54`, `134`).

**Deferred concern:** actual pool-vs-concurrency *sizing* tuning is explicitly deferred — the above guards block the *symptom* (500-to-empty grid) but the cold-start pool pressure under a large portfolio is unresolved. The other big ThreadPool fan-outs are independent risks against the same shared pool: calendar 15 workers (`backend/routers/calendar.py:83`), `enrich/batch` 8 workers (`backend/routers/stocks.py:269-270`).

---

## §3. NaN/inf → JSON 500 (starlette `allow_nan=False`) — recurring class

**Mechanism:** starlette `JSONResponse` serializes with `allow_nan=False`, so any `NaN`/`inf` reaching the response dict raises `Out of range float values are not JSON compliant` → **500**. The trap is that the *fallback* hides it differently: PostgreSQL rejects NaN in a `json` column (save fails), but Python `json.dumps` defaults to `allow_nan=True` so the file fallback *succeeds* — symptoms diverge and diagnosis lags. External quotes are the usual source (yfinance `Close`=NaN, FX `usdkrw`=NaN, correlation coefficients).

**Defended spots (the pattern is "guard at source, then sanitize as a net"):**
- `_usdkrw_rate` source guard: `backend/routers/stocks.py:313-328` — `math.isfinite` check so a NaN FX returns `None` (NaN≠None would otherwise slip past the `if fx is None` guard in `_portfolio_totals` and poison `totals`, task#104).
- `services.utils.sanitize` (`backend/services/utils.py:29`) recursively maps NaN/inf→None; applied as a net in `_build_all` (`backend/routers/stocks.py:494`) and in report-bake writes (`backend/services/report_generator.py:319`, `485`).
- macro-correlation & recommendations isfinite + sanitize (task#109, retro `.forge/retro/2026-06-27-nan-serialization-500-guards.md`).

**Standing rule / fragility:** *every* endpoint that serves external-quote floats or computed sums must isfinite-guard at the source **and** sanitize the response. This has recurred (dashboard totals task#104, digest 500 `8cd70a42`, macro-correlation/recommendations task#109). Source-guard alone isolates a bad row so other rows' weights survive; sanitize-only lets one NaN poison `total_krw` and null *all* weights — so both layers are needed (retro `.forge/retro/2026-06-27-nan-serialization-500-guards.md`). Any *new* endpoint adding a float to its response is a fresh instance of this risk.

---

## §4. KR quote-source glitches (NXT `_AL` transient bad ticks) — defended, structurally fragile

**Background:** KR live quotes use the Kiwoom SOR integrated code (`_AL` = NXT after-hours). It periodically returns *transient* bad ticks (e.g. 005930 priced at ~70k vs real ~354k) that get **baked into the daily report snapshot** if unguarded. This is not a persistent source bug — it's a momentary glitch frozen into a batch (root cause task#94). Two independent guards exist; both add real complexity and neither is a complete fix:

**Guard A — live dashboard (NXT) majority vote.** `backend/services/market/kr.py`:
- `_corroborated_pick` (`backend/services/market/kr.py:127`) — 2-of-N majority across independent price feeds; a feed is trusted only if ≥1 *other* feed agrees within 2x ([0.5, 2.0]).
- `_kr_pick_basic` (`backend/services/market/kr.py:181`) — lazy escalation: normally Kiwoom NXT + Kiwoom KRX (2 calls); on disagreement it escalates to KIS + Naver (up to 4 feeds) and discards the outlier.
- Degenerate fallback `_kr_pick_degenerate_lazy` (`backend/services/market/kr.py:162`) — when only one feed is available, falls back to single-feed self-check (`_price_sane`, prev_close ±30% / daily-bar 2x at `backend/services/market/kr.py:109`).

**Guard B — report-bake independent-feed gate (KR only).** `backend/services/report_generator.py:276-318`:
- Before baking, cross-checks the KRX `price` and daily-bar reference close against an *independent* ref feed at 2x. Multi-feed ref (task#118): Naver retry-once (`backend/services/report_generator.py:288-298`) → KIS fallback (`backend/services/report_generator.py:301`, dormant-safe if key unset).
- **If no ref feed at all → bake is SKIPPED** (prior good snapshot kept, wrong<missing) with a loud `print("[Report] ...")` (`backend/services/report_generator.py:305-309`). This closed the earlier hole where "no Naver → skip verification, proceed" silently no-op'd the gate (task#118, 005930 70k recurrence).

**Why it stays fragile (document, don't "fix" naively):**
- Guard B is **not immune to KRX self-consistent contamination** — if both KRX TRs (quote ka10001 + daily-bar ka10081) glitch together at the same batch instant, they corroborate each other and `_price_sane` is blind; only the independent ref feed catches it (task#101 comment at `backend/services/report_generator.py:316-317`).
- A deployed fix **does not retroactively heal already-baked stale snapshots** — a baked 70k must be *regenerated* (after probing the live source is clean, to avoid re-baking a transient glitch). See `CLAUDE.md` Gotchas + retros `.forge/retro/2026-06-28-report-bake-gate-multifeed.md`, `2026-06-22-kr-quote-majority-guard.md`, `2026-06-22-report-bake-independent-feed-gate.md`, ADR-0020 (`.forge/adr/0020-report-regular-session-live-nxt-price-basis.md`).
- The whole majority-vote machinery (`backend/services/market/kr.py` is ~15 `except` blocks deep) is intricate enough that a careless edit to feed priority can silently regress (e.g. the task#96 KRX single-anchor false-reject that survived into task#98).

---

## §5. External-source parsing — fixture-pass / live-fail (recurring, needs live checks in DoD)

External data parsers repeatedly pass mocked unit tests but fail on live data because mocks can't reproduce the real request requirements / label conventions. This has recurred across **at least four** slices and is the single most reliable bug class in the codebase.

**DART `fnlttSinglAcntAll` (KR financials)** — `backend/services/market/kr.py:367-470`:
- `fs_div` is a **required request param** (omitting it → DART `status 100 "필수값 누락"` → all None); request CFS→OFS fallback (`backend/services/market/kr.py:456-464`).
- The fs_div-requested response **does not echo per-row `fs_div`**, so filtering rows by `row.get("fs_div")` skips everything — `_dart_extract_3y` must *not* filter (`backend/services/market/kr.py:375-380`).
- Match by XBRL `account_id` (`backend/services/market/kr.py:367-380`), e.g. interest-coverage denominator is `이자의 지급` = `ifrs-full_InterestPaidClassifiedAsOperatingActivities` (`backend/services/market/kr.py:370`), **not** `금융비용`. (Contrast `fnlttSinglAcnt` in `backlog.py` which is the opposite convention.) Bug found only in live UAT — retro `.forge/retro/2026-06-27-financial-health-metrics-2of2.md` (task#117). A `silent except` had been *hiding* this exact bug → now `logger.warning`.

**yfinance label conventions** — `backend/services/market/us.py` + `_yf_val` (exact-match, returns None on mismatch):
- `get_income_stmt()`/`get_balance_sheet()`/`get_cashflow()` *methods* use no-space index labels (`OperatingCashFlow`); `.income_stmt`/`.cash_flow` *properties* use space labels (`Operating Cash Flow`). Mixing them → silent None for FCF/CapEx. Must use the `get_*()` methods (task#117).
- `info` dict keys are equally non-intuitive: PSR is `priceToSalesTrailing12Months` (numeral 12), **not** `...TwelveMonths` (task#112, retro `.forge/retro/2026-06-28-relative-valuation-multiples.md`).

**Naver rows / `document.xml` (KR backlog)** — `backend/services/backlog.py`: column-mapping + reconciliation; unit-caption parsing failures must yield `pending` not a "safe default (억원)" (a wrong unit → ×100 mis-store; "wrong < missing"). Live re-ingest catches cases fixtures miss (foreign-currency `(단위 : USD천)`, caption line-wraps). See `CLAUDE.md` Gotchas + ADR-0002/0003.

**DART list.json type blind spot** — `pblntf_ty` is not echoed and AGM disclosures are **only found by no-type calls** (the per-type A/B/C/D loop in `backend/services/disclosures.py` misses them); the AGM batch does its own no-type call (task#120, retro `.forge/retro/2026-06-28-event-calendar-expansion-2of3.md`).

**Standing rule:** the DoD for any external-source parsing slice must include a **live single-ticker extraction comparison** — mocks alone are insufficient. This is documented repeatedly in retros and `CLAUDE.md`.

---

## §6. KOSDAQ yfinance coverage is patchy + `_yf_sym` defaults KOSDAQ to `.KS`

**Location:** `backend/services/market/format.py:68-72`.

`_yf_sym` builds the yfinance symbol: for KR it uses `exchange` as the suffix, **defaulting to `KS` when `exchange` is empty** (`backend/services/market/format.py:70`). A KOSDAQ stock with a blank `exchange` field therefore gets `.KS` instead of `.KQ` — wrong exchange suffix → yfinance may 404. Even with the correct `.KQ`, **KOSDAQ coverage on yfinance is patchy** (some `.KQ` 404 outright).

**Impact:** the KR earnings-calendar feature (task#121) relies on `t.calendar["Earnings Date"]` via `_yf_sym` (`backend/routers/calendar.py:73`); `.KQ` 404s mean some KOSDAQ holdings show no forward earnings date in the calendar. yfinance is the *only* forward KR earnings-date source (Naver/DART provide no forward dates), so there is no fallback. Documented as a known limitation in retro `.forge/retro/2026-06-28-event-calendar-expansion-3of3.md` (D3) and `CLAUDE.md` Gotchas. The empty-`exchange`→`.KS` default is "existing app behaviour, not a new risk" per that retro, but it remains a latent wrong-symbol source for KOSDAQ.

---

## §7. Silent / broad `except` swallowing — diagnosis hazards

Broad `except Exception:` / `except: pass` blocks recur throughout the backend (~40+ outside tests). Most are intentional graceful-degradation, but several swallow errors that should be logged (the project's own "silent except 금지" rule, repeatedly re-learned — a silent except *hid* the DART fs_div bug in §5, retro `.forge/retro/2026-06-27-financial-health-metrics-2of2.md`).

**Notable swallowing spots (with `file:line`):**
- `backend/main.py:41` — `_warm_calendar_cache` startup `except Exception: pass` (hides the §1 FRED failure/latency).
- `backend/main.py:50` — `_warm_market_cache` startup swallow.
- `backend/services/db.py:37-39` — `get_connection` rolls back then re-raises (this one is correct, not swallowing).
- `backend/routers/stocks.py:39,51,75,120,155,194` — multiple bare `except Exception:` in the stocks router.
- `backend/services/report_generator.py` — many (`:57,98,156,162,188,201,373,388,416`); report generation degrades per-section but several are silent.
- `backend/services/job_runs.py:38,49,61,71,83,100` — job-run recording swallows (acceptable: telemetry must not break the job).
- `backend/services/scraper.py:38,91,129`, `backend/services/guru_scraper.py:32`, `backend/services/investor_service.py:83`, `backend/services/short_sell_service.py:16`, `backend/services/digest_service.py:48,163,198` — external-fetch swallows.

**Batch-fetch anti-pattern (documented in `CLAUDE.md`):** batch-backing views (ranking, KR sector momentum) must **not** swallow fetch failures silently and must **not** bake empty/all-None results into the cache (task#48 `_fetch_one_sector` swallowed empty closes → all-None baked; established task#48→49→50). Guard the *failure class* (all-None) not a suspected trigger.

**Frontend silent catches:** `frontend/src/hooks/usePortfolioData.js:39-40` (`fetchDashboard` `catch { // silent }`), `:62-64` (`refreshLivePrices`), and `.catch(() => {})` swallows at `:28,34,84,89`. The dashboard silent-catch is the one that produced the "header N / empty grid" symptom (task#102) — now backstopped by the §2 bounded retry, but the catch itself is unchanged. Additional `.catch(() => {})` in `App.jsx`, `Calendar.jsx`, `Ranking.jsx`, `ReportManualGen.jsx` (×3), `ConsensusSettings.jsx`, `AdminAnalytics.jsx`, `GuruCrawlNow.jsx`.

---

## §8. Other fragile / debt spots

- **`_get_econ_events` is an inline cache-miss FRED fetch, not batched** (`backend/routers/calendar.py:183-190`) — the docstring itself flags the upgrade path: "fetched inline at cache-miss; upgrade path = batch into market_cache if FRED rate-limits ever become a problem." Combined with §1, every cold calendar month-miss (and every startup) hits live FRED.
- **Phased/incremental-batch recurrence trap** — AGM batch originally skipped a ticker if *any* AGM was already resolved, which would have left *next year's* AGM permanently un-fetched (annual calendar silently dies in the next season). Fixed to skip only when the *latest rcept_no* is already resolved (task#120, retro `.forge/retro/2026-06-28-event-calendar-expansion-2of3.md` D1). This "does the batch still work in season 2?" lens is a standing review gap for any time-series/seasonal batch.
- **Cache-invalidation coupling (dual-source names)** — `tickers.name` vs `snapshots.data.name` must both update or list↔detail diverge; DB-only edits need `cache.invalidate(ticker)` + `invalidate_list()` or the list cache / snapshot LRU serve stale (`CLAUDE.md` Gotchas; storage→cache uses lazy import to avoid a circular reference).
- **Name backfill silently skips on transient quote failure** — `POST /api/stocks/names/backfill` skips a ticker without retry on a momentary quote failure (`updated:0`), so a 0 result must be re-run (task#77/#88; `skipped` list + server skip log added for diagnosis).
- **`scheduler/` is a package, not a single module** — `CLAUDE.md` still says "scheduler.py … 루트 레벨" but it's actually `backend/scheduler/` (doc drift flagged in retro `.forge/retro/2026-06-28-event-calendar-expansion-2of3.md` D3; partially corrected in commit `dac85f78`).
- **Stale test imports (pre-existing failures)** — `test_financials_kr*.py` had 5 failures from `from backend.services...` import paths; mostly fixed in commit `be9ae946`, but this `from backend.` vs `from services.` import-path inconsistency is a recurring footgun (retro `.forge/retro/2026-06-28-relative-valuation-multiples.md` open follow-up).
- **Startup idempotent migrations run inline at boot** — `_migrate` (`backend/main.py:54+`) runs `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` DDL on every startup, each wrapped in its own try/except with a `print` on failure (ADR-0006). Idempotent and intentional, but it means schema drift is masked unless logs are read.
- **Deferred placeholders in code** — `backend/services/recommendation/universe.py:17` ("후속 단계 확장"), `backend/services/recommendation/__init__.py:6` — explicit "to be expanded later" markers in the recommendation engine (phased universe, ADR-0015/0016).
- **KIS backup quote source is dormant-by-config** — `backend/services/kis/` is keyed off `KIS_APP_KEY` etc.; `configured()` returns False without keys so the whole fallback chain is inert (safe default). This is intentional (ADR-0011) but means the US yfinance→KIS and KR Kiwoom→KIS→Naver fallbacks are *untested in production* until keys are injected.

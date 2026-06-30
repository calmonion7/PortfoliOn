---
last_mapped_commit: 78750ecc2c96d71a9e3a3f225a56aea99db71db5
mapped: 2026-07-01
---

# CONCERNS — Tech Debt, Known Bugs, Security, Performance, Fragile Areas

Implementation-level concerns for the PortfoliOn backend (FastAPI) and frontend (React). Each item cites real `file:line` and, where relevant, the retro/ADR that documented it. This is a map of *where the codebase is fragile*, not a glossary (see `CONTEXT.md` for terms).

---

## §1. DB NUMERIC ↔ float arithmetic — `float`/`Decimal` TypeError → per-card throw → enrichment wipeout (FIXED, generalize)

**Location:** `backend/routers/stocks.py:369-379` (the dividend-income computation inside `_build_one` card builder).

**The bug (root cause of the task#102 symptom):** `avg_cost` / `quantity` come from a PostgreSQL **NUMERIC** column and arrive as Python `Decimal`; `annual_dividend_per_share` (`annual_div`) comes from the dividends store as a Python `float`. Dividing them directly (`annual_div / avg_cost`) raises `TypeError: unsupported operand type(s) for /: 'float' and 'decimal.Decimal'`. That throw happens *inside per-card enrichment*, so the `_safe` wrapper (`backend/routers/stocks.py:485`) catches it and falls back to `_minimal_card` (`backend/routers/stocks.py:456`) — meaning **every holding card silently loses its enrichment** (consensus/dividend/supply/insider all stripped to the minimal shape). The grid renders but is empty of analysis.

**Fix (in place — do not regress):** coerce both operands with `float(...)` before arithmetic — `round(float(annual_div) / float(avg_cost) * 100, 2)` and `round(float(annual_div) * float(qty), 2)` (`backend/routers/stocks.py:376-379`), with the explanatory comment at `backend/routers/stocks.py:373-375`.

**Why it's a standing class, not a one-off:** the `_minimal_card` fallback **masks the root cause** — the response is a valid 200 with valid-shaped (but degraded) cards, so there is no 500 and no obvious error. Diagnose via the per-card fallback log: `docker logs portfolion-backend-1 | grep '최소카드 폴백'` (the `print(...최소카드 폴백...)` at `backend/routers/stocks.py:490`). **Generalize:** any arithmetic mixing a NUMERIC-column value (→`Decimal`) with an external/computed `float` (yfinance, dividends, FX, consensus) is a fresh instance — coerce at the boundary. This is the *same* fragility family as the §3 NaN/inf trap (external float meets a strict consumer), just surfacing as a TypeError instead of a serialization 500.

---

## §2. yfinance percent fields are *decimal fractions* — ×100 display scale (recurring: #122 short%, #123 pct_buy)

**Mechanism:** yfinance returns percent-like fields as **0–1 decimal fractions**, not percents: `info.shortPercentOfFloat` (0.0098 = 0.98%), `institutional_holders.pctHeld` / `pctChange`, `insider_purchases` `% Buy Shares` / `% Sell Shares` (0.0476 = 4.76%), `info.dividendYield`, etc. The backend stores them raw (`backend/services/us_supply.py:74,77,114,124` — `_finite(...)` of each field) and the **frontend must multiply by 100 for display**.

**Defended spots (frontend, ×100):**
- `frontend/src/components/reports/UsSupplySection.jsx:80` (`short_pct_float * 100`), `:123` (`pct_held * 100`), `:127` (`pct_change * 100`).
- `frontend/src/components/reports/UsInsiderSection.jsx:106` (`pct_buy * 100`), `:112` (`pct_sell * 100`).

**Why it keeps recurring:** unit tests assert the *stored fraction*, never the *rendered %*, so this trap is invisible to fixtures and only shows in live UI (the frontend-display face of §5's fixture-pass/live-fail). It is easy to ×100 one field and miss a sibling — task#122 shipped short% as `0.01%` (one field missed while the institutional table was already ×100; caught by adversarial Review). task#123 then mis-wrote `pct_buy`/`pct_sell` *as percents (4.76/95.24)* in API_SPEC examples + fixtures while yfinance returns fractions (0.0476/0.9524) — doc/fixture drift, not a render bug. Two consecutive recurrences (#122, #123) promoted this to a `CLAUDE.md` Gotcha (`CLAUDE.md:213`). **Standing rule:** every percent-display field must be scale-checked *individually*, and API_SPEC example values + test fixtures must also use the fraction scale. Retros: `.forge/retro/2026-06-29-us-supply-demand-signals-1of3.md` (D1), `.forge/retro/2026-06-30-us-supply-demand-signals-2of3.md` (D1).

---

## §3. DB connection pool contention on cold `/api/stocks/dashboard` — guarded, sizing deferred

**Location:** pool config `backend/services/db.py:16-28`; dashboard build `backend/routers/stocks.py:472-494`.

The dashboard endpoint fans `holdings` cards across a `ThreadPoolExecutor(max_workers=min(len(holdings), 10))` (`backend/routers/stocks.py:490`), and each card does multiple DB reads (snapshot/consensus/dividend/supply-demand/insider). On a cold first call the pool can be starved: psycopg2's `ThreadedConnectionPool` **throws `PoolError` on exhaustion rather than blocking**, so an exhausted pool surfaces as a 500, not a queue.

**Mitigations in place (do not re-introduce the regression):**
- Pool `maxconn` was raised to **20** (`backend/services/db.py:25`) — deliberately above the max concurrent ThreadPool worker count (calendar 15, analysis 11) precisely because the pool throws instead of blocking (comment at `backend/services/db.py:23-24`).
- Per-card `_safe` wrapper (`backend/routers/stocks.py:485-491`) — any card that throws falls back to `_minimal_card` instead of 500-ing the whole response (invariant: holdings=N → always N cards, task#102). NOTE: this *also* masks the §1 TypeError class — see §1 for the diagnosis log.
- Whole-response `sanitize(...)` net (`backend/routers/stocks.py:494`) against NaN/inf (see §4).
- The batch-quote call is wrapped try/except→`{}` (`backend/routers/stocks.py:474-478`).
- Frontend bounded self-heal: `frontend/src/pages/Portfolio.jsx` retries the dashboard fetch up to 3 times and shows a Skeleton (not an empty state) while `stocks.length > 0` (task#102).

**Deferred concern:** actual pool-vs-concurrency *sizing* tuning is explicitly deferred — the above guards block the *symptom* (500-to-empty grid) but the cold-start pool pressure under a large portfolio is unresolved. The other big ThreadPool fan-outs are independent risks against the same shared pool: calendar 15 workers (`backend/routers/calendar.py`), `enrich/batch` 8 workers (`backend/routers/stocks.py:269-270`).

---

## §4. NaN/inf → JSON 500 (starlette `allow_nan=False`) — recurring class

**Mechanism:** starlette `JSONResponse` serializes with `allow_nan=False`, so any `NaN`/`inf` reaching the response dict raises `Out of range float values are not JSON compliant` → **500**. The trap is that the *fallback* hides it differently: PostgreSQL rejects NaN in a `json` column (save fails), but Python `json.dumps` defaults to `allow_nan=True` so the file fallback *succeeds* — symptoms diverge and diagnosis lags. External quotes are the usual source (yfinance `Close`=NaN, FX `usdkrw`=NaN, correlation coefficients, CAPE crawl values).

**Defended spots (the pattern is "guard at source, then sanitize as a net"):**
- `_usdkrw_rate` source guard: `backend/routers/stocks.py:313-328` — `math.isfinite` check so a NaN FX returns `None` (NaN≠None would otherwise slip past the `if fx is None` guard in `_portfolio_totals` and poison `totals`, task#104).
- `services.utils.sanitize` (`backend/services/utils.py`) recursively maps NaN/inf→None; applied as a net in `_build_all` (`backend/routers/stocks.py:494`) and in report-bake writes (`backend/services/report_generator.py`).
- Market-index/CAPE crawl: `math.isfinite` checks throughout `backend/services/market_indicators/indices.py:22,32,80,86` + `sanitize` net at `backend/services/market_indicators/indices.py:132-133` (task#113; CAPE crawled from multpl.com, see §5).
- macro-correlation & recommendations isfinite + sanitize (task#109, retro `.forge/retro/2026-06-27-nan-serialization-500-guards.md`).

**Standing rule / fragility:** *every* endpoint that serves external-quote floats or computed sums must isfinite-guard at the source **and** sanitize the response. This has recurred (dashboard totals task#104, digest 500 `8cd70a42`, macro-correlation/recommendations task#109). Source-guard alone isolates a bad row so other rows' weights survive; sanitize-only lets one NaN poison `total_krw` and null *all* weights — so both layers are needed (retro `.forge/retro/2026-06-27-nan-serialization-500-guards.md`). Any *new* endpoint adding a float to its response is a fresh instance of this risk.

---

## §5. External-source parsing — fixture-pass / live-fail (recurring, needs live checks in DoD)

External data parsers repeatedly pass mocked unit tests but fail on live data because mocks can't reproduce the real request requirements / label conventions. This has recurred across **many** slices and is the single most reliable bug class in the codebase.

**DART `fnlttSinglAcntAll` (KR financials)** — `backend/services/market/kr.py:367-470`:
- `fs_div` is a **required request param** (omitting it → DART `status 100 "필수값 누락"` → all None); request CFS→OFS fallback (`backend/services/market/kr.py:456-464`).
- The fs_div-requested response **does not echo per-row `fs_div`**, so filtering rows by `row.get("fs_div")` skips everything — `_dart_extract_3y` must *not* filter (`backend/services/market/kr.py:375-380`).
- Match by XBRL `account_id` (`backend/services/market/kr.py:367-380`), e.g. interest-coverage denominator is `이자의 지급` = `ifrs-full_InterestPaidClassifiedAsOperatingActivities` (`backend/services/market/kr.py:370`), **not** `금융비용`. (Contrast `fnlttSinglAcnt` in `backlog.py` which is the opposite convention.) Bug found only in live UAT — retro `.forge/retro/2026-06-27-financial-health-metrics-2of2.md` (task#117). A `silent except` had been *hiding* this exact bug → now `logger.warning`.

**yfinance label conventions** — `backend/services/market/us.py` + `_yf_val` (exact-match, returns None on mismatch):
- `get_income_stmt()`/`get_balance_sheet()`/`get_cashflow()` *methods* use no-space index labels (`OperatingCashFlow`); `.income_stmt`/`.cash_flow` *properties* use space labels (`Operating Cash Flow`). Mixing them → silent None for FCF/CapEx. Must use the `get_*()` methods (task#117).
- `info` dict keys are equally non-intuitive: PSR is `priceToSalesTrailing12Months` (numeral 12), **not** `...TwelveMonths` (task#112, retro `.forge/retro/2026-06-28-relative-valuation-multiples.md`).
- (The yfinance percent-*scale* trap is its own recurring class — see §2.)

**S&P 500 Shiller CAPE crawl** — `backend/services/market_indicators/indices.py:39-103`:
- FRED has **no** CAPE series (its "Case-Shiller" is the *housing-price* index), so CAPE is scraped from `multpl.com/shiller-pe` via `requests.get` + `BeautifulSoup(html, "html.parser")` (`backend/services/market_indicators/indices.py:42,96-102`). `html.parser` (not `lxml`) is required because the local `.venv` lacks `lxml` (`CLAUDE.md` Gotcha; Docker has it, local doesn't). HTML-structure drift on multpl.com would silently break parsing — both `_parse_multpl_cape` and the fetch are wrapped `except Exception: return None` (`backend/services/market_indicators/indices.py:90,103`), so a layout change degrades gracefully but invisibly (CAPE just disappears).

**Naver rows / `document.xml` (KR backlog)** — `backend/services/backlog.py`: column-mapping + reconciliation; unit-caption parsing failures must yield `pending` not a "safe default (억원)" (a wrong unit → ×100 mis-store; "wrong < missing"). Live re-ingest catches cases fixtures miss (foreign-currency `(단위 : USD천)`, caption line-wraps). See `CLAUDE.md` Gotchas + ADR-0002/0003.

**DART list.json type blind spot** — `pblntf_ty` is not echoed and AGM disclosures are **only found by no-type calls** (the per-type A/B/C/D loop in `backend/services/disclosures.py` misses them); the AGM batch does its own no-type call (task#120, retro `.forge/retro/2026-06-28-event-calendar-expansion-2of3.md`).

**Standing rule:** the DoD for any external-source parsing slice must include a **live single-ticker extraction comparison** — mocks alone are insufficient. This is documented repeatedly in retros and `CLAUDE.md`.

---

## §6. KR quote-source glitches (NXT `_AL` transient bad ticks) — defended, structurally fragile

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

## §7. FOMC `_FOMC_DATES` — static hard-coded list, yearly manual refresh, exhaustion → graceful missing

**Location:** `backend/routers/calendar.py:27-35` (the list), `backend/routers/calendar.py:201-211` (consumed in `_get_events`).

The FOMC policy-decision calendar (task#125, the current HEAD `78750ecc`) is a **static Python list** of 24 hard-coded dates (`2025-01-29` … `2027-12-08`), expanded unconditionally into calendar events regardless of `FRED_API_KEY` (`backend/routers/calendar.py:201`). Two concerns:

1. **Yearly manual update required.** Coverage ends at ~2027-12; the comment at `backend/routers/calendar.py:27` flags this ("차기 일정 공표 시 연 1회 수동 갱신"). When the list is exhausted the FOMC events simply stop appearing — **graceful missing, not a crash** (the loop just iterates an empty tail). The failure mode is "calendar silently loses a recurring event class," which nobody notices until someone looks for a future FOMC date.
2. **2027 dates are tentative.** The Fed publishes the following year's schedule late in the prior year; the 2027 entries (`backend/routers/calendar.py:33-34`) are best-effort/tentative and may shift once officially announced (e.g. `2027-06-09` looked early relative to the usual mid-month cadence). They must be reconciled against the official federalreserve.gov release when it lands.

This is the same maintenance shape as any hard-coded date table; it is intentional (no live FOMC feed exists comparable to FRED) but is a standing annual TODO.

---

## §8. KOSDAQ yfinance coverage is patchy + `_yf_sym` defaults KOSDAQ to `.KS`

**Location:** `backend/services/market/format.py:68-72`.

`_yf_sym` builds the yfinance symbol: for KR it uses `exchange` as the suffix, **defaulting to `KS` when `exchange` is empty** (`backend/services/market/format.py:70`). A KOSDAQ stock with a blank `exchange` field therefore gets `.KS` instead of `.KQ` — wrong exchange suffix → yfinance may 404. Even with the correct `.KQ`, **KOSDAQ coverage on yfinance is patchy** (some `.KQ` 404 outright).

**Impact:** the KR earnings-calendar feature (task#121) relies on `t.calendar["Earnings Date"]` via `_yf_sym` (`backend/routers/calendar.py:73`); `.KQ` 404s mean some KOSDAQ holdings show no forward earnings date in the calendar. yfinance is the *only* forward KR earnings-date source (Naver/DART provide no forward dates), so there is no fallback. Documented as a known limitation in retro `.forge/retro/2026-06-28-event-calendar-expansion-3of3.md` (D3) and `CLAUDE.md` Gotchas. The empty-`exchange`→`.KS` default is "existing app behaviour, not a new risk" per that retro, but it remains a latent wrong-symbol source for KOSDAQ.

---

## §9. Silent / broad `except` swallowing — diagnosis hazards

Broad `except Exception:` / `except: pass` blocks recur throughout the backend (~40+ outside tests). Most are intentional graceful-degradation, but several swallow errors that should be logged (the project's own "silent except 금지" rule, repeatedly re-learned — a silent except *hid* the DART fs_div bug in §5, retro `.forge/retro/2026-06-27-financial-health-metrics-2of2.md`).

**Notable swallowing spots (with `file:line`):**
- `backend/main.py` — `_warm_market_cache` startup `except` swallow (the startup market-cache warm; the older `_warm_calendar_cache` startup-FRED warm was **REMOVED** in commit `f1d9658e` — no longer a concern).
- `backend/services/db.py:37-39` — `get_connection` rolls back then re-raises (this one is correct, not swallowing).
- `backend/routers/stocks.py` — multiple bare `except Exception:` in the stocks router (e.g. `:39,51,75,120,155,194` region).
- `backend/services/report_generator.py` — many `except` blocks; report generation degrades per-section but several are silent.
- `backend/services/job_runs.py` — job-run recording swallows (acceptable: telemetry must not break the job).
- `backend/services/scraper.py`, `backend/services/guru_scraper.py`, `backend/services/investor_service.py`, `backend/services/short_sell_service.py`, `backend/services/digest_service.py`, `backend/services/us_supply.py` (`_finite` + per-fetch try/except), `backend/services/market_indicators/indices.py:90,103` (CAPE crawl) — external-fetch swallows.

**Batch-fetch anti-pattern (documented in `CLAUDE.md`):** batch-backing views (ranking, KR sector momentum) must **not** swallow fetch failures silently and must **not** bake empty/all-None results into the cache (task#48 `_fetch_one_sector` swallowed empty closes → all-None baked; established task#48→49→50). Guard the *failure class* (all-None) not a suspected trigger.

**Frontend silent catches:** `frontend/src/hooks/usePortfolioData.js` (`fetchDashboard` `catch { // silent }`, `refreshLivePrices`, and `.catch(() => {})` swallows). The dashboard silent-catch is the one that produced the "header N / empty grid" symptom (task#102) — now backstopped by the §3 bounded retry, but the catch itself is unchanged. Additional `.catch(() => {})` in `App.jsx`, `Calendar.jsx`, `Ranking.jsx`, `ReportManualGen.jsx`, `ConsensusSettings.jsx`, `AdminAnalytics.jsx`, `GuruCrawlNow.jsx`.

---

## §10. Other fragile / debt spots

- **`_get_econ_events` is an inline cache-miss FRED fetch, not batched** (`backend/routers/calendar.py:183-202`) — the docstring flags the upgrade path: "fetched inline at cache-miss; upgrade path = batch into market_cache if FRED rate-limits ever become a problem." Every cold calendar month-miss hits live FRED. (NOTE: the *startup* FRED-on-boot defect via `_warm_calendar_cache` was removed in `f1d9658e`; this remaining inline-on-cache-miss path is the lower-severity residue.)
- **Phased/incremental-batch recurrence trap** — AGM batch originally skipped a ticker if *any* AGM was already resolved, which would have left *next year's* AGM permanently un-fetched (annual calendar silently dies in the next season). Fixed to skip only when the *latest rcept_no* is already resolved (task#120, retro `.forge/retro/2026-06-28-event-calendar-expansion-2of3.md` D1). This "does the batch still work in season 2?" lens is a standing review gap for any time-series/seasonal batch (and is the same shape as the §7 FOMC-list exhaustion).
- **Cache-invalidation coupling (dual-source names)** — `tickers.name` vs `snapshots.data.name` must both update or list↔detail diverge; DB-only edits need `cache.invalidate(ticker)` + `invalidate_list()` or the list cache / snapshot LRU serve stale (`CLAUDE.md` Gotchas; storage→cache uses lazy import to avoid a circular reference).
- **Name backfill silently skips on transient quote failure** — `POST /api/stocks/names/backfill` skips a ticker without retry on a momentary quote failure (`updated:0`), so a 0 result must be re-run (task#77/#88; `skipped` list + server skip log added for diagnosis).
- **`scheduler/` is a package, not a single module** — `CLAUDE.md` still says "scheduler.py … 루트 레벨" but it's actually `backend/scheduler/` (doc drift flagged in retro `.forge/retro/2026-06-28-event-calendar-expansion-2of3.md` D3; partially corrected in commit `dac85f78`).
- **Stale test imports (pre-existing failures)** — `test_financials_kr*.py` had failures from `from backend.services...` import paths; mostly fixed in commit `be9ae946`, but this `from backend.` vs `from services.` import-path inconsistency is a recurring footgun (retro `.forge/retro/2026-06-28-relative-valuation-multiples.md` open follow-up).
- **Startup idempotent migrations run inline at boot** — `_migrate` (`backend/main.py`) runs `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` DDL on every startup, each wrapped in its own try/except with a `print` on failure (ADR-0006). Idempotent and intentional, but it means schema drift is masked unless logs are read.
- **Deferred placeholders in code** — `backend/services/recommendation/universe.py:17` ("후속 단계 확장"), `backend/services/recommendation/__init__.py:6` — explicit "to be expanded later" markers in the recommendation engine (phased universe, ADR-0015/0016).
- **KIS backup quote source is dormant-by-config** — `backend/services/kis/` is keyed off `KIS_APP_KEY` etc.; `configured()` returns False without keys so the whole fallback chain is inert (safe default). This is intentional (ADR-0011) but means the US yfinance→KIS and KR Kiwoom→KIS→Naver fallbacks are *untested in production* until keys are injected.
- **US supply/insider snapshot populates only via batch** — `us_supply_snapshot` (short interest + institutional + Form4 insider) is filled by the `us_supply_fetch` batch; `GET /report/{ticker}/us-supply` and `/us-insider` read stored values only (no live yfinance on request). Until the batch runs post-deploy the sections render empty (verification deferred-by-design, like calendar/dividends; retros `.forge/retro/2026-06-29-us-supply-demand-signals-1of3.md`, `...-2of3.md`).

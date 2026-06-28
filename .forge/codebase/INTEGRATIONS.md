---
last_mapped_commit: 6b1c06b514d7ca9511360a7263b14cf97d783d18
mapped: 2026-06-28
---

# INTEGRATIONS

External APIs, data sources, datastore, and auth providers — what each is used for and the service file path. (Domain concepts belong in CONTEXT.md.)

## Market quote / financial data

### yfinance (Yahoo Finance)
- **Use**: primary US quotes/financials/history; also some KR financials and market-indicator history. US 1st-line source.
- **Files**: `backend/services/market/us.py` (`get_annual_financials_us` via `get_income_stmt`/`get_balance_sheet`/`get_cashflow` methods), `backend/services/market/kr.py`, `backend/services/ranking_service.py`, `backend/services/analysis_service.py` (SECTOR_ETFS, MACRO_TICKERS TLT/UUP/USO/^VIX), `backend/services/market_indicators/` (`fx.py` `^VIX`, `commodities.py` treasuries `^IRX/^FVX/^TNX/^TYX`, `earnings.py`, `indices.py` `^GSPC`/`^KS11`/`^KQ11`).
- **No API key.** US quote chain: yfinance → KIS (backup).

### Naver Mobile Stock API
- **Use**: KR quote/financials fallback (when 키움 unset/fails/empty); also KR earnings.
- **Endpoint**: `https://m.stock.naver.com/api/stock/{code}/...` (custom User-Agent + Referer headers).
- **Files**: `backend/services/market/kr.py` (`_naver_get`, `_NAVER_BASE`), `backend/services/market_indicators/earnings.py`.
- **No API key** (public web API).

### FnGuide (KR market cap scrape)
- **Use**: KR market-cap fallback parsed from `comp.fnguide.com` HTML.
- **File**: `backend/services/market/kr.py` (`_fnguide_market_cap`, regex over stripped HTML).

### 키움 / Kiwoom REST API
- **Use**: **KR read-only primary quote source** (boundary ADR-0009 — quotes/charts/sector/investor/short-sell TRs only; no account/order). KR 1st-line.
- **Auth**: server-side single key `KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`, base `KIWOOM_BASE_URL` (default `https://api.kiwoom.com`). In-process singleton token, 401 retry, serial throttle (min 0.25s), 12h token cache. `configured()` gates (unset → caller falls back).
- **Files**: `backend/services/kiwoom/client.py` (token + `request(api_id, body, category)`, `integrated_code(stk_cd, regular)` SOR `_AL` vs plain KRX), `backend/services/kiwoom/quote.py` (ka10001), `backend/services/kiwoom/sector.py` (ka20006 sector daily closes, ka20002 sector→stock mapping), `backend/services/kiwoom/investor.py` (ka10059 flows, ka10008 foreign ratio), `backend/services/kiwoom/chart.py` (ka10081 daily / ka10082 weekly / ka10083 monthly bars), `backend/services/kiwoom/shortsell.py` (ka10014).
- Consumed by `backend/services/kr_sector_service.py`, `backend/services/short_sell_service.py`, `backend/services/investor_service.py`. Catalog: `KIWOOM_API.md`.

### KIS — 한국투자증권 (Korea Investment Securities) REST API
- **Use**: **read-only BACKUP quote source** (boundary ADR-0011). KR chain 키움→KIS→Naver; US chain yfinance→KIS. Dormant when keys unset.
- **Auth**: `KIS_APP_KEY`/`KIS_APP_SECRET`, base `KIS_BASE_URL` (default live `https://openapi.koreainvestment.com:9443`). `/oauth2/tokenP` singleton token, EGW00133 reissue guard (60s min), 401 retry, serial throttle (0.05s), 23h token cache, `custtype=P` header.
- **Files**: `backend/services/kis/client.py` (`request(tr_id, path, params)`), `backend/services/kis/quote.py` (KR `FHKST01010100`; US price `HHDFS00000300` + daily `HHDFS76240000`, EXCD NAS→NYS→AMS probe).
- Catalog: `KIS_API.md`.

## DART — OpenDART (Korea FSS disclosures)
- **Base**: `https://opendart.fss.or.kr/api`. **Auth**: `DART_API_KEY` (required, KR-only). corp_code map from `corpCode.xml` (cached ~1 week), reused across services via `backlog._get_corp_code_map`.
- **Order backlog** — `backend/services/backlog.py` (+ parser `backend/services/backlog_parser.py`): `list.json` → recent report `rcept_no`; `document.xml` (ZIP, all members decoded/joined) for raw text; `fnlttSinglAcnt.json` for financial-context accounts. Auto-extract type-1 supply tables with reconciliation, else `pending` for Cowork.
- **Disclosure feed** — `backend/services/disclosures.py`: `list.json` called **per core type A/B/C/D separately** (response omits `pblntf_ty`, so query value is stamped). dedup upsert by `rcept_no` to `stock_disclosures`. status 013 (no data) graceful.
- **AGM meeting dates** — `backend/services/agm.py`: `list.json` called with **NO `pblntf_ty`** (specifying type returns 0 AGM filings) then filtered by '주주총회'; `document.xml` text parsed for meeting date (structured table / free-text / fallback strategies). Upsert to `stock_disclosures.meeting_date`. Batch id `agm_fetch`.
- **Insider / 5% holdings** — `backend/services/insider_trades.py`: `elestock.json` (officer/major-shareholder ownership → 'insider') + `majorstock.json` (5%-rule → 'major5'), idempotent upsert by `row_hash` to `stock_insider_trades`.
- **Dividends (KR side)** — `backend/services/dividends.py`: `alotMatter.json` (latest annual `reprt_code=11011`, common-stock per-share dividend + yield current-period values).

## FRED — St. Louis Fed (US macro / economic data)
- **Base**: `https://api.stlouisfed.org/fred/series/observations`. **Auth**: `FRED_API_KEY` (unset → fetch fails gracefully, stored values unchanged). Incremental fetch (observation_start = last stored date).
- **Files**: `backend/services/market_indicators/econ.py` (CPI, unemployment, etc. — `monthly_us` batch), `backend/services/market_indicators/macro.py` (`macro_signals`: `T10Y2Y`, `BAMLH0A0HYM2`, `M2SL`, `DFF` + signal evaluation; `macro_signals_fetch` batch). **Also `backend/routers/calendar.py` `_get_econ_events`** uses the `https://api.stlouisfed.org/fred/releases/dates` endpoint (curated major US release names — CPI/Employment/GDP/PPI) for the calendar `econ` event type (request-time on calendar cache-miss, market-wide; `FRED_API_KEY` unset → no econ events, graceful).
- Note: two FRED endpoints are used — `series/observations` (market-indicator values, `econ.py`/`macro.py`) and `releases/dates` (calendar econ event dates, `calendar.py`). FRED has no S&P CAPE series (FRED "Case-Shiller" is housing prices); CAPE is scraped from multpl.com (see below).

## S&P 500 Shiller CAPE — multpl.com scrape
- **Use**: US valuation (S&P500 CAPE current + mean/median/min/max) for `GET /api/market/indices`.
- **Endpoint**: `https://www.multpl.com/shiller-pe` (HTML scrape via `requests` + `BeautifulSoup(html, "html.parser")` — local lxml absent).
- **File**: `backend/services/market_indicators/indices.py` (`_parse_multpl_cape`).

## FX rate — open.er-api.com
- **Use**: USD-base FX rates (e.g. USDKRW) for FX section / portfolio KRW conversion.
- **Endpoint**: `https://open.er-api.com/v6/latest/USD` (no key).
- **File**: `backend/services/market_indicators/fx.py`.

## KOFIA / 공공데이터포털 (data.go.kr) — leverage & lending
- **Auth**: `KOFIA_API_KEY` (shared by both services; unset → request fails). Paginated (`numOfRows`/`pageNo`).
- **Leverage** — `backend/services/leverage_service.py`: `https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService` (credit balance, forced liquidation/반대매매) + `.../GetMarketIndexInfoService` (market cap). → `market_leverage_indicators` table.
- **Lending** — `backend/services/lending_service.py`: `https://apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2/getNatiAndForeLendAndBorrBalaCo_V2` (domestic/foreign 대차잔고). → `market_lending_balance` table.

## 관세청 / KITA — KR exports (semiconductors etc.)
- **Use**: KR monthly export figures (`monthly_kr` batch).
- **Primary**: Korea Customs Service `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList` via `KITA_API_KEY` (note: env name `KITA_API_KEY` is actually the 관세청 key).
- **Fallback**: UN Comtrade public API `https://comtradeapi.un.org/public/v1/preview/C/M/HS` (no key) — used when `KITA_API_KEY` unset or customs fetch fails.
- **File**: `backend/services/market_indicators/exports.py`.

## PostgreSQL (Docker)
- **Use**: primary datastore (runtime data); local JSON files are caches only.
- **Driver/access**: `backend/services/db.py` (psycopg2 `ThreadedConnectionPool`, DSN `DATABASE_URL`).
- **Schemas**: `backend/auth_schema.sql` (users, refresh_tokens — runs first) then `backend/app_schema.sql` (tickers, user_stocks, snapshots, schedules, guru_*, digests, consensus_history, calendar_cache, market_cache, user_menu_permissions, user_events, market_leverage_indicators, market_lending_balance, raw_reports, daily_consensus_mart, stock_disclosures, stock_insider_trades, market_short_sell, backlog_history, stock_dividends, etc.). Container: `postgres:16-alpine` (`docker-compose.yml`).
- **Market-indicator cache**: `backend/services/market_indicators/cache.py` (`_mc_load`/`_mc_save` over `market_cache`).

## Auth providers
- **Google OAuth** — `backend/routers/auth.py`: redirect to `https://accounts.google.com/o/oauth2/v2/auth`, token exchange `https://oauth2.googleapis.com/token` (via `httpx`). Keys `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Callback `FRONTEND_URL + /api/auth/oauth/google/callback`.
- **GitHub OAuth** — `backend/routers/auth.py`: `https://github.com/login/oauth/authorize` → `.../access_token` → `https://api.github.com/user` + `/user/emails`. Keys `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` (currently blank in env → effectively dormant).
- **JWT (local + OAuth sessions)** — `backend/services/auth_service.py`: HS256 via `python-jose`, `JWT_SECRET`; access 1h / refresh 30d; bcrypt password hashing; `upsert_oauth_user` links provider accounts. Library: `authlib` (dep) + `python-jose`.
- **Session** — starlette `SessionMiddleware` with `SESSION_SECRET` (`backend/main.py`).

## Cowork (external AI analysis writer)
- **Use**: external Claude/Cowork client writes AI analysis text via enrich/backlog endpoints (backend itself has no LLM). Gated by `COWORK_API_KEY`.
- **Spec**: `CLAUDE_COWORK_API.md` (consumes `PUT /api/report/{ticker}/...` enrich routes). Backend code in `backend/routers/report.py` / `backend/routers/stocks.py`.

## Cloudflare Tunnel
- **Use**: public ingress `portfolion.taebro.com` → `localhost:80` (nginx). TLS terminated at Cloudflare (nginx 443 block commented out).
- **Run**: `cloudflared` is NOT a compose container — launched via launchd. Referenced in `CLAUDE.md`, `README.md`, `docs/ops/deploy.md`, `scripts/ddns_update.sh` (Cloudflare DNS API for DDNS). Not driven from application code.

## Scheduling / batches
- `backend/scheduler/` (APScheduler) drives batch jobs; `backend/services/batch_registry.py` is the batch catalog (each batch has `market` KR/US/공통, `source`, `usage`); `backend/services/job_runs.py` records runs (`job_runs.record`). `GET /api/batches` exposes the registry.

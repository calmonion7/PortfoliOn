---
last_mapped_commit: c482aa6811262685f424cb8fb871e8121cf438c6
mapped: 2026-07-02
---

# INTEGRATIONS

External APIs and data sources, each with its backend service file path. All HTTP unless noted; most use `requests`, OAuth token exchange uses `httpx`. Keys read from env (see STACK.md).

## yfinance (Yahoo Finance)

Library (`import yfinance as yf`), not an HTTP endpoint. Primary US source.

- **US market quotes / history / financials** — `backend/services/market/us.py`. `yf.Ticker(yf_sym)`, `.history(period=...)`, `get_income_stmt()`/`get_balance_sheet()`/`get_cashflow()` methods (no-space index labels — see CLAUDE.md gotcha vs `.income_stmt` property labels). Backup falls back to KIS.
- **US supply / ownership** — `backend/services/us_supply.py`. `fetch_us_supply(ticker, exchange)` reads `t.institutional_holders`, `t.insider_transactions`, and `info["shortPercentOfFloat"]` (with NaN/inf guards via `_finite`); persists to `us_supply_snapshot` table. Read via `get_us_supply` / `get_us_insider`.
- **Calendar earnings/dividend events** — `backend/routers/calendar.py`. `yf.Ticker(sym).calendar` fetched per stock, parallelized over a `ThreadPoolExecutor(max_workers ≤ 15)`.
- **Recommendation funnel US consensus backfill** — `backend/services/recommendation/funnel.py` `_backfill_us_consensus(cand)`. US candidates that lack a `daily_consensus_mart` entry for today have their yfinance analyst targets (`t.upgrades_downgrades`) fetched once and fed through `consensus_pipeline.upsert_raw_reports` → `consensus_pipeline.refresh_mart`. Called from the recommendation funnel batch for US candidates only, guarded so it fires only when mart data is absent.
- **종목명 해석 / 이름 백필** — `backend/services/market/__init__.py` `resolve_name(ticker, market, ...)`. US는 yfinance quote의 `info.get("shortName", ticker)`, KR은 키움 `stk_nm`/Naver에서 실명을 채운다. 이름 백필 `POST /api/stocks/names/backfill`이 이 경로로 shortName을 fetch한다.

## Naver (m.stock.naver.com / api.stock.naver.com / finance.naver.com)

Unauthenticated public JSON/HTML endpoints (custom `User-Agent` + `Referer: https://m.stock.naver.com/`).

- **KR quotes (fallback)** — `backend/services/market/kr.py`. `_NAVER_BASE = "https://m.stock.naver.com/api/stock"`; part of the KR quote corroboration chain (Kiwoom → KIS → Naver).
- **Consensus / research reports** — `backend/services/consensus_pipeline.py`. `https://m.stock.naver.com/api/research/stock/{ticker}?pageSize=200` and `/{rid}` detail.
- **News scraping** — `backend/services/scraper.py`. `https://m.stock.naver.com/api/news/stock/{ticker}` + article pages `https://n.news.naver.com/mnews/article/{office_id}/{article_id}`.
- **Guru (US holdings)** — `backend/services/guru_scraper.py`. `_NAVER_US_BASE = "https://api.stock.naver.com/stock"`.
- **Rankings (market value)** — `backend/services/ranking_service.py`. `_NAVER_MARKETVALUE = "https://m.stock.naver.com/api/stocks/marketValue"`.
- **KR earnings / market-cap list** — `backend/services/market_indicators/earnings.py`. `_NAVER_BASE = "https://m.stock.naver.com/api/stock"` + `https://finance.naver.com/sise/sise_market_sum.naver`.

## Kiwoom (키움) REST API

Primary KR quote source. Read-only TR endpoints only (no accounts/orders). Client `backend/services/kiwoom/client.py`.

- Base URL: `KIWOOM_BASE_URL` env, default `https://api.kiwoom.com`. Keys: `KIWOOM_APP_KEY` / `KIWOOM_SECRET_KEY`.
- Token: `POST {base}/oauth2/token` with `{grant_type: "client_credentials", appkey, secretkey}` (in-process singleton, 401 retry/re-issue).
- TR request: `POST {base}/api/dostk/{category}` with `api-id` / `authorization` headers, serial throttle, `return_code != 0` raises.
- Submodules: `quote.py` (ka10001 current price), `chart.py` (ka10081 daily bars), `sector.py` (ka20006 sector index daily / ka20002 sector membership), `investor.py` (investor flows), `shortsell.py` (short-sell). KR quotes consumed by `backend/services/market/kr.py` (Kiwoom-first + Naver fallback). KR sector momentum precomputed by `backend/services/kr_sector_service.py`. Integrated code selection (`integrated_code(stk_cd, regular=)`) toggles KRX-regular vs NXT `_AL` codes.

## KIS (한국투자증권 / Korea Investment)

Backup quote source (KR fallback after Kiwoom; US fallback after yfinance). Read-only, no orders/accounts. Client `backend/services/kis/client.py`.

- Base URL: `KIS_BASE_URL` env, default `https://openapi.koreainvestment.com:9443` (live). Keys: `KIS_APP_KEY` / `KIS_APP_SECRET`. Dormant when keys unset (`configured()` False).
- Token: `POST {base}/oauth2/tokenP` (in-process singleton; forced re-issue guarded to ≤ once/60s for EGW00133; 401 retry).
- Request: `GET {base}/uapi/...` with `tr_id` / `appkey` / `appsecret` / `custtype=P` headers, serial throttle, `rt_cd != "0"` raises.
- `quote.py`: KR `FHKST01010100` (current price), US price `HHDFS00000300` + dailyprice `HHDFS76240000` (EXCD NAS→NYS→AMS probe).

## DART (OpenDART, opendart.fss.or.kr)

KR-only, `DART_API_KEY` required. Base `https://opendart.fss.or.kr/api`. Status 013 (no data) handled gracefully.

- **Order backlog (수주잔고)** — `backend/services/backlog.py` (+ parser `backend/services/backlog_parser.py`). No structured backlog API → `list.json` for report `rcept_no`, then `document.xml` (ZIP → decode all members → combined raw text) parsed for backlog tables. `_get_corp_code_map` provides ticker→corp_code mapping (reused by other DART services).
- **Disclosures feed** — `backend/services/disclosures.py`. `list.json` called **per core type A/B/C/D separately** (response does not echo `pblntf_ty`, so the query type is stamped onto each item). Dedup by `rcept_no` into `stock_disclosures`.
- **AGM meeting dates (주주총회)** — `backend/services/agm.py`. `_DART_BASE = "https://opendart.fss.or.kr/api"`. `_fetch_agm_list(corp_code)` calls `list.json` **with no `pblntf_ty`** (specifying it returns 0 AGM disclosures) then filters items for '주주총회'; `parse_agm_meeting_date(document_text)` extracts the meeting date from `document.xml` text. Serial throttle `_DART_THROTTLE = 0.3s`. Reuses `services.backlog._get_corp_code_map`.
- **Insider trades** — `backend/services/insider_trades.py`. `elestock.json` (임원·주요주주 소유상황 → 'insider') + `majorstock.json` (5% rule → 'major5'); deterministic `row_hash` for idempotent upsert into `stock_insider_trades`.
- **KR dividends** — referenced via DART `alotMatter.json` (per CLAUDE.md, in `backend/services/dividends.py` KR branch).
- **KR financials** — `backend/services/market/kr.py` uses `fnlttSinglAcntAll` (full statements, requires `fs_div`) and `fnlttSinglAcnt` (major accounts).

## FRED (St. Louis Fed) — TWO distinct endpoints

`FRED_API_KEY` required; graceful no-op / error message when unset.

- **`series/observations`** — economic & macro time series.
  - `backend/services/market_indicators/econ.py`: `https://api.stlouisfed.org/fred/series/observations` (`_fetch_series(series_id, start)`), economic indicators.
  - `backend/services/market_indicators/macro.py`: same `series/observations` endpoint (`_fetch_series(series_id, api_key, start)`) for macro signal series (`T10Y2Y`, `BAMLH0A0HYM2`, `M2SL`, `DFF`).
- **`releases/dates`** — calendar econ-release events. `backend/routers/calendar.py` `_get_econ_events(month_start, month_end)` calls `https://api.stlouisfed.org/fred/releases/dates` for curated major US release dates. **FOMC dates come from a static `_FOMC_DATES` list** in the same file (always included regardless of `FRED_API_KEY`; coverage ~2027-12, manually refreshed, graceful when exhausted).

## KOFIA / data.go.kr (공공데이터포털)

`KOFIA_API_KEY` required (shared by both services). HTTP `requests.get` with `User-Agent: Mozilla/5.0`.

- **Leverage indicators** (신용잔고·반대매매·시총) — `backend/services/leverage_service.py`. `_KOFIA_BASE = "https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService"` (endpoints `getGrantingOfCreditBalanceInfo`, `getSecuritiesMarketTotalCapitalInfo`, …) and `_INDEX_BASE = "https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService"`; paginates all pages → `market_leverage_indicators` table.
- **Lending balance** (내외국인 대차잔고) — `backend/services/lending_service.py`. `_BASE = "https://apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2"` → `market_lending_balance` table.

## 관세청 / KITA (Korea Customs / exports)

`backend/services/market_indicators/exports.py`. KR export statistics.

- Primary (when `KITA_API_KEY` set): Korea Customs `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList` (`_fetch_customs_exports`).
- Fallback (no key, or on failure): UN Comtrade `_COMTRADE_URL = "https://comtradeapi.un.org/public/v1/preview/C/M/HS"` (`_fetch_comtrade_exports`).

(Note: env var named `KITA_API_KEY` is actually the Korea Customs Service key — see CLAUDE.md.)

## PostgreSQL (Docker)

`backend/services/db.py`. `psycopg2` with `RealDictCursor` and a module-level `ThreadedConnectionPool` (`_get_pool()`, dsn from `os.environ["DATABASE_URL"]`, pool sized above max ThreadPool concurrency). Connections via `get_connection()` (getconn/putconn). Container is `postgres:16-alpine` (`docker-compose.yml`); schemas `backend/auth_schema.sql` then `backend/app_schema.sql`.

## Google & GitHub OAuth + JWT

`backend/routers/auth.py` (flows) + `backend/services/auth_service.py` (tokens/users).

- **Google OAuth**: authorize `https://accounts.google.com/o/oauth2/v2/auth`, token exchange `https://oauth2.googleapis.com/token` (via `httpx`). Redirect URI `{FRONTEND_URL}/api/auth/oauth/google/callback`. Keys `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
- **GitHub OAuth**: authorize `https://github.com/login/oauth/authorize`, token `https://github.com/login/oauth/access_token`, profile `https://api.github.com/user`. Keys `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
- **JWT**: `from jose import jwt`; HS256 encode/decode with `JWT_SECRET` (`backend/services/auth_service.py` `create_token` / `decode`). OAuth users upserted into `users` by `(oauth_provider, oauth_sub)`. Short-lived OAuth codes held in an in-process `_oauth_codes` dict (120s TTL).

## Cloudflare Tunnel

Not a code integration — infra. `portfolion.taebro.com` → `localhost:80`, run via launchd (not a compose container) per `README.md` and `CLAUDE.md`. A separate DDNS updater script `scripts/ddns_update.sh` uses the Cloudflare API (`CF_ZONE_ID` / `CF_API_TOKEN`, set outside `.env.docker`).

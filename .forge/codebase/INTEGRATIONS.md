---
last_mapped_commit: 6793157d58f56e2b8392cfbe725de186d9f95e0d
mapped: 2026-06-20
---

# External Integrations

## Market Data & External APIs

| Source | Base URL / lib | Code path | Notes |
|--------|----------------|-----------|-------|
| yfinance | `yfinance` lib | `backend/services/market.py` | US primary quote/history/sector |
| Naver Finance | `https://finance.naver.com/...` | `backend/services/market.py`, `market_indicators/earnings.py` | KR quote fallback |
| Kiwoom REST | `https://api.kiwoom.com` (`KIWOOM_BASE_URL`) | `backend/services/kiwoom/client.py` (+ quote/chart/investor/sector/shortsell) | KR primary, read-only TR; token via `KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY` (`POST /api/dostk/{category}`, `api-id` header) |
| KIS (한국투자증권) | `https://openapi.koreainvestment.com:9443` (`KIS_BASE_URL`) | `backend/services/kis/client.py`, `kis/quote.py` | Backup quote (KR: Kiwoom→KIS→Naver; US: yfinance→KIS). `/oauth2/tokenP`, `tr_id` header. Dormant if keys unset |
| DART (OpenDART) | `https://opendart.fss.or.kr/api` | `backend/services/disclosures.py`, `insider_trades.py`, `backlog.py`, `dividends.py` | KR disclosures/insider/backlog/dividends; `DART_API_KEY` |
| FRED (St. Louis Fed) | `https://api.stlouisfed.org/fred/series/observations` | `backend/services/market_indicators/econ.py`, `macro.py` | Econ indicators + macro signals; `FRED_API_KEY` |
| KOFIA / Market Index (data.go.kr 1160100) | `https://apis.data.go.kr/1160100/...` | `leverage_service.py` (GetKofiaStatisticsInfoService, GetMarketIndexInfoService), `lending_service.py` (GetStocLendBorrInfoService_V2) | Leverage/credit + lending balance; `KOFIA_API_KEY` |
| 관세청 (Korea Customs, data.go.kr 1220000) | `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList` | `market_indicators/exports.py` | KR exports; `KITA_API_KEY` (actually customs key) |
| UN Comtrade | `https://comtradeapi.un.org/public/v1/preview/C/M/HS` | `market_indicators/exports.py` | Fallback when customs key unset |

## Databases

- **PostgreSQL 16** — `postgres:16-alpine` container (`docker-compose.yml`), volume `pgdata`, port 5432. DB `portfolion`. Driver `psycopg2` (`backend/services/db.py`, `DATABASE_URL`).
- Init order: `auth_schema.sql` (`01-auth.sql`) → `app_schema.sql` (`02-app.sql`).

Key tables (`backend/auth_schema.sql`, `backend/app_schema.sql`, runtime migrations in `main.py:_migrate()`):

| Table | Purpose |
|-------|---------|
| `users`, `refresh_tokens` | accounts + JWT refresh (auth schema) |
| `tickers`, `user_stocks`, `snapshots` | ticker master, per-user holdings/watchlist, per-date report JSON |
| `schedules`, `guru_schedules`, `batch_schedules`, `job_runs` | batch scheduling + run history |
| `guru_managers`, `digests`, `consensus_history`, `daily_consensus_mart` | guru cache, digests, consensus |
| `calendar_cache`, `market_cache` | calendar/market indicator caches |
| `user_menu_permissions`, `default_menu_permissions`, `user_events` | permissions + behavior log |
| `raw_reports` | per-ticker raw AI report text |
| `market_leverage_indicators`, `market_lending_balance` | credit/lending time series |
| `backlog_history`, `market_rankings`, `market_investor_trend`, `market_short_sell` | order backlog, rankings, investor flow, short-sell |
| `stock_disclosures`, `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations` | DART disclosures, dividends, supply scoring, insider trades, recommendations |

Local file caches (gitignored): `backend/data/consensus/`, `backend/data/calendar/`, `backend/snapshots/`.

## Authentication

- **JWT HS256** — encode/decode via `python-jose` in `backend/services/auth_service.py` (`JWT_SECRET`). Access + refresh tokens.
- Passwords: `bcrypt`. Sessions: starlette `SessionMiddleware` (`SESSION_SECRET`).
- **OAuth** (`backend/routers/auth.py`):
  - Google — `https://accounts.google.com/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token`; `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.
  - GitHub — `github.com/login/...`; `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`.
  - Callback redirect via `FRONTEND_URL`; temp-code exchange (`_oauth_codes`, 120s) with HMAC-signed nonce.
- **Cowork external API** — `COWORK_API_KEY` (gated write API, see `CLAUDE_COWORK_API.md`).
- Admin role gate: `users.role` (`user`|`admin`); menu permissions via `user_menu_permissions`.

## Infrastructure & Networking

- **Docker Compose** 4 containers (`docker-compose.yml`): `postgres`, `backend` (FastAPI :8000), `nginx`, `certbot`.
- **nginx** (`nginx:alpine`, `nginx/nginx.conf`) — serves `frontend/dist` on HTTP :80 (also :443 mapped), proxies `/api/` and `/health` → `backend:8000`, ACME challenge route for certbot.
- **certbot** (`certbot/certbot`) — HTTPS cert auto-renew loop (`certbot renew` every 12h), shares `./certbot/conf` + `./certbot/www`.
- **Cloudflare Tunnel** — `portfolion.taebro.com` → `localhost:80`; `cloudflared` runs via launchd (not a compose container).
- **launchd** auto-runs `cloudflared` + docker compose; auto-deploy poller `com.portfolion.auto-deploy-poll`.

## Scheduled Batches (APScheduler)

Scheduler: `backend/scheduler/` (`jobs.py`, `schedule.py`, `_state.py`); started in `main.py` lifespan. Batch catalog: `backend/services/batch_registry.py` (`BATCHES`, each with `market` KR/US/공통, `source`, `usage`); exposed via `GET /api/batches`. Times are KST. Defaults:

| Batch id | Schedule | Source |
|----------|----------|--------|
| `daily_report_kr` / `daily_report_us` | weekly 20:30 / 07:00 | report snapshots |
| `consensus` | (per registry) | Naver/yfinance |
| `daily_digest` | daily 08:00 | digest |
| `backlog_fetch` / `dividend_fetch` | weekly Sun 04:00 / 05:00 | DART |
| `disclosure_fetch` / `insider_fetch` | daily 07:30 / 07:45 | DART |
| `earnings_kr` / `earnings_us` | weekly Sun 03:00 | Naver / yfinance |
| `monthly_kr` / `monthly_us` | monthly day-1 02:00 | 관세청·Comtrade / FRED |
| `macro_signals_fetch` | daily 06:00 | FRED |
| `leverage_fetch` | daily 07:00 | KOFIA |
| `lending_fetch` | monthly day-5 08:00 | data.go.kr |
| `kr_rankings_fetch` / `us_rankings_fetch` | interval 10min (09–15 / 09–16) | Kiwoom / yfinance |
| `investor_trend_fetch` / `short_sell_fetch` / `supply_score_fetch` | daily 18:00 / 18:30 / 19:00 | Kiwoom |
| `kr_sector_fetch` | daily 16:00 | Kiwoom |
| `recommendation_kr` / `recommendation_us` | daily 20:30 / 07:00 | computed |
| `guru_crawl` | weekly Sun 03:00 (disabled by default) | guru scraper |

> Batch-backed views read only stored values (market_cache/tables); external fetch happens in batch lane, not on request path.

## Environment Variable Names

`backend/.env.docker`: `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ANTHROPIC_API_KEY` (unused), `FRED_API_KEY`, `KITA_API_KEY`, `KOFIA_API_KEY`, `DART_API_KEY`, `FRONTEND_URL`, `COWORK_API_KEY`, `KIWOOM_BASE_URL`, `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY`, `KIS_APP_KEY`, `KIS_APP_SECRET` (+ optional `KIS_BASE_URL`).
Root `.env`: `FRED_API_KEY`, `KITA_API_KEY` (compose interpolation). `POSTGRES_PASSWORD` consumed by compose.

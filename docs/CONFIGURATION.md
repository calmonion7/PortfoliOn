<!-- generated-by: gsd-doc-writer -->
# CONFIGURATION.md

Configuration reference for PortfoliOn. Covers environment variables, `.env` file setup, CORS settings, cache TTL values, and port configuration.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `FRED_API_KEY` | Optional | — | FRED (Federal Reserve Economic Data) API key. Required to fetch CPI and unemployment series via `GET /api/market/econ-indicators`. Without it, that endpoint returns an error. Get a free key at [fred.stlouisfed.org](https://fred.stlouisfed.org/docs/api/api_key.html). |
| `KITA_API_KEY` | Optional | — | Korea Customs Service (관세청) API key for `apis.data.go.kr`. Used to fetch Korea export data with semiconductor breakdown. If absent, `GET /api/market/kr-exports` falls back to UN Comtrade public API (no key required). |
| `TELEGRAM_BOT_TOKEN` | Optional | — | Telegram bot token. If set together with `TELEGRAM_CHAT_ID`, the daily digest is sent as a Telegram message at 08:00 KST. If either variable is missing, the Telegram send step is silently skipped. |
| `TELEGRAM_CHAT_ID` | Optional | — | Telegram chat ID to receive digest notifications. Must be set alongside `TELEGRAM_BOT_TOKEN`. |

> **Note on `ANTHROPIC_API_KEY`:** The project context documents this as required for AI report generation, but the current `backend/services/report_generator.py` does not reference `ANTHROPIC_API_KEY` directly — report generation uses yfinance, Naver API, and Finviz scraping only. If a Claude AI integration is added in future, this key will be required. <!-- VERIFY: whether ANTHROPIC_API_KEY is consumed by any part of the current codebase -->

---

## .env File Setup

`start.sh` automatically loads a `.env` file from the project root if one is present:

```bash
# start.sh behaviour
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a; source "$PROJECT_DIR/.env"; set +a
fi
```

`start.bat` (Windows) does **not** auto-load `.env`. On Windows, set variables in your shell or system environment before running `start.bat`.

Create `.env` in the project root (same directory as `start.sh`):

```bash
# .env — place at project root
FRED_API_KEY=your_fred_api_key_here
KITA_API_KEY=your_kita_api_key_here

# Optional: Telegram digest notifications
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
```

The `.env` file is **not** committed to the repository (confirmed absent from version control). Do not commit real API keys.

---

## CORS Configuration

CORS is configured in `backend/main.py` via FastAPI's `CORSMiddleware`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

| Setting | Value |
|---|---|
| Allowed origins | `http://localhost:3000`, `http://localhost:5173` |
| Allowed methods | All (`*`) |
| Allowed headers | All (`*`) |
| Credentials | Not configured (default `False`) |

To allow a different frontend origin (e.g., a staging domain), add it to the `allow_origins` list in `backend/main.py`. <!-- VERIFY: whether a production deployment requires additional origins -->

---

## Cache TTL Settings

Cache configuration lives in `backend/services/cache.py`. All caches are in-memory and reset on server restart.

### Global caches (cache.py)

| Cache | Type | TTL | Max entries | Invalidated by |
|---|---|---|---|---|
| `_list_cache` | TTL | 5 seconds | — | Stock add / edit / delete |
| `_dashboard_cache` | TTL | 300 seconds (5 min) | — | Stock add / edit / delete; manual `DELETE /api/stocks/dashboard/cache` |
| `_correlation_cache` | TTL | 300 seconds (5 min) | — | Stock add / edit / delete |
| `_snapshots` | LRU | No expiry | 200 entries | Per-ticker invalidation on stock mutation |

### Market indicators caches (market_indicators_service.py)

These use a separate in-memory dict (`_cache`) with per-entry expiry:

| Data | TTL |
|---|---|
| Treasury yields | 3600 seconds (1 hour) |
| FX rates | 3600 seconds (1 hour) |
| VIX | 3600 seconds (1 hour) |
| Commodities (Gold, WTI, Copper) | 3600 seconds (1 hour) |
| M7 earnings | 86400 seconds (24 hours) |
| KR Top2 earnings | 86400 seconds (24 hours) |
| Economic indicators (CPI, unemployment) | 86400 seconds (24 hours) |

### File-based caches

| Cache | Location | TTL | Notes |
|---|---|---|---|
| Korea export data | `backend/data/kr_exports.json` | 3 days (259200 s) | Written on fetch; read on next request if still fresh |
| S&P 500 ticker list | `backend/data/sp500_tickers.json` | 7 days | Scraped from Wikipedia |
| KOSPI ticker list | `backend/data/kospi_tickers.json` | 7 days | Scraped from Naver Finance |
| Calendar events | `backend/data/calendar/YYYY-MM.json` | No expiry | Cleared on stock add/remove/promote or `DELETE /api/calendar/cache` |
| Consensus data | `backend/data/consensus/` | Per-ticker JSON | Gitignored |

---

## Port Configuration

| Service | Port | Config location |
|---|---|---|
| Backend (FastAPI/uvicorn) | `8000` | Hardcoded in `start.sh`, `start.bat`, and uvicorn launch command |
| Frontend (Vite dev server) | `5173` | `frontend/vite.config.js` → `server.port` |

The Vite dev server proxies all `/api/*` requests to `http://localhost:8000`:

```js
// frontend/vite.config.js
proxy: {
  '/api': {
    target: 'http://localhost:8000',
    changeOrigin: true,
  },
},
```

Frontend axios calls use relative paths (e.g., `/api/stocks`) — no base URL configuration is needed in the frontend code.

To change either port:
1. **Backend:** update the `--port` argument in `start.sh` / `start.bat`, and update `allow_origins` in `backend/main.py` if the frontend origin changes.
2. **Frontend:** update `server.port` in `frontend/vite.config.js` and the proxy `target` if the backend port also changed.

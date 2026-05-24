<!-- generated-by: gsd-doc-writer -->
# API Reference

**Base URL:** `http://localhost:8000`

**Interactive docs (Swagger UI):** `http://localhost:8000/docs`

**Full endpoint reference:** [API_SPEC.md](../API_SPEC.md)

---

## Router Groups

| Prefix | Router file | Description |
|---|---|---|
| `/api/stocks` | `routers/stocks.py` | Unified holdings and watchlist CRUD, enrichment, dashboard cache |
| `/api/portfolio` | `routers/portfolio.py` | Portfolio-level aggregation and performance metrics |
| `/api/watchlist` | `routers/watchlist.py` | Watchlist management (promote/demote to holding) |
| `/api/analytics` | `routers/analytics.py` | Return correlation heatmap for held positions |
| `/api/market` | `routers/market_indicators.py` | FX rates, VIX, commodities, FRED economic indicators |
| `/api/guru` | `routers/guru.py` | Guru manager data, crawl settings, stats |
| `/api/` (report) | `routers/report.py` | AI-generated stock reports and snapshots |
| `/api/` (calendar) | `routers/calendar.py` | Earnings calendar with file-based cache |
| `/api/` (digest) | `routers/digest.py` | Daily market digest generation and retrieval |

---

For request/response schemas, query parameters, and error codes, see [API_SPEC.md](../API_SPEC.md).

For the external Claude AI integration surface, see [CLAUDE_COWORK_API.md](../CLAUDE_COWORK_API.md).

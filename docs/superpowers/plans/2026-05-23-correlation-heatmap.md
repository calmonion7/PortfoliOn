# Correlation Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `GET /api/analytics/correlation` endpoint that returns a 90-day Pearson correlation matrix for holdings, and render it as an SVG heatmap in the Analytics page.

**Architecture:** New `backend/routers/analytics.py` fetches yfinance 90-day close prices for all holdings in parallel, computes correlation via pandas, and caches the result for 300s using the existing `TTLCache` pattern. The frontend `CorrelationHeatmap` component fetches this endpoint independently and renders an SVG grid.

**Tech Stack:** FastAPI, pandas, yfinance, React 18, SVG (no new libraries)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `backend/services/cache.py` | Add `_correlation_cache`, `get_correlation()`, `invalidate_correlation()` |
| Modify | `backend/tests/test_cache.py` | Tests for correlation cache + `_clear()` update |
| Create | `backend/routers/analytics.py` | `GET /api/analytics/correlation` endpoint |
| Create | `backend/tests/test_analytics_router.py` | Endpoint tests |
| Modify | `backend/main.py` | Mount analytics router |
| Modify | `frontend/src/pages/Analytics.jsx` | Add `corrColor` + `CorrelationHeatmap` component |

---

### Task 1: Add correlation cache to cache.py

**Files:**
- Modify: `backend/services/cache.py`
- Modify: `backend/tests/test_cache.py`

- [ ] **Step 1: Write failing tests for correlation cache**

Add to the bottom of `backend/tests/test_cache.py`:

```python
def test_get_correlation_caches_result():
    import services.cache as c
    _clear()
    calls = []
    def loader():
        calls.append(1)
        return {"tickers": ["AAPL"], "matrix": [[1.0]]}
    c.get_correlation(loader)
    c.get_correlation(loader)
    assert len(calls) == 1


def test_invalidate_correlation_clears_cache():
    import services.cache as c
    _clear()
    calls = []
    c.get_correlation(lambda: (calls.append(1), {"tickers": [], "matrix": []})[1])
    c.invalidate_correlation()
    c.get_correlation(lambda: (calls.append(1), {"tickers": [], "matrix": []})[1])
    assert len(calls) == 2


def test_invalidate_also_clears_correlation():
    import services.cache as c
    _clear()
    calls = []
    c.get_correlation(lambda: (calls.append(1), {"tickers": [], "matrix": []})[1])
    c.invalidate("AAPL")
    c.get_correlation(lambda: (calls.append(1), {"tickers": [], "matrix": []})[1])
    assert len(calls) == 2
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/calmonion/Project/PortfoliOn/backend && .venv/bin/python -m pytest tests/test_cache.py::test_get_correlation_caches_result tests/test_cache.py::test_invalidate_correlation_clears_cache tests/test_cache.py::test_invalidate_also_clears_correlation -v
```
Expected: FAIL — `AttributeError: module 'services.cache' has no attribute 'get_correlation'`

- [ ] **Step 3: Add correlation cache to cache.py**

In `backend/services/cache.py`, after `_dashboard_cache = TTLCache(300.0)`:

```python
_correlation_cache = TTLCache(300.0)
```

After the `get_dashboard` / `invalidate_dashboard` functions, add:

```python
def invalidate_correlation() -> None:
    _correlation_cache.invalidate()


def get_correlation(loader) -> dict:
    return _correlation_cache.get(loader)
```

Also update `invalidate()` to call `invalidate_correlation()`. The current `invalidate()` ends with `invalidate_dashboard()`. Add one line:

```python
def invalidate(ticker: str) -> None:
    prefix = f"{ticker.upper()}/"
    for k in [k for k in _snapshots if k.startswith(prefix)]:
        del _snapshots[k]
    invalidate_list()
    invalidate_dashboard()
    invalidate_correlation()
```

Also update the `_clear()` helper at the top of `test_cache.py` to include correlation:

```python
def _clear():
    import services.cache as c
    c._snapshots.clear()
    c.invalidate_list()
    c.invalidate_dashboard()
    c.invalidate_correlation()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/calmonion/Project/PortfoliOn/backend && .venv/bin/python -m pytest tests/test_cache.py -v
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/calmonion/Project/PortfoliOn add backend/services/cache.py backend/tests/test_cache.py
git -C /Users/calmonion/Project/PortfoliOn commit -m "feat: add correlation TTL cache to cache.py"
```

---

### Task 2: Create analytics router

**Files:**
- Create: `backend/routers/analytics.py`
- Create: `backend/tests/test_analytics_router.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_analytics_router.py`:

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import pandas as pd
import numpy as np

from routers.analytics import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def _make_hist(seed: int, n: int = 60) -> MagicMock:
    rng = np.random.default_rng(seed)
    closes = 100.0 + np.cumsum(rng.standard_normal(n))
    mock = MagicMock()
    mock.history.return_value = pd.DataFrame({"Close": closes})
    return mock


def test_correlation_returns_matrix_for_two_holdings():
    portfolio = {
        "stocks": [
            {"ticker": "AAPL", "market": "US", "exchange": ""},
            {"ticker": "MSFT", "market": "US", "exchange": ""},
        ],
        "watchlist": [],
    }

    def mock_ticker(sym):
        return _make_hist(0) if "AAPL" in sym else _make_hist(1)

    with patch("routers.analytics.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analytics.yf.Ticker", side_effect=mock_ticker), \
         patch("routers.analytics.cache_svc.get_correlation", side_effect=lambda loader: loader()):
        resp = client.get("/api/analytics/correlation")

    assert resp.status_code == 200
    data = resp.json()
    assert set(data["tickers"]) == {"AAPL", "MSFT"}
    assert len(data["matrix"]) == 2
    assert len(data["matrix"][0]) == 2
    # diagonal must be 1.0
    idx = data["tickers"].index("AAPL")
    assert data["matrix"][idx][idx] == 1.0


def test_correlation_returns_empty_for_single_holding():
    portfolio = {
        "stocks": [{"ticker": "AAPL", "market": "US", "exchange": ""}],
        "watchlist": [],
    }
    with patch("routers.analytics.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analytics.cache_svc.get_correlation", side_effect=lambda loader: loader()):
        resp = client.get("/api/analytics/correlation")
    assert resp.status_code == 200
    assert resp.json() == {"tickers": [], "matrix": []}


def test_correlation_returns_empty_for_no_holdings():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("routers.analytics.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analytics.cache_svc.get_correlation", side_effect=lambda loader: loader()):
        resp = client.get("/api/analytics/correlation")
    assert resp.status_code == 200
    assert resp.json() == {"tickers": [], "matrix": []}


def test_correlation_excludes_ticker_with_insufficient_data():
    portfolio = {
        "stocks": [
            {"ticker": "AAPL", "market": "US", "exchange": ""},
            {"ticker": "MSFT", "market": "US", "exchange": ""},
            {"ticker": "BAD",  "market": "US", "exchange": ""},
        ],
        "watchlist": [],
    }
    bad_mock = MagicMock()
    bad_mock.history.return_value = pd.DataFrame({"Close": [100.0] * 5})  # only 5 rows < 20

    def mock_ticker(sym):
        if "AAPL" in sym:
            return _make_hist(0)
        if "MSFT" in sym:
            return _make_hist(1)
        return bad_mock

    with patch("routers.analytics.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analytics.yf.Ticker", side_effect=mock_ticker), \
         patch("routers.analytics.cache_svc.get_correlation", side_effect=lambda loader: loader()):
        resp = client.get("/api/analytics/correlation")

    assert resp.status_code == 200
    data = resp.json()
    assert "BAD" not in data["tickers"]
    assert set(data["tickers"]) == {"AAPL", "MSFT"}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/calmonion/Project/PortfoliOn/backend && .venv/bin/python -m pytest tests/test_analytics_router.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'routers.analytics'`

- [ ] **Step 3: Create analytics router**

Create `backend/routers/analytics.py`:

```python
from fastapi import APIRouter
from concurrent.futures import ThreadPoolExecutor

import yfinance as yf
import pandas as pd

from services import storage, cache as cache_svc

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _fetch_closes(item: dict) -> tuple[str | None, pd.Series | None]:
    ticker = item["ticker"].upper()
    market = item.get("market", "US")
    exchange = item.get("exchange", "")
    sym = f"{ticker}.{exchange or 'KS'}" if market == "KR" else ticker
    try:
        closes = yf.Ticker(sym).history(period="90d")["Close"].dropna()
        if len(closes) < 20:
            return None, None
        return ticker, closes
    except Exception:
        return None, None


@router.get("/correlation")
def get_correlation():
    def _build() -> dict:
        holdings = storage.get_full_portfolio().get("stocks", [])
        if len(holdings) < 2:
            return {"tickers": [], "matrix": []}

        with ThreadPoolExecutor(max_workers=30) as executor:
            results = list(executor.map(_fetch_closes, holdings))

        closes_map = {t: s for t, s in results if t is not None}
        if len(closes_map) < 2:
            return {"tickers": [], "matrix": []}

        corr = pd.DataFrame(closes_map).corr()
        tickers = list(corr.columns)
        matrix = [
            [round(float(corr.loc[t1, t2]), 3) for t2 in tickers]
            for t1 in tickers
        ]
        return {"tickers": tickers, "matrix": matrix}

    return cache_svc.get_correlation(_build)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/calmonion/Project/PortfoliOn/backend && .venv/bin/python -m pytest tests/test_analytics_router.py -v
```
Expected: all 4 PASS

- [ ] **Step 5: Run full backend test suite**

```bash
cd /Users/calmonion/Project/PortfoliOn/backend && .venv/bin/python -m pytest -v 2>&1 | tail -10
```
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git -C /Users/calmonion/Project/PortfoliOn add backend/routers/analytics.py backend/tests/test_analytics_router.py
git -C /Users/calmonion/Project/PortfoliOn commit -m "feat: add GET /api/analytics/correlation endpoint"
```

---

### Task 3: Mount analytics router in main.py

**Files:**
- Modify: `backend/main.py:9,54`

- [ ] **Step 1: Add import**

In `backend/main.py`, update the routers import line (line 9):

```python
from routers import portfolio, report, watchlist, stocks, guru, calendar, digest, analytics
```

- [ ] **Step 2: Mount router**

After `app.include_router(market_indicators_router)` (line 54), add:

```python
app.include_router(analytics.router)
```

- [ ] **Step 3: Verify server starts**

```bash
cd /Users/calmonion/Project/PortfoliOn/backend && .venv/bin/python -c "from main import app; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git -C /Users/calmonion/Project/PortfoliOn add backend/main.py
git -C /Users/calmonion/Project/PortfoliOn commit -m "feat: mount analytics router in main.py"
```

---

### Task 4: Add CorrelationHeatmap to Analytics.jsx

**Files:**
- Modify: `frontend/src/pages/Analytics.jsx`

- [ ] **Step 1: Add corrColor helper and CorrelationHeatmap component**

In `frontend/src/pages/Analytics.jsx`, add the following **before** the `export default function Analytics()` line.

First, add the color helper function:

```jsx
function corrColor(v) {
  const neutral = [69, 90, 100]
  const pos = [79, 195, 247]
  const neg = [239, 154, 154]
  const t = Math.abs(v)
  const to = v >= 0 ? pos : neg
  return `rgb(${Math.round(neutral[0] + t * (to[0] - neutral[0]))},${Math.round(neutral[1] + t * (to[1] - neutral[1]))},${Math.round(neutral[2] + t * (to[2] - neutral[2]))})`
}
```

Then add the CorrelationHeatmap component:

```jsx
function CorrelationHeatmap() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/analytics/correlation')
      .then(r => { setData(r.data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <div style={{ color: 'var(--text-muted)', marginTop: 48 }}>상관관계 계산 중...</div>
  if (error) return <div style={{ color: '#ef9a9a', marginTop: 48 }}>오류: {error}</div>
  if (!data || !data.tickers.length) return (
    <div style={{ color: 'var(--text-muted)', marginTop: 48 }}>보유종목 2개 이상 필요</div>
  )

  const { tickers, matrix } = data
  const n = tickers.length
  const CELL = 48
  const LABEL = 64

  return (
    <div style={{ marginTop: 48 }}>
      <h3 style={{ color: 'var(--text)', marginBottom: 8 }}>상관관계 히트맵</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 16 }}>
        90일 종가 기준 Pearson 상관계수 · 1.0=완전 양의 상관 · -1.0=완전 음의 상관
      </p>
      <svg width={LABEL + n * CELL} height={LABEL + n * CELL}>
        {tickers.map((t, j) => (
          <text key={`col-${j}`} x={LABEL + j * CELL + CELL / 2} y={LABEL - 8}
            textAnchor="middle" fontSize={11} fill="var(--text-muted)">{t}</text>
        ))}
        {tickers.map((t, i) => (
          <text key={`row-${i}`} x={LABEL - 8} y={LABEL + i * CELL + CELL / 2 + 4}
            textAnchor="end" fontSize={11} fill="var(--text-muted)">{t}</text>
        ))}
        {matrix.map((row, i) => row.map((v, j) => (
          <g key={`${i}-${j}`}>
            <rect x={LABEL + j * CELL} y={LABEL + i * CELL}
              width={CELL} height={CELL} fill={corrColor(v)} rx={2} />
            <text x={LABEL + j * CELL + CELL / 2} y={LABEL + i * CELL + CELL / 2 + 4}
              textAnchor="middle" fontSize={10} fill="white">{v.toFixed(2)}</text>
          </g>
        )))}
      </svg>
    </div>
  )
}
```

- [ ] **Step 2: Render CorrelationHeatmap in Analytics**

In `export default function Analytics()`, add `<CorrelationHeatmap />` after `<OpportunityBubble cards={cards} />`:

```jsx
  return (
    <div>
      <h2 style={{ color: 'var(--text)', marginBottom: 32 }}>포트폴리오 분석</h2>
      <SectorAllocation cards={cards} />
      <OpportunityBubble cards={cards} />
      <CorrelationHeatmap />
    </div>
  )
```

- [ ] **Step 3: Verify no build errors**

```bash
cd /Users/calmonion/Project/PortfoliOn/frontend && npm run build 2>&1 | tail -10
```
Expected: build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git -C /Users/calmonion/Project/PortfoliOn add frontend/src/pages/Analytics.jsx
git -C /Users/calmonion/Project/PortfoliOn commit -m "feat: add CorrelationHeatmap SVG component to Analytics page"
```

---

### Task 5: Full test suite verification

- [ ] **Step 1: Run all backend tests**

```bash
cd /Users/calmonion/Project/PortfoliOn/backend && .venv/bin/python -m pytest -v 2>&1 | tail -10
```
Expected: all PASS (164+ tests)

- [ ] **Step 2: Verify existing pages unaffected in browser**

With servers running (`./start.sh`):
- `/` — Portfolio loads normally
- `/analytics` — Sector chart + bubble chart still render, heatmap section shows either the chart or "상관관계 계산 중..."

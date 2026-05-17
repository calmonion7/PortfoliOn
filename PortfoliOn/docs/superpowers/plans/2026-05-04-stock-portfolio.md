# Stock Portfolio Manager & Auto Report Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web-based stock portfolio manager with automated daily Markdown reports covering 7 analysis sections per stock.

**Architecture:** FastAPI backend (port 8000) serves REST API + static report files; React/Vite frontend (port 3000) handles portfolio CRUD and report viewing; APScheduler runs report generation on configurable schedule; all data persisted to local JSON files with no database.

**Tech Stack:** Python 3.11, FastAPI, APScheduler, yfinance, pandas, numpy, matplotlib, requests, BeautifulSoup4; React 18, Vite, react-router-dom, recharts, react-markdown, axios.

---

## File Map

| File | Responsibility |
|---|---|
| `backend/main.py` | FastAPI app init, CORS, router mounting, static files mount, scheduler start |
| `backend/scheduler.py` | APScheduler instance, cron job definition |
| `backend/routers/__init__.py` | Empty |
| `backend/routers/portfolio.py` | CRUD endpoints `/api/portfolio` |
| `backend/routers/report.py` | Report generation/listing + schedule GET/PUT |
| `backend/services/__init__.py` | Empty |
| `backend/services/storage.py` | Read/write portfolio.json and schedule.json |
| `backend/services/market.py` | yfinance: quotes, financials, analyst targets |
| `backend/services/indicators.py` | RSI(14), EMA, support/resistance, RSI target price |
| `backend/services/scraper.py` | Finviz consensus scrape, yfinance news |
| `backend/services/charts.py` | matplotlib: revenue PNG, RSI PNG |
| `backend/services/report_generator.py` | Assemble 7-section markdown report |
| `backend/data/portfolio.json` | Stock data store (ticker, qty, avg_cost, competitors, moat, growth_plan) |
| `backend/data/schedule.json` | Schedule settings (enabled, time, days) |
| `backend/tests/__init__.py` | Empty |
| `backend/tests/conftest.py` | sys.path setup for pytest |
| `backend/tests/test_storage.py` | Storage read/write tests |
| `backend/tests/test_indicators.py` | RSI/EMA unit tests |
| `backend/tests/test_market.py` | Market service tests (mock yfinance) |
| `backend/tests/test_portfolio_router.py` | Portfolio CRUD API tests |
| `backend/pytest.ini` | Pytest config |
| `frontend/vite.config.js` | Vite config with `/api` proxy → port 8000 |
| `frontend/src/App.jsx` | React Router setup with 3 routes |
| `frontend/src/pages/Portfolio.jsx` | Stock list table + add/edit/delete |
| `frontend/src/components/StockModal.jsx` | Add/edit stock modal form |
| `frontend/src/pages/Reports.jsx` | Report browser (left list, right viewer) |
| `frontend/src/components/MarkdownViewer.jsx` | react-markdown wrapper with image path rewriting |
| `frontend/src/pages/Settings.jsx` | Schedule toggle, time, days, generate-now button |

---

## Task 1: Project Setup & Dependencies

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/pytest.ini`
- Create: `backend/data/portfolio.json`
- Create: `backend/data/schedule.json`
- Create: `backend/routers/__init__.py`
- Create: `backend/services/__init__.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/conftest.py`
- Create: `frontend/` (via Vite scaffold)

- [ ] **Step 1: Create backend directory structure**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject"
mkdir backend\routers, backend\services, backend\data, backend\tests, backend\reports
New-Item backend\routers\__init__.py, backend\services\__init__.py, backend\tests\__init__.py -ItemType File
```

- [ ] **Step 2: Create requirements.txt**

Create `backend/requirements.txt`:
```
fastapi>=0.104.0
uvicorn[standard]>=0.24.0
apscheduler>=3.10.4
yfinance>=0.2.40
pandas>=2.1.0
numpy>=1.26.0
matplotlib>=3.8.0
requests>=2.31.0
beautifulsoup4>=4.12.0
httpx>=0.25.0
pytest>=7.4.0
```

- [ ] **Step 3: Install Python dependencies**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
pip install -r requirements.txt
```

Expected: All packages install without error.

- [ ] **Step 4: Create initial data files**

Create `backend/data/portfolio.json`:
```json
{"stocks": []}
```

Create `backend/data/schedule.json`:
```json
{"enabled": false, "time": "08:00", "days": ["mon", "tue", "wed", "thu", "fri"]}
```

- [ ] **Step 5: Create pytest.ini**

Create `backend/pytest.ini`:
```ini
[pytest]
testpaths = tests
pythonpath = .
```

- [ ] **Step 6: Create conftest.py**

Create `backend/tests/conftest.py`:
```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
```

- [ ] **Step 7: Scaffold React frontend with Vite**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject"
npm create vite@latest frontend -- --template react
cd frontend
npm install
npm install react-router-dom axios recharts react-markdown remark-gfm
```

Expected: `frontend/` created with `src/App.jsx`, `src/main.jsx`, etc.

- [ ] **Step 8: Commit**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject"
git init
git add backend/requirements.txt backend/pytest.ini backend/data/ backend/routers/__init__.py backend/services/__init__.py backend/tests/
git commit -m "chore: project scaffold and dependencies"
```

---

## Task 2: Storage Service

**Files:**
- Create: `backend/services/storage.py`
- Create: `backend/tests/test_storage.py`

- [ ] **Step 1: Write failing test for get_portfolio**

Create `backend/tests/test_storage.py`:
```python
import json
import pytest
from pathlib import Path
from unittest.mock import patch, mock_open

def test_get_portfolio_returns_empty_when_file_missing():
    with patch("services.storage.DATA_DIR", Path("/nonexistent")):
        from services import storage
        result = storage.get_portfolio()
    assert result == {"stocks": []}

def test_save_and_load_portfolio_roundtrip(tmp_path):
    from services import storage
    with patch("services.storage.DATA_DIR", tmp_path):
        portfolio = {"stocks": [{"ticker": "NFLX", "quantity": 10, "avg_cost": 85.59}]}
        storage.save_portfolio(portfolio)
        loaded = storage.get_portfolio()
    assert loaded == portfolio

def test_get_schedule_returns_default_when_file_missing():
    with patch("services.storage.DATA_DIR", Path("/nonexistent")):
        from services import storage
        result = storage.get_schedule()
    assert result["enabled"] is False
    assert result["time"] == "08:00"
    assert "mon" in result["days"]

def test_save_and_load_schedule_roundtrip(tmp_path):
    from services import storage
    with patch("services.storage.DATA_DIR", tmp_path):
        schedule = {"enabled": True, "time": "09:30", "days": ["mon", "fri"]}
        storage.save_schedule(schedule)
        loaded = storage.get_schedule()
    assert loaded == schedule
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -m pytest tests/test_storage.py -v
```

Expected: ImportError or ModuleNotFoundError for `services.storage`.

- [ ] **Step 3: Implement storage.py**

Create `backend/services/storage.py`:
```python
import json
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).parent.parent / "data"

def _read_json(filename: str) -> Any:
    path = DATA_DIR / filename
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def _write_json(filename: str, data: Any) -> None:
    path = DATA_DIR / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def get_portfolio() -> dict:
    data = _read_json("portfolio.json")
    return data if data is not None else {"stocks": []}

def save_portfolio(portfolio: dict) -> None:
    _write_json("portfolio.json", portfolio)

def get_schedule() -> dict:
    data = _read_json("schedule.json")
    return data if data is not None else {
        "enabled": False,
        "time": "08:00",
        "days": ["mon", "tue", "wed", "thu", "fri"],
    }

def save_schedule(schedule: dict) -> None:
    _write_json("schedule.json", schedule)
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -m pytest tests/test_storage.py -v
```

Expected: 4 tests PASSED.

- [ ] **Step 5: Commit**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
git add services/storage.py tests/test_storage.py
git commit -m "feat: storage service for portfolio and schedule JSON"
```

---

## Task 3: Market Data Service

**Files:**
- Create: `backend/services/market.py`
- Create: `backend/tests/test_market.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_market.py`:
```python
import pytest
from unittest.mock import patch, MagicMock
import pandas as pd
from datetime import datetime

def _make_mock_ticker(price=150.0, market_cap=100_000_000_000, prev_close=148.0):
    mock = MagicMock()
    mock.info = {
        "currentPrice": price,
        "marketCap": market_cap,
        "shortName": "Test Corp",
    }
    dates = pd.date_range("2026-01-02", periods=2, freq="B")
    mock.history.return_value = pd.DataFrame(
        {"Close": [prev_close, price], "High": [155.0, 152.0], "Low": [145.0, 148.0]},
        index=dates,
    )
    mock.quarterly_income_stmt = pd.DataFrame(
        {"Total Revenue": [10e9, 9.5e9, 9e9, 8.5e9],
         "Operating Income": [2e9, 1.9e9, 1.8e9, 1.7e9]},
        index=pd.date_range("2025-12-31", periods=4, freq="-1Q"),
    ).T
    mock.analyst_price_targets = {"mean": 180.0, "high": 220.0, "low": 140.0}
    mock.recommendations_summary = pd.DataFrame(
        [{"period": "0m", "strongBuy": 5, "buy": 10, "hold": 8, "sell": 2, "strongSell": 1}]
    )
    mock.news = [
        {
            "title": "Test News",
            "link": "https://example.com",
            "publisher": "Reuters",
            "providerPublishTime": 1746316800,
        }
    ]
    return mock

def test_get_quote_returns_expected_fields():
    with patch("services.market.yf.Ticker", return_value=_make_mock_ticker()):
        from services import market
        result = market.get_quote("TEST")
    assert result["ticker"] == "TEST"
    assert result["price"] == 150.0
    assert result["market_cap"] == 100_000_000_000
    assert result["name"] == "Test Corp"
    assert "ytd_return" in result
    assert "prev_close" in result
    assert "daily_change" in result

def test_get_financials_returns_four_quarters():
    with patch("services.market.yf.Ticker", return_value=_make_mock_ticker()):
        from services import market
        result = market.get_financials("TEST")
    assert len(result) == 4
    assert "period" in result[0]
    assert "revenue" in result[0]
    assert "operating_income" in result[0]

def test_get_analyst_data_returns_consensus():
    with patch("services.market.yf.Ticker", return_value=_make_mock_ticker()):
        from services import market
        result = market.get_analyst_data("TEST")
    assert result["target_mean"] == 180.0
    assert result["buy"] == 15   # strongBuy(5) + buy(10)
    assert result["hold"] == 8
    assert result["sell"] == 3   # sell(2) + strongSell(1)
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -m pytest tests/test_market.py -v
```

Expected: ImportError for `services.market`.

- [ ] **Step 3: Implement market.py**

Create `backend/services/market.py`:
```python
import yfinance as yf
import pandas as pd
from datetime import datetime

def get_quote(ticker: str) -> dict:
    try:
        t = yf.Ticker(ticker)
        info = t.info
        hist = t.history(period="1y")
        current = info.get("currentPrice") or info.get("regularMarketPrice") or 0.0
        prev_close = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else None
        ytd_start = float(hist["Close"].iloc[0]) if not hist.empty else None
        daily_change_pct = ((current - prev_close) / prev_close * 100) if prev_close else None
        ytd_return = ((current - ytd_start) / ytd_start * 100) if ytd_start else None
        return {
            "ticker": ticker,
            "name": info.get("shortName", ticker),
            "price": float(current),
            "prev_close": round(prev_close, 2) if prev_close else None,
            "daily_change": f"{daily_change_pct:+.2f}%" if daily_change_pct is not None else "N/A",
            "market_cap": info.get("marketCap"),
            "ytd_return": round(ytd_return, 2) if ytd_return else None,
        }
    except Exception as e:
        return {
            "ticker": ticker, "name": ticker, "price": None,
            "prev_close": None, "daily_change": "N/A",
            "market_cap": None, "ytd_return": None,
            "error": str(e),
        }

def get_financials(ticker: str) -> list[dict]:
    try:
        t = yf.Ticker(ticker)
        stmt = t.quarterly_income_stmt
        if stmt is None or stmt.empty:
            return []
        results = []
        for col in stmt.columns[:4]:
            revenue = stmt.loc["Total Revenue", col] if "Total Revenue" in stmt.index else None
            op_income = stmt.loc["Operating Income", col] if "Operating Income" in stmt.index else None
            period_str = col.strftime("%Y-Q%m") if hasattr(col, "strftime") else str(col)[:7]
            results.append({
                "period": period_str,
                "revenue": int(revenue) if revenue is not None and not pd.isna(revenue) else None,
                "operating_income": int(op_income) if op_income is not None and not pd.isna(op_income) else None,
            })
        return results
    except Exception:
        return []

def get_analyst_data(ticker: str) -> dict:
    try:
        t = yf.Ticker(ticker)
        targets = t.analyst_price_targets or {}
        recs = t.recommendations_summary
        buy = hold = sell = 0
        if recs is not None and not recs.empty:
            row = recs.iloc[0]
            buy = int(row.get("strongBuy", 0)) + int(row.get("buy", 0))
            hold = int(row.get("hold", 0))
            sell = int(row.get("sell", 0)) + int(row.get("strongSell", 0))
        return {
            "target_mean": targets.get("mean"),
            "target_high": targets.get("high"),
            "target_low": targets.get("low"),
            "buy": buy,
            "hold": hold,
            "sell": sell,
        }
    except Exception:
        return {"target_mean": None, "target_high": None, "target_low": None, "buy": 0, "hold": 0, "sell": 0}
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -m pytest tests/test_market.py -v
```

Expected: 3 tests PASSED.

- [ ] **Step 5: Commit**

```powershell
git add services/market.py tests/test_market.py
git commit -m "feat: market data service using yfinance"
```

---

## Task 4: Technical Indicators Service

**Files:**
- Create: `backend/services/indicators.py`
- Create: `backend/tests/test_indicators.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_indicators.py`:
```python
import pytest
import pandas as pd
import numpy as np
from unittest.mock import patch, MagicMock

def _make_price_series(n=50, start=100.0, trend=0.5):
    np.random.seed(42)
    prices = [start]
    for _ in range(n - 1):
        prices.append(prices[-1] + trend + np.random.randn() * 2)
    return pd.Series(prices, dtype=float)

def test_calc_rsi_values_in_0_to_100_range():
    from services.indicators import calc_rsi
    prices = _make_price_series(60)
    rsi = calc_rsi(prices)
    valid = rsi.dropna()
    assert (valid >= 0).all() and (valid <= 100).all()

def test_calc_rsi_oversold_on_declining_prices():
    from services.indicators import calc_rsi
    declining = pd.Series([100 - i * 2 for i in range(50)], dtype=float)
    rsi = calc_rsi(declining)
    assert rsi.dropna().iloc[-1] < 30

def test_calc_ema_tracks_price():
    from services.indicators import calc_ema
    prices = _make_price_series(50)
    ema = calc_ema(prices, 20)
    assert len(ema) == len(prices)
    assert not ema.isna().all()

def test_get_support_resistance_returns_required_keys():
    from services.indicators import get_support_resistance
    prices = _make_price_series(260)
    df = pd.DataFrame({
        "Close": prices,
        "High": prices + 1,
        "Low": prices - 1,
    })
    result = get_support_resistance(df)
    assert "week52_high" in result
    assert "week52_low" in result
    assert "ema20" in result
    assert "ema50" in result
    assert "ema200" in result
    assert result["week52_high"] >= result["week52_low"]

def test_calc_rsi_target_price_returns_float():
    from services.indicators import calc_rsi, calc_rsi_target_price
    prices = _make_price_series(60)
    rsi = calc_rsi(prices)
    result = calc_rsi_target_price(prices, rsi, 30.0)
    assert result is not None
    assert isinstance(result, float)
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -m pytest tests/test_indicators.py -v
```

Expected: ImportError for `services.indicators`.

- [ ] **Step 3: Implement indicators.py**

Create `backend/services/indicators.py`:
```python
import pandas as pd
import numpy as np
import yfinance as yf

def calc_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def calc_ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()

def get_support_resistance(df: pd.DataFrame) -> dict:
    close = df["Close"]
    return {
        "week52_high": round(float(df["High"].tail(252).max()), 2),
        "week52_low": round(float(df["Low"].tail(252).min()), 2),
        "ema20": round(float(calc_ema(close, 20).iloc[-1]), 2),
        "ema50": round(float(calc_ema(close, 50).iloc[-1]), 2),
        "ema200": round(float(calc_ema(close, 200).iloc[-1]), 2),
    }

def calc_rsi_target_price(
    prices: pd.Series, rsi_values: pd.Series, target_rsi: float
) -> float | None:
    prices = prices.dropna()
    rsi_values = rsi_values.dropna()
    n = min(len(prices), len(rsi_values), 20)
    if n < 5:
        return None
    p = prices.iloc[-n:].values
    r = rsi_values.iloc[-n:].values
    coeffs = np.polyfit(r, p, 1)
    return round(float(np.polyval(coeffs, target_rsi)), 2)

def get_timeframe_rsi(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    result = {}
    configs = [
        ("daily",   {"period": "1y",  "interval": "1d"}),
        ("weekly",  {"period": "5y",  "interval": "1wk"}),
        ("monthly", {"period": "10y", "interval": "1mo"}),
    ]
    for tf, params in configs:
        try:
            df = t.history(**params)
            if df.empty:
                result[tf] = {"rsi": None, "target_30": None, "target_70": None}
                continue
            rsi = calc_rsi(df["Close"])
            current_rsi = round(float(rsi.iloc[-1]), 2)
            result[tf] = {
                "rsi": current_rsi,
                "target_30": calc_rsi_target_price(df["Close"], rsi, 30.0),
                "target_70": calc_rsi_target_price(df["Close"], rsi, 70.0),
            }
        except Exception:
            result[tf] = {"rsi": None, "target_30": None, "target_70": None}
    return result
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -m pytest tests/test_indicators.py -v
```

Expected: 5 tests PASSED.

- [ ] **Step 5: Commit**

```powershell
git add services/indicators.py tests/test_indicators.py
git commit -m "feat: RSI/EMA indicators and support/resistance calculation"
```

---

## Task 5: Scraper Service

**Files:**
- Create: `backend/services/scraper.py`

- [ ] **Step 1: Implement scraper.py**

Create `backend/services/scraper.py`:
```python
import requests
from bs4 import BeautifulSoup
import yfinance as yf
from datetime import datetime

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}

def scrape_finviz_consensus(ticker: str) -> dict:
    """Scrape Finviz for analyst recommendation score and target price."""
    try:
        url = f"https://finviz.com/quote.ashx?t={ticker}"
        resp = requests.get(url, headers=_HEADERS, timeout=10)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        table = soup.find("table", {"class": "snapshot-table2"})
        if not table:
            return {}
        cells = table.find_all("td")
        data = {}
        for i, cell in enumerate(cells):
            text = cell.get_text(strip=True)
            if text == "Recom" and i + 1 < len(cells):
                try:
                    data["finviz_recom"] = float(cells[i + 1].get_text(strip=True))
                except ValueError:
                    pass
            elif text == "Target Price" and i + 1 < len(cells):
                try:
                    data["finviz_target"] = float(cells[i + 1].get_text(strip=True))
                except ValueError:
                    pass
        return data
    except Exception:
        return {}

def get_news(ticker: str) -> list[dict]:
    """Fetch recent news via yfinance (sourced from Yahoo Finance)."""
    try:
        t = yf.Ticker(ticker)
        raw = t.news or []
        return [
            {
                "title": item.get("title", ""),
                "link": item.get("link", ""),
                "publisher": item.get("publisher", ""),
                "published_at": datetime.fromtimestamp(
                    item.get("providerPublishTime", 0)
                ).strftime("%Y-%m-%d %H:%M"),
            }
            for item in raw[:5]
        ]
    except Exception:
        return []
```

- [ ] **Step 2: Smoke test scraper manually**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -c "from services.scraper import get_news; print(get_news('NFLX'))"
```

Expected: list of 0–5 news dicts (may be empty if market is closed or API rate-limited).

- [ ] **Step 3: Commit**

```powershell
git add services/scraper.py
git commit -m "feat: Finviz consensus scraper and yfinance news fetcher"
```

---

## Task 6: Charts Service

**Files:**
- Create: `backend/services/charts.py`

- [ ] **Step 1: Implement charts.py**

Create `backend/services/charts.py`:
```python
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import pandas as pd
from pathlib import Path

from services.indicators import calc_rsi

def generate_revenue_chart(quarters: list[dict], ticker: str, output_dir: Path) -> str:
    """Bar chart of quarterly revenue + operating income. Returns saved PNG path."""
    if not quarters:
        return ""
    periods = [q["period"] for q in quarters]
    revenues = [(q["revenue"] or 0) / 1e9 for q in quarters]
    op_incomes = [(q["operating_income"] or 0) / 1e9 for q in quarters]

    x = list(range(len(periods)))
    fig, ax = plt.subplots(figsize=(8, 4))
    w = 0.35
    ax.bar([i - w / 2 for i in x], revenues, w, label="Revenue ($B)", color="#4472C4")
    ax.bar([i + w / 2 for i in x], op_incomes, w, label="Op. Income ($B)", color="#ED7D31")
    ax.set_xticks(x)
    ax.set_xticklabels(periods, rotation=30, ha="right")
    ax.yaxis.set_major_formatter(mticker.FormatStrFormatter("$%.1fB"))
    ax.legend()
    ax.set_title(f"{ticker} — Quarterly Financials")
    fig.tight_layout()

    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "revenue_chart.png"
    fig.savefig(path, dpi=100)
    plt.close(fig)
    return str(path)

def generate_rsi_chart(daily_close: pd.Series, ticker: str, output_dir: Path) -> str:
    """RSI(14) line chart for last 90 trading days. Returns saved PNG path."""
    rsi = calc_rsi(daily_close).tail(90)

    fig, ax = plt.subplots(figsize=(10, 3))
    ax.plot(rsi.index, rsi.values, color="#4472C4", linewidth=1.5, label="RSI(14)")
    ax.axhline(70, color="red",   linestyle="--", linewidth=0.8, label="Overbought 70")
    ax.axhline(30, color="green", linestyle="--", linewidth=0.8, label="Oversold 30")
    ax.axhline(50, color="gray",  linestyle=":",  linewidth=0.8)
    ax.set_ylim(0, 100)
    ax.set_title(f"{ticker} — RSI(14) Daily (90d)")
    ax.legend(loc="upper left", fontsize=8)
    fig.tight_layout()

    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "rsi_chart.png"
    fig.savefig(path, dpi=100)
    plt.close(fig)
    return str(path)
```

- [ ] **Step 2: Smoke test charts**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -c "
import pandas as pd, numpy as np
from pathlib import Path
from services.charts import generate_rsi_chart
prices = pd.Series([100 + i + np.random.randn() for i in range(100)])
p = generate_rsi_chart(prices, 'TEST', Path('reports/TEST'))
print('Chart saved:', p)
"
```

Expected: `Chart saved: reports/TEST/rsi_chart.png` and file exists.

- [ ] **Step 3: Commit**

```powershell
git add services/charts.py
git commit -m "feat: matplotlib revenue and RSI chart generators"
```

---

## Task 7: Report Generator

**Files:**
- Create: `backend/services/report_generator.py`
- Create: `backend/tests/test_report_generator.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_report_generator.py`:
```python
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

SAMPLE_STOCK = {
    "ticker": "TEST",
    "name": "Test Corp",
    "quantity": 10,
    "avg_cost": 100.0,
    "competitors": [],
    "moat": "Strong brand",
    "growth_plan": "Expand to Asia",
}

def _mock_services():
    return {
        "services.report_generator.market.get_quote": MagicMock(return_value={
            "ticker": "TEST", "name": "Test Corp", "price": 120.0,
            "prev_close": 118.0, "daily_change": "+1.69%",
            "market_cap": 500_000_000_000, "ytd_return": 15.0,
        }),
        "services.report_generator.market.get_financials": MagicMock(return_value=[
            {"period": "2025-Q4", "revenue": 10_000_000_000, "operating_income": 2_000_000_000},
        ]),
        "services.report_generator.market.get_analyst_data": MagicMock(return_value={
            "target_mean": 150.0, "target_high": 200.0, "target_low": 120.0,
            "buy": 15, "hold": 5, "sell": 2,
        }),
        "services.report_generator.indicators.get_timeframe_rsi": MagicMock(return_value={
            "daily":   {"rsi": 55.0, "target_30": 90.0,  "target_70": 130.0},
            "weekly":  {"rsi": 60.0, "target_30": 85.0,  "target_70": 140.0},
            "monthly": {"rsi": 50.0, "target_30": 80.0,  "target_70": 145.0},
        }),
        "services.report_generator.indicators.get_support_resistance": MagicMock(return_value={
            "week52_high": 135.0, "week52_low": 90.0,
            "ema20": 118.0, "ema50": 115.0, "ema200": 110.0,
        }),
        "services.report_generator.scraper.scrape_finviz_consensus": MagicMock(return_value={}),
        "services.report_generator.scraper.get_news": MagicMock(return_value=[
            {"title": "Test news", "link": "https://example.com",
             "publisher": "Reuters", "published_at": "2026-05-04 09:00"}
        ]),
        "services.report_generator.charts.generate_revenue_chart": MagicMock(return_value=""),
        "services.report_generator.charts.generate_rsi_chart": MagicMock(return_value=""),
        "services.report_generator.yf.Ticker": MagicMock(
            return_value=MagicMock(history=MagicMock(return_value=__import__("pandas").DataFrame(
                {"Close": [100.0 + i for i in range(50)],
                 "High":  [101.0 + i for i in range(50)],
                 "Low":   [99.0  + i for i in range(50)]},
            )))
        ),
    }

def test_generate_report_creates_markdown_file(tmp_path):
    with __import__("contextlib").ExitStack() as stack:
        mocks = _mock_services()
        for target, mock in mocks.items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        md_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    assert md_path.endswith(".md")
    content = Path(md_path).read_text(encoding="utf-8")
    assert "Test Corp" in content
    assert "① 사업영역" in content
    assert "② 매출" in content
    assert "③ 증권사" in content
    assert "④ 경제적 해자" in content
    assert "Strong brand" in content
    assert "⑤ 장기 성장 계획" in content
    assert "Expand to Asia" in content
    assert "⑥ 최근 공시" in content
    assert "⑦ 매수/매도" in content
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -m pytest tests/test_report_generator.py -v
```

Expected: ImportError for `services.report_generator`.

- [ ] **Step 3: Implement report_generator.py**

Create `backend/services/report_generator.py`:
```python
from pathlib import Path
from datetime import date
import pandas as pd
import yfinance as yf

from services import market, indicators, scraper, charts

REPORTS_DIR = Path(__file__).parent.parent / "reports"

def generate_report(stock: dict, output_base_dir: Path = REPORTS_DIR) -> str:
    ticker = stock["ticker"]
    today = date.today().strftime("%Y-%m-%d")
    output_dir = output_base_dir / ticker
    output_dir.mkdir(parents=True, exist_ok=True)

    quote = market.get_quote(ticker)
    financials = market.get_financials(ticker)
    analyst = market.get_analyst_data(ticker)
    competitor_quotes = [market.get_quote(c) for c in stock.get("competitors", [])]
    timeframe_rsi = indicators.get_timeframe_rsi(ticker)
    t = yf.Ticker(ticker)
    daily_df = t.history(period="1y")
    sr = indicators.get_support_resistance(daily_df) if not daily_df.empty else {}
    finviz = scraper.scrape_finviz_consensus(ticker)
    news = scraper.get_news(ticker)
    charts.generate_revenue_chart(financials, ticker, output_dir)
    rsi_close = daily_df["Close"] if not daily_df.empty else pd.Series(dtype=float)
    charts.generate_rsi_chart(rsi_close, ticker, output_dir)

    sections = [
        _header(stock, quote, today),
        _section1(quote, competitor_quotes),
        _section2(financials),
        _section3(analyst, finviz),
        _section4(stock),
        _section5(stock),
        _section6(quote, news),
        _section7(timeframe_rsi, sr),
    ]

    md_path = output_dir / f"{today}.md"
    md_path.write_text("\n\n".join(filter(None, sections)), encoding="utf-8")
    return str(md_path)

def _header(stock: dict, quote: dict, today: str) -> str:
    price = quote.get("price")
    avg_cost = stock.get("avg_cost")
    ret = f"{(price - avg_cost) / avg_cost * 100:+.2f}%" if price and avg_cost else "N/A"
    return (
        f"# {stock.get('name', stock['ticker'])} ({stock['ticker']}) — {today}\n\n"
        f"**현재가:** ${price:.2f}  |  **보유 수익률:** {ret}  |  "
        f"**전일 대비:** {quote.get('daily_change', 'N/A')}"
    ) if price else f"# {stock.get('name', stock['ticker'])} ({stock['ticker']}) — {today}\n\n데이터 조회 실패"

def _section1(quote: dict, competitor_quotes: list[dict]) -> str:
    rows = [quote] + competitor_quotes
    lines = [
        "## ① 사업영역 & 시장순위\n",
        "| 종목 | 티커 | 현재가 | 시가총액 | YTD 수익률 |",
        "|---|---|---|---|---|",
    ]
    for r in rows:
        mc = f"${r['market_cap']/1e9:.1f}B" if r.get("market_cap") else "N/A"
        ytd = f"{r['ytd_return']:+.1f}%" if r.get("ytd_return") is not None else "N/A"
        price = f"${r['price']:.2f}" if r.get("price") else "N/A"
        lines.append(f"| {r.get('name', r['ticker'])} | {r['ticker']} | {price} | {mc} | {ytd} |")
    return "\n".join(lines)

def _section2(financials: list[dict]) -> str:
    lines = [
        "## ② 매출/영업이익 추이 (최근 4분기)\n",
        "| 분기 | 매출 | 영업이익 |",
        "|---|---|---|",
    ]
    if not financials:
        lines.append("| N/A | N/A | N/A |")
    else:
        for q in financials:
            rev = f"${q['revenue']/1e9:.2f}B" if q.get("revenue") else "N/A"
            op = f"${q['operating_income']/1e9:.2f}B" if q.get("operating_income") else "N/A"
            lines.append(f"| {q['period']} | {rev} | {op} |")
    lines.append("\n![Revenue Chart](./revenue_chart.png)")
    return "\n".join(lines)

def _section3(analyst: dict, finviz: dict) -> str:
    target = analyst.get("target_mean") or finviz.get("finviz_target")
    total = (analyst.get("buy", 0) + analyst.get("hold", 0) + analyst.get("sell", 0)) or 1
    lines = [
        "## ③ 증권사 컨센서스\n",
        "| 항목 | 값 |",
        "|---|---|",
        f"| 평균 목표가 | ${target:.2f} |" if target else "| 평균 목표가 | N/A |",
        f"| 최고 목표가 | ${analyst['target_high']:.2f} |" if analyst.get("target_high") else "| 최고 목표가 | N/A |",
        f"| 최저 목표가 | ${analyst['target_low']:.2f} |" if analyst.get("target_low") else "| 최저 목표가 | N/A |",
        f"| Buy | {analyst.get('buy', 0)}명 ({analyst.get('buy', 0)/total*100:.0f}%) |",
        f"| Hold | {analyst.get('hold', 0)}명 ({analyst.get('hold', 0)/total*100:.0f}%) |",
        f"| Sell | {analyst.get('sell', 0)}명 ({analyst.get('sell', 0)/total*100:.0f}%) |",
    ]
    if finviz.get("finviz_recom"):
        lines.append(f"| Finviz 추천지수 | {finviz['finviz_recom']:.1f} (1=강매수, 5=강매도) |")
    return "\n".join(lines)

def _section4(stock: dict) -> str:
    return f"## ④ 경제적 해자\n\n{stock.get('moat', '정보 없음')}"

def _section5(stock: dict) -> str:
    return f"## ⑤ 장기 성장 계획\n\n{stock.get('growth_plan', '정보 없음')}"

def _section6(quote: dict, news: list[dict]) -> str:
    lines = [
        "## ⑥ 최근 공시 & 주가 영향\n",
        f"**어제 종가:** ${quote['prev_close']:.2f}  |  **전일 대비:** {quote.get('daily_change', 'N/A')}\n"
        if quote.get("prev_close") else "",
        "### 최근 뉴스\n",
    ]
    if not news:
        lines.append("_(뉴스 없음)_")
    else:
        for item in news:
            lines.append(f"- [{item['title']}]({item['link']}) — {item['publisher']} ({item['published_at']})")
    return "\n".join(lines)

def _section7(timeframe_rsi: dict, sr: dict) -> str:
    lines = [
        "## ⑦ 매수/매도 타점\n",
        "### RSI 현황\n",
        "| 시간대 | 현재 RSI | RSI 30 도달 예상가 | RSI 70 도달 예상가 |",
        "|---|---|---|---|",
    ]
    for tf, label in [("daily", "일봉"), ("weekly", "주봉"), ("monthly", "월봉")]:
        d = timeframe_rsi.get(tf, {})
        rsi = f"{d['rsi']:.1f}" if d.get("rsi") else "N/A"
        t30 = f"${d['target_30']:.2f}" if d.get("target_30") else "N/A"
        t70 = f"${d['target_70']:.2f}" if d.get("target_70") else "N/A"
        lines.append(f"| {label} | {rsi} | {t30} | {t70} |")
    lines += [
        "\n### 지지·저항 & EMA\n",
        "| 항목 | 값 |",
        "|---|---|",
        f"| 52주 고점 | ${sr['week52_high']:.2f} |" if sr.get("week52_high") else "| 52주 고점 | N/A |",
        f"| 52주 저점 | ${sr['week52_low']:.2f} |" if sr.get("week52_low") else "| 52주 저점 | N/A |",
        f"| EMA(20) | ${sr['ema20']:.2f} |" if sr.get("ema20") else "| EMA(20) | N/A |",
        f"| EMA(50) | ${sr['ema50']:.2f} |" if sr.get("ema50") else "| EMA(50) | N/A |",
        f"| EMA(200) | ${sr['ema200']:.2f} |" if sr.get("ema200") else "| EMA(200) | N/A |",
        "\n![RSI Chart](./rsi_chart.png)",
    ]
    return "\n".join(lines)
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -m pytest tests/test_report_generator.py -v
```

Expected: 1 test PASSED.

- [ ] **Step 5: Commit**

```powershell
git add services/report_generator.py tests/test_report_generator.py
git commit -m "feat: 7-section markdown report generator"
```

---

## Task 8: Portfolio API Router

**Files:**
- Create: `backend/routers/portfolio.py`
- Create: `backend/tests/test_portfolio_router.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_portfolio_router.py`:
```python
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.portfolio import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)

SAMPLE_PORTFOLIO = {
    "stocks": [
        {"ticker": "NFLX", "name": "Netflix", "quantity": 10, "avg_cost": 85.59,
         "competitors": ["DIS"], "moat": "Content", "growth_plan": "Gaming"}
    ]
}

def test_get_portfolio_returns_stocks():
    with patch("routers.portfolio.storage.get_portfolio", return_value=SAMPLE_PORTFOLIO):
        resp = client.get("/api/portfolio")
    assert resp.status_code == 200
    assert len(resp.json()["stocks"]) == 1
    assert resp.json()["stocks"][0]["ticker"] == "NFLX"

def test_add_stock_appends_to_portfolio():
    portfolio = {"stocks": []}
    with patch("routers.portfolio.storage.get_portfolio", return_value=portfolio), \
         patch("routers.portfolio.storage.save_portfolio") as mock_save:
        resp = client.post("/api/portfolio", json={
            "ticker": "NVDA", "name": "Nvidia", "quantity": 5, "avg_cost": 200.0,
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 201
    saved = mock_save.call_args[0][0]
    assert saved["stocks"][0]["ticker"] == "NVDA"

def test_add_duplicate_ticker_returns_400():
    with patch("routers.portfolio.storage.get_portfolio", return_value=SAMPLE_PORTFOLIO):
        resp = client.post("/api/portfolio", json={
            "ticker": "NFLX", "name": "Netflix", "quantity": 5, "avg_cost": 90.0,
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 400

def test_update_stock_modifies_fields():
    portfolio = {"stocks": [{"ticker": "NFLX", "name": "Netflix", "quantity": 10,
                             "avg_cost": 85.59, "competitors": [], "moat": "", "growth_plan": ""}]}
    with patch("routers.portfolio.storage.get_portfolio", return_value=portfolio), \
         patch("routers.portfolio.storage.save_portfolio") as mock_save:
        resp = client.put("/api/portfolio/NFLX", json={
            "ticker": "NFLX", "name": "Netflix", "quantity": 20, "avg_cost": 90.0,
            "competitors": ["DIS"], "moat": "Brand", "growth_plan": "Gaming"
        })
    assert resp.status_code == 200
    saved = mock_save.call_args[0][0]
    assert saved["stocks"][0]["quantity"] == 20

def test_delete_stock_removes_from_portfolio():
    portfolio = {"stocks": [{"ticker": "NFLX", "name": "Netflix", "quantity": 10,
                             "avg_cost": 85.59, "competitors": [], "moat": "", "growth_plan": ""}]}
    with patch("routers.portfolio.storage.get_portfolio", return_value=portfolio), \
         patch("routers.portfolio.storage.save_portfolio") as mock_save:
        resp = client.delete("/api/portfolio/NFLX")
    assert resp.status_code == 200
    saved = mock_save.call_args[0][0]
    assert saved["stocks"] == []

def test_delete_nonexistent_ticker_returns_404():
    with patch("routers.portfolio.storage.get_portfolio", return_value={"stocks": []}):
        resp = client.delete("/api/portfolio/FAKE")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -m pytest tests/test_portfolio_router.py -v
```

Expected: ImportError for `routers.portfolio`.

- [ ] **Step 3: Implement portfolio router**

Create `backend/routers/portfolio.py`:
```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
from services import storage

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])

class Stock(BaseModel):
    ticker: str
    name: str
    quantity: float
    avg_cost: float
    competitors: List[str] = []
    moat: str = ""
    growth_plan: str = ""

@router.get("")
def get_portfolio():
    return storage.get_portfolio()

@router.post("", status_code=201)
def add_stock(stock: Stock):
    portfolio = storage.get_portfolio()
    tickers = [s["ticker"].upper() for s in portfolio["stocks"]]
    if stock.ticker.upper() in tickers:
        raise HTTPException(status_code=400, detail=f"{stock.ticker} already exists")
    portfolio["stocks"].append({**stock.model_dump(), "ticker": stock.ticker.upper()})
    storage.save_portfolio(portfolio)
    return portfolio["stocks"][-1]

@router.put("/{ticker}")
def update_stock(ticker: str, stock: Stock):
    portfolio = storage.get_portfolio()
    idx = next((i for i, s in enumerate(portfolio["stocks"]) if s["ticker"].upper() == ticker.upper()), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"{ticker} not found")
    portfolio["stocks"][idx] = {**stock.model_dump(), "ticker": ticker.upper()}
    storage.save_portfolio(portfolio)
    return portfolio["stocks"][idx]

@router.delete("/{ticker}")
def delete_stock(ticker: str):
    portfolio = storage.get_portfolio()
    original_len = len(portfolio["stocks"])
    portfolio["stocks"] = [s for s in portfolio["stocks"] if s["ticker"].upper() != ticker.upper()]
    if len(portfolio["stocks"]) == original_len:
        raise HTTPException(status_code=404, detail=f"{ticker} not found")
    storage.save_portfolio(portfolio)
    return {"deleted": ticker.upper()}
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -m pytest tests/test_portfolio_router.py -v
```

Expected: 6 tests PASSED.

- [ ] **Step 5: Commit**

```powershell
git add routers/portfolio.py tests/test_portfolio_router.py
git commit -m "feat: portfolio CRUD API router"
```

---

## Task 9: Report API Router

**Files:**
- Create: `backend/routers/report.py`

- [ ] **Step 1: Implement report router**

Create `backend/routers/report.py`:
```python
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pathlib import Path
from services import storage, report_generator

router = APIRouter(prefix="/api", tags=["report"])

REPORTS_DIR = Path(__file__).parent.parent / "reports"

@router.post("/report/generate", status_code=202)
def generate_all(background_tasks: BackgroundTasks):
    portfolio = storage.get_portfolio()
    stocks = portfolio.get("stocks", [])
    if not stocks:
        raise HTTPException(status_code=400, detail="No stocks in portfolio")
    background_tasks.add_task(_run_generation, stocks)
    return {"message": f"Generating reports for {len(stocks)} stock(s)"}

@router.post("/report/generate/{ticker}", status_code=202)
def generate_one(ticker: str, background_tasks: BackgroundTasks):
    portfolio = storage.get_portfolio()
    stock = next((s for s in portfolio["stocks"] if s["ticker"].upper() == ticker.upper()), None)
    if not stock:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in portfolio")
    background_tasks.add_task(_run_generation, [stock])
    return {"message": f"Generating report for {ticker.upper()}"}

def _run_generation(stocks: list):
    for stock in stocks:
        try:
            report_generator.generate_report(stock)
        except Exception as e:
            print(f"[Report] Failed for {stock['ticker']}: {e}")

@router.get("/report/list")
def list_reports():
    result = {}
    if not REPORTS_DIR.exists():
        return result
    for ticker_dir in sorted(REPORTS_DIR.iterdir()):
        if ticker_dir.is_dir():
            dates = sorted(
                [f.stem for f in ticker_dir.glob("*.md")], reverse=True
            )
            if dates:
                result[ticker_dir.name] = dates
    return result

@router.get("/report/{ticker}/{date_str}")
def get_report(ticker: str, date_str: str):
    path = REPORTS_DIR / ticker.upper() / f"{date_str}.md"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Report not found")
    return {"ticker": ticker.upper(), "date": date_str, "content": path.read_text(encoding="utf-8")}

@router.get("/schedule")
def get_schedule():
    return storage.get_schedule()

@router.put("/schedule")
def update_schedule(schedule: dict):
    required = {"enabled", "time", "days"}
    if not required.issubset(schedule.keys()):
        raise HTTPException(status_code=400, detail=f"Missing fields: {required - schedule.keys()}")
    storage.save_schedule(schedule)
    return schedule
```

- [ ] **Step 2: Smoke test report list endpoint**

After starting the server (Task 11), verify:
```powershell
Invoke-RestMethod -Uri "http://localhost:8000/api/report/list"
```

Expected: empty dict `{}` when no reports exist.

- [ ] **Step 3: Commit**

```powershell
git add routers/report.py
git commit -m "feat: report generation and listing API"
```

---

## Task 10: Scheduler + FastAPI Main App

**Files:**
- Create: `backend/scheduler.py`
- Create: `backend/main.py`

- [ ] **Step 1: Implement scheduler.py**

Create `backend/scheduler.py`:
```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from services import storage, report_generator

_scheduler = AsyncIOScheduler()
_JOB_ID = "daily_report"

_DAY_MAP = {
    "mon": "mon", "tue": "tue", "wed": "wed",
    "thu": "thu", "fri": "fri", "sat": "sat", "sun": "sun",
}

def _generate_all():
    portfolio = storage.get_portfolio()
    for stock in portfolio.get("stocks", []):
        try:
            report_generator.generate_report(stock)
            print(f"[Scheduler] Report generated for {stock['ticker']}")
        except Exception as e:
            print(f"[Scheduler] Failed for {stock['ticker']}: {e}")

def _reschedule():
    cfg = storage.get_schedule()
    if _scheduler.get_job(_JOB_ID):
        _scheduler.remove_job(_JOB_ID)
    if not cfg.get("enabled"):
        return
    time_parts = cfg["time"].split(":")
    hour, minute = int(time_parts[0]), int(time_parts[1])
    days_str = ",".join(_DAY_MAP[d] for d in cfg.get("days", []) if d in _DAY_MAP)
    if not days_str:
        return
    _scheduler.add_job(
        _generate_all,
        CronTrigger(day_of_week=days_str, hour=hour, minute=minute),
        id=_JOB_ID,
    )
    print(f"[Scheduler] Scheduled daily report at {cfg['time']} on {days_str}")

def start():
    _reschedule()
    _scheduler.start()

def stop():
    if _scheduler.running:
        _scheduler.shutdown(wait=False)

def reload():
    _reschedule()
```

- [ ] **Step 2: Implement main.py**

Create `backend/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from contextlib import asynccontextmanager

import scheduler as sched
from routers import portfolio, report

REPORTS_DIR = Path(__file__).parent / "reports"
REPORTS_DIR.mkdir(exist_ok=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    sched.start()
    yield
    sched.stop()

app = FastAPI(title="Stock Portfolio Manager", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/reports", StaticFiles(directory=str(REPORTS_DIR)), name="reports")

app.include_router(portfolio.router)
app.include_router(report.router)

@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 3: Start backend and verify health**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
uvicorn main:app --reload --port 8000
```

In another terminal:
```powershell
Invoke-RestMethod -Uri "http://localhost:8000/health"
```

Expected: `{"status": "ok"}`

- [ ] **Step 4: Commit**

```powershell
git add scheduler.py main.py
git commit -m "feat: FastAPI main app with CORS, static files, and scheduler"
```

---

## Task 11: React App Setup & Routing

**Files:**
- Modify: `frontend/vite.config.js`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/main.jsx`

- [ ] **Step 1: Configure Vite API proxy**

Edit `frontend/vite.config.js`:
```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 2: Set up App.jsx with routing and nav**

Replace `frontend/src/App.jsx`:
```jsx
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Portfolio from './pages/Portfolio'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import './App.css'

export default function App() {
  return (
    <BrowserRouter>
      <nav style={{ padding: '12px 24px', background: '#1a1a2e', display: 'flex', gap: 24 }}>
        <span style={{ color: '#e0e0e0', fontWeight: 'bold', marginRight: 16 }}>📈 Portfolio Manager</span>
        {[['/', '종목 관리'], ['/reports', '리포트'], ['/settings', '설정']].map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            style={({ isActive }) => ({
              color: isActive ? '#4fc3f7' : '#b0b0b0',
              textDecoration: 'none',
              fontWeight: isActive ? 600 : 400,
            })}
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <main style={{ padding: 24 }}>
        <Routes>
          <Route path="/" element={<Portfolio />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
```

- [ ] **Step 3: Update App.css with base styles**

Replace `frontend/src/App.css`:
```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #121212; color: #e0e0e0; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #333; }
th { background: #1e1e2e; color: #90caf9; font-weight: 600; }
tr:hover td { background: #1e1e1e; }
button { cursor: pointer; padding: 6px 14px; border-radius: 4px; border: none; font-size: 14px; }
.btn-primary { background: #1565c0; color: white; }
.btn-primary:hover { background: #1976d2; }
.btn-danger { background: #c62828; color: white; }
.btn-danger:hover { background: #d32f2f; }
.btn-secondary { background: #333; color: #e0e0e0; }
input, select, textarea {
  background: #1e1e2e; color: #e0e0e0; border: 1px solid #444;
  padding: 6px 10px; border-radius: 4px; font-size: 14px; width: 100%;
}
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.7);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal { background: #1e1e2e; padding: 24px; border-radius: 8px; width: 480px; max-width: 95vw; }
.modal h2 { margin-bottom: 16px; color: #90caf9; }
.form-field { margin-bottom: 12px; }
.form-field label { display: block; margin-bottom: 4px; font-size: 13px; color: #aaa; }
.positive { color: #66bb6a; }
.negative { color: #ef5350; }
```

- [ ] **Step 4: Start frontend and verify navigation works**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\frontend"
npm run dev
```

Open `http://localhost:5173` in browser. Expected: nav bar with 3 links, pages load without errors.

- [ ] **Step 5: Commit**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\frontend"
git add vite.config.js src/App.jsx src/App.css src/main.jsx
git commit -m "feat: React app with routing and base styles"
```

---

## Task 12: Portfolio Page

**Files:**
- Create: `frontend/src/pages/Portfolio.jsx`
- Create: `frontend/src/components/StockModal.jsx`

- [ ] **Step 1: Create StockModal component**

Create `frontend/src/components/StockModal.jsx`:
```jsx
import { useState, useEffect } from 'react'

const EMPTY = { ticker: '', name: '', quantity: '', avg_cost: '', competitors: '', moat: '', growth_plan: '' }

export default function StockModal({ stock, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY)
  const isEdit = !!stock

  useEffect(() => {
    if (stock) {
      setForm({ ...stock, competitors: stock.competitors?.join(', ') || '' })
    } else {
      setForm(EMPTY)
    }
  }, [stock])

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave({
      ticker: form.ticker.trim().toUpperCase(),
      name: form.name.trim(),
      quantity: parseFloat(form.quantity),
      avg_cost: parseFloat(form.avg_cost),
      competitors: form.competitors.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
      moat: form.moat.trim(),
      growth_plan: form.growth_plan.trim(),
    })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{isEdit ? '종목 수정' : '종목 추가'}</h2>
        <form onSubmit={handleSubmit}>
          {[
            ['ticker', '티커 (예: NFLX)', 'text', !isEdit],
            ['name', '회사명', 'text', false],
            ['quantity', '보유 수량', 'number', false],
            ['avg_cost', '평균 매입가 ($)', 'number', false],
            ['competitors', '경쟁사 티커 (쉼표 구분, 예: DIS,WBD)', 'text', false],
          ].map(([field, label, type, required]) => (
            <div className="form-field" key={field}>
              <label>{label}</label>
              <input
                type={type}
                value={form[field]}
                onChange={set(field)}
                required={required}
                disabled={field === 'ticker' && isEdit}
                step={type === 'number' ? '0.01' : undefined}
              />
            </div>
          ))}
          <div className="form-field">
            <label>경제적 해자</label>
            <textarea rows={2} value={form.moat} onChange={set('moat')} />
          </div>
          <div className="form-field">
            <label>장기 성장 계획</label>
            <textarea rows={2} value={form.growth_plan} onChange={set('growth_plan')} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="submit" className="btn-primary">저장</button>
            <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create Portfolio page**

Create `frontend/src/pages/Portfolio.jsx`:
```jsx
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import StockModal from '../components/StockModal'

export default function Portfolio() {
  const [stocks, setStocks] = useState([])
  const [quotes, setQuotes] = useState({})
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')

  const fetchPortfolio = useCallback(async () => {
    const { data } = await axios.get('/api/portfolio')
    setStocks(data.stocks || [])
  }, [])

  useEffect(() => { fetchPortfolio() }, [fetchPortfolio])

  const handleSave = async (stockData) => {
    try {
      if (editing) {
        await axios.put(`/api/portfolio/${editing.ticker}`, stockData)
      } else {
        await axios.post('/api/portfolio', stockData)
      }
      setModalOpen(false)
      setEditing(null)
      setError('')
      fetchPortfolio()
    } catch (err) {
      setError(err.response?.data?.detail || '저장 실패')
    }
  }

  const handleDelete = async (ticker) => {
    if (!window.confirm(`${ticker}를 삭제하시겠습니까?`)) return
    await axios.delete(`/api/portfolio/${ticker}`)
    fetchPortfolio()
  }

  const openEdit = (stock) => { setEditing(stock); setModalOpen(true) }
  const openAdd = () => { setEditing(null); setModalOpen(true) }

  const returnPct = (stock, price) => {
    if (!price || !stock.avg_cost) return null
    return ((price - stock.avg_cost) / stock.avg_cost * 100)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ color: '#90caf9' }}>내 포트폴리오</h1>
        <button className="btn-primary" onClick={openAdd}>+ 종목 추가</button>
      </div>
      {error && <p style={{ color: '#ef5350', marginBottom: 8 }}>{error}</p>}
      <table>
        <thead>
          <tr>
            <th>티커</th><th>회사명</th><th>수량</th><th>평단가</th>
            <th>수익률</th><th>경쟁사</th><th>관리</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map(stock => {
            const pct = returnPct(stock, quotes[stock.ticker])
            return (
              <tr key={stock.ticker}>
                <td><strong>{stock.ticker}</strong></td>
                <td>{stock.name}</td>
                <td>{stock.quantity}</td>
                <td>${stock.avg_cost?.toFixed(2)}</td>
                <td>
                  {pct !== null
                    ? <span className={pct >= 0 ? 'positive' : 'negative'}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</span>
                    : <span style={{ color: '#666' }}>-</span>
                  }
                </td>
                <td style={{ fontSize: 12, color: '#aaa' }}>{stock.competitors?.join(', ') || '-'}</td>
                <td>
                  <button className="btn-secondary" style={{ marginRight: 6 }} onClick={() => openEdit(stock)}>수정</button>
                  <button className="btn-danger" onClick={() => handleDelete(stock.ticker)}>삭제</button>
                </td>
              </tr>
            )
          })}
          {stocks.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: 'center', color: '#666', padding: 32 }}>종목을 추가해 주세요</td></tr>
          )}
        </tbody>
      </table>
      {modalOpen && <StockModal stock={editing} onSave={handleSave} onClose={() => { setModalOpen(false); setEditing(null) }} />}
    </div>
  )
}
```

- [ ] **Step 3: Verify in browser**

With both backend and frontend running, open `http://localhost:5173`.
- Add NFLX (qty: 10, avg_cost: 85.59, competitors: DIS,WBD,PARA)
- Add NVDA
- Add TSLA
- Edit NFLX to add moat and growth_plan fields
- Delete one stock, re-add it

Expected: All operations work, table updates immediately.

- [ ] **Step 4: Commit**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\frontend"
git add src/pages/Portfolio.jsx src/components/StockModal.jsx
git commit -m "feat: portfolio management page with add/edit/delete modal"
```

---

## Task 13: Reports Page

**Files:**
- Create: `frontend/src/pages/Reports.jsx`
- Create: `frontend/src/components/MarkdownViewer.jsx`

- [ ] **Step 1: Create MarkdownViewer component**

Create `frontend/src/components/MarkdownViewer.jsx`:
```jsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function MarkdownViewer({ content, ticker }) {
  const processedContent = ticker
    ? content.replace(
        /!\[([^\]]*)\]\(\.\/([^)]+)\)/g,
        `![$1](http://localhost:8000/reports/${ticker}/$2)`
      )
    : content

  return (
    <div style={{ lineHeight: 1.7, maxWidth: 900 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 style={{ color: '#90caf9', borderBottom: '1px solid #333', paddingBottom: 8, marginBottom: 16 }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ color: '#80cbc4', marginTop: 24, marginBottom: 12 }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ color: '#b0bec5', marginTop: 16, marginBottom: 8 }}>{children}</h3>,
          table: ({ children }) => <table style={{ marginBottom: 16 }}>{children}</table>,
          img: ({ src, alt }) => (
            <img src={src} alt={alt} style={{ maxWidth: '100%', borderRadius: 4, margin: '12px 0' }} />
          ),
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#4fc3f7' }}>{children}</a>,
          p: ({ children }) => <p style={{ marginBottom: 8 }}>{children}</p>,
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}
```

- [ ] **Step 2: Create Reports page**

Create `frontend/src/pages/Reports.jsx`:
```jsx
import { useState, useEffect } from 'react'
import axios from 'axios'
import MarkdownViewer from '../components/MarkdownViewer'

export default function Reports() {
  const [reportList, setReportList] = useState({})
  const [selected, setSelected] = useState({ ticker: null, date: null })
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    axios.get('/api/report/list').then(({ data }) => {
      setReportList(data)
      const tickers = Object.keys(data)
      if (tickers.length > 0) {
        const ticker = tickers[0]
        const date = data[ticker][0]
        setSelected({ ticker, date })
      }
    })
  }, [])

  useEffect(() => {
    if (!selected.ticker || !selected.date) return
    setLoading(true)
    axios.get(`/api/report/${selected.ticker}/${selected.date}`)
      .then(({ data }) => setContent(data.content))
      .finally(() => setLoading(false))
  }, [selected])

  const tickers = Object.keys(reportList)

  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 120px)' }}>
      {/* Left panel */}
      <div style={{ width: 200, overflowY: 'auto', borderRight: '1px solid #333', paddingRight: 16 }}>
        <h3 style={{ color: '#90caf9', marginBottom: 12 }}>리포트 목록</h3>
        {tickers.length === 0 && <p style={{ color: '#666', fontSize: 13 }}>리포트 없음</p>}
        {tickers.map(ticker => (
          <div key={ticker} style={{ marginBottom: 16 }}>
            <div style={{ color: '#80cbc4', fontWeight: 600, marginBottom: 4 }}>{ticker}</div>
            {reportList[ticker].map(date => (
              <div
                key={date}
                onClick={() => setSelected({ ticker, date })}
                style={{
                  padding: '4px 8px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  fontSize: 13,
                  background: selected.ticker === ticker && selected.date === date ? '#1565c0' : 'transparent',
                  color: selected.ticker === ticker && selected.date === date ? 'white' : '#aaa',
                }}
              >
                {date}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && <p style={{ color: '#aaa' }}>로딩 중...</p>}
        {!loading && content && <MarkdownViewer content={content} ticker={selected.ticker} />}
        {!loading && !content && tickers.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 80, color: '#666' }}>
            <p>리포트가 없습니다.</p>
            <p style={{ marginTop: 8, fontSize: 13 }}>설정 페이지에서 "지금 생성" 버튼을 눌러 첫 리포트를 만드세요.</p>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify in browser**

After generating a report via Settings page (Task 14), navigate to `/reports`.
- Left panel shows ticker + date list
- Clicking a date shows the markdown report with charts

- [ ] **Step 4: Commit**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\frontend"
git add src/pages/Reports.jsx src/components/MarkdownViewer.jsx
git commit -m "feat: report browser with markdown viewer and chart display"
```

---

## Task 14: Settings Page

**Files:**
- Create: `frontend/src/pages/Settings.jsx`

- [ ] **Step 1: Implement Settings page**

Create `frontend/src/pages/Settings.jsx`:
```jsx
import { useState, useEffect } from 'react'
import axios from 'axios'

const DAYS = [
  { key: 'mon', label: '월' }, { key: 'tue', label: '화' },
  { key: 'wed', label: '수' }, { key: 'thu', label: '목' },
  { key: 'fri', label: '금' }, { key: 'sat', label: '토' },
  { key: 'sun', label: '일' },
]

export default function Settings() {
  const [schedule, setSchedule] = useState({ enabled: false, time: '08:00', days: ['mon','tue','wed','thu','fri'] })
  const [saved, setSaved] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genMsg, setGenMsg] = useState('')

  useEffect(() => {
    axios.get('/api/schedule').then(({ data }) => setSchedule(data))
  }, [])

  const toggleDay = (day) => {
    setSchedule(s => ({
      ...s,
      days: s.days.includes(day) ? s.days.filter(d => d !== day) : [...s.days, day],
    }))
  }

  const handleSave = async () => {
    await axios.put('/api/schedule', schedule)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleGenerateNow = async () => {
    setGenerating(true)
    setGenMsg('')
    try {
      const { data } = await axios.post('/api/report/generate')
      setGenMsg(data.message)
    } catch (err) {
      setGenMsg(err.response?.data?.detail || '생성 실패')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <h1 style={{ color: '#90caf9', marginBottom: 24 }}>설정</h1>

      <section style={{ background: '#1e1e2e', padding: 20, borderRadius: 8, marginBottom: 24 }}>
        <h2 style={{ color: '#80cbc4', marginBottom: 16, fontSize: 16 }}>자동 리포트 스케줄</h2>

        <div className="form-field" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ marginBottom: 0, width: 'auto' }}>자동 생성</label>
          <input
            type="checkbox"
            checked={schedule.enabled}
            onChange={e => setSchedule(s => ({ ...s, enabled: e.target.checked }))}
            style={{ width: 'auto' }}
          />
        </div>

        <div className="form-field">
          <label>생성 시간</label>
          <input
            type="time"
            value={schedule.time}
            onChange={e => setSchedule(s => ({ ...s, time: e.target.value }))}
            disabled={!schedule.enabled}
          />
        </div>

        <div className="form-field">
          <label style={{ marginBottom: 8 }}>요일</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {DAYS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleDay(key)}
                disabled={!schedule.enabled}
                style={{
                  padding: '6px 10px',
                  borderRadius: 4,
                  border: 'none',
                  cursor: schedule.enabled ? 'pointer' : 'default',
                  background: schedule.days.includes(key) ? '#1565c0' : '#333',
                  color: schedule.days.includes(key) ? 'white' : '#888',
                  opacity: schedule.enabled ? 1 : 0.5,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <button className="btn-primary" onClick={handleSave}>
          {saved ? '✓ 저장됨' : '저장'}
        </button>
      </section>

      <section style={{ background: '#1e1e2e', padding: 20, borderRadius: 8 }}>
        <h2 style={{ color: '#80cbc4', marginBottom: 12, fontSize: 16 }}>즉시 리포트 생성</h2>
        <p style={{ color: '#aaa', fontSize: 13, marginBottom: 12 }}>포트폴리오의 모든 종목에 대해 즉시 리포트를 생성합니다. 종목당 30초~1분 소요됩니다.</p>
        <button className="btn-primary" onClick={handleGenerateNow} disabled={generating}>
          {generating ? '생성 중...' : '지금 생성'}
        </button>
        {genMsg && <p style={{ marginTop: 8, color: '#66bb6a', fontSize: 13 }}>{genMsg}</p>}
      </section>
    </div>
  )
}
```

- [ ] **Step 2: End-to-end test**

1. Open `http://localhost:5173/settings`
2. Click "지금 생성" — expected: "Generating reports for N stock(s)" message
3. Wait 1–2 minutes per stock for reports to generate
4. Navigate to `/reports` — expected: report list appears
5. Click a date — expected: markdown with all 7 sections renders, charts display

- [ ] **Step 3: Test schedule save**

1. Enable auto-generate toggle
2. Select time and days
3. Click "저장" — expected: "✓ 저장됨" confirmation
4. Refresh page — expected: settings persist

- [ ] **Step 4: Final test — run all backend tests**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -m pytest tests/ -v
```

Expected: All tests PASSED.

- [ ] **Step 5: Commit**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\frontend"
git add src/pages/Settings.jsx
git commit -m "feat: settings page with schedule config and generate-now button"
```

---

## Running the Application

**Backend:**
```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
uvicorn main:app --reload --port 8000
```

**Frontend:**
```powershell
cd "C:\Users\Kim Tae Hyung\myProject\frontend"
npm run dev
```

Open `http://localhost:5173`

---

## Quick Reference

| Command | Purpose |
|---|---|
| `python -m pytest tests/ -v` | Run all backend tests |
| `uvicorn main:app --reload` | Start backend (from `backend/`) |
| `npm run dev` | Start frontend (from `frontend/`) |
| `GET /api/portfolio` | List all stocks |
| `POST /api/report/generate` | Trigger report for all stocks |
| `GET /api/report/list` | List generated reports |

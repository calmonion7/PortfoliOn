import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from datetime import date
import pandas as pd

from routers.calendar import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)

SAMPLE_PORTFOLIO = {
    "stocks": [{"ticker": "AAPL", "type": "holding", "name": "Apple"}],
    "watchlist": [{"ticker": "TSLA", "type": "watchlist", "name": "Tesla"}],
}


def _mock_ticker(ticker):
    m = MagicMock()
    if ticker == "AAPL":
        m.calendar = {"Earnings Date": [date(2026, 5, 20)]}
        m.dividends = pd.Series(
            [0.25, 0.25, 0.25],
            index=pd.DatetimeIndex([
                pd.Timestamp("2025-08-09", tz="UTC"),
                pd.Timestamp("2025-11-07", tz="UTC"),
                pd.Timestamp("2026-02-07", tz="UTC"),
            ]),
        )
    else:
        m.calendar = {}
        m.dividends = pd.Series([], dtype=float)
    return m


def test_calendar_returns_earnings_event(tmp_path):
    with patch("routers.calendar.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("routers.calendar.yf.Ticker", side_effect=_mock_ticker), \
         patch("routers.calendar._CACHE_DIR", tmp_path):
        resp = client.get("/api/calendar?month=2026-05")
    assert resp.status_code == 200
    events = resp.json()["events"]
    earnings = [e for e in events if e["type"] == "earnings"]
    assert len(earnings) == 1
    assert earnings[0]["ticker"] == "AAPL"
    assert earnings[0]["date"] == "2026-05-20"
    assert earnings[0]["stock_type"] == "holding"


def test_calendar_returns_dividend_event(tmp_path):
    # AAPL: last div 2026-02-07, avg interval ~91 days → next ~2026-05-09 (in May)
    with patch("routers.calendar.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("routers.calendar.yf.Ticker", side_effect=_mock_ticker), \
         patch("routers.calendar._CACHE_DIR", tmp_path):
        resp = client.get("/api/calendar?month=2026-05")
    events = resp.json()["events"]
    divs = [e for e in events if e["type"] == "dividend"]
    assert len(divs) == 1
    assert divs[0]["ticker"] == "AAPL"
    assert divs[0]["stock_type"] == "holding"


def test_calendar_empty_for_ticker_with_no_data():
    with patch("routers.calendar.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("routers.calendar.yf.Ticker", side_effect=_mock_ticker):
        resp = client.get("/api/calendar?month=2026-07")
    assert resp.status_code == 200
    assert resp.json()["events"] == []


def test_calendar_invalid_month_returns_422():
    resp = client.get("/api/calendar?month=not-a-month")
    assert resp.status_code == 422


def test_calendar_tsla_watchlist_stock_type(tmp_path):
    portfolio = {
        "stocks": [],
        "watchlist": [{"ticker": "TSLA", "type": "watchlist", "name": "Tesla"}],
    }
    mock = MagicMock()
    mock.calendar = {"Earnings Date": [date(2026, 5, 15)]}
    mock.dividends = pd.Series([], dtype=float)
    with patch("routers.calendar._CACHE_DIR", tmp_path), \
         patch("routers.calendar.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.calendar.yf.Ticker", return_value=mock):
        resp = client.get("/api/calendar?month=2026-05")
    events = resp.json()["events"]
    assert events[0]["stock_type"] == "watchlist"

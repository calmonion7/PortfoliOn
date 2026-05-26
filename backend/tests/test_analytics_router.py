import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import pandas as pd
import numpy as np

from routers.analytics import router
from auth import get_current_user

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
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

    with patch("routers.analytics.storage.get_holdings", return_value=portfolio["stocks"]), \
         patch("routers.analytics.yf.Ticker", side_effect=mock_ticker), \
         patch("routers.analytics.cache_svc.get_correlation", side_effect=lambda user_id, loader: loader()):
        resp = client.get("/api/analytics/correlation")

    assert resp.status_code == 200
    data = resp.json()
    assert set(data["tickers"]) == {"AAPL", "MSFT"}
    assert len(data["matrix"]) == 2
    assert len(data["matrix"][0]) == 2
    idx = data["tickers"].index("AAPL")
    assert data["matrix"][idx][idx] == 1.0


def test_correlation_returns_empty_for_single_holding():
    portfolio = {
        "stocks": [{"ticker": "AAPL", "market": "US", "exchange": ""}],
        "watchlist": [],
    }
    with patch("routers.analytics.storage.get_holdings", return_value=portfolio["stocks"]), \
         patch("routers.analytics.cache_svc.get_correlation", side_effect=lambda user_id, loader: loader()):
        resp = client.get("/api/analytics/correlation")
    assert resp.status_code == 200
    assert resp.json() == {"tickers": [], "matrix": []}


def test_correlation_returns_empty_for_no_holdings():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("routers.analytics.storage.get_holdings", return_value=portfolio["stocks"]), \
         patch("routers.analytics.cache_svc.get_correlation", side_effect=lambda user_id, loader: loader()):
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
    bad_mock.history.return_value = pd.DataFrame({"Close": [100.0] * 5})

    def mock_ticker(sym):
        if "AAPL" in sym:
            return _make_hist(0)
        if "MSFT" in sym:
            return _make_hist(1)
        return bad_mock

    with patch("routers.analytics.storage.get_holdings", return_value=portfolio["stocks"]), \
         patch("routers.analytics.yf.Ticker", side_effect=mock_ticker), \
         patch("routers.analytics.cache_svc.get_correlation", side_effect=lambda user_id, loader: loader()):
        resp = client.get("/api/analytics/correlation")

    assert resp.status_code == 200
    data = resp.json()
    assert "BAD" not in data["tickers"]
    assert set(data["tickers"]) == {"AAPL", "MSFT"}

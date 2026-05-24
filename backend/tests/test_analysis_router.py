# backend/tests/test_analysis_router.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import pandas as pd
import numpy as np

from routers.analysis import router
from auth import get_current_user

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
client = TestClient(app)


def _make_hist(seed: int, n: int = 70) -> MagicMock:
    rng = np.random.default_rng(seed)
    closes = 100.0 + np.cumsum(rng.standard_normal(n))
    dates = pd.date_range(end=pd.Timestamp("2026-05-24"), periods=n, freq="B")
    mock = MagicMock()
    mock.history.return_value = pd.DataFrame({"Close": closes}, index=dates)
    return mock


def test_sector_returns_11_etfs():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("services.analysis_service.yf.Ticker", return_value=_make_hist(0)), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_sector", side_effect=lambda loader: loader()):
        resp = client.get("/api/analysis/sector")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["sectors"]) == 11
    etfs = [s["etf"] for s in data["sectors"]]
    for etf in ["XLK", "XLF", "XLV", "XLE", "XLI", "XLY", "XLP", "XLB", "XLU", "XLRE", "XLC"]:
        assert etf in etfs


def test_sector_includes_return_fields():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("services.analysis_service.yf.Ticker", return_value=_make_hist(0)), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_sector", side_effect=lambda loader: loader()):
        resp = client.get("/api/analysis/sector")
    s = resp.json()["sectors"][0]
    assert "return_1w" in s
    assert "return_1mo" in s
    assert "return_3mo" in s
    assert s["return_1w"] is not None
    assert s["return_1mo"] is not None
    assert s["return_3mo"] is not None


def test_sector_portfolio_overlay():
    portfolio = {
        "stocks": [{"ticker": "AAPL", "sector": "Technology", "quantity": 5}],
        "watchlist": [],
    }
    with patch("services.analysis_service.yf.Ticker", return_value=_make_hist(0)), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_sector", side_effect=lambda loader: loader()):
        resp = client.get("/api/analysis/sector")
    assert resp.json()["portfolio_sectors"]["AAPL"] == "Technology"


def test_macro_returns_four_correlations():
    portfolio = {
        "stocks": [
            {"ticker": "AAPL", "market": "US", "exchange": "", "quantity": 5},
            {"ticker": "MSFT", "market": "US", "exchange": "", "quantity": 3},
        ],
        "watchlist": [],
    }
    def mock_ticker(sym):
        return _make_hist(abs(hash(sym)) % 97)
    with patch("services.analysis_service.yf.Ticker", side_effect=mock_ticker), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_macro", side_effect=lambda loader: loader()):
        resp = client.get("/api/analysis/macro-correlation")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["correlations"]) == 4
    tickers = [c["ticker"] for c in data["correlations"]]
    assert "TLT" in tickers
    assert "^VIX" in tickers


def test_macro_empty_for_no_holdings():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_macro", side_effect=lambda loader: loader()):
        resp = client.get("/api/analysis/macro-correlation")
    assert resp.status_code == 200
    assert resp.json() == {"correlations": [], "scatter": []}


def test_macro_scatter_contains_indicator_field():
    portfolio = {
        "stocks": [{"ticker": "AAPL", "market": "US", "exchange": "", "quantity": 10}],
        "watchlist": [],
    }
    def mock_ticker(sym):
        return _make_hist(abs(hash(sym)) % 97)
    with patch("services.analysis_service.yf.Ticker", side_effect=mock_ticker), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_macro", side_effect=lambda loader: loader()):
        resp = client.get("/api/analysis/macro-correlation")
    scatter = resp.json()["scatter"]
    if scatter:
        assert "indicator" in scatter[0]
        assert "macro_delta" in scatter[0]
        assert "portfolio_return" in scatter[0]

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.portfolio import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)

SAMPLE_STOCKS = [
    {"ticker": "NFLX", "name": "Netflix", "competitors": ["DIS"], "moat": "Content", "growth_plan": "Gaming"}
]
SAMPLE_HOLDINGS = [
    {"ticker": "NFLX", "quantity": 10, "avg_cost": 85.59}
]
SAMPLE_FULL = {
    "stocks": [{"ticker": "NFLX", "name": "Netflix", "quantity": 10, "avg_cost": 85.59,
                "competitors": ["DIS"], "moat": "Content", "growth_plan": "Gaming"}],
    "watchlist": []
}


def test_get_portfolio_returns_full_portfolio():
    with patch("routers.portfolio.storage.get_full_portfolio", return_value=SAMPLE_FULL):
        resp = client.get("/api/portfolio")
    assert resp.status_code == 200
    assert resp.json()["stocks"][0]["ticker"] == "NFLX"


def test_add_stock_saves_to_holdings_and_stocks():
    with patch("routers.portfolio.storage.get_holdings", return_value=[]), \
         patch("routers.portfolio.storage.get_stocks", return_value=[]), \
         patch("routers.portfolio.storage.save_stocks") as mock_save_stocks, \
         patch("routers.portfolio.storage.save_holdings") as mock_save_holdings:
        resp = client.post("/api/portfolio", json={
            "ticker": "NVDA", "name": "Nvidia", "quantity": 5, "avg_cost": 200.0,
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 201
    saved_holdings = mock_save_holdings.call_args[0][0]
    assert saved_holdings[0]["ticker"] == "NVDA"
    assert saved_holdings[0]["quantity"] == 5
    saved_stocks = mock_save_stocks.call_args[0][0]
    assert saved_stocks[0]["ticker"] == "NVDA"


def test_add_duplicate_ticker_returns_400():
    with patch("routers.portfolio.storage.get_holdings", return_value=SAMPLE_HOLDINGS):
        resp = client.post("/api/portfolio", json={
            "ticker": "NFLX", "name": "Netflix", "quantity": 5, "avg_cost": 90.0,
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 400


def test_update_stock_modifies_holdings_and_stocks():
    with patch("routers.portfolio.storage.get_holdings", return_value=list(SAMPLE_HOLDINGS)), \
         patch("routers.portfolio.storage.get_stocks", return_value=list(SAMPLE_STOCKS)), \
         patch("routers.portfolio.storage.save_holdings") as mock_save_holdings, \
         patch("routers.portfolio.storage.save_stocks") as mock_save_stocks:
        resp = client.put("/api/portfolio/NFLX", json={
            "ticker": "NFLX", "name": "Netflix", "quantity": 20, "avg_cost": 90.0,
            "competitors": ["DIS"], "moat": "Brand", "growth_plan": "Gaming"
        })
    assert resp.status_code == 200
    saved_holdings = mock_save_holdings.call_args[0][0]
    assert saved_holdings[0]["quantity"] == 20
    saved_stocks = mock_save_stocks.call_args[0][0]
    assert saved_stocks[0]["moat"] == "Brand"


def test_delete_stock_removes_from_holdings_and_adds_to_watchlist():
    with patch("routers.portfolio.storage.get_holdings", return_value=list(SAMPLE_HOLDINGS)), \
         patch("routers.portfolio.storage.get_watchlist_tickers", return_value=[]), \
         patch("routers.portfolio.storage.save_holdings") as mock_save_holdings, \
         patch("routers.portfolio.storage.save_watchlist_tickers") as mock_save_watchlist:
        resp = client.delete("/api/portfolio/NFLX")
    assert resp.status_code == 200
    assert mock_save_holdings.call_args[0][0] == []
    assert "NFLX" in mock_save_watchlist.call_args[0][0]


def test_delete_stock_keeps_stock_data_when_in_watchlist():
    with patch("routers.portfolio.storage.get_holdings", return_value=list(SAMPLE_HOLDINGS)), \
         patch("routers.portfolio.storage.get_watchlist_tickers", return_value=["NFLX"]), \
         patch("routers.portfolio.storage.save_holdings"), \
         patch("routers.portfolio.storage.save_stocks") as mock_save_stocks:
        resp = client.delete("/api/portfolio/NFLX")
    assert resp.status_code == 200
    mock_save_stocks.assert_not_called()


def test_delete_nonexistent_ticker_returns_404():
    with patch("routers.portfolio.storage.get_holdings", return_value=[]):
        resp = client.delete("/api/portfolio/FAKE")
    assert resp.status_code == 404

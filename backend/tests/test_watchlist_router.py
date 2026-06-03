from copy import deepcopy
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.watchlist import router
from auth import get_current_user

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
client = TestClient(app)

SAMPLE_STOCKS = [
    {"ticker": "NFLX", "name": "Netflix", "competitors": [], "moat": "", "growth_plan": ""},
    {"ticker": "NVDA", "name": "Nvidia", "competitors": [], "moat": "", "growth_plan": ""},
]
SAMPLE_HOLDINGS = [{"ticker": "NFLX", "quantity": 10, "avg_cost": 85.59}]
SAMPLE_WATCHLIST = ["NVDA"]


def test_get_watchlist_returns_items():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=SAMPLE_WATCHLIST), \
         patch("routers.watchlist.storage.get_stocks", return_value=SAMPLE_STOCKS):
        resp = client.get("/api/watchlist")
    assert resp.status_code == 200
    assert resp.json()[0]["ticker"] == "NVDA"
    assert resp.json()[0]["name"] == "Nvidia"


def test_add_watchlist_stock_saves_ticker_and_stock_data():
    with patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.get_watchlist_tickers", return_value=[]), \
         patch("routers.watchlist.storage.get_stocks", return_value=[]), \
         patch("routers.watchlist.storage.save_stocks") as mock_save_stocks, \
         patch("routers.watchlist.storage.save_watchlist_tickers") as mock_save_watchlist, \
         patch("routers.watchlist.storage.get_schedule", return_value={}), \
         patch("routers.watchlist.db_query", return_value=[]):
        resp = client.post("/api/watchlist", json={
            "ticker": "TSLA", "name": "Tesla",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 201
    saved_tickers = mock_save_watchlist.call_args[0][1]
    assert "TSLA" in saved_tickers
    saved_stocks = mock_save_stocks.call_args[0][1]
    assert saved_stocks[0]["ticker"] == "TSLA"


def test_add_duplicate_in_holdings_returns_400():
    with patch("routers.watchlist.storage.get_holdings", return_value=SAMPLE_HOLDINGS), \
         patch("routers.watchlist.storage.get_watchlist_tickers", return_value=[]):
        resp = client.post("/api/watchlist", json={
            "ticker": "NFLX", "name": "Netflix",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 400


def test_add_duplicate_in_watchlist_returns_400():
    with patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.get_watchlist_tickers", return_value=SAMPLE_WATCHLIST):
        resp = client.post("/api/watchlist", json={
            "ticker": "NVDA", "name": "Nvidia",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 400


def test_update_watchlist_stock_updates_stocks_json():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=["NVDA"]), \
         patch("routers.watchlist.storage.get_stocks", return_value=[
             {"ticker": "NVDA", "name": "Nvidia", "competitors": [], "moat": "", "growth_plan": ""}
         ]), \
         patch("routers.watchlist.storage.save_stocks") as mock_save_stocks:
        resp = client.put("/api/watchlist/NVDA", json={
            "ticker": "NVDA", "name": "Nvidia",
            "competitors": ["AMD"], "moat": "GPU dominance", "growth_plan": "AI chips"
        })
    assert resp.status_code == 200
    saved = mock_save_stocks.call_args[0][1]
    assert saved[0]["moat"] == "GPU dominance"


def test_delete_watchlist_removes_from_watchlist_and_stocks():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=["NVDA"]), \
         patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.save_watchlist_tickers") as mock_save_watchlist:
        resp = client.delete("/api/watchlist/NVDA")
    assert resp.status_code == 200
    assert mock_save_watchlist.call_args[0][1] == []


def test_delete_watchlist_keeps_stock_data_when_in_holdings():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=["NFLX"]), \
         patch("routers.watchlist.storage.get_holdings", return_value=SAMPLE_HOLDINGS), \
         patch("routers.watchlist.storage.save_watchlist_tickers"), \
         patch("routers.watchlist.storage.save_stocks") as mock_save_stocks:
        resp = client.delete("/api/watchlist/NFLX")
    assert resp.status_code == 200
    mock_save_stocks.assert_not_called()


def test_delete_nonexistent_returns_404():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=[]):
        resp = client.delete("/api/watchlist/FAKE")
    assert resp.status_code == 404


def test_promote_moves_ticker_to_holdings():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=["NVDA"]), \
         patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.get_stocks", return_value=[
             {"ticker": "NVDA", "name": "Nvidia", "competitors": ["AMD"], "moat": "GPU", "growth_plan": "AI"}
         ]), \
         patch("routers.watchlist.storage.save_watchlist_tickers") as mock_save_watchlist, \
         patch("routers.watchlist.storage.save_holdings") as mock_save_holdings:
        resp = client.post("/api/watchlist/NVDA/promote",
                           json={"quantity": 5, "avg_cost": 200.0})
    assert resp.status_code == 200
    saved_watchlist = mock_save_watchlist.call_args[0][1]
    assert "NVDA" not in saved_watchlist
    saved_holdings = mock_save_holdings.call_args[0][1]
    assert saved_holdings[0]["ticker"] == "NVDA"
    assert saved_holdings[0]["quantity"] == 5
    assert saved_holdings[0]["avg_cost"] == 200.0
    assert resp.json()["moat"] == "GPU"


def test_promote_nonexistent_returns_404():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=[]):
        resp = client.post("/api/watchlist/FAKE/promote",
                           json={"quantity": 1, "avg_cost": 100.0})
    assert resp.status_code == 404


def test_promote_already_in_holdings_returns_400():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=["NVDA"]), \
         patch("routers.watchlist.storage.get_holdings", return_value=[
             {"ticker": "NVDA", "quantity": 1, "avg_cost": 100.0}
         ]):
        resp = client.post("/api/watchlist/NVDA/promote",
                           json={"quantity": 5, "avg_cost": 200.0})
    assert resp.status_code == 400


def test_promote_invalidates_dashboard_cache():
    with patch("routers.watchlist.cache_svc") as mock_cache, \
         patch("routers.watchlist.storage.get_watchlist_tickers", return_value=["NVDA"]), \
         patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.get_stocks", return_value=[
             {"ticker": "NVDA", "name": "Nvidia", "market": "US", "exchange": ""}
         ]), \
         patch("routers.watchlist.storage.save_watchlist_tickers"), \
         patch("routers.watchlist.storage.save_holdings"), \
         patch("routers.watchlist.calendar_router.clear_cache"):
        resp = client.post("/api/watchlist/NVDA/promote", json={"quantity": 10, "avg_cost": 500.0})
    assert resp.status_code == 200
    mock_cache.invalidate_portfolio_caches.assert_called_once()


def test_add_watchlist_stock_triggers_report_when_no_snapshot():
    with patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.get_watchlist_tickers", return_value=[]), \
         patch("routers.watchlist.storage.get_stocks", return_value=[]), \
         patch("routers.watchlist.storage.save_stocks"), \
         patch("routers.watchlist.storage.save_watchlist_tickers"), \
         patch("routers.watchlist.storage.get_schedule", return_value={}), \
         patch("routers.watchlist.calendar_router.clear_cache"), \
         patch("routers.watchlist.db_query", return_value=[]) as mock_query, \
         patch("routers.watchlist.report_generator.generate_report") as mock_gen:
        resp = client.post("/api/watchlist", json={
            "ticker": "TSLA", "name": "Tesla",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 201
    assert mock_query.call_count >= 1
    call_args = mock_query.call_args
    assert "snapshots" in call_args[0][0]
    assert "TSLA" in call_args[0][1]
    mock_gen.assert_called_once()


def test_add_watchlist_stock_skips_report_when_snapshot_exists():
    with patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.get_watchlist_tickers", return_value=[]), \
         patch("routers.watchlist.storage.get_stocks", return_value=[]), \
         patch("routers.watchlist.storage.save_stocks"), \
         patch("routers.watchlist.storage.save_watchlist_tickers"), \
         patch("routers.watchlist.storage.get_schedule", return_value={}), \
         patch("routers.watchlist.calendar_router.clear_cache"), \
         patch("routers.watchlist.db_query", return_value=[{"ticker": "TSLA", "date": "2026-05-01"}]), \
         patch("routers.watchlist.report_generator.generate_report") as mock_gen:
        resp = client.post("/api/watchlist", json={
            "ticker": "TSLA", "name": "Tesla",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 201
    mock_gen.assert_not_called()

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.watchlist import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)

SAMPLE_PORTFOLIO = {
    "stocks": [
        {"ticker": "NFLX", "name": "Netflix", "quantity": 10, "avg_cost": 85.59,
         "competitors": [], "moat": "", "growth_plan": ""}
    ],
    "watchlist": [
        {"ticker": "NVDA", "name": "Nvidia", "competitors": [], "moat": "", "growth_plan": ""}
    ]
}

def test_get_watchlist_returns_items():
    with patch("routers.watchlist.storage.get_portfolio", return_value=SAMPLE_PORTFOLIO):
        resp = client.get("/api/watchlist")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["ticker"] == "NVDA"

def test_add_watchlist_stock():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("routers.watchlist.storage.get_portfolio", return_value=portfolio), \
         patch("routers.watchlist.storage.save_portfolio") as mock_save:
        resp = client.post("/api/watchlist", json={
            "ticker": "TSLA", "name": "Tesla",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 201
    saved = mock_save.call_args[0][0]
    assert saved["watchlist"][0]["ticker"] == "TSLA"

def test_add_duplicate_in_stocks_returns_400():
    with patch("routers.watchlist.storage.get_portfolio", return_value=SAMPLE_PORTFOLIO):
        resp = client.post("/api/watchlist", json={
            "ticker": "NFLX", "name": "Netflix",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 400

def test_add_duplicate_in_watchlist_returns_400():
    with patch("routers.watchlist.storage.get_portfolio", return_value=SAMPLE_PORTFOLIO):
        resp = client.post("/api/watchlist", json={
            "ticker": "NVDA", "name": "Nvidia",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 400

def test_update_watchlist_stock():
    portfolio = {"stocks": [], "watchlist": [
        {"ticker": "NVDA", "name": "Nvidia", "competitors": [], "moat": "", "growth_plan": ""}
    ]}
    with patch("routers.watchlist.storage.get_portfolio", return_value=portfolio), \
         patch("routers.watchlist.storage.save_portfolio") as mock_save:
        resp = client.put("/api/watchlist/NVDA", json={
            "ticker": "NVDA", "name": "Nvidia",
            "competitors": ["AMD"], "moat": "GPU dominance", "growth_plan": "AI chips"
        })
    assert resp.status_code == 200
    saved = mock_save.call_args[0][0]
    assert saved["watchlist"][0]["moat"] == "GPU dominance"

def test_delete_watchlist_stock():
    portfolio = {"stocks": [], "watchlist": [
        {"ticker": "NVDA", "name": "Nvidia", "competitors": [], "moat": "", "growth_plan": ""}
    ]}
    with patch("routers.watchlist.storage.get_portfolio", return_value=portfolio), \
         patch("routers.watchlist.storage.save_portfolio") as mock_save:
        resp = client.delete("/api/watchlist/NVDA")
    assert resp.status_code == 200
    saved = mock_save.call_args[0][0]
    assert saved["watchlist"] == []

def test_delete_nonexistent_returns_404():
    with patch("routers.watchlist.storage.get_portfolio",
               return_value={"stocks": [], "watchlist": []}):
        resp = client.delete("/api/watchlist/FAKE")
    assert resp.status_code == 404

def test_promote_moves_to_stocks():
    portfolio = {"stocks": [], "watchlist": [
        {"ticker": "NVDA", "name": "Nvidia", "competitors": ["AMD"], "moat": "GPU", "growth_plan": "AI"}
    ]}
    with patch("routers.watchlist.storage.get_portfolio", return_value=portfolio), \
         patch("routers.watchlist.storage.save_portfolio") as mock_save:
        resp = client.post("/api/watchlist/NVDA/promote",
                           json={"quantity": 5, "avg_cost": 200.0})
    assert resp.status_code == 200
    saved = mock_save.call_args[0][0]
    assert saved["watchlist"] == []
    assert saved["stocks"][0]["ticker"] == "NVDA"
    assert saved["stocks"][0]["quantity"] == 5
    assert saved["stocks"][0]["avg_cost"] == 200.0
    assert saved["stocks"][0]["moat"] == "GPU"

def test_promote_nonexistent_returns_404():
    with patch("routers.watchlist.storage.get_portfolio",
               return_value={"stocks": [], "watchlist": []}):
        resp = client.post("/api/watchlist/FAKE/promote",
                           json={"quantity": 1, "avg_cost": 100.0})
    assert resp.status_code == 404

def test_promote_already_in_stocks_returns_400():
    portfolio = {
        "stocks": [{"ticker": "NVDA", "name": "Nvidia", "quantity": 1, "avg_cost": 100.0,
                    "competitors": [], "moat": "", "growth_plan": ""}],
        "watchlist": [{"ticker": "NVDA", "name": "Nvidia", "competitors": [], "moat": "", "growth_plan": ""}]
    }
    with patch("routers.watchlist.storage.get_portfolio", return_value=portfolio):
        resp = client.post("/api/watchlist/NVDA/promote",
                           json={"quantity": 5, "avg_cost": 200.0})
    assert resp.status_code == 400

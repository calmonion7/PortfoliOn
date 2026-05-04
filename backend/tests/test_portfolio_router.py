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

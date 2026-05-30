from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from routers.stocks import router
from auth import get_current_user


app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
client = TestClient(app)

SAMPLE_PORTFOLIO = {
    "stocks": [
        {"ticker": "LLY", "name": "일라이 릴리", "quantity": 3.0, "avg_cost": 886.6,
         "competitors": ["NVO"], "moat": "", "growth_plan": "", "recent_disclosures": ""}
    ],
    "watchlist": [
        {"ticker": "AVAV", "name": "에어로바이런먼트", "competitors": [], "moat": "", "growth_plan": "", "recent_disclosures": ""}
    ],
}


def test_get_stocks_returns_flat_list_with_type():
    with patch("routers.stocks.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO):
        resp = client.get("/api/stocks")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    holding = next(s for s in data if s["ticker"] == "LLY")
    watchlist = next(s for s in data if s["ticker"] == "AVAV")
    assert holding["type"] == "holding"
    assert watchlist["type"] == "watchlist"
    assert holding["name"] == "일라이 릴리"


def test_enrich_single_stock_returns_updated_fields():
    with patch("routers.stocks.storage.enrich_stock", return_value=True):
        resp = client.put("/api/stocks/LLY/enrich", json={
            "moat": "특허 포트폴리오",
            "growth_plan": "GLP 확장",
        })
    assert resp.status_code == 200
    body = resp.json()
    assert body["ticker"] == "LLY"
    assert set(body["updated"]) == {"moat", "growth_plan"}


def test_enrich_single_stock_returns_404_when_not_found():
    with patch("routers.stocks.storage.enrich_stock", return_value=False):
        resp = client.put("/api/stocks/FAKE/enrich", json={"moat": "x"})
    assert resp.status_code == 404


def test_enrich_single_stock_returns_400_when_no_fields():
    resp = client.put("/api/stocks/LLY/enrich", json={})
    assert resp.status_code == 400


def test_enrich_batch_returns_updated_and_not_found():
    def mock_enrich(ticker, fields):
        return ticker.upper() != "FAKE"

    with patch("routers.stocks.storage.enrich_stock", side_effect=mock_enrich):
        resp = client.put("/api/stocks/enrich/batch", json=[
            {"ticker": "LLY", "moat": "특허"},
            {"ticker": "FAKE", "moat": "x"},
        ])
    assert resp.status_code == 200
    body = resp.json()
    assert "LLY" in body["updated"]
    assert "FAKE" in body["not_found"]


def test_enrich_batch_returns_400_when_empty():
    resp = client.put("/api/stocks/enrich/batch", json=[])
    assert resp.status_code == 400


def test_enrich_batch_item_with_no_fields_appears_in_not_found():
    with patch("routers.stocks.storage.enrich_stock", return_value=True):
        resp = client.put("/api/stocks/enrich/batch", json=[
            {"ticker": "LLY"},
        ])
    assert resp.status_code == 200
    body = resp.json()
    assert "LLY" in body["not_found"]
    assert "LLY" not in body["updated"]


def test_enrich_single_stock_with_competitors():
    captured = {}

    def mock_enrich(ticker, fields):
        captured.update(fields)
        return True

    with patch("routers.stocks.storage.enrich_stock", side_effect=mock_enrich):
        resp = client.put("/api/stocks/LLY/enrich", json={"competitors": ["NVO", "AZN"]})
    assert resp.status_code == 200
    assert captured["competitors"] == ["NVO", "AZN"]


def test_enrich_batch_with_competitors():
    captured = {}

    def mock_enrich(ticker, fields):
        captured[ticker.upper()] = fields
        return True

    with patch("routers.stocks.storage.enrich_stock", side_effect=mock_enrich):
        resp = client.put("/api/stocks/enrich/batch", json=[
            {"ticker": "LLY", "competitors": ["NVO"]},
        ])
    assert resp.status_code == 200
    assert resp.json()["updated"] == ["LLY"]
    assert captured["LLY"]["competitors"] == ["NVO"]


def test_dashboard_returns_cards_for_holdings():
    portfolio = {
        "stocks": [
            {"ticker": "AAPL", "name": "Apple Inc.", "market": "US",
             "avg_cost": 150.0, "quantity": 10, "exchange": ""},
        ],
        "watchlist": [
            {"ticker": "TSLA", "name": "Tesla", "market": "US",
             "avg_cost": None, "quantity": None, "exchange": ""},
        ]
    }
    quote = {
        "ticker": "AAPL", "price": 185.2,
        "daily_change_pct": 1.4, "weekly_change_pct": 2.1, "monthly_change_pct": 5.8,
        "name": "Apple Inc.", "market": "US",
    }
    from pathlib import Path
    with patch("routers.stocks.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.stocks.market.get_quote", return_value=quote), \
         patch("routers.stocks.SNAPSHOTS_DIR", Path("/nonexistent")), \
         patch("routers.stocks.REPORTS_DIR", Path("/nonexistent")), \
         patch("routers.stocks.query", return_value=[]):
        resp = client.get("/api/stocks/dashboard")
    assert resp.status_code == 200
    data = resp.json()
    # watchlist excluded — only holdings
    assert len(data) == 1
    card = data[0]
    assert card["ticker"] == "AAPL"
    assert card["current_price"] == 185.2
    assert card["daily_change_pct"] == 1.4
    assert card["weekly_change_pct"] == 2.1
    assert card["monthly_change_pct"] == 5.8
    assert card["rsi"] is None      # no snapshot
    assert card["target_mean"] is None


def test_dashboard_returns_empty_list_when_no_holdings():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("routers.stocks.storage.get_full_portfolio", return_value=portfolio):
        resp = client.get("/api/stocks/dashboard")
    assert resp.status_code == 200
    assert resp.json() == []


def test_dashboard_card_includes_sector():
    import services.cache as cache_svc
    cache_svc.invalidate_dashboard()
    portfolio = {
        "stocks": [
            {"ticker": "AAPL", "name": "Apple Inc.", "market": "US",
             "avg_cost": 150.0, "quantity": 10, "exchange": ""},
        ],
        "watchlist": []
    }
    quote = {
        "ticker": "AAPL", "price": 185.2,
        "daily_change_pct": 1.4, "weekly_change_pct": 2.1, "monthly_change_pct": 5.8,
        "name": "Apple Inc.", "market": "US",
        "sector": "Technology", "industry": "Consumer Electronics",
    }
    from pathlib import Path
    with patch("routers.stocks.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.stocks.market.get_quote", return_value=quote), \
         patch("routers.stocks.SNAPSHOTS_DIR", Path("/nonexistent")), \
         patch("routers.stocks.REPORTS_DIR", Path("/nonexistent")):
        resp = client.get("/api/stocks/dashboard")
    assert resp.status_code == 200
    card = resp.json()[0]
    assert card["sector"] == "Technology"

import pytest
from pydantic import ValidationError
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.utils import is_valid_ticker
from routers.portfolio import Stock, router as portfolio_router
from routers.watchlist import WatchlistStock
from auth import get_current_user

VALID = ["AAPL", "005930", "BRK.B", "BRK-B", "aapl", " AAPL "]
INVALID = ["AAPL MSFT NVDA", "", "   ", "A" * 16, "AAPL,MSFT", "AA@PL"]


@pytest.mark.parametrize("t", VALID)
def test_is_valid_ticker_accepts(t):
    assert is_valid_ticker(t) is True


@pytest.mark.parametrize("t", INVALID)
def test_is_valid_ticker_rejects(t):
    assert is_valid_ticker(t) is False


def test_stock_validator_normalizes_and_accepts():
    s = Stock(ticker=" brk.b ", name="x", quantity=1, avg_cost=1)
    assert s.ticker == "BRK.B"


@pytest.mark.parametrize("t", INVALID)
def test_stock_validator_rejects(t):
    with pytest.raises(ValidationError):
        Stock(ticker=t, name="x", quantity=1, avg_cost=1)


def test_watchlist_validator_normalizes_and_accepts():
    w = WatchlistStock(ticker="  005930  ", name="x")
    assert w.ticker == "005930"


@pytest.mark.parametrize("t", INVALID)
def test_watchlist_validator_rejects(t):
    with pytest.raises(ValidationError):
        WatchlistStock(ticker=t, name="x")


def test_post_portfolio_invalid_ticker_returns_422():
    app = FastAPI()
    app.include_router(portfolio_router)
    app.dependency_overrides[get_current_user] = lambda: "test-user-id"
    client = TestClient(app)
    resp = client.post("/api/portfolio", json={
        "ticker": "AAPL MSFT NVDA", "name": "x", "quantity": 1, "avg_cost": 1,
        "competitors": [], "moat": "", "growth_plan": ""
    })
    assert resp.status_code == 422

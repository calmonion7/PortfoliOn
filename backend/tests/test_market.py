import pytest
from unittest.mock import patch, MagicMock
import pandas as pd

def _make_mock_ticker(price=150.0, market_cap=100_000_000_000, prev_close=148.0):
    mock = MagicMock()
    mock.info = {
        "currentPrice": price,
        "marketCap": market_cap,
        "shortName": "Test Corp",
    }
    import numpy as np
    dates = pd.date_range("2026-01-02", periods=100, freq="B")
    closes = [prev_close] + [price] * 99
    mock.history.return_value = pd.DataFrame(
        {"Close": closes, "High": [c + 2 for c in closes], "Low": [c - 2 for c in closes]},
        index=dates,
    )
    # quarterly_income_stmt: index=dates, columns=["Total Revenue","Operating Income"]
    q_dates = pd.date_range("2025-12-31", periods=4, freq="-1QE")
    mock.quarterly_income_stmt = pd.DataFrame(
        {"Total Revenue": [10e9, 9.5e9, 9e9, 8.5e9],
         "Operating Income": [2e9, 1.9e9, 1.8e9, 1.7e9]},
        index=q_dates,
    ).T
    mock.analyst_price_targets = {"mean": 180.0, "high": 220.0, "low": 140.0}
    mock.recommendations_summary = pd.DataFrame(
        [{"period": "0m", "strongBuy": 5, "buy": 10, "hold": 8, "sell": 2, "strongSell": 1}]
    )
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
        import importlib; importlib.reload(market)
        result = market.get_financials("TEST")
    assert len(result) == 4
    assert "period" in result[0]
    assert "revenue" in result[0]
    assert "operating_income" in result[0]

def test_get_analyst_data_returns_consensus():
    with patch("services.market.yf.Ticker", return_value=_make_mock_ticker()):
        from services import market
        import importlib; importlib.reload(market)
        result = market.get_analyst_data("TEST")
    assert result["target_mean"] == 180.0
    assert result["buy"] == 15   # strongBuy(5) + buy(10)
    assert result["hold"] == 8
    assert result["sell"] == 3   # sell(2) + strongSell(1)

def test_get_quote_handles_exception_gracefully():
    mock = MagicMock()
    mock.info = {}
    mock.history.side_effect = Exception("API error")
    with patch("services.market.yf.Ticker", return_value=mock):
        from services import market
        import importlib; importlib.reload(market)
        result = market.get_quote("FAIL")
    assert result["ticker"] == "FAIL"
    assert result["price"] is None
    assert "error" in result

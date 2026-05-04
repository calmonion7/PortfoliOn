import pytest
import pandas as pd
import numpy as np
from unittest.mock import patch, MagicMock

def _make_price_series(n=60, start=100.0, trend=0.5):
    np.random.seed(42)
    prices = [start]
    for _ in range(n - 1):
        prices.append(prices[-1] + trend + np.random.randn() * 2)
    return pd.Series(prices, dtype=float)

def test_calc_rsi_values_in_0_to_100_range():
    from services.indicators import calc_rsi
    prices = _make_price_series(60)
    rsi = calc_rsi(prices)
    valid = rsi.dropna()
    assert len(valid) > 0
    assert (valid >= 0).all() and (valid <= 100).all()

def test_calc_rsi_oversold_on_declining_prices():
    from services.indicators import calc_rsi
    declining = pd.Series([100 - i * 2 for i in range(50)], dtype=float)
    rsi = calc_rsi(declining)
    assert rsi.dropna().iloc[-1] < 30

def test_calc_ema_has_correct_length():
    from services.indicators import calc_ema
    prices = _make_price_series(50)
    ema = calc_ema(prices, 20)
    assert len(ema) == len(prices)
    assert not ema.isna().all()

def test_get_support_resistance_returns_required_keys():
    from services.indicators import get_support_resistance
    prices = _make_price_series(260)
    df = pd.DataFrame({
        "Close": prices,
        "High": prices + 1,
        "Low": prices - 1,
    })
    result = get_support_resistance(df)
    assert "week52_high" in result
    assert "week52_low" in result
    assert "ema20" in result
    assert "ema50" in result
    assert "ema200" in result
    assert result["week52_high"] >= result["week52_low"]

def test_calc_rsi_target_price_returns_float():
    from services.indicators import calc_rsi, calc_rsi_target_price
    prices = _make_price_series(60)
    rsi = calc_rsi(prices)
    result = calc_rsi_target_price(prices, rsi, 30.0)
    assert result is not None
    assert isinstance(result, float)

def test_get_timeframe_rsi_returns_all_timeframes():
    mock_ticker = MagicMock()
    df = pd.DataFrame({
        "Close": _make_price_series(100),
        "High": _make_price_series(100) + 1,
        "Low": _make_price_series(100) - 1,
    })
    mock_ticker.history.return_value = df
    with patch("services.indicators.yf.Ticker", return_value=mock_ticker):
        from services import indicators
        import importlib; importlib.reload(indicators)
        result = indicators.get_timeframe_rsi("TEST")
    assert "daily" in result
    assert "weekly" in result
    assert "monthly" in result
    for tf in ["daily", "weekly", "monthly"]:
        assert "rsi" in result[tf]
        assert "target_30" in result[tf]
        assert "target_70" in result[tf]

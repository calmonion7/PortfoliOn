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
    # get_timeframe_rsi는 이제 market.get_history_df로 라우팅(KR=키움/그외=yfinance).
    df = pd.DataFrame({
        "Close": _make_price_series(100),
        "High": _make_price_series(100) + 1,
        "Low": _make_price_series(100) - 1,
    })
    with patch("services.market.get_history_df", return_value=df):
        from services import indicators
        result = indicators.get_timeframe_rsi("TEST")
    assert "daily" in result
    assert "weekly" in result
    assert "monthly" in result
    for tf in ["daily", "weekly", "monthly"]:
        assert "rsi" in result[tf]
        assert "target_20" in result[tf]
        assert "target_25" in result[tf]
        assert "target_30" in result[tf]
        assert "target_70" in result[tf]
        assert "target_75" in result[tf]
        assert "target_80" in result[tf]

def test_get_timeframe_rsi_reuses_daily_df_without_fetch():
    # daily_df 제공 시 daily 타임프레임은 재fetch 없이 그 df로 계산(동시 호출 rate-limit로
    # daily RSI만 빠지는 것 방지 — report_generator가 이미 받은 일봉 재사용).
    daily_df = pd.DataFrame({
        "Close": _make_price_series(100),
        "High": _make_price_series(100) + 1,
        "Low": _make_price_series(100) - 1,
    })
    fetched = pd.DataFrame({
        "Close": _make_price_series(100, start=200.0),
        "High": _make_price_series(100, start=200.0) + 1,
        "Low": _make_price_series(100, start=200.0) - 1,
    })
    mock_ghd = MagicMock(return_value=fetched)
    with patch("services.market.get_history_df", mock_ghd):
        from services import indicators
        result = indicators.get_timeframe_rsi("TEST", "US", "", daily_df=daily_df)
    assert result["daily"]["rsi"] is not None
    fetched_tfs = [c.args[3] for c in mock_ghd.call_args_list if len(c.args) > 3]
    assert "daily" not in fetched_tfs               # daily는 재fetch 안 함
    assert "weekly" in fetched_tfs and "monthly" in fetched_tfs

def test_get_timeframe_rsi_fetches_daily_when_no_df():
    # daily_df 미전달(None)이면 기존대로 daily도 fetch(하위호환).
    df = pd.DataFrame({
        "Close": _make_price_series(100),
        "High": _make_price_series(100) + 1,
        "Low": _make_price_series(100) - 1,
    })
    mock_ghd = MagicMock(return_value=df)
    with patch("services.market.get_history_df", mock_ghd):
        from services import indicators
        indicators.get_timeframe_rsi("TEST", "US", "")
    fetched_tfs = [c.args[3] for c in mock_ghd.call_args_list if len(c.args) > 3]
    assert "daily" in fetched_tfs

def test_get_volume_profile_returns_poc_hvn_lvn():
    from services.indicators import get_volume_profile
    prices = np.concatenate([
        np.ones(80) * 100.0,
        np.ones(40) * 120.0,
        np.ones(40) * 80.0,
        np.linspace(80, 120, 40),
    ])
    volumes = np.concatenate([
        np.ones(80) * 1_000_000,
        np.ones(40) * 500_000,
        np.ones(40) * 400_000,
        np.ones(40) * 50_000,
    ])
    df = pd.DataFrame({"Close": prices, "Volume": volumes})
    result = get_volume_profile(df, bins=50)
    assert "poc" in result
    assert "hvn" in result
    assert "lvn" in result
    assert result["poc"] is not None
    assert abs(result["poc"] - 100.0) < 5.0
    assert len(result["hvn"]) <= 3
    assert isinstance(result["hvn"], list)
    assert isinstance(result["lvn"], list)

def test_get_volume_profile_returns_empty_on_insufficient_data():
    from services.indicators import get_volume_profile
    assert get_volume_profile(pd.DataFrame()) == {"poc": None, "hvn": [], "lvn": []}


# ── S1: get_support_resistance empty-df graceful ──────────────────────────────

def test_get_support_resistance_empty_df_returns_none_fields():
    """Empty df must not throw; all fields None."""
    from services.indicators import get_support_resistance
    result = get_support_resistance(pd.DataFrame())
    for key in ("week52_high", "week52_low", "ema20", "ema50", "ema200"):
        assert result[key] is None, f"{key} should be None on empty df"


def test_get_support_resistance_short_df_returns_none_fields():
    """Fewer rows than longest EMA (200) should not throw."""
    from services.indicators import get_support_resistance
    prices = _make_price_series(10)
    df = pd.DataFrame({"Close": prices, "High": prices + 1, "Low": prices - 1})
    result = get_support_resistance(df)
    # doesn't throw; numeric keys may be None or float — just no exception
    assert isinstance(result, dict)
    for key in ("week52_high", "week52_low", "ema20", "ema50", "ema200"):
        assert key in result


# ── S2: calc_trend_summary ────────────────────────────────────────────────────

def _make_ohlcv(n=300, start=100.0, trend=0.3):
    np.random.seed(7)
    prices = [start]
    for _ in range(n - 1):
        prices.append(max(1.0, prices[-1] + trend + np.random.randn()))
    s = pd.Series(prices, dtype=float)
    return pd.DataFrame({"Close": s, "High": s + 1, "Low": s - 1, "Volume": [1_000_000] * n})


def test_calc_trend_summary_shape():
    """Returns all required keys with sane types."""
    from services.indicators import calc_trend_summary
    df = _make_ohlcv(300)
    t = calc_trend_summary(df)
    assert isinstance(t, dict)
    for key in ("above_ema20", "above_ema50", "above_ema200",
                "return_30d", "golden_cross", "dead_cross"):
        assert key in t, f"missing key: {key}"


def test_calc_trend_summary_above_ema_when_uptrend():
    """Strong uptrend: price should be above ema20/50."""
    from services.indicators import calc_trend_summary
    prices = np.linspace(50, 200, 300)
    df = pd.DataFrame({"Close": prices, "High": prices + 1, "Low": prices - 1})
    t = calc_trend_summary(df)
    assert t["above_ema20"] is True
    assert t["above_ema50"] is True


def test_calc_trend_summary_below_ema_when_downtrend():
    """Strong downtrend: price should be below ema20/50/200."""
    from services.indicators import calc_trend_summary
    prices = np.linspace(200, 50, 300)
    df = pd.DataFrame({"Close": prices, "High": prices + 1, "Low": prices - 1})
    t = calc_trend_summary(df)
    assert t["above_ema20"] is False
    assert t["above_ema50"] is False


def test_calc_trend_summary_30d_return():
    """30-day return calculation: last vs 30 bars ago."""
    from services.indicators import calc_trend_summary
    prices = [100.0] * 270 + [100.0 * (1 + i * 0.01) for i in range(30)]  # +29% last 30 bars
    df = pd.DataFrame({"Close": prices, "High": [p + 1 for p in prices], "Low": [p - 1 for p in prices]})
    t = calc_trend_summary(df)
    assert t["return_30d"] is not None
    assert t["return_30d"] > 0


def test_calc_trend_summary_golden_cross():
    """ema50 crosses above ema200 → golden_cross True.
    Strategy: long downtrend (400 bars) so ema50 < ema200, then short sharp upturn (20 bars)
    so ema50 just crossed ema200 within the detection window."""
    from services.indicators import calc_trend_summary
    down = np.linspace(300, 50, 400)
    up   = np.linspace(50, 600, 20)   # steep enough to make ema50 > ema200 recently
    prices = np.concatenate([down, up])
    df = pd.DataFrame({"Close": prices, "High": prices + 1, "Low": prices - 1})
    t = calc_trend_summary(df)
    assert t["golden_cross"] is True, f"Expected golden_cross, got {t}"


def test_calc_trend_summary_dead_cross():
    """ema50 crosses below ema200 → dead_cross True."""
    from services.indicators import calc_trend_summary
    up   = np.linspace(100, 300, 400)
    down = np.linspace(300, 30, 20)   # steep enough to make ema50 < ema200 recently
    prices = np.concatenate([up, down])
    df = pd.DataFrame({"Close": prices, "High": prices + 1, "Low": prices - 1})
    t = calc_trend_summary(df)
    assert t["dead_cross"] is True, f"Expected dead_cross, got {t}"


def test_calc_trend_summary_empty_df_graceful():
    from services.indicators import calc_trend_summary
    result = calc_trend_summary(pd.DataFrame())
    assert isinstance(result, dict)
    for key in ("above_ema20", "above_ema50", "above_ema200",
                "return_30d", "golden_cross", "dead_cross"):
        assert result[key] is None


# ── S3: calc_beta, calc_hv ────────────────────────────────────────────────────

def test_calc_beta_known_value():
    """OLS beta = cov(stock, index) / var(index). Known values."""
    from services.indicators import calc_beta
    np.random.seed(0)
    idx_ret = pd.Series(np.random.randn(100) * 0.01)
    # stock returns = 1.5 * index + noise
    stk_ret = 1.5 * idx_ret + pd.Series(np.random.randn(100) * 0.002)
    beta = calc_beta(stk_ret, idx_ret)
    assert beta is not None
    assert abs(beta - 1.5) < 0.15, f"Expected ~1.5, got {beta}"


def test_calc_beta_insufficient_data_returns_none():
    from services.indicators import calc_beta
    assert calc_beta(pd.Series([0.01, 0.02]), pd.Series([0.01, 0.02])) is None


def test_calc_beta_zero_variance_returns_none():
    from services.indicators import calc_beta
    idx_ret = pd.Series([0.0] * 50)
    stk_ret = pd.Series([0.01] * 50)
    assert calc_beta(stk_ret, idx_ret) is None


def test_calc_hv_annualizes_correctly():
    """HV = stdev(daily returns) * sqrt(252). Known stdev."""
    from services.indicators import calc_hv
    np.random.seed(1)
    daily_std = 0.01
    returns = pd.Series(np.random.randn(252) * daily_std)
    hv = calc_hv(returns)
    assert hv is not None
    expected = float(returns.std() * np.sqrt(252))
    assert abs(hv - expected) < 1e-6


def test_calc_hv_insufficient_data_returns_none():
    from services.indicators import calc_hv
    assert calc_hv(pd.Series([0.01])) is None


def test_calc_hv_finite_guard():
    from services.indicators import calc_hv
    returns = pd.Series([float("nan")] * 50)
    assert calc_hv(returns) is None

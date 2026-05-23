import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
import pandas as pd
from unittest.mock import patch, MagicMock


# ── helpers ──────────────────────────────────────────────────────────────────

def _make_hist(values: list[float]) -> pd.DataFrame:
    idx = pd.date_range("2026-01-01", periods=len(values), freq="D")
    return pd.DataFrame({"Close": values}, index=idx)


# ── get_treasury ──────────────────────────────────────────────────────────────

def test_get_treasury_returns_four_rates():
    from services.market_indicators_service import get_treasury, _cache
    _cache.clear()
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([4.50, 4.55])
        result = get_treasury()
    assert set(result["rates"].keys()) == {"3m", "5y", "10y", "30y"}


def test_get_treasury_change_bp():
    from services.market_indicators_service import get_treasury, _cache
    _cache.clear()
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([4.50, 4.55])
        result = get_treasury()
    # change = (4.55 - 4.50) * 100 = 5 bp
    assert result["rates"]["10y"]["change_bp"] == pytest.approx(5.0, abs=0.1)


def test_get_treasury_spread_is_10y_minus_3m():
    from services.market_indicators_service import get_treasury, _cache
    _cache.clear()
    def mock_hist_by_sym(sym):
        mock = MagicMock()
        val = 4.55 if sym == "^TNX" else 5.00 if sym == "^TYX" else 4.00 if sym == "^FVX" else 3.50
        mock.history.return_value = _make_hist([val - 0.05, val])
        return mock
    with patch("services.market_indicators_service.yf.Ticker", side_effect=mock_hist_by_sym):
        result = get_treasury()
    # spread = 10y(4.55) - 3m(3.50) = 1.05
    assert len(result["spread"]) > 0
    assert result["spread"][-1]["value"] == pytest.approx(1.05, abs=0.01)


def test_get_treasury_caches_result():
    from services.market_indicators_service import get_treasury, _cache
    _cache.clear()
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([4.50, 4.55])
        get_treasury()
        call_count_1 = mock_t.call_count
        get_treasury()
        call_count_2 = mock_t.call_count
    assert call_count_1 == call_count_2  # second call hits cache, no new yf calls

"""Unit tests for indices.py — no network calls."""
from unittest.mock import patch, MagicMock
from services.market_indicators.indices import _parse_multpl_cape, get_indices

# --- (a) multpl HTML parser ---

_MULTPL_HTML = """
<html><body>
<div id="current">CurrentShiller PE Ratio:40.70-0.30\n(-0.74%)4:00 PM EDT, Fri Jun 26</div>
<table>
  <tr><th>Mean:</th><td>17.39Median:16.10Min:4.78(Dec 1920)Max:44.19(Dec 1999)</td><td></td></tr>
  <tr><th>Median:</th><td>16.10Min:4.78(Dec 1920)Max:44.19(Dec 1999)</td><td></td></tr>
  <tr><th>Min:</th><td>4.78(Dec 1920)Max:44.19(Dec 1999)</td><td>(Dec 1920)</td></tr>
  <tr><th>Max:</th><td>44.19(Dec 1999)</td><td>(Dec 1999)</td></tr>
</table>
</body></html>
"""


def test_parse_cape_current():
    result = _parse_multpl_cape(_MULTPL_HTML)
    assert result is not None
    assert result["current"] == 40.70


def test_parse_cape_stats():
    result = _parse_multpl_cape(_MULTPL_HTML)
    assert result["mean"] == 17.39
    assert result["median"] == 16.10
    assert result["min"] == 4.78
    assert result["max"] == 44.19


def test_parse_cape_bad_html():
    assert _parse_multpl_cape("<html></html>") is None


# --- (b) get_indices shape ---

_FAKE_HISTORY = [{"date": "2025-01-01", "value": 4700.0}, {"date": "2025-01-02", "value": 4750.0}]


def test_get_indices_shape():
    with (
        patch("services.market_indicators.indices._get_cache", return_value=None),
        patch("services.market_indicators.indices._mc_load", return_value=None),
        patch("services.market_indicators.indices._yf_close_history", return_value=_FAKE_HISTORY),
        patch("services.market_indicators.indices._fetch_cape", return_value={
            "current": 38.5, "mean": 17.39, "median": 16.10, "min": 4.78, "max": 44.19
        }),
        patch("services.market_indicators.indices._mc_save"),
        patch("services.market_indicators.indices._set_cache"),
    ):
        result = get_indices()

    assert "indices" in result
    assert "valuation" in result
    for key in ("gspc", "ks11", "kq11"):
        idx = result["indices"][key]
        assert "current" in idx
        assert "change_pct" in idx
        assert "history" in idx

    cape = result["valuation"]["sp500_cape"]
    assert cape["current"] == 38.5
    assert cape["mean"] == 17.39

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


# ── _get_sp500_tickers ────────────────────────────────────────────────────────

def test_get_sp500_tickers_parses_wikipedia(tmp_path, monkeypatch):
    from services.market_indicators_service import _get_sp500_tickers
    monkeypatch.setattr(
        "services.market_indicators_service._SP500_CACHE",
        str(tmp_path / "sp500.json"),
    )
    fake_html = """
    <table id="constituents"><tbody>
      <tr><th>Symbol</th></tr>
      <tr><td>AAPL</td><td>Apple</td></tr>
      <tr><td>BRK.B</td><td>Berkshire</td></tr>
    </tbody></table>
    """
    with patch("services.market_indicators_service.requests.get") as mock_get:
        mock_get.return_value.text = fake_html
        tickers = _get_sp500_tickers()
    assert "AAPL" in tickers
    assert "BRK-B" in tickers  # dot converted to dash


def test_get_sp500_tickers_uses_file_cache(tmp_path, monkeypatch):
    from services.market_indicators_service import _get_sp500_tickers
    cache_file = tmp_path / "sp500.json"
    cache_file.write_text('["AAPL", "MSFT"]')
    import os as _os; _os.utime(cache_file, None)  # touch (recent mtime)
    monkeypatch.setattr(
        "services.market_indicators_service._SP500_CACHE", str(cache_file)
    )
    with patch("services.market_indicators_service.requests.get") as mock_get:
        tickers = _get_sp500_tickers()
        assert not mock_get.called  # should NOT hit network
    assert tickers == ["AAPL", "MSFT"]


# ── get_m7_earnings ───────────────────────────────────────────────────────────

def test_get_m7_earnings_structure():
    from services.market_indicators_service import get_m7_earnings, _cache
    _cache.clear()
    fake_ni = {"2025Q1": 25.0, "2025Q2": 28.0}
    with patch("services.market_indicators_service._get_sp500_tickers", return_value=["AAPL", "MSFT", "JPM"]), \
         patch("services.market_indicators_service._get_yf_quarterly_net_income", return_value=fake_ni):
        result = get_m7_earnings()
    assert "quarters" in result
    assert "unit" in result
    assert all({"q", "m7", "rest"} <= set(q.keys()) for q in result["quarters"])


def test_get_m7_earnings_rest_excludes_m7():
    from services.market_indicators_service import get_m7_earnings, M7, _cache
    _cache.clear()
    called_tickers: list[str] = []

    def capture_ni(ticker):
        called_tickers.append(ticker)
        return {"2025Q1": 10.0}

    with patch("services.market_indicators_service._get_sp500_tickers", return_value=["AAPL", "JPM", "V"]), \
         patch("services.market_indicators_service._get_yf_quarterly_net_income", side_effect=capture_ni):
        get_m7_earnings()
    # JPM and V should be in rest (not M7), AAPL is in M7
    rest_tickers = [t for t in called_tickers if t not in M7]
    assert "JPM" in rest_tickers
    assert "V" in rest_tickers


# ── _get_kospi200_tickers ─────────────────────────────────────────────────────

def test_get_kospi200_tickers_parses_krx(tmp_path, monkeypatch):
    from services.market_indicators_service import _get_kospi200_tickers
    monkeypatch.setattr(
        "services.market_indicators_service._KOSPI200_CACHE",
        str(tmp_path / "kospi200.json"),
    )
    fake_response = {"output": [{"ISU_SRT_CD": "005930"}, {"ISU_SRT_CD": "000660"}]}
    with patch("services.market_indicators_service.requests.post") as mock_post:
        mock_post.return_value.json.return_value = fake_response
        tickers = _get_kospi200_tickers()
    assert "005930" in tickers
    assert "000660" in tickers


def test_get_kospi200_tickers_uses_file_cache(tmp_path, monkeypatch):
    from services.market_indicators_service import _get_kospi200_tickers
    cache_file = tmp_path / "kospi200.json"
    cache_file.write_text('["005930","000660","005380"]')
    import os as _os; _os.utime(cache_file, None)
    monkeypatch.setattr(
        "services.market_indicators_service._KOSPI200_CACHE", str(cache_file)
    )
    with patch("services.market_indicators_service.requests.post") as mock_post:
        tickers = _get_kospi200_tickers()
        assert not mock_post.called
    assert "005380" in tickers


# ── _get_naver_quarterly_net_income ──────────────────────────────────────────

def test_get_naver_quarterly_net_income_parses_row():
    from services.market_indicators_service import _get_naver_quarterly_net_income
    fake_resp = {
        "financeInfo": {
            "rowList": [
                {"title": "매출액", "columns": {"202503": {"value": "100,000"}}},
                {"title": "영업이익", "columns": {"202503": {"value": "20,000"}}},
                {"title": "당기순이익", "columns": {
                    "202503": {"value": "122,257"},
                    "202506": {"value": "150,000"},
                }},
            ]
        }
    }
    with patch("services.market_indicators_service.requests.get") as mock_get:
        mock_get.return_value.json.return_value = fake_resp
        mock_get.return_value.raise_for_status = lambda: None
        result = _get_naver_quarterly_net_income("005930")
    assert "2025Q1" in result
    assert result["2025Q1"] == pytest.approx(122257.0, rel=0.01)
    assert "2025Q2" in result


# ── get_kr_top2_earnings ──────────────────────────────────────────────────────

def test_get_kr_top2_earnings_structure():
    from services.market_indicators_service import get_kr_top2_earnings, _cache
    _cache.clear()
    with patch("services.market_indicators_service._get_kospi200_tickers",
               return_value=["005930", "000660", "005380"]), \
         patch("services.market_indicators_service._get_naver_quarterly_net_income",
               return_value={"2025Q1": 100000.0, "2025Q2": 120000.0}):
        result = get_kr_top2_earnings()
    assert "quarters" in result
    assert result["unit"] == "억원"
    assert all({"q", "top2", "rest"} <= set(q.keys()) for q in result["quarters"])


def test_get_kr_top2_earnings_rest_excludes_top2():
    from services.market_indicators_service import get_kr_top2_earnings, KR_TOP2, _cache
    _cache.clear()
    called: list[str] = []

    def capture(ticker):
        called.append(ticker)
        return {"2025Q1": 50000.0}

    with patch("services.market_indicators_service._get_kospi200_tickers",
               return_value=["005930", "000660", "005380"]), \
         patch("services.market_indicators_service._get_naver_quarterly_net_income",
               side_effect=capture):
        get_kr_top2_earnings()
    rest_tickers = [t for t in called if t not in KR_TOP2]
    assert "005380" in rest_tickers
    assert "005930" not in rest_tickers


# ── get_kr_exports ────────────────────────────────────────────────────────────

import json as _json

def test_get_kr_exports_no_api_key_returns_error(tmp_path, monkeypatch):
    from services.market_indicators_service import get_kr_exports
    monkeypatch.setattr(
        "services.market_indicators_service._EXPORTS_CACHE",
        str(tmp_path / "kr_exports.json"),
    )
    monkeypatch.delenv("KITA_API_KEY", raising=False)
    result = get_kr_exports()
    assert result["months"] == []
    assert "error" in result


def test_get_kr_exports_uses_file_cache(tmp_path, monkeypatch):
    from services.market_indicators_service import get_kr_exports
    cache_file = tmp_path / "kr_exports.json"
    cached_data = {"months": [{"month": "202501", "semiconductor": 100.0, "non_semiconductor": 200.0}]}
    cache_file.write_text(_json.dumps(cached_data))
    import os as _os; _os.utime(cache_file, None)
    monkeypatch.setattr(
        "services.market_indicators_service._EXPORTS_CACHE", str(cache_file)
    )
    with patch("services.market_indicators_service.requests.get") as mock_get:
        result = get_kr_exports()
        assert not mock_get.called
    assert result["months"][0]["semiconductor"] == 100.0


def test_get_kr_exports_with_api_key(tmp_path, monkeypatch):
    from services.market_indicators_service import get_kr_exports
    monkeypatch.setattr(
        "services.market_indicators_service._EXPORTS_CACHE",
        str(tmp_path / "kr_exports.json"),
    )
    monkeypatch.setenv("KITA_API_KEY", "test-key-123")
    fake_response = {
        "items": {
            "item": [
                {"period": "202501", "itmNm": "반도체", "expAmt": "10000000000"},
                {"period": "202501", "itmNm": "자동차", "expAmt": "5000000000"},
                {"period": "202502", "itmNm": "반도체", "expAmt": "11000000000"},
            ]
        }
    }
    with patch("services.market_indicators_service.requests.get") as mock_get:
        mock_get.return_value.json.return_value = fake_response
        result = get_kr_exports()
    months = {m["month"]: m for m in result["months"]}
    assert "202501" in months
    assert months["202501"]["semiconductor"] > 0
    assert months["202501"]["non_semiconductor"] > 0

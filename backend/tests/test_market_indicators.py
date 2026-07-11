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
    from services.market_indicators import get_treasury, _cache
    _cache.clear()
    with patch("services.market_indicators.cache.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([4.50, 4.55])
        result = get_treasury()
    assert set(result["rates"].keys()) == {"3m", "5y", "10y", "30y"}


def test_get_treasury_change_bp():
    from services.market_indicators import get_treasury, _cache
    _cache.clear()
    with patch("services.market_indicators.commodities._mc_load", return_value=None), \
         patch("services.market_indicators.cache.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([4.50, 4.55])
        result = get_treasury()
    # change = (4.55 - 4.50) * 100 = 5 bp
    assert result["rates"]["10y"]["change_bp"] == pytest.approx(5.0, abs=0.1)


def test_get_treasury_spread_is_10y_minus_3m():
    from services.market_indicators import get_treasury, _cache
    _cache.clear()
    def mock_hist_by_sym(sym):
        mock = MagicMock()
        val = 4.55 if sym == "^TNX" else 5.00 if sym == "^TYX" else 4.00 if sym == "^FVX" else 3.50
        mock.history.return_value = _make_hist([val - 0.05, val])
        return mock
    with patch("services.market_indicators.commodities._mc_load", return_value=None), \
         patch("services.market_indicators.cache.yf.Ticker", side_effect=mock_hist_by_sym):
        result = get_treasury()
    # spread = 10y(4.55) - 3m(3.50) = 1.05
    assert len(result["spread"]) > 0
    assert result["spread"][-1]["value"] == pytest.approx(1.05, abs=0.01)


def test_get_treasury_caches_result():
    from services.market_indicators import get_treasury, _cache
    _cache.clear()
    with patch("services.market_indicators.cache.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([4.50, 4.55])
        get_treasury()
        call_count_1 = mock_t.call_count
        get_treasury()
        call_count_2 = mock_t.call_count
    assert call_count_1 == call_count_2  # second call hits cache, no new yf calls


# ── _get_sp500_tickers ────────────────────────────────────────────────────────

def test_get_sp500_tickers_parses_wikipedia(tmp_path, monkeypatch):
    from services.market_indicators.earnings import _get_sp500_tickers
    monkeypatch.setattr(
        "services.market_indicators.earnings._SP500_CACHE",
        str(tmp_path / "sp500.json"),
    )
    fake_html = """
    <table id="constituents"><tbody>
      <tr><th>Symbol</th></tr>
      <tr><td>AAPL</td><td>Apple</td></tr>
      <tr><td>BRK.B</td><td>Berkshire</td></tr>
    </tbody></table>
    """
    with patch("services.market_indicators.earnings.requests.get") as mock_get:
        mock_get.return_value.text = fake_html
        tickers = _get_sp500_tickers()
    assert "AAPL" in tickers
    assert "BRK-B" in tickers  # dot converted to dash


def test_get_sp500_tickers_uses_file_cache(tmp_path, monkeypatch):
    from services.market_indicators.earnings import _get_sp500_tickers
    cache_file = tmp_path / "sp500.json"
    cache_file.write_text('["AAPL", "MSFT"]')
    import os as _os; _os.utime(cache_file, None)  # touch (recent mtime)
    monkeypatch.setattr(
        "services.market_indicators.earnings._SP500_CACHE", str(cache_file)
    )
    with patch("services.market_indicators.earnings.requests.get") as mock_get:
        tickers = _get_sp500_tickers()
        assert not mock_get.called  # should NOT hit network
    assert tickers == ["AAPL", "MSFT"]


# ── get_m7_earnings ───────────────────────────────────────────────────────────

def test_get_m7_earnings_structure():
    from services.market_indicators import get_m7_earnings, _cache
    _cache.clear()
    fake_ni = {"2025Q1": 25.0, "2025Q2": 28.0}
    with patch("services.market_indicators.earnings._get_sp500_tickers", return_value=["AAPL", "MSFT", "JPM"]), \
         patch("services.market_indicators.earnings._get_yf_quarterly_net_income", return_value=fake_ni):
        result = get_m7_earnings()
    assert "quarters" in result
    assert "unit" in result
    assert all({"q", "m7", "rest"} <= set(q.keys()) for q in result["quarters"])


def test_get_m7_earnings_rest_excludes_m7():
    from services.market_indicators import get_m7_earnings, _cache
    from services.market_indicators.earnings import M7
    _cache.clear()
    called_tickers: list[str] = []

    def capture_ni(ticker):
        called_tickers.append(ticker)
        return {"2025Q1": 10.0}

    with patch("services.market_indicators.cache._mc_load", return_value=None), \
         patch("services.market_indicators.earnings._get_sp500_tickers", return_value=["AAPL", "JPM", "V"]), \
         patch("services.market_indicators.earnings._get_yf_quarterly_net_income", side_effect=capture_ni):
        get_m7_earnings()
    # JPM and V should be in rest (not M7), AAPL is in M7
    rest_tickers = [t for t in called_tickers if t not in M7]
    assert "JPM" in rest_tickers
    assert "V" in rest_tickers


# ── _get_kospi_tickers ────────────────────────────────────────────────────────

def test_get_kospi200_tickers_parses_krx(tmp_path, monkeypatch):
    from services.market_indicators.earnings import _get_kospi_tickers
    monkeypatch.setattr(
        "services.market_indicators.earnings._KOSPI_CACHE",
        str(tmp_path / "kospi_tickers.json"),
    )
    # current impl: GET requests to naver with regex code=([0-9]{6})
    call_count = [0]
    def mock_get(url, **kwargs):
        m = MagicMock()
        if call_count[0] == 0:
            m.content = b"code=005930 code=000660"
        else:
            m.content = b""  # no codes → stop pagination
        call_count[0] += 1
        return m
    with patch("services.market_indicators.earnings.requests.get", side_effect=mock_get):
        tickers = _get_kospi_tickers()
    assert "005930" in tickers
    assert "000660" in tickers


def test_get_kospi200_tickers_uses_file_cache(tmp_path, monkeypatch):
    from services.market_indicators.earnings import _get_kospi_tickers
    cache_file = tmp_path / "kospi_tickers.json"
    cache_file.write_text('["005930","000660","005380"]')
    import os as _os; _os.utime(cache_file, None)
    monkeypatch.setattr(
        "services.market_indicators.earnings._KOSPI_CACHE", str(cache_file)
    )
    with patch("services.market_indicators.earnings.requests.get") as mock_get:
        tickers = _get_kospi_tickers()
        assert not mock_get.called
    assert "005380" in tickers


# ── _get_naver_quarterly_net_income ──────────────────────────────────────────

def test_get_naver_quarterly_net_income_parses_row():
    from services.market_indicators.earnings import _get_naver_quarterly_net_income
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
    with patch("services.market_indicators.earnings.requests.get") as mock_get:
        mock_get.return_value.json.return_value = fake_resp
        mock_get.return_value.raise_for_status = lambda: None
        result = _get_naver_quarterly_net_income("005930")
    assert "2025Q1" in result
    assert result["2025Q1"] == pytest.approx(122257.0, rel=0.01)
    assert "2025Q2" in result


# ── get_kr_top2_earnings ──────────────────────────────────────────────────────

def test_get_kr_top2_earnings_structure():
    from services.market_indicators import get_kr_top2_earnings, _cache
    _cache.clear()
    with patch("services.market_indicators.cache._mc_load", return_value=None), \
         patch("services.market_indicators.earnings._mc_save"), \
         patch("services.market_indicators.earnings._get_kospi_tickers",
               return_value=["005930", "000660", "005380"]), \
         patch("services.market_indicators.earnings._get_naver_quarterly_net_income",
               return_value={"2025Q1": 100000.0, "2025Q2": 120000.0}):
        result = get_kr_top2_earnings()
    assert "quarters" in result
    assert result["unit"] == "억원"
    assert all({"q", "top2", "rest"} <= set(q.keys()) for q in result["quarters"])


def test_get_kr_top2_earnings_rest_excludes_top2():
    from services.market_indicators import get_kr_top2_earnings, _cache
    from services.market_indicators.earnings import KR_TOP2
    _cache.clear()
    called: list[str] = []

    def capture(ticker):
        called.append(ticker)
        return {"2025Q1": 50000.0}

    with patch("services.market_indicators.cache._mc_load", return_value=None), \
         patch("services.market_indicators.earnings._mc_save"), \
         patch("services.market_indicators.earnings._get_kospi_tickers",
               return_value=["005930", "000660", "005380"]), \
         patch("services.market_indicators.earnings._get_naver_quarterly_net_income",
               side_effect=capture):
        get_kr_top2_earnings()
    rest_tickers = [t for t in called if t not in KR_TOP2]
    assert "005380" in rest_tickers
    assert "005930" not in rest_tickers


# ── get_kr_exports ────────────────────────────────────────────────────────────

import json as _json

def test_get_kr_exports_no_api_key_returns_error(tmp_path, monkeypatch):
    from services.market_indicators import get_kr_exports, _cache
    _cache.clear()
    monkeypatch.setattr(
        "services.market_indicators.exports._EXPORTS_CACHE",
        str(tmp_path / "kr_exports.json"),
    )
    monkeypatch.delenv("KITA_API_KEY", raising=False)
    with patch("services.market_indicators.exports._mc_load", return_value=None), \
         patch("services.market_indicators.exports._fetch_comtrade_exports",
               side_effect=Exception("network error")):
        result = get_kr_exports()
    assert result["months"] == []
    assert "error" in result


def test_get_kr_exports_uses_file_cache(tmp_path, monkeypatch):
    from services.market_indicators import get_kr_exports, _cache
    _cache.clear()
    cache_file = tmp_path / "kr_exports.json"
    cached_data = {"months": [{"month": "202501", "semiconductor": 100.0, "non_semiconductor": 200.0}]}
    cache_file.write_text(_json.dumps(cached_data))
    import os as _os; _os.utime(cache_file, None)
    monkeypatch.setattr(
        "services.market_indicators.exports._EXPORTS_CACHE", str(cache_file)
    )
    monkeypatch.setattr("services.market_indicators.exports._mc_load", lambda key: None)
    with patch("services.market_indicators.exports.requests.get") as mock_get:
        result = get_kr_exports()
        assert not mock_get.called
    assert result["months"][0]["semiconductor"] == 100.0


def test_get_kr_exports_with_api_key(tmp_path, monkeypatch):
    from services.market_indicators import get_kr_exports, _cache
    _cache.clear()
    monkeypatch.setattr(
        "services.market_indicators.exports._EXPORTS_CACHE",
        str(tmp_path / "kr_exports.json"),
    )
    monkeypatch.setenv("KITA_API_KEY", "test-key-123")
    fake_data = {"months": [
        {"month": "202501", "semiconductor": 50.0, "non_semiconductor": 100.0},
        {"month": "202502", "semiconductor": 55.0, "non_semiconductor": 105.0},
    ]}
    with patch("services.market_indicators.exports._mc_load", return_value=None), \
         patch("services.market_indicators.exports._mc_save"), \
         patch("services.market_indicators.exports._fetch_customs_exports", return_value=fake_data):
        result = get_kr_exports()
    months = {m["month"]: m for m in result["months"]}
    assert "202501" in months
    assert months["202501"]["semiconductor"] > 0
    assert months["202501"]["non_semiconductor"] > 0


def test_get_kr_exports_stored_stale_serves_stored_no_live_fetch(monkeypatch):
    """F14: stored가 stale해도 요청경로에서 라이브 재조회하지 않고 저장값 반환 + 캐시 워밍."""
    from services.market_indicators import get_kr_exports, _cache
    from services.market_indicators.cache import _get_cache
    _cache.clear()
    stale_data = {"months": [
        {"month": "202001", "semiconductor": 50.0, "non_semiconductor": 100.0},
    ]}
    with patch("services.market_indicators.exports._mc_load",
               return_value={"data": stale_data, "fetched_at": "2020-02-01T00:00:00Z"}), \
         patch("services.market_indicators.exports._fetch_and_save_kr_exports") as mock_fetch:
        result = get_kr_exports()
        assert not mock_fetch.called          # stale이어도 라이브 fetch 미호출
    assert result == stale_data                # 저장값 그대로 반환
    assert _get_cache("kr_exports") == stale_data   # 인메모리 캐시 워밍됨


def test_get_kr_exports_cold_db_bootstraps_fetch_once(tmp_path, monkeypatch):
    """DB가 완전히 빈 콜드 상태에서만 부트스트랩 fetch 1회."""
    from services.market_indicators import get_kr_exports, _cache
    _cache.clear()
    monkeypatch.setattr(
        "services.market_indicators.exports._EXPORTS_CACHE",
        str(tmp_path / "kr_exports.json"),   # 레거시 파일 폴백도 없는 콜드 상태
    )
    monkeypatch.setenv("KITA_API_KEY", "test-key-123")
    fake_data = {"months": [{"month": "202501", "semiconductor": 50.0, "non_semiconductor": 100.0}]}
    with patch("services.market_indicators.exports._mc_load", return_value=None), \
         patch("services.market_indicators.exports._mc_save"), \
         patch("services.market_indicators.exports._fetch_customs_exports",
               return_value=fake_data) as mock_fetch:
        result = get_kr_exports()
        assert mock_fetch.call_count == 1
    assert result["months"][0]["month"] == "202501"


# ── get_fx ────────────────────────────────────────────────────────────────────

def test_get_fx_returns_three_rates():
    from services.market_indicators import get_fx, _cache
    _cache.clear()
    with patch("services.market_indicators.cache.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([1350.0, 1370.5])
        result = get_fx()
    assert set(result["rates"].keys()) == {"usdkrw", "usdjpy", "eurusd"}


def test_get_fx_change_pct():
    from services.market_indicators import get_fx, _cache
    _cache.clear()
    with patch("services.market_indicators.fx._mc_load", return_value=None), \
         patch("services.market_indicators.cache.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([1000.0, 1010.0])
        result = get_fx()
    # change = (1010 - 1000) / 1000 * 100 = 1.0%
    assert result["rates"]["usdkrw"]["change_pct"] == pytest.approx(1.0, abs=0.01)


def test_get_fx_history_usdkrw_only():
    from services.market_indicators import get_fx, _cache
    _cache.clear()
    with patch("services.market_indicators.cache.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([1350.0, 1370.5])
        result = get_fx()
    assert "usdkrw" in result["history"]
    assert "usdjpy" not in result["history"]


def test_get_fx_caches_result():
    from services.market_indicators import get_fx, _cache
    _cache.clear()
    with patch("services.market_indicators.cache.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([1350.0, 1370.5])
        get_fx()
        count1 = mock_t.call_count
        get_fx()
        count2 = mock_t.call_count
    assert count1 == count2


# ── get_vix ───────────────────────────────────────────────────────────────────

def test_get_vix_returns_current_and_change():
    from services.market_indicators import get_vix, _cache
    _cache.clear()
    with patch("services.market_indicators.fx._mc_load", return_value=None), \
         patch("services.market_indicators.cache.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([19.5, 18.2])
        result = get_vix()
    assert result["current"] == pytest.approx(18.2, abs=0.01)
    assert result["change"] == pytest.approx(-1.3, abs=0.01)


def test_get_vix_has_history():
    from services.market_indicators import get_vix, _cache
    _cache.clear()
    with patch("services.market_indicators.fx._mc_load", return_value=None), \
         patch("services.market_indicators.cache.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([18.0, 19.0, 20.0])
        result = get_vix()
    assert len(result["history"]) == 3
    assert result["history"][0]["value"] == pytest.approx(18.0, abs=0.01)


def test_get_vix_caches_result():
    from services.market_indicators import get_vix, _cache
    _cache.clear()
    with patch("services.market_indicators.cache.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([18.0, 19.0])
        get_vix()
        count1 = mock_t.call_count
        get_vix()
        count2 = mock_t.call_count
    assert count1 == count2


# ── get_commodities ───────────────────────────────────────────────────────────

def test_get_commodities_returns_three_prices():
    from services.market_indicators import get_commodities, _cache
    _cache.clear()
    with patch("services.market_indicators.cache.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([2300.0, 2350.0])
        result = get_commodities()
    assert set(result["prices"].keys()) == {"gold", "oil", "copper"}


def test_get_commodities_change_pct():
    from services.market_indicators import get_commodities, _cache
    _cache.clear()
    with patch("services.market_indicators.commodities._mc_load", return_value=None), \
         patch("services.market_indicators.cache.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([2000.0, 2100.0])
        result = get_commodities()
    # change = (2100 - 2000) / 2000 * 100 = 5.0%
    assert result["prices"]["gold"]["change_pct"] == pytest.approx(5.0, abs=0.01)


def test_get_commodities_has_history_for_all():
    from services.market_indicators import get_commodities, _cache
    _cache.clear()
    with patch("services.market_indicators.cache.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([100.0, 101.0])
        result = get_commodities()
    assert set(result["history"].keys()) == {"gold", "oil", "copper"}


def test_get_commodities_unit_labels():
    from services.market_indicators import get_commodities, _cache
    _cache.clear()
    with patch("services.market_indicators.cache.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([100.0, 101.0])
        result = get_commodities()
    assert result["prices"]["gold"]["unit"] == "USD/oz"
    assert result["prices"]["oil"]["unit"] == "USD/bbl"
    assert result["prices"]["copper"]["unit"] == "USD/lb"


def test_get_commodities_caches_result():
    from services.market_indicators import get_commodities, _cache
    _cache.clear()
    with patch("services.market_indicators.cache.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([100.0, 101.0])
        get_commodities()
        count1 = mock_t.call_count
        get_commodities()
        count2 = mock_t.call_count
    assert count1 == count2


# ── get_econ_indicators ───────────────────────────────────────────────────────

def test_get_econ_indicators_no_api_key_returns_error(monkeypatch):
    from services.market_indicators import get_econ_indicators, _cache
    _cache.clear()
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    result = get_econ_indicators()
    assert "error" in result


def test_get_econ_indicators_returns_cpi_and_unemployment(monkeypatch):
    from services.market_indicators import get_econ_indicators, _cache
    _cache.clear()
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    monkeypatch.setattr("services.market_indicators.econ._mc_load", lambda key: None)

    fake_obs = [
        {"date": "2024-01-01", "value": "308.5"},
        {"date": "2024-02-01", "value": "309.0"},
    ]
    fake_response = MagicMock()
    fake_response.json.return_value = {"observations": fake_obs}
    fake_response.raise_for_status = lambda: None

    with patch("services.market_indicators.econ.requests.get", return_value=fake_response):
        result = get_econ_indicators()

    assert "cpi" in result
    assert "unemployment" in result
    assert len(result["cpi"]) == 2
    assert result["cpi"][0]["value"] == pytest.approx(308.5, abs=0.01)


def test_get_econ_indicators_skips_missing_values(monkeypatch):
    from services.market_indicators import get_econ_indicators, _cache
    _cache.clear()
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    monkeypatch.setattr("services.market_indicators.econ._mc_load", lambda key: None)

    fake_obs = [
        {"date": "2024-01-01", "value": "308.5"},
        {"date": "2024-02-01", "value": "."},   # FRED 결측값
    ]
    fake_response = MagicMock()
    fake_response.json.return_value = {"observations": fake_obs}
    fake_response.raise_for_status = lambda: None

    with patch("services.market_indicators.econ.requests.get", return_value=fake_response):
        result = get_econ_indicators()

    assert len(result["cpi"]) == 1


def test_get_econ_indicators_caches_result(monkeypatch):
    from services.market_indicators import get_econ_indicators, _cache
    _cache.clear()
    monkeypatch.setenv("FRED_API_KEY", "test-key")

    fake_response = MagicMock()
    fake_response.json.return_value = {"observations": [{"date": "2024-01-01", "value": "3.7"}]}
    fake_response.raise_for_status = lambda: None

    with patch("services.market_indicators.econ.requests.get", return_value=fake_response) as mock_get:
        get_econ_indicators()
        count1 = mock_get.call_count
        get_econ_indicators()
        count2 = mock_get.call_count
    assert count1 == count2


# ── _mc_save / _mc_load ───────────────────────────────────────────────────────

def test_mc_save_and_load(monkeypatch):
    import json
    import services.market_indicators.cache as svc
    store = {}

    def fake_query(sql, params=None):
        key = params[0] if params else None
        return [store[key]] if key in store else []

    def fake_execute(sql, params=None):
        if params and "INSERT INTO market_cache" in sql:
            store[params[0]] = {"data": json.loads(params[1]), "fetched_at": params[2]}
        return 1

    monkeypatch.setattr(svc, "query", fake_query)
    monkeypatch.setattr(svc, "execute", fake_execute)

    svc._mc_save("test_key", {"hello": "world"})
    result = svc._mc_load("test_key")
    assert result is not None
    assert result["data"]["hello"] == "world"


def test_mc_load_returns_none_on_missing(monkeypatch):
    import services.market_indicators.cache as svc
    monkeypatch.setattr(svc, "query", lambda sql, params=None: [])
    assert svc._mc_load("nonexistent") is None


# ── _merge_history / _yf_close_history ───────────────────────────────────────

def test_yf_merge_history_appends_new_points():
    from services.market_indicators.cache import _merge_history
    stored = [
        {"date": "2026-01-01", "value": 1.0},
        {"date": "2026-01-02", "value": 2.0},
    ]
    new_pts = [
        {"date": "2026-01-02", "value": 2.1},
        {"date": "2026-01-03", "value": 3.0},
    ]
    result = _merge_history(stored, new_pts)
    dates = [p["date"] for p in result]
    assert dates == ["2026-01-01", "2026-01-02", "2026-01-03"]
    assert next(p["value"] for p in result if p["date"] == "2026-01-02") == 2.1


def test_yf_merge_history_empty_new():
    from services.market_indicators.cache import _merge_history
    stored = [{"date": "2026-01-01", "value": 1.0}]
    result = _merge_history(stored, [])
    assert result == stored

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


# ── 티커 캐시 = market_cache (task#234) ───────────────────────────────────────
# `backend/data/*.json`은 **read-only 정적 시드**다 — 7일 캐시는 DB(`market_cache`)에 있고
# 티커 조회는 시드 파일에 절대 write하지 않는다(CLAUDE.md "backend/data/는 정적 참조 데이터만").
# 파일 write는 ① 추적 정적 데이터를 라이브 스크레이프 결과로 오염시키고 ② 컨테이너 FS라
# 배포마다 리셋되며 ③ 덮어쓴 직후 mtime이 신선해져 7일간 증상을 숨겼다.

def _fresh(tickers: list[str]) -> dict:
    """`_mc_load`가 주는 신선한 저장값 (fetched_at은 라이브와 동일하게 tz-aware datetime)."""
    from datetime import datetime, timezone
    return {"data": {"tickers": tickers}, "fetched_at": datetime.now(timezone.utc)}


def _aged(tickers: list[str], days: int) -> dict:
    from datetime import datetime, timedelta, timezone
    return {"data": {"tickers": tickers},
            "fetched_at": datetime.now(timezone.utc) - timedelta(days=days)}


def _seed_state() -> dict:
    """실제 시드 파일들의 (mtime, 바이트) — write 여부 판정용."""
    from services.market_indicators import earnings
    out = {}
    for p in (earnings._SP500_SEED, earnings._KOSPI_SEED):
        path = Path(p)
        out[p] = (path.stat().st_mtime, path.read_bytes()) if path.exists() else None
    return out


_SP500_HTML = """
<table id="constituents"><tbody>
  <tr><th>Symbol</th></tr>
  <tr><td>AAPL</td><td>Apple</td></tr>
  <tr><td>BRK.B</td><td>Berkshire</td></tr>
</tbody></table>
"""


def test_get_sp500_tickers_uses_db_cache():
    """신선한 저장값이 있으면 스크레이프 0회."""
    from services.market_indicators.earnings import _get_sp500_tickers
    with patch("services.market_indicators.earnings._mc_load",
               return_value=_fresh(["AAPL", "MSFT"])), \
         patch("services.market_indicators.earnings.requests.get") as mock_get:
        tickers = _get_sp500_tickers()
        assert not mock_get.called
    assert tickers == ["AAPL", "MSFT"]


def test_get_sp500_tickers_expired_cache_rescrapes():
    """TTL(7일) 초과 저장값은 신선하지 않다 — fetched_at 기준 판정(파일 mtime 아님)."""
    from services.market_indicators.earnings import _get_sp500_tickers
    with patch("services.market_indicators.earnings._mc_load",
               return_value=_aged(["STALE"], days=8)), \
         patch("services.market_indicators.earnings._mc_save"), \
         patch("services.market_indicators.earnings.requests.get") as mock_get:
        mock_get.return_value.text = _SP500_HTML
        tickers = _get_sp500_tickers()
    assert "AAPL" in tickers and "STALE" not in tickers


def test_get_sp500_tickers_parses_wikipedia_and_saves_to_db():
    """미스 시 스크레이프 후 market_cache에 `{"tickers": [...]}`로 저장."""
    from services.market_indicators.earnings import _get_sp500_tickers
    with patch("services.market_indicators.earnings._mc_load", return_value=None), \
         patch("services.market_indicators.earnings._mc_save") as mock_save, \
         patch("services.market_indicators.earnings.requests.get") as mock_get:
        mock_get.return_value.text = _SP500_HTML
        tickers = _get_sp500_tickers()
    assert "AAPL" in tickers
    assert "BRK-B" in tickers  # dot converted to dash
    mock_save.assert_called_once_with("sp500_tickers", {"tickers": tickers})


def test_ticker_fetch_never_writes_seed_files():
    """핵심 회귀 — 미스+스크레이프 경로가 `backend/data/*.json`을 수정하지 않는다."""
    from services.market_indicators.earnings import _get_sp500_tickers, _get_kospi_tickers
    before = _seed_state()

    def kospi_get(url, **kwargs):
        m = MagicMock()
        m.content = b"code=005930" if "sise" in url else b""
        return m

    with patch("services.market_indicators.earnings._mc_load", return_value=None), \
         patch("services.market_indicators.earnings._mc_save"), \
         patch("services.market_indicators.earnings.requests.get") as mock_get:
        mock_get.return_value.text = _SP500_HTML
        _get_sp500_tickers()
    with patch("services.market_indicators.earnings._mc_load", return_value=None), \
         patch("services.market_indicators.earnings._mc_save"), \
         patch("services.market_indicators.earnings.requests.get", side_effect=kospi_get):
        _get_kospi_tickers()

    assert _seed_state() == before, (
        "티커 조회가 backend/data/ 시드 파일을 수정했다 — 시드는 read-only여야 한다")


def test_get_sp500_tickers_scrape_failure_does_not_save():
    """스크레이프 실패 시 빈 목록 박제 금지 — `_mc_save` 미호출 + 시드 폴백."""
    from services.market_indicators.earnings import _get_sp500_tickers
    with patch("services.market_indicators.earnings._mc_load", return_value=None), \
         patch("services.market_indicators.earnings._mc_save") as mock_save, \
         patch("services.market_indicators.earnings.requests.get",
               side_effect=RuntimeError("boom")):
        tickers = _get_sp500_tickers()
    assert not mock_save.called
    assert len(tickers) > 100  # 저장소 시드(S&P500 전체)로 폴백


def test_get_sp500_tickers_scrape_failure_prefers_stale_over_seed():
    """실패 시 만료된 직전 저장값이 있으면 그것을 쓴다(시드보다 최신)."""
    from services.market_indicators.earnings import _get_sp500_tickers
    with patch("services.market_indicators.earnings._mc_load",
               return_value=_aged(["OLD1", "OLD2"], days=9)), \
         patch("services.market_indicators.earnings._mc_save") as mock_save, \
         patch("services.market_indicators.earnings.requests.get",
               side_effect=RuntimeError("boom")):
        tickers = _get_sp500_tickers()
    assert not mock_save.called
    assert tickers == ["OLD1", "OLD2"]


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

def test_get_kospi200_tickers_parses_krx_and_saves_to_db():
    from services.market_indicators.earnings import _get_kospi_tickers
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
    with patch("services.market_indicators.earnings._mc_load", return_value=None), \
         patch("services.market_indicators.earnings._mc_save") as mock_save, \
         patch("services.market_indicators.earnings.requests.get", side_effect=mock_get):
        tickers = _get_kospi_tickers()
    assert "005930" in tickers
    assert "000660" in tickers
    mock_save.assert_called_once_with("kospi_tickers", {"tickers": tickers})


def test_get_kospi200_tickers_uses_db_cache():
    from services.market_indicators.earnings import _get_kospi_tickers
    with patch("services.market_indicators.earnings._mc_load",
               return_value=_fresh(["005930", "000660", "005380"])), \
         patch("services.market_indicators.earnings.requests.get") as mock_get:
        tickers = _get_kospi_tickers()
        assert not mock_get.called
    assert "005380" in tickers


def test_get_kospi_tickers_scrape_failure_does_not_save():
    from services.market_indicators.earnings import _get_kospi_tickers
    with patch("services.market_indicators.earnings._mc_load", return_value=None), \
         patch("services.market_indicators.earnings._mc_save") as mock_save, \
         patch("services.market_indicators.earnings.requests.get",
               side_effect=RuntimeError("boom")):
        tickers = _get_kospi_tickers()
    assert not mock_save.called
    assert len(tickers) > 100  # 저장소 시드(KOSPI 전체)로 폴백


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


# ── _filter_outliers / _yf_close_history 저장·표시 분리 (B60, task#303, ADR-0040) ──
# 회귀 고정 4축. 판정축을 「중앙값 배수」→「고립 스파이크」로 교체하기 *전*에 신설하고,
# 구현 전 실제 FAIL(단언 실패, import 파손 아님)을 확인한 뒤에만 구현으로 넘어간다.

def test_filter_outliers_removes_isolated_oldest_spike():
    """원 버그 재현(9dedc01/f7b5a21, "구리·금·WTI 차트 첫 값 스파이크") — 가장 오래된 점
    하나만 이웃과 자릿수가 다르면 그 점만 표시에서 빠지고 나머지는 살아남는다."""
    from services.market_indicators.cache import _filter_outliers
    pts = [{"date": "2025-01-01", "value": 0.01}] + [
        {"date": f"2025-02-{i + 1:02d}", "value": 100.0 + i * 0.5} for i in range(20)
    ]
    result = _filter_outliers(pts)
    dates = [p["date"] for p in result]
    print(f"[coverage] isolated_spike n={len(pts)} kept={len(result)}")
    assert "2025-01-01" not in dates
    assert len(result) == len(pts) - 1


def test_filter_outliers_survives_sustained_multiyear_move():
    """^IRX형 — 0.03에서 4.5까지 250점에 걸쳐 단조 상승하는 지속 이동은 한 점도 지워지면
    안 된다. 이빨: 옛 판정(중앙값 5배)이면 중앙값≈0.37·밴드≈[0.074,1.86]로 약 90점이
    잘리는 입력이라, 구현 전 이 축은 red여야 한다."""
    import math
    from services.market_indicators.cache import _filter_outliers
    n = 250
    start, end = 0.03, 4.5
    pts = [
        {"date": f"2025-{1 + i // 28:02d}-{1 + i % 28:02d}",
         "value": round(start * math.exp(i / (n - 1) * math.log(end / start)), 6)}
        for i in range(n)
    ]
    vals = sorted(p["value"] for p in pts)
    median = vals[len(vals) // 2]
    print(f"[coverage] sustained_move n={n} median={median:.4f} "
          f"old_band=[{median / 5:.4f},{median * 5:.4f}]")
    result = _filter_outliers(pts)
    assert len(result) == n


def test_filter_outliers_never_drops_latest_point():
    """최신 점은 직전 대비 아무리 튀어도 제거되지 않는다 — current/change_pct의 출처.
    이빨: 옛 판정(중앙값 5배, median=4.2)이면 500.0(밴드 상한 21 초과)이 잘리는 입력이다."""
    from services.market_indicators.cache import _filter_outliers
    pts = [{"date": f"2025-03-{i + 1:02d}", "value": 4.2} for i in range(20)]
    pts.append({"date": "2025-04-01", "value": 500.0})
    result = _filter_outliers(pts)
    dates = [p["date"] for p in result]
    print(f"[coverage] latest_point_spike n={len(pts)} kept={len(result)}")
    assert "2025-04-01" in dates
    assert result[-1]["value"] == 500.0


def test_yf_close_history_storage_return_keeps_all_points_incl_spike():
    """저장용 반환값은 raw다 — 표시 필터에 걸릴 스파이크도 `_yf_close_history`가
    저장용으로 내주는 값에는 그대로 남아 있어야 병합·트림 도중 영구 손실이 없다."""
    from services.market_indicators.cache import _yf_close_history
    values = [0.01] + [100.0 + i * 0.5 for i in range(20)]
    with patch("services.market_indicators.cache.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist(values)
        result = _yf_close_history("TEST", stored=[])
    dates = [p["date"] for p in result]
    print(f"[coverage] storage_lossless n={len(values)} returned={len(result)}")
    assert len(result) == len(values)
    assert result[0]["value"] == pytest.approx(0.01, abs=1e-6)


# ── 적대 검토 확증 결함의 회귀 잠금 (task#303 in-run fix, CONFIRMED HIGH x3 + MED) ──

def _pts(vals):
    return [{"date": f"2025-{1 + i // 28:02d}-{1 + i % 28:02d}", "value": float(v)}
            for i, v in enumerate(vals)]


def test_filter_outliers_drops_nonpositive_points():
    """0·음수 점은 어느 위치에서도 이상치다. 옛 중앙값 필터는 median>0인 한 v<=0을 항상
    배제했으므로, 새 국소 판정이 이를 놓치면 **신규 사각**이 된다(적대 검토 HIGH).
    yfinance 결측이 0.0으로 들어오는 경로가 실재한다."""
    from services.market_indicators.cache import _filter_outliers
    cases = {
        "leading_zero": _pts([0.0] + [100.0 + i * 0.5 for i in range(20)]),
        "mid_zero": _pts([100.0 + i * 0.5 for i in range(10)] + [0.0] + [105.0 + i * 0.5 for i in range(10)]),
        "mid_negative": _pts([100.0 + i * 0.5 for i in range(10)] + [-50.0] + [105.0 + i * 0.5 for i in range(10)]),
    }
    for name, pts in cases.items():
        kept = _filter_outliers(pts)
        vals = [p["value"] for p in kept]
        print(f"[coverage] nonpositive:{name} n={len(pts)} kept={len(kept)}")
        assert all(v > 0 for v in vals), f"{name}: 비양수 점이 살아남았다 -> {[v for v in vals if v <= 0]}"
        assert len(kept) == len(pts) - 1, f"{name}: {len(pts)} -> {len(kept)} (기대 {len(pts) - 1})"


def test_filter_outliers_drops_leading_garbage_run():
    """선두 쓰레기가 **2점 연속**이면 그 둘이 서로 정합해버려 '이웃 정합' 조건이 무력화된다
    — 원 버그(9dedc01·f7b5a21)가 정확히 이 변형으로 재발한다(적대 검토 HIGH).
    선두 런 판정(_LEAD_ABSURD_RATIO)이 그것을 막는다."""
    from services.market_indicators.cache import _filter_outliers
    pts = _pts([0.01, 0.01] + [100.0 + i * 0.5 for i in range(20)])
    kept = _filter_outliers(pts)
    print(f"[coverage] leading_run n={len(pts)} kept={len(kept)}")
    assert len(kept) == 20, f"선두 쓰레기 2점이 생존했다: {[p['value'] for p in kept[:3]]}"
    assert min(p["value"] for p in kept) >= 100.0


def test_filter_outliers_lead_guard_spares_sustained_move():
    """선두 런 판정이 지속 이동의 첫 점을 먹지 않는다 — ^IRX는 중앙값 대비 12배까지
    벌어지므로 임계 50배가 그 사이에 있어야 한다(이 축이 없으면 위 가드가 B60을 재발시킨다)."""
    from services.market_indicators.cache import _filter_outliers
    pts = _pts([0.03 * (150 ** (i / 249)) for i in range(250)])
    kept = _filter_outliers(pts)
    print(f"[coverage] lead_guard_vs_ramp n={len(pts)} kept={len(kept)}")
    assert len(kept) == 250, f"지속 이동에서 {250 - len(kept)}점이 잘렸다"


def test_raw_history_never_leaks_into_api_response():
    """저장 전용 raw 필드는 응답에 실리지 않는다 — 라우터가 이 dict를 그대로 반환하므로
    새면 ADR-0040이 가리기로 한 쓰레기 점이 공개 API로 나가고 응답 shape도 바뀐다
    (계획 비목표 위반, 적대 검토 HIGH). treasury의 _raw_histories는 **기존 키**라 대상이 아니다."""
    from services.market_indicators import fx as fx_mod
    from services.market_indicators import commodities as com_mod
    checked = 0
    with patch.object(fx_mod, "_get_cache", return_value=None), \
         patch.object(fx_mod, "_mc_load", return_value=None), \
         patch.object(fx_mod, "_mc_save"), patch.object(fx_mod, "_set_cache"), \
         patch.object(fx_mod, "_yf_close_history",
                      return_value=_pts([0.01] + [1300.0 + i for i in range(20)])):
        resp = fx_mod.get_fx()
        checked += 1
        assert "_raw_history" not in resp, f"get_fx 응답에 raw 누출: {sorted(resp)}"
        assert all(p["value"] > 1.0 for p in resp["history"]["usdkrw"]), "표시본에 쓰레기 점이 남았다"
        vix = fx_mod.get_vix()
        checked += 1
        assert "_raw_history" not in vix, f"get_vix 응답에 raw 누출: {sorted(vix)}"
    with patch.object(com_mod, "_get_cache", return_value=None), \
         patch.object(com_mod, "_mc_load", return_value=None), \
         patch.object(com_mod, "_mc_save"), patch.object(com_mod, "_set_cache"), \
         patch.object(com_mod, "_yf_close_history",
                      return_value=_pts([0.01] + [100.0 + i for i in range(20)])):
        resp = com_mod.get_commodities()
        checked += 1
        assert "_raw_history" not in resp, f"get_commodities 응답에 raw 누출: {sorted(resp)}"
    print(f"[coverage] raw_leak endpoints={checked}")
    assert checked == 3


def test_public_strips_only_new_raw_key():
    """_public은 신규 키(_raw_history)만 벗긴다 — 기존 키(_raw_histories)를 없애는 것도
    응답 shape 변경이다."""
    from services.market_indicators.cache import _public
    out = _public({"rates": 1, "history": 2, "_raw_history": 3, "_raw_histories": 4})
    assert out == {"rates": 1, "history": 2, "_raw_histories": 4}

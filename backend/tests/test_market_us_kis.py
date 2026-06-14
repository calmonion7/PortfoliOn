"""US 현재가 KIS 백업 폴백 (yfinance→KIS, .forge/adr/0011, Part 2)."""
from unittest.mock import patch, MagicMock
import pandas as pd
from services import market


def _yf_ok(price=190.0):
    m = MagicMock()
    m.info = {"currentPrice": price, "shortName": "Apple Inc.", "marketCap": 3_000_000,
              "sector": "Technology", "industry": "Consumer Electronics"}
    m.history.return_value = pd.DataFrame({"Close": [180.0, 185.0, 188.0, 189.0, 190.0]})
    return m


def _yf_no_price():
    m = MagicMock()
    m.info = {}
    m.history.return_value = pd.DataFrame({"Close": []})
    return m


def test_us_uses_yfinance_when_ok_kis_not_called():
    with patch("services.kis.quote.get_quote_us") as kis_call:
        q = market._get_quote_uncached("AAPL", "US", _t=_yf_ok(190.0))
    assert q["price"] == 190.0
    assert q["name"] == "Apple Inc."
    kis_call.assert_not_called()             # yfinance 정상 → KIS 미호출


def test_us_falls_back_to_kis_when_yfinance_no_price():
    kis_norm = {"price": 191.5, "prev_close": 189.0, "daily_change_pct": 1.32}
    with patch("services.kis.client.configured", return_value=True), \
         patch("services.kis.quote.get_quote_us", return_value=kis_norm):
        q = market._get_quote_uncached("AAPL", "US", _t=_yf_no_price())
    assert q["price"] == 191.5              # yfinance 무시세 → KIS 백업
    assert q["prev_close"] == 189.0
    assert q["daily_change_pct"] == 1.32
    assert q["daily_change"] == "+1.32%"
    assert q["market"] == "US"
    assert q["name"] == "AAPL"               # KIS 해외엔 종목명 없음 → 티커


def test_us_falls_back_to_kis_when_yfinance_raises():
    kis_norm = {"price": 55.0, "prev_close": 54.0, "daily_change_pct": 1.85}
    with patch("services.market.yf.Ticker", side_effect=RuntimeError("yf 장애")), \
         patch("services.kis.client.configured", return_value=True), \
         patch("services.kis.quote.get_quote_us", return_value=kis_norm):
        q = market._get_quote_uncached("XYZ", "US")
    assert q["price"] == 55.0               # yfinance 예외 → KIS 백업
    assert "error" not in q


def test_us_error_dict_when_yfinance_fails_and_kis_unconfigured():
    with patch("services.market.yf.Ticker", side_effect=RuntimeError("yf 장애")), \
         patch("services.kis.client.configured", return_value=False):
        q = market._get_quote_uncached("XYZ", "US")
    assert q["price"] is None               # yfinance 실패 + KIS 미설정 → 에러 dict
    assert q.get("error") == "yf 장애"


def test_us_error_dict_when_yfinance_and_kis_both_fail():
    with patch("services.market.yf.Ticker", side_effect=RuntimeError("yf 장애")), \
         patch("services.kis.client.configured", return_value=True), \
         patch("services.kis.quote.get_quote_us", return_value={"price": None, "prev_close": None, "daily_change_pct": None}):
        q = market._get_quote_uncached("XYZ", "US")
    assert q["price"] is None               # KIS도 빈값 → 에러 dict로 폴
    assert "error" in q

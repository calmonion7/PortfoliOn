"""get_quote_kr 키움 우선 + Naver 폴백 동작 (S3)."""
from unittest.mock import patch, MagicMock
import pandas as pd


def _patch_yf():
    # yfinance 보강 블록이 네트워크를 타지 않게 빈 히스토리로 mock
    m = MagicMock()
    m.history.return_value = pd.DataFrame({"Close": []})
    m.info = {}
    return patch("services.market.yf.Ticker", return_value=m)


def test_get_quote_kr_uses_kiwoom_when_available():
    kiwoom_norm = {"price": 75000.0, "daily_change_pct": 2.04, "prev_close": 73500,
                   "market_cap": 24352 * 10**8, "name": "삼성전자"}
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.quote.get_quote", return_value=kiwoom_norm):
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 75000.0
    assert q["daily_change_pct"] == 2.04
    assert q["name"] == "삼성전자"
    assert q["market"] == "KR"


def test_get_quote_kr_falls_back_to_naver_when_kiwoom_unconfigured():
    naver_basic = {"closePrice": "60000", "compareToPreviousClosePrice": "1000",
                   "fluctuationsRatio": "1.69", "marketValue": "100000", "stockName": "폴백종목"}
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=False), \
         patch("services.market._naver_get", return_value=naver_basic):
        from services import market
        q = market.get_quote_kr("000660")
    assert q["price"] == 60000.0
    assert q["name"] == "폴백종목"
    assert q["daily_change_pct"] == 1.69


def test_get_quote_kr_falls_back_when_kiwoom_raises():
    naver_basic = {"closePrice": "50000", "compareToPreviousClosePrice": "-500",
                   "fluctuationsRatio": "-0.99", "marketValue": "80000", "stockName": "에러폴백"}
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.quote.get_quote", side_effect=RuntimeError("키움 장애")), \
         patch("services.market._naver_get", return_value=naver_basic):
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 50000.0          # 키움 예외 → Naver 폴백
    assert q["name"] == "에러폴백"

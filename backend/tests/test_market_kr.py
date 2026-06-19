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
         patch("services.market.kr._naver_get", return_value=naver_basic):
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
         patch("services.kis.client.configured", return_value=False), \
         patch("services.market.kr._naver_get", return_value=naver_basic):
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 50000.0          # 키움 예외 + KIS 미설정 → Naver 폴백
    assert q["name"] == "에러폴백"


# ── KIS 백업 폴백: 키움 → KIS → Naver (.forge/adr/0011) ──
def test_get_quote_kr_uses_kis_when_kiwoom_fails():
    # 키움 실패(None) → KIS 백업이 응답 → Naver 미호출
    kis_norm = {"price": 64000.0, "daily_change_pct": -1.23, "prev_close": 64800,
                "market_cap": 12000 * 10**8, "name": None}
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.quote.get_quote", side_effect=RuntimeError("키움 장애")), \
         patch("services.kis.client.configured", return_value=True), \
         patch("services.kis.quote.get_quote_kr", return_value=kis_norm) as kis_call, \
         patch("services.market.kr._naver_get") as naver_call:
        from services import market
        q = market.get_quote_kr("000660")
    assert q["price"] == 64000.0
    assert q["daily_change_pct"] == -1.23
    assert q["name"] == "000660"          # KIS엔 종목명 없음 → 티커 유지(resolve_name이 후처리)
    kis_call.assert_called_once()
    naver_call.assert_not_called()        # KIS가 답했으므로 Naver 미호출


def test_get_quote_kr_skips_kis_when_kiwoom_ok():
    # 키움 성공 → KIS/Naver 둘 다 미호출
    kiwoom_norm = {"price": 75000.0, "daily_change_pct": 2.04, "prev_close": 73500,
                   "market_cap": 24352 * 10**8, "name": "삼성전자"}
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.quote.get_quote", return_value=kiwoom_norm), \
         patch("services.kis.quote.get_quote_kr") as kis_call, \
         patch("services.market.kr._naver_get") as naver_call:
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 75000.0
    kis_call.assert_not_called()
    naver_call.assert_not_called()


def test_get_quote_kr_kis_to_naver_when_kis_also_fails():
    # 키움 실패 + KIS 실패 → Naver 폴백
    naver_basic = {"closePrice": "30000", "compareToPreviousClosePrice": "300",
                   "fluctuationsRatio": "1.01", "marketValue": "5000", "stockName": "최종폴백"}
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.quote.get_quote", side_effect=RuntimeError("키움 장애")), \
         patch("services.kis.client.configured", return_value=True), \
         patch("services.kis.quote.get_quote_kr", side_effect=RuntimeError("KIS 장애")), \
         patch("services.market.kr._naver_get", return_value=naver_basic):
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 30000.0
    assert q["name"] == "최종폴백"

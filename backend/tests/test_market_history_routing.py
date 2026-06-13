"""get_history_df 마켓 라우팅 + get_timeframe_rsi 키움/yfinance 분기 (Phase 2 part 1, S4)."""
from unittest.mock import patch, MagicMock
import pandas as pd


def _df(closes):
    idx = pd.date_range("2025-01-01", periods=len(closes), freq="D")
    return pd.DataFrame({"Open": closes, "High": [c + 1 for c in closes],
                         "Low": [c - 1 for c in closes], "Close": closes,
                         "Volume": [100] * len(closes)}, index=idx)


def test_get_history_df_kr_uses_kiwoom_when_configured():
    from services import market
    kdf = _df([100, 110, 120])
    with patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.chart.history_df", return_value=kdf) as m:
        out = market.get_history_df("005930", "KR", "KS", "daily")
    assert m.called
    assert list(out["Close"]) == [100, 110, 120]


def test_get_history_df_kr_falls_back_to_yfinance_when_kiwoom_empty():
    from services import market
    ydf = _df([50, 55])
    yt = MagicMock(); yt.history.return_value = ydf
    with patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.chart.history_df", return_value=pd.DataFrame()), \
         patch("services.market.yf.Ticker", return_value=yt):
        out = market.get_history_df("005930", "KR", "KS", "daily")
    assert list(out["Close"]) == [50, 55]  # 키움 빈 결과 → yfinance 폴백


def test_get_history_df_us_uses_yfinance():
    from services import market
    ydf = _df([200, 210])
    yt = MagicMock(); yt.history.return_value = ydf
    with patch("services.market.yf.Ticker", return_value=yt) as m:
        out = market.get_history_df("AAPL", "US", "", "weekly")
    assert m.called and list(out["Close"]) == [200, 210]


def test_get_timeframe_rsi_routes_through_get_history_df():
    from services import indicators
    # 충분한 길이의 단조 시리즈 → RSI 계산 성공
    closes = list(range(100, 140))
    with patch("services.market.get_history_df", return_value=_df(closes)) as m:
        out = indicators.get_timeframe_rsi("005930", "KR", "KS")
    assert m.called
    assert set(out.keys()) == {"daily", "weekly", "monthly"}
    assert out["daily"]["rsi"] is not None

"""키움 OHLC 차트 정규화 단위테스트 (Phase 2 part 1, S1)."""
import pandas as pd
from services.kiwoom.chart import _num, normalize_bars, history_df


def test_num_sign_comma_empty():
    assert _num("+600") == 600.0
    assert _num("-152000") == -152000.0
    assert _num("1,234") == 1234.0
    assert _num("") is None and _num("-") is None and _num(None) is None


def _rows():
    # 키움은 최신→과거 순으로 내려줌(역순). 정규화는 오름차순 정렬해야.
    return [
        {"dt": "20250908", "cur_prc": "70100", "open_pric": "69800", "high_pric": "70500",
         "low_pric": "69600", "trde_qty": "9263135", "trde_prica": "648525", "pred_pre": "+600"},
        {"dt": "20250905", "cur_prc": "69500", "open_pric": "70300", "high_pric": "70400",
         "low_pric": "69500", "trde_qty": "11526724", "trde_prica": "804642", "pred_pre": "-600"},
    ]


def test_normalize_bars_sorts_ascending_and_abs():
    bars = normalize_bars(_rows())
    assert [b["date"] for b in bars] == ["20250905", "20250908"]  # 오름차순
    last = bars[-1]
    assert last["close"] == 70100.0 and last["open"] == 69800.0
    assert last["high"] == 70500.0 and last["low"] == 69600.0
    assert last["volume"] == 9263135.0


def test_normalize_bars_abs_on_signed_price():
    # 일부 응답은 가격에 부호가 붙음 → 절대값
    rows = [{"dt": "20250101", "cur_prc": "-152000", "open_pric": "-151000",
             "high_pric": "-153000", "low_pric": "-150000", "trde_qty": "100"}]
    b = normalize_bars(rows)[0]
    assert b["close"] == 152000.0 and b["open"] == 151000.0


def test_normalize_bars_drops_rows_without_date_or_close():
    rows = [{"dt": "", "cur_prc": "100"}, {"dt": "20250101", "cur_prc": ""}]
    assert normalize_bars(rows) == []


def test_history_df_shape(monkeypatch):
    # fetch_bars를 목으로 대체해 DataFrame 형태(yfinance history 동형) 검증
    import services.kiwoom.chart as ch
    monkeypatch.setattr(ch, "fetch_bars", lambda *a, **k: ch.normalize_bars(_rows()))
    df = history_df("005930", "daily")
    assert list(df.columns) == ["Open", "High", "Low", "Close", "Volume"]
    assert isinstance(df.index, pd.DatetimeIndex)
    assert df["Close"].iloc[-1] == 70100.0  # 최신이 마지막(오름차순)


def test_fetch_bars_truncates_to_recent_max_items(monkeypatch):
    # 1콜에 max_items보다 많이 와도 "최근 max_items개"로 절단 (ytd 기간 오산출 방지)
    import services.kiwoom.chart as ch
    rows = [{"dt": f"202501{str(i).zfill(2)}", "cur_prc": str(100 + i)} for i in range(1, 40)]
    monkeypatch.setattr(ch.client, "request_paged", lambda *a, **k: rows)
    bars = ch.fetch_bars("005930", "daily", base_dt="20250201", max_items=10)
    assert len(bars) == 10
    assert bars[-1]["date"] == "20250139"  # 오름차순 최근(가장 큰 날짜)
    assert bars[0]["date"] == "20250130"

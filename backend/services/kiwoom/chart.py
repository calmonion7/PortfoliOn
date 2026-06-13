"""KR OHLC 차트 TR — ka10081(일봉)/ka10082(주봉)/ka10083(월봉) 조회·정규화·DataFrame 어댑터.

report_generator/indicators가 쓰는 yfinance `history()`와 동형 DataFrame(DatetimeIndex,
Open/High/Low/Close/Volume)을 만들어 KR 가격 히스토리를 키움으로 공급한다.
키움 실패 시 호출측이 yfinance로 폴백(경계: .forge/adr/0009).
"""
from __future__ import annotations
import datetime as _dt
import pandas as pd
from services.kiwoom import client

# timeframe → (api_id, 응답 LIST 키). 세 TR은 구조 동일, LIST 키만 다름.
_TF = {
    "daily":   ("ka10081", "stk_dt_pole_chart_qry"),
    "weekly":  ("ka10082", "stk_stk_pole_chart_qry"),
    "monthly": ("ka10083", "stk_mth_pole_chart_qry"),
}


def _num(val) -> float | None:
    if val is None:
        return None
    s = str(val).strip().replace(",", "")
    if s in ("", "-", "+"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def normalize_bars(rows: list) -> list[dict]:
    """ka1008x LIST → 일자 오름차순(과거→현재) OHLCV dict 리스트. 가격은 절대값(부호 제거)."""
    out = []
    for r in rows:
        dt = (r.get("dt") or "").strip()
        close = _num(r.get("cur_prc"))
        if not dt or close is None:
            continue
        o, h, l = _num(r.get("open_pric")), _num(r.get("high_pric")), _num(r.get("low_pric"))
        out.append({
            "date": dt,
            "open": abs(o) if o is not None else None,
            "high": abs(h) if h is not None else None,
            "low": abs(l) if l is not None else None,
            "close": abs(close),
            "volume": _num(r.get("trde_qty")),
        })
    out.sort(key=lambda x: x["date"])
    return out


def fetch_bars(stk_cd: str, timeframe: str, base_dt: str | None = None,
               max_items: int = 1000) -> list[dict]:
    """timeframe(daily/weekly/monthly) OHLCV 리스트(과거→현재). base_dt 미지정 시 오늘 기준."""
    api_id, list_key = _TF[timeframe]
    base_dt = base_dt or _dt.date.today().strftime("%Y%m%d")
    rows = client.request_paged(
        api_id, {"stk_cd": stk_cd, "base_dt": base_dt, "upd_stkpc_tp": "1"},
        "chart", list_key, max_items,
    )
    bars = normalize_bars(rows)
    # 한 페이지가 max_items보다 크게 와도(키움은 1콜 600개) "최근 max_items개"로 절단.
    # ytd_return(start=bars[0]) 등 시작점 기준 계산이 의도한 기간을 넘지 않도록.
    return bars[-max_items:] if max_items and len(bars) > max_items else bars


def history_df(stk_cd: str, timeframe: str = "daily", base_dt: str | None = None,
               max_items: int = 1000) -> pd.DataFrame:
    """yfinance `history()`와 동형 DataFrame(DatetimeIndex, Open/High/Low/Close/Volume)."""
    bars = fetch_bars(stk_cd, timeframe, base_dt, max_items)
    cols = ["Open", "High", "Low", "Close", "Volume"]
    if not bars:
        return pd.DataFrame(columns=cols)
    df = pd.DataFrame(bars)
    df.index = pd.to_datetime(df["date"], format="%Y%m%d")
    return df.rename(columns={"open": "Open", "high": "High", "low": "Low",
                              "close": "Close", "volume": "Volume"})[cols]


def daily_closes(stk_cd: str, base_dt: str | None = None, max_items: int = 60) -> list[float]:
    """일봉 종가 시리즈(과거→현재). get_quotes_batch의 _changes_from_closes용(monthly index -23 필요)."""
    return [b["close"] for b in fetch_bars(stk_cd, "daily", base_dt, max_items) if b["close"] is not None]

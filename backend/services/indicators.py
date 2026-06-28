from __future__ import annotations
import pandas as pd
import numpy as np

def calc_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def calc_ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()

def get_support_resistance(df: pd.DataFrame) -> dict:
    import math
    _none = {"week52_high": None, "week52_low": None, "ema20": None, "ema50": None, "ema200": None}
    if df.empty or "Close" not in df.columns:
        return _none
    close = df["Close"].dropna()
    if close.empty:
        return _none

    def _fin(v):
        try:
            f = float(v)
            return round(f, 2) if math.isfinite(f) else None
        except (TypeError, ValueError):
            return None

    high = df["High"].dropna() if "High" in df.columns else close
    low  = df["Low"].dropna()  if "Low"  in df.columns else close
    return {
        "week52_high": _fin(high.tail(252).max()),
        "week52_low":  _fin(low.tail(252).min()),
        "ema20":  _fin(calc_ema(close, 20).iloc[-1]),
        "ema50":  _fin(calc_ema(close, 50).iloc[-1]),
        "ema200": _fin(calc_ema(close, 200).iloc[-1]),
    }


def calc_trend_summary(df: pd.DataFrame) -> dict:
    """Price/EMA trend summary. Pure calc — no I/O."""
    import math
    _none = {"above_ema20": None, "above_ema50": None, "above_ema200": None,
             "return_30d": None, "golden_cross": None, "dead_cross": None}
    if df.empty or "Close" not in df.columns:
        return _none
    close = df["Close"].dropna()
    if len(close) < 2:
        return _none

    def _fin(v):
        try:
            f = float(v)
            return f if math.isfinite(f) else None
        except (TypeError, ValueError):
            return None

    price = _fin(close.iloc[-1])
    if price is None:
        return _none

    e20  = calc_ema(close, 20)
    e50  = calc_ema(close, 50)
    e200 = calc_ema(close, 200)

    def _above(ema_series):
        v = _fin(ema_series.iloc[-1])
        return (price > v) if v is not None else None

    # 30-day return: close[-1] / close[-31] - 1
    return_30d = None
    if len(close) >= 31:
        p30 = _fin(close.iloc[-31])
        if p30 and p30 > 0:
            r = (price / p30) - 1.0
            return_30d = round(r * 100, 2) if math.isfinite(r) else None

    # golden/dead cross: did ema50 cross ema200 in last ~30 bars?
    golden_cross = dead_cross = None
    n = min(30, len(e50) - 1)
    if n >= 1:
        cur50  = _fin(e50.iloc[-1]);   cur200  = _fin(e200.iloc[-1])
        prev50 = _fin(e50.iloc[-1-n]); prev200 = _fin(e200.iloc[-1-n])
        if all(v is not None for v in (cur50, cur200, prev50, prev200)):
            golden_cross = bool(cur50 > cur200 and prev50 <= prev200)
            dead_cross   = bool(cur50 < cur200 and prev50 >= prev200)

    return {
        "above_ema20":  _above(e20),
        "above_ema50":  _above(e50),
        "above_ema200": _above(e200),
        "return_30d":   return_30d,
        "golden_cross": golden_cross,
        "dead_cross":   dead_cross,
    }


def calc_beta(stock_returns: pd.Series, index_returns: pd.Series, min_obs: int = 20) -> float | None:
    """OLS beta = cov(stock, index) / var(index). None if insufficient/zero-var."""
    import math
    aligned = pd.concat([stock_returns, index_returns], axis=1).dropna()
    aligned.columns = ["s", "i"]
    if len(aligned) < min_obs:
        return None
    var_i = float(aligned["i"].var())
    if not math.isfinite(var_i) or var_i == 0:
        return None
    cov = float(aligned["s"].cov(aligned["i"]))
    if not math.isfinite(cov):
        return None
    return round(cov / var_i, 4)


def calc_hv(returns: pd.Series, min_obs: int = 10) -> float | None:
    """Historical volatility = stdev(daily returns) * sqrt(252)."""
    import math
    clean = returns.dropna()
    if len(clean) < min_obs:
        return None
    std = float(clean.std())
    if not math.isfinite(std):
        return None
    hv = std * math.sqrt(252)
    return round(hv, 6) if math.isfinite(hv) else None

def calc_rsi_target_price(
    prices: pd.Series, rsi_values: pd.Series, target_rsi: float, n: int = 30,
    period: int = 14,
) -> float | None:
    prices = prices.dropna()
    if len(prices) < period + 1:
        return None

    delta = prices.diff()
    gain  = delta.clip(lower=0)
    loss  = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()

    AG = float(avg_gain.iloc[-1])
    AL = float(avg_loss.iloc[-1])

    if np.isnan(AG) or np.isnan(AL):
        return None

    cur_price = float(prices.iloc[-1])
    RS_target = target_rsi / (100.0 - target_rsi)
    factor = period - 1
    current_rs = AG / AL if AL > 0 else float("inf")

    if RS_target >= current_rs:
        delta_p = factor * (AL * RS_target - AG)
    else:
        delta_p = factor * (AL - AG / RS_target)

    result = cur_price + delta_p
    if result > 0:
        return round(result, 2)
    return None

def get_timeframe_rsi(ticker: str, market: str = "US", exchange: str = "") -> dict:
    # KR은 키움(ka10081/82/83) 우선, 그 외/폴백은 yfinance — market.get_history_df가 라우팅.
    from services import market as mkt
    result = {}
    configs = [
        ("daily",   30),
        ("weekly",  60),
        ("monthly", 60),
    ]
    for tf, n in configs:
        try:
            df = mkt.get_history_df(ticker, market, exchange, tf)
            if df.empty:
                result[tf] = {
                    "rsi": None,
                    "target_20": None, "target_25": None, "target_30": None,
                    "target_70": None, "target_75": None, "target_80": None,
                }
                continue
            rsi = calc_rsi(df["Close"])
            current_rsi = round(float(rsi.iloc[-1]), 2)
            t20 = calc_rsi_target_price(df["Close"], rsi, 20.0, n)
            t25 = calc_rsi_target_price(df["Close"], rsi, 25.0, n)
            t30 = calc_rsi_target_price(df["Close"], rsi, 30.0, n)
            t70 = calc_rsi_target_price(df["Close"], rsi, 70.0, n)
            t75 = calc_rsi_target_price(df["Close"], rsi, 75.0, n)
            t80 = calc_rsi_target_price(df["Close"], rsi, 80.0, n)
            # 단조성 검증: t20 <= t25 <= t30, t70 <= t75 <= t80
            if t20 is not None and t25 is not None and t20 > t25:
                t20 = None
            if t25 is not None and t30 is not None and t25 > t30:
                t25 = None
            if t70 is not None and t75 is not None and t70 > t75:
                t75 = None
            if t75 is not None and t80 is not None and t75 > t80:
                t80 = None
            result[tf] = {
                "rsi": current_rsi,
                "target_20": t20, "target_25": t25, "target_30": t30,
                "target_70": t70, "target_75": t75, "target_80": t80,
            }
        except Exception:
            result[tf] = {
                "rsi": None,
                "target_20": None, "target_25": None, "target_30": None,
                "target_70": None, "target_75": None, "target_80": None,
            }
    return result

def get_volume_profile(df: pd.DataFrame, bins: int = 50) -> dict:
    empty = {"poc": None, "hvn": [], "lvn": []}
    if bins < 2:
        return empty
    if df.empty or "Close" not in df.columns or "Volume" not in df.columns:
        return empty
    data = df[["Close", "Volume"]].dropna()
    if len(data) < 10:
        return empty
    prices = data["Close"].values
    volumes = data["Volume"].values
    min_p, max_p = prices.min(), prices.max()
    if max_p <= min_p:
        return empty

    bin_edges = np.linspace(min_p, max_p, bins + 1)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
    indices = np.clip(np.searchsorted(bin_edges[1:], prices), 0, bins - 1)
    bin_volumes = np.bincount(indices, weights=volumes, minlength=bins).astype(float)

    poc_idx = int(np.argmax(bin_volumes))
    poc = round(float(bin_centers[poc_idx]), 2)

    target_vol = float(bin_volumes.sum()) * 0.70
    area_vol = float(bin_volumes[poc_idx])
    lo_idx, hi_idx = poc_idx, poc_idx
    while area_vol < target_vol:
        can_up = hi_idx + 1 < bins
        can_dn = lo_idx - 1 >= 0
        if not can_up and not can_dn:
            break
        up_vol = float(bin_volumes[hi_idx + 1]) if can_up else -1.0
        dn_vol = float(bin_volumes[lo_idx - 1]) if can_dn else -1.0
        if up_vol >= dn_vol:
            hi_idx += 1
            area_vol += up_vol
        else:
            lo_idx -= 1
            area_vol += dn_vol
    vah = round(float(bin_edges[hi_idx + 1]), 2)
    val = round(float(bin_edges[lo_idx]), 2)

    hvn_indices: list[int] = []
    for idx in np.argsort(bin_volumes)[::-1]:
        if len(hvn_indices) >= 3:
            break
        if not any(abs(int(idx) - h) <= 1 for h in hvn_indices):
            hvn_indices.append(int(idx))
    hvn = sorted([round(float(bin_centers[i]), 2) for i in hvn_indices])

    lvn: list[float] = []
    if len(hvn) >= 2:
        active = bin_volumes[bin_volumes > 0]
        threshold = float(np.percentile(active, 20)) if len(active) > 0 else 0.0
        lo, hi = min(hvn), max(hvn)
        lvn = sorted([
            round(float(bin_centers[i]), 2)
            for i in range(bins)
            if 0 < bin_volumes[i] <= threshold and lo < bin_centers[i] < hi
        ])

    return {"poc": poc, "vah": vah, "val": val, "hvn": hvn, "lvn": lvn}

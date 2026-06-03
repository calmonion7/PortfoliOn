from __future__ import annotations
import pandas as pd
import numpy as np
import yfinance as yf

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
    close = df["Close"]
    return {
        "week52_high": round(float(df["High"].tail(252).max()), 2),
        "week52_low": round(float(df["Low"].tail(252).min()), 2),
        "ema20": round(float(calc_ema(close, 20).iloc[-1]), 2),
        "ema50": round(float(calc_ema(close, 50).iloc[-1]), 2),
        "ema200": round(float(calc_ema(close, 200).iloc[-1]), 2),
    }

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

def get_timeframe_rsi(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    result = {}
    configs = [
        ("daily",   {"period": "1y",  "interval": "1d"},  30),
        ("weekly",  {"period": "5y",  "interval": "1wk"}, 60),
        ("monthly", {"period": "10y", "interval": "1mo"}, 60),
    ]
    for tf, params, n in configs:
        try:
            df = t.history(**params)
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

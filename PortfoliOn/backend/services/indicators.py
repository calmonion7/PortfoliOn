import pandas as pd
import numpy as np
import yfinance as yf

def calc_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
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
    prices: pd.Series, rsi_values: pd.Series, target_rsi: float, n: int = 30
) -> float | None:
    prices = prices.dropna()
    rsi_values = rsi_values.dropna()
    n = min(len(prices), len(rsi_values), n)
    if n < 5:
        return None
    p = prices.iloc[-n:].values
    r = rsi_values.iloc[-n:].values
    coeffs = np.polyfit(r, p, 1)
    # RSI와 가격은 양의 상관관계여야 함 — 기울기가 0 이하면 회귀 신뢰 불가
    if coeffs[0] <= 0:
        return None
    result = round(float(np.polyval(coeffs, target_rsi)), 2)
    # 음수 또는 현재가의 10% 미만 — 극단 외삽 무효
    current_price = float(prices.iloc[-1])
    if result <= 0 or result < current_price * 0.1:
        return None
    current_rsi = float(rsi_values.iloc[-1])
    # 방향 검증: RSI 목표가 현재보다 높으면 가격도 높아야 하고, 낮으면 낮아야 함
    if target_rsi > current_rsi and result < current_price:
        return None
    if target_rsi < current_rsi and result > current_price:
        return None
    return result

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
            result[tf] = {
                "rsi": current_rsi,
                "target_20": calc_rsi_target_price(df["Close"], rsi, 20.0, n),
                "target_25": calc_rsi_target_price(df["Close"], rsi, 25.0, n),
                "target_30": calc_rsi_target_price(df["Close"], rsi, 30.0, n),
                "target_70": calc_rsi_target_price(df["Close"], rsi, 70.0, n),
                "target_75": calc_rsi_target_price(df["Close"], rsi, 75.0, n),
                "target_80": calc_rsi_target_price(df["Close"], rsi, 80.0, n),
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

    return {"poc": poc, "hvn": hvn, "lvn": lvn}

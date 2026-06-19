from __future__ import annotations
import pandas as pd

_SECTOR_NORM = {
    "Healthcare":            "Health Care",
    "Financial Services":    "Financials",
    "Consumer Cyclical":     "Consumer Discretionary",
    "Consumer Defensive":    "Consumer Staples",
    "Basic Materials":       "Materials",
}

def _norm_sector(s: str) -> str:
    return _SECTOR_NORM.get(s, s) if s else ""


def _n(val) -> float | None:
    if val is None:
        return None
    try:
        return float(str(val).replace(",", ""))
    except (ValueError, TypeError):
        return None


def _to_won(val) -> int | None:
    if val is None:
        return None
    v = _n(val)
    if v is None:
        return None
    return int(v * 1e8) if abs(v) < 1e10 else int(v)


def _yf_val(src, key, col):
    if src is None or src.empty or key not in src.index or col not in src.columns:
        return None
    v = src.loc[key, col]
    return None if v is None or (isinstance(v, float) and pd.isna(v)) else v


def _yf_sym(ticker: str, market: str = "US", exchange: str = "") -> str:
    if market == "KR":
        suffix = exchange if exchange else "KS"
        return f"{ticker}.{suffix}"
    return ticker.replace(".", "-")


def _fmt_price(price, market: str = "US") -> str:
    if price is None:
        return "N/A"
    if market == "KR":
        return f"₩{int(price):,}"
    return f"${float(price):.2f}"


def _fmt_market_cap(mc, market: str = "US") -> str:
    if mc is None:
        return "N/A"
    if market == "KR":
        v = mc / 1e8
        return f"₩{v:,.0f}억" if v < 10000 else f"₩{v/10000:,.1f}조"
    return f"${mc/1e9:.1f}B"

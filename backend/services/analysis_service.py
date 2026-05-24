# backend/services/analysis_service.py
import numpy as np
import pandas as pd
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor

SECTOR_ETFS = [
    {"name": "Technology",             "etf": "XLK"},
    {"name": "Financials",             "etf": "XLF"},
    {"name": "Health Care",            "etf": "XLV"},
    {"name": "Energy",                 "etf": "XLE"},
    {"name": "Industrials",            "etf": "XLI"},
    {"name": "Consumer Discretionary", "etf": "XLY"},
    {"name": "Consumer Staples",       "etf": "XLP"},
    {"name": "Materials",              "etf": "XLB"},
    {"name": "Utilities",              "etf": "XLU"},
    {"name": "Real Estate",            "etf": "XLRE"},
    {"name": "Communication Services", "etf": "XLC"},
]

MACRO_TICKERS = [
    {"label": "미국 10년물 금리", "ticker": "TLT"},
    {"label": "달러 인덱스",     "ticker": "UUP"},
    {"label": "유가",            "ticker": "USO"},
    {"label": "공포 지수",       "ticker": "^VIX"},
]


def _calc_return(closes: pd.Series, days: int):
    if len(closes) < days + 1:
        return None
    return round((float(closes.iloc[-1]) / float(closes.iloc[-days - 1]) - 1) * 100, 2)


def _fetch_etf(entry: dict) -> dict:
    try:
        hist = yf.Ticker(entry["etf"]).history(period="100d")["Close"].dropna()
        return {
            "name": entry["name"],
            "etf": entry["etf"],
            "return_1w": _calc_return(hist, 5),
            "return_1mo": _calc_return(hist, 21),
            "return_3mo": _calc_return(hist, 63),
        }
    except Exception:
        return {"name": entry["name"], "etf": entry["etf"],
                "return_1w": None, "return_1mo": None, "return_3mo": None}


def get_sector_momentum(holdings: list) -> dict:
    with ThreadPoolExecutor(max_workers=11) as ex:
        sectors = list(ex.map(_fetch_etf, SECTOR_ETFS))
    portfolio_sectors = {
        h["ticker"].upper(): h.get("sector") or "기타"
        for h in holdings
    }
    return {"sectors": sectors, "portfolio_sectors": portfolio_sectors}


def _fetch_holding_closes(item: dict):
    ticker = item["ticker"].upper()
    market = item.get("market", "US")
    exchange = item.get("exchange", "")
    qty = item.get("quantity", 0)
    sym = f"{ticker}.{exchange or 'KS'}" if market == "KR" else ticker
    try:
        closes = yf.Ticker(sym).history(period="90d")["Close"].dropna()
        if len(closes) < 20 or not qty:
            return None
        return closes, qty
    except Exception:
        return None


def get_macro_correlation(holdings: list) -> dict:
    with ThreadPoolExecutor(max_workers=30) as ex:
        results = list(ex.map(_fetch_holding_closes, holdings))
    results = [r for r in results if r is not None]

    if not results:
        return {"correlations": [], "scatter": []}

    ret_series = {}
    raw_weights = {}
    for i, (closes, qty) in enumerate(results):
        ret_series[i] = closes.pct_change().dropna()
        raw_weights[i] = qty * float(closes.iloc[-1])

    df = pd.DataFrame(ret_series).dropna()
    if df.empty or len(df) < 10:
        return {"correlations": [], "scatter": []}

    total_w = sum(raw_weights.values())
    if total_w == 0:
        return {"correlations": [], "scatter": []}

    w_arr = np.array([raw_weights[i] / total_w for i in range(len(results))])
    portfolio_ret = pd.Series(df.values @ w_arr, index=df.index)

    correlations = []
    scatter = []

    for m in MACRO_TICKERS:
        try:
            macro_hist = yf.Ticker(m["ticker"]).history(period="90d")["Close"].dropna()
            macro_delta = macro_hist.pct_change().dropna()
            idx = portfolio_ret.index.intersection(macro_delta.index)
            if len(idx) < 10:
                correlations.append({"indicator": m["label"], "ticker": m["ticker"], "corr_90d": None})
                continue
            p = portfolio_ret.loc[idx]
            md = macro_delta.loc[idx]
            corr = round(float(p.corr(md)), 3)
            correlations.append({"indicator": m["label"], "ticker": m["ticker"], "corr_90d": corr})
            for dt, mv, pv in zip(idx, md.values, p.values):
                scatter.append({
                    "date": str(dt.date()),
                    "indicator": m["ticker"],
                    "macro_delta": round(float(mv) * 100, 4),
                    "portfolio_return": round(float(pv) * 100, 4),
                })
        except Exception:
            correlations.append({"indicator": m["label"], "ticker": m["ticker"], "corr_90d": None})

    return {"correlations": correlations, "scatter": scatter}

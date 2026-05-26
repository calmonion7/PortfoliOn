from fastapi import APIRouter, Depends
import math

import yfinance as yf
import pandas as pd

from services import storage, cache as cache_svc
from services.market import _yf_sym
from services.parallel import parallel_map
from auth import get_current_user

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _fetch_closes(item: dict) -> tuple:
    ticker = item["ticker"].upper()
    sym = _yf_sym(ticker, item.get("market", "US"), item.get("exchange", ""))
    try:
        closes = yf.Ticker(sym).history(period="90d")["Close"].dropna()
        if len(closes) < 20:
            return None, None
        return ticker, closes
    except Exception:
        return None, None


@router.get("/correlation")
def get_correlation(user_id: str = Depends(get_current_user)):
    def _build() -> dict:
        holdings = storage.get_holdings(user_id)
        if len(holdings) < 2:
            return {"tickers": [], "matrix": []}

        results = parallel_map(_fetch_closes, holdings, max_workers=10)

        closes_map = {t: s for t, s in results if t is not None}
        if len(closes_map) < 2:
            return {"tickers": [], "matrix": []}

        corr = pd.DataFrame(closes_map).corr()
        tickers = list(corr.columns)
        def _safe(v):
            f = float(v)
            return None if (math.isnan(f) or math.isinf(f)) else round(f, 3)
        matrix = [
            [_safe(corr.loc[t1, t2]) for t2 in tickers]
            for t1 in tickers
        ]
        return {"tickers": tickers, "matrix": matrix}

    return cache_svc.get_correlation(user_id, _build)

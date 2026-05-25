from fastapi import APIRouter, Depends
from concurrent.futures import ThreadPoolExecutor

import yfinance as yf
import pandas as pd

from services import storage, cache as cache_svc
from auth import get_current_user

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _fetch_closes(item: dict) -> tuple:
    ticker = item["ticker"].upper()
    market = item.get("market", "US")
    exchange = item.get("exchange", "")
    sym = f"{ticker}.{exchange or 'KS'}" if market == "KR" else ticker
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
        holdings = storage.get_full_portfolio(user_id).get("stocks", [])
        if len(holdings) < 2:
            return {"tickers": [], "matrix": []}

        with ThreadPoolExecutor(max_workers=30) as executor:
            results = list(executor.map(_fetch_closes, holdings))

        closes_map = {t: s for t, s in results if t is not None}
        if len(closes_map) < 2:
            return {"tickers": [], "matrix": []}

        corr = pd.DataFrame(closes_map).corr()
        tickers = list(corr.columns)
        matrix = [
            [round(float(corr.loc[t1, t2]), 3) for t2 in tickers]
            for t1 in tickers
        ]
        return {"tickers": tickers, "matrix": matrix}

    return cache_svc.get_correlation(user_id, _build)

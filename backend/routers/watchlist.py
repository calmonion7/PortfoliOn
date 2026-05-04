from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List
from services import storage

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


class WatchlistStock(BaseModel):
    ticker: str
    name: str
    competitors: List[str] = []
    moat: str = ""
    growth_plan: str = ""


class PromotePayload(BaseModel):
    quantity: float = Field(..., gt=0)
    avg_cost: float = Field(..., gt=0)


@router.get("")
def get_watchlist():
    tickers = storage.get_watchlist_tickers()
    stocks_by_ticker = {s["ticker"]: s for s in storage.get_stocks()}
    return [
        stocks_by_ticker.get(t, {"ticker": t, "name": t, "competitors": [], "moat": "", "growth_plan": ""})
        for t in tickers
    ]


@router.post("", status_code=201)
def add_watchlist_stock(stock: WatchlistStock):
    holdings = storage.get_holdings()
    watchlist = storage.get_watchlist_tickers()
    all_tickers = [h["ticker"].upper() for h in holdings] + [t.upper() for t in watchlist]
    if stock.ticker.upper() in all_tickers:
        raise HTTPException(status_code=400, detail=f"{stock.ticker} already exists")

    stocks = storage.get_stocks()
    if stock.ticker.upper() not in [s["ticker"].upper() for s in stocks]:
        stocks.append({
            "ticker": stock.ticker.upper(), "name": stock.name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan,
        })
        storage.save_stocks(stocks)

    watchlist.append(stock.ticker.upper())
    storage.save_watchlist_tickers(watchlist)

    return {"ticker": stock.ticker.upper(), "name": stock.name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan}


@router.put("/{ticker}")
def update_watchlist_stock(ticker: str, stock: WatchlistStock):
    watchlist = storage.get_watchlist_tickers()
    if ticker.upper() not in [t.upper() for t in watchlist]:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in watchlist")

    stocks = storage.get_stocks()
    idx = next((i for i, s in enumerate(stocks) if s["ticker"].upper() == ticker.upper()), None)
    if idx is not None:
        stocks[idx] = {
            "ticker": ticker.upper(), "name": stock.name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan,
        }
        storage.save_stocks(stocks)

    return {"ticker": ticker.upper(), "name": stock.name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan}


@router.delete("/{ticker}")
def delete_watchlist_stock(ticker: str):
    upper = ticker.upper()
    watchlist = storage.get_watchlist_tickers()
    if upper not in [t.upper() for t in watchlist]:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in watchlist")

    storage.save_watchlist_tickers([t for t in watchlist if t.upper() != upper])

    holdings = storage.get_holdings()
    if upper not in [h["ticker"].upper() for h in holdings]:
        stocks = storage.get_stocks()
        storage.save_stocks([s for s in stocks if s["ticker"].upper() != upper])

    return {"deleted": upper}


@router.post("/{ticker}/promote")
def promote_to_holdings(ticker: str, payload: PromotePayload):
    upper = ticker.upper()
    watchlist = storage.get_watchlist_tickers()
    if upper not in [t.upper() for t in watchlist]:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in watchlist")

    holdings = storage.get_holdings()
    if upper in [h["ticker"].upper() for h in holdings]:
        raise HTTPException(status_code=400, detail=f"{ticker} already exists in holdings")

    storage.save_watchlist_tickers([t for t in watchlist if t.upper() != upper])

    new_holding = {"ticker": upper, "quantity": payload.quantity, "avg_cost": payload.avg_cost}
    holdings.append(new_holding)
    storage.save_holdings(holdings)

    stocks = storage.get_stocks()
    stock_data = next(
        (s for s in stocks if s["ticker"].upper() == upper),
        {"ticker": upper, "name": upper, "competitors": [], "moat": "", "growth_plan": ""}
    )
    return {**stock_data, "quantity": payload.quantity, "avg_cost": payload.avg_cost}

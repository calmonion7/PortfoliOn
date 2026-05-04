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


def _all_tickers(portfolio: dict) -> list[str]:
    return [s["ticker"].upper() for s in portfolio["stocks"]] + \
           [s["ticker"].upper() for s in portfolio["watchlist"]]


@router.get("")
def get_watchlist():
    return storage.get_portfolio()["watchlist"]


@router.post("", status_code=201)
def add_watchlist_stock(stock: WatchlistStock):
    portfolio = storage.get_portfolio()
    if stock.ticker.upper() in _all_tickers(portfolio):
        raise HTTPException(status_code=400, detail=f"{stock.ticker} already exists")
    portfolio["watchlist"].append({**stock.model_dump(), "ticker": stock.ticker.upper()})
    storage.save_portfolio(portfolio)
    return portfolio["watchlist"][-1]


@router.put("/{ticker}")
def update_watchlist_stock(ticker: str, stock: WatchlistStock):
    portfolio = storage.get_portfolio()
    idx = next(
        (i for i, s in enumerate(portfolio["watchlist"])
         if s["ticker"].upper() == ticker.upper()),
        None,
    )
    if idx is None:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in watchlist")
    portfolio["watchlist"][idx] = {**stock.model_dump(), "ticker": ticker.upper()}
    storage.save_portfolio(portfolio)
    return portfolio["watchlist"][idx]


@router.delete("/{ticker}")
def delete_watchlist_stock(ticker: str):
    portfolio = storage.get_portfolio()
    original_len = len(portfolio["watchlist"])
    portfolio["watchlist"] = [
        s for s in portfolio["watchlist"] if s["ticker"].upper() != ticker.upper()
    ]
    if len(portfolio["watchlist"]) == original_len:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in watchlist")
    storage.save_portfolio(portfolio)
    return {"deleted": ticker.upper()}


@router.post("/{ticker}/promote")
def promote_to_holdings(ticker: str, payload: PromotePayload):
    portfolio = storage.get_portfolio()
    watch_idx = next(
        (i for i, s in enumerate(portfolio["watchlist"])
         if s["ticker"].upper() == ticker.upper()),
        None,
    )
    if watch_idx is None:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in watchlist")
    stock_tickers = [s["ticker"].upper() for s in portfolio["stocks"]]
    if ticker.upper() in stock_tickers:
        raise HTTPException(status_code=400, detail=f"{ticker} already exists in holdings")
    watch_stock = portfolio["watchlist"].pop(watch_idx)
    new_stock = {**watch_stock, "quantity": payload.quantity, "avg_cost": payload.avg_cost}
    portfolio["stocks"].append(new_stock)
    storage.save_portfolio(portfolio)
    return new_stock

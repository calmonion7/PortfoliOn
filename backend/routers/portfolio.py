from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
from services import storage
from routers import calendar as calendar_router

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


class Stock(BaseModel):
    ticker: str
    name: str
    quantity: float
    avg_cost: float
    competitors: List[str] = []
    moat: str = ""
    growth_plan: str = ""
    market: str = "US"
    exchange: str = ""


@router.get("")
def get_portfolio():
    return storage.get_full_portfolio()


@router.post("", status_code=201)
def add_stock(stock: Stock):
    holdings = storage.get_holdings()
    if stock.ticker.upper() in [h["ticker"].upper() for h in holdings]:
        raise HTTPException(status_code=400, detail=f"{stock.ticker} already exists")

    stocks = storage.get_stocks()
    if stock.ticker.upper() not in [s["ticker"].upper() for s in stocks]:
        stocks.append({
            "ticker": stock.ticker.upper(),
            "name": stock.name,
            "competitors": stock.competitors,
            "moat": stock.moat,
            "growth_plan": stock.growth_plan,
            "market": stock.market,
            "exchange": stock.exchange,
        })
        storage.save_stocks(stocks)

    new_holding = {
        "ticker": stock.ticker.upper(),
        "quantity": stock.quantity,
        "avg_cost": stock.avg_cost,
        "market": stock.market,
        "exchange": stock.exchange,
    }
    holdings.append(new_holding)
    storage.save_holdings(holdings)
    calendar_router.clear_cache()

    return {**new_holding, "name": stock.name, "competitors": stock.competitors,
            "moat": stock.moat, "growth_plan": stock.growth_plan}


@router.put("/{ticker}")
def update_stock(ticker: str, stock: Stock):
    holdings = storage.get_holdings()
    h_idx = next((i for i, h in enumerate(holdings) if h["ticker"].upper() == ticker.upper()), None)
    if h_idx is None:
        raise HTTPException(status_code=404, detail=f"{ticker} not found")

    holdings[h_idx] = {
        "ticker": ticker.upper(),
        "quantity": stock.quantity,
        "avg_cost": stock.avg_cost,
        "market": stock.market,
        "exchange": stock.exchange,
    }
    storage.save_holdings(holdings)

    stocks = storage.get_stocks()
    s_idx = next((i for i, s in enumerate(stocks) if s["ticker"].upper() == ticker.upper()), None)
    if s_idx is not None:
        stocks[s_idx] = {
            "ticker": ticker.upper(), "name": stock.name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan,
            "market": stock.market, "exchange": stock.exchange,
        }
        storage.save_stocks(stocks)

    calendar_router.clear_cache()
    return {**holdings[h_idx], "name": stock.name, "competitors": stock.competitors,
            "moat": stock.moat, "growth_plan": stock.growth_plan}


@router.delete("/{ticker}")
def delete_stock(ticker: str):
    holdings = storage.get_holdings()
    upper = ticker.upper()
    filtered = [h for h in holdings if h["ticker"].upper() != upper]
    if len(filtered) == len(holdings):
        raise HTTPException(status_code=404, detail=f"{ticker} not found")
    storage.save_holdings(filtered)
    calendar_router.clear_cache()

    watchlist = storage.get_watchlist_tickers()
    if upper not in [t.upper() for t in watchlist]:
        watchlist.append(upper)
        storage.save_watchlist_tickers(watchlist)

    return {"moved_to_watchlist": upper}

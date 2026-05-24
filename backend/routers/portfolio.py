from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List
from services import storage
from services import cache as cache_svc
from routers import calendar as calendar_router
from auth import get_current_user

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
def get_portfolio(user_id: str = Depends(get_current_user)):
    return storage.get_full_portfolio(user_id)


@router.post("", status_code=201)
def add_stock(stock: Stock, user_id: str = Depends(get_current_user)):
    holdings = storage.get_holdings(user_id)
    if stock.ticker.upper() in [h["ticker"].upper() for h in holdings]:
        raise HTTPException(status_code=400, detail=f"{stock.ticker} already exists")

    stocks = storage.get_stocks(user_id)
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
        storage.save_stocks(user_id, stocks)

    new_holding = {
        "ticker": stock.ticker.upper(),
        "quantity": stock.quantity,
        "avg_cost": stock.avg_cost,
        "market": stock.market,
        "exchange": stock.exchange,
    }
    holdings.append(new_holding)
    storage.save_holdings(user_id, holdings)
    calendar_router.clear_cache()
    cache_svc.invalidate_dashboard()

    return {**new_holding, "name": stock.name, "competitors": stock.competitors,
            "moat": stock.moat, "growth_plan": stock.growth_plan}


@router.put("/{ticker}")
def update_stock(ticker: str, stock: Stock, user_id: str = Depends(get_current_user)):
    holdings = storage.get_holdings(user_id)
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
    storage.save_holdings(user_id, holdings)

    stocks = storage.get_stocks(user_id)
    s_idx = next((i for i, s in enumerate(stocks) if s["ticker"].upper() == ticker.upper()), None)
    if s_idx is not None:
        stocks[s_idx] = {
            "ticker": ticker.upper(), "name": stock.name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan,
            "market": stock.market, "exchange": stock.exchange,
        }
        storage.save_stocks(user_id, stocks)

    calendar_router.clear_cache()
    cache_svc.invalidate_dashboard()
    return {**holdings[h_idx], "name": stock.name, "competitors": stock.competitors,
            "moat": stock.moat, "growth_plan": stock.growth_plan}


@router.delete("/{ticker}")
def delete_stock(ticker: str, user_id: str = Depends(get_current_user)):
    holdings = storage.get_holdings(user_id)
    upper = ticker.upper()
    filtered = [h for h in holdings if h["ticker"].upper() != upper]
    if len(filtered) == len(holdings):
        raise HTTPException(status_code=404, detail=f"{ticker} not found")
    storage.save_holdings(user_id, filtered)
    calendar_router.clear_cache()
    cache_svc.invalidate_dashboard()

    watchlist = storage.get_watchlist_tickers(user_id)
    if upper not in [t.upper() for t in watchlist]:
        watchlist.append(upper)
        storage.save_watchlist_tickers(user_id, watchlist)

    return {"moved_to_watchlist": upper}

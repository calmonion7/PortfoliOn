from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List
from services import storage, errors
from services import cache as cache_svc
from services.utils import find_ticker_index, ticker_exists_in
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
    if ticker_exists_in(holdings, stock.ticker):
        raise errors.already_exists(stock.ticker)

    stocks = storage.get_stocks(user_id)
    if not ticker_exists_in(stocks, stock.ticker):
        storage.save_stocks(user_id, [{
            "ticker": stock.ticker.upper(),
            "name": stock.name,
            "competitors": stock.competitors,
            "moat": stock.moat,
            "growth_plan": stock.growth_plan,
            "market": stock.market,
            "exchange": stock.exchange,
        }])

    new_holding = {
        "ticker": stock.ticker.upper(),
        "quantity": stock.quantity,
        "avg_cost": stock.avg_cost,
        "market": stock.market,
        "exchange": stock.exchange,
    }
    holdings.append(new_holding)
    storage.save_holdings(user_id, holdings)
    cache_svc.invalidate_portfolio_caches()

    return {**new_holding, "name": stock.name, "competitors": stock.competitors,
            "moat": stock.moat, "growth_plan": stock.growth_plan}


@router.put("/{ticker}")
def update_stock(ticker: str, stock: Stock, user_id: str = Depends(get_current_user)):
    holdings = storage.get_holdings(user_id)
    h_idx = find_ticker_index(holdings, ticker)
    if h_idx is None:
        raise errors.not_found(ticker)

    holdings[h_idx] = {
        "ticker": ticker.upper(),
        "quantity": stock.quantity,
        "avg_cost": stock.avg_cost,
        "market": stock.market,
        "exchange": stock.exchange,
    }
    storage.save_holdings(user_id, holdings)

    stocks = storage.get_stocks(user_id)
    if ticker_exists_in(stocks, ticker):
        storage.save_stocks(user_id, [{
            "ticker": ticker.upper(), "name": stock.name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan,
            "market": stock.market, "exchange": stock.exchange,
        }])

    cache_svc.invalidate_portfolio_caches()
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
    cache_svc.invalidate_portfolio_caches()

    watchlist = storage.get_watchlist_tickers(user_id)
    if upper not in [t.upper() for t in watchlist]:
        watchlist.append(upper)
        storage.save_watchlist_tickers(user_id, watchlist)

    return {"moved_to_watchlist": upper}

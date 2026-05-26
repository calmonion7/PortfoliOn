from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from typing import List
from services import storage, errors, cache as cache_svc
from services.utils import find_ticker_index, ticker_exists_in, find_ticker
from routers import calendar as calendar_router
from auth import get_current_user

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


class WatchlistStock(BaseModel):
    ticker: str
    name: str
    competitors: List[str] = []
    moat: str = ""
    growth_plan: str = ""
    market: str = "US"
    exchange: str = ""


class PromotePayload(BaseModel):
    quantity: float = Field(..., gt=0)
    avg_cost: float = Field(..., gt=0)


@router.get("")
def get_watchlist(user_id: str = Depends(get_current_user)):
    tickers = storage.get_watchlist_tickers(user_id)
    stocks_by_ticker = {s["ticker"]: s for s in storage.get_stocks(user_id)}
    return [
        stocks_by_ticker.get(t, {"ticker": t, "name": t, "competitors": [], "moat": "", "growth_plan": "", "market": "US", "exchange": ""})
        for t in tickers
    ]


@router.post("", status_code=201)
def add_watchlist_stock(stock: WatchlistStock, user_id: str = Depends(get_current_user)):
    holdings = storage.get_holdings(user_id)
    watchlist = storage.get_watchlist_tickers(user_id)
    all_tickers = [h["ticker"].upper() for h in holdings] + [t.upper() for t in watchlist]
    if stock.ticker.upper() in all_tickers:
        raise errors.already_exists(stock.ticker)

    stocks = storage.get_stocks(user_id)
    if not ticker_exists_in(stocks, stock.ticker):
        stocks.append({
            "ticker": stock.ticker.upper(), "name": stock.name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan,
            "market": stock.market, "exchange": stock.exchange,
        })
        storage.save_stocks(user_id, stocks)

    watchlist.append(stock.ticker.upper())
    storage.save_watchlist_tickers(user_id, watchlist)
    calendar_router.clear_cache()

    return {"ticker": stock.ticker.upper(), "name": stock.name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan,
            "market": stock.market, "exchange": stock.exchange}


@router.put("/{ticker}")
def update_watchlist_stock(ticker: str, stock: WatchlistStock, user_id: str = Depends(get_current_user)):
    watchlist = storage.get_watchlist_tickers(user_id)
    if ticker.upper() not in [t.upper() for t in watchlist]:
        raise errors.not_found(ticker, "watchlist")

    stocks = storage.get_stocks(user_id)
    idx = find_ticker_index(stocks, ticker)
    if idx is not None:
        stocks[idx] = {
            "ticker": ticker.upper(), "name": stock.name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan,
            "market": stock.market, "exchange": stock.exchange,
        }
        storage.save_stocks(user_id, stocks)

    return {"ticker": ticker.upper(), "name": stock.name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan,
            "market": stock.market, "exchange": stock.exchange}


@router.delete("/{ticker}")
def delete_watchlist_stock(ticker: str, user_id: str = Depends(get_current_user)):
    upper = ticker.upper()
    watchlist = storage.get_watchlist_tickers(user_id)
    if upper not in [t.upper() for t in watchlist]:
        raise errors.not_found(ticker, "watchlist")

    storage.save_watchlist_tickers(user_id, [t for t in watchlist if t.upper() != upper])
    calendar_router.clear_cache()

    return {"deleted": upper}


@router.post("/{ticker}/promote")
def promote_to_holdings(ticker: str, payload: PromotePayload, user_id: str = Depends(get_current_user)):
    upper = ticker.upper()
    watchlist = storage.get_watchlist_tickers(user_id)
    if upper not in [t.upper() for t in watchlist]:
        raise errors.not_found(ticker, "watchlist")

    holdings = storage.get_holdings(user_id)
    if ticker_exists_in(holdings, upper):
        raise errors.already_exists(ticker, "holdings")

    storage.save_watchlist_tickers(user_id, [t for t in watchlist if t.upper() != upper])

    stocks = storage.get_stocks(user_id)
    stock_data = find_ticker(stocks, upper) or \
        {"ticker": upper, "name": upper, "competitors": [], "moat": "", "growth_plan": "", "market": "US", "exchange": ""}
    new_holding = {
        "ticker": upper,
        "quantity": payload.quantity,
        "avg_cost": payload.avg_cost,
        "market": stock_data.get("market", "US"),
        "exchange": stock_data.get("exchange", ""),
    }
    holdings.append(new_holding)
    storage.save_holdings(user_id, holdings)
    cache_svc.invalidate_portfolio_caches()

    return {**stock_data, "quantity": payload.quantity, "avg_cost": payload.avg_cost}

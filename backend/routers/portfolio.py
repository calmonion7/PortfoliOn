from datetime import date as _date, timedelta as _timedelta
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel
from typing import List
from services import storage, errors, report_generator, consensus as consensus_svc
from services import cache as cache_svc, market as market_svc
from services.utils import find_ticker_index, ticker_exists_in
from services.parallel import parallel_map
from services.db import query as db_query
from auth import get_current_user

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])

_DAY_MAP = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}


def _last_scheduled_date() -> str:
    schedule = storage.get_schedule()
    enabled = {_DAY_MAP[d] for d in schedule.get("days", []) if d in _DAY_MAP}
    today = _date.today()
    if not schedule.get("enabled") or not enabled:
        return today.isoformat()
    for i in range(7):
        d = today - _timedelta(days=i)
        if d.weekday() in enabled:
            return d.isoformat()
    return today.isoformat()


def _generate_with_consensus(stock_dict: dict):
    report_generator.generate_report(stock_dict, target_date=stock_dict.get("_target_date"))
    ticker = stock_dict["ticker"]
    market = stock_dict.get("market", "US")
    cache_svc.invalidate(ticker)
    try:
        consensus_svc.collect(ticker)
    except Exception as e:
        print(f"[AutoReport] consensus collect failed for {ticker}: {e}")
    try:
        consensus_svc.backfill(ticker, market)
    except Exception as e:
        print(f"[AutoReport] consensus backfill failed for {ticker}: {e}")


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


@router.get("/prices")
def get_portfolio_prices(user_id: str = Depends(get_current_user)):
    portfolio = storage.get_full_portfolio(user_id)
    all_stocks = portfolio.get("stocks", []) + portfolio.get("watchlist", [])

    def _fetch(s):
        try:
            quote = market_svc.get_quote(s["ticker"], s.get("market", "US"), s.get("exchange", ""))
            if quote:
                return s["ticker"], {"current_price": quote.get("price"), "change_pct": quote.get("daily_change_pct")}
        except Exception:
            pass
        return s["ticker"], {}

    return dict(parallel_map(_fetch, all_stocks))


@router.post("", status_code=201)
def add_stock(stock: Stock, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
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

    target_date = _last_scheduled_date()
    existing = db_query(
        "SELECT 1 FROM snapshots WHERE ticker = %s AND date = %s LIMIT 1",
        (stock.ticker.upper(), target_date),
    )
    if not existing:
        stock_dict = {
            "ticker": stock.ticker.upper(),
            "name": stock.name,
            "market": stock.market,
            "exchange": stock.exchange,
            "competitors": stock.competitors,
            "moat": stock.moat,
            "growth_plan": stock.growth_plan,
            "_target_date": target_date,
        }
        background_tasks.add_task(_generate_with_consensus, stock_dict)

    return {**new_holding, "name": stock.name, "competitors": stock.competitors,
            "moat": stock.moat, "growth_plan": stock.growth_plan,
            "report_queued": not bool(existing)}


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

from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field, field_validator
from typing import List
from services import storage, errors, cache as cache_svc, report_generator, consensus_pipeline as _pipeline
from services import market as market_svc
from services.utils import ticker_exists_in, find_ticker, is_valid_ticker
from services.db import query as db_query
from auth import get_current_user
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


def _generate_with_consensus(stock_dict: dict):
    report_generator.generate_report(stock_dict, target_date=stock_dict.get("_target_date"))
    ticker = stock_dict["ticker"]
    cache_svc.invalidate(ticker)
    try:
        # 정본 = daily_consensus_mart (ADR-0008). consensus_history 직접 적재(legacy) 대신 파이프라인 경유.
        _pipeline.backfill([stock_dict], days=180)
    except Exception as e:
        logger.warning(f"[AutoReport] consensus backfill failed for {ticker}: {e}")


def _generate_etf_report(stock_dict: dict):
    report_generator.generate_report(stock_dict, target_date=stock_dict.get("_target_date"))
    cache_svc.invalidate(stock_dict["ticker"])


class WatchlistStock(BaseModel):
    ticker: str
    name: str
    competitors: List[str] = []
    moat: str = ""
    growth_plan: str = ""
    market: str = "US"
    exchange: str = ""
    security_type: str = "EQUITY"

    @field_validator("ticker")
    @classmethod
    def _validate_ticker(cls, v: str) -> str:
        v = v.strip().upper()
        if not is_valid_ticker(v):
            raise ValueError("ticker must be 1-15 chars of letters, digits, '.' or '-'")
        return v


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
def add_watchlist_stock(stock: WatchlistStock, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    quote = None
    if stock.market == "KR":
        quote = market_svc.get_quote(stock.ticker, "KR", stock.exchange)
        if quote.get("delisted"):
            raise HTTPException(status_code=422, detail="상장폐지 종목입니다. 등록할 수 없습니다.")

    # 이름칸이 비거나 티커면 quote 실명으로 대체(종목번호로 박히는 것 방지)
    name = market_svc.resolve_name(stock.ticker, stock.market, stock.exchange, stock.name, quote=quote)

    holdings = storage.get_holdings(user_id)
    watchlist = storage.get_watchlist_tickers(user_id)
    all_tickers = [h["ticker"].upper() for h in holdings] + [t.upper() for t in watchlist]
    if stock.ticker.upper() in all_tickers:
        raise errors.already_exists(stock.ticker)

    stocks = storage.get_stocks(user_id)
    if not ticker_exists_in(stocks, stock.ticker):
        storage.save_stocks(user_id, [{
            "ticker": stock.ticker.upper(), "name": name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan,
            "market": stock.market, "exchange": stock.exchange,
            "security_type": stock.security_type,
        }])

    watchlist.append(stock.ticker.upper())
    storage.save_watchlist_tickers(user_id, watchlist)
    cache_svc.invalidate_portfolio_caches()

    target_date = storage.expected_report_date(stock.market)
    existing = db_query(
        "SELECT 1 FROM snapshots WHERE ticker = %s AND date = %s LIMIT 1",
        (stock.ticker.upper(), target_date),
    )
    if not existing:
        stock_dict = {
            "ticker": stock.ticker.upper(),
            "name": name,
            "market": stock.market,
            "exchange": stock.exchange,
            "competitors": stock.competitors,
            "moat": stock.moat,
            "growth_plan": stock.growth_plan,
            "security_type": stock.security_type,
            "_target_date": target_date,
        }
        if stock.security_type == "ETF":
            background_tasks.add_task(_generate_etf_report, stock_dict)
        else:
            background_tasks.add_task(_generate_with_consensus, stock_dict)

    return {"ticker": stock.ticker.upper(), "name": name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan,
            "market": stock.market, "exchange": stock.exchange, "security_type": stock.security_type,
            "report_queued": not bool(existing)}


@router.put("/{ticker}")
def update_watchlist_stock(ticker: str, stock: WatchlistStock, user_id: str = Depends(get_current_user)):
    watchlist = storage.get_watchlist_tickers(user_id)
    if ticker.upper() not in [t.upper() for t in watchlist]:
        raise errors.not_found(ticker, "watchlist")

    stocks = storage.get_stocks(user_id)
    if ticker_exists_in(stocks, ticker):
        # 편집 가능 필드(name, competitors)만 갱신 — 구조화 분석(moat/growth_plan 등)은 보존
        storage.update_ticker_meta(ticker, stock.name, stock.competitors)

    cache_svc.invalidate_portfolio_caches()
    return {"ticker": ticker.upper(), "name": stock.name,
            "competitors": stock.competitors,
            "market": stock.market, "exchange": stock.exchange}


@router.delete("/{ticker}")
def delete_watchlist_stock(ticker: str, user_id: str = Depends(get_current_user)):
    upper = ticker.upper()
    watchlist = storage.get_watchlist_tickers(user_id)
    if upper not in [t.upper() for t in watchlist]:
        raise errors.not_found(ticker, "watchlist")

    storage.save_watchlist_tickers(user_id, [t for t in watchlist if t.upper() != upper])
    cache_svc.invalidate_portfolio_caches()

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

    stocks = storage.get_stocks(user_id)
    stock_data = find_ticker(stocks, upper) or \
        {"ticker": upper, "name": upper, "competitors": [], "moat": "", "growth_plan": "", "market": "US", "exchange": ""}

    storage.save_watchlist_tickers(user_id, [t for t in watchlist if t.upper() != upper])

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

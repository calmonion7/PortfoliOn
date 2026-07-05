from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, Body
from pydantic import BaseModel, field_validator
from typing import List, Optional, Dict
from services import storage, errors, report_generator, consensus_pipeline as _pipeline
from services import cache as cache_svc, market as market_svc, kr_sector_service
from services.utils import find_ticker_index, ticker_exists_in, is_valid_ticker, sanitize
from services.market import _norm_sector
from services.db import query as db_query
from services.rebalance import compute_rebalance
from services.exposure import compute_exposure
from routers.stocks import _usdkrw_rate
from auth import get_current_user

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


def _generate_with_consensus(stock_dict: dict):
    report_generator.generate_report(stock_dict, target_date=stock_dict.get("_target_date"))
    ticker = stock_dict["ticker"]
    cache_svc.invalidate(ticker)
    try:
        # 정본 = daily_consensus_mart (ADR-0008). consensus_history 직접 적재(legacy) 대신 파이프라인 경유.
        _pipeline.backfill([stock_dict], days=180)
    except Exception as e:
        print(f"[AutoReport] consensus backfill failed for {ticker}: {e}")


def _generate_etf_report(stock_dict: dict):
    report_generator.generate_report(stock_dict, target_date=stock_dict.get("_target_date"))
    cache_svc.invalidate(stock_dict["ticker"])


class Stock(BaseModel):
    ticker: str
    name: str
    quantity: float
    avg_cost: float
    target_price: Optional[float] = None
    stop_price: Optional[float] = None
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


@router.get("")
def get_portfolio(user_id: str = Depends(get_current_user)):
    return storage.get_full_portfolio(user_id)


@router.get("/prices")
def get_portfolio_prices(user_id: str = Depends(get_current_user)):
    # 장중 자동폴링 대상: 보유+관심 종목 시세를 user당 15s 캐시(다중 폴링 레이트리밋 방어).
    def _compute():
        portfolio = storage.get_full_portfolio(user_id)
        all_stocks = portfolio.get("stocks", []) + portfolio.get("watchlist", [])
        quotes = market_svc.get_quotes_batch(all_stocks)
        return {
            s["ticker"]: {
                "current_price": quotes.get(s["ticker"].upper(), {}).get("price"),
                "change_pct": quotes.get(s["ticker"].upper(), {}).get("daily_change_pct"),
            }
            for s in all_stocks
        }
    return cache_svc.get_live_prices(user_id, _compute)


@router.get("/rebalance")
def get_rebalance(user_id: str = Depends(get_current_user)):
    """보유 종목 목표 비중 대비 현재 비중 드리프트 + 조정금액. 주문 실행은 범위 밖(읽기전용)."""
    holdings = storage.get_holdings(user_id)
    quotes = market_svc.get_quotes_batch(holdings)
    calc_holdings = [
        {**h, "current_price": quotes.get(h["ticker"].upper(), {}).get("price")}
        for h in holdings
    ]
    targets = {h["ticker"]: float(h["target_weight"]) for h in holdings if h.get("target_weight") is not None}
    result = compute_rebalance(calc_holdings, _usdkrw_rate(), targets)
    return sanitize(result)


@router.put("/rebalance/targets")
def set_rebalance_targets(weights: Dict[str, Optional[float]] = Body(...), user_id: str = Depends(get_current_user)):
    """보유 종목별 목표 비중(%) 배치 저장. 값 null이면 타겟 삭제(컬럼 NULL). 보유 중이 아닌 티커는 무시(스코프=보유 종목만)."""
    holdings = storage.get_holdings(user_id)
    holding_tickers = {h["ticker"].upper() for h in holdings}
    targets = {t.upper(): w for t, w in weights.items() if t.upper() in holding_tickers}
    storage.set_target_weights(user_id, targets)
    return {"updated": len(targets), "targets": targets}


@router.get("/exposure")
def get_exposure(user_id: str = Depends(get_current_user)):
    """보유 종목의 통화·섹터·단일종목 노출·집중도(전체-포트 KRW 환산 비중). 보유(holding)만 대상."""
    holdings = storage.get_holdings(user_id)
    quotes = market_svc.get_quotes_batch(holdings)

    us_tickers = [h["ticker"].upper() for h in holdings if h.get("market") != "KR"]
    sector_map: Dict[str, str] = {}
    if us_tickers:
        rows = db_query(
            "SELECT DISTINCT ON (ticker) ticker, data->>'sector' AS sector "
            "FROM snapshots WHERE ticker = ANY(%s) AND data->>'sector' IS NOT NULL AND data->>'sector' != '' "
            "ORDER BY ticker, date DESC",
            (us_tickers,),
        )
        sector_map.update({r["ticker"]: _norm_sector(r["sector"]) for r in rows})
    sector_map.update(kr_sector_service.map_holdings_to_sectors(holdings))  # 저장 인덱스만 읽음(라이브 키움 호출 없음)

    tickers = [h["ticker"].upper() for h in holdings]
    beta_map: Dict[str, float] = {}
    if tickers:
        rows = db_query(
            "SELECT ticker, beta FROM stock_beta WHERE ticker = ANY(%s) AND beta IS NOT NULL",
            (tickers,),
        )
        beta_map = {r["ticker"]: float(r["beta"]) for r in rows}

    result = compute_exposure(holdings, quotes, _usdkrw_rate(), sector_map, beta_map)
    return sanitize(result)


@router.post("", status_code=201)
def add_stock(stock: Stock, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    quote = None
    if stock.market == "KR":
        quote = market_svc.get_quote(stock.ticker, "KR", stock.exchange)
        if quote.get("delisted"):
            raise HTTPException(status_code=422, detail="상장폐지 종목입니다. 등록할 수 없습니다.")

    # 이름칸이 비거나 티커면 quote 실명으로 대체(종목번호로 박히는 것 방지)
    name = market_svc.resolve_name(stock.ticker, stock.market, stock.exchange, stock.name, quote=quote)

    holdings = storage.get_holdings(user_id)
    if ticker_exists_in(holdings, stock.ticker):
        raise errors.already_exists(stock.ticker)

    stocks = storage.get_stocks(user_id)
    if not ticker_exists_in(stocks, stock.ticker):
        storage.save_stocks(user_id, [{
            "ticker": stock.ticker.upper(),
            "name": name,
            "competitors": stock.competitors,
            "moat": stock.moat,
            "growth_plan": stock.growth_plan,
            "market": stock.market,
            "exchange": stock.exchange,
            "security_type": stock.security_type,
        }])

    new_holding = {
        "ticker": stock.ticker.upper(),
        "quantity": stock.quantity,
        "avg_cost": stock.avg_cost,
        "target_price": stock.target_price,
        "stop_price": stock.stop_price,
        "market": stock.market,
        "exchange": stock.exchange,
    }
    holdings.append(new_holding)
    storage.save_holdings(user_id, holdings)
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

    return {**new_holding, "name": name, "competitors": stock.competitors,
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
        "target_price": stock.target_price,
        "stop_price": stock.stop_price,
        "market": stock.market,
        "exchange": stock.exchange,
    }
    storage.save_holdings(user_id, holdings)

    stocks = storage.get_stocks(user_id)
    if ticker_exists_in(stocks, ticker):
        # 편집 가능 필드(name, competitors)만 갱신 — 구조화 분석(moat/growth_plan 등)은 보존
        storage.update_ticker_meta(ticker, stock.name, stock.competitors)

    cache_svc.invalidate_portfolio_caches()
    return {**holdings[h_idx], "name": stock.name, "competitors": stock.competitors}


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

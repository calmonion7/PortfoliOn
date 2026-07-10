import logging
from datetime import timedelta
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, Body
from pydantic import BaseModel, field_validator
from typing import List, Optional, Dict
from services import storage, errors, report_generator, consensus_pipeline as _pipeline
from services import cache as cache_svc, market as market_svc, kr_sector_service
from services import dividends as dividends_svc
from services.utils import find_ticker_index, ticker_exists_in, is_valid_ticker, sanitize
from services.market import _norm_sector
from services.db import query as db_query
from services.rebalance import compute_rebalance
from services.exposure import compute_exposure
from routers.stocks import _usdkrw_rate
from auth import get_current_user

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])
logger = logging.getLogger(__name__)


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


@router.get("/dividends")
def get_dividends(user_id: str = Depends(get_current_user)):
    """보유·관심 종목의 다가오는 배당 스케줄(저장값만) + 보유 12개월 예상 수령액(KRW).

    배치(dividend_fetch)가 사전계산한 stock_dividend_schedule을 읽어(요청경로 라이브 호출 0)
    유저 보유 수량과 조인해 예상 수령액을 계산. KR/그 외 예상(projected)·US 확정(confirmed). ADR-0023."""
    portfolio = storage.get_full_portfolio(user_id)
    def _qty(v):
        # user_stocks.quantity는 DB NUMERIC→Decimal — 예상 수령액(amt는 float) 계산 시
        # float*Decimal TypeError를 피하려 float로 정규화(CLAUDE.md 배당 Decimal 가토).
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    info: dict = {}
    for s in portfolio.get("stocks", []):
        info[s["ticker"].upper()] = {
            "stock_type": "holding", "quantity": _qty(s.get("quantity")),
            "name": s.get("name") or s["ticker"], "market": s.get("market", "US"),
        }
    for s in portfolio.get("watchlist", []):
        info.setdefault(s["ticker"].upper(), {
            "stock_type": "watchlist", "quantity": None,
            "name": s.get("name") or s["ticker"], "market": s.get("market", "US"),
        })
    if not info:
        return {"items": [], "summary": {"total_expected_12m_krw": 0, "holdings_with_dividend": 0, "fx_usdkrw": None}}

    sched = dividends_svc.get_schedule_batch(list(info.keys()))
    usdkrw = _usdkrw_rate()
    # '12개월' 합계는 today(KST)+365일 이내만 — 스케줄 horizon(+385일 버퍼)이 5번째 분기배당을
    # 합계에 흘려 ~25% 과대집계하던 것 차단(리스트 items는 전체 horizon 유지). task#160 #1.
    cutoff_365 = (dividends_svc._today_kst() + timedelta(days=365)).isoformat()
    items = []
    total_12m_krw = 0.0
    holdings_with_div: set = set()
    for row in sched:
        meta = info.get((row.get("ticker") or "").upper())
        if not meta:
            continue
        amt = row.get("amount_per_share")
        qty = meta["quantity"] if meta["stock_type"] == "holding" else None
        expected = (amt * qty) if (amt is not None and qty) else None
        items.append({
            "ticker": row["ticker"], "name": meta["name"], "market": meta["market"],
            "stock_type": meta["stock_type"], "ex_date": row.get("ex_date"), "pay_date": row.get("pay_date"),
            "amount_per_share": amt, "currency": row.get("currency"), "status": row.get("status"),
            "quantity": qty, "expected_amount": expected,
        })
        if expected is not None:
            # 카운트는 예상배당 있는 보유면 FX 유무와 무관하게 포함(#5) — 합계 환산 가능여부와 분리.
            holdings_with_div.add(row["ticker"].upper())
            cur = row.get("currency")
            within_365 = (row.get("ex_date") or "") <= cutoff_365
            if within_365:
                if cur == "KRW":
                    total_12m_krw += expected
                elif cur == "USD" and usdkrw:
                    total_12m_krw += expected * usdkrw
                # USD인데 저장 FX 없음 → KRW 합계서만 graceful 제외(카운트엔 이미 포함)
    summary = {
        "total_expected_12m_krw": round(total_12m_krw, 2),
        "holdings_with_dividend": len(holdings_with_div),
        "fx_usdkrw": usdkrw,
    }
    return sanitize({"items": items, "summary": summary})


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
    """보유 종목 목표 비중 대비 현재 비중 드리프트 + 조정금액. 주문 실행은 범위 밖(읽기전용).
    S3: user_id별 300s TTL 캐시 — 요청마다 라이브 시세 재조회 방지(get_sector/get_macro와 동일 패턴)."""
    def _compute():
        holdings = storage.get_holdings(user_id)
        quotes = market_svc.get_quotes_batch(holdings)
        calc_holdings = [
            {**h, "current_price": quotes.get(h["ticker"].upper(), {}).get("price")}
            for h in holdings
        ]
        targets = {h["ticker"]: float(h["target_weight"]) for h in holdings if h.get("target_weight") is not None}
        return compute_rebalance(calc_holdings, _usdkrw_rate(), targets)
    return sanitize(cache_svc.get_rebalance(user_id, _compute))


@router.put("/rebalance/targets")
def set_rebalance_targets(weights: Dict[str, Optional[float]] = Body(...), user_id: str = Depends(get_current_user)):
    """보유 종목별 목표 비중(%) 배치 저장. 값 null이면 타겟 삭제(컬럼 NULL). 보유 중이 아닌 티커는 무시(스코프=보유 종목만)."""
    holdings = storage.get_holdings(user_id)
    holding_tickers = {h["ticker"].upper() for h in holdings}
    targets = {t.upper(): w for t, w in weights.items() if t.upper() in holding_tickers}
    storage.set_target_weights(user_id, targets)
    cache_svc.invalidate_rebalance(user_id)  # 타겟 변경이 캐시된 rebalance에 즉시 반영되도록
    return {"updated": len(targets), "targets": targets}


@router.get("/exposure")
def get_exposure(user_id: str = Depends(get_current_user)):
    """보유 종목의 통화·섹터·단일종목 노출·집중도(전체-포트 KRW 환산 비중). 보유(holding)만 대상.
    S3: user_id별 300s TTL 캐시 — 요청마다 라이브 시세 재조회 방지."""
    def _compute():
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

        return compute_exposure(holdings, quotes, _usdkrw_rate(), sector_map, beta_map)
    return sanitize(cache_svc.get_exposure(user_id, _compute))


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
    cache_svc.invalidate_portfolio_caches(user_id)

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

    cache_svc.invalidate_portfolio_caches(user_id)
    return {**holdings[h_idx], "name": stock.name, "competitors": stock.competitors}


@router.delete("/{ticker}")
def delete_stock(ticker: str, user_id: str = Depends(get_current_user)):
    holdings = storage.get_holdings(user_id)
    upper = ticker.upper()
    filtered = [h for h in holdings if h["ticker"].upper() != upper]
    if len(filtered) == len(holdings):
        raise HTTPException(status_code=404, detail=f"{ticker} not found")
    storage.save_holdings(user_id, filtered)
    cache_svc.invalidate_portfolio_caches(user_id)

    watchlist = storage.get_watchlist_tickers(user_id)
    if upper not in [t.upper() for t in watchlist]:
        watchlist.append(upper)
        storage.save_watchlist_tickers(user_id, watchlist)

    return {"moved_to_watchlist": upper}

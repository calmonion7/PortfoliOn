from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from services import storage
import re
import json
import requests as http_requests
import yfinance as yf
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from services import market
from services import cache as cache_svc

SNAPSHOTS_DIR = Path(__file__).parent.parent / "snapshots"
REPORTS_DIR = Path(__file__).parent.parent / "reports"


def _latest_snapshot(ticker: str) -> tuple:
    """Find and load the latest snapshot for a ticker from snapshots or reports directory."""
    for base in (SNAPSHOTS_DIR, REPORTS_DIR):
        ticker_dir = base / ticker
        if ticker_dir.exists():
            dates = sorted([f.stem for f in ticker_dir.glob("*.json")], reverse=True)
            if dates:
                path = ticker_dir / f"{dates[0]}.json"
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                    return data, dates[0]
                except Exception:
                    pass
    return None, None


router = APIRouter(prefix="/api/stocks", tags=["stocks"])

_KR_PATTERN = re.compile(r'[가-힣]')


def _search_naver(q: str, max_results: int = 12) -> list:
    """Search Korean stocks via Naver Finance autocomplete (supports Korean text)."""
    try:
        r = http_requests.get(
            "https://ac.stock.naver.com/ac",
            params={"q": q, "target": "stock"},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=5,
        )
        items = r.json().get("items", [])
        results = []
        for item in items[:max_results]:
            code = item.get("code", "")
            name = item.get("name", "")
            type_code = item.get("typeCode", "KOSPI")
            exchange = "KQ" if type_code == "KOSDAQ" else "KS"
            results.append({
                "ticker": code,
                "name": name,
                "market": "KR",
                "exchange": exchange,
                "exchange_display": type_code,
            })
        return results
    except Exception:
        return []


class EnrichBody(BaseModel):
    moat: Optional[str] = None
    growth_plan: Optional[str] = None
    risks: Optional[str] = None
    recent_disclosures: Optional[str] = None
    competitors: Optional[List[str]] = None


class BatchEnrichItem(BaseModel):
    ticker: str
    moat: Optional[str] = None
    growth_plan: Optional[str] = None
    risks: Optional[str] = None
    recent_disclosures: Optional[str] = None
    competitors: Optional[List[str]] = None


@router.get("/search")
def search_stocks(q: str = Query(..., min_length=1), market: str = "ALL"):
    # Yahoo Finance doesn't support Korean text — use Naver autocomplete instead
    if _KR_PATTERN.search(q):
        results = _search_naver(q)
        if market != "ALL":
            results = [r for r in results if r["market"] == market]
        return results

    try:
        results = yf.Search(q, max_results=12, enable_fuzzy_query=True)
        quotes = results.quotes or []
    except Exception:
        return []

    filtered = []
    for item in quotes:
        symbol = item.get("symbol", "")
        if item.get("quoteType") not in ("EQUITY",):
            continue
        if symbol.endswith(".KS"):
            item_market, item_exchange, item_ticker = "KR", "KS", symbol[:-3]
        elif symbol.endswith(".KQ"):
            item_market, item_exchange, item_ticker = "KR", "KQ", symbol[:-3]
        else:
            item_market, item_exchange = "US", ""
            item_ticker = symbol.replace("-", ".")
        if market != "ALL" and item_market != market:
            continue
        name = item.get("shortname") or item.get("longname") or item_ticker
        filtered.append({
            "ticker": item_ticker,
            "name": name,
            "market": item_market,
            "exchange": item_exchange,
            "exchange_display": item.get("exchDisp", item.get("exchange", "")),
        })
    return filtered


@router.get("")
def get_stocks():
    portfolio = storage.get_full_portfolio()
    result = []
    for s in portfolio["stocks"]:
        result.append({"ticker": s["ticker"], "name": s.get("name", s["ticker"]), "type": "holding"})
    for s in portfolio["watchlist"]:
        result.append({"ticker": s["ticker"], "name": s.get("name", s["ticker"]), "type": "watchlist"})
    return result


@router.put("/enrich/batch")
def enrich_batch(items: List[BatchEnrichItem]):
    if not items:
        raise HTTPException(status_code=400, detail="No items provided")
    updated, not_found = [], []
    for item in items:
        fields = {k: v for k, v in item.model_dump().items() if k != "ticker" and v is not None}
        if not fields:
            not_found.append(item.ticker.upper())
            continue
        ok = storage.enrich_stock(item.ticker, fields)
        (updated if ok else not_found).append(item.ticker.upper())
    return {"updated": updated, "not_found": not_found}


@router.put("/{ticker}/enrich")
def enrich_single(ticker: str, body: EnrichBody):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided")
    ok = storage.enrich_stock(ticker, fields)
    if not ok:
        raise HTTPException(status_code=404, detail="Ticker not found")
    return {"ticker": ticker.upper(), "updated": list(fields.keys())}


@router.delete("/dashboard/cache")
def clear_dashboard_cache():
    cache_svc.invalidate_dashboard()
    return {"cleared": True}


@router.get("/dashboard")
def get_dashboard():
    portfolio = storage.get_full_portfolio()
    holdings = portfolio.get("stocks", [])
    if not holdings:
        return []

    def _build_card(stock: dict) -> dict:
        ticker = stock["ticker"].upper()
        snapshot, snapshot_date = _latest_snapshot(ticker)
        quote = market.get_quote(ticker, stock.get("market", "US"), stock.get("exchange", ""))

        rsi = None
        target_mean = buy = hold = sell = None
        if snapshot:
            rsi = (snapshot.get("daily_rsi") or {}).get("rsi")
            target_mean = snapshot.get("target_mean")
            buy = snapshot.get("buy")
            hold = snapshot.get("hold")
            sell = snapshot.get("sell")

        return {
            "ticker": ticker,
            "name": stock.get("name", ticker),
            "market": stock.get("market", "US"),
            "avg_cost": stock.get("avg_cost"),
            "quantity": stock.get("quantity"),
            "current_price": quote.get("price"),
            "daily_change_pct": quote.get("daily_change_pct"),
            "weekly_change_pct": quote.get("weekly_change_pct"),
            "monthly_change_pct": quote.get("monthly_change_pct"),
            "rsi": rsi,
            "target_mean": target_mean,
            "buy": buy,
            "hold": hold,
            "sell": sell,
            "snapshot_date": snapshot_date,
            "sector": quote.get("sector") or "기타",
        }

    def _build_all():
        with ThreadPoolExecutor(max_workers=30) as executor:
            return list(executor.map(_build_card, holdings))

    return cache_svc.get_dashboard(_build_all)

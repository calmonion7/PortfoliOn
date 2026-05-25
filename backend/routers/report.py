from __future__ import annotations
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pathlib import Path
from services import storage, report_generator
from services import consensus as consensus_svc
from services import cache as cache_svc
from services.utils import sanitize as _sanitize
from services.db import get_db
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["report"])

SNAPSHOTS_DIR = Path(__file__).parent.parent / "snapshots"
REPORTS_DIR = Path(__file__).parent.parent / "reports"

_progress: dict = {"running": False, "done": 0, "total": 0, "current": ""}
_progress_lock = threading.Lock()
_backfill_progress: dict = {"running": False, "done": 0, "total": 0, "current": "", "created": 0}


@router.get("/report/progress")
def get_progress():
    return _progress


@router.get("/report/backfill/progress")
def get_backfill_progress():
    return _backfill_progress


@router.post("/report/backfill", status_code=202)
def backfill_all(background_tasks: BackgroundTasks, days: int = 60, user_id: str = Depends(get_current_user)):
    portfolio = storage.get_full_portfolio(user_id)
    stocks = portfolio.get("stocks", []) + portfolio.get("watchlist", [])
    if not stocks:
        raise HTTPException(status_code=400, detail="No stocks in portfolio or watchlist")
    background_tasks.add_task(_run_backfill, stocks, days)
    return {"message": f"과거 {days}일 스냅샷 백필 시작: {len(stocks)}개 종목"}


def _run_backfill(stocks: list, days: int):
    _backfill_progress.update({"running": True, "done": 0, "total": len(stocks), "current": "", "created": 0})
    total_created = 0
    for stock in stocks:
        _backfill_progress["current"] = stock["ticker"]
        try:
            n = report_generator.backfill_ticker(stock, days=days)
            total_created += n
            cache_svc.invalidate(stock["ticker"])
        except Exception as e:
            print(f"[Backfill] Failed for {stock['ticker']}: {e}")
        _backfill_progress["done"] += 1
        _backfill_progress["created"] = total_created
    _backfill_progress.update({"running": False, "current": ""})


@router.post("/report/generate", status_code=202)
def generate_all(background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    portfolio = storage.get_full_portfolio(user_id)
    stocks = portfolio.get("stocks", []) + portfolio.get("watchlist", [])
    if not stocks:
        raise HTTPException(status_code=400, detail="No stocks in portfolio or watchlist")
    background_tasks.add_task(_run_generation, stocks)
    return {"message": f"Generating reports for {len(stocks)} stock(s)"}


@router.post("/report/generate/{ticker}", status_code=202)
def generate_one(ticker: str, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    portfolio = storage.get_full_portfolio(user_id)
    stock = next(
        (s for s in portfolio["stocks"] if s["ticker"].upper() == ticker.upper()), None
    )
    if not stock:
        stock = next(
            (s for s in portfolio.get("watchlist", [])
             if s["ticker"].upper() == ticker.upper()), None
        )
    if not stock:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in portfolio or watchlist")
    background_tasks.add_task(_run_generation, [stock])
    return {"message": f"Generating report for {ticker.upper()}"}


def _run_generation(stocks: list):
    _progress.update({"running": True, "done": 0, "total": len(stocks), "current": ""})

    def _process_one(stock):
        with _progress_lock:
            _progress["current"] = stock["ticker"]
        try:
            report_generator.generate_report(stock)
            cache_svc.invalidate(stock["ticker"])
            consensus_svc.collect(stock["ticker"])
        except Exception as e:
            print(f"[Report] Failed for {stock['ticker']}: {e}")
        finally:
            with _progress_lock:
                _progress["done"] += 1

    with ThreadPoolExecutor(max_workers=5) as executor:
        list(executor.map(_process_one, stocks))

    _progress.update({"running": False, "current": ""})


def _read_snapshot(ticker: str, date_str: str) -> Optional[dict]:
    db = get_db()
    rows = db.table("snapshots").select("data").eq("ticker", ticker.upper()).eq("date", date_str).execute().data
    if rows:
        return _sanitize(rows[0]["data"])
    # 로컬 파일 폴백
    for base in (SNAPSHOTS_DIR, REPORTS_DIR):
        path = base / ticker / f"{date_str}.json"
        if path.exists():
            return _sanitize(json.loads(path.read_text(encoding="utf-8")))
    return None


@router.get("/report/list")
def list_reports(user_id: str = Depends(get_current_user)):
    def _build():
        portfolio = storage.get_full_portfolio(user_id)
        portfolio_stocks = {s["ticker"].upper(): s for s in portfolio.get("stocks", [])}
        portfolio_watchlist = {s["ticker"].upper(): s for s in portfolio.get("watchlist", [])}
        holding_tickers = set(portfolio_stocks.keys())
        watchlist_tickers = set(portfolio_watchlist.keys())

        db = get_db()
        snap_rows = db.table("snapshots").select("ticker, date").order("date", desc=True).execute().data
        ticker_dates: dict = {}
        for r in snap_rows:
            t = r["ticker"].upper()
            if t not in ticker_dates:
                ticker_dates[t] = []
            ticker_dates[t].append(r["date"])

        result = {}
        for ticker, dates in ticker_dates.items():
            category = "holdings" if ticker in holding_tickers else \
                       "watchlist" if ticker in watchlist_tickers else "other"
            summary = _read_snapshot(ticker, dates[0]) if dates else None
            stock_info = portfolio_stocks.get(ticker) or portfolio_watchlist.get(ticker) or {}
            market = stock_info.get("market") or (summary or {}).get("market", "US")
            result[ticker] = {"dates": dates, "category": category, "summary": summary, "market": market}

        for ticker, stock in portfolio_stocks.items():
            if ticker not in result:
                result[ticker] = {"dates": [], "category": "holdings", "summary": None,
                                  "market": stock.get("market", "US")}
        for ticker, stock in portfolio_watchlist.items():
            if ticker not in result:
                result[ticker] = {"dates": [], "category": "watchlist", "summary": None,
                                  "market": stock.get("market", "US")}
        return result

    return cache_svc.get_list(_build)


@router.get("/report/{ticker}/history")
def get_history(ticker: str):
    upper = ticker.upper()
    db = get_db()
    rows = db.table("snapshots").select("date, data").eq("ticker", upper).order("date").execute().data
    result = []
    for r in rows:
        raw = r["data"] or {}
        result.append({
            "date": r["date"],
            "price": raw.get("price"),
            "target_mean": raw.get("target_mean"),
            "target_high": raw.get("target_high"),
            "target_low": raw.get("target_low"),
            "buy": raw.get("buy"),
            "hold": raw.get("hold"),
            "sell": raw.get("sell"),
            "rsi_daily": (raw.get("daily_rsi") or {}).get("rsi"),
            "rsi_weekly": (raw.get("weekly_rsi") or {}).get("rsi"),
            "rsi_monthly": (raw.get("monthly_rsi") or {}).get("rsi"),
        })
    return result


@router.get("/report/{ticker}/{date_str}")
def get_report(ticker: str, date_str: str):
    upper = ticker.upper()
    summary = cache_svc.get_snapshot(upper, date_str, lambda: _read_snapshot(upper, date_str))
    if summary is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"ticker": upper, "date": date_str, "summary": summary}


_consensus_progress: dict = {"running": False, "done": 0, "total": 0, "current": ""}


@router.get("/consensus/batch/progress")
def get_consensus_batch_progress():
    return _consensus_progress


@router.post("/consensus/batch", status_code=202)
def batch_consensus(background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    portfolio = storage.get_full_portfolio(user_id)
    stocks = portfolio.get("stocks", []) + portfolio.get("watchlist", [])
    if not stocks:
        raise HTTPException(status_code=400, detail="No stocks in portfolio or watchlist")
    background_tasks.add_task(_run_consensus_batch, stocks)
    return {"message": f"컨센서스 수집/백필 시작: {len(stocks)}개 종목"}


def _run_consensus_batch(stocks: list):
    _consensus_progress["running"] = True
    _consensus_progress["done"] = 0
    _consensus_progress["total"] = len(stocks)
    _consensus_progress["current"] = ""
    for stock in stocks:
        ticker = stock["ticker"]
        market = stock.get("market", "US")
        _consensus_progress["current"] = ticker
        try:
            consensus_svc.collect(ticker)
        except Exception as e:
            print(f"[Consensus] collect failed for {ticker}: {e}")
        try:
            consensus_svc.backfill(ticker, market)
        except Exception as e:
            print(f"[Consensus] backfill failed for {ticker}: {e}")
        _consensus_progress["done"] += 1
    _consensus_progress["running"] = False
    _consensus_progress["current"] = ""


@router.get("/consensus/{ticker}")
def get_consensus(ticker: str):
    return consensus_svc.get_history(ticker)


@router.post("/consensus/{ticker}")
def collect_consensus(ticker: str):
    entry = consensus_svc.collect(ticker)
    if entry is None:
        raise HTTPException(status_code=400, detail="리포트를 먼저 생성하세요")
    return entry


@router.post("/consensus/{ticker}/backfill")
def backfill_consensus(ticker: str):
    upper = ticker.upper()
    db = get_db()
    rows = db.table("snapshots").select("date, data").eq("ticker", upper).order("date", desc=True).limit(1).execute().data
    if not rows:
        raise HTTPException(status_code=400, detail="리포트를 먼저 생성하세요")
    summary = rows[0]["data"] or {}
    market = summary.get("market", "US")
    added = consensus_svc.backfill(upper, market)
    return {"added": len(added), "entries": added}


@router.get("/schedule")
def get_schedule():
    return storage.get_schedule()


@router.put("/schedule")
def update_schedule(schedule: dict):
    required = {"enabled", "time", "days"}
    if not required.issubset(schedule.keys()):
        raise HTTPException(
            status_code=400, detail=f"Missing fields: {required - schedule.keys()}"
        )
    storage.save_schedule(schedule)
    return schedule

from __future__ import annotations
import json
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pathlib import Path
from services import storage, report_generator
from services import consensus as consensus_svc

router = APIRouter(prefix="/api", tags=["report"])

REPORTS_DIR = Path(__file__).parent.parent / "reports"

_progress: dict = {"running": False, "done": 0, "total": 0, "current": ""}


@router.get("/report/progress")
def get_progress():
    return _progress


@router.post("/report/generate", status_code=202)
def generate_all(background_tasks: BackgroundTasks):
    portfolio = storage.get_full_portfolio()
    stocks = portfolio.get("stocks", []) + portfolio.get("watchlist", [])
    if not stocks:
        raise HTTPException(status_code=400, detail="No stocks in portfolio or watchlist")
    background_tasks.add_task(_run_generation, stocks)
    return {"message": f"Generating reports for {len(stocks)} stock(s)"}


@router.post("/report/generate/{ticker}", status_code=202)
def generate_one(ticker: str, background_tasks: BackgroundTasks):
    portfolio = storage.get_full_portfolio()
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
    _progress["running"] = True
    _progress["done"] = 0
    _progress["total"] = len(stocks)
    _progress["current"] = ""
    for stock in stocks:
        _progress["current"] = stock["ticker"]
        try:
            report_generator.generate_report(stock)
            consensus_svc.collect(stock["ticker"])
        except Exception as e:
            print(f"[Report] Failed for {stock['ticker']}: {e}")
        _progress["done"] += 1
    _progress["running"] = False
    _progress["current"] = ""


def _read_summary(json_path: Path) -> dict | None:
    if json_path.exists():
        return json.loads(json_path.read_text(encoding="utf-8"))
    return None


@router.get("/report/list")
def list_reports():
    portfolio = storage.get_full_portfolio()
    portfolio_stocks = {s["ticker"].upper(): s for s in portfolio.get("stocks", [])}
    portfolio_watchlist = {s["ticker"].upper(): s for s in portfolio.get("watchlist", [])}
    holding_tickers = set(portfolio_stocks.keys())
    watchlist_tickers = set(portfolio_watchlist.keys())

    result = {}
    if REPORTS_DIR.exists():
        for ticker_dir in sorted(REPORTS_DIR.iterdir()):
            if ticker_dir.is_dir():
                dates = sorted([f.stem for f in ticker_dir.glob("*.md")], reverse=True)
                if dates:
                    ticker = ticker_dir.name.upper()
                    category = "holdings" if ticker in holding_tickers else \
                               "watchlist" if ticker in watchlist_tickers else "other"
                    summary = _read_summary(ticker_dir / f"{dates[0]}.json")
                    stock_info = portfolio_stocks.get(ticker) or portfolio_watchlist.get(ticker) or {}
                    market = stock_info.get("market") or (summary or {}).get("market", "US")
                    result[ticker_dir.name] = {"dates": dates, "category": category, "summary": summary, "market": market}

    # 포트폴리오에 있지만 아직 리포트가 없는 종목도 표시 (생성 버튼 노출)
    for ticker, stock in portfolio_stocks.items():
        if ticker not in result:
            result[ticker] = {"dates": [], "category": "holdings", "summary": None,
                              "market": stock.get("market", "US")}
    for ticker, stock in portfolio_watchlist.items():
        if ticker not in result:
            result[ticker] = {"dates": [], "category": "watchlist", "summary": None,
                              "market": stock.get("market", "US")}

    return result


@router.get("/report/{ticker}/{date_str}")
def get_report(ticker: str, date_str: str):
    upper = ticker.upper()
    path = REPORTS_DIR / upper / f"{date_str}.md"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Report not found")
    summary = _read_summary(REPORTS_DIR / upper / f"{date_str}.json")
    return {
        "ticker": upper,
        "date": date_str,
        "content": path.read_text(encoding="utf-8"),
        "summary": summary,
    }


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
    ticker_dir = REPORTS_DIR / upper
    if not ticker_dir.exists():
        raise HTTPException(status_code=400, detail="리포트를 먼저 생성하세요")
    json_files = sorted(ticker_dir.glob("*.json"), reverse=True)
    if not json_files:
        raise HTTPException(status_code=400, detail="리포트를 먼저 생성하세요")
    summary = json.loads(json_files[0].read_text(encoding="utf-8"))
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

import json
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pathlib import Path
from services import storage, report_generator

router = APIRouter(prefix="/api", tags=["report"])

REPORTS_DIR = Path(__file__).parent.parent / "reports"


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
    for stock in stocks:
        try:
            report_generator.generate_report(stock)
        except Exception as e:
            print(f"[Report] Failed for {stock['ticker']}: {e}")


def _read_summary(json_path: Path) -> dict | None:
    if json_path.exists():
        return json.loads(json_path.read_text(encoding="utf-8"))
    return None


@router.get("/report/list")
def list_reports():
    portfolio = storage.get_full_portfolio()
    holding_tickers = {s["ticker"].upper() for s in portfolio.get("stocks", [])}
    watchlist_tickers = {s["ticker"].upper() for s in portfolio.get("watchlist", [])}

    result = {}
    if not REPORTS_DIR.exists():
        return result
    for ticker_dir in sorted(REPORTS_DIR.iterdir()):
        if ticker_dir.is_dir():
            dates = sorted([f.stem for f in ticker_dir.glob("*.md")], reverse=True)
            if dates:
                ticker = ticker_dir.name.upper()
                category = "holdings" if ticker in holding_tickers else \
                           "watchlist" if ticker in watchlist_tickers else "other"
                summary = _read_summary(ticker_dir / f"{dates[0]}.json")
                result[ticker_dir.name] = {"dates": dates, "category": category, "summary": summary}
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

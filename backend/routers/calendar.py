from __future__ import annotations
import json
import sys
import calendar as cal_lib
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path
from fastapi import APIRouter, Query
import yfinance as yf
from services import storage

router = APIRouter(prefix="/api", tags=["calendar"])

_CACHE_DIR = Path(__file__).parent.parent / "data" / "calendar"
_CACHE_DIR.mkdir(exist_ok=True)


def _cache_path(month: str) -> Path:
    return _CACHE_DIR / f"{month}.json"


def clear_cache() -> None:
    for f in _CACHE_DIR.glob("*.json"):
        f.unlink(missing_ok=True)


@router.get("/calendar")
def get_calendar(month: str = Query(..., pattern=r"^\d{4}-\d{2}$")):
    return {"events": _get_events(month)}


@router.delete("/calendar/cache")
def delete_calendar_cache(month: str = Query(..., pattern=r"^\d{4}-\d{2}$")):
    _cache_path(month).unlink(missing_ok=True)
    return {"cleared": month}


def _get_events(month: str) -> list[dict]:
    path = _cache_path(month)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))

    year, mon = map(int, month.split("-"))
    month_start = date(year, mon, 1)
    month_end = date(year, mon, cal_lib.monthrange(year, mon)[1])

    portfolio = storage.get_full_portfolio()
    all_stocks = (
        [{"ticker": s["ticker"], "stock_type": "holding", "name": s.get("name", s["ticker"])} for s in portfolio["stocks"]]
        + [{"ticker": s["ticker"], "stock_type": "watchlist", "name": s.get("name", s["ticker"])} for s in portfolio["watchlist"]]
    )

    def _fetch_stock(stock):
        result = []
        try:
            t = yf.Ticker(stock["ticker"])
            _collect_earnings(t, stock["ticker"], stock["stock_type"], stock["name"], month_start, month_end, result)
            _collect_dividend(t, stock["ticker"], stock["stock_type"], stock["name"], month_start, month_end, result)
        except Exception as e:
            print(f"calendar: skip {stock['ticker']}: {e}", file=sys.stderr)
        return result

    events: list[dict] = []
    with ThreadPoolExecutor(max_workers=30) as executor:
        futures = {executor.submit(_fetch_stock, s): s for s in all_stocks}
        for future in as_completed(futures):
            events.extend(future.result())

    path.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    return events


def _collect_earnings(t, ticker, stock_type, name, start, end, events):
    cal = t.calendar
    if not cal or "Earnings Date" not in cal:
        return
    dates = cal["Earnings Date"]
    if not isinstance(dates, list):
        dates = [dates]
    for d in dates:
        if hasattr(d, "date"):
            d = d.date()
        if isinstance(d, date) and start <= d <= end:
            events.append({
                "date": d.isoformat(),
                "ticker": ticker,
                "name": name,
                "type": "earnings",
                "stock_type": stock_type,
            })


def _collect_dividend(t, ticker, stock_type, name, start, end, events):
    divs = t.dividends
    if divs is None or len(divs) < 2:
        return
    dates = [d.date() if hasattr(d, "date") else d for d in divs.index[-4:]]
    if len(dates) < 2:
        return
    intervals = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
    avg_interval = round(sum(intervals) / len(intervals))
    next_div = dates[-1] + timedelta(days=avg_interval)
    if start <= next_div <= end:
        events.append({
            "date": next_div.isoformat(),
            "ticker": ticker,
            "name": name,
            "type": "dividend",
            "stock_type": stock_type,
        })

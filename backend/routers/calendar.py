from __future__ import annotations
import sys
import time
import calendar as cal_lib
from datetime import date, timedelta
from fastapi import APIRouter, Query
import yfinance as yf
from services import storage

router = APIRouter(prefix="/api", tags=["calendar"])

_cache: dict[str, tuple[list, float]] = {}
_TTL = 6 * 3600


@router.get("/calendar")
def get_calendar(month: str = Query(..., pattern=r"^\d{4}-\d{2}$")):
    return {"events": _get_events(month)}


def _get_events(month: str) -> list[dict]:
    now = time.time()
    if month in _cache:
        data, ts = _cache[month]
        if now - ts < _TTL:
            return data

    year, mon = map(int, month.split("-"))
    month_start = date(year, mon, 1)
    month_end = date(year, mon, cal_lib.monthrange(year, mon)[1])

    portfolio = storage.get_full_portfolio()
    all_stocks = (
        [{"ticker": s["ticker"], "stock_type": "holding", "name": s.get("name", s["ticker"])} for s in portfolio["stocks"]]
        + [{"ticker": s["ticker"], "stock_type": "watchlist", "name": s.get("name", s["ticker"])} for s in portfolio["watchlist"]]
    )

    events: list[dict] = []
    for stock in all_stocks:
        try:
            t = yf.Ticker(stock["ticker"])
            _collect_earnings(t, stock["ticker"], stock["stock_type"], stock["name"], month_start, month_end, events)
            _collect_dividend(t, stock["ticker"], stock["stock_type"], stock["name"], month_start, month_end, events)
        except Exception as e:
            print(f"calendar: skip {stock['ticker']}: {e}", file=sys.stderr)
            continue

    _cache[month] = (events, now)
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

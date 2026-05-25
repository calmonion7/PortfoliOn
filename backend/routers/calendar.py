from __future__ import annotations
import json
import sys
import calendar as cal_lib
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path
from fastapi import APIRouter, Query, Depends
import pandas as pd
import yfinance as yf
import exchange_calendars as xcals
from services import storage
from services.db import get_db
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["calendar"])

_CACHE_DIR = Path(__file__).parent.parent / "data" / "calendar"
_CACHE_DIR.mkdir(exist_ok=True)


def clear_cache() -> None:
    # 로컬 파일 + Supabase 캐시 모두 삭제 (user_id 불명이므로 로컬만)
    for f in _CACHE_DIR.glob("*.json"):
        f.unlink(missing_ok=True)


@router.get("/calendar")
def get_calendar(month: str = Query(..., pattern=r"^\d{4}-\d{2}$"), user_id: str = Depends(get_current_user)):
    return {"events": _get_events(month, user_id)}


@router.delete("/calendar/cache")
def delete_calendar_cache(month: str = Query(..., pattern=r"^\d{4}-\d{2}$"), user_id: str = Depends(get_current_user)):
    get_db().table("calendar_cache").delete().eq("user_id", user_id).eq("month", month).execute()
    return {"cleared": month}


def _get_events(month: str, user_id: str = "") -> list[dict]:
    if user_id:
        db = get_db()
        rows = db.table("calendar_cache").select("events").eq("user_id", user_id).eq("month", month).execute().data
        if rows:
            return rows[0]["events"]

    year, mon = map(int, month.split("-"))
    month_start = date(year, mon, 1)
    month_end = date(year, mon, cal_lib.monthrange(year, mon)[1])

    portfolio = storage.get_full_portfolio(user_id) if user_id else {"stocks": [], "watchlist": []}
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
    with ThreadPoolExecutor(max_workers=min(len(all_stocks), 15)) as executor:
        futures = {executor.submit(_fetch_stock, s): s for s in all_stocks}
        for future in as_completed(futures):
            events.extend(future.result())

    events.extend(_get_holidays(month_start, month_end))

    if user_id:
        get_db().table("calendar_cache").upsert(
            {"user_id": user_id, "month": month, "events": events},
            on_conflict="user_id,month",
        ).execute()

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


def _get_holidays(month_start: date, month_end: date) -> list[dict]:
    start_str = month_start.isoformat()
    end_str = month_end.isoformat()
    results = []
    for exchange, label, holiday_type in [
        ("XNYS", "NYSE", "holiday_us"),
        ("XKRX", "KRX",  "holiday_kr"),
    ]:
        try:
            cal = xcals.get_calendar(exchange)
            sessions = cal.sessions_in_range(start_str, end_str)
            all_weekdays = pd.date_range(start_str, end_str, freq="B")
            holidays = all_weekdays.difference(sessions)
            for h in holidays:
                results.append({
                    "date": h.date().isoformat(),
                    "ticker": label,
                    "name": f"{label} 휴장",
                    "type": holiday_type,
                    "stock_type": "market",
                })
        except Exception as e:
            print(f"calendar: holiday fetch failed {exchange}: {e}", file=sys.stderr)
    return results

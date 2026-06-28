from __future__ import annotations
import json
import os
import sys
import calendar as cal_lib
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
from fastapi import APIRouter, Query, Depends
import pandas as pd
import yfinance as yf
import exchange_calendars as xcals
from services import storage
from services.db import query, execute
from auth import get_current_user

# S2: curated FRED release names to show in calendar
_FRED_RELEASES = {
    "Consumer Price Index",
    "Employment Situation",
    "Gross Domestic Product",
    "Producer Price Index",
}

router = APIRouter(prefix="/api", tags=["calendar"])

_CACHE_DIR = Path(__file__).parent.parent / "data" / "calendar"
_CACHE_DIR.mkdir(exist_ok=True)


def _cache_path(month: str) -> Path:
    return _CACHE_DIR / f"{month}.json"


def clear_cache() -> None:
    # 로컬 파일 + Supabase 캐시 모두 삭제 (user_id 불명이므로 로컬만)
    for f in _CACHE_DIR.glob("*.json"):
        f.unlink(missing_ok=True)


@router.get("/calendar")
def get_calendar(month: str = Query(..., pattern=r"^\d{4}-\d{2}$"), user_id: str = Depends(get_current_user)):
    return {"events": _get_events(month, user_id)}


@router.delete("/calendar/cache")
def delete_calendar_cache(month: str = Query(..., pattern=r"^\d{4}-\d{2}$"), user_id: str = Depends(get_current_user)):
    execute("DELETE FROM calendar_cache WHERE user_id = %s AND month = %s", (user_id, month))
    return {"cleared": month}


def _get_events(month: str, user_id: str = "") -> list[dict]:
    if user_id:
        rows = query("SELECT events FROM calendar_cache WHERE user_id = %s AND month = %s", (user_id, month))
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
            cal = t.calendar  # fetch once; shared by earnings + dividend
            _collect_earnings(cal, stock["ticker"], stock["stock_type"], stock["name"], month_start, month_end, result)
            _collect_dividend(cal, stock["ticker"], stock["stock_type"], stock["name"], month_start, month_end, result)
        except Exception as e:
            print(f"calendar: skip {stock['ticker']}: {e}", file=sys.stderr)
        return result

    events: list[dict] = []
    with ThreadPoolExecutor(max_workers=max(1, min(len(all_stocks), 15))) as executor:
        futures = {executor.submit(_fetch_stock, s): s for s in all_stocks}
        for future in as_completed(futures):
            events.extend(future.result())

    events.extend(_get_holidays(month_start, month_end))
    events.extend(_get_econ_events(month_start, month_end))

    if user_id:
        execute(
            """
            INSERT INTO calendar_cache (user_id, month, events) VALUES (%s, %s, %s)
            ON CONFLICT (user_id, month) DO UPDATE SET events = EXCLUDED.events
            """,
            (user_id, month, json.dumps(events)),
        )

    return events


def _collect_earnings(cal, ticker, stock_type, name, start, end, events):
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


def _collect_dividend(cal, ticker, stock_type, name, start, end, events):
    """S1: emit exact ex-dividend date from t.calendar (US only). KR: skip."""
    if not cal:
        return
    raw = cal.get("Ex-Dividend Date")
    if raw is None:
        return
    # raw may be a date, Timestamp, or list; normalise to a list of date
    candidates = raw if isinstance(raw, list) else [raw]
    for d in candidates:
        if hasattr(d, "date"):
            d = d.date()
        try:
            if pd.isna(d):
                continue
        except (TypeError, ValueError):
            pass
        if isinstance(d, date) and start <= d <= end:
            events.append({
                "date": d.isoformat(),
                "ticker": ticker,
                "name": name,
                "type": "dividend",
                "stock_type": stock_type,
            })


def _get_econ_events(month_start: date, month_end: date) -> list[dict]:
    """S2: FRED /fred/releases/dates → curated major US release dates.
    eco: fetched inline at cache-miss; upgrade path = batch into market_cache
    if FRED rate-limits ever become a problem.
    """
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        return []
    try:
        r = requests.get(
            "https://api.stlouisfed.org/fred/releases/dates",
            params={
                "api_key": api_key,
                "file_type": "json",
                "realtime_start": month_start.isoformat(),
                "realtime_end": month_end.isoformat(),
                "include_release_dates_with_no_data": "false",
            },
            timeout=10,
        )
        r.raise_for_status()
        items = r.json().get("release_dates", [])
    except Exception as e:
        print(f"calendar: FRED releases fetch failed: {e}", file=sys.stderr)
        return []
    events = []
    for item in items:
        name = item.get("release_name", "")
        d_str = item.get("date", "")
        if name not in _FRED_RELEASES or not d_str:
            continue
        try:
            d = date.fromisoformat(d_str)
        except ValueError:
            continue
        if month_start <= d <= month_end:
            events.append({
                "date": d.isoformat(),
                "ticker": "FRED",
                "name": f"{name} 발표",
                "type": "econ",
                "stock_type": "market",
            })
    return events


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

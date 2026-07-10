from __future__ import annotations
import json
import logging
import os
import calendar as cal_lib
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from fastapi import APIRouter, Query, Depends
import pandas as pd
import yfinance as yf
import exchange_calendars as xcals
from services import storage
from services.db import query, execute
from services.market.format import _yf_sym
from services.utils import today_kst
from auth import get_current_user

logger = logging.getLogger(__name__)

# S2: curated FRED release names to show in calendar
_FRED_RELEASES = {
    "Consumer Price Index",
    "Employment Situation",
    "Gross Domestic Product",
    "Producer Price Index",
}

# FOMC 정책결정일(2일차) — federalreserve.gov 공표, 커버리지 ~2027-12, 차기 일정 공표 시 연 1회 수동 갱신; 소진 시 FOMC 미표시(graceful)
_FOMC_DATES = [
    "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18",
    "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
    "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
    "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
    "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09",
    "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
]


def fomc_coverage_status(threshold_months: int = 6) -> dict:
    """_FOMC_DATES 하드코딩 목록의 마지막 날짜와 today를 비교 — 커버리지 소진까지 개월수 +
    갱신필요 플래그. 소진 임박(< threshold개월)하면 배치 허브가 '갱신 필요' 경고를 띄워
    무음 미표시(CONCERNS §7)를 막는다. 목록이 이미 소진돼도 예외 없이 graceful(음수 개월)."""
    today = today_kst()
    last = max(_FOMC_DATES)                     # ISO 문자열 = 날짜 정렬
    days_left = (date.fromisoformat(last) - today).days
    return {
        "last_date": last,
        "months_left": round(days_left / 30.44, 1),
        "needs_update": days_left < threshold_months * 30.44,
        "threshold_months": threshold_months,
    }


router = APIRouter(prefix="/api", tags=["calendar"])

def clear_cache(user_id: str = None) -> None:
    # 라이브 저장소: calendar_cache DB 테이블 — user_id 없으면 전체 삭제(관리자 전역 변경 등).
    # 레거시 파일 캐시(backend/data/calendar/*.json)는 task#167에서 제거됨.
    if user_id:
        execute("DELETE FROM calendar_cache WHERE user_id = %s", (user_id,))
    else:
        execute("DELETE FROM calendar_cache")


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
        [{"ticker": s["ticker"], "stock_type": "holding", "name": s.get("name", s["ticker"]), "market": s.get("market", "US"), "exchange": s.get("exchange", "")} for s in portfolio["stocks"]]
        + [{"ticker": s["ticker"], "stock_type": "watchlist", "name": s.get("name", s["ticker"]), "market": s.get("market", "US"), "exchange": s.get("exchange", "")} for s in portfolio["watchlist"]]
    )

    def _fetch_stock(stock):
        result = []
        try:
            sym = _yf_sym(stock["ticker"], stock["market"], stock["exchange"])
            t = yf.Ticker(sym)
            cal = t.calendar  # fetch once; shared by earnings + dividend
            _collect_earnings(cal, stock["ticker"], stock["stock_type"], stock["name"], month_start, month_end, result)
            _collect_dividend(cal, stock["ticker"], stock["stock_type"], stock["name"], month_start, month_end, result)
        except Exception as e:
            logger.warning(f"[Calendar] skip {stock['ticker']}: {e}")
        return result

    events: list[dict] = []
    with ThreadPoolExecutor(max_workers=max(1, min(len(all_stocks), 15))) as executor:
        futures = {executor.submit(_fetch_stock, s): s for s in all_stocks}
        for future in as_completed(futures):
            events.extend(future.result())

    events.extend(_get_holidays(month_start, month_end))
    events.extend(_get_econ_events(month_start, month_end))
    events.extend(_get_agm_events(all_stocks, month_start, month_end))

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


def _get_agm_events(stocks: list[dict], month_start: date, month_end: date) -> list[dict]:
    """S3: AGM dates from stock_disclosures.meeting_date — read-only, batch-populated.
    eco: pass all tickers; stock_disclosures is KR-only so US tickers return nothing."""
    if not stocks:
        return []
    stock_map = {s["ticker"]: s for s in stocks}
    placeholders = ",".join(["%s"] * len(stocks))
    rows = query(
        f"""
        SELECT DISTINCT ON (ticker) ticker, meeting_date
        FROM stock_disclosures
        WHERE ticker IN ({placeholders})
          AND report_nm LIKE '%%주주총회%%'
          AND meeting_date BETWEEN %s AND %s
        ORDER BY ticker, rcept_dt DESC
        """,
        (*stock_map.keys(), month_start, month_end),
    )
    events = []
    for row in rows:
        s = stock_map.get(row["ticker"])
        if not s:
            continue
        events.append({
            "date": row["meeting_date"].isoformat(),
            "ticker": row["ticker"],
            "name": s["name"],
            "type": "agm",
            "stock_type": s["stock_type"],
        })
    return events


def _get_econ_events(month_start: date, month_end: date) -> list[dict]:
    """S2: FRED /fred/releases/dates → curated major US release dates.
    FOMC 정책결정일은 _FOMC_DATES 정적 목록에서 — FRED_API_KEY 미설정 시에도 항상 포함.
    eco: fetched inline at cache-miss; upgrade path = batch into market_cache
    if FRED rate-limits ever become a problem.
    """
    events: list[dict] = []

    # FOMC: static — always included regardless of FRED_API_KEY
    for d_str in _FOMC_DATES:
        try:
            d = date.fromisoformat(d_str)
        except ValueError:
            continue
        if month_start <= d <= month_end:
            events.append({
                "date": d_str,
                "ticker": "FOMC",
                "name": "FOMC 정책결정",
                "type": "econ",
                "stock_type": "market",
            })

    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        return events
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
        logger.warning(f"[Calendar] FRED releases fetch failed: {e}")
        return events
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
            logger.warning(f"[Calendar] holiday fetch failed {exchange}: {e}")
    return results

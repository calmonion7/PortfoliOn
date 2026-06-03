from __future__ import annotations
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
import yfinance as yf

from services import storage
from services.db import query, execute
from services.market import _yf_sym
from services.market_indicators.fx import _fetch_usdkrw_current
from routers.calendar import _get_events

DIGEST_DIR = Path(__file__).parent.parent / "data" / "digest"
DIGEST_DIR.mkdir(exist_ok=True)
ANOMALY_THRESHOLD = 5.0


def generate(user_id: str, today: date = None) -> dict:
    if today is None:
        today = date.today()

    portfolio = storage.get_full_portfolio(user_id)
    holdings = portfolio.get("stocks", [])
    watchlist = portfolio.get("watchlist", [])
    all_stocks = holdings + watchlist
    holding_tickers = {h["ticker"].upper() for h in holdings}

    def _fetch_quote(stock):
        ticker = stock["ticker"].upper()
        sym = _yf_sym(ticker, stock.get("market", "US"), stock.get("exchange", ""))
        try:
            hist = yf.Ticker(sym).history(period="2d")
            if len(hist) >= 2:
                prev_close = float(hist["Close"].iloc[-2])
                current = float(hist["Close"].iloc[-1])
                change_pct = round((current - prev_close) / prev_close * 100, 2)
                return ticker, {"prev_close": prev_close, "current": current, "change_pct": change_pct}
        except Exception:
            pass
        return ticker, None

    quotes: dict = {}
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(_fetch_quote, s): s for s in all_stocks}
        for future in as_completed(futures):
            ticker, data = future.result()
            if data:
                quotes[ticker] = data

    usdkrw = _fetch_usdkrw_current() or 1380

    def _to_krw(h, price_key):
        ticker = h["ticker"].upper()
        if ticker not in quotes or not h.get("quantity"):
            return 0
        price = quotes[ticker][price_key]
        qty = float(h.get("quantity", 0))
        return price * qty * (1 if h.get("market") == "KR" else usdkrw)

    total_value = sum(_to_krw(h, "current") for h in holdings)
    total_prev = sum(_to_krw(h, "prev_close") for h in holdings)
    daily_change_krw = round(total_value - total_prev, 0)
    daily_change_pct = round(daily_change_krw / total_prev * 100, 2) if total_prev > 0 else 0.0

    stocks_list = []
    anomalies = []
    for stock in sorted(all_stocks, key=lambda s: (0 if s["ticker"].upper() in holding_tickers else 1)):
        ticker = stock["ticker"].upper()
        q = quotes.get(ticker)
        if q is None:
            continue
        is_anomaly = abs(q["change_pct"]) >= ANOMALY_THRESHOLD
        stocks_list.append({
            "ticker": ticker,
            "name": stock.get("name", ticker),
            "change_pct": q["change_pct"],
            "is_holding": ticker in holding_tickers,
            "is_anomaly": is_anomaly,
        })
        if is_anomaly:
            anomalies.append({
                "ticker": ticker,
                "change_pct": q["change_pct"],
                "reason": f"{'상승' if q['change_pct'] > 0 else '하락'} {abs(q['change_pct']):.1f}%",
            })

    end_date = today + timedelta(days=7)
    month_str = today.strftime("%Y-%m")
    next_month_str = (today.replace(day=1) + timedelta(days=32)).strftime("%Y-%m")
    all_events = _get_events(month_str, user_id)
    if end_date.month != today.month or end_date.year != today.year:
        all_events = all_events + _get_events(next_month_str, user_id)

    events_7d = sorted(
        [
            {
                "ticker": ev["ticker"],
                "event_type": ev["type"],
                "date": ev["date"],
                "days_until": (date.fromisoformat(ev["date"]) - today).days,
            }
            for ev in all_events
            if today <= date.fromisoformat(ev["date"]) <= end_date
        ],
        key=lambda x: x["date"],
    )

    kst = timezone(timedelta(hours=9))
    digest = {
        "date": today.isoformat(),
        "generated_at": datetime.now(kst).isoformat(timespec="seconds"),
        "portfolio_summary": {
            "total_value_krw": round(total_value, 0),
            "daily_change_pct": daily_change_pct,
            "daily_change_krw": daily_change_krw,
        },
        "stocks": stocks_list,
        "events_7d": events_7d,
        "anomalies": anomalies,
    }

    try:
        execute(
            "INSERT INTO digests (user_id, date, data) VALUES (%s, %s, %s) ON CONFLICT (user_id, date) DO UPDATE SET data=EXCLUDED.data",
            (user_id, today.isoformat(), json.dumps(digest)),
        )
    except Exception as e:
        print(f"[Digest] DB save failed, falling back to file: {e}")
        path = DIGEST_DIR / f"{user_id}-{today.isoformat()}.json"
        path.write_text(json.dumps(digest, ensure_ascii=False, indent=2), encoding="utf-8")
    return digest


def get_latest(user_id: str) -> dict | None:
    try:
        rows = query(
            "SELECT data FROM digests WHERE user_id = %s ORDER BY date DESC LIMIT 1",
            (user_id,),
        )
        if rows:
            return rows[0]["data"]
    except Exception as e:
        print(f"[Digest] DB read failed, falling back to file: {e}")
    # Filesystem fallback
    files = sorted(DIGEST_DIR.glob(f"{user_id}-*.json"), reverse=True)
    if not files:
        return None
    return json.loads(files[0].read_text(encoding="utf-8"))


def send_telegram(digest: dict) -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return

    summary = digest["portfolio_summary"]
    sign = "+" if summary["daily_change_pct"] >= 0 else ""
    lines = [
        f"📊 Daily Digest — {digest['date']}",
        f"포트폴리오: ₩{summary['total_value_krw']:,.0f}  "
        f"{sign}{summary['daily_change_pct']:.1f}% ({sign}₩{summary['daily_change_krw']:,.0f})",
    ]

    if digest["anomalies"]:
        lines.append("\n⚠ 이상신호")
        for a in digest["anomalies"]:
            s = "+" if a["change_pct"] >= 0 else ""
            lines.append(f"  {a['ticker']}  {s}{a['change_pct']:.1f}%")

    if digest["events_7d"]:
        lines.append("\n📅 향후 7일 이벤트")
        for ev in digest["events_7d"][:5]:
            label = "실적" if ev["event_type"] == "earnings" else "배당"
            lines.append(f"  D-{ev['days_until']}  {ev['ticker']}  {label}")

    lines.append("\n종목별 등락")
    for s in digest["stocks"]:
        sign2 = "+" if s["change_pct"] >= 0 else ""
        lines.append(f"  {s['ticker']}  {sign2}{s['change_pct']:.1f}%")

    try:
        requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": "\n".join(lines)},
            timeout=10,
        )
    except Exception as e:
        print(f"[Digest] Telegram send failed: {e}")

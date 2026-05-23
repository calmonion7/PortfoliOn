from __future__ import annotations
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
import yfinance as yf

from services import storage
from services.market import _yf_sym
from routers.calendar import _get_events

DIGEST_DIR = Path(__file__).parent.parent / "data" / "digest"
DIGEST_DIR.mkdir(exist_ok=True)
ANOMALY_THRESHOLD = 5.0


def generate(today: date = None) -> dict:
    if today is None:
        today = date.today()

    portfolio = storage.get_full_portfolio()
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

    total_value = sum(
        h.get("quantity", 0) * quotes[h["ticker"].upper()]["current"]
        for h in holdings
        if h["ticker"].upper() in quotes and h.get("quantity")
    )
    total_prev = sum(
        h.get("quantity", 0) * quotes[h["ticker"].upper()]["prev_close"]
        for h in holdings
        if h["ticker"].upper() in quotes and h.get("quantity")
    )
    daily_change_usd = round(total_value - total_prev, 2)
    daily_change_pct = round(daily_change_usd / total_prev * 100, 2) if total_prev > 0 else 0.0

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
    all_events = _get_events(month_str)
    if next_month_str != month_str:
        all_events = all_events + _get_events(next_month_str)

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
            "total_value_usd": round(total_value, 2),
            "daily_change_pct": daily_change_pct,
            "daily_change_usd": daily_change_usd,
        },
        "stocks": stocks_list,
        "events_7d": events_7d,
        "anomalies": anomalies,
    }

    path = DIGEST_DIR / f"{today.isoformat()}.json"
    path.write_text(json.dumps(digest, ensure_ascii=False, indent=2), encoding="utf-8")
    return digest


def get_latest() -> dict | None:
    files = sorted(DIGEST_DIR.glob("*.json"), reverse=True)
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
        f"포트폴리오: ${summary['total_value_usd']:,.0f}  "
        f"{sign}{summary['daily_change_pct']:.1f}% ({sign}${summary['daily_change_usd']:,.0f})",
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

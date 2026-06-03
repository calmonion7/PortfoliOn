from __future__ import annotations
from datetime import date
from services.db import execute, query


def get_history(ticker: str) -> list[dict]:
    from services.consensus_pipeline import get_mart_history
    mart = get_mart_history(ticker)
    if mart:
        return mart
    # 마트 데이터 없으면 legacy consensus_history 폴백
    rows = query(
        "SELECT date, target_high, target_mean, target_low, buy, hold, sell FROM consensus_history"
        " WHERE ticker = %s ORDER BY date DESC",
        (ticker.upper(),),
    )
    return [
        {
            "date": str(r["date"]),
            "target_high": r.get("target_high"),
            "target_mean": r.get("target_mean"),
            "target_low": r.get("target_low"),
            "buy": r.get("buy"),
            "hold": r.get("hold"),
            "sell": r.get("sell"),
        }
        for r in rows
    ]


def collect(ticker: str) -> dict | None:
    upper = ticker.upper()
    rows = query(
        "SELECT data FROM snapshots WHERE ticker = %s ORDER BY date DESC LIMIT 1",
        (upper,),
    )
    if not rows:
        return None
    summary = rows[0]["data"] or {}
    target_high = summary.get("target_high")
    target_mean = summary.get("target_mean")
    target_low = summary.get("target_low")
    buy = summary.get("buy")
    hold = summary.get("hold")
    sell = summary.get("sell")
    if all(v is None for v in [target_mean, buy, hold, sell]):
        return None
    entry = {
        "ticker": upper,
        "date": str(date.today()),
        "target_high": target_high,
        "target_mean": target_mean,
        "target_low": target_low,
        "buy": buy,
        "hold": hold,
        "sell": sell,
    }
    execute(
        "INSERT INTO consensus_history (ticker, date, target_high, target_mean, target_low, buy, hold, sell)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"
        " ON CONFLICT (ticker, date) DO UPDATE SET"
        "  target_high=EXCLUDED.target_high, target_mean=EXCLUDED.target_mean,"
        "  target_low=EXCLUDED.target_low, buy=EXCLUDED.buy,"
        "  hold=EXCLUDED.hold, sell=EXCLUDED.sell",
        (upper, entry["date"], entry["target_high"], entry["target_mean"], entry["target_low"],
         entry["buy"], entry["hold"], entry["sell"]),
    )
    return {k: v for k, v in entry.items() if k != "ticker"}


def backfill(ticker: str, market: str, days: int = 180, force: bool = False) -> list[dict]:
    from datetime import timedelta
    upper = ticker.upper()

    fetched = _fetch_kr(upper, days) if market == "KR" else _fetch_us(upper, days)

    if force:
        cutoff = (date.today() - timedelta(days=days)).isoformat()
        execute(
            "DELETE FROM consensus_history WHERE ticker = %s AND date >= %s",
            (upper, cutoff),
        )
        to_add = fetched
    else:
        existing_rows = query(
            "SELECT date FROM consensus_history WHERE ticker = %s",
            (upper,),
        )
        existing_dates = {str(r["date"]) for r in existing_rows}
        to_add = [e for e in fetched if e["date"] not in existing_dates]

    if not to_add:
        return []

    for e in to_add:
        execute(
            "INSERT INTO consensus_history (ticker, date, target_high, target_mean, target_low, buy, hold, sell)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"
            " ON CONFLICT (ticker, date) DO UPDATE SET"
            "  target_high=EXCLUDED.target_high, target_mean=EXCLUDED.target_mean,"
            "  target_low=EXCLUDED.target_low, buy=EXCLUDED.buy,"
            "  hold=EXCLUDED.hold, sell=EXCLUDED.sell",
            (upper, e["date"], e.get("target_high"), e.get("target_mean"), e.get("target_low"),
             e.get("buy"), e.get("hold"), e.get("sell")),
        )
    return to_add


_KR_BUY = {"매수", "적극매수", "강력매수"}
_KR_SELL = {"매도", "강력매도"}
_US_BUY = {"Buy", "Outperform", "Overweight", "Strong Buy", "Positive", "Add", "Accumulate", "Top Pick"}
_US_SELL = {"Sell", "Underperform", "Underweight", "Strong Sell", "Negative", "Reduce"}


def _fetch_kr(ticker: str, days: int = 180) -> list[dict]:
    import requests
    from collections import defaultdict
    from concurrent.futures import ThreadPoolExecutor
    from datetime import timedelta
    from services.consensus_pipeline import _fetch_kr_fnguide

    today = date.today()
    cutoff = (today - timedelta(days=days)).isoformat()

    # FnGuide 우선
    fg_raw = _fetch_kr_fnguide(ticker)
    fg_recent = [r for r in fg_raw if r["report_date"] >= cutoff]
    if fg_recent:
        by_date: dict = defaultdict(list)
        for r in fg_recent:
            by_date[r["report_date"]].append((r.get("raw_opinion", ""), r.get("target_price")))
        output = []
        for d, reports in sorted(by_date.items()):
            buy  = sum(1 for op, _ in reports if op in _KR_BUY)
            sell = sum(1 for op, _ in reports if op in _KR_SELL)
            hold = len(reports) - buy - sell
            prices = [gp for _, gp in reports if gp is not None]
            output.append({
                "date": d,
                "target_high": round(max(prices)) if prices else None,
                "target_mean": round(sum(prices) / len(prices)) if prices else None,
                "target_low": round(min(prices)) if prices else None,
                "buy": buy,
                "hold": hold,
                "sell": sell,
            })
        return output

    # fallback: Naver Research
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        r = requests.get(
            f"https://m.stock.naver.com/api/research/stock/{ticker}?pageSize=200",
            headers=headers, timeout=8,
        )
        r.raise_for_status()
        items = r.json()
    except Exception:
        return []

    recent = [i for i in items if i.get("writeDate", "") >= cutoff]
    if not recent:
        return []

    def fetch_detail(item):
        rid = item["researchId"]
        write_date = item["writeDate"]
        try:
            dr = requests.get(
                f"https://m.stock.naver.com/api/research/stock/{ticker}/{rid}",
                headers=headers, timeout=8,
            )
            dr.raise_for_status()
            content = dr.json().get("researchContent", {})
            opinion = content.get("opinion", "").strip()
            price_str = content.get("goalPrice", "")
            try:
                goal_price = float(price_str.replace(",", "")) if price_str else None
            except ValueError:
                goal_price = None
            return write_date, opinion, goal_price
        except Exception:
            return write_date, "", None

    with ThreadPoolExecutor(max_workers=5) as ex:
        all_reports = list(ex.map(fetch_detail, recent))

    by_date2: dict = defaultdict(list)
    for d, op, gp in all_reports:
        by_date2[d[:10]].append((op, gp))

    output = []
    for d, reports in sorted(by_date2.items()):
        buy  = sum(1 for op, _ in reports if op in _KR_BUY)
        sell = sum(1 for op, _ in reports if op in _KR_SELL)
        hold = len(reports) - buy - sell
        prices = [gp for _, gp in reports if gp is not None]
        output.append({
            "date": d,
            "target_high": round(max(prices)) if prices else None,
            "target_mean": round(sum(prices) / len(prices)) if prices else None,
            "target_low": round(min(prices)) if prices else None,
            "buy": buy,
            "hold": hold,
            "sell": sell,
        })
    return output


def _fetch_us(ticker: str, days: int = 180) -> list[dict]:
    try:
        import yfinance as yf
        import pandas as pd
        from collections import defaultdict
        from datetime import timedelta
        t = yf.Ticker(ticker.replace(".", "-"))
        ud = t.upgrades_downgrades
        if ud is None or ud.empty:
            return []

        idx = pd.to_datetime(ud.index)
        if idx.tz is not None:
            idx = idx.tz_convert(None)
        ud = ud.copy()
        ud.index = idx.date

        cutoff = (date.today() - timedelta(days=days))
        by_date: dict = defaultdict(list)
        for d, row in ud.iterrows():
            if d >= cutoff:
                by_date[d].append(row)

        output = []
        for d, rows in sorted(by_date.items()):
            buy  = sum(1 for row in rows if row.get("ToGrade", "") in _US_BUY)
            sell = sum(1 for row in rows if row.get("ToGrade", "") in _US_SELL)
            hold = len(rows) - buy - sell
            prices = [row.get("currentPriceTarget") for row in rows
                      if row.get("currentPriceTarget") is not None
                      and float(row.get("currentPriceTarget")) > 0]
            output.append({
                "date": d.isoformat(),
                "target_high": round(max(prices), 2) if prices else None,
                "target_mean": round(sum(prices) / len(prices), 2) if prices else None,
                "target_low": round(min(prices), 2) if prices else None,
                "buy": buy,
                "hold": hold,
                "sell": sell,
            })
        return output
    except Exception:
        return []

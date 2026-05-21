from __future__ import annotations
import json
from datetime import date
from pathlib import Path

CONSENSUS_DIR = Path(__file__).parent.parent / "data" / "consensus"
SNAPSHOTS_DIR = Path(__file__).parent.parent / "snapshots"
REPORTS_DIR = Path(__file__).parent.parent / "reports"


def _month_start(n: int) -> date:
    today = date.today()
    month = today.month - n
    year = today.year
    while month <= 0:
        month += 12
        year -= 1
    return date(year, month, 1)


def get_history(ticker: str) -> list[dict]:
    path = CONSENSUS_DIR / f"{ticker.upper()}.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def collect(ticker: str) -> dict | None:
    upper = ticker.upper()
    json_files = []
    for base in (SNAPSHOTS_DIR, REPORTS_DIR):
        d = base / upper
        if d.exists():
            json_files = sorted(d.glob("*.json"), reverse=True)
            if json_files:
                break
    if not json_files:
        return None
    summary = json.loads(json_files[0].read_text(encoding="utf-8"))
    target_mean = summary.get("target_mean")
    buy = summary.get("buy")
    hold = summary.get("hold")
    sell = summary.get("sell")
    if all(v is None for v in [target_mean, buy, hold, sell]):
        return None
    entry = {
        "date": str(date.today()),
        "target_mean": target_mean,
        "buy": buy,
        "hold": hold,
        "sell": sell,
    }
    CONSENSUS_DIR.mkdir(parents=True, exist_ok=True)
    path = CONSENSUS_DIR / f"{upper}.json"
    existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    existing = [e for e in existing if e["date"] != entry["date"]]
    existing.append(entry)
    existing.sort(key=lambda e: e["date"], reverse=True)
    path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    return entry


def backfill(ticker: str, market: str) -> list[dict]:
    upper = ticker.upper()
    existing = get_history(upper)
    existing_dates = {e["date"] for e in existing}

    fetched = _fetch_kr(upper) if market == "KR" else _fetch_us(upper)
    to_add = [e for e in fetched if e["date"] not in existing_dates]

    if not to_add:
        return []

    CONSENSUS_DIR.mkdir(parents=True, exist_ok=True)
    path = CONSENSUS_DIR / f"{upper}.json"
    merged = existing + to_add
    merged.sort(key=lambda e: e["date"], reverse=True)
    path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    return to_add


_KR_BUY = {"매수", "적극매수", "강력매수"}
_KR_SELL = {"매도", "강력매도"}
_US_BUY = {"Buy", "Outperform", "Overweight", "Strong Buy", "Positive", "Add", "Accumulate", "Top Pick"}
_US_SELL = {"Sell", "Underperform", "Underweight", "Strong Sell", "Negative", "Reduce"}


def _fetch_kr(ticker: str) -> list[dict]:
    import requests
    from concurrent.futures import ThreadPoolExecutor
    from datetime import timedelta

    today = date.today()
    cutoff = (today - timedelta(days=180)).isoformat()
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

    output = []
    for n_months in [3, 2, 1]:
        ref = _month_start(n_months)
        window_start = (ref - timedelta(days=90)).isoformat()
        ref_str = ref.isoformat()
        active = [(d, op, gp) for d, op, gp in all_reports if window_start <= d <= ref_str]
        if not active:
            continue
        buy  = sum(1 for _, op, _ in active if op in _KR_BUY)
        sell = sum(1 for _, op, _ in active if op in _KR_SELL)
        hold = len(active) - buy - sell
        prices = [gp for _, _, gp in active if gp is not None]
        output.append({
            "date": ref_str,
            "target_mean": round(sum(prices) / len(prices)) if prices else None,
            "buy": buy,
            "hold": hold,
            "sell": sell,
        })
    return output


def _fetch_us(ticker: str) -> list[dict]:
    """yfinance recommendations_summary + upgrades_downgrades로 과거 3개월 월별 컨센서스 수집."""
    try:
        import yfinance as yf
        import pandas as pd
        t = yf.Ticker(ticker.replace(".", "-"))
        recs = t.recommendations_summary
        if recs is None or recs.empty:
            return []

        if "period" in recs.columns:
            recs = recs.set_index("period")

        target_by_month: dict[str, float] = {}
        try:
            ud = t.upgrades_downgrades
            if ud is not None and not ud.empty:
                idx = pd.to_datetime(ud.index)
                if idx.tz is not None:
                    idx = idx.tz_convert(None)
                ud = ud.copy()
                ud.index = idx.date
                for n in [1, 2, 3]:
                    start = _month_start(n)
                    end = _month_start(n - 1)
                    mask = (ud.index >= start) & (ud.index < end)
                    prices = ud.loc[mask, "currentPriceTarget"].dropna()
                    prices = prices[prices > 0]
                    if len(prices) > 0:
                        target_by_month[start.isoformat()] = round(float(prices.mean()), 2)
        except Exception:
            pass

        period_map = {"-1m": _month_start(1), "-2m": _month_start(2), "-3m": _month_start(3)}

        result = []
        for period, dt in period_map.items():
            if period not in recs.index:
                continue
            row = recs.loc[period]
            buy = int(row.get("strongBuy", 0)) + int(row.get("buy", 0))
            hold = int(row.get("hold", 0))
            sell = int(row.get("sell", 0)) + int(row.get("strongSell", 0))
            result.append({
                "date": dt.isoformat(),
                "target_mean": target_by_month.get(dt.isoformat()),
                "buy": buy,
                "hold": hold,
                "sell": sell,
            })
        return result
    except Exception:
        return []

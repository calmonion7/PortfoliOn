from __future__ import annotations
import json
from collections import defaultdict
from datetime import date
from pathlib import Path

CONSENSUS_DIR = Path(__file__).parent.parent / "data" / "consensus"
REPORTS_DIR = Path(__file__).parent.parent / "reports"


def get_history(ticker: str) -> list[dict]:
    path = CONSENSUS_DIR / f"{ticker.upper()}.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def collect(ticker: str) -> dict | None:
    """최신 리포트 JSON에서 컨센서스를 읽어 날짜별 파일에 누적한다. 데이터 없으면 None 반환."""
    upper = ticker.upper()
    ticker_dir = REPORTS_DIR / upper
    if not ticker_dir.exists():
        return None
    json_files = sorted(ticker_dir.glob("*.json"), reverse=True)
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
    """외부 소스에서 과거 컨센서스를 가져와 기존에 없는 날짜만 추가한다."""
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
    """Naver Research API로 최근 60일 날짜별 컨센서스 수집."""
    import requests
    from concurrent.futures import ThreadPoolExecutor
    from datetime import timedelta

    cutoff = (date.today() - timedelta(days=60)).isoformat()
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
        results = list(ex.map(fetch_detail, recent))

    by_date: dict[str, dict] = defaultdict(lambda: {"buy": 0, "hold": 0, "sell": 0, "prices": []})
    for write_date, opinion, goal_price in results:
        d = by_date[write_date]
        if opinion in _KR_BUY:
            d["buy"] += 1
        elif opinion in _KR_SELL:
            d["sell"] += 1
        else:
            d["hold"] += 1
        if goal_price is not None:
            d["prices"].append(goal_price)

    output = []
    for dt, d in sorted(by_date.items()):
        prices = d["prices"]
        output.append({
            "date": dt,
            "target_mean": round(sum(prices) / len(prices)) if prices else None,
            "buy": d["buy"],
            "hold": d["hold"],
            "sell": d["sell"],
        })
    return output


def _fetch_us(ticker: str) -> list[dict]:
    """yfinance upgrades_downgrades로 최근 60일 날짜별 컨센서스 수집."""
    from datetime import timedelta
    try:
        import yfinance as yf
        import pandas as pd
        ud = yf.Ticker(ticker).upgrades_downgrades
        if ud is None or ud.empty:
            return []

        cutoff = date.today() - timedelta(days=60)
        grade_dates = pd.to_datetime(ud.index)
        if grade_dates.tz is not None:
            grade_dates = grade_dates.tz_convert(None)
        ud = ud.copy()
        ud.index = grade_dates.date
        ud = ud[ud.index >= cutoff]

        by_date: dict[str, dict] = defaultdict(lambda: {"buy": 0, "hold": 0, "sell": 0, "prices": []})
        for grade_date, row in ud.iterrows():
            dt = str(grade_date)
            grade = str(row.get("ToGrade", ""))
            d = by_date[dt]
            if grade in _US_BUY:
                d["buy"] += 1
            elif grade in _US_SELL:
                d["sell"] += 1
            else:
                d["hold"] += 1
            try:
                price = float(row.get("currentPriceTarget", 0) or 0)
                if price > 0:
                    d["prices"].append(price)
            except (ValueError, TypeError):
                pass

        return [
            {
                "date": dt,
                "target_mean": round(sum(d["prices"]) / len(d["prices"]), 2) if d["prices"] else None,
                "buy": d["buy"],
                "hold": d["hold"],
                "sell": d["sell"],
            }
            for dt, d in sorted(by_date.items())
        ]
    except Exception:
        return []

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


def _fetch_kr(ticker: str) -> list[dict]:
    """FnGuide에서 최근 ~6주 날짜별 컨센서스 수집."""
    import requests
    url = f"https://comp.fnguide.com/SVO2/json/data/01_06/03_A{ticker}.json"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://comp.fnguide.com/",
    }
    try:
        r = requests.get(url, headers=headers, timeout=8)
        r.raise_for_status()
        data = json.loads(r.content.decode("utf-8-sig"))
    except Exception:
        return []

    by_date: dict[str, list] = defaultdict(list)
    for item in data.get("comp", []):
        est_dt = item.get("EST_DT", "")
        if est_dt:
            by_date[est_dt].append(item)

    result = []
    for est_dt, items in sorted(by_date.items()):
        avg_prc_str = items[0].get("AVG_PRC", "")
        try:
            target_mean = float(avg_prc_str.replace(",", "")) if avg_prc_str else None
        except ValueError:
            target_mean = None
        recom_codes = []
        for item in items:
            try:
                recom_codes.append(float(item["RECOM_CD"]))
            except (ValueError, KeyError):
                pass
        result.append({
            "date": est_dt.replace("/", "-"),
            "target_mean": target_mean,
            "buy":  sum(1 for c in recom_codes if c >= 3.5),
            "hold": sum(1 for c in recom_codes if 2.5 <= c < 3.5),
            "sell": sum(1 for c in recom_codes if c < 2.5),
        })
    return result


def _fetch_us(ticker: str) -> list[dict]:
    """yfinance recommendations에서 최근 4개월 월별 컨센서스 수집."""
    try:
        import yfinance as yf
        recs = yf.Ticker(ticker).recommendations
        if recs is None or recs.empty:
            return []
    except Exception:
        return []

    result = []
    for _, row in recs.iterrows():
        period = str(row.get("period", ""))
        if not period.endswith("m"):
            continue
        result.append({
            "date": _period_to_date(period),
            "target_mean": None,
            "buy":  int(row.get("strongBuy", 0)) + int(row.get("buy", 0)),
            "hold": int(row.get("hold", 0)),
            "sell": int(row.get("sell", 0)) + int(row.get("strongSell", 0)),
        })
    return result


def _period_to_date(period: str) -> str:
    """yfinance period 문자열('0m', '-1m' 등)을 해당 월 1일 ISO 날짜로 변환."""
    offset = int(period.replace("m", ""))
    today = date.today()
    month = today.month + offset
    year = today.year
    while month <= 0:
        month += 12
        year -= 1
    return date(year, month, 1).isoformat()

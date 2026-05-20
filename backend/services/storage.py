import json
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).parent.parent / "data"

_ANALYST_KEYS = frozenset({"name", "competitors", "moat", "growth_plan", "risks", "recent_disclosures"})


def _read_json(filename: str) -> Any:
    path = DATA_DIR / filename
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(filename: str, data: Any) -> None:
    path = DATA_DIR / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _get_unified() -> list[dict]:
    data = _read_json("stocks.json")
    return data.get("stocks", []) if data else []


def _save_unified(stocks: list[dict]) -> None:
    _write_json("stocks.json", {"stocks": stocks})


def get_stocks() -> list[dict]:
    return [
        {k: s[k] for k in (*_ANALYST_KEYS, "ticker", "market", "exchange") if k in s}
        for s in _get_unified()
    ]


def save_stocks(stocks: list[dict]) -> None:
    by_ticker = {s["ticker"]: s for s in _get_unified()}
    incoming = {s["ticker"].upper(): s for s in stocks}
    # Remove non-holdings not in new list
    for t in list(by_ticker):
        if t not in incoming and by_ticker[t].get("type") != "holding":
            del by_ticker[t]
    # Update / insert analyst fields
    for t, s in incoming.items():
        if t in by_ticker:
            by_ticker[t].update({k: v for k, v in s.items() if k in _ANALYST_KEYS})
        else:
            by_ticker[t] = {
                "ticker": t, "type": "watchlist", "quantity": None, "avg_cost": None,
                "market": s.get("market", "US"), "exchange": s.get("exchange", ""),
                **{k: s.get(k, "") for k in _ANALYST_KEYS},
            }
    _save_unified(list(by_ticker.values()))


def get_holdings() -> list[dict]:
    return [
        {"ticker": s["ticker"], "quantity": s["quantity"], "avg_cost": s["avg_cost"],
         "market": s.get("market", "US"), "exchange": s.get("exchange", "")}
        for s in _get_unified() if s.get("type") == "holding"
    ]


def save_holdings(holdings: list[dict]) -> None:
    by_ticker = {s["ticker"]: s for s in _get_unified()}
    holding_tickers = {h["ticker"].upper() for h in holdings}
    # Demote removed holdings to watchlist
    for s in by_ticker.values():
        if s.get("type") == "holding" and s["ticker"] not in holding_tickers:
            s["type"] = "watchlist"
            s["quantity"] = None
            s["avg_cost"] = None
    # Update / insert
    for h in holdings:
        t = h["ticker"].upper()
        if t in by_ticker:
            by_ticker[t]["type"] = "holding"
            by_ticker[t]["quantity"] = h["quantity"]
            by_ticker[t]["avg_cost"] = h["avg_cost"]
            by_ticker[t]["market"] = h.get("market", by_ticker[t].get("market", "US"))
            by_ticker[t]["exchange"] = h.get("exchange", by_ticker[t].get("exchange", ""))
        else:
            by_ticker[t] = {
                "ticker": t, "type": "holding", "name": t, "quantity": h["quantity"],
                "avg_cost": h["avg_cost"], "market": h.get("market", "US"),
                "exchange": h.get("exchange", ""), "competitors": [], "moat": "",
                "growth_plan": "", "risks": "", "recent_disclosures": "",
            }
    _save_unified(list(by_ticker.values()))


def get_watchlist_tickers() -> list[str]:
    return [s["ticker"] for s in _get_unified() if s.get("type") == "watchlist"]


def save_watchlist_tickers(tickers: list[str]) -> None:
    by_ticker = {s["ticker"]: s for s in _get_unified()}
    for t in [t.upper() for t in tickers]:
        if t in by_ticker:
            if by_ticker[t].get("type") != "holding":
                by_ticker[t]["type"] = "watchlist"
        else:
            by_ticker[t] = {
                "ticker": t, "type": "watchlist", "name": t, "quantity": None,
                "avg_cost": None, "market": "US", "exchange": "",
                "competitors": [], "moat": "", "growth_plan": "",
                "risks": "", "recent_disclosures": "",
            }
    _save_unified(list(by_ticker.values()))


def get_full_portfolio() -> dict:
    unified = _get_unified()
    return {
        "stocks": [s for s in unified if s.get("type") == "holding"],
        "watchlist": [s for s in unified if s.get("type") == "watchlist"],
    }


def get_schedule() -> dict:
    data = _read_json("schedule.json")
    return data if data is not None else {
        "enabled": False, "time": "08:00",
        "days": ["mon", "tue", "wed", "thu", "fri"],
    }


def save_schedule(schedule: dict) -> None:
    _write_json("schedule.json", schedule)


def enrich_stock(ticker: str, fields: dict) -> bool:
    upper = ticker.upper()
    unified = _get_unified()
    by_ticker = {s["ticker"]: s for s in unified}
    if upper not in by_ticker:
        return False
    for k, v in fields.items():
        by_ticker[upper][k] = v
    _save_unified(list(by_ticker.values()))
    return True


def get_guru_managers() -> dict:
    data = _read_json("guru_managers.json")
    return data if data is not None else {"last_updated": None, "managers": []}


def save_guru_managers(data: dict) -> None:
    _write_json("guru_managers.json", data)


def get_guru_schedule() -> dict:
    data = _read_json("guru_schedule.json")
    return data if data is not None else {"enabled": False, "day": "sun", "time": "03:00"}


def save_guru_schedule(schedule: dict) -> None:
    _write_json("guru_schedule.json", schedule)

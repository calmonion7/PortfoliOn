import json
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).parent.parent / "data"


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


def get_stocks() -> list[dict]:
    data = _read_json("stocks.json")
    return data.get("stocks", []) if data else []


def save_stocks(stocks: list[dict]) -> None:
    _write_json("stocks.json", {"stocks": stocks})


def get_holdings() -> list[dict]:
    data = _read_json("holdings.json")
    return data.get("holdings", []) if data else []


def save_holdings(holdings: list[dict]) -> None:
    _write_json("holdings.json", {"holdings": holdings})


def get_watchlist_tickers() -> list[str]:
    data = _read_json("watchlist.json")
    return data.get("watchlist", []) if data else []


def save_watchlist_tickers(tickers: list[str]) -> None:
    _write_json("watchlist.json", {"watchlist": tickers})


def get_full_portfolio() -> dict:
    stocks = get_stocks()
    holdings = get_holdings()
    watchlist_tickers = get_watchlist_tickers()
    stocks_by_ticker = {s["ticker"]: s for s in stocks}

    def _fallback(t: str) -> dict:
        return {"ticker": t, "name": t, "competitors": [], "moat": "", "growth_plan": "",
                "risks": "", "recent_disclosures": "", "market": "US", "exchange": ""}

    holding_stocks = []
    for h in holdings:
        meta = stocks_by_ticker.get(h["ticker"], _fallback(h["ticker"]))
        holding_stocks.append({
            **meta,
            "quantity": h["quantity"],
            "avg_cost": h["avg_cost"],
            "market": h.get("market", meta.get("market", "US")),
            "exchange": h.get("exchange", meta.get("exchange", "")),
        })

    watchlist_stocks = [
        stocks_by_ticker.get(t, _fallback(t))
        for t in watchlist_tickers
    ]
    return {"stocks": holding_stocks, "watchlist": watchlist_stocks}


def get_schedule() -> dict:
    data = _read_json("schedule.json")
    return data if data is not None else {
        "enabled": False,
        "time": "08:00",
        "days": ["mon", "tue", "wed", "thu", "fri"],
    }


def save_schedule(schedule: dict) -> None:
    _write_json("schedule.json", schedule)


def enrich_stock(ticker: str, fields: dict) -> bool:
    upper = ticker.upper()
    holdings = get_holdings()
    watchlist = get_watchlist_tickers()
    all_tickers = {h["ticker"].upper() for h in holdings} | {t.upper() for t in watchlist}
    if upper not in all_tickers:
        return False
    stocks = get_stocks()
    idx = next((i for i, s in enumerate(stocks) if s["ticker"].upper() == upper), None)
    if idx is not None:
        for k, v in fields.items():
            stocks[idx][k] = v
    else:
        entry = {"ticker": upper, "name": upper, "competitors": [],
                 "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": "",
                 "market": "US", "exchange": ""}
        entry.update(fields)
        stocks.append(entry)
    save_stocks(stocks)
    return True

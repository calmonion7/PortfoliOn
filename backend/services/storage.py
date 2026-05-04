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

def get_portfolio() -> dict:
    data = _read_json("portfolio.json")
    if data is None:
        return {"stocks": [], "watchlist": []}
    if "watchlist" not in data:
        data["watchlist"] = []
    return data

def save_portfolio(portfolio: dict) -> None:
    _write_json("portfolio.json", portfolio)

def get_schedule() -> dict:
    data = _read_json("schedule.json")
    return data if data is not None else {
        "enabled": False,
        "time": "08:00",
        "days": ["mon", "tue", "wed", "thu", "fri"],
    }

def save_schedule(schedule: dict) -> None:
    _write_json("schedule.json", schedule)

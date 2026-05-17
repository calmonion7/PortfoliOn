import json
import shutil
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"


def migrate():
    portfolio_path = DATA_DIR / "portfolio.json"
    if not portfolio_path.exists():
        print("portfolio.json not found — nothing to migrate.")
        return

    with open(portfolio_path, "r", encoding="utf-8") as f:
        portfolio = json.load(f)

    old_stocks = portfolio.get("stocks", [])
    old_watchlist = portfolio.get("watchlist", [])

    stocks = []
    for s in old_stocks:
        stocks.append({
            "ticker": s["ticker"],
            "name": s.get("name", s["ticker"]),
            "competitors": s.get("competitors", []),
            "moat": s.get("moat", ""),
            "growth_plan": s.get("growth_plan", ""),
        })
    for w in old_watchlist:
        stocks.append({
            "ticker": w["ticker"],
            "name": w.get("name", w["ticker"]),
            "competitors": w.get("competitors", []),
            "moat": w.get("moat", ""),
            "growth_plan": w.get("growth_plan", ""),
        })

    holdings = [
        {"ticker": s["ticker"], "quantity": s["quantity"], "avg_cost": s["avg_cost"]}
        for s in old_stocks
    ]

    watchlist_tickers = [w["ticker"] for w in old_watchlist]

    def write(filename, data):
        with open(DATA_DIR / filename, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    write("stocks.json", {"stocks": stocks})
    write("holdings.json", {"holdings": holdings})
    write("watchlist.json", {"watchlist": watchlist_tickers})

    shutil.copy(portfolio_path, DATA_DIR / "portfolio.json.bak")
    portfolio_path.unlink()

    print("Migration complete.")
    print(f"  stocks.json    : {len(stocks)} 종목")
    print(f"  holdings.json  : {len(holdings)} 보유종목")
    print(f"  watchlist.json : {len(watchlist_tickers)} 관심종목")
    print(f"  portfolio.json.bak : 백업 생성")


if __name__ == "__main__":
    migrate()

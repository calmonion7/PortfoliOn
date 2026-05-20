"""One-shot migration: merge holdings.json + watchlist.json + stocks.json → unified stocks.json"""
import json
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"


def _read(name):
    p = DATA_DIR / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


holdings = _read("holdings.json").get("holdings", [])
watchlist = _read("watchlist.json").get("watchlist", [])
stocks_meta = {s["ticker"]: s for s in _read("stocks.json").get("stocks", [])}

unified = []
holding_tickers = set()

for h in holdings:
    t = h["ticker"].upper()
    holding_tickers.add(t)
    meta = stocks_meta.get(t, {})
    unified.append({
        "ticker": t,
        "name": meta.get("name", t),
        "market": h.get("market", meta.get("market", "US")),
        "exchange": h.get("exchange", meta.get("exchange", "")),
        "type": "holding",
        "quantity": h["quantity"],
        "avg_cost": h["avg_cost"],
        "competitors": meta.get("competitors", []),
        "moat": meta.get("moat", ""),
        "growth_plan": meta.get("growth_plan", ""),
        "recent_disclosures": meta.get("recent_disclosures", ""),
        "risks": meta.get("risks", ""),
    })

for ticker_str in watchlist:
    t = ticker_str.upper()
    if t in holding_tickers:
        continue
    meta = stocks_meta.get(t, {})
    unified.append({
        "ticker": t,
        "name": meta.get("name", t),
        "market": meta.get("market", "US"),
        "exchange": meta.get("exchange", ""),
        "type": "watchlist",
        "quantity": None,
        "avg_cost": None,
        "competitors": meta.get("competitors", []),
        "moat": meta.get("moat", ""),
        "growth_plan": meta.get("growth_plan", ""),
        "recent_disclosures": meta.get("recent_disclosures", ""),
        "risks": meta.get("risks", ""),
    })

# stocks.json에만 있고 holdings/watchlist에 없는 항목
covered = holding_tickers | {t.upper() for t in watchlist}
for t, meta in stocks_meta.items():
    if t.upper() not in covered:
        unified.append({
            "ticker": t.upper(),
            "name": meta.get("name", t),
            "market": meta.get("market", "US"),
            "exchange": meta.get("exchange", ""),
            "type": "watchlist",
            "quantity": None,
            "avg_cost": None,
            "competitors": meta.get("competitors", []),
            "moat": meta.get("moat", ""),
            "growth_plan": meta.get("growth_plan", ""),
            "recent_disclosures": meta.get("recent_disclosures", ""),
            "risks": meta.get("risks", ""),
        })

(DATA_DIR / "stocks.json").write_text(
    json.dumps({"stocks": unified}, ensure_ascii=False, indent=2),
    encoding="utf-8"
)
print(f"Migrated {len(unified)} stocks ({len(holding_tickers)} holdings, {len(unified) - len(holding_tickers)} watchlist)")

for f in ["holdings.json", "watchlist.json"]:
    p = DATA_DIR / f
    if p.exists():
        p.unlink()
        print(f"Deleted {f}")

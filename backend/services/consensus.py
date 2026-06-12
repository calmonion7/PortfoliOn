from __future__ import annotations
from services.db import query


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

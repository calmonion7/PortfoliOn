from __future__ import annotations
from services.db import query


def get_asof(ticker: str, date) -> dict | None:
    """목표가·의견수 정본 = daily_consensus_mart의 base_date<=date 최신행(as-of-date). ADR-0008.
    mart 없으면 consensus_history(date<=date 최신)로 폴백, 둘 다 없으면 None."""
    upper = ticker.upper()
    rows = query(
        "SELECT avg_target_price AS target_mean, avg_target_high AS target_high,"
        " avg_target_low AS target_low, buy_count AS buy, hold_count AS hold, sell_count AS sell"
        " FROM daily_consensus_mart WHERE ticker = %s AND base_date <= %s"
        " ORDER BY base_date DESC LIMIT 1",
        (upper, date),
    )
    if not rows:
        rows = query(
            "SELECT target_high, target_mean, target_low, buy, hold, sell FROM consensus_history"
            " WHERE ticker = %s AND date <= %s ORDER BY date DESC LIMIT 1",
            (upper, date),
        )
    return rows[0] if rows else None


def apply_asof(summary: dict, ticker: str, date) -> dict:
    """summary의 목표가·의견수를 as-of 정본으로 정합해 새 dict를 반환(원본 불변). ADR-0008.
    정본 행이 있으면 buy/hold/sell은 항상, target_*은 non-null일 때만 덮어써 snapshot 동결값을 보존한다.
    정본 행이 없으면 summary를 그대로 반환한다."""
    row = get_asof(ticker, date)
    if not row:
        return summary
    summary = dict(summary)
    summary["buy"] = row["buy"]
    summary["hold"] = row["hold"]
    summary["sell"] = row["sell"]
    for k in ("target_mean", "target_high", "target_low"):
        if row.get(k) is not None:
            summary[k] = row[k]
    return summary


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

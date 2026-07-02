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


def get_asof_batch(pairs: list[tuple]) -> dict[str, dict | None]:
    """(ticker, date) 쌍 리스트를 최대 2쿼리로 일괄 조회. {ticker_upper: row_or_None} 반환.
    mart에 행이 없는 티커만 consensus_history 폴백 2차 쿼리."""
    if not pairs:
        return {}
    normalized = list(dict.fromkeys((t.upper(), d) for t, d in pairs))  # 중복 쌍 제거(VALUES 중복 방지)
    tickers_needed = [t for t, _ in normalized]

    # 1차: daily_consensus_mart DISTINCT ON (ticker) per-(ticker,date) 쌍
    mart_rows = query(
        "SELECT DISTINCT ON (m.ticker) m.ticker,"
        " m.avg_target_price AS target_mean, m.avg_target_high AS target_high,"
        " m.avg_target_low AS target_low, m.buy_count AS buy, m.hold_count AS hold, m.sell_count AS sell"
        " FROM daily_consensus_mart m"
        " JOIN (VALUES %s) AS v(ticker, d) ON m.ticker = v.ticker AND m.base_date <= v.d"
        " ORDER BY m.ticker, m.base_date DESC" % _values_placeholder(normalized),
        _flatten(normalized),
    )
    result: dict[str, dict | None] = {t: None for t in tickers_needed}
    for r in mart_rows:
        result[r["ticker"].upper()] = {k: v for k, v in r.items() if k != "ticker"}

    # 2차: mart 미스 티커만 consensus_history 폴백
    miss = [(t, d) for t, d in normalized if result[t] is None]
    if miss:
        hist_rows = query(
            "SELECT DISTINCT ON (ch.ticker) ch.ticker,"
            " ch.target_high, ch.target_mean, ch.target_low, ch.buy, ch.hold, ch.sell"
            " FROM consensus_history ch"
            " JOIN (VALUES %s) AS v(ticker, d) ON ch.ticker = v.ticker AND ch.date <= v.d"
            " ORDER BY ch.ticker, ch.date DESC" % _values_placeholder(miss),
            _flatten(miss),
        )
        for r in hist_rows:
            result[r["ticker"].upper()] = {k: v for k, v in r.items() if k != "ticker"}

    return result


def _values_placeholder(pairs: list[tuple]) -> str:
    """(%s,%s::date), (%s,%s::date), ... 형태의 VALUES 행 플레이스홀더 문자열.
    ⚠️ 바깥 괄호를 추가로 감싸면 안 됨 — VALUES ((a,b),(c,d))는 N행이 아니라
    record 컬럼의 1행이 돼 AS v(ticker, d) 매핑에서 라이브 에러."""
    return ", ".join("(%s,%s::date)" for _ in pairs)


def _flatten(pairs: list[tuple]) -> list:
    return [v for pair in pairs for v in pair]


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

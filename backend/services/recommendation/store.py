"""stock_recommendations 저장/조회 (.forge/adr/0015 §5 batch precompute→read).

per-ticker 공유 테이블(PK ticker). 배치가 replace_recommendations로 통째 교체(시장 단위),
소비처(GET /api/recommendations)는 read_recommendations로 저장값만 읽는다.
세 섹션(발굴/관심/보유)은 같은 저장값을 요청 시 필터/교집합으로 분기(ADR-0015 §6).
"""
from __future__ import annotations

import json
from datetime import date

from services.db import execute, query


def replace_recommendations(market: str, rows: list[dict]) -> None:
    """한 시장(KR|US)의 추천 점수 스냅샷을 통째 교체(배치 write).

    해당 market 기존 행 삭제 후 신규 행을 per-ticker upsert(ON CONFLICT (ticker)).
    각 row: {"ticker", "market", "score", "factors": dict, "flags": list,
             "rank": int, "base_date": date}. factors·flags는 JSONB 저장.
    rows가 비면(all-None 등) 호출측이 생략하므로 여기서는 가드하지 않는다.
    """
    execute("DELETE FROM stock_recommendations WHERE market = %s", (market,))
    for row in rows:
        execute(
            """
            INSERT INTO stock_recommendations
                (ticker, market, score, factors, flags, rank, base_date, low_liquidity, exchange, updated_at)
            VALUES (%s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s, %s, NOW())
            ON CONFLICT (ticker) DO UPDATE SET
                market        = EXCLUDED.market,
                score         = EXCLUDED.score,
                factors       = EXCLUDED.factors,
                flags         = EXCLUDED.flags,
                rank          = EXCLUDED.rank,
                base_date     = EXCLUDED.base_date,
                low_liquidity = EXCLUDED.low_liquidity,
                exchange      = EXCLUDED.exchange,
                updated_at    = NOW()
            """,
            (
                row["ticker"].upper(),
                row["market"],
                row["score"],
                json.dumps(row.get("factors") or {}, ensure_ascii=False),
                json.dumps(row.get("flags") or [], ensure_ascii=False),
                row.get("rank"),
                row["base_date"],
                bool(row.get("low_liquidity", False)),
                row.get("exchange") or "",
            ),
        )


def read_recommendations(
    markets: list[str] | None = None,
    exclude_tickers: list[str] | None = None,
    only_tickers: list[str] | None = None,
    limit: int | None = None,
    exclude_low_liquidity: bool = False,
) -> list[dict]:
    """추천 저장값 조회(저장값만 읽음, 점수 내림차순).

    markets: 시장 필터(None이면 전체). exclude_tickers: 제외(발굴=호출자 추적 제외).
    only_tickers: 교집합 한정(관심/보유 섹션) — 빈 리스트면 교집합 공집합이므로 쿼리 없이 [] 반환.
    limit: 상한. exclude_low_liquidity: True면 저유동성 제외(발굴 섹션 전용).
    name은 tickers 마스터에서 LEFT JOIN.
    반환 각 dict: {"ticker", "name", "market", "score", "flags", "rank", "base_date", "exchange"}.
    """
    # only_tickers가 명시적 빈 리스트면 교집합이 공집합 → DB 조회 없이 빈 결과.
    if only_tickers is not None and len(only_tickers) == 0:
        return []

    where: list[str] = []
    params: list = []
    if markets:
        where.append("r.market = ANY(%s)")
        params.append(list(markets))
    if exclude_tickers:
        where.append("r.ticker != ALL(%s)")
        params.append([t.upper() for t in exclude_tickers])
    if only_tickers:
        where.append("r.ticker = ANY(%s)")
        params.append([t.upper() for t in only_tickers])
    if exclude_low_liquidity:
        where.append("r.low_liquidity = FALSE")

    sql = (
        "SELECT r.ticker, t.name, r.market, r.score, r.flags, r.rank, r.base_date, r.exchange "
        "FROM stock_recommendations r "
        "LEFT JOIN tickers t ON t.ticker = r.ticker"
    )
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY score DESC"
    if limit is not None:
        sql += " LIMIT %s"
        params.append(limit)

    return [dict(r) for r in query(sql, tuple(params))]

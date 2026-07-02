"""공매도 추이 오케스트레이션 — 키움 ka10014 fetch → market_short_sell 적립 → 시계열 읽기.

KR 전용(.forge/adr/0009). 순수 신규 데이터라 폴백 소스 없음(키움 미설정/실패 시 빈 결과).
investor_service와 동형 구조(fetch_trend/upsert_trend/read_series).
"""
from __future__ import annotations
import logging
from services.db import execute, query

logger = logging.getLogger(__name__)


def fetch_trend(ticker: str, days: int = 252) -> list[dict]:
    """일별 공매도 추이 행 리스트(KR 전용, 키움 ka10014). 미설정/실패 시 빈 리스트."""
    try:
        from services.kiwoom import shortsell as kss, client as kclient
        if kclient.configured():
            return kss.fetch_rows(ticker, days=days)
    except Exception as e:
        logger.warning(f"[ShortSell] fetch_trend 실패 ticker={ticker}: {e}")
        pass
    return []


def upsert_trend(ticker: str, rows: list[dict]) -> None:
    """파싱된 일별 행을 market_short_sell에 멱등 적립((ticker, base_date) 충돌 시 갱신)."""
    sql = """
        INSERT INTO market_short_sell
            (ticker, base_date, short_volume, short_value, short_ratio, short_balance, close_price)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (ticker, base_date) DO UPDATE SET
            short_volume  = EXCLUDED.short_volume,
            short_value   = EXCLUDED.short_value,
            short_ratio   = EXCLUDED.short_ratio,
            short_balance = EXCLUDED.short_balance,
            close_price   = EXCLUDED.close_price
    """
    for row in rows:
        execute(sql, (
            ticker,
            row["base_date"],
            row.get("short_volume"),
            row.get("short_value"),
            row.get("short_ratio"),
            row.get("short_balance"),
            row.get("close_price"),
        ))


def read_series(ticker: str, days: int = 252) -> list[dict]:
    """종목 공매도 시계열(차트용, base_date 오름차순 최신 days일)."""
    return query("""
        SELECT base_date, short_volume, short_value, short_ratio, short_balance, close_price
        FROM (
            SELECT base_date, short_volume, short_value, short_ratio, short_balance, close_price
            FROM market_short_sell
            WHERE ticker = %s
            ORDER BY base_date DESC
            LIMIT %s
        ) t
        ORDER BY base_date ASC
    """, (ticker, days))

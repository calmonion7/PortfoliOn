"""갱신 대상 집합 (Enrich Target Set) — 야간 갱신이 매일 다시 쓰는 종목 (ADR 260916-132605 결정 1).

정의 = (어느 사용자든 `holding`으로 추적하는 종목)
     ∪ (최근 `window_days` 안에 리포트 상세가 열린 종목 — `report_view_open`·`ranking_row_click` 이벤트,
        단 **추적 종목(user_stocks 전체)에 속하는 것만**).

관심(watchlist) 종목은 열렸을 때만 들어온다. 매일 02:00 시점에 산출되므로 고정 목록이 아니다.
정의역이 추적 종목인 이유: enrich는 `tickers` 행에 쓰이고 그 행은 추적으로 생긴다 — 미추적 종목에
쏘면 저장할 곳이 없다. 라이브 정합은 `scripts/loopcheck-enrich-target-set.py`가 독립 SQL로 대조한다.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from services.db import query

VIEW_EVENTS = ("report_view_open", "ranking_row_click")
DEFAULT_WINDOW_DAYS = 30


def compute_enrich_target_set(now: Optional[datetime] = None, window_days: int = DEFAULT_WINDOW_DAYS) -> list[str]:
    """정렬된 ticker 목록. 판정은 파이썬에서 하고(테스트 가능), SQL은 후보 행만 좁혀 가져온다."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=window_days)

    stocks = query("SELECT ticker, type FROM user_stocks") or []
    tracked = {r["ticker"].upper() for r in stocks if r.get("ticker")}
    held = {r["ticker"].upper() for r in stocks if r.get("ticker") and r.get("type") == "holding"}

    events = query(
        """
        SELECT event_name, properties->>'ticker' AS ticker, created_at
        FROM user_events
        WHERE event_name = ANY(%s) AND created_at > %s AND properties->>'ticker' IS NOT NULL
        """,
        (list(VIEW_EVENTS), cutoff),
    ) or []
    viewed = set()
    for r in events:
        t = r.get("ticker")
        at = r.get("created_at")
        if not t or r.get("event_name") not in VIEW_EVENTS or at is None:
            continue
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        if at > cutoff:
            viewed.add(t.upper())

    return sorted(held | (viewed & tracked))

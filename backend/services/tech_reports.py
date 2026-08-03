"""선도기술 리포트 — 기술 단위 발행물 (ADR-0033, task#276).

종목이 아니라 기술(재사용 로켓·전고체 배터리·SMR·로봇) 단위 발행물. `analyst_reports.py`
(ADR-0027)와 동형 저장 계층 — 같은 (slug, published_date) 재발행은 upsert(그날 판 교체),
다른 날은 누적. TECH_TOPICS가 대상 4종의 정본(백엔드 상수, ADR-0033 결정 2).
"""
from __future__ import annotations

import json
from typing import Optional

from services.db import query, execute

TECH_TOPICS = [
    {"slug": "reusable-rocket", "name": "재사용 로켓", "order": 1},
    {"slug": "solid-state-battery", "name": "전고체 배터리", "order": 2},
    {"slug": "smr", "name": "SMR", "order": 3},
    {"slug": "robotics", "name": "로봇", "order": 4},
]


def save_report(slug: str, payload: dict) -> None:
    """발행 저장 — 같은 (slug, published_date)는 upsert(그날 판 교체), 다른 날은 누적."""
    execute(
        """INSERT INTO tech_reports
               (slug, published_date, title, description, difficulty, players,
                challenges, related, market, sources)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (slug, published_date) DO UPDATE SET
               title = EXCLUDED.title, description = EXCLUDED.description,
               difficulty = EXCLUDED.difficulty, players = EXCLUDED.players,
               challenges = EXCLUDED.challenges, related = EXCLUDED.related,
               market = EXCLUDED.market, sources = EXCLUDED.sources,
               created_at = NOW()""",
        (slug, payload["published_date"], payload["title"], payload.get("description", ""),
         json.dumps(payload.get("difficulty"), ensure_ascii=False),
         json.dumps(payload.get("players", []), ensure_ascii=False),
         json.dumps(payload.get("challenges", []), ensure_ascii=False),
         json.dumps(payload.get("related", {}), ensure_ascii=False),
         json.dumps(payload.get("market", {}), ensure_ascii=False),
         json.dumps(payload.get("sources", []), ensure_ascii=False)),
    )


def latest_all() -> list:
    """기술당 최신 1건(발행일 최신순) — 목록의 정체성(ADR-0027 개정 원칙과 동형)."""
    return query(
        "SELECT * FROM (SELECT DISTINCT ON (slug) * FROM tech_reports"
        " ORDER BY slug, published_date DESC) t ORDER BY published_date DESC, slug"
    )


def list_by_slug(slug: str) -> list:
    """그 slug의 전 판, 최신순(문서 상세 이력 네비게이션용)."""
    return query(
        "SELECT * FROM tech_reports WHERE slug = %s ORDER BY published_date DESC",
        (slug,),
    )


def get_report(slug: str, published_date: str) -> Optional[dict]:
    """단건 또는 None."""
    rows = query(
        "SELECT * FROM tech_reports WHERE slug = %s AND published_date = %s",
        (slug, published_date),
    )
    return rows[0] if rows else None

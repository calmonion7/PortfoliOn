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


def _json_or_null(value):
    """JSONB 파라미터 — 값이 None이면 `json.dumps`를 거치지 않고 None(=SQL NULL)을 그대로 넘긴다.

    `json.dumps(None)`은 파이썬 문자열 `"null"`이라 jsonb 컬럼에 캐스트되면 SQL NULL이 아니라
    **JSON null 스칼라**로 저장된다(`%s::jsonb IS NULL` → False, 라이브 읽기전용 실측). 그대로 두면
    같은 컬럼에 두 종류의 NULL 표현이 공존해 `IS NULL` 질의·문서 서술과 어긋난다(task#281 F7).
    """
    return None if value is None else json.dumps(value, ensure_ascii=False)


def save_report(slug: str, payload: dict) -> None:
    """발행 저장 — 같은 (slug, published_date)는 upsert(그날 판 교체), 다른 날은 누적."""
    execute(
        """INSERT INTO tech_reports
               (slug, published_date, title, description, difficulty, players,
                challenges, related, market, sources, key_points, milestones,
                variants, watch_items)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (slug, published_date) DO UPDATE SET
               title = EXCLUDED.title, description = EXCLUDED.description,
               difficulty = EXCLUDED.difficulty, players = EXCLUDED.players,
               challenges = EXCLUDED.challenges, related = EXCLUDED.related,
               market = EXCLUDED.market, sources = EXCLUDED.sources,
               key_points = EXCLUDED.key_points, milestones = EXCLUDED.milestones,
               variants = EXCLUDED.variants, watch_items = EXCLUDED.watch_items,
               created_at = NOW()""",
        (slug, payload["published_date"], payload["title"], payload.get("description", ""),
         json.dumps(payload.get("difficulty"), ensure_ascii=False),
         json.dumps(payload.get("players", []), ensure_ascii=False),
         json.dumps(payload.get("challenges", []), ensure_ascii=False),
         json.dumps(payload.get("related", {}), ensure_ascii=False),
         json.dumps(payload.get("market", {}), ensure_ascii=False),
         json.dumps(payload.get("sources", []), ensure_ascii=False),
         # 요약 레이어 2종·계보 비교축·관찰 체크리스트는 전부 nullable — 없으면 SQL NULL로
         # 저장돼 조회 시 None으로 나온다(구 판과 같은 형태라 프론트가 섹션째 생략한다).
         # 빈 배열은 NULL이 아니다(구분 유지). json.dumps(None) 직행은 문자열 "null"이 되므로
         # _json_or_null을 반드시 통과시킨다(task#281 F7).
         _json_or_null(payload.get("key_points")),
         _json_or_null(payload.get("milestones")),
         _json_or_null(payload.get("variants")),
         _json_or_null(payload.get("watch_items"))),
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

"""주요기술 리포트 — 기술 단위 발행물 (ADR-0033, 개명·저장모델 개정 ADR-0038, 대상 개정 ADR-0039·ADR-0044).

종목이 아니라 **기술** 단위 발행물이다(개별 기술 목록은 여기 열거하지 않는다 — 정본은 아래 상수다).
slug당 1행으로 고정(ADR-0038 결정 2) — 과거 판은 누적하지 않는다. 재발행은 본문 컬럼을 덮어쓰고,
선택 5필드(`_PRESERVABLE`)는 요청이 키를 **생략**하면 SET 목록에서 빠져 직전 판이 보존된다
(명시적 null = 삭제, task#313).
TECH_TOPICS가 대상 15종의 정본(백엔드 상수, ADR-0038 결정 1 · ADR-0039 1차 개정 · ADR-0044 2차 개정).
편입 판정은 「지금 투자 지형에서 중요한가」이며, 넓은 이름은 한 문서가 감당할 범위로 좁혀 등재한다
(ADR-0044 결정 2·3 — 예: 양자「컴퓨팅」, 태양광은 셀·모듈).
"""
from __future__ import annotations

import json

from services.db import query, execute

# name은 프론트 frontend/src/components/reports/techReportUtils.js의 TECH_NAMES와
# dual-source다(API가 표시명을 안 준다) — slug 추가/개명 시 그쪽도 함께 갱신할 것.
TECH_TOPICS = [
    {"slug": "reusable-rocket", "name": "재사용 로켓", "order": 1},
    {"slug": "solid-state-battery", "name": "전고체 배터리", "order": 2},
    {"slug": "smr", "name": "SMR", "order": 3},
    {"slug": "robotics", "name": "로봇", "order": 4},
    {"slug": "ai-datacenter-equipment", "name": "AI 데이터센터 설비", "order": 5},
    {"slug": "ai-datacenter-ops", "name": "AI 데이터센터 운영", "order": 6},
    # 2차 개정 9종(ADR-0044 결정 1) — 좁힌 이름은 그 범위가 정본이다(결정 3, 루틴 프롬프트 §3이 지시문으로 담는다).
    {"slug": "autonomous-driving", "name": "자율주행", "order": 7},
    {"slug": "space-comms", "name": "우주통신", "order": 8},
    {"slug": "quantum-computing", "name": "양자컴퓨팅", "order": 9},
    {"slug": "nuclear-fusion", "name": "핵융합", "order": 10},
    {"slug": "solar-pv", "name": "태양광", "order": 11},
    {"slug": "semiconductor-equipment", "name": "반도체 장비", "order": 12},
    {"slug": "on-device-ai", "name": "온디바이스 AI", "order": 13},
    {"slug": "obesity-drugs", "name": "비만·대사 치료제", "order": 14},
    {"slug": "unmanned-defense", "name": "무인 방산체계", "order": 15},
]


def _json_or_null(value):
    """JSONB 파라미터 — 값이 None이면 `json.dumps`를 거치지 않고 None(=SQL NULL)을 그대로 넘긴다.

    `json.dumps(None)`은 파이썬 문자열 `"null"`이라 jsonb 컬럼에 캐스트되면 SQL NULL이 아니라
    **JSON null 스칼라**로 저장된다(`%s::jsonb IS NULL` → False, 라이브 읽기전용 실측). 그대로 두면
    같은 컬럼에 두 종류의 NULL 표현이 공존해 `IS NULL` 질의·문서 서술과 어긋난다(task#281 F7).
    """
    return None if value is None else json.dumps(value, ensure_ascii=False)


# 재발행 때 **생략하면 직전 판이 보존되는** 선택 필드(task#313). 본문 4필드
# (description·players·challenges·related)는 여기 없다 — 그쪽 생략은 부분 갱신이 아니라
# 잘못된 발행이므로 보존해 숨기지 않고 드러나게 둔다.
_PRESERVABLE = ("key_points", "milestones", "variants", "watch_items", "composition")

# `DO UPDATE SET` 목록의 정본(순서 포함). 컬럼명은 **이 상수에서만** 오며 요청 값이
# 컬럼명 자리에 닿는 경로가 없다(동적 SQL은 고정 allowlist에서만 만든다).
_UPDATE_COLUMNS = (
    "published_date", "title", "description", "difficulty", "players",
    "challenges", "related", "market", "sources",
) + _PRESERVABLE


def _upsert_sql(omitted) -> str:
    """`omitted`에 든 보존 대상 컬럼만 `DO UPDATE SET`에서 뺀 upsert SQL.

    `INSERT` 컬럼 목록은 **full 유지** — 신규 slug는 보존할 직전 판이 없으므로 입도를
    나눌 이유가 없다(생략분은 NULL로 들어간다).
    """
    if isinstance(omitted, str):
        # 문자열은 문자를 순회해 skip이 비므로 **보존이 예외 없이 전량 덮어쓰기로 강하**한다
        # (컬럼명 주입은 allowlist가 막으니 SQL 오류로도 안 드러난다, 적대검토 #6).
        raise TypeError("omitted는 컬럼명 집합이어야 합니다(문자열 1개 금지)")
    skip = {c for c in omitted if c in _PRESERVABLE}   # 화이트리스트 밖의 이름은 무시
    sets = ",\n               ".join(
        f"{c} = EXCLUDED.{c}" for c in _UPDATE_COLUMNS if c not in skip
    )
    return f"""INSERT INTO tech_reports
               (slug, published_date, title, description, difficulty, players,
                challenges, related, market, sources, key_points, milestones,
                variants, watch_items, composition)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (slug) DO UPDATE SET
               {sets},
               created_at = NOW()"""


def save_report(slug: str, payload: dict, omitted: frozenset = frozenset()) -> None:
    """발행 저장 — slug당 1행(ADR-0038 결정 2). 재발행은 그 행을 덮어쓴다(단 `omitted`는 제외).

    `omitted`는 요청이 **생략한**(키 자체가 없던) 선택 필드명 집합이다. 거기 든
    `_PRESERVABLE` 컬럼만 `DO UPDATE SET`에서 빠져 직전 판의 값이 살아남는다 —
    즉 계약은 **「키 생략 = 보존 / 명시적 `null` = 삭제」**다(task#313). 명시적 null은
    `omitted`에 들어오지 않으므로 컬럼이 SET에 남고 NULL이 저장된다.
    """
    execute(
        _upsert_sql(omitted),
        (slug, payload["published_date"], payload["title"], payload.get("description", ""),
         json.dumps(payload.get("difficulty"), ensure_ascii=False),
         json.dumps(payload.get("players", []), ensure_ascii=False),
         json.dumps(payload.get("challenges", []), ensure_ascii=False),
         json.dumps(payload.get("related", {}), ensure_ascii=False),
         json.dumps(payload.get("market", {}), ensure_ascii=False),
         json.dumps(payload.get("sources", []), ensure_ascii=False),
         # 요약 레이어 2종·계보 비교축·관찰 체크리스트는 전부 nullable — 값이 없으면 SQL NULL을
         # 바인딩한다. 그 NULL이 **실제로 저장되는 것은 INSERT 경로(신규 행)와 명시적 null뿐**이다:
         # 재발행에서 키를 생략하면 그 컬럼이 `DO UPDATE SET`에 없어 이 파라미터가 쓰이지 않는다.
         # 빈 배열은 NULL이 아니다(구분 유지). json.dumps(None) 직행은 문자열 "null"이 되므로
         # _json_or_null을 반드시 통과시킨다(task#281 F7).
         _json_or_null(payload.get("key_points")),
         _json_or_null(payload.get("milestones")),
         _json_or_null(payload.get("variants")),
         _json_or_null(payload.get("watch_items")),
         # 기술 해부 3축(ADR-0042) — 미수록 판은 SQL NULL(프론트가 빈 상태 안내를 렌더한다).
         _json_or_null(payload.get("composition"))),
    )


def latest_all() -> list:
    """기술별 1건씩, 갱신일 최신순 — slug당 1행이라 DISTINCT ON이 불필요하다(ADR-0038)."""
    return query("SELECT * FROM tech_reports ORDER BY published_date DESC, slug")


def get_by_slug(slug: str) -> list:
    """그 slug의 행 — slug당 1행이라 0 또는 1건(ADR-0038). 응답 봉투는 리스트로 유지."""
    return query(
        "SELECT * FROM tech_reports WHERE slug = %s ORDER BY published_date DESC",
        (slug,),
    )

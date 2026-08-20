"""주요기술 리포트 저장 계층 (ADR-0033, task#276 S1, 개명·저장모델 개정 ADR-0038).

analyst_reports.py(ADR-0027)와 동형 — query/execute를 mock한다(conftest _block_real_db 가드,
실 DB 접근 금지). 단언은 SQL 리터럴만이 아니라 파라미터(call_args[0][1])도 함께 본다.
"""
import json

import pytest

from unittest.mock import patch

from services import tech_reports as svc


PAYLOAD = {
    "published_date": "2026-08-03",
    "title": "재사용 발사체, 궤도당 비용을 다시 쓴다",
    "description": "1단 재사용이 발사비를 낮추는 구조를 설명한다.",
    "difficulty": {"score": 4, "rationale": "극저온 추진제 재점화가 어렵다."},
    "players": [
        {"name": "SpaceX", "country": "US", "state_led": False, "tech_level": 5},
    ],
    "challenges": [{"title": "재점화 신뢰성", "body": "다회 재점화 엔진 내구성."}],
    "related": {"prerequisites": ["정밀 유도항법"], "derivatives": [], "complements": [], "competitors": []},
    "market": {"history": [], "forecast": [], "cagr_pct": 12.3, "share_basis": None, "as_of": "2026-08-03"},
    "sources": [{"title": "NASA", "url": None}],
}


def test_save_report_upserts_by_slug():
    """slug당 1행(ADR-0038 결정 2) — 충돌키는 slug 단독이고 published_date는 EXCLUDED로 갱신된다."""
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("reusable-rocket", PAYLOAD)
    sql, params = mock_exec.call_args.args
    assert "INSERT INTO tech_reports" in sql
    assert "ON CONFLICT (slug) DO UPDATE" in sql
    assert "published_date = EXCLUDED.published_date" in sql
    assert params[0] == "reusable-rocket"
    assert params[1] == "2026-08-03"
    assert params[2] == PAYLOAD["title"]
    # JSONB 파라미터는 호출측 json.dumps (CONVENTIONS §7)
    assert json.loads(params[4]) == PAYLOAD["difficulty"]
    assert json.loads(params[5]) == PAYLOAD["players"]
    assert json.loads(params[9]) == PAYLOAD["sources"]


def test_save_report_upsert_updates_published_date_on_resave():
    """같은 slug를 다른 published_date로 2회 저장 → 1행만 남고 published_date가 최신으로
    갱신된다(ADR-0038 결정 2). 충돌키가 slug 단독이라 DB `UNIQUE(slug)`가 1행을 보장하고
    (마이그레이션 S2), 이 테스트는 그 보장 위에서 `DO UPDATE SET published_date =
    EXCLUDED.published_date` 한 줄이 실제로 실려 있는지 SQL·파라미터 수준에서 못박는다 —
    이 한 줄이 빠지면 갱신일이 옛 값에 고착한다."""
    payload1 = dict(PAYLOAD, published_date="2026-08-01")
    payload2 = dict(PAYLOAD, published_date="2026-08-10")
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("smr", payload1)
        svc.save_report("smr", payload2)
    assert mock_exec.call_count == 2
    for call, expected_date in zip(mock_exec.call_args_list, ("2026-08-01", "2026-08-10")):
        sql, params = call.args
        assert "ON CONFLICT (slug) DO UPDATE" in sql
        assert "published_date = EXCLUDED.published_date" in sql
        assert params[0] == "smr"
        assert params[1] == expected_date


def test_save_report_defaults_missing_optional_collections():
    """difficulty만 있고 나머지 컬렉션 키가 없는 payload도 저장 계층이 안전 기본값을 채운다."""
    minimal = {"published_date": "2026-08-03", "title": "t", "difficulty": {"score": 1, "rationale": "r"}}
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("smr", minimal)
    _, params = mock_exec.call_args.args
    assert params[3] == ""            # description
    assert json.loads(params[5]) == []  # players
    assert json.loads(params[6]) == []  # challenges
    assert json.loads(params[7]) == {}  # related
    assert json.loads(params[8]) == {}  # market
    assert json.loads(params[9]) == []  # sources


def test_save_report_persists_key_points_and_milestones():
    """신규 컬럼 2개가 INSERT 컬럼 목록·VALUES 자리표시자·DO UPDATE SET **세 곳 모두**에
    실려야 한다 — 한 곳만 고치면 재발행(upsert) 경로에서 조용히 유실된다(task#281 S1)."""
    payload = dict(PAYLOAD)
    payload["key_points"] = [{"title": "t", "metrics": [{"label": "l", "value": "v", "change_pct": -2.0}], "body": "b"}]
    payload["milestones"] = [{"year": 2030, "actor": None, "event": "e", "status": "planned"}]
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("smr", payload)
    sql, params = mock_exec.call_args.args
    head = sql.split("VALUES")[0]
    for col in ("key_points", "milestones"):
        assert col in head, f"INSERT 컬럼 목록에 {col} 누락"
        assert f"{col} = EXCLUDED.{col}" in sql, f"DO UPDATE SET에 {col} 누락"
    assert sql.count("%s") == len(params)   # VALUES 자리표시자 ↔ 파라미터 개수 일치
    assert json.loads(params[10]) == payload["key_points"]
    assert json.loads(params[11]) == payload["milestones"]


def test_save_report_new_fields_absent_binds_sql_null_param():
    """구 판 payload(신규 2필드 전무)는 파라미터로 **SQL NULL**을 바인딩한다.

    ⚠️ 재고 있는 것은 *파라미터 바인딩*이다 — 실제 저장 결과는 아니다. 라우터는 키 부재를
    `omitted`로 넘기므로 그 컬럼은 `DO UPDATE SET`에서 빠지고 **이 파라미터가 쓰이지 않는다**
    (= 직전 판 보존, task#313). 이 NULL이 실제로 저장되는 것은 INSERT 경로(신규 행)와
    명시적 null뿐이다.

    ⚠️ 단언이 `json.loads(params[i]) is None`에서 `params[i] is None`으로 바뀌었다(task#281 F7).
    전엔 `json.dumps(None)`을 그대로 넘겨 파라미터가 파이썬 문자열 `"null"`이었고, jsonb 컬럼에
    캐스트되면 SQL NULL이 아니라 **JSON null 스칼라**로 저장됐다(라이브 읽기전용 실측:
    `%s::jsonb IS NULL` → False). 같은 컬럼에 두 종류의 NULL이 공존해 `IS NULL` 질의·문서 서술과
    어긋난다. `json.loads`를 거치면 두 표현이 똑같이 None으로 보여 이 차이를 **원리적으로 못 본다**.
    """
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("smr", PAYLOAD)
    _, params = mock_exec.call_args.args
    assert params[10] is None, "key_points 부재는 SQL NULL이어야 한다(문자열 'null' 금지)"
    assert params[11] is None, "milestones 부재는 SQL NULL이어야 한다(문자열 'null' 금지)"


def test_save_report_new_fields_explicit_none_also_stores_sql_null():
    """키가 **있고 값이 None**인 판도 같은 SQL NULL을 바인딩한다.

    라우터 모델이 `Optional[List[...]] = Field(None)`이라 model_dump는 두 경우 모두 값 None을
    준다 — 그래서 이 계층에서 둘은 구별되지 않고, **보존/삭제의 구별은 `omitted`에만 있다**
    (task#313). 명시적 null은 `omitted`에 안 들어가므로 이 NULL이 실제로 저장돼 삭제된다.
    """
    payload = dict(PAYLOAD, key_points=None, milestones=None)
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("smr", payload)
    _, params = mock_exec.call_args.args
    assert params[10] is None and params[11] is None
    # 값이 있으면 여전히 JSON 문자열이다(가드가 정상 경로를 삼키지 않는다는 이빨 단언)
    payload2 = dict(PAYLOAD, key_points=[{"title": "t", "metrics": [], "body": "b"}], milestones=[])
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("smr", payload2)
    _, params2 = mock_exec.call_args.args
    assert json.loads(params2[10]) == payload2["key_points"]
    assert json.loads(params2[11]) == []          # 빈 배열은 NULL이 아니다(구분 유지)


def test_save_report_persists_variants_and_watch_items():
    """신규 컬럼 2개(variants·watch_items)도 세 곳(INSERT 컬럼 목록·VALUES 자리표시자·
    DO UPDATE SET) 전부에 실려야 한다 — key_points·milestones와 동일 패턴(task#296)."""
    payload = dict(PAYLOAD)
    payload["variants"] = [{
        "axis_label": "노형",
        "options": [
            {"name": "경수형", "examples": ["중국 ACP100"], "strength": "s", "tradeoff": "t"},
            {"name": "중수형", "examples": None, "strength": None, "tradeoff": None},
        ],
    }]
    payload["watch_items"] = [{"label": "계통연결 여부", "detail": "d", "not_signal": "n"}]
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("smr", payload)
    sql, params = mock_exec.call_args.args
    head = sql.split("VALUES")[0]
    for col in ("variants", "watch_items"):
        assert col in head, f"INSERT 컬럼 목록에 {col} 누락"
        assert f"{col} = EXCLUDED.{col}" in sql, f"DO UPDATE SET에 {col} 누락"
    assert sql.count("%s") == len(params)   # VALUES 자리표시자 ↔ 파라미터 개수 일치
    assert len(params) == 15                # 12 → 14 (task#296) → 15 (task#305 composition)
    assert json.loads(params[12]) == payload["variants"]
    assert json.loads(params[13]) == payload["watch_items"]


def test_save_report_variants_watch_items_absent_binds_sql_null_param():
    """부재 시 파라미터가 SQL NULL(파이썬 None) — 문자열 'null' 금지(`_json_or_null`, task#281 F7).

    저장 결과가 아니라 바인딩을 잰다 — 재발행에서 키 부재는 `omitted`로 넘어가 보존된다(task#313).
    """
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("smr", PAYLOAD)
    _, params = mock_exec.call_args.args
    assert len(params) == 15
    assert params[12] is None, "variants 부재는 SQL NULL이어야 한다(문자열 'null' 금지)"
    assert params[13] is None, "watch_items 부재는 SQL NULL이어야 한다(문자열 'null' 금지)"


def test_save_report_variants_watch_items_explicit_none_also_stores_sql_null():
    """키가 있고 값이 None인 판도 같은 SQL NULL — 그리고 이쪽은 `omitted`에 안 들어가 실제로 삭제된다."""
    payload = dict(PAYLOAD, variants=None, watch_items=None)
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("smr", payload)
    _, params = mock_exec.call_args.args
    assert params[12] is None and params[13] is None
    # 값이 있으면 여전히 JSON 문자열이다(가드가 정상 경로를 삼키지 않는다는 이빨 단언)
    payload2 = dict(PAYLOAD, variants=[], watch_items=[])
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("smr", payload2)
    _, params2 = mock_exec.call_args.args
    assert json.loads(params2[12]) == []
    assert json.loads(params2[13]) == []


def test_latest_all_no_longer_needs_distinct_on():
    """slug당 1행이라 DISTINCT ON이 불필요(ADR-0038) — 그냥 전체를 갱신일 최신순으로 정렬."""
    with patch.object(svc, "query", return_value=[{"slug": "smr"}]) as mock_q:
        rows = svc.latest_all()
    sql = mock_q.call_args.args[0]
    assert "DISTINCT ON" not in sql
    assert "ORDER BY published_date DESC, slug" in sql
    assert rows == [{"slug": "smr"}]


def test_get_by_slug_returns_the_single_current_row_or_empty():
    """get_by_slug 계약은 「그 slug의 현재 1건」이다(ADR-0038) — slug당 1행이라 「최신 우선
    정렬」이라는 옛 축(list_by_slug)은 더 이상 의미가 없다(정렬할 대상이 0 또는 1건뿐).
    그래서 이 테스트는 정렬이 아니라 존재/부재 두 경로를 단언한다."""
    with patch.object(svc, "query", return_value=[{"slug": "robotics", "published_date": "2026-08-03"}]) as mock_q:
        rows = svc.get_by_slug("robotics")
    sql, params = mock_q.call_args.args
    assert "WHERE slug = %s" in sql
    assert params == ("robotics",)
    assert rows == [{"slug": "robotics", "published_date": "2026-08-03"}]

    with patch.object(svc, "query", return_value=[]):
        assert svc.get_by_slug("robotics") == []


def test_tech_topics_has_exactly_the_fifteen_slugs():
    """대상 2차 개정(ADR-0044) — 1차 개정(ADR-0039)의 6종에 9종을 더해 TECH_TOPICS는 15종이다.
    (1차: data-center 1종이 ai-datacenter-equipment·ai-datacenter-ops 2종으로 대체.)
    함수명이 계약을 서술하므로 개수가 바뀌면 이름도 함께 고친다 — 통과하면서 거짓이 되는
    테스트를 남기지 않는다."""
    slugs = {t["slug"] for t in svc.TECH_TOPICS}
    assert slugs == {
        "reusable-rocket", "solid-state-battery", "smr", "robotics",
        "ai-datacenter-equipment", "ai-datacenter-ops",
        "autonomous-driving", "space-comms", "quantum-computing", "nuclear-fusion",
        "solar-pv", "semiconductor-equipment", "on-device-ai", "obesity-drugs",
        "unmanned-defense",
    }
    assert len(svc.TECH_TOPICS) == 15
    # order는 1~15 중복 없이 유일하다(신규 9종은 7~15)
    orders = [t["order"] for t in svc.TECH_TOPICS]
    assert sorted(orders) == list(range(1, 16))
    # 각 항목이 표시명·정렬순서를 갖는다
    for t in svc.TECH_TOPICS:
        assert t["name"] and isinstance(t["order"], int)
    equipment = next(t for t in svc.TECH_TOPICS if t["slug"] == "ai-datacenter-equipment")
    assert equipment["name"] == "AI 데이터센터 설비"
    assert equipment["order"] == 5
    ops = next(t for t in svc.TECH_TOPICS if t["slug"] == "ai-datacenter-ops")
    assert ops["name"] == "AI 데이터센터 운영"
    assert ops["order"] == 6


# ── 기술 해부 composition (ADR-0042, task#305 S3) ─────────────────────

COMPOSITION = {
    "tech": [
        {"name": "재점화 엔진", "share_pct": 40.0, "leaders": ["SpaceX"], "rationale": "근거."},
        {"name": "정밀 착륙 제어", "share_pct": 35.0, "leaders": None, "rationale": "근거."},
        {"name": "열보호 소재", "share_pct": 25.0, "leaders": [], "rationale": "근거."},
    ],
    "minerals_share_basis": "원재료비 기준",
}


def test_save_report_persists_composition():
    """composition도 세 곳(INSERT 컬럼 목록·VALUES 자리표시자·DO UPDATE SET) 전부에 실려야 한다
    — variants·watch_items와 동일 패턴(task#296)."""
    payload = dict(PAYLOAD, composition=COMPOSITION)
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("reusable-rocket", payload)
    sql, params = mock_exec.call_args.args
    head = sql.split("VALUES")[0]
    assert "composition" in head, "INSERT 컬럼 목록에 composition 누락"
    assert "composition = EXCLUDED.composition" in sql, "DO UPDATE SET에 composition 누락"
    assert sql.count("%s") == len(params)   # VALUES 자리표시자 ↔ 파라미터 개수 일치
    assert len(params) == 15                # 14 → 15 (task#305)
    assert json.loads(params[14]) == COMPOSITION


def test_save_report_composition_absent_binds_sql_null_param():
    """부재 시 파라미터가 SQL NULL — `json.dumps(None)`의 문자열 'null'은 `IS NULL`과 어긋난다(F7).

    저장 결과가 아니라 바인딩을 잰다 — 재발행에서 키 부재는 `omitted`로 넘어가 보존된다(task#313).
    """
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("reusable-rocket", PAYLOAD)
    _, params = mock_exec.call_args.args
    assert params[14] is None, "composition 부재는 SQL NULL이어야 한다(문자열 'null' 금지)"


def test_save_report_composition_explicit_none_also_stores_sql_null():
    """키가 있고 값이 None인 판도 같은 SQL NULL — 그리고 이쪽은 `omitted`에 안 들어가 실제로 삭제된다."""
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("reusable-rocket", dict(PAYLOAD, composition=None))
    _, params = mock_exec.call_args.args
    assert params[14] is None
    # 이빨 — 가드가 정상 경로를 삼키지 않는다(빈 dict는 NULL이 아니라 JSON으로 간다)
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("reusable-rocket", dict(PAYLOAD, composition={}))
    _, params2 = mock_exec.call_args.args
    assert json.loads(params2[14]) == {}


# ── 「생략=보존」 (task#313 S1) ─────────────────────────────────────────
#
# 계약: 요청이 선택 5필드 중 하나를 **생략**하면 그 컬럼만 `DO UPDATE SET`에서 빠져
# 직전 판의 값이 보존된다. 값이 **명시적 None**이면(생략이 아님) 컬럼은 SET에 남고
# NULL이 저장돼 삭제된다. `INSERT` 컬럼 목록은 어느 경우에도 full 유지 —
# 신규 행은 보존할 직전 판이 없다.
#
# ⚠️ 이 테스트들은 execute를 mock하므로 「조회 시 값이 살아 있다」를 DB 왕복으로 재지 않고
# **생성된 SQL의 구조**로 잰다(conftest _block_real_db). SET 목록에서 그 컬럼이 빠지는 것이
# 곧 「그 컬럼을 덮어쓰지 않는다」이고, 라이브 왕복 확인은 S6 스모크가 진다.

_SQL_AT_HEAD = (
    'INSERT INTO tech_reports\n'
    '               (slug, published_date, title, description, difficulty, players,\n'
    '                challenges, related, market, sources, key_points, milestones,\n'
    '                variants, watch_items, composition)\n'
    '           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)\n'
    '           ON CONFLICT (slug) DO UPDATE SET\n'
    '               published_date = EXCLUDED.published_date,\n'
    '               title = EXCLUDED.title, description = EXCLUDED.description,\n'
    '               difficulty = EXCLUDED.difficulty, players = EXCLUDED.players,\n'
    '               challenges = EXCLUDED.challenges, related = EXCLUDED.related,\n'
    '               market = EXCLUDED.market, sources = EXCLUDED.sources,\n'
    '               key_points = EXCLUDED.key_points, milestones = EXCLUDED.milestones,\n'
    '               variants = EXCLUDED.variants, watch_items = EXCLUDED.watch_items,\n'
    '               composition = EXCLUDED.composition,\n'
    '               created_at = NOW()'
)

_PARAM_INDEX = {"key_points": 10, "milestones": 11, "variants": 12, "watch_items": 13, "composition": 14}
_NON_PRESERVABLE_SETS = (
    "published_date", "title", "description", "difficulty", "players",
    "challenges", "related", "market", "sources",
)


def _norm(sql: str) -> str:
    return " ".join(sql.split())


def _sql_for(omitted):
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("smr", PAYLOAD, omitted=omitted)
    return mock_exec.call_args.args


def test_empty_omitted_yields_the_sql_that_head_produced():
    """대조군 — `omitted`가 빈 집합이면 SQL이 변경 전과 같다(기존 호출자 회귀 0의 증거).

    이 테스트가 없으면 아래 red-first 5축의 실패가 「보존이 안 됨」인지 「테스트가 잘못된
    컬럼을 보고 있음」인지 가릴 수 없다. 공백만 정규화해 비교한다 — SET 목록을 런타임에
    조립하게 되면서 줄바꿈 폭(전엔 한 줄에 2개씩 묶여 있었다)만 달라지고 **컬럼 집합과
    순서·나머지 절은 전부 동일**해야 한다. 기본 인자 경로(`omitted` 미전달)도 같은 SQL이다.
    """
    sql, params = _sql_for(frozenset())
    assert _norm(sql) == _norm(_SQL_AT_HEAD)
    assert len(params) == 15 and sql.count("%s") == len(params)
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("smr", PAYLOAD)          # 기본 인자 = frozenset()
    assert _norm(mock_exec.call_args.args[0]) == _norm(_SQL_AT_HEAD)


@pytest.mark.parametrize("col", ["key_points", "milestones", "variants", "watch_items", "composition"])
def test_omitted_field_is_not_overwritten_on_resave(col):
    """red-first 5축 — 그 컬럼만 `DO UPDATE SET`에서 빠진다(= 재발행 시 직전 판 보존).

    수정 전에는 전 컬럼이 무조건 `EXCLUDED.*`로 덮여 생략분이 NULL이 됐다.
    """
    sql, params = _sql_for(frozenset({col}))
    assert f"{col} = EXCLUDED.{col}" not in sql, f"{col}이 여전히 덮어써진다(보존 실패)"
    # 형제 4필드와 본문 컬럼은 그대로 덮어써야 한다 — 생략 하나가 다른 컬럼을 데려가지 않는다
    for other in set(_PARAM_INDEX) - {col}:
        assert f"{other} = EXCLUDED.{other}" in sql, f"{col} 생략이 {other}까지 SET에서 빼앗았다"
    for other in _NON_PRESERVABLE_SETS:
        assert f"{other} = EXCLUDED.{other}" in sql
    assert "created_at = NOW()" in sql
    # INSERT 컬럼 목록은 full 유지(신규 행은 보존할 직전 판이 없다) + 자리표시자 정합
    head = sql.split("VALUES")[0]
    assert col in head, f"INSERT 컬럼 목록에서 {col}이 빠졌다"
    assert len(params) == 15 and sql.count("%s") == len(params)


@pytest.mark.parametrize("col", ["key_points", "milestones", "variants", "watch_items", "composition"])
def test_explicit_none_still_deletes(col):
    """양성 5축 — 명시적 `null`은 생략이 아니다: 컬럼이 SET에 남고 파라미터가 SQL NULL이라 삭제된다.

    음성 테스트(위 red-first)만으론 「생략과 null이 갈린다」가 표현되지 않는다(task#297 ⓑ).
    라우터는 `model_fields_set`에 있는 키를 `omitted`에 넣지 않으므로 이 경로가 실제 발행 경로다.
    """
    sql, params = _sql_for(frozenset())          # 명시적 null → omitted에 안 들어간다
    assert f"{col} = EXCLUDED.{col}" in sql
    payload = dict(PAYLOAD, **{col: None})
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("smr", payload, omitted=frozenset())
    sql2, params2 = mock_exec.call_args.args
    assert f"{col} = EXCLUDED.{col}" in sql2, f"명시적 null이 {col}을 보존해버렸다"
    assert params2[_PARAM_INDEX[col]] is None


def test_omitted_ignores_names_outside_the_whitelist():
    """화이트리스트 — `_PRESERVABLE` 밖의 값은 `omitted`에 들어와도 무시한다(결정 5).

    `DO UPDATE SET` 목록을 런타임에 조립하므로 컬럼명은 모듈 상수에서만 와야 한다. 본문 4필드
    (`description`·`players`·`challenges`·`related`)는 생략이 곧 오류 신호라 보존 대상이 아니고
    (비목표), `created_at`·`slug` 같은 이름이나 SQL 조각이 SET 목록을 흔들어서도 안 된다.
    """
    sql, _ = _sql_for(frozenset({"description", "players", "challenges", "related",
                                 "created_at", "slug", "title = 'x'", "*"}))
    assert _norm(sql) == _norm(_SQL_AT_HEAD)


def test_preservable_is_exactly_the_five_optional_fields():
    """보존 대상 정본 — 본문 4필드는 여기 없다(비목표: 생략은 부분 갱신이 아니라 잘못된 발행)."""
    assert svc._PRESERVABLE == ("key_points", "milestones", "variants", "watch_items", "composition")


def test_omitted_string_is_rejected_not_silently_ignored():
    """`omitted`에 컬럼명 **문자열 하나**를 넘기면 보존이 조용히 꺼지지 않고 TypeError다.

    `{c for c in "composition" if c in _PRESERVABLE}`는 문자를 순회해 빈 집합이 되므로
    보존을 의도한 호출이 **예외 없이 전량 덮어쓰기로 강하**한다 — 컬럼명 주입은 allowlist가
    막으니 SQL 오류로도 안 드러난다(적대검토 #6). 데이터 보존 가드의 무음 강하는 금지다.
    """
    with pytest.raises(TypeError):
        svc._upsert_sql("composition")

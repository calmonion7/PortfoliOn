"""선도기술 리포트 저장 계층 (ADR-0033, task#276 S1).

analyst_reports.py(ADR-0027)와 동형 — query/execute를 mock한다(conftest _block_real_db 가드,
실 DB 접근 금지). 단언은 SQL 리터럴만이 아니라 파라미터(call_args[0][1])도 함께 본다.
"""
import json

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


def test_save_report_upserts_by_slug_and_published_date():
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("reusable-rocket", PAYLOAD)
    sql, params = mock_exec.call_args.args
    assert "INSERT INTO tech_reports" in sql
    assert "ON CONFLICT (slug, published_date) DO UPDATE" in sql
    assert params[0] == "reusable-rocket"
    assert params[1] == "2026-08-03"
    assert params[2] == PAYLOAD["title"]
    # JSONB 파라미터는 호출측 json.dumps (CONVENTIONS §7)
    assert json.loads(params[4]) == PAYLOAD["difficulty"]
    assert json.loads(params[5]) == PAYLOAD["players"]
    assert json.loads(params[9]) == PAYLOAD["sources"]


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


def test_save_report_new_fields_absent_stores_null():
    """구 판 payload(신규 2필드 전무)는 **SQL NULL**로 저장 — 조회 시 None이라 프론트가 섹션째 생략한다.

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
    """키가 **있고 값이 None**인 판(pydantic Optional 기본값 경로)도 같은 SQL NULL로 간다.

    라우터 모델이 `Optional[List[...]] = Field(None)`이라 model_dump는 키를 담고 값만 None으로 준다 —
    키 부재 경로만 단언하면 실제 발행 경로(값 None)를 못 본다.
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
    assert len(params) == 14                # 12 → 14 (task#296)
    assert json.loads(params[12]) == payload["variants"]
    assert json.loads(params[13]) == payload["watch_items"]


def test_save_report_variants_watch_items_absent_stores_sql_null():
    """부재 시 SQL NULL(파이썬 None) — 문자열 'null' 금지(`_json_or_null`, task#281 F7과 동일 가드)."""
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("smr", PAYLOAD)
    _, params = mock_exec.call_args.args
    assert len(params) == 14
    assert params[12] is None, "variants 부재는 SQL NULL이어야 한다(문자열 'null' 금지)"
    assert params[13] is None, "watch_items 부재는 SQL NULL이어야 한다(문자열 'null' 금지)"


def test_save_report_variants_watch_items_explicit_none_also_stores_sql_null():
    """키가 있고 값이 None인 판(pydantic Optional 기본값 경로)도 같은 SQL NULL로 간다."""
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


def test_latest_all_uses_distinct_on_slug():
    with patch.object(svc, "query", return_value=[{"slug": "smr"}]) as mock_q:
        rows = svc.latest_all()
    sql = mock_q.call_args.args[0]
    assert "DISTINCT ON (slug)" in sql
    assert "ORDER BY slug, published_date DESC" in sql
    assert rows == [{"slug": "smr"}]


def test_list_by_slug_orders_latest_first():
    with patch.object(svc, "query", return_value=[{"published_date": "2026-08-03"}]) as mock_q:
        rows = svc.list_by_slug("robotics")
    sql, params = mock_q.call_args.args
    assert "WHERE slug = %s ORDER BY published_date DESC" in sql
    assert params == ("robotics",)
    assert rows == [{"published_date": "2026-08-03"}]


def test_get_report_found_and_not_found():
    with patch.object(svc, "query", return_value=[{"slug": "smr", "title": "t"}]) as mock_q:
        row = svc.get_report("smr", "2026-08-03")
    assert row == {"slug": "smr", "title": "t"}
    assert mock_q.call_args.args[1] == ("smr", "2026-08-03")

    with patch.object(svc, "query", return_value=[]):
        assert svc.get_report("smr", "2099-01-01") is None


def test_tech_topics_has_exactly_the_four_slugs():
    slugs = {t["slug"] for t in svc.TECH_TOPICS}
    assert slugs == {"reusable-rocket", "solid-state-battery", "smr", "robotics"}
    assert len(svc.TECH_TOPICS) == 4
    # 각 항목이 표시명·정렬순서를 갖는다
    for t in svc.TECH_TOPICS:
        assert t["name"] and isinstance(t["order"], int)

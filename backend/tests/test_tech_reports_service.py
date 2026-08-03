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

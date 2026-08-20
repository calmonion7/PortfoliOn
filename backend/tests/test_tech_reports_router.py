"""주요기술 리포트 발행·조회 API (ADR-0033, task#276 S2, 개명·저장모델 개정 ADR-0038).

라우터 테스트는 self-app + dependency override(conftest는 main.app 한정),
무인증 401은 override 없는 fresh app으로 검증(test_security_auth_gaps 패턴).
DB는 services.tech_reports.query/execute를 mock(conftest _block_real_db 가드).
조회 표면은 2종(목록·slug별 현재 판) — 단건(이력) 조회 `GET /{slug}/{published_date}`는
ADR-0038 결정 3으로 제거됐다.
"""
import copy
import json
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.tech_reports import Composition, router
from auth import get_current_user_or_api_key, require_admin_or_api_key
from services import tech_reports as svc

app = FastAPI()
app.include_router(router)
# 발행은 require_admin_or_api_key(루틴), 조회 2종은 get_current_user_or_api_key(ADR-0029)
app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
app.dependency_overrides[require_admin_or_api_key] = lambda: "test-admin-id"
client = TestClient(app)


@pytest.fixture(autouse=True)
def _no_stored_row():
    """발행 핸들러가 **보존분 재검증**(task#313 S2)을 위해 기존 행을 read하므로, 파일 전역
    기본값을 「직전 판 없음」으로 고정한다 — 안 하면 그 read가 conftest `_block_real_db`
    가드에 걸려 발행 테스트 전부가 500이 된다. 직전 판이 필요한 테스트는 자기
    `patch.object(svc, "query", ...)`로 안쪽에서 덮는다(중첩 patch는 내부가 이긴다).
    """
    with patch.object(svc, "query", return_value=[]):
        yield


VALID_BODY = {
    "published_date": "2026-08-03",
    "title": "재사용 발사체, 궤도당 비용을 다시 쓴다",
    "description": "1단 재사용이 발사비를 낮추는 구조를 설명한다.",
    "difficulty": {"score": 4, "rationale": "극저온 추진제 재점화가 어렵다."},
    "players": [
        {"name": "SpaceX", "country": "US", "state_led": False, "tech_level": 5,
         "ticker": None, "gap_years": 0, "leader_name": "Elon Musk",
         "share_pct": 60.0, "note": "재사용 1위"},
    ],
    "challenges": [{"title": "재점화 신뢰성", "body": "다회 재점화 엔진 내구성."}],
    "related": {"prerequisites": ["정밀 유도항법"], "derivatives": [], "complements": [], "competitors": []},
    "market": {
        "history": [{"year": 2024, "size": {"value": 12.5, "currency": "USD", "unit": "bn"}}],
        "forecast": [{"year": 2030, "size": {"value": 30.5, "currency": "USD", "unit": "bn"}}],
        "cagr_pct": 12.3, "share_basis": "발사 횟수 기준", "as_of": "2026-08-03",
    },
    "sources": [{"title": "NASA", "url": None}],
}


# ── 발행 검증 8케이스 ─────────────────────────────────────────────────

def test_publish_unregistered_slug_422():
    """오타/미등록 slug → 422 (pydantic Literal, 핸들러 진입 전)."""
    with patch.object(svc, "execute") as mock_exec:
        resp = client.post("/api/tech-reports/fusion-power", json=VALID_BODY)
    assert resp.status_code == 422
    mock_exec.assert_not_called()


def test_publish_unit_enum_violation_422():
    """unit: "억원" (enum 밖) → 422."""
    body = copy.deepcopy(VALID_BODY)
    body["market"]["history"][0]["size"]["unit"] = "억원"
    with patch.object(svc, "execute") as mock_exec:
        resp = client.post("/api/tech-reports/smr", json=body)
    assert resp.status_code == 422
    mock_exec.assert_not_called()


def test_publish_nan_value_rejected_422():
    """value: NaN(raw JSON 토큰) → 422. json=로는 NaN 토큰이 전달되지 않으므로 body를 문자열로
    만들어 보낸다. 422 detail의 NaN echo 직렬화 500 방지(main.app 커스텀 핸들러)까지 함께
    검증하므로 self-app이 아니라 main.app을 태운다(analyst_reports 패턴과 동형)."""
    from main import app as main_app
    raw = json.dumps(VALID_BODY).replace('"value": 12.5', '"value": NaN')
    assert '"value": NaN' in raw  # sanity: replace가 실제로 매치됐는지
    main_app.dependency_overrides[require_admin_or_api_key] = lambda: "test-admin-id"
    try:
        c = TestClient(main_app)
        with patch.object(svc, "execute") as mock_exec:
            resp = c.post("/api/tech-reports/smr", content=raw,
                          headers={"Content-Type": "application/json"})
        assert resp.status_code == 422
        mock_exec.assert_not_called()
    finally:
        main_app.dependency_overrides.pop(require_admin_or_api_key, None)


def test_publish_gap_years_explicit_null_201():
    """"gap_years": null 명시 → 201 (task#250 함정의 핀 — Optional[int]여야 통과한다)."""
    body = copy.deepcopy(VALID_BODY)
    body["players"][0]["gap_years"] = None
    with patch.object(svc, "execute") as mock_exec:
        resp = client.post("/api/tech-reports/smr", json=body)
    assert resp.status_code == 201
    mock_exec.assert_called_once()


def test_publish_ambiguous_date_422():
    """모호한 날짜 문자열 → 422. plain str이면 psycopg2가 DATE 바인딩 시 서버 DateStyle로
    "03/08/2026"을 8월 3일로 조용히 저장한다(적대적 리뷰 렌즈2 발견, wrong < missing).
    핵심은 크래시가 아니라 **틀린 값이 커밋되는 것**이라 execute 미호출을 함께 단언한다."""
    for bad in ("03/08/2026", "2026-13-45", "2026/03/08", "next tuesday", ""):
        body = copy.deepcopy(VALID_BODY)
        body["published_date"] = bad
        with patch.object(svc, "execute") as mock_exec:
            resp = client.post("/api/tech-reports/smr", json=body)
        assert resp.status_code == 422, f"{bad!r} → {resp.status_code}"
        mock_exec.assert_not_called()


def test_publish_share_pct_without_basis_422():
    """share_pct 있고 share_basis 없음 → 422 (모델 validator, 필드 간 교차검증)."""
    body = copy.deepcopy(VALID_BODY)
    body["market"]["share_basis"] = None
    with patch.object(svc, "execute") as mock_exec:
        resp = client.post("/api/tech-reports/smr", json=body)
    assert resp.status_code == 422
    mock_exec.assert_not_called()


def test_publish_sources_empty_422():
    """sources: [] → 422 (min_length=1)."""
    body = copy.deepcopy(VALID_BODY)
    body["sources"] = []
    with patch.object(svc, "execute") as mock_exec:
        resp = client.post("/api/tech-reports/smr", json=body)
    assert resp.status_code == 422
    mock_exec.assert_not_called()


def test_list_all_one_row_per_slug():
    """목록 GET ""이 slug당 1행 (S1 latest_all이 slug당 1행이라 DISTINCT ON을 안 쓰는 위임 확인,
    ADR-0038)."""
    rows = [
        {"slug": "smr", "published_date": "2026-08-02", "title": "t2"},
        {"slug": "robotics", "published_date": "2026-08-01", "title": "t1"},
    ]
    with patch.object(svc, "query", return_value=rows) as mock_q:
        resp = client.get("/api/tech-reports")
    assert resp.status_code == 200
    reports = resp.json()["reports"]
    assert len(reports) == 2
    assert {r["slug"] for r in reports} == {"smr", "robotics"}
    sql = mock_q.call_args.args[0]
    assert "ORDER BY published_date DESC" in sql


def test_list_all_topics_len_matches_tech_topics():
    """topics 길이가 svc.TECH_TOPICS 정본 길이와 같다(리터럴 15를 박지 않고 상수에서 파생)."""
    with patch.object(svc, "query", return_value=[]):
        resp = client.get("/api/tech-reports")
    assert resp.status_code == 200
    assert len(resp.json()["topics"]) == len(svc.TECH_TOPICS)


def test_list_all_topics_order_and_keys():
    """topics는 order 엄격 오름차순이고 각 항목 키 집합이 정확히 {slug, name, order}."""
    with patch.object(svc, "query", return_value=[]):
        resp = client.get("/api/tech-reports")
    topics = resp.json()["topics"]
    orders = [t["order"] for t in topics]
    assert orders == sorted(orders)
    assert len(set(orders)) == len(orders)
    for t in topics:
        assert set(t.keys()) == {"slug", "name", "order"}


def test_list_all_reports_unchanged_by_topics_addition():
    """reports 키가 여전히 존재하고 topics 추가 전과 내용이 동일(순수 additive)."""
    rows = [{"slug": "smr", "published_date": "2026-08-02", "title": "t2"}]
    with patch.object(svc, "query", return_value=rows):
        resp = client.get("/api/tech-reports")
    assert resp.status_code == 200
    assert resp.json()["reports"] == rows


def test_republish_replaces_not_appends():
    """slug당 1행(ADR-0038) — 재발행이 행을 늘리지 않고 교체. 두 호출 모두
    ON CONFLICT (slug) DO UPDATE SQL을 태우는지(router→service 배선 확인,
    실제 upsert 보장은 S1 test_tech_reports_service.py가 SQL 단위로 이미 못박았다)."""
    with patch.object(svc, "execute") as mock_exec:
        r1 = client.post("/api/tech-reports/smr", json=VALID_BODY)
        r2 = client.post("/api/tech-reports/smr", json=VALID_BODY)
    assert r1.status_code == 201 and r2.status_code == 201
    assert mock_exec.call_count == 2
    for call in mock_exec.call_args_list:
        assert "ON CONFLICT (slug) DO UPDATE" in call.args[0]


# ── 요약 레이어 3필드 (task#281 S1) ───────────────────────────────────

KEY_POINTS = [
    {"title": "발사비 하락", "body": "1단 회수가 궤도당 비용을 낮춘다.",
     "metrics": [{"label": "발사비", "value": "1.1조원", "change_pct": -22.0},
                 {"label": "재사용 횟수", "value": "22회", "change_pct": None}]},
    {"title": "발사 주기 단축", "body": "재정비 기간이 짧아졌다."},
]
MILESTONES = [
    {"year": 2020, "actor": "로사톰", "event": "로모노소프 상업운전", "status": "done"},
    {"year": 2026, "actor": None, "event": "링룽 계통연결", "status": "in_progress"},
    {"year": 2034, "actor": "한수원", "event": "i-SMR 실증", "status": "planned"},
]


def test_publish_with_key_points_milestones_category_201():
    """① 3필드 전부 담은 정상 본문 → 201, 그리고 저장 payload에 그대로 실린다."""
    body = copy.deepcopy(VALID_BODY)
    body["key_points"] = copy.deepcopy(KEY_POINTS)
    body["milestones"] = copy.deepcopy(MILESTONES)
    body["players"][0]["category"] = "경수형"
    with patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/tech-reports/smr", json=body)
    assert resp.status_code == 201
    payload = mock_save.call_args.args[1]
    assert payload["key_points"][0]["metrics"][0]["change_pct"] == -22.0
    assert payload["key_points"][0]["metrics"][1]["change_pct"] is None
    assert payload["key_points"][1]["metrics"] is None          # metrics 생략 → None
    assert [m["status"] for m in payload["milestones"]] == ["done", "in_progress", "planned"]
    assert payload["milestones"][1]["actor"] is None
    assert payload["players"][0]["category"] == "경수형"


def test_publish_new_fields_omitted_is_null_201():
    """구 판(3필드 전무) 본문도 그대로 201 — additive. 생략 시 None으로 실린다."""
    with patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/tech-reports/smr", json=copy.deepcopy(VALID_BODY))
    assert resp.status_code == 201
    payload = mock_save.call_args.args[1]
    assert payload["key_points"] is None
    assert payload["milestones"] is None
    assert payload["players"][0]["category"] is None


def test_publish_explicit_null_new_fields_not_422():
    """② metrics·actor·category에 **명시적 null** → 422가 아니다(task#250 전체차단 함정의 핀).

    pydantic v2는 validate_default=False라 키 생략은 검증을 안 타지만 클라이언트가 보낸
    null은 선언 타입 검증을 탄다 — `List[X] = Field(None)`/`str = Field(None)`로 쓰면
    칩 하나 때문에 발행 요청 **전체**가 422로 막힌다. Optional[...]가 유일한 차단선.
    """
    body = copy.deepcopy(VALID_BODY)
    body["key_points"] = [{"title": "t", "body": "b", "metrics": None}]
    body["milestones"] = [{"year": 2030, "actor": None, "event": "e", "status": "planned"}]
    body["players"][0]["category"] = None
    with patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/tech-reports/smr", json=body)
    assert resp.status_code == 201, resp.text
    payload = mock_save.call_args.args[1]
    assert payload["key_points"][0]["metrics"] is None
    assert payload["milestones"][0]["actor"] is None
    assert payload["players"][0]["category"] is None
    # 최상위 3필드 자체에 명시적 null을 보내도 통과해야 한다(루틴이 "없음"을 null로 표현할 수 있다)
    body2 = copy.deepcopy(VALID_BODY)
    body2["key_points"] = None
    body2["milestones"] = None
    with patch.object(svc, "save_report"):
        assert client.post("/api/tech-reports/smr", json=body2).status_code == 201


def test_publish_nan_in_key_point_metric_422():
    """③ metrics의 NaN/Infinity 토큰 → 422.

    수정 전에도 통과하므로 red-first가 원리적으로 불가하다(목적은 미래 회귀 차단) —
    change_pct의 `allow_inf_nan=False`를 일시 제거하면 실제로 실패함을 이빨 검증했다.
    raw NaN 토큰은 json.loads를 통과하고 422 detail이 그 NaN을 echo해 직렬화 500이 되므로
    (main.app 커스텀 핸들러가 차단) self-app이 아니라 main.app을 태운다.
    """
    from main import app as main_app
    main_app.dependency_overrides[require_admin_or_api_key] = lambda: "test-admin-id"
    try:
        c = TestClient(main_app)
        for token, needle in (("NaN", '"change_pct": -22.0'), ("Infinity", '"change_pct": -22.0')):
            body = copy.deepcopy(VALID_BODY)
            body["key_points"] = copy.deepcopy(KEY_POINTS)
            raw = json.dumps(body).replace(needle, f'"change_pct": {token}')
            assert f'"change_pct": {token}' in raw  # sanity: replace가 실제로 매치됐는지
            with patch.object(svc, "save_report") as mock_save:
                resp = c.post("/api/tech-reports/smr", content=raw,
                              headers={"Content-Type": "application/json"})
            assert resp.status_code == 422, f"{token} → {resp.status_code}"
            mock_save.assert_not_called()
        # 표시용 문자열 value에 NaN 토큰이 와도 통과하지 않는다(str 타입 거부).
        # ensure_ascii=False 필수 — 기본 True면 "1.1조원"이 \uXXXX로 이스케이프돼 replace가
        # 조용히 no-op하고 이 케이스가 원본 본문으로 201을 받는다(무음 스킵).
        body = copy.deepcopy(VALID_BODY)
        body["key_points"] = copy.deepcopy(KEY_POINTS)
        raw = json.dumps(body, ensure_ascii=False).replace('"value": "1.1조원"', '"value": NaN')
        assert '"value": NaN' in raw  # sanity: replace가 실제로 매치됐는지
        with patch.object(svc, "save_report") as mock_save:
            resp = c.post("/api/tech-reports/smr", content=raw,
                          headers={"Content-Type": "application/json"})
        assert resp.status_code == 422
        mock_save.assert_not_called()
    finally:
        main_app.dependency_overrides.pop(require_admin_or_api_key, None)


def test_publish_milestone_status_enum_violation_422():
    """④ status가 enum 밖 → 422. 색·마커가 3단계 enum으로 결정론적이므로 자유문자열을 막는다."""
    for bad in ("완료", "cancelled", "DONE", ""):
        body = copy.deepcopy(VALID_BODY)
        body["milestones"] = [{"year": 2030, "event": "e", "status": bad}]
        with patch.object(svc, "save_report") as mock_save:
            resp = client.post("/api/tech-reports/smr", json=body)
        assert resp.status_code == 422, f"{bad!r} → {resp.status_code}"
        mock_save.assert_not_called()


def test_publish_key_point_metrics_max_4_422():
    """칩은 최대 4개(레이아웃 계약 — 열 수가 칩 수로 결정된다)."""
    body = copy.deepcopy(VALID_BODY)
    body["key_points"] = [{"title": "t", "body": "b", "metrics": [
        {"label": f"l{i}", "value": f"v{i}"} for i in range(5)]}]
    with patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/tech-reports/smr", json=body)
    assert resp.status_code == 422
    mock_save.assert_not_called()


# ── market.estimates[] (task#282 S1) ──────────────────────────────────

ESTIMATES = [
    {"institution": "Morgan Stanley", "year": 2030,
     "size": {"value": 33.5, "currency": "USD", "unit": "bn"}, "scope": None, "is_basis": True},
    {"institution": "Goldman Sachs", "year": 2030,
     "size": {"value": 28.0, "currency": "USD", "unit": "bn"}, "scope": None, "is_basis": None},
    {"institution": "McKinsey", "year": 2030,
     "size": {"value": 32.0, "currency": "USD", "unit": "bn"}, "scope": "발사 서비스만", "is_basis": None},
    {"institution": "Citi", "year": 2030,
     "size": {"value": 27.5, "currency": "USD", "unit": "bn"}, "scope": None, "is_basis": None},
    {"institution": "BofA", "year": 2030,
     "size": {"value": 29.0, "currency": "USD", "unit": "bn"}, "scope": None, "is_basis": None},
]


def test_publish_estimates_five_institutions_201():
    """① 5기관 정상 통과 → 201, 저장 payload에 그대로 실린다."""
    body = copy.deepcopy(VALID_BODY)
    body["market"]["estimates"] = copy.deepcopy(ESTIMATES)
    with patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/tech-reports/smr", json=body)
    assert resp.status_code == 201, resp.text
    payload = mock_save.call_args.args[1]
    assert len(payload["market"]["estimates"]) == 5
    assert payload["market"]["estimates"][0]["institution"] == "Morgan Stanley"
    assert payload["market"]["estimates"][0]["is_basis"] is True


def test_publish_estimates_unit_mismatch_422():
    """② unit 혼합(bn+mn) → 422."""
    body = copy.deepcopy(VALID_BODY)
    ests = copy.deepcopy(ESTIMATES)
    ests[1]["size"]["unit"] = "mn"
    body["market"]["estimates"] = ests
    with patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/tech-reports/smr", json=body)
    assert resp.status_code == 422
    mock_save.assert_not_called()


def test_publish_estimates_currency_mismatch_422():
    """③ currency 혼합(USD+KRW) → 422."""
    body = copy.deepcopy(VALID_BODY)
    ests = copy.deepcopy(ESTIMATES)
    ests[1]["size"]["currency"] = "KRW"
    body["market"]["estimates"] = ests
    with patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/tech-reports/smr", json=body)
    assert resp.status_code == 422
    mock_save.assert_not_called()


def test_publish_estimates_year_mismatch_422():
    """④ year 혼합 → 422."""
    body = copy.deepcopy(VALID_BODY)
    ests = copy.deepcopy(ESTIMATES)
    ests[1]["year"] = 2031
    body["market"]["estimates"] = ests
    with patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/tech-reports/smr", json=body)
    assert resp.status_code == 422
    mock_save.assert_not_called()


def test_publish_estimates_two_basis_422():
    """⑤ is_basis=True 2개 이상 → 422."""
    body = copy.deepcopy(VALID_BODY)
    ests = copy.deepcopy(ESTIMATES)
    ests[1]["is_basis"] = True
    body["market"]["estimates"] = ests
    with patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/tech-reports/smr", json=body)
    assert resp.status_code == 422
    mock_save.assert_not_called()


def test_publish_estimates_max_6_422():
    """⑥ 7개(초과, max_length=6) → 422."""
    body = copy.deepcopy(VALID_BODY)
    body["market"]["estimates"] = [
        {**copy.deepcopy(ESTIMATES[0]), "institution": f"Inst{i}", "is_basis": None}
        for i in range(7)
    ]
    with patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/tech-reports/smr", json=body)
    assert resp.status_code == 422
    mock_save.assert_not_called()


def test_publish_estimates_omitted_is_null_201():
    """⑦ market.estimates 키 생략 → 201, None으로 저장(additive)."""
    with patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/tech-reports/smr", json=copy.deepcopy(VALID_BODY))
    assert resp.status_code == 201
    payload = mock_save.call_args.args[1]
    assert payload["market"]["estimates"] is None


def test_publish_estimates_explicit_null_201():
    """⑧ market.estimates: null 명시 → 201(422 아님), None으로 저장(task#250 함정의 핀 —
    Optional[List[...]] = Field(None)이어야 통과한다)."""
    body = copy.deepcopy(VALID_BODY)
    body["market"]["estimates"] = None
    with patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/tech-reports/smr", json=body)
    assert resp.status_code == 201, resp.text
    payload = mock_save.call_args.args[1]
    assert payload["market"]["estimates"] is None


def test_publish_estimates_nan_value_rejected_422():
    """⑨ estimates[].size.value에 NaN(raw JSON 토큰) → 422.

    MoneyValue를 재사용하므로 allow_inf_nan=False가 이미 상속돼 있다 — 수정 전에도 통과하므로
    red-first가 원리적으로 불가하다(이빨 검증: MoneyValue.value의 allow_inf_nan=False를 일시
    제거해 실제로 실패함을 확인 후 원복, 결과는 완료 보고에 기록).
    """
    from main import app as main_app
    main_app.dependency_overrides[require_admin_or_api_key] = lambda: "test-admin-id"
    try:
        c = TestClient(main_app)
        body = copy.deepcopy(VALID_BODY)
        body["market"]["estimates"] = copy.deepcopy(ESTIMATES)
        raw = json.dumps(body).replace('"value": 33.5', '"value": NaN')
        assert '"value": NaN' in raw  # sanity: replace가 실제로 매치됐는지
        with patch.object(svc, "save_report") as mock_save:
            resp = c.post("/api/tech-reports/smr", content=raw,
                          headers={"Content-Type": "application/json"})
        assert resp.status_code == 422
        mock_save.assert_not_called()
    finally:
        main_app.dependency_overrides.pop(require_admin_or_api_key, None)


# ── 계보 비교축·관찰 체크리스트(task#296 S1) ──────────────────────────

VARIANTS = [
    {"axis_label": "노형", "options": [
        {"name": "경수형", "examples": ["중국 ACP100 125MWe"],
         "strength": "검증된 기술 기반", "tradeoff": "노심 손상 시 냉각수 필요"},
        {"name": "고온가스형", "examples": ["중국 HTR-PM"],
         "strength": "고온 열 공급 가능", "tradeoff": "흑연 감속재 관리 부담"},
    ]},
    {"axis_label": "회수 방식", "options": [
        {"name": "추진 수직착륙", "examples": ["SpaceX Falcon 9"],
         "strength": "재사용 실적 최다", "tradeoff": "연료 소모가 크다"},
        {"name": "낙하산+그물", "examples": ["Rocket Lab Electron"],
         "strength": "연료가 불필요", "tradeoff": "회수 신뢰성이 낮다"},
    ]},
]
WATCH_ITEMS = [
    {"label": "링룽 1호 계통연결이 IAEA에 등재되는가",
     "detail": "IAEA PRIS 등재는 상업운전 근접의 공인 신호다.",
     "not_signal": "언론 보도만으로는 진척 신호가 아니다"},
    {"label": "차세대 SMR 실증 착공", "detail": None, "not_signal": None},
]


def test_publish_with_variants_watch_items_201():
    """ⓐ 두 필드를 담은 정상 body → 201, 저장 payload에 그대로 실린다."""
    body = copy.deepcopy(VALID_BODY)
    body["variants"] = copy.deepcopy(VARIANTS)
    body["watch_items"] = copy.deepcopy(WATCH_ITEMS)
    with patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/tech-reports/smr", json=body)
    assert resp.status_code == 201, resp.text
    payload = mock_save.call_args.args[1]
    assert len(payload["variants"]) == 2
    assert payload["variants"][0]["axis_label"] == "노형"
    assert payload["variants"][0]["options"][0]["name"] == "경수형"
    assert payload["variants"][0]["options"][0]["examples"] == ["중국 ACP100 125MWe"]
    assert len(payload["watch_items"]) == 2
    assert payload["watch_items"][0]["label"] == WATCH_ITEMS[0]["label"]
    assert payload["watch_items"][1]["detail"] is None


def test_publish_variants_watch_items_omitted_and_explicit_null_201():
    """ⓑ 키 생략과 명시적 null 둘 다 201·None(task#250 함정의 핀 — Optional[List[...]]여야 통과).

    ⚠️ 두 경로가 같은 것은 **model_dump 값**뿐이다 — 저장 시맨틱은 생략=보존 / null=삭제로
    갈리며 그 구별은 `omitted`가 진다(위 `test_omitted_wiring_...`이 그 축을 잰다, task#313).
    """
    # 생략(=구발행물 형태 body, ⓔ 회귀 0)
    with patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/tech-reports/smr", json=copy.deepcopy(VALID_BODY))
    assert resp.status_code == 201
    payload = mock_save.call_args.args[1]
    assert payload["variants"] is None
    assert payload["watch_items"] is None
    # 명시적 null
    body = copy.deepcopy(VALID_BODY)
    body["variants"] = None
    body["watch_items"] = None
    with patch.object(svc, "save_report") as mock_save2:
        resp2 = client.post("/api/tech-reports/smr", json=body)
    assert resp2.status_code == 201, resp2.text
    payload2 = mock_save2.call_args.args[1]
    assert payload2["variants"] is None
    assert payload2["watch_items"] is None


def test_publish_variants_watch_items_violations_422():
    """ⓒⓓ 구조 위반 8케이스 → 422, detail[].loc이 그 필드를 가리킨다.

    ⚠️ 옵션 픽스처에 `strength`를 넣는 것은 장식이 아니다 — `VariantOption._has_comparison_content`가
    이점·대가 둘 다 결측인 옵션을 422로 막으므로(적대 리뷰 렌즈1 #2), 그것 없이 만든 픽스처는 각
    케이스가 **의도한 필드가 아니라 그 부수 에러로** 422를 받아 단언이 격리되지 않는다."""
    two_opts = [{"name": "경수형", "strength": "s"}, {"name": "고온가스형", "strength": "s"}]
    cases = [
        ("axis_label 누락", {"variants": [{"options": two_opts}]}, "axis_label"),
        ("options 1개", {"variants": [{"axis_label": "노형", "options": [{"name": "경수형", "strength": "s"}]}]}, "options"),
        ("options 7개", {"variants": [{"axis_label": "노형",
                                       "options": [{"name": f"opt{i}", "strength": "s"} for i in range(7)]}]}, "options"),
        ("variants 3축", {"variants": [{"axis_label": f"축{i}", "options": two_opts} for i in range(3)]},
         "variants"),
        ("name 빈 문자열", {"variants": [{"axis_label": "노형", "options": [{"name": "", "strength": "s"}, {"name": "b", "strength": "s"}]}]},
         "name"),
        ("watch_items label 61자", {"watch_items": [{"label": "가" * 61}]}, "label"),
        ("watch_items detail 201자", {"watch_items": [{"label": "l", "detail": "가" * 201}]}, "detail"),
        ("options[0].examples 7개", {"variants": [{"axis_label": "노형", "options": [
            {"name": "경수형", "strength": "s", "examples": [f"e{i}" for i in range(7)]}, {"name": "b", "strength": "s"}]}]}, "examples"),
    ]
    for name, patch_fields, expected_field in cases:
        body = copy.deepcopy(VALID_BODY)
        body.update(patch_fields)
        with patch.object(svc, "save_report") as mock_save:
            resp = client.post("/api/tech-reports/smr", json=body)
        assert resp.status_code == 422, f"{name} → {resp.status_code}: {resp.text}"
        locs = [str(x) for err in resp.json()["detail"] for x in err["loc"]]
        assert expected_field in locs, f"{name}: loc={locs}"
        mock_save.assert_not_called()


def test_publish_variants_duplicate_and_empty_comparison_422():
    """적대적 리뷰 렌즈1 #1·#2 회귀 — 검증을 통과하면서 **의미가 깨지는** 입력 3종.

    세 케이스 모두 이 validator들이 없을 때 **201로 통과했다**(리뷰가 TestClient로 직접 재현,
    `save_report` mock으로 무쓰기 확인). 즉 이 테스트의 red 근거는 리뷰의 재현이다.
      · options name 중복  → 2of2 비교표에 같은 이름의 행이 두 번 나와 서로 다른 두 계열로 읽힌다
      · axis_label 중복    → 축마다 표+소제목을 렌더하므로 같은 제목의 표가 나란히 두 개 뜬다
      · strength·tradeoff 둘 다 결측 → 행이 이름만 남아 「비교가 아니라 서술」이 된다
        (축 수준의 min_length=2가 막으려던 상태를 행 수준으로 내린 것)"""
    ok = {"name": "경수형", "strength": "검증된 기술 기반"}
    cases = [
        ("options name 중복",
         {"variants": [{"axis_label": "노형", "options": [dict(ok), dict(ok)]}]}, "name"),
        ("axis_label 중복",
         {"variants": [{"axis_label": "노형", "options": [dict(ok), {"name": "b", "strength": "s"}]},
                       {"axis_label": "노형", "options": [{"name": "c", "strength": "s"},
                                                          {"name": "d", "strength": "s"}]}]}, "axis_label"),
        ("이점·대가 둘 다 결측",
         {"variants": [{"axis_label": "노형", "options": [{"name": "경수형"},
                                                          {"name": "b", "strength": "s"}]}]}, "strength"),
    ]
    for name, patch_fields, expected_word in cases:
        body = copy.deepcopy(VALID_BODY)
        body.update(patch_fields)
        with patch.object(svc, "save_report") as mock_save:
            resp = client.post("/api/tech-reports/smr", json=body)
        assert resp.status_code == 422, f"{name} → {resp.status_code}: {resp.text}"
        # 메시지·loc 어느 쪽이든 그 필드를 가리켜야 한다(validator는 loc이 모델 단위로 나온다)
        assert expected_word in resp.text, f"{name}: {resp.text}"
        mock_save.assert_not_called()


def test_publish_variant_option_one_side_only_201():
    """이점·대가 중 **하나만** 있으면 통과한다 — 「최소 하나」이고 둘 다 요구하지 않는다.

    이 단언이 없으면 다음 사람이 `_has_comparison_content`를 "쌍 강제"로 조여도 아무 테스트가
    막지 않는다. 둘 다 요구하면 한쪽만 아는 계열에서 **발행 전체가 422**로 막히는데, 그 대가가
    이득보다 크다고 판단해 하한을 하나로 둔 것이다(루틴 프롬프트는 여전히 "쌍으로"를 지시한다)."""
    for one_side in ({"strength": "이점만 안다"}, {"tradeoff": "대가만 안다"}):
        body = copy.deepcopy(VALID_BODY)
        opt_a = {"name": "경수형", **one_side}
        body["variants"] = [{"axis_label": "노형",
                             "options": [opt_a, {"name": "고온가스형", "strength": "s"}]}]
        with patch.object(svc, "save_report") as mock_save:
            resp = client.post("/api/tech-reports/smr", json=body)
        assert resp.status_code == 201, f"{one_side} → {resp.status_code}: {resp.text}"
        mock_save.assert_called_once()


# ── 조회 API(추가) ────────────────────────────────────────────────────

def test_list_by_slug():
    rows = [{"slug": "smr", "published_date": "2026-08-01", "title": "t"}]
    with patch.object(svc, "query", return_value=rows):
        resp = client.get("/api/tech-reports/smr")
    assert resp.status_code == 200
    assert resp.json()["slug"] == "smr"
    assert len(resp.json()["reports"]) == 1


def test_list_by_slug_unregistered_422():
    with patch.object(svc, "query") as mock_q:
        resp = client.get("/api/tech-reports/fusion-power")
    assert resp.status_code == 422
    mock_q.assert_not_called()


def test_detail_route_removed_404_or_405():
    """단건(이력) 조회 `GET /{slug}/{published_date}`는 ADR-0038 결정 3으로 제거됐다 —
    소비처가 0(프론트·프로브 7종·루틴 어디서도 호출 안 함)이고, 이력 자체가 폐기됐으므로
    조회할 과거 판이 없다. 그 경로가 조용히 되살아나지 않았음을 핀으로 못박는다."""
    with patch.object(svc, "query") as mock_q:
        resp = client.get("/api/tech-reports/smr/2026-08-01")
    assert resp.status_code in (404, 405)
    mock_q.assert_not_called()


# ── auth 게이팅 (ADR-0029) ────────────────────────────────────────────

def test_publish_blocked_for_non_admin():
    """루틴 API key도 아닌 일반 사용자 세션 → 403 (require_admin_or_api_key 실게이트)."""
    nonadmin = FastAPI()
    nonadmin.include_router(router)
    nonadmin.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
    c = TestClient(nonadmin)
    with patch("auth.auth_service.get_user_by_id", return_value={"role": "user"}):
        with patch.object(svc, "execute") as mock_exec:
            resp = c.post("/api/tech-reports/smr", json=VALID_BODY)
    assert resp.status_code == 403
    mock_exec.assert_not_called()


def test_unauthenticated_401():
    """무인증 read/write 전부 거부(override 없는 fresh app — ADR-0029).

    조회 표면은 2종뿐(단건 조회 경로는 ADR-0038 결정 3으로 제거 — 위 test_detail_route_removed_404_or_405)."""
    fresh = FastAPI()
    fresh.include_router(router)
    c = TestClient(fresh)
    assert c.get("/api/tech-reports").status_code == 401
    assert c.get("/api/tech-reports/smr").status_code == 401
    assert c.post("/api/tech-reports/smr", json=VALID_BODY).status_code == 401


# ── 기술 해부 composition 3축 (ADR-0042, task#305 S1·S2) ──────────────
#
# 검증 6종 각각에 「위반 → 422 · 경계 → 201」 쌍을 둔다. 422는 *그 규칙 때문에* 난 것이어야
# 의미가 있으므로(무관한 필드 오류로도 422가 나므로) detail의 식별 문자열까지 단언한다.

COMPOSITION = {
    "tech": [
        {"name": "재점화 엔진", "share_pct": 40.0, "leaders": ["SpaceX"],
         "rationale": "다회 재점화 내구성이 재사용 횟수의 상한을 정한다."},
        {"name": "정밀 착륙 제어", "share_pct": 35.0, "leaders": [],
         "rationale": "착륙 오차가 회수 성공률을 직접 좌우한다."},
        {"name": "열보호 소재", "share_pct": 25.0, "leaders": ["SpaceX"],
         "rationale": "재진입 열부하가 정비 비용을 지배한다."},
    ],
    "minerals": [
        {"name": "니오븀", "share_pct": 45.0, "rationale": "고온 합금의 대체 불가 첨가원소다.",
         "top_source_country": "브라질", "top_source_pct": 88.0, "used_in": ["재점화 엔진"],
         "producers": [{"name": "CBMM", "country": "브라질", "ticker": None, "share_pct": 78.0}]},
        {"name": "탄소섬유", "share_pct": 30.0, "rationale": "동체 경량화 원가의 다수를 차지한다.",
         "top_source_country": "일본", "top_source_pct": 62.0, "used_in": ["열보호 소재"],
         "producers": []},
        {"name": "헬륨", "share_pct": 25.0, "rationale": "추진제 가압에 상용 대체재가 없다.",
         "top_source_country": "US", "top_source_pct": 55.0, "used_in": [], "producers": []},
    ],
    "minerals_share_basis": "원재료비 기준",
    "experts": [
        {"name": "추진 시스템 설계", "share_pct": 50.0,
         "rationale": "재점화 사이클 설계 경험자가 가장 희소하다."},
        {"name": "유도항법 제어", "share_pct": 30.0,
         "rationale": "착륙 유도 알고리즘 실증 인력이 소수다."},
        {"name": "재진입 열역학", "share_pct": 20.0,
         "rationale": "실비행 열데이터를 다뤄본 인력이 극소수다."},
    ],
}


def _body_with_composition(comp):
    """VALID_BODY에 composition을 얹은 사본 — 원본 오염 방지(형제 테스트 관례)."""
    body = copy.deepcopy(VALID_BODY)
    body["composition"] = copy.deepcopy(comp)
    return body


def _detail(resp):
    return json.dumps(resp.json(), ensure_ascii=False)


# ── S1. additive 3케이스 ─────────────────────────────────────────────

def test_publish_composition_key_omitted_201():
    """composition 키 생략 → 201 (기존 발행 회귀 0)."""
    with patch.object(svc, "execute") as mock_exec:
        resp = client.post("/api/tech-reports/reusable-rocket", json=VALID_BODY)
    assert resp.status_code == 201
    mock_exec.assert_called_once()


def test_publish_composition_explicit_null_201():
    """명시적 `"composition": null` → 201.

    `Composition = Field(None)`(Optional 누락)으로 쓰면 pydantic v2가 선언 타입 검증을 태워
    **키 생략은 통과하는데 명시적 null만 422**가 된다(task#250). 루틴이 "없음"을 null로 표현하면
    리포트 발행 전체가 막히므로 Optional[...]이 필수다.
    """
    body = copy.deepcopy(VALID_BODY)
    body["composition"] = None
    with patch.object(svc, "execute") as mock_exec:
        resp = client.post("/api/tech-reports/reusable-rocket", json=body)
    assert resp.status_code == 201, _detail(resp)
    mock_exec.assert_called_once()


def test_publish_composition_three_axes_201():
    """3축을 채운 페이로드 → 201, 저장 파라미터에 composition이 실린다."""
    with patch.object(svc, "execute") as mock_exec:
        resp = client.post("/api/tech-reports/reusable-rocket",
                           json=_body_with_composition(COMPOSITION))
    assert resp.status_code == 201, _detail(resp)
    mock_exec.assert_called_once()


# ── S2. 검증 6종 (위반 422 · 경계 201) ────────────────────────────────

def test_composition_share_pct_not_multiple_of_five_422():
    """① 5% 그리드 — 37.0·32.5 모두 422 (ADR-0042 결정 3)."""
    for bad, rest in ((37.0, 63.0), (32.5, 67.5)):
        comp = copy.deepcopy(COMPOSITION)
        comp["experts"] = [
            {"name": "A", "share_pct": bad, "rationale": "근거."},
            {"name": "B", "share_pct": rest, "rationale": "근거."},
            {"name": "기타", "share_pct": 0.0, "rationale": "잔여."},
        ]
        with patch.object(svc, "execute") as mock_exec:
            resp = client.post("/api/tech-reports/reusable-rocket",
                               json=_body_with_composition(comp))
        assert resp.status_code == 422, f"{bad}: {_detail(resp)}"
        assert "5의 배수" in _detail(resp), _detail(resp)
        mock_exec.assert_not_called()


def test_composition_share_pct_multiple_of_five_201():
    """① 경계 — 35.0/5.0 같은 5의 배수는 통과한다."""
    comp = copy.deepcopy(COMPOSITION)
    comp["experts"] = [
        {"name": "A", "share_pct": 35.0, "rationale": "근거."},
        {"name": "B", "share_pct": 60.0, "rationale": "근거."},
        {"name": "기타", "share_pct": 5.0, "rationale": "잔여."},
    ]
    with patch.object(svc, "execute"):
        resp = client.post("/api/tech-reports/reusable-rocket",
                           json=_body_with_composition(comp))
    assert resp.status_code == 201, _detail(resp)


def test_composition_axis_sum_not_100_422():
    """② Σ=100 정확히 — 95·105 둘 다 422."""
    for items in (
        [{"name": "A", "share_pct": 50.0, "rationale": "근거."},
         {"name": "B", "share_pct": 30.0, "rationale": "근거."},
         {"name": "C", "share_pct": 15.0, "rationale": "근거."}],   # 95
        [{"name": "A", "share_pct": 50.0, "rationale": "근거."},
         {"name": "B", "share_pct": 35.0, "rationale": "근거."},
         {"name": "C", "share_pct": 20.0, "rationale": "근거."}],   # 105
    ):
        comp = copy.deepcopy(COMPOSITION)
        comp["experts"] = items
        with patch.object(svc, "execute") as mock_exec:
            resp = client.post("/api/tech-reports/reusable-rocket",
                               json=_body_with_composition(comp))
        assert resp.status_code == 422, _detail(resp)
        assert "합이 정확히 100" in _detail(resp), _detail(resp)
        mock_exec.assert_not_called()


def test_composition_axis_sum_exactly_100_201():
    """② 경계 — 합이 정확히 100이면 통과(기본 픽스처가 세 축 모두 100)."""
    with patch.object(svc, "execute"):
        resp = client.post("/api/tech-reports/reusable-rocket",
                           json=_body_with_composition(COMPOSITION))
    assert resp.status_code == 201, _detail(resp)


def test_composition_axis_item_count_out_of_range_422():
    """③ 항목 수 3~7 — 2개·8개 모두 422."""
    two = [{"name": "A", "share_pct": 50.0, "rationale": "근거."},
           {"name": "B", "share_pct": 50.0, "rationale": "근거."}]
    eight = [{"name": f"E{i}", "share_pct": s, "rationale": "근거."}
             for i, s in enumerate([15.0, 15.0, 15.0, 15.0, 10.0, 10.0, 10.0, 10.0])]
    for items, marker in ((two, "too_short"), (eight, "too_long")):
        comp = copy.deepcopy(COMPOSITION)
        comp["experts"] = items
        with patch.object(svc, "execute") as mock_exec:
            resp = client.post("/api/tech-reports/reusable-rocket",
                               json=_body_with_composition(comp))
        assert resp.status_code == 422, _detail(resp)
        assert marker in _detail(resp), _detail(resp)
        mock_exec.assert_not_called()


def test_composition_axis_item_count_boundaries_201():
    """③ 경계 — 정확히 3개·7개는 통과한다."""
    seven = [{"name": f"E{i}", "share_pct": s, "rationale": "근거."}
             for i, s in enumerate([20.0, 20.0, 15.0, 15.0, 10.0, 10.0, 10.0])]
    for items in ([{"name": "A", "share_pct": 50.0, "rationale": "근거."},
                   {"name": "B", "share_pct": 30.0, "rationale": "근거."},
                   {"name": "C", "share_pct": 20.0, "rationale": "근거."}], seven):
        comp = copy.deepcopy(COMPOSITION)
        comp["experts"] = items
        with patch.object(svc, "execute"):
            resp = client.post("/api/tech-reports/reusable-rocket",
                               json=_body_with_composition(comp))
        assert resp.status_code == 201, _detail(resp)


def test_composition_blank_rationale_422():
    """④ 근거 1문장 필수 — 공백만인 rationale은 422 (min_length=1을 공백이 통과한다)."""
    comp = copy.deepcopy(COMPOSITION)
    comp["experts"][0]["rationale"] = "   "
    with patch.object(svc, "execute") as mock_exec:
        resp = client.post("/api/tech-reports/reusable-rocket",
                           json=_body_with_composition(comp))
    assert resp.status_code == 422, _detail(resp)
    assert "근거" in _detail(resp), _detail(resp)
    mock_exec.assert_not_called()


def test_composition_dangling_leader_422():
    """⑤ leaders[]는 players[].name에 실재해야 한다 — 오타 이름은 422이고 그 이름을 메시지에 싣는다."""
    comp = copy.deepcopy(COMPOSITION)
    comp["tech"][0]["leaders"] = ["SpceX"]
    with patch.object(svc, "execute") as mock_exec:
        resp = client.post("/api/tech-reports/reusable-rocket",
                           json=_body_with_composition(comp))
    assert resp.status_code == 422, _detail(resp)
    assert "SpceX" in _detail(resp), _detail(resp)
    assert "players" in _detail(resp), _detail(resp)
    mock_exec.assert_not_called()


def test_composition_leader_matching_player_201():
    """⑤ 경계 — players[]에 실재하는 이름은 통과(바이트 동일 요구)."""
    comp = copy.deepcopy(COMPOSITION)
    comp["tech"][0]["leaders"] = ["SpaceX"]
    with patch.object(svc, "execute"):
        resp = client.post("/api/tech-reports/reusable-rocket",
                           json=_body_with_composition(comp))
    assert resp.status_code == 201, _detail(resp)


def test_composition_producer_share_without_basis_422():
    """⑥ producers[].share_pct가 있으면 minerals_share_basis 필수(_share_pct_requires_basis 동형).

    이 축의 점유는 *그 광물 세계 생산* 기준이라 market.share_basis(그 기술 시장 점유)와 자가 다르다
    — 그래서 별도 기준 문구를 요구한다(ADR-0042 결정 4).
    """
    comp = copy.deepcopy(COMPOSITION)
    comp.pop("minerals_share_basis")
    with patch.object(svc, "execute") as mock_exec:
        resp = client.post("/api/tech-reports/reusable-rocket",
                           json=_body_with_composition(comp))
    assert resp.status_code == 422, _detail(resp)
    assert "minerals_share_basis" in _detail(resp), _detail(resp)
    mock_exec.assert_not_called()


def test_composition_producer_without_share_needs_no_basis_201():
    """⑥ 경계 — 어느 producer도 share_pct를 안 실으면 기준 문구 없이도 통과한다."""
    comp = copy.deepcopy(COMPOSITION)
    comp.pop("minerals_share_basis")
    for m in comp["minerals"]:
        for p in m.get("producers", []):
            p.pop("share_pct", None)
    with patch.object(svc, "execute"):
        resp = client.post("/api/tech-reports/reusable-rocket",
                           json=_body_with_composition(comp))
    assert resp.status_code == 201, _detail(resp)


def test_composition_nan_share_pct_422():
    """NaN 토큰은 422 — raw JSON의 NaN은 json.loads를 통과하고 NaN 비교는 **항상 False**라
    5% 그리드도 Σ=100도 조용히 통과한다(task#211). allow_inf_nan=False가 유일한 차단선이다.

    self-app이 아니라 `main.app`을 쓰는 이유: 422 detail이 입력 NaN을 echo하면 starlette
    allow_nan=False 직렬화가 **500**을 낸다 — 그걸 막는 RequestValidationError 핸들러는
    main.app에만 있다(형제 test_publish_estimates_nan_value_rejected_422와 같은 관례).

    ⚠️ red-first가 원리적으로 불가하다(수정 전에도 통과). 이빨 검증: CompositionItem.share_pct의
    allow_inf_nan=False를 일시 제거해 실제로 실패함을 확인한 뒤 원복했다(task#250 관례).
    """
    from main import app as main_app
    main_app.dependency_overrides[require_admin_or_api_key] = lambda: "test-admin-id"
    try:
        c = TestClient(main_app)
        for token in ("NaN", "Infinity"):
            raw = json.dumps(_body_with_composition(COMPOSITION)).replace(
                '"share_pct": 40.0', f'"share_pct": {token}', 1)
            assert f'"share_pct": {token}' in raw  # sanity: replace가 실제로 매치됐는지
            with patch.object(svc, "save_report") as mock_save:
                resp = c.post("/api/tech-reports/reusable-rocket", content=raw,
                              headers={"Content-Type": "application/json"})
            assert resp.status_code == 422, f"{token}: {_detail(resp)}"
            mock_save.assert_not_called()
    finally:
        main_app.dependency_overrides.pop(require_admin_or_api_key, None)


def test_composition_empty_object_422():
    """축이 하나도 없는 `composition: {}`는 422.

    빈 객체를 허용하면 「해부 없음」의 표현이 null과 {} 둘이 되고, 2/2의 빈 상태 분기가
    두 형태를 각각 다뤄야 한다. 없으면 필드를 생략(=null)하는 것이 이 저장소의 관례다.
    """
    with patch.object(svc, "execute") as mock_exec:
        resp = client.post("/api/tech-reports/reusable-rocket", json=_body_with_composition({}))
    assert resp.status_code == 422, _detail(resp)
    assert "최소 한 축" in _detail(resp), _detail(resp)
    mock_exec.assert_not_called()


def test_composition_single_axis_only_201():
    """경계 — 축 하나만 채운 부분 발행은 통과한다(루틴이 모르는 축은 통째로 생략)."""
    comp = {"experts": copy.deepcopy(COMPOSITION["experts"])}
    with patch.object(svc, "execute"):
        resp = client.post("/api/tech-reports/reusable-rocket",
                           json=_body_with_composition(comp))
    assert resp.status_code == 201, _detail(resp)


def test_composition_duplicate_item_names_422():
    """한 축 안의 항목명 중복은 422 (형제 `_option_names_unique`와 동형).

    중복이면 화면이 같은 이름의 행을 두 번 그려 독자가 서로 다른 둘로 읽고, 2/2 렌더러의
    React key도 충돌한다. task#297이 `variants`에서 HIGH로 잡은 클래스인데 `composition`을
    만들 때 형제의 validator 목록을 전부 열거하지 않아 짝이 빠져 있었다(task#306 자체 검토).
    """
    comp = copy.deepcopy(COMPOSITION)
    comp["experts"] = [
        {"name": "같은이름", "share_pct": 50.0, "rationale": "근거."},
        {"name": "같은이름", "share_pct": 30.0, "rationale": "근거."},
        {"name": "C", "share_pct": 20.0, "rationale": "근거."},
    ]
    with patch.object(svc, "execute") as mock_exec:
        resp = client.post("/api/tech-reports/reusable-rocket", json=_body_with_composition(comp))
    assert resp.status_code == 422, _detail(resp)
    assert "같은이름" in _detail(resp), _detail(resp)
    mock_exec.assert_not_called()


def test_composition_same_name_across_different_axes_201():
    """경계 — **다른 축**에 같은 이름은 통과한다(축이 서로 독립이라 정당하다).

    이 양성 테스트가 없으면 나중에 누가 유일성을 전 축 통합으로 넓혀도 아무도 못 잡는다
    (음성 테스트만으론 "축 단위"라는 결정이 표현되지 않는다 — task#297의 완화 판단 교훈).
    """
    comp = copy.deepcopy(COMPOSITION)
    comp["tech"][0]["name"] = "리튬"          # minerals[0]과 같은 이름
    comp["tech"][0]["leaders"] = []
    comp["minerals"][0]["name"] = "리튬"
    # tech 항목을 개명했으므로 그것을 가리키던 used_in도 함께 옮긴다 — task#313 S3가 그 참조
    # 실재를 강제하므로, 안 옮기면 이 픽스처가 「축 단위 유일성」이 아니라 dangling used_in으로
    # 422가 나 결정이 아니라 픽스처 사정 때문에 실패한다(축은 그대로 유지된다).
    comp["minerals"][0]["used_in"] = ["리튬"]
    with patch.object(svc, "execute"):
        resp = client.post("/api/tech-reports/reusable-rocket", json=_body_with_composition(comp))
    assert resp.status_code == 201, _detail(resp)


# ── 재발행 보존분 재검증 · used_in 실재 (task#313 S2·S3) ───────────────
#
# S1이 「키 생략 = 보존」을 만들면서 새 경로가 열린다: 옛 판의 composition이 보존되는데
# 새 판 players[]에서 그 업체가 빠지면 참조가 조용히 끊긴다(ADR-0042 결정 1의 근거 문장이
# 전용 엔드포인트에 대해 예고한 바로 그 경로가 단일 엔드포인트 안에서 열린 것). S2가 그것을
# 발행 시점 422로 막고, S3는 같은 가족의 남은 공백(minerals[].used_in → tech[].name)을 닫는다.


def _stored(comp):
    """기존 행 1건 — 이 경로가 읽는 것은 그 판의 composition뿐이다(jsonb는 dict로 디코드된다)."""
    return [{"slug": "reusable-rocket", "published_date": "2026-08-01",
             "title": "옛 판", "composition": comp}]


def test_omitted_wiring_passes_preservable_names_to_save_report():
    """배선 — 생략한 선택 필드명이 그대로 `omitted`로 넘어간다.

    이 배선이 없으면 S1의 보존 기능이 **한 번도 호출되지 않는다**(SQL은 늘 full SET).
    명시적 null은 「삭제」이므로 omitted에 들지 않는다 — 그 비대칭이 계약 전체를 지탱한다.
    """
    with patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/tech-reports/reusable-rocket", json=copy.deepcopy(VALID_BODY))
    assert resp.status_code == 201, _detail(resp)
    assert mock_save.call_args.kwargs["omitted"] == frozenset(svc._PRESERVABLE)

    body = copy.deepcopy(VALID_BODY)
    body["composition"] = None
    body["variants"] = None
    with patch.object(svc, "save_report") as mock_save2:
        assert client.post("/api/tech-reports/reusable-rocket", json=body).status_code == 201
    assert mock_save2.call_args.kwargs["omitted"] == (
        frozenset(svc._PRESERVABLE) - {"composition", "variants"})


def test_preserved_leaders_dangling_when_players_shrink_422():
    """① 보존될 composition.tech[].leaders가 새 players[]에 없으면 422.

    red-first: S1(생략=보존)만 있으면 이 요청은 **201로 통과**해 모순이 저장된다 —
    옛 판이 참조하는 업체가 새 판 players[]에 없는 상태가 조용히 살아남는다.
    """
    stored = copy.deepcopy(COMPOSITION)
    stored["tech"][0]["leaders"] = ["SpaceX", "Blue Origin"]
    body = copy.deepcopy(VALID_BODY)                 # players는 SpaceX 하나뿐
    assert "composition" not in body                 # 정의역 sentinel: 생략 경로를 실제로 탄다
    with patch.object(svc, "query", return_value=_stored(stored)):
        with patch.object(svc, "execute") as mock_exec:
            resp = client.post("/api/tech-reports/reusable-rocket", json=body)
    assert resp.status_code == 422, _detail(resp)
    d = _detail(resp)
    assert "Blue Origin" in d, d
    # 해법 2가지가 메시지에 있어야 한다(결정 3) — 없으면 루틴이 같은 422를 30일마다 반복한다
    assert "players" in d, d
    assert "composition" in d, d
    mock_exec.assert_not_called()


def test_preserved_leaders_all_present_201():
    """① 대조군 — 보존될 leaders가 새 players[]에 전부 있으면 통과한다.

    이 축이 없으면 위 422가 「무조건 거부」로도 통과하므로 판별력이 0이다.
    """
    stored = copy.deepcopy(COMPOSITION)
    stored["tech"][0]["leaders"] = ["SpaceX"]
    with patch.object(svc, "query", return_value=_stored(stored)):
        with patch.object(svc, "execute") as mock_exec:
            resp = client.post("/api/tech-reports/reusable-rocket", json=copy.deepcopy(VALID_BODY))
    assert resp.status_code == 201, _detail(resp)
    mock_exec.assert_called_once()


def test_explicit_null_composition_skips_revalidation_201():
    """② 명시적 `"composition": null`은 이 경로를 타지 않는다 — 삭제 의도라 보존할 것이 없다.

    read 자체를 안 하는 것까지 단언한다(하면 「삭제인데 옛 판을 근거로 거부」가 된다).
    """
    stored = copy.deepcopy(COMPOSITION)
    stored["tech"][0]["leaders"] = ["SpaceX", "Blue Origin"]   # 새 players엔 없다
    body = copy.deepcopy(VALID_BODY)
    body["composition"] = None
    with patch.object(svc, "query", return_value=_stored(stored)) as mock_q:
        with patch.object(svc, "execute") as mock_exec:
            resp = client.post("/api/tech-reports/reusable-rocket", json=body)
    assert resp.status_code == 201, _detail(resp)
    mock_q.assert_not_called()
    mock_exec.assert_called_once()


def test_new_slug_has_nothing_to_preserve_201():
    """③ 기존 행이 없는 신규 slug — 보존할 판이 없으므로 통과한다."""
    with patch.object(svc, "query", return_value=[]):
        with patch.object(svc, "execute") as mock_exec:
            resp = client.post("/api/tech-reports/quantum-computing",
                               json=copy.deepcopy(VALID_BODY))
    assert resp.status_code == 201, _detail(resp)
    mock_exec.assert_called_once()


def test_stored_row_without_composition_201():
    """③ 경계 — 직전 판이 있어도 composition이 NULL이면 대조할 참조가 없다."""
    with patch.object(svc, "query", return_value=_stored(None)):
        with patch.object(svc, "execute") as mock_exec:
            resp = client.post("/api/tech-reports/reusable-rocket",
                               json=copy.deepcopy(VALID_BODY))
    assert resp.status_code == 201, _detail(resp)
    mock_exec.assert_called_once()


def test_used_in_dangling_422():
    """S3 — minerals[].used_in의 이름은 tech[].name에 실재해야 한다(못 찾은 이름을 메시지에 싣는다).

    이 참조가 끊기면 해부 화면이 광물을 존재하지 않는 필요기술에 연결해 그린다.
    """
    comp = copy.deepcopy(COMPOSITION)
    comp["minerals"][0]["used_in"] = ["재점화 엔진", "없는기술"]
    with patch.object(svc, "execute") as mock_exec:
        resp = client.post("/api/tech-reports/reusable-rocket", json=_body_with_composition(comp))
    assert resp.status_code == 422, _detail(resp)
    assert "없는기술" in _detail(resp), _detail(resp)
    mock_exec.assert_not_called()


def test_used_in_all_present_201():
    """S3 대조군 — 기본 픽스처의 used_in은 전부 tech[].name에 실재한다(무조건 거부가 아님)."""
    comp = copy.deepcopy(COMPOSITION)
    assert [m.get("used_in") for m in comp["minerals"]] != [[], [], []]   # 빈 표본 아님
    with patch.object(svc, "execute"):
        resp = client.post("/api/tech-reports/reusable-rocket", json=_body_with_composition(comp))
    assert resp.status_code == 201, _detail(resp)


def test_used_in_without_tech_axis_201():
    """S3 — tech 축이 없으면 검증을 **생략**한다(광물 축만 실은 부분 발행이 합법).

    ⚠️ 라이브 7종엔 「tech 부재 + used_in 있음」 판이 0건이라(S0 baseline) 이 생략 분기는
    픽스처로만 덮인다. 그래서 픽스처가 실제로 그 분기를 *타는지* 아래에서 별도로 증명한다 —
    이빨 단언은 분기 커버리지를 보장하지 않는다(task#301).

    이 201은 **직전 판이 없는(또는 tech 축이 없던) 경우**의 계약이다. 직전 판에 tech가 있던
    재발행에서 광물만 싣는 요청은 `_reject_dropped_axes`가 축 소실로 먼저 422를 낸다
    (적대검토 #2·#15 — dangling used_in이 저장되는 유해 경로는 그쪽에서 닫혔다).
    """
    comp = {"minerals": copy.deepcopy(COMPOSITION["minerals"]),
            "minerals_share_basis": COMPOSITION["minerals_share_basis"]}
    parsed = Composition(**copy.deepcopy(comp))
    assert parsed.tech is None                                  # 생략 분기의 게이트 조건
    assert any(m.used_in for m in parsed.minerals)               # 그리고 검사할 참조가 실재한다
    with patch.object(svc, "execute"):
        resp = client.post("/api/tech-reports/reusable-rocket", json=_body_with_composition(comp))
    assert resp.status_code == 201, _detail(resp)


# ── 축 단위 부분 발행 (적대검토 #1·#14) ────────────────────────────────
#
# 보존 입도는 **컬럼 단위**다 — `composition`을 실으면 컬럼이 통째 치환되므로, 루틴이
# 프롬프트 §3의 「모르는 축은 통째로 생략하라」를 따라 광물만 실은 재발행 하나가 직전 판의
# tech·experts 두 축(각 3~7항목의 판단값)을 경고 없이 지운다. 필드 수준의 「생략=보존」과
# 같은 계약을 축 수준으로 내린다: **축 생략 = 유지 요구(422) / 명시적 null = 삭제 허용**.


def _minerals_only():
    return {"minerals": copy.deepcopy(COMPOSITION["minerals"]),
            "minerals_share_basis": COMPOSITION["minerals_share_basis"]}


def test_composition_axis_dropped_on_republish_422():
    """직전 판에 있던 축을 새 composition이 말없이 빼면 422(사라지는 축 이름을 메시지에 싣는다).

    red-first: 이 가드가 없으면 201이고 저장값은 `{"tech": null, "experts": null, ...}`가 된다
    — 게이트 0(leaders·used_in 검증은 tech가 None이라 skip)·테스트 0의 데이터 손실 경로였다.
    """
    with patch.object(svc, "query", return_value=_stored(copy.deepcopy(COMPOSITION))):
        with patch.object(svc, "execute") as mock_exec:
            resp = client.post("/api/tech-reports/reusable-rocket",
                               json=_body_with_composition(_minerals_only()))
    assert resp.status_code == 422, _detail(resp)
    d = _detail(resp)
    assert "tech" in d and "experts" in d, d
    mock_exec.assert_not_called()


def test_composition_axis_explicit_null_deletes_201():
    """축 삭제는 **명시적 null**로만 — 그때는 통과한다(필드 수준 계약과 같은 비대칭)."""
    comp = _minerals_only()
    comp["tech"] = None
    comp["experts"] = None
    with patch.object(svc, "query", return_value=_stored(copy.deepcopy(COMPOSITION))):
        with patch.object(svc, "execute") as mock_exec:
            resp = client.post("/api/tech-reports/reusable-rocket",
                               json=_body_with_composition(comp))
    assert resp.status_code == 201, _detail(resp)
    mock_exec.assert_called_once()


def test_composition_all_axes_reincluded_201():
    """대조군 — 세 축을 다시 실으면 통과한다(가드가 「composition 실으면 무조건 거부」가 아님)."""
    with patch.object(svc, "query", return_value=_stored(copy.deepcopy(COMPOSITION))):
        with patch.object(svc, "execute") as mock_exec:
            resp = client.post("/api/tech-reports/reusable-rocket",
                               json=_body_with_composition(COMPOSITION))
    assert resp.status_code == 201, _detail(resp)
    mock_exec.assert_called_once()


def test_new_slug_partial_axis_201():
    """대조군 — 직전 판이 없으면 광물 축만 실은 부분 발행이 합법이다(잃을 축이 없다)."""
    with patch.object(svc, "query", return_value=[]):
        with patch.object(svc, "execute") as mock_exec:
            resp = client.post("/api/tech-reports/quantum-computing",
                               json=_body_with_composition(_minerals_only()))
    assert resp.status_code == 201, _detail(resp)
    mock_exec.assert_called_once()


def test_publish_response_reports_preserved_fields():
    """관측 — 보존이 일어난 필드를 응답에 싣는다.

    `published_date`·`created_at`은 **항상** 갱신되는데 보존분은 그대로이므로, 응답에
    아무 것도 안 실으면 「stale이 fresh로 보인다」를 사후에 셀 수단이 없다(적대검토 #4·#9·#17).
    """
    with patch.object(svc, "execute"):
        resp = client.post("/api/tech-reports/reusable-rocket", json=copy.deepcopy(VALID_BODY))
    assert resp.status_code == 201, _detail(resp)
    assert resp.json()["preserved"] == sorted(svc._PRESERVABLE)
    # 이빨 — 전부 실은 판은 보존이 0이다(무조건 5개를 되돌리는 것이 아님)
    body = _body_with_composition(COMPOSITION)
    body.update(key_points=None, milestones=None, variants=None, watch_items=None)
    with patch.object(svc, "query", return_value=[]):
        with patch.object(svc, "execute"):
            resp2 = client.post("/api/tech-reports/reusable-rocket", json=body)
    assert resp2.status_code == 201, _detail(resp2)
    assert resp2.json()["preserved"] == []


def test_preserved_leaders_message_offers_resend_before_deletion():
    """422 메시지는 **되싣기**를 먼저 제시해야 한다 — 삭제가 첫 해법이면 201을 최적화하는
    루틴에게 가장 값싼 경로가 「해부 삭제」가 된다(적대검토 #5·#8).
    """
    stored = copy.deepcopy(COMPOSITION)
    stored["tech"][0]["leaders"] = ["SpaceX", "Blue Origin"]
    with patch.object(svc, "query", return_value=_stored(stored)):
        resp = client.post("/api/tech-reports/reusable-rocket", json=copy.deepcopy(VALID_BODY))
    assert resp.status_code == 422, _detail(resp)
    d = resp.json()["detail"]
    assert d.index("다시 실어") < d.index('"composition": null'), d

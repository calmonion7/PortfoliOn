"""선도기술 리포트 발행·조회 API (ADR-0033, task#276 S2).

라우터 테스트는 self-app + dependency override(conftest는 main.app 한정),
무인증 401은 override 없는 fresh app으로 검증(test_security_auth_gaps 패턴).
DB는 services.tech_reports.query/execute를 mock(conftest _block_real_db 가드).
"""
import copy
import json
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.tech_reports import router
from auth import get_current_user_or_api_key, require_admin_or_api_key
from services import tech_reports as svc

app = FastAPI()
app.include_router(router)
# 발행은 require_admin_or_api_key(루틴), 조회 3종은 get_current_user_or_api_key(ADR-0029)
app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
app.dependency_overrides[require_admin_or_api_key] = lambda: "test-admin-id"
client = TestClient(app)


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
    """목록 GET ""이 slug당 1행 (S1 latest_all의 DISTINCT ON (slug) 위임 확인)."""
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
    assert "DISTINCT ON (slug)" in sql


def test_republish_same_day_replaces_not_appends():
    """같은 (slug, published_date) 재발행이 행을 늘리지 않고 교체 — 두 호출 모두
    ON CONFLICT (slug, published_date) DO UPDATE SQL을 태우는지(router→service 배선 확인,
    실제 upsert 보장은 S1 test_tech_reports_service.py가 SQL 단위로 이미 못박았다)."""
    with patch.object(svc, "execute") as mock_exec:
        r1 = client.post("/api/tech-reports/smr", json=VALID_BODY)
        r2 = client.post("/api/tech-reports/smr", json=VALID_BODY)
    assert r1.status_code == 201 and r2.status_code == 201
    assert mock_exec.call_count == 2
    for call in mock_exec.call_args_list:
        assert "ON CONFLICT (slug, published_date) DO UPDATE" in call.args[0]


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


def test_get_detail_found_and_404():
    row = {"slug": "smr", "published_date": "2026-08-01", "title": "t"}
    with patch.object(svc, "query", return_value=[row]):
        resp = client.get("/api/tech-reports/smr/2026-08-01")
    assert resp.status_code == 200
    assert resp.json()["title"] == "t"
    with patch.object(svc, "query", return_value=[]):
        assert client.get("/api/tech-reports/smr/2099-01-01").status_code == 404
    # 비정상 date 문자열의 DB 캐스트 500 방지(analyst_reports 관용구와 동형)
    assert client.get("/api/tech-reports/smr/not-a-date").status_code == 404


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
    """무인증 read/write 전부 거부(override 없는 fresh app — ADR-0029)."""
    fresh = FastAPI()
    fresh.include_router(router)
    c = TestClient(fresh)
    assert c.get("/api/tech-reports").status_code == 401
    assert c.get("/api/tech-reports/smr").status_code == 401
    assert c.get("/api/tech-reports/smr/2026-08-01").status_code == 401
    assert c.post("/api/tech-reports/smr", json=VALID_BODY).status_code == 401

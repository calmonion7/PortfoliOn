"""애널리스트 리포트 발행물 (ADR-0027, task#211) — PER 밴드·데이터 블록·발행/조회 API.

라우터 테스트는 self-app + dependency override(conftest는 main.app 한정),
무인증 401은 override 없는 fresh app으로 검증(test_security_auth_gaps 패턴).
DB는 services.analyst_reports.query/execute를 mock(conftest _block_real_db 가드).
"""
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.analyst_reports import router
from auth import get_current_user, get_current_user_or_api_key, require_admin, require_admin_or_api_key
from services import analyst_reports as svc

app = FastAPI()
app.include_router(router)
# 조회는 get_current_user_or_api_key(루틴 API key 허용, task#213), 발행은 require_admin_or_api_key,
# 삭제는 require_admin(admin 세션 전용 — 루틴 제외, task#222)
app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
app.dependency_overrides[require_admin_or_api_key] = lambda: "test-admin-id"
app.dependency_overrides[require_admin] = lambda: "test-admin-id"
client = TestClient(app)


# ── per_band ──────────────────────────────────────────────────────────

KR_ANNUAL = [
    {"period": "2022", "revenue": 100, "operating_income": 10, "eps": 5000, "per": 12.0, "is_consensus": False},
    {"period": "2023", "revenue": 110, "operating_income": 12, "eps": 5500, "per": 10.0, "is_consensus": False},
    {"period": "2024", "revenue": 120, "operating_income": 14, "eps": 6000, "per": 14.0, "is_consensus": False},
    {"period": "2025", "revenue": 130, "operating_income": 16, "eps": 7000, "per": None, "is_consensus": True},
]


def test_per_band_kr():
    band = svc.per_band(KR_ANNUAL, current_per=13.0, forward_per=11.0)
    assert band == {"min": 10.0, "max": 14.0, "avg": 12.0, "current": 13.0, "forward": 11.0}


def test_per_band_us_ignores_consensus_and_invalid():
    annual = [
        {"period": "2023", "per": 25.0, "is_consensus": False},
        {"period": "2024", "per": 30.0, "is_consensus": False},
        {"period": "2022", "per": -5.0, "is_consensus": False},   # 음수 PER 제외
        {"period": "2025", "per": 99.0, "is_consensus": True},    # 컨센서스 행 제외
    ]
    band = svc.per_band(annual)
    assert band["min"] == 25.0 and band["max"] == 30.0


def test_per_band_insufficient_returns_none():
    assert svc.per_band([{"period": "2024", "per": 12.0, "is_consensus": False}]) is None
    assert svc.per_band([]) is None
    assert svc.per_band(None) is None


# ── build_data_block ──────────────────────────────────────────────────

SNAPSHOT = {
    "price": 70000.0, "market": "KR", "name": "테스트전자",
    "per": 13.0, "forward_per": 11.0,
    "target_mean": 90000.0, "buy": 20, "hold": 3, "sell": 0,
    "financials_annual": KR_ANNUAL,
    "competitors_data": [
        {"ticker": "TST", "name": "테스트전자", "is_self": True, "per": 13.0, "pbr": 1.2,
         "psr": 2.0, "ev_ebitda": 8.0, "rd_intensity": 9.5, "price": 70000.0, "market_cap": 1}
    ],
}


def test_build_data_block():
    block = svc.build_data_block(SNAPSHOT, "2026-07-25")
    assert block["snapshot_date"] == "2026-07-25"
    assert block["price"] == 70000.0
    assert block["consensus"]["target_mean"] == 90000.0
    # 발췌: 비컨센서스 3개년 + 컨센서스 행, period 오름차순
    periods = [f["period"] for f in block["financials_annual"]]
    assert periods == ["2022", "2023", "2024", "2025"]
    assert block["financials_annual"][-1]["is_consensus"] is True
    # 피어 멀티플: 정의된 필드만 (price/market_cap 미포함)
    assert "price" not in block["competitors"][0]
    assert block["competitors"][0]["rd_intensity"] == 9.5
    assert block["per_band"]["current"] == 13.0


# ── 발행 API ──────────────────────────────────────────────────────────

VALID_BODY = {
    "rating": "buy",
    "title": "HBM 증설이 이끄는 실적 재평가",
    "fair_value_low": 80000,
    "fair_value_high": 95000,
    "valuation_method": "과거 5년 PER 밴드 평균 12배에 2026F EPS 적용",
    "points": [
        {"title": "포인트1", "body": "근거1"},
        {"title": "포인트2", "body": "근거2"},
    ],
    "risks": "수요 둔화 리스크",
}


def _publish(body=None):
    with patch.object(svc, "latest_snapshot", return_value=("2026-07-25", SNAPSHOT)), \
         patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/analyst-reports/tst", json=body or VALID_BODY)
    return resp, mock_save


def test_publish_ok_attaches_data_block():
    resp, mock_save = _publish()
    assert resp.status_code == 201
    assert resp.json()["ticker"] == "TST"
    args = mock_save.call_args.args
    # save_report(ticker, published_date, rating, title, low, high, method, points, risks, data)
    assert args[0] == "TST"
    assert args[2] == "buy"
    data = args[9]
    assert data["snapshot_date"] == "2026-07-25"
    assert data["per_band"]["min"] == 10.0
    assert len(args[7]) == 2  # points


def test_publish_with_point_metrics():
    """포인트 지표 칩(metrics, task#218) — additive: 있으면 저장, 없으면(구 payload) 기본 []."""
    body = {**VALID_BODY, "points": [
        {"title": "이익 정상화", "body": "요약.", "metrics": [
            {"label": "2026F 영업이익", "value": "383.2조원", "change_pct": 779.0},
            {"label": "forward PER", "value": "5.9배"},
        ]},
        {"title": "포인트2", "body": "근거2"},
    ]}
    resp, mock_save = _publish(body)
    assert resp.status_code == 201
    points = mock_save.call_args.args[7]
    assert points[0]["metrics"][0]["value"] == "383.2조원"
    assert points[0]["metrics"][1]["change_pct"] is None
    assert points[1]["metrics"] == []  # 구 형태 호환
    too_many = {**VALID_BODY, "points": [
        {"title": "t", "body": "b", "metrics": [{"label": f"l{i}", "value": "v"} for i in range(5)]},
        {"title": "t2", "body": "b2"},
    ]}
    assert client.post("/api/analyst-reports/TST", json=too_many).status_code == 422


def test_publish_explicit_null_change_pct_accepted():
    """명시적 `"change_pct": null`이 발행 요청 전체를 422로 막던 버그(task#250).

    pydantic v2는 validate_default=False라 **키 생략은 통과하지만 명시적 null은 타입 검증을 탄다** —
    `float = Field(None, ...)`이면 null이 float_type 422가 되어, 선택 칩 필드 하나 때문에
    발행 전체가 죽었다. Optional[float]이 그 비대칭을 없앤다.
    """
    body = {**VALID_BODY, "points": [
        {"title": "포인트1", "body": "근거1", "metrics": [
            {"label": "forward PER", "value": "5.9배", "change_pct": None},
        ]},
        {"title": "포인트2", "body": "근거2"},
    ]}
    resp, mock_save = _publish(body)
    assert resp.status_code == 201
    points = mock_save.call_args.args[7]
    assert points[0]["metrics"][0]["change_pct"] is None


def test_publish_nan_change_pct_rejected_422():
    """change_pct의 NaN 차단(allow_inf_nan=False)을 못박는다 — Optional화가 가드를 떨어뜨리지 않도록.

    수정 전에도 통과하므로 red-first가 원리적으로 불가능하다. 목적은 미래 회귀 차단:
    누가 `Optional[float] = None`으로 '정리'하며 allow_inf_nan=False를 지워도 초록으로
    통과하는 것을 막는다. raw NaN 토큰은 json.loads를 통과하고 422 detail이 그 NaN을
    echo해 직렬화 500이 되므로(main.app 커스텀 핸들러가 차단) self-app이 아니라 main.app을 태운다.
    """
    import json as _json
    from main import app as main_app
    body = {**VALID_BODY, "points": [
        {"title": "포인트1", "body": "근거1", "metrics": [
            {"label": "2026F 영업이익", "value": "383.2조원", "change_pct": 779.0},
        ]},
        {"title": "포인트2", "body": "근거2"},
    ]}
    raw = _json.dumps(body).replace('"change_pct": 779.0', '"change_pct": NaN')
    main_app.dependency_overrides[require_admin_or_api_key] = lambda: "test-admin-id"
    try:
        c = TestClient(main_app)
        with patch.object(svc, "latest_snapshot", return_value=("2026-07-25", SNAPSHOT)), \
             patch.object(svc, "save_report"):
            resp = c.post("/api/analyst-reports/TST", content=raw,
                          headers={"Content-Type": "application/json"})
        assert resp.status_code == 422
    finally:
        main_app.dependency_overrides.pop(require_admin_or_api_key, None)


def test_publish_no_snapshot_409():
    with patch.object(svc, "latest_snapshot", return_value=None):
        resp = client.post("/api/analyst-reports/TST", json=VALID_BODY)
    assert resp.status_code == 409


def test_publish_validation_422():
    bad_rating = {**VALID_BODY, "rating": "strong_buy"}
    assert client.post("/api/analyst-reports/TST", json=bad_rating).status_code == 422
    one_point = {**VALID_BODY, "points": [{"title": "1", "body": "1"}]}
    assert client.post("/api/analyst-reports/TST", json=one_point).status_code == 422
    band_inverted = {**VALID_BODY, "fair_value_low": 95000, "fair_value_high": 80000}
    assert client.post("/api/analyst-reports/TST", json=band_inverted).status_code == 422
    missing = {k: v for k, v in VALID_BODY.items() if k != "title"}
    assert client.post("/api/analyst-reports/TST", json=missing).status_code == 422


def test_publish_nan_rejected_422():
    """raw body의 NaN 토큰은 json.loads·NaN 비교(항상 False)를 다 통과하므로
    allow_inf_nan=False가 차단선 — 불변 문서 오염 방지(적대 리뷰 #1).
    422 detail의 NaN echo 직렬화 500 방지(main.app 커스텀 핸들러)까지 함께 검증하므로
    self-app이 아니라 main.app을 태운다."""
    import json as _json
    from main import app as main_app
    main_app.dependency_overrides[require_admin_or_api_key] = lambda: "test-admin-id"
    try:
        c = TestClient(main_app)
        raw = _json.dumps(VALID_BODY).replace('"fair_value_low": 80000', '"fair_value_low": NaN')
        resp = c.post("/api/analyst-reports/TST", content=raw,
                      headers={"Content-Type": "application/json"})
        assert resp.status_code == 422
    finally:
        main_app.dependency_overrides.pop(require_admin_or_api_key, None)


# ── 조회 API ──────────────────────────────────────────────────────────

ROW = {
    "ticker": "TST", "published_date": "2026-07-25", "rating": "buy",
    "title": "한줄 논지", "fair_value_low": 80000, "fair_value_high": 95000,
    "valuation_method": "PER 밴드", "points": [{"title": "p", "body": "b"}],
    "risks": "리스크", "data": {"name": "테스트전자", "market": "KR", "price": 70000.0},
}


def test_list_all():
    with patch.object(svc, "query", return_value=[ROW]):
        resp = client.get("/api/analyst-reports")
    assert resp.status_code == 200
    reports = resp.json()["reports"]
    assert reports[0]["ticker"] == "TST"
    assert reports[0]["name"] == "테스트전자"
    assert "data" not in reports[0]  # 목록은 요약만


def test_list_all_dedups_to_latest_per_ticker():
    """목록 SQL이 종목당 최신 1건으로 줄이는 형태인지 (task#222 — query mock이라 SQL 형태로 못박음)."""
    with patch.object(svc, "query", return_value=[ROW]) as mock_q:
        assert client.get("/api/analyst-reports").status_code == 200
    sql = mock_q.call_args.args[0]
    assert "DISTINCT ON (ticker)" in sql
    assert "ORDER BY ticker, published_date DESC" in sql   # 종목별 최신 판 선택
    assert sql.rstrip().endswith("ORDER BY published_date DESC, ticker")  # 목록 표시는 최신순


def test_list_by_ticker():
    with patch.object(svc, "query", return_value=[ROW]):
        resp = client.get("/api/analyst-reports/tst")
    assert resp.status_code == 200
    assert resp.json()["ticker"] == "TST"
    assert len(resp.json()["reports"]) == 1


def test_list_by_ticker_keeps_all_versions():
    """종목별 조회는 이력 소비처 — dedup 금지, 전 판 유지 (task#222)."""
    older = {**ROW, "published_date": "2026-07-20"}
    with patch.object(svc, "query", return_value=[ROW, older]) as mock_q:
        resp = client.get("/api/analyst-reports/TST")
    assert len(resp.json()["reports"]) == 2
    assert "DISTINCT ON" not in mock_q.call_args.args[0]


def test_detail_and_404():
    with patch.object(svc, "query", return_value=[ROW]):
        resp = client.get("/api/analyst-reports/TST/2026-07-25")
    assert resp.status_code == 200
    body = resp.json()
    assert body["points"] == [{"title": "p", "body": "b"}]
    assert body["data"]["price"] == 70000.0
    with patch.object(svc, "query", return_value=[]):
        assert client.get("/api/analyst-reports/TST/2026-01-01").status_code == 404


def test_save_report_upserts():
    with patch.object(svc, "execute") as mock_exec:
        svc.save_report("TST", "2026-07-25", "buy", "t", 1, 2, "m",
                        [{"title": "p", "body": "b"}], "r", {"k": 1})
    sql = mock_exec.call_args.args[0]
    assert "ON CONFLICT (ticker, published_date) DO UPDATE" in sql


# ── 삭제 (종목 단위 전 판, admin 세션 전용 — task#222) ──

def test_delete_by_ticker():
    with patch.object(svc, "execute", return_value=3) as mock_exec:
        resp = client.delete("/api/analyst-reports/tst")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "ticker": "TST", "deleted": 3}
    sql, params = mock_exec.call_args.args
    assert "DELETE FROM analyst_reports WHERE ticker = %s" in sql
    assert params == ("TST",)


def test_delete_404_when_no_reports():
    with patch.object(svc, "execute", return_value=0):
        assert client.delete("/api/analyst-reports/NONE").status_code == 404


def test_delete_blocked_for_non_admin():
    """루틴 API key도 아닌 일반 사용자 세션 → 403 (require_admin 실게이트, override 없는 app)."""
    nonadmin = FastAPI()
    nonadmin.include_router(router)
    nonadmin.dependency_overrides[get_current_user] = lambda: "test-user-id"
    c = TestClient(nonadmin)
    with patch("auth.auth_service.get_user_by_id", return_value={"role": "user"}):
        with patch.object(svc, "execute") as mock_exec:
            resp = c.delete("/api/analyst-reports/TST")
    assert resp.status_code == 403
    mock_exec.assert_not_called()  # 게이트가 삭제 전에 막는다


# ── 비admin 403 (require_admin_or_api_key 실게이트 — test_report_router 패턴) ──

def test_publish_blocked_for_non_admin():
    nonadmin = FastAPI()
    nonadmin.include_router(router)
    nonadmin.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
    c = TestClient(nonadmin)
    with patch("auth.auth_service.get_user_by_id", return_value={"role": "user"}):
        resp = c.post("/api/analyst-reports/TST", json=VALID_BODY)
    assert resp.status_code == 403


# ── 무인증 401 (override 없는 fresh app — test_security_auth_gaps 패턴) ──

def test_unauthenticated_401():
    fresh = FastAPI()
    fresh.include_router(router)
    c = TestClient(fresh)
    assert c.get("/api/analyst-reports").status_code == 401
    assert c.get("/api/analyst-reports/TST").status_code == 401
    assert c.get("/api/analyst-reports/TST/2026-07-25").status_code == 401
    assert c.post("/api/analyst-reports/TST", json=VALID_BODY).status_code == 401
    assert c.delete("/api/analyst-reports/TST").status_code == 401


# ── 컨센서스 근거 박제 (task#260) ──────────────────────────────────────

import json as _json
import datetime as _dt
from decimal import Decimal as _D


def test_consensus_basis_normalizes_decimal_and_pins_sentinel_exclusion():
    """mart·raw_reports Decimal → float 정규화(json 직렬화 가능), 증권사 최신순,
    __consensus__ 배제는 SQL 담당 — 질의문에 조건이 박혀 있음을 핀."""
    mart_row = {"base_date": _dt.date(2026, 7, 31), "avg_target_price": _D("215000"),
                "avg_target_high": _D("250000"),
                "avg_target_low": _D("180000"), "avg_opinion_score": _D("4.13"),
                "analyst_count": 8}
    brok_rows = [
        {"brokerage_code": "미래에셋", "raw_opinion": "매수", "target_price": _D("240000"),
         "opinion_score": _D("5"), "report_date": _dt.date(2026, 7, 30)},
        {"brokerage_code": "NH투자", "raw_opinion": "Buy", "target_price": _D("230000"),
         "opinion_score": _D("4"), "report_date": _dt.date(2026, 7, 31)},
    ]
    calls = []
    def fake_query(sql, params=None):
        calls.append(sql)
        return [mart_row] if "daily_consensus_mart" in sql else brok_rows
    with patch.object(svc, "query", side_effect=fake_query):
        out = svc.consensus_basis("tst")
    assert out["consensus"] == {"target_mean": 215000.0, "target_high": 250000.0,
                                "target_low": 180000.0,
                                "opinion_score": 4.13, "analyst_count": 8,
                                "base_date": "2026-07-31"}
    bs = out["consensus_detail"]["brokerages"]
    assert [b["brokerage"] for b in bs] == ["NH투자", "미래에셋"]   # 최신순
    assert bs[0]["target_price"] == 230000.0 and isinstance(bs[0]["target_price"], float)
    assert bs[0]["report_date"] == "2026-07-31"
    raw_sql = next(s for s in calls if "raw_reports" in s)
    assert "__consensus__" in raw_sql
    _json.dumps(out)   # Decimal 잔존이면 여기서 TypeError


def test_consensus_basis_empty_returns_none_and_read_failure_graceful():
    with patch.object(svc, "query", return_value=[]):
        assert svc.consensus_basis("TST") is None
    with patch.object(svc, "query", side_effect=Exception("db down")):
        assert svc.consensus_basis("TST") is None   # 발행을 막지 않는다


_BASIS = {
    "consensus": {"target_mean": 215000.0, "target_high": 250000.0, "target_low": 180000.0,
                  "opinion_score": 4.13, "analyst_count": 8, "base_date": "2026-07-31"},
    "consensus_detail": {"brokerages": [
        {"brokerage": "NH투자", "opinion": "Buy", "target_price": 230000.0,
         "opinion_score": 4.0, "report_date": "2026-07-31"}]},
}


def test_publish_attaches_consensus_basis_additively():
    with patch.object(svc, "latest_snapshot", return_value=("2026-07-25", SNAPSHOT)), \
         patch.object(svc, "consensus_basis", return_value=_BASIS), \
         patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/analyst-reports/tst", json=VALID_BODY)
    assert resp.status_code == 201
    data = mock_save.call_args.args[9]
    assert data["consensus"]["target_mean"] == SNAPSHOT["target_mean"]   # 스냅샷 값 우선(mart로 안 덮음)
    assert data["consensus"]["target_high"] == 250000.0                  # additive 확장
    assert data["consensus_detail"]["brokerages"][0]["brokerage"] == "NH투자"


def test_publish_fills_null_target_mean_from_mart():
    """KR 스냅샷 target_mean이 null이면 mart 평균으로 보충 — 평균 스탯·델타 성립(라이브 발견)."""
    snap = {**SNAPSHOT, "target_mean": None}
    with patch.object(svc, "latest_snapshot", return_value=("2026-07-25", snap)), \
         patch.object(svc, "consensus_basis", return_value=_BASIS), \
         patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/analyst-reports/tst", json=VALID_BODY)
    assert resp.status_code == 201
    assert mock_save.call_args.args[9]["consensus"]["target_mean"] == 215000.0


def test_publish_without_consensus_basis_keeps_existing_block():
    """파이프라인 미커버 종목 — consensus_detail 부재, 기존 consensus는 스냅샷 값 그대로."""
    with patch.object(svc, "latest_snapshot", return_value=("2026-07-25", SNAPSHOT)), \
         patch.object(svc, "consensus_basis", return_value=None), \
         patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/analyst-reports/tst", json=VALID_BODY)
    assert resp.status_code == 201
    data = mock_save.call_args.args[9]
    assert "consensus_detail" not in data
    assert data["consensus"]["target_mean"] == SNAPSHOT["target_mean"]

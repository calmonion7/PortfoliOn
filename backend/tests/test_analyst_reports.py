"""애널리스트 리포트 발행물 (ADR-0027, task#211) — PER 밴드·데이터 블록·발행/조회 API.

라우터 테스트는 self-app + dependency override(conftest는 main.app 한정),
무인증 401은 override 없는 fresh app으로 검증(test_security_auth_gaps 패턴).
DB는 services.analyst_reports.query/execute를 mock(conftest _block_real_db 가드).
"""
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.analyst_reports import router
from auth import get_current_user_or_api_key, require_admin_or_api_key
from services import analyst_reports as svc

app = FastAPI()
app.include_router(router)
# 조회는 get_current_user_or_api_key(루틴 API key 허용, task#213), 발행은 require_admin_or_api_key
app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
app.dependency_overrides[require_admin_or_api_key] = lambda: "test-admin-id"
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


def test_list_by_ticker():
    with patch.object(svc, "query", return_value=[ROW]):
        resp = client.get("/api/analyst-reports/tst")
    assert resp.status_code == 200
    assert resp.json()["ticker"] == "TST"
    assert len(resp.json()["reports"]) == 1


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

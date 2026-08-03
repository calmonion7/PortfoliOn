"""애널리스트 리포트 발행물 (ADR-0027, task#211) — PER 밴드·데이터 블록·발행/조회 API.

라우터 테스트는 self-app + dependency override(conftest는 main.app 한정),
무인증 401은 override 없는 fresh app으로 검증(test_security_auth_gaps 패턴).
DB는 services.analyst_reports.query/execute를 mock(conftest _block_real_db 가드).
"""
import json
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


def test_build_data_block_market_outlook_segments_included_when_present():
    """segments 있는 스냅샷 → data["market_outlook"]["segments"] 반환 (task#275 S3ⓒ)."""
    snap = {**SNAPSHOT, "market_outlook": {
        "market_name": "메모리 반도체",
        "segments": [{"name": "메모리", "period": "2024", "revenue_share_pct": 58.3}],
    }}
    block = svc.build_data_block(snap, "2026-07-25")
    assert block["market_outlook"]["segments"] == [
        {"name": "메모리", "period": "2024", "revenue_share_pct": 58.3}
    ]


def test_build_data_block_market_outlook_segments_omitted_when_absent():
    """segments 없는 스냅샷 → "market_outlook" 키 자체 부재(구발행물 섹션 자연 생략)."""
    assert "market_outlook" not in svc.build_data_block(SNAPSHOT, "2026-07-25")
    # market_outlook 필드는 있으나 segments가 없거나 빈 배열인 경우도 동일
    no_segments = {**SNAPSHOT, "market_outlook": {"market_name": "메모리 반도체"}}
    assert "market_outlook" not in svc.build_data_block(no_segments, "2026-07-25")
    empty_segments = {**SNAPSHOT, "market_outlook": {"segments": []}}
    assert "market_outlook" not in svc.build_data_block(empty_segments, "2026-07-25")


def test_build_data_block_market_outlook_segments_parses_json_string():
    """tickers.market_outlook은 text 컬럼 — JSON 문자열로 온 경우도 파싱."""
    snap = {**SNAPSHOT, "market_outlook": json.dumps({
        "segments": [{"name": "파운드리", "period": "2024", "revenue_share_pct": 20.0}]
    })}
    block = svc.build_data_block(snap, "2026-07-25")
    assert block["market_outlook"]["segments"][0]["name"] == "파운드리"
    # 파싱 실패(깨진 JSON 문자열)도 키 부재로 graceful
    broken = {**SNAPSHOT, "market_outlook": "{not json"}
    assert "market_outlook" not in svc.build_data_block(broken, "2026-07-25")


def test_build_data_block_market_outlook_segments_sanitizes_nan_inf():
    """NaN/Infinity 입력이 다른 필드를 오염시키지 않고 그 필드만 null (JSONB 저장·직렬화 500 방지)."""
    snap = {**SNAPSHOT, "market_outlook": {"segments": [
        {"name": "메모리", "period": "2024", "revenue_share_pct": float("nan"),
         "market": {"size": float("inf"), "cagr_pct": 8.0}},
    ]}}
    block = svc.build_data_block(snap, "2026-07-25")
    seg = block["market_outlook"]["segments"][0]
    assert seg["name"] == "메모리"
    assert seg["revenue_share_pct"] is None
    assert seg["market"]["size"] is None
    assert seg["market"]["cagr_pct"] == 8.0
    json.dumps(block)  # NaN/Infinity 잔존이면 여기서 ValueError(allow_nan 기본 True라도 이건 소거 확인용)


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
                "analyst_count": 8, "buy_count": 6, "hold_count": 2, "sell_count": 0}
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
    # analyst_count는 mart의 8이 아니라 **증권사 행수 2**다(task#268/BH7-M2로 판정축 변경).
    # task#260 계획은 "mart에서 analyst_count를 additive 추가"라고 적었지만 같은 줄에서
    # "sentinel은 증권사가 아니라 집계 placeholder라 제외"라고 근거를 밝혔다 — 두 진술이
    # 서로 모순이었고, 계획의 *의도*(sentinel은 애널리스트가 아니다)가 이쪽을 지지한다.
    # 즉 기록된 결정을 뒤집은 게 아니라 부수적 단언을 바로잡은 것이다.
    assert out["consensus"] == {"target_mean": 215000.0, "target_high": 250000.0,
                                "target_low": 180000.0,
                                "opinion_score": 4.13, "analyst_count": 2,
                                "base_date": "2026-07-31",
                                "buy": 6, "hold": 2, "sell": 0}
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
                  "opinion_score": 4.13, "analyst_count": 8, "base_date": "2026-07-31",
                  "buy": 6, "hold": 2, "sell": 0},
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
    assert data["consensus"]["buy"] == SNAPSHOT["buy"]                   # 분포도 스냅샷 우선
    assert data["consensus_detail"]["brokerages"][0]["brokerage"] == "NH투자"


def test_publish_fills_null_target_mean_from_mart():
    """KR 스냅샷 target_mean이 null이면 mart 평균으로 보충 — 평균 스탯·델타 성립(라이브 발견)."""
    snap = {**SNAPSHOT, "target_mean": None, "buy": 0, "hold": 0, "sell": 0}
    with patch.object(svc, "latest_snapshot", return_value=("2026-07-25", snap)), \
         patch.object(svc, "consensus_basis", return_value=_BASIS), \
         patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/analyst-reports/tst", json=VALID_BODY)
    assert resp.status_code == 201
    data = mock_save.call_args.args[9]
    assert data["consensus"]["target_mean"] == 215000.0
    assert (data["consensus"]["buy"], data["consensus"]["hold"], data["consensus"]["sell"]) == (6, 2, 0)


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


# ══ 7차 버그헌트 — 발행 경로 계약 3건 (BH7-M1 · BH7-M2 · BH7-L2) ══════════════

def test_republish_preserves_prior_basis_when_read_fails_BH7_M1():
    """BH7-M1 — 같은 날 재발행 중 consensus_basis read가 실패하면, save_report의
    `data = EXCLUDED.data` 전체 치환이 이미 박제된 근거를 통째로 지운다. ADR-0027이
    '잘못된 판은 새 판 발행으로 덮는다'로 같은 날 재발행을 정정 수단으로 규정하므로
    우연한 경로가 아니다. 같은 (ticker, published_date) 행의 근거만 보존한다."""
    prior = {"data": {"consensus": {"target_high": 250000.0, "target_low": 180000.0,
                                    "opinion_score": 4.13, "analyst_count": 8,
                                    "base_date": "2026-07-31"},
                      "consensus_detail": {"brokerages": [{"brokerage": "NH투자"}]}}}
    with patch.object(svc, "latest_snapshot", return_value=("2026-07-25", SNAPSHOT)), \
         patch.object(svc, "consensus_basis", return_value=None), \
         patch.object(svc, "get_report", return_value=prior), \
         patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/analyst-reports/tst", json=VALID_BODY)
    assert resp.status_code == 201
    data = mock_save.call_args.args[9]
    assert data["consensus_detail"]["brokerages"][0]["brokerage"] == "NH투자"
    assert data["consensus"]["target_high"] == 250000.0      # mart 유래 보충 필드도 보존
    assert data["consensus"]["target_mean"] == SNAPSHOT["target_mean"]   # 스냅샷 값은 안 덮음


def test_new_date_publish_does_not_borrow_old_basis_BH7_M1():
    """BH7-M1 — 보존 범위는 **같은 날 재발행**뿐이다. 새 발행일에 read가 실패했다면
    근거는 없는 게 맞다(wrong < missing). 과거 판의 근거를 새 판에 실으면 stale
    날짜 귀속이 되어 BH7-L2를 되살린다."""
    with patch.object(svc, "latest_snapshot", return_value=("2026-07-25", SNAPSHOT)), \
         patch.object(svc, "consensus_basis", return_value=None), \
         patch.object(svc, "get_report", return_value=None), \
         patch.object(svc, "save_report") as mock_save:
        resp = client.post("/api/analyst-reports/tst", json=VALID_BODY)
    assert resp.status_code == 201
    data = mock_save.call_args.args[9]
    assert "consensus_detail" not in data


def _basis_with(mart_count, brok_rows):
    mart_row = {"base_date": _dt.date(2026, 7, 31), "avg_target_price": _D("215000"),
                "avg_target_high": _D("250000"), "avg_target_low": _D("180000"),
                "avg_opinion_score": _D("4.13"), "analyst_count": mart_count,
                "buy_count": 6, "hold_count": 2, "sell_count": 0}
    def fake_query(sql, params=None):
        return [mart_row] if "daily_consensus_mart" in sql else brok_rows
    with patch.object(svc, "query", side_effect=fake_query):
        return svc.consensus_basis("tst")


def _brok(code):
    return {"brokerage_code": code, "raw_opinion": "Buy", "target_price": _D("230000"),
            "opinion_score": _D("4"), "report_date": _dt.date(2026, 7, 31)}


def test_analyst_count_matches_brokerage_rows_BH7_M2():
    """BH7-M2 — mart의 COUNT(DISTINCT brokerage_code)는 __consensus__ sentinel을 세는데
    (_MART_SQL의 latest_per_brokerage CTE엔 제외가 없다) 증권사 쿼리는 그것을 제외해,
    발행물에 '애널리스트 N명'과 그보다 짧은 증권사 표가 함께 박제된다."""
    out = _basis_with(mart_count=5, brok_rows=[_brok("NH투자"), _brok("미래에셋"),
                                              _brok("삼성"), _brok("KB")])
    assert out["consensus"]["analyst_count"] == 4
    assert len(out["consensus_detail"]["brokerages"]) == 4


def test_analyst_count_none_when_sentinel_only_BH7_M2():
    """BH7-M2 — sentinel만 있는 US 종목은 mart가 1을 주지만 표는 0행이다. 숫자를 지워
    '—'로 표시하는 게 맞다(1명이라 적고 표가 비는 것이 wrong)."""
    out = _basis_with(mart_count=1, brok_rows=[])
    assert out["consensus"]["analyst_count"] is None


def test_base_date_follows_the_shown_target_mean_BH7_L2():
    """BH7-L2 — 라우터가 스냅샷 target_mean을 채택하면(mart 평균을 덮어씀) 그 옆 캡션의
    base_date도 스냅샷 날짜여야 한다. mart 날짜가 남으면 캡션이 옆 숫자의 기준일이 아니다."""
    with patch.object(svc, "latest_snapshot", return_value=("2026-07-25", SNAPSHOT)), \
         patch.object(svc, "consensus_basis", return_value=_BASIS), \
         patch.object(svc, "save_report") as mock_save:
        client.post("/api/analyst-reports/tst", json=VALID_BODY)
    assert mock_save.call_args.args[9]["consensus"]["base_date"] == "2026-07-25"

    # 스냅샷이 비어 mart 평균으로 보충한 경우엔 mart 기준일이 맞다.
    snap = {**SNAPSHOT, "target_mean": None}
    with patch.object(svc, "latest_snapshot", return_value=("2026-07-25", snap)), \
         patch.object(svc, "consensus_basis", return_value=_BASIS), \
         patch.object(svc, "save_report") as mock_save:
        client.post("/api/analyst-reports/tst", json=VALID_BODY)
    assert mock_save.call_args.args[9]["consensus"]["base_date"] == "2026-07-31"

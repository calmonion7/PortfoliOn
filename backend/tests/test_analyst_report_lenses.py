"""심층 리포트 v2 — 구조 축·9렌즈 틀 (ADR 261006-232406, task#368).

렌즈 3·4·5·8의 계산·신호·바뀜 조건은 서버 공식이 정본이다. 오라클 = task#367 CRCL 원자료
(.forge/analysis/crcl/facts.json). 변형마다 손계산 기대값을 하나 이상 두고, 문턱은 양쪽 값을
쌍으로 단언한다(음성만 두면 제약이 없어도 통과한다).

라우터 테스트는 self-app + dependency override, DB는 services.analyst_reports를 mock
(conftest _block_real_db 가드).
"""
import json
import math
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import get_current_user_or_api_key, require_admin, require_admin_or_api_key
from routers.analyst_reports import router
from services import analyst_lenses as L
from services import analyst_reports as svc

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
app.dependency_overrides[require_admin_or_api_key] = lambda: "test-admin-id"
app.dependency_overrides[require_admin] = lambda: "test-admin-id"
client = TestClient(app)


def _v(d):
    """{key: value} → 계산 함수 입력(값만)."""
    return dict(d)


# ── 렌즈 3: 영업 레버리지 ────────────────────────────────────────────────

def test_lens3_revenue_linked_crcl_oracle():
    # RLDC 251→289(+15.1%), 조정 영업비용 119.366→146.380(+22.6%) → ≈0.67 → 빨강
    r = L.lens3("revenue_linked", {"contribution_prev": 251, "contribution_curr": 289,
                                   "fixed_cost_prev": 119.366, "fixed_cost_curr": 146.380})
    assert r["values"]["ratio"] == pytest.approx(0.67, abs=0.01)
    assert r["signal"] == "stop"
    # 바뀜 조건: 빨강→노랑 경계 = 고정비 증가율 × 0.8 ≈ 18.1%
    assert r["flip_value"] == pytest.approx(0.8 * (146.380 / 119.366 - 1) * 100, abs=0.01)
    assert "노랑" in r["flip"]


def test_lens3_fixed_hand_calc():
    # 매출 +20%, 영업비용 +10% → 2.0 → 초록, 노랑 경계 = 매출 증가율 10%
    r = L.lens3("fixed", {"revenue_prev": 100, "revenue_curr": 120, "opex_prev": 50, "opex_curr": 55})
    assert r["values"]["ratio"] == pytest.approx(2.0)
    assert r["signal"] == "go"
    assert r["flip_value"] == pytest.approx(10.0)


def test_lens3_cost_not_growing_is_go_without_ratio():
    r = L.lens3("fixed", {"revenue_prev": 100, "revenue_curr": 105, "opex_prev": 50, "opex_curr": 50})
    assert r["signal"] == "go" and r["values"]["ratio"] is None
    r = L.lens3("fixed", {"revenue_prev": 100, "revenue_curr": 80, "opex_prev": 50, "opex_curr": 49})
    assert r["signal"] == "stop"   # 매출이 비용보다 더 빨리 줄면 레버리지가 역으로 작동


@pytest.mark.parametrize("ratio,expected", [(1.0, "go"), (0.999, "wait"), (0.8, "wait"), (0.799, "stop")])
def test_lens3_threshold_pairs(ratio, expected):
    assert L.classify_lens3(ratio) == expected


# ── 렌즈 4: 비용의 매출 연동 ─────────────────────────────────────────────

def test_lens4_revenue_linked_crcl_oracle():
    # 2025Q2→2026Q2 매출 658.078→701.315, 분배비용 406.94→412.47 → 한계 ≈12.8% · 평균 ≈58.8% → 초록
    r = L.lens4("revenue_linked", {"revenue_prev": 658.078, "revenue_curr": 701.315,
                                   "linked_cost_prev": 406.94, "linked_cost_curr": 412.47})
    assert r["values"]["marginal_pct"] == pytest.approx(12.8, abs=0.05)
    assert r["values"]["average_pct"] == pytest.approx(58.8, abs=0.05)
    assert r["signal"] == "go"
    assert r["flip_value"] == pytest.approx(r["values"]["average_pct"] - 5, abs=1e-9)


def test_lens4_fixed_hand_calc():
    # 약정 1.5배, 매출 1.2배 → 1.25 → 빨강(>1.2)
    r = L.lens4("fixed", {"commitment_prev": 100, "commitment_curr": 150,
                          "revenue_prev": 100, "revenue_curr": 120})
    assert r["values"]["ratio"] == pytest.approx(1.25)
    assert r["signal"] == "stop"


def test_lens4_revenue_linked_shrinking_revenue_is_na():
    r = L.lens4("revenue_linked", {"revenue_prev": 100, "revenue_curr": 90,
                                   "linked_cost_prev": 50, "linked_cost_curr": 48})
    assert r["signal"] == "na" and r["na_reason"]


@pytest.mark.parametrize("marginal,average,expected", [
    (53.79, 58.8, "go"), (53.8, 58.8, "wait"), (63.8, 58.8, "wait"), (63.81, 58.8, "stop")])
def test_lens4_linked_threshold_pairs(marginal, average, expected):
    assert L.classify_lens4_linked(marginal, average) == expected


@pytest.mark.parametrize("ratio,expected", [(1.0, "go"), (1.001, "wait"), (1.2, "wait"), (1.201, "stop")])
def test_lens4_fixed_threshold_pairs(ratio, expected):
    assert L.classify_lens4_fixed(ratio) == expected


# ── 렌즈 5: 자금 원천 ────────────────────────────────────────────────────

CRCL_DEPOSIT = {
    "balance": 74200, "current_yield_pct": 3.49, "avg_share_pct": 38.2,
    "rate_sens_revenue": 737, "rate_sens_cost": 360,
    "other_revenue": 140, "operating_expense": 620,
}


def test_lens5_deposit_crcl_oracle():
    # 한계 몫(Item 7A: 1−360/737 ≈51.2%)으로 손익분기 ≈2.15% → 여유 ≈1.34%p → 노랑, 빨강 경계 ≈3.15%
    r = L.lens5("deposit", CRCL_DEPOSIT)
    assert r["values"]["breakeven_pct"] == pytest.approx(2.15, abs=0.01)
    assert r["values"]["margin_pp"] == pytest.approx(1.34, abs=0.01)
    assert r["signal"] == "wait"
    assert r["flip_value"] == pytest.approx(3.15, abs=0.01)
    assert "빨강" in r["flip"]


def test_lens5_equity_hand_calc():
    r = L.lens5("equity", {"cash": 300, "annual_burn": 100})
    assert r["values"]["runway_years"] == pytest.approx(3.0)
    assert r["signal"] == "go"                       # 3년 경계 포함
    assert r["flip_value"] == pytest.approx(100.0)   # 연 소진 100 넘으면 노랑
    r = L.lens5("equity", {"cash": 300, "annual_burn": -20})   # 흑자 → 무한
    assert r["signal"] == "go" and r["values"]["runway_years"] is None


def test_lens5_debt_hand_calc():
    r = L.lens5("debt", {"operating_income": 100, "interest_expense": 25})
    assert r["values"]["coverage"] == pytest.approx(4.0)
    assert r["signal"] == "wait"
    assert r["flip_value"] == pytest.approx(50.0)    # 영업이익 50 아래면 빨강


@pytest.mark.parametrize("v,expected", [(3.0, "go"), (2.99, "wait"), (1.5, "wait"), (1.49, "stop")])
def test_lens5_runway_threshold_pairs(v, expected):
    assert L.classify_runway(v) == expected


@pytest.mark.parametrize("v,expected", [(2.0, "go"), (1.99, "wait"), (1.0, "wait"), (0.99, "stop")])
def test_lens5_breakeven_threshold_pairs(v, expected):
    assert L.classify_breakeven_margin(v) == expected


@pytest.mark.parametrize("v,expected", [(5.0, "go"), (4.99, "wait"), (2.0, "wait"), (1.99, "stop")])
def test_lens5_coverage_threshold_pairs(v, expected):
    assert L.classify_coverage(v) == expected


# ── 렌즈 8: 밸류에이션 ───────────────────────────────────────────────────

CRCL_MCAP = 20.63e9


def test_lens8_crcl_oracle_multiple_and_yield():
    # 시총 206.3억 달러 ÷ forward 조정 EBITDA 6.2억 → 33.3배, 이익수익률 3.0%
    r = L.lens8("balance_rate", {"forward_earnings": 620}, unit_scale=1e6,
                market_cap=CRCL_MCAP, risk_free_pct=4.0)
    assert r["values"]["multiple"] == pytest.approx(33.3, abs=0.05)
    assert r["values"]["earnings_yield_pct"] == pytest.approx(3.0, abs=0.02)
    assert r["signal"] == "wait"      # 3.0 ≥ 4.0−1.5
    r = L.lens8("balance_rate", {"forward_earnings": 620}, unit_scale=1e6,
                market_cap=CRCL_MCAP, risk_free_pct=4.96)
    assert r["signal"] == "stop"


def test_lens8_balance_rate_sensitivity_crcl_oracle():
    inputs = {"forward_earnings": 620, **{k: v for k, v in CRCL_DEPOSIT.items() if k != "balance"}}
    sens = {"exogenous": [3.0, 3.6, 4.2], "endogenous": [70000, 74000, 80000]}
    r = L.lens8("balance_rate", inputs, unit_scale=1e6, market_cap=CRCL_MCAP,
                risk_free_pct=4.0, sensitivity=sens)
    table = r["values"]["sensitivity"]
    # 행 = 외생(금리), 열 = 내생(유통량). (3.6%, 740억) ≈ 37.6배
    assert table["multiples"][1][1] == pytest.approx(37.6, abs=0.1)
    assert len(table["multiples"]) == 3 and all(len(row) == 3 for row in table["multiples"])


def test_lens8_price_exogenous_sensitivity_hand_calc():
    inputs = {"forward_earnings": 300, "unit_cost": 6, "fixed_cost": 100}
    sens = {"exogenous": [8, 10, 12], "endogenous": [100, 110, 120]}
    r = L.lens8("price_exogenous", inputs, unit_scale=1, market_cap=3400,
                risk_free_pct=4.0, sensitivity=sens)
    # 이익(가격 10, 판매량 110) = 110×(10−6) − 100 = 340 → 3400/340 = 10배
    assert r["values"]["sensitivity"]["multiples"][1][1] == pytest.approx(10.0)


def test_lens8_negative_earnings_is_stop_and_missing_rf_is_na():
    r = L.lens8("usage", {"forward_earnings": -50}, unit_scale=1, market_cap=1000, risk_free_pct=4.0)
    assert r["signal"] == "stop" and r["values"]["multiple"] is None
    r = L.lens8("usage", {"forward_earnings": 50}, unit_scale=1, market_cap=1000, risk_free_pct=None)
    assert r["signal"] == "na" and r["values"]["multiple"] == pytest.approx(20.0)


@pytest.mark.parametrize("ey,rf,expected", [(4.0, 4.0, "go"), (3.99, 4.0, "wait"), (2.5, 4.0, "wait"), (2.49, 4.0, "stop")])
def test_lens8_threshold_pairs(ey, rf, expected):
    assert L.classify_lens8(ey, rf) == expected


def test_nonfinite_derived_value_becomes_na():
    # 1e308 ÷ 1e-308 = inf — 박제·직렬화할 수 없는 값은 추측하지 않고 회색(na)으로
    r = L.lens5("debt", {"operating_income": 1e308, "interest_expense": 1e-308})
    assert r["signal"] == "na" and r["na_reason"]
    assert all(v is None or math.isfinite(v) for v in r["values"].values() if isinstance(v, float))


# ── v2 발행 스키마 ───────────────────────────────────────────────────────

def _raw(value, unit="USD M", source="disclosure", **kw):
    return {"value": value, "unit": unit, "source": source, "ref": "10-Q 2026Q2", **kw}


def _judgment(i, signal="wait"):
    return {"id": i, "summary": f"렌즈{i} 요약", "body": f"렌즈{i} 본문", "signal": signal,
            "flip": f"렌즈{i} 바뀜 조건"}


def crcl_body():
    pct = lambda v: _raw(v, unit="%")
    return {
        "format": 2,
        "title": "금리 의존 구조 그대로 — 손익분기까지 여유 1.3%p",
        "structure": {
            "revenue_engine": {"value": "balance_rate", "rationale": "준비금 잔고×금리가 매출의 95%"},
            "cost_nature": {"value": "revenue_linked", "rationale": "분배비용이 준비금 수익에 연동"},
            "funding_source": {"value": "deposit", "rationale": "USDC 예치금이 수익 자산의 원천"},
        },
        "lenses": [
            _judgment(1), _judgment(2, "go"),
            {"id": 3, "summary": "고정비가 기여몫보다 빨리 증가", "body": "본문",
             "inputs": {"contribution_prev": _raw(251), "contribution_curr": _raw(289),
                        "fixed_cost_prev": _raw(119.366), "fixed_cost_curr": _raw(146.380)}},
            {"id": 4, "summary": "한계 분배율 하락", "body": "본문",
             "metrics": [{"label": "한계 분배율", "value": "12.8%"}],
             "inputs": {"revenue_prev": _raw(658.078), "revenue_curr": _raw(701.315),
                        "linked_cost_prev": _raw(406.94), "linked_cost_curr": _raw(412.47)}},
            {"id": 5, "summary": "금리 하락에 취약", "body": "본문",
             "inputs": {"balance": _raw(74200), "current_yield_pct": pct(3.49),
                        "avg_share_pct": _raw(38.2, unit="%", source="estimate", rationale="RLDC÷준비금 수익"),
                        "rate_sens_revenue": _raw(737), "rate_sens_cost": _raw(360),
                        "other_revenue": _raw(140), "operating_expense": _raw(620)}},
            _judgment(6, "stop"), _judgment(7),
            {"id": 8, "summary": "이익수익률이 무위험 금리 아래", "body": "본문",
             "inputs": {"forward_earnings": _raw(620, source="estimate", rationale="가이던스 중앙값"),
                        "current_yield_pct": pct(3.49),
                        "avg_share_pct": _raw(38.2, unit="%", source="estimate", rationale="RLDC÷준비금 수익"),
                        "rate_sens_revenue": _raw(737), "rate_sens_cost": _raw(360),
                        "other_revenue": _raw(140), "operating_expense": _raw(620)},
             "sensitivity": {
                 "exogenous": {"label": "준비금 수익률", "values": [3.0, 3.6, 4.2], "unit": "%",
                               "source": "estimate", "ref": "시나리오", "rationale": "±0.6%p"},
                 "endogenous": {"label": "USDC 유통량", "values": [70000, 74000, 80000], "unit": "USD M",
                                "source": "estimate", "ref": "시나리오", "rationale": "현재 ±"}}},
            _judgment(9, "na") | {"flip": None, "na_reason": "규제 공시 없음"},
        ],
    }


US_SNAPSHOT = {"price": 81.25, "market": "US", "name": "Circle",
               "competitors_data": [{"ticker": "CRCL", "is_self": True, "market_cap": CRCL_MCAP}]}


def _publish(body, snapshot=US_SNAPSHOT, rf=4.0):
    with patch.object(svc, "latest_snapshot", return_value=("2026-10-06", snapshot)), \
         patch.object(svc, "consensus_basis", return_value=None), \
         patch.object(svc, "get_report", return_value=None), \
         patch.object(L, "cached_risk_free_pct", return_value=rf), \
         patch.object(svc, "save_lens_report") as mock_save, \
         patch.object(svc, "save_report") as mock_v1:
        resp = client.post("/api/analyst-reports/crcl", json=body)
    return resp, mock_save, mock_v1


def _lens(saved_lens_report, i):
    return next(l for l in saved_lens_report["lenses"] if l["id"] == i)


def test_v2_publish_crcl_computes_and_stores_signals():
    resp, mock_save, mock_v1 = _publish(crcl_body())
    assert resp.status_code == 201, resp.text
    mock_v1.assert_not_called()
    kw = mock_save.call_args.kwargs
    lr = kw["lens_report"]
    assert kw["ticker"] == "CRCL" and kw["title"].startswith("금리 의존")
    assert _lens(lr, 3)["signal"] == "stop"
    assert _lens(lr, 4)["signal"] == "go"
    assert _lens(lr, 5)["signal"] == "wait"
    assert _lens(lr, 5)["computed"]["values"]["breakeven_pct"] == pytest.approx(2.15, abs=0.01)
    assert _lens(lr, 5)["computed"]["estimate_based"] is True   # avg_share가 추정
    assert _lens(lr, 3)["computed"]["estimate_based"] is False
    assert _lens(lr, 8)["computed"]["values"]["multiple"] == pytest.approx(33.3, abs=0.05)
    assert _lens(lr, 8)["computed"]["risk_free_source"] == "server_cache"
    assert _lens(lr, 8)["flip"].startswith("forward 이익 ") and "USD M" in _lens(lr, 8)["flip"]  # 단위 병기
    for i in (3, 4, 5, 8):
        assert _lens(lr, i)["flip"]
    # 판단 렌즈 1 wait·2 go·6 stop·7 wait·9 na + 계산 3 stop·4 go·5 wait·8 wait(3.0 ≥ 4.0−1.5)
    assert _lens(lr, 8)["signal"] == "wait"
    assert lr["tally"] == {"go": 2, "wait": 4, "stop": 2, "na": 1}
    assert lr["structure"]["funding_source"]["value"] == "deposit"
    assert kw["data"]["snapshot_date"] == "2026-10-06"


def test_v2_computed_lens_with_signal_is_422_and_without_is_201():
    body = crcl_body()
    body["lenses"][2]["signal"] = "go"
    assert _publish(body)[0].status_code == 422
    body = crcl_body()
    body["lenses"][2]["flip"] = "x"
    assert _publish(body)[0].status_code == 422
    assert _publish(crcl_body())[0].status_code == 201


def test_v2_lens_ids_must_be_1_to_9_exactly_once():
    body = crcl_body()
    body["lenses"] = body["lenses"][:-1]
    assert _publish(body)[0].status_code == 422
    body = crcl_body()
    body["lenses"][-1] = _judgment(1)
    assert _publish(body)[0].status_code == 422


def test_v2_judgment_lens_rules():
    body = crcl_body()
    del body["lenses"][0]["signal"]
    assert _publish(body)[0].status_code == 422          # 판단 렌즈 신호 필수
    body = crcl_body()
    body["lenses"][0]["flip"] = None
    assert _publish(body)[0].status_code == 422          # na가 아니면 바뀜 조건 필수
    body = crcl_body()
    body["lenses"][8]["na_reason"] = None
    assert _publish(body)[0].status_code == 422          # na면 사유 필수


def test_v2_estimate_requires_rationale_pair():
    body = crcl_body()
    body["lenses"][2]["inputs"]["contribution_prev"] = _raw(251, source="estimate")
    assert _publish(body)[0].status_code == 422
    body["lenses"][2]["inputs"]["contribution_prev"] = _raw(251, source="estimate", rationale="분기 추정")
    assert _publish(body)[0].status_code == 201


def test_v2_missing_input_is_422_but_na_reason_is_201_grey():
    body = crcl_body()
    del body["lenses"][4]["inputs"]["rate_sens_cost"]
    assert _publish(body)[0].status_code == 422
    body["lenses"][4] = {"id": 5, "summary": "원자료 없음", "body": "본문", "na_reason": "Item 7A 미공시"}
    resp, mock_save, _ = _publish(body)
    assert resp.status_code == 201
    l5 = _lens(mock_save.call_args.kwargs["lens_report"], 5)
    assert l5["signal"] == "na" and l5["na_reason"] == "Item 7A 미공시" and l5.get("computed") is None


def test_v2_unknown_input_key_and_bad_enum_422():
    body = crcl_body()
    body["lenses"][2]["inputs"]["typo_key"] = _raw(1)
    assert _publish(body)[0].status_code == 422
    body = crcl_body()
    body["structure"]["revenue_engine"]["value"] = "subscription"
    assert _publish(body)[0].status_code == 422


def test_v2_mixed_money_units_422():
    body = crcl_body()
    body["lenses"][2]["inputs"]["contribution_prev"] = _raw(251, unit="USD B")
    assert _publish(body)[0].status_code == 422


def test_v2_explicit_null_optionals_accepted():
    body = crcl_body()
    body["lenses"][0]["metrics"] = None
    body["lenses"][2]["inputs"]["contribution_prev"]["rationale"] = None
    body["lenses"][2]["metrics"] = None
    assert _publish(body)[0].status_code == 201


def test_v2_lens8_currency_mismatch_422():
    snap = {**US_SNAPSHOT, "market": "KR"}
    assert _publish(crcl_body(), snapshot=snap)[0].status_code == 422


def test_v2_lens8_missing_snapshot_market_cap_is_na():
    snap = {**US_SNAPSHOT, "competitors_data": []}
    resp, mock_save, _ = _publish(crcl_body(), snapshot=snap)
    assert resp.status_code == 201
    l8 = _lens(mock_save.call_args.kwargs["lens_report"], 8)
    assert l8["signal"] == "na" and "시총" in l8["na_reason"]


def test_v2_nan_raw_value_422_on_main_app():
    from main import app as main_app
    good = json.dumps(crcl_body())
    raws = [good.replace('"value": 251', '"value": NaN', 1),          # 원자료 값
            good.replace("[3.0, 3.6, 4.2]", "[3.0, Infinity, 4.2]", 1)]  # 민감도 축 원소
    assert all(r != good for r in raws)
    main_app.dependency_overrides[require_admin_or_api_key] = lambda: "test-admin-id"
    try:
        c = TestClient(main_app)
        for raw in raws:
            with patch.object(svc, "latest_snapshot", return_value=("2026-10-06", US_SNAPSHOT)), \
                 patch.object(svc, "save_lens_report") as ms:
                resp = c.post("/api/analyst-reports/CRCL", content=raw,
                              headers={"Content-Type": "application/json"})
            assert resp.status_code == 422
            ms.assert_not_called()
    finally:
        main_app.dependency_overrides.pop(require_admin_or_api_key, None)


# ── 저장·응답 왕복 ───────────────────────────────────────────────────────

def test_v2_roundtrip_post_then_get_returns_stored_lens_report():
    resp, mock_save, _ = _publish(crcl_body())
    assert resp.status_code == 201
    kw = mock_save.call_args.kwargs
    row = {"ticker": "CRCL", "published_date": kw["published_date"], "rating": None,
           "title": kw["title"], "fair_value_low": None, "fair_value_high": None,
           "valuation_method": "", "points": [], "risks": "", "data": kw["data"],
           "lens_report": kw["lens_report"]}
    with patch.object(svc, "query", return_value=[row]):
        detail = client.get(f"/api/analyst-reports/CRCL/{kw['published_date']}").json()
        listing = client.get("/api/analyst-reports/CRCL").json()
    assert detail["format"] == 2
    assert [l["id"] for l in detail["lenses"]] == list(range(1, 10))
    assert detail["lenses"] == kw["lens_report"]["lenses"]
    assert detail["structure"] == kw["lens_report"]["structure"]
    assert detail["tally"] == kw["lens_report"]["tally"]
    assert listing["reports"][0]["format"] == 2
    assert listing["reports"][0]["tally"] == kw["lens_report"]["tally"]


def test_v1_row_reports_format_1():
    row = {"ticker": "TST", "published_date": "2026-07-25", "rating": "buy", "title": "t",
           "fair_value_low": 1, "fair_value_high": 2, "valuation_method": "m", "points": [],
           "risks": "r", "data": {}, "lens_report": None}
    with patch.object(svc, "query", return_value=[row]):
        detail = client.get("/api/analyst-reports/TST/2026-07-25").json()
    assert detail["format"] == 1 and "lenses" not in detail


def test_save_lens_report_sql_sets_lens_report_and_nulls_rating():
    with patch.object(svc, "execute") as ex:
        svc.save_lens_report(ticker="crcl", published_date="2026-10-06", title="t",
                             data={"a": 1}, lens_report={"lenses": []})
    sql, params = ex.call_args.args
    assert "ON CONFLICT (ticker, published_date)" in sql
    assert "lens_report = EXCLUDED.lens_report" in sql
    # 같은 날 v1 판을 v2로 덮으면 v1 판단 필드가 남지 않아야 한다(두 형식이 한 행에 섞이지 않게)
    assert "rating = NULL" in sql and "fair_value_low = NULL" in sql
    assert params[0] == "CRCL"
    assert json.loads(params[-1]) == {"lenses": []}


def test_v1_save_report_clears_lens_report_on_same_day_overwrite():
    with patch.object(svc, "execute") as ex:
        svc.save_report("TST", "2026-07-25", "buy", "t", 1, 2, "m", [], "r", {})
    assert "lens_report = NULL" in ex.call_args.args[0]


# ── 적대 검토 수정분 (task#368 리뷰) ─────────────────────────────────────

def test_lens8_balance_rate_zero_rate_sensitivity_is_na_not_500():
    """검증을 통과한 본문이 민감도 표 계산에서 ZeroDivisionError로 500을 내던 경로(HIGH)."""
    inputs = {"forward_earnings": 620, **{k: v for k, v in CRCL_DEPOSIT.items() if k != "balance"},
              "rate_sens_revenue": 0}
    r = L.lens8("balance_rate", inputs, unit_scale=1e6, market_cap=CRCL_MCAP, risk_free_pct=4.0,
                sensitivity={"exogenous": [3.0, 3.6, 4.2], "endogenous": [70000, 74000, 80000]})
    assert r["signal"] == "na" and r["na_reason"]
    body = crcl_body()
    body["lenses"][7]["inputs"]["rate_sens_revenue"] = _raw(0)
    resp, mock_save, _ = _publish(body)
    assert resp.status_code == 201
    assert _lens(mock_save.call_args.kwargs["lens_report"], 8)["signal"] == "na"


def test_lens5_equity_non_positive_cash_flip_is_reachable():
    """현금 ≤0이면 런웨이 0 → 빨강, 바뀜 조건은 도달 가능한 양수 경계여야 한다(음수 경계 금지)."""
    r = L.lens5("equity", {"cash": -5, "annual_burn": 2})
    assert r["signal"] == "stop"
    assert r["flip_value"] == pytest.approx(3.0) and "-" not in r["flip"]


def test_lens3_falling_cost_flip_names_the_boundary_colour():
    r = L.lens3("fixed", {"revenue_prev": 100, "revenue_curr": 105, "opex_prev": 50, "opex_curr": 49})
    assert r["signal"] == "go" and "빨강" in r["flip"]
    assert r["flip_value"] == pytest.approx(-2.0)
    r = L.lens3("fixed", {"revenue_prev": 100, "revenue_curr": 80, "opex_prev": 50, "opex_curr": 49})
    assert r["signal"] == "stop" and "초록" in r["flip"]


def test_lens8_balance_rate_axis_units_pair():
    body = crcl_body()
    body["lenses"][7]["sensitivity"]["exogenous"]["unit"] = "bp"
    assert _publish(body)[0].status_code == 422
    body = crcl_body()
    body["lenses"][7]["sensitivity"]["endogenous"]["unit"] = "USD B"
    assert _publish(body)[0].status_code == 422
    assert _publish(crcl_body())[0].status_code == 201


def test_bad_format_value_is_rejected_with_format_error():
    for fmt in ("2", 3):
        body = {**crcl_body(), "format": fmt}
        resp = _publish(body)[0]
        assert resp.status_code == 422
        assert any("format" in [str(x) for x in e["loc"]] for e in resp.json()["detail"])

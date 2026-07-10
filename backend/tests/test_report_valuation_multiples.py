"""KR PSR 파생 로직 단위 테스트 (task#112 S2).
PSR = market_cap(원) ÷ TTM매출(원).
financials의 revenue는 이미 원 단위(get_financials_kr에서 ×1e8 변환됨).
"""
import math
import pytest


def _kr_psr(market_cap, financials):
    """report_generator generate_report KR 분기의 PSR 파생 로직 추출."""
    actual_f = [f for f in financials if not f.get("is_consensus")]
    try:
        mc = market_cap
        ttm_rev = sum(
            f["revenue"] for f in actual_f[:4]
            if f.get("revenue") is not None
        )
        if mc and ttm_rev and ttm_rev > 0 and math.isfinite(mc / ttm_rev):
            return round(mc / ttm_rev, 2)
    except Exception:
        pass
    return None


def _make_f(revenue, is_consensus=False):
    return {"revenue": revenue, "is_consensus": is_consensus}


def test_kr_psr_basic():
    # 삼성전자 근사값: mc=~1984조원, ttm_rev=~388조원 → PSR≈5.11
    mc = 1_984_811_600_000_000
    financials = [
        _make_f(1_338_734 * int(1e8)),  # 202603 분기 매출(억원→원)
        _make_f(938_374 * int(1e8)),
        _make_f(860_617 * int(1e8)),
        _make_f(745_663 * int(1e8)),
        _make_f(None),                   # 결측 분기 — 제외됨
    ]
    psr = _kr_psr(mc, financials)
    assert psr is not None
    assert 4.0 < psr < 7.0  # 합리적 범위 — 과적합 아닌 상한/하한


def test_kr_psr_skips_consensus():
    # consensus 분기는 TTM 계산에서 제외
    mc = 1_000_000_000_000
    financials = [
        _make_f(100_000 * int(1e8), is_consensus=False),
        _make_f(100_000 * int(1e8), is_consensus=False),
        _make_f(100_000 * int(1e8), is_consensus=False),
        _make_f(100_000 * int(1e8), is_consensus=True),   # 제외
    ]
    # consensus 제외 3분기만 합산 → ttm_rev = 300_000억원 = 3e13원
    psr = _kr_psr(mc, financials)
    assert psr is not None
    expected = round(mc / (3e13), 2)
    assert psr == expected


def test_kr_psr_zero_revenue_returns_none():
    mc = 1_000_000_000_000
    financials = [_make_f(0), _make_f(0)]
    assert _kr_psr(mc, financials) is None


def test_kr_psr_no_market_cap_returns_none():
    financials = [_make_f(100_000 * int(1e8))]
    assert _kr_psr(None, financials) is None


# ── task#169: 실제 추출 함수(services.report_generator) 검증 ────────────────────
# ADR-0024: KR EV/EBITDA=yfinance info.enterpriseToEbitda, 지표별 동일 소스.

from unittest.mock import patch, MagicMock

from services import report_generator as rg


def test_real_kr_psr_normal():
    assert rg._kr_psr(1_000_000_000_000, 200_000_000_000) == 5.0


def test_real_kr_psr_none_market_cap():
    assert rg._kr_psr(None, 200_000_000_000) is None


def test_real_kr_psr_zero_revenue():
    assert rg._kr_psr(1_000_000_000_000, 0) is None


def test_real_kr_psr_non_finite():
    assert rg._kr_psr(float("inf"), 200_000_000_000) is None
    assert rg._kr_psr(1_000_000_000_000, float("nan")) is None


def _naver_quarter_response(quarters):
    """quarters: [{key, revenue(억원), per, pbr, is_consensus}], 순서 무관(함수가 key desc 정렬)."""
    metas = [{"key": q["key"], "isConsensus": "Y" if q.get("is_consensus") else "N"} for q in quarters]
    rows = [{"columns": {}} for _ in range(15)]
    rows[0]["columns"] = {q["key"]: {"value": str(q["revenue"])} for q in quarters}
    rows[12]["columns"] = {q["key"]: {"value": str(q["per"])} for q in quarters if q.get("per") is not None}
    rows[14]["columns"] = {q["key"]: {"value": str(q["pbr"])} for q in quarters if q.get("pbr") is not None}
    return {"financeInfo": {"trTitleList": metas, "rowList": rows}}


def test_comp_valuation_us_reads_psr_ev_ebitda_from_info():
    with patch("services.report_generator.yf.Ticker", return_value=MagicMock(info={
        "trailingPE": 20.0, "priceToBook": 5.0,
        "priceToSalesTrailing12Months": 8.5, "enterpriseToEbitda": 22.1,
    })):
        result = rg._comp_valuation("MSFT", "US")
    assert result == {"per": 20.0, "pbr": 5.0, "psr": 8.5, "ev_ebitda": 22.1}


def test_comp_valuation_us_nan_infinity_become_none():
    with patch("services.report_generator.yf.Ticker", return_value=MagicMock(info={
        "trailingPE": float("nan"), "priceToBook": "Infinity",
        "priceToSalesTrailing12Months": None, "enterpriseToEbitda": float("inf"),
    })):
        result = rg._comp_valuation("MSFT", "US")
    assert result == {"per": None, "pbr": None, "psr": None, "ev_ebitda": None}


def test_comp_valuation_kr_ttm_revenue_complete_4_quarters():
    data = [
        {"key": "4", "revenue": 100_000, "per": 12.0, "pbr": 1.5},
        {"key": "3", "revenue": 90_000, "per": 11.0, "pbr": 1.4},
        {"key": "2", "revenue": 80_000, "per": 10.0, "pbr": 1.3},
        {"key": "1", "revenue": 70_000, "per": 9.0, "pbr": 1.2},
    ]
    resp = _naver_quarter_response(data)
    with patch("services.market.kr._naver_get", return_value=resp), \
         patch("services.report_generator.yf.Ticker", return_value=MagicMock(info={"enterpriseToEbitda": 8.5})):
        result = rg._comp_valuation("000660", "KR")
    assert result["per"] == 12.0
    assert result["pbr"] == 1.5
    assert result["_ttm_revenue"] == pytest.approx((100_000 + 90_000 + 80_000 + 70_000) * 1e8)
    assert result["ev_ebitda"] == 8.5


def test_comp_valuation_kr_ttm_revenue_none_under_4_quarters():
    data = [
        {"key": "3", "revenue": 90_000, "per": 11.0, "pbr": 1.4},
        {"key": "2", "revenue": 80_000, "per": 10.0, "pbr": 1.3},
        {"key": "1", "revenue": 70_000, "per": 9.0, "pbr": 1.2},
    ]
    resp = _naver_quarter_response(data)
    with patch("services.market.kr._naver_get", return_value=resp), \
         patch("services.report_generator.yf.Ticker", return_value=MagicMock(info={"enterpriseToEbitda": 8.5})):
        result = rg._comp_valuation("000660", "KR")
    assert result["_ttm_revenue"] is None
    assert result["per"] == 11.0  # 최신(비consensus) 분기 = key "3"


def test_comp_valuation_kr_ev_ebitda_ks_none_falls_back_kq():
    resp = _naver_quarter_response([{"key": "1", "revenue": 100_000, "per": 10.0, "pbr": 1.0}])
    calls = []

    def _fake_ticker(sym):
        calls.append(sym)
        if sym.endswith(".KS"):
            return MagicMock(info={})
        return MagicMock(info={"enterpriseToEbitda": 60.1})

    with patch("services.market.kr._naver_get", return_value=resp), \
         patch("services.report_generator.yf.Ticker", side_effect=_fake_ticker):
        result = rg._comp_valuation("247540", "KR")
    assert result["ev_ebitda"] == 60.1
    assert calls == ["247540.KS", "247540.KQ"]


def test_comp_valuation_kr_exception_returns_all_none_four_keys():
    with patch("services.market.kr._naver_get", side_effect=RuntimeError("boom")):
        result = rg._comp_valuation("000660", "KR")
    assert result == {"per": None, "pbr": None, "_ttm_revenue": None, "ev_ebitda": None}

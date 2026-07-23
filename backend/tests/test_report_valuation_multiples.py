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
    # get_income_stmt는 미설정 MagicMock(.empty가 기본 truthy) → rd_intensity None
    assert result == {"per": 20.0, "pbr": 5.0, "psr": 8.5, "ev_ebitda": 22.1, "rd_intensity": None}


def test_comp_valuation_us_nan_infinity_become_none():
    with patch("services.report_generator.yf.Ticker", return_value=MagicMock(info={
        "trailingPE": float("nan"), "priceToBook": "Infinity",
        "priceToSalesTrailing12Months": None, "enterpriseToEbitda": float("inf"),
    })):
        result = rg._comp_valuation("MSFT", "US")
    assert result == {"per": None, "pbr": None, "psr": None, "ev_ebitda": None, "rd_intensity": None}


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
    assert result == {"per": None, "pbr": None, "_ttm_revenue": None, "ev_ebitda": None, "rd_intensity": None}


# ── task#204 S2: R&D집약도(rd_intensity) ─────────────────────────────────────
# US=yfinance get_income_stmt 메서드(무공백 라벨). KR=DART best-effort(Non-goal).

import pandas as pd


def _income_stmt(rd=None, revenue=None):
    """get_income_stmt(freq='yearly', as_dict=False) 형태 fixture(무공백 라벨, 최신 연도 1컬럼)."""
    data, index = {}, []
    if rd is not None:
        index.append("ResearchAndDevelopment")
    if revenue is not None:
        index.append("TotalRevenue")
    values = [v for v in (rd, revenue) if v is not None]
    return pd.DataFrame({pd.Timestamp("2025-12-31"): values}, index=index)


def test_comp_valuation_us_rd_intensity_normal():
    stmt = _income_stmt(rd=1_000_000_000.0, revenue=20_000_000_000.0)
    with patch("services.report_generator.yf.Ticker", return_value=MagicMock(
            info={}, get_income_stmt=MagicMock(return_value=stmt))):
        result = rg._comp_valuation("MSFT", "US")
    assert result["rd_intensity"] == 5.0


def test_comp_valuation_us_rd_intensity_sanity_violation_returns_none():
    """R&D > 매출(비정상) → None (wrong<missing)."""
    stmt = _income_stmt(rd=25_000_000_000.0, revenue=20_000_000_000.0)
    with patch("services.report_generator.yf.Ticker", return_value=MagicMock(
            info={}, get_income_stmt=MagicMock(return_value=stmt))):
        result = rg._comp_valuation("MSFT", "US")
    assert result["rd_intensity"] is None


def test_comp_valuation_us_rd_intensity_missing_label_returns_none():
    stmt = _income_stmt(revenue=20_000_000_000.0)  # ResearchAndDevelopment 행 없음
    with patch("services.report_generator.yf.Ticker", return_value=MagicMock(
            info={}, get_income_stmt=MagicMock(return_value=stmt))):
        result = rg._comp_valuation("MSFT", "US")
    assert result["rd_intensity"] is None


from services.market.kr import get_rd_intensity_kr

# KR 경로는 task M3에서 재구현됨: fnlttSinglAcntAll(4대 재무제표)엔 R&D 세부 라인이
# 구조적으로 없어 구버전은 항상 None이었다 — 사업보고서 document.xml의 '연구개발비용'
# 표를 직접 파싱한다(list.json → document.xml → HTML 표). 3형 fixture로 파싱 로직만
# 단위검증(라이브 정합은 배포 후 메인 세션이 별도 확인 — fixture-pass-live-fail 가토).

_LIST_JSON_사업보고서 = {"status": "000", "list": [
    {"rcept_no": "20260101000001", "report_nm": "사업보고서 (2025.12)", "rcept_dt": "20260101"},
]}


def _mock_list_resp():
    m = MagicMock()
    m.json.return_value = _LIST_JSON_사업보고서
    return m


def test_kr_rd_intensity_000660형_ratio_row_direct():
    """000660형(SK하이닉스): '연구개발비 / 매출액 비율(%)' 행이 있으면 그 당기 값을 직접 사용."""
    html = """
    <p>연구개발비용 (단위: 백만원)</p>
    <table>
      <tr><td>과목</td><td>제77기</td><td>제76기</td><td>제75기</td><td>비고</td></tr>
      <tr><td>연구개발비용 계</td><td>2,000,000</td><td>1,800,000</td><td>1,700,000</td><td>-</td></tr>
      <tr><td>연구개발비 / 매출액 비율(%)</td><td>3.50</td><td>3.20</td><td>3.10</td><td>-</td></tr>
    </table>
    """
    with patch("os.environ.get", side_effect=lambda k, d="": "dummy-key" if k == "DART_API_KEY" else d), \
         patch("services.backlog._get_corp_code_map", return_value={"000660": "00164779"}), \
         patch("services.market.kr.requests.get", return_value=_mock_list_resp()), \
         patch("services.backlog._get_document_text", return_value=html):
        result = get_rd_intensity_kr("000660")
    assert result == 3.5


def test_kr_rd_intensity_035420형_cost_over_revenue_no_ratio_row():
    """035420형(네이버): 비율 행 없음(연결/별도 컬럼) → 연구개발비÷매출액으로 계산."""
    html = """
    <p>[연구개발비용] (단위 : 백만원)</p>
    <table>
      <tr><td>과목</td><td>연결</td><td>별도</td></tr>
      <tr><td>연구개발비</td><td>500,000</td><td>450,000</td></tr>
      <tr><td>매출액</td><td>10,000,000</td><td>9,000,000</td></tr>
    </table>
    """
    with patch("os.environ.get", side_effect=lambda k, d="": "dummy-key" if k == "DART_API_KEY" else d), \
         patch("services.backlog._get_corp_code_map", return_value={"035420": "00266961"}), \
         patch("services.market.kr.requests.get", return_value=_mock_list_resp()), \
         patch("services.backlog._get_document_text", return_value=html):
        result = get_rd_intensity_kr("035420")
    assert result == 5.0


def test_kr_rd_intensity_영업수익_비율행_실네이버구조():
    """실 035420(네이버) 사업보고서 구조: 분모 라벨이 '매출액'이 아니라 '영업수익'인
    비율 행(연결/별도 4열, leftmost=연결 당기). 1순위 비율행이 '매출액'만 매칭하던
    task#209 라이브 UAT 버그(=None) 재현·방어 — 연결 당기 17.3% 반환해야 한다."""
    html = """
    <p>연구개발비용 (단위 : 백만원, %)</p>
    <table>
      <tr><td>과 목</td><td>연결</td><td>연결</td><td>별도</td><td>별도</td></tr>
      <tr><td>과 목</td><td>제 26기</td><td>제 25기</td><td>제 26기</td><td>제 25기</td></tr>
      <tr><td>연구개발비용 계</td><td>1,857,936</td><td>1,992,636</td><td>623,045</td><td>635,717</td></tr>
      <tr><td>연구개발비/영업수익 비율(%)</td><td>17.3%</td><td>20.6%</td><td>10.1%</td><td>11.3%</td></tr>
    </table>
    """
    with patch("os.environ.get", side_effect=lambda k, d="": "dummy-key" if k == "DART_API_KEY" else d), \
         patch("services.backlog._get_corp_code_map", return_value={"035420": "00266961"}), \
         patch("services.market.kr.requests.get", return_value=_mock_list_resp()), \
         patch("services.backlog._get_document_text", return_value=html):
        result = get_rd_intensity_kr("035420")
    assert result == 17.3


def test_kr_rd_intensity_unit_caption_missing_returns_none():
    """단위 캡션 없음(계산 경로) → '안전 기본값' 폴백 없이 None(wrong<missing)."""
    html = """
    <table>
      <tr><td>과목</td><td>연결</td><td>별도</td></tr>
      <tr><td>연구개발비</td><td>500,000</td><td>450,000</td></tr>
      <tr><td>매출액</td><td>10,000,000</td><td>9,000,000</td></tr>
    </table>
    """
    with patch("os.environ.get", side_effect=lambda k, d="": "dummy-key" if k == "DART_API_KEY" else d), \
         patch("services.backlog._get_corp_code_map", return_value={"035420": "00266961"}), \
         patch("services.market.kr.requests.get", return_value=_mock_list_resp()), \
         patch("services.backlog._get_document_text", return_value=html):
        result = get_rd_intensity_kr("035420")
    assert result is None


def test_kr_rd_intensity_no_dart_key_returns_none():
    with patch("os.environ.get", side_effect=lambda k, d="": "" if k == "DART_API_KEY" else d):
        result = get_rd_intensity_kr("000660")
    assert result is None

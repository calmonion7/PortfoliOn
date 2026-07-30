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


# ── task#248: 피어 멀티플 이상치 가드(_guard_peer_multiples) ────────────────────
# 외부 소스의 단위 혼선 오값(TSM PBR 81.87 = 실제 ~4배의 20배)이 파싱을 성공해
# 경고 없이 들어온다. 판정축 = 그 행을 뺀 나머지 peer 중앙값 대비 배수가 [1/5, 5]
# 밖인지 — 절대 임계값을 추정하지 않는다(형제 _VALUE_EST_BAND, task#244와 동형).

import logging


def _peer_rows():
    """fg-ask 라이브 실측 — 005930 발행물 2026-07-29 판 `data.competitors` 5행."""
    return [
        {"ticker": "005930", "name": "삼성전자", "price": 74000, "market_cap": 4.4e14, "is_self": True,
         "per": 16.9, "pbr": 2.9, "psr": 3.14, "ev_ebitda": 9.56, "rd_intensity": 11.3},
        {"ticker": "000660", "name": "SK하이닉스", "price": 300000, "market_cap": 2.2e14, "is_self": False,
         "per": 7.8, "pbr": 3.48, "psr": 7.75, "ev_ebitda": 11.62, "rd_intensity": 6.9},
        {"ticker": "TSM", "name": "TSMC", "price": 185.06, "market_cap": 9.6e11, "is_self": False,
         "per": 34.47, "pbr": 81.87, "psr": 0.458, "ev_ebitda": 4.341, "rd_intensity": 6.47},
        {"ticker": "MU", "name": "Micron", "price": 110.0, "market_cap": 1.2e11, "is_self": False,
         "per": 20.37, "pbr": 9.20, "psr": 10.27, "ev_ebitda": 13.30, "rd_intensity": 10.16},
        {"ticker": "INTC", "name": "Intel", "price": 22.0, "market_cap": 9.5e10, "is_self": False,
         "per": None, "pbr": 3.89, "psr": 7.63, "ev_ebitda": 28.01, "rd_intensity": 26.06},
    ]


def test_guard_peer_multiples_nulls_only_tsm_pbr_and_psr():
    """실측 5행: TSM pbr(21.0×)·psr(1/16.9×)만 결측, 밴드 안 지표·비판정 필드는 불변.
    대칭 밴드가 과대·과소 방향 오류를 동시에 잡고 멀쩡한 지표는 건드리지 않는다."""
    original = {r["ticker"]: dict(r) for r in _peer_rows()}
    rows = rg._guard_peer_multiples(_peer_rows())

    tsm = next(r for r in rows if r["ticker"] == "TSM")
    assert tsm["pbr"] is None
    assert tsm["psr"] is None
    assert tsm["per"] == 34.47          # 2.45× — 밴드 안
    assert tsm["ev_ebitda"] == 4.341    # 1/3.06× — 밴드 안
    # 판정 대상이 아닌 필드는 손대지 않는다
    assert tsm["rd_intensity"] == 6.47
    assert (tsm["name"], tsm["price"], tsm["market_cap"], tsm["is_self"]) == ("TSMC", 185.06, 9.6e11, False)

    # 나머지 4행은 어떤 필드도 변하지 않는다(거짓양성 0)
    for r in rows:
        if r["ticker"] != "TSM":
            assert r == original[r["ticker"]]


def test_guard_peer_multiples_never_judges_self_row():
    """자사(is_self)는 판정 대상도 중앙값 표본도 아니다 — 출처가 달라 신뢰도가 비대칭."""
    rows = _peer_rows()
    rows[0]["pbr"] = 999.0
    out = rg._guard_peer_multiples(rows)
    assert out[0]["pbr"] == 999.0                                       # 밴드 밖이어도 불변
    assert next(r for r in out if r["ticker"] == "TSM")["pbr"] is None   # 표본에서도 빠짐


def test_guard_peer_multiples_ignores_rd_intensity():
    """R&D 집약도는 밸류에이션 멀티플이 아니라 사업 지표 — 대상 제외."""
    rows = _peer_rows()
    rows[2]["rd_intensity"] = 999.0
    assert rg._guard_peer_multiples(rows)[2]["rd_intensity"] == 999.0


def test_guard_peer_multiples_skips_when_under_two_other_peers():
    """나머지 표본이 1개면 판정 생략 — computePeerPremiums의 `<2` 관례를 그대로 따른다."""
    rows = [
        {"ticker": "A", "is_self": True, "pbr": 3.0},
        {"ticker": "B", "is_self": False, "pbr": 100.0},
        {"ticker": "C", "is_self": False, "pbr": 1.0},
    ]
    out = rg._guard_peer_multiples(rows)
    assert [r["pbr"] for r in out] == [3.0, 100.0, 1.0]


def test_guard_peer_multiples_skips_non_positive_median():
    """중앙값이 0 이하면 배수 계산이 무의미 → 판정 생략(wrong<missing)."""
    rows = [
        {"ticker": "A", "is_self": False, "pbr": 50.0},
        {"ticker": "B", "is_self": False, "pbr": -1.0},
        {"ticker": "C", "is_self": False, "pbr": 0.0},
        {"ticker": "D", "is_self": False, "pbr": -2.0},
    ]
    out = rg._guard_peer_multiples(rows)
    assert [r["pbr"] for r in out] == [50.0, -1.0, 0.0, -2.0]


def test_guard_peer_multiples_excludes_none_from_target_and_sample():
    """None은 판정 대상도 표본도 아니다(INTC per 실측) — 표본에 남으면 정렬에서 죽는다."""
    rows = [
        {"ticker": "A", "is_self": False, "per": None},
        {"ticker": "B", "is_self": False, "per": 10.0},
        {"ticker": "C", "is_self": False, "per": 11.0},
        {"ticker": "D", "is_self": False, "per": 12.0},
        {"ticker": "E", "is_self": False, "per": 1000.0},
    ]
    out = rg._guard_peer_multiples(rows)
    assert out[0]["per"] is None
    assert [r["per"] for r in out[1:4]] == [10.0, 11.0, 12.0]
    assert out[4]["per"] is None      # 1000 / median(10,11,12)=11 → 90.9×


def test_guard_peer_multiples_even_sample_median_is_mean_of_middle_two():
    """짝수 표본 중앙값 = 중간 두 값 평균 — computePeerPremiums(reportUtils.jsx)와 같은 정의.
    표본 [2,4,10,100] → median 7.0. 34.9=4.99× 안 / 35.1=5.01× 밖으로 정의를 못박는다
    (중간 하나만 쓰면 4.0 또는 10.0이 되어 두 단언 중 하나가 반드시 깨진다)."""
    def _rows(target):
        return [
            {"ticker": "T", "is_self": False, "pbr": target},
            {"ticker": "A", "is_self": False, "pbr": 2.0},
            {"ticker": "B", "is_self": False, "pbr": 4.0},
            {"ticker": "C", "is_self": False, "pbr": 10.0},
            {"ticker": "D", "is_self": False, "pbr": 100.0},
        ]
    assert rg._guard_peer_multiples(_rows(34.9))[0]["pbr"] == 34.9
    assert rg._guard_peer_multiples(_rows(35.1))[0]["pbr"] is None


def test_guard_peer_multiples_warns_once_per_dropped_field(caplog):
    """결측 처리한 필드마다 경고 1건 — 마커는 그 파일 형제 로그와 같은 `[Valuation]`."""
    with caplog.at_level(logging.WARNING, logger="services.report_generator"):
        rg._guard_peer_multiples(_peer_rows())
    warns = [r for r in caplog.records if "피어 멀티플 이상치" in r.message]
    assert len(warns) == 2
    msgs = " | ".join(w.message for w in warns)
    assert "TSM pbr:" in msgs and "TSM psr:" in msgs
    assert all("[Valuation]" in w.message for w in warns)


def test_guard_peer_multiples_three_peers_is_over_conservative_known():
    """알려진 한계(결정 #4 leave-one-out × #5 `<2` 생략의 조합): peer가 3개면 나머지
    표본이 2개라 극단 outlier가 중앙값(중간 두 값 평균)을 끌어 정상 행까지 결측된다.
    지표가 통째 사라지면 computePeerPremiums가 그 지표를 생략하므로 wrong<missing은
    유지된다(과보수적일 뿐 틀리지 않는다). 실측 005930은 peer 4개라 해당 없음."""
    rows = [
        {"ticker": "A", "is_self": False, "pbr": 10.0},
        {"ticker": "B", "is_self": False, "pbr": 10.0},
        {"ticker": "C", "is_self": False, "pbr": 1000.0},
    ]
    assert [r["pbr"] for r in rg._guard_peer_multiples(rows)] == [None, None, None]

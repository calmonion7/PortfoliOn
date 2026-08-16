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


_ROW_TITLES = [
    "매출액", "영업이익", "당기순이익", "지배주주순이익", "비지배주주순이익",
    "영업이익률", "순이익률", "ROE", "부채비율", "당좌비율", "유보율",
    "EPS", "PER", "BPS", "PBR", "주당배당금",
]  # 실 Naver rowList 순서·title(B61, task#303)


def _naver_quarter_response(quarters):
    """quarters: [{key, revenue(억원), per, pbr, is_consensus}], 순서 무관(함수가 key desc 정렬)."""
    metas = [{"key": q["key"], "isConsensus": "Y" if q.get("is_consensus") else "N"} for q in quarters]
    rows = [{"title": t, "columns": {}} for t in _ROW_TITLES]
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


# ── task#248/#249: 피어 멀티플 이상치 가드(_guard_peer_multiples) ───────────────
# 외부 소스의 단위 혼선 오값(TSM PBR 81.87 = 실제 ~4배의 20배)이 파싱을 성공해
# 경고 없이 들어온다. 판정축 = **값이 있는 peer 전체 + 자사**(기준 표본) 중앙값 대비
# 배수가 [1/5, 5] 밖인지 — 절대 임계값을 추정하지 않는다(형제 _VALUE_EST_BAND, #244).
# task#249에서 판정축을 leave-one-out(판정 대상을 표본에서 뺌)에서 교체했다: LOO는
# 표본을 항상 1개 줄여 peer 3개에서 오값 지분이 50%가 되고, 정상 peer가 결측돼 지표
# 비교가 통째 사라졌다(005930 PBR 칩 소멸). 생략 임계도 "나머지 <2"에서 **"표본 <3"**
# 으로 옮겼다 — 표본 2개는 중앙값이 두 값 평균이라 배수가 (0,2)에만 머물러 5배 밴드가
# 원리적으로 발동할 수 없다(ADR-0030). 판정 대상에서 자사를 빼는 것은 유지.

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
    대칭 밴드가 과대·과소 방향 오류를 동시에 잡고 멀쩡한 지표는 건드리지 않는다.

    task#249 판정축 교체 후에도 결과 동일 — 자사를 표본에 넣어 pbr 표본은
    [2.9, 3.48, 81.87, 9.20, 3.89] median 3.89, psr은 median 7.63으로 #248과 같다."""
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
    """자사(is_self)는 **판정 대상이 아니다** — 값이 밴드 밖이어도 결측되지 않는다.

    자사는 비교할 동종 집단이 없어 판정이 횡단면(peer 대조)이 아니라 자기 과거값
    대조여야 하므로 메커니즘이 다르다(ADR-0030 비목표). 표본 포함은 별개 축이라
    아래 `_self_is_in_reference_sample`가 따로 단언한다."""
    rows = _peer_rows()
    rows[0]["pbr"] = 999.0
    out = rg._guard_peer_multiples(rows)
    # 표본 [999, 3.48, 81.87, 9.20, 3.89] median 9.20 → 자사는 108.6×인데도 불변
    assert out[0]["pbr"] == 999.0
    assert next(r for r in out if r["ticker"] == "TSM")["pbr"] is None   # 8.9× → 결측


def test_guard_peer_multiples_self_is_in_reference_sample():
    """자사는 **기준 표본에 포함된다** — 자사를 빼면 판정이 뒤집히는 구성으로 못박는다.

    peers {1.9, 10, 10} + 자사 2.0. 표본에 자사가 있으면 median (2.0+10)/2 = 6.0 →
    1.9는 0.317×로 보존. 자사를 빼면(구 LOO/자사제외) 표본 {10, 10} median 10.0 →
    1.9가 0.19×로 결측된다. 즉 자사 1개가 정상 peer의 생사를 갈랐다 — 라이브 005930의
    PBR 칩 소멸과 같은 메커니즘의 최소 재현."""
    rows = [
        {"ticker": "T", "is_self": False, "pbr": 1.9},
        {"ticker": "A", "is_self": False, "pbr": 10.0},
        {"ticker": "B", "is_self": False, "pbr": 10.0},
        {"ticker": "SELF", "is_self": True, "pbr": 2.0},
    ]
    out = rg._guard_peer_multiples(rows)
    assert [r["pbr"] for r in out] == [1.9, 10.0, 10.0, 2.0]

    # 대조군: 자사 행을 뺀 같은 peer 구성이면 1.9가 결측된다(표본이 얇아진 탓)
    without_self = rg._guard_peer_multiples([dict(r) for r in rows if not r["is_self"]])
    assert [r["pbr"] for r in without_self] == [None, 10.0, 10.0]


def test_guard_peer_multiples_ignores_rd_intensity():
    """R&D 집약도는 밸류에이션 멀티플이 아니라 사업 지표 — 대상 제외."""
    rows = _peer_rows()
    rows[2]["rd_intensity"] = 999.0
    assert rg._guard_peer_multiples(rows)[2]["rd_intensity"] == 999.0


def test_guard_peer_multiples_skips_when_sample_under_three():
    """기준 표본이 3개 미만이면 판정 생략 — 표본 2개는 중앙값이 두 값 평균이라 배수가
    `2v/(v+s)` = (0, 2) 구간에만 머물러 5배 밴드가 원리적으로 발동할 수 없다(ADR-0030).
    발동하는 것처럼 보이는 경우는 정상값이 오값과 짝지어져 밀려나는 역전뿐이다."""
    rows = [
        {"ticker": "A", "is_self": True, "pbr": 3.0},
        {"ticker": "B", "is_self": False, "pbr": 100.0},
    ]
    out = rg._guard_peer_multiples(rows)
    assert [r["pbr"] for r in out] == [3.0, 100.0]      # 표본 2개 → 판정 자격 없음

    # 표본이 3개가 되는 순간 판정이 시작된다(경계 확인 — 생략이 오값을 영구 면제하지 않는다)
    rows.append({"ticker": "C", "is_self": False, "pbr": 1.0})
    out = rg._guard_peer_multiples(rows)
    assert [r["pbr"] for r in out] == [3.0, None, 1.0]  # median 3.0 → 100은 33.3×


def test_guard_peer_multiples_skips_when_self_missing_leaves_two_peers():
    """자사 값이 `None`이면 표본에서 빠진다 — peer 2개만 남으면 생략으로 **역전을 막는다**.

    판정했다면 median 43.74로 정상값 3.48이 0.0796×에 결측되고 오값 84.0은 1.92×로
    살아남는다(정확히 거꾸로). 자사 `None`을 표본 크기에 세지 않는 것이 이 방어의 핵심."""
    rows = [
        {"ticker": "SELF", "is_self": True, "pbr": None},
        {"ticker": "OK", "is_self": False, "pbr": 3.48},
        {"ticker": "BAD", "is_self": False, "pbr": 84.0},
    ]
    out = rg._guard_peer_multiples(rows)
    assert [r["pbr"] for r in out] == [None, 3.48, 84.0]


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
    assert out[4]["per"] is None      # 1000 / median(10,11,12,1000)=11.5 → 87.0×


def test_guard_peer_multiples_even_sample_median_is_mean_of_middle_two():
    """짝수 표본 중앙값 = 중간 두 값 평균 — computePeerPremiums(reportUtils.jsx)와 같은 정의.

    판정 대상이 표본에 남으므로(task#249) **표본이 짝수가 되는 구성**으로 재설계했다:
    peer 5행 + 자사 1행 = 6개. target이 최솟값이라 정렬은 [target,2,4,10,30,200]이고
    중간 두 값은 4·10 → median 7.0, 밴드 하단 1.4. 1.41=0.2014× 안 / 1.39=0.1986× 밖.
    중간 하나만 쓰는 구현이면 median이 4.0(→둘 다 보존) 또는 10.0(→둘 다 결측)이 되어
    두 단언 중 하나가 반드시 깨진다."""
    def _rows(target):
        return [
            {"ticker": "T", "is_self": False, "pbr": target},
            {"ticker": "A", "is_self": False, "pbr": 2.0},
            {"ticker": "B", "is_self": False, "pbr": 4.0},
            {"ticker": "C", "is_self": False, "pbr": 10.0},
            {"ticker": "D", "is_self": False, "pbr": 30.0},
            {"ticker": "SELF", "is_self": True, "pbr": 200.0},
        ]
    assert rg._guard_peer_multiples(_rows(1.41))[0]["pbr"] == 1.41
    assert rg._guard_peer_multiples(_rows(1.39))[0]["pbr"] is None
    # 다른 peer는 어느 쪽에서도 건드려지지 않는다(경계 테스트가 거짓양성을 숨기지 않도록)
    assert [r["pbr"] for r in rg._guard_peer_multiples(_rows(1.39))[1:]] == [2.0, 4.0, 10.0, 30.0, 200.0]


def test_guard_peer_multiples_warns_once_per_dropped_field(caplog):
    """결측 처리한 필드마다 경고 1건 — 마커는 그 파일 형제 로그와 같은 `[Valuation]`."""
    with caplog.at_level(logging.WARNING, logger="services.report_generator"):
        rg._guard_peer_multiples(_peer_rows())
    warns = [r for r in caplog.records if "피어 멀티플 이상치" in r.message]
    assert len(warns) == 2
    msgs = " | ".join(w.message for w in warns)
    assert "TSM pbr:" in msgs and "TSM psr:" in msgs
    assert all("[Valuation]" in w.message for w in warns)


def test_guard_peer_multiples_three_peers_drops_only_the_outlier():
    """**task#249가 뒤집은 회귀**: peer 3개에서 오값만 결측되고 정상 2행은 보존된다.

    구 판정축(leave-one-out)에서는 나머지 표본이 2개라 오값 지분이 50%가 되어 중앙값이
    끌려가 3행 전멸(`[None, None, None]`)이었다 — 지표가 통째 사라져 화면의 비교가
    없어졌다(005930 PBR 칩 소멸). 이 반전이 작업의 목적이므로 값으로 못박는다."""
    rows = [
        {"ticker": "A", "is_self": False, "pbr": 10.0},
        {"ticker": "B", "is_self": False, "pbr": 10.0},
        {"ticker": "C", "is_self": False, "pbr": 1000.0},
    ]
    assert [r["pbr"] for r in rg._guard_peer_multiples(rows)] == [10.0, 10.0, None]


# ── task#249 스트레스 4케이스 (자사 PBR 2.88, ADR-0030 측정표) ──────────────────
# `오값 잔존`=화면에 틀린 값(wrong) · `거짓양성`=정상값 결측(missing). 결측 **집합**을
# 정확히 단언해 두 실패 방향을 동시에 잡는다(한쪽만 보면 반대쪽을 놓친다).

def _stress_rows(peer_pbrs, self_pbr=2.88):
    rows = [{"ticker": "SELF", "is_self": True, "pbr": self_pbr}]
    rows += [{"ticker": f"P{i}", "is_self": False, "pbr": v} for i, v in enumerate(peer_pbrs)]
    return rows


def _dropped(rows):
    """가드 후 결측된 peer 티커 집합."""
    out = rg._guard_peer_multiples(rows)
    return {r["ticker"] for r in out if not r["is_self"] and r["pbr"] is None}


def test_guard_peer_multiples_stress_peer3_one_bad():
    """라이브 케이스(005930): peer 3개·오값 1개 → 오값만 결측, 정상 2개 보존.
    표본 {2.88, 3.48, 84.11, 9.80} median 6.64 → 3.48=0.52× 보존 · 84.11=12.66× 결측
    · 9.80=1.48× 보존. 구 판정축은 여기서 3.48을 결측시켰다(거짓양성)."""
    assert _dropped(_stress_rows([3.48, 84.11, 9.80])) == {"P1"}


def test_guard_peer_multiples_stress_peer4_two_bad():
    """peer 4개·오값 2개 → 오값 2개만 결측. 표본 {2.88, 3.48, 3.89, 84, 86} median 3.89
    → 84=21.6× · 86=22.1× 결측, 정상 2개 보존. 구 판정축은 4행 전멸이었다."""
    assert _dropped(_stress_rows([3.48, 3.89, 84.0, 86.0])) == {"P2", "P3"}


def test_guard_peer_multiples_stress_peer2_one_bad():
    """peer 2개·오값 1개 → 오값만 결측. 표본 {2.88, 3.48, 84} 3개로 **판정이 가능해진다**
    (median 3.48 → 84가 24.1×). 구 판정축은 나머지 표본 1개로 생략해 오값이 화면에
    남았다 — `wrong<missing` 위반 구멍이었고 이 변경이 함께 닫는다(ADR-0030 부수 발견)."""
    assert _dropped(_stress_rows([3.48, 84.0])) == {"P1"}


def test_guard_peer_multiples_stress_peer4_no_bad():
    """평시(오값 0) → 거짓양성 0. 표본 {2.88, 3.48, 3.89, 9.80, 12.4} median 3.89 →
    최대 배수가 12.4/3.89 = 3.19×로 밴드 안. 가드가 정상 표본을 갉아먹지 않는다."""
    assert _dropped(_stress_rows([3.48, 3.89, 9.80, 12.4])) == set()


# ── 자사 멀티플 시계열 이탈 관측(task#258) — 감지만, 값 무변경 ──────────────

def test_self_outliers_band_out_detected():
    """밴드 밖(10×) → 1건 수집. 과거중앙값·배율이 함께 반환된다."""
    self_row = {"per": 100.0, "pbr": 2.9, "psr": None, "ev_ebitda": None}
    hist = {"per": [10.0, 10.0, 10.0], "pbr": [2.8, 2.9, 3.0]}
    out = rg._self_multiple_outliers(self_row, hist)
    assert len(out) == 1
    metric, value, median, ratio = out[0]
    assert (metric, value, median) == ("per", 100.0, 10.0)
    assert ratio == pytest.approx(10.0)


def test_self_outliers_band_in_zero():
    """밴드 안(최대 5배 이내) → 0건. 과소 방향(1/5 이상)도 안."""
    self_row = {"per": 45.0, "pbr": 0.7, "psr": 3.0, "ev_ebitda": 10.0}
    hist = {"per": [10.0, 11.0, 12.0], "pbr": [3.0, 3.2, 3.4],
            "psr": [3.0, 3.0, 3.0], "ev_ebitda": [9.0, 10.0, 11.0]}
    assert rg._self_multiple_outliers(self_row, hist) == []


def test_self_outliers_skips_under_3_history():
    """유효 과거값 2개 → 판정 생략(peer 가드와 동형 산수)."""
    self_row = {"per": 100.0, "pbr": None, "psr": None, "ev_ebitda": None}
    assert rg._self_multiple_outliers(self_row, {"per": [10.0, 10.0]}) == []


def test_self_outliers_excludes_none_then_judges():
    """과거값에 None 섞임 → 제외 후 유효 3개로 판정."""
    self_row = {"per": 100.0, "pbr": None, "psr": None, "ev_ebitda": None}
    out = rg._self_multiple_outliers(self_row, {"per": [None, 10.0, 10.0, 10.0]})
    assert [o[0] for o in out] == ["per"]


def test_self_outliers_skips_nonpositive_median():
    """중앙값 ≤ 0 → 판정 생략(적자 EPS 시계열 등)."""
    self_row = {"per": 100.0, "pbr": None, "psr": None, "ev_ebitda": None}
    assert rg._self_multiple_outliers(self_row, {"per": [-5.0, -5.0, -5.0]}) == []


def test_self_outliers_never_mutates_inputs():
    """감지 함수는 입력 dict를 수정하지 않는다 — 처방이 아님을 구조로 못박는다."""
    self_row = {"per": 100.0, "pbr": 2.9, "psr": 0.1, "ev_ebitda": 300.0}
    hist = {"per": [10.0, 10.0, 10.0], "pbr": [2.8, 2.9, 3.0],
            "psr": [3.0, 3.1, 3.2], "ev_ebitda": [9.0, 10.0, 11.0]}
    row_before, hist_before = dict(self_row), {k: list(v) for k, v in hist.items()}
    out = rg._self_multiple_outliers(self_row, hist)
    assert len(out) == 3          # per 10×·psr 1/30×·ev_ebitda 30× 이탈, pbr 안
    assert self_row == row_before
    assert hist == hist_before

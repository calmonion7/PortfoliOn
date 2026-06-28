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

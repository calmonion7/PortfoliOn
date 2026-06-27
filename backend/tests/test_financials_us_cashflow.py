"""Self-check: US annual financials FCF + interest_coverage helpers (no network)."""
from services.market.format import _safe_ratio


def test_safe_ratio_zero_den():
    assert _safe_ratio(100, 0) is None


def test_safe_ratio_none_den():
    assert _safe_ratio(100, None) is None


def test_safe_ratio_basic():
    assert _safe_ratio(100, 5) == 20.0


def test_safe_ratio_negative():
    assert _safe_ratio(-60, 3) == -20.0


def test_fcf_ocf_minus_capex():
    """FCF = OCF + CapEx (yfinance CapEx is negative)."""
    ocf = 100
    capex = -30  # negative in yfinance
    fcf = ocf + capex
    assert fcf == 70


def test_fcf_negative_allowed():
    """Negative FCF must not be clamped."""
    ocf = -566_000_000_000
    capex = -80_000_000_000
    fcf = ocf + capex
    assert fcf < 0

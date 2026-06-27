"""Pure unit tests for _safe_pct — no network calls."""
from services.market.format import _safe_pct


def test_zero_denominator():
    assert _safe_pct(1, 0) is None


def test_falsy_denominator():
    assert _safe_pct(1, None) is None


def test_zero_numerator():
    assert _safe_pct(0, 5) == 0.0


def test_normal():
    assert _safe_pct(5, 100) == 5.0


def test_inf_numerator():
    assert _safe_pct(float("inf"), 1) is None


def test_negative():
    assert _safe_pct(-5, 100) == -5.0

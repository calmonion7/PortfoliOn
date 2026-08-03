from decimal import Decimal

from services.utils import sanitize


def test_sanitize_decimal_nan_becomes_none():
    assert sanitize(Decimal("NaN")) is None


def test_sanitize_decimal_infinity_becomes_none():
    assert sanitize(Decimal("Infinity")) is None


def test_sanitize_decimal_negative_infinity_becomes_none():
    assert sanitize(Decimal("-Infinity")) is None


def test_sanitize_nested_decimal_nan_becomes_none():
    result = sanitize({"a": [Decimal("NaN"), {"b": Decimal("Infinity")}]})
    assert result == {"a": [None, {"b": None}]}


def test_sanitize_normal_decimal_preserved_as_decimal_not_float():
    result = sanitize(Decimal("12.5"))
    assert result == Decimal("12.5")
    assert type(result) is Decimal

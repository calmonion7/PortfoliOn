"""kospi_futures.py 단위테스트 — dormant/조립/실패시 last-good 폴백/빈값 미영속(ADR-0022)."""
from unittest.mock import patch
from services.market_indicators.kospi_futures import get_kospi_futures

_FRONT = {
    "code": "A01609", "contract_name": "F 202609", "price": 1247.50,
    "change_pct": -4.33, "basis": 5.41, "last_tr_date": "20260910",
}
_HISTORY = [{"date": "2026-07-06", "close": 1303.95}, {"date": "2026-07-07", "close": 1247.50}]

_MODULE = "services.market_indicators.kospi_futures"


def test_dormant_when_kis_not_configured():
    with patch(f"{_MODULE}.client.configured", return_value=False):
        result = get_kospi_futures()
    assert result == {"current": None, "history": []}


def test_assembles_shape_on_success():
    with (
        patch(f"{_MODULE}.client.configured", return_value=True),
        patch(f"{_MODULE}._get_cache", return_value=None),
        patch(f"{_MODULE}.kis_futures.get_front_month", return_value=_FRONT),
        patch(f"{_MODULE}.kis_futures.fetch_daily", return_value=_HISTORY),
        patch(f"{_MODULE}._mc_save"),
        patch(f"{_MODULE}._set_cache"),
    ):
        result = get_kospi_futures()

    assert result["current"] == {
        "price": 1247.50, "change_pct": -4.33, "basis": 5.41,
        "contract": "F 202609", "last_tr_date": "20260910",
    }
    assert result["history"] == _HISTORY


def test_fetch_failure_falls_back_to_last_good():
    stored_data = {"current": {"price": 1200.0}, "history": _HISTORY}
    with (
        patch(f"{_MODULE}.client.configured", return_value=True),
        patch(f"{_MODULE}._get_cache", return_value=None),
        patch(f"{_MODULE}.kis_futures.get_front_month", side_effect=Exception("KIS down")),
        patch(f"{_MODULE}._mc_load", return_value={"data": stored_data}),
        patch(f"{_MODULE}._set_cache"),
    ):
        result = get_kospi_futures()
    assert result == stored_data


def test_fetch_failure_no_stored_returns_empty():
    with (
        patch(f"{_MODULE}.client.configured", return_value=True),
        patch(f"{_MODULE}._get_cache", return_value=None),
        patch(f"{_MODULE}.kis_futures.get_front_month", side_effect=Exception("KIS down")),
        patch(f"{_MODULE}._mc_load", return_value=None),
    ):
        result = get_kospi_futures()
    assert result == {"current": None, "history": []}


def test_empty_result_not_persisted():
    """fetch가 예외 없이도 사용 불가 값(front_month 실패 전파)이면 _mc_save 호출 안 됨."""
    with (
        patch(f"{_MODULE}.client.configured", return_value=True),
        patch(f"{_MODULE}._get_cache", return_value=None),
        patch(f"{_MODULE}.kis_futures.get_front_month", side_effect=Exception("KIS down")),
        patch(f"{_MODULE}._mc_load", return_value=None),
        patch(f"{_MODULE}._mc_save") as mc_save,
    ):
        get_kospi_futures()
    mc_save.assert_not_called()


def test_nan_inf_sanitized():
    front_with_nan = {**_FRONT, "basis": float("nan"), "change_pct": float("inf")}
    with (
        patch(f"{_MODULE}.client.configured", return_value=True),
        patch(f"{_MODULE}._get_cache", return_value=None),
        patch(f"{_MODULE}.kis_futures.get_front_month", return_value=front_with_nan),
        patch(f"{_MODULE}.kis_futures.fetch_daily", return_value=_HISTORY),
        patch(f"{_MODULE}._mc_save"),
        patch(f"{_MODULE}._set_cache"),
    ):
        result = get_kospi_futures()
    assert result["current"]["basis"] is None
    assert result["current"]["change_pct"] is None

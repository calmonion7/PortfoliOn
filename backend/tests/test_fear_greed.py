"""Unit tests for sentiment.py (CNN Fear & Greed) — no network calls."""
import math
from unittest.mock import patch, MagicMock

_CNN_JSON = {
    "fear_and_greed": {
        "score": 44.846,
        "rating": "fear",
        "timestamp": "2026-07-05T12:00:00+00:00",
        "previous_close": 45.02,
        "previous_1_week": 50.13,
        "previous_1_month": 60.44,
    },
    "fear_and_greed_historical": {
        "data": [
            {"x": 1751673600000, "y": 52.3},
            {"x": 1751760000000, "y": 44.846},
        ]
    },
}


def _mock_response(payload):
    resp = MagicMock()
    resp.json.return_value = payload
    resp.raise_for_status.return_value = None
    return resp


# --- (a) fetch parsing ---

def test_fetch_fear_greed_parses_score_rating_history():
    from services.market_indicators.sentiment import _fetch_fear_greed

    with patch("services.market_indicators.sentiment.requests.get", return_value=_mock_response(_CNN_JSON)):
        data = _fetch_fear_greed()

    assert data["score"] == 44.85
    assert data["rating"] == "fear"
    assert data["previous_close"] == 45.02
    assert data["previous_1_week"] == 50.13
    assert data["previous_1_month"] == 60.44
    assert len(data["history"]) == 2
    assert data["history"][0] == {"date": "2025-07-05", "value": 52.3}


def test_fetch_fear_greed_score_nan_guarded():
    from services.market_indicators.sentiment import _fetch_fear_greed

    bad = {**_CNN_JSON, "fear_and_greed": {**_CNN_JSON["fear_and_greed"], "score": float("nan")}}
    with patch("services.market_indicators.sentiment.requests.get", return_value=_mock_response(bad)):
        assert _fetch_fear_greed() is None


def test_fetch_fear_greed_request_exception_returns_none():
    from services.market_indicators.sentiment import _fetch_fear_greed

    with patch("services.market_indicators.sentiment.requests.get", side_effect=Exception("418 teapot")):
        assert _fetch_fear_greed() is None


# --- (b) get_fear_greed graceful fallback ---

def test_get_fear_greed_uses_memory_cache():
    from services.market_indicators.sentiment import get_fear_greed
    from services.market_indicators.cache import _set_cache, _cache

    _set_cache("fear_greed", {"score": 1.0}, ttl=60)
    with patch("services.market_indicators.sentiment._fetch_fear_greed") as mock_fetch:
        result = get_fear_greed()
    assert result == {"score": 1.0}
    mock_fetch.assert_not_called()
    _cache.pop("fear_greed", None)


def test_get_fear_greed_fetch_success_saves_and_returns():
    from services.market_indicators.sentiment import get_fear_greed
    from services.market_indicators.cache import _cache

    _cache.pop("fear_greed", None)
    fresh = {"score": 70.0, "rating": "greed", "history": []}
    with (
        patch("services.market_indicators.sentiment._get_cache", return_value=None),
        patch("services.market_indicators.sentiment._fetch_fear_greed", return_value=fresh),
        patch("services.market_indicators.sentiment._mc_save") as mock_save,
        patch("services.market_indicators.sentiment._set_cache") as mock_set,
    ):
        result = get_fear_greed()

    assert result["score"] == 70.0
    mock_save.assert_called_once_with("fear_greed", fresh)
    mock_set.assert_called_once_with("fear_greed", fresh, ttl=3600)


def test_get_fear_greed_fetch_failure_falls_back_to_stored():
    from services.market_indicators.sentiment import get_fear_greed

    stored_data = {"score": 30.0, "rating": "fear", "history": []}
    with (
        patch("services.market_indicators.sentiment._get_cache", return_value=None),
        patch("services.market_indicators.sentiment._fetch_fear_greed", return_value=None),
        patch("services.market_indicators.sentiment._mc_load", return_value={"data": stored_data}),
        patch("services.market_indicators.sentiment._set_cache") as mock_set,
    ):
        result = get_fear_greed()

    assert result == stored_data
    mock_set.assert_called_once_with("fear_greed", stored_data, ttl=3600)


def test_get_fear_greed_fetch_failure_no_stored_returns_none():
    from services.market_indicators.sentiment import get_fear_greed

    with (
        patch("services.market_indicators.sentiment._get_cache", return_value=None),
        patch("services.market_indicators.sentiment._fetch_fear_greed", return_value=None),
        patch("services.market_indicators.sentiment._mc_load", return_value=None),
    ):
        result = get_fear_greed()

    assert result is None

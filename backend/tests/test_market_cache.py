from unittest.mock import patch


def test_get_or_refresh_uses_memory_cache():
    from services.market_indicators.cache import _cache, _set_cache, get_or_refresh
    _set_cache("_test_key", {"v": 1}, ttl=60)
    fetch_called = []
    def fetch():
        fetch_called.append(1)
        return {"v": 2}
    result = get_or_refresh("_test_key", fetch, ttl=60)
    assert result == {"v": 1}
    assert not fetch_called
    _cache.pop("_test_key", None)


def test_get_or_refresh_calls_fetch_when_no_cache():
    from services.market_indicators.cache import _cache, get_or_refresh
    _cache.pop("_test_missing", None)
    with patch("services.market_indicators.cache._mc_load", return_value=None):
        result = get_or_refresh("_test_missing", lambda: {"v": 42}, ttl=60)
    assert result == {"v": 42}


def test_clear_cache_removes_both():
    from services.market_indicators.cache import _cache, _set_cache, clear_cache
    _set_cache("_test_clear", {"x": 1}, ttl=60)
    assert "_test_clear" in _cache
    with patch("services.market_indicators.cache._mc_delete") as mock_del:
        clear_cache("_test_clear")
        mock_del.assert_called_once_with("_test_clear")
    assert "_test_clear" not in _cache

"""S4 — invalidate_portfolio_caches()가 live_prices 캐시도 무효화하는지 검증."""
from unittest.mock import patch
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import services.cache as cache


def _seed_live_prices():
    """user_id 'u1'로 live prices 캐시에 값을 심는다."""
    cache.get_live_prices("u1", lambda: {"AAPL": 100.0})
    assert cache._live_prices_cache._store.get("u1") is not None, "사전조건: 캐시가 채워져야 함"


def test_invalidate_portfolio_caches_clears_live_prices():
    """종목 mutation 후 live prices 캐시가 비어야 한다."""
    _seed_live_prices()

    with patch("routers.calendar.clear_cache"):
        cache.invalidate_portfolio_caches()

    assert cache._live_prices_cache._store == {}, "live_prices 캐시가 비어야 함"

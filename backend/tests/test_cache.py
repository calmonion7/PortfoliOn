import time
from unittest.mock import patch
import pytest


def _clear():
    import services.cache as c
    c._snapshots.clear()
    c.invalidate_list()
    c.invalidate_dashboard()
    c.invalidate_correlation()


def test_get_snapshot_calls_loader_once():
    import services.cache as c
    _clear()
    calls = []
    def loader():
        calls.append(1)
        return {"ticker": "AAPL"}
    r1 = c.get_snapshot("AAPL", "2026-05-20", loader)
    r2 = c.get_snapshot("AAPL", "2026-05-20", loader)
    assert len(calls) == 1
    assert r1 == r2 == {"ticker": "AAPL"}


def test_get_snapshot_different_dates_separate():
    import services.cache as c
    _clear()
    c.get_snapshot("AAPL", "2026-05-19", lambda: {"date": "19"})
    calls = []
    c.get_snapshot("AAPL", "2026-05-20", lambda: (calls.append(1), {"date": "20"})[1])
    assert len(calls) == 1


def test_invalidate_clears_ticker_entries():
    import services.cache as c
    _clear()
    c.get_snapshot("AAPL", "2026-05-20", lambda: {"v": 1})
    c.get_snapshot("AAPL", "2026-05-19", lambda: {"v": 2})
    c.get_snapshot("TSLA", "2026-05-20", lambda: {"v": 3})
    c.invalidate("AAPL")
    calls = []
    c.get_snapshot("AAPL", "2026-05-20", lambda: (calls.append(1), {"v": 99})[1])
    assert len(calls) == 1  # AAPL was evicted
    tsla_calls = []
    c.get_snapshot("TSLA", "2026-05-20", lambda: (tsla_calls.append(1), {})[1])
    assert len(tsla_calls) == 0  # TSLA cache intact


def test_lru_evicts_oldest_when_full():
    import services.cache as c
    _clear()
    original_max = c._MAX
    c._MAX = 3
    try:
        c.get_snapshot("A", "d1", lambda: {"v": "A"})
        c.get_snapshot("B", "d1", lambda: {"v": "B"})
        c.get_snapshot("C", "d1", lambda: {"v": "C"})
        c.get_snapshot("D", "d1", lambda: {"v": "D"})  # evicts A
        assert "A/d1" not in c._snapshots
        assert "D/d1" in c._snapshots
    finally:
        c._MAX = original_max


def test_get_list_caches_within_ttl():
    import services.cache as c
    _clear()
    calls = []
    def loader():
        calls.append(1)
        return {"data": "list"}
    c.get_list("u1", loader)
    c.get_list("u1", loader)
    assert len(calls) == 1


def test_get_list_refreshes_after_ttl(monkeypatch):
    import services.cache as c
    _clear()
    calls = []
    def loader():
        calls.append(1)
        return {"data": "list"}
    c.get_list("u1", loader)
    # ts를 0으로 만들어 TTL 만료 시뮬레이션
    c._list_cache._store["u1"] = (c._list_cache._store["u1"][0], 0.0)
    c.get_list("u1", loader)
    assert len(calls) == 2


def test_invalidate_list_resets_cache():
    import services.cache as c
    _clear()
    calls = []
    c.get_list("u1", lambda: (calls.append(1), {})[1])
    c.invalidate_list()
    c.get_list("u1", lambda: (calls.append(1), {})[1])
    assert len(calls) == 2


def test_get_snapshot_none_loader_not_cached():
    import services.cache as c
    _clear()
    calls = []
    def loader():
        calls.append(1)
        return None
    r1 = c.get_snapshot("MISS", "2026-05-20", loader)
    r2 = c.get_snapshot("MISS", "2026-05-20", loader)
    assert r1 is None
    assert len(calls) == 2  # None is not cached


def test_invalidate_normalizes_ticker_case():
    import services.cache as c
    _clear()
    c.get_snapshot("aapl", "2026-05-20", lambda: {"v": 1})
    c.invalidate("AAPL")  # uppercase invalidate should clear lowercase-inserted entry
    calls = []
    c.get_snapshot("aapl", "2026-05-20", lambda: (calls.append(1), {"v": 99})[1])
    assert len(calls) == 1  # was evicted


def test_get_correlation_caches_result():
    import services.cache as c
    _clear()
    calls = []
    def loader():
        calls.append(1)
        return {"tickers": ["AAPL"], "matrix": [[1.0]]}
    c.get_correlation("test-user", loader)
    c.get_correlation("test-user", loader)
    assert len(calls) == 1


def test_invalidate_correlation_clears_cache():
    import services.cache as c
    _clear()
    calls = []
    c.get_correlation("test-user", lambda: (calls.append(1), {"tickers": [], "matrix": []})[1])
    c.invalidate_correlation()
    c.get_correlation("test-user", lambda: (calls.append(1), {"tickers": [], "matrix": []})[1])
    assert len(calls) == 2


def test_invalidate_also_clears_correlation():
    import services.cache as c
    _clear()
    calls = []
    c.get_correlation("test-user", lambda: (calls.append(1), {"tickers": [], "matrix": []})[1])
    c.invalidate("AAPL")
    c.get_correlation("test-user", lambda: (calls.append(1), {"tickers": [], "matrix": []})[1])
    assert len(calls) == 2


def test_invalidate_portfolio_caches_clears_list():
    # 종목 변이(추가/삭제/편집·승격·관심) 후 리포트 목록이 stale로 남지 않아야 한다 (task#105)
    import services.cache as c
    _clear()
    calls = []
    c.get_list("u1", lambda: (calls.append(1), {})[1])
    with patch("routers.calendar.clear_cache"):  # 라이브 calendar_cache DB DELETE 차단
        c.invalidate_portfolio_caches()
    c.get_list("u1", lambda: (calls.append(1), {})[1])
    assert len(calls) == 2


# ── 장중 라이브 시세 캐시 (Phase 3 part 1, S1) ──

def test_live_prices_cache_hits_within_ttl_then_invalidates():
    from services import cache as c
    calls = {"n": 0}
    def loader():
        calls["n"] += 1
        return {"005930": {"current_price": 322500, "change_pct": 1.2}}
    c.invalidate_live_prices()
    r1 = c.get_live_prices("user-A", loader)
    r2 = c.get_live_prices("user-A", loader)   # TTL 내 → 캐시 히트(loader 재호출 X)
    assert calls["n"] == 1 and r1 == r2
    # 다른 유저는 별도 키
    c.get_live_prices("user-B", loader)
    assert calls["n"] == 2
    # 무효화 후 재호출
    c.invalidate_live_prices("user-A")
    c.get_live_prices("user-A", loader)
    assert calls["n"] == 3


def test_stock_mutation_invalidates_live_prices():
    from services import cache as c
    calls = {"n": 0}
    loader = lambda: (calls.__setitem__("n", calls["n"] + 1) or {"x": 1})
    c.invalidate_live_prices()
    c.get_live_prices("user-A", loader)
    c.invalidate("005930")   # 종목 변경 → 라이브 캐시도 무효화
    c.get_live_prices("user-A", loader)
    assert calls["n"] == 2


# ── rebalance/exposure 요청경로 캐시 (S3) — get_sector/get_macro와 동일 패턴 ──

def test_get_rebalance_caches_within_ttl():
    import services.cache as c
    calls = []
    def loader():
        calls.append(1)
        return {"data": "rebalance"}
    c.invalidate_rebalance("rebal-user")
    c.get_rebalance("rebal-user", loader)
    c.get_rebalance("rebal-user", loader)
    assert len(calls) == 1


def test_invalidate_rebalance_clears_cache():
    import services.cache as c
    calls = []
    c.get_rebalance("rebal-user-2", lambda: (calls.append(1), {})[1])
    c.invalidate_rebalance("rebal-user-2")
    c.get_rebalance("rebal-user-2", lambda: (calls.append(1), {})[1])
    assert len(calls) == 2


def test_get_exposure_caches_within_ttl():
    import services.cache as c
    calls = []
    def loader():
        calls.append(1)
        return {"data": "exposure"}
    c.invalidate_exposure("expo-user")
    c.get_exposure("expo-user", loader)
    c.get_exposure("expo-user", loader)
    assert len(calls) == 1


def test_invalidate_exposure_clears_cache():
    import services.cache as c
    calls = []
    c.get_exposure("expo-user-2", lambda: (calls.append(1), {})[1])
    c.invalidate_exposure("expo-user-2")
    c.get_exposure("expo-user-2", lambda: (calls.append(1), {})[1])
    assert len(calls) == 2


def test_invalidate_portfolio_caches_also_clears_rebalance_and_exposure():
    import services.cache as c
    calls = []
    c.get_rebalance("port-user", lambda: (calls.append(1), {})[1])
    c.get_exposure("port-user", lambda: (calls.append(1), {})[1])
    with patch("routers.calendar.clear_cache"):  # 라이브 calendar_cache DB DELETE 차단
        c.invalidate_portfolio_caches()
    c.get_rebalance("port-user", lambda: (calls.append(1), {})[1])
    c.get_exposure("port-user", lambda: (calls.append(1), {})[1])
    assert len(calls) == 4

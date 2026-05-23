import time
import pytest


def _clear():
    import services.cache as c
    c._snapshots.clear()
    c.invalidate_list()
    c.invalidate_dashboard()


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
    c.get_list(loader)
    c.get_list(loader)
    assert len(calls) == 1


def test_get_list_refreshes_after_ttl(monkeypatch):
    import services.cache as c
    _clear()
    calls = []
    def loader():
        calls.append(1)
        return {"data": "list"}
    c.get_list(loader)
    # ts를 0으로 만들어 TTL 만료 시뮬레이션
    c._list_cache._ts = 0.0
    c.get_list(loader)
    assert len(calls) == 2


def test_invalidate_list_resets_cache():
    import services.cache as c
    _clear()
    calls = []
    c.get_list(lambda: (calls.append(1), {})[1])
    c.invalidate_list()
    c.get_list(lambda: (calls.append(1), {})[1])
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

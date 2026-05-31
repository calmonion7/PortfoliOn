import time
from collections import OrderedDict
from typing import Optional


class TTLCache:
    def __init__(self, ttl: float, maxsize: int = 200):
        self._ttl = ttl
        self._maxsize = maxsize
        self._store: dict = {}  # key -> (data, timestamp)

    def get(self, key: str, loader):
        now = time.time()
        if key in self._store:
            data, ts = self._store[key]
            if now - ts < self._ttl:
                return data
        # 만료 항목 정리 (maxsize 초과 시)
        if len(self._store) >= self._maxsize:
            self._store = {k: v for k, v in self._store.items() if now - v[1] < self._ttl}
        data = loader()
        self._store[key] = (data, now)
        return data

    def invalidate(self, key: str = None):
        if key is None:
            self._store.clear()
        else:
            self._store.pop(key, None)


_snapshots: OrderedDict[str, dict] = OrderedDict()
_list_cache = TTLCache(60.0)
_dashboard_cache = TTLCache(300.0)
_correlation_cache = TTLCache(300.0)
_MAX = 50


def get_snapshot(ticker: str, date: str, loader) -> Optional[dict]:
    key = f"{ticker.upper()}/{date}"
    if key in _snapshots:
        _snapshots.move_to_end(key)
        return _snapshots[key]
    data = loader()
    if data is not None:
        if len(_snapshots) >= _MAX:
            _snapshots.popitem(last=False)
        _snapshots[key] = data
    return data


def invalidate(ticker: str) -> None:
    prefix = f"{ticker.upper()}/"
    for k in [k for k in _snapshots if k.startswith(prefix)]:
        del _snapshots[k]
    invalidate_list()
    invalidate_dashboard()  # clear all users' dashboards
    invalidate_correlation()
    invalidate_sector()
    invalidate_macro()


def invalidate_dashboard(user_id: str = None) -> None:
    _dashboard_cache.invalidate(user_id)


def get_dashboard(user_id: str, loader) -> list:
    return _dashboard_cache.get(user_id, loader)


def invalidate_correlation(user_id: str = None) -> None:
    _correlation_cache.invalidate(user_id)


def get_correlation(user_id: str, loader) -> dict:
    return _correlation_cache.get(user_id, loader)


def invalidate_list() -> None:
    _list_cache.invalidate()


def get_list(loader) -> dict:
    return _list_cache.get("__global__", loader)


_sector_cache = TTLCache(300.0)
_macro_cache = TTLCache(300.0)


def get_sector(user_id: str, loader) -> dict:
    return _sector_cache.get(user_id, loader)


def get_macro(user_id: str, loader) -> dict:
    return _macro_cache.get(user_id, loader)


def invalidate_sector(user_id: str = None) -> None:
    _sector_cache.invalidate(user_id)


def invalidate_macro(user_id: str = None) -> None:
    _macro_cache.invalidate(user_id)


def invalidate_portfolio_caches() -> None:
    from routers import calendar as calendar_router
    calendar_router.clear_cache()
    invalidate_dashboard()
    invalidate_sector()
    invalidate_macro()
    invalidate_correlation()

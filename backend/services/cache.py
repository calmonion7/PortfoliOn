import time
from collections import OrderedDict
from typing import Optional


class TTLCache:
    def __init__(self, ttl: float):
        self._ttl = ttl
        self._data = None
        self._ts = 0.0

    def get(self, loader):
        now = time.time()
        if self._data is not None and now - self._ts < self._ttl:
            return self._data
        self._data = loader()
        self._ts = now
        return self._data

    def invalidate(self):
        self._data = None
        self._ts = 0.0


_snapshots: OrderedDict[str, dict] = OrderedDict()
_list_cache = TTLCache(5.0)
_dashboard_cache = TTLCache(300.0)
_correlation_cache = TTLCache(300.0)
_MAX = 200


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
    invalidate_dashboard()
    invalidate_correlation()
    invalidate_sector()
    invalidate_macro()


def invalidate_dashboard() -> None:
    _dashboard_cache.invalidate()


def get_dashboard(loader) -> list:
    return _dashboard_cache.get(loader)


def invalidate_correlation() -> None:
    _correlation_cache.invalidate()


def get_correlation(loader) -> dict:
    return _correlation_cache.get(loader)


def invalidate_list() -> None:
    _list_cache.invalidate()


def get_list(loader) -> dict:
    return _list_cache.get(loader)


_sector_cache = TTLCache(300.0)
_macro_cache = TTLCache(300.0)


def get_sector(loader) -> dict:
    return _sector_cache.get(loader)


def get_macro(loader) -> dict:
    return _macro_cache.get(loader)


def invalidate_sector() -> None:
    _sector_cache.invalidate()


def invalidate_macro() -> None:
    _macro_cache.invalidate()

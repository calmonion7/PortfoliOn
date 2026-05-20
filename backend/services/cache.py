import time
from collections import OrderedDict
from typing import Optional

_snapshots: OrderedDict[str, dict] = OrderedDict()
_list_cache: dict = {"data": None, "ts": 0.0}
_MAX = 200
_LIST_TTL = 5.0


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


def invalidate_list() -> None:
    _list_cache["data"] = None
    _list_cache["ts"] = 0.0


def get_list(loader) -> dict:
    now = time.time()
    if _list_cache["data"] is not None and now - _list_cache["ts"] < _LIST_TTL:
        return _list_cache["data"]
    data = loader()
    _list_cache["data"] = data
    _list_cache["ts"] = now
    return data

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
    invalidate_live_prices()  # 장중 폴링 캐시도 무효화(종목 추가/삭제 즉시 반영)


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


def get_sector(user_id: str, loader, market: str = "US") -> dict:
    # market을 캐시키에 반영해 US/KR이 같은 user_id로 충돌하지 않게 한다.
    # 종목 변경 시 invalidate_sector()(인자 없음 전체 clear)가 두 키 모두 무효화.
    return _sector_cache.get(f"{user_id}:{market}", loader)


def get_macro(user_id: str, loader) -> dict:
    return _macro_cache.get(user_id, loader)


def invalidate_sector(user_id: str = None) -> None:
    _sector_cache.invalidate(user_id)


def invalidate_macro(user_id: str = None) -> None:
    _macro_cache.invalidate(user_id)


_quote_cache = TTLCache(60.0)


def get_quote_cached(key: str, loader) -> dict:
    return _quote_cache.get(key, loader)


def invalidate_quote(key: str = None) -> None:
    _quote_cache.invalidate(key)


# 장중 자동폴링 전용: /api/portfolio/prices 결과를 user당 짧게 캐시.
# 다중 사용자·다중 탭의 15초 폴링이 단일 키움 자격증명 레이트리밋을 치지 않게 상한.
# (yf.download/ka10081 일괄은 1콜이라 KR/US 분리 TTL 없이 통합 15s로 단순화)
_live_prices_cache = TTLCache(15.0)


def get_live_prices(user_id: str, loader) -> dict:
    return _live_prices_cache.get(user_id, loader)


def invalidate_live_prices(user_id: str = None) -> None:
    _live_prices_cache.invalidate(user_id)


def invalidate_portfolio_caches() -> None:
    from routers import calendar as calendar_router
    calendar_router.clear_cache()
    invalidate_list()
    invalidate_dashboard()
    invalidate_sector()
    invalidate_macro()
    invalidate_correlation()

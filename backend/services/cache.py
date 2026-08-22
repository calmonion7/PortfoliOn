import threading
import time
from collections import OrderedDict
from typing import Optional


class TTLCache:
    """스레드 안전 TTL 캐시 (B69).

    락 규율:
    - `_lock`은 **dict 조작 구간만** 감싼다. `loader()`는 락 **밖**에서 돈다 —
      `_dashboard_cache`의 loader는 카드당 10-워커 ThreadPool을 쓰는 수 초짜리 작업이라
      락 안에 넣으면 다른 사용자의 조회와 `invalidate()`가 그만큼 막힌다.
    - 그 대가로 loader 실행 중 들어온 `invalidate()`를 **세대 카운터**로 감지해 캐시를
      건너뛴다. 무효화가 조용히 no-op이 되는 것은 stale 값을 되살리는 정합 결함이다
      (세대는 캐시 단위라, 다른 키의 무효화도 in-flight 적재를 취소한다 — 보수적인 쪽).
    - 만료 정리는 **in-place 삭제**다. 옛 구현은 `self._store = {...}`로 dict를
      **재바인딩**해서, 그 창에 실행된 `invalidate(key)`가 버려질 dict에 적용돼 유실됐다.
    - 이 락은 **다른 락을 잡은 채로 획득하지 않는다**(중첩 0 → 데드락 불가).
      `cache.invalidate(ticker)`도 `_snap_lock`을 놓은 뒤에 파생 캐시를 무효화한다.
    """

    def __init__(self, ttl: float, maxsize: int = 200):
        self._ttl = ttl
        self._maxsize = maxsize
        self._store: dict = {}  # key -> (data, timestamp)
        self._lock = threading.Lock()
        self._gen = 0  # invalidate 호출마다 증가 — loader 실행 중 무효화 감지용

    def get(self, key: str, loader):
        now = time.time()
        with self._lock:
            if key in self._store:
                data, ts = self._store[key]
                if now - ts < self._ttl:
                    return data
            # 만료 항목 정리 (maxsize 초과 시) — 재바인딩 금지, in-place 삭제
            if len(self._store) >= self._maxsize:
                for k in [k for k, v in self._store.items() if now - v[1] >= self._ttl]:
                    del self._store[k]
            gen = self._gen
        data = loader()
        with self._lock:
            if gen == self._gen:
                self._store[key] = (data, now)
        return data

    def invalidate(self, key: str = None):
        with self._lock:
            self._gen += 1
            if key is None:
                self._store.clear()
            else:
                self._store.pop(key, None)


_snapshots: OrderedDict[str, dict] = OrderedDict()
# 모듈 전역 `_snapshots`용 락·세대 (TTLCache와 같은 규율 — loader는 락 밖).
_snap_lock = threading.Lock()
_snap_gen = 0
_list_cache = TTLCache(60.0)
_dashboard_cache = TTLCache(300.0)
_correlation_cache = TTLCache(300.0)
_MAX = 50


def get_snapshot(ticker: str, date: str, loader) -> Optional[dict]:
    key = f"{ticker.upper()}/{date}"
    with _snap_lock:
        if key in _snapshots:
            _snapshots.move_to_end(key)
            return _snapshots[key]
        gen = _snap_gen
    data = loader()
    if data is not None:
        with _snap_lock:
            if gen == _snap_gen:  # 적재 중 무효화가 들어왔으면 되살리지 않는다
                if len(_snapshots) >= _MAX:
                    _snapshots.popitem(last=False)
                _snapshots[key] = data
    return data


def invalidate(ticker: str) -> None:
    global _snap_gen
    prefix = f"{ticker.upper()}/"
    with _snap_lock:
        _snap_gen += 1
        for k in [k for k in _snapshots if k.startswith(prefix)]:
            del _snapshots[k]
    # ⚠️ 파생 캐시 무효화는 `_snap_lock`을 **놓은 뒤에** 한다 — 락 중첩을 만들지 않는
    #    것이 이 파일의 데드락 불가 근거다(TTLCache 클래스 docstring 참조).
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


def get_list(user_id: str, loader) -> dict:
    return _list_cache.get(user_id, loader)


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


# S3: rebalance/exposure 요청경로 라이브 시세 반복호출 방지 (get_sector/get_macro와 동일 패턴)
_rebalance_cache = TTLCache(300.0)
_exposure_cache = TTLCache(300.0)


def get_rebalance(user_id: str, loader) -> dict:
    return _rebalance_cache.get(user_id, loader)


def invalidate_rebalance(user_id: str = None) -> None:
    _rebalance_cache.invalidate(user_id)


def get_exposure(user_id: str, loader) -> dict:
    return _exposure_cache.get(user_id, loader)


def invalidate_exposure(user_id: str = None) -> None:
    _exposure_cache.invalidate(user_id)


def invalidate_portfolio_caches(user_id: str = None) -> None:
    from routers import calendar as calendar_router
    calendar_router.clear_cache(user_id)  # S1: 라이브 저장소(calendar_cache 테이블)를 user_id로 무효화
    invalidate_list()
    invalidate_dashboard()
    invalidate_sector()
    invalidate_macro()
    invalidate_correlation()
    invalidate_live_prices()  # 장중 폴링 캐시도 무효화(종목 추가/삭제 즉시 반영)
    invalidate_rebalance()
    invalidate_exposure()

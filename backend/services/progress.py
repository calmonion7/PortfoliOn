import threading
import time
from collections import OrderedDict


def _initial_state(**extra) -> dict:
    return {"running": False, "done": 0, "total": 0, "current": "", "failed": [], **extra}


class ProgressTracker:
    # 활동 없이 이 시간을 넘긴 `running=True`는 고착으로 보고 회수한다(초).
    # 근거: `try_start`가 이중 실행을 거부하게 되면서 「이중 클릭이 진행상태를 리셋하며
    # 자기치유하던」 성질이 사라졌는데, `running`을 회수하는 경로는 `finish()` 하나뿐이고
    # **백그라운드 태스크가 실행되지 않는 경로가 실재한다** — starlette는 응답 body를
    # flush한 **뒤** `await self.background()`를 호출하므로(`starlette/responses.py`의
    # `send(...http.response.body)` 다음 줄), flush 중 클라이언트가 끊기면 `_run_generation`이
    # 시작조차 하지 않고 아무도 `finish()`를 부르지 않는다 → 그 사용자는 **프로세스 재시작
    # 전까지 영구 409**가 되고 관리자용 리셋 수단도 없다.
    # 15분: 판정 기준은 경과시간이 아니라 **무활동 시간**이다(`set`/`increment`가 활동을
    # 갱신하므로 종목 수와 무관하게 오래 걸리는 생성은 회수되지 않는다). 종목 1건의
    # `generate_report_with_retry` 최악 소요(외부 재시도 포함)보다 넉넉히 크게 잡았다.
    _STALE_AFTER = 15 * 60

    def __init__(self, **extra):
        self._lock = threading.Lock()
        self._state = _initial_state(**extra)
        # monotonic — 시스템 시계 변경(NTP·DST)에 영향받지 않는다.
        self._activity_at = time.monotonic()

    def get(self) -> dict:
        with self._lock:
            snapshot = dict(self._state)
        # failed는 리스트라 얕은 복사로는 내부와 같은 객체가 나간다 — 호출자가 직렬화하며
        # 순회하는 동안 워커의 add_failed가 append하면 torn read가 된다. 복제해서 떼어낸다.
        snapshot["failed"] = list(snapshot["failed"])
        return snapshot

    def start(self, total: int) -> None:
        with self._lock:
            self._reset_locked(total)

    def try_start(self, total: int) -> bool:
        """진행 중이면 상태를 건드리지 않고 False를 반환한다.

        start()는 무조건 리셋하므로 진행 중 재호출이 done/total을 되돌려 남은 워커의
        increment가 done > total 을 만든다(B77). 이중 실행을 거부해야 하는 호출자는 이것을 쓴다.

        단 **고착된 트래커는 회수**한다(`_STALE_AFTER` 참조) — 그러지 않으면 백그라운드가
        아예 시작되지 않은 사용자가 영구히 거부된다. 판정은 무활동 시간이므로 진행 중인
        정상 생성은 영향받지 않는다(⑷ 대조군).
        """
        with self._lock:
            if self._state["running"] and not self._is_stale_locked():
                return False
            self._reset_locked(total)
            return True

    def _is_stale_locked(self) -> bool:
        """락을 보유한 상태에서만 호출할 것."""
        return (time.monotonic() - self._activity_at) > self._STALE_AFTER

    def _reset_locked(self, total: int) -> None:
        """락을 보유한 상태에서만 호출할 것."""
        self._state.update({"running": True, "done": 0, "total": total, "current": "", "failed": []})
        self._activity_at = time.monotonic()

    def is_stuck(self) -> bool:
        """running=True인데 활동이 상한을 넘긴 상태(축출 대상 판정용)."""
        with self._lock:
            return bool(self._state["running"]) and self._is_stale_locked()

    def set(self, **kwargs) -> None:
        with self._lock:
            self._state.update(kwargs)
            self._activity_at = time.monotonic()

    def increment(self) -> None:
        with self._lock:
            self._state["done"] += 1
            self._activity_at = time.monotonic()

    def add_failed(self, ticker: str, error: str = "") -> None:
        with self._lock:
            self._state["failed"].append({"ticker": ticker, "error": error})

    def finish(self) -> None:
        with self._lock:
            self._state.update({"running": False, "current": ""})


class ProgressRegistry:
    """키(=사용자)별 ProgressTracker 보관소.

    전역 싱글턴 하나를 두면 두 사용자의 작업이 서로의 진행상태를 덮는다(B77) — 진행률이
    남의 종목을 가리키고, 겹친 두 실행의 increment가 합산돼 done > total 이 된다.

    메모리: 키가 사용자 수만큼 늘어나므로 상한(_MAX)을 두고, 초과 시 **유휴(진행 중이 아닌)**
    트래커를 오래된 것부터 버린다. 진행 중 트래커를 버리면 그 사용자의 진행률이 0으로 되돌아가
    프론트 폴링이 완료를 영원히 못 보므로 남긴다(전부 진행 중이면 상한을 잠시 넘긴다 —
    과 축출보다 안전하다). 폴링만 하는 호출자는 peek()이라 트래커를 만들지 않는다.
    """

    _MAX = 64

    def __init__(self, **extra):
        self._lock = threading.Lock()
        self._extra = extra
        self._trackers: "OrderedDict[str, ProgressTracker]" = OrderedDict()

    def for_key(self, key: str) -> ProgressTracker:
        with self._lock:
            tracker = self._trackers.get(key)
            if tracker is None:
                self._evict_locked()
                tracker = ProgressTracker(**self._extra)
                self._trackers[key] = tracker
            self._trackers.move_to_end(key)
            return tracker

    def peek(self, key: str) -> dict:
        """등록 없이 상태만 읽는다 — 없으면 초기 상태(응답 shape 동일)를 준다."""
        with self._lock:
            tracker = self._trackers.get(key)
        return tracker.get() if tracker is not None else _initial_state(**self._extra)

    def size(self) -> int:
        with self._lock:
            return len(self._trackers)

    def _evict_locked(self) -> None:
        # 고착 트래커(running=True인데 무활동 상한 초과)도 유휴로 본다 — 아니면 그 슬롯이
        # 영구히 상한을 잠식해 새 사용자가 들어올 자리를 뺏는다.
        while len(self._trackers) >= self._MAX:
            victim = next((k for k, v in self._trackers.items()
                           if not v.get()["running"] or v.is_stuck()), None)
            if victim is None:
                return
            del self._trackers[victim]

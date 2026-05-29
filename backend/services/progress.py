import threading


class ProgressTracker:
    def __init__(self, **extra):
        self._lock = threading.Lock()
        self._state = {"running": False, "done": 0, "total": 0, "current": "", "failed": [], **extra}

    def get(self) -> dict:
        with self._lock:
            return dict(self._state)

    def start(self, total: int) -> None:
        with self._lock:
            self._state.update({"running": True, "done": 0, "total": total, "current": "", "failed": []})

    def set(self, **kwargs) -> None:
        with self._lock:
            self._state.update(kwargs)

    def increment(self) -> None:
        with self._lock:
            self._state["done"] += 1

    def add_failed(self, ticker: str, error: str = "") -> None:
        with self._lock:
            self._state["failed"].append({"ticker": ticker, "error": error})

    def finish(self) -> None:
        with self._lock:
            self._state.update({"running": False, "current": ""})

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scheduler
import services.kr_sector_service as krs


def test_seed_runs_refresh_when_cache_empty(monkeypatch):
    """빈 캐시(load_momentum []) → refresh 1회 호출."""
    calls = []
    monkeypatch.setattr(krs, "load_momentum", lambda: [])
    monkeypatch.setattr(krs, "refresh", lambda: calls.append("refresh") or [])
    scheduler._seed_kr_sector_if_empty()
    assert calls == ["refresh"]


def test_seed_skips_when_cache_present(monkeypatch):
    """캐시에 업종이 있으면 refresh 안 함(skip)."""
    calls = []
    monkeypatch.setattr(krs, "load_momentum", lambda: [{"name": "전기/전자", "code": "013"}])
    monkeypatch.setattr(krs, "refresh", lambda: calls.append("refresh") or [])
    scheduler._seed_kr_sector_if_empty()
    assert calls == []


def test_seed_swallows_refresh_error(monkeypatch):
    """refresh 예외가 기동을 깨지 않는다(graceful)."""
    def boom():
        raise RuntimeError("kiwoom down")
    monkeypatch.setattr(krs, "load_momentum", lambda: [])
    monkeypatch.setattr(krs, "refresh", boom)
    scheduler._seed_kr_sector_if_empty()  # must not raise

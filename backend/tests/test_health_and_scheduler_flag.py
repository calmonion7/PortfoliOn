"""task#386 S1 — 표준 배포(taebro-infra `bin/deploy`)가 기대하는 두 가지.

ⓐ `/health` 본문에 `"service": "portfolion"` — `deploy/taebro.env`의 `HEALTH_EXPECT=portfolion`이
   이 문자열을 찾는다. 포트가 엉뚱한 앱에 붙어 200이 나는 거짓 통과를 막는 장치라, 본문이
   `{"status":"ok"}`뿐이면 배포가 헬스 실패로 롤백된다.
ⓑ `SCHEDULER_ENABLED=false`면 lifespan이 `sched.start()`/`sched.stop()`을 건너뛴다 — dev 스택
   (prod DB 복사본)이 배치 스케줄을 그대로 실행하지 않게 하는 스위치. 미설정 = 켜짐(prod 무변경).
"""
import asyncio
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import main


def test_health_body_names_the_service():
    r = TestClient(main.app).get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "service": "portfolion"}


def _run_lifespan(monkeypatch):
    fake_sched = MagicMock()
    monkeypatch.setattr(main, "sched", fake_sched)
    monkeypatch.setattr(main, "_migrate", lambda: None)
    monkeypatch.setattr(main.threading, "Thread", MagicMock())

    async def _cycle():
        async with main.lifespan(main.app):
            pass

    asyncio.run(_cycle())
    return fake_sched


@pytest.mark.parametrize("value", ["false", "False", "0", "no", "off"])
def test_scheduler_disabled_skips_start_and_stop(monkeypatch, value):
    monkeypatch.setenv("SCHEDULER_ENABLED", value)
    fake = _run_lifespan(monkeypatch)
    fake.start.assert_not_called()
    fake.stop.assert_not_called()


@pytest.mark.parametrize("value", [None, "true", "1", ""])
def test_scheduler_enabled_by_default(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("SCHEDULER_ENABLED", raising=False)
    else:
        monkeypatch.setenv("SCHEDULER_ENABLED", value)
    fake = _run_lifespan(monkeypatch)
    fake.start.assert_called_once()
    fake.stop.assert_called_once()

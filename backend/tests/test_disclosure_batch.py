"""S3: disclosure_fetch 배치 — registry · scheduler 잡 · 수동 lane.

CLAUDE.md "배치 id 4표면"(read·표시·job_runs record·테스트) 일관 배선 검증.
"""
import sys
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from services import batch_registry


# ── registry 엔트리 (read·표시 표면) ──

def test_disclosure_fetch_registry_entry():
    e = batch_registry.get_batch("disclosure_fetch")
    assert e is not None
    assert e["market"] == "KR"
    assert e["category"] == "report"
    assert e["editable"] is True
    assert e["trigger_kinds"] == ["auto", "manual"]
    assert e["manual_endpoint"] == "/api/report/disclosures/refresh"
    assert e["scheduler_job_id"] == "disclosure_fetch"
    assert e["timezone"] == "Asia/Seoul"
    # 08:00 다이제스트 직전
    assert e["default_schedule"] == {"enabled": True, "type": "daily", "time": "07:30"}


# ── scheduler 잡 (job_funcs 배선 + auto record) ──

def test_scheduler_wires_disclosure_fetch():
    import scheduler
    assert "disclosure_fetch" in scheduler._JOB_FUNCS


def test_fetch_disclosures_job_records_auto(monkeypatch):
    import scheduler
    calls = []

    @contextmanager
    def fake_record(job_id, trigger):
        calls.append((job_id, trigger))
        yield 1

    import services.job_runs as job_runs
    monkeypatch.setattr(job_runs, "record", fake_record)
    monkeypatch.setattr("services.disclosures.fetch_all_disclosures",
                        lambda: {"total": 1, "ok": 1, "failed": 0})
    scheduler._fetch_disclosures()
    assert ("disclosure_fetch", "auto") in calls


def test_seed_spec_for_disclosure_fetch_default(monkeypatch):
    """옛 행 없음 → default_schedule(daily 07:30)로 시드."""
    import scheduler
    assert scheduler._seed_spec_for("disclosure_fetch") == \
        batch_registry.get_batch("disclosure_fetch")["default_schedule"]


# ── 수동 lane (manual record) ──

def _admin_client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routers.report import router
    from auth import require_admin
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_admin] = lambda: "admin-id"
    return TestClient(app)


def test_manual_refresh_records_manual(monkeypatch):
    import routers.report as report_mod
    calls = []

    @contextmanager
    def fake_record(job_id, trigger):
        calls.append((job_id, trigger))
        yield 1

    monkeypatch.setattr(report_mod.job_runs, "record", fake_record)
    monkeypatch.setattr("services.disclosures.fetch_all_disclosures",
                        lambda: {"total": 0, "ok": 0, "failed": 0})

    resp = _admin_client().post("/api/report/disclosures/refresh")
    assert resp.status_code == 202
    # BackgroundTasks 실행 후 manual 기록
    assert ("disclosure_fetch", "manual") in calls

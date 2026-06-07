from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from routers.batches import router
from auth import get_current_user, require_admin

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
client = TestClient(app)

# admin이 오버라이드된 별도 앱(PUT 성공/검증 경로 테스트용)
admin_app = FastAPI()
admin_app.include_router(router)
admin_app.dependency_overrides[get_current_user] = lambda: "test-user-id"
admin_app.dependency_overrides[require_admin] = lambda: "admin-user-id"
admin_client = TestClient(admin_app)

REQUIRED_FIELDS = {
    "id", "label", "category", "schedule_desc", "usage", "editable",
    "trigger_kinds", "manual_endpoint", "scheduler_job_id",
    "next_run", "recent_runs",
}

EXPECTED_IDS = {
    "daily_report", "consensus", "daily_digest", "earnings_refresh",
    "monthly_refresh", "leverage_fetch", "lending_fetch", "kr_rankings_fetch",
    "us_rankings_fetch", "investor_trend_fetch", "guru_crawl", "backlog_fetch",
}


def test_lists_eleven_batches_with_required_fields():
    with patch("routers.batches.job_runs.recent", return_value=[]), \
         patch("routers.batches.storage.get_batch_schedule", return_value=None), \
         patch.object(__import__("scheduler"), "_scheduler") as mock_sched:
        mock_sched.get_job.return_value = None
        resp = client.get("/api/batches")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 12
    assert {b["id"] for b in data} == EXPECTED_IDS
    for b in data:
        assert REQUIRED_FIELDS.issubset(b.keys()), b["id"]


def test_next_run_nullable_and_populated_from_scheduler():
    job = MagicMock()
    job.next_run_time.isoformat.return_value = "2026-06-07T08:00:00+09:00"

    def get_job(jid):
        # daily_digest has a scheduler job; others return None here
        return job if jid == "daily_digest" else None

    with patch("routers.batches.job_runs.recent", return_value=[]), \
         patch("routers.batches.storage.get_batch_schedule", return_value=None), \
         patch.object(__import__("scheduler"), "_scheduler") as mock_sched:
        mock_sched.get_job.side_effect = get_job
        resp = client.get("/api/batches")
    data = {b["id"]: b for b in resp.json()}
    # consensus never has a scheduler job -> always null
    assert data["consensus"]["next_run"] is None
    assert data["daily_digest"]["next_run"] == "2026-06-07T08:00:00+09:00"
    assert data["leverage_fetch"]["next_run"] is None


def test_next_run_swallows_scheduler_errors():
    with patch("routers.batches.job_runs.recent", return_value=[]), \
         patch("routers.batches.storage.get_batch_schedule", return_value=None), \
         patch.object(__import__("scheduler"), "_scheduler") as mock_sched:
        mock_sched.get_job.side_effect = RuntimeError("scheduler not started")
        resp = client.get("/api/batches")
    assert resp.status_code == 200
    assert all(b["next_run"] is None for b in resp.json())


def test_recent_runs_included_from_job_runs():
    runs = [{"id": 1, "job_id": "daily_report", "status": "success"}]

    def recent(job_id, *a, **k):
        return runs if job_id == "daily_report" else []

    with patch("routers.batches.job_runs.recent", side_effect=recent), \
         patch("routers.batches.storage.get_batch_schedule", return_value=None), \
         patch.object(__import__("scheduler"), "_scheduler") as mock_sched:
        mock_sched.get_job.return_value = None
        resp = client.get("/api/batches")
    data = {b["id"]: b for b in resp.json()}
    assert data["daily_report"]["recent_runs"] == runs
    assert data["guru_crawl"]["recent_runs"] == []


def test_requires_authentication():
    no_auth_app = FastAPI()
    no_auth_app.include_router(router)
    c = TestClient(no_auth_app)
    resp = c.get("/api/batches")
    assert resp.status_code == 401


# ── schedule 필드 + GET/PUT /batches/{job_id}/schedule ──────────────────────

def test_list_includes_schedule_editable_timezone():
    def get_sched(job_id):
        return {"enabled": True, "type": "daily", "time": "09:30"} if job_id == "daily_digest" else None

    with patch("routers.batches.job_runs.recent", return_value=[]), \
         patch("routers.batches.storage.get_batch_schedule", side_effect=get_sched), \
         patch.object(__import__("scheduler"), "_scheduler") as mock_sched:
        mock_sched.get_job.return_value = None
        resp = client.get("/api/batches")
    data = {b["id"]: b for b in resp.json()}
    # 저장값 있는 editable
    assert data["daily_digest"]["schedule"] == {"enabled": True, "type": "daily", "time": "09:30"}
    assert data["daily_digest"]["editable"] is True
    assert data["daily_digest"]["timezone"] == "Asia/Seoul"
    # 저장값 없으면 default_schedule 폴백
    assert data["leverage_fetch"]["schedule"] == {"enabled": True, "type": "daily", "time": "07:00"}
    # 비편집(consensus)은 schedule None
    assert data["consensus"]["schedule"] is None


def test_get_schedule_returns_stored_spec():
    spec = {"enabled": True, "type": "weekly", "days": ["mon", "wed"], "time": "08:00"}
    with patch("routers.batches.storage.get_batch_schedule", return_value=spec):
        resp = client.get("/api/batches/daily_report/schedule")
    assert resp.status_code == 200
    assert resp.json() == spec


def test_get_schedule_falls_back_to_default():
    with patch("routers.batches.storage.get_batch_schedule", return_value=None):
        resp = client.get("/api/batches/leverage_fetch/schedule")
    assert resp.status_code == 200
    assert resp.json() == {"enabled": True, "type": "daily", "time": "07:00"}


def test_get_schedule_unknown_job_404():
    resp = client.get("/api/batches/nope/schedule")
    assert resp.status_code == 404


def test_get_schedule_non_editable_404():
    resp = client.get("/api/batches/consensus/schedule")
    assert resp.status_code == 404


def test_put_schedule_saves_and_reloads():
    spec = {"enabled": True, "type": "weekly", "days": ["mon", "tue"], "time": "07:30"}
    with patch("routers.batches.storage.save_batch_schedule") as save, \
         patch("routers.batches.scheduler.reload") as reload_:
        resp = admin_client.put("/api/batches/daily_report/schedule", json=spec)
    assert resp.status_code == 200
    assert resp.json() == spec
    save.assert_called_once_with("daily_report", spec)
    reload_.assert_called_once_with("daily_report")


def test_put_schedule_invalid_spec_400():
    bad = {"enabled": True, "type": "daily", "time": "99:99"}
    with patch("routers.batches.storage.save_batch_schedule") as save, \
         patch("routers.batches.scheduler.reload") as reload_:
        resp = admin_client.put("/api/batches/daily_report/schedule", json=bad)
    assert resp.status_code == 400
    save.assert_not_called()
    reload_.assert_not_called()


def test_put_schedule_unknown_job_404():
    spec = {"enabled": True, "type": "daily", "time": "08:00"}
    with patch("routers.batches.storage.save_batch_schedule") as save, \
         patch("routers.batches.scheduler.reload") as reload_:
        resp = admin_client.put("/api/batches/nope/schedule", json=spec)
    assert resp.status_code == 404
    save.assert_not_called()
    reload_.assert_not_called()


def test_put_schedule_non_editable_404():
    spec = {"enabled": True, "type": "daily", "time": "08:00"}
    resp = admin_client.put("/api/batches/consensus/schedule", json=spec)
    assert resp.status_code == 404


def test_put_schedule_blocked_for_non_admin():
    """require_admin 미오버라이드 앱: 비-admin role이면 403."""
    spec = {"enabled": True, "type": "daily", "time": "08:00"}
    with patch("auth.auth_service.get_user_by_id", return_value={"role": "user"}):
        resp = client.put("/api/batches/daily_report/schedule", json=spec)
    assert resp.status_code == 403

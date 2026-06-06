from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from routers.batches import router
from auth import get_current_user

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
client = TestClient(app)

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

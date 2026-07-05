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
    "next_run", "recent_runs", "source",
}

EXPECTED_IDS = {
    "daily_report_kr", "daily_report_us", "consensus", "daily_digest",
    "earnings_kr", "earnings_us", "monthly_kr", "monthly_us", "macro_signals_fetch",
    "leverage_fetch", "lending_fetch", "kr_rankings_fetch",
    "us_rankings_fetch", "investor_trend_fetch", "short_sell_fetch", "guru_crawl", "backlog_fetch",
    "kr_sector_fetch", "us_sector_fetch", "disclosure_fetch", "agm_fetch", "dividend_fetch", "supply_score_fetch",
    "insider_fetch", "recommendation_kr", "recommendation_us",
    "us_supply_fetch", "beta_fetch",
}


def test_lists_sixteen_batches_with_required_fields():
    with patch("routers.batches.job_runs.recent", return_value=[]), \
         patch("routers.batches.storage.get_batch_schedule", return_value=None), \
         patch.object(__import__("scheduler"), "_scheduler") as mock_sched:
        mock_sched.get_job.return_value = None
        resp = client.get("/api/batches")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 28
    assert {b["id"] for b in data} == EXPECTED_IDS
    for b in data:
        assert REQUIRED_FIELDS.issubset(b.keys()), b["id"]
        assert b["market"] in {"KR", "US", "공통"}, b["id"]


def test_every_batch_has_nonempty_source():
    """전 배치가 비어있지 않은 source(list[str])를 가지고, /api/batches로 노출된다.

    source = [[데이터 소스]](fetch 출처) — 신규 배치가 source를 빠뜨리면 RED."""
    with patch("routers.batches.job_runs.recent", return_value=[]), \
         patch("routers.batches.storage.get_batch_schedule", return_value=None), \
         patch.object(__import__("scheduler"), "_scheduler") as mock_sched:
        mock_sched.get_job.return_value = None
        resp = client.get("/api/batches")
    assert resp.status_code == 200
    for b in resp.json():
        src = b.get("source")
        assert isinstance(src, list) and len(src) > 0, b["id"]
        assert all(isinstance(s, str) and s.strip() for s in src), b["id"]


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
    runs = [{"id": 1, "job_id": "daily_report_kr", "status": "success"}]

    def recent(job_id, *a, **k):
        return runs if job_id == "daily_report_kr" else []

    with patch("routers.batches.job_runs.recent", side_effect=recent), \
         patch("routers.batches.storage.get_batch_schedule", return_value=None), \
         patch.object(__import__("scheduler"), "_scheduler") as mock_sched:
        mock_sched.get_job.return_value = None
        resp = client.get("/api/batches")
    data = {b["id"]: b for b in resp.json()}
    assert data["daily_report_kr"]["recent_runs"] == runs
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


def test_schedule_desc_derived_from_saved_spec_for_editable():
    """편집 배치의 schedule_desc는 저장 spec에서 파생, 비편집은 정적 문자열 유지."""
    def get_sched(job_id):
        if job_id == "daily_digest":  # 시간 변경됨
            return {"enabled": True, "type": "daily", "time": "09:30"}
        if job_id == "leverage_fetch":  # 자동실행 꺼짐
            return {"enabled": False, "type": "daily", "time": "07:00"}
        return None

    with patch("routers.batches.job_runs.recent", return_value=[]), \
         patch("routers.batches.storage.get_batch_schedule", side_effect=get_sched), \
         patch.object(__import__("scheduler"), "_scheduler") as mock_sched:
        mock_sched.get_job.return_value = None
        resp = client.get("/api/batches")
    data = {b["id"]: b for b in resp.json()}
    # editable + 저장값 → spec 반영
    assert data["daily_digest"]["schedule_desc"] == "매일 09:30"
    # editable + 비활성 → "자동실행 꺼짐"
    assert data["leverage_fetch"]["schedule_desc"] == "자동실행 꺼짐"
    # editable + 저장값 없음 → default_schedule에서 파생 (backlog_fetch 기본: 매주 일 04:00)
    assert data["backlog_fetch"]["schedule_desc"] == "매주 일 04:00"
    # 비편집(consensus)은 레지스트리 정적 문자열 유지
    assert data["consensus"]["schedule_desc"] == "리포트 생성에 포함"


def test_get_schedule_returns_stored_spec():
    spec = {"enabled": True, "type": "weekly", "days": ["mon", "wed"], "time": "20:30"}
    with patch("routers.batches.storage.get_batch_schedule", return_value=spec):
        resp = client.get("/api/batches/daily_report_kr/schedule")
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
        resp = admin_client.put("/api/batches/daily_report_kr/schedule", json=spec)
    assert resp.status_code == 200
    assert resp.json() == spec
    save.assert_called_once_with("daily_report_kr", spec)
    reload_.assert_called_once_with("daily_report_kr")


def test_put_schedule_invalid_spec_400():
    bad = {"enabled": True, "type": "daily", "time": "99:99"}
    with patch("routers.batches.storage.save_batch_schedule") as save, \
         patch("routers.batches.scheduler.reload") as reload_:
        resp = admin_client.put("/api/batches/daily_report_kr/schedule", json=bad)
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
        resp = client.put("/api/batches/daily_report_kr/schedule", json=spec)
    assert resp.status_code == 403


# ── FOMC 커버리지 가드 (task#140) — 라이브로는 소진 임박 상태를 만들 수 없으므로
#    양 브랜치를 patch로 결정적으로 못박는다(실행 날짜 무관). ──
from datetime import date, timedelta
import routers.calendar as _cal


def test_fomc_coverage_needs_update_when_near_exhaustion():
    soon = (date.today() + timedelta(days=90)).isoformat()  # ~3개월 남음
    with patch.object(_cal, "_FOMC_DATES", ["2025-01-01", soon]):
        st = _cal.fomc_coverage_status()
    assert st["needs_update"] is True
    assert st["last_date"] == soon
    assert st["months_left"] < 6


def test_fomc_coverage_ok_when_far():
    far = (date.today() + timedelta(days=400)).isoformat()  # ~13개월 남음
    with patch.object(_cal, "_FOMC_DATES", ["2025-01-01", far]):
        st = _cal.fomc_coverage_status()
    assert st["needs_update"] is False
    assert st["months_left"] > 6


def test_fomc_coverage_graceful_when_exhausted():
    """목록이 이미 소진돼도 예외 없이 음수 개월 + needs_update True."""
    past = (date.today() - timedelta(days=30)).isoformat()
    with patch.object(_cal, "_FOMC_DATES", ["2024-01-01", past]):
        st = _cal.fomc_coverage_status()
    assert st["needs_update"] is True
    assert st["months_left"] < 0


def test_fomc_coverage_endpoint_shape():
    resp = client.get("/api/batches/fomc-coverage")
    assert resp.status_code == 200
    data = resp.json()
    assert set(data) >= {"last_date", "months_left", "needs_update", "threshold_months"}
    assert isinstance(data["needs_update"], bool)

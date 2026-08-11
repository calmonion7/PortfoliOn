"""S2: GET /api/market/trimmed-inflation + POST /api/market/refresh-trimmed-inflation.

무인증 거부는 override 없는 fresh app으로(conftest override는 main.app 한정, ADR-0029
test_security_auth_gaps.py 패턴). 인증된 호출은 서비스 함수를 mock해 계약 형태만 확인.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.market_indicators import router as mi_router
from auth import get_current_user, require_admin


def _fresh_client():
    app = FastAPI()
    app.include_router(mi_router)
    return TestClient(app)


# ── 무인증 거부 (fresh app, override 없음) ──────────────────────────────────

def test_trimmed_inflation_requires_auth():
    r = _fresh_client().get("/api/market/trimmed-inflation")
    assert r.status_code != 404, "경로가 존재하지 않는다"
    assert r.status_code == 401


def test_refresh_trimmed_inflation_requires_auth():
    r = _fresh_client().post("/api/market/refresh-trimmed-inflation")
    assert r.status_code != 404, "경로가 존재하지 않는다"
    assert r.status_code in (401, 403)


# ── 인증된 호출 ──────────────────────────────────────────────────────────────

def _client_as_user():
    app = FastAPI()
    app.include_router(mi_router)
    app.dependency_overrides[get_current_user] = lambda: "test-user"
    return TestClient(app)


def _client_as_admin():
    app = FastAPI()
    app.include_router(mi_router)
    app.dependency_overrides[require_admin] = lambda: "admin-id"
    return TestClient(app)


def test_get_trimmed_inflation_returns_stored_contract(monkeypatch):
    import routers.market_indicators as mi
    stored = {
        "core_pce": {"history": [{"date": "2026-07-01", "value": 2.61}],
                     "latest": 2.61, "latest_date": "2026-07-01"},
        "headline_pce": {"history": [], "latest": None, "latest_date": None},
        "dallas_trimmed": {"history": [{"date": "2026-07-01", "value": 2.7}],
                            "latest": 2.7, "latest_date": "2026-07-01"},
        "cleveland_trimmed": {"history": [], "latest": None, "latest_date": None},
    }
    monkeypatch.setattr(mi, "get_trimmed_inflation", lambda: stored)

    resp = _client_as_user().get("/api/market/trimmed-inflation")

    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"core_pce", "headline_pce", "dallas_trimmed", "cleveland_trimmed"}
    assert body["core_pce"]["latest"] == pytest.approx(2.61)
    assert body["headline_pce"]["latest"] is None


def test_refresh_trimmed_inflation_records_manual_and_fetches(monkeypatch):
    import routers.market_indicators as mi
    from contextlib import contextmanager

    calls = []

    @contextmanager
    def fake_record(job_id, trigger):
        calls.append((job_id, trigger))
        yield 1

    monkeypatch.setattr(mi.job_runs, "record", fake_record)

    fetched = []

    def fake_fetch():
        fetched.append("fetch")
        return {"core_pce": [{"date": "2026-07-01", "value": 1.0}],
                "headline_pce": [{"date": "2026-07-01", "value": 2.0}],
                "dallas_trimmed": [{"date": "2026-07-01", "value": 3.0}],
                "cleveland_trimmed": [{"date": "2026-07-01", "value": 4.0}]}

    monkeypatch.setattr(mi, "_fetch_and_save_trimmed_inflation", fake_fetch)

    resp = _client_as_admin().post("/api/market/refresh-trimmed-inflation")

    assert resp.status_code == 200, resp.text
    assert ("trimmed_inflation_fetch", "manual") in calls
    assert fetched == ["fetch"]
    body = resp.json()
    assert body == {"ok": True, "status": "success",
                     "core_pce_points": 1, "headline_pce_points": 1,
                     "dallas_trimmed_points": 1, "cleveland_trimmed_points": 1}


def test_refresh_trimmed_inflation_reports_skipped_when_no_api_key(monkeypatch):
    """FRED_API_KEY 미설정(또는 전 계열 실패) 시 ok=false·status=skipped — "ok:true"로
    오인하지 않도록 응답에서 성공과 스킵을 구분한다(관측 가능성 축)."""
    import routers.market_indicators as mi
    from contextlib import contextmanager

    class _FakeRun:
        def __init__(self):
            self.calls = []

        def set_status(self, status, error=None):
            self.calls.append((status, error))

    fake_run = _FakeRun()

    @contextmanager
    def fake_record(job_id, trigger):
        yield fake_run

    monkeypatch.setattr(mi.job_runs, "record", fake_record)
    monkeypatch.setattr(mi, "_fetch_and_save_trimmed_inflation",
                         lambda: {"error": "FRED_API_KEY 환경변수가 필요합니다."})

    resp = _client_as_admin().post("/api/market/refresh-trimmed-inflation")

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": False, "status": "skipped",
                            "error": "FRED_API_KEY 환경변수가 필요합니다."}
    assert fake_run.calls == [("skipped", "FRED_API_KEY 환경변수가 필요합니다.")]


def test_refresh_trimmed_inflation_reports_partial_with_ok_false(monkeypatch):
    """⭐ partial 응답 바디를 단언하는 케이스 — 형제 2건(business-formation·labor-surveys)에는
    이 커버리지가 없어서 API_SPEC 오기(partial인데 ok:true)가 스위트를 통과했다. status가
    "success"가 아니면 ok는 반드시 false다(핸들러: ok = status == "success")."""
    import routers.market_indicators as mi
    from contextlib import contextmanager

    class _FakeRun:
        def __init__(self):
            self.calls = []

        def set_status(self, status, error=None):
            self.calls.append((status, error))

    fake_run = _FakeRun()

    @contextmanager
    def fake_record(job_id, trigger):
        yield fake_run

    monkeypatch.setattr(mi.job_runs, "record", fake_record)
    monkeypatch.setattr(mi, "_fetch_and_save_trimmed_inflation",
                         lambda: {"core_pce": [{"date": "2026-07-01", "value": 1.0}],
                                  "headline_pce": [],
                                  "dallas_trimmed": [{"date": "2026-07-01", "value": 3.0}],
                                  "cleveland_trimmed": [{"date": "2026-07-01", "value": 4.0}],
                                  "_status": "partial"})

    resp = _client_as_admin().post("/api/market/refresh-trimmed-inflation")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body == {"ok": False, "status": "partial",
                     "core_pce_points": 1, "headline_pce_points": 0,
                     "dallas_trimmed_points": 1, "cleveland_trimmed_points": 1}
    assert fake_run.calls == [("partial", None)]

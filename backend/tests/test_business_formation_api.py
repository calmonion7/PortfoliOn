"""S2: GET /api/market/business-formation + POST /api/market/refresh-business-formation.

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

def test_business_formation_requires_auth():
    r = _fresh_client().get("/api/market/business-formation")
    assert r.status_code != 404, "경로가 존재하지 않는다"
    assert r.status_code == 401


def test_refresh_business_formation_requires_auth():
    r = _fresh_client().post("/api/market/refresh-business-formation")
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


def test_get_business_formation_returns_stored_contract(monkeypatch):
    import routers.market_indicators as mi
    stored = {
        "information": {"history": [{"date": "2026-06-01", "value": 12999.0}],
                         "ma3": [{"date": "2026-06-01", "value": 12510.0}],
                         "latest_raw": 12999.0, "latest_ma3": 12510.0,
                         "latest_date": "2026-06-01", "prev_raw": 12800.0},
        "professional": {"history": [], "ma3": [], "latest_raw": None,
                          "latest_ma3": None, "latest_date": None, "prev_raw": None},
    }
    monkeypatch.setattr(mi, "get_business_formation", lambda: stored)

    resp = _client_as_user().get("/api/market/business-formation")

    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"information", "professional"}
    assert body["information"]["latest_raw"] == pytest.approx(12999.0)
    assert body["professional"]["latest_raw"] is None


def test_refresh_business_formation_records_manual_and_fetches(monkeypatch):
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
        return {"information": [{"date": "2026-06-01", "value": 1.0}],
                "professional": [{"date": "2026-06-01", "value": 2.0}]}

    monkeypatch.setattr(mi, "_fetch_and_save_business_formation", fake_fetch)

    resp = _client_as_admin().post("/api/market/refresh-business-formation")

    assert resp.status_code == 200, resp.text
    assert ("business_formation_fetch", "manual") in calls
    assert fetched == ["fetch"]
    body = resp.json()
    assert body == {"ok": True, "status": "success",
                     "information_points": 1, "professional_points": 1}


def test_refresh_business_formation_reports_skipped_when_no_api_key(monkeypatch):
    """FRED_API_KEY 미설정(또는 전 부문 실패) 시 ok=false·status=skipped — "ok:true"로
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
    monkeypatch.setattr(mi, "_fetch_and_save_business_formation",
                         lambda: {"error": "FRED_API_KEY 환경변수가 필요합니다."})

    resp = _client_as_admin().post("/api/market/refresh-business-formation")

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": False, "status": "skipped",
                            "error": "FRED_API_KEY 환경변수가 필요합니다."}
    assert fake_run.calls == [("skipped", "FRED_API_KEY 환경변수가 필요합니다.")]

"""S4: 신규 수동 트리거 4종 + 기존 미게이트 엔드포인트 admin 게이팅 통일.

- 비-admin 403, admin 200/202 게이팅 (require_admin override 패턴).
- 신규 워커 엔드포인트는 job_runs.record(<job_id>, "manual")로 계측됨을 spy로 확인.
- record는 spy 컨텍스트매니저로 대체해 DB 불필요.
"""
import sys
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import get_current_user, require_admin


@pytest.fixture
def spy(monkeypatch):
    """services.job_runs.record를 (job_id, trigger)를 기록하는 컨텍스트매니저로 대체."""
    calls = []

    @contextmanager
    def fake_record(job_id, trigger):
        calls.append((job_id, trigger))
        yield 1

    import services.job_runs as job_runs
    monkeypatch.setattr(job_runs, "record", fake_record)
    return calls


def _admin_client(router):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: "admin-id"
    app.dependency_overrides[require_admin] = lambda: "admin-id"
    return TestClient(app)


def _non_admin_client(router, monkeypatch):
    """require_admin override 없이 get_current_user만 주입 → require_admin이 403."""
    monkeypatch.setattr("auth.auth_service.get_user_by_id", lambda _id: {"role": "user"})
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: "user-1"
    return TestClient(app)


# ---------------------------------------------------------------------------
# POST /api/digest/generate-all → daily_digest
# ---------------------------------------------------------------------------

def test_digest_generate_all_blocks_non_admin(monkeypatch):
    from routers.digest import router
    resp = _non_admin_client(router, monkeypatch).post("/api/digest/generate-all")
    assert resp.status_code == 403


def test_digest_generate_all_admin_records(spy, monkeypatch):
    import routers.digest as digest
    monkeypatch.setattr(digest, "_holding_user_ids", lambda: ["u1", "u2"])
    monkeypatch.setattr(digest.digest_service, "generate", lambda uid: {"user_id": uid})
    monkeypatch.setattr(digest.digest_service, "send_telegram", lambda d: None)
    resp = _admin_client(digest.router).post("/api/digest/generate-all")
    assert resp.status_code == 200
    assert ("daily_digest", "manual") in spy
    assert resp.json()["users"] == 2


# ---------------------------------------------------------------------------
# POST /api/market/refresh-monthly → monthly_refresh
# ---------------------------------------------------------------------------

def test_refresh_monthly_blocks_non_admin(monkeypatch):
    from routers.market_indicators import router
    resp = _non_admin_client(router, monkeypatch).post("/api/market/refresh-monthly")
    assert resp.status_code == 403


def test_refresh_monthly_admin_records(spy, monkeypatch):
    import routers.market_indicators as mi
    monkeypatch.setattr(mi, "_fetch_and_save_econ_indicators", lambda: {"cpi": [], "unemployment": []})
    monkeypatch.setattr(mi, "_fetch_and_save_kr_exports", lambda: {"history": []})
    resp = _admin_client(mi.router).post("/api/market/refresh-monthly")
    assert resp.status_code == 200
    assert ("monthly_refresh", "manual") in spy


# ---------------------------------------------------------------------------
# POST /api/rankings/refresh?market=KR|US → kr_rankings_fetch / us_rankings_fetch
# ---------------------------------------------------------------------------

def test_rankings_refresh_blocks_non_admin(monkeypatch):
    from routers.rankings import router
    resp = _non_admin_client(router, monkeypatch).post("/api/rankings/refresh?market=KR")
    assert resp.status_code == 403


def test_rankings_refresh_kr_admin_records(spy, monkeypatch):
    import routers.rankings as rankings
    calls = []
    monkeypatch.setattr(rankings.ranking_service, "get_kr_rankings", lambda: {"value": [], "volume": []})
    monkeypatch.setattr(rankings.ranking_service, "get_us_rankings", lambda: {"value": [], "volume": []})
    monkeypatch.setattr(rankings.ranking_service, "replace_market_rankings",
                        lambda market, r: calls.append((market, r)))
    resp = _admin_client(rankings.router).post("/api/rankings/refresh?market=KR")
    assert resp.status_code == 200
    assert calls == [("KR", {"value": [], "volume": []})]
    assert ("kr_rankings_fetch", "manual") in spy


def test_rankings_refresh_us_admin_records(spy, monkeypatch):
    import routers.rankings as rankings
    calls = []
    monkeypatch.setattr(rankings.ranking_service, "get_kr_rankings", lambda: {"value": [], "volume": []})
    monkeypatch.setattr(rankings.ranking_service, "get_us_rankings", lambda: {"value": [], "volume": []})
    monkeypatch.setattr(rankings.ranking_service, "replace_market_rankings",
                        lambda market, r: calls.append((market, r)))
    resp = _admin_client(rankings.router).post("/api/rankings/refresh?market=US")
    assert resp.status_code == 200
    assert calls == [("US", {"value": [], "volume": []})]
    assert ("us_rankings_fetch", "manual") in spy


def test_rankings_refresh_bad_market_400(spy):
    import routers.rankings as rankings
    resp = _admin_client(rankings.router).post("/api/rankings/refresh?market=JP")
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/investor/refresh → investor_trend_fetch
# ---------------------------------------------------------------------------

def test_investor_refresh_blocks_non_admin(monkeypatch):
    from routers.investor import router
    resp = _non_admin_client(router, monkeypatch).post("/api/investor/refresh")
    assert resp.status_code == 403


def test_investor_refresh_admin_records(spy, monkeypatch):
    import routers.investor as investor
    called = []
    monkeypatch.setattr(investor.scheduler, "_investor_trend_work", lambda: called.append(True))
    resp = _admin_client(investor.router).post("/api/investor/refresh")
    assert resp.status_code == 202
    assert called == [True]
    assert ("investor_trend_fetch", "manual") in spy


# ---------------------------------------------------------------------------
# 기존 미게이트 엔드포인트 → admin 게이트 추가
# ---------------------------------------------------------------------------

def test_refresh_earnings_blocks_non_admin(monkeypatch):
    from routers.market_indicators import router
    resp = _non_admin_client(router, monkeypatch).post("/api/market/refresh-earnings")
    assert resp.status_code == 403


def test_refresh_earnings_admin_ok(monkeypatch):
    import routers.market_indicators as mi
    monkeypatch.setattr(mi.job_runs, "record", lambda *a, **k: __import__("contextlib").nullcontext(1))
    monkeypatch.setattr(mi, "_fetch_and_save_m7_earnings", lambda: {"quarters": []})
    monkeypatch.setattr(mi, "_fetch_and_save_kr_top2_earnings", lambda: {"quarters": []})
    resp = _admin_client(mi.router).post("/api/market/refresh-earnings")
    assert resp.status_code == 200


def test_refresh_econ_blocks_non_admin(monkeypatch):
    from routers.market_indicators import router
    resp = _non_admin_client(router, monkeypatch).post("/api/market/refresh-econ")
    assert resp.status_code == 403


def test_refresh_econ_admin_ok(monkeypatch):
    import routers.market_indicators as mi
    monkeypatch.setattr(mi.job_runs, "record", lambda *a, **k: __import__("contextlib").nullcontext(1))
    monkeypatch.setattr(mi, "_fetch_and_save_econ_indicators", lambda: {"cpi": [], "unemployment": []})
    resp = _admin_client(mi.router).post("/api/market/refresh-econ")
    assert resp.status_code == 200


def test_schedule_put_blocks_non_admin(monkeypatch):
    from routers.report import router
    body = {"enabled": True, "time": "07:00", "days": ["mon"]}
    resp = _non_admin_client(router, monkeypatch).put("/api/schedule", json=body)
    assert resp.status_code == 403


def test_schedule_put_admin_ok(monkeypatch):
    import routers.report as report
    monkeypatch.setattr(report.storage, "save_schedule", lambda s: None)
    body = {"enabled": True, "time": "07:00", "days": ["mon"]}
    resp = _admin_client(report.router).put("/api/schedule", json=body)
    assert resp.status_code == 200


def test_guru_schedule_put_blocks_non_admin(monkeypatch):
    from routers.guru import router
    body = {"enabled": True, "day": "sun", "time": "03:00"}
    resp = _non_admin_client(router, monkeypatch).put("/api/guru/schedule", json=body)
    assert resp.status_code == 403


def test_guru_schedule_put_admin_ok(monkeypatch):
    import routers.guru as guru
    monkeypatch.setattr(guru.storage, "save_guru_schedule", lambda s: None)
    monkeypatch.setattr(guru.sched, "reload_guru", lambda: None)
    body = {"enabled": True, "day": "sun", "time": "03:00"}
    resp = _admin_client(guru.router).put("/api/guru/schedule", json=body)
    assert resp.status_code == 200

"""task #53 S2: macro_signals_fetch 일배치 + GET /api/market/macro-signals.

배치 id 4표면 일관: registry read·schedule_desc·job_runs.record(auto+manual)·테스트.
market=해외(FRED=US 출처국, ADR-0013). 요청경로 외부 FRED 라이브 호출 0(저장값만).
"""
import sys
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from unittest.mock import patch


# ── 배치 레지스트리 엔트리 (market=해외) ──────────────────────────────────────

def test_registry_has_macro_signals_fetch():
    from services import batch_registry
    e = batch_registry.get_batch("macro_signals_fetch")
    assert e is not None
    assert e["market"] == "US"
    assert e["category"] == "market"
    assert e["editable"] is True
    assert e["trigger_kinds"] == ["auto", "manual"]
    assert e["scheduler_job_id"] == "macro_signals_fetch"
    assert e["timezone"] == "Asia/Seoul"
    assert e["manual_endpoint"] == "/api/market/refresh-macro-signals"
    assert e["default_schedule"] == {"enabled": True, "type": "daily", "time": "06:00"}


def test_registry_count_grows_by_one():
    from services import batch_registry
    # task 46 기준 19 + macro_signals_fetch + supply_score_fetch + insider_fetch
    #   + recommendation_kr + recommendation_us + agm_fetch + us_supply_fetch
    #   + us_sector_fetch = 27
    assert len(batch_registry.BATCHES) == 27


def test_macro_signals_counts_as_overseas():
    from services import batch_registry
    overseas = [b for b in batch_registry.BATCHES if b["market"] == "US"]
    assert "macro_signals_fetch" in {b["id"] for b in overseas}


# ── scheduler 잡 배선 (auto record + 4종 수집 호출) ──────────────────────────

@pytest.fixture
def spy(monkeypatch):
    calls = []

    @contextmanager
    def fake_record(job_id, trigger):
        calls.append((job_id, trigger))
        yield 1

    import services.job_runs as job_runs
    monkeypatch.setattr(job_runs, "record", fake_record)
    return calls


def test_job_funcs_wires_macro_signals_fetch():
    import scheduler
    assert "macro_signals_fetch" in scheduler._JOB_FUNCS


def test_refresh_macro_signals_records_auto_and_fetches(spy, monkeypatch):
    import scheduler
    called = []
    monkeypatch.setattr("services.market_indicators._fetch_and_save_macro_signals",
                        lambda: called.append("fetch"))
    scheduler._refresh_macro_signals()
    assert ("macro_signals_fetch", "auto") in spy
    assert called == ["fetch"]


# ── 수동 엔드포인트 (admin, manual record) ───────────────────────────────────

def _admin_client(router):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from auth import require_admin
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_admin] = lambda: "admin-id"
    return TestClient(app)


def test_manual_refresh_macro_signals_records_manual(spy, monkeypatch):
    import routers.market_indicators as mi
    called = []
    monkeypatch.setattr(mi, "_fetch_and_save_macro_signals",
                        lambda: called.append("fetch") or {
                            "yield_curve": [{"date": "2026-06-10", "value": -0.2}],
                            "hy_spread": [], "m2": [], "fed_funds": [],
                            "signals": {"inverted": True, "credit_stress": None},
                        })
    resp = _admin_client(mi.router).post("/api/market/refresh-macro-signals")
    assert resp.status_code == 200
    assert ("macro_signals_fetch", "manual") in spy
    assert called == ["fetch"]


# ── GET /api/market/macro-signals (저장값만, 라이브 FRED 0) ────────────────────

def test_get_macro_signals_endpoint_returns_stored(monkeypatch):
    import routers.market_indicators as mi
    stored = {
        "yield_curve": [{"date": "2026-06-10", "value": -0.2}],
        "hy_spread": [{"date": "2026-06-10", "value": 6.1}],
        "m2": [{"date": "2026-05-01", "value": 21000.0}],
        "fed_funds": [{"date": "2026-06-10", "value": 4.33}],
        "signals": {"inverted": True, "credit_stress": True},
    }
    monkeypatch.setattr(mi, "get_macro_signals", lambda: stored)

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from auth import get_current_user
    app = FastAPI()
    app.include_router(mi.router)
    app.dependency_overrides[get_current_user] = lambda: "test-user"
    resp = TestClient(app).get("/api/market/macro-signals")
    assert resp.status_code == 200
    body = resp.json()
    assert body["signals"]["inverted"] is True
    assert body["yield_curve"][0]["value"] == pytest.approx(-0.2, abs=0.001)


def test_batches_endpoint_exposes_macro_signals_overseas(client, monkeypatch):
    """GET /api/batches 가 macro_signals_fetch를 해외(US) 배치로 노출."""
    resp = client.get("/api/batches")
    assert resp.status_code == 200
    by_id = {b["id"]: b for b in resp.json()}
    assert "macro_signals_fetch" in by_id
    assert by_id["macro_signals_fetch"]["market"] == "US"

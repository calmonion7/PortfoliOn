"""task #46: earnings·monthly 시장별 분리 + 16배치 market 분류.

S1 registry, S2 scheduler 잡 분리, S3 수동 lane 재배선, S4 기동 시드 마이그레이션을
한 파일에서 검증한다(ADR-0013). 옛 id(earnings_refresh/monthly_refresh)는 4표면 어디에도
잔존하지 않아야 한다.
"""
import sys
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from services import batch_registry


# ── S1: registry 16엔트리 + market 분류 + 옛 id 부재 ─────────────────────────

_MARKET_BY_ID = {
    "daily_report_kr": "KR",
    "kr_rankings_fetch": "KR",
    "backlog_fetch": "KR",
    "leverage_fetch": "KR",
    "lending_fetch": "KR",
    "investor_trend_fetch": "KR",
    "short_sell_fetch": "KR",
    "earnings_kr": "KR",
    "monthly_kr": "KR",
    "daily_report_us": "US",
    "us_rankings_fetch": "US",
    "earnings_us": "US",
    "monthly_us": "US",
    "consensus": "공통",
    "daily_digest": "공통",
    "guru_crawl": "공통",
    "kr_sector_fetch": "KR",
    "disclosure_fetch": "KR",
}


def test_registry_has_sixteen_batches():
    assert len(batch_registry.BATCHES) == 18


def test_old_split_ids_absent():
    assert batch_registry.get_batch("earnings_refresh") is None
    assert batch_registry.get_batch("monthly_refresh") is None


def test_new_split_ids_present():
    for jid in ("earnings_kr", "earnings_us", "monthly_kr", "monthly_us"):
        assert batch_registry.get_batch(jid) is not None, jid


def test_every_batch_has_valid_market():
    for b in batch_registry.BATCHES:
        assert b.get("market") in {"KR", "US", "공통"}, b["id"]


def test_market_classification_matches_adr():
    for b in batch_registry.BATCHES:
        assert b["market"] == _MARKET_BY_ID[b["id"]], b["id"]
    # 분류 카운트: 국내 11 / 해외 4 / 공통 3 (disclosure_fetch 추가, task 51)
    counts = {"KR": 0, "US": 0, "공통": 0}
    for b in batch_registry.BATCHES:
        counts[b["market"]] += 1
    assert counts == {"KR": 11, "US": 4, "공통": 3}


def test_new_earnings_entries_inherit_weekly_schedule():
    for jid in ("earnings_kr", "earnings_us"):
        e = batch_registry.get_batch(jid)
        assert e["category"] == "market"
        assert e["editable"] is True
        assert e["trigger_kinds"] == ["auto", "manual"]
        assert e["timezone"] == "Asia/Seoul"
        assert e["scheduler_job_id"] == jid
        assert e["misfire_grace_time"] is None
        assert e["default_schedule"] == {
            "enabled": True, "type": "weekly", "days": ["sun"], "time": "03:00",
        }


def test_new_monthly_entries_inherit_monthly_schedule():
    for jid in ("monthly_kr", "monthly_us"):
        e = batch_registry.get_batch(jid)
        assert e["category"] == "market"
        assert e["editable"] is True
        assert e["trigger_kinds"] == ["auto", "manual"]
        assert e["timezone"] == "Asia/Seoul"
        assert e["scheduler_job_id"] == jid
        assert e["misfire_grace_time"] is None
        assert e["default_schedule"] == {
            "enabled": True, "type": "monthly", "day_of_month": 1, "time": "02:00",
        }


def test_new_entries_manual_endpoint_market_scoped():
    assert batch_registry.get_batch("earnings_kr")["manual_endpoint"] == "/api/market/refresh-earnings?market=KR"
    assert batch_registry.get_batch("earnings_us")["manual_endpoint"] == "/api/market/refresh-earnings?market=US"
    assert batch_registry.get_batch("monthly_kr")["manual_endpoint"] == "/api/market/refresh-monthly?market=KR"
    assert batch_registry.get_batch("monthly_us")["manual_endpoint"] == "/api/market/refresh-monthly?market=US"


# ── S2: scheduler 잡 분리 (auto record + 올바른 시장 함수 호출) ───────────────

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


def test_refresh_earnings_kr_records_and_calls_kr_only(spy, monkeypatch):
    import scheduler
    called = []
    monkeypatch.setattr("services.market_indicators._fetch_and_save_kr_top2_earnings",
                        lambda: called.append("kr"))
    monkeypatch.setattr("services.market_indicators._fetch_and_save_m7_earnings",
                        lambda: called.append("us"))
    scheduler._refresh_earnings_kr()
    assert ("earnings_kr", "auto") in spy
    assert called == ["kr"]


def test_refresh_earnings_us_records_and_calls_us_only(spy, monkeypatch):
    import scheduler
    called = []
    monkeypatch.setattr("services.market_indicators._fetch_and_save_kr_top2_earnings",
                        lambda: called.append("kr"))
    monkeypatch.setattr("services.market_indicators._fetch_and_save_m7_earnings",
                        lambda: called.append("us"))
    scheduler._refresh_earnings_us()
    assert ("earnings_us", "auto") in spy
    assert called == ["us"]


def test_refresh_monthly_kr_records_and_calls_exports_only(spy, monkeypatch):
    import scheduler
    called = []
    monkeypatch.setattr("services.market_indicators._fetch_and_save_kr_exports",
                        lambda: called.append("kr"))
    monkeypatch.setattr("services.market_indicators._fetch_and_save_econ_indicators",
                        lambda: called.append("us"))
    scheduler._refresh_monthly_kr()
    assert ("monthly_kr", "auto") in spy
    assert called == ["kr"]


def test_refresh_monthly_us_records_and_calls_econ_only(spy, monkeypatch):
    import scheduler
    called = []
    monkeypatch.setattr("services.market_indicators._fetch_and_save_kr_exports",
                        lambda: called.append("kr"))
    monkeypatch.setattr("services.market_indicators._fetch_and_save_econ_indicators",
                        lambda: called.append("us"))
    scheduler._refresh_monthly_us()
    assert ("monthly_us", "auto") in spy
    assert called == ["us"]


def test_job_funcs_wires_new_ids_not_old():
    import scheduler
    assert "earnings_refresh" not in scheduler._JOB_FUNCS
    assert "monthly_refresh" not in scheduler._JOB_FUNCS
    for jid in ("earnings_kr", "earnings_us", "monthly_kr", "monthly_us"):
        assert jid in scheduler._JOB_FUNCS


# ── S3: 수동 lane 재배선 (?market= 으로 시장별 id 기록) ────────────────────────

def _admin_client(router):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from auth import require_admin
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_admin] = lambda: "admin-id"
    return TestClient(app)


def test_manual_refresh_earnings_kr_records_kr(spy, monkeypatch):
    import routers.market_indicators as mi
    called = []
    monkeypatch.setattr(mi, "_fetch_and_save_kr_top2_earnings",
                        lambda: called.append("kr") or {"quarters": []})
    monkeypatch.setattr(mi, "_fetch_and_save_m7_earnings",
                        lambda: called.append("us") or {"quarters": []})
    resp = _admin_client(mi.router).post("/api/market/refresh-earnings?market=KR")
    assert resp.status_code == 200
    assert ("earnings_kr", "manual") in spy
    assert called == ["kr"]


def test_manual_refresh_earnings_us_records_us(spy, monkeypatch):
    import routers.market_indicators as mi
    called = []
    monkeypatch.setattr(mi, "_fetch_and_save_kr_top2_earnings",
                        lambda: called.append("kr") or {"quarters": []})
    monkeypatch.setattr(mi, "_fetch_and_save_m7_earnings",
                        lambda: called.append("us") or {"quarters": []})
    resp = _admin_client(mi.router).post("/api/market/refresh-earnings?market=US")
    assert resp.status_code == 200
    assert ("earnings_us", "manual") in spy
    assert called == ["us"]


def test_manual_refresh_monthly_kr_records_kr(spy, monkeypatch):
    import routers.market_indicators as mi
    called = []
    monkeypatch.setattr(mi, "_fetch_and_save_kr_exports",
                        lambda: called.append("kr") or {"history": []})
    monkeypatch.setattr(mi, "_fetch_and_save_econ_indicators",
                        lambda: called.append("us") or {"cpi": [], "unemployment": []})
    resp = _admin_client(mi.router).post("/api/market/refresh-monthly?market=KR")
    assert resp.status_code == 200
    assert ("monthly_kr", "manual") in spy
    assert called == ["kr"]


def test_manual_refresh_monthly_us_records_us(spy, monkeypatch):
    import routers.market_indicators as mi
    called = []
    monkeypatch.setattr(mi, "_fetch_and_save_kr_exports",
                        lambda: called.append("kr") or {"history": []})
    monkeypatch.setattr(mi, "_fetch_and_save_econ_indicators",
                        lambda: called.append("us") or {"cpi": [], "unemployment": []})
    resp = _admin_client(mi.router).post("/api/market/refresh-monthly?market=US")
    assert resp.status_code == 200
    assert ("monthly_us", "manual") in spy
    assert called == ["us"]


def test_manual_refresh_bad_market_400(spy):
    import routers.market_indicators as mi
    r1 = _admin_client(mi.router).post("/api/market/refresh-earnings?market=JP")
    r2 = _admin_client(mi.router).post("/api/market/refresh-monthly?market=JP")
    assert r1.status_code == 400
    assert r2.status_code == 400


def test_orphan_refresh_econ_records_monthly_us(spy, monkeypatch):
    """고아 /refresh-econ 은 monthly_us로 흡수 — 옛 monthly_refresh id로 기록하지 않음."""
    import routers.market_indicators as mi
    monkeypatch.setattr(mi, "_fetch_and_save_econ_indicators",
                        lambda: {"cpi": [], "unemployment": []})
    resp = _admin_client(mi.router).post("/api/market/refresh-econ")
    assert resp.status_code == 200
    assert ("monthly_us", "manual") in spy


# ── S4: 기동 시드 마이그레이션 (옛 id 행 → 신규 4 id 승계, idempotent) ────────

def _store_seed(monkeypatch, store):
    import services.storage as storage
    saved = []
    monkeypatch.setattr(storage, "get_batch_schedule", lambda jid: store.get(jid))

    def _save(jid, spec):
        store[jid] = spec
        saved.append(jid)

    monkeypatch.setattr(storage, "save_batch_schedule", _save)
    monkeypatch.setattr(storage, "get_schedule", lambda: {"enabled": False, "time": "08:00", "days": []})
    monkeypatch.setattr(storage, "get_guru_schedule", lambda: {"enabled": False, "day": "sun", "time": "03:00"})
    return saved


def test_seed_inherits_old_earnings_monthly_rows(monkeypatch):
    """옛 earnings_refresh·monthly_refresh 행이 있으면 신규 4 id가 enabled·spec을 승계."""
    import scheduler
    store = {
        "earnings_refresh": {"enabled": False, "type": "weekly", "days": ["sat"], "time": "05:00"},
        "monthly_refresh": {"enabled": True, "type": "monthly", "day_of_month": 3, "time": "04:00"},
    }
    _store_seed(monkeypatch, store)
    scheduler._seed_batch_schedules()
    # earnings_kr/us 가 옛 earnings_refresh spec을 승계 (시각 override 없음)
    assert store["earnings_kr"] == {"enabled": False, "type": "weekly", "days": ["sat"], "time": "05:00"}
    assert store["earnings_us"] == {"enabled": False, "type": "weekly", "days": ["sat"], "time": "05:00"}
    # monthly_kr/us 가 옛 monthly_refresh spec을 승계
    assert store["monthly_kr"] == {"enabled": True, "type": "monthly", "day_of_month": 3, "time": "04:00"}
    assert store["monthly_us"] == {"enabled": True, "type": "monthly", "day_of_month": 3, "time": "04:00"}


def test_seed_idempotent_no_overwrite_on_reseed(monkeypatch):
    """이미 신규 id 행이 있으면 재시드 시 덮어쓰지 않는다."""
    import scheduler
    store = {
        "earnings_refresh": {"enabled": False, "type": "weekly", "days": ["sat"], "time": "05:00"},
        "earnings_kr": {"enabled": True, "type": "weekly", "days": ["mon"], "time": "01:00"},  # 사용자 편집
    }
    saved = _store_seed(monkeypatch, store)
    scheduler._seed_batch_schedules()
    # earnings_kr는 이미 있었으니 안 덮어씀
    assert "earnings_kr" not in saved
    assert store["earnings_kr"] == {"enabled": True, "type": "weekly", "days": ["mon"], "time": "01:00"}


def test_seed_falls_back_to_default_when_no_old_row(monkeypatch):
    """옛 행이 없으면 신규 default_schedule로 시드."""
    import scheduler
    store: dict = {}
    _store_seed(monkeypatch, store)
    scheduler._seed_batch_schedules()
    assert store["earnings_kr"] == batch_registry.get_batch("earnings_kr")["default_schedule"]
    assert store["monthly_us"] == batch_registry.get_batch("monthly_us")["default_schedule"]

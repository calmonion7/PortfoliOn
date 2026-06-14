"""S3: 자동 잡(scheduler) + 기존 수동 엔드포인트 워커가 job_runs.record로
계측되는지 검증. record를 spy 컨텍스트매니저로 대체해 (job_id, trigger) 호출만 확인."""
import sys
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest


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


# ---------------------------------------------------------------------------
# 자동 잡 (scheduler) — trigger="auto"
# ---------------------------------------------------------------------------

def test_generate_kr_records_daily_report_kr(spy, monkeypatch):
    import scheduler
    monkeypatch.setattr("services.db.query", lambda *a, **k: [])
    scheduler._generate_kr()
    assert ("daily_report_kr", "auto") in spy


def test_generate_us_records_daily_report_us(spy, monkeypatch):
    import scheduler
    monkeypatch.setattr("services.db.query", lambda *a, **k: [])
    scheduler._generate_us()
    assert ("daily_report_us", "auto") in spy


def test_run_guru_crawl_records(spy, monkeypatch):
    import scheduler
    monkeypatch.setattr("services.guru_scraper.scrape_all_managers", lambda *a, **k: [])
    monkeypatch.setattr("services.storage.save_guru_managers", lambda *a, **k: None)
    scheduler._run_guru_crawl()
    assert ("guru_crawl", "auto") in spy


def test_run_digest_records(spy, monkeypatch):
    import scheduler
    monkeypatch.setattr("services.db.query", lambda *a, **k: [])
    scheduler._run_digest()
    assert ("daily_digest", "auto") in spy


def test_refresh_earnings_kr_records(spy, monkeypatch):
    import scheduler
    monkeypatch.setattr("services.market_indicators._fetch_and_save_kr_top2_earnings", lambda: None)
    scheduler._refresh_earnings_kr()
    assert ("earnings_kr", "auto") in spy


def test_refresh_earnings_us_records(spy, monkeypatch):
    import scheduler
    monkeypatch.setattr("services.market_indicators._fetch_and_save_m7_earnings", lambda: None)
    scheduler._refresh_earnings_us()
    assert ("earnings_us", "auto") in spy


def test_refresh_monthly_kr_records(spy, monkeypatch):
    import scheduler
    monkeypatch.setattr("services.market_indicators._fetch_and_save_kr_exports", lambda: None)
    scheduler._refresh_monthly_kr()
    assert ("monthly_kr", "auto") in spy


def test_refresh_monthly_us_records(spy, monkeypatch):
    import scheduler
    monkeypatch.setattr("services.market_indicators._fetch_and_save_econ_indicators", lambda: None)
    scheduler._refresh_monthly_us()
    assert ("monthly_us", "auto") in spy


def test_fetch_leverage_records(spy, monkeypatch):
    import scheduler
    monkeypatch.setattr("services.leverage_service.fetch_and_store", lambda: None)
    scheduler._fetch_leverage()
    assert ("leverage_fetch", "auto") in spy


def test_fetch_lending_records(spy, monkeypatch):
    import scheduler
    monkeypatch.setattr("services.lending_service.fetch_and_store", lambda: 0)
    scheduler._fetch_lending()
    assert ("lending_fetch", "auto") in spy


def test_fetch_kr_rankings_records(spy, monkeypatch):
    import scheduler
    monkeypatch.setattr("services.ranking_service.get_kr_rankings", lambda: {})
    monkeypatch.setattr("services.ranking_service.replace_market_rankings", lambda *a, **k: None)
    scheduler._fetch_kr_rankings()
    assert ("kr_rankings_fetch", "auto") in spy


def test_fetch_us_rankings_records(spy, monkeypatch):
    import scheduler
    monkeypatch.setattr("services.ranking_service.get_us_rankings", lambda: {})
    monkeypatch.setattr("services.ranking_service.replace_market_rankings", lambda *a, **k: None)
    scheduler._fetch_us_rankings()
    assert ("us_rankings_fetch", "auto") in spy


def test_fetch_investor_trend_records(spy, monkeypatch):
    import scheduler
    monkeypatch.setattr("services.db.query", lambda *a, **k: [])
    scheduler._fetch_investor_trend()
    assert ("investor_trend_fetch", "auto") in spy


def test_fetch_backlog_records(spy, monkeypatch):
    import scheduler
    monkeypatch.setattr("services.backlog.fetch_all_backlog", lambda *a, **k: {})
    scheduler._fetch_backlog()
    assert ("backlog_fetch", "auto") in spy


# ---------------------------------------------------------------------------
# 기존 수동 엔드포인트 워커 — trigger="manual"
# ---------------------------------------------------------------------------

def test_report_generation_worker_records(spy, monkeypatch):
    import routers.report as report
    monkeypatch.setattr(report.report_generator, "generate_report", lambda *a, **k: None)
    monkeypatch.setattr(report.cache_svc, "invalidate", lambda *a, **k: None)
    monkeypatch.setattr(report._pipeline, "run_daily", lambda *a, **k: None)
    report._run_generation([{"ticker": "AAPL"}])
    assert ("daily_report_us", "manual") in spy


def test_report_backfill_worker_records(spy, monkeypatch):
    import routers.report as report
    monkeypatch.setattr(report.report_generator, "backfill_ticker", lambda *a, **k: 0)
    monkeypatch.setattr(report.cache_svc, "invalidate", lambda *a, **k: None)
    report._run_backfill([{"ticker": "AAPL"}], days=1, force=False)
    assert ("daily_report_us", "manual") in spy


def test_consensus_batch_worker_records(spy, monkeypatch):
    import routers.report as report
    monkeypatch.setattr(report._pipeline, "backfill", lambda *a, **k: None)
    report._run_consensus_batch([{"ticker": "AAPL"}], days=1, force=False)
    assert ("consensus", "manual") in spy


def test_guru_crawl_worker_records(spy, monkeypatch):
    import routers.guru as guru
    monkeypatch.setattr(guru, "scrape_all_managers", lambda *a, **k: [])
    monkeypatch.setattr(guru.storage, "save_guru_managers", lambda *a, **k: None)
    guru._run_crawl()
    assert ("guru_crawl", "manual") in spy


def test_leverage_backfill_worker_records(spy, monkeypatch):
    import services.leverage_service as svc
    monkeypatch.setattr(svc, "query", lambda *a, **k: [])
    monkeypatch.setattr(svc, "_fetch_credit_balance", lambda *a, **k: [])
    monkeypatch.setattr(svc, "_fetch_market_fund", lambda *a, **k: [])
    monkeypatch.setattr(svc, "_fetch_market_cap", lambda *a, **k: [])
    monkeypatch.setattr(svc.time, "sleep", lambda *a, **k: None)
    svc.backfill_with_progress(2021, 2021)
    assert ("leverage_fetch", "manual") in spy


def test_lending_sync_endpoint_records(spy, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routers.market_indicators import router
    from auth import require_admin
    import routers.market_indicators as mi

    monkeypatch.setattr(mi, "lending_fetch_and_store", lambda: 3)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_admin] = lambda: "admin-id"
    resp = TestClient(app).post("/api/market/lending/sync")
    assert resp.status_code == 200
    assert ("lending_fetch", "manual") in spy


def test_refresh_earnings_endpoint_records(spy, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routers.market_indicators import router
    from auth import require_admin
    import routers.market_indicators as mi

    monkeypatch.setattr(mi, "_fetch_and_save_m7_earnings", lambda: {"quarters": []})
    monkeypatch.setattr(mi, "_fetch_and_save_kr_top2_earnings", lambda: {"quarters": []})
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_admin] = lambda: "admin-id"
    resp = TestClient(app).post("/api/market/refresh-earnings?market=US")
    assert resp.status_code == 200
    assert ("earnings_us", "manual") in spy


def test_refresh_econ_endpoint_records(spy, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routers.market_indicators import router
    from auth import require_admin
    import routers.market_indicators as mi

    monkeypatch.setattr(mi, "_fetch_and_save_econ_indicators", lambda: {"cpi": [], "unemployment": []})
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_admin] = lambda: "admin-id"
    resp = TestClient(app).post("/api/market/refresh-econ")
    assert resp.status_code == 200
    assert ("monthly_us", "manual") in spy


def test_refresh_all_backlog_rejects_non_admin():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routers.report import router

    app = FastAPI()
    app.include_router(router)
    resp = TestClient(app).post("/api/report/backlog/refresh-all")
    assert resp.status_code in (401, 403)


def test_refresh_all_backlog_endpoint_accepts_admin(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routers.report import router
    from auth import require_admin

    monkeypatch.setattr("services.backlog.fetch_all_backlog", lambda *a, **k: {})
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_admin] = lambda: "admin-id"
    resp = TestClient(app).post("/api/report/backlog/refresh-all")
    assert resp.status_code == 202


def test_refresh_all_backlog_worker_records(spy, monkeypatch):
    import routers.report as report
    monkeypatch.setattr("services.backlog.fetch_all_backlog", lambda *a, **k: {})
    report._run_backlog_all()
    assert ("backlog_fetch", "manual") in spy

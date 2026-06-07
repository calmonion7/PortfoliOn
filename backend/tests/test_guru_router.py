import sys
from contextlib import contextmanager
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

# guru router만 독립적으로 테스트하는 앱
from routers.guru import router
from auth import require_admin
test_app = FastAPI()
test_app.include_router(router)
test_app.dependency_overrides[require_admin] = lambda: "test-user-id"
client = TestClient(test_app)


@pytest.fixture(autouse=True)
def _stub_job_runs(monkeypatch):
    """백그라운드 크롤 워커에 추가된 job_runs.record 계측이 테스트 DB를 건드리지 않도록 no-op로 대체."""
    import services.job_runs as job_runs

    @contextmanager
    def _noop(job_id, trigger):
        yield 1

    monkeypatch.setattr(job_runs, "record", _noop)

SAMPLE_DATA = {
    "last_updated": "2026-05-14T10:00:00",
    "managers": [
        {
            "id": "brk", "name": "Warren Buffett", "firm": "Berkshire Hathaway",
            "portfolio_value": 350_000_000_000, "num_stocks": 45,
            "top10": [
                {"rank": 1, "ticker": "AAPL", "name": "Apple Inc.", "name_kr": "애플", "weight_pct": 42.1},
                {"rank": 2, "ticker": "BAC",  "name": "Bank of America", "name_kr": "", "weight_pct": 10.3},
            ],
        }
    ],
}


def test_get_managers_returns_stored_data():
    with patch("routers.guru.storage.get_guru_managers", return_value=SAMPLE_DATA):
        r = client.get("/api/guru/managers")
    assert r.status_code == 200
    assert r.json()["managers"][0]["name"] == "Warren Buffett"


def test_get_managers_returns_empty_default():
    with patch("routers.guru.storage.get_guru_managers", return_value={"last_updated": None, "managers": []}):
        r = client.get("/api/guru/managers")
    assert r.status_code == 200
    assert r.json()["managers"] == []


def test_stats_popularity():
    with patch("routers.guru.storage.get_guru_managers", return_value=SAMPLE_DATA):
        r = client.get("/api/guru/stats/popularity")
    assert r.status_code == 200
    assert r.json()[0]["ticker"] == "AAPL"
    assert r.json()[0]["count"] == 1


def test_stats_manager_top3():
    with patch("routers.guru.storage.get_guru_managers", return_value=SAMPLE_DATA):
        r = client.get("/api/guru/stats/manager-top3")
    assert r.status_code == 200
    assert r.json()[0]["manager_name"] == "Warren Buffett"
    assert r.json()[0]["top3"][0]["ticker"] == "AAPL"


def test_stats_weighted():
    with patch("routers.guru.storage.get_guru_managers", return_value=SAMPLE_DATA):
        r = client.get("/api/guru/stats/weighted")
    assert r.status_code == 200
    assert r.json()[0]["ticker"] == "AAPL"
    assert r.json()[0]["score"] == pytest.approx(1.0, abs=0.001)


def test_crawl_progress_initial():
    r = client.get("/api/guru/crawl/progress")
    assert r.status_code == 200
    data = r.json()
    assert all(k in data for k in ("running", "done", "total", "current"))


def test_start_crawl_returns_202():
    with patch("routers.guru.scrape_all_managers", return_value=[]):
        with patch("routers.guru.storage.save_guru_managers"):
            r = client.post("/api/guru/crawl")
    assert r.status_code == 202


# --- 403 test: crawl blocked for non-admin ---

from auth import get_current_user as _get_current_user

_nonadmin_guru_app = FastAPI()
_nonadmin_guru_app.include_router(router)
_nonadmin_guru_app.dependency_overrides[_get_current_user] = lambda: "user-id"
_nonadmin_guru_client = TestClient(_nonadmin_guru_app)


def test_crawl_blocked_for_non_admin():
    with patch("auth.auth_service.get_user_by_id", return_value={"role": "user"}):
        r = _nonadmin_guru_client.post("/api/guru/crawl")
    assert r.status_code == 403

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.digest import router
from auth import get_current_user

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
client = TestClient(app)

SAMPLE_DIGEST = {
    "date": "2026-05-23",
    "generated_at": "2026-05-23T08:00:00+09:00",
    "portfolio_summary": {"total_value_usd": 1000.0, "daily_change_pct": 1.0, "daily_change_usd": 10.0},
    "stocks": [{"ticker": "AAPL", "name": "Apple", "change_pct": 2.0, "is_holding": True, "is_anomaly": False}],
    "events_7d": [],
    "anomalies": [],
}


def test_get_latest_returns_digest():
    with patch("routers.digest.digest_service.get_latest", return_value=SAMPLE_DIGEST):
        resp = client.get("/api/digest/latest")
    assert resp.status_code == 200
    assert resp.json()["date"] == "2026-05-23"


def test_get_latest_returns_null_when_none():
    with patch("routers.digest.digest_service.get_latest", return_value=None):
        resp = client.get("/api/digest/latest")
    assert resp.status_code == 200
    assert resp.json() is None


def test_post_generate_returns_digest():
    with patch("routers.digest.digest_service.generate", return_value=SAMPLE_DIGEST):
        resp = client.post("/api/digest/generate")
    assert resp.status_code == 200
    assert resp.json()["date"] == "2026-05-23"

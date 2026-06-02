# backend/tests/test_events_router.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch
from routers.events import router
from auth import get_current_user

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "user-1"
client = TestClient(app)


def test_valid_event_returns_200():
    with patch("routers.events._persist") as mock_persist:
        resp = client.post("/api/events", json={"event_name": "nav_portfolio", "properties": {}})
    assert resp.status_code == 200


def test_invalid_event_name_ignored():
    with patch("routers.events._persist") as mock_persist:
        resp = client.post("/api/events", json={"event_name": "unknown_event", "properties": {}})
    assert resp.status_code == 200
    assert not mock_persist.called


def test_event_with_properties_passes_event_name():
    captured = []
    def fake_persist(user_id, event_name, properties):
        captured.append(event_name)
    with patch("routers.events._persist", side_effect=fake_persist):
        resp = client.post(
            "/api/events",
            json={"event_name": "report_view_open", "properties": {"ticker": "AAPL"}},
        )
    assert resp.status_code == 200
    assert "report_view_open" in captured

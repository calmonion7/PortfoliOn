# backend/tests/test_events_router.py
import re
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch
from routers.events import router, VALID_EVENTS
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


def test_ranking_watch_toggle_is_whitelisted():
    # task#273 S5: Ranking.jsx가 쏘는 ranking_watch_toggle이 VALID_EVENTS에 없으면
    # 화이트리스트 탈락으로 _persist가 호출되지 않는다(요청은 200이지만 이벤트는 조용히 사라짐).
    with patch("routers.events._persist") as mock_persist:
        resp = client.post(
            "/api/events",
            json={"event_name": "ranking_watch_toggle", "properties": {"ticker": "005930"}},
        )
    assert resp.status_code == 200
    assert mock_persist.called


def test_api_spec_event_list_matches_valid_events():
    # API_SPEC.md의 "허용 이벤트:" 산문 나열이 VALID_EVENTS와 집합으로 일치해야 한다.
    spec_path = Path(__file__).parent.parent.parent / "API_SPEC.md"
    text = spec_path.read_text(encoding="utf-8")
    marker = "허용 이벤트:"
    idx = text.index(marker)
    # 마커 이후 첫 문단(다음 줄바꿈까지)에서 백틱으로 감싼 이벤트명만 추출
    line_end = text.index("\n", idx)
    segment = text[idx + len(marker):line_end]
    documented = set(re.findall(r"`([^`]+)`", segment))
    assert documented == VALID_EVENTS

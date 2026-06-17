# backend/tests/test_recommendation_endpoint.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from datetime import date

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.recommendations import router
from auth import get_current_user, require_admin

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
app.dependency_overrides[require_admin] = lambda: "admin-id"
client = TestClient(app)


def _scored_rows():
    return [
        {
            "ticker": "AAPL", "name": "Apple", "market": "US",
            "score": 88.0, "flags": [{"label": "목표가 대비 +20%", "kind": "value"}],
            "rank": 1, "base_date": date(2026, 6, 18),
        },
        {
            "ticker": "005930", "name": "삼성전자", "market": "KR",
            "score": 75.0, "flags": [], "rank": 2, "base_date": date(2026, 6, 18),
        },
    ]


def test_get_recommendations_returns_discovery_section():
    with patch("routers.recommendations.storage.get_all_stocks", return_value=[]), \
         patch("routers.recommendations.recommendation.read_recommendations",
               return_value=_scored_rows()) as mock_read:
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    data = resp.json()
    # additive 섹션 키 객체
    assert set(data.keys()) >= {"as_of", "discovery"}
    assert isinstance(data["discovery"], list)
    # as_of = 가장 최신 base_date
    assert data["as_of"] == "2026-06-18"
    first = data["discovery"][0]
    assert first["ticker"] == "AAPL"
    assert first["score"] == 88.0
    assert first["rank"] == 1
    assert first["flags"] == [{"label": "목표가 대비 +20%", "kind": "value"}]
    # base_date는 응답 항목에 노출하지 않음(as_of로 대체)
    assert "base_date" not in first
    # read_recommendations 호출 인자: exclude_tickers=[] (추적종목 없음), limit 전달
    _, kwargs = mock_read.call_args
    assert kwargs.get("exclude_tickers") == []


def test_get_recommendations_excludes_caller_tracked():
    tracked = [{"ticker": "AAPL"}, {"ticker": "005930"}]
    with patch("routers.recommendations.storage.get_all_stocks", return_value=tracked), \
         patch("routers.recommendations.recommendation.read_recommendations",
               return_value=[]) as mock_read:
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    _, kwargs = mock_read.call_args
    assert sorted(kwargs.get("exclude_tickers")) == ["005930", "AAPL"]


def test_get_recommendations_passes_limit():
    with patch("routers.recommendations.storage.get_all_stocks", return_value=[]), \
         patch("routers.recommendations.recommendation.read_recommendations",
               return_value=[]) as mock_read:
        resp = client.get("/api/recommendations?limit=10")
    assert resp.status_code == 200
    _, kwargs = mock_read.call_args
    assert kwargs.get("limit") == 10


def test_get_recommendations_empty_graceful():
    with patch("routers.recommendations.storage.get_all_stocks", return_value=[]), \
         patch("routers.recommendations.recommendation.read_recommendations",
               return_value=[]):
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    data = resp.json()
    assert data["discovery"] == []
    assert data["as_of"] is None


def test_get_recommendations_no_live_external_call():
    # 요청 경로에서 배치/외부 fetch 금지 — read_recommendations(저장값)만 호출
    with patch("routers.recommendations.storage.get_all_stocks", return_value=[]), \
         patch("routers.recommendations.recommendation.read_recommendations",
               return_value=[]), \
         patch("routers.recommendations.recommendation.run_recommendation_batch") as mock_batch:
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    mock_batch.assert_not_called()


def test_get_recommendations_requires_auth():
    no_auth = FastAPI()
    no_auth.include_router(router)
    c = TestClient(no_auth)
    resp = c.get("/api/recommendations")
    assert resp.status_code in (401, 403)


def test_refresh_triggers_batch():
    with patch("routers.recommendations.scheduler._recommendation_work") as mock_work, \
         patch("routers.recommendations.job_runs.record"):
        resp = client.post("/api/recommendations/refresh?market=KR")
    assert resp.status_code == 202
    assert resp.json() == {"ok": True}
    mock_work.assert_called_once_with("KR")

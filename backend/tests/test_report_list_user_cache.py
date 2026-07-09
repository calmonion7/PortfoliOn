"""GET /api/report/list 캐시가 user_id별로 분리되는지 검증 (S1: 교차 사용자 캐시 유출 수정).

버그: get_list(loader)가 단일 전역 키("__global__")를 써서, TTL 60s 내 사용자 B가
사용자 A의 캐시된(개인화된) 포트폴리오 목록을 그대로 받을 수 있었다.
수정: get_list(user_id, loader)로 user_id별 키 분리.
"""
from unittest.mock import patch
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.report import router
from auth import get_current_user, get_current_user_or_api_key
import services.cache as cache_svc


@pytest.fixture(autouse=True)
def _clear_list_cache():
    cache_svc.invalidate_list()
    yield
    cache_svc.invalidate_list()


def _make_client(current_user: dict):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: current_user["id"]
    app.dependency_overrides[get_current_user_or_api_key] = lambda: current_user["id"]
    return TestClient(app)


_PORTFOLIOS = {
    "user-a": {"stocks": [{"ticker": "AAA", "name": "A사", "competitors": [], "moat": "", "growth_plan": ""}],
               "watchlist": []},
    "user-b": {"stocks": [{"ticker": "BBB", "name": "B사", "competitors": [], "moat": "", "growth_plan": ""}],
               "watchlist": []},
}


def test_get_list_does_not_leak_across_users():
    current_user = {"id": "user-a"}
    client = _make_client(current_user)

    with patch("routers.report.query", return_value=[]), \
         patch("routers.report.storage.get_full_portfolio", side_effect=lambda uid: _PORTFOLIOS[uid]), \
         patch("routers.report.storage.get_schedule", return_value={}), \
         patch("routers.report.storage.expected_report_dates", return_value={}):
        resp_a = client.get("/api/report/list")
        current_user["id"] = "user-b"
        resp_b = client.get("/api/report/list")

    assert resp_a.status_code == 200 and resp_b.status_code == 200
    stocks_a = resp_a.json()["stocks"]
    stocks_b = resp_b.json()["stocks"]
    assert "AAA" in stocks_a and "BBB" not in stocks_a
    # user B는 여전히 TTL 내지만 own 데이터를 받아야 한다 (user A 캐시 유출 금지)
    assert "BBB" in stocks_b and "AAA" not in stocks_b


def test_get_list_same_user_second_call_hits_cache_within_ttl():
    current_user = {"id": "user-a"}
    client = _make_client(current_user)
    calls = []

    def _tracking_full_portfolio(uid):
        calls.append(uid)
        return _PORTFOLIOS[uid]

    with patch("routers.report.query", return_value=[]), \
         patch("routers.report.storage.get_full_portfolio", side_effect=_tracking_full_portfolio), \
         patch("routers.report.storage.get_schedule", return_value={}), \
         patch("routers.report.storage.expected_report_dates", return_value={}):
        client.get("/api/report/list")
        client.get("/api/report/list")

    assert calls == ["user-a"]  # 두 번째 호출은 캐시 히트 → loader(빌더) 재호출 없음

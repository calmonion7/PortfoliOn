from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch
from routers.admin import router
from auth import get_current_user, require_admin

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "admin-id"
app.dependency_overrides[require_admin] = lambda: "admin-id"
client = TestClient(app)

USERS = [
    {"id": "admin-id", "email": "admin@test.com", "role": "admin", "oauth_provider": None},
    {"id": "user-1",   "email": "user1@test.com", "role": "user",  "oauth_provider": None},
]


def test_get_users_returns_list():
    perm_rows = [{"user_id": "user-1", "menu": "portfolio", "enabled": True}]
    with patch("routers.admin.query", side_effect=[USERS, perm_rows]):
        resp = client.get("/api/admin/users")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2


def test_put_permissions_updates_user():
    body = {"permissions": {"portfolio": True, "research": False, "market": False,
                            "guru": True, "settings": False}}
    with patch("routers.admin.execute") as mock_exec:
        resp = client.put("/api/admin/users/user-1/permissions", json=body)
    assert resp.status_code == 200
    assert mock_exec.call_count == 5  # one upsert per menu key


def test_bulk_permissions_updates_multiple_users():
    body = {
        "user_ids": ["user-1", "user-2"],
        "permissions": {"portfolio": True, "research": True, "market": False,
                        "guru": False, "settings": False},
    }
    with patch("routers.admin.execute") as mock_exec:
        resp = client.post("/api/admin/users/bulk-permissions", json=body)
    assert resp.status_code == 200
    assert mock_exec.call_count == 10  # 2 users × 5 menus


def test_non_admin_blocked():
    no_admin_app = FastAPI()
    no_admin_app.include_router(router)
    no_admin_app.dependency_overrides[get_current_user] = lambda: "user-1"
    c = TestClient(no_admin_app)
    with patch("auth.auth_service.get_user_by_id", return_value={"role": "user"}):
        resp = c.get("/api/admin/users")
    assert resp.status_code == 403


# --- Analytics endpoints ---

SUMMARY_ROWS = [
    {"event_name": "nav_portfolio", "cnt": 5},
    {"event_name": "nav_research",  "cnt": 3},
]
DAU_ROWS = [{"dau": 2}]
TOTAL_ROWS = [{"total": 8}]

USERS_ROWS_ANALYTICS = [
    {"user_id": "user-1", "email": "a@test.com", "total_events": 8, "last_active": None},
]

HISTORY_ROWS = [
    {"event_name": "nav_portfolio", "properties": {}, "created_at": None},
]


def test_analytics_summary_returns_data():
    with patch("routers.admin.query", side_effect=[DAU_ROWS, TOTAL_ROWS, SUMMARY_ROWS]):
        resp = client.get("/api/admin/analytics/summary?days=7")
    assert resp.status_code == 200
    data = resp.json()
    assert "dau" in data
    assert "total_events" in data
    assert "top_events" in data


def test_analytics_events_timeline():
    timeline_rows = [{"date": "2026-06-03", "event_name": "nav_portfolio", "count": 3}]
    with patch("routers.admin.query", return_value=timeline_rows):
        resp = client.get("/api/admin/analytics/events?days=7")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_analytics_users_list():
    with patch("routers.admin.query", return_value=USERS_ROWS_ANALYTICS):
        resp = client.get("/api/admin/analytics/users")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["email"] == "a@test.com"


def test_analytics_user_history():
    with patch("routers.admin.query", return_value=HISTORY_ROWS):
        resp = client.get("/api/admin/analytics/users/user-1")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# --- Global stock delete (admin force-remove across ALL users) ---
def test_delete_stock_all_users_removes_across_users():
    with patch("routers.admin.execute", return_value=2) as mock_exec:
        resp = client.delete("/api/admin/stocks/aapl")
    assert resp.status_code == 200
    assert resp.json() == {"deleted": 2, "ticker": "AAPL"}
    sql, params = mock_exec.call_args.args
    # 전 사용자 대상이어야 한다 — 소유자(user_id) 필터가 없어야 보유·관심 모든 행이 지워진다
    assert "user_stocks" in sql and "user_id" not in sql
    assert params == ("AAPL",)


def test_delete_stock_all_users_missing_is_idempotent():
    with patch("routers.admin.execute", return_value=0):
        resp = client.delete("/api/admin/stocks/ZZZZ")
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 0


def test_delete_stock_all_users_blocked_for_non_admin():
    no_admin_app = FastAPI()
    no_admin_app.include_router(router)
    no_admin_app.dependency_overrides[get_current_user] = lambda: "user-1"
    c = TestClient(no_admin_app)
    with patch("auth.auth_service.get_user_by_id", return_value={"role": "user"}):
        resp = c.delete("/api/admin/stocks/AAPL")
    assert resp.status_code == 403

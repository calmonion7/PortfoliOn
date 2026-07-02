"""S6 — list_users permissions are fetched in one batch query, not N per-user queries."""
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, call
from routers.admin import router, ALL_MENUS
from auth import get_current_user, require_admin

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "admin-id"
app.dependency_overrides[require_admin] = lambda: "admin-id"
client = TestClient(app)

USERS = [
    {"id": "admin-id", "email": "admin@test.com", "role": "admin",  "oauth_provider": None},
    {"id": "user-1",   "email": "user1@test.com", "role": "user",   "oauth_provider": None},
    {"id": "user-2",   "email": "user2@test.com", "role": "user",   "oauth_provider": "google"},
]

PERM_ROWS = [
    {"user_id": "user-1", "menu": "portfolio", "enabled": True},
    {"user_id": "user-1", "menu": "research",  "enabled": True},
    {"user_id": "user-2", "menu": "market",    "enabled": False},
]


def test_list_users_response_shape():
    """Response has id/email/role/oauth_provider/permissions for every user."""
    with patch("routers.admin.query", side_effect=[USERS, PERM_ROWS]):
        resp = client.get("/api/admin/users")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 3
    for item in data:
        assert set(item.keys()) == {"id", "email", "role", "oauth_provider", "permissions"}
        assert set(item["permissions"].keys()) == set(ALL_MENUS)


def test_list_users_admin_gets_all_true():
    with patch("routers.admin.query", side_effect=[USERS, PERM_ROWS]):
        data = client.get("/api/admin/users").json()
    admin_entry = next(d for d in data if d["id"] == "admin-id")
    assert all(admin_entry["permissions"].values())


def test_list_users_user_perms_applied():
    with patch("routers.admin.query", side_effect=[USERS, PERM_ROWS]):
        data = client.get("/api/admin/users").json()
    u1 = next(d for d in data if d["id"] == "user-1")
    assert u1["permissions"]["portfolio"] is True
    assert u1["permissions"]["research"] is True
    assert u1["permissions"]["guru"] is False  # not in PERM_ROWS → default False


def test_list_users_query_count_is_two():
    """Only 2 DB queries: one for users, one batch for all permissions."""
    with patch("routers.admin.query", side_effect=[USERS, PERM_ROWS]) as mock_q:
        client.get("/api/admin/users")
    assert mock_q.call_count == 2
    # second call must use ANY(%s) — batch, not per-user
    second_sql = mock_q.call_args_list[1].args[0]
    assert "ANY" in second_sql

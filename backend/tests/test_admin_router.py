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
    {"id": "admin-id", "email": "admin@test.com", "role": "admin"},
    {"id": "user-1",   "email": "user1@test.com", "role": "user"},
]
PERMS = [{"menu": "portfolio", "enabled": True}, {"menu": "research", "enabled": True}]


def test_get_users_returns_list():
    with patch("routers.admin.query", return_value=USERS), \
         patch("routers.admin._get_user_permissions", return_value={"portfolio": True}):
        resp = client.get("/api/admin/users")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2


def test_put_permissions_updates_user():
    body = {"permissions": {"portfolio": True, "research": False, "market": False,
                            "analysis": False, "guru": True, "settings": False}}
    with patch("routers.admin.execute") as mock_exec:
        resp = client.put("/api/admin/users/user-1/permissions", json=body)
    assert resp.status_code == 200
    assert mock_exec.call_count == 6  # one upsert per menu key


def test_bulk_permissions_updates_multiple_users():
    body = {
        "user_ids": ["user-1", "user-2"],
        "permissions": {"portfolio": True, "research": True, "market": False,
                        "analysis": False, "guru": False, "settings": False},
    }
    with patch("routers.admin.execute") as mock_exec:
        resp = client.post("/api/admin/users/bulk-permissions", json=body)
    assert resp.status_code == 200
    assert mock_exec.call_count == 12  # 2 users × 6 menus


def test_non_admin_blocked():
    no_admin_app = FastAPI()
    no_admin_app.include_router(router)
    no_admin_app.dependency_overrides[get_current_user] = lambda: "user-1"
    c = TestClient(no_admin_app)
    with patch("auth.auth_service.get_user_by_id", return_value={"role": "user"}):
        resp = c.get("/api/admin/users")
    assert resp.status_code == 403

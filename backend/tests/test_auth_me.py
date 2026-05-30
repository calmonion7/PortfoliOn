from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch
from routers.auth import router
from auth import get_current_user

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "user-123"
client = TestClient(app)

ADMIN_USER = {"id": "user-123", "email": "admin@test.com", "role": "admin"}
NORMAL_USER = {"id": "user-123", "email": "user@test.com", "role": "user"}


def test_me_admin_returns_all_menus():
    with patch("services.auth_service.get_user_by_id", return_value=ADMIN_USER):
        resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "admin"
    assert set(data["menu_permissions"]) == {"portfolio", "research", "market", "analysis", "guru", "settings"}


def test_me_user_returns_enabled_menus():
    perm_rows = [
        {"menu": "portfolio", "enabled": True},
        {"menu": "research", "enabled": True},
        {"menu": "market", "enabled": False},
    ]
    with patch("services.auth_service.get_user_by_id", return_value=NORMAL_USER), \
         patch("services.db.query", return_value=perm_rows):
        resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "user"
    assert "portfolio" in data["menu_permissions"]
    assert "market" not in data["menu_permissions"]

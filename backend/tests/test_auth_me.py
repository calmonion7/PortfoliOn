from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch
from routers.auth import router, ALL_MENUS
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
    # 이 단언의 축은 "admin이면 전체 메뉴를 받는다"이고, 6항목 리터럴은 그 수단이었다.
    # 리터럴이 auth.py의 잔존 6번째 키 'analysis'를 고정하고 있었는데, 그 키는
    # 정본 4소스(admin.py·PermissionPanel.jsx·app_schema.sql 시드) 어디에도 없고
    # ADR-0025가 "ALL_MENUS 5키 불변"을 경계로 못박고 있다(이 테스트를 만든 커밋
    # d7df218은 forge 도입 이전이라 대응 계획서가 없다 — 즉 리터럴은 기록된 결정이 아니다).
    # 그래서 축을 유지하면서 정본을 참조하는 상대 단언으로 바꾼다
    # (형제 test_admin_users_perms_batch.py의 `set(ALL_MENUS)`와 같은 형태).
    # 집합 자체의 드리프트는 tests/test_all_menus_single_source.py가 감시한다.
    assert set(data["menu_permissions"]) == set(ALL_MENUS)


def test_me_user_returns_enabled_menus():
    perm_rows = [
        {"menu": "portfolio"},
        {"menu": "research"},
    ]
    with patch("services.auth_service.get_user_by_id", return_value=NORMAL_USER), \
         patch("services.db.query", return_value=perm_rows):
        resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "user"
    assert "portfolio" in data["menu_permissions"]
    assert "market" not in data["menu_permissions"]

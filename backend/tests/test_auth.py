import os
import pytest
import jwt
from unittest.mock import patch, MagicMock
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from fastapi import HTTPException
from services import auth_service
from auth import require_admin, get_current_user


def _make_token(secret: str, sub: str = "user-123") -> str:
    return jwt.encode(
        {"sub": sub, "aud": "authenticated"},
        secret,
        algorithm="HS256",
    )


def test_valid_token_returns_user_id(monkeypatch):
    secret = "testsecret"
    monkeypatch.setenv("SUPABASE_JWT_SECRET", secret)
    token = _make_token(secret)
    payload = jwt.decode(token, secret, algorithms=["HS256"], audience="authenticated")
    assert payload["sub"] == "user-123"


def test_invalid_token_raises():
    with pytest.raises(jwt.PyJWTError):
        jwt.decode("badtoken", "secret", algorithms=["HS256"], audience="authenticated")


def test_wrong_secret_raises():
    token = _make_token("correctsecret")
    with pytest.raises(jwt.PyJWTError):
        jwt.decode(token, "wrongsecret", algorithms=["HS256"], audience="authenticated")


def test_get_user_by_id_returns_user():
    fake_user = {"id": "abc-123", "email": "test@example.com", "role": "user"}
    with patch("services.auth_service.query", return_value=[fake_user]):
        result = auth_service.get_user_by_id("abc-123")
    assert result == fake_user


def test_get_user_by_id_returns_none_when_not_found():
    with patch("services.auth_service.query", return_value=[]):
        result = auth_service.get_user_by_id("nonexistent")
    assert result is None


def _make_app(role: str):
    _app = FastAPI()
    _app.dependency_overrides[get_current_user] = lambda: "user-123"

    @_app.get("/test-admin")
    def protected(uid: str = Depends(require_admin)):
        return {"uid": uid}

    return _app


def test_require_admin_allows_admin():
    _app = _make_app("admin")
    with patch("auth.auth_service.get_user_by_id", return_value={"role": "admin"}):
        c = TestClient(_app)
        resp = c.get("/test-admin")
    assert resp.status_code == 200
    assert resp.json()["uid"] == "user-123"


def test_require_admin_blocks_user():
    _app = _make_app("user")
    with patch("auth.auth_service.get_user_by_id", return_value={"role": "user"}):
        c = TestClient(_app)
        resp = c.get("/test-admin")
    assert resp.status_code == 403

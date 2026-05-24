import os
import pytest
import jwt


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

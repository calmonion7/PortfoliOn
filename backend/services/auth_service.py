# backend/services/auth_service.py
from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext
from psycopg2.extras import RealDictCursor

from services.db import get_connection, query, execute

_pwd = CryptContext(schemes=["bcrypt"])

_ACCESS_EXPIRE = timedelta(hours=1)
_REFRESH_EXPIRE = timedelta(days=30)


def _secret() -> str:
    return os.environ["JWT_SECRET"]


# ── 비밀번호 ──────────────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return _pwd.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd.verify(plain, hashed)


# ── 사용자 조회/생성 ───────────────────────────────────────────────────────────

def get_user_by_email(email: str) -> dict | None:
    rows = query("SELECT * FROM users WHERE email = %s", (email,))
    return rows[0] if rows else None


def create_user(email: str, password: str | None = None) -> dict:
    rows = query(
        "INSERT INTO users (email, password_hash) VALUES (%s, %s) RETURNING *",
        (email, hash_password(password) if password else None),
    )
    return rows[0]


def upsert_oauth_user(email: str, provider: str, sub: str) -> dict:
    """OAuth 사용자 조회 → 없으면 생성, 있으면 provider 연결."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM users WHERE oauth_provider = %s AND oauth_sub = %s",
                (provider, sub),
            )
            row = cur.fetchone()
            if row:
                return dict(row)

            cur.execute("SELECT * FROM users WHERE email = %s", (email,))
            row = cur.fetchone()
            if row:
                cur.execute(
                    "UPDATE users SET oauth_provider=%s, oauth_sub=%s WHERE id=%s RETURNING *",
                    (provider, sub, row["id"]),
                )
                return dict(cur.fetchone())

            cur.execute(
                "INSERT INTO users (email, oauth_provider, oauth_sub) VALUES (%s, %s, %s) RETURNING *",
                (email, provider, sub),
            )
            return dict(cur.fetchone())


# ── JWT / Refresh Token ───────────────────────────────────────────────────────

def issue_tokens(user_id: str) -> dict:
    now = datetime.now(timezone.utc)
    access = jwt.encode(
        {"sub": user_id, "exp": now + _ACCESS_EXPIRE},
        _secret(),
        algorithm="HS256",
    )
    refresh = secrets.token_urlsafe(64)
    execute(
        "INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (%s, %s, %s)",
        (user_id, refresh, now + _REFRESH_EXPIRE),
    )
    return {"access_token": access, "refresh_token": refresh, "token_type": "bearer"}


def verify_access_token(token: str) -> str:
    """유효한 토큰이면 user_id(str) 반환, 아니면 JWTError 발생."""
    payload = jwt.decode(token, _secret(), algorithms=["HS256"])
    return payload["sub"]


def consume_refresh_token(token: str) -> str | None:
    """유효한 refresh token이면 user_id 반환 (만료 토큰은 None)."""
    rows = query(
        "SELECT user_id, expires_at FROM refresh_tokens WHERE token = %s",
        (token,),
    )
    if not rows:
        return None
    expires_at = rows[0]["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        return None
    return str(rows[0]["user_id"])


def revoke_refresh_token(token: str) -> None:
    execute("DELETE FROM refresh_tokens WHERE token = %s", (token,))

# backend/auth.py
import os
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from services import auth_service

_bearer = HTTPBearer(auto_error=False)

_API_KEY_HEADER = "X-API-Key"
# sentinel user_id returned when authenticated via API key
_API_KEY_USER_ID = "__api_key__"


def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> str:
    if not creds:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = jwt.decode(
            creds.credentials,
            os.environ["JWT_SECRET"],
            algorithms=["HS256"],
        )
        return payload["sub"]
    except (JWTError, KeyError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


def get_current_user_or_api_key(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> str:
    """JWT Bearer token 또는 X-API-Key 헤더 중 하나로 인증(진짜 OR).

    한쪽 자격증명이 무효여도 다른 한쪽이 유효하면 통과한다 — 전에는 키 헤더가 *있지만 틀리면*
    유효한 Bearer를 검사하지도 않고 401을 던져 사실상 「키가 있으면 키만」이었다(B73).
    둘 다 유효하면 키를 우선한다(기존 동작 보존).
    """
    api_key = request.headers.get(_API_KEY_HEADER)
    if api_key:
        expected = os.environ.get("COWORK_API_KEY", "")
        if expected and api_key == expected:
            return _API_KEY_USER_ID
    if creds:
        try:
            payload = jwt.decode(
                creds.credentials,
                os.environ["JWT_SECRET"],
                algorithms=["HS256"],
            )
            return payload["sub"]
        except (JWTError, KeyError):
            pass
    if api_key:
        # 키를 보냈는데 둘 다 실패한 경우엔 기존 진단 문구를 유지한다(Cowork가 키 오류를 구별).
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")


def require_admin(user_id: str = Depends(get_current_user)) -> str:
    user = auth_service.get_user_by_id(user_id)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user_id


def require_admin_or_api_key(
    request: Request,
    user_id: str = Depends(get_current_user_or_api_key),
) -> str:
    """API 키 또는 어드민 JWT 중 하나로 인증."""
    if user_id == _API_KEY_USER_ID:
        return user_id
    user = auth_service.get_user_by_id(user_id)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user_id

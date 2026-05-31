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
    """JWT Bearer token 또는 X-API-Key 헤더 중 하나로 인증."""
    api_key = request.headers.get(_API_KEY_HEADER)
    if api_key:
        expected = os.environ.get("COWORK_API_KEY", "")
        if expected and api_key == expected:
            return _API_KEY_USER_ID
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
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
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")


def require_admin(user_id: str = Depends(get_current_user)) -> str:
    user = auth_service.get_user_by_id(user_id)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user_id

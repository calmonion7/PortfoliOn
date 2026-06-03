# backend/routers/auth.py
import hashlib
import hmac
import os
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from starlette.requests import Request

from auth import get_current_user
from services import auth_service
from services import db as db_service

router = APIRouter(prefix="/api/auth", tags=["auth"])

_HMAC_SECRET = os.environ.get("SESSION_SECRET", "dev-secret").encode()

def _make_state() -> str:
    nonce = secrets.token_urlsafe(16)
    sig = hmac.new(_HMAC_SECRET, nonce.encode(), hashlib.sha256).hexdigest()[:20]
    return f"{nonce}.{sig}"

def _verify_state(state: str) -> bool:
    parts = state.rsplit(".", 1)
    if len(parts) != 2:
        return False
    nonce, sig = parts
    expected = hmac.new(_HMAC_SECRET, nonce.encode(), hashlib.sha256).hexdigest()[:20]
    return hmac.compare_digest(sig, expected)


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/register", status_code=201)
def register(req: RegisterRequest):
    if auth_service.get_user_by_email(req.email):
        raise HTTPException(400, "Email already registered")
    user = auth_service.create_user(req.email, req.password)
    auth_service.apply_default_permissions(str(user["id"]))
    return {"message": "Registered successfully"}


@router.post("/login")
def login(req: LoginRequest):
    user = auth_service.get_user_by_email(req.email)
    if not user or not user.get("password_hash"):
        raise HTTPException(401, "Invalid credentials")
    if not auth_service.verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    return auth_service.issue_tokens(str(user["id"]))


@router.post("/refresh")
def refresh(req: RefreshRequest):
    user_id = auth_service.consume_refresh_token(req.refresh_token)
    if not user_id:
        raise HTTPException(401, "Invalid or expired refresh token")
    return auth_service.issue_tokens(user_id)


@router.post("/logout")
def logout(req: RefreshRequest):
    auth_service.revoke_refresh_token(req.refresh_token)
    return {"message": "Logged out"}


ALL_MENUS = ["portfolio", "research", "market", "analysis", "guru", "settings"]


@router.get("/me")
def me(user_id: str = Depends(get_current_user)):
    user = auth_service.get_user_by_id(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user["role"] == "admin":
        menu_permissions = ALL_MENUS
    else:
        rows = db_service.query(
            "SELECT menu FROM user_menu_permissions WHERE user_id = %s AND enabled = true",
            (user_id,),
        )
        menu_permissions = [r["menu"] for r in rows]
    return {
        "user_id": user_id,
        "email": user["email"],
        "role": user["role"],
        "menu_permissions": menu_permissions,
    }


@router.get("/oauth/google")
async def oauth_google(request: Request):
    state = _make_state()
    redirect_uri = os.environ["FRONTEND_URL"] + "/api/auth/oauth/google/callback"
    params = urlencode({
        "response_type": "code",
        "client_id": os.environ["GOOGLE_CLIENT_ID"],
        "redirect_uri": redirect_uri,
        "scope": "openid email profile",
        "state": state,
    })
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")


@router.get("/oauth/google/callback")
async def oauth_google_callback(request: Request):
    state = request.query_params.get("state", "")
    if not _verify_state(state):
        raise HTTPException(status_code=400, detail="Invalid state")
    code = request.query_params.get("code")
    redirect_uri = os.environ["FRONTEND_URL"] + "/api/auth/oauth/google/callback"
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={"code": code, "client_id": os.environ["GOOGLE_CLIENT_ID"],
                  "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
                  "redirect_uri": redirect_uri, "grant_type": "authorization_code"},
        )
    token_data = token_resp.json()
    id_token = token_data.get("id_token", "")
    from jose import jwt as jose_jwt
    userinfo = jose_jwt.decode(id_token, key="", options={"verify_signature": False})
    user = auth_service.upsert_oauth_user(userinfo["email"], "google", userinfo["sub"])
    auth_service.apply_default_permissions(str(user["id"]))
    tokens = auth_service.issue_tokens(str(user["id"]))
    frontend = os.environ["FRONTEND_URL"]
    return RedirectResponse(
        f"{frontend}/?token={tokens['access_token']}&refresh={tokens['refresh_token']}"
    )


@router.get("/oauth/github")
async def oauth_github(request: Request):
    state = _make_state()
    redirect_uri = os.environ["FRONTEND_URL"] + "/api/auth/oauth/github/callback"
    params = urlencode({
        "client_id": os.environ["GITHUB_CLIENT_ID"],
        "redirect_uri": redirect_uri,
        "scope": "user:email",
        "state": state,
    })
    return RedirectResponse(f"https://github.com/login/oauth/authorize?{params}")


@router.get("/oauth/github/callback")
async def oauth_github_callback(request: Request):
    state = request.query_params.get("state", "")
    if not _verify_state(state):
        raise HTTPException(status_code=400, detail="Invalid state")
    code = request.query_params.get("code")
    redirect_uri = os.environ["FRONTEND_URL"] + "/api/auth/oauth/github/callback"
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={"code": code, "client_id": os.environ["GITHUB_CLIENT_ID"],
                  "client_secret": os.environ["GITHUB_CLIENT_SECRET"],
                  "redirect_uri": redirect_uri},
        )
        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        headers = {"Authorization": f"token {access_token}", "Accept": "application/json"}
        profile_resp = await client.get("https://api.github.com/user", headers=headers)
        emails_resp = await client.get("https://api.github.com/user/emails", headers=headers)
    profile = profile_resp.json()
    emails = emails_resp.json()
    email = next(
        (e["email"] for e in emails if e.get("primary") and e.get("verified")),
        profile.get("email"),
    )
    user = auth_service.upsert_oauth_user(email, "github", str(profile["id"]))
    auth_service.apply_default_permissions(str(user["id"]))
    tokens = auth_service.issue_tokens(str(user["id"]))
    frontend = os.environ["FRONTEND_URL"]
    return RedirectResponse(
        f"{frontend}/?token={tokens['access_token']}&refresh={tokens['refresh_token']}"
    )

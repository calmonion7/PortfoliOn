# backend/routers/auth.py
import os

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from starlette.requests import Request

from auth import get_current_user
from services import auth_service
from services import db as db_service

router = APIRouter(prefix="/api/auth", tags=["auth"])

_oauth = OAuth()
_oauth.register(
    name="google",
    client_id=os.environ.get("GOOGLE_CLIENT_ID"),
    client_secret=os.environ.get("GOOGLE_CLIENT_SECRET"),
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)
_oauth.register(
    name="github",
    client_id=os.environ.get("GITHUB_CLIENT_ID"),
    client_secret=os.environ.get("GITHUB_CLIENT_SECRET"),
    access_token_url="https://github.com/login/oauth/access_token",
    authorize_url="https://github.com/login/oauth/authorize",
    api_base_url="https://api.github.com/",
    client_kwargs={"scope": "user:email"},
)


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
    redirect_uri = os.environ["FRONTEND_URL"] + "/api/auth/oauth/google/callback"
    return await _oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/oauth/google/callback")
async def oauth_google_callback(request: Request):
    token = await _oauth.google.authorize_access_token(request)
    userinfo = token.get("userinfo")
    user = auth_service.upsert_oauth_user(userinfo["email"], "google", userinfo["sub"])
    auth_service.apply_default_permissions(str(user["id"]))
    tokens = auth_service.issue_tokens(str(user["id"]))
    frontend = os.environ["FRONTEND_URL"]
    return RedirectResponse(
        f"{frontend}/?token={tokens['access_token']}&refresh={tokens['refresh_token']}"
    )


@router.get("/oauth/github")
async def oauth_github(request: Request):
    redirect_uri = os.environ["FRONTEND_URL"] + "/api/auth/oauth/github/callback"
    return await _oauth.github.authorize_redirect(request, redirect_uri)


@router.get("/oauth/github/callback")
async def oauth_github_callback(request: Request):
    token = await _oauth.github.authorize_access_token(request)
    resp = await _oauth.github.get("user", token=token)
    profile = resp.json()
    emails_resp = await _oauth.github.get("user/emails", token=token)
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

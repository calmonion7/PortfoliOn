# backend/routers/auth.py
from __future__ import annotations
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
from services import rate_limit

import time

router = APIRouter(prefix="/api/auth", tags=["auth"])

# B20 — bcrypt(login/register) DoS 방어 임계. 근거: .forge/adr/260823-085145-auth-rate-limit-in-process-cf-ip.md
_LOGIN_LIMIT, _LOGIN_WINDOW_S = 10, 300.0
_REGISTER_LIMIT, _REGISTER_WINDOW_S = 3, 3600.0


def _enforce_rate_limit(request: Request, scope: str, limit: int, window_s: float) -> None:
    retry_after = rate_limit.check(f"{scope}:{rate_limit.client_ip(request)}", limit, window_s)
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="Too many requests",
            headers={"Retry-After": str(max(1, round(retry_after)))},
        )

# Temp codes for OAuth token exchange (code -> (tokens, expiry))
_oauth_codes: dict = {}

def _store_oauth_tokens(tokens: dict) -> str:
    now = time.time()
    # eco: O(n) sweep on every insert; acceptable for low-volume OAuth flow
    expired = [k for k, (_, exp) in _oauth_codes.items() if exp < now]
    for k in expired:
        _oauth_codes.pop(k, None)  # pop: 동시 exchange가 먼저 제거해도 KeyError 없이 관용
    code = secrets.token_urlsafe(24)
    _oauth_codes[code] = (tokens, now + 120)
    return code

def _pop_oauth_tokens(code: str) -> dict | None:
    entry = _oauth_codes.pop(code, None)
    if entry is None:
        return None
    tokens, expiry = entry
    if time.time() > expiry:
        return None
    return tokens

def _hmac_secret() -> bytes:
    """OAuth state 서명키를 *호출 시점*에 해석한다 — 하드코딩 폴백 없음.

    임포트타임 바인딩 + 리터럴 폴백을 쓰면, main.py를 거치지 않는 진입점
    (스크립트·워커·테스트)이 load_dotenv 이전에 이 모듈을 임포트할 때
    그 리터럴이 실제 서명키로 박혀 누구나 state를 위조할 수 있다.
    미설정이면 조용히 서명하지 않고 명확히 실패한다 (wrong < missing).
    임포트타임 raise는 하지 않는다 — main 밖 진입점의 임포트를 통째로 막기 때문.
    """
    secret = os.environ.get("SESSION_SECRET")
    if not secret:
        raise RuntimeError("SESSION_SECRET is not set — cannot sign/verify OAuth state")
    return secret.encode()

def _make_state() -> str:
    nonce = secrets.token_urlsafe(16)
    sig = hmac.new(_hmac_secret(), nonce.encode(), hashlib.sha256).hexdigest()[:20]
    return f"{nonce}.{sig}"

def _verify_state(state: str) -> bool:
    parts = state.rsplit(".", 1)
    if len(parts) != 2:
        return False
    nonce, sig = parts
    expected = hmac.new(_hmac_secret(), nonce.encode(), hashlib.sha256).hexdigest()[:20]
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
def register(req: RegisterRequest, request: Request):
    _enforce_rate_limit(request, "register", _REGISTER_LIMIT, _REGISTER_WINDOW_S)
    if auth_service.get_user_by_email(req.email):
        raise HTTPException(400, "Email already registered")
    user = auth_service.create_user(req.email, req.password)
    auth_service.apply_default_permissions(str(user["id"]))
    return {"message": "Registered successfully"}


@router.post("/login")
def login(req: LoginRequest, request: Request):
    _enforce_rate_limit(request, "login", _LOGIN_LIMIT, _LOGIN_WINDOW_S)
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


# 메뉴 권한 키 정본 — admin.py·PermissionPanel.jsx·app_schema.sql 시드와 같은 집합이어야 한다
# (ADR-0025 "ALL_MENUS 5키 불변"). 드리프트 감시: tests/test_all_menus_single_source.py.
ALL_MENUS = ["portfolio", "research", "market", "guru", "settings"]


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


def _no_cache_redirect(url: str) -> RedirectResponse:
    r = RedirectResponse(url)
    r.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    r.headers["Pragma"] = "no-cache"
    return r


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
    return _no_cache_redirect(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")


@router.get("/oauth/google/callback")
async def oauth_google_callback(request: Request):
    if request.query_params.get("error"):
        frontend = os.environ.get("FRONTEND_URL", "")
        return _no_cache_redirect(f"{frontend}/?error=oauth_denied")
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
    if not id_token or id_token.count(".") < 2:
        frontend = os.environ.get("FRONTEND_URL", "")
        return _no_cache_redirect(f"{frontend}/?error=oauth_failed")
    import base64 as _b64, json as _json
    _payload = id_token.split(".")[1] + "=="
    userinfo = _json.loads(_b64.urlsafe_b64decode(_payload))
    user = auth_service.upsert_oauth_user(userinfo["email"], "google", userinfo["sub"])
    auth_service.apply_default_permissions(str(user["id"]))
    tokens = auth_service.issue_tokens(str(user["id"]))
    code = _store_oauth_tokens(tokens)
    frontend = os.environ["FRONTEND_URL"]
    return _no_cache_redirect(f"{frontend}/?oauth={code}")


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
    return _no_cache_redirect(f"https://github.com/login/oauth/authorize?{params}")


@router.get("/oauth/github/callback")
async def oauth_github_callback(request: Request):
    # 거절/에러 콜백엔 code가 없다 — state 검증보다 먼저 판정해 프론트로 되돌린다
    # (구글 콜백과 같은 순서·같은 에러 파라미터).
    if request.query_params.get("error"):
        frontend = os.environ.get("FRONTEND_URL", "")
        return _no_cache_redirect(f"{frontend}/?error=oauth_denied")
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
        if not access_token:
            # 토큰교환 실패(만료 code·client_secret 불일치 등) — 프로필 조회로 진행하면
            # 401 응답을 파싱하다 raw 500이 된다.
            frontend = os.environ.get("FRONTEND_URL", "")
            return _no_cache_redirect(f"{frontend}/?error=oauth_failed")
        headers = {"Authorization": f"token {access_token}", "Accept": "application/json"}
        profile_resp = await client.get("https://api.github.com/user", headers=headers)
        emails_resp = await client.get("https://api.github.com/user/emails", headers=headers)
    profile = profile_resp.json()
    emails = emails_resp.json()
    frontend = os.environ.get("FRONTEND_URL", "")
    # 토큰교환 *이후* 두 콜의 에러 본문을 성공 본문처럼 파싱하면 미포착 500이 된다:
    #   ⓐ `/user`가 에러 dict면 `profile["id"]` → KeyError
    #   ⓑ `/user/emails`가 리스트가 아닌 에러 dict면 `for e in emails`가 키 문자열을 순회 →
    #      AttributeError('str' object has no attribute 'get')
    #   ⓒ primary+verified도 프로필 이메일도 없으면 email=None이 upsert까지 도달 →
    #      `users.email TEXT UNIQUE NOT NULL` 위반(IntegrityError)
    # 판정은 status_code가 아니라 **본문 형태**로 한다 — `/user/emails`만 실패하고 프로필
    # 이메일이 공개된 사용자는 여전히 로그인할 수 있어야 하며(그 폴백이 아래 next()의 설계
    # 의도다), status_code 일괄 검사는 성공 가능한 로그인을 막는다.
    if not isinstance(profile, dict) or not profile.get("id"):
        return _no_cache_redirect(f"{frontend}/?error=oauth_failed")
    email = next(
        (
            e["email"]
            for e in (emails if isinstance(emails, list) else [])
            if isinstance(e, dict) and e.get("primary") and e.get("verified") and e.get("email")
        ),
        profile.get("email"),
    )
    if not email:
        # 이메일을 확정하지 못했다 — 여기서 멈추지 않으면 NOT NULL 위반으로 raw 500이 된다.
        return _no_cache_redirect(f"{frontend}/?error=oauth_failed")
    user = auth_service.upsert_oauth_user(email, "github", str(profile["id"]))
    auth_service.apply_default_permissions(str(user["id"]))
    tokens = auth_service.issue_tokens(str(user["id"]))
    code = _store_oauth_tokens(tokens)
    frontend = os.environ["FRONTEND_URL"]
    return _no_cache_redirect(f"{frontend}/?oauth={code}")

@router.get("/oauth/token")
def oauth_token_exchange(code: str):
    tokens = _pop_oauth_tokens(code)
    if not tokens:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth code")
    return tokens

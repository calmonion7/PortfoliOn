"""GitHub OAuth 콜백의 실패 경로 가드 (B72).

대조군은 같은 파일의 `oauth_google_callback`이다 — 거절은 `?error=oauth_denied`,
토큰교환 실패는 `?error=oauth_failed`로 프론트에 리다이렉트하고 `_no_cache_redirect`를 쓴다.
GitHub 콜백은 그 두 가드가 없어 거절 시 400(무상태)·500(유효상태)으로 새어나갔다.
"""
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.auth as auth_mod

app = FastAPI()
app.include_router(auth_mod.router)
client = TestClient(app, follow_redirects=False)

FRONTEND = "https://front.example"


@pytest.fixture(autouse=True)
def _oauth_env(monkeypatch):
    monkeypatch.setenv("FRONTEND_URL", FRONTEND)
    monkeypatch.setenv("GITHUB_CLIENT_ID", "gh-id")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "gh-secret")
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret")


class _FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


class _FakeClient:
    """httpx.AsyncClient 대역 — 호출을 기록해 '네트워크에 닿았는가'를 단언 가능하게 한다."""

    def __init__(self, token_payload=None):
        self.token_payload = token_payload if token_payload is not None else {}
        self.posts = []
        self.gets = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        return False

    async def post(self, url, **_k):
        self.posts.append(url)
        return _FakeResp(self.token_payload)

    async def get(self, url, **_k):
        self.gets.append(url)
        return _FakeResp({})


def _valid_state() -> str:
    return auth_mod._make_state()


def test_github_callback_denied_without_state_redirects_oauth_denied():
    """error 파라미터는 state 검증보다 *먼저* 판정된다 (구글 콜백과 같은 순서).

    사용자가 GitHub 동의 화면에서 취소하면 code가 없다 — 그때 400/500을 내지 않고
    프론트가 읽을 수 있는 에러 파라미터로 되돌린다.
    """
    resp = client.get("/api/auth/oauth/github/callback?error=access_denied")
    assert resp.status_code in (302, 307)
    assert resp.headers["location"] == f"{FRONTEND}/?error=oauth_denied"
    assert "no-store" in resp.headers["cache-control"]


def test_github_callback_denied_does_not_attempt_token_exchange():
    """거절 콜백은 토큰교환에 아예 닿지 않는다 (state가 유효해도)."""
    fake = _FakeClient()
    with patch("routers.auth.httpx.AsyncClient", return_value=fake):
        resp = client.get(
            f"/api/auth/oauth/github/callback?error=access_denied&state={_valid_state()}"
        )
    assert resp.status_code in (302, 307)
    assert resp.headers["location"] == f"{FRONTEND}/?error=oauth_denied"
    assert fake.posts == [], "거절 콜백에서 토큰교환을 시도했다"
    assert fake.gets == []


def test_github_callback_without_access_token_redirects_oauth_failed():
    """토큰교환 응답에 access_token이 없으면 프로필 조회로 진행하지 않고 oauth_failed."""
    fake = _FakeClient({"error": "bad_verification_code"})
    with patch("routers.auth.httpx.AsyncClient", return_value=fake):
        resp = client.get(
            f"/api/auth/oauth/github/callback?code=xyz&state={_valid_state()}"
        )
    assert resp.status_code in (302, 307)
    assert resp.headers["location"] == f"{FRONTEND}/?error=oauth_failed"
    assert "no-store" in resp.headers["cache-control"]
    assert fake.posts, "토큰교환은 시도되어야 한다 (이 축의 전제)"
    assert fake.gets == [], "access_token 없이 프로필/이메일을 조회했다"


# --- 토큰교환 *이후* 실패 경로 (적대 검토 #4·#5·#8) ---
#
# 위 3축은 토큰교환 전(거절)·중(access_token 부재)만 닫았다. 그 뒤 두 콜
# (`GET /user`·`GET /user/emails`)은 status_code도 본문 형태도 검사하지 않아
# **에러 본문을 성공 본문처럼 파싱**했고, 세 갈래로 미포착 500이 됐다:
#   ⓐ `/user/emails`가 리스트가 아닌 에러 dict → `for e in emails`가 **키 문자열**을
#      순회해 `AttributeError: 'str' object has no attribute 'get'`
#   ⓑ `/user`가 에러 dict → `profile["id"]`가 `KeyError: 'id'`
#   ⓒ primary+verified 이메일이 없고 프로필 이메일도 비공개 → `email=None`이
#      `upsert_oauth_user`까지 도달 → `users.email TEXT UNIQUE NOT NULL` 위반(IntegrityError)
# 세 경우 모두 사용자는 프론트로 돌아오지 못하고 JSON 500 페이지를 본다
# (`useAuthBootstrap.js`의 `?error=oauth_failed` 분기가 도달 불가).
#
# ⚠️ 판정은 status_code가 아니라 **본문 형태**로 한다 — `/user/emails`만 실패하고
# 프로필 이메일이 공개된 사용자는 여전히 로그인할 수 있어야 한다(그 폴백이 원래
# `next(..., profile.get("email"))`의 설계 의도다). status_code로 일괄 중단하면
# 성공 가능한 로그인을 막는다.


class _FakeClient2(_FakeClient):
    """URL별 GET 응답을 지정할 수 있는 대역 (`/user` ↔ `/user/emails`)."""

    def __init__(self, token_payload=None, profile=None, emails=None):
        super().__init__(token_payload if token_payload is not None else {"access_token": "gh-tok"})
        self.profile = profile if profile is not None else {}
        self.emails = emails if emails is not None else []

    async def get(self, url, **_k):
        self.gets.append(url)
        return _FakeResp(self.emails if url.endswith("/user/emails") else self.profile)


@pytest.fixture
def upsert_spy():
    """`upsert_oauth_user` 호출 인자를 관측 — 실패 경로에서 DB에 닿지 않음을 단언한다."""
    calls = []

    def _spy(email, provider, provider_id):
        calls.append({"email": email, "provider": provider, "provider_id": provider_id})
        return {"id": "user-uuid"}

    with patch.object(auth_mod.auth_service, "upsert_oauth_user", side_effect=_spy), \
         patch.object(auth_mod.auth_service, "apply_default_permissions"), \
         patch.object(auth_mod.auth_service, "issue_tokens", return_value={"access_token": "a", "refresh_token": "r"}):
        yield calls


def _github_cb(fake):
    with patch("routers.auth.httpx.AsyncClient", return_value=fake):
        return client.get(f"/api/auth/oauth/github/callback?code=xyz&state={_valid_state()}")


def test_github_callback_profile_error_body_redirects_oauth_failed(upsert_spy):
    """ⓑ `/user`가 에러 dict(id 없음)면 `profile["id"]` KeyError 대신 oauth_failed."""
    fake = _FakeClient2(profile={"message": "Bad credentials"}, emails=[])
    resp = _github_cb(fake)
    assert resp.status_code in (302, 307)
    assert resp.headers["location"] == f"{FRONTEND}/?error=oauth_failed"
    assert "no-store" in resp.headers["cache-control"]
    assert upsert_spy == [], "프로필 식별 실패인데 사용자 upsert를 시도했다"


def test_github_callback_emails_error_body_does_not_crash(upsert_spy):
    """ⓐ `/user/emails`가 에러 dict여도 키 문자열을 순회하지 않는다 (AttributeError 없음).

    프로필 이메일도 없으므로 결과는 oauth_failed — 크래시가 아니라 리다이렉트여야 한다.
    """
    fake = _FakeClient2(
        profile={"id": 12345, "email": None},
        emails={"message": "API rate limit exceeded", "documentation_url": "https://x"},
    )
    resp = _github_cb(fake)
    assert resp.status_code in (302, 307)
    assert resp.headers["location"] == f"{FRONTEND}/?error=oauth_failed"
    assert upsert_spy == [], "이메일 확정 실패인데 사용자 upsert를 시도했다"


def test_github_callback_emails_error_falls_back_to_public_profile_email(upsert_spy):
    """ⓐ의 대조군 — `/user/emails`만 실패하고 프로필 이메일이 공개면 로그인은 성공한다.

    이 축이 없으면 "형태가 이상하면 전부 oauth_failed"로 과도하게 닫아
    성공 가능한 로그인을 막는 변경이 통과한다(status_code 일괄 검사가 그 형태다).
    """
    fake = _FakeClient2(
        profile={"id": 12345, "email": "public@example.com"},
        emails={"message": "Bad credentials"},
    )
    resp = _github_cb(fake)
    assert resp.status_code in (302, 307)
    assert resp.headers["location"].startswith(f"{FRONTEND}/?oauth=")
    assert [c["email"] for c in upsert_spy] == ["public@example.com"]


def test_github_callback_no_resolvable_email_redirects_oauth_failed(upsert_spy):
    """ⓒ primary+verified 없고 프로필 이메일 비공개 → email=None이 DB에 닿지 않는다.

    `users.email`은 `TEXT UNIQUE NOT NULL`이라 None은 IntegrityError → 500이 된다.
    """
    fake = _FakeClient2(
        profile={"id": 12345, "email": None},
        emails=[{"email": "u@x.com", "primary": True, "verified": False}],
    )
    resp = _github_cb(fake)
    assert resp.status_code in (302, 307)
    assert resp.headers["location"] == f"{FRONTEND}/?error=oauth_failed"
    assert upsert_spy == [], f"email=None이 upsert까지 도달했다: {upsert_spy}"


def test_github_callback_verified_primary_email_still_wins(upsert_spy):
    """무회귀 — 정상 응답에서는 primary+verified 이메일로 로그인한다."""
    fake = _FakeClient2(
        profile={"id": 12345, "email": "public@example.com"},
        emails=[
            {"email": "alt@x.com", "primary": False, "verified": True},
            {"email": "primary@x.com", "primary": True, "verified": True},
        ],
    )
    resp = _github_cb(fake)
    assert resp.status_code in (302, 307)
    assert resp.headers["location"].startswith(f"{FRONTEND}/?oauth=")
    assert [c["email"] for c in upsert_spy] == ["primary@x.com"]

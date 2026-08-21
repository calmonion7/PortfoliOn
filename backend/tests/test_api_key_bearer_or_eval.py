"""B73 — `auth.get_current_user_or_api_key`가 이름대로 OR로 평가하는지 못박는다.

결함: `X-API-Key` 헤더가 **있지만 틀리면** 유효한 Bearer 토큰을 검사하지도 않고 401로 거부했다
(즉 「키 또는 사용자」가 아니라 사실상 「키가 있으면 키만」). 브라우저가 API 키를 함께 보내는
프록시/확장 환경이나 키가 회전된 직후에 로그인한 사용자가 조용히 401을 받는다.

override 없는 fresh app으로 실제 의존성을 태운다 — conftest의 `dependency_overrides`는
`main.app` 한정이므로 여기엔 걸리지 않는다(`tests/test_security_auth_gaps.py` 패턴).

판정 조합은 4개가 아니라 **6개**다: 4조합(한쪽만 유효 / 둘 다 유효 / 둘 다 무효)만으로는
「유효한 한쪽 + 무효한 다른 쪽」 경로를 지나지 않아 이 결함을 원리적으로 못 잡는다.
"""
import os

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jose import jwt
from unittest.mock import patch

from auth import (
    _API_KEY_USER_ID,
    get_current_user_or_api_key,
    require_admin_or_api_key,
)

_SECRET = "b73-test-jwt-secret"
_KEY = "b73-test-cowork-key"
_USER = "u-b73"


def _client():
    app = FastAPI()

    @app.get("/or-user")
    def _or_user(uid: str = Depends(get_current_user_or_api_key)):
        return {"uid": uid}

    @app.get("/or-admin")
    def _or_admin(uid: str = Depends(require_admin_or_api_key)):
        return {"uid": uid}

    return TestClient(app)


def _headers(bearer, key):
    """bearer/key: None | "valid" | "invalid"."""
    h = {}
    if bearer == "valid":
        h["Authorization"] = "Bearer " + jwt.encode({"sub": _USER}, _SECRET, algorithm="HS256")
    elif bearer == "invalid":
        h["Authorization"] = "Bearer " + jwt.encode({"sub": _USER}, "wrong-secret", algorithm="HS256")
    if key == "valid":
        h["X-API-Key"] = _KEY
    elif key == "invalid":
        h["X-API-Key"] = "wrong-key"
    return h


@pytest.fixture
def env():
    with patch.dict(os.environ, {"JWT_SECRET": _SECRET, "COWORK_API_KEY": _KEY}):
        yield


# (bearer, key, 기대 status, 기대 uid)
_COMBOS = [
    # 계획서가 지목한 4조합
    ("valid",   None,      200, _USER),            # Bearer만 유효
    (None,      "valid",   200, _API_KEY_USER_ID), # 키만 유효
    ("valid",   "valid",   200, _API_KEY_USER_ID), # 둘 다 유효 — 키 우선(기존 동작 보존)
    ("invalid", "invalid", 401, None),             # 둘 다 무효
    # 이 둘이 실제 이빨이다 — "유효한 한쪽 + 무효한 다른 쪽"
    ("valid",   "invalid", 200, _USER),            # ★ B73의 red: 틀린 키가 유효 Bearer를 가렸다
    ("invalid", "valid",   200, _API_KEY_USER_ID),
    # 자격증명 전무
    (None,      None,      401, None),
]


@pytest.mark.parametrize(
    "bearer,key,expected,uid",
    _COMBOS,
    ids=["bearer=%s,key=%s" % (b, k) for b, k, _, _ in _COMBOS],
)
def test_or_evaluation_matrix(env, bearer, key, expected, uid):
    r = _client().get("/or-user", headers=_headers(bearer, key))
    assert r.status_code == expected, r.text
    if uid is not None:
        assert r.json()["uid"] == uid


def test_unconfigured_api_key_does_not_mask_valid_bearer():
    """COWORK_API_KEY 미설정 환경에서 키 헤더가 와도 유효 Bearer는 통과해야 한다.

    미설정이면 어떤 키도 유효할 수 없으므로 키 헤더는 '없는 것'과 같아야 한다.
    """
    with patch.dict(os.environ, {"JWT_SECRET": _SECRET}):
        os.environ.pop("COWORK_API_KEY", None)
        r = _client().get("/or-user", headers=_headers("valid", "invalid"))
    assert r.status_code == 200, r.text
    assert r.json()["uid"] == _USER


# --- 형제 함수 require_admin_or_api_key — 같은 결함을 위임으로 상속한다 ---

def test_admin_bearer_survives_bad_api_key(env):
    """★ 형제 red: 어드민 JWT가 유효한데 틀린 키 헤더 때문에 401이 되던 경로."""
    import auth as auth_mod

    with patch.object(auth_mod.auth_service, "get_user_by_id", return_value={"role": "admin"}):
        r = _client().get("/or-admin", headers=_headers("valid", "invalid"))
    assert r.status_code == 200, r.text
    assert r.json()["uid"] == _USER


def test_non_admin_bearer_with_bad_api_key_is_403_not_401(env):
    """이빨 — 폴스루가 *실제로* 어드민 검사까지 도달했음을 상태코드로 구별한다.

    401이면 키 분기에서 막힌 것이고, 403이면 Bearer가 해석돼 role 검사를 탄 것이다.
    """
    import auth as auth_mod

    with patch.object(auth_mod.auth_service, "get_user_by_id", return_value={"role": "user"}):
        r = _client().get("/or-admin", headers=_headers("valid", "invalid"))
    assert r.status_code == 403, r.text


def test_admin_gate_still_rejects_bad_key_alone(env):
    """무회귀 — Bearer 없이 틀린 키만 오면 여전히 401(기존 test_security_auth_gaps 축과 동형)."""
    r = _client().get("/or-admin", headers=_headers(None, "invalid"))
    assert r.status_code == 401

"""SESSION_SECRET 하드코딩 폴백 제거 (B19).

`routers/auth.py`는 OAuth state 서명키를 임포트타임에 바인딩하며
`os.environ.get("SESSION_SECRET", "dev-secret")` 폴백을 갖고 있었다.
`main.py`의 `SessionMiddleware` 배선은 기동 시 fail-fast하지만(심볼 앵커 —
줄번호 포인터는 이 저장소가 금지한다: 같은 wave의 형제 슬라이스가 그 위에
34줄을 넣어 원래 적혀 있던 `:327`이 즉시 거짓이 됐다),
main을 거치지 않는 진입점(스크립트·워커·테스트)이 load_dotenv 이전에
`routers.auth`를 임포트하면 리터럴 'dev-secret'이 실제 서명키로 박힌다
(CONCERNS §5.5) — 그러면 누구나 유효한 state를 위조할 수 있다.

게이트는 "기동 불가로 만들지 않는 것"이므로 임포트타임 raise가 아니라
요청 시점 lazy 해석이어야 한다.
"""
import contextlib
import hashlib
import hmac
import importlib
import os

import pytest

import routers.auth as auth_mod

_FALLBACK_LITERAL = b"dev-secret"


def _sign(secret: bytes, nonce: str) -> str:
    """auth.py와 같은 방식으로 state를 만든다 (위조 시도용)."""
    sig = hmac.new(secret, nonce.encode(), hashlib.sha256).hexdigest()[:20]
    return f"{nonce}.{sig}"


@contextlib.contextmanager
def _reloaded_without_session_secret():
    """SESSION_SECRET이 없는 환경에서 모듈을 재임포트한다.

    monkeypatch로는 임포트타임 바인딩을 재현할 수 없어(이미 바인딩된 뒤다)
    실제 취약 경로를 재는 유일한 방법이 reload다.
    """
    original = os.environ.pop("SESSION_SECRET", None)
    try:
        yield importlib.reload(auth_mod)
    finally:
        if original is not None:
            os.environ["SESSION_SECRET"] = original
        importlib.reload(auth_mod)


def test_import_without_session_secret_does_not_raise():
    """회귀 가드(구동력 없음 — 수정 전에도 통과한다): 임포트타임 raise로 바꾸지 않았다.

    S6의 실질 제약이 이것이다 — 임포트에서 터지면 main 밖 진입점이 통째로 막힌다.
    """
    with _reloaded_without_session_secret() as mod:
        assert mod is auth_mod


def test_forged_state_signed_with_hardcoded_fallback_is_never_accepted():
    """미설정 환경에서 임포트돼도 리터럴 'dev-secret'이 서명키로 쓰이지 않는다.

    이것이 이 슬라이스의 구동 축이다 — 수정 전에는 위조 state가 통과했다.
    """
    forged = _sign(_FALLBACK_LITERAL, "attacker-nonce")
    with _reloaded_without_session_secret() as mod:
        try:
            accepted = mod._verify_state(forged)
        except RuntimeError:
            # 미설정을 명확히 거부 — 폴백으로 접지 않았다 (wrong < missing)
            accepted = False
        assert accepted is False, "하드코딩 폴백 'dev-secret'으로 서명한 state가 통과했다"


def test_make_state_without_session_secret_fails_loudly():
    """미설정 시 조용히 서명하지 않고 명확히 실패한다 (lazy 해석의 관측 가능성)."""
    with _reloaded_without_session_secret() as mod:
        with pytest.raises(RuntimeError):
            mod._make_state()


def test_secret_is_resolved_per_call_not_at_import(monkeypatch):
    """서명키는 호출 시점에 해석된다 — 비밀을 교체하면 옛 state가 즉시 무효화된다.

    reload 없이 lazy 해석을 재는 축(수정 전에는 임포트타임 값 하나만 쓰므로
    비밀 교체가 검증에 반영되지 않아 옛 state가 계속 통과했다).
    """
    monkeypatch.setenv("SESSION_SECRET", "secret-A")
    state = auth_mod._make_state()
    assert auth_mod._verify_state(state) is True

    monkeypatch.setenv("SESSION_SECRET", "secret-B")
    assert auth_mod._verify_state(state) is False

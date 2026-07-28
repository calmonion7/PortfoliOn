"""ADR-0029 회귀 게이트 — 무인증 `/api` 엔드포인트는 auth.py 공개 9개뿐 (task#233).

라이브 `app` 배선을 본다(AST/데코레이터 파싱 아님) — 각 엔드포인트 함수 파라미터 default가
`Depends(...)`이고 그 dependency가 4개 인증 의존성 중 하나인지, 그리고 라우트 수준
`dependencies=[...]`도 함께 검사한다. 그래서 의존성 주입 실수도 잡힌다.

허용목록은 `test_api_doc_sync.py`의 `KNOWN_UNDOCUMENTED`와 동형인 **exact-match 양방향**:
새 무인증이 생기면 실패(정책 위반 포착)하고, 목록에 있는데 인증이 걸렸거나 사라졌으면도
실패(stale 목록 정리 유도)한다. 핸들러를 실행하지 않고 라우트 메타데이터만 보므로 DB에 닿지 않는다.
"""
import inspect

from fastapi.params import Depends as DependsParam

import auth
from main import app
from tests._routes import walk_routes

AUTH_DEPS = {
    auth.get_current_user,
    auth.get_current_user_or_api_key,
    auth.require_admin,
    auth.require_admin_or_api_key,
}

# 정당한 공개 엔드포인트 — 로그인 자체(register/login/refresh/logout)와 OAuth 플로우.
# 이 목록에 추가하려면 ADR-0029를 먼저 개정할 것.
ALLOWED_PUBLIC = frozenset({
    ("POST", "/api/auth/register"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/refresh"),
    ("POST", "/api/auth/logout"),
    ("GET", "/api/auth/oauth/google"),
    ("GET", "/api/auth/oauth/google/callback"),
    ("GET", "/api/auth/oauth/github"),
    ("GET", "/api/auth/oauth/github/callback"),
    ("GET", "/api/auth/oauth/token"),
})


def _has_auth_dep(route) -> bool:
    """엔드포인트 함수 시그니처 또는 라우트 dependencies에 인증 의존성이 있는지."""
    for d in getattr(route, "dependencies", []) or []:
        if getattr(d, "dependency", None) in AUTH_DEPS:
            return True
    fn = getattr(route, "endpoint", None)
    if fn is None:
        return False
    try:
        sig = inspect.signature(fn)
    except (TypeError, ValueError):
        return False
    return any(
        isinstance(p.default, DependsParam) and p.default.dependency in AUTH_DEPS
        for p in sig.parameters.values()
    )


def _unauthenticated() -> set:
    out = set()
    for route in walk_routes(app.routes):
        if not route.path.startswith("/api/"):
            continue
        if _has_auth_dep(route):
            continue
        for m in getattr(route, "methods", None) or []:
            if m not in ("HEAD", "OPTIONS"):
                out.add((m, route.path))
    return out


def test_route_walk_is_not_silently_empty():
    """헬퍼가 라우트를 실제로 열거한다 — 0개를 세며 조용히 통과하는 실패 모드 차단.

    평탄 `app.routes` 순회는 배포 이미지(FastAPI 0.138+)에서 0개를 세므로, 이 단언이
    없으면 아래 두 테스트가 '무인증 0개'로 거짓 통과한다(감사 스크립트가 실제로 그랬다).
    """
    api_routes = [r for r in walk_routes(app.routes) if r.path.startswith("/api/")]
    assert len(api_routes) > 100, (
        f"/api 라우트가 {len(api_routes)}개뿐 — 라우트 순회가 깨졌을 가능성"
        f"(FastAPI 버전차로 include된 라우트를 못 찾는 경우). tests/_routes.py 확인")


def test_no_unauthenticated_endpoints_beyond_allowlist():
    """무인증 − 허용목록 == 공집합 (새 무인증 read/write 추가 즉시 실패)."""
    violations = _unauthenticated() - ALLOWED_PUBLIC
    assert not violations, (
        f"인증 의존성 없는 /api 엔드포인트 {len(violations)}개 — ADR-0029 위반. "
        f"get_current_user 등 인증 의존성을 추가하거나, 정당한 공개라면 ADR-0029를 개정하고 "
        f"ALLOWED_PUBLIC에 추가: {sorted(violations)}")


def test_allowlist_has_no_stale_entries():
    """허용목록 − 무인증 == 공집합 (인증이 걸렸거나 사라진 항목 정리 유도)."""
    stale = ALLOWED_PUBLIC - _unauthenticated()
    assert not stale, (
        f"ALLOWED_PUBLIC에 있으나 무인증이 아닌(인증이 걸렸거나 라우터에서 사라진) 항목: "
        f"{sorted(stale)}")

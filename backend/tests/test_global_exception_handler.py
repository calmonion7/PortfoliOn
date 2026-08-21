"""S3 (B72 부수) — 앱 전역 미포착 예외 핸들러.

배경: `main.py`에 일반 예외 핸들러가 없어서 미포착 예외가 starlette 기본 경로로
plain-text raw 500이 됐다. 프로덕션에서는 그 경로가 내부 메시지/스택 흔적을 그대로
내보낼 수 있고, 클라이언트는 JSON을 기대하는데 `text/plain`을 받아 파싱에도 실패한다.
`@app.exception_handler(Exception)`으로 **스택·내부 메시지 없는 구조화 JSON 500**으로 바꾼다.

이 파일이 지키는 4축:
  (1) 구조화 500 — status 500 · `application/json` · `{"detail": "Internal Server Error"}`,
      본문에 예외 메시지·타입명·"Traceback" 흔적 없음
  ⓐ `HTTPException`을 삼키지 않는다 — 라우팅 레벨(404·405)과 라우트 내부 raise(403)가
      각자의 상태코드·본문을 유지한다(starlette는 `Exception`/500 핸들러만
      ServerErrorMiddleware로 보내고 나머지는 ExceptionMiddleware에 두므로 원리적으로
      분리되지만, 그 분리는 등록 방식에 의존하니 행동으로 못박는다)
  ⓑ 응답 본문은 `services.utils.sanitize` 경유 — `JSONResponse`는 `allow_nan=False`라
      본문에 NaN/inf가 섞이면 **핸들러 자신이 500을 낸다**(핸들러가 핸들러를 필요로 하는 상태)
  ⓒ 기존 `RequestValidationError` 422 경로 무회귀 — 입력 NaN echo 500을 막는 앱 전역 장치가
      새 핸들러 등록으로 우선순위가 어긋나거나 가려지지 않는다

부수 핀: starlette `ServerErrorMiddleware`는 핸들러를 호출한 *뒤에도* 예외를 재raise한다
(`starlette/middleware/errors.py`의 "We always continue to raise the exception"). 그래서
`TestClient` 기본값(`raise_server_exceptions=True`)에서는 이 핸들러 등록 후에도 예외가
그대로 전파된다 — `from main import app`을 쓰는 기존 테스트들이 "예외 전파"를 기대하는
지점이 조용히 통과로 바뀌지 않는다. 그 성질이 깨지면 이 파일의 마지막 테스트가 잡는다.
"""
import json
import logging

import pytest
from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

import main
from main import app

_BOOM_PATH = "/__s3_boom__"
_HTTPEXC_PATH = "/__s3_httpexc__"
# 응답에 절대 새어나가면 안 되는 내부 문자열(자격증명·경로처럼 보이게 만든 미끼)
_SECRET = "internal-detail db_password=hunter2 at /srv/app/services/db.py:42"


def _install(path, endpoint):
    """main.app에 임시 라우트를 심고 (client, 제거함수)를 돌려준다.

    ⚠️ main.app은 conftest가 공유하는 전역이고 `test_api_doc_sync.py`·
    `test_no_public_reads.py`가 `app.routes`를 순회하므로, 테스트 전용 라우트를 남기면
    형제 테스트를 오염시킨다 → 반드시 teardown에서 in-place 제거한다
    (`app.router.routes`를 새 리스트로 재할당하지 않는다).
    """
    app.add_api_route(path, endpoint, methods=["GET"], include_in_schema=False)
    added = [r for r in app.router.routes if getattr(r, "path", None) == path]

    def _remove():
        for r in added:
            if r in app.router.routes:
                app.router.routes.remove(r)
        app.openapi_schema = None

    return added, _remove


@pytest.fixture
def boom_client():
    """미포착 RuntimeError를 던지는 라우트 + 500 응답을 관측하는 클라이언트."""
    async def _boom():
        raise RuntimeError(_SECRET)

    _added, remove = _install(_BOOM_PATH, _boom)
    try:
        # 500 응답 본문을 관측하려면 raise_server_exceptions=False가 필요하다
        # (기본값이면 위 부수 핀대로 예외가 테스트로 재raise된다).
        yield TestClient(app, raise_server_exceptions=False)
    finally:
        remove()


@pytest.fixture
def httpexc_client():
    """라우트 *내부*에서 HTTPException(403)을 던지는 라우트 — ⓐ의 핵심 케이스."""
    async def _forbidden():
        raise HTTPException(status_code=403, detail="권한 없음")

    _added, remove = _install(_HTTPEXC_PATH, _forbidden)
    try:
        yield TestClient(app, raise_server_exceptions=False)
    finally:
        remove()


# --- (1) 구조화 JSON 500 ---

def test_unhandled_exception_returns_structured_json_500(boom_client):
    resp = boom_client.get(_BOOM_PATH)
    assert resp.status_code == 500
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.json() == {"detail": "Internal Server Error"}


def test_500_body_leaks_no_stack_or_internal_message(boom_client):
    resp = boom_client.get(_BOOM_PATH)
    body = resp.text
    for leak in (_SECRET, "hunter2", "services/db.py", "Traceback", "RuntimeError", _BOOM_PATH):
        assert leak not in body, f"500 본문에 내부 정보 유출: {leak!r} in {body!r}"


# --- ⓐ HTTPException을 삼키지 않는다 ---

def test_routing_level_http_exceptions_preserved(client):
    """404(경로 없음)·405(메서드 불일치)가 500으로 바뀌지 않는다."""
    r404 = client.get("/api/__s3_no_such_path__")
    assert r404.status_code == 404
    assert r404.json() == {"detail": "Not Found"}

    r405 = client.post("/health")
    assert r405.status_code == 405


def test_http_exception_raised_in_route_not_converted_to_500(httpexc_client):
    """라우트 내부 raise도 자기 상태코드·detail을 유지한다(일반 핸들러가 가로채지 않음)."""
    resp = httpexc_client.get(_HTTPEXC_PATH)
    assert resp.status_code == 403
    assert resp.json() == {"detail": "권한 없음"}


def test_handler_registration_does_not_shadow_http_or_validation_handlers():
    """등록 지도: Exception만 새 핸들러이고 HTTPException·RequestValidationError는 각자 유지."""
    from starlette.exceptions import HTTPException as StarletteHTTPException

    handlers = app.exception_handlers
    assert Exception in handlers, "일반 예외 핸들러가 main.app에 등록되지 않았다"
    assert handlers[Exception] is not handlers.get(StarletteHTTPException)
    assert handlers[Exception] is not handlers.get(RequestValidationError)
    # 기존 422 sanitizing 핸들러가 여전히 main.py 소유 함수다
    assert handlers[RequestValidationError].__module__ == "main"


# --- ⓑ 본문은 sanitize 경유 ---

def test_500_body_goes_through_sanitize(boom_client, monkeypatch):
    """sanitize 래퍼가 실제로 본문 경로에 있는지 — 대체 함수의 결과가 본문에 나타나야 한다.

    이빨: 핸들러에서 sanitize 호출을 빼면 marker가 본문에 나타나지 않아 실패한다.
    (핸들러의 본문 자체는 정적 문자열이므로 sanitize는 no-op이다 — 그래서 "NaN을 넣어
    깨뜨리는" 행동 테스트로는 이 래퍼의 이빨을 확인할 수 없다. 래퍼가 필요한 이유는
    나중에 예외 컨텍스트에서 온 값을 본문에 실을 때 `allow_nan=False`로 핸들러 자신이
    500을 내는 상태를 원리적으로 막는 것이다.)
    """
    calls = []

    def _spy(obj):
        calls.append(obj)
        return {"detail": "SANITIZE-MARKER"}

    import services.utils as utils_mod
    monkeypatch.setattr(utils_mod, "sanitize", _spy)

    resp = boom_client.get(_BOOM_PATH)
    assert calls, "핸들러가 services.utils.sanitize를 호출하지 않았다"
    assert resp.json() == {"detail": "SANITIZE-MARKER"}, "본문이 sanitize 결과를 통과하지 않았다"


def test_500_body_is_allow_nan_false_serializable(boom_client):
    """핸들러 응답이 starlette allow_nan=False 직렬화를 통과한다(핸들러가 500을 내지 않음)."""
    resp = boom_client.get(_BOOM_PATH)
    json.dumps(resp.json(), allow_nan=False)


# --- ⓒ 기존 422 경로 무회귀 ---

def test_validation_error_nan_echo_still_422_not_500(client):
    """입력 NaN이 422 detail로 echo돼도 sanitize 핸들러가 500을 막는다(task#211 경로).

    새 일반 핸들러가 우선순위를 가로채면 이 요청이 500이 된다.
    """
    body = '{"ticker": "AAPL", "name": "Apple", "quantity": NaN, "avg_cost": 1.0}'
    resp = client.post("/api/portfolio", content=body, headers={"Content-Type": "application/json"})
    assert resp.status_code == 422
    assert "detail" in resp.json()  # 파싱 성공 자체가 sanitize 결합 확인


# --- 관측성 ---

def test_unhandled_exception_is_logged_with_component_marker(boom_client, caplog):
    with caplog.at_level(logging.ERROR, logger="main"):
        boom_client.get(_BOOM_PATH)
    errs = [r for r in caplog.records if r.levelno == logging.ERROR and "[UnhandledError]" in r.getMessage()]
    assert errs, f"[UnhandledError] ERROR 로그가 없다: {[r.getMessage() for r in caplog.records]}"
    msg = errs[0].getMessage()
    # 응답에는 없어야 하는 내부 메시지가 *로그에는* 남아야 한다(원인 추적 가능)
    assert _SECRET in msg, f"로그에 예외 메시지가 없다: {msg!r}"
    assert "GET" in msg and _BOOM_PATH in msg, f"로그에 요청 컨텍스트가 없다: {msg!r}"


def test_unhandled_exception_log_carries_traceback(boom_client, caplog):
    """`exc_info=True`가 load-bearing임을 못박는다 — 스택이 유일한 진단 수단이다.

    응답 본문에서 원인을 *의도적으로* 지웠으므로(위 유출 축), 트레이스백이 사라지면
    프로덕션 500의 원인이 **어디에도 남지 않는다**. 그런데 위 축은 메시지 *문자열*만
    보므로 `exc_info=True` 한 줄을 빼도 통과한다(실측: 그 줄만 제거하고 이 파일을 돌리면
    11축 전부 초록이었다) — 그래서 레코드의 `exc_info`와 포매팅 결과를 직접 단언한다.
    """
    with caplog.at_level(logging.ERROR, logger="main"):
        boom_client.get(_BOOM_PATH)
    errs = [r for r in caplog.records if r.levelno == logging.ERROR and "[UnhandledError]" in r.getMessage()]
    assert errs, "[UnhandledError] ERROR 로그가 없다"
    rec = errs[0]
    assert rec.exc_info is not None, (
        "로그 레코드에 exc_info가 없다 — logger.error(..., exc_info=True)가 빠졌다. "
        "응답 본문에도 원인이 없으므로 500의 스택이 어디에도 남지 않는다"
    )
    formatted = logging.Formatter().format(rec)
    assert "Traceback" in formatted, f"포매팅 결과에 스택이 없다: {formatted!r}"
    assert "RuntimeError" in formatted, f"포매팅 결과에 예외 타입이 없다: {formatted!r}"


# --- 부수 핀: 기존 테스트의 "예외 전파" 기대가 깨지지 않는다 ---

def test_default_testclient_still_raises_unhandled_exception():
    """ServerErrorMiddleware는 핸들러 호출 뒤 예외를 재raise한다 — 기본 TestClient는 여전히 raise.

    이 성질이 깨지면 `from main import app`으로 예외 전파를 기대하는 기존 테스트들이
    조용히 통과로 바뀐다.
    """
    async def _boom():
        raise RuntimeError(_SECRET)

    _added, remove = _install("/__s3_boom_raise__", _boom)
    try:
        with pytest.raises(RuntimeError):
            TestClient(app).get("/__s3_boom_raise__")
    finally:
        remove()


def test_temp_routes_are_not_left_on_main_app():
    """이 파일이 심은 임시 라우트가 형제 테스트에 새지 않는지 최종 확인."""
    leaked = [getattr(r, "path", None) for r in app.router.routes
              if str(getattr(r, "path", "")).startswith("/__s3_")]
    assert not leaked, f"임시 라우트 잔존: {leaked}"

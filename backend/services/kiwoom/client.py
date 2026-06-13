"""키움 REST API 클라이언트 토대 — 토큰 발급/갱신 + 요청 헬퍼.

키움은 KR 읽기전용 시세 소스로만 쓴다(경계: .forge/adr/0009). 자격증명은
서버측 단일 키(`KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`), 토큰은 인프로세스 싱글톤.
env는 호출 시점에 읽어 테스트에서 monkeypatch 가능하게 한다.
"""
from __future__ import annotations
import os
import time
import threading
import requests

_TIMEOUT = 8
_MIN_INTERVAL = 0.25          # 직렬 throttle: 요청 최소 간격(초) — 레이트리밋 방어
_TOKEN_CACHE_SEC = 12 * 3600  # 토큰 캐시 창(토큰 수명 ~24h보다 보수적). 만료는 401 재시도로도 방어


class KiwoomError(Exception):
    """키움 응답 오류(return_code≠0 또는 HTTP 오류)."""


class KiwoomAuthError(KiwoomError):
    """자격증명 미설정 또는 토큰 발급 실패."""


def _base_url() -> str:
    return os.getenv("KIWOOM_BASE_URL", "https://api.kiwoom.com")


def _creds() -> tuple[str, str]:
    return os.getenv("KIWOOM_APP_KEY", ""), os.getenv("KIWOOM_SECRET_KEY", "")


def configured() -> bool:
    """자격증명이 설정돼 있어야 키움을 시도한다(미설정 시 호출측이 폴백)."""
    app_key, secret_key = _creds()
    return bool(app_key and secret_key)


# ── 토큰 싱글톤 ───────────────────────────────────────────────────────────────
_token_lock = threading.Lock()
_token: str | None = None
_token_expiry: float = 0.0


def _issue_token() -> str:
    app_key, secret_key = _creds()
    if not (app_key and secret_key):
        raise KiwoomAuthError("KIWOOM_APP_KEY/KIWOOM_SECRET_KEY 미설정")
    r = requests.post(
        f"{_base_url()}/oauth2/token",
        json={"grant_type": "client_credentials", "appkey": app_key, "secretkey": secret_key},
        headers={"Content-Type": "application/json;charset=UTF-8"},
        timeout=_TIMEOUT,
    )
    r.raise_for_status()
    d = r.json()
    rc = d.get("return_code")
    if rc not in (0, None):
        raise KiwoomAuthError(f"토큰 발급 실패 (return_code={rc}): {d.get('return_msg')}")
    token = d.get("token")
    if not token:
        raise KiwoomAuthError(f"토큰 응답에 token 없음: {d}")
    return token


def _get_token(force: bool = False) -> str:
    global _token, _token_expiry
    with _token_lock:
        if force or not _token or time.time() >= _token_expiry:
            _token = _issue_token()
            _token_expiry = time.time() + _TOKEN_CACHE_SEC
        return _token


# ── 요청 throttle ─────────────────────────────────────────────────────────────
_throttle_lock = threading.Lock()
_last_request_ts = 0.0


def _throttle() -> None:
    global _last_request_ts
    with _throttle_lock:
        wait = _MIN_INTERVAL - (time.time() - _last_request_ts)
        if wait > 0:
            time.sleep(wait)
        _last_request_ts = time.time()


def request(api_id: str, body: dict, category: str,
            cont_yn: str = "", next_key: str = "") -> dict:
    """키움 TR 요청. category는 URL 경로 끝(예: 'stkinfo' → /api/dostk/stkinfo).

    토큰 만료(401/403) 시 1회 재발급 후 재시도. return_code≠0이면 KiwoomError.
    """
    if not configured():
        raise KiwoomAuthError("KIWOOM 자격증명 미설정")
    d, _ = _request(api_id, body, category, cont_yn, next_key, retry=True)
    return d


def request_paged(api_id: str, body: dict, category: str, list_key: str,
                  max_items: int = 1000) -> list:
    """연속조회(cont-yn/next-key)로 응답 LIST(list_key) 항목을 max_items까지 모아 반환.

    차트/시계열 TR처럼 한 번에 다 안 오는 응답을 페이지네이션. 첫 페이지에 충분히
    오면(대부분의 우리 조회 깊이) 1콜로 끝난다.
    """
    items: list = []
    cont_yn, next_key = "", ""
    while True:
        d, resp_headers = _request(api_id, body, category, cont_yn, next_key, retry=True)
        items.extend(d.get(list_key) or [])
        cont_yn = (resp_headers.get("cont-yn") or "").strip()
        next_key = (resp_headers.get("next-key") or "").strip()
        if cont_yn != "Y" or not next_key or len(items) >= max_items:
            break
    return items


def _request(api_id, body, category, cont_yn, next_key, retry) -> tuple[dict, dict]:
    token = _get_token()
    _throttle()
    headers = {
        "Content-Type": "application/json;charset=UTF-8",
        "authorization": f"Bearer {token}",
        "api-id": api_id,
    }
    if cont_yn:
        headers["cont-yn"] = cont_yn
    if next_key:
        headers["next-key"] = next_key

    r = requests.post(f"{_base_url()}/api/dostk/{category}", json=body, headers=headers, timeout=_TIMEOUT)
    if r.status_code in (401, 403) and retry:
        _get_token(force=True)  # 토큰 만료 추정 → 재발급 후 1회 재시도
        return _request(api_id, body, category, cont_yn, next_key, retry=False)
    r.raise_for_status()
    d = r.json()
    rc = d.get("return_code")
    if rc not in (0, None):
        raise KiwoomError(f"{api_id} 실패 (return_code={rc}): {d.get('return_msg')}")
    return d, r.headers

"""한국투자증권(KIS) REST API 클라이언트 토대 — 토큰 발급/캐시 + GET 요청 헬퍼.

KIS는 KR/US 읽기전용 *백업* 시세 소스로만 쓴다(경계: .forge/adr/0011). 자격증명은
서버측 단일 키(`KIS_APP_KEY`/`KIS_APP_SECRET`), 토큰은 인프로세스 싱글톤.
토큰 발급은 1분당 1회 제한(EGW00133)이라 강제 재발급에 최소간격 가드를 둔다.
env는 호출 시점에 읽어 테스트에서 monkeypatch 가능하게 한다(키움 client 패턴과 동결).
"""
from __future__ import annotations
import os
import time
import threading
import requests

_TIMEOUT = 8
_MIN_INTERVAL = 0.05          # 직렬 throttle: 요청 최소 간격(초) — 실전 20req/sec
_TOKEN_CACHE_SEC = 23 * 3600  # 토큰 캐시 창(토큰 수명 ~24h보다 보수적). 만료는 401 재시도로도 방어
_REISSUE_MIN_INTERVAL = 60    # 발급 1분당 1회 제한(EGW00133) 방어: 강제 재발급 최소간격


class KisError(Exception):
    """KIS 응답 오류(rt_cd≠0 또는 HTTP 오류)."""


class KisAuthError(KisError):
    """자격증명 미설정 또는 토큰 발급 실패."""


def _base_url() -> str:
    # 실전 도메인 기본값. 시세는 계좌 불요라 실전 사용(모의는 KIS_BASE_URL로 override).
    return os.getenv("KIS_BASE_URL", "https://openapi.koreainvestment.com:9443")


def _creds() -> tuple[str, str]:
    return os.getenv("KIS_APP_KEY", ""), os.getenv("KIS_APP_SECRET", "")


def configured() -> bool:
    """자격증명이 설정돼 있어야 KIS를 시도한다(미설정 시 호출측이 폴백)."""
    app_key, app_secret = _creds()
    return bool(app_key and app_secret)


# ── 토큰 싱글톤 ───────────────────────────────────────────────────────────────
_token_lock = threading.Lock()
_token: str | None = None
_token_expiry: float = 0.0
_last_issue_ts: float = 0.0


def _issue_token() -> str:
    app_key, app_secret = _creds()
    if not (app_key and app_secret):
        raise KisAuthError("KIS_APP_KEY/KIS_APP_SECRET 미설정")
    r = requests.post(
        f"{_base_url()}/oauth2/tokenP",
        json={"grant_type": "client_credentials", "appkey": app_key, "appsecret": app_secret},
        headers={"content-type": "application/json"},
        timeout=_TIMEOUT,
    )
    r.raise_for_status()
    d = r.json()
    token = d.get("access_token")
    if not token:
        raise KisAuthError(f"토큰 응답에 access_token 없음: {d}")
    return token


def _get_token(force: bool = False) -> str:
    global _token, _token_expiry, _last_issue_ts
    with _token_lock:
        if force or not _token or time.time() >= _token_expiry:
            # EGW00133(발급 1분당 1회): 최근 60s 내 발급분이 있으면 강제 재발급해도 기존 토큰 재사용
            # (토큰 수명 24h라 60s 내 토큰은 거의 확실히 유효 — 401 폭주·발급제한 동시 방어).
            if _token and (time.time() - _last_issue_ts) < _REISSUE_MIN_INTERVAL:
                return _token
            _token = _issue_token()
            _token_expiry = time.time() + _TOKEN_CACHE_SEC
            _last_issue_ts = time.time()
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


def request(tr_id: str, path: str, params: dict, *, tr_cont: str = "") -> dict:
    """KIS 시세 조회 GET 요청. path는 `/uapi/...` 전체 경로.

    토큰 만료(401/403) 시 1회 재발급 후 재시도. rt_cd≠0이면 KisError.
    읽기전용 시세만 — 주문·계좌·hashkey TR 미사용(경계: .forge/adr/0011).
    """
    if not configured():
        raise KisAuthError("KIS 자격증명 미설정")
    return _request(tr_id, path, params, tr_cont, retry=True)


def _request(tr_id, path, params, tr_cont, retry) -> dict:
    app_key, app_secret = _creds()
    token = _get_token()
    _throttle()
    headers = {
        "content-type": "application/json",
        "authorization": f"Bearer {token}",
        "appkey": app_key,
        "appsecret": app_secret,
        "tr_id": tr_id,
        "custtype": "P",
    }
    if tr_cont:
        headers["tr_cont"] = tr_cont

    r = requests.get(f"{_base_url()}{path}", params=params, headers=headers, timeout=_TIMEOUT)
    if r.status_code in (401, 403) and retry:
        _get_token(force=True)  # 토큰 만료 추정 → 재발급 후 1회 재시도
        return _request(tr_id, path, params, tr_cont, retry=False)
    r.raise_for_status()
    d = r.json()
    rc = d.get("rt_cd")
    if rc not in ("0", 0, None):
        raise KisError(f"{tr_id} 실패 (rt_cd={rc}): {d.get('msg1')}")
    return d

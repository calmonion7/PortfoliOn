"""KIS 클라이언트 토대 — configured 가드 · 토큰 캐시/재사용 · 401 재발급 · EGW00133 60s 가드."""
import pytest
from services.kis import client


class _Resp:
    def __init__(self, *, status=200, json_body=None):
        self.status_code = status
        self._json = json_body or {}
        self.headers = {}

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests
            raise requests.exceptions.HTTPError(response=self)

    def json(self):
        return self._json


@pytest.fixture(autouse=True)
def _reset_token(monkeypatch):
    # 모듈 전역 토큰 싱글톤을 매 테스트 초기화 + 자격증명 주입 + throttle 무력화(테스트 속도).
    monkeypatch.setenv("KIS_APP_KEY", "k")
    monkeypatch.setenv("KIS_APP_SECRET", "s")
    client._token = None
    client._token_expiry = 0.0
    client._last_issue_ts = 0.0
    monkeypatch.setattr(client, "_throttle", lambda: None)
    yield


def test_configured_requires_both_keys(monkeypatch):
    assert client.configured() is True
    monkeypatch.delenv("KIS_APP_SECRET")
    assert client.configured() is False
    monkeypatch.setenv("KIS_APP_SECRET", "s")
    monkeypatch.delenv("KIS_APP_KEY")
    assert client.configured() is False


def test_request_issues_token_once_and_caches(monkeypatch):
    posts = {"n": 0}

    def fake_post(url, **kw):
        posts["n"] += 1
        return _Resp(json_body={"access_token": f"tok{posts['n']}"})

    gets = []

    def fake_get(url, **kw):
        gets.append(kw["headers"]["authorization"])
        return _Resp(json_body={"rt_cd": "0", "output": {"stck_prpr": "100"}})

    monkeypatch.setattr(client.requests, "post", fake_post)
    monkeypatch.setattr(client.requests, "get", fake_get)

    d1 = client.request("FHKST01010100", "/p", {"a": 1})
    d2 = client.request("FHKST01010100", "/p", {"a": 1})
    assert d1["output"]["stck_prpr"] == "100"
    assert posts["n"] == 1                       # 토큰 1회만 발급, 재사용
    assert gets == ["Bearer tok1", "Bearer tok1"]


def test_request_reissues_token_on_401(monkeypatch):
    posts = {"n": 0}

    def fake_post(url, **kw):
        posts["n"] += 1
        return _Resp(json_body={"access_token": f"tok{posts['n']}"})

    calls = {"n": 0}

    def fake_get(url, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            return _Resp(status=401)             # 첫 호출 토큰 만료 → 재발급 재시도
        return _Resp(json_body={"rt_cd": "0", "output": {"ok": True}})

    monkeypatch.setattr(client.requests, "post", fake_post)
    monkeypatch.setattr(client.requests, "get", fake_get)
    monkeypatch.setattr(client.time, "time", lambda: 1_000_000.0)
    # 캐시된(만료 안 된) 토큰이 서버에서 401 → 강제 재발급. 직전 발급은 200s 전이라 60s 가드 통과.
    client._token = "stale"
    client._token_expiry = 1_000_000.0 + 9999
    client._last_issue_ts = 1_000_000.0 - 200

    d = client.request("FHKST01010100", "/p", {})
    assert d["output"]["ok"] is True
    assert posts["n"] == 1                        # 401 → 강제 재발급 1회
    assert calls["n"] == 2                         # 첫 401 + 재시도 성공


def test_force_reissue_blocked_within_60s_reuses_token(monkeypatch):
    posts = {"n": 0}

    def fake_post(url, **kw):
        posts["n"] += 1
        return _Resp(json_body={"access_token": f"tok{posts['n']}"})

    monkeypatch.setattr(client.requests, "post", fake_post)
    monkeypatch.setattr(client.time, "time", lambda: 2_000_000.0)

    t1 = client._get_token()                      # 최초 발급
    assert posts["n"] == 1
    t2 = client._get_token(force=True)            # 60s 내 강제 재발급 → EGW00133 방어로 기존 재사용
    assert t2 == t1
    assert posts["n"] == 1


def test_request_raises_on_nonzero_rt_cd(monkeypatch):
    monkeypatch.setattr(client.requests, "post", lambda url, **kw: _Resp(json_body={"access_token": "t"}))
    monkeypatch.setattr(client.requests, "get",
                        lambda url, **kw: _Resp(json_body={"rt_cd": "1", "msg1": "오류"}))
    with pytest.raises(client.KisError):
        client.request("FHKST01010100", "/p", {})


def test_request_skips_when_unconfigured(monkeypatch):
    monkeypatch.delenv("KIS_APP_KEY")
    with pytest.raises(client.KisAuthError):
        client.request("FHKST01010100", "/p", {})

"""B20 — login/register 레이트리밋 (task#337, ADR 260823-085145).

fresh app(main.app 아님)으로 `routers.auth.router`만 얹어 실제 HTTP를 태운다.
`services.auth_service`의 DB호출은 전부 mock — conftest `_block_real_db`가 실 DB를 막는다.
"""
import threading
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.auth import router as auth_router
from services import rate_limit

_LOGIN_URL = "/api/auth/login"
_REGISTER_URL = "/api/auth/register"


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(auth_router)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_rate_limit_state():
    # 프로세스 전역 상태 — 없으면 뒤 테스트가 앞 테스트의 소진을 물려받는다.
    rate_limit.reset()
    yield
    rate_limit.reset()


def test_B20_login_429_after_threshold_with_retry_after():
    with patch("services.auth_service.get_user_by_email", return_value=None):
        c = _client()
        headers = {"CF-Connecting-IP": "10.0.0.1"}
        for _ in range(10):
            r = c.post(_LOGIN_URL, json={"email": "a@b.com", "password": "x"}, headers=headers)
            assert r.status_code == 401
        blocked = c.post(_LOGIN_URL, json={"email": "a@b.com", "password": "x"}, headers=headers)
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers


def test_B20_register_429_after_threshold():
    with patch("services.auth_service.get_user_by_email", return_value=None), \
         patch("services.auth_service.query", return_value=[{"id": "u1"}]), \
         patch("services.auth_service.hash_password", return_value="h"):
        c = _client()
        headers = {"CF-Connecting-IP": "10.0.0.2"}
        for _ in range(3):
            r = c.post(_REGISTER_URL, json={"email": "a@b.com", "password": "x"}, headers=headers)
            assert r.status_code == 201
        blocked = c.post(_REGISTER_URL, json={"email": "a@b.com", "password": "x"}, headers=headers)
    assert blocked.status_code == 429


def test_B20_login_blocked_skips_bcrypt_verify():
    user = {"id": "u1", "email": "a@b.com", "password_hash": "h"}
    with patch("services.auth_service.get_user_by_email", return_value=user), \
         patch("services.auth_service.verify_password", return_value=False) as mock_verify:
        c = _client()
        headers = {"CF-Connecting-IP": "10.0.0.3"}
        for _ in range(10):
            c.post(_LOGIN_URL, json={"email": "a@b.com", "password": "x"}, headers=headers)
        before = mock_verify.call_count
        blocked = c.post(_LOGIN_URL, json={"email": "a@b.com", "password": "x"}, headers=headers)
    assert blocked.status_code == 429
    assert mock_verify.call_count == before


def test_B20_register_blocked_skips_bcrypt_hash():
    with patch("services.auth_service.get_user_by_email", return_value=None), \
         patch("services.auth_service.query", return_value=[{"id": "u1"}]), \
         patch("services.auth_service.hash_password", return_value="h") as mock_hash:
        c = _client()
        headers = {"CF-Connecting-IP": "10.0.0.4"}
        for _ in range(3):
            c.post(_REGISTER_URL, json={"email": "a@b.com", "password": "x"}, headers=headers)
        before = mock_hash.call_count
        blocked = c.post(_REGISTER_URL, json={"email": "a@b.com", "password": "x"}, headers=headers)
    assert blocked.status_code == 429
    assert mock_hash.call_count == before


def test_B20_ip_buckets_are_independent():
    with patch("services.auth_service.get_user_by_email", return_value=None):
        c = _client()
        ip_a = {"CF-Connecting-IP": "10.0.1.1"}
        ip_b = {"CF-Connecting-IP": "10.0.1.2"}
        for _ in range(10):
            r = c.post(_LOGIN_URL, json={"email": "a@b.com", "password": "x"}, headers=ip_a)
            assert r.status_code == 401
        blocked = c.post(_LOGIN_URL, json={"email": "a@b.com", "password": "x"}, headers=ip_a)
        assert blocked.status_code == 429
        other_ip = c.post(_LOGIN_URL, json={"email": "a@b.com", "password": "x"}, headers=ip_b)
    # 다른 IP는 별도 버킷 — A가 소진돼도 B는 아직 429가 아니다.
    assert other_ip.status_code == 401


def test_B20_window_rollover_allows_again(monkeypatch):
    fake_now = [1_000.0]
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: fake_now[0])
    with patch("services.auth_service.get_user_by_email", return_value=None):
        c = _client()
        headers = {"CF-Connecting-IP": "10.0.2.1"}
        for _ in range(10):
            c.post(_LOGIN_URL, json={"email": "a@b.com", "password": "x"}, headers=headers)
        blocked = c.post(_LOGIN_URL, json={"email": "a@b.com", "password": "x"}, headers=headers)
        assert blocked.status_code == 429
        fake_now[0] += 301  # 5분 창(300s) 경과
        allowed = c.post(_LOGIN_URL, json={"email": "a@b.com", "password": "x"}, headers=headers)
    assert allowed.status_code == 401  # 429가 아니면 다시 허용됐다는 뜻


def test_B20_normal_login_preserved_under_threshold():
    user = {"id": "u1", "email": "a@b.com", "password_hash": "h"}
    tokens = {"access_token": "a", "refresh_token": "r", "token_type": "bearer"}
    with patch("services.auth_service.get_user_by_email", return_value=user), \
         patch("services.auth_service.verify_password", side_effect=[False, False, False, True]), \
         patch("services.auth_service.issue_tokens", return_value=tokens):
        c = _client()
        headers = {"CF-Connecting-IP": "10.0.3.1"}
        for _ in range(3):
            r = c.post(_LOGIN_URL, json={"email": "a@b.com", "password": "wrong"}, headers=headers)
            assert r.status_code == 401
        ok = c.post(_LOGIN_URL, json={"email": "a@b.com", "password": "right"}, headers=headers)
    assert ok.status_code == 200
    assert ok.json() == tokens


def test_B20_key_cap_evicts_oldest_and_bounds_memory(monkeypatch):
    monkeypatch.setattr(rate_limit, "_MAX_KEYS", 3)
    for i in range(5):
        rate_limit.check(f"k{i}", 100, 60.0, now=float(i))
    assert len(rate_limit._buckets) <= 3
    assert "k0" not in rate_limit._buckets
    assert "k4" in rate_limit._buckets


# --- 동시성 회귀 (적대적 리뷰 HIGH/MEDIUM/LOW — 락 없던 시절 barrier로 재현됨) ---
# 순차 for-loop 테스트(위)는 이 경합을 원리적으로 재현하지 않는다.


def test_B20_concurrent_check_never_exceeds_limit_no_lost_count():
    """MEDIUM(과다허용) + LOW(신규키 생성 손실) 회귀 — 락 없으면 allowed != limit이 될 수 있다."""
    rate_limit.reset()
    n_threads = 40
    limit = 10
    barrier = threading.Barrier(n_threads)
    results: list = []

    def worker():
        barrier.wait()
        results.append(rate_limit.check("race-key", limit, 60.0, now=100.0))

    threads = [threading.Thread(target=worker) for _ in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    allowed = sum(1 for r in results if r is None)
    assert allowed == limit  # 정확히 limit개만 허용 — 초과도 손실도 없어야 한다
    assert len(rate_limit._buckets["race-key"]) == limit


def test_B20_concurrent_check_at_expiry_boundary_no_crash():
    """HIGH(IndexError) 회귀 — 만료 대상 타임스탬프 1개를 여러 스레드가 동시에 popleft 경합."""
    rate_limit.reset()
    rate_limit.check("expiry-key", 100, 60.0, now=0.0)  # 만료될 타임스탬프 1개 심기
    n_threads = 30
    barrier = threading.Barrier(n_threads)
    errors: list = []

    def worker():
        barrier.wait()
        try:
            rate_limit.check("expiry-key", 100, 60.0, now=61.0)  # window 60s 초과 → 만료 대상
        except Exception as e:  # pragma: no cover - 회귀 시에만 발생
            errors.append(e)

    threads = [threading.Thread(target=worker) for _ in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []

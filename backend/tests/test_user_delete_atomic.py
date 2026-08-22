"""B5 — `DELETE /api/admin/users/{user_id}` 원자성 회귀.

기존 구현은 확인 `query` 1회 + `execute` 6회로 **7개 독립 트랜잭션**이었다(`db.execute`는
호출마다 커넥션을 새로 얻어 커밋한다). 중간 실패 시 「로그인은 되는데 종목·권한이 사라진
계정」이나 고아 행이 영구히 남는다. 삭제 전체가 단일 `get_connection` 트랜잭션이어야 한다.

이 파일은 `services.db._get_pool`만 가짜로 바꿔 **실제 `db.get_connection`**(commit/rollback
계약의 정본)이 돌게 한다 — commit/rollback 단언이 내가 쓴 가짜 컨텍스트매니저가 아니라
프로덕션 코드를 재도록 하기 위함이다.
"""
from contextlib import contextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import get_current_user, require_admin
from routers.admin import router

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "admin-id"
app.dependency_overrides[require_admin] = lambda: "admin-id"
client = TestClient(app)

TARGET = "11111111-1111-1111-1111-111111111111"

# 현재 구현이 지우는 테이블·순서(users는 FK 자식이 먼저 지워진 뒤 마지막).
EXPECTED_TABLES = [
    "user_stocks",
    "user_menu_permissions",
    "refresh_tokens",
    "digests",
    "calendar_cache",
    "users",
]


class FakeCursor:
    """psycopg2 커서 모사 — `cursor_factory` 유무로 dict/tuple 행을 갈라 반환한다."""

    def __init__(self, row, fail_on=None):
        self.row = row
        self.fail_on = fail_on
        self.executed = []
        self.dict_rows = False
        self.rowcount = 1

    def execute(self, sql, params=None):
        self.executed.append((sql, params))
        if self.fail_on and self.fail_on in sql:
            raise RuntimeError("simulated DB failure")

    def _row(self):
        if self.row is None:
            return None
        return dict(self.row) if self.dict_rows else tuple(self.row.values())

    def fetchone(self):
        return self._row()

    def fetchall(self):
        r = self._row()
        return [r] if r is not None else []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, cur):
        self.cur = cur
        self.commits = 0
        self.rollbacks = 0

    def cursor(self, cursor_factory=None):
        self.cur.dict_rows = cursor_factory is not None
        return self.cur

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class FakePool:
    def __init__(self, conn):
        self.conn = conn
        self.getconn_count = 0

    def getconn(self):
        self.getconn_count += 1
        return self.conn

    def putconn(self, conn):
        pass


@contextmanager
def _fake_db(monkeypatch, row, fail_on=None):
    """실제 `db.get_connection`을 살려 둔 채 풀만 가짜로 교체한다."""
    from services import db as db_svc

    cur = FakeCursor(row, fail_on=fail_on)
    conn = FakeConn(cur)
    pool = FakePool(conn)
    monkeypatch.setattr(db_svc, "_get_pool", lambda: pool)
    yield pool, conn, cur


def _deleted_tables(cur):
    out = []
    for sql, _ in cur.executed:
        s = sql.strip()
        if s.upper().startswith("DELETE FROM"):
            out.append(s.split()[2])
    return out


# --- ⓑ 대조군: 정상 경로는 6테이블 전부 지우고 이전과 같은 응답을 낸다 ---
def test_delete_user_normal_path_is_single_transaction(monkeypatch):
    row = {"role": "user", "oauth_provider": None}
    with _fake_db(monkeypatch, row) as (pool, conn, cur):
        resp = client.delete(f"/api/admin/users/{TARGET}")

        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
        assert _deleted_tables(cur) == EXPECTED_TABLES  # 6테이블·순서 보존
        assert pool.getconn_count == 1                  # 단일 커넥션 = 단일 트랜잭션
        assert conn.commits == 1                        # 커밋 1회(삭제 전체를 한 번에)
        assert conn.rollbacks == 0


# --- ⓐ 중간 실패 시 아무것도 삭제되지 않는다(롤백) ---
def test_delete_user_mid_failure_rolls_back_everything(monkeypatch):
    """4번째 삭제(refresh_tokens)가 실패하면 앞선 3건도 커밋되지 않아야 한다."""
    row = {"role": "user", "oauth_provider": None}
    with _fake_db(monkeypatch, row, fail_on="refresh_tokens") as (pool, conn, cur):
        resp = client.delete(f"/api/admin/users/{TARGET}")

        assert resp.status_code == 500
        assert pool.getconn_count == 1
        assert conn.commits == 0    # 부분 커밋 0 — 반쯤 삭제된 사용자가 남지 않는다
        assert conn.rollbacks == 1
        # 실패 이후 단계는 시도조차 되지 않는다
        assert "users" not in _deleted_tables(cur)


# --- ⓒ 실패는 로그와 응답에 드러난다(조용한 성공 보고 금지) ---
def test_delete_user_failure_is_logged_and_reported(monkeypatch, caplog):
    row = {"role": "user", "oauth_provider": None}
    with caplog.at_level("ERROR"), _fake_db(monkeypatch, row, fail_on="digests"):
        resp = client.delete(f"/api/admin/users/{TARGET}")

    assert resp.status_code == 500
    detail = resp.json()["detail"]
    assert "digests" in detail          # 응답이 실패 단계를 알린다
    errors = [r.message for r in caplog.records if r.levelname == "ERROR"]
    assert any("[Admin]" in m and "digests" in m for m in errors)


# --- 역할 가드가 삭제와 같은 트랜잭션에서 읽힌다(확인→승격→삭제 TOCTOU 차단) ---
def test_role_guard_read_shares_the_delete_transaction(monkeypatch):
    """가드용 SELECT가 삭제와 같은 커넥션에서 `FOR UPDATE`로 읽혀야 한다.

    행 잠금 자체는 가짜 커서로 증명할 수 없다 — 여기서 재는 것은 「가드 read가 삭제와 같은
    트랜잭션에 있고 잠금을 요구한다」는 구조뿐이다(락 동작은 PostgreSQL의 계약).
    """
    row = {"role": "user", "oauth_provider": None}
    with _fake_db(monkeypatch, row) as (pool, conn, cur):
        client.delete(f"/api/admin/users/{TARGET}")

        first_sql = cur.executed[0][0].upper()
        assert first_sql.strip().startswith("SELECT")
        assert "FOR UPDATE" in first_sql
        assert pool.getconn_count == 1  # 가드 read가 별도 커넥션을 열지 않는다


# --- 회귀 핀: 거부 경로는 아무 행도 지우지 않는다(현재도 성립, 고정한다) ---
@pytest.mark.parametrize(
    "row,status",
    [
        ({"role": "admin", "oauth_provider": None}, 403),
        ({"role": "user", "oauth_provider": "google"}, 403),
        (None, 404),
    ],
)
def test_delete_user_rejected_targets_delete_nothing(monkeypatch, row, status):
    with _fake_db(monkeypatch, row) as (pool, conn, cur):
        resp = client.delete(f"/api/admin/users/{TARGET}")

        assert resp.status_code == status
        assert _deleted_tables(cur) == []
        assert conn.commits == 0


# --- 게이트: override 없는 fresh app으로 실제 auth 의존성을 태운다 ---
# (conftest·이 파일 상단의 override는 각자의 app 한정이라 아래 fresh app엔 걸리지 않는다)
def _fresh_client():
    fresh = FastAPI()
    fresh.include_router(router)
    return TestClient(fresh)


def test_delete_user_requires_auth():
    assert _fresh_client().delete(f"/api/admin/users/{TARGET}").status_code == 401


def test_delete_user_rejects_api_key():
    """`require_admin`은 API 키를 받지 않는다 — 파괴적 삭제는 admin 세션 전용."""
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setenv("COWORK_API_KEY", "test-key")
    try:
        resp = _fresh_client().delete(
            f"/api/admin/users/{TARGET}", headers={"X-API-Key": "test-key"}
        )
    finally:
        monkeypatch.undo()
    assert resp.status_code == 401


def test_delete_user_rejects_non_admin():
    from unittest.mock import patch

    fresh = FastAPI()
    fresh.include_router(router)
    fresh.dependency_overrides[get_current_user] = lambda: "user-1"
    with patch("auth.auth_service.get_user_by_id", return_value={"role": "user"}):
        resp = TestClient(fresh).delete(f"/api/admin/users/{TARGET}")
    assert resp.status_code == 403

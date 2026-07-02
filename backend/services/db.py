# backend/services/db.py
from __future__ import annotations

import os
import threading
from contextlib import contextmanager

import psycopg2
from psycopg2.extras import RealDictCursor, execute_batch
from psycopg2.pool import ThreadedConnectionPool

_pool: ThreadedConnectionPool | None = None
_lock = threading.Lock()


def _get_pool() -> ThreadedConnectionPool:
    global _pool
    if _pool is None:
        with _lock:
            if _pool is None:
                _pool = ThreadedConnectionPool(
                    minconn=1,
                    # 최대 ThreadPool 동시성(calendar 15·analysis 11)보다 크게 — psycopg2 풀은
                    # 소진 시 블록이 아니라 PoolError를 던지므로 워커 수 이상으로 둔다(CONCERNS §4.2).
                    maxconn=20,
                    dsn=os.environ["DATABASE_URL"],
                )
    return _pool


@contextmanager
def get_connection():
    conn = _get_pool().getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _get_pool().putconn(conn)


def query(sql: str, params=None) -> list[dict]:
    """단일 SELECT — 결과를 dict 리스트로 반환."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]


def execute(sql: str, params=None) -> int:
    """단일 INSERT/UPDATE/DELETE — 영향받은 행 수 반환."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.rowcount


def execute_many(sql: str, params_list: list) -> None:
    """배치 INSERT/UPDATE/DELETE — 단일 커넥션에서 execute_batch 실행.

    빈 params_list는 no-op(커넥션 미획득).
    """
    if not params_list:
        return
    with get_connection() as conn:
        with conn.cursor() as cur:
            execute_batch(cur, sql, params_list)

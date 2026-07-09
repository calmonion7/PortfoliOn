"""S4 Bug A: replace_recommendations 단일 트랜잭션화(delete+insert 한 커넥션) 회귀 테스트.

기존 execute()-per-call 방식은 중단 시 DELETE만 커밋되고 일부 INSERT만 반영될 수 있었다
(마켓 추천 데이터 소실). get_connection 단일 트랜잭션(dividends.replace_schedule과 동형)이면
INSERT 중 예외 시 커넥션 전체가 rollback되어 기존 행이 보존된다."""
import sys
from contextlib import contextmanager
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from datetime import date


def test_replace_recommendations_single_transaction(monkeypatch):
    """단일 커넥션 획득(=단일 트랜잭션) — DELETE와 INSERT가 같은 커서에서 실행된다."""
    from services.recommendation import store

    verbs = []

    class FakeCur:
        def execute(self, sql, params=None):
            verbs.append(sql.strip().split()[0].upper())
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False

    class FakeConn:
        def cursor(self):
            return FakeCur()

    conns = {"n": 0}

    @contextmanager
    def fake_conn():
        conns["n"] += 1
        yield FakeConn()

    monkeypatch.setattr(store, "get_connection", fake_conn)
    store.replace_recommendations("KR", [
        {"ticker": "005930", "market": "KR", "score": 88.5, "factors": {}, "flags": [],
         "rank": 1, "base_date": date(2026, 6, 18)},
        {"ticker": "000660", "market": "KR", "score": 71.0, "factors": {}, "flags": [],
         "rank": 2, "base_date": date(2026, 6, 18)},
    ])

    assert conns["n"] == 1              # 단일 커넥션(=단일 트랜잭션)
    assert verbs[0] == "DELETE"         # delete 먼저
    assert verbs.count("INSERT") == 2   # 행별 insert


def test_replace_recommendations_mid_loop_failure_rolls_back(monkeypatch):
    """두 번째 INSERT가 예외를 던지면 커넥션 전체가 rollback되어(commit 없음) 부분 반영이 없다."""
    from services.recommendation import store

    class FakeCur:
        def __init__(self):
            self.n_inserts = 0
        def execute(self, sql, params=None):
            verb = sql.strip().split()[0].upper()
            if verb == "INSERT":
                self.n_inserts += 1
                if self.n_inserts == 2:
                    raise RuntimeError("DB error mid-loop")
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False

    class FakeConn:
        def __init__(self):
            self.committed = False
            self.rolled_back = False
        def cursor(self):
            return FakeCur()
        def commit(self):
            self.committed = True
        def rollback(self):
            self.rolled_back = True

    fake_conn_obj = FakeConn()

    @contextmanager
    def fake_get_connection():
        # services.db.get_connection의 실제 commit/rollback 계약을 재현.
        try:
            yield fake_conn_obj
            fake_conn_obj.commit()
        except Exception:
            fake_conn_obj.rollback()
            raise

    monkeypatch.setattr(store, "get_connection", fake_get_connection)

    with pytest.raises(RuntimeError):
        store.replace_recommendations("KR", [
            {"ticker": "005930", "market": "KR", "score": 88.5, "factors": {}, "flags": [],
             "rank": 1, "base_date": date(2026, 6, 18)},
            {"ticker": "000660", "market": "KR", "score": 71.0, "factors": {}, "flags": [],
             "rank": 2, "base_date": date(2026, 6, 18)},
        ])

    assert fake_conn_obj.committed is False   # 커밋 안 됨 → DELETE도 반영 안 됨
    assert fake_conn_obj.rolled_back is True  # 전체 rollback

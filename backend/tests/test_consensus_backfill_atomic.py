"""버그 #28 회귀 — consensus backfill force 경로의 DELETE+재적재 원자성.

force=True 백필은 DELETE + 날짜별 재적재를 단일 get_connection 트랜잭션으로 묶어야 한다.
루프 중단(예외·킬) 시 롤백돼 기존 mart가 통째 보존된다(비원자 DELETE→부분 소실 방지).
"""
from contextlib import contextmanager
from datetime import date, timedelta
from unittest.mock import MagicMock

from services import consensus_pipeline as cp


def _fake_conn():
    conn = MagicMock()
    cur = MagicMock()
    cm = MagicMock()
    cm.__enter__.return_value = cur
    cm.__exit__.return_value = False
    conn.cursor.return_value = cm
    return conn, cur


def _make_get_connection(conn):
    """db.py get_connection 시맨틱 모사 — 정상 종료 시 commit, 예외 시 rollback+재raise."""
    @contextmanager
    def fake():
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return fake


def test_force_backfill_single_transaction(monkeypatch):
    monkeypatch.setattr(cp, "upsert_raw_reports", lambda *a, **k: 0)
    earliest = date.today() - timedelta(days=2)  # earliest~today = 3일
    monkeypatch.setattr(cp, "query", lambda *a, **k: [{"earliest": earliest}])
    conn, cur = _fake_conn()
    gc = MagicMock(side_effect=_make_get_connection(conn))
    monkeypatch.setattr(cp, "get_connection", gc)

    cp.backfill([{"ticker": "AAA", "market": "US"}], days=180, force=True)

    # 단일 트랜잭션: get_connection 1회 (DELETE + 전체 INSERT가 한 커넥션)
    assert gc.call_count == 1
    sqls = [c.args[0] for c in cur.execute.call_args_list]
    assert "DELETE FROM daily_consensus_mart" in sqls[0]  # 첫 실행 = DELETE
    assert sum("INSERT INTO daily_consensus_mart" in s for s in sqls) == 3  # 3일 재적재
    conn.commit.assert_called_once()
    conn.rollback.assert_not_called()


def test_force_backfill_rolls_back_on_mid_loop_failure(monkeypatch):
    monkeypatch.setattr(cp, "upsert_raw_reports", lambda *a, **k: 0)
    earliest = date.today() - timedelta(days=2)
    monkeypatch.setattr(cp, "query", lambda *a, **k: [{"earliest": earliest}])
    conn, cur = _fake_conn()
    calls = {"mart": 0}

    def execute_side(sql, params=None):
        if "INSERT INTO daily_consensus_mart" in sql:
            calls["mart"] += 1
            if calls["mart"] == 2:  # 재적재 루프 중간에 킬 시뮬레이션
                raise RuntimeError("simulated mid-loop kill")
    cur.execute.side_effect = execute_side
    monkeypatch.setattr(cp, "get_connection", _make_get_connection(conn))

    # 중단돼도 backfill 외부 except가 삼켜 정상 반환(다음 종목 진행)
    cp.backfill([{"ticker": "AAA", "market": "US"}], days=180, force=True)

    # 원자성: 롤백만 호출, 커밋 없음 → DELETE도 취소돼 기존 mart 보존(부분 소실 0)
    conn.rollback.assert_called_once()
    conn.commit.assert_not_called()


def test_nonforce_backfill_uses_refresh_mart_no_transaction(monkeypatch):
    """non-force는 무변경 — DELETE 없는 per-date refresh_mart 루프(파괴적 삭제 없음)."""
    monkeypatch.setattr(cp, "upsert_raw_reports", lambda *a, **k: 0)
    earliest = date.today() - timedelta(days=1)
    monkeypatch.setattr(cp, "query", lambda *a, **k: [{"earliest": earliest}])
    refreshed = []
    monkeypatch.setattr(cp, "refresh_mart", lambda t, d: refreshed.append(d))
    gc = MagicMock()
    monkeypatch.setattr(cp, "get_connection", gc)

    cp.backfill([{"ticker": "AAA", "market": "US"}], days=180, force=False)

    assert len(refreshed) == 2  # earliest~today = 2일
    gc.assert_not_called()  # non-force는 트랜잭션 미사용

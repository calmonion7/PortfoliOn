from unittest.mock import patch

import pytest


def test_record_inserts_running_then_success():
    """record()는 enter시 running INSERT, 정상 exit시 success UPDATE."""
    from services import job_runs

    with patch.object(job_runs, "query", return_value=[{"id": 7}]) as q, \
         patch.object(job_runs, "execute", return_value=1) as ex:
        with job_runs.record("daily_report", "manual"):
            pass

    # INSERT(RETURNING id) via query
    assert q.call_count == 1
    insert_sql = q.call_args[0][0]
    assert "INSERT INTO job_runs" in insert_sql
    assert "RETURNING id" in insert_sql
    assert q.call_args[0][1] == ("daily_report", "manual")

    # prune + success UPDATE via execute (2 calls)
    sqls = [c[0][0] for c in ex.call_args_list]
    assert any("DELETE FROM job_runs" in s for s in sqls)
    success = [c for c in ex.call_args_list if "UPDATE job_runs" in c[0][0]]
    assert len(success) == 1
    # status는 파라미터다 — 본문이 종료 상태를 지정할 수 있게 되며 리터럴에서 바뀌었다(task#274)
    assert success[0][0][1] == ("success", None, 7)


def test_record_failed_path_records_error_and_reraises():
    """예외 발생시 failed + error 기록 후 재raise."""
    from services import job_runs

    with patch.object(job_runs, "query", return_value=[{"id": 9}]), \
         patch.object(job_runs, "execute", return_value=1) as ex:
        with pytest.raises(ValueError, match="boom"):
            with job_runs.record("guru_crawl", "auto"):
                raise ValueError("boom")

    fail = [c for c in ex.call_args_list if "UPDATE job_runs" in c[0][0]]
    assert len(fail) == 1
    _, params = fail[0][0]
    assert params == ("failed", "boom", 9)


def test_record_prune_keeps_20():
    """INSERT 직후 prune: 해당 job_id 최신 20건만 보관."""
    from services import job_runs

    with patch.object(job_runs, "query", return_value=[{"id": 1}]), \
         patch.object(job_runs, "execute", return_value=0) as ex:
        with job_runs.record("daily_report", "auto"):
            pass

    prune = [c for c in ex.call_args_list if "DELETE FROM job_runs" in c[0][0]]
    assert len(prune) == 1
    sql, params = prune[0][0]
    assert "20" in sql
    assert params == ("daily_report", "daily_report")


def test_record_insert_failure_still_runs_body_no_reraise():
    """INSERT(query) 실패시(테이블 부재 등) 본문은 그대로 실행되고, 계측 실패는 삼킨다."""
    from services import job_runs

    ran = []
    with patch.object(job_runs, "query", side_effect=Exception("relation does not exist")), \
         patch.object(job_runs, "execute", return_value=1) as ex:
        with job_runs.record("daily_report", "auto") as run:
            ran.append(run.run_id)

    # 본문 실행됨, 센티넬 run_id=None
    assert ran == [None]
    # run_id 없으면 종료 UPDATE는 no-op
    assert not any("UPDATE job_runs" in c[0][0] for c in ex.call_args_list)


def test_record_insert_failure_reraises_genuine_body_exception():
    """INSERT 실패 + 본문 예외시: 계측은 삼키되 본문 예외는 그대로 전파."""
    from services import job_runs

    with patch.object(job_runs, "query", side_effect=Exception("relation does not exist")), \
         patch.object(job_runs, "execute", return_value=1) as ex:
        with pytest.raises(ValueError, match="boom"):
            with job_runs.record("daily_report", "auto"):
                raise ValueError("boom")

    # run_id 없으면 failed UPDATE도 no-op
    assert not any("UPDATE job_runs" in c[0][0] for c in ex.call_args_list)


def test_record_prune_failure_still_runs_body():
    """prune DELETE 실패해도 본문은 실행되고 success UPDATE는 정상 진행."""
    from services import job_runs

    ran = []

    def _exec(sql, *a, **k):
        if "DELETE FROM job_runs" in sql:
            raise Exception("transient")
        return 1

    with patch.object(job_runs, "query", return_value=[{"id": 5}]), \
         patch.object(job_runs, "execute", side_effect=_exec) as ex:
        with job_runs.record("daily_report", "auto") as run:
            ran.append(run.run_id)

    assert ran == [5]
    success = [c for c in ex.call_args_list
               if "UPDATE job_runs" in c[0][0] and c[0][1][0] == "success"]
    assert len(success) == 1


def test_record_exit_update_failure_swallowed():
    """종료 UPDATE 실패해도 record()가 예외를 내지 않는다(본문은 이미 끝남)."""
    from services import job_runs

    def _exec(sql, *a, **k):
        if "UPDATE job_runs" in sql:
            raise Exception("transient")
        return 1

    with patch.object(job_runs, "query", return_value=[{"id": 5}]), \
         patch.object(job_runs, "execute", side_effect=_exec):
        with job_runs.record("daily_report", "auto"):
            pass  # 예외 없이 통과해야 함


def test_recent_returns_latest_first():
    from services import job_runs

    rows = [{"id": 2}, {"id": 1}]
    with patch.object(job_runs, "query", return_value=rows) as q:
        out = job_runs.recent("daily_report", n=5)

    assert out == rows
    sql, params = q.call_args[0]
    assert "started_at DESC" in sql
    assert params == ("daily_report", 5)


def test_recent_graceful_on_missing_table():
    from services import job_runs

    with patch.object(job_runs, "query", side_effect=Exception("relation does not exist")):
        assert job_runs.recent("daily_report") == []


def test_recent_map_graceful_and_groups():
    from services import job_runs

    rows = [
        {"id": 3, "job_id": "daily_report"},
        {"id": 2, "job_id": "guru_crawl"},
        {"id": 1, "job_id": "daily_report"},
    ]
    with patch.object(job_runs, "query", return_value=rows):
        out = job_runs.recent_map(["daily_report", "guru_crawl", "lending_fetch"])

    assert [r["id"] for r in out["daily_report"]] == [3, 1]
    assert [r["id"] for r in out["guru_crawl"]] == [2]
    assert out["lending_fetch"] == []

    with patch.object(job_runs, "query", side_effect=Exception("boom")):
        out2 = job_runs.recent_map(["daily_report"])
    assert out2 == {"daily_report": []}


# ══ task#274 (B31) — 종료 상태 지정 ═════════════════════════════════════════════
#
# 본문이 예외를 try/except로 삼키면 record()는 항상 success로 기록한다. 잡이 스스로
# "부분/생략/실패"를 말할 수 있어야 배치 허브의 초록이 사실이 된다.

def _updates(ex):
    return [c[0] for c in ex.call_args_list if "UPDATE job_runs" in c[0][0]]


def test_record_body_can_set_partial_status_T274():
    """본문이 set_status로 지정하면 그 상태가 기록된다(예외 없이 정상 종료해도)."""
    from services import job_runs

    with patch.object(job_runs, "query", return_value=[{"id": 3}]), \
         patch.object(job_runs, "execute", return_value=1) as ex:
        with job_runs.record("guru_crawl", "auto") as run:
            run.set_status("partial")

    (sql, params), = _updates(ex)
    assert params[0] == "partial"
    assert params[-1] == 3
    assert "%s" in sql          # 상태는 리터럴이 아니라 파라미터


def test_record_body_can_set_skipped_status_T274():
    """빈 결과 같은 '안 했음'은 success가 아니라 skipped다."""
    from services import job_runs

    with patch.object(job_runs, "query", return_value=[{"id": 4}]), \
         patch.object(job_runs, "execute", return_value=1) as ex:
        with job_runs.record("guru_crawl", "auto") as run:
            run.set_status("skipped")

    (_, params), = _updates(ex)
    assert params[0] == "skipped"


def test_record_body_can_set_failed_without_raising_T274():
    """본문이 예외를 삼켜도 failed를 기록할 수 있다 — B31의 핵심."""
    from services import job_runs

    with patch.object(job_runs, "query", return_value=[{"id": 5}]), \
         patch.object(job_runs, "execute", return_value=1) as ex:
        with job_runs.record("guru_crawl", "auto") as run:
            try:
                raise RuntimeError("boom")
            except Exception as e:
                run.set_status("failed", str(e))

    (_, params), = _updates(ex)
    assert params[0] == "failed"
    assert params[1] == "boom"


def test_record_unset_status_still_success_T274():
    """하위호환 핀 — 상태를 지정하지 않는 기존 잡은 종래대로 success."""
    from services import job_runs

    with patch.object(job_runs, "query", return_value=[{"id": 6}]), \
         patch.object(job_runs, "execute", return_value=1) as ex:
        with job_runs.record("daily_report", "auto"):
            pass

    (_, params), = _updates(ex)
    assert params[0] == "success"


def test_record_body_exception_beats_set_status_T274():
    """전파된 예외가 지정 상태를 이긴다(종래 동작 보존) + 재raise."""
    from services import job_runs

    with patch.object(job_runs, "query", return_value=[{"id": 8}]), \
         patch.object(job_runs, "execute", return_value=1) as ex:
        with pytest.raises(ValueError, match="kaboom"):
            with job_runs.record("guru_crawl", "auto") as run:
                run.set_status("partial")
                raise ValueError("kaboom")

    (_, params), = _updates(ex)
    assert params[0] == "failed"
    assert params[1] == "kaboom"


def test_record_status_update_failure_swallowed_T274():
    """상태 UPDATE가 실패해도 본문 결과는 안 바뀐다(graceful degrade 보존)."""
    from services import job_runs

    def _exec(sql, *a, **k):
        if "UPDATE job_runs" in sql:
            raise Exception("transient")
        return 1

    ran = []
    with patch.object(job_runs, "query", return_value=[{"id": 9}]), \
         patch.object(job_runs, "execute", side_effect=_exec):
        with job_runs.record("guru_crawl", "auto") as run:
            run.set_status("partial")
            ran.append("body-finished")

    assert ran == ["body-finished"]

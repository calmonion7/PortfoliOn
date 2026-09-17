"""S2: job_runs.payload 컬럼 — set_payload로 종료 UPDATE에 그 실행이 무엇을 대상으로
했는지 함께 기록. TDD red-first: 구현 전 이 파일을 먼저 돌려 실패를 확인할 것."""
import json
from unittest.mock import patch


def test_set_payload_included_in_finish_update():
    """set_payload를 부르면 종료 UPDATE의 SQL/params에 그 payload가 실린다."""
    from services import job_runs

    with patch.object(job_runs, "query", return_value=[{"id": 11}]), \
         patch.object(job_runs, "execute", return_value=1) as ex:
        with job_runs.record("cowork_enrich_nightly", "auto") as run:
            run.set_payload({"tickers": ["AAPL", "005930"]})

    updates = [c[0] for c in ex.call_args_list if "UPDATE job_runs" in c[0][0]]
    assert len(updates) == 1
    sql, params = updates[0]
    assert "payload" in sql
    assert params[-2] == json.dumps({"tickers": ["AAPL", "005930"]}, ensure_ascii=False)
    assert params[-1] == 11


def test_set_payload_not_called_leaves_update_unchanged():
    """set_payload를 부르지 않으면 종료 UPDATE는 payload 컬럼을 안 건드린다(무회귀 축) —
    이게 없으면 「payload를 항상 NULL로 덮어쓰는」 회귀가 안 잡힌다."""
    from services import job_runs

    with patch.object(job_runs, "query", return_value=[{"id": 12}]), \
         patch.object(job_runs, "execute", return_value=1) as ex:
        with job_runs.record("daily_report", "auto"):
            pass

    updates = [c[0] for c in ex.call_args_list if "UPDATE job_runs" in c[0][0]]
    assert len(updates) == 1
    sql, params = updates[0]
    assert "payload" not in sql
    assert params == ("success", None, 12)


def test_recent_select_includes_payload_column():
    from services import job_runs

    with patch.object(job_runs, "query", return_value=[]) as q:
        job_runs.recent("daily_report")

    sql = q.call_args[0][0]
    assert "payload" in sql


def test_recent_map_select_includes_payload_column():
    from services import job_runs

    with patch.object(job_runs, "query", return_value=[]) as q:
        job_runs.recent_map(["daily_report"])

    sql = q.call_args[0][0]
    assert "payload" in sql


def test_payload_serialization_failure_does_not_break_body():
    """payload 직렬화가 실패해도(순환참조 등) 본문 실행·종료 처리 자체는 안 깨진다 —
    계측은 관측 전용이라는 이 모듈의 기존 규율(job_runs.py 모듈 docstring)을 payload에도 적용."""
    from services import job_runs

    bad = {}
    bad["self"] = bad  # json.dumps가 여기서 ValueError(순환참조)를 낸다

    ran = []
    with patch.object(job_runs, "query", return_value=[{"id": 13}]), \
         patch.object(job_runs, "execute", return_value=1) as ex:
        with job_runs.record("daily_report", "auto") as run:
            run.set_payload(bad)
            ran.append("body-finished")

    assert ran == ["body-finished"]
    updates = [c[0] for c in ex.call_args_list if "UPDATE job_runs" in c[0][0]]
    assert len(updates) == 1

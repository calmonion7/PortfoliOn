"""S5: 02:00 fire 갱신 대조 잡 — cowork_enrich_verify (ADR 260916-132605).

`_verify_nightly_enrich`가 02:00 run(payload에 쏜 ticker 목록)을 그 run의 started_at을
window_start로 `enrich_verify.judge`에 넘겨 판정하고, ⓐ 02:00 run 행을 UPDATE ⓑ 자기
run에도 같은 상태를 남기는지를 잰다. DB는 전부 모킹(conftest의 실DB 가드가 있어도 무해).

적대적 검토(task#357)가 잡은 3축이 여기 상주한다 — 이 잡이 고치려는 「거짓 초록」이
검증 잡 자신에서 재생산되는 경로들이다:
  ⓐ 02:00 run 조회가 DB 오류로 실패하면 「run 없음」(정상 skip)이 아니라 failed다.
  ⓑ 최신 run이 오늘 것이 아니면(야간 잡이 아예 안 돈 날) failed다 — 며칠 전 행을
     재판정해 success로 덮으면 「오늘 밤 안 돌았다」가 사라진다.
  ⓒ naive/aware가 섞여도 오판하지 않는다(호출측이 tz를 정규화한다).
"""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

# 신선도 가드(24h)를 통과해야 하므로 고정 날짜가 아니라 「지금 기준」으로 잡는다.
STARTED = datetime.now(timezone.utc) - timedelta(hours=6)

_NIGHTLY_SQL = "job_id = 'cowork_enrich_nightly'"


@pytest.fixture
def run_status():
    status = MagicMock()

    @contextmanager
    def _record(job_id, trigger):
        assert job_id == "cowork_enrich_verify"
        yield status
    from scheduler import jobs
    with patch.object(jobs.job_runs, "record", _record):
        yield status


def _nightly_row(payload, started_at=None):
    return {
        "id": 42, "job_id": "cowork_enrich_nightly", "status": "success",
        "started_at": STARTED if started_at is None else started_at,
        "payload": payload, "error": None,
    }


def _query_router(nightly_rows, enriched_rows=None, nightly_exc=None, enriched_exc=None):
    """query()는 이제 ⓐ 02:00 run 조회 ⓑ enriched_at 조회 둘 다에 쓰인다 — SQL로 분기한다."""
    def _q(sql, params=None):
        if _NIGHTLY_SQL in sql:
            if nightly_exc:
                raise nightly_exc
            return nightly_rows
        if enriched_exc:
            raise enriched_exc
        return enriched_rows or []
    return _q


def test_verify_skipped_when_no_nightly_run(run_status):
    """02:00 run 행 자체가 없으면(아직 한 번도 안 돎) 대조할 것이 없다 — skipped."""
    from scheduler import jobs
    with patch("services.db.query", side_effect=_query_router([])), \
         patch("services.db.execute") as ex:
        jobs._verify_nightly_enrich()
    assert run_status.set_status.call_args.args[0] == "skipped"
    ex.assert_not_called()  # 대조 대상이 없으니 02:00 행도 건드리지 않는다


def test_verify_db_failure_is_failed_not_skipped(run_status):
    """⚠️ 02:00 run 조회가 DB 오류로 실패하면 failed다 — 「run 없음」으로 붕괴시키지 않는다.

    job_runs.recent()는 예외를 삼키고 []를 주므로 그것을 쓰면 이 둘이 구별되지 않고,
    검증 잡이 죽어도 회색 skipped만 남아 침묵이 한 계층 위로 옮겨간다(적대적 검토 HIGH).
    """
    from scheduler import jobs
    with patch("services.db.query", side_effect=_query_router(None, nightly_exc=RuntimeError("pool exhausted"))), \
         patch("services.db.execute") as ex:
        jobs._verify_nightly_enrich()
    assert run_status.set_status.call_args.args[0] == "failed"
    assert "pool exhausted" in run_status.set_status.call_args.args[1]
    ex.assert_not_called()


def test_verify_stale_nightly_run_is_failed(run_status):
    """⚠️ 최신 run이 3일 전이면(그날 야간 잡이 아예 안 돌았다) failed.

    그것을 오늘 것으로 대조하면 이미 갱신된 티커들 덕에 success가 재기록돼
    「오늘 밤 안 돌았다」는 사실이 job_runs 어디에도 남지 않는다(적대적 검토 MEDIUM ×2).
    """
    from scheduler import jobs
    stale = _nightly_row(
        {"tickers": ["AAPL"], "chunk": 5, "model": "opus"},
        started_at=datetime.now(timezone.utc) - timedelta(days=3),
    )
    with patch("services.db.query", side_effect=_query_router([stale])), \
         patch("services.db.execute") as ex:
        jobs._verify_nightly_enrich()
    assert run_status.set_status.call_args.args[0] == "failed"
    ex.assert_not_called()  # 며칠 전 행을 덮지 않는다


def test_verify_skipped_when_payload_missing(run_status):
    """payload가 없으면(기록 이전 run·fire 실패·대상 0 skip) skipped — failed로 오분류 금지."""
    from scheduler import jobs
    with patch("services.db.query", side_effect=_query_router([_nightly_row(None)])), \
         patch("services.db.execute") as ex:
        jobs._verify_nightly_enrich()
    assert run_status.set_status.call_args.args[0] == "skipped"
    ex.assert_not_called()


def test_verify_success_updates_both_rows(run_status):
    """전원 window_start 이후 갱신 — 02:00 행과 자기 행 둘 다 success로 UPDATE."""
    from scheduler import jobs
    nightly = _nightly_row({"tickers": ["AAPL", "005930"], "chunk": 5, "model": "opus"})
    enriched = [
        {"ticker": "AAPL", "enriched_at": STARTED + timedelta(minutes=10)},
        {"ticker": "005930", "enriched_at": STARTED + timedelta(minutes=20)},
    ]
    with patch("services.db.query", side_effect=_query_router([nightly], enriched)), \
         patch("services.db.execute", return_value=1) as ex:
        jobs._verify_nightly_enrich()
    assert ex.call_count == 1
    sql, params = ex.call_args.args
    assert "UPDATE job_runs" in sql
    assert params == ("success", None, 42)
    run_status.set_status.assert_called_once_with("success", None)


def test_verify_naive_timestamps_do_not_misjudge(run_status):
    """⚠️ DB가 naive datetime을 주더라도 전원 미갱신으로 오판하지 않는다.

    judge는 tz 정합을 호출측 책임으로 두므로, 호출부가 정규화하지 않으면 비교가 TypeError로
    떨어져 「거짓 초록 제거」가 매일 밤 「거짓 빨강」을 만든다(적대적 검토 MEDIUM).
    """
    from scheduler import jobs
    naive_start = STARTED.replace(tzinfo=None)
    nightly = _nightly_row({"tickers": ["AAPL"], "chunk": 5, "model": "opus"}, started_at=naive_start)
    enriched = [{"ticker": "AAPL", "enriched_at": naive_start + timedelta(minutes=30)}]
    with patch("services.db.query", side_effect=_query_router([nightly], enriched)), \
         patch("services.db.execute", return_value=1) as ex:
        jobs._verify_nightly_enrich()
    assert ex.call_args.args[1] == ("success", None, 42)


def test_verify_partial_updates_with_missing_list(run_status):
    """일부만 갱신 — partial + 미갱신 ticker가 error에 담긴다(카드가 recent_runs[].error로 노출)."""
    from scheduler import jobs
    nightly = _nightly_row({"tickers": ["AAPL", "005930"], "chunk": 5, "model": "opus"})
    enriched = [
        {"ticker": "AAPL", "enriched_at": STARTED + timedelta(minutes=10)},
        {"ticker": "005930", "enriched_at": None},
    ]
    with patch("services.db.query", side_effect=_query_router([nightly], enriched)), \
         patch("services.db.execute", return_value=1) as ex:
        jobs._verify_nightly_enrich()
    sql, params = ex.call_args.args
    status, error, run_id = params
    assert status == "partial"
    assert "005930" in error
    assert run_id == 42
    run_status.set_status.assert_called_once_with("partial", error)


def test_verify_query_failure_records_failed(run_status):
    """enriched_at 조회 자체가 실패하면(DB 장애) failed — 02:00 행은 건드리지 않는다."""
    from scheduler import jobs
    nightly = _nightly_row({"tickers": ["AAPL"], "chunk": 5, "model": "opus"})
    with patch("services.db.query",
               side_effect=_query_router([nightly], enriched_exc=RuntimeError("db down"))), \
         patch("services.db.execute") as ex:
        jobs._verify_nightly_enrich()
    assert run_status.set_status.call_args.args[0] == "failed"
    ex.assert_not_called()

"""갱신 대상 집합 + 야간 enrich 배선 (task#354, ADR 260916-132605 결정 1).

정의: (어느 사용자든 holding으로 추적) ∪ (30일 내 report_view_open·ranking_row_click 열람, 추적 종목으로 제한).
SQL 정합은 `scripts/loopcheck-enrich-target-set.py`(라이브 identity)가 따로 재고, 여기선 파이썬 판정을 mock 행으로 잰다.
"""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from services import enrich_targets

NOW = datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)


def _rows(stocks, events):
    """query mock — user_stocks 조회와 user_events 조회를 SQL 텍스트로 구분해 돌려준다."""
    def _q(sql, params=None):
        if "user_stocks" in sql:
            return [{"ticker": t, "type": ty} for t, ty in stocks]
        if "user_events" in sql:
            return [{"event_name": n, "ticker": t, "created_at": at} for n, t, at in events]
        raise AssertionError(f"unexpected sql: {sql}")
    return _q


def _compute(stocks, events):
    with patch.object(enrich_targets, "query", side_effect=_rows(stocks, events)):
        return enrich_targets.compute_enrich_target_set(now=NOW)


def test_holding_included_without_any_view():
    assert _compute([("AAPL", "holding")], []) == ["AAPL"]


def test_watchlist_only_unviewed_excluded():
    assert _compute([("NVDA", "watchlist")], []) == []


def test_watchlist_viewed_within_window_included():
    ev = [("report_view_open", "NVDA", NOW - timedelta(days=29))]
    assert _compute([("NVDA", "watchlist")], ev) == ["NVDA"]


def test_view_older_than_window_excluded():
    ev = [("report_view_open", "NVDA", NOW - timedelta(days=31))]
    assert _compute([("NVDA", "watchlist")], ev) == []


def test_ranking_row_click_counts_as_view():
    ev = [("ranking_row_click", "005930", NOW - timedelta(days=1))]
    assert _compute([("005930", "watchlist")], ev) == ["005930"]


def test_lowercase_event_ticker_normalized():
    ev = [("report_view_open", "nvda", NOW - timedelta(days=1))]
    assert _compute([("NVDA", "watchlist")], ev) == ["NVDA"]


def test_viewed_but_untracked_ticker_excluded():
    ev = [("report_view_open", "ZZZZ", NOW - timedelta(days=1))]
    assert _compute([("AAPL", "holding")], ev) == ["AAPL"]


def test_empty_when_nothing_tracked():
    assert _compute([], []) == []


def test_union_is_sorted_and_deduplicated():
    ev = [("report_view_open", "AAPL", NOW - timedelta(days=2)),
          ("report_view_open", "MSFT", NOW - timedelta(days=2))]
    got = _compute([("AAPL", "holding"), ("MSFT", "watchlist"), ("AMZN", "holding")], ev)
    assert got == ["AAPL", "AMZN", "MSFT"]


# ── 야간 배선: _run_nightly_enrich ──────────────────────────────────

@pytest.fixture
def run_status():
    status = MagicMock()

    @contextmanager
    def _record(job_id, trigger):
        assert job_id == "cowork_enrich_nightly"
        yield status
    from scheduler import jobs
    with patch.object(jobs.job_runs, "record", _record):
        yield status


def test_nightly_fires_exact_target_set(run_status, caplog):
    from scheduler import jobs
    from services import cowork_trigger
    caplog.set_level("INFO")
    with patch.object(enrich_targets, "compute_enrich_target_set", return_value=["AAPL", "MSFT"]), \
         patch.object(cowork_trigger, "configured", return_value=True), \
         patch.object(cowork_trigger, "fire", return_value=True) as fire:
        jobs._run_nightly_enrich()
    assert fire.call_count == 1
    kw = fire.call_args.kwargs
    assert kw["tickers"] == ["AAPL", "MSFT"]  # 존재가 아니라 동일성
    assert kw["model"] == "opus"
    assert kw["chunk"] == 5
    run_status.set_status.assert_not_called()
    text = " ".join(r.getMessage() for r in caplog.records)
    assert "2종목" in text and "AAPL, MSFT" in text


def test_nightly_skips_when_target_set_empty(run_status):
    from scheduler import jobs
    from services import cowork_trigger
    with patch.object(enrich_targets, "compute_enrich_target_set", return_value=[]), \
         patch.object(cowork_trigger, "configured", return_value=True), \
         patch.object(cowork_trigger, "fire") as fire:
        jobs._run_nightly_enrich()
    fire.assert_not_called()
    assert run_status.set_status.call_args.args[0] == "skipped"


def test_nightly_records_failed_when_fire_returns_false(run_status):
    from scheduler import jobs
    from services import cowork_trigger
    with patch.object(enrich_targets, "compute_enrich_target_set", return_value=["AAPL"]), \
         patch.object(cowork_trigger, "configured", return_value=True), \
         patch.object(cowork_trigger, "fire", return_value=False):
        jobs._run_nightly_enrich()
    assert run_status.set_status.call_args.args[0] == "failed"

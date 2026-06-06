import sys
from contextlib import contextmanager
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from datetime import date, timedelta

import pytest

import scheduler


@pytest.fixture(autouse=True)
def _stub_job_runs(monkeypatch):
    """잡 함수에 추가된 job_runs.record 계측이 테스트 DB를 건드리지 않도록 no-op로 대체."""
    import services.job_runs as job_runs

    @contextmanager
    def _noop(job_id, trigger):
        yield 1

    monkeypatch.setattr(job_runs, "record", _noop)


def test_investor_job_forward_and_backward(monkeypatch):
    import services.investor_service as svc
    import services.db as db

    monkeypatch.setattr(
        db, "query",
        lambda sql, params=None: [{"ticker": "005930"}],
    )

    fetch_calls = []  # (ticker, bizdate)
    upsert_calls = []  # (ticker, rows)
    oldest = date.today() - timedelta(days=30)  # within 1-year cap

    def fake_fetch_trend(ticker, bizdate=None):
        fetch_calls.append((ticker, bizdate))
        return [{"base_date": oldest}]

    monkeypatch.setattr(svc, "fetch_trend", fake_fetch_trend)
    monkeypatch.setattr(svc, "upsert_trend",
                        lambda ticker, rows: upsert_calls.append((ticker, rows)))
    monkeypatch.setattr(svc, "oldest_date", lambda ticker: oldest)

    scheduler._fetch_investor_trend()

    # forward (bizdate=None) + backward (bizdate=oldest) both called
    assert ("005930", None) in fetch_calls
    assert ("005930", oldest.strftime("%Y%m%d")) in fetch_calls
    assert len(fetch_calls) == 2
    # both upserts happened
    assert len(upsert_calls) == 2


def test_investor_job_stops_backfill_at_one_year_cap(monkeypatch):
    import services.investor_service as svc
    import services.db as db

    monkeypatch.setattr(
        db, "query",
        lambda sql, params=None: [{"ticker": "005930"}],
    )

    fetch_calls = []
    too_old = date.today() - timedelta(days=400)  # beyond 1-year cap

    def fake_fetch_trend(ticker, bizdate=None):
        fetch_calls.append((ticker, bizdate))
        return [{"base_date": too_old}]

    monkeypatch.setattr(svc, "fetch_trend", fake_fetch_trend)
    monkeypatch.setattr(svc, "upsert_trend", lambda ticker, rows: None)
    monkeypatch.setattr(svc, "oldest_date", lambda ticker: too_old)

    scheduler._fetch_investor_trend()

    # only the forward call — backward skipped because oldest is past the cap
    assert fetch_calls == [("005930", None)]


def test_investor_job_swallows_errors(monkeypatch):
    import services.investor_service as svc
    import services.db as db

    monkeypatch.setattr(
        db, "query",
        lambda sql, params=None: [{"ticker": "005930"}],
    )

    def boom(ticker, bizdate=None):
        raise RuntimeError("fetch failed")

    monkeypatch.setattr(svc, "fetch_trend", boom)
    monkeypatch.setattr(svc, "upsert_trend", lambda ticker, rows: None)
    monkeypatch.setattr(svc, "oldest_date", lambda ticker: None)

    # Must not raise — matches other jobs' try/except + print pattern.
    scheduler._fetch_investor_trend()


def test_investor_job_registered_with_correct_cron(monkeypatch):
    monkeypatch.setattr(scheduler, "_reschedule", lambda: None)
    monkeypatch.setattr(scheduler, "_reschedule_guru", lambda: None)
    monkeypatch.setattr(scheduler, "_check_missed_report", lambda: None)
    monkeypatch.setattr(scheduler, "_seed_rankings_if_empty", lambda: None)
    monkeypatch.setattr(scheduler._scheduler, "start", lambda: None)

    scheduler.start()

    job = scheduler._scheduler.get_job("investor_trend_fetch")
    assert job is not None

    fields = {f.name: str(f) for f in job.trigger.fields}
    assert fields["hour"] == "18"
    assert fields["minute"] == "0"
    assert str(job.trigger.timezone) == "Asia/Seoul"

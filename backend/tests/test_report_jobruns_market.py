"""S6: _run_generation / _run_backfill record the correct batch id based on market."""
import pytest
from unittest.mock import MagicMock, patch


def _make_stock(ticker, market):
    return {"ticker": ticker, "market": market}


@pytest.fixture(autouse=True)
def patch_side_effects(monkeypatch):
    import routers.report as report

    monkeypatch.setattr(report.report_generator, "generate_report_with_retry", lambda *a, **k: None)
    monkeypatch.setattr(report.cache_svc, "invalidate", lambda *a, **k: None)
    monkeypatch.setattr(report._pipeline, "run_daily", lambda *a, **k: None)
    monkeypatch.setattr(report.report_generator, "backfill_ticker", lambda *a, **k: 0)
    monkeypatch.setattr(report._progress, "start", lambda *a, **k: None)
    monkeypatch.setattr(report._progress, "finish", lambda *a, **k: None)
    monkeypatch.setattr(report._progress, "set", lambda *a, **k: None)
    monkeypatch.setattr(report._progress, "increment", lambda *a, **k: None)
    monkeypatch.setattr(report._progress, "add_failed", lambda *a, **k: None)
    monkeypatch.setattr(report._backfill_progress, "start", lambda *a, **k: None)
    monkeypatch.setattr(report._backfill_progress, "finish", lambda *a, **k: None)
    monkeypatch.setattr(report._backfill_progress, "set", lambda *a, **k: None)
    monkeypatch.setattr(report._backfill_progress, "increment", lambda *a, **k: None)


def test_run_generation_kr_only_records_kr():
    import routers.report as report

    recorded = []
    mock_cm = MagicMock()
    mock_cm.__enter__ = lambda s: None
    mock_cm.__exit__ = lambda s, *a: False

    def fake_record(batch_id, trigger):
        recorded.append((batch_id, trigger))
        return mock_cm

    with patch.object(report.job_runs, "record", side_effect=fake_record):
        report._run_generation([_make_stock("005930", "KR"), _make_stock("035720", "KR")])

    assert recorded == [("daily_report_kr", "manual")]


def test_run_generation_us_records_us():
    import routers.report as report

    recorded = []
    mock_cm = MagicMock()
    mock_cm.__enter__ = lambda s: None
    mock_cm.__exit__ = lambda s, *a: False

    def fake_record(batch_id, trigger):
        recorded.append((batch_id, trigger))
        return mock_cm

    with patch.object(report.job_runs, "record", side_effect=fake_record):
        report._run_generation([_make_stock("AAPL", "US")])

    assert recorded == [("daily_report_us", "manual")]


def test_run_generation_mixed_records_us():
    import routers.report as report

    recorded = []
    mock_cm = MagicMock()
    mock_cm.__enter__ = lambda s: None
    mock_cm.__exit__ = lambda s, *a: False

    def fake_record(batch_id, trigger):
        recorded.append((batch_id, trigger))
        return mock_cm

    with patch.object(report.job_runs, "record", side_effect=fake_record):
        report._run_generation([_make_stock("005930", "KR"), _make_stock("AAPL", "US")])

    assert recorded == [("daily_report_us", "manual")]


def test_run_backfill_kr_only_records_kr():
    import routers.report as report

    recorded = []
    mock_cm = MagicMock()
    mock_cm.__enter__ = lambda s: None
    mock_cm.__exit__ = lambda s, *a: False

    def fake_record(batch_id, trigger):
        recorded.append((batch_id, trigger))
        return mock_cm

    with patch.object(report.job_runs, "record", side_effect=fake_record):
        report._run_backfill([_make_stock("005930", "KR")], days=1)

    assert recorded == [("daily_report_kr", "manual")]


def test_run_backfill_us_records_us():
    import routers.report as report

    recorded = []
    mock_cm = MagicMock()
    mock_cm.__enter__ = lambda s: None
    mock_cm.__exit__ = lambda s, *a: False

    def fake_record(batch_id, trigger):
        recorded.append((batch_id, trigger))
        return mock_cm

    with patch.object(report.job_runs, "record", side_effect=fake_record):
        report._run_backfill([_make_stock("AAPL", "US"), _make_stock("005930", "KR")], days=1)

    assert recorded == [("daily_report_us", "manual")]

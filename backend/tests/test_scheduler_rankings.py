import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import scheduler


def test_kr_ranking_job_calls_service(monkeypatch):
    import services.ranking_service as svc
    calls = []
    monkeypatch.setattr(svc, "get_kr_rankings", lambda: {"value": [], "volume": []})
    monkeypatch.setattr(svc, "replace_market_rankings", lambda market, rankings: calls.append((market, rankings)))
    scheduler._fetch_kr_rankings()
    assert calls == [("KR", {"value": [], "volume": []})]


def test_us_ranking_job_calls_service(monkeypatch):
    import services.ranking_service as svc
    calls = []
    monkeypatch.setattr(svc, "get_us_rankings", lambda: {"value": [], "volume": []})
    monkeypatch.setattr(svc, "replace_market_rankings", lambda market, rankings: calls.append((market, rankings)))
    scheduler._fetch_us_rankings()
    assert calls == [("US", {"value": [], "volume": []})]


def test_ranking_job_swallows_errors(monkeypatch):
    import services.ranking_service as svc

    def boom():
        raise RuntimeError("fetch failed")

    monkeypatch.setattr(svc, "get_kr_rankings", boom)
    # Must not raise — matches other jobs' try/except + print pattern.
    scheduler._fetch_kr_rankings()


def test_jobs_registered_with_correct_cron(monkeypatch):
    # Avoid registering the DB-backed daily/guru jobs by neutralizing reschedule helpers.
    monkeypatch.setattr(scheduler, "_reschedule", lambda: None)
    monkeypatch.setattr(scheduler, "_reschedule_guru", lambda: None)
    monkeypatch.setattr(scheduler, "_check_missed_report", lambda: None)
    monkeypatch.setattr(scheduler._scheduler, "start", lambda: None)

    scheduler.start()

    kr = scheduler._scheduler.get_job("kr_rankings_fetch")
    us = scheduler._scheduler.get_job("us_rankings_fetch")
    assert kr is not None
    assert us is not None

    kr_fields = {f.name: str(f) for f in kr.trigger.fields}
    assert kr_fields["hour"] == "9-15"
    assert kr_fields["minute"] == "*/10"
    assert str(kr.trigger.timezone) == "Asia/Seoul"

    us_fields = {f.name: str(f) for f in us.trigger.fields}
    assert us_fields["hour"] == "9-16"
    assert us_fields["minute"] == "*/10"
    assert str(us.trigger.timezone) == "America/New_York"

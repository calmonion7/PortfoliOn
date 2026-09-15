"""S3 — daily_report_{kr,us} 휴장일 건너뛰기 (report-holiday-skip, task#347).

`_generate_all`이 `skip_holidays` 스위치+세션 판정일 휴장 시 report_generator·fire를
호출하지 않고 `job_runs`를 skipped로 남기는지 검증한다. `job_runs.record`는 가짜
컨텍스트매니저로 대체하되 `set_status`를 가진 `Run` 핸들을 yield해야 한다(task#274 —
`yield 1`이면 깨진다).
"""
from contextlib import contextmanager
from datetime import date
from unittest.mock import patch

from services import job_runs


@contextmanager
def _fake_record(job_id, trigger):
    yield job_runs.Run(1)


def _patch_common(monkeypatch, spec):
    from scheduler import jobs
    monkeypatch.setattr(jobs.storage, "get_batch_schedule", lambda job_id: spec)
    monkeypatch.setattr(jobs.job_runs, "record", _fake_record)
    monkeypatch.setattr("services.db.query", lambda *a, **k: [])


def test_holiday_skip_no_generate_no_fire(monkeypatch):
    """휴장일 + skip_holidays on → generate 0회·fire 0회."""
    from scheduler import jobs
    from services import market_session
    _patch_common(monkeypatch, {"enabled": True, "skip_holidays": True})
    monkeypatch.setattr(market_session, "session_date_for", lambda job_id, now: date(2026, 9, 25))
    monkeypatch.setattr(market_session, "is_session_day", lambda exchange, day: False)

    with patch("services.report_generator.generate_report_with_retry") as mock_gen, \
         patch("services.cowork_trigger.fire") as mock_fire:
        jobs._generate_all("KR", "daily_report_kr")

    assert mock_gen.call_count == 0
    assert mock_fire.call_count == 0


def test_holiday_skip_records_skipped_status(monkeypatch):
    """스킵 시 job_runs 핸들에 skipped 상태 + 사유가 기록된다."""
    from scheduler import jobs
    from services import market_session
    captured = {}

    @contextmanager
    def _capturing_record(job_id, trigger):
        run = job_runs.Run(1)
        yield run
        captured["status"] = run.status
        captured["error"] = run.error

    monkeypatch.setattr(jobs.storage, "get_batch_schedule",
                        lambda job_id: {"enabled": True, "skip_holidays": True})
    monkeypatch.setattr(jobs.job_runs, "record", _capturing_record)
    monkeypatch.setattr("services.db.query", lambda *a, **k: [])
    monkeypatch.setattr(market_session, "session_date_for", lambda job_id, now: date(2026, 9, 25))
    monkeypatch.setattr(market_session, "is_session_day", lambda exchange, day: False)

    with patch("services.cowork_trigger.fire"):
        jobs._generate_all("KR", "daily_report_kr")

    assert captured["status"] == "skipped"
    assert "휴장일" in captured["error"]


def test_business_day_generates_and_fires_control(monkeypatch):
    """대조군 — 영업일이면 fire 1회(스킵 로직이 정상 경로를 막지 않는지 확인)."""
    from scheduler import jobs
    from services import market_session
    _patch_common(monkeypatch, {"enabled": True, "skip_holidays": True})
    monkeypatch.setattr(market_session, "session_date_for", lambda job_id, now: date(2026, 9, 28))
    monkeypatch.setattr(market_session, "is_session_day", lambda exchange, day: True)

    with patch("services.cowork_trigger.fire") as mock_fire:
        jobs._generate_all("KR", "daily_report_kr")

    assert mock_fire.call_count == 1
    assert "KR" in mock_fire.call_args.args[0]


def test_switch_off_holiday_generates_as_before(monkeypatch):
    """스위치 꺼짐이면 휴장일이어도 기존대로(하위호환)."""
    from scheduler import jobs
    from services import market_session
    _patch_common(monkeypatch, {"enabled": True, "skip_holidays": False})
    monkeypatch.setattr(market_session, "session_date_for", lambda job_id, now: date(2026, 9, 25))
    monkeypatch.setattr(market_session, "is_session_day", lambda exchange, day: False)

    with patch("services.cowork_trigger.fire") as mock_fire:
        jobs._generate_all("KR", "daily_report_kr")

    assert mock_fire.call_count == 1


def test_no_exchange_job_skips_judgment_entirely(monkeypatch):
    """exchange 없는 job(session_date_for가 None) → 휴장일 판정 자체를 안 함."""
    from scheduler import jobs
    from services import market_session
    _patch_common(monkeypatch, {"enabled": True, "skip_holidays": True})
    monkeypatch.setattr(market_session, "session_date_for", lambda job_id, now: None)
    called = {"is_session_day": False}

    def _spy_is_session_day(exchange, day):
        called["is_session_day"] = True
        return False

    monkeypatch.setattr(market_session, "is_session_day", _spy_is_session_day)

    with patch("services.cowork_trigger.fire") as mock_fire:
        jobs._generate_all("KR", "daily_report_kr")

    assert called["is_session_day"] is False
    assert mock_fire.call_count == 1

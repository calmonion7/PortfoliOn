"""S3: 통합 batch_schedules 시딩 + 제너릭 트리거가 기존 하드코딩 거동을 보존하는지 검증.

핵심은 behavior-preserving: 각 배치의 시드 스펙이 build_trigger_kwargs를 거쳐
CronTrigger로 빌드됐을 때, 제거된 하드코딩 add_job의 CronTrigger 인자와 동치여야 한다.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from apscheduler.triggers.cron import CronTrigger

import scheduler
from services import batch_registry


def _fields(trigger):
    return {f.name: str(f) for f in trigger.fields}


# ── 제거된 하드코딩 add_job의 CronTrigger 인자(진실 기준값) ────────────────────
# 거동 보존 검증의 기준. 시드 스펙→build_trigger_kwargs로 빌드한 트리거가 이것과 동치여야 한다.
_HARDCODED = {
    "daily_digest": CronTrigger(hour=8, minute=0, timezone="Asia/Seoul"),
    "earnings_refresh": CronTrigger(day_of_week="sun", hour=3, minute=0, timezone="Asia/Seoul"),
    "monthly_refresh": CronTrigger(day=1, hour=2, minute=0, timezone="Asia/Seoul"),
    "leverage_fetch": CronTrigger(hour=7, minute=0, timezone="Asia/Seoul"),
    "lending_fetch": CronTrigger(day=5, hour=8, minute=0, timezone="Asia/Seoul"),
    "kr_rankings_fetch": CronTrigger(hour="9-15", minute="*/10", timezone="Asia/Seoul"),
    "us_rankings_fetch": CronTrigger(hour="9-16", minute="*/10", timezone="America/New_York"),
    "investor_trend_fetch": CronTrigger(hour=18, minute=0, timezone="Asia/Seoul"),
    "short_sell_fetch": CronTrigger(hour=18, minute=30, timezone="Asia/Seoul"),
    "backlog_fetch": CronTrigger(day_of_week="sun", hour=4, minute=0, timezone="Asia/Seoul"),
}


def test_default_schedules_match_hardcoded_cron():
    """9종 default_schedule이 기존 하드코딩 CronTrigger와 필드·타임존 동치."""
    for job_id, expected in _HARDCODED.items():
        entry = batch_registry.get_batch(job_id)
        spec = entry["default_schedule"]
        built = scheduler._build_trigger(spec, entry["timezone"])
        assert _fields(built) == _fields(expected), f"{job_id} trigger fields differ"
        assert str(built.timezone) == str(expected.timezone), f"{job_id} timezone differs"


def test_us_rankings_timezone_is_new_york():
    entry = batch_registry.get_batch("us_rankings_fetch")
    assert entry["timezone"] == "America/New_York"


def test_seoul_timezone_for_other_jobs():
    for job_id in _HARDCODED:
        if job_id == "us_rankings_fetch":
            continue
        assert batch_registry.get_batch(job_id)["timezone"] == "Asia/Seoul"


def test_daily_report_misfire_grace_preserved():
    entry = batch_registry.get_batch("daily_report")
    assert entry["misfire_grace_time"] == 82800


def test_consensus_not_editable():
    entry = batch_registry.get_batch("consensus")
    assert entry["editable"] is False
    assert "default_schedule" not in entry


def test_all_eleven_jobs_editable():
    editable = [b["id"] for b in batch_registry.BATCHES if b.get("editable")]
    assert set(editable) == {
        "daily_report", "guru_crawl", "daily_digest", "earnings_refresh",
        "monthly_refresh", "leverage_fetch", "lending_fetch", "kr_rankings_fetch",
        "us_rankings_fetch", "investor_trend_fetch", "short_sell_fetch", "backlog_fetch",
    }


# ── _seed_spec_for: daily_report/guru_crawl 기존값 변환 ────────────────────────

def test_seed_spec_daily_report_converts_legacy(monkeypatch):
    import services.storage as storage
    monkeypatch.setattr(storage, "get_schedule",
                        lambda: {"enabled": True, "time": "09:30", "days": ["mon", "wed"]})
    spec = scheduler._seed_spec_for("daily_report")
    assert spec == {"enabled": True, "type": "weekly", "days": ["mon", "wed"], "time": "09:30"}


def test_seed_spec_daily_report_empty_days_defaults_weekdays(monkeypatch):
    import services.storage as storage
    monkeypatch.setattr(storage, "get_schedule",
                        lambda: {"enabled": False, "time": "08:00", "days": []})
    spec = scheduler._seed_spec_for("daily_report")
    assert spec["days"] == ["mon", "tue", "wed", "thu", "fri"]
    assert spec["enabled"] is False


def test_seed_spec_guru_converts_legacy(monkeypatch):
    import services.storage as storage
    monkeypatch.setattr(storage, "get_guru_schedule",
                        lambda: {"enabled": True, "day": "fri", "time": "05:00"})
    spec = scheduler._seed_spec_for("guru_crawl")
    assert spec == {"enabled": True, "type": "weekly", "days": ["fri"], "time": "05:00"}


def test_seed_spec_other_uses_default():
    spec = scheduler._seed_spec_for("leverage_fetch")
    assert spec == batch_registry.get_batch("leverage_fetch")["default_schedule"]


# ── _seed_batch_schedules: idempotent, 기존 행 미보존 ─────────────────────────

def test_seed_only_fills_missing_rows(monkeypatch):
    """이미 행이 있는 잡은 건드리지 않고, 없는 잡만 시드한다."""
    import services.storage as storage
    store = {
        "leverage_fetch": {"enabled": False, "type": "daily", "time": "23:00"},  # 기존 사용자 값
    }
    saved = []
    monkeypatch.setattr(storage, "get_batch_schedule", lambda jid: store.get(jid))

    def _save(jid, spec):
        store[jid] = spec
        saved.append(jid)

    monkeypatch.setattr(storage, "save_batch_schedule", _save)
    monkeypatch.setattr(storage, "get_schedule", lambda: {"enabled": False, "time": "08:00", "days": []})
    monkeypatch.setattr(storage, "get_guru_schedule", lambda: {"enabled": False, "day": "sun", "time": "03:00"})

    scheduler._seed_batch_schedules()

    # leverage_fetch는 이미 있었으니 안 덮어쓰고 사용자 값 유지
    assert "leverage_fetch" not in saved
    assert store["leverage_fetch"]["time"] == "23:00"
    # 나머지 editable 잡은 시드됨 (consensus 제외, leverage는 기존값 유지)
    expected_seeded = {
        "daily_report", "guru_crawl", "daily_digest", "earnings_refresh",
        "monthly_refresh", "lending_fetch", "kr_rankings_fetch",
        "us_rankings_fetch", "investor_trend_fetch", "short_sell_fetch", "backlog_fetch",
    }
    assert set(saved) == expected_seeded
    assert "consensus" not in store


def test_seed_skips_consensus(monkeypatch):
    """consensus는 editable=False — 시드 대상에서 제외."""
    import services.storage as storage
    store: dict = {}
    monkeypatch.setattr(storage, "get_batch_schedule", lambda jid: store.get(jid))
    monkeypatch.setattr(storage, "save_batch_schedule", lambda jid, spec: store.__setitem__(jid, spec))
    monkeypatch.setattr(storage, "get_schedule", lambda: {"enabled": False, "time": "08:00", "days": []})
    monkeypatch.setattr(storage, "get_guru_schedule", lambda: {"enabled": False, "day": "sun", "time": "03:00"})

    scheduler._seed_batch_schedules()
    assert "consensus" not in store

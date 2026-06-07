import pytest

from services.schedule_spec import validate_schedule_spec, build_trigger_kwargs, describe_schedule


# ── valid 패턴 4종 ────────────────────────────────────────────────────────────

def test_daily_valid():
    validate_schedule_spec({"enabled": True, "type": "daily", "time": "08:00"})


def test_weekly_valid():
    validate_schedule_spec({"enabled": True, "type": "weekly", "days": ["mon", "fri"], "time": "03:00"})


def test_monthly_valid():
    validate_schedule_spec({"enabled": False, "type": "monthly", "day_of_month": 1, "time": "02:00"})


def test_interval_valid():
    validate_schedule_spec(
        {"enabled": True, "type": "interval", "every_minutes": 10, "start_hour": 9, "end_hour": 15}
    )


def test_time_boundary_valid():
    validate_schedule_spec({"enabled": True, "type": "daily", "time": "00:00"})
    validate_schedule_spec({"enabled": True, "type": "daily", "time": "23:59"})


# ── 공통 필수필드 ─────────────────────────────────────────────────────────────

def test_not_dict_rejected():
    with pytest.raises(ValueError):
        validate_schedule_spec(["not", "a", "dict"])


def test_missing_enabled_rejected():
    with pytest.raises(ValueError):
        validate_schedule_spec({"type": "daily", "time": "08:00"})


def test_enabled_not_bool_rejected():
    with pytest.raises(ValueError):
        validate_schedule_spec({"enabled": "yes", "type": "daily", "time": "08:00"})


def test_unknown_type_rejected():
    with pytest.raises(ValueError):
        validate_schedule_spec({"enabled": True, "type": "hourly", "time": "08:00"})


def test_missing_type_rejected():
    with pytest.raises(ValueError):
        validate_schedule_spec({"enabled": True, "time": "08:00"})


# ── time 형식 ─────────────────────────────────────────────────────────────────

def test_bad_time_format_rejected():
    for bad in ["8:00", "08:0", "0800", "08-00", "8am", "", "24:00", "08:60", "12:99"]:
        with pytest.raises(ValueError):
            validate_schedule_spec({"enabled": True, "type": "daily", "time": bad})


def test_missing_time_daily_rejected():
    with pytest.raises(ValueError):
        validate_schedule_spec({"enabled": True, "type": "daily"})


# ── weekly ────────────────────────────────────────────────────────────────────

def test_weekly_empty_days_rejected():
    with pytest.raises(ValueError):
        validate_schedule_spec({"enabled": True, "type": "weekly", "days": [], "time": "03:00"})


def test_weekly_missing_days_rejected():
    with pytest.raises(ValueError):
        validate_schedule_spec({"enabled": True, "type": "weekly", "time": "03:00"})


def test_weekly_invalid_day_rejected():
    with pytest.raises(ValueError):
        validate_schedule_spec({"enabled": True, "type": "weekly", "days": ["monday"], "time": "03:00"})


def test_weekly_all_days_valid():
    validate_schedule_spec(
        {"enabled": True, "type": "weekly",
         "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], "time": "08:00"}
    )


# ── monthly ───────────────────────────────────────────────────────────────────

def test_monthly_day_zero_rejected():
    with pytest.raises(ValueError):
        validate_schedule_spec({"enabled": True, "type": "monthly", "day_of_month": 0, "time": "02:00"})


def test_monthly_day_32_rejected():
    with pytest.raises(ValueError):
        validate_schedule_spec({"enabled": True, "type": "monthly", "day_of_month": 32, "time": "02:00"})


def test_monthly_missing_day_rejected():
    with pytest.raises(ValueError):
        validate_schedule_spec({"enabled": True, "type": "monthly", "time": "02:00"})


def test_monthly_day_31_valid():
    validate_schedule_spec({"enabled": True, "type": "monthly", "day_of_month": 31, "time": "02:00"})


# ── interval ──────────────────────────────────────────────────────────────────

def test_interval_every_minutes_below_5_rejected():
    with pytest.raises(ValueError):
        validate_schedule_spec(
            {"enabled": True, "type": "interval", "every_minutes": 4, "start_hour": 9, "end_hour": 15}
        )


def test_interval_every_minutes_5_valid():
    validate_schedule_spec(
        {"enabled": True, "type": "interval", "every_minutes": 5, "start_hour": 9, "end_hour": 15}
    )


def test_interval_start_after_end_rejected():
    with pytest.raises(ValueError):
        validate_schedule_spec(
            {"enabled": True, "type": "interval", "every_minutes": 10, "start_hour": 16, "end_hour": 9}
        )


def test_interval_start_equals_end_valid():
    validate_schedule_spec(
        {"enabled": True, "type": "interval", "every_minutes": 10, "start_hour": 9, "end_hour": 9}
    )


def test_interval_hour_out_of_range_rejected():
    for bad in [(-1, 15), (0, 24), (9, 25)]:
        with pytest.raises(ValueError):
            validate_schedule_spec(
                {"enabled": True, "type": "interval", "every_minutes": 10,
                 "start_hour": bad[0], "end_hour": bad[1]}
            )


def test_interval_missing_field_rejected():
    with pytest.raises(ValueError):
        validate_schedule_spec({"enabled": True, "type": "interval", "every_minutes": 10, "start_hour": 9})


# ── build_trigger_kwargs: spec → CronTrigger 인자 ─────────────────────────────

def test_build_daily():
    kwargs = build_trigger_kwargs({"enabled": True, "type": "daily", "time": "08:00"})
    assert kwargs == {"hour": 8, "minute": 0}


def test_build_weekly_multi_day_sorted():
    kwargs = build_trigger_kwargs(
        {"enabled": True, "type": "weekly", "days": ["fri", "mon", "wed"], "time": "03:05"}
    )
    assert kwargs == {"day_of_week": "mon,wed,fri", "hour": 3, "minute": 5}


def test_build_weekly_single_day():
    kwargs = build_trigger_kwargs(
        {"enabled": True, "type": "weekly", "days": ["sun"], "time": "04:00"}
    )
    assert kwargs == {"day_of_week": "sun", "hour": 4, "minute": 0}


def test_build_monthly():
    kwargs = build_trigger_kwargs(
        {"enabled": True, "type": "monthly", "day_of_month": 5, "time": "08:00"}
    )
    assert kwargs == {"day": 5, "hour": 8, "minute": 0}


def test_build_interval():
    kwargs = build_trigger_kwargs(
        {"enabled": True, "type": "interval", "every_minutes": 10, "start_hour": 9, "end_hour": 15}
    )
    assert kwargs == {"hour": "9-15", "minute": "*/10"}


def test_build_time_minute_parsed():
    kwargs = build_trigger_kwargs({"enabled": True, "type": "daily", "time": "23:59"})
    assert kwargs == {"hour": 23, "minute": 59}


# ── 현재 scheduler.py 하드코딩 CronTrigger 인자와 동치 검증 ─────────────────────

def test_equivalent_to_current_hardcoded_triggers():
    # daily_report (weekly): CronTrigger(day_of_week="mon,tue,wed,thu,fri", hour=8, minute=0)
    assert build_trigger_kwargs(
        {"enabled": True, "type": "weekly",
         "days": ["mon", "tue", "wed", "thu", "fri"], "time": "08:00"}
    ) == {"day_of_week": "mon,tue,wed,thu,fri", "hour": 8, "minute": 0}

    # daily_digest (daily): CronTrigger(hour=8, minute=0)
    assert build_trigger_kwargs(
        {"enabled": True, "type": "daily", "time": "08:00"}
    ) == {"hour": 8, "minute": 0}

    # monthly_refresh (monthly): CronTrigger(day=1, hour=2, minute=0)
    assert build_trigger_kwargs(
        {"enabled": True, "type": "monthly", "day_of_month": 1, "time": "02:00"}
    ) == {"day": 1, "hour": 2, "minute": 0}

    # kr_rankings_fetch (interval): CronTrigger(hour="9-15", minute="*/10")
    assert build_trigger_kwargs(
        {"enabled": True, "type": "interval", "every_minutes": 10, "start_hour": 9, "end_hour": 15}
    ) == {"hour": "9-15", "minute": "*/10"}

    # us_rankings_fetch (interval): CronTrigger(hour="9-16", minute="*/10")
    assert build_trigger_kwargs(
        {"enabled": True, "type": "interval", "every_minutes": 10, "start_hour": 9, "end_hour": 16}
    ) == {"hour": "9-16", "minute": "*/10"}

    # backlog_fetch (weekly): CronTrigger(day_of_week="sun", hour=4, minute=0)
    assert build_trigger_kwargs(
        {"enabled": True, "type": "weekly", "days": ["sun"], "time": "04:00"}
    ) == {"day_of_week": "sun", "hour": 4, "minute": 0}


# ── describe_schedule: spec → 사람이 읽는 주기설명 (제목 밑 표시) ────────────────

def test_describe_disabled_overrides_all():
    # enabled=False면 type/시간과 무관하게 "자동실행 꺼짐"
    assert describe_schedule({"enabled": False, "type": "daily", "time": "08:00"}) == "자동실행 꺼짐"
    assert describe_schedule(
        {"enabled": False, "type": "weekly", "days": ["mon"], "time": "03:00"}
    ) == "자동실행 꺼짐"


def test_describe_daily():
    assert describe_schedule({"enabled": True, "type": "daily", "time": "08:00"}) == "매일 08:00"
    assert describe_schedule({"enabled": True, "type": "daily", "time": "09:30"}) == "매일 09:30"


def test_describe_weekly_single_day():
    # 기존 정적 문자열 "매주 일 04:00" 포맷과 일치
    assert describe_schedule(
        {"enabled": True, "type": "weekly", "days": ["sun"], "time": "04:00"}
    ) == "매주 일 04:00"


def test_describe_weekly_multi_day_mon_sun_order():
    # days 입력 순서와 무관하게 월~일 순으로 콤마 결합
    assert describe_schedule(
        {"enabled": True, "type": "weekly", "days": ["fri", "mon", "wed"], "time": "08:00"}
    ) == "매주 월,수,금 08:00"
    assert describe_schedule(
        {"enabled": True, "type": "weekly",
         "days": ["mon", "tue", "wed", "thu", "fri"], "time": "08:00"}
    ) == "매주 월,화,수,목,금 08:00"


def test_describe_monthly():
    # 기존 정적 문자열 "매월 1일 02:00" / "매월 5일 08:00" 포맷과 일치
    assert describe_schedule(
        {"enabled": True, "type": "monthly", "day_of_month": 1, "time": "02:00"}
    ) == "매월 1일 02:00"
    assert describe_schedule(
        {"enabled": True, "type": "monthly", "day_of_month": 5, "time": "08:00"}
    ) == "매월 5일 08:00"


def test_describe_interval():
    # 기존 정적 문자열 "장중 09–15시 10분마다" 포맷과 일치 (시각 2자리, en-dash)
    assert describe_schedule(
        {"enabled": True, "type": "interval", "every_minutes": 10, "start_hour": 9, "end_hour": 15}
    ) == "장중 09–15시 10분마다"
    assert describe_schedule(
        {"enabled": True, "type": "interval", "every_minutes": 10, "start_hour": 9, "end_hour": 16}
    ) == "장중 09–16시 10분마다"

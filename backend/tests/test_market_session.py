from datetime import date, datetime
from zoneinfo import ZoneInfo

from services.market_session import is_session_day, session_date_for, exchange_for

_KST = ZoneInfo("Asia/Seoul")


def test_xkrx_holiday_false():
    assert is_session_day("XKRX", date(2026, 9, 25)) is False  # 추석


def test_xkrx_regular_day_true():
    assert is_session_day("XKRX", date(2026, 9, 28)) is True


def test_xnys_holiday_false():
    assert is_session_day("XNYS", date(2026, 9, 7)) is False  # Labor Day


def test_out_of_range_fail_open_true():
    assert is_session_day("XKRX", date(2028, 1, 3)) is True


def test_session_date_for_us_offset_minus_one():
    # 화요일 07:00 KST 실행 → 판정일은 전날(월요일)
    run_dt = datetime(2026, 9, 15, 7, 0, tzinfo=_KST)
    assert session_date_for("daily_report_us", run_dt) == date(2026, 9, 14)


def test_session_date_for_kr_offset_zero():
    run_dt = datetime(2026, 9, 15, 20, 30, tzinfo=_KST)
    assert session_date_for("daily_report_kr", run_dt) == date(2026, 9, 15)


def test_session_date_for_no_exchange_returns_none():
    run_dt = datetime(2026, 9, 15, 9, 0, tzinfo=_KST)
    assert session_date_for("us_rankings_fetch", run_dt) is None


def test_exchange_for():
    assert exchange_for("daily_report_kr") == "XKRX"
    assert exchange_for("daily_report_us") == "XNYS"
    assert exchange_for("us_rankings_fetch") is None
    assert exchange_for("nonexistent_job") is None

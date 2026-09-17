"""갱신 대조 판정 — judge() 순수 함수 (task#S4, ADR 260916-132605).

fired(쏜 목록) vs enriched(현재 enriched_at)를 window_start 기준 대조해
success/partial/failed/skipped 4분기 + 미갱신 목록을 판정한다. DB 접근 없음.
"""
from datetime import datetime, timedelta, timezone

from services.enrich_verify import judge

NOW = datetime(2026, 9, 17, 9, 0, tzinfo=timezone.utc)
BEFORE = NOW - timedelta(hours=1)
AFTER = NOW + timedelta(hours=1)


def test_skipped_when_fired_empty():
    assert judge([], {"AAPL": AFTER}, NOW) == ("skipped", [])


def test_success_when_all_updated():
    got = judge(["AAPL", "MSFT"], {"AAPL": AFTER, "MSFT": AFTER}, NOW)
    assert got == ("success", [])


def test_partial_when_some_missing():
    got = judge(["AAPL", "MSFT"], {"AAPL": AFTER, "MSFT": BEFORE}, NOW)
    assert got == ("partial", ["MSFT"])


def test_failed_when_all_missing():
    got = judge(["AAPL", "MSFT"], {"AAPL": BEFORE, "MSFT": BEFORE}, NOW)
    assert got == ("failed", ["AAPL", "MSFT"])


def test_missing_key_counts_as_not_updated():
    got = judge(["AAPL"], {}, NOW)
    assert got == ("failed", ["AAPL"])


def test_none_value_counts_as_not_updated():
    got = judge(["AAPL"], {"AAPL": None}, NOW)
    assert got == ("failed", ["AAPL"])


def test_boundary_exact_window_start_counts_as_updated():
    got = judge(["AAPL"], {"AAPL": NOW}, NOW)
    assert got == ("success", [])


def test_missing_list_is_sorted():
    got = judge(["ZZZZ", "AAPL", "MSFT"], {}, NOW)
    assert got == ("failed", ["AAPL", "MSFT", "ZZZZ"])


def test_incomparable_tz_naive_vs_aware_counts_as_not_updated():
    """window_start가 tz-aware인데 enriched 값이 naive면 비교 불가 — 미갱신으로 처리(정의는 모듈 docstring)."""
    naive_at = datetime(2026, 9, 17, 10, 0)  # tzinfo 없음, NOW(aware)보다 미래 시각이지만 비교 불가
    got = judge(["AAPL"], {"AAPL": naive_at}, NOW)
    assert got == ("failed", ["AAPL"])

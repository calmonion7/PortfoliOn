"""task 19 — daily_report 배치 회복력: 생성 실패 재시도 + 누락 종목 백필."""
import pytest
from unittest.mock import patch, MagicMock

from services import report_generator


# ── S1: generate_report_with_retry ─────────────────────────────────────────

def test_retry_succeeds_on_second_attempt():
    """1회째 예외, 2회째 성공이면 스냅샷 경로를 반환하고 예외를 던지지 않는다."""
    calls = []

    def side(stock, target_date=None):
        calls.append(1)
        if len(calls) == 1:
            raise ValueError("주가 데이터 없음")
        return "/snap/TEST/2026-06-07.json"

    with patch.object(report_generator, "generate_report", side_effect=side):
        result = report_generator.generate_report_with_retry({"ticker": "TEST"})

    assert result == "/snap/TEST/2026-06-07.json"
    assert len(calls) == 2  # 최초 1 + 재시도 1


def test_retry_gives_up_and_raises_after_all_attempts():
    """1 + retries회 모두 실패하면 마지막 예외를 전파한다 (기본 retries=1 → 2회 시도)."""
    with patch.object(report_generator, "generate_report",
                      side_effect=ValueError("주가 데이터 없음")) as m:
        with pytest.raises(ValueError):
            report_generator.generate_report_with_retry({"ticker": "TEST"})
    assert m.call_count == 2


# ── S2: _check_missed_report 부분 누락 복구 ──────────────────────────────────

_CFG = {"enabled": True,
        "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        "time": "00:00"}  # 모든 요일 + 00:00 → 요일·시각 조기 return 우회


def _run_missed(have_tickers, user_stocks):
    """_check_missed_report를 모킹 환경에서 실행하고, 생성 호출된 종목 목록을 반환."""
    import scheduler

    def db_side(sql, params=None):
        if "DISTINCT user_id" in sql:
            return [{"user_id": "u1"}]
        if "FROM snapshots" in sql:
            return [{"ticker": t} for t in have_tickers]
        return []

    gen = MagicMock(return_value="/snap/x.json")
    with patch("services.storage.get_batch_schedule", return_value=_CFG), \
         patch("services.storage.get_all_stocks", return_value=user_stocks), \
         patch("services.db.query", side_effect=db_side), \
         patch("services.report_generator.generate_report_with_retry", gen), \
         patch("services.consensus_pipeline.run_daily", MagicMock()):
        scheduler._check_missed_report()
    return [c.args[0]["ticker"] for c in gen.call_args_list]


def test_missed_report_generates_only_missing_tickers():
    """오늘 스냅샷이 없는 종목만 재생성하고, 있는 종목은 건드리지 않는다."""
    generated = _run_missed(
        have_tickers={"AAA"},
        user_stocks=[{"ticker": "AAA"}, {"ticker": "BBB"}],
    )
    assert generated == ["BBB"]


def test_missed_report_noop_when_all_present():
    """전 종목이 오늘 스냅샷을 가지면 아무 것도 생성하지 않는다."""
    generated = _run_missed(
        have_tickers={"AAA", "BBB"},
        user_stocks=[{"ticker": "AAA"}, {"ticker": "BBB"}],
    )
    assert generated == []

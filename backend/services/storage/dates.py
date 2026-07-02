# backend/services/storage/dates.py
import logging

from .schedule import get_batch_schedule

logger = logging.getLogger(__name__)


_REPORT_BATCH_BY_MARKET = {"KR": "daily_report_kr", "US": "daily_report_us"}
_DAY_ABBR = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _now_kst():
    """현재 KST 시각 — 시각인지 기대날짜 계산의 테스트 시드(monkeypatch 지점)."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return datetime.now(tz=ZoneInfo("Asia/Seoul"))


def expected_report_date(market: str) -> str:
    """해당 시장(KR/US) 배치의 '기대 리포트 날짜'(YYYY-MM-DD)를 KST now 기준으로 계산.

    오늘이 스케줄 요일이고 배치 시각이 지났으면 오늘, 아니면 직전 스케줄 영업일.
    스케줄 disabled/요일없음/미시드면 today를 반환(거짓 '미생성' 방지)."""
    from datetime import timedelta
    job_id = _REPORT_BATCH_BY_MARKET.get(market, "daily_report_us")
    try:
        cfg = get_batch_schedule(job_id)
    except Exception as e:
        logger.warning(f"[Report] get_batch_schedule({job_id}) 실패: {e}")
        cfg = None
    now = _now_kst()
    today = now.date()
    enabled_days = {d for d in (cfg or {}).get("days", []) if d in _DAY_ABBR}
    if not cfg or not cfg.get("enabled") or not enabled_days:
        return today.strftime("%Y-%m-%d")
    time_parts = str(cfg.get("time", "00:00")).split(":")
    sched_hour, sched_minute = int(time_parts[0]), int(time_parts[1])
    past_today = (now.hour, now.minute) >= (sched_hour, sched_minute)
    for i in range(7):
        d = today - timedelta(days=i)
        if _DAY_ABBR[d.weekday()] not in enabled_days:
            continue
        if i == 0 and not past_today:
            continue
        return d.strftime("%Y-%m-%d")
    return today.strftime("%Y-%m-%d")


def expected_report_dates() -> dict:
    """시장별 기대 리포트 날짜 {"KR": ..., "US": ...}."""
    return {"KR": expected_report_date("KR"), "US": expected_report_date("US")}

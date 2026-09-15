"""거래소 세션(영업일) 판정 — `skip_holidays` 스위치가 참조하는 순수 함수.

캘린더 범위 밖·로드 실패는 fail-open(영업일 취급) — 휴장일 오판으로 정상 배치를
막는 것보다 낫다(wrong<missing과 같은 방향의 보수적 기본값)."""
from __future__ import annotations
import logging
from datetime import date, datetime, timedelta
from typing import Optional

import exchange_calendars as xcals

from services.batch_registry import get_batch

logger = logging.getLogger(__name__)

_CALENDARS: dict = {}


def _get_calendar(exchange: str):
    cal = _CALENDARS.get(exchange)
    if cal is None:
        cal = xcals.get_calendar(exchange)
        _CALENDARS[exchange] = cal
    return cal


def is_session_day(exchange: str, day: date) -> bool:
    """`exchange`(예: XKRX·XNYS)가 `day`에 개장하는지. 범위 밖·로드 실패는 True(fail-open)."""
    try:
        cal = _get_calendar(exchange)
        if day < cal.first_session.date() or day > cal.last_session.date():
            logger.warning(f"[MarketSession] 캘린더 범위 밖 exchange={exchange} day={day} — 영업일 취급")
            return True
        return bool(cal.is_session(day.isoformat()))
    except Exception as e:
        logger.warning(f"[MarketSession] 캘린더 판정 실패 exchange={exchange} day={day}: {e} — 영업일 취급")
        return True


def exchange_for(job_id: str) -> Optional[str]:
    """레지스트리에 등록된 배치의 거래소(없으면 None)."""
    entry = get_batch(job_id)
    if not entry:
        return None
    return entry.get("exchange")


def session_date_for(job_id: str, run_dt: datetime) -> Optional[date]:
    """`job_id`의 세션 판정일 = `run_dt`의 날짜 + 레지스트리 `session_offset_days`(기본 0).

    레지스트리에 `exchange`가 없는 job_id는 세션 판정 대상이 아니므로 None."""
    entry = get_batch(job_id)
    if not entry or not entry.get("exchange"):
        return None
    offset = entry.get("session_offset_days", 0)
    return run_dt.date() + timedelta(days=offset)

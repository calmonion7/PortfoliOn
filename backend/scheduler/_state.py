from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler

_scheduler = AsyncIOScheduler()
_DIGEST_JOB_ID = "daily_digest"
_VALID_DAYS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}
_DAY_MAP = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}

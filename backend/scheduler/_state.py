from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler

_scheduler = AsyncIOScheduler()
_DIGEST_JOB_ID = "daily_digest"
_VALID_DAYS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}

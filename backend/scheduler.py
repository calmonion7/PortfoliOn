from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from services import storage, report_generator

_scheduler = AsyncIOScheduler()
_JOB_ID = "daily_report"

_DAY_MAP = {
    "mon": "mon", "tue": "tue", "wed": "wed",
    "thu": "thu", "fri": "fri", "sat": "sat", "sun": "sun",
}


def _generate_all():
    portfolio = storage.get_portfolio()
    for stock in portfolio.get("stocks", []):
        try:
            report_generator.generate_report(stock)
            print(f"[Scheduler] Report generated for {stock['ticker']}")
        except Exception as e:
            print(f"[Scheduler] Failed for {stock['ticker']}: {e}")


def _reschedule():
    cfg = storage.get_schedule()
    if _scheduler.get_job(_JOB_ID):
        _scheduler.remove_job(_JOB_ID)
    if not cfg.get("enabled"):
        return
    time_parts = cfg["time"].split(":")
    hour, minute = int(time_parts[0]), int(time_parts[1])
    days_str = ",".join(_DAY_MAP[d] for d in cfg.get("days", []) if d in _DAY_MAP)
    if not days_str:
        return
    _scheduler.add_job(
        _generate_all,
        CronTrigger(day_of_week=days_str, hour=hour, minute=minute),
        id=_JOB_ID,
    )
    print(f"[Scheduler] Scheduled daily report at {cfg['time']} on {days_str}")


def start():
    _reschedule()
    _scheduler.start()


def stop():
    if _scheduler.running:
        _scheduler.shutdown(wait=False)


def reload():
    _reschedule()

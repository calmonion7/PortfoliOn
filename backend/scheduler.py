from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from services import storage, report_generator, consensus as consensus_svc

_scheduler = AsyncIOScheduler()
_JOB_ID = "daily_report"
_GURU_JOB_ID = "guru_crawl"
_VALID_DAYS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}


def _generate_all():
    portfolio = storage.get_full_portfolio()
    for stock in portfolio.get("stocks", []):
        try:
            report_generator.generate_report(stock)
            print(f"[Scheduler] Report generated for {stock['ticker']}")
        except Exception as e:
            print(f"[Scheduler] Failed for {stock['ticker']}: {e}")
        try:
            consensus_svc.collect(stock["ticker"])
            print(f"[Scheduler] Consensus collected for {stock['ticker']}")
        except Exception as e:
            print(f"[Scheduler] Consensus collection failed for {stock['ticker']}: {e}")


def _reschedule():
    cfg = storage.get_schedule()
    if _scheduler.get_job(_JOB_ID):
        _scheduler.remove_job(_JOB_ID)
    if not cfg.get("enabled"):
        return
    time_parts = cfg["time"].split(":")
    hour, minute = int(time_parts[0]), int(time_parts[1])
    days_str = ",".join(d for d in cfg.get("days", []) if d in _VALID_DAYS)
    if not days_str:
        return
    _scheduler.add_job(
        _generate_all,
        CronTrigger(day_of_week=days_str, hour=hour, minute=minute),
        id=_JOB_ID,
    )
    print(f"[Scheduler] Scheduled daily report at {cfg['time']} on {days_str}")


def _run_guru_crawl():
    from services.guru_scraper import scrape_all_managers
    from datetime import datetime
    try:
        managers = scrape_all_managers()
        storage.save_guru_managers({
            "last_updated": datetime.now().isoformat(timespec="seconds"),
            "managers": managers,
        })
        print("[Scheduler] Guru crawl completed")
    except Exception as e:
        print(f"[Scheduler] Guru crawl failed: {e}")


def _reschedule_guru():
    cfg = storage.get_guru_schedule()
    if _scheduler.get_job(_GURU_JOB_ID):
        _scheduler.remove_job(_GURU_JOB_ID)
    if not cfg.get("enabled"):
        return
    time_parts = cfg["time"].split(":")
    hour, minute = int(time_parts[0]), int(time_parts[1])
    day = cfg.get("day", "sun")
    if day not in _VALID_DAYS:
        day = "sun"
    _scheduler.add_job(
        _run_guru_crawl,
        CronTrigger(day_of_week=day, hour=hour, minute=minute),
        id=_GURU_JOB_ID,
    )
    print(f"[Scheduler] Guru crawl scheduled at {cfg['time']} on {day}")


def start():
    _reschedule()
    _reschedule_guru()
    _scheduler.start()


def stop():
    if _scheduler.running:
        _scheduler.shutdown(wait=False)


def reload():
    _reschedule()


def reload_guru():
    _reschedule_guru()

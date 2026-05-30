from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from services import storage, report_generator, consensus as consensus_svc

_scheduler = AsyncIOScheduler()
_JOB_ID = "daily_report"
_GURU_JOB_ID = "guru_crawl"
_DIGEST_JOB_ID = "daily_digest"
_VALID_DAYS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}


def _generate_all():
    from services.db import query
    user_ids = list({r["user_id"] for r in query("SELECT DISTINCT user_id FROM user_stocks")})
    for user_id in user_ids:
        stocks = storage.get_all_stocks(user_id)
        for stock in stocks:
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
        replace_existing=True,
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


def _refresh_monthly():
    from services.market_indicators_service import _fetch_and_save_econ_indicators, _fetch_and_save_kr_exports
    try:
        _fetch_and_save_econ_indicators()
        print("[Scheduler] Econ indicators refreshed")
    except Exception as e:
        print(f"[Scheduler] Econ indicators refresh failed: {e}")
    try:
        _fetch_and_save_kr_exports()
        print("[Scheduler] KR exports refreshed")
    except Exception as e:
        print(f"[Scheduler] KR exports refresh failed: {e}")


def _refresh_earnings():
    from services.market_indicators_service import _fetch_and_save_m7_earnings, _fetch_and_save_kr_top2_earnings
    try:
        _fetch_and_save_m7_earnings()
        print("[Scheduler] M7 earnings refreshed")
    except Exception as e:
        print(f"[Scheduler] M7 earnings refresh failed: {e}")
    try:
        _fetch_and_save_kr_top2_earnings()
        print("[Scheduler] KR Top2 earnings refreshed")
    except Exception as e:
        print(f"[Scheduler] KR Top2 earnings refresh failed: {e}")


def _run_digest():
    from services import digest_service
    from services.db import query
    try:
        user_ids = list({r["user_id"] for r in query("SELECT DISTINCT user_id FROM user_stocks WHERE type = 'holding'")})
    except Exception as e:
        print(f"[Scheduler] Digest: failed to fetch user list: {e}")
        return
    for user_id in user_ids:
        try:
            d = digest_service.generate(user_id)
            digest_service.send_telegram(d)
            print(f"[Scheduler] Daily digest generated for {user_id}")
        except Exception as e:
            print(f"[Scheduler] Daily digest failed for {user_id}: {e}")


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
        replace_existing=True,
    )
    print(f"[Scheduler] Guru crawl scheduled at {cfg['time']} on {day}")


def start():
    _reschedule()
    _reschedule_guru()
    _scheduler.add_job(
        _run_digest,
        CronTrigger(hour=8, minute=0, timezone="Asia/Seoul"),
        id=_DIGEST_JOB_ID,
        replace_existing=True,
    )
    _scheduler.add_job(
        _refresh_earnings,
        CronTrigger(day_of_week="sun", hour=3, minute=0, timezone="Asia/Seoul"),
        id="earnings_refresh",
        replace_existing=True,
    )
    _scheduler.add_job(
        _refresh_monthly,
        CronTrigger(day=1, hour=2, minute=0, timezone="Asia/Seoul"),
        id="monthly_refresh",
        replace_existing=True,
    )
    _scheduler.start()


def stop():
    if _scheduler.running:
        _scheduler.shutdown(wait=False)


def reload():
    _reschedule()


def reload_guru():
    _reschedule_guru()

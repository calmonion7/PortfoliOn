from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from services import storage, report_generator, consensus_pipeline as _pipeline

_scheduler = AsyncIOScheduler()
_JOB_ID = "daily_report"
_GURU_JOB_ID = "guru_crawl"
_DIGEST_JOB_ID = "daily_digest"
_VALID_DAYS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}


def _generate_all():
    from services.db import query
    user_ids = list({r["user_id"] for r in query("SELECT DISTINCT user_id FROM user_stocks")})
    all_stocks: dict = {}
    for user_id in user_ids:
        stocks = storage.get_all_stocks(user_id)
        for stock in stocks:
            try:
                report_generator.generate_report(stock)
                print(f"[Scheduler] Report generated for {stock['ticker']}")
            except Exception as e:
                print(f"[Scheduler] Failed for {stock['ticker']}: {e}")
            all_stocks[stock["ticker"]] = stock
    try:
        _pipeline.run_daily(list(all_stocks.values()))
        print(f"[Scheduler] Pipeline run_daily completed for {len(all_stocks)} stocks")
    except Exception as e:
        print(f"[Scheduler] Pipeline run_daily failed: {e}")


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
        CronTrigger(day_of_week=days_str, hour=hour, minute=minute, timezone="Asia/Seoul"),
        id=_JOB_ID,
        replace_existing=True,
        misfire_grace_time=82800,
        coalesce=True,
    )
    print(f"[Scheduler] Scheduled daily report at {cfg['time']} KST on {days_str}")


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
    from services.market_indicators import _fetch_and_save_econ_indicators, _fetch_and_save_kr_exports
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
    from services.market_indicators import _fetch_and_save_m7_earnings, _fetch_and_save_kr_top2_earnings
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


def _fetch_leverage():
    from services.leverage_service import fetch_and_store
    try:
        fetch_and_store()
        print("[Scheduler] Leverage indicators fetched")
    except Exception as e:
        print(f"[Scheduler] Leverage fetch failed: {e}")


def _fetch_lending():
    from services.lending_service import fetch_and_store
    try:
        n = fetch_and_store()
        print(f"[Scheduler] Lending balance fetched: {n} rows")
    except Exception as e:
        print(f"[Scheduler] Lending fetch failed: {e}")


def _fetch_kr_rankings():
    from services import ranking_service
    try:
        ranking_service.replace_market_rankings("KR", ranking_service.get_kr_rankings())
        print("[Scheduler] KR rankings refreshed")
    except Exception as e:
        print(f"[Scheduler] KR rankings refresh failed: {e}")


def _fetch_us_rankings():
    from services import ranking_service
    try:
        ranking_service.replace_market_rankings("US", ranking_service.get_us_rankings())
        print("[Scheduler] US rankings refreshed")
    except Exception as e:
        print(f"[Scheduler] US rankings refresh failed: {e}")


def _seed_rankings_if_empty():
    """기동 시 market_rankings가 비어 있으면(예: 장외 시간 배포) 즉시 1회 적재.
    장중 cron이 돌기 전까지 랭킹 탭이 빈 상태로 남는 것을 방지(_check_missed_report와 동일 취지)."""
    from services.db import query as db_query
    try:
        rows = db_query("SELECT 1 FROM market_rankings LIMIT 1")
    except Exception as e:
        print(f"[Scheduler] Rankings seed check failed: {e}")
        return
    if rows:
        return
    print("[Scheduler] market_rankings empty, seeding now...")
    _fetch_kr_rankings()
    _fetch_us_rankings()


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


_DAY_MAP = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}


def _check_missed_report():
    """기동 시 당일 스케줄이 이미 지났는데 리포트가 없으면 즉시 실행."""
    from datetime import datetime, date
    from services.db import query as db_query
    cfg = storage.get_schedule()
    if not cfg.get("enabled"):
        return
    now = datetime.now(tz=__import__("zoneinfo").ZoneInfo("Asia/Seoul"))
    day_abbr = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][now.weekday()]
    if day_abbr not in cfg.get("days", []):
        return
    time_parts = cfg["time"].split(":")
    sched_hour, sched_minute = int(time_parts[0]), int(time_parts[1])
    if now.hour < sched_hour or (now.hour == sched_hour and now.minute < sched_minute):
        return
    today = now.date().strftime("%Y-%m-%d")
    rows = db_query("SELECT 1 FROM snapshots WHERE date = %s LIMIT 1", (today,))
    if rows:
        return
    print(f"[Scheduler] Missed job detected for {today}, running now...")
    _generate_all()


def start():
    _reschedule()
    _reschedule_guru()
    _check_missed_report()
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
    _scheduler.add_job(
        _fetch_leverage,
        CronTrigger(hour=7, minute=0, timezone="Asia/Seoul"),
        id="leverage_fetch",
        replace_existing=True,
    )
    _scheduler.add_job(
        _fetch_lending,
        CronTrigger(day=5, hour=8, minute=0, timezone="Asia/Seoul"),
        id="lending_fetch",
        replace_existing=True,
    )
    _scheduler.add_job(
        _fetch_kr_rankings,
        CronTrigger(hour="9-15", minute="*/10", timezone="Asia/Seoul"),
        id="kr_rankings_fetch",
        replace_existing=True,
    )
    _scheduler.add_job(
        _fetch_us_rankings,
        CronTrigger(hour="9-16", minute="*/10", timezone="America/New_York"),
        id="us_rankings_fetch",
        replace_existing=True,
    )
    _seed_rankings_if_empty()
    _scheduler.start()


def stop():
    if _scheduler.running:
        _scheduler.shutdown(wait=False)


def reload():
    _reschedule()


def reload_guru():
    _reschedule_guru()

from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from services import storage, report_generator, consensus_pipeline as _pipeline, job_runs
from services import batch_registry
from services.schedule_spec import build_trigger_kwargs

_scheduler = AsyncIOScheduler()
_DIGEST_JOB_ID = "daily_digest"
_VALID_DAYS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}


def _generate_all():
    from services.db import query
    with job_runs.record("daily_report", "auto"):
        user_ids = list({r["user_id"] for r in query("SELECT DISTINCT user_id FROM user_stocks")})
        all_stocks: dict = {}
        for user_id in user_ids:
            stocks = storage.get_all_stocks(user_id)
            for stock in stocks:
                try:
                    report_generator.generate_report_with_retry(stock)
                    print(f"[Scheduler] Report generated for {stock['ticker']}")
                except Exception as e:
                    print(f"[Scheduler] Failed for {stock['ticker']}: {e}")
                all_stocks[stock["ticker"]] = stock
        try:
            _pipeline.run_daily(list(all_stocks.values()))
            print(f"[Scheduler] Pipeline run_daily completed for {len(all_stocks)} stocks")
        except Exception as e:
            print(f"[Scheduler] Pipeline run_daily failed: {e}")


def _run_guru_crawl():
    from services.guru_scraper import scrape_all_managers
    from datetime import datetime
    with job_runs.record("guru_crawl", "auto"):
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
    with job_runs.record("monthly_refresh", "auto"):
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
    with job_runs.record("earnings_refresh", "auto"):
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
    with job_runs.record("daily_digest", "auto"):
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
    with job_runs.record("leverage_fetch", "auto"):
        try:
            fetch_and_store()
            print("[Scheduler] Leverage indicators fetched")
        except Exception as e:
            print(f"[Scheduler] Leverage fetch failed: {e}")


def _fetch_lending():
    from services.lending_service import fetch_and_store
    with job_runs.record("lending_fetch", "auto"):
        try:
            n = fetch_and_store()
            print(f"[Scheduler] Lending balance fetched: {n} rows")
        except Exception as e:
            print(f"[Scheduler] Lending fetch failed: {e}")


def _fetch_backlog():
    from services.backlog import fetch_all_backlog
    with job_runs.record("backlog_fetch", "auto"):
        try:
            r = fetch_all_backlog()
            print(f"[Scheduler] Backlog fetched: {r}")
        except Exception as e:
            print(f"[Scheduler] Backlog fetch failed: {e}")


def _fetch_kr_rankings():
    from services import ranking_service
    with job_runs.record("kr_rankings_fetch", "auto"):
        try:
            ranking_service.replace_market_rankings("KR", ranking_service.get_kr_rankings())
            print("[Scheduler] KR rankings refreshed")
        except Exception as e:
            print(f"[Scheduler] KR rankings refresh failed: {e}")


def _fetch_us_rankings():
    from services import ranking_service
    with job_runs.record("us_rankings_fetch", "auto"):
        try:
            ranking_service.replace_market_rankings("US", ranking_service.get_us_rankings())
            print("[Scheduler] US rankings refreshed")
        except Exception as e:
            print(f"[Scheduler] US rankings refresh failed: {e}")


def _fetch_investor_trend():
    with job_runs.record("investor_trend_fetch", "auto"):
        _investor_trend_work()


def _investor_trend_work():
    """KR 랭킹 종목 일일 수급 배치: 전진 적립 + 종목당 1청크 후진 백필.

    전진: 최신 /trend → upsert (빈 테이블이면 ~10일 시드).
    후진: oldest_date가 ~1년(약 365일) 이내면 그 날짜 이전 10일을 1청크 fetch.
    종목당 ~2 호출/회, ThreadPoolExecutor 병렬(정중한 동시성)."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from datetime import date, timedelta
    from services import investor_service as svc
    from services.db import query as db_query

    try:
        tickers = [r["ticker"] for r in db_query(
            "SELECT DISTINCT ticker FROM market_rankings WHERE market = 'KR'")]
    except Exception as e:
        print(f"[Scheduler] Investor trend: failed to fetch KR universe: {e}")
        return

    backfill_floor = date.today() - timedelta(days=365)

    def _fetch_one(ticker):
        # 전진
        try:
            svc.upsert_trend(ticker, svc.fetch_trend(ticker))
        except Exception as e:
            print(f"[Scheduler] Investor trend forward failed for {ticker}: {e}")
        # 후진 (1청크) — oldest가 1년 캡 이내일 때만
        try:
            oldest = svc.oldest_date(ticker)
            if oldest is not None and oldest > backfill_floor:
                older = svc.fetch_trend(ticker, bizdate=oldest.strftime("%Y%m%d"))
                if older:
                    svc.upsert_trend(ticker, older)
        except Exception as e:
            print(f"[Scheduler] Investor trend backfill failed for {ticker}: {e}")

    if not tickers:
        print("[Scheduler] Investor trend: no KR tickers")
        return
    # max_workers ≤ 8: 워커가 DB 풀(maxconn=10)에서 커넥션을 점유하므로 풀 초과(PoolError) 방지
    with ThreadPoolExecutor(max_workers=max(1, min(len(tickers), 8))) as executor:
        futures = [executor.submit(_fetch_one, t) for t in tickers]
        for future in as_completed(futures):
            future.result()
    print(f"[Scheduler] Investor trend fetched for {len(tickers)} KR tickers")


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


_JOB_FUNCS = {
    "daily_report": _generate_all,
    "guru_crawl": _run_guru_crawl,
    "daily_digest": _run_digest,
    "earnings_refresh": _refresh_earnings,
    "monthly_refresh": _refresh_monthly,
    "leverage_fetch": _fetch_leverage,
    "lending_fetch": _fetch_lending,
    "kr_rankings_fetch": _fetch_kr_rankings,
    "us_rankings_fetch": _fetch_us_rankings,
    "investor_trend_fetch": _fetch_investor_trend,
    "backlog_fetch": _fetch_backlog,
}


def _build_trigger(spec: dict, timezone: str) -> CronTrigger:
    return CronTrigger(**build_trigger_kwargs(spec), timezone=timezone)


def _reschedule_job(job_id: str) -> None:
    """편집 가능한 배치 1종을 storage 스펙대로 리스케줄. disabled면 잡 제거만."""
    entry = batch_registry.get_batch(job_id)
    if entry is None or not entry.get("editable"):
        return
    spec = storage.get_batch_schedule(job_id)
    if _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)
    if not spec or not spec.get("enabled"):
        return
    job_kwargs = dict(id=job_id, coalesce=True, replace_existing=True)
    # misfire_grace_time 미지정 시 인자를 빼서 스케줄러 기본값(1초)을 쓴다 —
    # None을 넘기면 APScheduler가 '유예 무제한'으로 해석해 거동이 바뀐다(daily_report만 82800 명시).
    mgt = entry.get("misfire_grace_time")
    if mgt is not None:
        job_kwargs["misfire_grace_time"] = mgt
    _scheduler.add_job(
        _JOB_FUNCS[job_id],
        _build_trigger(spec, entry["timezone"]),
        **job_kwargs,
    )
    print(f"[Scheduler] Scheduled {job_id}: {spec}")


def _seed_spec_for(job_id: str) -> dict:
    """기동 마이그레이션용 시드 스펙. daily_report/guru_crawl은 기존
    schedules/guru_schedules 값을 통합 스펙으로 변환해 거동 보존."""
    if job_id == "daily_report":
        cfg = storage.get_schedule()
        days = [d for d in cfg.get("days", []) if d in _VALID_DAYS]
        if not days:
            days = ["mon", "tue", "wed", "thu", "fri"]
        return {
            "enabled": bool(cfg.get("enabled")),
            "type": "weekly",
            "days": days,
            "time": cfg.get("time", "08:00"),
        }
    if job_id == "guru_crawl":
        cfg = storage.get_guru_schedule()
        day = cfg.get("day", "sun")
        if day not in _VALID_DAYS:
            day = "sun"
        return {
            "enabled": bool(cfg.get("enabled")),
            "type": "weekly",
            "days": [day],
            "time": cfg.get("time", "03:00"),
        }
    return batch_registry.get_batch(job_id)["default_schedule"]


def _seed_batch_schedules() -> None:
    """기동 idempotent 마이그레이션: 편집 배치에 batch_schedules 행이 없으면 시드.
    이미 행이 있으면 건드리지 않는다."""
    for entry in batch_registry.BATCHES:
        if not entry.get("editable"):
            continue
        job_id = entry["id"]
        if storage.get_batch_schedule(job_id) is not None:
            continue
        storage.save_batch_schedule(job_id, _seed_spec_for(job_id))


_DAY_MAP = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}


def _check_missed_report():
    """기동 시 당일 스케줄이 이미 지났는데 리포트가 없으면 즉시 실행."""
    from datetime import datetime, date
    from services.db import query as db_query
    cfg = storage.get_batch_schedule("daily_report")
    if not cfg or not cfg.get("enabled"):
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
    # 전 사용자 종목 중 오늘 스냅샷이 없는 것만 골라 재생성 (부분 누락 복구).
    # 기존엔 "하나라도 있으면 전체 스킵"이라 일부 종목만 빠진 날은 복구되지 않았다.
    user_ids = list({r["user_id"] for r in db_query("SELECT DISTINCT user_id FROM user_stocks")})
    stocks_by_ticker: dict = {}
    for user_id in user_ids:
        for stock in storage.get_all_stocks(user_id):
            stocks_by_ticker.setdefault(stock["ticker"], stock)
    if not stocks_by_ticker:
        return
    have = {r["ticker"] for r in db_query(
        "SELECT DISTINCT ticker FROM snapshots WHERE date = %s AND ticker = ANY(%s)",
        (today, list(stocks_by_ticker.keys())),
    )}
    missing = [s for t, s in stocks_by_ticker.items() if t not in have]
    if not missing:
        return
    print(f"[Scheduler] Missed report: {len(missing)} stock(s) for {today}, generating...")
    for stock in missing:
        try:
            report_generator.generate_report_with_retry(stock)
        except Exception as e:
            print(f"[Scheduler] Missed-report failed for {stock['ticker']}: {e}")
    try:
        _pipeline.run_daily(missing)
    except Exception as e:
        print(f"[Scheduler] Missed-report pipeline failed: {e}")


def start():
    _seed_batch_schedules()
    for entry in batch_registry.BATCHES:
        if entry.get("editable"):
            _reschedule_job(entry["id"])
    _check_missed_report()
    _seed_rankings_if_empty()
    _scheduler.start()


def stop():
    if _scheduler.running:
        _scheduler.shutdown(wait=False)


def reload(job_id: str):
    _reschedule_job(job_id)

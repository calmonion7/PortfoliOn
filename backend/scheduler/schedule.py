from __future__ import annotations

from apscheduler.triggers.cron import CronTrigger
from services import storage, report_generator, consensus_pipeline as _pipeline, batch_registry
from services.schedule_spec import build_trigger_kwargs

from ._state import _scheduler, _VALID_DAYS
from .jobs import _JOB_FUNCS, _in_market


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
    """기동 마이그레이션용 시드 스펙. daily_report_kr/us·guru_crawl은 기존
    schedules/guru_schedules 값을 통합 스펙으로 변환해 거동 보존.

    daily_report_kr/us는 기존 통합 daily_report(batch_schedules)→레거시 get_schedule()
    순으로 enabled·days를 승계하되 time만 신규 기본값(KR 20:30 / US 07:00)으로 override.
    배포 즉시 KR을 오후로 옮기는 마이그레이션."""
    if job_id in ("daily_report_kr", "daily_report_us"):
        cfg = storage.get_batch_schedule("daily_report") or storage.get_schedule()
        days = [d for d in cfg.get("days", []) if d in _VALID_DAYS]
        if not days:
            days = ["mon", "tue", "wed", "thu", "fri"]
        return {
            "enabled": bool(cfg.get("enabled")),
            "type": "weekly",
            "days": days,
            "time": batch_registry.get_batch(job_id)["default_schedule"]["time"],
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
    # earnings_kr/us·monthly_kr/us: 은퇴한 earnings_refresh·monthly_refresh 행의
    # enabled·spec을 그대로 승계(시각 override 없음 — 주/월 주기라 장마감 민감도 없음).
    # 옛 행이 없으면 default_schedule로 폴백.
    if job_id in ("earnings_kr", "earnings_us"):
        old = storage.get_batch_schedule("earnings_refresh")
        if old is not None:
            return old
    if job_id in ("monthly_kr", "monthly_us"):
        old = storage.get_batch_schedule("monthly_refresh")
        if old is not None:
            return old
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


def _check_missed_report():
    """기동 시 시장별(KR/US) 당일 스케줄이 이미 지났는데 리포트가 없으면 즉시 실행."""
    for job_id, market in (("daily_report_kr", "KR"), ("daily_report_us", "US")):
        _check_missed_report_for(job_id, market)


def _check_missed_report_for(job_id: str, market: str):
    from datetime import datetime
    from services.db import query as db_query
    cfg = storage.get_batch_schedule(job_id)
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
    # 전 사용자 종목 중 이 시장에 속하고 오늘 스냅샷이 없는 것만 골라 재생성 (부분 누락 복구).
    # 기존엔 "하나라도 있으면 전체 스킵"이라 일부 종목만 빠진 날은 복구되지 않았다.
    user_ids = list({r["user_id"] for r in db_query("SELECT DISTINCT user_id FROM user_stocks")})
    stocks_by_ticker: dict = {}
    for user_id in user_ids:
        for stock in storage.get_all_stocks(user_id):
            if _in_market(stock, market):
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
    print(f"[Scheduler] Missed report ({market}): {len(missing)} stock(s) for {today}, generating...")
    for stock in missing:
        try:
            report_generator.generate_report_with_retry(stock)
        except Exception as e:
            print(f"[Scheduler] Missed-report failed for {stock['ticker']}: {e}")
    try:
        _pipeline.run_daily(missing)
    except Exception as e:
        print(f"[Scheduler] Missed-report pipeline failed: {e}")

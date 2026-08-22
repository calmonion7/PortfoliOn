from __future__ import annotations

import logging

from apscheduler.triggers.cron import CronTrigger
from services import storage, report_generator, consensus_pipeline as _pipeline, batch_registry
from services.schedule_spec import build_trigger_kwargs, validate_schedule_spec

from ._state import _scheduler, _VALID_DAYS
from .jobs import _JOB_FUNCS, _in_market

logger = logging.getLogger(__name__)


def _build_trigger(spec: dict, timezone: str) -> CronTrigger:
    return CronTrigger(**build_trigger_kwargs(spec), timezone=timezone)


def _reschedule_job(job_id: str) -> None:
    """편집 가능한 배치 1종을 storage 스펙대로 리스케줄. disabled면 잡 제거만.

    저장 스펙이 깨져 있으면(레거시 형태 승계·수기 편집) **그 잡만 건너뛰고 loud하게 남긴다.**
    기동 경로(`scheduler.start`)가 이 함수를 배치마다 호출하고 `_scheduler.start()`가 그 뒤에
    오므로, 예외를 전파하면 행 하나 때문에 앱이 뜨지 않고 전 배치가 미등록된다.
    판정을 `remove_job` **앞에** 두어 reload 실패가 이미 도는 잡을 죽이지 않게 한다.

    ⚠️ 판정 게이트는 `validate_schedule_spec`이 **아니라** `_build_trigger`다(빌드 +
    CronTrigger 생성). 두 축이 다르기 때문이다 — validator는 *새 입력*을 받는 PUT 경계용이라
    더 엄격하고, 그것을 기동 게이트로 쓰면 **변경 전에는 정상 등록·실행되던** 스펙까지
    조용히 미등록된다(로컬 실측 4형태: `time:'7:00'` zero-pad 없음 · `enabled:1` 비-bool 참 ·
    `day_of_month:'15'` 문자열 · `every_minutes:3`). 그 배치는 ERROR 한 줄만 남기고 **영구히
    실행되지 않는데**, `GET /api/batches`의 `enabled=true`+`next_run=null`은 disabled 잡과
    구별되지 않아 며칠 stale해질 때까지 아무도 모른다. 반대로 CronTrigger 생성은 기동을
    실제로 죽이는 실패(`time:''`·`type` 부재·`time:'25:00'`·`days:[]`)를 전부 잡아낸다 —
    즉 「이 스펙으로 잡을 등록할 수 있는가」가 이 자리의 등가 축이다.
    validator 실패는 **경고로만** 남긴다(레거시 형태를 운영자가 PUT으로 정규화할 단서)."""
    entry = batch_registry.get_batch(job_id)
    if entry is None or not entry.get("editable"):
        return
    spec = storage.get_batch_schedule(job_id)
    trigger = None
    if spec and spec.get("enabled"):
        try:
            trigger = _build_trigger(spec, entry["timezone"])
        except Exception as e:
            logger.error(f"[Scheduler] Invalid schedule spec for {job_id}, job left unchanged: {spec!r}: {e}")
            return
        try:
            validate_schedule_spec(spec)
        except Exception as e:
            logger.warning(
                f"[Scheduler] Legacy schedule spec for {job_id} (등록은 유지, PUT으로 정규화 권장): {spec!r}: {e}"
            )
    if _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)
    if trigger is None:
        return
    job_kwargs = dict(id=job_id, coalesce=True, replace_existing=True)
    # misfire_grace_time 미지정 시 인자를 빼서 스케줄러 기본값(1초)을 쓴다 —
    # None을 넘기면 APScheduler가 '유예 무제한'으로 해석해 거동이 바뀐다(daily_report만 82800 명시).
    mgt = entry.get("misfire_grace_time")
    if mgt is not None:
        job_kwargs["misfire_grace_time"] = mgt
    _scheduler.add_job(_JOB_FUNCS[job_id], trigger, **job_kwargs)
    logger.info(f"[Scheduler] Scheduled {job_id}: {spec}")


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
        spec = _seed_spec_for(job_id)
        try:
            validate_schedule_spec(spec)
        except Exception as e:
            # 은퇴한 earnings_refresh·monthly_refresh 행의 verbatim 승계가 통합 스펙 이전
            # 형태(type 키 없음 등)이면 여기서 걸린다. 깨진 스펙을 시드하면 그 배치가
            # 매 기동마다 _reschedule_job에서 스킵되므로, 레지스트리 기본값으로 폴백한다.
            #
            # `except Exception` — validator는 ValueError만 내는 게 아니다(실측:
            # `days:[['mon']]` → `set(days)`가 TypeError). `_seed_batch_schedules()`는
            # `scheduler.start()`의 **1단계**라 여기서 예외가 새면 잡 단위 가드에 닿지도
            # 못하고 앱이 뜨지 않는다 — 이 가드의 존재 이유가 바로 그 경우다.
            logger.error(f"[Scheduler] Invalid seed spec for {job_id}, using default: {spec!r}: {e}")
            # ⚠️ `enabled`는 승계한다 — 레거시 행에서 실질적으로 유일하게 의미 있는 필드이고,
            #    레지스트리 기본값은 전부 `enabled: True`다. 통째로 교체하면 사용자가 옛 UI에서
            #    **꺼 둔** 배치 4종(earnings_kr/us·monthly_kr/us)이 조용히 켜져 외부 API를
            #    호출한다(verbatim 승계의 목적 자체가 「enabled·spec을 그대로」였다).
            enabled = bool(spec.get("enabled")) if isinstance(spec, dict) else True
            spec = {**entry["default_schedule"], "enabled": enabled}
        storage.save_batch_schedule(job_id, spec)


def _check_missed_report():
    """기동 시 시장별(KR/US) 당일 스케줄이 이미 지났는데 리포트가 없으면 즉시 실행.

    시장 단위로 예외를 잡는다 — `scheduler.start()`가 `_reschedule_job` 루프 **뒤에**
    이것을 호출하고 `_scheduler.start()`는 그 다음이므로, 여기서 예외가 새면 잡 단위
    가드를 다 통과했는데도 **앱이 뜨지 않는다**(= 그 가드가 없애려던 바로 그 결과).
    누락복구는 부가 기능이고 기동은 필수이므로, 한 시장의 실패가 다른 시장·기동을
    막지 않게 한다."""
    for job_id, market in (("daily_report_kr", "KR"), ("daily_report_us", "US")):
        try:
            _check_missed_report_for(job_id, market)
        except Exception as e:
            logger.error(f"[Scheduler] Missed-report check failed for {job_id}: {e}")


def _parse_hhmm(spec: dict):
    """스케줄 스펙의 `time`을 (hour, minute)로. 형태가 깨져 있으면 None.

    저장 스펙은 레거시 verbatim 승계·수기 편집으로 `time`이 빈 문자열이거나 아예 없을
    수 있다 — `int("".split(":")[0])`은 ValueError, 키 부재는 KeyError다."""
    parts = str(spec.get("time") or "").split(":")
    if len(parts) != 2:
        return None
    try:
        hour, minute = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return hour, minute


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
    # `_reschedule_job`의 가드가 이 스펙에 **적용되지 않는다** — 그쪽은 잡 등록만 건너뛰고
    # 이 함수는 같은 행을 독립적으로 다시 읽는다. 여기서 판정하지 않으면 깨진
    # daily_report 행 하나가 기동을 통째로 죽인다(days에 오늘 요일이 없으면 위에서 조기
    # return해 **우연히** 통과하므로 날짜 의존 결함이 된다).
    hhmm = _parse_hhmm(cfg)
    if hhmm is None:
        logger.error(f"[Scheduler] Invalid schedule time for {job_id}, missed-report check skipped: {cfg!r}")
        return
    sched_hour, sched_minute = hhmm
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
    logger.info(f"[Scheduler] Missed report ({market}): {len(missing)} stock(s) for {today}, generating...")
    for stock in missing:
        try:
            report_generator.generate_report_with_retry(stock)
        except Exception as e:
            logger.warning(f"[Scheduler] Missed-report failed for {stock['ticker']}: {e}")
    try:
        _pipeline.run_daily(missing)
    except Exception as e:
        logger.warning(f"[Scheduler] Missed-report pipeline failed: {e}")

from __future__ import annotations

# 외부 소비처(`scheduler.X`)·테스트(`scheduler.job_runs`)가 모듈 속성으로 조회하는 심볼.
from services import storage, report_generator, consensus_pipeline as _pipeline, job_runs
from services import batch_registry

# 공유 상태/상수 (leaf 모듈에서 import — 부분초기화 순환 회피).
from ._state import _scheduler, _DIGEST_JOB_ID, _VALID_DAYS

# 잡 함수 + _JOB_FUNCS (private 포함 명시 re-export — `import *`는 underscore를 건너뜀).
from .jobs import (
    _in_market,
    _generate_all,
    _generate_kr,
    _generate_us,
    _run_guru_crawl,
    _refresh_monthly_us,
    _refresh_macro_signals,
    _refresh_monthly_kr,
    _refresh_earnings_us,
    _refresh_earnings_kr,
    _run_digest,
    _fetch_leverage,
    _fetch_lending,
    _fetch_backlog,
    _fetch_disclosures,
    _fetch_agm,
    _fetch_insider,
    _fetch_dividends,
    _fetch_kr_rankings,
    _fetch_us_rankings,
    _fetch_investor_trend,
    _investor_trend_work,
    _fetch_short_sell,
    _fetch_supply_score,
    _supply_score_work,
    _fetch_recommendation_kr,
    _fetch_recommendation_us,
    _recommendation_work,
    _fetch_kr_sector,
    _short_sell_work,
    _seed_rankings_if_empty,
    _seed_kr_sector_if_empty,
    _JOB_FUNCS,
)

# 스케줄/트리거/시드/누락복구.
from .schedule import (
    _build_trigger,
    _reschedule_job,
    _seed_spec_for,
    _seed_batch_schedules,
    _check_missed_report,
    _check_missed_report_for,
)


def start():
    _seed_batch_schedules()
    for entry in batch_registry.BATCHES:
        if entry.get("editable"):
            _reschedule_job(entry["id"])
    _check_missed_report()
    _seed_rankings_if_empty()
    _seed_kr_sector_if_empty()
    _scheduler.start()


def stop():
    if _scheduler.running:
        _scheduler.shutdown(wait=False)


def reload(job_id: str):
    _reschedule_job(job_id)

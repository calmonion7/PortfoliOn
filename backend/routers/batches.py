from fastapi import APIRouter, Depends, HTTPException, Body

import scheduler
from auth import get_current_user, require_admin
from services import job_runs, storage
from services.batch_registry import BATCHES, get_batch
from services.schedule_spec import validate_schedule_spec, describe_schedule

router = APIRouter(prefix="/api", tags=["batches"])


def _next_run(scheduler_job_id):
    """스케줄러 잡의 다음 실행 시각(isoformat). 잡 없음/None/예외시 None."""
    if not scheduler_job_id:
        return None
    try:
        job = scheduler._scheduler.get_job(scheduler_job_id)
        if job is None or job.next_run_time is None:
            return None
        return job.next_run_time.isoformat()
    except Exception:
        return None


def _schedule_for(entry):
    """편집 가능한 배치의 현재 스케줄 스펙(없으면 default_schedule). 비편집이면 None."""
    if not entry.get("editable"):
        return None
    return storage.get_batch_schedule(entry["id"]) or entry["default_schedule"]


@router.get("/batches")
def list_batches(user_id: str = Depends(get_current_user)):
    """배치 현황: 레지스트리 + 다음 실행 시각 + 최근 실행로그 + (편집가능 시) 스케줄.

    편집 가능한 배치의 schedule_desc는 저장된 스케줄 spec에서 파생(정본).
    비편집 배치는 레지스트리의 정적 문자열을 유지."""
    out = []
    for b in BATCHES:
        sched = _schedule_for(b)
        desc = describe_schedule(sched) if (b.get("editable") and sched) else b["schedule_desc"]
        out.append({
            **b,
            "schedule_desc": desc,
            "next_run": _next_run(b["scheduler_job_id"]),
            "recent_runs": job_runs.recent(b["id"]),
            "schedule": sched,
        })
    return out


@router.get("/batches/{job_id}/schedule")
def get_batch_schedule(job_id: str, user_id: str = Depends(get_current_user)):
    """편집 가능한 배치의 스케줄 스펙(저장값 없으면 default_schedule)."""
    entry = get_batch(job_id)
    if entry is None or not entry.get("editable"):
        raise HTTPException(status_code=404, detail=f"Unknown or non-editable batch: {job_id}")
    return storage.get_batch_schedule(job_id) or entry["default_schedule"]


@router.put("/batches/{job_id}/schedule")
def update_batch_schedule(
    job_id: str,
    schedule: dict = Body(...),
    user_id: str = Depends(require_admin),
):
    """편집 가능한 배치의 스케줄 스펙 저장 후 즉시 리스케줄."""
    entry = get_batch(job_id)
    if entry is None or not entry.get("editable"):
        raise HTTPException(status_code=404, detail=f"Unknown or non-editable batch: {job_id}")
    try:
        validate_schedule_spec(schedule)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    storage.save_batch_schedule(job_id, schedule)
    scheduler.reload(job_id)
    return schedule

from fastapi import APIRouter, Depends

import scheduler
from auth import get_current_user
from services import job_runs
from services.batch_registry import BATCHES

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


@router.get("/batches")
def list_batches(user_id: str = Depends(get_current_user)):
    """배치 현황: 레지스트리 + 다음 실행 시각 + 최근 실행로그."""
    return [
        {
            **b,
            "next_run": _next_run(b["scheduler_job_id"]),
            "recent_runs": job_runs.recent(b["id"]),
        }
        for b in BATCHES
    ]

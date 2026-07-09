import logging

from fastapi import APIRouter, Depends
from services import digest_service, job_runs
from services.db import query
from auth import get_current_user, require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["digest"])


def _holding_user_ids() -> list[str]:
    return list({r["user_id"] for r in query(
        "SELECT DISTINCT user_id FROM user_stocks WHERE type = 'holding'")})


@router.get("/digest/latest")
def get_latest(user_id: str = Depends(get_current_user)):
    return digest_service.get_latest(user_id)


@router.post("/digest/generate")
def generate(user_id: str = Depends(get_current_user)):
    return digest_service.generate(user_id)


@router.post("/digest/generate-all")
def generate_all(_: str = Depends(require_admin)):
    """전체 holding 사용자 다이제스트 생성 (스케줄러 _run_digest와 동일 로직)."""
    with job_runs.record("daily_digest", "manual"):
        user_ids = _holding_user_ids()
        for uid in user_ids:
            try:
                d = digest_service.generate(uid)
                digest_service.send_telegram(d)
            except Exception as e:
                logger.warning(f"[Digest] generate-all failed for {uid}: {e}")
    return {"ok": True, "users": len(user_ids)}

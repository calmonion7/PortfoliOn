import logging
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from datetime import datetime
from services import storage
from services import job_runs
from services.guru_scraper import scrape_all_managers
from services.guru_stats import compute_popularity, compute_weighted, compute_allocation
from services.progress import ProgressTracker
from auth import require_admin, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/guru", tags=["guru"])

_progress = ProgressTracker()


_DETAIL_ONLY_KEYS = ("holdings", "sold_out")   # 상세 전용 계층 — 목록 페이로드에서 벗긴다


@router.get("/managers")
def get_managers(_: str = Depends(get_current_user)):
    data = storage.get_guru_managers()
    return {
        **data,
        "managers": [
            {k: v for k, v in m.items() if k not in _DETAIL_ONLY_KEYS}
            for m in data.get("managers", [])
        ],
    }


@router.get("/managers/{manager_id}")
def get_manager_detail(manager_id: str, _: str = Depends(get_current_user)):
    data = storage.get_guru_managers()
    for m in data.get("managers", []):
        if m.get("id") == manager_id:
            return m
    raise HTTPException(status_code=404, detail="Manager not found")


@router.get("/stats/popularity")
def stats_popularity(_: str = Depends(get_current_user)):
    data = storage.get_guru_managers()
    return compute_popularity(data.get("managers", []))


@router.get("/stats/weighted")
def stats_weighted(_: str = Depends(get_current_user)):
    data = storage.get_guru_managers()
    return compute_weighted(data.get("managers", []))


@router.get("/stats/allocation")
def stats_allocation(_: str = Depends(get_current_user)):
    data = storage.get_guru_managers()
    return compute_allocation(data.get("managers", []))


@router.get("/crawl/progress")
def crawl_progress(_: str = Depends(get_current_user)):
    return _progress.get()


@router.post("/crawl", status_code=202)
def start_crawl(background_tasks: BackgroundTasks, _: str = Depends(require_admin)):
    if _progress.get()["running"]:
        raise HTTPException(status_code=409, detail="Crawl already running")
    background_tasks.add_task(_run_crawl)
    return {"message": "Crawl started"}


def _run_crawl():
    def on_progress(done: int, total: int, current: str):
        _progress.set(running=True, done=done, total=total, current=current)

    with job_runs.record("guru_crawl", "manual"):
        _progress.set(running=True)
        try:
            managers = scrape_all_managers(on_progress=on_progress)
            if not storage.save_guru_managers({
                "last_updated": datetime.now().isoformat(timespec="seconds"),
                "managers": managers,
            }):
                logger.warning("[Guru] 빈 결과 — 저장 생략, 직전값 유지 (manual)")
        except Exception as e:
            logger.warning(f"[Guru] Crawl failed: {e}")
        finally:
            _progress.finish()

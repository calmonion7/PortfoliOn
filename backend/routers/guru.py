from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from datetime import datetime
from services import storage
from services import job_runs
from services.guru_scraper import scrape_all_managers
from services.guru_stats import compute_popularity, compute_manager_top3, compute_weighted
from services.progress import ProgressTracker
from auth import require_admin

router = APIRouter(prefix="/api/guru", tags=["guru"])

_progress = ProgressTracker()


@router.get("/managers")
def get_managers():
    return storage.get_guru_managers()


@router.get("/stats/popularity")
def stats_popularity():
    data = storage.get_guru_managers()
    return compute_popularity(data.get("managers", []))


@router.get("/stats/manager-top3")
def stats_manager_top3():
    data = storage.get_guru_managers()
    return compute_manager_top3(data.get("managers", []))


@router.get("/stats/weighted")
def stats_weighted():
    data = storage.get_guru_managers()
    return compute_weighted(data.get("managers", []))


@router.get("/crawl/progress")
def crawl_progress():
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
            storage.save_guru_managers({
                "last_updated": datetime.now().isoformat(timespec="seconds"),
                "managers": managers,
            })
        except Exception as e:
            print(f"[Guru] Crawl failed: {e}")
        finally:
            _progress.finish()

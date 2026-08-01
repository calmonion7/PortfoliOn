import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Query
from datetime import datetime
from services import storage
from services import job_runs
from services.guru_scraper import scrape_all_managers
from services.guru_stats import compute_popularity, compute_weighted, compute_allocation
from services.progress import ProgressTracker
from auth import require_admin, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/guru", tags=["guru"])

# result: 크롤 종료 사유("saved"|"skipped"|"failed") — 저장 생략을 프론트가 초록 "완료"와
# 구분하려면 진행 상태만으론 부족하다(task#262). ProgressTracker 공통 스키마는 건드리지 않고
# 인스턴스 extra로 얹는다(report.py의 ProgressTracker(created=0)와 같은 방식).
_progress = ProgressTracker(result=None)


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
def stats_allocation(top: Optional[int] = Query(None, ge=1), _: str = Depends(get_current_user)):
    data = storage.get_guru_managers()
    return {
        "last_updated": data.get("last_updated"),
        **compute_allocation(data.get("managers", []), top=top),
    }


@router.get("/crawl/progress")
def crawl_progress(_: str = Depends(get_current_user)):
    return _progress.get()


@router.post("/crawl", status_code=202)
def start_crawl(background_tasks: BackgroundTasks, _: str = Depends(require_admin)):
    if _progress.get()["running"]:
        raise HTTPException(status_code=409, detail="Crawl already running")
    # BackgroundTasks는 응답 *후* 실행되므로, 리셋을 _run_crawl에만 두면 POST 직후~배치 시작
    # 사이에 폴러가 직전 실행의 result와 running=False를 읽어 즉시 완료로 오판한다.
    # fresh/stale도 같은 이유로 여기서 함께 비운다 — 안 하면 폴러가 직전 크롤의 건수를
    # 이번 실행의 것으로 표시한다(BH7-H1).
    _progress.set(running=True, done=0, total=0, current="", result=None, fresh=None, stale=None)
    background_tasks.add_task(_run_crawl)
    return {"message": "Crawl started"}


def _run_crawl():
    def on_progress(done: int, total: int, current: str):
        _progress.set(running=True, done=done, total=total, current=current)

    with job_runs.record("guru_crawl", "manual"):
        _progress.set(running=True, result=None, fresh=None, stale=None)
        result = "failed"
        try:
            managers, roster = scrape_all_managers(on_progress=on_progress)
            stats = storage.save_guru_managers({
                "last_updated": datetime.now().isoformat(timespec="seconds"),
                "managers": managers,
                "roster": roster,
            })
            if stats["saved"]:
                # 부분 성공을 'saved'(초록)로 뭉뚱그리면 화면이 데이터 절반 소실을 성공으로
                # 단언한다 — 직전값으로 백필된 매니저가 하나라도 있으면 'partial'이다(BH7-H1).
                result = "partial" if stats["stale"] else "saved"
                _progress.set(fresh=stats["fresh"], stale=stats["stale"])
                if stats["stale"]:
                    logger.warning(
                        f"[Guru] 부분 크롤 — 갱신 {stats['fresh']} · 직전값 유지 {stats['stale']} (manual)"
                    )
            else:
                result = "skipped"
                logger.warning("[Guru] 빈 결과 — 저장 생략, 직전값 유지 (manual)")
        except Exception as e:
            logger.warning(f"[Guru] Crawl failed: {e}")
        finally:
            _progress.set(result=result)
            _progress.finish()

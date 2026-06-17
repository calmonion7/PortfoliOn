"""종목 추천 API (.forge/adr/0015 §6 per-user partition).

GET /api/recommendations — 발굴 섹션(글로벌 점수 − 호출자 추적종목, 점수 내림차순).
  저장값만 읽음(요청경로 외부 호출 0). 응답은 섹션 키 객체(additive) — part3/4가
  "watchlist"/"holdings" 키를 추가만으로 붙인다.
POST /api/recommendations/refresh — admin, market 쿼리(KR|US) 수동 트리거.
"""
from fastapi import APIRouter, Query, Depends, BackgroundTasks, HTTPException
from auth import get_current_user, require_admin
from services import recommendation, storage, job_runs
import scheduler

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])


@router.get("")
def get_recommendations(
    limit: int = Query(50, ge=1, le=200),
    user_id: str = Depends(get_current_user),
):
    """발굴 섹션 반환(저장값 read-only, 호출자 추적종목 제외, 점수 내림차순).

    응답 shape(섹션 키 객체):
        {"as_of": <date|null>, "discovery": [{ticker,name,market,score,flags,rank}, ...]}
    part3/4가 "watchlist"/"holdings" 키를 additive로 추가한다.
    """
    tracked = [s["ticker"] for s in storage.get_all_stocks(user_id) if s.get("ticker")]
    rows = recommendation.read_recommendations(exclude_tickers=tracked, limit=limit)

    as_of = None
    discovery = []
    for r in rows:
        bd = r.get("base_date")
        bd_str = bd.isoformat() if hasattr(bd, "isoformat") else (str(bd) if bd else None)
        if bd_str and (as_of is None or bd_str > as_of):
            as_of = bd_str
        discovery.append({
            "ticker": r["ticker"],
            "name": r.get("name"),
            "market": r.get("market"),
            "score": float(r["score"]) if r.get("score") is not None else None,
            "flags": r.get("flags") or [],
            "rank": r.get("rank"),
        })

    return {"as_of": as_of, "discovery": discovery}


@router.post("/refresh", status_code=202)
def refresh_recommendations(
    background_tasks: BackgroundTasks,
    market: str = Query(..., pattern="^(KR|US)$"),
    _: str = Depends(require_admin),
):
    """추천 점수 갱신(scheduler._recommendation_work, admin 전용). market=KR|US."""
    job_id = "recommendation_kr" if market == "KR" else "recommendation_us"

    def _run():
        with job_runs.record(job_id, "manual"):
            scheduler._recommendation_work(market)

    background_tasks.add_task(_run)
    return {"ok": True}

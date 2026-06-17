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
    """발굴·관심 섹션 반환(저장값 read-only, 점수 내림차순).

    응답 shape(섹션 키 객체):
        {"as_of": <date|null>,
         "discovery": [{ticker,name,market,score,flags,rank}, ...],  # 호출자 추적종목 제외
         "watchlist": [{ticker,name,market,score,flags,rank}, ...]}  # 호출자 관심종목, 점수 없으면 score=None 말미
    part4가 "holdings" 키를 additive로 추가한다.
    """
    portfolio = storage.get_full_portfolio(user_id)
    wl_stocks = portfolio["watchlist"]
    all_stocks = portfolio["stocks"] + wl_stocks
    tracked = [s["ticker"] for s in all_stocks if s.get("ticker")]
    rows = recommendation.read_recommendations(exclude_tickers=tracked, limit=limit)

    def _item(r):
        return {
            "ticker": r["ticker"],
            "name": r.get("name"),
            "market": r.get("market"),
            "score": float(r["score"]) if r.get("score") is not None else None,
            "flags": r.get("flags") or [],
            "rank": r.get("rank"),
        }

    def _as_of(rows_, current):
        for r in rows_:
            bd = r.get("base_date")
            bd_str = bd.isoformat() if hasattr(bd, "isoformat") else (str(bd) if bd else None)
            if bd_str and (current is None or bd_str > current):
                current = bd_str
        return current

    as_of = _as_of(rows, None)
    discovery = [_item(r) for r in rows]

    # 관심 섹션: 호출자 watchlist를 저장 점수로 score DESC 정렬(저장값 read만).
    wl_tickers = [s["ticker"] for s in wl_stocks if s.get("ticker")]
    watchlist = []
    if wl_tickers:
        scored = recommendation.read_recommendations(only_tickers=wl_tickers)
        as_of = _as_of(scored, as_of)
        scored_by_ticker = {r["ticker"].upper(): r for r in scored}
        watchlist = [_item(r) for r in scored]  # score DESC 보존
        for s in wl_stocks:
            t = s.get("ticker")
            if not t or t.upper() in scored_by_ticker:
                continue
            watchlist.append({
                "ticker": t,
                "name": s.get("name"),
                "market": s.get("market"),
                "score": None,
                "flags": [],
                "rank": None,
            })

    return {"as_of": as_of, "discovery": discovery, "watchlist": watchlist}


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

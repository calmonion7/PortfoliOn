# backend/routers/analysis.py
from fastapi import APIRouter, Depends, Query, HTTPException
from services import storage, cache as cache_svc, job_runs, kr_sector_service, us_sector_service
from services.analysis_service import get_sector_momentum, get_macro_correlation
from services.db import query as db_query
from services.market import _norm_sector
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.get("/sector")
def sector(market: str = Query("US"), user_id: str = Depends(get_current_user)):
    """섹터 모멘텀. market=KR이면 키움 업종 모멘텀(저장값)+보유 KR 종목→업종,
    그 외(US/미지정)는 기존 yfinance SECTOR_ETFS 경로(불변)."""
    if market == "KR":
        def _build_kr():
            holdings = storage.get_full_portfolio(user_id).get("stocks", [])
            return {
                "sectors": kr_sector_service.load_momentum(),
                "portfolio_sectors": kr_sector_service.map_holdings_to_sectors(holdings),
            }
        return cache_svc.get_sector(user_id, _build_kr, market="KR")

    def _build():
        holdings = storage.get_full_portfolio(user_id).get("stocks", [])
        if holdings:
            tickers = [h["ticker"].upper() for h in holdings]
            rows = db_query(
                "SELECT DISTINCT ON (ticker) ticker, data->>'sector' AS sector "
                "FROM snapshots WHERE ticker = ANY(%s) AND data->>'sector' IS NOT NULL AND data->>'sector' != '' "
                "ORDER BY ticker, date DESC",
                (tickers,),
            )
            sector_map = {r["ticker"]: _norm_sector(r["sector"]) for r in rows}
            for h in holdings:
                h["sector"] = sector_map.get(h["ticker"].upper(), "")
        return get_sector_momentum(holdings)
    return cache_svc.get_sector(user_id, _build, market="US")


@router.post("/sector/refresh-kr")
def refresh_kr_sector(_: str = Depends(require_admin)):
    """KR 업종 모멘텀 수동 갱신(kr_sector_fetch). 전 업종 series fetch→momentum 저장."""
    try:
        with job_runs.record("kr_sector_fetch", "manual"):
            sectors = kr_sector_service.refresh()
        cache_svc.invalidate_sector()
        return {"ok": True, "sectors": len(sectors)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sector/refresh-us")
def refresh_us_sector(_: str = Depends(require_admin)):
    """US 섹터 모멘텀 수동 갱신(us_sector_fetch). 전 ETF series fetch→momentum 저장."""
    try:
        with job_runs.record("us_sector_fetch", "manual"):
            sectors = us_sector_service.refresh()
        cache_svc.invalidate_sector()
        return {"ok": True, "sectors": len(sectors)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/macro-correlation")
def macro_correlation(user_id: str = Depends(get_current_user)):
    def _build():
        holdings = storage.get_full_portfolio(user_id).get("stocks", [])
        return get_macro_correlation(holdings)
    return cache_svc.get_macro(user_id, _build)

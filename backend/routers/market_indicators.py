from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from services.leverage_service import get_leverage_data, get_coverage, backfill_with_progress, _backfill_progress
from auth import require_admin
from services.market_indicators_service import (
    get_treasury,
    get_m7_earnings,
    get_kr_top2_earnings,
    get_kr_exports,
    get_fx,
    get_vix,
    get_commodities,
    get_econ_indicators,
    _fetch_and_save_m7_earnings,
    _fetch_and_save_kr_top2_earnings,
    _fetch_and_save_econ_indicators,
    _mc_delete,
    _cache,
)

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("/treasury")
def treasury():
    try:
        return get_treasury()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/m7-earnings")
def m7_earnings():
    try:
        return get_m7_earnings()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/kr-top2-earnings")
def kr_top2_earnings():
    try:
        return get_kr_top2_earnings()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/kr-exports")
def kr_exports():
    try:
        return get_kr_exports()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/fx")
def fx():
    try:
        return get_fx()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/vix")
def vix():
    try:
        return get_vix()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/commodities")
def commodities():
    try:
        return get_commodities()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/econ-indicators")
def econ_indicators():
    try:
        return get_econ_indicators()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh-earnings")
def refresh_earnings():
    try:
        m7 = _fetch_and_save_m7_earnings()
        kr = _fetch_and_save_kr_top2_earnings()
        return {"ok": True, "m7_quarters": len(m7.get("quarters", [])), "kr_quarters": len(kr.get("quarters", []))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh-econ")
def refresh_econ():
    try:
        data = _fetch_and_save_econ_indicators()
        return {"ok": True, "cpi_points": len(data.get("cpi", [])), "unemp_points": len(data.get("unemployment", []))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/leverage")
def leverage():
    try:
        return get_leverage_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/leverage/coverage")
def leverage_coverage():
    try:
        return get_coverage()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/leverage/backfill")
def leverage_backfill(
    background_tasks: BackgroundTasks,
    start_year: int = 2021,
    end_year: int = 2026,
    user_id: str = Depends(require_admin),
):
    import services.leverage_service as svc
    if svc._backfill_progress.get("running"):
        raise HTTPException(status_code=409, detail="이미 백필이 실행 중입니다.")
    background_tasks.add_task(backfill_with_progress, start_year, end_year)
    return {"ok": True, "start_year": start_year, "end_year": end_year}


@router.get("/leverage/backfill/progress")
def leverage_backfill_progress():
    import services.leverage_service as svc
    return svc._backfill_progress


@router.post("/refresh-market")
def refresh_market():
    """FX/VIX/Treasury/Commodities Supabase 캐시 초기화 후 1년치 재조회."""
    try:
        for key in ("fx", "vix", "treasury", "commodities"):
            _mc_delete(key)
            _cache.pop(key, None)
        fx = get_fx()
        vix = get_vix()
        treasury = get_treasury()
        commodities = get_commodities()
        return {
            "ok": True,
            "fx_points": len((fx.get("history") or {}).get("usdkrw", [])),
            "vix_points": len(vix.get("history", [])),
            "treasury_points": len((treasury.get("history") or {}).get("10y", [])),
            "commodities_gold_points": len((commodities.get("history") or {}).get("gold", [])),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Query
from services.leverage_service import get_leverage_data, get_coverage, backfill_with_progress, _backfill_progress
from services.lending_service import get_lending_data, fetch_and_store as lending_fetch_and_store
from services import job_runs
from auth import require_admin
from services.market_indicators import (
    get_treasury,
    get_m7_earnings,
    get_kr_top2_earnings,
    get_kr_exports,
    get_fx,
    get_vix,
    get_commodities,
    get_econ_indicators,
    get_macro_signals,
    get_indices,
    _fetch_and_save_m7_earnings,
    _fetch_and_save_kr_top2_earnings,
    _fetch_and_save_econ_indicators,
    _fetch_and_save_kr_exports,
    _fetch_and_save_macro_signals,
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


@router.get("/indices")
def indices():
    try:
        return get_indices()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/macro-signals")
def macro_signals():
    """FRED 매크로 신호(금리차·HY·M2·기준금리) 저장 시계열+신호. 요청경로 라이브 FRED 0."""
    try:
        return get_macro_signals()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh-macro-signals")
def refresh_macro_signals(_: str = Depends(require_admin)):
    """매크로 신호(FRED 4종) 수동 갱신 — macro_signals_fetch로 기록."""
    try:
        with job_runs.record("macro_signals_fetch", "manual"):
            data = _fetch_and_save_macro_signals()
        return {"ok": True, "yield_curve_points": len(data.get("yield_curve", [])),
                "signals": data.get("signals", {})}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh-earnings")
def refresh_earnings(market: str = Query("KR"), _: str = Depends(require_admin)):
    """시장별 실적 갱신: KR=KR Top2(earnings_kr) / US=M7(earnings_us). 각자 자기 id로 기록."""
    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="market must be KR or US")
    try:
        if market == "KR":
            with job_runs.record("earnings_kr", "manual"):
                kr = _fetch_and_save_kr_top2_earnings()
            return {"ok": True, "market": "KR", "kr_quarters": len(kr.get("quarters", []))}
        with job_runs.record("earnings_us", "manual"):
            m7 = _fetch_and_save_m7_earnings()
        return {"ok": True, "market": "US", "m7_quarters": len(m7.get("quarters", []))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh-econ")
def refresh_econ(_: str = Depends(require_admin)):
    """FRED 경제지표 단독 갱신(고아 엔드포인트) — monthly_us(해외 월간)로 흡수 기록."""
    try:
        with job_runs.record("monthly_us", "manual"):
            data = _fetch_and_save_econ_indicators()
        return {"ok": True, "cpi_points": len(data.get("cpi", [])), "unemp_points": len(data.get("unemployment", []))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh-monthly")
def refresh_monthly(market: str = Query("US"), _: str = Depends(require_admin)):
    """시장별 월간 지표 갱신: KR=KR 수출(monthly_kr) / US=FRED 경제지표(monthly_us). 각자 자기 id로 기록."""
    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="market must be KR or US")
    try:
        if market == "KR":
            with job_runs.record("monthly_kr", "manual"):
                exports = _fetch_and_save_kr_exports()
            return {"ok": True, "market": "KR", "export_points": len(exports.get("history", []))}
        with job_runs.record("monthly_us", "manual"):
            econ = _fetch_and_save_econ_indicators()
        return {"ok": True, "market": "US", "cpi_points": len(econ.get("cpi", [])), "unemp_points": len(econ.get("unemployment", []))}
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


@router.get("/lending")
def lending():
    try:
        return get_lending_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/lending/sync")
def lending_sync(user_id: str = Depends(require_admin)):
    try:
        with job_runs.record("lending_fetch", "manual"):
            n = lending_fetch_and_store()
        return {"ok": True, "rows": n}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh-market")
def refresh_market(_: str = Depends(require_admin)):
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

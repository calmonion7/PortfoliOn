from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Query
from services.leverage_service import get_leverage_data, get_coverage, backfill_with_progress, _backfill_progress
from services.lending_service import get_lending_data, fetch_and_store as lending_fetch_and_store
from services import job_runs
from auth import require_admin, get_current_user
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
    get_kospi_signal,
    refresh_kospi_signal,
    get_indices,
    get_fear_greed,
    get_kospi_futures,
    get_business_formation,
    get_labor_surveys,
    _fetch_and_save_m7_earnings,
    _fetch_and_save_kr_top2_earnings,
    _fetch_and_save_econ_indicators,
    _fetch_and_save_kr_exports,
    _fetch_and_save_macro_signals,
    _fetch_and_save_business_formation,
    _fetch_and_save_labor_surveys,
    _mc_delete,
    _cache,
)

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("/treasury")
def treasury(_: str = Depends(get_current_user)):
    try:
        return get_treasury()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/m7-earnings")
def m7_earnings(_: str = Depends(get_current_user)):
    try:
        return get_m7_earnings()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/kr-top2-earnings")
def kr_top2_earnings(_: str = Depends(get_current_user)):
    try:
        return get_kr_top2_earnings()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/kr-exports")
def kr_exports(_: str = Depends(get_current_user)):
    try:
        return get_kr_exports()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/fx")
def fx(_: str = Depends(get_current_user)):
    try:
        return get_fx()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/vix")
def vix(_: str = Depends(get_current_user)):
    try:
        return get_vix()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/commodities")
def commodities(_: str = Depends(get_current_user)):
    try:
        return get_commodities()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/econ-indicators")
def econ_indicators(_: str = Depends(get_current_user)):
    try:
        return get_econ_indicators()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/indices")
def indices(_: str = Depends(get_current_user)):
    try:
        return get_indices()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/kospi-futures")
def kospi_futures(_: str = Depends(get_current_user)):
    try:
        return get_kospi_futures()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/fear-greed")
def fear_greed(_: str = Depends(get_current_user)):
    """CNN Fear & Greed 지수(US). 요청경로 증분(fx/vix 패턴), 배치 없음. CNN 실패 시 직전 저장값 graceful."""
    try:
        return get_fear_greed()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/macro-signals")
def macro_signals(_: str = Depends(get_current_user)):
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


@router.get("/business-formation")
def business_formation(_: str = Depends(get_current_user)):
    """FRED 신규 창업 신청(정보·전문서비스 부문) 저장 시계열+3MA. 요청경로 라이브 FRED 0."""
    try:
        return get_business_formation()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh-business-formation")
def refresh_business_formation(_: str = Depends(require_admin)):
    """신규 창업 신청(FRED 2부문) 수동 갱신 — business_formation_fetch로 기록.

    `status`: success(전부 갱신)/partial(일부 부문 실패, 직전값 유지)/skipped(FRED_API_KEY
    미설정 또는 전 부문 실패, 저장 생략) — `ok`만 보면 실패해도 갱신된 것으로 오인하기
    쉬워 함께 반환한다.
    """
    try:
        with job_runs.record("business_formation_fetch", "manual") as run:
            data = _fetch_and_save_business_formation()
            if "error" in data:
                run.set_status("skipped", data["error"])
                return {"ok": False, "status": "skipped", "error": data["error"]}
            status = data.get("_status") or "success"
            if status != "success":
                run.set_status(status)
            return {"ok": status == "success", "status": status,
                    "information_points": len(data.get("information", [])),
                    "professional_points": len(data.get("professional", []))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/labor-surveys")
def labor_surveys(_: str = Depends(get_current_user)):
    """FRED 고용 조사 2종(기업조사 PAYEMS·가계조사 CE16OV) 저장 시계열+12개월 변화. 요청경로 라이브 FRED 0."""
    try:
        return get_labor_surveys()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh-labor-surveys")
def refresh_labor_surveys(_: str = Depends(require_admin)):
    """고용 조사 2종(FRED) 수동 갱신 — labor_surveys_fetch로 기록.

    `status`: success(전부 갱신)/partial(일부 조사 실패, 직전값 유지)/skipped(FRED_API_KEY
    미설정 또는 전 조사 실패, 저장 생략) — `ok`만 보면 실패해도 갱신된 것으로 오인하기
    쉬워 함께 반환한다.
    """
    try:
        with job_runs.record("labor_surveys_fetch", "manual") as run:
            data = _fetch_and_save_labor_surveys()
            if "error" in data:
                run.set_status("skipped", data["error"])
                return {"ok": False, "status": "skipped", "error": data["error"]}
            status = data.get("_status") or "success"
            if status != "success":
                run.set_status(status)
            return {"ok": status == "success", "status": status,
                    "establishment_points": len(data.get("establishment", [])),
                    "household_points": len(data.get("household", []))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/kospi-signal")
def kospi_signal(_: str = Depends(get_current_user)):
    """다음날 코스피 방향 신호(오버나잇 프록시) 저장 시계열+최신. 요청경로 라이브 yfinance 0."""
    try:
        return get_kospi_signal()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh-kospi-signal")
def refresh_kospi_signal_endpoint(_: str = Depends(require_admin)):
    """코스피 방향 신호 수동 갱신 — kospi_signal_fetch로 기록."""
    try:
        with job_runs.record("kospi_signal_fetch", "manual"):
            data = refresh_kospi_signal()
        series = data.get("series", [])
        return {"ok": True, "series_points": len(series),
                "latest": series[-1] if series else None}
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
            # 반환 키는 months다(history 아님 — 옛 표기는 항상 0을 보고했다). `stale`이면
            # 빈 결과로 저장을 생략하고 직전값을 돌려준 것이므로 saved=False.
            return {"ok": True, "market": "KR",
                    "export_points": len(exports.get("months", [])),
                    "saved": not exports.get("stale")}
        with job_runs.record("monthly_us", "manual"):
            econ = _fetch_and_save_econ_indicators()
        return {"ok": True, "market": "US", "cpi_points": len(econ.get("cpi", [])), "unemp_points": len(econ.get("unemployment", []))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/leverage")
def leverage(_: str = Depends(get_current_user)):
    try:
        return get_leverage_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/leverage/coverage")
def leverage_coverage(_: str = Depends(get_current_user)):
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
def leverage_backfill_progress(_: str = Depends(get_current_user)):
    import services.leverage_service as svc
    return svc._backfill_progress


@router.get("/lending")
def lending(_: str = Depends(get_current_user)):
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

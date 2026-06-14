from fastapi import APIRouter, HTTPException, Query, Depends, BackgroundTasks
from services import short_sell_service, job_runs
from auth import require_admin
import scheduler

router = APIRouter(prefix="/api", tags=["short-sell"])


def _to_float(val):
    return float(val) if val is not None else None


def _to_int(val):
    return int(val) if val is not None else None


def _iso_date(val):
    return val.isoformat() if val is not None else None


def _serialize(row: dict) -> dict:
    return {
        "base_date": _iso_date(row["base_date"]),
        "short_volume": _to_int(row["short_volume"]),
        "short_value": _to_int(row["short_value"]),
        "short_ratio": _to_float(row["short_ratio"]),
        "short_balance": _to_int(row["short_balance"]),
        "close_price": _to_int(row["close_price"]),
    }


@router.get("/stocks/{ticker}/short-sell")
def short_sell_trend(ticker: str, days: int = Query(252, ge=1, le=1000)):
    """종목 공매도 추이 시계열 (KR 전용). 데이터 없으면 items 빈 배열."""
    try:
        rows = short_sell_service.read_series(ticker, days)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {
        "ticker": ticker,
        "items": [_serialize(r) for r in rows],
    }


@router.post("/short-sell/refresh", status_code=202)
def refresh_short_sell(background_tasks: BackgroundTasks, _: str = Depends(require_admin)):
    """공매도 추이 갱신 (스케줄러 _short_sell_work 로직, admin 전용)."""
    def _run():
        with job_runs.record("short_sell_fetch", "manual"):
            scheduler._short_sell_work()
    background_tasks.add_task(_run)
    return {"ok": True}

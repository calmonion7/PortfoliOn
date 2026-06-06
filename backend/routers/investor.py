from fastapi import APIRouter, HTTPException, Query
from services import investor_service

router = APIRouter(prefix="/api", tags=["investor"])


def _to_float(val):
    return float(val) if val is not None else None


def _to_int(val):
    return int(val) if val is not None else None


def _iso_date(val):
    return val.isoformat() if val is not None else None


def _serialize_screening(row: dict) -> dict:
    """psycopg2 Decimal/date를 JSON 직렬화 가능 형태로 변환."""
    return {
        "ticker": row["ticker"],
        "name": row["name"],
        "base_date": _iso_date(row["base_date"]),
        "foreign_net": _to_int(row["foreign_net"]),
        "organ_net": _to_int(row["organ_net"]),
        "individual_net": _to_int(row["individual_net"]),
        "foreign_hold_ratio": _to_float(row["foreign_hold_ratio"]),
        "close_price": _to_int(row["close_price"]),
    }


def _serialize_trend(row: dict) -> dict:
    return {
        "base_date": _iso_date(row["base_date"]),
        "foreign_net": _to_int(row["foreign_net"]),
        "organ_net": _to_int(row["organ_net"]),
        "individual_net": _to_int(row["individual_net"]),
        "foreign_hold_ratio": _to_float(row["foreign_hold_ratio"]),
        "close_price": _to_int(row["close_price"]),
    }


@router.get("/investor/screening")
def investor_screening(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    try:
        rows = investor_service.read_screening(limit, offset)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    items = [_serialize_screening(r) for r in rows]
    latest_date = max((it["base_date"] for it in items if it["base_date"]), default=None)
    return {"items": items, "latest_date": latest_date}


@router.get("/stocks/{ticker}/investor-trend")
def investor_trend(ticker: str, days: int = Query(252, ge=1, le=1000)):
    try:
        rows = investor_service.read_series(ticker, days)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {
        "ticker": ticker,
        "items": [_serialize_trend(r) for r in rows],
    }

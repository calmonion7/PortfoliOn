from fastapi import APIRouter, HTTPException, Query
from services import ranking_service

router = APIRouter(prefix="/api", tags=["rankings"])

_MARKETS = {"KR", "US"}
_METRICS = {"value", "volume"}
_TYPES = {"all", "stock", "etf"}


def _to_float(val):
    return float(val) if val is not None else None


def _to_int(val):
    return int(val) if val is not None else None


def _serialize(row: dict) -> dict:
    """psycopg2 Decimal/datetime을 JSON 직렬화 가능 형태로 변환."""
    return {
        "rank": row["rank"],
        "ticker": row["ticker"],
        "name": row["name"],
        "price": _to_float(row["price"]),
        "change_pct": _to_float(row["change_pct"]),
        "trading_value": _to_float(row["trading_value"]),
        "trading_volume": _to_int(row["trading_volume"]),
        "market_cap": _to_float(row["market_cap"]),
        "is_etf": row["is_etf"],
        "exchange": row["exchange"],
    }


@router.get("/rankings")
def rankings(
    market: str = Query("KR"),
    metric: str = Query("value"),
    type: str = Query("all"),
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    if market not in _MARKETS:
        raise HTTPException(status_code=400, detail="market must be KR or US")
    if metric not in _METRICS:
        raise HTTPException(status_code=400, detail="metric must be value or volume")
    if type not in _TYPES:
        raise HTTPException(status_code=400, detail="type must be all, stock, or etf")
    try:
        result = ranking_service.read_rankings(market, metric, type, limit, offset)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {
        "items": [_serialize(r) for r in result["rows"]],
        "base_ts": result["base_ts"],
        "market": market,
        "metric": metric,
    }

# backend/routers/analysis.py
from fastapi import APIRouter, Depends
from services import storage, cache as cache_svc
from services.analysis_service import get_sector_momentum, get_macro_correlation
from services.db import query as db_query
from auth import get_current_user

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.get("/sector")
def sector(user_id: str = Depends(get_current_user)):
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
            sector_map = {r["ticker"]: r["sector"] for r in rows}
            for h in holdings:
                h["sector"] = sector_map.get(h["ticker"].upper(), "")
        return get_sector_momentum(holdings)
    return cache_svc.get_sector(user_id, _build)


@router.get("/macro-correlation")
def macro_correlation(user_id: str = Depends(get_current_user)):
    def _build():
        holdings = storage.get_full_portfolio(user_id).get("stocks", [])
        return get_macro_correlation(holdings)
    return cache_svc.get_macro(user_id, _build)

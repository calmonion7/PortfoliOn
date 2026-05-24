# backend/routers/analysis.py
from fastapi import APIRouter, Depends
from services import storage, cache as cache_svc
from services.analysis_service import get_sector_momentum, get_macro_correlation
from auth import get_current_user

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.get("/sector")
def sector(user_id: str = Depends(get_current_user)):
    def _build():
        holdings = storage.get_full_portfolio(user_id).get("stocks", [])
        return get_sector_momentum(holdings)
    return cache_svc.get_sector(_build)


@router.get("/macro-correlation")
def macro_correlation(user_id: str = Depends(get_current_user)):
    def _build():
        holdings = storage.get_full_portfolio(user_id).get("stocks", [])
        return get_macro_correlation(holdings)
    return cache_svc.get_macro(_build)

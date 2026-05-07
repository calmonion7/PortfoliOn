from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from services import storage

router = APIRouter(prefix="/api/stocks", tags=["stocks"])


class EnrichBody(BaseModel):
    moat: Optional[str] = None
    growth_plan: Optional[str] = None
    recent_disclosures: Optional[str] = None
    competitors: Optional[List[str]] = None


class BatchEnrichItem(BaseModel):
    ticker: str
    moat: Optional[str] = None
    growth_plan: Optional[str] = None
    recent_disclosures: Optional[str] = None
    competitors: Optional[List[str]] = None


@router.get("")
def get_stocks():
    portfolio = storage.get_full_portfolio()
    result = []
    for s in portfolio["stocks"]:
        result.append({"ticker": s["ticker"], "name": s.get("name", s["ticker"]), "type": "holding"})
    for s in portfolio["watchlist"]:
        result.append({"ticker": s["ticker"], "name": s.get("name", s["ticker"]), "type": "watchlist"})
    return result


@router.put("/enrich/batch")
def enrich_batch(items: List[BatchEnrichItem]):
    if not items:
        raise HTTPException(status_code=400, detail="No items provided")
    updated, not_found = [], []
    for item in items:
        fields = {k: v for k, v in item.model_dump().items() if k != "ticker" and v is not None}
        if not fields:
            not_found.append(item.ticker.upper())
            continue
        ok = storage.enrich_stock(item.ticker, fields)
        (updated if ok else not_found).append(item.ticker.upper())
    return {"updated": updated, "not_found": not_found}


@router.put("/{ticker}/enrich")
def enrich_single(ticker: str, body: EnrichBody):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided")
    ok = storage.enrich_stock(ticker, fields)
    if not ok:
        raise HTTPException(status_code=404, detail="Ticker not found")
    return {"ticker": ticker.upper(), "updated": list(fields.keys())}

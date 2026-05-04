from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
from services import storage

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


class Stock(BaseModel):
    ticker: str
    name: str
    quantity: float
    avg_cost: float
    competitors: List[str] = []
    moat: str = ""
    growth_plan: str = ""


@router.get("")
def get_portfolio():
    return storage.get_portfolio()


@router.post("", status_code=201)
def add_stock(stock: Stock):
    portfolio = storage.get_portfolio()
    tickers = [s["ticker"].upper() for s in portfolio["stocks"]]
    if stock.ticker.upper() in tickers:
        raise HTTPException(status_code=400, detail=f"{stock.ticker} already exists")
    portfolio["stocks"].append({**stock.model_dump(), "ticker": stock.ticker.upper()})
    storage.save_portfolio(portfolio)
    return portfolio["stocks"][-1]


@router.put("/{ticker}")
def update_stock(ticker: str, stock: Stock):
    portfolio = storage.get_portfolio()
    idx = next(
        (i for i, s in enumerate(portfolio["stocks"]) if s["ticker"].upper() == ticker.upper()),
        None,
    )
    if idx is None:
        raise HTTPException(status_code=404, detail=f"{ticker} not found")
    portfolio["stocks"][idx] = {**stock.model_dump(), "ticker": ticker.upper()}
    storage.save_portfolio(portfolio)
    return portfolio["stocks"][idx]


@router.delete("/{ticker}")
def delete_stock(ticker: str):
    portfolio = storage.get_portfolio()
    original_len = len(portfolio["stocks"])
    portfolio["stocks"] = [
        s for s in portfolio["stocks"] if s["ticker"].upper() != ticker.upper()
    ]
    if len(portfolio["stocks"]) == original_len:
        raise HTTPException(status_code=404, detail=f"{ticker} not found")
    storage.save_portfolio(portfolio)
    return {"deleted": ticker.upper()}

from __future__ import annotations
import os
import json
import time
import pandas as pd
import yfinance as yf
import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DATA_DIR = os.path.join(_BASE_DIR, "data")

_NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://m.stock.naver.com/",
    "Accept": "application/json, text/plain, */*",
}
_NAVER_BASE = "https://m.stock.naver.com/api/stock"

# 인메모리 TTL 캐시
_cache: dict = {}


def _get_cache(key: str) -> dict | None:
    entry = _cache.get(key)
    if entry and time.time() < entry["expires"]:
        return entry["data"]
    return None


def _set_cache(key: str, data: dict, ttl: int) -> None:
    _cache[key] = {"data": data, "expires": time.time() + ttl}


# ── Treasury ──────────────────────────────────────────────────────────────────

_TREASURY_SYMBOLS = {"3m": "^IRX", "5y": "^FVX", "10y": "^TNX", "30y": "^TYX"}


def _fetch_treasury(args: tuple[str, str]) -> tuple[str, dict | None]:
    key, sym = args
    try:
        hist = yf.Ticker(sym).history(period="1y", interval="1d")
        if hist.empty:
            return key, None
        close = hist["Close"].dropna()
        current = round(float(close.iloc[-1]), 3)
        prev = round(float(close.iloc[-2]), 3) if len(close) > 1 else current
        history = [
            {"date": str(d.date()), "value": round(float(v), 3)}
            for d, v in zip(close.index, close.values)
        ]
        return key, {
            "current": current,
            "change_bp": round((current - prev) * 100, 1),
            "history": history,
        }
    except Exception:
        return key, None


def get_treasury() -> dict:
    cached = _get_cache("treasury")
    if cached:
        return cached

    with ThreadPoolExecutor(max_workers=4) as ex:
        results = dict(ex.map(_fetch_treasury, _TREASURY_SYMBOLS.items()))

    rates = {
        k: {"current": v["current"], "change_bp": v["change_bp"]}
        for k, v in results.items() if v
    }
    history = {k: v["history"] for k, v in results.items() if v and k in ("3m", "10y")}

    spread: list[dict] = []
    if results.get("10y") and results.get("3m"):
        h10 = {d["date"]: d["value"] for d in results["10y"]["history"]}
        h3m = {d["date"]: d["value"] for d in results["3m"]["history"]}
        spread = [
            {"date": dt, "value": round(h10[dt] - h3m[dt], 3)}
            for dt in sorted(set(h10) & set(h3m))
        ]

    data = {"rates": rates, "history": history, "spread": spread}
    _set_cache("treasury", data, ttl=3600)
    return data

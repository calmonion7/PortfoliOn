from __future__ import annotations
import json
import logging
import os
import time
import yfinance as yf
from services.db import query, execute
from services.utils import today_kst

logger = logging.getLogger(__name__)

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_DATA_DIR = os.path.join(_BASE_DIR, "data")

_cache: dict = {}


def _get_cache(key: str) -> dict | None:
    entry = _cache.get(key)
    if entry and time.time() < entry["expires"]:
        return entry["data"]
    return None


def _set_cache(key: str, data: dict, ttl: int) -> None:
    now = time.time()
    expired = [k for k, v in _cache.items() if now >= v["expires"]]
    for k in expired:
        del _cache[k]
    _cache[key] = {"data": data, "expires": now + ttl}


def _mc_load(key: str) -> dict | None:
    try:
        rows = query("SELECT data, fetched_at FROM market_cache WHERE key = %s", (key,))
        if rows:
            return {"data": rows[0]["data"], "fetched_at": rows[0]["fetched_at"]}
    except Exception as e:
        logger.warning(f"[Cache] _mc_load key={key} 실패: {e}")
    return None


def _mc_save(key: str, data: dict) -> None:
    from datetime import datetime, timezone
    try:
        fetched_at = datetime.now(timezone.utc).isoformat()
        execute(
            "INSERT INTO market_cache (key, data, fetched_at) VALUES (%s, %s, %s) "
            "ON CONFLICT (key) DO UPDATE SET data=EXCLUDED.data, fetched_at=EXCLUDED.fetched_at",
            (key, json.dumps(data), fetched_at),
        )
    except Exception as e:
        logger.warning(f"[Cache] _mc_save key={key} 실패: {e}")


def _mc_delete(key: str) -> None:
    try:
        execute("DELETE FROM market_cache WHERE key = %s", (key,))
    except Exception as e:
        logger.warning(f"[Cache] _mc_delete key={key} 실패: {e}")


def clear_cache(key: str) -> None:
    """인메모리 + DB 캐시 모두 삭제."""
    _mc_delete(key)
    _cache.pop(key, None)


def _merge_history(stored: list[dict], new_pts: list[dict]) -> list[dict]:
    merged = {p["date"]: p for p in stored}
    merged.update({p["date"]: p for p in new_pts})
    return sorted(merged.values(), key=lambda p: p["date"])


def _filter_outliers(pts: list[dict], max_ratio: float = 5.0) -> list[dict]:
    if len(pts) < 5:
        return pts
    vals = sorted(p["value"] for p in pts)
    median = vals[len(vals) // 2]
    if median <= 0:
        return pts
    return [p for p in pts if (1 / max_ratio) <= (p["value"] / median) <= max_ratio]


def _yf_close_history(sym: str, stored: list[dict], precision: int = 4) -> list[dict]:
    from datetime import date, timedelta
    if stored:
        last = stored[-1]["date"]
        start = (date.fromisoformat(last) + timedelta(days=1)).isoformat()
        if start > today_kst().isoformat():
            return _filter_outliers(stored)
        hist = yf.Ticker(sym).history(start=start, interval="1d")
    else:
        hist = yf.Ticker(sym).history(period="1y", interval="1d")

    if hist.empty:
        return _filter_outliers(stored) if stored else []

    close = hist["Close"].dropna()
    new_pts = [
        {"date": str(d.date()), "value": round(float(v), precision)}
        for d, v in zip(close.index, close.values)
    ]
    combined = _merge_history(stored, new_pts)
    cutoff = (today_kst() - timedelta(days=366)).isoformat()
    trimmed = [p for p in combined if p["date"] >= cutoff]
    return _filter_outliers(trimmed)


def get_or_refresh(key: str, fetch_fn, ttl: int, force: bool = False) -> dict:
    """캐시 확인 → 없으면 fetch_fn() 호출. fetch_fn은 저장까지 담당."""
    if not force:
        cached = _get_cache(key)
        if cached:
            return cached
        stored = _mc_load(key)
        if stored:
            _set_cache(key, stored["data"], ttl)
            return stored["data"]
    return fetch_fn()

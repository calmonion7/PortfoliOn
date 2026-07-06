from __future__ import annotations
import logging
import math
from datetime import datetime, timezone
import requests
from .cache import _get_cache, _set_cache, _mc_load, _mc_save

logger = logging.getLogger(__name__)

_CNN_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
_CNN_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://edition.cnn.com",
    "Referer": "https://edition.cnn.com/",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
}


def _num(v) -> float | None:
    return round(float(v), 2) if isinstance(v, (int, float)) and math.isfinite(v) else None


def _fetch_fear_greed() -> dict | None:
    try:
        r = requests.get(_CNN_URL, headers=_CNN_HEADERS, timeout=15)
        r.raise_for_status()
        payload = r.json()
        fg = payload["fear_and_greed"]
        score = _num(fg.get("score"))
        if score is None:
            return None

        hist_pts = (payload.get("fear_and_greed_historical") or {}).get("data") or []
        history = []
        for p in hist_pts[-60:]:
            y = _num(p.get("y"))
            x = p.get("x")
            if y is None or x is None:
                continue
            date = datetime.fromtimestamp(x / 1000, tz=timezone.utc).date().isoformat()
            history.append({"date": date, "value": y})

        return {
            "score": score,
            "rating": fg.get("rating"),
            "timestamp": fg.get("timestamp"),
            "previous_close": _num(fg.get("previous_close")),
            "previous_1_week": _num(fg.get("previous_1_week")),
            "previous_1_month": _num(fg.get("previous_1_month")),
            "history": history,
        }
    except Exception as e:
        logger.warning(f"[FearGreed] CNN fetch 실패: {e}")
        return None


def get_fear_greed() -> dict | None:
    """CNN Fear & Greed 지수(US). 실패 시 직전 저장값, 없으면 None graceful."""
    cached = _get_cache("fear_greed")
    if cached:
        return cached

    data = _fetch_fear_greed()
    if data is not None:
        from services.utils import sanitize
        data = sanitize(data)
        _mc_save("fear_greed", data)
        _set_cache("fear_greed", data, ttl=3600)
        return data

    stored = _mc_load("fear_greed")
    if stored:
        _set_cache("fear_greed", stored["data"], ttl=3600)
        return stored["data"]
    return None

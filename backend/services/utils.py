from __future__ import annotations
import math
import re
from typing import Optional

TICKER_RE = re.compile(r"^[A-Za-z0-9.\-]{1,15}$")


def is_valid_ticker(ticker: str) -> bool:
    """티커 형식 검증: strip·upper 후 영숫자+'.'/'-' 1~15자만 허용 (공백/잡문자/빈값/과길이 거부)."""
    return bool(TICKER_RE.match(ticker.strip().upper()))


def find_ticker_index(items: list, ticker: str, key: str = "ticker") -> Optional[int]:
    upper = ticker.upper()
    return next((i for i, item in enumerate(items) if item.get(key, "").upper() == upper), None)


def ticker_exists_in(items: list, ticker: str, key: str = "ticker") -> bool:
    upper = ticker.upper()
    return any(item.get(key, "").upper() == upper for item in items)


def find_ticker(items: list, ticker: str, key: str = "ticker") -> Optional[dict]:
    upper = ticker.upper()
    return next((item for item in items if item.get(key, "").upper() == upper), None)


def sanitize(obj):
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    return obj

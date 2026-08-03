from __future__ import annotations
import math
import re
from datetime import datetime
from decimal import Decimal
from typing import Optional
from zoneinfo import ZoneInfo

TICKER_RE = re.compile(r"^[A-Za-z0-9.\-]{1,15}$")


def today_kst():
    """KR/KST 시장-날짜 판정용 — 컨테이너 UTC라 bare date.today() 금지, CLAUDE.md gotcha/task#157."""
    return datetime.now(ZoneInfo("Asia/Seoul")).date()


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
    """NaN/inf 재귀 제거. PostgreSQL numeric은 NaN을 저장하고 psycopg2가 Decimal로
    되돌리므로 float만 검사하면 sanitize를 호출한 지점조차 안전하지 않다(B2) — Decimal도
    함께 검사한다. 정상 Decimal은 float으로 캐스트하지 않고 그대로 보존(정밀도 손실 방지)."""
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, Decimal) and (obj.is_nan() or obj.is_infinite()):
        return None
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    return obj

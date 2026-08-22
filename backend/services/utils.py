from __future__ import annotations
import math
import re
from datetime import datetime
from decimal import Decimal
from typing import Optional
from zoneinfo import ZoneInfo

TICKER_RE = re.compile(r"^[A-Za-z0-9.\-]{1,15}$")


_KST = ZoneInfo("Asia/Seoul")


def today_kst():
    """KR/KST 시장-날짜 판정용 — 컨테이너 UTC라 bare date.today() 금지, CLAUDE.md gotcha/task#157."""
    return datetime.now(_KST).date()


def now_kst():
    """사용자에게 보여줄 **타임스탬프**용 KST aware datetime.

    `today_kst`가 「어느 달력일이냐」(스칼라 날짜)를 담당한다면 이것은 「몇 시냐」다.
    bare `datetime.now()`는 컨테이너 UTC라 화면에 9시간 뒤처진 시각이 뜨고, 00~09시 KST엔
    날짜까지 하루 뒤로 보여 「배치가 안 돌았다」는 오판을 만든다(구루 명부 `last_updated`
    실사례). 재구현 금지 — 새 타임스탬프 writer는 이 헬퍼를 쓸 것.
    """
    return datetime.now(_KST)


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

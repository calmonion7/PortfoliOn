"""KR 시세 TR — ka10001(주식기본정보) 조회 + get_quote_kr용 정규화.

ka10001 응답은 부호 포함 문자열·억원 단위라, market.get_quote_kr이 쓰는
필드(price/daily_change_pct/prev_close/market_cap/name)로 변환한다.
"""
from __future__ import annotations
from services.kiwoom import client


def _num(val) -> float | None:
    """부호·콤마 포함 문자열을 float로. 빈값/'-'/'+'는 None."""
    if val is None:
        return None
    s = str(val).strip().replace(",", "")
    if s in ("", "-", "+"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def get_basic_info(stk_cd: str) -> dict:
    """ka10001 주식기본정보요청 — raw 응답 dict. 통합(SOR) 코드로 NXT 확장시간 가격 포함."""
    return client.request("ka10001", {"stk_cd": client.integrated_code(stk_cd)}, "stkinfo")


def normalize_basic(d: dict) -> dict:
    """ka10001 응답 → get_quote_kr 정규화 필드.

    - cur_prc(현재가, 부호 포함) → price = |값|
    - flu_rt(등락율 %, 부호 포함) → daily_change_pct
    - pred_pre(전일대비, 부호 포함) → prev_close = price - pred_pre
    - mac(시가총액, 억원) → market_cap = 값 × 1e8 (원)
    - stk_nm → name
    """
    cur = _num(d.get("cur_prc"))
    price = abs(cur) if cur is not None else None

    ratio = _num(d.get("flu_rt"))

    pred_pre = _num(d.get("pred_pre"))
    prev_close = (price - pred_pre) if (price is not None and pred_pre is not None) else None

    mac = _num(d.get("mac"))
    market_cap = int(mac * 1e8) if mac is not None else None

    name = (d.get("stk_nm") or "").strip() or None

    return {
        "price": price,
        "daily_change_pct": ratio,
        "prev_close": round(prev_close) if prev_close is not None else None,
        "market_cap": market_cap,
        "name": name,
    }


def get_quote(stk_cd: str) -> dict:
    """ka10001 조회 → 정규화 dict. 키움 실패 시 예외 전파(호출측이 폴백)."""
    return normalize_basic(get_basic_info(stk_cd))

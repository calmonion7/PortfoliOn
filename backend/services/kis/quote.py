"""KIS 시세 — 국내(FHKST01010100) 현재가 조회 + get_quote_kr용 정규화.

응답값은 numeric string·시총 억원 단위라, market.get_quote_kr이 쓰는 필드
(price/daily_change_pct/prev_close/market_cap/name)로 변환한다.
prdy_ctrt(등락율)는 부호 포함 문자열이라 그대로 쓴다. 경계: .forge/adr/0011.
"""
from __future__ import annotations
from services.kis import client

_KR_PRICE_PATH = "/uapi/domestic-stock/v1/quotations/inquire-price"
_KR_PRICE_TR = "FHKST01010100"


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


def get_kr_basic_info(ticker: str) -> dict:
    """FHKST01010100 국내주식 현재가 — raw output dict."""
    d = client.request(_KR_PRICE_TR, _KR_PRICE_PATH,
                       {"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": ticker})
    return d.get("output") or {}


def normalize_kr_basic(out: dict) -> dict:
    """FHKST01010100 output → get_quote_kr 정규화 필드.

    - stck_prpr(현재가) → price
    - prdy_ctrt(전일대비율 %, 부호 포함) → daily_change_pct
    - stck_sdpr(주식 기준가 = 전일종가) → prev_close
    - hts_avls(HTS 시가총액, 억원) → market_cap = 값 × 1e8 (원)
    - 종목명은 이 TR output에 없어 None (폴백 단계라 market.resolve_name이 처리)
    """
    price = _num(out.get("stck_prpr"))
    ratio = _num(out.get("prdy_ctrt"))
    prev_close = _num(out.get("stck_sdpr"))

    avls = _num(out.get("hts_avls"))
    market_cap = int(avls * 1e8) if avls is not None else None

    return {
        "price": price,
        "daily_change_pct": ratio,
        "prev_close": round(prev_close) if prev_close is not None else None,
        "market_cap": market_cap,
        "name": None,
    }


def get_quote_kr(ticker: str) -> dict:
    """국내 현재가 조회 → 정규화 dict. KIS 실패 시 예외 전파(호출측이 폴백)."""
    return normalize_kr_basic(get_kr_basic_info(ticker))

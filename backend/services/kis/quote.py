"""KIS 시세 — 국내(FHKST01010100) 현재가 조회 + get_quote_kr용 정규화.

응답값은 numeric string·시총 억원 단위라, market.get_quote_kr이 쓰는 필드
(price/daily_change_pct/prev_close/market_cap/name)로 변환한다.
prdy_ctrt(등락율)는 부호 포함 문자열이라 그대로 쓴다. 경계: .forge/adr/0011.
"""
from __future__ import annotations
import logging
from services.kis import client

logger = logging.getLogger(__name__)

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


# ── 해외(미국) 현재가 (Part 2, .forge/adr/0011) ──
_US_PRICE_PATH = "/uapi/overseas-price/v1/quotations/price"
_US_PRICE_TR = "HHDFS00000300"
_US_DAILY_PATH = "/uapi/overseas-price/v1/quotations/dailyprice"
_US_DAILY_TR = "HHDFS76240000"
_US_EXCD_ORDER = ("NAS", "NYS", "AMS")   # 나스닥·뉴욕·아멕스

# yfinance/일반 거래소 힌트 → KIS EXCD
_EXCD_MAP = {
    "NAS": "NAS", "NASDAQ": "NAS", "NMS": "NAS", "NCM": "NAS", "NGM": "NAS",
    "NYS": "NYS", "NYSE": "NYS", "NYQ": "NYS",
    "AMS": "AMS", "AMEX": "AMS", "ASE": "AMS", "AMX": "AMS",
}


def _excd_candidates(exchange: str) -> tuple:
    """exchange 힌트가 US 거래소면 그걸 먼저, 아니면 NAS→NYS→AMS 순차 probe."""
    hint = _EXCD_MAP.get((exchange or "").upper())
    if hint:
        return (hint,) + tuple(e for e in _US_EXCD_ORDER if e != hint)
    return _US_EXCD_ORDER


def _apply_sign(rate, sign) -> float | None:
    """등락율을 KIS 대비기호(1상한 2상승 3보합 4하한 5하락)로 부호 정규화.
    rate가 이미 부호를 가져도(abs 후 재부여) 일관 — 보합/미상은 파싱값 그대로."""
    r = _num(rate)
    if r is None:
        return None
    s = str(sign or "").strip()
    if s in ("4", "5"):
        return -abs(r)
    if s in ("1", "2"):
        return abs(r)
    return r


def _normalize_us_price(out: dict) -> dict:
    """HHDFS00000300 output(단건) → price/prev_close/daily_change_pct.
    last/base는 이미 소수 가격(공식 예제가 zdiv 미적용) — 그대로 사용."""
    return {
        "price": _num(out.get("last")),
        "prev_close": _num(out.get("base")),
        "daily_change_pct": _apply_sign(out.get("rate"), out.get("sign")),
    }


def _normalize_us_daily(bars: list) -> dict:
    """HHDFS76240000 output2(일봉 리스트, newest-first) → 최근 종가/전일종가/등락율."""
    if not bars:
        return {"price": None, "prev_close": None, "daily_change_pct": None}
    latest = bars[0]
    prev = bars[1] if len(bars) > 1 else {}
    return {
        "price": _num(latest.get("clos")),
        "prev_close": _num(prev.get("clos")),
        "daily_change_pct": _apply_sign(latest.get("rate"), latest.get("sign")),
    }


def get_quote_us(ticker: str, exchange: str = "") -> dict:
    """해외(미국) 현재가 → {price, prev_close, daily_change_pct}.

    1) price(HHDFS00000300) EXCD probe — 주요지수 구성종목 커버.
    2) 커버리지 밖이면 dailyprice(HHDFS76240000) 최근 종가 폴백.
    모두 실패면 price=None dict(호출측이 폴백). 백업 경로·15분 지연 수용(.forge/adr/0011).
    """
    sym = ticker.upper()
    excds = _excd_candidates(exchange)

    for excd in excds:
        try:
            d = client.request(_US_PRICE_TR, _US_PRICE_PATH,
                               {"AUTH": "", "EXCD": excd, "SYMB": sym})
        except Exception as e:
            logger.warning(f"[KISQuote] US price fetch 실패 ticker={sym} excd={excd}: {e}")
            continue
        q = _normalize_us_price(d.get("output") or {})
        if q["price"]:
            return q

    for excd in excds:
        try:
            d = client.request(_US_DAILY_TR, _US_DAILY_PATH,
                               {"AUTH": "", "EXCD": excd, "SYMB": sym,
                                "GUBN": "0", "BYMD": "", "MODP": "0"})
        except Exception as e:
            logger.warning(f"[KISQuote] US dailyprice fetch 실패 ticker={sym} excd={excd}: {e}")
            continue
        q = _normalize_us_daily(d.get("output2") or [])
        if q["price"]:
            return q

    return {"price": None, "prev_close": None, "daily_change_pct": None}

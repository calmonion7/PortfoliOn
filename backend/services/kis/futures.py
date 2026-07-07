"""KIS 국내선물(KOSPI200 F) 시세 — 최근월물 해석 + 현재가/일봉. 읽기전용(ADR-0022).

시세 조회 TR만 사용(주문·계좌 미연동). 최근월물 코드는 "A01"+연%10+분기월(3/6/9/12)
공식으로 후보를 계산하고, 응답의 futs_last_tr_date(만기)가 지났으면 다음 분기로
롤오버한다. 응답은 output1/output2/output3 분할 구조(주식 현재가의 단수 output과 다름).
"""
from __future__ import annotations
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from services.kis import client
from services.kis.quote import _num

_PRICE_PATH = "/uapi/domestic-futureoption/v1/quotations/inquire-price"
_PRICE_TR = "FHMIF10000000"
_DAILY_PATH = "/uapi/domestic-futureoption/v1/quotations/inquire-daily-fuopchartprice"
_DAILY_TR = "FHKIF03020100"

_KST = ZoneInfo("Asia/Seoul")
_QUARTER_MONTHS = (3, 6, 9, 12)


def _code(year: int, month: int) -> str:
    return f"A01{year % 10}{month:02d}"


def _next_quarter(year: int, month: int) -> tuple[int, int]:
    nxt = next((m for m in _QUARTER_MONTHS if m > month), None)
    return (year, nxt) if nxt else (year + 1, _QUARTER_MONTHS[0])


def _candidate_quarter(today: date) -> tuple[int, int]:
    """분기월물 후보(연,월) 산출 — 이번 달이 분기월이고 만기(2번째 목요일) 전으로
    보이면 이번 달, 아니면 다음 분기월. 만기는 근사치(15일 기준)라 부정확할 수
    있으나 get_front_month()가 실거래일(futs_last_tr_date)로 최종 확정한다."""
    if today.month in _QUARTER_MONTHS and today.day <= 15:
        return today.year, today.month
    return _next_quarter(today.year, today.month)


def _front_month_code(today: date) -> str:
    return _code(*_candidate_quarter(today))


def _fetch_price(code: str) -> dict:
    """FHMIF10000000 현재가 — output1(종목 시세)만 사용. output2/3은 지수 스냅샷(미사용)."""
    d = client.request(_PRICE_TR, _PRICE_PATH,
                       {"FID_COND_MRKT_DIV_CODE": "F", "FID_INPUT_ISCD": code})
    out1 = d.get("output1") or {}
    return {
        "code": code,
        "contract_name": out1.get("hts_kor_isnm"),
        "price": _num(out1.get("futs_prpr")),
        "change_pct": _num(out1.get("futs_prdy_ctrt")),  # 부호 포함 문자열, 그대로 사용
        "basis": _num(out1.get("mrkt_basis")),
        "last_tr_date": out1.get("futs_last_tr_date"),  # YYYYMMDD, 만기(롤오버 기준)
    }


def get_front_month() -> dict:
    """최근월물 해석 + 현재가. 만기(futs_last_tr_date) 지났으면 다음 분기로 롤오버해 재조회.
    KIS 실패 시 예외 전파(호출측이 캐시/폴백 처리, .forge/adr/0022)."""
    today = datetime.now(_KST).date()
    year, month = _candidate_quarter(today)
    info = _fetch_price(_code(year, month))
    today_str = today.strftime("%Y%m%d")
    last_tr = info.get("last_tr_date")
    if last_tr and today_str > last_tr:
        year, month = _next_quarter(year, month)
        info = _fetch_price(_code(year, month))
    return info


def fetch_daily(code: str, days: int = 120) -> list[dict]:
    """FHKIF03020100 일봉 — output2(최신순 리스트) → 날짜 오름차순 {date, close}.
    close는 절대값(부호 없는 문자열이 정상이나 방어적으로 abs 처리). 페이지네이션/
    연속선물 스티칭 없음(최근월물 전체 윈도우 단발 조회, ADR-0022)."""
    today = datetime.now(_KST).date()
    start = today - timedelta(days=int(days * 1.8))  # 거래일 확보를 위한 여유 창
    d = client.request(_DAILY_TR, _DAILY_PATH, {
        "FID_COND_MRKT_DIV_CODE": "F",
        "FID_INPUT_ISCD": code,
        "FID_INPUT_DATE_1": start.strftime("%Y%m%d"),
        "FID_INPUT_DATE_2": today.strftime("%Y%m%d"),
        "FID_PERIOD_DIV_CODE": "D",
    })
    bars = d.get("output2") or []
    out = []
    for b in reversed(bars):  # newest-first → 오름차순
        bsop = b.get("stck_bsop_date")
        close = _num(b.get("futs_prpr"))
        if bsop and close is not None:
            out.append({"date": f"{bsop[:4]}-{bsop[4:6]}-{bsop[6:8]}", "close": abs(close)})
    return out[-days:] if len(out) > days else out

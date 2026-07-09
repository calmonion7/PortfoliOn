"""KR 공매도 추이 TR — ka10014(공매도추이요청) 조회·정규화.

market_short_sell 동형 행을 만든다 (KR 전용, 키움 ka10014). 경계: .forge/adr/0009.
ka10014 응답 list_key=`shrts_trnsn`, 행 필드(라이브 프로브 확인):
- shrts_qty        → short_volume  공매도 거래량(주)
- shrts_trde_prica → short_value   공매도 거래대금: **천원 단위** → ×1000 = 원
- trde_wght        → short_ratio   공매도 비중(%) (부호문자열 '+3.44')
- ovr_shrts_qty    → short_balance 공매도 잔량(주, 미상환 누적)
- close_pric       → close_price   종가(원, 부호문자열 → 절대값)
필수 요청 파라미터: stk_cd, strt_dt, end_dt (YYYYMMDD).
"""
from __future__ import annotations
import datetime as _dt
from datetime import date
from services.kiwoom import client
from services.utils import today_kst


def _int(val) -> int:
    if val is None:
        return 0
    s = str(val).replace(",", "").strip().lstrip("+")
    if s in ("", "-", "+", "N/A"):
        return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


def _pct(val) -> float | None:
    if val is None:
        return None
    s = str(val).replace("%", "").replace(",", "").strip().lstrip("+")
    if s in ("", "-", "+", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _to_date(val) -> date | None:
    s = str(val or "").strip()
    if len(s) != 8 or not s.isdigit():
        return None
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def parse_rows(items: list[dict]) -> list[dict]:
    """ka10014 `shrts_trnsn` 항목 → market_short_sell 동형 행(base_date 오름차순).

    거래대금은 천원→원(×1000) 정규화. 같은 날짜 중복은 마지막 값으로 합쳐진다."""
    out: dict = {}
    for r in items:
        d = _to_date(r.get("dt"))
        if d is None:
            continue
        out[d] = {
            "base_date": d,
            "short_volume": abs(_int(r.get("shrts_qty"))),
            "short_value": abs(_int(r.get("shrts_trde_prica"))) * 1000,  # 천원 → 원
            "short_ratio": _pct(r.get("trde_wght")),
            "short_balance": abs(_int(r.get("ovr_shrts_qty"))),
            "close_price": abs(_int(r.get("close_pric"))),
        }
    return [out[d] for d in sorted(out)]


def fetch_rows(stk_cd: str, days: int = 252, end: str | None = None) -> list[dict]:
    """ka10014 공매도추이 → market_short_sell 동형 행(최근 days 거래일 커버).

    end=기준일 YYYYMMDD(없으면 오늘). 거래일 days를 캘린더 여유로 환산해 범위 조회."""
    end_d = _dt.datetime.strptime(end, "%Y%m%d").date() if end else today_kst()
    strt_d = end_d - _dt.timedelta(days=int(days * 1.6) + 14)  # 거래일→캘린더 여유(주말·휴장)
    items = client.request_paged(
        "ka10014",
        {"stk_cd": stk_cd, "strt_dt": strt_d.strftime("%Y%m%d"), "end_dt": end_d.strftime("%Y%m%d")},
        "shsa", "shrts_trnsn", max_items=days + 50,
    )
    return parse_rows(items)

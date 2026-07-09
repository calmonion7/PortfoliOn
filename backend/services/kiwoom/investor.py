"""KR 수급 TR — ka10059(투자자별 순매수)+ka10008(외국인 보유율) 조회·정규화·병합.

investor_service.market_investor_trend 스키마와 동형 행을 만든다:
- 순매수(foreign/organ/individual_net)는 **주식 수량(주)** — ka10059 amt_qty_tp=2, unit_tp=1.
  (기존 Naver foreignerPureBuyQuant도 '수량'이므로 의미 일치. 금액 아님.)
- foreign_hold_ratio는 ka10008 wght(외국인 보유 비중 %).
키움 실패 시 호출측이 Naver 폴백. 경계: .forge/adr/0009.
"""
from __future__ import annotations
from datetime import date
from services.kiwoom import client
from services.utils import today_kst


def _signed_int(val) -> int:
    if val is None:
        return 0
    s = str(val).replace(",", "").strip()
    if s in ("", "-", "+", "N/A"):
        return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


def _pct(val) -> float | None:
    if val is None:
        return None
    s = str(val).replace("%", "").replace(",", "").strip()
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


def fetch_flows(stk_cd: str, dt: str | None = None, max_items: int = 100) -> dict:
    """ka10059 순매수(수량/주) → {date: {foreign_net, organ_net, individual_net, close_price}}.
    dt=기준일 YYYYMMDD(없으면 오늘); 그 날짜에서 과거로 시계열."""
    dt = dt or today_kst().strftime("%Y%m%d")
    rows = client.request_paged(
        "ka10059",
        {"dt": dt, "stk_cd": stk_cd, "amt_qty_tp": "2", "trde_tp": "0", "unit_tp": "1"},
        "stkinfo", "stk_invsr_orgn", max_items,
    )
    out: dict = {}
    for r in rows:
        d = _to_date(r.get("dt"))
        if d is None:
            continue
        out[d] = {
            "foreign_net": _signed_int(r.get("frgnr_invsr")),
            "organ_net": _signed_int(r.get("orgn")),
            "individual_net": _signed_int(r.get("ind_invsr")),
            "close_price": abs(_signed_int(r.get("cur_prc"))),
        }
    return out


def fetch_foreign_ratio(stk_cd: str, max_items: int = 400) -> dict:
    """ka10008 외국인 보유율 wght(%) → {date: ratio}. max_items로 백필 깊이(≈일수) 커버."""
    rows = client.request_paged("ka10008", {"stk_cd": stk_cd}, "frgnistt", "stk_frgnr", max_items)
    out: dict = {}
    for r in rows:
        d = _to_date(r.get("dt"))
        if d is None:
            continue
        out[d] = _pct(r.get("wght"))
    return out


def fetch_trend_rows(stk_cd: str, dt: str | None = None, max_items: int = 100) -> list[dict]:
    """ka10059+ka10008 병합 → market_investor_trend 동형 행 리스트(base_date 오름차순).

    foreign_hold_ratio는 ka10008이 그 날짜를 커버할 때만 채워지고, 그보다 오래된
    백필 날짜는 None(순매수는 채워짐 — 'wrong < missing')."""
    flows = fetch_flows(stk_cd, dt, max_items)
    ratios = fetch_foreign_ratio(stk_cd)
    rows = []
    for d in sorted(flows):
        f = flows[d]
        rows.append({
            "base_date": d,
            "foreign_net": f["foreign_net"],
            "organ_net": f["organ_net"],
            "individual_net": f["individual_net"],
            "foreign_hold_ratio": ratios.get(d),
            "close_price": f["close_price"],
        })
    return rows

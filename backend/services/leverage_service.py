from __future__ import annotations
import os
import requests

_KOFIA_BASE = "https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService"
_INDEX_BASE  = "https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService"

# ── 실제 API 필드명 상수 (프로브 결과 기준) ──
_F_DATE        = "basDt"
_F_KOSPI_CRDT  = "crdTrFingScrs"
_F_KOSDAQ_CRDT = "crdTrFingKosdaq"
_F_DEPOSIT     = "invrDpsgAmt"
_F_MISU        = "brkTrdUcolMny"
_F_LQDT        = "brkTrdUcolMnyVsOppsTrdAmt"
_F_LQDT_RTO    = "ucolMnyVsOppsTrdRlImpt"
_F_IDX_NM      = "idxNm"
_F_MKT_CAP     = "lstgMrktTotAmt"


def _kofia_get(endpoint: str, extra_params: str = "") -> list[dict]:
    """KOFIA 공공데이터포털 API 조회. URL에 직접 serviceKey 삽입 (이중인코딩 방지)."""
    key = os.environ.get("KOFIA_API_KEY", "")
    url = f"{endpoint}?serviceKey={key}&resultType=json&numOfRows=1000&pageNo=1{extra_params}"
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    body = r.json()["response"]["body"]
    raw = body["items"].get("item", [])
    return raw if isinstance(raw, list) else [raw]


def _fmt_date(yyyymmdd: str) -> str:
    return f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:8]}"


def _safe_float(val) -> float | None:
    try:
        v = str(val).replace(",", "").strip()
        return float(v) if v not in ("", "-", "N/A") else None
    except (ValueError, TypeError):
        return None


def _fetch_credit_balance(start_dt: str, end_dt: str) -> list[dict]:
    items = _kofia_get(
        f"{_KOFIA_BASE}/getGrantingOfCreditBalanceInfo",
        f"&beginBasDt={start_dt}&endBasDt={end_dt}",
    )
    result = []
    for item in items:
        d = item.get(_F_DATE, "")
        if len(d) != 8:
            continue
        result.append({
            "date": _fmt_date(d),
            "kospi_credit_balance": _safe_float(item.get(_F_KOSPI_CRDT)),
            "kosdaq_credit_balance": _safe_float(item.get(_F_KOSDAQ_CRDT)),
        })
    return result


def _fetch_market_fund(start_dt: str, end_dt: str) -> list[dict]:
    items = _kofia_get(
        f"{_KOFIA_BASE}/getSecuritiesMarketTotalCapitalInfo",
        f"&beginBasDt={start_dt}&endBasDt={end_dt}",
    )
    result = []
    for item in items:
        d = item.get(_F_DATE, "")
        if len(d) != 8:
            continue
        result.append({
            "date": _fmt_date(d),
            "customer_deposit": _safe_float(item.get(_F_DEPOSIT)),
            "total_misu_amt": _safe_float(item.get(_F_MISU)),
            "liquidated_amt": _safe_float(item.get(_F_LQDT)),
            "liquidation_ratio": _safe_float(item.get(_F_LQDT_RTO)),
        })
    return result


def _fetch_market_cap(start_dt: str, end_dt: str) -> list[dict]:
    items = _kofia_get(
        f"{_INDEX_BASE}/getStockMarketIndex",
        f"&beginBasDt={start_dt}&endBasDt={end_dt}",
    )
    by_date: dict[str, dict] = {}
    for item in items:
        d = item.get(_F_DATE, "")
        if len(d) != 8:
            continue
        fmt = _fmt_date(d)
        name = item.get(_F_IDX_NM, "")
        cap = _safe_float(item.get(_F_MKT_CAP))
        if fmt not in by_date:
            by_date[fmt] = {"date": fmt, "kospi_market_cap": None, "kosdaq_market_cap": None}
        if "코스피" in name and "200" not in name:
            by_date[fmt]["kospi_market_cap"] = cap
        elif "코스닥" in name and "150" not in name:
            by_date[fmt]["kosdaq_market_cap"] = cap
    return list(by_date.values())

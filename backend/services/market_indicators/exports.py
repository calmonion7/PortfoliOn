from __future__ import annotations
import json
import logging
import os
import requests
from concurrent.futures import ThreadPoolExecutor
from .cache import _mc_save, _mc_load, _cache, _get_cache, _set_cache, _DATA_DIR
from services.utils import today_kst

logger = logging.getLogger(__name__)

_EXPORTS_CACHE = os.path.join(_DATA_DIR, "kr_exports.json")
_COMTRADE_URL = "https://comtradeapi.un.org/public/v1/preview/C/M/HS"


def _last_n_month_codes(n: int) -> list[str]:
    today = today_kst()
    y, m = today.year, today.month
    codes = []
    for _ in range(n):
        m -= 1
        if m == 0:
            m = 12
            y -= 1
        codes.append(f"{y}{m:02d}")
    return codes


def _months_ago(n: int) -> str:
    today = today_kst()
    month = today.month - n
    year = today.year + (month - 1) // 12
    month = ((month - 1) % 12) + 1
    return f"{year}{month:02d}"


def _fetch_customs_exports(api_key: str) -> dict:
    from xml.etree import ElementTree as ET
    from collections import defaultdict
    base = "https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList"
    start = _last_n_month_codes(12)[-1]
    end = _last_n_month_codes(1)[0]
    r_semi = requests.get(base, params={
        "serviceKey": api_key, "strtYymm": start, "endYymm": end,
        "numOfRows": 1000, "pageNo": 1, "hsSgn": "8542",
    }, timeout=15)
    r_semi.raise_for_status()
    semi_by_month: dict[str, int] = defaultdict(int)
    for item in ET.fromstring(r_semi.text).findall(".//item"):
        yr = item.findtext("year", "")
        if yr and yr != "총계":
            ym = yr.replace(".", "")
            semi_by_month[ym] += int(item.findtext("expDlr", "0") or 0)
    months = _last_n_month_codes(12)

    def _fetch_month_total(ym: str) -> tuple[str, int]:
        r = requests.get(base, params={
            "serviceKey": api_key, "strtYymm": ym, "endYymm": ym,
            "numOfRows": 9999, "pageNo": 1,
        }, timeout=30)
        total = sum(
            int(i.findtext("expDlr", "0") or 0)
            for i in ET.fromstring(r.text).findall(".//item")
            if i.findtext("year", "") != "총계"
        )
        return ym, total

    with ThreadPoolExecutor(max_workers=6) as ex:
        total_by_month = dict(ex.map(_fetch_month_total, months))

    all_months = sorted(m for m in months if total_by_month.get(m, 0) > 0)
    return {
        "months": [
            {"month": m,
             "semiconductor": round(semi_by_month.get(m, 0) / 1e8, 1),
             "non_semiconductor": round((total_by_month.get(m, 0) - semi_by_month.get(m, 0)) / 1e8, 1)}
            for m in all_months
        ]
    }


def _fetch_comtrade_exports() -> dict:
    periods = ",".join(_last_n_month_codes(12))
    r_total = requests.get(_COMTRADE_URL, params={
        "reporterCode": "410", "period": periods, "partnerCode": "0",
        "cmdCode": "TOTAL", "flowCode": "X"}, timeout=15)
    r_semi = requests.get(_COMTRADE_URL, params={
        "reporterCode": "410", "period": periods, "partnerCode": "0",
        "cmdCode": "8542", "flowCode": "X"}, timeout=15)
    total_by_month = {row["period"]: row.get("fobvalue", 0) or 0
                      for row in r_total.json().get("data", [])}
    semi_by_month = {row["period"]: row.get("fobvalue", 0) or 0
                     for row in r_semi.json().get("data", [])}
    all_months = sorted(m for m in total_by_month if m in semi_by_month)
    return {
        "months": [
            {"month": m,
             "semiconductor": round(semi_by_month[m] / 1e8, 1),
             "non_semiconductor": round((total_by_month[m] - semi_by_month[m]) / 1e8, 1)}
            for m in all_months
        ]
    }


def _exports_is_stale(data: dict) -> bool:
    months = data.get("months", [])
    if not months:
        return True
    last = months[-1]["month"]
    today = today_kst()
    last_y, last_m = int(last[:4]), int(last[4:])
    diff = (today.year - last_y) * 12 + (today.month - last_m)
    return diff >= 2


def _fetch_and_save_kr_exports() -> dict:
    stored = _mc_load("kr_exports")
    api_key = os.environ.get("KITA_API_KEY")
    try:
        data = _fetch_customs_exports(api_key) if api_key else _fetch_comtrade_exports()
    except Exception as e:
        logger.warning(f"[KrExports] 1차 수출 fetch 실패, Comtrade 폴백 시도: {e}")
        try:
            data = _fetch_comtrade_exports()
        except Exception as e:
            if stored:
                return stored["data"]
            return {"months": [], "error": str(e)}
    _mc_save("kr_exports", data)
    _cache.pop("kr_exports", None)
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_EXPORTS_CACHE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    return data


def get_kr_exports() -> dict:
    cached = _get_cache("kr_exports")
    if cached:
        return cached
    stored = _mc_load("kr_exports")
    if stored:
        data = stored["data"]
        if _exports_is_stale(data):
            return _fetch_and_save_kr_exports()
        _set_cache("kr_exports", data, ttl=86400)
        return data
    if os.path.exists(_EXPORTS_CACHE):
        with open(_EXPORTS_CACHE) as f:
            return json.load(f)
    return _fetch_and_save_kr_exports()

from __future__ import annotations
import os
import requests
from .cache import _mc_save, _cache, _mc_load, _get_cache, _set_cache, _merge_history, _mc_delete


def _fetch_and_save_econ_indicators() -> dict:
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        return {"error": "FRED_API_KEY 환경변수가 필요합니다."}

    stored = _mc_load("econ_indicators")
    stored_data = stored["data"] if stored else None

    from datetime import date as _date
    cpi_stored = (stored_data or {}).get("cpi", [])
    unemp_stored = (stored_data or {}).get("unemployment", [])
    cpi_start = cpi_stored[-1]["date"] if cpi_stored else _date(_date.today().year - 3, 1, 1).isoformat()
    unemp_start = unemp_stored[-1]["date"] if unemp_stored else _date(_date.today().year - 3, 1, 1).isoformat()

    def _fetch_series(series_id: str, start: str) -> list:
        r = requests.get(
            "https://api.stlouisfed.org/fred/series/observations",
            params={"series_id": series_id, "api_key": api_key, "file_type": "json",
                    "observation_start": start},
            timeout=10,
        )
        r.raise_for_status()
        return [
            {"date": obs["date"], "value": float(obs["value"])}
            for obs in r.json().get("observations", [])
            if obs.get("value") not in (".", None, "")
        ]

    try:
        new_cpi = _fetch_series("CPIAUCSL", cpi_start)
        new_unemp = _fetch_series("UNRATE", unemp_start)
    except Exception:
        return stored_data or {"cpi": [], "unemployment": []}

    cpi = _merge_history(cpi_stored, new_cpi)
    unemployment = _merge_history(unemp_stored, new_unemp)
    data = {"cpi": cpi, "unemployment": unemployment}
    _mc_save("econ_indicators", data)
    _cache.pop("econ_indicators", None)
    return data


def _is_valid_econ_data(data: dict) -> bool:
    """실업률이 CPI 값으로 오염됐는지 체크 (실업률은 정상 0~30% 범위)."""
    unemp = data.get("unemployment", [])
    if unemp and unemp[-1].get("value", 0) > 50:
        return False
    return True


def get_econ_indicators() -> dict:
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        return {"error": "FRED_API_KEY 환경변수가 필요합니다. https://fred.stlouisfed.org/docs/api/api_key.html 에서 무료 발급 후 설정하세요."}

    cached = _get_cache("econ_indicators")
    if cached and _is_valid_econ_data(cached):
        return cached

    stored = _mc_load("econ_indicators")
    if stored and _is_valid_econ_data(stored["data"]):
        _set_cache("econ_indicators", stored["data"], ttl=86400)
        return stored["data"]

    # 캐시 없거나 데이터 오염 → 강제 재fetch
    _mc_delete("econ_indicators")
    _cache.pop("econ_indicators", None)
    data = _fetch_and_save_econ_indicators()
    if isinstance(data, dict) and "error" not in data:
        _set_cache("econ_indicators", data, ttl=86400)
    return data

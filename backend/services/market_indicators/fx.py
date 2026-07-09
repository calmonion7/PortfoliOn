from __future__ import annotations
import logging
import requests
from concurrent.futures import ThreadPoolExecutor
from .cache import _get_cache, _set_cache, _mc_load, _mc_save, _yf_close_history

logger = logging.getLogger(__name__)

_FX_SYMBOLS = {"usdkrw": "USDKRW=X", "usdjpy": "USDJPY=X", "eurusd": "EURUSD=X"}


def _fetch_usdkrw_current() -> float | None:
    try:
        r = requests.get("https://open.er-api.com/v6/latest/USD", timeout=5)
        r.raise_for_status()
        krw = r.json().get("rates", {}).get("KRW")
        return round(float(krw), 2) if krw else None
    except Exception as e:
        logger.warning(f"[FX] _fetch_usdkrw_current 실패: {e}")
        return None


def _fetch_fx(args: tuple) -> tuple:
    key, sym, stored_history = args
    try:
        history = _yf_close_history(sym, stored_history, precision=4)
        if history:
            current = round(history[-1]["value"], 4)
            prev = round(history[-2]["value"], 4) if len(history) > 1 else current
            change_pct = round((current - prev) / prev * 100, 2) if prev else 0.0
            return key, {"current": current, "change_pct": change_pct, "history": history}
    except Exception as e:
        logger.warning(f"[FX] _fetch_fx({key}) yfinance 실패: {e}")
        pass

    if stored_history:
        current = round(stored_history[-1]["value"], 4)
        prev = round(stored_history[-2]["value"], 4) if len(stored_history) > 1 else current
        change_pct = round((current - prev) / prev * 100, 2) if prev else 0.0
        return key, {"current": current, "change_pct": change_pct, "history": stored_history}

    if key == "usdkrw":
        current = _fetch_usdkrw_current()
        if current:
            return key, {"current": current, "change_pct": 0.0, "history": []}

    return key, None


def get_fx() -> dict:
    cached = _get_cache("fx")
    if cached:
        return cached

    stored = _mc_load("fx")
    stored_histories = {}
    stored_rates = (stored["data"].get("rates") or {}) if stored else {}
    if stored:
        for k in _FX_SYMBOLS:
            stored_histories[k] = (stored["data"].get("history") or {}).get(k, [])

    with ThreadPoolExecutor(max_workers=3) as ex:
        results = dict(ex.map(
            _fetch_fx,
            [(k, sym, stored_histories.get(k, [])) for k, sym in _FX_SYMBOLS.items()]
        ))

    rates = {
        k: {"current": v["current"], "change_pct": v["change_pct"]}
        for k, v in results.items() if v
    }

    failed = [k for k in _FX_SYMBOLS if k not in rates and k in stored_rates]
    if failed:
        logger.warning(f"[FX] 갱신 실패, 직전 저장값 유지: {failed}")
        for k in failed:
            rates[k] = stored_rates[k]

    history = {"usdkrw": results["usdkrw"]["history"]} if results.get("usdkrw") else {}

    if not rates:
        return {"rates": {}, "history": {}}

    data = {"rates": rates, "history": history}
    _mc_save("fx", data)
    _set_cache("fx", data, ttl=3600)
    return data


def get_vix() -> dict:
    cached = _get_cache("vix")
    if cached:
        return cached

    stored = _mc_load("vix")
    stored_history = (stored["data"].get("history") or []) if stored else []

    try:
        history = _yf_close_history("^VIX", stored_history, precision=2)
        if not history:
            return {"current": None, "change": None, "history": []}
        current = round(history[-1]["value"], 2)
        prev = round(history[-2]["value"], 2) if len(history) > 1 else current
        change = round(current - prev, 2)
        data = {"current": current, "change": change, "history": history}
        _mc_save("vix", data)
        _set_cache("vix", data, ttl=3600)
        return data
    except Exception as e:
        logger.warning(f"[VIX] get_vix 실패: {e}")
        return {"current": None, "change": None, "history": []}

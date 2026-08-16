from __future__ import annotations
import logging
import requests
from concurrent.futures import ThreadPoolExecutor
from .cache import _get_cache, _set_cache, _mc_load, _mc_save, _yf_close_history, _filter_outliers, _public

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
    key, sym, stored_raw = args
    try:
        raw_history = _yf_close_history(sym, stored_raw, precision=4)
        history = _filter_outliers(raw_history)
        if history:
            current = round(history[-1]["value"], 4)
            prev = round(history[-2]["value"], 4) if len(history) > 1 else current
            change_pct = round((current - prev) / prev * 100, 2) if prev else 0.0
            return key, {"current": current, "change_pct": change_pct, "history": history,
                         "_raw_history": raw_history}
    except Exception as e:
        logger.warning(f"[FX] _fetch_fx({key}) yfinance 실패: {e}")
        pass

    if stored_raw:
        history = _filter_outliers(stored_raw)
        if history:
            current = round(history[-1]["value"], 4)
            prev = round(history[-2]["value"], 4) if len(history) > 1 else current
            change_pct = round((current - prev) / prev * 100, 2) if prev else 0.0
            return key, {"current": current, "change_pct": change_pct, "history": history,
                         "_raw_history": stored_raw}

    if key == "usdkrw":
        current = _fetch_usdkrw_current()
        if current:
            return key, {"current": current, "change_pct": 0.0, "history": [], "_raw_history": []}

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
            # 배포 직후 창(구버전 blob엔 _raw_history 없음) → 구키 history로 폴백.
            stored_histories[k] = ((stored["data"].get("_raw_history")
                                    or stored["data"].get("history") or {}).get(k, []))

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
    # `.get` 폴백 — _fetch_fx를 몽키패치하는 기존 테스트가 구 형태를 반환한다(적대 검토 HIGH).
    _u = results.get("usdkrw")
    raw_history = {"usdkrw": (_u.get("_raw_history") or _u.get("history") or [])} if _u else {}

    if not rates:
        return {"rates": {}, "history": {}}

    data = {"rates": rates, "history": history, "_raw_history": raw_history}
    _mc_save("fx", data)
    public = _public(data)
    _set_cache("fx", public, ttl=3600)
    return public


def get_vix() -> dict:
    cached = _get_cache("vix")
    if cached:
        return cached

    stored = _mc_load("vix")
    # 배포 직후 창(구버전 blob엔 _raw_history 없음) → 구키 history로 폴백.
    stored_raw = ((stored["data"].get("_raw_history") or stored["data"].get("history") or [])
                  if stored else [])

    try:
        raw_history = _yf_close_history("^VIX", stored_raw, precision=2)
        if not raw_history:
            return {"current": None, "change": None, "history": []}
        history = _filter_outliers(raw_history)
        current = round(history[-1]["value"], 2)
        prev = round(history[-2]["value"], 2) if len(history) > 1 else current
        change = round(current - prev, 2)
        data = {"current": current, "change": change, "history": history, "_raw_history": raw_history}
        _mc_save("vix", data)
        public = _public(data)
        _set_cache("vix", public, ttl=3600)
        return public
    except Exception as e:
        logger.warning(f"[VIX] get_vix 실패: {e}")
        return {"current": None, "change": None, "history": []}

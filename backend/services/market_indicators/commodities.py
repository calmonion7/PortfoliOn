from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from .cache import _get_cache, _set_cache, _mc_load, _mc_save, _yf_close_history

_COMMODITY_SYMBOLS: dict[str, tuple[str, str]] = {
    "gold":   ("GC=F", "USD/oz"),
    "oil":    ("CL=F", "USD/bbl"),
    "copper": ("HG=F", "USD/lb"),
}
_TREASURY_SYMBOLS = {"3m": "^IRX", "5y": "^FVX", "10y": "^TNX", "30y": "^TYX"}


def _fetch_commodity(args: tuple) -> tuple:
    key, sym_unit, stored_history = args
    sym, unit = sym_unit
    try:
        history = _yf_close_history(sym, stored_history, precision=2)
        if not history:
            return key, None
        current = round(history[-1]["value"], 2)
        prev = round(history[-2]["value"], 2) if len(history) > 1 else current
        change_pct = round((current - prev) / prev * 100, 2) if prev else 0.0
        return key, {"current": current, "change_pct": change_pct, "unit": unit, "history": history}
    except Exception:
        return key, None


def get_commodities() -> dict:
    cached = _get_cache("commodities")
    if cached:
        return cached

    stored = _mc_load("commodities")
    stored_histories = {}
    if stored:
        for k in _COMMODITY_SYMBOLS:
            stored_histories[k] = (stored["data"].get("history") or {}).get(k, [])

    with ThreadPoolExecutor(max_workers=3) as ex:
        results = dict(ex.map(
            _fetch_commodity,
            [(k, sym_unit, stored_histories.get(k, [])) for k, sym_unit in _COMMODITY_SYMBOLS.items()]
        ))

    prices = {k: {"current": v["current"], "change_pct": v["change_pct"], "unit": v["unit"]}
              for k, v in results.items() if v}
    history = {k: v["history"] for k, v in results.items() if v}

    data = {"prices": prices, "history": history}
    _mc_save("commodities", data)
    _set_cache("commodities", data, ttl=3600)
    return data


def _fetch_treasury(args: tuple) -> tuple:
    key, sym, stored_history = args
    try:
        history = _yf_close_history(sym, stored_history, precision=3)
        if not history:
            return key, None
        current = round(history[-1]["value"], 3)
        prev = round(history[-2]["value"], 3) if len(history) > 1 else current
        return key, {"current": current, "change_bp": round((current - prev) * 100, 1), "history": history}
    except Exception:
        return key, None


def get_treasury() -> dict:
    cached = _get_cache("treasury")
    if cached:
        return cached

    stored = _mc_load("treasury")
    stored_raw = (stored["data"].get("_raw_histories") or {}) if stored else {}

    with ThreadPoolExecutor(max_workers=4) as ex:
        results = dict(ex.map(
            _fetch_treasury,
            [(k, sym, stored_raw.get(k, [])) for k, sym in _TREASURY_SYMBOLS.items()]
        ))

    for k, stored_h in stored_raw.items():
        if results.get(k) is None and stored_h:
            last = stored_h[-1]["value"]
            prev = stored_h[-2]["value"] if len(stored_h) > 1 else last
            results[k] = {"current": last, "change_bp": round((last - prev) * 100, 1), "history": stored_h}

    rates = {k: {"current": v["current"], "change_bp": v["change_bp"]}
             for k, v in results.items() if v}
    history = {k: v["history"] for k, v in results.items() if v and k in ("3m", "10y")}

    spread: list = []
    if results.get("10y") and results.get("3m"):
        h10 = {d["date"]: d["value"] for d in results["10y"]["history"]}
        h3m = {d["date"]: d["value"] for d in results["3m"]["history"]}
        spread = [{"date": dt, "value": round(h10[dt] - h3m[dt], 3)}
                  for dt in sorted(set(h10) & set(h3m))]

    raw_histories = {k: v["history"] for k, v in results.items() if v}
    data = {"rates": rates, "history": history, "spread": spread, "_raw_histories": raw_histories}
    _mc_save("treasury", data)
    _set_cache("treasury", data, ttl=3600)
    return data

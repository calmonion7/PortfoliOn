from __future__ import annotations
import logging
import math
import re
import requests
from bs4 import BeautifulSoup
from .cache import _get_cache, _set_cache, _mc_load, _mc_save, _yf_close_history

logger = logging.getLogger(__name__)

_INDEX_SYMBOLS = {
    "gspc": "^GSPC",
    "ks11": "^KS11",
    "kq11": "^KQ11",
}


def _fetch_index(key: str, sym: str, stored_history: list) -> tuple[str, dict | None]:
    try:
        history = _yf_close_history(sym, stored_history, precision=2)
        if history:
            current = history[-1]["value"]
            prev = history[-2]["value"] if len(history) > 1 else current
            change_pct = round((current - prev) / prev * 100, 2) if prev else 0.0
            if not math.isfinite(change_pct):
                change_pct = None
            return key, {"current": current, "change_pct": change_pct, "history": history}
    except Exception as e:
        logger.warning("[Index] %s yfinance fetch 실패, stored 폴백: %s", sym, e)

    if stored_history:
        current = stored_history[-1]["value"]
        prev = stored_history[-2]["value"] if len(stored_history) > 1 else current
        change_pct = round((current - prev) / prev * 100, 2) if prev else 0.0
        if not math.isfinite(change_pct):
            change_pct = None
        return key, {"current": current, "change_pct": change_pct, "history": stored_history}

    return key, None


def _parse_multpl_cape(html: str) -> dict | None:
    """multpl.com/shiller-pe 페이지에서 현재값과 통계 테이블 파싱."""
    try:
        soup = BeautifulSoup(html, "html.parser")

        # 현재값: #current div의 raw text에서 "Ratio:NN.NN" 패턴으로 추출
        current = None
        current_div = soup.find(id="current")
        if current_div:
            raw = current_div.get_text(strip=True)
            m = re.search(r"Ratio:\s*(\d+\.?\d*)", raw)
            if m:
                try:
                    current = float(m.group(1))
                except ValueError:
                    pass

        # 통계 테이블 — th 레이블이 "Mean:", "Median:", "Min:", "Max:"
        stats: dict[str, float | None] = {"mean": None, "median": None, "min": None, "max": None}
        label_map = {
            "mean": "mean",
            "average": "mean",
            "median": "median",
            "minimum": "min",
            "min": "min",
            "maximum": "max",
            "max": "max",
        }
        for row in soup.find_all("tr"):
            cells = row.find_all(["th", "td"])
            if len(cells) >= 2:
                label = cells[0].get_text(strip=True).lower().rstrip(":")
                # value cell may have extra text like "17.39Median:..." — grab leading float
                val_raw = cells[1].get_text(strip=True)
                m2 = re.match(r"(\d+\.?\d*)", val_raw)
                if not m2:
                    continue
                for keyword, stat_key in label_map.items():
                    if keyword in label:
                        try:
                            v = float(m2.group(1))
                            if math.isfinite(v) and stats[stat_key] is None:
                                stats[stat_key] = v
                        except ValueError:
                            pass
                        break

        if current is None or not math.isfinite(current):
            return None

        return {"current": current, **stats}
    except Exception as e:
        logger.warning("[CAPE] multpl 파싱 실패: %s", e)
        return None


def _fetch_cape() -> dict | None:
    try:
        r = requests.get(
            "https://www.multpl.com/shiller-pe",
            timeout=10,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        r.raise_for_status()
        return _parse_multpl_cape(r.text)
    except Exception as e:
        logger.warning("[CAPE] multpl.com fetch 실패: %s", e)
        return None


def get_indices() -> dict:
    cached = _get_cache("indices")
    if cached:
        return cached

    stored = _mc_load("indices")
    stored_data = stored["data"] if stored else {}

    # --- S1: index levels ---
    stored_histories: dict[str, list] = {}
    if stored_data:
        for k in _INDEX_SYMBOLS:
            stored_histories[k] = (stored_data.get("indices") or {}).get(k, {}).get("history", [])

    indices: dict[str, dict | None] = {}
    for k, sym in _INDEX_SYMBOLS.items():
        _, result = _fetch_index(k, sym, stored_histories.get(k, []))
        indices[k] = result

    # --- S2: US CAPE ---
    cape = _fetch_cape()
    if cape is None and stored_data:
        cape = (stored_data.get("valuation") or {}).get("sp500_cape")

    # --- NaN guard + assemble ---
    from services.utils import sanitize
    data = sanitize({
        "indices": indices,
        "valuation": {"sp500_cape": cape},
    })

    if any(v is not None for v in indices.values()):
        _mc_save("indices", data)
        _set_cache("indices", data, ttl=3600)

    return data

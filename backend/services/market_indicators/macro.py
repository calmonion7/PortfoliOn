from __future__ import annotations
import logging
import os
import requests
from datetime import date as _date
from .cache import _mc_save, _mc_load, _merge_history
from services.utils import today_kst

logger = logging.getLogger(__name__)

# 큐레이션 4종 FRED 시리즈 → 내부 키.
_SERIES = {
    "yield_curve": "T10Y2Y",      # 10Y-2Y 국채 금리차(일간, %p). <0 = 수익률곡선 역전
    "hy_spread": "BAMLH0A0HYM2",  # ICE BofA US HY OAS(일간, %). 급확대 = 신용 스트레스
    "m2": "M2SL",                 # M2 통화량(월간, 십억달러)
    "fed_funds": "DFF",           # 연방기금 실효금리(일간, %)
}

# HY OAS 절대 임계: ~500bp(5.0%) 초과를 신용 스트레스로 본다(역사적 elevated 라인).
HY_STRESS_THRESHOLD = 5.0


def _latest(series: list) -> float | None:
    return series[-1]["value"] if series else None


def evaluate_signals(data: dict) -> dict:
    """저장된 시계열에서 핵심 신호 2종을 판정하는 순수함수.

    inverted: 최신 금리차 <0(수익률곡선 역전·침체 경고). 시리즈 없으면 None.
    credit_stress: 최신 HY 스프레드 >= 임계(신용 스트레스). 시리즈 없으면 None.
    """
    yc = _latest(data.get("yield_curve", []))
    hy = _latest(data.get("hy_spread", []))
    return {
        "inverted": (yc < 0) if yc is not None else None,
        "credit_stress": (hy >= HY_STRESS_THRESHOLD) if hy is not None else None,
        "yield_curve_latest": yc,
        "hy_spread_latest": hy,
    }


def _fetch_series(series_id: str, api_key: str, start: str) -> list:
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


def _fetch_and_save_macro_signals() -> dict:
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        return {"error": "FRED_API_KEY 환경변수가 필요합니다."}

    stored = _mc_load("macro_signals")
    stored_data = (stored["data"] if stored else None) or {}
    default_start = _date(today_kst().year - 3, 1, 1).isoformat()

    try:
        merged: dict = {}
        for key, series_id in _SERIES.items():
            prev = stored_data.get(key, [])
            start = prev[-1]["date"] if prev else default_start
            new_pts = _fetch_series(series_id, api_key, start)
            merged[key] = _merge_history(prev, new_pts)
    except Exception as e:
        logger.warning(f"[Macro] FRED 시계열 수집 실패, 저장값 반환: {e}")
        return stored_data or {k: [] for k in _SERIES} | {"signals": {}}

    merged["signals"] = evaluate_signals(merged)
    _mc_save("macro_signals", merged)
    return merged


def get_macro_signals() -> dict:
    """저장된 매크로 신호 시계열+신호를 반환(요청경로 외부 API 호출 없음)."""
    stored = _mc_load("macro_signals")
    if stored:
        return stored["data"]
    return {k: [] for k in _SERIES} | {"signals": {}}

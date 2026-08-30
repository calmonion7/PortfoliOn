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
    """FRED 4종을 증분 수집해 병합 저장하고, 실패 사실을 반환값에 실어 노출한다.

    반환에는 계열 데이터(`_SERIES` 키) 외에 다음이 실릴 수 있다 —
    `error`(FRED_API_KEY 미설정) 또는 `_status: "skipped"`(수집 실패, 저장 생략).
    호출측(scheduler/jobs.py · routers/market_indicators.py)이 이를 job_runs 상태로 반영한다.
    안 하면 `job_runs.record`가 **본문이 예외를 전파할 때만** failed를 기록하므로, FRED가 며칠
    죽어도 매 실행이 success로 남고 저장값만 무기한 stale해진다(B6, task#341).

    ⚠️ `partial`은 이 함수에서 발생하지 않는다 — 수집 루프 전체가 하나의 try 안이라 한 계열의
    실패가 전부를 중단시키는 all-or-nothing이기 때문이다. 형제 `econ.py`는 계열별 소스-폴백이라
    `partial`이 있다. 계열별 폴백 도입은 *관측*이 아니라 구조 변경이므로 이 태스크의 비목표다.

    `_status`는 배치 레인 전용 메타이므로 `_mc_save`에 넘기는 dict에는 섞지 않는다(여기서는
    실패 시 저장 자체를 생략하므로 자연히 성립한다). 요청경로 `get_macro_signals`는 저장값만
    읽으므로 응답 shape도 변하지 않는다.
    """
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
        logger.warning(f"[Macro] FRED 시계열 수집 실패, 저장 생략·직전값 반환: {e}")
        fallback = dict(stored_data) if stored_data else {k: [] for k in _SERIES} | {"signals": {}}
        return {**fallback, "_status": "skipped"}   # 반환용 별도 dict — 저장값을 mutate하지 않는다

    merged["signals"] = evaluate_signals(merged)
    _mc_save("macro_signals", merged)
    return merged


def get_macro_signals() -> dict:
    """저장된 매크로 신호 시계열+신호를 반환(요청경로 외부 API 호출 없음)."""
    stored = _mc_load("macro_signals")
    if stored:
        return stored["data"]
    return {k: [] for k in _SERIES} | {"signals": {}}

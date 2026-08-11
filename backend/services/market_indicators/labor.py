from __future__ import annotations
import logging
import math
import os
import requests
from datetime import date as _date
from .cache import _mc_save, _mc_load, _merge_history
from services.utils import today_kst

logger = logging.getLogger(__name__)

# 고용 조사 2종(FRED) — 기업조사(establishment)와 가계조사(household)는 같은 고용 규모를
# 서로 다른 방법론으로 재는 별개 시계열이라(CONTEXT "고용 조사 격차") 격차 자체가 신호다.
_SERIES = {
    "establishment": "PAYEMS",  # 기업조사(비농업 임금근로자), 월간·계절조정·천 명
    "household": "CE16OV",      # 가계조사(16세 이상 취업자), 월간·계절조정·천 명
}


def _fetch_series(series_id: str, api_key: str, start: str) -> list:
    r = requests.get(
        "https://api.stlouisfed.org/fred/series/observations",
        params={"series_id": series_id, "api_key": api_key, "file_type": "json",
                "observation_start": start},
        timeout=10,
    )
    r.raise_for_status()
    pts = []
    for obs in r.json().get("observations", []):
        val = obs.get("value")
        if val in (".", None, ""):
            continue
        try:
            v = float(val)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(v):  # FRED "."는 위에서 걸러지지만 "NaN"/"Infinity" 문자열은 예외 없이 통과한다.
            continue
        pts.append({"date": obs["date"], "value": v})
    return pts


def _fetch_and_save_labor_surveys() -> dict:
    """조사별 소스-폴백 — 한 조사의 실패(예외·빈응답)가 다른 조사의 갱신을 막지 않는다.

    끝 가드가 아니라 조사 단위 가드다(CONVENTIONS §1.3): 어떤 실패 경로에서도 그 조사는
    직전 저장값을 그대로 유지하고, 성공한 조사만 갱신해 저장한다(wrong < missing).

    반환에는 조사 데이터(`_SERIES` 키) 외에 `_status`가 실릴 수 있다 — 전부 성공이면
    없고, 일부만 실패하면 "partial", 전부 실패하면 "skipped"(저장은 생략됐다). 호출측
    (scheduler/jobs.py·routers/market_indicators.py)이 이를 job_runs 상태로 반영한다.
    `_status`는 `_mc_save` 호출 *뒤에* 붙여 저장 캐시에는 섞이지 않는다.
    """
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        return {"error": "FRED_API_KEY 환경변수가 필요합니다."}

    stored_data = (_mc_load("labor_surveys") or {}).get("data") or {}
    default_start = _date(today_kst().year - 5, 1, 1).isoformat()

    merged: dict = {}
    any_success = False
    any_failure = False
    for key, series_id in _SERIES.items():
        prev = stored_data.get(key, [])
        try:
            start = prev[-1]["date"] if prev else default_start
            new_pts = _fetch_series(series_id, api_key, start)
            if not new_pts:  # 성공-but-빈응답도 실패로 취급(예외 가드를 그냥 통과하는 클래스)
                raise ValueError("관측 0건")
            merged[key] = _merge_history(prev, new_pts)
            any_success = True
        except Exception as e:
            logger.warning(f"[Labor] {key}({series_id}) 수집 실패, 직전값 보존: {e}")
            merged[key] = prev
            any_failure = True

    if not any_success:
        logger.warning("[Labor] 전 조사 수집 실패 — 저장 생략, 직전값 반환")
        result = dict(stored_data) if stored_data else {k: [] for k in _SERIES}
        result["_status"] = "skipped"
        return result

    _mc_save("labor_surveys", merged)
    if any_failure:
        return {**merged, "_status": "partial"}  # 반환용 별도 dict — _mc_save에 넘긴 merged는 그대로 둔다
    return merged


def change_12m(series: list[dict]) -> float | None:
    """최신값 − 12개월 전 값(순수함수).

    ⚠️ 인덱스 오프셋(`series[-13]`)이 아니라 **날짜 키**로 매칭한다 — 관측 결손이 있으면
    조용히 다른 달과 비교하지 않고 None을 반환한다.
    """
    if not series:
        return None
    latest = series[-1]
    d = _date.fromisoformat(latest["date"])
    target_date = _date(d.year - 1, d.month, d.day).isoformat()
    by_date = {p["date"]: p["value"] for p in series}
    prev_value = by_date.get(target_date)
    if prev_value is None:
        return None
    return round(latest["value"] - prev_value, 2)


def _survey_view(history: list) -> dict:
    latest = history[-1] if history else None
    return {
        "history": history,
        "latest": latest["value"] if latest else None,
        "latest_date": latest["date"] if latest else None,
        "change_12m": change_12m(history),
    }


def get_labor_surveys() -> dict:
    """저장된 고용 조사 시계열을 조사별 뷰로 반환(요청경로 FRED 호출 없음)."""
    stored = _mc_load("labor_surveys")
    data = (stored["data"] if stored else None) or {}
    return {key: _survey_view(data.get(key, [])) for key in _SERIES}

from __future__ import annotations
import logging
import math
import os
import requests
from datetime import date as _date
from .cache import _mc_save, _mc_load, _merge_history
from services.utils import today_kst

logger = logging.getLogger(__name__)

# 큐레이션 2종 FRED 신규 창업 신청(Business Formation Statistics) 시리즈 → 내부 키.
_SERIES = {
    "information": "BABANAICS51SAUS",   # 정보 부문, 월간·계절조정
    "professional": "BABANAICS54SAUS",  # 전문·과학·기술서비스 부문, 월간·계절조정
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


def _fetch_and_save_business_formation() -> dict:
    """부문별 소스-폴백 — 한 부문의 실패(예외·빈응답)가 다른 부문의 갱신을 막지 않는다.

    끝 가드가 아니라 부문 단위 가드다: 어떤 실패 경로에서도 그 부문은 직전 저장값을
    그대로 유지하고, 성공한 부문만 갱신해 저장한다(wrong < missing, CONVENTIONS §1.3).

    반환에는 부문 데이터(`_SERIES` 키) 외에 `_status`가 실릴 수 있다 — 전부 성공이면
    없고, 일부만 실패하면 "partial", 전부 실패하면 "skipped"(저장은 생략됐다). 호출측
    (scheduler/jobs.py·routers/market_indicators.py)이 이를 job_runs 상태로 반영한다.
    `_status`는 `_mc_save` 호출 *뒤에* 붙여 저장 캐시에는 섞이지 않는다.
    """
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        return {"error": "FRED_API_KEY 환경변수가 필요합니다."}

    stored_data = (_mc_load("business_formation") or {}).get("data") or {}
    default_start = _date(today_kst().year - 6, 1, 1).isoformat()

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
            logger.warning(f"[Formation] {key}({series_id}) 수집 실패, 직전값 보존: {e}")
            merged[key] = prev
            any_failure = True

    if not any_success:
        logger.warning("[Formation] 전 부문 수집 실패 — 저장 생략, 직전값 반환")
        result = dict(stored_data) if stored_data else {k: [] for k in _SERIES}
        result["_status"] = "skipped"
        return result

    _mc_save("business_formation", merged)
    if any_failure:
        return {**merged, "_status": "partial"}  # 반환용 별도 dict — _mc_save에 넘긴 merged는 그대로 둔다
    return merged


def moving_average(series: list[dict], window: int = 3) -> list[dict]:
    """단순 이동평균(순수함수). 앞 window-1개 지점은 값이 없으므로 결과에서 빠진다."""
    if len(series) < window:
        return []
    result = []
    for i in range(window - 1, len(series)):
        vals = [series[j]["value"] for j in range(i - window + 1, i + 1)]
        result.append({"date": series[i]["date"], "value": round(sum(vals) / window, 2)})
    return result


def _sector_view(history: list) -> dict:
    ma3 = moving_average(history)
    return {
        "history": history,
        "ma3": ma3,
        "latest_raw": history[-1]["value"] if history else None,
        "latest_ma3": ma3[-1]["value"] if ma3 else None,
        "latest_date": history[-1]["date"] if history else None,
        "prev_raw": history[-2]["value"] if len(history) >= 2 else None,
    }


def get_business_formation() -> dict:
    """저장된 신규 창업 신청 시계열을 부문별 뷰로 반환(요청경로 FRED 호출 없음)."""
    stored = _mc_load("business_formation")
    data = (stored["data"] if stored else None) or {}
    return {key: _sector_view(data.get(key, [])) for key in _SERIES}

from __future__ import annotations
import logging
import math
import os
import requests
from datetime import date as _date
from .cache import _mc_save, _mc_load, _merge_history
from services.utils import today_kst

logger = logging.getLogger(__name__)

# 절사평균 물가 4종(FRED) — 2종은 지수(YoY 파생 필요), 2종은 이미 YoY %로 발행된다
# (CONTEXT "[[절사평균 물가]]"). 저장은 원계열 그대로 두고(지수는 지수·%는 %), 응답에서만
# 단위를 YoY %로 통일한다 — 단위 혼동이 이 섹션의 최대 위험이다(지수 값 131이 %축에
# 섞이면 차트가 통째로 무의미해진다).
_SERIES = {
    "core_pce": {"series_id": "PCEPILFE", "kind": "index"},                          # 코어 PCE, 월간·지수
    "headline_pce": {"series_id": "PCEPI", "kind": "index"},                         # 헤드라인 PCE, 월간·지수
    "dallas_trimmed": {"series_id": "PCETRIM12M159SFRBDAL", "kind": "percent"},       # Dallas Fed 절사평균, 이미 YoY %
    "cleveland_trimmed": {"series_id": "TRMMEANCPIM159SFRBCLE", "kind": "percent"},   # Cleveland Fed 16% 절사평균, 이미 YoY %
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


def _fetch_and_save_trimmed_inflation() -> dict:
    """계열별 소스-폴백 — 한 계열의 실패(예외·빈응답)가 다른 계열의 갱신을 막지 않는다.

    끝 가드가 아니라 계열 단위 가드다(CONVENTIONS §1.3): 어떤 실패 경로에서도 그 계열은
    직전 저장값을 그대로 유지하고, 성공한 계열만 갱신해 저장한다(wrong < missing).
    저장은 FRED 원계열(지수는 지수·%는 %) — 단위 통일은 get_trimmed_inflation()이 담당한다.

    반환에는 계열 데이터(`_SERIES` 키) 외에 `_status`가 실릴 수 있다 — 전부 성공이면
    없고, 일부만 실패하면 "partial", 전부 실패하면 "skipped"(저장은 생략됐다). 호출측
    (scheduler/jobs.py·routers/market_indicators.py)이 이를 job_runs 상태로 반영한다.
    `_status`는 `_mc_save` 호출 *뒤에* 붙여 저장 캐시에는 섞이지 않는다.
    """
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        return {"error": "FRED_API_KEY 환경변수가 필요합니다."}

    stored_data = (_mc_load("trimmed_inflation") or {}).get("data") or {}
    # 표시 시작(today_kst().year-8 상당, 2018-01)에 YoY 계산용 12개월 여유를 더한 값.
    # 표시창만 잡으면 지수 2종의 YoY 첫 1년이 통째로 빈다.
    default_start = _date(today_kst().year - 9, 1, 1).isoformat()

    merged: dict = {}
    any_success = False
    any_failure = False
    for key, meta in _SERIES.items():
        series_id = meta["series_id"]
        prev = stored_data.get(key, [])
        try:
            start = prev[-1]["date"] if prev else default_start
            new_pts = _fetch_series(series_id, api_key, start)
            if not new_pts:  # 성공-but-빈응답도 실패로 취급(예외 가드를 그냥 통과하는 클래스)
                raise ValueError("관측 0건")
            merged[key] = _merge_history(prev, new_pts)
            any_success = True
        except Exception as e:
            logger.warning(f"[Inflation] {key}({series_id}) 수집 실패, 직전값 보존: {e}")
            merged[key] = prev
            any_failure = True

    if not any_success:
        logger.warning("[Inflation] 전 계열 수집 실패 — 저장 생략, 직전값 반환")
        result = dict(stored_data) if stored_data else {k: [] for k in _SERIES}
        result["_status"] = "skipped"
        return result

    _mc_save("trimmed_inflation", merged)
    if any_failure:
        return {**merged, "_status": "partial"}  # 반환용 별도 dict — _mc_save에 넘긴 merged는 그대로 둔다
    return merged


def yoy_from_index(series: list[dict]) -> list[dict]:
    """지수 시계열 → 전년동월비(%) 시계열로 변환하는 순수함수.

    ⚠️ 인덱스 오프셋(`series[i-12]`)이 아니라 **날짜 키(YYYY-MM-DD에서 1년 뺀 키)**로
    짝을 찾는다 — 관측 결손이 있으면 조용히 다른 달과 비교하지 않고 그 지점을 생략한다.
    분모(12개월 전 값)가 0이거나 결과가 비유한이면 그 지점도 생략한다.
    """
    by_date = {p["date"]: p["value"] for p in series}
    result = []
    for p in series:
        d = _date.fromisoformat(p["date"])
        target_date = _date(d.year - 1, d.month, d.day).isoformat()
        prev_value = by_date.get(target_date)
        if prev_value is None or prev_value == 0:
            continue
        v = (p["value"] / prev_value - 1) * 100
        if not math.isfinite(v):
            continue
        result.append({"date": p["date"], "value": round(v, 2)})
    return result


def _series_view(key: str, history: list) -> dict:
    yoy = history if _SERIES[key]["kind"] == "percent" else yoy_from_index(history)
    latest = yoy[-1] if yoy else None
    return {
        "history": yoy,
        "latest": latest["value"] if latest else None,
        "latest_date": latest["date"] if latest else None,
    }


def get_trimmed_inflation() -> dict:
    """저장된 물가 4종 시계열을 YoY %로 통일한 뷰로 반환(요청경로 FRED 호출 없음).

    지수 2종(core_pce·headline_pce)은 yoy_from_index로 파생하고, 이미 % 2종
    (dallas_trimmed·cleveland_trimmed)은 원값 그대로 노출한다(YoY를 두 번 적용하지
    않는다) — 응답은 항상 4종 모두 YoY % 시계열이다.
    """
    stored = _mc_load("trimmed_inflation")
    data = (stored["data"] if stored else None) or {}
    return {key: _series_view(key, data.get(key, [])) for key in _SERIES}

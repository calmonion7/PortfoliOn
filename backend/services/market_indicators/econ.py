from __future__ import annotations
import logging
import os
import requests
from datetime import date as _date

from .cache import (_mc_save, _cache, _mc_load, _mc_load_strict, _get_cache, _set_cache,
                    _merge_history, _mc_delete)
from services.utils import today_kst

logger = logging.getLogger(__name__)

# 큐레이션 2종 FRED 경제지표 시리즈 → 내부 키(응답 키이기도 하다).
_SERIES = {
    "cpi": "CPIAUCSL",         # 소비자물가지수(월간)
    "unemployment": "UNRATE",  # 실업률(월간, %)
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


def _fetch_and_save_econ_indicators() -> dict:
    """계열별 소스-폴백 — 한 계열의 실패(예외·빈응답)가 다른 계열의 갱신을 막지 않는다.

    끝 가드가 아니라 계열 단위 가드다: 어떤 실패 경로에서도 그 계열은 직전 저장값을
    그대로 유지하고, 성공한 계열만 갱신해 저장한다(wrong < missing, CONVENTIONS §1.3).
    형제 `formation.py`·`labor.py`·`inflation.py`와 같은 형태다.

    반환에는 계열 데이터(`_SERIES` 키) 외에 `_status`가 실릴 수 있다 — 전부 성공이면
    없고, 일부만 실패하면 "partial", 전부 실패하면 "skipped"(저장은 생략됐다). 호출측
    (scheduler/jobs.py·routers/market_indicators.py)이 이를 job_runs 상태로 반영한다 —
    안 하면 FRED가 며칠 죽어도 매 실행이 success로 기록되고 저장값이 무기한 stale해진다(B6).
    `_status`는 `_mc_save` 호출 *뒤에* 붙여 저장 캐시에는 섞이지 않는다.

    ⚠️ 저장값 조회는 **엄격 로더**다. 관용 `_mc_load`는 조회 예외를 None으로 접으므로
    「DB 오류」가 「저장값 없음」이 되고, 그러면 `prev=[]`가 되어 **실패한 계열이 빈 배열로
    저장돼 누적 시계열이 파괴된다**(그 순간 로그는 "직전값 보존"이라고 말하므로 관측이 사실과
    반대가 된다). 이 함수는 저장값 위에 `_merge_history`로 누적하는 경로이므로 조회 실패는
    전파해 `_mc_save`에 도달하지 못하게 한다 — 이력이 보존되고 `job_runs.record`가 스스로
    failed를 기록한다(`_mc_load_strict` docstring, kospi_signal과 같은 처방).
    """
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        return {"error": "FRED_API_KEY 환경변수가 필요합니다."}

    stored_data = (_mc_load_strict("econ_indicators") or {}).get("data") or {}
    default_start = _date(today_kst().year - 3, 1, 1).isoformat()

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
            logger.warning(f"[Econ] {key}({series_id}) 수집 실패, 직전값 보존: {e}")
            merged[key] = prev
            any_failure = True

    if not any_success:
        logger.warning("[Econ] 전 계열 수집 실패 — 저장 생략, 직전값 반환")
        result = dict(stored_data) if stored_data else {k: [] for k in _SERIES}
        result["_status"] = "skipped"
        return result

    _mc_save("econ_indicators", merged)
    _cache.pop("econ_indicators", None)
    if any_failure:
        return {**merged, "_status": "partial"}  # 반환용 별도 dict — _mc_save에 넘긴 merged는 그대로 둔다
    return merged


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
    if stored:
        if _is_valid_econ_data(stored["data"]):
            _set_cache("econ_indicators", stored["data"], ttl=86400)
            return stored["data"]
        # **오염 데이터일 때만** 삭제한다. `_mc_load`는 조회 예외를 None으로 접으므로
        # `stored is None`은 「행 없음」과 「DB 오류」를 겸한다 — 후자에서 삭제하면 누적 행이
        # 사라지고, `default_start`가 항상 올해−3년이라 그 이전 구간은 **영구 소실**된다
        # (행이 없을 때의 삭제는 어차피 no-op이므로 이 이동은 의도된 동작을 하나도 잃지 않는다).
        logger.warning("[Econ] 저장 데이터 오염 감지 — 행 삭제 후 강제 재fetch")
        _mc_delete("econ_indicators")
    _cache.pop("econ_indicators", None)
    data = _fetch_and_save_econ_indicators()
    if isinstance(data, dict) and "error" not in data:
        # `_status`는 배치 레인 전용 메타다 — 응답·인메모리 캐시에 실으면 요청경로 shape이
        # 실패할 때만 달라진다(형제 get_business_formation은 fetch를 안 타서 이 문제가 없다).
        data = {k: v for k, v in data.items() if k != "_status"}
        _set_cache("econ_indicators", data, ttl=86400)
    return data

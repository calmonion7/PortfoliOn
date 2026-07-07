"""코스피200 선물(KIS) 일봉 차트 + 현재가/베이시스 — 요청경로, 배치 없음(ADR-0022).

최근월물 전체 윈도우(~120봉) 단발 조회(스티칭 없음). KIS 미설정 시 dormant(graceful
빈 응답). fetch 실패 시 sentiment.py 방식으로 직전 저장값 폴백(get_or_refresh는
stale-fallback 안 함).
"""
from __future__ import annotations
import logging
from services.kis import client, futures as kis_futures
from .cache import _get_cache, _set_cache, _mc_load, _mc_save

logger = logging.getLogger(__name__)

_EMPTY = {"current": None, "history": []}


def _fetch() -> dict | None:
    try:
        front = kis_futures.get_front_month()
        history = kis_futures.fetch_daily(front["code"], days=120)
        return {
            "current": {
                "price": front.get("price"),
                "change_pct": front.get("change_pct"),
                "basis": front.get("basis"),
                "contract": front.get("contract_name"),
                "last_tr_date": front.get("last_tr_date"),
            },
            "history": history,
        }
    except Exception as e:
        logger.warning(f"[KospiFutures] fetch 실패: {e}")
        return None


def get_kospi_futures() -> dict:
    if not client.configured():
        return dict(_EMPTY)

    cached = _get_cache("kospi_futures")
    if cached:
        return cached

    data = _fetch()
    if data is not None:
        from services.utils import sanitize
        data = sanitize(data)
        _mc_save("kospi_futures", data)
        _set_cache("kospi_futures", data, ttl=3600)
        return data

    stored = _mc_load("kospi_futures")
    if stored:
        _set_cache("kospi_futures", stored["data"], ttl=3600)
        return stored["data"]
    return dict(_EMPTY)

from __future__ import annotations
import logging
import requests
from concurrent.futures import ThreadPoolExecutor
from .cache import (_get_cache, _set_cache, _cache, _mc_load, _mc_save, _yf_close_history,
                    _filter_outliers, _public)

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
    """심볼 하나의 소스-폴백. 반환 dict의 `_stale`은 「직전 저장값으로 채웠다」는 표시다.

    이 함수가 폴백 계층이라, 라이브가 통째로 죽어도 값이 채워져 돌아온다 — 표시가 없으면
    호출측(배치)이 「전멸」과 「정상」을 구별할 수 없어 job_runs가 영원히 초록이 된다(B41).
    `_stale`은 rates/history 구성에 쓰이지 않으므로 저장 blob·응답에는 실리지 않는다.

    ⚠️ **실패 클래스 (b) 성공-but-빈응답이 이 함수의 성공 분기로 들어온다.** yfinance의
    지배적 실패 모드는 예외가 아니라 **빈 DataFrame**이고, `_yf_close_history`는 그때
    (그리고 조회 구간이 없을 때) 입력 리스트를 **그대로** 돌려준다 — 예외가 없으니 아래
    try/except 가드를 그냥 통과한다. 그래서 「새 점이 하나도 안 붙었다」를 `_stale`로 함께
    표시해야 전 심볼 빈응답이 success로 고착되지 않는다(그 상태에서 `_mc_save`까지 돌면
    내용은 그대로인데 `fetched_at`만 갱신돼 나이 신호마저 거짓이 된다).
    """
    key, sym, stored_raw = args
    try:
        raw_history = _yf_close_history(sym, stored_raw, precision=4)
        history = _filter_outliers(raw_history)
        if history:
            current = round(history[-1]["value"], 4)
            prev = round(history[-2]["value"], 4) if len(history) > 1 else current
            change_pct = round((current - prev) / prev * 100, 2) if prev else 0.0
            out = {"current": current, "change_pct": change_pct, "history": history,
                   "_raw_history": raw_history}
            if raw_history == stored_raw:
                # 새 종가가 한 점도 안 붙었다 = 라이브에서 아무것도 못 받았다.
                # (휴장일·같은 날 재실행도 여기로 온다 — 그때도 "갱신됨"은 사실이 아니다.)
                out["_stale"] = True
            return key, out
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
                         "_raw_history": stored_raw, "_stale": True}

    if key == "usdkrw":
        current = _fetch_usdkrw_current()
        if current:
            return key, {"current": current, "change_pct": 0.0, "history": [], "_raw_history": []}

    return key, None


def get_fx() -> dict:
    cached = _get_cache("fx")
    if cached:
        return cached
    public, _ = _refresh_fx_data()  # 요청경로는 status를 쓰지 않는다(배치 레인 전용)
    return public


def _refresh_fx_data() -> tuple:
    """저장값을 갱신하고 `(응답 dict, status)`를 반환한다. status: success|partial|skipped.

    본문은 종래 `get_fx()`의 것이고 응답 계약도 그대로다 — 배치 레인이 「무엇이 실제로
    갱신됐는지」를 알아야 job_runs를 초록으로 고착시키지 않기 때문에 status만 함께 돌려준다.
    판정 축은 **신선한 심볼 수**다: `_fetch_fx`가 소스-폴백 계층이라 저장값 폴백도 값을
    채워 반환하므로, rates 커버리지만 보면 yfinance가 통째로 죽어도 success로 보인다.
    """
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
        return {"rates": {}, "history": {}}, "skipped"

    data = {"rates": rates, "history": history, "_raw_history": raw_history}
    public = _public(data)
    # 판정을 **저장 앞**에 둔다 — 신선한 심볼이 0개면 payload 내용이 저장값과 동일하므로
    # 쓰면 `fetched_at`만 갱신돼 나이 신호가 거짓이 된다(BH7-L1의 "판정을 백필 앞으로" 형제).
    # 인메모리 캐시는 채운다 — 요청경로가 last-good을 계속 서빙해야 한다.
    fresh = {k for k, v in results.items() if v and not v.get("_stale")}
    if not fresh:
        logger.warning("[FX] 신선한 심볼 0개 — 저장 생략, 직전 저장값 유지")
        _set_cache("fx", public, ttl=3600)
        return public, "skipped"

    _mc_save("fx", data)
    _set_cache("fx", public, ttl=3600)
    if len(fresh) < len(_FX_SYMBOLS):
        return public, "partial"
    return public, "success"


def _fetch_and_save_fx() -> dict:
    """배치용 강제 갱신 — 인메모리 TTL을 비운 뒤 저장값을 갱신한다(fx_fetch 배치의 본문).

    반환은 `get_fx()`와 같은 응답 dict에 `_status`(partial|skipped)를 얹은 것이며, 전부
    신선하면 `_status`가 없다. `_mc_delete`는 하지 않는다 — 저장값이 소스-폴백의 baseline이라
    지우면 fetch 실패 시 폴백할 것이 없어진다(`refresh-market`은 그렇게 하지만 그쪽은
    「초기화 후 1년치 재조회」가 목적이다).
    """
    _cache.pop("fx", None)
    public, status = _refresh_fx_data()
    if status == "success":
        return public
    # 새 dict — 저장 blob도 인메모리 캐시(public)도 mutate하지 않는다.
    return {**public, "_status": status}


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

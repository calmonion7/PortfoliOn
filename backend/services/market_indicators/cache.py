from __future__ import annotations
import json
import logging
import os
import time
import yfinance as yf
from services.db import query, execute
from services.utils import today_kst

logger = logging.getLogger(__name__)

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_DATA_DIR = os.path.join(_BASE_DIR, "data")

_cache: dict = {}


def _get_cache(key: str) -> dict | None:
    entry = _cache.get(key)
    if entry and time.time() < entry["expires"]:
        return entry["data"]
    return None


def _set_cache(key: str, data: dict, ttl: int) -> None:
    now = time.time()
    expired = [k for k, v in _cache.items() if now >= v["expires"]]
    for k in expired:
        del _cache[k]
    _cache[key] = {"data": data, "expires": now + ttl}


def _mc_load_strict(key: str) -> dict | None:
    """`_mc_load`의 엄격판 — **조회 실패를 전파**한다. 행 부재는 종래대로 None.

    `_mc_load`는 예외를 warning 후 None으로 접으므로 「DB 오류」와 「한 번도 저장 안 됨」이
    같은 값이 된다. 저장값을 읽어 **그 위에 누적**하는 경로에서는 그 붕괴가 곧 이력 파괴다
    (`kospi_signal`: SELECT 한 번의 실패 + 드라이버 fetch 성공 → 180일 신호·적중률이
    오늘 1건으로 치환된다. 그날의 갭·종가 대사에서 파생되므로 재구성 불가).
    누적 저장 경로만 이 함수를 쓴다 — 예외가 전파되면 `_mc_save`에 도달하지 못해 이력이
    보존되고, `job_runs.record`가 스스로 `failed`를 기록해 관측성까지 함께 얻는다
    (이 한 건에서는 예외 전파가 `set_status` 배선보다 정확한 신호다).

    ⚠️ **additive다.** 기존 `_mc_load`(앱 36곳·18모듈 + patch하는 테스트 17파일)의
    반환 계약은 건드리지 않는다 — 그중 다수가 이 wave의 소유 밖이다.
    """
    rows = query("SELECT data, fetched_at FROM market_cache WHERE key = %s", (key,))
    if rows:
        return {"data": rows[0]["data"], "fetched_at": rows[0]["fetched_at"]}
    return None


def _mc_load(key: str) -> dict | None:
    """관용 로더 — 조회 실패를 warning 후 None으로 접는다(동작 불변).

    누적 저장 경로에서는 이 붕괴가 위험하니 `_mc_load_strict`를 쓸 것."""
    try:
        return _mc_load_strict(key)
    except Exception as e:
        logger.warning(f"[Cache] _mc_load key={key} 실패: {e}")
    return None


def _mc_save(key: str, data: dict) -> None:
    from datetime import datetime, timezone
    try:
        fetched_at = datetime.now(timezone.utc).isoformat()
        execute(
            "INSERT INTO market_cache (key, data, fetched_at) VALUES (%s, %s, %s) "
            "ON CONFLICT (key) DO UPDATE SET data=EXCLUDED.data, fetched_at=EXCLUDED.fetched_at",
            (key, json.dumps(data), fetched_at),
        )
    except Exception as e:
        logger.warning(f"[Cache] _mc_save key={key} 실패: {e}")


def _mc_delete(key: str) -> None:
    try:
        execute("DELETE FROM market_cache WHERE key = %s", (key,))
    except Exception as e:
        logger.warning(f"[Cache] _mc_delete key={key} 실패: {e}")


def clear_cache(key: str) -> None:
    """인메모리 + DB 캐시 모두 삭제."""
    _mc_delete(key)
    _cache.pop(key, None)


# ── 계약(ADR-0040): 저장값은 raw다. 저장값을 직접 읽는 새 소비처는 스스로 표시
# 필터(`_filter_outliers`)를 걸어야 한다 — `_yf_close_history`가 필터를 대신 해주지 않는다.


def _public(data: dict) -> dict:
    """저장 blob → 응답용 dict. 저장 전용 raw 필드를 벗긴다.

    라우터가 이 dict를 그대로 반환하므로, 벗기지 않으면 ADR-0040이 표시에서 가리기로 한
    바로 그 쓰레기 점이 공개 API로 새고 응답 shape도 바뀐다(계획 비목표 위반, 적대 검토 HIGH).
    `_raw_histories`(treasury)는 이번 변경 *이전부터* 응답에 있던 키라 건드리지 않는다 —
    없애는 것도 shape 변경이다."""
    return {k: v for k, v in data.items() if k != "_raw_history"}

def _merge_history(stored: list[dict], new_pts: list[dict]) -> list[dict]:
    merged = {p["date"]: p for p in stored}
    merged.update({p["date"]: p for p in new_pts})
    return sorted(merged.values(), key=lambda p: p["date"])


_SPIKE_RATIO = 3.0
_NEIGHBOR_AGREE_RATIO = 1.5
# 선두 쓰레기 런 판정 임계. 지속 이동의 중앙값 대비 최대 이탈(^IRX 0.03→4.5는 12배)과
# 실측 쓰레기 점(9000 vs 4.2 = 2143배, 0.01 vs 104 = 10450배) 사이에 여유롭게 둔다.
_LEAD_ABSURD_RATIO = 50.0


def _filter_outliers(pts: list[dict]) -> list[dict]:
    """판정축 = 고립 스파이크(하루 튀었다 정확히 제자리로 돌아옴). 중앙값 대비 배수는
    지속적 국면전환(예: ^IRX 0.03%→4.5%)과 일시적 쓰레기 점을 구별 못 해 지속 이동의
    양 끝을 통째로 자른다(ADR-0040) — 이웃끼리의 국소 정합만 보면 지속 이동엔
    원리적으로 무반응하다. 첫 점은 단일 이웃 비교, 마지막 점은 current/change_pct의
    출처라 검사하지 않는다.

    ⚠️ 입력은 **엄격히 양수인** 가격/금리 시계열이어야 한다(호출처 12곳 전부 그렇다).
    부호가 교차하는 시계열(예: 국채 spread)을 넣으면 부호 전환점이 스파이크로 오판된다 —
    spread는 이 필터를 타지 않는다."""
    n = len(pts)
    if n < 2:
        return pts

    def _ratio(a: float, b: float) -> float:
        # 한쪽만 비양수면 완전 불일치(inf)다. 둘 다 비양수면 서로 정합으로 본다.
        # 옛 중앙값 필터는 median>0인 한 v<=0을 항상 배제했으므로, 여기서 1.0을 주면
        # 0/음수 쓰레기 점이 영영 안 걸리는 신규 사각이 생긴다(적대 검토 HIGH).
        if a <= 0 and b <= 0:
            return 1.0
        if a <= 0 or b <= 0:
            return float("inf")
        return max(a / b, b / a)

    drop: set[int] = set()

    # ① 선두 쓰레기 런 — 원 버그(9dedc01·f7b5a21)의 형태는 "가장 오래된 쓰레기 점"이고,
    # 그것이 2점 이상 연속이면 쓰레기끼리 정합해버려 ②의 국소 판정이 통째로 무력화된다.
    # 그래서 선두만 본문 중앙값과 대조해 자릿수가 다른 동안 벗겨낸다(지속 이동엔 무반응).
    vals = sorted(p["value"] for p in pts)
    median = vals[n // 2]
    if median > 0:
        for i in range(n - 1):
            if _ratio(pts[i]["value"], median) < _LEAD_ABSURD_RATIO:
                break
            drop.add(i)

    # ② 고립 스파이크 — 양 이웃과 모두 어긋나면서 그 이웃끼리는 서로 정합일 때만.
    if _ratio(pts[0]["value"], pts[1]["value"]) >= _SPIKE_RATIO:
        drop.add(0)

    for i in range(1, n - 1):
        prev_v, cur_v, next_v = pts[i - 1]["value"], pts[i]["value"], pts[i + 1]["value"]
        if (_ratio(cur_v, prev_v) >= _SPIKE_RATIO and _ratio(cur_v, next_v) >= _SPIKE_RATIO
                and _ratio(prev_v, next_v) <= _NEIGHBOR_AGREE_RATIO):
            drop.add(i)

    return [p for idx, p in enumerate(pts) if idx not in drop]


def _yf_close_history(sym: str, stored: list[dict], precision: int = 4) -> list[dict]:
    """yfinance Close 히스토리 incremental fetch. **저장용 반환값이다 — raw, 필터 없음**
    (ADR-0040). 표시 필터(`_filter_outliers`)는 호출자가 응답/계산을 만드는 자리에서
    스스로 적용해야 한다. 저장값을 직접 읽는 새 소비처도 이 계약을 따를 것."""
    from datetime import date, timedelta
    if stored:
        last = stored[-1]["date"]
        start = (date.fromisoformat(last) + timedelta(days=1)).isoformat()
        if start > today_kst().isoformat():
            return stored
        hist = yf.Ticker(sym).history(start=start, interval="1d")
    else:
        hist = yf.Ticker(sym).history(period="1y", interval="1d")

    if hist.empty:
        return stored

    close = hist["Close"].dropna()
    new_pts = [
        {"date": str(d.date()), "value": round(float(v), precision)}
        for d, v in zip(close.index, close.values)
    ]
    combined = _merge_history(stored, new_pts)
    cutoff = (today_kst() - timedelta(days=366)).isoformat()
    return [p for p in combined if p["date"] >= cutoff]


def get_or_refresh(key: str, fetch_fn, ttl: int, force: bool = False) -> dict:
    """캐시 확인 → 없으면 fetch_fn() 호출. fetch_fn은 저장까지 담당."""
    if not force:
        cached = _get_cache(key)
        if cached:
            return cached
        stored = _mc_load(key)
        if stored:
            _set_cache(key, stored["data"], ttl)
            return stored["data"]
    return fetch_fn()

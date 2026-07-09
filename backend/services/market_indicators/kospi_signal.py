"""task #154: 다음날 코스피 방향 신호(오버나잇 프록시) + 적중률 누적.

미국장 마감 후(S&P500·나스닥·USD/KRW) 종가 변동을 합성해 다음 KR 거래일 방향을
bullish/bearish/neutral로 판정하고, 실제 결과(코스피 시가/종가)로 적중 여부를
누적한다. market_cache key 'kospi_signal'.
"""
from __future__ import annotations
import logging
import math
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import yfinance as yf
from services.utils import sanitize
from .cache import _mc_load, _mc_save, _yf_close_history

logger = logging.getLogger(__name__)

_KST = ZoneInfo("Asia/Seoul")

_DRIVER_SYMBOLS = {"sp500": "^GSPC", "nasdaq": "^IXIC", "usdkrw": "USDKRW=X"}
_KOSPI_SYMBOL = "^KS11"

# eco: 등가중(1/3씩) + 고정 밴드(±0.5%p) — 업그레이드 경로: 누적 적중률로 가중치/밴드 보정
BAND = 0.5
_MAX_DAYS = 180


def _chg_pct(history: list[dict]) -> float | None:
    """저장 히스토리에서 최신 종가 대비 직전 종가 변동률(%)."""
    if len(history) < 2:
        return None
    latest, prev = history[-1]["value"], history[-2]["value"]
    if not prev:
        return None
    pct = (latest - prev) / prev * 100
    return pct if math.isfinite(pct) else None


def compute_signal(sp500_chg: float | None, nasdaq_chg: float | None,
                    usdkrw_chg: float | None) -> tuple[float | None, str | None]:
    """composite_pct = (sp500+nasdaq-usdkrw)/3, ±0.5 밴드로 signal 판정. 순수함수."""
    if sp500_chg is None or nasdaq_chg is None or usdkrw_chg is None:
        return None, None
    composite = (sp500_chg + nasdaq_chg - usdkrw_chg) / 3
    if not math.isfinite(composite):
        return None, None
    composite = round(composite, 4)
    if composite > BAND:
        signal = "bullish"
    elif composite < -BAND:
        signal = "bearish"
    else:
        signal = "neutral"
    return composite, signal


def judge_hit(signal: str | None, actual_close_pct: float | None) -> bool | None:
    """종가 기준 적중 판정. signal/actual 결측이면 None."""
    if signal is None or actual_close_pct is None:
        return None
    if signal == "bullish":
        return actual_close_pct > BAND
    if signal == "bearish":
        return actual_close_pct < -BAND
    return abs(actual_close_pct) <= BAND


def _reconcile_actuals(series: list[dict]) -> list[dict]:
    """actual_close_pct가 비어있는 레코드에 코스피 시가/종가로 실제 결과를 채운다."""
    pending = [r for r in series if r.get("actual_close_pct") is None]
    if not pending:
        return series
    try:
        hist = yf.Ticker(_KOSPI_SYMBOL).history(period="6mo", interval="1d")
    except Exception as e:
        logger.warning(f"[KospiSignal] KOSPI 히스토리 fetch 실패, reconcile 스킵: {e}")
        return series
    if hist.empty:
        return series

    rows = {}
    for d, o, c in zip(hist.index, hist["Open"].values, hist["Close"].values):
        o, c = float(o), float(c)
        if math.isfinite(o) and math.isfinite(c):
            rows[str(d.date())] = {"open": o, "close": c}
    dates_sorted = sorted(rows)

    for rec in pending:
        d = rec["date"]
        if d not in rows:
            continue
        idx = dates_sorted.index(d)
        if idx == 0:
            continue
        prev_close = rows[dates_sorted[idx - 1]]["close"]
        if not prev_close:
            continue
        gap_pct = (rows[d]["open"] - prev_close) / prev_close * 100
        close_pct = (rows[d]["close"] - prev_close) / prev_close * 100
        if not (math.isfinite(gap_pct) and math.isfinite(close_pct)):
            continue
        rec["actual_gap_pct"] = round(gap_pct, 4)
        rec["actual_close_pct"] = round(close_pct, 4)
        rec["hit"] = judge_hit(rec.get("signal"), rec["actual_close_pct"])
    return series


def refresh_kospi_signal() -> dict:
    stored = _mc_load("kospi_signal")
    stored_data = (stored["data"] if stored else None) or {}
    series: list[dict] = list(stored_data.get("series", []))
    drivers_history: dict = dict(stored_data.get("drivers_history", {}))

    today_str = datetime.now(_KST).date().isoformat()

    new_hist = {}
    fetch_ok = True
    for key, sym in _DRIVER_SYMBOLS.items():
        try:
            h = _yf_close_history(sym, drivers_history.get(key, []), precision=4)
        except Exception as e:
            logger.warning(f"[KospiSignal] {sym} fetch 실패: {e}")
            h = []
        if not h:
            fetch_ok = False
        new_hist[key] = h

    if fetch_ok:
        drivers_history = new_hist
        composite, signal = compute_signal(
            _chg_pct(drivers_history["sp500"]),
            _chg_pct(drivers_history["nasdaq"]),
            _chg_pct(drivers_history["usdkrw"]),
        )
        record = {
            "date": today_str,
            "signal": signal,
            "composite_pct": composite,
            "drivers": {
                "sp500": _chg_pct(drivers_history["sp500"]),
                "nasdaq": _chg_pct(drivers_history["nasdaq"]),
                "usdkrw": _chg_pct(drivers_history["usdkrw"]),
            },
            "actual_gap_pct": None,
            "actual_close_pct": None,
            "hit": None,
        }
        series = sorted(
            [r for r in series if r["date"] != today_str] + [record],
            key=lambda r: r["date"],
        )
    else:
        logger.warning("[KospiSignal] 드라이버 히스토리 수집 실패, 저장 시리즈 유지")

    pending_before = sum(1 for r in series if r.get("actual_close_pct") is None)
    series = _reconcile_actuals(series)
    pending_after = sum(1 for r in series if r.get("actual_close_pct") is None)
    changed = fetch_ok or pending_after < pending_before

    cutoff = (datetime.now(_KST).date() - timedelta(days=_MAX_DAYS)).isoformat()
    series = [r for r in series if r["date"] >= cutoff]

    data = sanitize({"series": series, "drivers_history": drivers_history})
    if changed:
        _mc_save("kospi_signal", data)
    return data


def get_kospi_signal() -> dict:
    """저장된 신호 시계열+적중률 반환(요청경로 외부 API 호출 없음)."""
    stored = _mc_load("kospi_signal")
    data = (stored["data"] if stored else None) or {}
    series = data.get("series", [])

    current = None
    if series:
        latest = series[-1]
        current = {
            "date": latest.get("date"),
            "signal": latest.get("signal"),
            "composite_pct": latest.get("composite_pct"),
            "drivers": latest.get("drivers"),
        }

    directional = [r for r in series if r.get("signal") in ("bullish", "bearish") and r.get("hit") is not None]
    hits = sum(1 for r in directional if r["hit"])
    hit_rate = (hits / len(directional)) if directional else None

    neutral = [r for r in series if r.get("signal") == "neutral" and r.get("hit") is not None]
    neutral_hits = sum(1 for r in neutral if r["hit"])

    return sanitize({
        "current": current,
        "history": series,
        "hit_rate": hit_rate,
        "neutral": {"total": len(neutral), "hit": neutral_hits},
        "timestamp": stored["fetched_at"] if stored else None,
    })

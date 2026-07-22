"""task #154: 다음날 코스피 방향 신호(오버나잇 프록시) + 적중률 누적.

미국장 마감 후(S&P500·나스닥·USD/KRW·필라델피아 반도체지수 SOX) 종가 변동을 가중
합성해 다음 KR 거래일 방향을 bullish/bearish/neutral로 판정하고(task#203 S2 백테스트
채택 구성 — 모듈 상단 주석 참조), 실제 결과(코스피 시가/종가)로 적중 여부를 누적한다.
market_cache key 'kospi_signal'.
"""
from __future__ import annotations
import logging
import math
import statistics
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import yfinance as yf
from services.utils import sanitize
from .cache import _mc_load, _mc_save, _yf_close_history

logger = logging.getLogger(__name__)

_KST = ZoneInfo("Asia/Seoul")

_DRIVER_SYMBOLS = {"sp500": "^GSPC", "nasdaq": "^IXIC", "usdkrw": "USDKRW=X", "sox": "^SOX"}
_KOSPI_SYMBOL = "^KS11"

# 채택 구성(task#203 S2 백테스트, scripts/kospi_signal_backtest.py 1년 전수 조합 탐색) —
# base3(S&P500·나스닥·USD/KRW)+SOX(필라델피아 반도체지수), 가중치 sp500=2·nasdaq=0.5·
# usdkrw=-0.5(원화약세=비우호로 역방향)·sox=1. composite=Σ(가중치×등락률)/Σ|가중치|.
# 부호기준 방향성 적중률 78.9%(baseline 등가중3종·고정밴드0.5=71.3% 대비 +7.7%p, 채택
# 마진 +5%p 충족, 전후반 6개월 안정성 게이트 통과). 업그레이드 경로: 재보정 필요 시
# 스크립트 재실행 후 이 상수들만 갱신.
_DRIVER_WEIGHTS = {"sp500": 2.0, "nasdaq": 0.5, "usdkrw": -0.5, "sox": 1.0}
_WEIGHT_ABS_SUM = sum(abs(w) for w in _DRIVER_WEIGHTS.values())

# 밴드=적응형 k×20일 실현변동성(σ, k=0.5, 표본표준편차). BAND는 σ20 계산 불가(데이터
# 부족/fetch 실패) 시 폴백 + 레거시 레코드(band 미저장) 기본값으로만 쓰인다.
BAND = 0.5
_BAND_K = 0.5
_SIGMA_WINDOW = 20
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
                    usdkrw_chg: float | None, sox_chg: float | None,
                    band: float) -> tuple[float | None, str | None]:
    """composite = Σ(가중치×등락률)/Σ|가중치|(채택 구성, 모듈 상단 주석 참조),
    band 밴드(부호 대칭)로 signal 판정. 순수함수."""
    chgs = {"sp500": sp500_chg, "nasdaq": nasdaq_chg, "usdkrw": usdkrw_chg, "sox": sox_chg}
    if any(v is None for v in chgs.values()):
        return None, None
    composite = sum(_DRIVER_WEIGHTS[k] * v for k, v in chgs.items()) / _WEIGHT_ABS_SUM
    if not math.isfinite(composite):
        return None, None
    composite = round(composite, 4)
    if composite > band:
        signal = "bullish"
    elif composite < -band:
        signal = "bearish"
    else:
        signal = "neutral"
    return composite, signal


def judge_hit(signal: str | None, actual_close_pct: float | None, band: float = 0.5) -> bool | None:
    """적중 판정. 방향성(bullish/bearish)=부호 기준(크기 무관, actual==0은 miss),
    중립=|actual|<=band. signal/actual 결측이면 None."""
    if signal is None or actual_close_pct is None:
        return None
    if signal == "bullish":
        return actual_close_pct > 0
    if signal == "bearish":
        return actual_close_pct < 0
    return abs(actual_close_pct) <= band


_UNSET = object()


def _fetch_kospi_rows(period: str = "6mo") -> dict | None:
    """^KS11 일봉 fetch+파싱({date: {open, close}}) — reconcile과 적응형 밴드 σ20 계산이
    fetch 1회를 공유한다(refresh_kospi_signal에서 미리 호출해 넘김). 실패/빈 응답이면
    None(호출측이 graceful 처리)."""
    try:
        hist = yf.Ticker(_KOSPI_SYMBOL).history(period=period, interval="1d")
    except Exception as e:
        logger.warning(f"[KospiSignal] KOSPI 히스토리 fetch 실패: {e}")
        return None
    if hist.empty:
        return None
    rows = {}
    for d, o, c in zip(hist.index, hist["Open"].values, hist["Close"].values):
        o, c = float(o), float(c)
        if math.isfinite(o) and math.isfinite(c):
            rows[str(d.date())] = {"open": o, "close": c}
    return rows or None


def _adaptive_band(kospi_rows: dict | None, before_date: str) -> float:
    """k×20일 실현변동성(σ, %) 밴드 — before_date 이전(<) 최근 20개 일간 종가수익률의
    표본표준편차(pandas rolling(20).std() 동치, ddof=1) × _BAND_K. 데이터 부족/미제공
    시 고정 BAND로 폴백."""
    if kospi_rows:
        dates = sorted(d for d in kospi_rows if d < before_date)
        if len(dates) >= _SIGMA_WINDOW + 1:
            window = dates[-(_SIGMA_WINDOW + 1):]
            returns = []
            for i in range(1, len(window)):
                prev_c = kospi_rows[window[i - 1]]["close"]
                cur_c = kospi_rows[window[i]]["close"]
                if prev_c:
                    pct = (cur_c - prev_c) / prev_c * 100
                    if math.isfinite(pct):
                        returns.append(pct)
            if len(returns) == _SIGMA_WINDOW:
                band = round(_BAND_K * statistics.stdev(returns), 4)
                if math.isfinite(band) and band > 0:
                    return band
    return BAND


def _reconcile_actuals(series: list[dict], kospi_rows=_UNSET) -> list[dict]:
    """actual_close_pct가 있는 전 레코드의 hit을 재계산하고(레거시 band 기준 retro-fix),
    비어있는 레코드는 코스피 시가/종가로 채운다. 코스피 봉이 없고(휴장일) 이후 거래일
    봉이 존재하는 pending 레코드는 시리즈에서 제거한다(오늘 신호=뒤 봉 없음은 보존).
    kospi_rows 미지정(_UNSET)이면 직접 fetch하고, refresh 경로는 밴드 계산과 공유하려고
    미리 fetch한 rows(dict|None)를 넘긴다."""
    for rec in series:
        if rec.get("actual_close_pct") is not None:
            band = rec.get("band") or 0.5
            rec["hit"] = judge_hit(rec.get("signal"), rec["actual_close_pct"], band)

    pending = [r for r in series if r.get("actual_close_pct") is None]
    if not pending:
        return series
    if kospi_rows is _UNSET:
        kospi_rows = _fetch_kospi_rows()
    if not kospi_rows:
        return series
    rows = kospi_rows
    dates_sorted = sorted(rows)
    last_date = dates_sorted[-1] if dates_sorted else None

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
        band = rec.get("band") or 0.5
        rec["hit"] = judge_hit(rec.get("signal"), rec["actual_close_pct"], band)

    if last_date is not None:
        series = [
            r for r in series
            if not (r.get("actual_close_pct") is None and r["date"] not in rows and r["date"] < last_date)
        ]
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

    pending_exists = any(r.get("actual_close_pct") is None for r in series)
    # 적응형 밴드(오늘자 신규 레코드)와 reconcile(기존 pending)이 fetch 1회를 공유
    kospi_rows = _fetch_kospi_rows() if (fetch_ok or pending_exists) else None

    if fetch_ok:
        drivers_history = new_hist
        band = _adaptive_band(kospi_rows, today_str)
        composite, signal = compute_signal(
            _chg_pct(drivers_history["sp500"]),
            _chg_pct(drivers_history["nasdaq"]),
            _chg_pct(drivers_history["usdkrw"]),
            _chg_pct(drivers_history["sox"]),
            band,
        )
        record = {
            "date": today_str,
            "signal": signal,
            "composite_pct": composite,
            "band": band,
            "drivers": {
                "sp500": _chg_pct(drivers_history["sp500"]),
                "nasdaq": _chg_pct(drivers_history["nasdaq"]),
                "usdkrw": _chg_pct(drivers_history["usdkrw"]),
                "sox": _chg_pct(drivers_history["sox"]),
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
    hits_before = {r["date"]: r.get("hit") for r in series if r.get("actual_close_pct") is not None}
    series = _reconcile_actuals(series, kospi_rows=kospi_rows)
    pending_after = sum(1 for r in series if r.get("actual_close_pct") is None)
    hits_after = {r["date"]: r.get("hit") for r in series if r.get("actual_close_pct") is not None}
    # hits_before/after 비교는 이미 확정된 레코드의 retro-fix(부호기준 재판정)를 잡는다 —
    # pending 카운트만 보면 fetch 실패+pending 없음일 때 retro-fix된 hit이 저장 안 됨(task#203 적대 리뷰).
    changed = fetch_ok or pending_after < pending_before or hits_before != hits_after

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
            "band": latest.get("band"),
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

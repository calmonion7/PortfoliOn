"""코스피 방향 신호(backend/services/market_indicators/kospi_signal.py) 백테스트.

task#203 S2 — 로컬 오프라인 분석 도구다. 런타임(백엔드)에는 포함되지 않으며,
가중치/밴드/드라이버 구성을 재조정하고 싶을 때 로컬에서 재실행해 근거표를 얻는다.

무엇을 하나:
  1. yfinance로 ^GSPC·^IXIC·USDKRW=X·EWY·^SOX·^VIX(드라이버 후보)와 ^KS11(정답)의
     1년치 일봉을 받는다.
  2. 런타임의 "08:30 KST 지식집합"을 재현한다 — KR 거래일 D의 각 드라이버 변동률은
     '날짜 < D 인 가장 최근 두 봉' 간 pct change (미래 누수 없음).
  3. 드라이버 부분집합 10종 × 가중치 소그리드 × 밴드(고정 4종 + 적응형 k×20일 σ 4종)
     조합을 방향성 적중률(부호 기준)로 평가한다.
  4. 정해진 채택 규칙(①커버리지≥30% ②적중률 최고 ③동률타이브레이크 ④전후반 안정성
     ⑤baseline 대비 +5%p 미만이면 현행 유지)으로 승자를 자동 산출해 stdout에 표로 보여준다.

재실행법:
    cd backend && .venv/bin/python ../scripts/kospi_signal_backtest.py

주의: backend/services/market_indicators/kospi_signal.py의 judge_hit()을 그대로
import해 적중 판정 의미론이 런타임과 항상 일치하게 한다(로직 중복 금지).
"""
from __future__ import annotations

import bisect
import itertools
import math
import os
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf

_KST = ZoneInfo("Asia/Seoul")

# kospi_signal.judge_hit()을 그대로 재사용 — 백엔드 경로를 sys.path에 추가
_BACKEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend")
sys.path.insert(0, _BACKEND_DIR)
from services.market_indicators.kospi_signal import judge_hit  # noqa: E402

DRIVER_SYMBOLS = {
    "sp500": "^GSPC",
    "nasdaq": "^IXIC",
    "usdkrw": "USDKRW=X",
    "ewy": "EWY",
    "sox": "^SOX",
    "vix": "^VIX",
}
KOSPI_SYMBOL = "^KS11"
BASE3 = ("sp500", "nasdaq", "usdkrw")
NEGATIVE_DRIVERS = {"usdkrw", "vix"}  # 원화약세·VIX상승 = 비우호 → 음수 가중

SUBSETS: dict[str, tuple[str, ...]] = {
    "base3": BASE3,
    "base3+ewy": BASE3 + ("ewy",),
    "base3+sox": BASE3 + ("sox",),
    "base3+vix": BASE3 + ("vix",),
    "base3+ewy+sox": BASE3 + ("ewy", "sox"),
    "base3+ewy+vix": BASE3 + ("ewy", "vix"),
    "base3+sox+vix": BASE3 + ("sox", "vix"),
    "base3+all": BASE3 + ("ewy", "sox", "vix"),
    "ewy_only": ("ewy",),
    "ewy+usdkrw": ("ewy", "usdkrw"),
}

FIXED_BANDS = [0.3, 0.5, 0.75, 1.0]
ADAPTIVE_KS = [0.1, 0.2, 0.3, 0.5]

EVAL_DAYS = 365
BUFFER_DAYS = 90  # 20일 롤링 σ + 드라이버 2봉 정렬용 사전 여유(평가 구간엔 미포함)
COVERAGE_GATE = 0.30
STABILITY_GATE = 0.50
ADOPT_MARGIN = 0.05


def fetch_close_series(symbol: str, start: str, end: str) -> dict[str, float]:
    hist = yf.Ticker(symbol).history(start=start, end=end, interval="1d")
    if hist.empty:
        return {}
    out = {}
    for d, c in zip(hist.index, hist["Close"].values):
        c = float(c)
        if math.isfinite(c):
            out[str(d.date())] = c
    return out


def chg_before(dates_sorted: list[str], close_map: dict[str, float], d: str) -> float | None:
    """d 이전(< d) 최근 두 봉 간 pct change. 런타임 08:30 지식집합 재현."""
    idx = bisect.bisect_left(dates_sorted, d)
    if idx < 2:
        return None
    d1, d0 = dates_sorted[idx - 1], dates_sorted[idx - 2]
    c1, c0 = close_map[d1], close_map[d0]
    if not c0:
        return None
    pct = (c1 - c0) / c0 * 100
    return pct if math.isfinite(pct) else None


def weight_combos_for_subset(subset_keys: tuple[str, ...]) -> list[dict[str, float]]:
    """크기<=4: 드라이버별 {0.5,1,2} 풀그리드. 그 외: 등가중 + (신규 드라이버 1개씩
    2배 강조) 변형만 — 폭발 방지."""
    if len(subset_keys) <= 4:
        return [dict(zip(subset_keys, vals)) for vals in itertools.product((0.5, 1.0, 2.0), repeat=len(subset_keys))]
    combos = [{k: 1.0 for k in subset_keys}]
    for k in subset_keys:
        if k in BASE3:
            continue
        combos.append({d: (2.0 if d == k else 1.0) for d in subset_keys})
    return combos


def evaluate(eval_dates, driver_chg, kospi_actual, band_fn, subset_keys, weights):
    total = 0
    directional_hits: list[bool] = []
    neutral_total = 0
    neutral_hits = 0
    per_date: dict[str, tuple[str, bool]] = {}

    for d in eval_dates:
        band = band_fn(d)
        if band is None:
            continue
        chgs = []
        ok = True
        for key in subset_keys:
            c = driver_chg[key].get(d)
            if c is None:
                ok = False
                break
            chgs.append(c)
        if not ok:
            continue

        signed_sum = 0.0
        weight_sum = 0.0
        for key, c in zip(subset_keys, chgs):
            w = weights[key] * (-1.0 if key in NEGATIVE_DRIVERS else 1.0)
            signed_sum += w * c
            weight_sum += abs(w)
        if weight_sum == 0:
            continue
        composite = signed_sum / weight_sum
        if not math.isfinite(composite):
            continue

        if composite > band:
            signal = "bullish"
        elif composite < -band:
            signal = "bearish"
        else:
            signal = "neutral"

        actual = kospi_actual.get(d)
        if actual is None:
            continue
        hit = judge_hit(signal, actual, band)

        total += 1
        per_date[d] = (signal, hit)
        if signal in ("bullish", "bearish"):
            directional_hits.append(hit)
        else:
            neutral_total += 1
            if hit:
                neutral_hits += 1

    directional_n = len(directional_hits)
    hits = sum(1 for h in directional_hits if h)
    hit_rate = (hits / directional_n) if directional_n else None
    coverage = (directional_n / total) if total else 0.0
    return {
        "total": total, "directional_n": directional_n, "hits": hits,
        "hit_rate": hit_rate, "coverage": coverage,
        "neutral_total": neutral_total, "neutral_hits": neutral_hits,
        "per_date": per_date,
    }


def half_rates(per_date: dict[str, tuple[str, bool]], mid_date: str) -> tuple[float | None, float | None]:
    h1 = [hit for d, (sig, hit) in per_date.items() if d < mid_date and sig in ("bullish", "bearish")]
    h2 = [hit for d, (sig, hit) in per_date.items() if d >= mid_date and sig in ("bullish", "bearish")]
    r1 = (sum(h1) / len(h1)) if h1 else None
    r2 = (sum(h2) / len(h2)) if h2 else None
    return r1, r2


def fmt_weights(subset_keys, weights) -> str:
    parts = []
    for k in subset_keys:
        sign = "-" if k in NEGATIVE_DRIVERS else ""
        parts.append(f"{k}={sign}{weights[k]:g}")
    return ",".join(parts)


def fmt_pct(v) -> str:
    return f"{v*100:5.1f}%" if v is not None else "  n/a "


def fmt_band(row) -> str:
    if row["band_type"] == "fixed":
        return f"fixed {row['band_value']:.2f}"
    return f"adapt k={row['band_value']:.1f}"


def main():
    now = datetime.now(_KST)
    today = now.date()
    eval_start = today - timedelta(days=EVAL_DAYS)
    fetch_start = eval_start - timedelta(days=BUFFER_DAYS)
    fetch_end = today + timedelta(days=1)  # yfinance end는 배타적

    print(f"[kospi_signal_backtest] 실행: {now.isoformat()}")
    print(f"  fetch range : {fetch_start} ~ {today} (버퍼 {BUFFER_DAYS}일 + 평가 {EVAL_DAYS}일)")

    raw: dict[str, dict[str, float]] = {}
    for key, sym in {**DRIVER_SYMBOLS, "kospi": KOSPI_SYMBOL}.items():
        data = fetch_close_series(sym, fetch_start.isoformat(), fetch_end.isoformat())
        print(f"  {key:8s} {sym:10s} bars={len(data)}")
        raw[key] = data
        if not data:
            raise RuntimeError(f"{sym} 데이터 없음 — 백테스트 중단")

    kospi_close = raw["kospi"]
    kospi_dates = sorted(kospi_close)
    kospi_actual: dict[str, float] = {}
    for i in range(1, len(kospi_dates)):
        d, prev = kospi_dates[i], kospi_dates[i - 1]
        c0, c1 = kospi_close[prev], kospi_close[d]
        if c0:
            pct = (c1 - c0) / c0 * 100
            if math.isfinite(pct):
                kospi_actual[d] = pct

    returns_series = pd.Series(kospi_actual).sort_index()
    sigma20 = returns_series.rolling(20).std().shift(1)  # D 이전 20개 수익률만 사용
    sigma20_map = {d: (float(v) if pd.notna(v) and math.isfinite(v) else None) for d, v in sigma20.items()}

    eval_dates = [d for d in kospi_dates if d >= eval_start.isoformat() and d in kospi_actual]
    print(f"  eval window : {eval_dates[0]} ~ {eval_dates[-1]} ({len(eval_dates)} KR 거래일)")

    driver_dates = {key: sorted(raw[key]) for key in DRIVER_SYMBOLS}
    driver_chg: dict[str, dict[str, float | None]] = {key: {} for key in DRIVER_SYMBOLS}
    for key in DRIVER_SYMBOLS:
        dates_sorted = driver_dates[key]
        close_map = raw[key]
        for d in eval_dates:
            driver_chg[key][d] = chg_before(dates_sorted, close_map, d)

    mid_date = (eval_start + timedelta(days=182)).isoformat()

    band_configs = [("fixed", b) for b in FIXED_BANDS] + [("adaptive", k) for k in ADAPTIVE_KS]

    results = []
    for subset_name, subset_keys in SUBSETS.items():
        for weights in weight_combos_for_subset(subset_keys):
            for band_type, band_param in band_configs:
                if band_type == "fixed":
                    band_fn = lambda d, b=band_param: b
                else:
                    band_fn = lambda d, k=band_param: (
                        k * sigma20_map[d] if sigma20_map.get(d) is not None else None
                    )
                m = evaluate(eval_dates, driver_chg, kospi_actual, band_fn, subset_keys, weights)
                if m["hit_rate"] is None:
                    continue
                r1, r2 = half_rates(m["per_date"], mid_date)
                results.append({
                    "subset": subset_name, "keys": subset_keys, "weights": weights,
                    "band_type": band_type, "band_value": band_param,
                    "hit_rate": m["hit_rate"], "coverage": m["coverage"],
                    "directional_n": m["directional_n"], "hits": m["hits"],
                    "neutral_total": m["neutral_total"], "neutral_hits": m["neutral_hits"],
                    "half1": r1, "half2": r2, "driver_count": len(subset_keys),
                })

    print(f"\n  평가된 조합 수: {len(results)}")

    baseline = next(
        r for r in results
        if r["subset"] == "base3" and r["band_type"] == "fixed" and r["band_value"] == 0.5
        and all(abs(v - 1.0) < 1e-9 for v in r["weights"].values())
    )

    candidates = [r for r in results if r["coverage"] >= COVERAGE_GATE]
    candidates = [
        r for r in candidates
        if r["half1"] is not None and r["half1"] >= STABILITY_GATE
        and r["half2"] is not None and r["half2"] >= STABILITY_GATE
    ]
    candidates.sort(key=lambda r: (-r["hit_rate"], r["driver_count"], 0 if r["band_type"] == "fixed" else 1))

    winner = candidates[0] if candidates else None
    keep_current = winner is None or winner["hit_rate"] < baseline["hit_rate"] + ADOPT_MARGIN

    header = (
        f"{'구성':28s} {'가중치':38s} {'밴드':14s} "
        f"{'적중률':7s} {'커버리지':8s} {'전반':7s} {'후반':7s} {'판정N':6s} {'중립(적중)':10s}"
    )

    def row_str(r, tag=""):
        return (
            f"{tag}{r['subset']:26s} {fmt_weights(r['keys'], r['weights']):38s} {fmt_band(r):14s} "
            f"{fmt_pct(r['hit_rate'])} {fmt_pct(r['coverage'])} {fmt_pct(r['half1'])} {fmt_pct(r['half2'])} "
            f"{r['directional_n']:5d} {r['neutral_total']:3d}({r['neutral_hits']})"
        )

    lines = []
    lines.append("=" * len(header))
    lines.append(f"BASELINE (현행: base3 등가중, fixed 0.5 — 부호기준 재평가)")
    lines.append(header)
    lines.append(row_str(baseline, tag="[BASE] "))
    lines.append("-" * len(header))
    lines.append(f"TOP 10 (커버리지≥{COVERAGE_GATE:.0%}·전후반 적중률≥{STABILITY_GATE:.0%} 통과 조합 중 적중률 순, 후보 {len(candidates)}개)")
    lines.append(header)
    for i, r in enumerate(candidates[:10], 1):
        lines.append(row_str(r, tag=f"[{i:2d}]   "))
    lines.append("=" * len(header))
    lines.append("(참고: usdkrw/vix 가중치는 음수로 합성에 반영됨 — 표의 값은 크기, 부호는 고정)")

    table_text = "\n".join(lines)
    print()
    print(table_text)

    print()
    print("─" * 40)
    if keep_current:
        reason = "채택 후보 없음(모든 조합이 게이트 탈락)" if winner is None else (
            f"1위({winner['subset']}, {fmt_band(winner)})의 적중률 {winner['hit_rate']*100:.1f}%가 "
            f"baseline {baseline['hit_rate']*100:.1f}%+{ADOPT_MARGIN*100:.0f}%p 기준을 못 넘음"
        )
        print(f"결론: KEEP CURRENT (현행 가중치/밴드/드라이버 유지) — {reason}")
    else:
        print(
            f"결론: ADOPT — {winner['subset']} / {fmt_weights(winner['keys'], winner['weights'])} / "
            f"{fmt_band(winner)} (적중률 {winner['hit_rate']*100:.1f}%, baseline 대비 "
            f"+{(winner['hit_rate']-baseline['hit_rate'])*100:.1f}%p)"
        )

    return {
        "keep_current": keep_current,
        "baseline": baseline,
        "winner": winner,
        "candidates_n": len(candidates),
        "results_n": len(results),
        "table_text": table_text,
    }


if __name__ == "__main__":
    main()

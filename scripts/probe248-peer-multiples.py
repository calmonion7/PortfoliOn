"""task#248 라이브 프로브 — 피어 멀티플 이상치 가드를 yfinance/Naver **실값**으로 대조.

fixture는 밴드 로직만 고정한다. 외부 소스가 *실제로* 어떤 숫자를 주는지는 별개 축이라
(fixture-pass-live-fail, 회고 #111·#117) 005930의 실 경쟁사로 라이브 호출해 원값→가드후값을
나란히 찍는다. 판정은 **리터럴이 아니라 불변식**으로 쓴다 — 발행 판마다 값이 달라지므로
(TSM PBR 81.87↔86.57 관측) `pbr == 81.87`로 못박으면 정당한 변화에 거짓 실패한다(회고 #228).

`probe239-guru-activity.py`와 같이 **로컬 backend/.venv로 실행**한다(prod 컨테이너·DB 무접촉,
읽기전용). 경쟁사 목록은 DB를 읽지 않고 fg-ask가 발행물에서 직독한 실측 목록을 쓴다.

실행: backend/.venv/bin/python scripts/probe248-peer-multiples.py
"""
import sys
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from services import market as mkt  # noqa: E402
from services import report_generator as rg  # noqa: E402
from services.report_generator import (  # noqa: E402
    _PEER_MULTIPLE_BAND as BAND,
    _PEER_MULTIPLE_METRICS as METRICS,
)

SELF = "005930"
# fg-ask가 발행물 `data.competitors`에서 직독한 005930 실 경쟁사(2026-07-29 판).
PEERS = [("000660", "KR", "KS"), ("TSM", "US", ""), ("MU", "US", ""), ("INTC", "US", "")]
# 관측된 오값(단위 혼선). 리터럴 값이 아니라 "밴드 밖"이라는 불변식으로 단언한다.
EXPECT_DROP = {("TSM", "pbr"), ("TSM", "psr")}
EXPECT_KEEP_TSM = ("per", "ev_ebitda")


def fetch_rows():
    """조립부(`generate_report`)와 **같은 순서로** 최종 값을 만든다.
    psr은 KR 폴백(`_kr_psr`)까지 끝난 최종 값이어야 한다 — 중간값에 걸면 폴백이 가드를 우회한다.
    """
    rows = [dict({"ticker": SELF, "is_self": True}, **{m: None for m in METRICS})]
    for ticker, market, exchange in PEERS:
        try:
            q = mkt.get_quote(ticker, market, exchange, regular=True) or {}
        except Exception as e:
            print(f"  ! quote 실패 {ticker}: {e}")
            q = {}
        try:
            v = rg._comp_valuation(ticker, market) or {}
        except Exception as e:
            print(f"  ! valuation 실패 {ticker}: {e}")
            v = {}
        psr = v.get("psr")
        if psr is None:
            psr = rg._kr_psr(q.get("market_cap"), v.get("_ttm_revenue"))
        rows.append({
            "ticker": ticker, "is_self": False,
            "per": v.get("per"), "pbr": v.get("pbr"),
            "psr": psr, "ev_ebitda": v.get("ev_ebitda"),
        })
    return rows


def judgments(rows):
    """가드와 동일한 leave-one-out 판정을 재현해 **항별 실측치**를 남긴다.
    OR/분기로 통과한 단언은 어느 항으로 통과했는지 출력하지 않으면 무엇을 봤는지 알 수 없다
    (회고 #243 → CLAUDE.md ⑧ⓕ). 그래서 배수·중앙값·생략사유를 전부 찍는다.
    """
    peers = [r for r in rows if not r["is_self"]]
    out = []
    for metric in METRICS:
        vals = [(r, rg._fin_num(r.get(metric))) for r in peers]
        for row, value in vals:
            others = [v for o, v in vals if o is not row and v is not None]
            if value is None:
                out.append((row["ticker"], metric, None, None, None, "생략(값 없음)"))
                continue
            if len(others) < 2:
                out.append((row["ticker"], metric, value, None, None, f"생략(표본 {len(others)}<2)"))
                continue
            median = rg._peer_median(others)
            if median <= 0:
                out.append((row["ticker"], metric, value, median, None, "생략(중앙값<=0)"))
                continue
            ratio = value / median
            outside = not (1 / BAND <= ratio <= BAND)
            out.append((row["ticker"], metric, value, median, ratio,
                        "밴드 밖 → 결측" if outside else "밴드 안 → 보존"))
    return out


def fmt(v):
    return "—" if v is None else (f"{v:.4g}" if isinstance(v, float) else str(v))


def main():
    print(f"=== task#248 피어 멀티플 가드 라이브 프로브 (밴드 [1/{BAND}, {BAND}]) ===\n")
    print(f"라이브 조회: {SELF} + peers {[p[0] for p in PEERS]}")
    before = fetch_rows()
    after = rg._guard_peer_multiples(deepcopy(before))
    peers_before = {r["ticker"]: r for r in before if not r["is_self"]}
    peers_after = {r["ticker"]: r for r in after if not r["is_self"]}

    print(f"\n--- 원값 (가드 전) ---")
    print(f"{'ticker':<8}" + "".join(f"{m:>13}" for m in METRICS))
    for t, r in peers_before.items():
        print(f"{t:<8}" + "".join(f"{fmt(r[m]):>13}" for m in METRICS))

    # ⑥ 측정 실패 판정 — 값이 전부 비면 PASS가 아니라 "못 쟀다"로 보고한다(CLAUDE.md ⑧ⓑ·ⓔ).
    observed = sum(1 for r in peers_before.values() for m in METRICS if rg._fin_num(r[m]) is not None)
    total_cells = len(peers_before) * len(METRICS)
    print(f"\n관측된 값: {observed}/{total_cells} 셀")
    if observed == 0:
        print("\n❌ 측정 실패 — 외부 소스가 값을 전혀 주지 않았다(yfinance/Naver 일시 실패).")
        print("   0건은 성공이 아니다. 재실행할 것.")
        return 1

    print(f"\n--- 판정 (leave-one-out, 자사·None 제외) ---")
    judged = skipped = dropped = 0
    for ticker, metric, value, median, ratio, verdict in judgments(before):
        ratio_s = f" ratio={ratio:.3f}" if ratio is not None else ""
        median_s = f" median={fmt(median)}" if median is not None else ""
        print(f"  {ticker:<7} {metric:<10} value={fmt(value):<10}{median_s}{ratio_s}  {verdict}")
        if verdict.startswith("생략"):
            skipped += 1
        else:
            judged += 1
            if "결측" in verdict:
                dropped += 1
    # ④ 커버리지 — 실패만 기록하는 프로브의 통과는 아무것도 안 본 것과 구별되지 않는다(회고 #238 ⓐ).
    print(f"\n검사 커버리지: 판정 {judged}건 · 생략 {skipped}건 · 결측 처리 {dropped}건"
          f" (대상 {len(peers_before)} peer × {len(METRICS)} 지표 = {total_cells})")

    print(f"\n--- 가드 후 ---")
    print(f"{'ticker':<8}" + "".join(f"{m:>13}" for m in METRICS))
    for t, r in peers_after.items():
        print(f"{t:<8}" + "".join(f"{fmt(r[m]):>13}" for m in METRICS))

    print(f"\n--- 단언 ---")
    fails = []

    def check(ok, label):
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
        if not ok:
            fails.append(label)

    # ① 오값이 실제로 밴드 밖인지 — 리터럴이 아니라 불변식으로
    for ticker, metric in sorted(EXPECT_DROP):
        value = rg._fin_num(peers_before[ticker][metric])
        others = [rg._fin_num(r[metric]) for t, r in peers_before.items()
                  if t != ticker and rg._fin_num(r[metric]) is not None]
        if value is None or len(others) < 2:
            check(False, f"① {ticker} {metric} 원값/표본 부족 — 측정 실패(value={fmt(value)}, 표본 {len(others)})")
            continue
        median = rg._peer_median(others)
        ratio = value / median
        check(not (1 / BAND <= ratio <= BAND),
              f"① {ticker} {metric} 원값이 밴드 밖 (value={fmt(value)} median={fmt(median)} ratio={ratio:.3f})")
        # ② 가드 후 결측
        check(peers_after[ticker][metric] is None,
              f"② {ticker} {metric} 가드 후 결측 (={fmt(peers_after[ticker][metric])})")

    # ② 밴드 안 지표는 보존
    for metric in EXPECT_KEEP_TSM:
        b, a = peers_before["TSM"][metric], peers_after["TSM"][metric]
        check(a == b, f"② TSM {metric} 보존 (before={fmt(b)} after={fmt(a)})")

    # ③ 거짓양성 0 — 나머지 peer의 어떤 지표도 바뀌지 않았다
    for ticker in peers_before:
        if ticker == "TSM":
            continue
        changed = [m for m in METRICS if peers_before[ticker][m] != peers_after[ticker][m]]
        check(not changed, f"③ {ticker} 무변경 (거짓양성 0, 바뀐 지표={changed or '없음'})")

    print()
    if fails:
        print(f"❌ {len(fails)}건 FAIL")
        for f in fails:
            print(f"   - {f}")
        return 1
    print(f"✅ ALL PASS — 판정 {judged}건 중 결측 {dropped}건, 거짓양성 0")
    return 0


if __name__ == "__main__":
    sys.exit(main())

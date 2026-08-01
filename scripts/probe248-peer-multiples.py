"""task#248/#249 라이브 프로브 — 피어 멀티플 이상치 가드를 yfinance/Naver **실값**으로 대조.

fixture는 밴드 로직만 고정한다. 외부 소스가 *실제로* 어떤 숫자를 주는지는 별개 축이라
(fixture-pass-live-fail, 회고 #111·#117) 005930의 실 경쟁사로 라이브 호출해 원값→가드후값을
나란히 찍는다. 판정은 **리터럴이 아니라 불변식**으로 쓴다 — 발행 판마다 값이 달라지므로
(TSM PBR 81.87↔84.11↔86.57 관측) `pbr == 84.11`로 못박으면 정당한 변화에 거짓 실패한다(#228).

task#249에서 판정축을 **기준 표본 = 값이 있는 peer 전체 + 자사**(표본 <3이면 생략)로 교체했다.
그래서 이 프로브는 자사 값도 라이브로 받아 표본에 넣고, **가드 후 유효 peer로 산출되는
Peer 할인/할증 칩 값까지 출력·단언**한다 — #248 프로브는 "오값이 지워졌는가"(대리지표)만 보고
"화면 비교가 살아있는가"(목표)를 안 봐서 정상 peer가 결측되고 PBR 칩이 통째 사라진 것을
놓쳤다(회고 #247 ② — 완료기준을 대리지표가 아니라 목표 자체로).

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

SELF = ("005930", "KR", "KS")
# fg-ask가 발행물 `data.competitors`에서 직독한 005930 실 경쟁사(2026-07-30 현재 구성 —
# INTC가 빠져 3개. 이 얇아짐이 task#249 결함의 방아쇠였다).
PEERS = [("000660", "KR", "KS"), ("TSM", "US", ""), ("MU", "US", "")]
# 관측된 오값(단위 혼선). 리터럴 값이 아니라 "밴드 밖"이라는 불변식으로 단언한다.
EXPECT_DROP = {("TSM", "pbr"), ("TSM", "psr")}
EXPECT_KEEP_TSM = ("per", "ev_ebitda")
# task#249의 목적 — 이 정상 peer가 보존되어야 PBR 칩이 되살아난다. "거짓양성 0"에 묻지 않고
# 단독 항으로 세운다(대리지표가 아니라 목표 자체).
EXPECT_PRESERVE = ("000660", "pbr")
# 칩(Peer 할인/할증)은 유효 peer가 2개 이상일 때만 표시된다 — computePeerPremiums의 관례.
# 가드의 표본 임계(<3, 자사 포함)와는 **세는 대상이 다른 별개 규칙**이다(혼동 금지).
CHIP_MIN_PEERS = 2


def _row(ticker, market, exchange, is_self):
    """조립부(`generate_report`)와 **같은 순서로** 최종 값을 만든다.
    psr은 KR 폴백(`_kr_psr`)까지 끝난 최종 값이어야 한다 — 중간값에 걸면 폴백이 가드를 우회한다.
    """
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
    return {
        "ticker": ticker, "is_self": is_self,
        "per": v.get("per"), "pbr": v.get("pbr"),
        "psr": psr, "ev_ebitda": v.get("ev_ebitda"),
    }


def fetch_rows():
    """자사 + peer 전체. 자사도 라이브로 받는다 — task#249 판정축에서 자사는 기준 표본의
    일부이므로 `None` 자리표시자로 두면 표본이 1개 얇아져 판정이 달라진다."""
    return [_row(*SELF, True)] + [_row(t, m, e, False) for t, m, e in PEERS]


def judgments(rows):
    """가드와 동일한 판정을 재현해 **항별 실측치**를 남긴다(표본·중앙값·배수·생략사유).
    OR/분기로 통과한 단언은 어느 항으로 통과했는지 출력하지 않으면 무엇을 봤는지 알 수 없다
    (회고 #243 → CLAUDE.md ⑧ⓕ).
    """
    peers = [r for r in rows if not r["is_self"]]
    out = []
    for metric in METRICS:
        sample = [v for v in (rg._fin_num(r.get(metric)) for r in rows) if v is not None]
        median = rg._peer_median(sample) if sample else None
        for row in peers:
            value = rg._fin_num(row.get(metric))
            if value is None:
                out.append((row["ticker"], metric, None, len(sample), None, None, "생략(값 없음)"))
                continue
            if len(sample) < 3:
                out.append((row["ticker"], metric, value, len(sample), None, None,
                            f"생략(표본 {len(sample)}<3)"))
                continue
            if median <= 0:
                out.append((row["ticker"], metric, value, len(sample), median, None, "생략(중앙값<=0)"))
                continue
            ratio = value / median
            outside = not (1 / BAND <= ratio <= BAND)
            out.append((row["ticker"], metric, value, len(sample), median, ratio,
                        "밴드 밖 → 결측" if outside else "밴드 안 → 보존"))
    return out


def chip_pct(rows, metric):
    """가드 후 값으로 프론트 `computePeerPremiums`를 재현 — (자사/peer중앙값 − 1)×100.
    유효 peer가 `CHIP_MIN_PEERS` 미만이면 칩이 생략된다(None). 자사는 peer 중앙값에 안 들어간다.
    """
    self_val = next((rg._fin_num(r.get(metric)) for r in rows if r["is_self"]), None)
    peer_vals = [v for v in (rg._fin_num(r.get(metric)) for r in rows if not r["is_self"])
                 if v is not None]
    if self_val is None or len(peer_vals) < CHIP_MIN_PEERS:
        return None, len(peer_vals)
    median = rg._peer_median(peer_vals)
    if median <= 0:
        return None, len(peer_vals)
    return (self_val / median - 1) * 100, len(peer_vals)


def fmt(v):
    return "—" if v is None else (f"{v:.4g}" if isinstance(v, float) else str(v))


def main():
    print(f"=== task#249 피어 멀티플 가드 라이브 프로브 (밴드 [1/{BAND}, {BAND}], 표본<3 생략) ===\n")
    print(f"라이브 조회: 자사 {SELF[0]} + peers {[p[0] for p in PEERS]}")
    before = fetch_rows()
    after = rg._guard_peer_multiples(deepcopy(before))
    self_before = next(r for r in before if r["is_self"])
    peers_before = {r["ticker"]: r for r in before if not r["is_self"]}
    peers_after = {r["ticker"]: r for r in after if not r["is_self"]}

    print(f"\n--- 원값 (가드 전) ---")
    print(f"{'ticker':<8}" + "".join(f"{m:>13}" for m in METRICS))
    print(f"{'(자사)':<8}" + "".join(f"{fmt(self_before[m]):>13}" for m in METRICS))
    for t, r in peers_before.items():
        print(f"{t:<8}" + "".join(f"{fmt(r[m]):>13}" for m in METRICS))

    # 측정 실패 판정 — 값이 전부 비면 PASS가 아니라 "못 쟀다"로 보고한다(CLAUDE.md ⑧ⓑ·ⓔ).
    observed = sum(1 for r in peers_before.values() for m in METRICS if rg._fin_num(r[m]) is not None)
    total_cells = len(peers_before) * len(METRICS)
    self_observed = sum(1 for m in METRICS if rg._fin_num(self_before[m]) is not None)
    print(f"\n관측된 값: peer {observed}/{total_cells} 셀 · 자사 {self_observed}/{len(METRICS)} 셀")
    if observed == 0:
        print("\n❌ 측정 실패 — 외부 소스가 peer 값을 전혀 주지 않았다(yfinance/Naver 일시 실패).")
        print("   0건은 성공이 아니다. 재실행할 것.")
        return 1
    # ⑦ 자사 값을 못 받으면 그 지표의 표본이 1개 얇아진다 — 판정이 달라지므로 드러낸다.
    missing_self = [m for m in METRICS if rg._fin_num(self_before[m]) is None]
    if missing_self:
        print(f"   ⚠️ 자사 값 결측 {missing_self} — 그 지표의 기준 표본이 1개 얇아진 상태로 판정된다.")

    print(f"\n--- 판정 (기준 표본 = 값 있는 peer 전체 + 자사, 판정 대상은 peer만) ---")
    judged = skipped = dropped = 0
    per_metric = {m: {"judged": 0, "skipped": 0, "dropped": 0} for m in METRICS}
    for ticker, metric, value, n_sample, median, ratio, verdict in judgments(before):
        ratio_s = f" ratio={ratio:.3f}" if ratio is not None else ""
        median_s = f" median={fmt(median)}" if median is not None else ""
        print(f"  {ticker:<7} {metric:<10} value={fmt(value):<10} n={n_sample}{median_s}{ratio_s}  {verdict}")
        if verdict.startswith("생략"):
            skipped += 1
            per_metric[metric]["skipped"] += 1
        else:
            judged += 1
            per_metric[metric]["judged"] += 1
            if "결측" in verdict:
                dropped += 1
                per_metric[metric]["dropped"] += 1
    # 커버리지 — 실패만 기록하는 프로브의 통과는 아무것도 안 본 것과 구별되지 않는다(회고 #238 ⓐ).
    print(f"\n검사 커버리지: 판정 {judged}건 · 생략 {skipped}건 · 결측 처리 {dropped}건"
          f" (대상 {len(peers_before)} peer × {len(METRICS)} 지표 = {total_cells})")
    for m in METRICS:
        c = per_metric[m]
        print(f"  - {m:<10} 판정 {c['judged']} · 생략 {c['skipped']} · 결측 {c['dropped']}")

    print(f"\n--- 가드 후 ---")
    print(f"{'ticker':<8}" + "".join(f"{m:>13}" for m in METRICS))
    print(f"{'(자사)':<8}" + "".join(f"{fmt(self_before[m]):>13}" for m in METRICS))
    for t, r in peers_after.items():
        print(f"{t:<8}" + "".join(f"{fmt(r[m]):>13}" for m in METRICS))

    # ④ 목표 자체 — 가드 후 유효 peer 수와 칩 값. 오값을 지웠는지가 아니라 화면 비교가
    #    살아있는지를 본다(#248 프로브가 놓친 축).
    print(f"\n--- 칩 (Peer 할인/할증, computePeerPremiums 재현 · 유효 peer >= {CHIP_MIN_PEERS}) ---")
    chips = {}
    for m in METRICS:
        pct_before, n_before = chip_pct(before, m)
        pct_after, n_after = chip_pct(after, m)
        chips[m] = (pct_after, n_after)
        b = "생략" if pct_before is None else f"{pct_before:+.1f}%"
        a = "생략" if pct_after is None else f"{pct_after:+.1f}%"
        print(f"  {m:<10} 가드전 {b:>9} (유효 {n_before})  →  가드후 {a:>9} (유효 {n_after})")

    print(f"\n--- 단언 ---")
    fails = []

    def check(ok, label):
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
        if not ok:
            fails.append(label)

    # ① 오값이 실제로 밴드 밖인지 — 리터럴이 아니라 불변식으로
    for ticker, metric in sorted(EXPECT_DROP):
        value = rg._fin_num(peers_before[ticker][metric])
        sample = [v for v in (rg._fin_num(r[metric]) for r in before) if v is not None]
        if value is None or len(sample) < 3:
            check(False, f"① {ticker} {metric} 원값/표본 부족 — 측정 실패"
                         f"(value={fmt(value)}, 표본 {len(sample)})")
            continue
        median = rg._peer_median(sample)
        ratio = value / median
        check(not (1 / BAND <= ratio <= BAND),
              f"① {ticker} {metric} 원값이 밴드 밖 (value={fmt(value)} median={fmt(median)}"
              f" ratio={ratio:.3f} n={len(sample)})")
        # ② 가드 후 결측
        check(peers_after[ticker][metric] is None,
              f"② {ticker} {metric} 가드 후 결측 (={fmt(peers_after[ticker][metric])})")

    # ② 밴드 안 지표는 보존
    # 원값이 결측이면 before/after가 둘 다 None이라 `a == b`가 자명 통과한다 —
    # 측정 실패를 "보존됨" PASS로 위장하지 않도록 ③과 같은 sentinel 가드를 둔다.
    for metric in EXPECT_KEEP_TSM:
        b, a = peers_before["TSM"][metric], peers_after["TSM"][metric]
        if rg._fin_num(b) is None:
            check(False, f"② TSM {metric} 원값 결측 — 보존 단언을 측정 못 했다(외부 소스 실패)")
            continue
        check(a == b, f"② TSM {metric} 보존 (before={fmt(b)} after={fmt(a)})")

    # ③ **이번 작업의 목적** — 정상 peer가 보존된다(구 판정축은 여기서 결측시켰다)
    pt, pm = EXPECT_PRESERVE
    b, a = peers_before[pt][pm], peers_after[pt][pm]
    if rg._fin_num(b) is None:
        check(False, f"③ {pt} {pm} 원값 결측 — 목적 항을 측정 못 했다(외부 소스 실패)")
    else:
        check(a == b, f"③ {pt} {pm} 보존 — task#249의 목적 (before={fmt(b)} after={fmt(a)})")

    # ④ 거짓양성 0 — 오값 외 어떤 지표도 바뀌지 않았다
    for ticker in peers_before:
        changed = [m for m in METRICS
                   if peers_before[ticker][m] != peers_after[ticker][m]
                   and (ticker, m) not in EXPECT_DROP]
        check(not changed, f"④ {ticker} 예상 외 변경 없음 (거짓양성 0, 바뀐 지표={changed or '없음'})")

    # ⑤ 칩이 살아있는가 — 결측 지표(pbr)의 칩이 생략되지 않아야 한다
    for metric in sorted({m for _, m in EXPECT_DROP}):
        pct, n = chips[metric]
        check(pct is not None,
              f"⑤ {metric} 칩 표시됨 (유효 peer {n} >= {CHIP_MIN_PEERS}, 값="
              f"{'생략' if pct is None else f'{pct:+.1f}%'})")

    print()
    if fails:
        print(f"❌ {len(fails)}건 FAIL")
        for f in fails:
            print(f"   - {f}")
        return 1
    print(f"✅ ALL PASS — 판정 {judged}건 중 결측 {dropped}건, 거짓양성 0, 칩 유지")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""task#239 로컬 라이브 전수 프로브 — dataroma 분기 활동 수집 검증.

로컬 backend/.venv 로 dataroma를 직접 호출한다(prod 컨테이너·DB 무접촉).
fixture는 라벨/구조 불일치를 못 잡으므로(회고 #111·#117 fixture-pass-live-fail) 83명 전수로
실데이터를 훑는다. 판정은 **리터럴이 아니라 불변식**으로 쓴다 — 매니저가 13F를 신고하면
분기 분포·행수는 자연히 변하므로, 리터럴로 못박으면 정당한 변화에 거짓 실패한다(회고 #228).

실행: backend/.venv/bin/python scripts/probe239-guru-activity.py
"""
import re
import sys
import time
from collections import Counter
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from services.guru_scraper import (  # noqa: E402
    scrape_manager_ids,
    scrape_holdings,
    scrape_activity,
    _enrich_activity,
)

KINDS = {"add", "reduce", "buy", "sold_out"}
SELL_KINDS = {"reduce", "sold_out"}
PERIOD_RE = re.compile(r"^Q[1-4] \d{4}$")
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SAMPLE_N = 5          # A·B 교차대조를 정밀히 볼 표본 수(전수는 아래 집계로 본다)

results = []
def check(ok, tag, msg):
    results.append((ok, tag, msg))
    if not ok:
        print(f"  ✗ {tag}: {msg}")


managers = scrape_manager_ids()
print(f"매니저 {len(managers)}명 — holdings + activity 2요청씩 훑습니다\n")
check(len(managers) > 0, "managers", f"매니저 목록 {len(managers)}명")

periods = Counter()
kind_counts = Counter()
truncated = []
no_activity_rows = []
sold_out_hist = Counter()
act_row_totals = 0
mismatch_kind = []
missing_period = []
direction_violations = []
stale_quarter = []
max_rows = ("", 0)

for idx, m in enumerate(managers):
    mid = m["id"]
    try:
        details = scrape_holdings(mid)
        act = scrape_activity(mid)
    except Exception as e:                                  # noqa: BLE001
        check(False, "fetch", f"{mid} 수집 실패: {e}")
        continue

    # ── S2: 분기 표기 ────────────────────────────────────────────
    p, pd = details.get("period"), details.get("portfolio_date")
    if not (p and PERIOD_RE.match(p)):
        missing_period.append((mid, p))
    if not (pd and ISO_RE.match(pd)):
        missing_period.append((mid, f"date={pd}"))
    if p:
        periods[p] += 1
    # ⚠️ "분기가 항상 일치한다"는 리터럴 단언은 라이브가 반증했다(aq: 보유 Q2 2026 / 활동
    #    Q4 2025 — 활동 페이지는 변동 있던 분기만 나열한다). 불변식은 "불일치하면 보강을
    #    생략한다"이고, 아래 S4 블록에서 그걸 단언한다.
    aligned = bool(p and act["period"] and p == act["period"])
    if not aligned:
        stale_quarter.append((mid, p, act["period"]))

    # ── S3: 활동 행 ──────────────────────────────────────────────
    rows = act["rows"]
    act_row_totals += len(rows)
    if len(rows) > max_rows[1]:
        max_rows = (mid, len(rows))
    if not rows:
        no_activity_rows.append(mid)
    for r in rows:
        kind_counts[r["kind"]] += 1
        if r["kind"] not in KINDS:
            check(False, "kind", f"{mid}/{r['ticker']}: 미지의 kind {r['kind']!r}")
        # 부호 뒤집힘 검사 — td class(sell)와 kind 방향이 어긋나면 감소가 증가로 저장된다
        if r["direction"] == "sell" and r["kind"] not in SELL_KINDS:
            direction_violations.append((mid, r["ticker"], r["kind"], r["direction"]))
        if r["direction"] == "buy" and r["kind"] in SELL_KINDS:
            direction_violations.append((mid, r["ticker"], r["kind"], r["direction"]))
    if act["truncated"]:
        truncated.append((mid, len(rows)))

    # ── S4: 합성 ─────────────────────────────────────────────────
    with patch("services.guru_scraper.scrape_activity", return_value=act):
        sold_out = _enrich_activity(mid, details)
    sold_out_hist[len(sold_out)] += 1
    sells = [r for r in act["rows"] if r["kind"] == "sold_out"]
    if aligned:
        if len(sold_out) != len(sells):
            check(False, "sold_out", f"{mid}: sold_out {len(sold_out)} != Sell 행 {len(sells)}")
    else:
        # 분기가 어긋나면 오래된 매도가 새어나오면 안 되고 비중 보강도 없어야 한다
        if sold_out:
            check(False, "stale-guard", f"{mid}: 분기 불일치인데 sold_out {len(sold_out)}건 누출")
        leaked = [h["ticker"] for h in details["holdings"]
                  if (h.get("activity") or {}).get("port_pct") is not None]
        if leaked:
            check(False, "stale-guard", f"{mid}: 분기 불일치인데 port_pct 누출 {leaked[:4]}")
        time.sleep(0.3)
        continue        # 아래 조인 대조는 정합한 표본에서만 의미가 있다

    # A(holdings)와 B(activity)의 kind 일치 — A가 정본이므로 어긋나면 조인 전제가 깨진다
    b_by_ticker = {r["ticker"]: r for r in act["rows"] if r["kind"] != "sold_out"}
    for h in details["holdings"]:
        a_kind = (h.get("activity") or {}).get("kind")
        b = b_by_ticker.get(h["ticker"])
        if a_kind and b and a_kind != b["kind"]:
            mismatch_kind.append((mid, h["ticker"], a_kind, b["kind"]))
        # port_pct 보강이 실제로 얹혔는지(B에 해당 행이 있고 값이 있을 때)
        if a_kind and b and b.get("port_pct") is not None:
            if h["activity"].get("port_pct") != b["port_pct"]:
                check(False, "join", f"{mid}/{h['ticker']}: port_pct 미반영")

    # top10 두 계층 정합
    for t in details["top10"]:
        h = next((x for x in details["holdings"] if x["ticker"] == t["ticker"]), None)
        if h and (h.get("activity") or {}).get("port_pct") is not None:
            if (t.get("activity") or {}).get("port_pct") != h["activity"]["port_pct"]:
                check(False, "top10-join", f"{mid}/{t['ticker']}: top10 port_pct 불일치")

    if idx < SAMPLE_N:
        acts = [h for h in details["holdings"] if h.get("activity")]
        print(f"  [{mid}] {p} · 보유 {details['num_stocks']} · 활동 {len(acts)} · "
              f"활동행 {len(rows)} · 전량매도 {len(sold_out)}"
              + (f" · 절단" if act["truncated"] else ""))
        for h in acts[:3]:
            print(f"       {h['ticker']:6s} {h['weight_pct']:6.2f}%  {h['activity']}")
    time.sleep(0.3)

# ── 불변식 판정 ──────────────────────────────────────────────────
print()
check(not missing_period, "period", f"분기/날짜 미파싱 {len(missing_period)}건: {missing_period[:6]}")
check(not no_activity_rows, "activity-rows", f"활동 0행 매니저 {len(no_activity_rows)}명: {no_activity_rows[:6]}")
check(set(kind_counts) <= KINDS, "kind-set", f"kind 집합 {set(kind_counts)}")
check(not direction_violations, "direction", f"부호 방향 뒤집힘 {len(direction_violations)}건: {direction_violations[:6]}")
check(not mismatch_kind, "kind-xcheck", f"A·B kind 불일치 {len(mismatch_kind)}건: {mismatch_kind[:6]}")
# 절단 매니저는 L 추적 뒤에도 상한에 닿은 경우 — 100행을 넘겼는지(추적이 실제로 동작했는지) 본다
for mid, n in truncated:
    check(n > 100, "pagination", f"{mid}: 절단 플래그인데 {n}행(≤100이면 L 추적이 안 됐다)")
# L 추적이 라이브에서 실제로 동작했는지 — 100행 페이지를 넘긴 표본이 있어야 그 경로가 밟힌다
check(max_rows[1] > 100, "pagination-exercised",
      f"100행을 넘긴 매니저가 없어 L 추적 경로가 검증되지 않았다(최대 {max_rows})")

print("\n── 집계 ──")
print(f"분기 분포(holdings): {dict(periods)}")
print(f"활동 kind: {dict(kind_counts)}  (합 {act_row_totals}행)")
print(f"전량매도 건수별 매니저수: {dict(sorted(sold_out_hist.items()))}")
print(f"절단(상한 도달) 매니저: {truncated or '없음'}")
print(f"활동행 최대: {max_rows[0]} {max_rows[1]}행 (>100 = L 추적 동작)")
print(f"분기 불일치(보강 생략, 정상 동작): {stale_quarter or '없음'}")

fails = [r for r in results if not r[0]]
print(f"\n{'ALL PASS' if not fails else 'FAIL'} — 단언 {len(results)}건, 실패 {len(fails)}건")
sys.exit(1 if fails else 0)

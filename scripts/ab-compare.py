#!/usr/bin/env python3
"""A/B 산출물 → 사람이 나란히 볼 수 있는 비교표 (task#350 DoD 8·9).

자동 축은 「어느 판이 나은가」를 판정하지 않는다 — 그건 사용자의 몫이다. 여기서 하는 일은
**판정할 수 있는 형태로 놓는 것**과, 자동으로 잴 수 있는 것(스키마·출처·수치·분량·변경 건수)을
같은 화면에 두는 것이다.

시점 간격을 반드시 싣는다 — opus 기준선은 표본에 따라 0~33일 전 판이라, 간격을 감추면
그 사이의 주가·실적 변동이 「무료 모델이 틀렸다」로 오독된다.
"""
import json
import sys
from datetime import datetime
from pathlib import Path

RUN_DATE = "2026-09-15"
# 이 간격을 넘으면 수치 대조를 「대조 불가」로 표기한다. 근거: 분기 실적·컨센서스가
# 갱신되는 주기보다 짧게 잡아야 시점 차이가 품질 차이로 새지 않는다.
SKEW_UNCOMPARABLE_DAYS = 7


def _skew(base, run=RUN_DATE):
    try:
        a = datetime.fromisoformat(str(base)[:10]).date()
        b = datetime.fromisoformat(str(run)[:10]).date()
        return (b - a).days
    except Exception:
        return None


def _load(p):
    try:
        return json.loads(Path(p).read_text())
    except Exception:
        return None


def build(lane, sample, outroot="out"):
    d = Path(outroot) / lane / sample
    arms = {}
    for arm in ("opus", "muse", "h1"):
        arms[arm] = _load(d / f"{arm}.json") or _load(d / f"{arm}.error.json")

    opus = arms.get("opus") or {}
    skew = _skew(opus.get("baseline_date", ""))
    comparable = skew is not None and skew <= SKEW_UNCOMPARABLE_DAYS

    L = []
    L.append(f"# {lane} / {sample} — 3팔 비교\n")
    L.append(f"- opus 기준선 생성일: `{str(opus.get('baseline_date'))[:10]}` "
             f"· 실행일 `{RUN_DATE}` · **간격 {skew}일**")
    L.append(f"- 수치 대조: {'**가능**' if comparable else f'**대조 불가** (간격 {skew}일 > {SKEW_UNCOMPARABLE_DAYS}일 — '
             '그 사이 주가·실적 변동이 모델 차이로 오독된다)'}")
    L.append("")
    L.append("| | opus (기존 발행물) | muse (무료) | H1 (muse→opus 검수) |")
    L.append("|---|---|---|---|")

    def cell(a, fn):
        if not a or a.get("error"):
            return f"— ({(a or {}).get('error','없음')[:28]})"
        try:
            v = fn(a)
            return "—" if v is None else str(v)
        except Exception:
            return "—"

    def body(a):
        return (a or {}).get("body") or {}

    rows = [
        ("세션 비용", lambda a: "0 (수확)" if a.get("fired") is False else f"{a.get('elapsed_sec','?')}초"),
        ("rating", lambda a: body(a).get("rating")),
        ("FV 밴드", lambda a: f"{body(a).get('fair_value_low')}~{body(a).get('fair_value_high')}"),
        ("포인트 수", lambda a: len(body(a).get("points") or []) or None),
        ("본문 분량(자)", lambda a: len(json.dumps(body(a), ensure_ascii=False))),
        ("H1 변경 건수", lambda a: a.get("changes_count")),
    ]
    for label, fn in rows:
        L.append(f"| **{label}** | {cell(arms['opus'], fn)} | {cell(arms['muse'], fn)} | {cell(arms['h1'], fn)} |")

    L.append("")
    for arm in ("opus", "muse", "h1"):
        a = arms[arm]
        L.append(f"## {arm}")
        if not a or a.get("error"):
            L.append(f"> 산출 없음 — {(a or {}).get('error', '파일 부재')}\n")
            continue
        b = body(a)
        L.append(f"**제목**: {b.get('title','—')}\n")
        L.append(f"**밸류에이션 근거**: {b.get('valuation_method','—')}\n")
        for i, pt in enumerate(b.get("points") or []):
            L.append(f"- **({i+1}) {pt.get('title','')}** {str(pt.get('body',''))[:400]}")
        L.append("")

    ch = arms.get("h1") or {}
    if ch.get("changes"):
        L.append("## H1 검수가 고친 것\n")
        L.append("| 심각도 | 필드 | 이유 |")
        L.append("|---|---|---|")
        for c in ch["changes"]:
            reason = str(c.get("reason", "")).replace("|", "/")[:150]
            L.append(f"| {c.get('severity','?')} | `{c.get('field','?')}` | {reason} |")
        L.append("")

    L.append("## 사용자 판정\n")
    L.append("| 항목 | 어느 판이 나은가 | 메모 |")
    L.append("|---|---|---|")
    for k in ("사실 정확성", "논지 설득력", "가독성", "종합"):
        L.append(f"| {k} |  |  |")
    L.append("")
    out = d / "compare.md"
    out.write_text("\n".join(L))
    return out


if __name__ == "__main__":
    print(build(sys.argv[1], sys.argv[2]))

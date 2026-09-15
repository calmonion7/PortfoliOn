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


def _body(a):
    """팔별 본문을 같은 모양으로 맞춘다.

    enrich 레인은 배치 PUT이라 muse/h1이 **1개짜리 리스트**로 오고 opus는 이력의 dict다.
    모양이 다른 것을 그대로 비교하면 축이 전부 «—»가 되거나 예외로 죽는다(실측: 본 실행 중
    `'list' object has no attribute 'get'`). `ticker`는 페이로드 주소지이지 내용이 아니므로 뺀다.
    """
    b = (a or {}).get("body")
    if isinstance(b, list):
        b = b[0] if b else {}
    if not isinstance(b, dict):
        return {}
    return {k: v for k, v in b.items() if k != "ticker"}


# 레인마다 「내용」을 이루는 축이 다르다 — 공통 축만 쓰면 무엇이 달라졌는지 안 보인다.
LANE_ROWS = {
    "analyst": [
        ("rating", lambda b: b.get("rating")),
        ("FV 밴드", lambda b: f"{b.get('fair_value_low')}~{b.get('fair_value_high')}"),
        ("포인트 수", lambda b: len(b.get("points") or []) or None),
    ],
    "tech": [
        ("주요업체 수", lambda b: len(b.get("players") or []) or None),
        ("출처 수", lambda b: len(b.get("sources") or []) or None),
        ("핵심포인트 수", lambda b: len(b.get("key_points") or []) or None),
        ("과제 수", lambda b: len(b.get("challenges") or []) or None),
    ],
    "enrich": [
        ("채운 필드 수", lambda b: len([k for k, v in b.items() if v]) or None),
        ("moat(자)", lambda b: len(str(b.get("moat") or "")) or None),
        ("risks(자)", lambda b: len(str(b.get("risks") or "")) or None),
        ("insights(자)", lambda b: len(json.dumps(b.get("insights") or "", ensure_ascii=False))),
    ],
}


def build(lane, sample, outroot="out"):
    d = Path(outroot) / lane / sample
    arms = {}
    for arm in ("opus", "muse", "h1"):
        arms[arm] = _load(d / f"{arm}.json") or _load(d / f"{arm}.error.json")

    opus = arms.get("opus") or {}
    skew = _skew(opus.get("baseline_date", ""))
    comparable = skew is not None and skew <= SKEW_UNCOMPARABLE_DAYS

    L = [f"# {lane} / {sample} — 3팔 비교\n"]
    L.append(f"- opus 기준선 생성일: `{str(opus.get('baseline_date'))[:10]}` "
             f"· 실행일 `{RUN_DATE}` · **간격 {skew}일**")
    L.append("- 수치 대조: " + ("**가능**" if comparable else
             f"**대조 불가** (간격 {skew}일 > {SKEW_UNCOMPARABLE_DAYS}일 — "
             "그 사이 주가·실적 변동이 모델 차이로 오독된다)"))
    L.append("")
    L.append("| | opus (기존 발행물) | muse (무료) | H1 (muse→opus 검수) |")
    L.append("|---|---|---|---|")

    def cell(a, fn, on_body=True):
        if not a or a.get("error"):
            return f"— ({(a or {}).get('error', '없음')[:26]})"
        try:
            v = fn(_body(a) if on_body else a)
            return "—" if v is None else str(v)
        except Exception:
            return "—"

    L.append("| **세션 비용** | " + " | ".join(
        cell(arms[x], lambda a: "0 (수확)" if a.get("fired") is False else f"{a.get('elapsed_sec','?')}초",
             on_body=False) for x in ("opus", "muse", "h1")) + " |")
    for label, fn in LANE_ROWS.get(lane, []):
        L.append(f"| **{label}** | " + " | ".join(cell(arms[x], fn) for x in ("opus", "muse", "h1")) + " |")
    L.append("| **본문 분량(자)** | " + " | ".join(
        cell(arms[x], lambda b: len(json.dumps(b, ensure_ascii=False))) for x in ("opus", "muse", "h1")) + " |")
    L.append("| **H1 변경 건수** | — | — | " +
             cell(arms["h1"], lambda a: a.get("changes_count"), on_body=False) + " |")
    L.append("")

    for arm in ("opus", "muse", "h1"):
        a = arms[arm]
        L.append(f"## {arm}")
        if not a or a.get("error"):
            L.append(f"> 산출 없음 — {(a or {}).get('error', '파일 부재')}\n")
            continue
        b = _body(a)
        if lane == "analyst":
            L.append(f"**제목**: {b.get('title','—')}\n")
            L.append(f"**밸류에이션 근거**: {b.get('valuation_method','—')}\n")
            for i, pt in enumerate(b.get("points") or []):
                L.append(f"- **({i+1}) {pt.get('title','')}** {str(pt.get('body',''))[:400]}")
        elif lane == "tech":
            L.append(f"**제목**: {b.get('title','—')}\n")
            L.append(f"**설명**: {str(b.get('description',''))[:400]}\n")
            for kp in (b.get("key_points") or [])[:4]:
                L.append(f"- **{kp.get('title','')}** {str(kp.get('body',''))[:300]}")
        else:
            for k in ("moat", "key_resource", "competitor_edge", "risks", "growth_plan"):
                if b.get(k):
                    L.append(f"**{k}**: {str(b[k])[:400]}\n")
        L.append("")

    ch = arms.get("h1") or {}
    if ch.get("changes"):
        L.append("## H1 검수가 고친 것\n")
        L.append("| 심각도 | 필드 | 이유 |")
        L.append("|---|---|---|")
        for c in ch["changes"]:
            if not isinstance(c, dict):
                continue
            L.append(f"| {c.get('severity','?')} | `{c.get('field','?')}` | "
                     f"{str(c.get('reason','')).replace('|','/')[:150]} |")
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

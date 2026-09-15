#!/usr/bin/env python3
"""S7 종합표 — 20표본 × 3팔을 한 표로 (task#350 DoD 5·6·7·9).

**이 파일이 판정하지 않는다.** 판정은 사용자의 몫이고, 여기서는 자동으로 잴 수 있는 것만
같은 화면에 놓는다. 그래서 「어느 팔이 낫다」는 문장을 쓰지 않는다.

반드시 함께 싣는 것 3가지 — 이것들이 빠지면 숫자가 거짓말을 한다:
  ① **시점 간격**: opus 기준선은 표본마다 0~33일 전 판이다. 간격을 감추면 그 사이의
     주가·실적 변동이 「무료 모델이 틀렸다」로 읽힌다.
  ② **커버리지**: 실패·미산출 표본 수를 적지 않은 평균은 공허하다(표본 0의 통과 위장).
  ③ **프로드 무쓰기 전후값**: 이 측정이 프로드를 건드리지 않았다는 증거 자체.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util

REPO = Path(__file__).resolve().parent.parent
_s = importlib.util.spec_from_file_location("abc", REPO / "scripts" / "ab-compare.py")
C = importlib.util.module_from_spec(_s); _s.loader.exec_module(C)
_s2 = importlib.util.spec_from_file_location("ab", REPO / "scripts" / "ab-publish.py")
M = importlib.util.module_from_spec(_s2); _s2.loader.exec_module(M)

PSQL = ["docker", "exec", "portfolion-postgres-1", "psql", "-U", "portfolion", "-d", "portfolion", "-tAc"]


def prod_counts():
    q = ("select (select count(*) from analyst_reports)||'|'||(select count(*) from tech_reports)"
         "||'|'||(select count(*) from enrich_history)||'|'||(select max(enriched_at) from tickers)")
    return subprocess.run(PSQL + [q], capture_output=True, text=True).stdout.strip()


def build(before_counts, outroot="out"):
    L = ["# 발행 레인 A/B — 종합 (task#350)\n",
         f"실행일 `{C.RUN_DATE}` · opus 팔은 **세션 0개**(기존 발행물 수확)\n"]

    rows, stats = [], {"total": 0, "muse_ok": 0, "h1_ok": 0, "changes": [], "sev_high": 0,
                       "muse_sec": [], "h1_sec": [], "uncomparable": []}
    for lane, samples in M.SAMPLES.items():
        for s in samples:
            d = Path(outroot) / lane / s
            stats["total"] += 1
            o = C._load(d / "opus.json") or {}
            mu = C._load(d / "muse.json")
            h1 = C._load(d / "h1.json")
            skew = C._skew(o.get("baseline_date", ""))
            comparable = skew is not None and skew <= C.SKEW_UNCOMPARABLE_DAYS
            if not comparable:
                stats["uncomparable"].append(f"{lane}/{s}({skew}일)")
            if mu:
                stats["muse_ok"] += 1
                if mu.get("elapsed_sec"):
                    stats["muse_sec"].append(mu["elapsed_sec"])
            if h1:
                stats["h1_ok"] += 1
                if h1.get("elapsed_sec"):
                    stats["h1_sec"].append(h1["elapsed_sec"])
                n = h1.get("changes_count")
                if n is not None:
                    stats["changes"].append(n)
                for c in (h1.get("changes") or []):
                    if isinstance(c, dict) and c.get("severity") == "high":
                        stats["sev_high"] += 1
            rows.append((lane, s, skew, comparable, mu, h1,
                         len(json.dumps(C._body(o), ensure_ascii=False)) if o else 0))

    L.append("## 표본별\n")
    L.append("| 레인 | 표본 | 기준선 간격 | 수치대조 | muse | H1 검수 | H1 변경 | opus 분량 |")
    L.append("|---|---|---|---|---|---|---|---|")
    for lane, s, skew, cmpable, mu, h1, olen in rows:
        L.append(f"| {lane} | `{s}` | {skew}일 | {'가능' if cmpable else '**대조 불가**'} | "
                 f"{('✓ ' + str(mu.get('elapsed_sec')) + 's') if mu else '✗'} | "
                 f"{('✓ ' + str(h1.get('elapsed_sec')) + 's') if h1 else '✗'} | "
                 f"{h1.get('changes_count') if h1 else '—'} | {olen} |")

    L.append("\n## 커버리지 (이것 없이는 아래 평균이 공허하다)\n")
    L.append(f"- 표본 {stats['total']}건 · muse 산출 **{stats['muse_ok']}** · H1 산출 **{stats['h1_ok']}**")
    L.append(f"- 수치 대조 불가 **{len(stats['uncomparable'])}건**: "
             f"{', '.join(stats['uncomparable']) or '없음'} "
             f"(기준선이 {C.SKEW_UNCOMPARABLE_DAYS}일 초과 — 모델 차이가 아니라 시점 차이가 섞인다)")

    ch = stats["changes"]
    L.append("\n## H1 검수가 고친 양\n")
    if ch:
        L.append(f"- 표본당 변경 **평균 {sum(ch)/len(ch):.1f}건** (최소 {min(ch)} · 최대 {max(ch)}), "
                 f"표본 {len(ch)}건 기준")
        L.append(f"- 그중 `high` 심각도 누계 **{stats['sev_high']}건** "
                 "(지어낸 수치·확인 불가 출처·자기모순 산식 등)")
    else:
        L.append("- 표본 0 — **집계 불가**")

    L.append("\n## 비용\n")
    ms, hs = stats["muse_sec"], stats["h1_sec"]
    L.append(f"- muse(무료): {len(ms)}세션 · 평균 {sum(ms)/len(ms):.0f}초" if ms else "- muse: 표본 0")
    L.append(f"- H1 검수(opus): {len(hs)}세션 · 평균 {sum(hs)/len(hs):.0f}초" if hs else "- H1: 표본 0")
    L.append(f"- **opus 팔 세션 0개** — 기존 발행물을 기준선으로 써서 opus 풀 {stats['total']}세션을 "
             "돌리지 않았다(원안 대비 절반 절감).")

    after = prod_counts()
    L.append("\n## 프로드 무쓰기 증명\n")
    L.append("| | analyst_reports \\| tech_reports \\| enrich_history \\| max(enriched_at) |")
    L.append("|---|---|")
    L.append(f"| 실행 전 | `{before_counts}` |")
    L.append(f"| 실행 후 | `{after}` |")
    L.append(f"| 판정 | **{'동일 — 프로드 무손상' if before_counts == after else '⚠️ 달라졌다 — 조사 필요'}** |")
    L.append("\n보장 방식은 프롬프트 지시가 아니라 구조다 — 쓰기 차단 프록시(GET/HEAD만 통과) + "
             "자식 세션의 더미 키(prod 직접 POST는 401). 두 겹은 서로 독립이고 각각 따로 검증했다.\n")

    out = Path(outroot) / "summary.md"
    out.write_text("\n".join(L))
    return out


if __name__ == "__main__":
    print(build(sys.argv[1] if len(sys.argv) > 1 else "103|15|516|2026-09-15 11:58:08.638118+00"))

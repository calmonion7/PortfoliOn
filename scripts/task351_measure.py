#!/usr/bin/env python3
"""task#351 「야간 enrich 범위 정책」 결정 입력 측정기 (task#352).

왜 스크립트인가 — 계획서에 박제된 수치는 착수 시점에 이미 틀릴 수 있다(실제로 사용자 수가 틀렸다).
그래서 「그때 이랬다」가 아니라 **지금 재산출할 수 있는 형태**로 남긴다.

모드
  (없음)         지표 JSON을 stdout에
  --write        .forge/task351-measurements.json 갱신
  --check        라이브 DB 재산출 ↔ 커밋된 JSON 대조. 불일치면 **차이를 출력하고** exit 1
  --verify-docs  .forge/task351-findings.md가 현재값을 담고 있는지 확인. 불일치면 exit 1

⚠️ --check가 의미를 가지려면 **두 소스가 독립**이어야 한다 — JSON은 디스크에서 읽고 값은 DB에서
재산출한다. 스크립트가 방금 자기가 쓴 것과 비교하면 항상 통과한다(자기참조).

⚠️ 비퇴화 가드 — 지표가 8개 미만이거나 tickers==0이면 **exit 2**. 빈 출력은 「FAIL 0」과
글자 하나 다르지 않아서, 계측 실패를 판정 성공으로 읽게 된다(루트 CLAUDE.md task#318).

⚠️ 읽기 전용이다. 라이브 DB에 쓰지 않는다.
⚠️ 로컬 venv에는 psycopg(v3)가 없다 — psycopg2를 쓴다.
"""
from __future__ import annotations

import difflib
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

import psycopg2
import psycopg2.extras

ROOT = Path(__file__).resolve().parent.parent
MEASUREMENTS = ROOT / ".forge" / "task351-measurements.json"
FINDINGS = ROOT / ".forge" / "task351-findings.md"

# 이력에 담기는 enrich 8필드 (정본: services/storage/portfolio.py::_HISTORY_FIELDS)
ENRICH_FIELDS = (
    "moat", "growth_plan", "risks", "recent_disclosures",
    "insights", "key_resource", "competitor_edge", "market_outlook",
)

# findings 문서가 반드시 현재값으로 담아야 하는 headline 지표 → 문서에서 그 값을 찾을 라벨.
#
# ⚠️ 라벨이 왜 필요한가 — 처음엔 `str(value) in doc`로 썼는데 **이빨이 없었다**: `users`가 9일 때
#    "9"는 「129」·「09-13」·「9개」 어디에나 있어서 값을 7로 바꿔도 통과했다(실측). 그래서 판정을
#    「같은 줄에 **라벨**과 **`**값**`(볼드로 구분된 토큰)이 함께 있다」로 **강화**했다.
#    느슨하게 고친 것이 아니라 등가·강화다 — 오탐이 줄고 진짜 드리프트는 여전히 잡는다.
HEADLINE = {
    "users": "users",
    "tickers": "tickers",
    "user_stocks": "user_stocks",
    "enriched": "enriched",
    "active_users_30d": "활동 사용자",
    "distinct_viewed_tickers_30d": "열람된 서로 다른 종목",
}


def _dsn() -> str:
    env = (ROOT / "backend" / ".env").read_text(encoding="utf-8")
    m = re.search(r"^DATABASE_URL=(\S+)", env, re.M)
    if not m:
        print("FATAL: backend/.env에 DATABASE_URL이 없다", file=sys.stderr)
        sys.exit(2)
    return m.group(1)


# ── 사실 토큰 추출 ────────────────────────────────────────────────────────────
# 왜 「사실」을 숫자 + 라틴문자 토큰으로 좁히는가 — 한국어 산문 단어까지 넣으면 사실 중첩도가
# 텍스트 유사도와 사실상 같은 값이 되어 **둘을 나눈 의미가 사라진다**. 숫자·연도·퍼센트와
# 고유명사성 라틴 토큰(TSMC·HBM·ASML·AI)은 「사실」이고, 그것을 감싸는 한국어는 「표현」이다.
_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?%?")
_LATIN = re.compile(r"[A-Za-z][A-Za-z0-9.\-]{1,}")


def fact_tokens(text: str) -> set:
    return {t.replace(",", "") for t in _NUM.findall(text)} | {t.lower() for t in _LATIN.findall(text)}


def word_ratio(a: str, b: str) -> float:
    """단어 단위 텍스트 유사도. 문자 단위 SequenceMatcher는 긴 텍스트에서 느리고,
    「같은 말을 다시 썼는가」는 단어 수준에서 보는 편이 맞다."""
    return difflib.SequenceMatcher(None, a.split(), b.split()).ratio()


def jaccard(a: set, b: set) -> float:
    if not a and not b:
        return -1.0  # 정의역 밖 — 평균에서 제외한다(0으로 접으면 「사실이 바뀌었다」로 오독된다)
    return len(a & b) / len(a | b)


def _flat(v) -> str:
    """JSON 필드를 비교 가능한 평문으로. dict/list는 값만 재귀로 뽑는다."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, (int, float, bool)):
        return str(v)
    if isinstance(v, list):
        return " ".join(_flat(x) for x in v)
    if isinstance(v, dict):
        return " ".join(_flat(x) for x in v.values())
    return str(v)


# ── 측정 ──────────────────────────────────────────────────────────────────────
def measure() -> dict:
    conn = psycopg2.connect(_dsn())
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    m: dict = {}

    def scalar(sql):
        cur.execute(sql)
        return list(cur.fetchone().values())[0]

    m["users"] = scalar("SELECT count(*) FROM users")
    m["tickers"] = scalar("SELECT count(*) FROM tickers")
    m["user_stocks"] = scalar("SELECT count(*) FROM user_stocks")
    m["enriched"] = scalar("SELECT count(*) FROM tickers WHERE enriched_at IS NOT NULL")

    # 종목당 보유자 수 분포 — 「갱신 대상의 몇 %가 단 한 사람의 종목인가」가 A안의 핵심 근거다
    cur.execute("SELECT ticker, count(DISTINCT user_id) AS n FROM user_stocks GROUP BY ticker")
    dist = Counter(r["n"] for r in cur.fetchall())
    m["holders_distribution"] = {str(k): dist[k] for k in sorted(dist)}
    total_tracked = sum(dist.values())
    m["single_holder_share_pct"] = round(100.0 * dist.get(1, 0) / total_tracked, 1) if total_tracked else 0.0

    m["events_30d"] = scalar(
        "SELECT count(*) FROM user_events WHERE created_at > NOW() - INTERVAL '30 days'")
    m["active_users_30d"] = scalar(
        "SELECT count(DISTINCT user_id) FROM user_events WHERE created_at > NOW() - INTERVAL '30 days'")
    m["report_view_open_30d"] = scalar(
        "SELECT count(*) FROM user_events WHERE event_name='report_view_open'"
        " AND created_at > NOW() - INTERVAL '30 days'")
    m["distinct_viewed_tickers_30d"] = scalar(
        "SELECT count(DISTINCT properties->>'ticker') FROM user_events"
        " WHERE event_name='report_view_open' AND created_at > NOW() - INTERVAL '30 days'")
    # 상세 조회 이벤트 중 ticker를 못 실은 비율 — 0이 아니면 「서로 다른 종목 N개」가 과소치다
    m["view_events_without_ticker_30d"] = scalar(
        "SELECT count(*) FROM user_events WHERE event_name='report_view_open'"
        " AND created_at > NOW() - INTERVAL '30 days' AND properties->>'ticker' IS NULL")
    # 이벤트 종류를 불문하고 ticker가 실린 것 전부의 합집합.
    # report_view_open 기준값과 같으면 「다른 경로로 본 종목」이 *관측되지 않았다*는 뜻이지
    # 「없다」는 뜻이 아니다 — 심층 리포트 상세는 아무 이벤트도 쏘지 않는다(task#352 S2).
    m["any_ticker_event_distinct_30d"] = scalar(
        "SELECT count(DISTINCT properties->>'ticker') FROM user_events"
        " WHERE properties ? 'ticker' AND created_at > NOW() - INTERVAL '30 days'")

    m["enrich_history_rows"] = scalar("SELECT count(*) FROM enrich_history")
    m["enrich_history_tickers"] = scalar("SELECT count(DISTINCT ticker) FROM enrich_history")
    cur.execute("SELECT created_at::date AS d, count(*) AS n FROM enrich_history GROUP BY 1 ORDER BY 1")
    m["enrich_history_by_day"] = {str(r["d"]): r["n"] for r in cur.fetchall()}

    # 부분 갱신의 라이브 증거 (정지조건 C4의 근거) — 한 필드만 보낸 뒤에도 나머지가 살아남았는가
    m["partial_write_rows"] = scalar(
        "SELECT count(*) FROM enrich_history WHERE jsonb_array_length(changed) < 8")
    m["partial_write_preserving_rows"] = scalar(
        "SELECT count(*) FROM enrich_history h WHERE jsonb_array_length(h.changed)=1"
        " AND (SELECT count(*) FROM jsonb_each(h.fields) e WHERE e.value <> 'null'::jsonb) >= 7")

    m["similarity"] = _similarity(cur)
    conn.close()
    return m


def _similarity(cur) -> dict:
    """연속일 쌍의 필드별 ⓐ텍스트 유사도 · ⓑ사실 중첩도.

    읽는 법 — ⓑ가 높은데 ⓐ가 낮으면 **같은 사실을 다시 쓴 것**(재표현)이다. 둘 다 낮으면
    사실 자체가 바뀐 것이다. 이 구별이 task#351 B·C안의 근거다.
    """
    cur.execute(
        "SELECT DISTINCT ON (ticker, created_at::date) ticker, created_at::date AS d, fields"
        " FROM enrich_history ORDER BY ticker, created_at::date, created_at DESC")
    rows = cur.fetchall()
    by_ticker: dict = {}
    for r in rows:
        by_ticker.setdefault(r["ticker"], []).append((str(r["d"]), r["fields"]))

    per_field = {f: {"text": [], "fact": []} for f in ENRICH_FIELDS}
    pairs = 0
    identity_ok = identity_total = 0
    no_facts = 0          # 사실 토큰이 하나도 없는 텍스트 (정의역 밖 — 오독 방지용 커버리지 지표)
    asym = 0              # 한쪽만 사실 토큰이 있는 경우 (사실이 생기거나 사라진 것 — 진짜 변화다)
    compared = 0
    for _t, days in by_ticker.items():
        days.sort()
        for (_d1, f1), (_d2, f2) in zip(days, days[1:]):
            pairs += 1
            for f in ENRICH_FIELDS:
                a, b = _flat(f1.get(f)), _flat(f2.get(f))
                if not a.strip() or not b.strip():
                    continue
                compared += 1
                per_field[f]["text"].append(word_ratio(a, b))
                ta, tb = fact_tokens(a), fact_tokens(b)
                if not ta and not tb:
                    # 양쪽 다 숫자·라틴 토큰이 없다 = 사실 중첩도의 **정의역 밖**이다.
                    # 0으로 접으면 「사실이 바뀌었다」로 오독되므로 평균에서 빼고 따로 센다.
                    no_facts += 1
                    continue
                per_field[f]["fact"].append(jaccard(ta, tb))
                # 한쪽만 비었으면 jaccard는 0.0이고 그건 **옳은 값**이다(사실이 생겼거나 사라졌다).
                if bool(ta) != bool(tb):
                    asym += 1
                # identity 대조군 — 비지 않은 사실집합을 자기 자신과 비교하면 1.0이어야 한다.
                # 깨지면 토큰화가 고장난 것이고, 낮은 ⓑ를 「사실 변경」으로 오독하게 된다.
                for side in (ta, tb):
                    if side:
                        identity_total += 1
                        if jaccard(side, side) == 1.0:
                            identity_ok += 1

    def avg(xs):
        return round(sum(xs) / len(xs), 3) if xs else None

    out = {
        "day_pairs": pairs,
        "identity_control": f"{identity_ok}/{identity_total}",
        "compared_field_instances": compared,
        "no_fact_token_instances": no_facts,
        "asymmetric_fact_instances": asym,
        "fields": {
            f: {"text": avg(v["text"]), "fact": avg(v["fact"]), "n": len(v["text"])}
            for f, v in per_field.items()
        },
    }
    all_text = [x for v in per_field.values() for x in v["text"]]
    all_fact = [x for v in per_field.values() for x in v["fact"]]
    out["overall_text"] = avg(all_text)
    out["overall_fact"] = avg(all_fact)
    out["sample_n"] = len(all_text)
    return out


def _guard(m: dict) -> None:
    """비퇴화 가드 — 계측 실패를 판정 성공으로 읽지 않기 위함."""
    if len(m) < 8:
        print(f"FATAL: 지표가 {len(m)}개뿐이다 (8 미만) — 계측이 대상에 닿지 못했다", file=sys.stderr)
        sys.exit(2)
    if not m.get("tickers"):
        print("FATAL: tickers == 0 — 계측이 대상에 닿지 못했다", file=sys.stderr)
        sys.exit(2)
    sim = m.get("similarity") or {}
    if sim.get("identity_control") and not sim["identity_control"].split("/")[0] == sim["identity_control"].split("/")[1]:
        print(f"FATAL: identity 대조군 실패 ({sim['identity_control']}) — 사실 토큰화가 고장났다",
              file=sys.stderr)
        sys.exit(2)


def _diff(fresh, stored, path="") -> list:
    out = []
    if isinstance(fresh, dict) and isinstance(stored, dict):
        for k in sorted(set(fresh) | set(stored)):
            out += _diff(fresh.get(k), stored.get(k), f"{path}.{k}" if path else k)
    elif fresh != stored:
        out.append(f"  {path}: 저장값={stored!r} → 현재={fresh!r}")
    return out


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""

    if mode == "--verify-docs":
        if not FINDINGS.exists():
            print(f"FAIL: {FINDINGS.relative_to(ROOT)} 부재", file=sys.stderr)
            sys.exit(1)
        m = measure()
        _guard(m)
        lines = FINDINGS.read_text(encoding="utf-8").splitlines()
        doc = "\n".join(lines)
        missing = []
        for key, label in HEADLINE.items():
            token = f"**{m[key]}**"
            if not any(label in ln and token in ln for ln in lines):
                missing.append((key, label, m[key]))
        if missing:
            print("FAIL: findings 문서가 현재값을 담지 않은 지표:", file=sys.stderr)
            for key, label in ((k, l) for k, l, _ in missing):
                print(f"  {key}: 「{label}」과 **{m[key]}**가 같은 줄에 있어야 한다", file=sys.stderr)
            sys.exit(1)
        # task#351 계획서의 어느 지표가 더 이상 맞지 않는지를 *이름으로* 명시했는가
        if "users" not in doc or "더 이상" not in doc:
            print("FAIL: findings 문서가 stale 지표를 이름으로 명시하지 않았다", file=sys.stderr)
            sys.exit(1)
        print(f"OK: findings 문서가 headline {len(HEADLINE)}종의 현재값을 담는다")
        return

    m = measure()
    _guard(m)

    if mode == "--check":
        if not MEASUREMENTS.exists():
            print(f"FAIL: {MEASUREMENTS.relative_to(ROOT)} 부재", file=sys.stderr)
            sys.exit(1)
        stored = json.loads(MEASUREMENTS.read_text(encoding="utf-8"))
        d = _diff(m, stored)
        if d:
            print(f"FAIL: 커밋된 측정값이 현재 DB와 다르다 ({len(d)}건)", file=sys.stderr)
            print("\n".join(d), file=sys.stderr)
            print("\n  → `--write`로 갱신하고 findings 문서도 함께 고칠 것", file=sys.stderr)
            sys.exit(1)
        print(f"OK: 측정값 {len(m)}종이 라이브 DB와 일치한다")
        return

    text = json.dumps(m, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if mode == "--write":
        MEASUREMENTS.write_text(text, encoding="utf-8")
        print(f"wrote {MEASUREMENTS.relative_to(ROOT)}")
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()

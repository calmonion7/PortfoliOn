#!/usr/bin/env python3
"""fg-loop 정지조건 C1b — 갱신 대상 집합의 **라이브 identity 대조**(ADR 260916-132605).

`services.enrich_targets.compute_enrich_target_set()`(구현)이 돌려주는 집합이, 이 스크립트가
**독립적으로** 적은 SQL(정의: 보유 ∪ 30일 열람, 추적 종목으로 제한)과 **원소 단위로 같은지** 본다.
개수 비교가 아니라 집합 비교다 — 하나 빠지고 하나 더해져도 잡는다.

읽기 전용. 실행: `backend/.venv/bin/python scripts/loopcheck-enrich-target-set.py`
exit 0 = MATCH · 1 = MISMATCH(차집합을 출력) · 2 = 환경/임포트 실패(판정 아님).
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

if "DATABASE_URL" not in os.environ:
    env = (BACKEND / ".env").read_text(encoding="utf-8") if (BACKEND / ".env").exists() else ""
    m = re.search(r"^DATABASE_URL=(\S+)", env, re.M)
    if not m:
        print("BLOCKED: backend/.env에 DATABASE_URL이 없다", file=sys.stderr)
        sys.exit(2)
    os.environ["DATABASE_URL"] = m.group(1)

try:
    import psycopg2  # noqa: E402
except Exception as e:  # pragma: no cover
    print(f"BLOCKED: psycopg2 임포트 실패: {e}", file=sys.stderr)
    sys.exit(2)

_INDEPENDENT_SQL = """
WITH held AS (SELECT DISTINCT ticker FROM user_stocks WHERE type = 'holding'),
viewed AS (
  SELECT DISTINCT upper(properties->>'ticker') AS t
  FROM user_events
  WHERE event_name IN ('report_view_open', 'ranking_row_click')
    AND created_at > now() - interval '30 days'
    AND properties->>'ticker' IS NOT NULL
),
tracked AS (SELECT DISTINCT ticker FROM user_stocks)
SELECT ticker FROM held
UNION
SELECT t FROM viewed WHERE t IN (SELECT ticker FROM tracked)
"""

with psycopg2.connect(os.environ["DATABASE_URL"]) as conn:
    with conn.cursor() as cur:
        cur.execute(_INDEPENDENT_SQL)
        expected = {r[0] for r in cur.fetchall()}

try:
    from services.enrich_targets import compute_enrich_target_set  # noqa: E402
except Exception as e:
    print(f"FAIL: services.enrich_targets.compute_enrich_target_set 임포트 실패 — 미구현? ({e})")
    sys.exit(1)

got = compute_enrich_target_set()
if not isinstance(got, list) or got != sorted(got):
    print(f"FAIL: 반환은 정렬된 list여야 한다 (type={type(got).__name__})")
    sys.exit(1)
got_set = set(got)
if got_set == expected:
    print(f"MATCH n={len(expected)}")
    sys.exit(0)
print(f"MISMATCH expected={len(expected)} got={len(got_set)}")
print(f"  only-in-impl: {sorted(got_set - expected)}")
print(f"  only-in-sql : {sorted(expected - got_set)}")
sys.exit(1)

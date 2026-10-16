#!/usr/bin/env python3
"""enrich 회차 완료 판정 — 로그 줄이 아니라 **DB 데이터**로 잰다(task#390 B1).

`job_runs.payload.tickers`(그 회차가 쏜 종목)가 전부 `tickers.enriched_at >= job_runs.started_at`
인지 본다. 리스너 로그의 「완료」 줄은 청크 종료일 뿐 갱신 증거가 아니다(task#389 회고).

읽기 전용. 실행: `backend/.venv/bin/python scripts/loopcheck-enrich-run.py [--run-id N]`
기본 대상 = payload 가 있는 `cowork_enrich_nightly` 의 **최신** run(수동 실행 포함).
exit 0 = 전부 갱신 · 1 = 미갱신 종목 있음(목록 출력) · 2 = 환경·판정 불가(대상 run 없음·DB 실패 등).
출력 첫 줄은 `n/N` (갱신 수/대상 수).
"""
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
JOB_ID = "cowork_enrich_nightly"


def _utc(dt):
    """naive 는 비교 불가 — None 으로 돌려 미갱신 취급한다(조용히 통과시키지 않는다)."""
    if not isinstance(dt, datetime) or dt.tzinfo is None:
        return None
    return dt.astimezone(timezone.utc)


def _load_database_url() -> bool:
    if "DATABASE_URL" in os.environ:
        return True
    env_file = BACKEND / ".env"
    m = re.search(r"^DATABASE_URL=(\S+)", env_file.read_text(encoding="utf-8") if env_file.exists() else "", re.M)
    if not m:
        return False
    os.environ["DATABASE_URL"] = m.group(1)
    return True


def main(argv=None, query=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    run_id = int(argv[argv.index("--run-id") + 1]) if "--run-id" in argv else None
    if query is None:
        if not _load_database_url():
            print("BLOCKED: backend/.env에 DATABASE_URL이 없다", file=sys.stderr)
            return 2
        sys.path.insert(0, str(BACKEND))
        from services.db import query  # noqa: E402

    try:
        if run_id is None:
            runs = query(
                "SELECT id, started_at, payload FROM job_runs "
                "WHERE job_id = %s AND payload->'tickers' IS NOT NULL "
                "ORDER BY started_at DESC LIMIT 1", (JOB_ID,))
        else:
            runs = query("SELECT id, started_at, payload FROM job_runs WHERE id = %s", (run_id,))
        if not runs:
            print("BLOCKED: 대상 run 이 없다(payload.tickers 가 있는 run 부재)", file=sys.stderr)
            return 2
        run = runs[0]
        tickers = (run.get("payload") or {}).get("tickers") or []
        started = _utc(run.get("started_at"))
        if not tickers or started is None:
            print(f"BLOCKED: run {run.get('id')} 에 tickers 또는 tz-aware started_at 이 없다", file=sys.stderr)
            return 2
        rows = query("SELECT ticker, enriched_at FROM tickers WHERE ticker = ANY(%s)", (tickers,))
    except Exception as e:
        print(f"BLOCKED: DB 조회 실패: {e}", file=sys.stderr)
        return 2

    enriched = {r["ticker"]: _utc(r.get("enriched_at")) for r in rows}
    missing = sorted(t for t in tickers if enriched.get(t) is None or enriched[t] < started)
    n, total = len(tickers) - len(missing), len(tickers)
    print(f"{n}/{total} (run {run['id']}, started_at {started.isoformat()})")
    if missing:
        print(f"미갱신 {len(missing)}종목: {', '.join(missing)}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

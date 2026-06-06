# backend/services/job_runs.py
"""배치 실행로그 — job_id별 최근 20건만 보관. 읽기는 graceful degrade."""
from __future__ import annotations

import logging
from contextlib import contextmanager

from services.db import query, execute

log = logging.getLogger(__name__)

KEEP = 20


@contextmanager
def record(job_id: str, trigger: str):
    """배치 실행을 running으로 기록하고, 종료 시 success/failed로 갱신.

    enter시 running 행 INSERT(RETURNING id) + 해당 job_id 최신 20건만 보관(prune).
    정상 exit시 success/finished_at UPDATE. 예외시 failed/error/finished_at UPDATE 후 재raise.
    """
    rows = query(
        "INSERT INTO job_runs (job_id, trigger, status) VALUES (%s, %s, 'running') RETURNING id",
        (job_id, trigger),
    )
    run_id = rows[0]["id"]
    execute(
        "DELETE FROM job_runs WHERE job_id = %s AND id NOT IN ("
        "SELECT id FROM job_runs WHERE job_id = %s ORDER BY started_at DESC LIMIT 20)",
        (job_id, job_id),
    )
    try:
        yield run_id
    except Exception as exc:
        execute(
            "UPDATE job_runs SET status = 'failed', error = %s, finished_at = NOW() WHERE id = %s",
            (str(exc), run_id),
        )
        raise
    else:
        execute(
            "UPDATE job_runs SET status = 'success', finished_at = NOW() WHERE id = %s",
            (run_id,),
        )


def recent(job_id: str, n: int = 20) -> list[dict]:
    """해당 job_id의 최신 실행로그 n건(최신순). 테이블 부재/예외시 []."""
    try:
        return query(
            "SELECT id, job_id, trigger, status, started_at, finished_at, error "
            "FROM job_runs WHERE job_id = %s ORDER BY started_at DESC LIMIT %s",
            (job_id, n),
        )
    except Exception:
        log.warning("job_runs.recent failed for %s", job_id, exc_info=True)
        return []


def recent_map(job_ids: list[str]) -> dict[str, list[dict]]:
    """여러 job_id의 최신 실행로그를 job_id->list(최신순)로 묶어 반환. 예외시 모두 []."""
    out: dict[str, list[dict]] = {jid: [] for jid in job_ids}
    if not job_ids:
        return out
    try:
        rows = query(
            "SELECT id, job_id, trigger, status, started_at, finished_at, error FROM ("
            "SELECT *, ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY started_at DESC) AS rn "
            "FROM job_runs WHERE job_id = ANY(%s)) t WHERE rn <= 20 ORDER BY started_at DESC",
            (job_ids,),
        )
    except Exception:
        log.warning("job_runs.recent_map failed", exc_info=True)
        return out
    for r in rows:
        jid = r.get("job_id")
        if jid in out:
            out[jid].append(r)
    return out

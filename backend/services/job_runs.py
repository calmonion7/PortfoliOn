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

    계측은 관측 전용 — 본문(배치)을 절대 깨뜨리지 않는다(write-path도 read-path와 동일하게 graceful degrade).
    enter시 running 행 INSERT(RETURNING id) + 해당 job_id 최신 20건만 보관(prune). 이 쓰기가
    실패하면(테이블 부재/일시 DB 오류 등) 경고만 남기고 run_id=None(센티넬)으로 본문을 그대로 실행.
    정상 exit시 success/finished_at UPDATE, 본문 예외시 failed/error/finished_at UPDATE 후 재raise.
    run_id가 None이면 종료 UPDATE는 no-op이고, UPDATE 자체 실패도 본문 결과에 영향 주지 않게 삼킨다.

    실패 가시성 주의: failed는 본문이 예외를 '전파'할 때만 기록된다. 다수의 스케줄러 잡
    (_run_guru_crawl/_refresh_monthly_kr/_refresh_monthly_us/_refresh_earnings_kr/_refresh_earnings_us/_fetch_leverage/_fetch_lending/
    _fetch_kr_rankings/_fetch_us_rankings/_run_digest/_fetch_investor_trend)과 일부 워커
    (report._run_*/guru._run_crawl/leverage_service.backfill_with_progress)는 내부 예외를
    try/except로 삼키고 정상 종료하므로, 부분/전체 실패여도 success로 기록된다.
    즉 허브의 success를 '내부 오류 없음'으로 과신하면 안 된다(잡 본문 로그를 함께 확인).
    """
    try:
        rows = query(
            "INSERT INTO job_runs (job_id, trigger, status) VALUES (%s, %s, 'running') RETURNING id",
            (job_id, trigger),
        )
        run_id = rows[0]["id"]
    except Exception:
        log.warning("job_runs.record enter failed for %s; running body uninstrumented", job_id, exc_info=True)
        run_id = None

    if run_id is not None:
        try:
            execute(
                "DELETE FROM job_runs WHERE job_id = %s AND id NOT IN ("
                "SELECT id FROM job_runs WHERE job_id = %s ORDER BY started_at DESC LIMIT 20)",
                (job_id, job_id),
            )
        except Exception:
            log.warning("job_runs.record prune failed for %s", job_id, exc_info=True)

    try:
        yield run_id
    except Exception as exc:
        if run_id is not None:
            try:
                execute(
                    "UPDATE job_runs SET status = 'failed', error = %s, finished_at = NOW() WHERE id = %s",
                    (str(exc), run_id),
                )
            except Exception:
                log.warning("job_runs.record failed-update failed for %s", job_id, exc_info=True)
        raise
    else:
        if run_id is not None:
            try:
                execute(
                    "UPDATE job_runs SET status = 'success', finished_at = NOW() WHERE id = %s",
                    (run_id,),
                )
            except Exception:
                log.warning("job_runs.record success-update failed for %s", job_id, exc_info=True)


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

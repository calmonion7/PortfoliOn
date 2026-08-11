# backend/services/job_runs.py
"""배치 실행로그 — job_id별 최근 20건만 보관. 읽기는 graceful degrade."""
from __future__ import annotations

import logging
from contextlib import contextmanager

from services.db import query, execute

log = logging.getLogger(__name__)

KEEP = 20


class Run:
    """record()가 yield하는 핸들. `.run_id`는 종래대로 노출하고, 본문이 종료 상태를 지정할 수 있다.

    상태 어휘: running | success | partial | skipped | failed.
    미지정이면 종래대로 success이고, 본문이 예외를 *전파*하면 failed가 지정을 이긴다.
    """

    __slots__ = ("run_id", "status", "error")

    def __init__(self, run_id):
        self.run_id = run_id
        self.status = None
        self.error = None

    def set_status(self, status: str, error: str | None = None) -> None:
        self.status = status
        self.error = error


@contextmanager
def record(job_id: str, trigger: str):
    """배치 실행을 running으로 기록하고, 종료 시 success/partial/skipped/failed로 갱신.

    계측은 관측 전용 — 본문(배치)을 절대 깨뜨리지 않는다(write-path도 read-path와 동일하게 graceful degrade).
    enter시 running 행 INSERT(RETURNING id) + 해당 job_id 최신 20건만 보관(prune). 이 쓰기가
    실패하면(테이블 부재/일시 DB 오류 등) 경고만 남기고 run_id=None(센티넬)으로 본문을 그대로 실행.
    정상 exit시 success/finished_at UPDATE, 본문 예외시 failed/error/finished_at UPDATE 후 재raise.
    run_id가 None이면 종료 UPDATE는 no-op이고, UPDATE 자체 실패도 본문 결과에 영향 주지 않게 삼킨다.

    본문은 `with record(...) as run:`으로 핸들을 받아 `run.set_status("partial"|"skipped"|"failed", err)`로
    종료 상태를 직접 말할 수 있다 — 예외를 삼키는 잡이 자기 결과를 정확히 기록하는 통로다(B31).

    실패 가시성 주의: 상태를 지정하지 않는 잡은 failed가 본문이 예외를 '전파'할 때만 기록된다.
    다수의 스케줄러 잡(_refresh_monthly_kr/_refresh_monthly_us/_refresh_earnings_kr/_refresh_earnings_us/
    _fetch_leverage/_fetch_lending/_fetch_kr_rankings/_fetch_us_rankings/_run_digest/_fetch_investor_trend)과
    일부 워커(report._run_*/leverage_service.backfill_with_progress)는 내부 예외를 try/except로
    삼키고 정상 종료하므로, 부분/전체 실패여도 success로 기록된다. 즉 그 잡들의 success를
    '내부 오류 없음'으로 과신하면 안 된다(잡 본문 로그를 함께 확인).
    구루 크롤 2경로(routers/guru._run_crawl · scheduler/jobs._run_guru_crawl)와 신규 창업
    신청 2경로(scheduler/jobs._refresh_business_formation ·
    routers/market_indicators.refresh_business_formation)·고용 조사 2경로
    (scheduler/jobs._refresh_labor_surveys · routers/market_indicators.refresh_labor_surveys)는
    set_status로 배선돼 있어 이 주의의 예외다.
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

    run = Run(run_id)

    def _finish(status: str, error: "str | None") -> None:
        if run_id is None:
            return
        try:
            execute(
                "UPDATE job_runs SET status = %s, error = %s, finished_at = NOW() WHERE id = %s",
                (status, error, run_id),
            )
        except Exception:
            log.warning("job_runs.record %s-update failed for %s", status, job_id, exc_info=True)

    try:
        yield run
    except Exception as exc:
        # 전파된 예외가 지정 상태를 이긴다 — 본문이 끝까지 못 갔다는 사실이 더 강한 신호다.
        _finish("failed", str(exc))
        raise
    else:
        _finish(run.status or "success", run.error)


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

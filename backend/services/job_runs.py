# backend/services/job_runs.py
"""배치 실행로그 — job_id별 최근 20건만 보관. 읽기는 graceful degrade."""
from __future__ import annotations

import json
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

    __slots__ = ("run_id", "status", "error", "payload")

    def __init__(self, run_id):
        self.run_id = run_id
        self.status = None
        self.error = None
        self.payload = None

    def set_status(self, status: str, error: str | None = None) -> None:
        self.status = status
        self.error = error

    def set_payload(self, payload: dict) -> None:
        """그 실행이 무엇을 대상으로 했는지(예: 대상 ticker 목록) — 종료 UPDATE에 함께 실린다.
        부르지 않으면 종료 UPDATE는 payload 컬럼을 건드리지 않는다(기존 잡 무회귀)."""
        self.payload = payload


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
    다수의 스케줄러 잡(_refresh_monthly_kr/
    _fetch_leverage/_fetch_lending/_run_digest/_fetch_investor_trend)과
    일부 워커(report._run_*/leverage_service.backfill_with_progress)는 내부 예외를 try/except로
    삼키고 정상 종료하므로, 부분/전체 실패여도 success로 기록된다. 즉 그 잡들의 success를
    '내부 오류 없음'으로 과신하면 안 된다(잡 본문 로그를 함께 확인).
    ⚠️ _refresh_earnings_kr/_refresh_earnings_us는 **예외만** 배선돼 있다 — 본문의 저장 생략
    4경로(고정집합 불완전·rest 유니버스 공백·rest 커버리지 미달·마감분기 없음)는 직전 저장값을
    그대로 반환하므로 반환값으로 구별할 수 없고, 그 절반은 여전히 success로 기록된다(선재 부채).
    구루 크롤 2경로(routers/guru._run_crawl · scheduler/jobs._run_guru_crawl)와 신규 창업
    신청 2경로(scheduler/jobs._refresh_business_formation ·
    routers/market_indicators.refresh_business_formation)·고용 조사 2경로
    (scheduler/jobs._refresh_labor_surveys · routers/market_indicators.refresh_labor_surveys)·
    절사평균 물가 2경로(scheduler/jobs._refresh_trimmed_inflation ·
    routers/market_indicators.refresh_trimmed_inflation)·FRED 경제지표 3경로
    (scheduler/jobs._refresh_monthly_us · routers/market_indicators.refresh_econ ·
    routers/market_indicators.refresh_monthly 의 US 분기)·환율 2경로
    (scheduler/jobs._refresh_fx · routers/market_indicators.refresh_fx)·매크로 신호 2경로
    (scheduler/jobs._refresh_macro_signals · routers/market_indicators.refresh_macro_signals
    — 키 미설정 `error`와 수집 실패 `_status: skipped`를 둘 다 skipped로, task#341)·발굴 추천 2경로
    (scheduler/jobs._fetch_recommendation_kr|us · routers/recommendations.refresh_recommendations
    — 둘 다 scheduler._recommendation_work(market, run)에 핸들을 넘겨 매핑을 공유한다)·
    랭킹 2경로(scheduler/jobs._fetch_kr_rankings · _fetch_us_rankings, fetch 가드의 예외를
    skipped로)·다음날 코스피 신호(scheduler/jobs._refresh_kospi_signal)·US 섹터 모멘텀
    (scheduler/jobs._fetch_us_sector, all-None 저장 생략을 skipped로)는
    set_status로 배선돼 있어 이 주의의 예외다.
    ⚠️ cowork_enrich_nightly는 이 잡 **자신의 본문**만 놓고 보면 여전히 위 주의에 해당한다 —
    set_status는 배선돼 있지만(fire 전송 실패 → failed, 미설정·대상 0 → skipped) 실제 갱신
    작업은 fire를 받은 다른 프로세스(로컬 리스너)에서 이 잡이 끝난 뒤 수 시간에 걸쳐 일어나므로,
    이 잡이 직접 기록하는 success는 그 시점엔 「트리거가 접수됨」 이상을 말하지 않는다.
    다만 이제 그 간극에 사후 대조가 생겼다: 다음날 08:00 cowork_enrich_verify가 이 잡이
    남긴 payload(쏜 ticker 목록, `run.set_payload`)를 `tickers.enriched_at`과 대조해 이
    run 행의 status/error를 실제 갱신 여부(success/partial/failed)로 **직접 다시 쓴다**(자기
    run에도 같은 상태를 남긴다). 즉 이 잡의 **최종** 상태는 08:00 대조를 거친 값이고, 그 전
    한동안만(02:00~08:00) 「접수됨」 상태로 보인다.
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
        # payload가 지정되지 않았으면(기본 None) 그 컬럼을 건드리지 않는다 — 기존 잡의 행동 보존.
        payload_json = None
        if run.payload is not None:
            try:
                payload_json = json.dumps(run.payload, ensure_ascii=False)
            except Exception:
                # 직렬화 실패도 계측 실패와 같은 규율 — payload 없이 종료 기록을 진행한다.
                log.warning("job_runs.record payload 직렬화 실패 for %s", job_id, exc_info=True)
        if payload_json is not None:
            try:
                execute(
                    "UPDATE job_runs SET status = %s, error = %s, finished_at = NOW(), "
                    "payload = %s::jsonb WHERE id = %s",
                    (status, error, payload_json, run_id),
                )
                return
            except Exception:
                # payload 쓰기 실패가 상태 확정까지 끌고 내려가면 그 run은 영구히 running으로 남는다
                # (예: payload 컬럼 마이그레이션 미적용). payload는 부가정보이므로 버리고 상태만 확정한다.
                log.warning("job_runs.record payload-update failed for %s; 상태만 기록", job_id, exc_info=True)
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
            "SELECT id, job_id, trigger, status, started_at, finished_at, error, payload "
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
            "SELECT id, job_id, trigger, status, started_at, finished_at, error, payload FROM ("
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

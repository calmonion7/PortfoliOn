"""task#274 — 구루 크롤 손실 가시화 (B29·B31).

B29: `dropped`는 storage에서 **계산되는데 아무도 읽지 않았다** — 수동·자동 두 경로가
     `saved`/`stale`만 분기해 매니저 삭제가 초록 "완료"로 보고됐다.
B31: 두 경로 모두 예외를 try/except로 삼켜 `job_runs`가 **항상 success**였다.

두 경로가 같은 분기를 쓰므로 한쪽만 고치면 다른 쪽이 그대로 남는다 — 그래서 수동·자동을
쌍으로 단언한다.
"""
import logging
from unittest.mock import patch

import pytest


def _stats(**kw):
    base = {"saved": True, "fresh": 10, "stale": 0, "dropped": 0, "held": 0}
    base.update(kw)
    return base


@pytest.fixture
def instrumented():
    """job_runs가 실제 run_id를 받도록 계측 — 미계측(run_id=None)이면 상태 UPDATE가 no-op이다."""
    from services import job_runs
    with patch.object(job_runs, "query", return_value=[{"id": 1}]), \
         patch.object(job_runs, "execute", return_value=1) as ex:
        yield ex


def _status(ex):
    ups = [c[0][1] for c in ex.call_args_list if "UPDATE job_runs" in c[0][0]]
    assert len(ups) == 1, f"종료 UPDATE 1건이어야 함: {ups}"
    return ups[0][0]


# ── 수동 경로 (routers/guru._run_crawl) ────────────────────────────────────────

def test_manual_crawl_held_is_partial_and_warns_T274(caplog, monkeypatch, instrumented):
    """보류가 발생하면 초록이 아니다 — 명부가 이상하다는 신호다."""
    import routers.guru as guru
    monkeypatch.setattr(guru, "scrape_all_managers", lambda *a, **k: ([{"id": "1"}], [{"id": "1"}]))
    monkeypatch.setattr(guru.storage, "save_guru_managers", lambda d: _stats(held=43, stale=43))

    with caplog.at_level(logging.WARNING):
        guru._run_crawl()

    assert guru._progress.get()["result"] == "partial"
    assert guru._progress.get()["held"] == 43
    assert any("보류" in r.message for r in caplog.records)
    assert _status(instrumented) == "partial"


def test_manual_crawl_dropped_stays_green_but_reports_number_T274(caplog, monkeypatch, instrumented):
    """정상 은퇴 반영은 오류가 아니다 — 초록을 유지하되 숫자는 보이게 한다(B29는 '안 보임' 문제)."""
    import routers.guru as guru
    monkeypatch.setattr(guru, "scrape_all_managers", lambda *a, **k: ([{"id": "1"}], [{"id": "1"}]))
    monkeypatch.setattr(guru.storage, "save_guru_managers", lambda d: _stats(dropped=3))

    with caplog.at_level(logging.INFO):
        guru._run_crawl()

    assert guru._progress.get()["result"] == "saved"
    assert guru._progress.get()["dropped"] == 3
    assert _status(instrumented) == "success"
    assert any("은퇴" in r.message for r in caplog.records)


def test_manual_crawl_empty_records_skipped_T274(monkeypatch, instrumented):
    """빈 결과는 '안 했음'이지 성공이 아니다."""
    import routers.guru as guru
    monkeypatch.setattr(guru, "scrape_all_managers", lambda *a, **k: ([], [{"id": "1"}]))
    monkeypatch.setattr(guru.storage, "save_guru_managers",
                        lambda d: {"saved": False, "fresh": 0, "stale": 0, "dropped": 0, "held": 0})

    guru._run_crawl()

    assert guru._progress.get()["result"] == "skipped"
    assert _status(instrumented) == "skipped"


def test_manual_crawl_swallowed_exception_records_failed_T274(monkeypatch, instrumented):
    """B31의 핵심 — 본문이 예외를 삼켜도 job_runs는 failed다."""
    import routers.guru as guru

    def _boom(*a, **k):
        raise RuntimeError("dataroma down")

    monkeypatch.setattr(guru, "scrape_all_managers", _boom)

    guru._run_crawl()   # 삼켜서 정상 종료(UI 폴링을 위해)

    assert guru._progress.get()["result"] == "failed"
    assert _status(instrumented) == "failed"


def test_start_crawl_resets_dropped_and_held_T274():
    """BackgroundTasks는 응답 *후* 실행된다 — 핸들러에서 선리셋하지 않으면 폴러가
    직전 크롤의 숫자를 이번 실행의 것으로 표시한다(task#262 학습 1이 필드마다 재적용된다)."""
    import routers.guru as guru
    guru._progress.set(running=False, result="saved", dropped=7, held=3)

    try:
        guru.start_crawl(_FakeBackgroundTasks(), _="admin")

        p = guru._progress.get()
        assert p["dropped"] is None
        assert p["held"] is None
    finally:
        # start_crawl은 running=True로 두고 배치는 가짜라 안 돈다 — 여기서 안 풀면
        # 다른 파일의 "크롤 시작 202" 테스트가 409를 받는다(실제로 발생시켰다).
        guru._progress.finish()


class _FakeBackgroundTasks:
    def add_task(self, *a, **k):
        pass


# ── 자동 경로 (scheduler/jobs._run_guru_crawl) ─────────────────────────────────

def test_scheduler_crawl_held_warns_and_records_partial_T274(caplog, monkeypatch, instrumented):
    """자동 경로도 같은 분기다 — 한쪽만 고치면 다른 쪽이 그대로 남는 게 B29의 본질이다."""
    from scheduler import jobs
    monkeypatch.setattr("services.guru_scraper.scrape_all_managers",
                        lambda *a, **k: ([{"id": "1"}], [{"id": "1"}]))
    monkeypatch.setattr(jobs.storage, "save_guru_managers", lambda d: _stats(held=43, stale=43))

    with caplog.at_level(logging.WARNING):
        jobs._run_guru_crawl()

    assert any("보류" in r.message for r in caplog.records)
    assert _status(instrumented) == "partial"


def test_scheduler_crawl_swallowed_exception_records_failed_T274(monkeypatch, instrumented):
    from scheduler import jobs

    def _boom(*a, **k):
        raise RuntimeError("dataroma down")

    monkeypatch.setattr("services.guru_scraper.scrape_all_managers", _boom)

    jobs._run_guru_crawl()

    assert _status(instrumented) == "failed"


def test_scheduler_crawl_dropped_stays_success_T274(monkeypatch, instrumented):
    from scheduler import jobs
    monkeypatch.setattr("services.guru_scraper.scrape_all_managers",
                        lambda *a, **k: ([{"id": "1"}], [{"id": "1"}]))
    monkeypatch.setattr(jobs.storage, "save_guru_managers", lambda d: _stats(dropped=3))

    jobs._run_guru_crawl()

    assert _status(instrumented) == "success"

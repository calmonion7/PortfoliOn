import sys
from contextlib import contextmanager
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

# guru router만 독립적으로 테스트하는 앱
from routers.guru import router
from auth import require_admin, get_current_user
test_app = FastAPI()
test_app.include_router(router)
test_app.dependency_overrides[require_admin] = lambda: "test-user-id"
test_app.dependency_overrides[get_current_user] = lambda: "test-user-id"
client = TestClient(test_app)


@pytest.fixture(autouse=True)
def _stub_job_runs(monkeypatch):
    """백그라운드 크롤 워커에 추가된 job_runs.record 계측이 테스트 DB를 건드리지 않도록 no-op로 대체."""
    import services.job_runs as job_runs

    @contextmanager
    def _noop(job_id, trigger):
        yield 1

    monkeypatch.setattr(job_runs, "record", _noop)

SAMPLE_DATA = {
    "last_updated": "2026-05-14T10:00:00",
    "managers": [
        {
            "id": "brk", "name": "Warren Buffett", "firm": "Berkshire Hathaway",
            "portfolio_value": 350_000_000_000, "num_stocks": 45,
            "top10": [
                {"rank": 1, "ticker": "AAPL", "name": "Apple Inc.", "name_kr": "애플", "weight_pct": 42.1},
                {"rank": 2, "ticker": "BAC",  "name": "Bank of America", "name_kr": "", "weight_pct": 10.3},
            ],
            "holdings": [
                {"rank": 1, "ticker": "AAPL", "name": "Apple Inc.", "weight_pct": 42.1},
                {"rank": 2, "ticker": "BAC", "name": "Bank of America", "weight_pct": 10.3},
                {"rank": 3, "ticker": "KO", "name": "Coca-Cola", "weight_pct": 8.0},
            ],
            "period": "Q1 2026", "portfolio_date": "2026-03-31",
            "sold_out": [{"ticker": "HLT", "name": "Hilton Worldwide", "port_pct": 5.6}],
        }
    ],
}


def test_get_managers_returns_stored_data():
    with patch("routers.guru.storage.get_guru_managers", return_value=SAMPLE_DATA):
        r = client.get("/api/guru/managers")
    assert r.status_code == 200
    body = r.json()
    assert body["managers"][0]["name"] == "Warren Buffett"
    # holdings 는 목록 응답에서 벗겨짐
    assert "holdings" not in body["managers"][0]
    # top10 은 그대로
    assert body["managers"][0]["top10"] == SAMPLE_DATA["managers"][0]["top10"]
    # sold_out 도 상세 전용 계층이라 목록에서 벗겨짐(task#239)
    assert "sold_out" not in body["managers"][0]
    # 분기 표기는 목록에도 남는다(카드에서 쓸 수 있어야 함)
    assert body["managers"][0]["period"] == "Q1 2026"
    # 저장 데이터 자체는 mutate 되지 않음
    assert "holdings" in SAMPLE_DATA["managers"][0]
    assert "sold_out" in SAMPLE_DATA["managers"][0]


def test_get_manager_detail_includes_sold_out_and_period():
    with patch("routers.guru.storage.get_guru_managers", return_value=SAMPLE_DATA):
        r = client.get("/api/guru/managers/brk")
    body = r.json()
    assert body["sold_out"] == SAMPLE_DATA["managers"][0]["sold_out"]
    assert body["period"] == "Q1 2026"
    assert body["portfolio_date"] == "2026-03-31"


def test_get_manager_detail_includes_holdings():
    with patch("routers.guru.storage.get_guru_managers", return_value=SAMPLE_DATA):
        r = client.get("/api/guru/managers/brk")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "brk"
    assert body["holdings"] == SAMPLE_DATA["managers"][0]["holdings"]


def test_get_manager_detail_404_for_unknown_id():
    with patch("routers.guru.storage.get_guru_managers", return_value=SAMPLE_DATA):
        r = client.get("/api/guru/managers/unknown")
    assert r.status_code == 404


def test_get_managers_returns_empty_default():
    with patch("routers.guru.storage.get_guru_managers", return_value={"last_updated": None, "managers": []}):
        r = client.get("/api/guru/managers")
    assert r.status_code == 200
    assert r.json()["managers"] == []


def test_stats_popularity():
    with patch("routers.guru.storage.get_guru_managers", return_value=SAMPLE_DATA):
        r = client.get("/api/guru/stats/popularity")
    assert r.status_code == 200
    assert r.json()[0]["ticker"] == "AAPL"
    assert r.json()[0]["count"] == 1


def test_stats_weighted():
    with patch("routers.guru.storage.get_guru_managers", return_value=SAMPLE_DATA):
        r = client.get("/api/guru/stats/weighted")
    assert r.status_code == 200
    assert r.json()[0]["ticker"] == "AAPL"
    assert r.json()[0]["score"] == pytest.approx(1.0, abs=0.001)


def test_stats_allocation_includes_last_updated_passthrough():
    with patch("routers.guru.storage.get_guru_managers", return_value=SAMPLE_DATA):
        r = client.get("/api/guru/stats/allocation")
    assert r.status_code == 200
    assert r.json()["last_updated"] == SAMPLE_DATA["last_updated"]


def test_stats_allocation_passes_top_query_param_to_service():
    with patch("routers.guru.storage.get_guru_managers", return_value=SAMPLE_DATA):
        with patch("routers.guru.compute_allocation", return_value={"rows": []}) as mock_alloc:
            r = client.get("/api/guru/stats/allocation?top=10")
    assert r.status_code == 200
    mock_alloc.assert_called_once_with(SAMPLE_DATA["managers"], top=10)


def test_stats_allocation_rejects_non_positive_top():
    assert client.get("/api/guru/stats/allocation?top=0").status_code == 422
    assert client.get("/api/guru/stats/allocation?top=-1").status_code == 422


def test_crawl_progress_initial():
    r = client.get("/api/guru/crawl/progress")
    assert r.status_code == 200
    data = r.json()
    assert all(k in data for k in ("running", "done", "total", "current"))


def test_start_crawl_returns_202():
    with patch("routers.guru.scrape_all_managers", return_value=[]):
        with patch("routers.guru.storage.save_guru_managers"):
            r = client.post("/api/guru/crawl")
    assert r.status_code == 202


# ── 크롤 종료 사유(result) — 저장 스킵을 초록 "완료"와 구분하기 위한 관측 (task#262) ──
# 프론트(GuruCrawlNow)는 이 필드로 문구·색을 가른다. 없으면 done>=total만 보고 무조건 초록.

def _run_crawl_and_get_result(monkeypatch, *, managers, saved):
    import routers.guru as guru
    monkeypatch.setattr(guru, "scrape_all_managers", lambda *a, **k: managers)
    monkeypatch.setattr(guru.storage, "save_guru_managers", lambda payload: saved)
    guru._run_crawl()
    return guru._progress.get()


def test_run_crawl_records_saved_on_success(monkeypatch):
    state = _run_crawl_and_get_result(monkeypatch, managers=[{"id": "brk"}], saved=True)
    assert state["result"] == "saved" and state["running"] is False


def test_run_crawl_records_skipped_when_save_declined(monkeypatch):
    """빈 스크랩 → save_guru_managers False(저장 생략·직전값 유지)를 'saved'와 구분해 기록."""
    state = _run_crawl_and_get_result(monkeypatch, managers=[], saved=False)
    assert state["result"] == "skipped" and state["running"] is False


def test_run_crawl_records_failed_on_exception(monkeypatch):
    import routers.guru as guru

    def _boom(*a, **k):
        raise RuntimeError("dataroma down")

    monkeypatch.setattr(guru, "scrape_all_managers", _boom)
    guru._run_crawl()
    state = guru._progress.get()
    # 예외로 죽으면 total이 0이라 done>=total 종료 조건이 영영 발화하지 않는다 — result가 유일한 신호.
    assert state["result"] == "failed" and state["running"] is False


def test_start_crawl_resets_stale_result_before_background_task(monkeypatch):
    """BackgroundTasks는 응답 *후* 실행 — POST 응답 시점에 직전 실행의 result가 남아 있으면
    폴러가 즉시 완료로 오판한다. 핸들러가 리셋하는지 못박는다."""
    import routers.guru as guru
    guru._progress.set(running=False, done=5, total=5, result="saved")   # 직전 실행 잔재
    captured = {}

    class _NoRunTasks:
        def add_task(self, fn, *a, **k):
            captured["state"] = guru._progress.get()   # 배치 실행 전 상태 = 응답 시점 상태

    guru.start_crawl(_NoRunTasks(), "admin-id")
    assert captured["state"]["result"] is None and captured["state"]["running"] is True


# --- 403 test: crawl blocked for non-admin ---

from auth import get_current_user as _get_current_user

_nonadmin_guru_app = FastAPI()
_nonadmin_guru_app.include_router(router)
_nonadmin_guru_app.dependency_overrides[_get_current_user] = lambda: "user-id"
_nonadmin_guru_client = TestClient(_nonadmin_guru_app)


def test_crawl_blocked_for_non_admin():
    with patch("auth.auth_service.get_user_by_id", return_value={"role": "user"}):
        r = _nonadmin_guru_client.post("/api/guru/crawl")
    assert r.status_code == 403

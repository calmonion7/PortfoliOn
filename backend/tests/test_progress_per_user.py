"""B77 — 리포트 진행상태의 사용자별 분리 + 이중 실행 거부.

결함(S1 판별): `ProgressTracker`의 개별 메서드엔 이미 락이 있다. 문제는 락 부재가 아니라
① `start()`가 진행 중 여부를 보지 않고 무조건 리셋한다 ② 두 진입점(`generate_all`·
`generate_one`)이 `running`을 확인하지 않는다 ③ `routers/report.py`의 `_progress`가
**사용자 무관 전역 싱글턴**이다. `generate_one`은 `Depends(get_current_user)`만 걸려
admin 한정이 아니므로 일반 사용자 둘이 실제로 부딪힌다.

수정 전 실측 red 증거(현재 코드에 이 파일과 같은 하니스를 씌워 확인):

  ⓐ 두 사용자 동시 생성 — in-flight 시점에 둘 다 같은 상태를 본다
     user-a → {'running': True, 'done': 0, 'total': 1, 'current': 'MSFT', ...}   ← user-b의 종목
     user-b → {'running': True, 'done': 0, 'total': 1, 'current': 'MSFT', ...}
     최종에도 둘 다 {'running': False, 'done': 2, 'total': 1, ...}

  ⓑ/ⓒ 같은 사용자 이중 요청 — 거부가 없어 statuses == [202, 202] 이고
     최종 진행상태가 {'running': False, 'done': 2, 'total': 1, 'current': '', 'failed': []}
     — 즉 `done > total` 불변식이 깨진다.

⑶에 따라 겹침은 `threading.Barrier`/세마포어로 강제한다("운 좋게 안 겹쳤다"로 통과하는 축을
만들지 않기 위해). ⑷에 따라 정상 입력 대조군(단일 사용자 단일 생성 + 응답 shape)을 쌍으로 둔다.
"""
import threading
from contextlib import contextmanager

import pytest
from fastapi import FastAPI, Header
from fastapi.testclient import TestClient
from unittest.mock import patch

import routers.report as report
from routers.report import router
from services.progress import ProgressTracker, ProgressRegistry
from auth import (
    get_current_user,
    require_admin,
    get_current_user_or_api_key,
    require_admin_or_api_key,
)

_PROGRESS_KEYS = {"running", "done", "total", "current", "failed"}


@pytest.fixture(autouse=True)
def _stub_job_runs(monkeypatch):
    """백그라운드 워커의 job_runs 계측이 테스트 DB를 건드리지 않도록 no-op."""
    import services.job_runs as job_runs

    @contextmanager
    def _noop(job_id, trigger):
        yield 1

    monkeypatch.setattr(job_runs, "record", _noop)


@pytest.fixture(autouse=True)
def _fresh_registry(monkeypatch):
    """사용자별 트래커 보관소를 테스트마다 새로 준다.

    전역 싱글턴 + 409 게이트는 파일 간 실행 순서 오염을 만든다
    (test_guru_crawl_completeness.py:111이 이미 그 함정을 기록해 뒀다) — 여기서 격리한다.
    """
    monkeypatch.setattr(report, "_progress_by_user", ProgressRegistry())


def _make_app():
    """X-Test-User 헤더로 호출자를 고르는 앱 — 사용자별 분리를 재려면 사용자가 둘 필요하다."""
    app = FastAPI()
    app.include_router(router)

    def _user(x_test_user: str = Header("user-a")):
        return x_test_user

    for dep in (get_current_user, require_admin, get_current_user_or_api_key, require_admin_or_api_key):
        app.dependency_overrides[dep] = _user
    return app


app = _make_app()


def _H(uid):
    return {"X-Test-User": uid}


def _progress_of(uid):
    return TestClient(app).get("/api/report/progress", headers=_H(uid)).json()


def _patch_generation(fake_gen, stock_for):
    """생성 파이프라인의 부수효과를 전부 막고 fake_gen만 남긴다."""
    return (
        patch("routers.report.storage.get_all_stocks", side_effect=stock_for),
        patch("routers.report.report_generator.generate_report_with_retry", side_effect=fake_gen),
        patch("routers.report.cache_svc.invalidate"),
        patch("routers.report._pipeline.run_daily"),
    )


# ── 대조군 (⑷) ──────────────────────────────────────────────────────────────

def test_progress_response_shape_unchanged():
    """응답 shape은 그대로다 — 한 번도 생성하지 않은 사용자도 초기 상태를 받는다."""
    state = _progress_of("nobody")
    assert set(state) == _PROGRESS_KEYS
    assert state == {"running": False, "done": 0, "total": 0, "current": "", "failed": []}


def test_single_user_single_generation_unchanged():
    """단일 사용자 단일 생성은 이전과 같게 동작한다(202 → done 1/total 1 → running False)."""
    stock = {"ticker": "AAPL", "name": "Apple", "market": "US", "exchange": ""}
    ctxs = _patch_generation(lambda s, target_date=None: None, lambda uid: [stock])
    with ctxs[0], ctxs[1], ctxs[2], ctxs[3]:
        resp = TestClient(app).post("/api/report/generate/AAPL", headers=_H("solo"))
    assert resp.status_code == 202
    assert _progress_of("solo") == {
        "running": False, "done": 1, "total": 1, "current": "", "failed": [],
    }


# ── ⓐ 두 사용자의 진행상태가 서로를 덮지 않는다 ──────────────────────────────

def test_two_users_generate_progress_isolated():
    stocks = {
        "user-a": [{"ticker": "AAPL", "name": "Apple", "market": "US", "exchange": ""}],
        "user-b": [{"ticker": "MSFT", "name": "Microsoft", "market": "US", "exchange": ""}],
    }
    both_in_flight = threading.Barrier(3, timeout=10)
    release = threading.Event()

    def fake_gen(stock, target_date=None):
        both_in_flight.wait()      # 두 사용자의 생성을 강제로 겹친다 (⑶)
        release.wait(10)

    def post(uid, ticker):
        TestClient(app).post(f"/api/report/generate/{ticker}", headers=_H(uid))

    ctxs = _patch_generation(fake_gen, lambda uid: stocks[uid])
    with ctxs[0], ctxs[1], ctxs[2], ctxs[3]:
        t1 = threading.Thread(target=post, args=("user-a", "AAPL"))
        t2 = threading.Thread(target=post, args=("user-b", "MSFT"))
        t1.start(); t2.start()
        both_in_flight.wait()
        mid_a, mid_b = _progress_of("user-a"), _progress_of("user-b")
        release.set()
        t1.join(10); t2.join(10)
        final_a, final_b = _progress_of("user-a"), _progress_of("user-b")

    # in-flight 시점: 각자 자기 종목을 본다 (수정 전엔 둘 다 'MSFT'였다)
    assert (mid_a["running"], mid_a["total"], mid_a["current"]) == (True, 1, "AAPL")
    assert (mid_b["running"], mid_b["total"], mid_b["current"]) == (True, 1, "MSFT")
    # 최종: 각자 자기 몫만 센다 (수정 전엔 둘 다 done=2 / total=1)
    assert (final_a["done"], final_a["total"], final_a["running"]) == (1, 1, False)
    assert (final_b["done"], final_b["total"], final_b["running"]) == (1, 1, False)


def test_one_users_failure_does_not_leak_to_another():
    """한쪽의 실패 목록이 다른 사용자에게 보이지 않는다."""
    stocks = {
        "user-a": [{"ticker": "AAPL", "name": "Apple", "market": "US", "exchange": ""}],
        "user-b": [{"ticker": "MSFT", "name": "Microsoft", "market": "US", "exchange": ""}],
    }

    def fake_gen(stock, target_date=None):
        if stock["ticker"] == "AAPL":
            raise RuntimeError("api down")

    ctxs = _patch_generation(fake_gen, lambda uid: stocks[uid])
    with ctxs[0], ctxs[1], ctxs[2], ctxs[3]:
        c = TestClient(app)
        c.post("/api/report/generate/AAPL", headers=_H("user-a"))
        c.post("/api/report/generate/MSFT", headers=_H("user-b"))

    assert [f["ticker"] for f in _progress_of("user-a")["failed"]] == ["AAPL"]
    assert _progress_of("user-b")["failed"] == []


# ── ⓑ done > total 불변식 ────────────────────────────────────────────────────

def test_same_user_concurrent_generate_never_exceeds_total():
    """같은 사용자의 동시 요청이 겹쳐도 done > total 이 되지 않는다.

    수정 전: statuses == [202, 202] 이고 최종 상태가
    {'running': False, 'done': 2, 'total': 1, 'current': '', 'failed': []}.
    """
    stock = {"ticker": "AAPL", "name": "Apple", "market": "US", "exchange": ""}
    entered = threading.Semaphore(0)
    release = threading.Event()
    statuses = []

    def fake_gen(s, target_date=None):
        entered.release()
        release.wait(10)

    def post():
        r = TestClient(app).post("/api/report/generate/AAPL", headers=_H("dup"))
        statuses.append(r.status_code)

    ctxs = _patch_generation(fake_gen, lambda uid: [stock])
    with ctxs[0], ctxs[1], ctxs[2], ctxs[3]:
        t1 = threading.Thread(target=post)
        t2 = threading.Thread(target=post)
        t1.start(); t2.start()
        assert entered.acquire(timeout=10), "첫 생성이 in-flight가 되지 않았다"
        # 첫 생성을 붙잡아 둔 동안 두 번째가 in-flight가 되면 두 실행이 겹친 것이다 (⑶)
        second_in_flight = entered.acquire(timeout=1.5)
        release.set()
        t1.join(10); t2.join(10)

    assert second_in_flight is False, "두 번째 생성이 같은 트래커에서 동시에 돌았다"
    assert sorted(statuses) == [202, 409]
    final = _progress_of("dup")
    assert final["done"] <= final["total"]
    assert final == {"running": False, "done": 1, "total": 1, "current": "", "failed": []}


def test_multi_market_batch_finishes_once():
    """market별로 그룹을 나눠 생성해도 finish()는 마지막 그룹 뒤 한 번만 돈다.

    그룹마다 finish하면 첫 그룹 완료 순간 running=False가 되어, 그 창의 재요청이
    남은 그룹과 겹치며 다시 done > total 이 된다.
    """
    portfolio = {
        "stocks": [
            {"ticker": "005930", "name": "삼성전자", "market": "KR", "exchange": "KS"},
            {"ticker": "AAPL", "name": "Apple", "market": "US", "exchange": ""},
        ],
        "watchlist": [],
    }
    seen_running = []

    def fake_gen(stock, target_date=None):
        seen_running.append(report._progress_by_user.peek("admin")["running"])

    with patch("routers.report.storage.get_global_portfolio", return_value=portfolio), \
         patch("routers.report.storage.expected_report_date", return_value="2026-08-21"), \
         patch("routers.report.report_generator.generate_report_with_retry", side_effect=fake_gen), \
         patch("routers.report.cache_svc.invalidate"), \
         patch("routers.report._pipeline.run_daily"):
        resp = TestClient(app).post("/api/report/generate", headers=_H("admin"))

    assert resp.status_code == 202
    assert seen_running == [True, True], "그룹 사이에서 running이 꺼졌다"
    assert _progress_of("admin") == {
        "running": False, "done": 2, "total": 2, "current": "", "failed": [],
    }


# ── ⓒ 이중 클릭 거부 ────────────────────────────────────────────────────────

def test_same_user_double_click_rejected_409():
    stock = {"ticker": "AAPL", "name": "Apple", "market": "US", "exchange": ""}
    in_flight = threading.Event()
    release = threading.Event()
    first = {}

    def fake_gen(s, target_date=None):
        in_flight.set()
        release.wait(10)

    def post():
        first["status"] = TestClient(app).post("/api/report/generate/AAPL", headers=_H("dbl")).status_code

    ctxs = _patch_generation(fake_gen, lambda uid: [stock])
    with ctxs[0], ctxs[1], ctxs[2], ctxs[3]:
        t = threading.Thread(target=post)
        t.start()
        assert in_flight.wait(10), "첫 생성이 in-flight가 되지 않았다"
        second = TestClient(app).post("/api/report/generate/AAPL", headers=_H("dbl"))
        release.set()
        t.join(10)

    assert first["status"] == 202
    assert second.status_code == 409
    # 거부는 진행 중 상태를 건드리지 않는다 — 첫 생성이 그대로 완주한다
    assert _progress_of("dbl") == {
        "running": False, "done": 1, "total": 1, "current": "", "failed": [],
    }


def test_another_user_is_not_blocked_by_running_generation():
    """대조군 — 이중 클릭 거부가 *다른* 사용자를 막지는 않는다."""
    stocks = {
        "busy": [{"ticker": "AAPL", "name": "Apple", "market": "US", "exchange": ""}],
        "other": [{"ticker": "MSFT", "name": "Microsoft", "market": "US", "exchange": ""}],
    }
    in_flight = threading.Event()
    release = threading.Event()

    def fake_gen(stock, target_date=None):
        if stock["ticker"] == "AAPL":
            in_flight.set()
            release.wait(10)

    ctxs = _patch_generation(fake_gen, lambda uid: stocks[uid])
    with ctxs[0], ctxs[1], ctxs[2], ctxs[3]:
        t = threading.Thread(
            target=lambda: TestClient(app).post("/api/report/generate/AAPL", headers=_H("busy"))
        )
        t.start()
        assert in_flight.wait(10)
        other = TestClient(app).post("/api/report/generate/MSFT", headers=_H("other"))
        release.set()
        t.join(10)

    assert other.status_code == 202


def test_stuck_generation_does_not_lock_user_out():
    """생성 본문이 예외로 끝나도 running이 남지 않는다 — 남으면 그 사용자는 영구히 409다."""
    stock = {"ticker": "AAPL", "name": "Apple", "market": "US", "exchange": ""}
    ctxs = _patch_generation(lambda s, target_date=None: None, lambda uid: [stock])
    with ctxs[0], ctxs[1], ctxs[2], ctxs[3], \
         patch("routers.report.parallel_map", side_effect=RuntimeError("worker pool down")):
        with pytest.raises(RuntimeError):
            TestClient(app).post("/api/report/generate/AAPL", headers=_H("stuck"))
    assert _progress_of("stuck")["running"] is False


# ── ProgressTracker / ProgressRegistry 단위 축 ──────────────────────────────

def test_try_start_rejects_while_running_and_allows_when_idle():
    t = ProgressTracker()
    assert t.try_start(5) is True
    t.increment()
    assert t.try_start(1) is False, "진행 중인데 재시작을 허용했다"
    # 거부는 상태를 건드리지 않는다 (start()의 무조건 리셋과 대비)
    assert (t.get()["done"], t.get()["total"]) == (1, 5)
    t.finish()
    assert t.try_start(1) is True          # 대조군: 유휴 상태면 시작한다
    assert (t.get()["done"], t.get()["total"]) == (0, 1)


def test_try_start_is_exclusive_under_contention():
    """동시 try_start 중 정확히 하나만 성공한다 (⑶ Barrier로 강제 인터리빙)."""
    t = ProgressTracker()
    gate = threading.Barrier(8, timeout=10)
    wins = []

    def racer():
        gate.wait()
        wins.append(t.try_start(1))

    threads = [threading.Thread(target=racer) for _ in range(8)]
    for th in threads:
        th.start()
    for th in threads:
        th.join(10)
    assert wins.count(True) == 1
    assert wins.count(False) == 7


def test_get_returns_detached_failed_list():
    """get()이 내부 failed 리스트를 그대로 내주면 직렬화 중 append가 끼어든다."""
    t = ProgressTracker()
    t.start(1)
    snapshot = t.get()
    t.add_failed("AAPL", "boom")
    assert snapshot["failed"] == []
    assert t.get()["failed"] == [{"ticker": "AAPL", "error": "boom"}]


def test_registry_returns_same_tracker_per_key():
    r = ProgressRegistry()
    assert r.for_key("u1") is r.for_key("u1")
    assert r.for_key("u1") is not r.for_key("u2")


def test_registry_peek_does_not_register():
    """폴링만 하는 사용자가 트래커를 쌓지 않는다(메모리 상한의 전제)."""
    r = ProgressRegistry()
    assert r.peek("poller") == {
        "running": False, "done": 0, "total": 0, "current": "", "failed": [],
    }
    assert r.size() == 0


def test_registry_is_bounded_but_keeps_running_trackers():
    """상한을 두되 진행 중 트래커는 축출하지 않는다 — 축출하면 그 사용자 진행률이 0으로 돌아간다."""
    r = ProgressRegistry()
    r.for_key("runner").try_start(3)
    for i in range(ProgressRegistry._MAX + 20):
        r.for_key(f"idle-{i}")
    assert r.size() <= ProgressRegistry._MAX
    assert r.peek("runner") == {
        "running": True, "done": 0, "total": 3, "current": "", "failed": [],
    }


def test_registry_carries_extra_keys():
    """extra 스키마(created=0 등)를 트래커에 그대로 전달한다."""
    r = ProgressRegistry(created=0)
    assert r.peek("u")["created"] == 0
    assert r.for_key("u").get()["created"] == 0


# ══════════════════════════════════════════════════════════════════════════════
# 적대 검토 수복 (task#330 review) — `running=True` 고착에서 빠져나올 길
# ══════════════════════════════════════════════════════════════════════════════
# `try_start`가 이중 실행을 거부하게 되면서 「이중 클릭이 진행상태를 리셋하며 자기치유하던」
# 성질이 사라졌다. 그런데 `running=True`를 회수하는 경로는 `finish()` 하나뿐이고,
# **백그라운드 태스크가 실행되지 않는 경로가 실재한다** — starlette는 응답 body를 flush한
# **뒤** `await self.background()`를 호출하므로(`starlette/responses.py`: `send(...body)`
# 다음 줄), flush 중 클라이언트가 끊기면 `_run_generation`이 시작조차 하지 않고
# 아무도 `finish()`를 부르지 않는다 → 그 사용자는 **프로세스 재시작 전까지 영구 409**다.
# 기존 `test_stuck_generation_does_not_lock_user_out`은 `parallel_map`이 예외를 내는
# 경로만 덮어(그 경로는 try/finally가 이미 회수한다) 이 시나리오에 원리적으로 블라인드다.


def test_try_start_reclaims_tracker_with_no_activity():
    """활동 없이 상한을 넘긴 `running=True`는 회수한다(영구 409 탈출구)."""
    t = ProgressTracker()
    assert t.try_start(3) is True
    assert t.try_start(3) is False, "대조군 — 방금 시작한 것을 회수하면 이중 실행이 뚫린다"

    # 시계에 의존하지 않는 결정적 위조 — 마지막 활동을 상한 이전으로 되돌린다.
    t._activity_at -= ProgressTracker._STALE_AFTER + 1

    assert t.try_start(1) is True, "고착된 트래커를 회수하지 못했다 — 사용자가 영구 409다"
    assert t.get()["total"] == 1


def test_progressing_tracker_is_never_reclaimed():
    """대조군 — 오래 걸리는 생성도 **진행이 있으면** 회수하지 않는다."""
    t = ProgressTracker()
    t.try_start(100)
    t._activity_at -= ProgressTracker._STALE_AFTER + 1
    t.increment()                      # 진행 신호 → 활동 시각 갱신
    assert t.try_start(1) is False

    t._activity_at -= ProgressTracker._STALE_AFTER + 1
    t.set(current="AAPL")              # set도 진행 신호다
    assert t.try_start(1) is False


def test_stuck_tracker_reclaim_is_exclusive_under_contention():
    """고착 회수도 정확히 한 명만 성공한다 (⑶ Barrier로 강제 인터리빙)."""
    t = ProgressTracker()
    t.try_start(1)
    t._activity_at -= ProgressTracker._STALE_AFTER + 1
    gate = threading.Barrier(8, timeout=10)
    wins = []

    def racer():
        gate.wait()
        wins.append(t.try_start(1))

    threads = [threading.Thread(target=racer) for _ in range(8)]
    for th in threads:
        th.start()
    for th in threads:
        th.join(10)

    assert wins.count(True) == 1
    assert wins.count(False) == 7


def test_registry_evicts_stuck_tracker_but_not_live_one():
    """고착 트래커는 유휴로 간주해 축출 대상이 된다 — 아니면 상한이 영구히 오염된다."""
    r = ProgressRegistry()
    r.for_key("stuck").try_start(3)
    r.for_key("stuck")._activity_at -= ProgressTracker._STALE_AFTER + 1
    r.for_key("live").try_start(3)

    for i in range(ProgressRegistry._MAX + 20):
        r.for_key(f"idle-{i}")

    assert r.size() <= ProgressRegistry._MAX
    assert r.peek("live")["running"] is True, "진행 중 트래커를 축출했다"

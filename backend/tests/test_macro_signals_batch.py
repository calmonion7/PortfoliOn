"""task #53 S2: macro_signals_fetch 일배치 + GET /api/market/macro-signals.

배치 id 4표면 일관: registry read·schedule_desc·job_runs.record(auto+manual)·테스트.
market=해외(FRED=US 출처국, ADR-0013). 요청경로 외부 FRED 라이브 호출 0(저장값만).
"""
import sys
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from unittest.mock import patch


# ── 배치 레지스트리 엔트리 (market=해외) ──────────────────────────────────────

def test_registry_has_macro_signals_fetch():
    from services import batch_registry
    e = batch_registry.get_batch("macro_signals_fetch")
    assert e is not None
    assert e["market"] == "US"
    assert e["category"] == "market"
    assert e["editable"] is True
    assert e["trigger_kinds"] == ["auto", "manual"]
    assert e["scheduler_job_id"] == "macro_signals_fetch"
    assert e["timezone"] == "Asia/Seoul"
    assert e["manual_endpoint"] == "/api/market/refresh-macro-signals"
    assert e["default_schedule"] == {"enabled": True, "type": "daily", "time": "06:00"}


def test_registry_count_grows_by_one():
    from services import batch_registry
    # task 46 기준 19 + macro_signals_fetch + supply_score_fetch + insider_fetch
    #   + recommendation_kr + recommendation_us + agm_fetch + us_supply_fetch
    #   + us_sector_fetch + beta_fetch + kospi_signal_fetch + business_formation_fetch
    #   + labor_surveys_fetch + trimmed_inflation_fetch + fx_fetch = 33
    assert len(batch_registry.BATCHES) == 33


def test_macro_signals_counts_as_overseas():
    from services import batch_registry
    overseas = [b for b in batch_registry.BATCHES if b["market"] == "US"]
    assert "macro_signals_fetch" in {b["id"] for b in overseas}


# ── scheduler 잡 배선 (auto record + 4종 수집 호출) ──────────────────────────

class _FakeRun:
    """`job_runs.record`가 주는 핸들 흉내 — set_status 호출을 같은 리스트에 기록한다.

    ⚠️ 이전 형태는 `yield 1`(int)이었다. `as run` 배선이 들어오면 int에는 set_status가 없어
    그 계약이 깨진다 — 「가짜 CM으로 함수를 통째 대체한 테스트 헬퍼」가 계약 변경의 진짜
    파장이라는 것(task#274)의 실사례다. 기존 8축의 `(job_id, trigger) in spy` 단언은 그대로 산다.
    """

    def __init__(self, calls):
        self._calls = calls

    def set_status(self, status, error=None):
        self._calls.append(("set_status", status, error))


@pytest.fixture
def spy(monkeypatch):
    calls = []

    @contextmanager
    def fake_record(job_id, trigger):
        calls.append((job_id, trigger))
        yield _FakeRun(calls)

    import services.job_runs as job_runs
    monkeypatch.setattr(job_runs, "record", fake_record)
    return calls


def _statuses(spy):
    return [c for c in spy if c[0] == "set_status"]


_KEY_ERR = "FRED_API_KEY 환경변수가 필요합니다."
_OK_PAYLOAD = {"yield_curve": [{"date": "2026-06-10", "value": -0.2}],
               "hy_spread": [], "m2": [], "fed_funds": [],
               "signals": {"inverted": True, "credit_stress": None}}


def test_job_funcs_wires_macro_signals_fetch():
    import scheduler
    assert "macro_signals_fetch" in scheduler._JOB_FUNCS


def test_refresh_macro_signals_records_auto_and_fetches(spy, monkeypatch):
    import scheduler
    called = []
    monkeypatch.setattr("services.market_indicators._fetch_and_save_macro_signals",
                        lambda: called.append("fetch"))
    scheduler._refresh_macro_signals()
    assert ("macro_signals_fetch", "auto") in spy
    assert called == ["fetch"]


# ── 수동 엔드포인트 (admin, manual record) ───────────────────────────────────

def _admin_client(router):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from auth import require_admin
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_admin] = lambda: "admin-id"
    return TestClient(app)


def test_manual_refresh_macro_signals_records_manual(spy, monkeypatch):
    import routers.market_indicators as mi
    called = []
    monkeypatch.setattr(mi, "_fetch_and_save_macro_signals",
                        lambda: called.append("fetch") or {
                            "yield_curve": [{"date": "2026-06-10", "value": -0.2}],
                            "hy_spread": [], "m2": [], "fed_funds": [],
                            "signals": {"inverted": True, "credit_stress": None},
                        })
    resp = _admin_client(mi.router).post("/api/market/refresh-macro-signals")
    assert resp.status_code == 200
    assert ("macro_signals_fetch", "manual") in spy
    assert called == ["fetch"]


# ── GET /api/market/macro-signals (저장값만, 라이브 FRED 0) ────────────────────

def test_get_macro_signals_endpoint_returns_stored(monkeypatch):
    import routers.market_indicators as mi
    stored = {
        "yield_curve": [{"date": "2026-06-10", "value": -0.2}],
        "hy_spread": [{"date": "2026-06-10", "value": 6.1}],
        "m2": [{"date": "2026-05-01", "value": 21000.0}],
        "fed_funds": [{"date": "2026-06-10", "value": 4.33}],
        "signals": {"inverted": True, "credit_stress": True},
    }
    monkeypatch.setattr(mi, "get_macro_signals", lambda: stored)

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from auth import get_current_user
    app = FastAPI()
    app.include_router(mi.router)
    app.dependency_overrides[get_current_user] = lambda: "test-user"
    resp = TestClient(app).get("/api/market/macro-signals")
    assert resp.status_code == 200
    body = resp.json()
    assert body["signals"]["inverted"] is True
    assert body["yield_curve"][0]["value"] == pytest.approx(-0.2, abs=0.001)


def test_batches_endpoint_exposes_macro_signals_overseas(client, monkeypatch):
    """GET /api/batches 가 macro_signals_fetch를 해외(US) 배치로 노출."""
    with patch("routers.batches.job_runs.recent", return_value=[]), \
         patch("routers.batches.storage.get_batch_schedule", return_value=None), \
         patch.object(__import__("scheduler"), "_scheduler") as mock_sched:
        mock_sched.get_job.return_value = None
        resp = client.get("/api/batches")
    assert resp.status_code == 200
    by_id = {b["id"]: b for b in resp.json()}
    assert "macro_signals_fetch" in by_id
    assert by_id["macro_signals_fetch"]["market"] == "US"


# ── B6: 실패가 배치현황에 「성공」으로 기록되던 것 (task#341) ─────────────────
# `job_runs.record`는 **본문이 예외를 전파할 때만** failed를 기록한다. macro는 키 미설정·수집
# 실패를 예외 없이 dict로 반환하므로, 두 레인이 그 반환값을 검사하지 않으면 매 실행이 success다
# — FRED가 며칠 죽어도 배치현황은 초록이고 저장값만 무기한 stale해진다.
# 형제 참조 구현: econ.py + jobs._refresh_monthly_us + routers.refresh_econ.


def test_refresh_macro_signals_records_skipped_when_key_missing(spy, monkeypatch):
    """auto 레인 — 키 미설정이 success로 기록되면 안 된다."""
    import scheduler
    monkeypatch.setattr("services.market_indicators._fetch_and_save_macro_signals",
                        lambda: {"error": _KEY_ERR})
    scheduler._refresh_macro_signals()
    assert ("macro_signals_fetch", "auto") in spy
    assert _statuses(spy) == [("set_status", "skipped", _KEY_ERR)]


def test_manual_refresh_macro_signals_reports_skipped_when_key_missing(spy, monkeypatch):
    """manual 레인 — 현행은 `{"error": …}`에 .get("yield_curve", [])를 적용해
    **ok: True, yield_curve_points: 0**을 낸다. 0건과 「키가 없어 아무것도 안 했다」가
    구별되지 않으므로 status를 함께 돌려준다(형제 refresh_econ과 동형)."""
    import routers.market_indicators as mi
    monkeypatch.setattr(mi, "_fetch_and_save_macro_signals", lambda: {"error": _KEY_ERR})
    resp = _admin_client(mi.router).post("/api/market/refresh-macro-signals")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert body["status"] == "skipped"
    assert body["error"] == _KEY_ERR
    assert ("set_status", "skipped", _KEY_ERR) in spy


def test_macro_fetch_failure_is_skipped_and_preserves_stored(monkeypatch):
    """수집 전량 실패 — 저장을 생략하고(직전값 파괴 금지) `_status`로 그 사실을 말한다."""
    from services.market_indicators import macro
    stored = {"yield_curve": [{"date": "2026-06-10", "value": -0.2}],
              "hy_spread": [], "m2": [], "fed_funds": [], "signals": {"inverted": True}}
    saved = []
    monkeypatch.setenv("FRED_API_KEY", "dummy")
    monkeypatch.setattr(macro, "_mc_load", lambda key: {"data": stored})
    monkeypatch.setattr(macro, "_mc_save", lambda key, val: saved.append((key, val)))

    def _boom(*a, **kw):
        raise RuntimeError("FRED 503")

    monkeypatch.setattr(macro, "_fetch_series", _boom)
    out = macro._fetch_and_save_macro_signals()
    assert out.get("_status") == "skipped"
    assert saved == []                                    # wrong < missing
    assert out["yield_curve"] == stored["yield_curve"]     # 직전값 그대로 반환


def test_refresh_macro_signals_success_records_no_status(spy, monkeypatch):
    """대조군 — 정상 성공은 상태를 지정하지 않는다(초록이 여전히 초록).

    이 축이 없으면 「항상 skipped를 기록」하는 과잉교정 구현으로도 위 두 축이 통과한다.
    """
    import scheduler
    monkeypatch.setattr("services.market_indicators._fetch_and_save_macro_signals",
                        lambda: dict(_OK_PAYLOAD))
    scheduler._refresh_macro_signals()
    assert ("macro_signals_fetch", "auto") in spy
    assert _statuses(spy) == []

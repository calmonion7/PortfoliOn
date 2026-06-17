"""S5: recommendation_kr/us 배치 본문 + registry 확정 (.forge/adr/0015).

배치 id 4표면 일관: registry read·market 분류·job_runs.record(auto+manual)·테스트.
scheduler._recommendation_work는 funnel.run_recommendation_batch를 호출하는 얇은 래퍼
(silent except 금지 패턴). 요청·기동 경로 라이브 호출 0(배치만 외부 fetch).
"""
import sys
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest


# ── 배치 레지스트리 엔트리 (recommendation_kr/us) ──────────────────────────────

def test_registry_has_recommendation_kr():
    from services import batch_registry
    e = batch_registry.get_batch("recommendation_kr")
    assert e is not None
    assert e["market"] == "KR"
    assert e["editable"] is True
    assert e["trigger_kinds"] == ["auto", "manual"]
    assert e["scheduler_job_id"] == "recommendation_kr"
    assert e["timezone"] == "Asia/Seoul"
    assert e["manual_endpoint"] == "/api/recommendations/refresh?market=KR"
    assert e["default_schedule"] == {"enabled": True, "type": "daily", "time": "20:30"}


def test_registry_has_recommendation_us():
    from services import batch_registry
    e = batch_registry.get_batch("recommendation_us")
    assert e is not None
    assert e["market"] == "US"
    assert e["editable"] is True
    assert e["trigger_kinds"] == ["auto", "manual"]
    assert e["scheduler_job_id"] == "recommendation_us"
    assert e["timezone"] == "Asia/Seoul"
    assert e["manual_endpoint"] == "/api/recommendations/refresh?market=US"
    assert e["default_schedule"] == {"enabled": True, "type": "daily", "time": "07:00"}


def test_recommendation_entries_have_source_and_usage():
    from services import batch_registry
    for jid in ("recommendation_kr", "recommendation_us"):
        e = batch_registry.get_batch(jid)
        assert isinstance(e["source"], list) and len(e["source"]) > 0, jid
        assert all(isinstance(s, str) and s.strip() for s in e["source"]), jid
        assert isinstance(e["usage"], list) and len(e["usage"]) > 0, jid


# ── scheduler 잡 배선 (_JOB_FUNCS + auto record + funnel 호출) ──────────────────

@pytest.fixture
def spy(monkeypatch):
    calls = []

    @contextmanager
    def fake_record(job_id, trigger):
        calls.append((job_id, trigger))
        yield 1

    import services.job_runs as job_runs
    monkeypatch.setattr(job_runs, "record", fake_record)
    return calls


def test_job_funcs_wires_recommendation_ids():
    import scheduler
    assert "recommendation_kr" in scheduler._JOB_FUNCS
    assert "recommendation_us" in scheduler._JOB_FUNCS


def test_fetch_recommendation_kr_records_auto_and_calls_funnel(spy, monkeypatch):
    import scheduler
    from services import recommendation
    called = []
    monkeypatch.setattr(recommendation, "run_recommendation_batch",
                        lambda market: called.append(market) or {"market": market})
    scheduler._fetch_recommendation_kr()
    assert ("recommendation_kr", "auto") in spy
    assert called == ["KR"]


def test_fetch_recommendation_us_records_auto_and_calls_funnel(spy, monkeypatch):
    import scheduler
    from services import recommendation
    called = []
    monkeypatch.setattr(recommendation, "run_recommendation_batch",
                        lambda market: called.append(market) or {"market": market})
    scheduler._fetch_recommendation_us()
    assert ("recommendation_us", "auto") in spy
    assert called == ["US"]


def test_recommendation_work_swallows_funnel_errors(spy, monkeypatch):
    """funnel 예외는 본문에서 삼키고 로깅 — job_runs는 여전히 기록(래퍼가 깨지지 않음)."""
    import scheduler
    from services import recommendation

    def boom(market):
        raise RuntimeError("fetch failed")

    monkeypatch.setattr(recommendation, "run_recommendation_batch", boom)
    # 예외가 _recommendation_work 밖으로 전파되지 않아야 한다
    scheduler._fetch_recommendation_kr()
    assert ("recommendation_kr", "auto") in spy


# ── GET /api/batches 노출 (시장별 분류) ──────────────────────────────────────

def test_batches_endpoint_exposes_recommendation_markets(client):
    resp = client.get("/api/batches")
    assert resp.status_code == 200
    by_id = {b["id"]: b for b in resp.json()}
    assert by_id["recommendation_kr"]["market"] == "KR"
    assert by_id["recommendation_us"]["market"] == "US"
    assert by_id["recommendation_kr"]["schedule_desc"]
    assert by_id["recommendation_us"]["schedule_desc"]

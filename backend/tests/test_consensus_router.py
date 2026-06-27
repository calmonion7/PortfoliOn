import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.report import router
from auth import get_current_user

app = FastAPI()
app.include_router(router)
# backfill_consensus는 get_current_user로 게이트(task#108) — 인증된 호출자로 오버라이드.
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
client = TestClient(app)

SAMPLE_SUMMARY = {
    "target_mean": 352000.0, "buy": 25, "hold": 0, "sell": 0,
    "price": 275500.0, "market": "KR",
}


def test_get_consensus_empty():
    with patch("services.consensus_pipeline.get_mart_history", return_value=None), \
         patch("services.consensus.query", return_value=[]):
        resp = client.get("/api/consensus/005930")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_consensus_returns_data():
    rows = [{"date": "2026-05-19", "target_mean": 352000, "buy": 25, "hold": 0, "sell": 0}]
    with patch("services.consensus_pipeline.get_mart_history", return_value=None), \
         patch("services.consensus.query", return_value=rows):
        resp = client.get("/api/consensus/005930")
    assert resp.status_code == 200
    assert resp.json()[0]["target_mean"] == 352000


def test_backfill_no_report():
    with patch("routers.report.query", return_value=[]):
        r = client.post("/api/consensus/AAPL/backfill")
    assert r.status_code == 400


def test_backfill_uses_pipeline_targets_mart():
    """백필 버튼은 정본 _pipeline.backfill(→ daily_consensus_mart)을 호출한다 (ADR-0008).

    legacy consensus_history 쓰기 경로(consensus.backfill)는 더 이상 타지 않으며,
    응답은 파이프라인이 upsert한 raw 행 수를 담은 {"added": <int>}이다(entries 없음).
    """
    from datetime import date
    snapshot_data = {"market": "KR", "target_mean": 80000}
    router_query_result = [{"date": date.today().isoformat(), "data": snapshot_data}]

    with patch("routers.report.query", return_value=router_query_result), \
         patch("routers.report._pipeline.backfill", return_value=7) as mock_pipeline:
        r = client.post("/api/consensus/005930/backfill")

    assert r.status_code == 200
    assert r.json() == {"added": 7}
    # 정본 파이프라인을 종목 dict 리스트로 호출
    mock_pipeline.assert_called_once()
    args, _ = mock_pipeline.call_args
    assert args[0] == [{"ticker": "005930", "market": "KR"}]


def test_backfill_market_defaults_us_when_missing():
    from datetime import date
    router_query_result = [{"date": date.today().isoformat(), "data": {}}]
    with patch("routers.report.query", return_value=router_query_result), \
         patch("routers.report._pipeline.backfill", return_value=0) as mock_pipeline:
        r = client.post("/api/consensus/AAPL/backfill")
    assert r.status_code == 200
    assert r.json() == {"added": 0}
    args, _ = mock_pipeline.call_args
    assert args[0] == [{"ticker": "AAPL", "market": "US"}]

import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.report import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)

SAMPLE_SUMMARY = {
    "target_mean": 352000.0, "buy": 25, "hold": 0, "sell": 0,
    "price": 275500.0, "market": "KR",
}


def test_get_consensus_empty(tmp_path):
    with patch("services.consensus.CONSENSUS_DIR", tmp_path):
        resp = client.get("/api/consensus/005930")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_consensus_returns_data(tmp_path):
    (tmp_path / "005930.json").write_text(
        json.dumps([{"date": "2026-05-19", "target_mean": 352000, "buy": 25, "hold": 0, "sell": 0}]),
        encoding="utf-8",
    )
    with patch("services.consensus.CONSENSUS_DIR", tmp_path):
        resp = client.get("/api/consensus/005930")
    assert resp.status_code == 200
    assert resp.json()[0]["target_mean"] == 352000


def test_collect_consensus_saves_entry(tmp_path):
    reports_tmp = tmp_path / "reports"
    reports_tmp.mkdir()
    consensus_tmp = tmp_path / "consensus"
    ticker_dir = reports_tmp / "005930"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-19.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    with patch("services.consensus.REPORTS_DIR", reports_tmp), \
         patch("services.consensus.CONSENSUS_DIR", consensus_tmp):
        resp = client.post("/api/consensus/005930")
    assert resp.status_code == 200
    assert resp.json()["target_mean"] == 352000.0


def test_collect_consensus_no_report(tmp_path):
    reports_tmp = tmp_path / "reports"
    reports_tmp.mkdir()
    consensus_tmp = tmp_path / "consensus"
    with patch("services.consensus.REPORTS_DIR", reports_tmp), \
         patch("services.consensus.CONSENSUS_DIR", consensus_tmp):
        resp = client.post("/api/consensus/UNKNOWN")
    assert resp.status_code == 400


def test_collect_consensus_upsert_same_date(tmp_path):
    reports_tmp = tmp_path / "reports"
    reports_tmp.mkdir()
    consensus_tmp = tmp_path / "consensus"
    consensus_tmp.mkdir()
    ticker_dir = reports_tmp / "005930"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-19.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    (consensus_tmp / "005930.json").write_text(
        json.dumps([{"date": "2026-05-19", "target_mean": 300000, "buy": 20, "hold": 2, "sell": 1}]),
        encoding="utf-8",
    )
    with patch("services.consensus.REPORTS_DIR", reports_tmp), \
         patch("services.consensus.CONSENSUS_DIR", consensus_tmp):
        client.post("/api/consensus/005930")
    saved = json.loads((consensus_tmp / "005930.json").read_text())
    same_date = [e for e in saved if e["date"] == "2026-05-19"]
    assert len(same_date) == 1
    assert same_date[0]["target_mean"] == 352000.0

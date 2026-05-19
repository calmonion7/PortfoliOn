import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

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
    from datetime import date
    fixed_date = "2026-05-19"
    reports_tmp = tmp_path / "reports"
    reports_tmp.mkdir()
    consensus_tmp = tmp_path / "consensus"
    consensus_tmp.mkdir()
    ticker_dir = reports_tmp / "005930"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-19.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    (consensus_tmp / "005930.json").write_text(
        json.dumps([{"date": fixed_date, "target_mean": 300000, "buy": 20, "hold": 2, "sell": 1}]),
        encoding="utf-8",
    )
    with patch("services.consensus.CONSENSUS_DIR", consensus_tmp), \
         patch("services.consensus.REPORTS_DIR", reports_tmp), \
         patch("services.consensus.date") as mock_date:
        mock_date.today.return_value = date.fromisoformat(fixed_date)
        client.post("/api/consensus/005930")
    saved = json.loads((consensus_tmp / "005930.json").read_text())
    same_date = [e for e in saved if e["date"] == fixed_date]
    assert len(same_date) == 1
    assert same_date[0]["target_mean"] == 352000.0


def test_backfill_no_report(tmp_path, monkeypatch):
    monkeypatch.setattr("routers.report.REPORTS_DIR", tmp_path)
    r = client.post("/api/consensus/AAPL/backfill")
    assert r.status_code == 400


def test_backfill_kr(tmp_path, monkeypatch):
    import pandas as pd
    upper = "005930"
    ticker_dir = tmp_path / upper
    ticker_dir.mkdir()
    summary = {"market": "KR", "target_mean": 80000, "buy": 10, "hold": 2, "sell": 0}
    (ticker_dir / "2026-05-01.json").write_text(json.dumps(summary), encoding="utf-8")
    monkeypatch.setattr("routers.report.REPORTS_DIR", tmp_path)

    fnguide_payload = {
        "comp": [
            {"EST_DT": "2026/04/01", "AVG_PRC": "80,000", "RECOM_CD": "4"},
            {"EST_DT": "2026/04/01", "AVG_PRC": "80,000", "RECOM_CD": "3"},
            {"EST_DT": "2026/03/15", "AVG_PRC": "78,000", "RECOM_CD": "4"},
        ]
    }
    with patch("services.consensus.CONSENSUS_DIR", tmp_path / "consensus"), \
         patch("requests.get") as mock_get:
        mock_response = MagicMock()
        mock_response.content = json.dumps(fnguide_payload).encode("utf-8")
        mock_response.raise_for_status = lambda: None
        mock_get.return_value = mock_response
        r = client.post(f"/api/consensus/{upper}/backfill")

    assert r.status_code == 200
    body = r.json()
    assert body["added"] == 2


def test_backfill_us(tmp_path, monkeypatch):
    import pandas as pd
    upper = "AAPL"
    ticker_dir = tmp_path / upper
    ticker_dir.mkdir()
    summary = {"market": "US", "target_mean": 200.0, "buy": 25, "hold": 5, "sell": 1}
    (ticker_dir / "2026-05-01.json").write_text(json.dumps(summary), encoding="utf-8")
    monkeypatch.setattr("routers.report.REPORTS_DIR", tmp_path)

    df = pd.DataFrame([
        {"period": "0m",  "strongBuy": 10, "buy": 20, "hold": 5, "sell": 2, "strongSell": 1},
        {"period": "-1m", "strongBuy": 8,  "buy": 18, "hold": 6, "sell": 3, "strongSell": 0},
    ])
    mock_ticker = MagicMock()
    mock_ticker.recommendations = df

    with patch("services.consensus.CONSENSUS_DIR", tmp_path / "consensus"), \
         patch("yfinance.Ticker", return_value=mock_ticker):
        r = client.post(f"/api/consensus/{upper}/backfill")

    assert r.status_code == 200
    body = r.json()
    assert body["added"] == 2
    buy_counts = {e["date"]: e["buy"] for e in body["entries"]}
    assert 30 in buy_counts.values()  # 10+20 for "0m"


def test_backfill_skips_existing_dates(tmp_path, monkeypatch):
    import pandas as pd
    from datetime import date
    upper = "AAPL"
    ticker_dir = tmp_path / upper
    ticker_dir.mkdir()
    summary = {"market": "US", "target_mean": 200.0, "buy": 25, "hold": 5, "sell": 1}
    (ticker_dir / "2026-05-01.json").write_text(json.dumps(summary), encoding="utf-8")
    monkeypatch.setattr("routers.report.REPORTS_DIR", tmp_path)

    # Pre-populate consensus with current month's entry
    today = date.today()
    existing_date = date(today.year, today.month, 1).isoformat()
    consensus_dir = tmp_path / "consensus"
    consensus_dir.mkdir()
    existing = [{"date": existing_date, "target_mean": None, "buy": 5, "hold": 2, "sell": 1}]
    (consensus_dir / f"{upper}.json").write_text(json.dumps(existing), encoding="utf-8")

    df = pd.DataFrame([
        {"period": "0m", "strongBuy": 10, "buy": 20, "hold": 5, "sell": 2, "strongSell": 1},
    ])
    mock_ticker = MagicMock()
    mock_ticker.recommendations = df

    with patch("services.consensus.CONSENSUS_DIR", consensus_dir), \
         patch("yfinance.Ticker", return_value=mock_ticker):
        r = client.post(f"/api/consensus/{upper}/backfill")

    assert r.status_code == 200
    assert r.json()["added"] == 0

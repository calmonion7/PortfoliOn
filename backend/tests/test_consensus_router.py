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
    from datetime import date, timedelta
    upper = "005930"
    today = date.today()
    d1 = (today - timedelta(days=30)).isoformat()
    d2 = (today - timedelta(days=10)).isoformat()

    ticker_dir = tmp_path / upper
    ticker_dir.mkdir()
    summary = {"market": "KR", "target_mean": 80000, "buy": 10, "hold": 2, "sell": 0}
    (ticker_dir / f"{today.isoformat()}.json").write_text(json.dumps(summary), encoding="utf-8")
    monkeypatch.setattr("routers.report.REPORTS_DIR", tmp_path)

    list_payload = [
        {"researchId": "101", "writeDate": d1, "brokerName": "NH"},
        {"researchId": "102", "writeDate": d1, "brokerName": "KB"},
        {"researchId": "103", "writeDate": d2, "brokerName": "KI"},
    ]
    details = {
        "101": {"researchContent": {"opinion": "매수", "goalPrice": "80,000"}},
        "102": {"researchContent": {"opinion": "중립", "goalPrice": "78,000"}},
        "103": {"researchContent": {"opinion": "매수", "goalPrice": "82,000"}},
    }

    def mock_get(url, **kwargs):
        m = MagicMock()
        m.raise_for_status = lambda: None
        last = url.split("?")[0].rstrip("/").split("/")[-1]
        m.json.return_value = details[last] if last in details else list_payload
        return m

    with patch("services.consensus.CONSENSUS_DIR", tmp_path / "consensus"), \
         patch("requests.get", side_effect=mock_get):
        r = client.post(f"/api/consensus/{upper}/backfill")

    assert r.status_code == 200
    body = r.json()
    assert body["added"] == 2


def test_backfill_us(tmp_path, monkeypatch):
    import pandas as pd
    from datetime import date, timedelta
    upper = "AAPL"
    today = date.today()
    d1 = (today - timedelta(days=10)).isoformat()
    d2 = (today - timedelta(days=20)).isoformat()

    ticker_dir = tmp_path / upper
    ticker_dir.mkdir()
    summary = {"market": "US", "target_mean": 200.0, "buy": 25, "hold": 5, "sell": 1}
    (ticker_dir / f"{today.isoformat()}.json").write_text(json.dumps(summary), encoding="utf-8")
    monkeypatch.setattr("routers.report.REPORTS_DIR", tmp_path)

    df = pd.DataFrame(
        {
            "ToGrade": ["Buy", "Outperform", "Hold"],
            "Firm": ["MS", "GS", "JPM"],
            "FromGrade": ["", "", ""],
            "Action": ["up", "up", "main"],
            "currentPriceTarget": [210.0, 220.0, 190.0],
        },
        index=pd.DatetimeIndex([d1, d1, d2], name="GradeDate"),
    )
    mock_ticker = MagicMock()
    mock_ticker.upgrades_downgrades = df

    with patch("services.consensus.CONSENSUS_DIR", tmp_path / "consensus"), \
         patch("yfinance.Ticker", return_value=mock_ticker):
        r = client.post(f"/api/consensus/{upper}/backfill")

    assert r.status_code == 200
    body = r.json()
    assert body["added"] == 2
    by_date = {e["date"]: e for e in body["entries"]}
    assert by_date[d1]["buy"] == 2           # Buy + Outperform
    assert by_date[d1]["target_mean"] == 215.0  # (210+220)/2
    assert by_date[d2]["target_mean"] == 190.0


def test_backfill_skips_existing_dates(tmp_path, monkeypatch):
    import pandas as pd
    from datetime import date, timedelta
    upper = "AAPL"
    today = date.today()
    existing_date = (today - timedelta(days=10)).isoformat()

    ticker_dir = tmp_path / upper
    ticker_dir.mkdir()
    summary = {"market": "US", "target_mean": 200.0, "buy": 25, "hold": 5, "sell": 1}
    (ticker_dir / f"{today.isoformat()}.json").write_text(json.dumps(summary), encoding="utf-8")
    monkeypatch.setattr("routers.report.REPORTS_DIR", tmp_path)

    consensus_dir = tmp_path / "consensus"
    consensus_dir.mkdir()
    existing = [{"date": existing_date, "target_mean": None, "buy": 5, "hold": 2, "sell": 1}]
    (consensus_dir / f"{upper}.json").write_text(json.dumps(existing), encoding="utf-8")

    df = pd.DataFrame(
        {"ToGrade": ["Buy"], "Firm": ["MS"], "FromGrade": [""], "Action": ["up"]},
        index=pd.DatetimeIndex([existing_date], name="GradeDate"),
    )
    mock_ticker = MagicMock()
    mock_ticker.upgrades_downgrades = df

    with patch("services.consensus.CONSENSUS_DIR", consensus_dir), \
         patch("yfinance.Ticker", return_value=mock_ticker):
        r = client.post(f"/api/consensus/{upper}/backfill")

    assert r.status_code == 200
    assert r.json()["added"] == 0

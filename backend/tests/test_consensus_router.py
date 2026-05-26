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


def _make_mock_db(data=None):
    m = MagicMock()
    for method in ['table', 'select', 'eq', 'order', 'limit', 'in_', 'upsert', 'delete']:
        getattr(m, method).return_value = m
    m.execute.return_value.data = data if data is not None else []
    return m


def test_get_consensus_empty():
    with patch("services.consensus.get_db", return_value=_make_mock_db([])):
        resp = client.get("/api/consensus/005930")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_consensus_returns_data():
    rows = [{"date": "2026-05-19", "target_mean": 352000, "buy": 25, "hold": 0, "sell": 0}]
    with patch("services.consensus.get_db", return_value=_make_mock_db(rows)):
        resp = client.get("/api/consensus/005930")
    assert resp.status_code == 200
    assert resp.json()[0]["target_mean"] == 352000


def test_collect_consensus_saves_entry():
    snapshot_rows = [{"data": SAMPLE_SUMMARY}]
    mock_db = _make_mock_db(snapshot_rows)
    with patch("services.consensus.get_db", return_value=mock_db):
        resp = client.post("/api/consensus/005930")
    assert resp.status_code == 200
    assert resp.json()["target_mean"] == 352000.0


def test_collect_consensus_no_report():
    with patch("services.consensus.get_db", return_value=_make_mock_db([])):
        resp = client.post("/api/consensus/UNKNOWN")
    assert resp.status_code == 400


def test_collect_consensus_upsert_same_date():
    snapshot_rows = [{"data": SAMPLE_SUMMARY}]
    mock_db = _make_mock_db(snapshot_rows)
    with patch("services.consensus.get_db", return_value=mock_db):
        resp = client.post("/api/consensus/005930")
    assert resp.status_code == 200
    # upsert was called on consensus_history
    assert mock_db.upsert.called


def test_backfill_no_report():
    with patch("routers.report.get_db", return_value=_make_mock_db([])):
        r = client.post("/api/consensus/AAPL/backfill")
    assert r.status_code == 400


def test_backfill_kr():
    from datetime import date, timedelta
    upper = "005930"
    today = date.today()
    d1 = (today - timedelta(days=30)).isoformat()
    d2 = (today - timedelta(days=10)).isoformat()

    snapshot_data = {"market": "KR", "target_mean": 80000, "buy": 10, "hold": 2, "sell": 0}
    router_db = _make_mock_db([{"date": today.isoformat(), "data": snapshot_data}])

    consensus_db = _make_mock_db([])

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

    with patch("routers.report.get_db", return_value=router_db), \
         patch("services.consensus.get_db", return_value=consensus_db), \
         patch("requests.get", side_effect=mock_get):
        r = client.post(f"/api/consensus/{upper}/backfill")

    assert r.status_code == 200
    body = r.json()
    assert body["added"] == 2


def test_backfill_us():
    import pandas as pd
    from datetime import date, timedelta
    upper = "AAPL"
    today = date.today()
    d1 = (today - timedelta(days=10)).isoformat()
    d2 = (today - timedelta(days=20)).isoformat()

    snapshot_data = {"market": "US", "target_mean": 200.0, "buy": 25, "hold": 5, "sell": 1}
    router_db = _make_mock_db([{"date": today.isoformat(), "data": snapshot_data}])
    consensus_db = _make_mock_db([])

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

    with patch("routers.report.get_db", return_value=router_db), \
         patch("services.consensus.get_db", return_value=consensus_db), \
         patch("yfinance.Ticker", return_value=mock_ticker):
        r = client.post(f"/api/consensus/{upper}/backfill")

    assert r.status_code == 200
    body = r.json()
    assert body["added"] == 2
    by_date = {e["date"]: e for e in body["entries"]}
    assert by_date[d1]["buy"] == 2
    assert by_date[d1]["target_mean"] == 215.0
    assert by_date[d2]["target_mean"] == 190.0


def test_backfill_skips_existing_dates():
    import pandas as pd
    from datetime import date, timedelta
    upper = "AAPL"
    today = date.today()
    existing_date = (today - timedelta(days=10)).isoformat()

    snapshot_data = {"market": "US", "target_mean": 200.0, "buy": 25, "hold": 5, "sell": 1}
    router_db = _make_mock_db([{"date": today.isoformat(), "data": snapshot_data}])

    existing_rows = [{"date": existing_date}]
    consensus_db = _make_mock_db(existing_rows)

    df = pd.DataFrame(
        {"ToGrade": ["Buy"], "Firm": ["MS"], "FromGrade": [""], "Action": ["up"],
         "currentPriceTarget": [210.0]},
        index=pd.DatetimeIndex([existing_date], name="GradeDate"),
    )
    mock_ticker = MagicMock()
    mock_ticker.upgrades_downgrades = df

    with patch("routers.report.get_db", return_value=router_db), \
         patch("services.consensus.get_db", return_value=consensus_db), \
         patch("yfinance.Ticker", return_value=mock_ticker):
        r = client.post(f"/api/consensus/{upper}/backfill")

    assert r.status_code == 200
    assert r.json()["added"] == 0

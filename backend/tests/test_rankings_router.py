# backend/tests/test_rankings_router.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from decimal import Decimal

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.rankings import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def _sample_rows():
    return [
        {
            "rank": 1,
            "ticker": "005930",
            "name": "삼성전자",
            "price": Decimal("329000"),
            "change_pct": Decimal("-6.40"),
            "trading_value": Decimal("10400439000000.00"),
            "trading_volume": Decimal("31299200"),
            "market_cap": Decimal("1923425700000000.00"),
            "is_etf": False,
            "exchange": "KS",
            "base_ts": None,
        }
    ]


def test_rankings_happy_path_coerces_decimals():
    payload = {"rows": _sample_rows(), "base_ts": "2026-06-06T01:00:00+00:00"}
    with patch("routers.rankings.ranking_service.read_rankings", return_value=payload) as mock_read:
        resp = client.get("/api/rankings?market=KR&metric=value&type=all&limit=20&offset=0")
    assert resp.status_code == 200
    data = resp.json()
    assert data["market"] == "KR"
    assert data["metric"] == "value"
    assert data["base_ts"] == "2026-06-06T01:00:00+00:00"
    item = data["items"][0]
    assert item["rank"] == 1
    assert item["ticker"] == "005930"
    assert item["price"] == 329000.0
    assert item["change_pct"] == -6.40
    assert item["trading_value"] == 10400439000000.0
    assert item["trading_volume"] == 31299200
    assert item["is_etf"] is False
    mock_read.assert_called_once_with("KR", "value", "all", 20, 0)


def test_rankings_defaults_and_type_passthrough():
    payload = {"rows": [], "base_ts": None}
    with patch("routers.rankings.ranking_service.read_rankings", return_value=payload) as mock_read:
        resp = client.get("/api/rankings?type=etf")
    assert resp.status_code == 200
    mock_read.assert_called_once_with("KR", "value", "etf", 20, 0)


def test_rankings_empty_table_graceful():
    payload = {"rows": [], "base_ts": None}
    with patch("routers.rankings.ranking_service.read_rankings", return_value=payload):
        resp = client.get("/api/rankings?market=US&metric=volume")
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["base_ts"] is None
    assert data["market"] == "US"
    assert data["metric"] == "volume"


def test_rankings_rejects_invalid_market():
    resp = client.get("/api/rankings?market=JP")
    assert resp.status_code == 400


def test_rankings_rejects_invalid_metric():
    resp = client.get("/api/rankings?metric=marketcap")
    assert resp.status_code == 400


def test_rankings_rejects_invalid_type():
    resp = client.get("/api/rankings?type=bond")
    assert resp.status_code == 400


def test_rankings_rejects_out_of_range_limit():
    resp = client.get("/api/rankings?limit=0")
    assert resp.status_code == 422

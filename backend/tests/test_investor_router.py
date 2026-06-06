# backend/tests/test_investor_router.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from datetime import date
from decimal import Decimal

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.investor import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def _screening_rows():
    """read_screening 출력 형태 (foreign_hold_ratio desc 정렬 가정)."""
    return [
        {
            "ticker": "005930",
            "name": "삼성전자",
            "base_date": date(2026, 6, 5),
            "foreign_net": Decimal("5414215"),
            "organ_net": Decimal("-4240844"),
            "individual_net": Decimal("-1173371"),
            "foreign_hold_ratio": Decimal("47.74"),
            "close_price": Decimal("329000"),
        },
        {
            "ticker": "000660",
            "name": "SK하이닉스",
            "base_date": date(2026, 6, 5),
            "foreign_net": Decimal("-100"),
            "organ_net": Decimal("200"),
            "individual_net": Decimal("-100"),
            "foreign_hold_ratio": Decimal("33.10"),
            "close_price": Decimal("180000"),
        },
    ]


def test_screening_serializes_and_preserves_order():
    with patch("routers.investor.investor_service.read_screening",
               return_value=_screening_rows()) as mock_read:
        resp = client.get("/api/investor/screening?limit=50&offset=0")
    assert resp.status_code == 200
    data = resp.json()
    assert data["latest_date"] == "2026-06-05"
    items = data["items"]
    # 서비스 정렬 순서 보존 (foreign_hold_ratio desc)
    assert [it["ticker"] for it in items] == ["005930", "000660"]
    first = items[0]
    assert first["name"] == "삼성전자"
    assert first["base_date"] == "2026-06-05"
    assert first["foreign_net"] == 5414215
    assert first["organ_net"] == -4240844
    assert first["individual_net"] == -1173371
    assert first["foreign_hold_ratio"] == 47.74
    assert first["close_price"] == 329000
    mock_read.assert_called_once_with(50, 0)


def test_screening_defaults():
    with patch("routers.investor.investor_service.read_screening",
               return_value=[]) as mock_read:
        resp = client.get("/api/investor/screening")
    assert resp.status_code == 200
    mock_read.assert_called_once_with(50, 0)


def test_screening_empty_graceful():
    with patch("routers.investor.investor_service.read_screening", return_value=[]):
        resp = client.get("/api/investor/screening")
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["latest_date"] is None


def test_screening_rejects_out_of_range_limit():
    resp = client.get("/api/investor/screening?limit=0")
    assert resp.status_code == 422


def test_trend_series_shape_asc():
    rows = [
        {
            "base_date": date(2026, 6, 4),
            "foreign_net": Decimal("100"),
            "organ_net": Decimal("-50"),
            "individual_net": Decimal("-50"),
            "foreign_hold_ratio": Decimal("47.70"),
            "close_price": Decimal("328000"),
        },
        {
            "base_date": date(2026, 6, 5),
            "foreign_net": Decimal("5414215"),
            "organ_net": Decimal("-4240844"),
            "individual_net": Decimal("-1173371"),
            "foreign_hold_ratio": Decimal("47.74"),
            "close_price": Decimal("329000"),
        },
    ]
    with patch("routers.investor.investor_service.read_series",
               return_value=rows) as mock_read:
        resp = client.get("/api/stocks/005930/investor-trend?days=60")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ticker"] == "005930"
    items = data["items"]
    assert [it["base_date"] for it in items] == ["2026-06-04", "2026-06-05"]
    assert items[1]["foreign_net"] == 5414215
    assert items[1]["foreign_hold_ratio"] == 47.74
    mock_read.assert_called_once_with("005930", 60)


def test_trend_default_days():
    with patch("routers.investor.investor_service.read_series",
               return_value=[]) as mock_read:
        resp = client.get("/api/stocks/005930/investor-trend")
    assert resp.status_code == 200
    mock_read.assert_called_once_with("005930", 252)


def test_trend_empty_graceful():
    with patch("routers.investor.investor_service.read_series", return_value=[]):
        resp = client.get("/api/stocks/000660/investor-trend")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ticker"] == "000660"
    assert data["items"] == []

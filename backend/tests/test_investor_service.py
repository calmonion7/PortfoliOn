import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from datetime import date
import pytest
from unittest.mock import patch, MagicMock


# ── pure parse helpers ──

def test_parse_signed_int():
    from services.investor_service import _parse_signed_int
    assert _parse_signed_int("+5,414,215") == 5414215
    assert _parse_signed_int("-4,240,844") == -4240844
    assert _parse_signed_int("329,000") == 329000
    assert _parse_signed_int("0") == 0


def test_parse_signed_int_missing_values():
    from services.investor_service import _parse_signed_int
    assert _parse_signed_int("N/A") == 0
    assert _parse_signed_int("-") == 0
    assert _parse_signed_int("") == 0
    assert _parse_signed_int(None) == 0


def test_parse_percent():
    from services.investor_service import _parse_percent
    assert _parse_percent("47.74%") == pytest.approx(47.74)
    assert _parse_percent("0.00%") == pytest.approx(0.0)


def test_parse_percent_missing_values():
    from services.investor_service import _parse_percent
    assert _parse_percent("N/A") is None
    assert _parse_percent("-") is None
    assert _parse_percent("") is None
    assert _parse_percent(None) is None


def test_parse_bizdate():
    from services.investor_service import _parse_bizdate
    assert _parse_bizdate("20260605") == date(2026, 6, 5)


def test_parse_bizdate_invalid():
    from services.investor_service import _parse_bizdate
    assert _parse_bizdate("2026") is None
    assert _parse_bizdate("") is None
    assert _parse_bizdate(None) is None


# ── row mapping ──

def test_map_row():
    from services.investor_service import _map_row
    raw = {
        "itemCode": "005930",
        "bizdate": "20260605",
        "foreignerPureBuyQuant": "+5,414,215",
        "organPureBuyQuant": "-4,240,844",
        "individualPureBuyQuant": "-1,173,371",
        "foreignerHoldRatio": "47.74%",
        "closePrice": "329,000",
        "accumulatedTradingVolume": "12,345,678",
    }
    row = _map_row(raw)
    assert row["base_date"] == date(2026, 6, 5)
    assert row["foreign_net"] == 5414215
    assert row["organ_net"] == -4240844
    assert row["individual_net"] == -1173371
    assert row["foreign_hold_ratio"] == pytest.approx(47.74)
    assert row["close_price"] == 329000


def test_map_row_skips_missing_bizdate():
    from services.investor_service import _map_row
    assert _map_row({"bizdate": "", "closePrice": "100"}) is None


# ── fetch_trend (network mocked) ──

def _fake_resp(payload):
    resp = MagicMock()
    resp.json.return_value = payload
    resp.raise_for_status = lambda: None
    return resp


def test_fetch_trend_parses_rows():
    from services import investor_service as svc
    payload = [
        {"bizdate": "20260605", "foreignerPureBuyQuant": "+5,414,215",
         "organPureBuyQuant": "-4,240,844", "individualPureBuyQuant": "-1,173,371",
         "foreignerHoldRatio": "47.74%", "closePrice": "329,000"},
        {"bizdate": "20260604", "foreignerPureBuyQuant": "-2,000,000",
         "organPureBuyQuant": "+1,500,000", "individualPureBuyQuant": "+500,000",
         "foreignerHoldRatio": "47.70%", "closePrice": "325,000"},
    ]
    with patch("services.investor_service.requests.get", return_value=_fake_resp(payload)):
        rows = svc.fetch_trend("005930")
    assert len(rows) == 2
    assert rows[0]["base_date"] == date(2026, 6, 5)
    assert rows[0]["foreign_net"] == 5414215
    assert rows[1]["organ_net"] == 1500000


def test_fetch_trend_passes_bizdate_param():
    from services import investor_service as svc
    mock_get = MagicMock(return_value=_fake_resp([]))
    with patch("services.investor_service.requests.get", mock_get):
        svc.fetch_trend("005930", bizdate="20260520")
    _, kwargs = mock_get.call_args
    assert kwargs["params"] == {"bizdate": "20260520"}


def test_fetch_trend_no_bizdate_sends_none_params():
    from services import investor_service as svc
    mock_get = MagicMock(return_value=_fake_resp([]))
    with patch("services.investor_service.requests.get", mock_get):
        svc.fetch_trend("005930")
    _, kwargs = mock_get.call_args
    assert kwargs["params"] is None


def test_fetch_trend_non_list_returns_empty():
    from services import investor_service as svc
    with patch("services.investor_service.requests.get", return_value=_fake_resp({"error": "bad"})):
        rows = svc.fetch_trend("AAPL")
    assert rows == []


# ── storage / read helpers (DB faked) ──

class _FakeDB:
    """ON CONFLICT (ticker, base_date) DO UPDATE 멱등 INSERT를 흉내내는 인메모리 저장소."""
    def __init__(self):
        self.store = {}  # (ticker, base_date) -> row dict

    def execute_many(self, sql, params_list):
        for params in params_list:
            ticker, base_date = params[0], params[1]
            self.store[(ticker, base_date)] = {
                "ticker": ticker, "base_date": base_date,
                "foreign_net": params[2], "organ_net": params[3],
                "individual_net": params[4], "foreign_hold_ratio": params[5],
                "close_price": params[6],
            }


def _row(d, fnet=0, hold=None):
    return {"base_date": d, "foreign_net": fnet, "organ_net": 0,
            "individual_net": 0, "foreign_hold_ratio": hold, "close_price": 100}


def test_upsert_trend_idempotent():
    from services import investor_service as svc
    fake = _FakeDB()
    rows = [_row(date(2026, 6, 5), fnet=111), _row(date(2026, 6, 4), fnet=222)]
    with patch("services.investor_service.execute_many", fake.execute_many):
        svc.upsert_trend("005930", rows)
        assert len(fake.store) == 2
        # 같은 날 재실행 — 행 수 그대로(멱등), 값 갱신
        svc.upsert_trend("005930", [_row(date(2026, 6, 5), fnet=999)])
        assert len(fake.store) == 2
        assert fake.store[("005930", date(2026, 6, 5))]["foreign_net"] == 999


def test_read_screening_ordering_and_params():
    from services import investor_service as svc
    captured = {}
    canned = [
        {"ticker": "A", "foreign_hold_ratio": 60.0},
        {"ticker": "B", "foreign_hold_ratio": 30.0},
    ]

    def fake_query(sql, params=None):
        captured["sql"] = sql
        captured["params"] = params
        return canned

    with patch("services.investor_service.query", fake_query):
        result = svc.read_screening(limit=10, offset=5)

    assert result == canned
    assert captured["params"] == (10, 5)
    assert "foreign_hold_ratio DESC" in captured["sql"]
    assert "market = 'KR'" in captured["sql"]


def test_oldest_date():
    from services import investor_service as svc
    with patch("services.investor_service.query",
               return_value=[{"oldest": date(2025, 6, 10)}]):
        assert svc.oldest_date("005930") == date(2025, 6, 10)


def test_oldest_date_empty():
    from services import investor_service as svc
    with patch("services.investor_service.query", return_value=[{"oldest": None}]):
        assert svc.oldest_date("005930") is None

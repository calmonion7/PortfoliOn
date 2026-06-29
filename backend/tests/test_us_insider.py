"""US 내부자 거래(Form4) 수집·조회 TDD (S1+S2).

S1: fetch_us_supply insider 확장 — insider_transactions + insider_purchases 파싱
S2: GET /report/{ticker}/us-insider 읽기 엔드포인트
"""
import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


# ── helpers ──────────────────────────────────────────────────────────────────

def _fake_ticker(info, holders_df, txn_df, purch_df):
    """yf.Ticker() 를 흉내내는 fake 객체 (insider 확장)."""
    class _FakeTicker:
        def __init__(self):
            self.info = info
            self.institutional_holders = holders_df
            self.insider_transactions = txn_df
            self.insider_purchases = purch_df
    return _FakeTicker()


_SAMPLE_TXN = pd.DataFrame([
    {
        "Insider": "Tim Cook",
        "Position": "CEO",
        "Transaction": "Sale",
        "Shares": 100_000,
        "Value": 18_500_000.0,
        "Start Date": pd.Timestamp("2026-05-10"),
        "Ownership": "Direct",
        "URL": "https://example.com/form4/1",
        "Text": "Sale of shares",
    },
    {
        "Insider": "Luca Maestri",
        "Position": "CFO",
        "Transaction": "Purchase",
        "Shares": 5_000,
        "Value": 925_000.0,
        "Start Date": pd.Timestamp("2026-04-15"),
        "Ownership": "Direct",
        "URL": "https://example.com/form4/2",
        "Text": "Purchase of shares",
    },
])

_SAMPLE_PURCH = pd.DataFrame([
    {"Insider Purchases Last 6 Months": "Purchases",       "Shares": 5_000,          "Trans": 1},
    {"Insider Purchases Last 6 Months": "Sales",           "Shares": 100_000,        "Trans": 1},
    {"Insider Purchases Last 6 Months": "Net Shares Purchased (Sold)", "Shares": -95_000, "Trans": 2},
    {"Insider Purchases Last 6 Months": "Total Insider Shares Held",   "Shares": 3_200_000, "Trans": None},
    {"Insider Purchases Last 6 Months": "% Buy Shares",   "Shares": 0.0476,         "Trans": None},
    {"Insider Purchases Last 6 Months": "% Sell Shares",  "Shares": 0.9524,         "Trans": None},
])

_MINIMAL_INFO = {
    "shortPercentOfFloat": 0.01,
    "shortRatio": 2.0,
    "sharesShort": 50_000_000,
    "dateShortInterest": None,
}


# ── S1: fetch_us_supply insider 파싱 ─────────────────────────────────────────

def test_fetch_parses_insider_transactions(monkeypatch):
    """insider_transactions DataFrame → compact list."""
    from services import us_supply as svc

    monkeypatch.setattr(
        svc.yf, "Ticker",
        lambda sym: _fake_ticker(_MINIMAL_INFO, None, _SAMPLE_TXN, _SAMPLE_PURCH),
    )

    result = svc.fetch_us_supply("AAPL")

    assert result is not None
    insider = result.get("insider")
    assert insider is not None

    txns = insider["transactions"]
    assert len(txns) == 2
    t0 = txns[0]
    assert t0["insider"] == "Tim Cook"
    assert t0["position"] == "CEO"
    assert t0["transaction"] == "Sale"
    assert t0["shares"] == 100_000
    assert abs(t0["value"] - 18_500_000.0) < 1.0
    assert t0["start_date"] == "2026-05-10"
    assert t0["ownership"] == "Direct"


def test_fetch_parses_insider_net_summary(monkeypatch):
    """insider_purchases DataFrame → 6mo net summary."""
    from services import us_supply as svc

    monkeypatch.setattr(
        svc.yf, "Ticker",
        lambda sym: _fake_ticker(_MINIMAL_INFO, None, _SAMPLE_TXN, _SAMPLE_PURCH),
    )

    result = svc.fetch_us_supply("AAPL")
    net = result["insider"]["net"]

    assert net["net_shares"] == -95_000
    assert abs(net["pct_buy"] - 0.0476) < 0.0001
    assert abs(net["pct_sell"] - 0.9524) < 0.0001
    assert net["total_held"] == 3_200_000


def test_fetch_insider_graceful_on_empty_dfs(monkeypatch):
    """빈 DataFrame이면 insider.transactions=[], insider.net={}."""
    from services import us_supply as svc

    monkeypatch.setattr(
        svc.yf, "Ticker",
        lambda sym: _fake_ticker(
            _MINIMAL_INFO, None,
            pd.DataFrame(),  # empty txn
            pd.DataFrame(),  # empty purch
        ),
    )

    result = svc.fetch_us_supply("AAPL")
    insider = result["insider"]
    assert insider["transactions"] == []
    assert insider["net"] == {}


def test_fetch_insider_graceful_on_none_dfs(monkeypatch):
    """insider_transactions / insider_purchases 가 None이면 graceful."""
    from services import us_supply as svc

    monkeypatch.setattr(
        svc.yf, "Ticker",
        lambda sym: _fake_ticker(_MINIMAL_INFO, None, None, None),
    )

    result = svc.fetch_us_supply("AAPL")
    insider = result["insider"]
    assert insider["transactions"] == []
    assert insider["net"] == {}


def test_fetch_insider_nan_guarded(monkeypatch):
    """float NaN/inf 값은 None으로 가드."""
    import math
    from services import us_supply as svc

    txn_nan = pd.DataFrame([{
        "Insider": "Test Person",
        "Position": "VP",
        "Transaction": "Sale",
        "Shares": float("nan"),
        "Value": float("inf"),
        "Start Date": pd.Timestamp("2026-05-01"),
        "Ownership": "Direct",
        "URL": "",
        "Text": "",
    }])

    monkeypatch.setattr(
        svc.yf, "Ticker",
        lambda sym: _fake_ticker(_MINIMAL_INFO, None, txn_nan, None),
    )

    result = svc.fetch_us_supply("AAPL")
    t0 = result["insider"]["transactions"][0]
    assert t0["shares"] is None
    assert t0["value"] is None


# ── S2: GET /report/{ticker}/us-insider ──────────────────────────────────────

def _make_app():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routers import report as report_router
    from auth import get_current_user_or_api_key
    app = FastAPI()
    app.include_router(report_router.router)
    app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user"
    return TestClient(app)


def test_get_us_insider_returns_stored_data(monkeypatch):
    """저장된 행 있으면 {transactions, net, fetched_at} 반환."""
    from services import us_supply as svc

    stored = {
        "insider_transactions": [
            {"insider": "Tim Cook", "position": "CEO", "transaction": "Sale",
             "shares": 100000, "value": 18500000.0, "start_date": "2026-05-10",
             "ownership": "Direct"}
        ],
        "insider_net": {"net_shares": -95000, "pct_buy": 0.0476,
                        "pct_sell": 0.9524, "total_held": 3200000},
        "fetched_at": "2026-06-29T06:00:00",
    }

    monkeypatch.setattr(svc, "get_us_insider", lambda ticker: stored)

    client = _make_app()
    resp = client.get("/api/report/AAPL/us-insider")
    assert resp.status_code == 200
    body = resp.json()
    assert "transactions" in body
    assert "net" in body
    assert len(body["transactions"]) == 1
    assert body["transactions"][0]["insider"] == "Tim Cook"
    assert body["net"]["net_shares"] == -95000


def test_get_us_insider_no_data_returns_empty(monkeypatch):
    """저장 행 없으면 {transactions:[], net:{}} graceful."""
    from services import us_supply as svc

    monkeypatch.setattr(svc, "get_us_insider", lambda ticker: None)

    client = _make_app()
    resp = client.get("/api/report/AAPL/us-insider")
    assert resp.status_code == 200
    body = resp.json()
    assert body["transactions"] == []
    assert body["net"] == {}


def test_get_us_insider_registered_before_catch_all(monkeypatch):
    """us-insider 라우트가 catch-all {date_str}보다 앞에 등록돼 있어야 한다."""
    from routers import report as report_router
    paths = [r.path for r in report_router.router.routes]
    insider_idx = next((i for i, p in enumerate(paths) if p == "/api/report/{ticker}/us-insider"), None)
    catch_all_idx = next((i for i, p in enumerate(paths) if p == "/api/report/{ticker}/{date_str}"), None)
    assert insider_idx is not None, "us-insider 라우트 미등록"
    assert catch_all_idx is not None, "catch-all 라우트 미등록"
    assert insider_idx < catch_all_idx, "us-insider가 catch-all보다 뒤에 등록됨"

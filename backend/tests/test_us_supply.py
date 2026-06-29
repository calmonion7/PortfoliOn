"""US 공매도 비중 + 기관 보유 수집·조회 TDD (S1+S2).

S1: fetch_us_supply (yfinance info + institutional_holders 파싱)
S2: GET /report/{ticker}/us-supply 읽기 엔드포인트
migrate: us_supply_snapshot 테이블 생성 idempotency
"""
import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


# ── helpers ──────────────────────────────────────────────────────────────────

def _fake_ticker(info: dict, holders_df):
    """yf.Ticker() 를 흉내내는 fake 객체."""
    class _FakeTicker:
        def __init__(self):
            self.info = info
            self.institutional_holders = holders_df
            self.insider_transactions = None  # eco: supply tests don't exercise insider
            self.insider_purchases = None
    return _FakeTicker()


# ── S1: fetch_us_supply — 파싱 ────────────────────────────────────────────────

def test_fetch_parses_short_and_institutional(monkeypatch):
    """info + institutional_holders → short stats + institutional list."""
    from services import us_supply as svc

    import datetime
    unix_ts = int(datetime.datetime(2026, 5, 1).timestamp())
    fake_info = {
        "shortPercentOfFloat": 0.0098,
        "shortRatio": 2.5,
        "sharesShort": 75_000_000,
        "dateShortInterest": unix_ts,
    }
    fake_holders = pd.DataFrame([
        {"Holder": "Vanguard Group Inc", "pctHeld": 0.0812, "Shares": 1_234_000, "pctChange": 0.002},
        {"Holder": "BlackRock Inc.", "pctHeld": 0.0634, "Shares": 980_000, "pctChange": -0.001},
    ])

    monkeypatch.setattr(svc.yf, "Ticker", lambda sym: _fake_ticker(fake_info, fake_holders))

    result = svc.fetch_us_supply("AAPL")

    assert result is not None
    short = result["short"]
    assert abs(short["short_pct_float"] - 0.0098) < 1e-9
    assert short["short_ratio"] == 2.5
    assert short["shares_short"] == 75_000_000
    assert short["date_short_interest"] == "2026-05-01"

    inst = result["institutional"]
    assert len(inst) == 2
    assert inst[0]["holder"] == "Vanguard Group Inc"
    assert abs(inst[0]["pct_held"] - 0.0812) < 1e-9
    assert inst[0]["shares"] == 1_234_000
    assert abs(inst[0]["pct_change"] - 0.002) < 1e-9


def test_fetch_graceful_on_missing_info_fields(monkeypatch):
    """일부 info 필드가 None / 누락이면 해당 값만 None, 나머지는 정상."""
    from services import us_supply as svc

    fake_info = {"shortPercentOfFloat": None, "shortRatio": None,
                 "sharesShort": None, "dateShortInterest": None}
    fake_holders = pd.DataFrame(columns=["Holder", "pctHeld", "Shares", "pctChange"])

    monkeypatch.setattr(svc.yf, "Ticker", lambda sym: _fake_ticker(fake_info, fake_holders))

    result = svc.fetch_us_supply("AAPL")
    assert result is not None
    assert result["short"]["short_pct_float"] is None
    assert result["institutional"] == []


def test_fetch_graceful_on_no_holders(monkeypatch):
    """institutional_holders가 None이면 institutional=[]."""
    from services import us_supply as svc

    fake_info = {"shortPercentOfFloat": 0.01, "shortRatio": 1.0,
                 "sharesShort": 1000, "dateShortInterest": None}

    monkeypatch.setattr(svc.yf, "Ticker", lambda sym: _fake_ticker(fake_info, None))

    result = svc.fetch_us_supply("AAPL")
    assert result["institutional"] == []


def test_fetch_returns_none_on_yfinance_exception(monkeypatch):
    """yfinance 예외 시 None 반환(crash 금지)."""
    from services import us_supply as svc

    def _boom(sym):
        raise RuntimeError("yfinance is down")

    monkeypatch.setattr(svc.yf, "Ticker", _boom)

    result = svc.fetch_us_supply("AAPL")
    assert result is None


def test_fetch_filters_non_finite_floats(monkeypatch):
    """NaN/inf info 값은 None으로 가드."""
    from services import us_supply as svc
    import math

    fake_info = {
        "shortPercentOfFloat": float("nan"),
        "shortRatio": float("inf"),
        "sharesShort": 5000,
        "dateShortInterest": None,
    }
    monkeypatch.setattr(svc.yf, "Ticker", lambda sym: _fake_ticker(fake_info, None))

    result = svc.fetch_us_supply("AAPL")
    assert result["short"]["short_pct_float"] is None
    assert result["short"]["short_ratio"] is None
    assert result["short"]["shares_short"] == 5000


# ── migrate: us_supply_snapshot 테이블 ────────────────────────────────────────

def test_migrate_creates_us_supply_snapshot_idempotent(monkeypatch):
    """_migrate()가 us_supply_snapshot CREATE TABLE IF NOT EXISTS를 실행한다."""
    import services.db as _db

    executed: list = []

    def fake_execute(sql, params=None):
        executed.append(sql)

    monkeypatch.setattr(_db, "execute", fake_execute)

    import main as _main
    _main._migrate()

    joined = "\n".join(executed)
    assert "us_supply_snapshot" in joined, "us_supply_snapshot 테이블 생성 SQL 없음"


# ── S2: GET /report/{ticker}/us-supply ────────────────────────────────────────

def _make_app():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routers import report as report_router
    from auth import get_current_user_or_api_key
    app = FastAPI()
    app.include_router(report_router.router)
    app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user"
    return TestClient(app)


def test_get_us_supply_returns_stored_data(monkeypatch):
    """저장된 행이 있으면 {short: {...}, institutional: [...]} 형태로 반환."""
    from services import us_supply as svc
    import json

    stored = {
        "short_pct_float": 0.0098,
        "short_ratio": 2.5,
        "shares_short": 75_000_000,
        "date_short_interest": "2026-05-01",
        "institutional_holders": [
            {"holder": "Vanguard", "pct_held": 0.08, "shares": 1000000, "pct_change": 0.001}
        ],
        "fetched_at": "2026-06-28T00:00:00",
    }

    monkeypatch.setattr(svc, "get_us_supply", lambda ticker: stored)

    client = _make_app()
    resp = client.get("/api/report/AAPL/us-supply")
    assert resp.status_code == 200
    body = resp.json()
    assert "short" in body
    assert "institutional" in body
    assert body["short"]["short_pct_float"] == pytest.approx(0.0098)
    assert len(body["institutional"]) == 1


def test_get_us_supply_no_data_returns_null(monkeypatch):
    """저장된 행 없으면 {short: null, institutional: []} graceful."""
    from services import us_supply as svc

    monkeypatch.setattr(svc, "get_us_supply", lambda ticker: None)

    client = _make_app()
    resp = client.get("/api/report/AAPL/us-supply")
    assert resp.status_code == 200
    body = resp.json()
    assert body["short"] is None
    assert body["institutional"] == []

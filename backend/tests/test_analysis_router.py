# backend/tests/test_analysis_router.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import pandas as pd
import numpy as np

from routers.analysis import router
from auth import get_current_user, require_admin

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
client = TestClient(app)

admin_app = FastAPI()
admin_app.include_router(router)
admin_app.dependency_overrides[get_current_user] = lambda: "test-user-id"
admin_app.dependency_overrides[require_admin] = lambda: "admin-id"
admin_client = TestClient(admin_app)


def _make_hist(seed: int, n: int = 70) -> MagicMock:
    rng = np.random.default_rng(seed)
    closes = 100.0 + np.cumsum(rng.standard_normal(n))
    dates = pd.date_range(end=pd.Timestamp("2026-05-24"), periods=n, freq="B")
    mock = MagicMock()
    mock.history.return_value = pd.DataFrame({"Close": closes}, index=dates)
    return mock


_STORED_11 = [
    {"name": n, "etf": e, "return_1w": 1.0, "return_1mo": 2.0, "return_3mo": 3.0}
    for n, e in [
        ("Technology", "XLK"), ("Financials", "XLF"), ("Health Care", "XLV"),
        ("Energy", "XLE"), ("Industrials", "XLI"), ("Consumer Discretionary", "XLY"),
        ("Consumer Staples", "XLP"), ("Materials", "XLB"), ("Utilities", "XLU"),
        ("Real Estate", "XLRE"), ("Communication Services", "XLC"),
    ]
]


def test_sector_returns_11_etfs():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("services.us_sector_service.load_momentum", return_value=_STORED_11), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_sector", side_effect=lambda user_id, loader, market="US": loader()):
        resp = client.get("/api/analysis/sector")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["sectors"]) == 11
    etfs = [s["etf"] for s in data["sectors"]]
    for etf in ["XLK", "XLF", "XLV", "XLE", "XLI", "XLY", "XLP", "XLB", "XLU", "XLRE", "XLC"]:
        assert etf in etfs


def test_sector_includes_return_fields():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("services.us_sector_service.load_momentum", return_value=_STORED_11), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_sector", side_effect=lambda user_id, loader, market="US": loader()):
        resp = client.get("/api/analysis/sector")
    s = resp.json()["sectors"][0]
    assert "return_1w" in s
    assert "return_1mo" in s
    assert "return_3mo" in s
    assert s["return_1w"] is not None
    assert s["return_1mo"] is not None
    assert s["return_3mo"] is not None


def test_sector_portfolio_overlay():
    portfolio = {
        "stocks": [{"ticker": "AAPL", "sector": "Technology", "quantity": 5}],
        "watchlist": [],
    }
    with patch("services.us_sector_service.load_momentum", return_value=_STORED_11), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.db_query", return_value=[{"ticker": "AAPL", "sector": "Technology"}]), \
         patch("routers.analysis.cache_svc.get_sector", side_effect=lambda user_id, loader, market="US": loader()):
        resp = client.get("/api/analysis/sector")
    assert resp.json()["portfolio_sectors"]["AAPL"] == "Technology"


def test_macro_returns_four_correlations():
    portfolio = {
        "stocks": [
            {"ticker": "AAPL", "market": "US", "exchange": "", "quantity": 5},
            {"ticker": "MSFT", "market": "US", "exchange": "", "quantity": 3},
        ],
        "watchlist": [],
    }
    def mock_ticker(sym):
        return _make_hist(abs(hash(sym)) % 97)
    with patch("services.analysis_service.yf.Ticker", side_effect=mock_ticker), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_macro", side_effect=lambda user_id, loader: loader()):
        resp = client.get("/api/analysis/macro-correlation")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["correlations"]) == 4
    tickers = [c["ticker"] for c in data["correlations"]]
    assert "TLT" in tickers
    assert "^VIX" in tickers


def test_macro_empty_for_no_holdings():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_macro", side_effect=lambda user_id, loader: loader()):
        resp = client.get("/api/analysis/macro-correlation")
    assert resp.status_code == 200
    assert resp.json() == {"correlations": [], "scatter": []}


def test_macro_scatter_contains_indicator_field():
    portfolio = {
        "stocks": [{"ticker": "AAPL", "market": "US", "exchange": "", "quantity": 10}],
        "watchlist": [],
    }
    def mock_ticker(sym):
        return _make_hist(abs(hash(sym)) % 97)
    with patch("services.analysis_service.yf.Ticker", side_effect=mock_ticker), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_macro", side_effect=lambda user_id, loader: loader()):
        resp = client.get("/api/analysis/macro-correlation")
    scatter = resp.json()["scatter"]
    if scatter:
        assert "indicator" in scatter[0]
        assert "macro_delta" in scatter[0]
        assert "portfolio_return" in scatter[0]


# ── S2: US 섹터 요청경로 저장값 전환 + refresh-us ──────────────────────────────

def test_us_sector_does_not_call_yfinance():
    """요청경로에서 yfinance 미호출: 저장값 read로 전환됐음을 단언."""
    portfolio = {"stocks": [], "watchlist": []}
    with patch("services.analysis_service.yf.Ticker", side_effect=AssertionError("yfinance must not be called for US sector")), \
         patch("services.us_sector_service.load_momentum", return_value=_STORED_11), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_sector", side_effect=lambda user_id, loader, market="US": loader()):
        resp = client.get("/api/analysis/sector?market=US")
    assert resp.status_code == 200
    assert len(resp.json()["sectors"]) == 11


def test_us_sector_empty_when_no_stored_data():
    """저장값 부재(빈 리스트)면 sectors 빈 리스트 — 라이브 폴백 금지."""
    portfolio = {"stocks": [], "watchlist": []}
    with patch("services.us_sector_service.load_momentum", return_value=[]), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_sector", side_effect=lambda user_id, loader, market="US": loader()):
        resp = client.get("/api/analysis/sector?market=US")
    assert resp.status_code == 200
    assert resp.json()["sectors"] == []


def test_refresh_us_records_manual_and_invalidates_cache():
    """refresh-us: us_sector_service.refresh 호출 + job_runs.record("us_sector_fetch","manual") + invalidate_sector."""
    from contextlib import contextmanager
    recorded = []

    @contextmanager
    def fake_record(job_id, trigger):
        recorded.append((job_id, trigger))
        yield 1

    with patch("routers.analysis.job_runs.record", fake_record), \
         patch("routers.analysis.us_sector_service.refresh", return_value=[{"name": "Technology"}]) as mock_refresh, \
         patch("routers.analysis.cache_svc.invalidate_sector") as mock_inv:
        resp = admin_client.post("/api/analysis/sector/refresh-us")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "sectors": 1}
    assert ("us_sector_fetch", "manual") in recorded
    mock_refresh.assert_called_once()
    mock_inv.assert_called_once()


def test_refresh_us_requires_admin():
    """require_admin 미오버라이드: 비-admin이면 403."""
    with patch("auth.auth_service.get_user_by_id", return_value={"role": "user"}):
        resp = client.post("/api/analysis/sector/refresh-us")
    assert resp.status_code == 403

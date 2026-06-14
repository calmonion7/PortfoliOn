"""GET /api/analysis/sector?market=KR + 수동 refresh (task 48, S5).

KR 분기는 저장된 momentum(sectors) + portfolio_sectors(보유 KR 종목→업종)를 US와 동형 출력.
US/미지정은 기존 yfinance 경로 불변.
"""
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


# ── US 경로 불변 (회귀 0) ──────────────────────────────────────────────────────
def test_us_default_path_unchanged():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("services.analysis_service.yf.Ticker", return_value=_make_hist(0)), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_sector", side_effect=lambda user_id, loader, market="US": loader()):
        resp = client.get("/api/analysis/sector")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["sectors"]) == 11
    assert "XLK" in [s["etf"] for s in data["sectors"]]


def test_us_explicit_market_unchanged():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("services.analysis_service.yf.Ticker", return_value=_make_hist(0)), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_sector", side_effect=lambda user_id, loader, market="US": loader()):
        resp = client.get("/api/analysis/sector?market=US")
    assert resp.status_code == 200
    assert len(resp.json()["sectors"]) == 11


# ── KR 분기: 저장 momentum + portfolio_sectors, US와 동형 ──────────────────────
def test_kr_returns_stored_momentum_and_portfolio_sectors():
    stored = [
        {"name": "전기/전자", "code": "013", "return_1w": 1.2, "return_1mo": 3.4, "return_3mo": 5.6},
        {"name": "화학", "code": "008", "return_1w": -0.5, "return_1mo": 0.7, "return_3mo": 2.1},
    ]
    portfolio = {"stocks": [{"ticker": "005930", "market": "KR"}], "watchlist": []}
    with patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.kr_sector_service.load_momentum", return_value=stored), \
         patch("routers.analysis.kr_sector_service.map_holdings_to_sectors",
               return_value={"005930": "전기/전자"}), \
         patch("routers.analysis.cache_svc.get_sector", side_effect=lambda user_id, loader, market="US": loader()):
        resp = client.get("/api/analysis/sector?market=KR")
    assert resp.status_code == 200
    data = resp.json()
    # US와 동형: sectors[].return_1w/1mo/3mo + portfolio_sectors
    assert data["sectors"] == stored
    s = data["sectors"][0]
    assert {"return_1w", "return_1mo", "return_3mo"}.issubset(s.keys())
    assert data["portfolio_sectors"] == {"005930": "전기/전자"}


def test_kr_does_not_call_yfinance():
    """KR 분기는 yfinance를 호출하지 않는다(키움 저장값 서빙)."""
    portfolio = {"stocks": [], "watchlist": []}
    with patch("services.analysis_service.yf.Ticker", side_effect=AssertionError("yfinance must not be called for KR")), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.kr_sector_service.load_momentum", return_value=[]), \
         patch("routers.analysis.kr_sector_service.map_holdings_to_sectors", return_value={}), \
         patch("routers.analysis.cache_svc.get_sector", side_effect=lambda user_id, loader, market="US": loader()):
        resp = client.get("/api/analysis/sector?market=KR")
    assert resp.status_code == 200
    assert resp.json() == {"sectors": [], "portfolio_sectors": {}}


def test_cache_keyed_by_market():
    """US와 KR이 같은 user_id로 캐시 충돌하지 않게 market을 캐시키에 반영."""
    seen = []

    def fake_get_sector(user_id, loader, market="US"):
        seen.append(market)
        return loader()

    portfolio = {"stocks": [], "watchlist": []}
    with patch("services.analysis_service.yf.Ticker", return_value=_make_hist(0)), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.kr_sector_service.load_momentum", return_value=[]), \
         patch("routers.analysis.kr_sector_service.map_holdings_to_sectors", return_value={}), \
         patch("routers.analysis.cache_svc.get_sector", side_effect=fake_get_sector):
        client.get("/api/analysis/sector?market=US")
        client.get("/api/analysis/sector?market=KR")
    assert seen == ["US", "KR"]


# ── 수동 refresh 엔드포인트 (admin, kr_sector_fetch manual 기록) ────────────────
def test_manual_refresh_kr_records_manual():
    from contextlib import contextmanager
    recorded = []

    @contextmanager
    def fake_record(job_id, trigger):
        recorded.append((job_id, trigger))
        yield 1

    with patch("routers.analysis.job_runs.record", fake_record), \
         patch("routers.analysis.kr_sector_service.refresh", return_value=[{"name": "화학"}]):
        resp = admin_client.post("/api/analysis/sector/refresh-kr")
    assert resp.status_code == 200
    assert ("kr_sector_fetch", "manual") in recorded
    assert resp.json()["ok"] is True
    assert resp.json()["sectors"] == 1


def test_manual_refresh_kr_requires_admin():
    """require_admin 미오버라이드: 비-admin이면 403."""
    with patch("auth.auth_service.get_user_by_id", return_value={"role": "user"}):
        resp = client.post("/api/analysis/sector/refresh-kr")
    assert resp.status_code == 403

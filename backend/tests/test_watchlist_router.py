from copy import deepcopy
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.watchlist import router
from auth import get_current_user

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
client = TestClient(app)

SAMPLE_STOCKS = [
    {"ticker": "NFLX", "name": "Netflix", "competitors": [], "moat": "", "growth_plan": ""},
    {"ticker": "NVDA", "name": "Nvidia", "competitors": [], "moat": "", "growth_plan": ""},
]
SAMPLE_HOLDINGS = [{"ticker": "NFLX", "quantity": 10, "avg_cost": 85.59}]
SAMPLE_WATCHLIST = ["NVDA"]


def test_get_watchlist_returns_items():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=SAMPLE_WATCHLIST), \
         patch("routers.watchlist.storage.get_stocks", return_value=SAMPLE_STOCKS):
        resp = client.get("/api/watchlist")
    assert resp.status_code == 200
    assert resp.json()[0]["ticker"] == "NVDA"
    assert resp.json()[0]["name"] == "Nvidia"


def test_add_watchlist_stock_saves_ticker_and_stock_data():
    with patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.get_watchlist_tickers", return_value=[]), \
         patch("routers.watchlist.storage.get_stocks", return_value=[]), \
         patch("routers.watchlist.storage.save_stocks") as mock_save_stocks, \
         patch("routers.watchlist.storage.save_watchlist_tickers") as mock_save_watchlist, \
         patch("routers.watchlist.storage.get_schedule", return_value={}), \
         patch("routers.watchlist.cache_svc.invalidate_portfolio_caches"), \
         patch("routers.watchlist.db_query", return_value=[]):
        resp = client.post("/api/watchlist", json={
            "ticker": "TSLA", "name": "Tesla",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 201
    saved_tickers = mock_save_watchlist.call_args[0][1]
    assert "TSLA" in saved_tickers
    saved_stocks = mock_save_stocks.call_args[0][1]
    assert saved_stocks[0]["ticker"] == "TSLA"


def test_add_duplicate_in_holdings_returns_400():
    with patch("routers.watchlist.storage.get_holdings", return_value=SAMPLE_HOLDINGS), \
         patch("routers.watchlist.storage.get_watchlist_tickers", return_value=[]):
        resp = client.post("/api/watchlist", json={
            "ticker": "NFLX", "name": "Netflix",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 400


def test_add_duplicate_in_watchlist_returns_400():
    with patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.get_watchlist_tickers", return_value=SAMPLE_WATCHLIST):
        resp = client.post("/api/watchlist", json={
            "ticker": "NVDA", "name": "Nvidia",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 400


def test_update_watchlist_stock_preserves_structured_analysis():
    """관심종목 수정도 name·competitors만 갱신하고 구조화 분석은 보존해야 한다."""
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=["NVDA"]), \
         patch("routers.watchlist.storage.get_stocks", return_value=[
             {"ticker": "NVDA", "name": "Nvidia", "competitors": [],
              "moat": {"summary": "GPU dominance", "factors": []}, "growth_plan": {"initiatives": []}}
         ]), \
         patch("routers.watchlist.storage.update_ticker_meta") as mock_update_meta, \
         patch("routers.watchlist.storage.save_stocks") as mock_save_stocks, \
         patch("routers.watchlist.cache_svc.invalidate_portfolio_caches"):
        resp = client.put("/api/watchlist/NVDA", json={
            "ticker": "NVDA", "name": "NVIDIA Corp", "competitors": ["AMD"]
        })
    assert resp.status_code == 200
    mock_update_meta.assert_called_once_with("NVDA", "NVIDIA Corp", ["AMD"])
    mock_save_stocks.assert_not_called()


def test_delete_watchlist_removes_from_watchlist_and_stocks():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=["NVDA"]), \
         patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.save_watchlist_tickers") as mock_save_watchlist, \
         patch("routers.watchlist.cache_svc.invalidate_portfolio_caches"):
        resp = client.delete("/api/watchlist/NVDA")
    assert resp.status_code == 200
    assert mock_save_watchlist.call_args[0][1] == []


def test_delete_watchlist_keeps_stock_data_when_in_holdings():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=["NFLX"]), \
         patch("routers.watchlist.storage.get_holdings", return_value=SAMPLE_HOLDINGS), \
         patch("routers.watchlist.storage.save_watchlist_tickers"), \
         patch("routers.watchlist.storage.save_stocks") as mock_save_stocks, \
         patch("routers.watchlist.cache_svc.invalidate_portfolio_caches"):
        resp = client.delete("/api/watchlist/NFLX")
    assert resp.status_code == 200
    mock_save_stocks.assert_not_called()


def test_delete_nonexistent_returns_404():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=[]):
        resp = client.delete("/api/watchlist/FAKE")
    assert resp.status_code == 404


def test_promote_moves_ticker_to_holdings():
    # save_watchlist_tickers는 promote 경로에서 더 이상 호출되지 않는다 — save_holdings의
    # ON CONFLICT UPDATE가 기존 watchlist 행을 type='holding'으로 전환한다(pinned 보존, task#182).
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=["NVDA"]), \
         patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.get_stocks", return_value=[
             {"ticker": "NVDA", "name": "Nvidia", "competitors": ["AMD"], "moat": "GPU", "growth_plan": "AI"}
         ]), \
         patch("routers.watchlist.storage.save_watchlist_tickers") as mock_save_watchlist, \
         patch("routers.watchlist.storage.save_holdings") as mock_save_holdings, \
         patch("routers.watchlist.cache_svc.invalidate_portfolio_caches"):
        resp = client.post("/api/watchlist/NVDA/promote",
                           json={"quantity": 5, "avg_cost": 200.0})
    assert resp.status_code == 200
    mock_save_watchlist.assert_not_called()
    saved_holdings = mock_save_holdings.call_args[0][1]
    assert saved_holdings[0]["ticker"] == "NVDA"
    assert saved_holdings[0]["quantity"] == 5
    assert saved_holdings[0]["avg_cost"] == 200.0
    assert resp.json()["moat"] == "GPU"


def test_promote_nonexistent_returns_404():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=[]):
        resp = client.post("/api/watchlist/FAKE/promote",
                           json={"quantity": 1, "avg_cost": 100.0})
    assert resp.status_code == 404


def test_promote_already_in_holdings_returns_400():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=["NVDA"]), \
         patch("routers.watchlist.storage.get_holdings", return_value=[
             {"ticker": "NVDA", "quantity": 1, "avg_cost": 100.0}
         ]):
        resp = client.post("/api/watchlist/NVDA/promote",
                           json={"quantity": 5, "avg_cost": 200.0})
    assert resp.status_code == 400


def test_promote_invalidates_dashboard_cache():
    with patch("routers.watchlist.cache_svc") as mock_cache, \
         patch("routers.watchlist.storage.get_watchlist_tickers", return_value=["NVDA"]), \
         patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.get_stocks", return_value=[
             {"ticker": "NVDA", "name": "Nvidia", "market": "US", "exchange": ""}
         ]), \
         patch("routers.watchlist.storage.save_watchlist_tickers"), \
         patch("routers.watchlist.storage.save_holdings"):
        resp = client.post("/api/watchlist/NVDA/promote", json={"quantity": 10, "avg_cost": 500.0})
    assert resp.status_code == 200
    mock_cache.invalidate_portfolio_caches.assert_called_once()


def test_add_watchlist_stock_triggers_report_when_no_snapshot():
    with patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.get_watchlist_tickers", return_value=[]), \
         patch("routers.watchlist.storage.get_stocks", return_value=[]), \
         patch("routers.watchlist.storage.save_stocks"), \
         patch("routers.watchlist.storage.save_watchlist_tickers"), \
         patch("routers.watchlist.storage.get_schedule", return_value={}), \
         patch("routers.watchlist.cache_svc.invalidate_portfolio_caches"), \
         patch("routers.watchlist.db_query", return_value=[]) as mock_query, \
         patch("routers.watchlist.report_generator.generate_report") as mock_gen:
        resp = client.post("/api/watchlist", json={
            "ticker": "TSLA", "name": "Tesla",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 201
    assert mock_query.call_count >= 1
    call_args = mock_query.call_args
    assert "snapshots" in call_args[0][0]
    assert "TSLA" in call_args[0][1]
    mock_gen.assert_called_once()


def test_add_watchlist_stock_skips_report_when_snapshot_exists():
    with patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.get_watchlist_tickers", return_value=[]), \
         patch("routers.watchlist.storage.get_stocks", return_value=[]), \
         patch("routers.watchlist.storage.save_stocks"), \
         patch("routers.watchlist.storage.save_watchlist_tickers"), \
         patch("routers.watchlist.storage.get_schedule", return_value={}), \
         patch("routers.watchlist.cache_svc.invalidate_portfolio_caches"), \
         patch("routers.watchlist.db_query", return_value=[{"ticker": "TSLA", "date": "2026-05-01"}]), \
         patch("routers.watchlist.report_generator.generate_report") as mock_gen:
        resp = client.post("/api/watchlist", json={
            "ticker": "TSLA", "name": "Tesla",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 201
    mock_gen.assert_not_called()


def test_generate_with_consensus_backfills_via_pipeline():
    """관심 종목 추가 후 자동 리포트가 정본 _pipeline.backfill(→ mart)로 백필한다 (ADR-0008)."""
    from routers import watchlist
    stock = {"ticker": "AAPL", "market": "US"}
    with patch("routers.watchlist.report_generator.generate_report"), \
         patch("routers.watchlist.cache_svc.invalidate"), \
         patch("routers.watchlist._pipeline.backfill", return_value=3) as mock_bf:
        watchlist._generate_with_consensus(dict(stock))
    mock_bf.assert_called_once_with([stock], days=180)

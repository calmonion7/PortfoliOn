import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.portfolio import router
from auth import get_current_user

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
client = TestClient(app)

SAMPLE_STOCKS = [
    {"ticker": "NFLX", "name": "Netflix", "competitors": ["DIS"], "moat": "Content", "growth_plan": "Gaming"}
]
SAMPLE_HOLDINGS = [
    {"ticker": "NFLX", "quantity": 10, "avg_cost": 85.59}
]
SAMPLE_FULL = {
    "stocks": [{"ticker": "NFLX", "name": "Netflix", "quantity": 10, "avg_cost": 85.59,
                "competitors": ["DIS"], "moat": "Content", "growth_plan": "Gaming"}],
    "watchlist": []
}


def test_get_portfolio_returns_full_portfolio():
    with patch("routers.portfolio.storage.get_full_portfolio", return_value=SAMPLE_FULL):
        resp = client.get("/api/portfolio")
    assert resp.status_code == 200
    assert resp.json()["stocks"][0]["ticker"] == "NFLX"


def test_add_stock_saves_to_holdings_and_stocks():
    with patch("routers.portfolio.storage.get_holdings", return_value=[]), \
         patch("routers.portfolio.storage.get_stocks", return_value=[]), \
         patch("routers.portfolio.storage.save_stocks") as mock_save_stocks, \
         patch("routers.portfolio.storage.save_holdings") as mock_save_holdings, \
         patch("routers.portfolio.storage.get_schedule", return_value={}), \
         patch("routers.portfolio.db_query", return_value=[]):
        resp = client.post("/api/portfolio", json={
            "ticker": "NVDA", "name": "Nvidia", "quantity": 5, "avg_cost": 200.0,
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 201
    saved_holdings = mock_save_holdings.call_args[0][1]
    assert saved_holdings[0]["ticker"] == "NVDA"
    assert saved_holdings[0]["quantity"] == 5
    saved_stocks = mock_save_stocks.call_args[0][1]
    assert saved_stocks[0]["ticker"] == "NVDA"


def test_add_duplicate_ticker_returns_400():
    with patch("routers.portfolio.storage.get_holdings", return_value=SAMPLE_HOLDINGS):
        resp = client.post("/api/portfolio", json={
            "ticker": "NFLX", "name": "Netflix", "quantity": 5, "avg_cost": 90.0,
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 400


def test_update_stock_updates_holdings_and_preserves_structured_analysis():
    """수정 시 수량/평단은 갱신하고 name·competitors만 마스터에 반영하되,
    구조화된 moat/growth_plan 등은 덮어쓰지 않고 보존해야 한다."""
    structured = [{
        "ticker": "NFLX", "name": "Netflix", "competitors": ["DIS"],
        "moat": {"summary": "Content moat", "factors": []},
        "growth_plan": {"initiatives": []},
    }]
    with patch("routers.portfolio.storage.get_holdings", return_value=list(SAMPLE_HOLDINGS)), \
         patch("routers.portfolio.storage.get_stocks", return_value=structured), \
         patch("routers.portfolio.storage.save_holdings") as mock_save_holdings, \
         patch("routers.portfolio.storage.update_ticker_meta") as mock_update_meta, \
         patch("routers.portfolio.storage.save_stocks") as mock_save_stocks:
        resp = client.put("/api/portfolio/NFLX", json={
            "ticker": "NFLX", "name": "Netflix Inc", "quantity": 20, "avg_cost": 90.0,
            "competitors": ["DIS", "WBD"]
        })
    assert resp.status_code == 200
    # 보유 수량 갱신
    assert mock_save_holdings.call_args[0][1][0]["quantity"] == 20
    # 편집 가능 필드만 갱신 (ticker, name, competitors)
    mock_update_meta.assert_called_once_with("NFLX", "Netflix Inc", ["DIS", "WBD"])
    # 구조화 분석을 덮어쓰는 save_stocks 경로는 호출되지 않아야 함
    mock_save_stocks.assert_not_called()


def test_delete_stock_removes_from_holdings_and_adds_to_watchlist():
    with patch("routers.portfolio.storage.get_holdings", return_value=list(SAMPLE_HOLDINGS)), \
         patch("routers.portfolio.storage.get_watchlist_tickers", return_value=[]), \
         patch("routers.portfolio.storage.save_holdings") as mock_save_holdings, \
         patch("routers.portfolio.storage.save_watchlist_tickers") as mock_save_watchlist:
        resp = client.delete("/api/portfolio/NFLX")
    assert resp.status_code == 200
    assert mock_save_holdings.call_args[0][1] == []
    assert "NFLX" in mock_save_watchlist.call_args[0][1]


def test_delete_stock_keeps_stock_data_when_in_watchlist():
    with patch("routers.portfolio.storage.get_holdings", return_value=list(SAMPLE_HOLDINGS)), \
         patch("routers.portfolio.storage.get_watchlist_tickers", return_value=["NFLX"]), \
         patch("routers.portfolio.storage.save_holdings"), \
         patch("routers.portfolio.storage.save_stocks") as mock_save_stocks:
        resp = client.delete("/api/portfolio/NFLX")
    assert resp.status_code == 200
    mock_save_stocks.assert_not_called()


def test_delete_nonexistent_ticker_returns_404():
    with patch("routers.portfolio.storage.get_holdings", return_value=[]):
        resp = client.delete("/api/portfolio/FAKE")
    assert resp.status_code == 404


def test_add_stock_triggers_report_when_no_snapshot():
    with patch("routers.portfolio.storage.get_holdings", return_value=[]), \
         patch("routers.portfolio.storage.get_stocks", return_value=[]), \
         patch("routers.portfolio.storage.save_stocks"), \
         patch("routers.portfolio.storage.save_holdings"), \
         patch("routers.portfolio.storage.get_schedule", return_value={}), \
         patch("routers.portfolio.cache_svc.invalidate_portfolio_caches"), \
         patch("routers.portfolio.db_query", return_value=[]) as mock_query, \
         patch("routers.portfolio.report_generator.generate_report") as mock_gen:
        resp = client.post("/api/portfolio", json={
            "ticker": "TSLA", "name": "Tesla", "quantity": 5,
            "avg_cost": 200.0, "market": "US", "exchange": ""
        })
    assert resp.status_code == 201
    assert mock_query.call_count >= 1
    call_args = mock_query.call_args
    assert "snapshots" in call_args[0][0]
    assert "TSLA" in call_args[0][1]
    mock_gen.assert_called_once()


def test_add_stock_skips_report_when_snapshot_exists():
    with patch("routers.portfolio.storage.get_holdings", return_value=[]), \
         patch("routers.portfolio.storage.get_stocks", return_value=[]), \
         patch("routers.portfolio.storage.save_stocks"), \
         patch("routers.portfolio.storage.save_holdings"), \
         patch("routers.portfolio.storage.get_schedule", return_value={}), \
         patch("routers.portfolio.cache_svc.invalidate_portfolio_caches"), \
         patch("routers.portfolio.db_query", return_value=[{"ticker": "TSLA", "date": "2026-05-01"}]), \
         patch("routers.portfolio.report_generator.generate_report") as mock_gen:
        resp = client.post("/api/portfolio", json={
            "ticker": "TSLA", "name": "Tesla", "quantity": 5,
            "avg_cost": 200.0, "market": "US", "exchange": ""
        })
    assert resp.status_code == 201
    mock_gen.assert_not_called()


def test_get_rebalance_computes_drift_from_holdings_and_quotes():
    holdings = [
        {"ticker": "AAPL", "market": "US", "quantity": 10, "target_weight": 100.0, "exchange": ""},
    ]
    with patch("routers.portfolio.storage.get_holdings", return_value=holdings), \
         patch("routers.portfolio.market_svc.get_quotes_batch", return_value={"AAPL": {"price": 150.0}}), \
         patch("routers.portfolio._usdkrw_rate", return_value=1300.0):
        resp = client.get("/api/portfolio/rebalance")
    assert resp.status_code == 200
    body = resp.json()
    assert body["holdings"][0]["ticker"] == "AAPL"
    assert body["holdings"][0]["current_weight"] == pytest.approx(100.0)
    assert body["holdings"][0]["target_weight"] == pytest.approx(100.0)


def test_put_rebalance_targets_saves_only_held_tickers():
    holdings = [{"ticker": "AAPL", "market": "US", "quantity": 10}]
    with patch("routers.portfolio.storage.get_holdings", return_value=holdings), \
         patch("routers.portfolio.storage.set_target_weights") as mock_set:
        resp = client.put("/api/portfolio/rebalance/targets", json={"AAPL": 60, "NOTHELD": 40})
    assert resp.status_code == 200
    assert resp.json() == {"updated": 1, "targets": {"AAPL": 60}}
    mock_set.assert_called_once_with("test-user-id", {"AAPL": 60})


def test_generate_with_consensus_backfills_via_pipeline():
    """종목 추가 후 자동 리포트가 정본 _pipeline.backfill(→ mart)로 백필한다 (ADR-0008)."""
    from routers import portfolio
    stock = {"ticker": "AAPL", "market": "US"}
    with patch("routers.portfolio.report_generator.generate_report"), \
         patch("routers.portfolio.cache_svc.invalidate"), \
         patch("routers.portfolio._pipeline.backfill", return_value=3) as mock_bf:
        portfolio._generate_with_consensus(dict(stock))
    mock_bf.assert_called_once_with([stock], days=180)

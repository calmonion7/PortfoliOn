import json
from contextlib import contextmanager
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from routers.report import router
from auth import get_current_user, require_admin, get_current_user_or_api_key, require_admin_or_api_key


@pytest.fixture(autouse=True)
def _stub_job_runs(monkeypatch):
    """백그라운드 워커에 추가된 job_runs.record 계측이 테스트 DB를 건드리지 않도록 no-op로 대체."""
    import services.job_runs as job_runs

    @contextmanager
    def _noop(job_id, trigger):
        yield 1

    monkeypatch.setattr(job_runs, "record", _noop)


app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
app.dependency_overrides[require_admin] = lambda: "test-user-id"
app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
app.dependency_overrides[require_admin_or_api_key] = lambda: "test-user-id"
client = TestClient(app)

FULL_PORTFOLIO = {
    "stocks": [{"ticker": "LLY", "quantity": 3.0, "avg_cost": 886.6,
                "name": "일라이 릴리", "competitors": [], "moat": "", "growth_plan": ""}],
    "watchlist": [],
}

SAMPLE_SUMMARY = {
    "ticker": "LLY", "name": "일라이 릴리", "date": "2026-05-05",
    "price": 890.0, "target_mean": 980.0, "buy": 15, "hold": 3, "sell": 1,
    "finviz_recom": 1.8, "moat": "Strong brand", "risks": "IRA risk",
    "growth_plan": "GLP1", "recent_disclosures": "Q1 호조",
    "competitors_data": [{"ticker": "LLY", "price": 890.0}],
    "news": [{"title": "News", "link": "http://x.com", "publisher": "Reuters", "published_at": "2026-05-05"}],
    "daily_rsi": {"rsi": 45.2, "target_20": 800.0},
}


def test_list_reports_detects_json_snapshots():
    date_rows = [{"ticker": "LLY", "date": "2026-05-05"}]
    summary_rows = [{"ticker": "LLY", "date": "2026-05-05", "data": SAMPLE_SUMMARY}]
    with patch("routers.report.query", side_effect=[date_rows, summary_rows]), \
         patch("routers.report.storage.get_full_portfolio", return_value=FULL_PORTFOLIO), \
         patch("routers.report.storage.get_schedule", return_value={}), \
         patch("routers.report.cache_svc.get_list", side_effect=lambda f: f()):
        resp = client.get("/api/report/list")
    assert resp.status_code == 200
    data = resp.json()["stocks"]
    assert "LLY" in data
    assert data["LLY"]["summary"]["target_mean"] == 980.0
    assert "2026-05-05" in data["LLY"]["dates"]


def test_list_reports_no_markdown_in_dates():
    date_rows = [{"ticker": "LLY", "date": "2026-05-05"}]
    summary_rows = [{"ticker": "LLY", "date": "2026-05-05", "data": SAMPLE_SUMMARY}]
    with patch("routers.report.query", side_effect=[date_rows, summary_rows]), \
         patch("routers.report.storage.get_full_portfolio", return_value=FULL_PORTFOLIO), \
         patch("routers.report.storage.get_schedule", return_value={}), \
         patch("routers.report.cache_svc.get_list", side_effect=lambda f: f()):
        resp = client.get("/api/report/list")
    dates = resp.json()["stocks"]["LLY"]["dates"]
    assert all(not d.endswith(".md") for d in dates)


def test_get_report_returns_summary_no_content(tmp_path):
    ticker_dir = tmp_path / "LLY"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-05.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    with patch("routers.report.SNAPSHOTS_DIR", tmp_path), \
         patch("routers.report.REPORTS_DIR", tmp_path / "legacy"), \
         patch("routers.report.query", return_value=[]), \
         patch("routers.report.cache_svc._snapshots", {}), \
         patch("routers.report.cache_svc._list_cache", {"data": None, "ts": 0.0}):
        resp = client.get("/api/report/LLY/2026-05-05")
    assert resp.status_code == 200
    body = resp.json()
    assert "content" not in body
    assert body["summary"]["target_mean"] == 980.0
    assert body["summary"]["moat"] == "Strong brand"
    assert body["summary"]["risks"] == "IRA risk"


def test_get_report_fallback_to_reports_dir(tmp_path):
    legacy_dir = tmp_path / "legacy"
    legacy_ticker = legacy_dir / "LLY"
    legacy_ticker.mkdir(parents=True)
    (legacy_ticker / "2026-05-01.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    snapshots_dir = tmp_path / "snapshots"
    snapshots_dir.mkdir()
    with patch("routers.report.SNAPSHOTS_DIR", snapshots_dir), \
         patch("routers.report.REPORTS_DIR", legacy_dir), \
         patch("routers.report.query", return_value=[]), \
         patch("routers.report.cache_svc._snapshots", {}), \
         patch("routers.report.cache_svc._list_cache", {"data": None, "ts": 0.0}):
        resp = client.get("/api/report/LLY/2026-05-01")
    assert resp.status_code == 200
    assert resp.json()["summary"]["target_mean"] == 980.0


def test_get_report_404_when_not_found(tmp_path):
    with patch("routers.report.SNAPSHOTS_DIR", tmp_path), \
         patch("routers.report.REPORTS_DIR", tmp_path / "legacy"), \
         patch("routers.report.query", return_value=[]), \
         patch("routers.report.cache_svc._snapshots", {}), \
         patch("routers.report.cache_svc._list_cache", {"data": None, "ts": 0.0}):
        resp = client.get("/api/report/LLY/2000-01-01")
    assert resp.status_code == 404


SAMPLE_SUMMARY_WITH_RSI = {
    "ticker": "LLY", "name": "일라이 릴리", "date": "2026-05-05",
    "price": 890.0, "target_mean": 980.0, "target_high": 1100.0, "target_low": 850.0,
    "buy": 15, "hold": 3, "sell": 1,
    "daily_rsi": {"rsi": 45.2, "target_20": 800.0},
    "weekly_rsi": {"rsi": 55.1, "target_20": 780.0},
    "monthly_rsi": {"rsi": 62.3, "target_20": 760.0},
}

SAMPLE_SUMMARY_2 = {
    "ticker": "LLY", "name": "일라이 릴리", "date": "2026-05-06",
    "price": 900.0, "target_mean": 990.0, "target_high": 1110.0, "target_low": 860.0,
    "buy": 16, "hold": 3, "sell": 1,
    "daily_rsi": {"rsi": 47.0, "target_20": 810.0},
    "weekly_rsi": {"rsi": 56.0, "target_20": 790.0},
    "monthly_rsi": None,
}


def test_get_history_returns_sorted_lean_array():
    rows = [
        {"date": "2026-05-05", "data": SAMPLE_SUMMARY_WITH_RSI},
        {"date": "2026-05-06", "data": SAMPLE_SUMMARY_2},
    ]
    with patch("routers.report.query", side_effect=[[], rows]):
        resp = client.get("/api/report/LLY/history")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["date"] == "2026-05-05"
    assert data[1]["date"] == "2026-05-06"
    assert data[0]["price"] == 890.0
    assert data[0]["target_mean"] == 980.0
    assert data[0]["target_high"] == 1100.0
    assert data[0]["target_low"] == 850.0
    assert data[0]["buy"] == 15
    assert data[0]["hold"] == 3
    assert data[0]["sell"] == 1
    assert data[0]["rsi_daily"] == 45.2
    assert data[0]["rsi_weekly"] == 55.1
    assert data[0]["rsi_monthly"] == 62.3


def test_get_history_handles_null_rsi():
    rows = [{"date": "2026-05-06", "data": SAMPLE_SUMMARY_2}]
    with patch("routers.report.query", side_effect=[[], rows]):
        resp = client.get("/api/report/LLY/history")
    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["rsi_monthly"] is None


def test_get_history_empty_when_no_snapshots():
    with patch("routers.report.query", return_value=[]):
        resp = client.get("/api/report/LLY/history")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_history_fallback_to_reports_dir():
    rows = [{"date": "2026-05-01", "data": SAMPLE_SUMMARY_WITH_RSI}]
    with patch("routers.report.query", return_value=rows):
        resp = client.get("/api/report/LLY/history")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_generate_all_runs_all_stocks():
    two_stocks = {
        "stocks": [
            {"ticker": "AAPL", "quantity": 1.0, "avg_cost": 150.0, "name": "Apple", "competitors": [], "moat": "", "growth_plan": "", "market": "US", "exchange": ""},
            {"ticker": "MSFT", "quantity": 1.0, "avg_cost": 300.0, "name": "Microsoft", "competitors": [], "moat": "", "growth_plan": "", "market": "US", "exchange": ""},
        ],
        "watchlist": [],
    }
    generated = []

    def _fake_generate(stock, target_date=None):
        generated.append(stock["ticker"])

    with patch("routers.report.storage.get_global_portfolio", return_value=two_stocks), \
         patch("routers.report.storage.get_schedule", return_value={}), \
         patch("routers.report.report_generator.generate_report", side_effect=_fake_generate), \
         patch("routers.report.cache_svc.invalidate"), \
         patch("routers.report._pipeline.run_daily"):
        resp = client.post("/api/report/generate")
    assert resp.status_code == 202
    assert set(generated) == {"AAPL", "MSFT"}


def test_generate_all_continues_on_one_failure():
    two_stocks = {
        "stocks": [
            {"ticker": "AAPL", "quantity": 1.0, "avg_cost": 150.0, "name": "Apple", "competitors": [], "moat": "", "growth_plan": "", "market": "US", "exchange": ""},
            {"ticker": "MSFT", "quantity": 1.0, "avg_cost": 300.0, "name": "Microsoft", "competitors": [], "moat": "", "growth_plan": "", "market": "US", "exchange": ""},
        ],
        "watchlist": [],
    }
    generated = []

    def _fake_generate(stock, target_date=None):
        if stock["ticker"] == "AAPL":
            raise RuntimeError("api down")
        generated.append(stock["ticker"])

    with patch("routers.report.storage.get_global_portfolio", return_value=two_stocks), \
         patch("routers.report.storage.get_schedule", return_value={}), \
         patch("routers.report.report_generator.generate_report", side_effect=_fake_generate), \
         patch("routers.report.cache_svc.invalidate"), \
         patch("routers.report._pipeline.run_daily"):
        resp = client.post("/api/report/generate")
    assert resp.status_code == 202
    assert "MSFT" in generated


# --- 403 tests: use a separate app without require_admin override ---

_nonadmin_app = FastAPI()
_nonadmin_app.include_router(router)
_nonadmin_app.dependency_overrides[get_current_user] = lambda: "test-user-id"
_nonadmin_app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
_nonadmin_client = TestClient(_nonadmin_app)


def test_generate_one_allowed_for_user():
    stock = {"ticker": "AAPL", "name": "Apple", "competitors": [], "moat": "", "growth_plan": "", "market": "US", "exchange": ""}
    with patch("routers.report.storage.get_all_stocks", return_value=[stock]), \
         patch("routers.report.report_generator.generate_report"), \
         patch("routers.report.cache_svc.invalidate"), \
         patch("routers.report._pipeline.run_daily"):
        resp = _nonadmin_client.post("/api/report/generate/AAPL")
    assert resp.status_code == 202


def test_generate_batch_blocked_for_non_admin():
    with patch("auth.auth_service.get_user_by_id", return_value={"role": "user"}):
        resp = _nonadmin_client.post("/api/report/generate?tickers=AAPL")
    assert resp.status_code == 403


def test_backfill_blocked_for_non_admin():
    with patch("auth.auth_service.get_user_by_id", return_value={"role": "user"}):
        resp = _nonadmin_client.post("/api/report/backfill")
    assert resp.status_code == 403

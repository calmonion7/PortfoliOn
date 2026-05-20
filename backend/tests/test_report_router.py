import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.report import router

app = FastAPI()
app.include_router(router)
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


def test_list_reports_detects_json_snapshots(tmp_path):
    ticker_dir = tmp_path / "LLY"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-05.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    with patch("routers.report.SNAPSHOTS_DIR", tmp_path), \
         patch("routers.report.REPORTS_DIR", tmp_path / "legacy"), \
         patch("routers.report.storage.get_full_portfolio", return_value=FULL_PORTFOLIO):
        resp = client.get("/api/report/list")
    assert resp.status_code == 200
    data = resp.json()
    assert "LLY" in data
    assert data["LLY"]["summary"]["target_mean"] == 980.0
    assert "2026-05-05" in data["LLY"]["dates"]


def test_list_reports_no_markdown_in_dates(tmp_path):
    ticker_dir = tmp_path / "LLY"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-05.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    with patch("routers.report.SNAPSHOTS_DIR", tmp_path), \
         patch("routers.report.REPORTS_DIR", tmp_path / "legacy"), \
         patch("routers.report.storage.get_full_portfolio", return_value=FULL_PORTFOLIO):
        resp = client.get("/api/report/list")
    dates = resp.json()["LLY"]["dates"]
    assert all(not d.endswith(".md") for d in dates)


def test_get_report_returns_summary_no_content(tmp_path):
    ticker_dir = tmp_path / "LLY"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-05.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    with patch("routers.report.SNAPSHOTS_DIR", tmp_path), \
         patch("routers.report.REPORTS_DIR", tmp_path / "legacy"), \
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
         patch("routers.report.cache_svc._snapshots", {}), \
         patch("routers.report.cache_svc._list_cache", {"data": None, "ts": 0.0}):
        resp = client.get("/api/report/LLY/2026-05-01")
    assert resp.status_code == 200
    assert resp.json()["summary"]["target_mean"] == 980.0


def test_get_report_404_when_not_found(tmp_path):
    with patch("routers.report.SNAPSHOTS_DIR", tmp_path), \
         patch("routers.report.REPORTS_DIR", tmp_path / "legacy"), \
         patch("routers.report.cache_svc._snapshots", {}), \
         patch("routers.report.cache_svc._list_cache", {"data": None, "ts": 0.0}):
        resp = client.get("/api/report/LLY/2000-01-01")
    assert resp.status_code == 404

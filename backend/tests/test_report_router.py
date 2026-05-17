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
    "finviz_recom": 1.8,
    "daily_rsi": {
        "rsi": 45.2,
        "target_20": 800.0, "target_25": 830.0, "target_30": 860.0,
        "target_70": 940.0, "target_75": 960.0, "target_80": 975.0,
    },
}


def test_list_reports_includes_summary(tmp_path):
    ticker_dir = tmp_path / "LLY"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-05.md").write_text("# report", encoding="utf-8")
    (ticker_dir / "2026-05-05.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    with patch("routers.report.REPORTS_DIR", tmp_path), \
         patch("routers.report.storage.get_full_portfolio", return_value=FULL_PORTFOLIO):
        resp = client.get("/api/report/list")
    assert resp.status_code == 200
    data = resp.json()
    assert "LLY" in data
    assert data["LLY"]["summary"]["target_mean"] == 980.0
    assert data["LLY"]["summary"]["daily_rsi"]["target_20"] == 800.0


def test_list_reports_summary_null_when_no_json(tmp_path):
    ticker_dir = tmp_path / "LLY"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-05.md").write_text("# report", encoding="utf-8")
    with patch("routers.report.REPORTS_DIR", tmp_path), \
         patch("routers.report.storage.get_full_portfolio", return_value=FULL_PORTFOLIO):
        resp = client.get("/api/report/list")
    assert resp.status_code == 200
    assert resp.json()["LLY"]["summary"] is None


def test_get_report_includes_summary(tmp_path):
    ticker_dir = tmp_path / "LLY"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-05.md").write_text("# LLY report content", encoding="utf-8")
    (ticker_dir / "2026-05-05.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    with patch("routers.report.REPORTS_DIR", tmp_path):
        resp = client.get("/api/report/LLY/2026-05-05")
    assert resp.status_code == 200
    assert "LLY report content" in resp.json()["content"]
    assert resp.json()["summary"]["daily_rsi"]["rsi"] == 45.2
    assert resp.json()["summary"]["target_mean"] == 980.0


def test_get_report_summary_null_when_no_json(tmp_path):
    ticker_dir = tmp_path / "LLY"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-05.md").write_text("# LLY report content", encoding="utf-8")
    with patch("routers.report.REPORTS_DIR", tmp_path):
        resp = client.get("/api/report/LLY/2026-05-05")
    assert resp.status_code == 200
    assert resp.json()["summary"] is None

import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
import contextlib
import pandas as pd

SAMPLE_STOCK = {
    "ticker": "TEST",
    "name": "Test Corp",
    "quantity": 10,
    "avg_cost": 100.0,
    "competitors": [],
    "moat": "Strong brand",
    "growth_plan": "Expand to Asia",
}

def _mock_all():
    df = pd.DataFrame({
        "Close": [100.0 + i for i in range(50)],
        "High":  [101.0 + i for i in range(50)],
        "Low":   [99.0  + i for i in range(50)],
    })
    return {
        "services.report_generator.market.get_quote": MagicMock(return_value={
            "ticker": "TEST", "name": "Test Corp", "price": 120.0,
            "prev_close": 118.0, "daily_change": "+1.69%",
            "market_cap": 500_000_000_000, "ytd_return": 15.0,
        }),
        "services.report_generator.market.get_financials": MagicMock(return_value=[
            {"period": "2025-Q4", "revenue": 10_000_000_000, "operating_income": 2_000_000_000},
        ]),
        "services.report_generator.market.get_analyst_data": MagicMock(return_value={
            "target_mean": 150.0, "target_high": 200.0, "target_low": 120.0,
            "buy": 15, "hold": 5, "sell": 2,
        }),
        "services.report_generator.indicators.get_timeframe_rsi": MagicMock(return_value={
            "daily": {
                "rsi": 55.0,
                "target_20": 80.0, "target_25": 85.0, "target_30": 90.0,
                "target_70": 130.0, "target_75": 135.0, "target_80": 140.0,
            },
            "weekly": {
                "rsi": 60.0,
                "target_20": 75.0, "target_25": 80.0, "target_30": 85.0,
                "target_70": 140.0, "target_75": 145.0, "target_80": 150.0,
            },
            "monthly": {
                "rsi": 50.0,
                "target_20": 70.0, "target_25": 75.0, "target_30": 80.0,
                "target_70": 145.0, "target_75": 150.0, "target_80": 155.0,
            },
        }),
        "services.report_generator.indicators.get_support_resistance": MagicMock(return_value={
            "week52_high": 135.0, "week52_low": 90.0,
            "ema20": 118.0, "ema50": 115.0, "ema200": 110.0,
        }),
        "services.report_generator.scraper.scrape_finviz_consensus": MagicMock(return_value={
            "finviz_recom": 1.8,
        }),
        "services.report_generator.scraper.get_news": MagicMock(return_value=[
            {"title": "Test news", "link": "https://example.com",
             "publisher": "Reuters", "published_at": "2026-05-04 09:00"}
        ]),
        "services.report_generator.charts.generate_revenue_chart": MagicMock(return_value=""),
        "services.report_generator.charts.generate_rsi_chart": MagicMock(return_value=""),
        "services.report_generator.yf.Ticker": MagicMock(
            return_value=MagicMock(history=MagicMock(return_value=df))
        ),
    }

def test_generate_report_creates_markdown_file(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        md_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    assert md_path.endswith(".md")
    content = Path(md_path).read_text(encoding="utf-8")
    assert "Test Corp" in content
    assert "① 사업영역" in content
    assert "② 매출" in content
    assert "③ 증권사" in content
    assert "④ 경제적 해자" in content
    assert "Strong brand" in content
    assert "⑤ 장기 성장 계획" in content
    assert "Expand to Asia" in content
    assert "⑥ 최근 공시" in content
    assert "⑦ 매수/매도" in content

def test_generate_report_saves_json_summary(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        md_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    json_path = Path(md_path).with_suffix(".json")
    assert json_path.exists(), "JSON summary file should be created alongside markdown"
    summary = json.loads(json_path.read_text(encoding="utf-8"))
    assert summary["ticker"] == "TEST"
    assert summary["name"] == "Test Corp"
    assert summary["target_mean"] == 150.0
    assert summary["buy"] == 15
    assert summary["hold"] == 5
    assert summary["sell"] == 2
    assert summary["finviz_recom"] == 1.8
    assert "daily_rsi" in summary
    assert summary["daily_rsi"]["rsi"] == 55.0
    assert summary["daily_rsi"]["target_20"] == 80.0

def test_generate_report_section7_includes_expanded_rsi_columns(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        md_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    content = Path(md_path).read_text(encoding="utf-8")
    assert "RSI20" in content
    assert "RSI25" in content
    assert "RSI75" in content
    assert "RSI80" in content

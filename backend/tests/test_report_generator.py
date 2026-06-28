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
    "competitors": ["COMP1"],
    "moat": "Strong brand",
    "growth_plan": "Expand to Asia",
    "recent_disclosures": "Q1 실적 호조",
    "risks": "Competition risk",
}

SAMPLE_NEWS = [
    {"title": "Test news", "link": "https://example.com",
     "publisher": "Reuters", "published_at": "2026-05-04 09:00"}
]

def _mock_all():
    df = pd.DataFrame({
        "Close": [100.0 + i for i in range(50)],
        "High":  [101.0 + i for i in range(50)],
        "Low":   [99.0  + i for i in range(50)],
        "Volume": [1_000_000] * 50,
    })
    return {
        "services.report_generator.mkt.get_quote": MagicMock(return_value={
            "ticker": "TEST", "name": "Test Corp", "price": 120.0,
            "prev_close": 118.0, "daily_change": "+1.69%",
            "market_cap": 500_000_000_000, "ytd_return": 15.0,
        }),
        "services.report_generator.mkt.get_financials": MagicMock(return_value=[
            {"period": "2025-Q4", "revenue": 10_000_000_000, "operating_income": 2_000_000_000},
        ]),
        "services.report_generator.mkt.get_annual_financials": MagicMock(return_value=[]),
        "services.report_generator.mkt.get_analyst_data": MagicMock(return_value={
            "target_mean": 150.0, "target_high": 200.0, "target_low": 120.0,
            "buy": 15, "hold": 5, "sell": 2,
        }),
        "services.report_generator.indicators.get_timeframe_rsi": MagicMock(return_value={
            "daily": {"rsi": 55.0, "target_20": 80.0, "target_25": 85.0, "target_30": 90.0,
                      "target_70": 130.0, "target_75": 135.0, "target_80": 140.0},
            "weekly": {"rsi": 60.0, "target_20": 75.0, "target_25": 80.0, "target_30": 85.0,
                       "target_70": 140.0, "target_75": 145.0, "target_80": 150.0},
            "monthly": {"rsi": 50.0, "target_20": 70.0, "target_25": 75.0, "target_30": 80.0,
                        "target_70": 145.0, "target_75": 150.0, "target_80": 155.0},
        }),
        "services.report_generator.indicators.get_volume_profile": MagicMock(return_value={
            "poc": 115.0, "hvn": [95.0, 115.0, 135.0], "lvn": [105.0, 125.0],
        }),
        "services.report_generator.scraper.scrape_finviz_consensus": MagicMock(return_value={
            "finviz_recom": 1.8,
        }),
        "services.report_generator.scraper.get_news": MagicMock(return_value=SAMPLE_NEWS),
        "services.report_generator.yf.Ticker": MagicMock(
            return_value=MagicMock(
                history=MagicMock(return_value=df),
                info={"sector": "Technology", "industry": "Software"},
            )
        ),
    }


def test_generate_report_creates_json_not_markdown(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    assert json_path.endswith(".json")
    assert not Path(json_path).with_suffix(".md").exists()


def test_generate_report_json_has_core_fields(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    assert summary["ticker"] == "TEST"
    assert summary["target_mean"] == 150.0
    assert summary["buy"] == 15
    assert summary["daily_rsi"]["rsi"] == 55.0
    assert summary["volume_profile"]["poc"] == 115.0
    assert summary["sector"] == "Technology"


def test_generate_report_json_has_analyst_text_fields(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    assert summary["moat"] == "Strong brand"
    assert summary["growth_plan"] == "Expand to Asia"
    assert summary["recent_disclosures"] == "Q1 실적 호조"
    assert summary["risks"] == "Competition risk"


def test_generate_report_json_has_competitors_data(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    assert "competitors_data" in summary
    assert isinstance(summary["competitors_data"], list)
    assert len(summary["competitors_data"]) >= 1


def test_generate_report_json_has_news(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    assert "news" in summary
    assert summary["news"][0]["title"] == "Test news"
    assert summary["news"][0]["publisher"] == "Reuters"


def test_generate_report_calls_all_io_functions(tmp_path):
    mocks = _mock_all()
    with contextlib.ExitStack() as stack:
        patched = {target: stack.enter_context(patch(target, mock)) for target, mock in mocks.items()}
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        report_generator.generate_report(SAMPLE_STOCK, tmp_path)

    patched["services.report_generator.mkt.get_quote"].assert_called()
    patched["services.report_generator.mkt.get_financials"].assert_called_once()
    patched["services.report_generator.mkt.get_annual_financials"].assert_called_once()
    patched["services.report_generator.mkt.get_analyst_data"].assert_called_once()
    patched["services.report_generator.indicators.get_timeframe_rsi"].assert_called_once()
    patched["services.report_generator.scraper.get_news"].assert_called_once()


# ── 종목명 ticker 박제 방어 (stock-name-ticker-revert-fix) ─────────────────────

def _mock_kr(quote_name: str):
    df = pd.DataFrame({
        "Close": [70000.0 + i for i in range(50)],
        "High":  [70100.0 + i for i in range(50)],
        "Low":   [69900.0 + i for i in range(50)],
        "Volume": [1_000_000] * 50,
    })
    return {
        "services.report_generator.mkt.get_quote": MagicMock(return_value={
            "ticker": "005930", "name": quote_name, "price": 70000.0,
            "market_cap": 400_000_000_000_000, "sector": "", "industry": "",
        }),
        "services.report_generator.mkt.get_history_df": MagicMock(return_value=df),
        "services.report_generator.mkt.get_financials": MagicMock(return_value=[]),
        "services.report_generator.mkt.get_annual_financials": MagicMock(return_value=[]),
        "services.report_generator.mkt.get_analyst_data": MagicMock(return_value={
            "target_mean": None, "target_high": None, "target_low": None,
            "buy": 0, "hold": 0, "sell": 0,
        }),
        "services.report_generator.indicators.get_timeframe_rsi": MagicMock(return_value={
            "daily": {}, "weekly": {}, "monthly": {},
        }),
        "services.report_generator.indicators.get_volume_profile": MagicMock(return_value={}),
        "services.report_generator.scraper.get_news": MagicMock(return_value=[]),
        # 박제-시 독립피드 게이트(task#101)가 KR에서 _kr_basic_naver를 호출하므로, quote(70k)와
        # 일관된 독립 참조를 mock해 게이트를 통과시킨다(이 테스트는 이름 해석 검증, 글리치 무관).
        "services.market.kr._kr_basic_naver": MagicMock(return_value=(70000.0, 0.0, 70000.0, 0, "삼성전자")),
    }


def test_generate_report_resolves_ticker_like_name_from_quote(tmp_path):
    """stock.name이 종목번호(ticker)면 quote의 실명으로 스냅샷 name을 채운다(배치 재박제 방어)."""
    stock = {"ticker": "005930", "name": "005930", "market": "KR", "exchange": "KS", "competitors": []}
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_kr("삼성전자").items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(stock, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    assert summary["name"] == "삼성전자"


# ── S1/S2/S3 field presence in snapshot ──────────────────────────────────────

def test_generate_report_has_price_technical_fields(tmp_path):
    """Snapshot must contain S1/S2/S3 fields (may be None on short mock df, must be present)."""
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    # S1
    for key in ("week52_high", "week52_low", "ema20", "ema50", "ema200"):
        assert key in summary, f"Missing S1 field: {key}"
    # S2
    assert "trend" in summary
    assert isinstance(summary["trend"], dict)
    for key in ("above_ema20", "above_ema50", "above_ema200", "return_30d", "golden_cross", "dead_cross"):
        assert key in summary["trend"], f"Missing trend sub-key: {key}"
    # S3
    assert "beta" in summary
    assert "hv" in summary

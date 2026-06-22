"""리포트 박제-시 독립피드 게이트 (task#101).

generate_report(KR, regular=True)이 KRX 자기일관 글리치(~70k)를 독립 피드(네이버)와
대조해 2x 밖이면 박제를 스킵(ValueError, 저장 안 함)하는지 검증.
"""
import contextlib
import importlib
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest


def _mocks_kr(quote_price, daily_close, naver_price):
    """KR 리포트 생성 경로 mock. naver_price=None이면 독립참조 부재."""
    df = pd.DataFrame({
        "Close": [daily_close] * 50,
        "High":  [daily_close + 100] * 50,
        "Low":   [daily_close - 100] * 50,
        "Volume": [1_000_000] * 50,
    })
    naver_ret = None if naver_price is None else (naver_price, -1.0, naver_price, 400_000_000_000_000, "삼성전자")
    return {
        "services.report_generator.mkt.get_quote": MagicMock(return_value={
            "ticker": "005930", "name": "삼성전자", "price": quote_price,
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
        "services.market.kr._kr_basic_naver": MagicMock(return_value=naver_ret),
        "services.db.execute": MagicMock(),
    }


_KR_STOCK = {"ticker": "005930", "name": "삼성전자", "market": "KR", "exchange": "KS", "competitors": []}


def _run(mocks, stock, tmp_path):
    with contextlib.ExitStack() as stack:
        patched = {t: stack.enter_context(patch(t, m)) for t, m in mocks.items()}
        from services import report_generator
        importlib.reload(report_generator)
        result = report_generator.generate_report(stock, tmp_path)
    return result, patched


def test_gate_skips_bake_on_krx_self_consistent_glitch(tmp_path):
    # quote·일봉 둘 다 70k(자기일관 글리치), 독립 네이버 357.5k → 박제 스킵(ValueError), DB 미저장
    mocks = _mocks_kr(quote_price=70000.0, daily_close=70000.0, naver_price=357500.0)
    with pytest.raises(ValueError):
        _run(mocks, _KR_STOCK, tmp_path)
    mocks["services.db.execute"].assert_not_called()


def test_gate_allows_sane_kr_report(tmp_path):
    # 정상: quote·일봉·네이버 모두 357.5k → 저장 진행
    mocks = _mocks_kr(quote_price=357500.0, daily_close=357500.0, naver_price=357500.0)
    result, patched = _run(mocks, _KR_STOCK, tmp_path)
    assert result.endswith(".json") and Path(result).exists()
    patched["services.db.execute"].assert_called()


def test_gate_skipped_when_no_independent_ref(tmp_path):
    # 네이버 None(참조 부재) → 게이트 생략, 저장 진행(참조 없으면 검증 생략)
    mocks = _mocks_kr(quote_price=70000.0, daily_close=70000.0, naver_price=None)
    result, _ = _run(mocks, _KR_STOCK, tmp_path)
    assert result.endswith(".json") and Path(result).exists()


def test_gate_catches_price_only_glitch(tmp_path):
    # quote 70k 글리치·일봉 357.5k 정상·네이버 357.5k → price vs ref로 스킵
    mocks = _mocks_kr(quote_price=70000.0, daily_close=357500.0, naver_price=357500.0)
    with pytest.raises(ValueError):
        _run(mocks, _KR_STOCK, tmp_path)


def test_gate_catches_chart_only_glitch(tmp_path):
    # quote 357.5k 정상·일봉 70k 글리치·네이버 357.5k → 일봉종가 vs ref로 스킵(차트 밴드 보호)
    mocks = _mocks_kr(quote_price=357500.0, daily_close=70000.0, naver_price=357500.0)
    with pytest.raises(ValueError):
        _run(mocks, _KR_STOCK, tmp_path)


def test_gate_not_applied_for_us(tmp_path):
    # US(market!=KR) → 독립피드 게이트 미적용, _kr_basic_naver 미호출
    us_df = pd.DataFrame({
        "Close": [120.0] * 50, "High": [121.0] * 50, "Low": [119.0] * 50, "Volume": [1_000_000] * 50,
    })
    mocks = {
        "services.report_generator.mkt.get_quote": MagicMock(return_value={
            "ticker": "AAPL", "name": "Apple", "price": 120.0, "market_cap": 5_000_000_000,
        }),
        "services.report_generator.mkt.get_financials": MagicMock(return_value=[]),
        "services.report_generator.mkt.get_annual_financials": MagicMock(return_value=[]),
        "services.report_generator.mkt.get_analyst_data": MagicMock(return_value={
            "target_mean": None, "target_high": None, "target_low": None, "buy": 0, "hold": 0, "sell": 0,
        }),
        "services.report_generator.indicators.get_timeframe_rsi": MagicMock(return_value={
            "daily": {}, "weekly": {}, "monthly": {},
        }),
        "services.report_generator.indicators.get_volume_profile": MagicMock(return_value={}),
        "services.report_generator.scraper.scrape_finviz_consensus": MagicMock(return_value={}),
        "services.report_generator.scraper.get_news": MagicMock(return_value=[]),
        "services.report_generator.yf.Ticker": MagicMock(return_value=MagicMock(
            history=MagicMock(return_value=us_df), info={"sector": "Tech", "industry": "HW"})),
        "services.market.kr._kr_basic_naver": MagicMock(return_value=(70000.0, 0, 0, 0, "x")),
        "services.db.execute": MagicMock(),
    }
    us_stock = {"ticker": "AAPL", "name": "Apple", "market": "US", "exchange": "", "competitors": []}
    result, patched = _run(mocks, us_stock, tmp_path)
    assert result.endswith(".json") and Path(result).exists()
    patched["services.market.kr._kr_basic_naver"].assert_not_called()

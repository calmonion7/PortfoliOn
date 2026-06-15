"""task #53 S1: FRED 매크로 신호 — 4종 시리즈 수집·merge + 신호 판정.

매크로 *신호*(FRED 침체/신용 시계열)는 MacroTab의 매크로 *상관*과 별개 store(market_cache key "macro_signals").
기존 경제지표(econ_indicators) store는 건드리지 않는다.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from unittest.mock import patch, MagicMock


def _fred_response(obs):
    resp = MagicMock()
    resp.json.return_value = {"observations": obs}
    resp.raise_for_status = lambda: None
    return resp


# ── 신호 판정 순수함수 ─────────────────────────────────────────────────────────

def test_evaluate_signals_inverted_when_latest_spread_negative():
    from services.market_indicators.macro import evaluate_signals
    data = {
        "yield_curve": [{"date": "2026-06-01", "value": 0.2}, {"date": "2026-06-10", "value": -0.15}],
        "hy_spread": [{"date": "2026-06-10", "value": 3.2}],
        "m2": [], "fed_funds": [],
    }
    sig = evaluate_signals(data)
    assert sig["inverted"] is True
    assert sig["yield_curve_latest"] == pytest.approx(-0.15, abs=0.001)


def test_evaluate_signals_not_inverted_when_latest_spread_positive():
    from services.market_indicators.macro import evaluate_signals
    data = {
        "yield_curve": [{"date": "2026-06-01", "value": -0.1}, {"date": "2026-06-10", "value": 0.4}],
        "hy_spread": [], "m2": [], "fed_funds": [],
    }
    sig = evaluate_signals(data)
    assert sig["inverted"] is False


def test_evaluate_signals_credit_stress_when_hy_above_threshold():
    from services.market_indicators.macro import evaluate_signals, HY_STRESS_THRESHOLD
    data = {
        "yield_curve": [{"date": "2026-06-10", "value": 0.5}],
        "hy_spread": [{"date": "2026-06-10", "value": HY_STRESS_THRESHOLD + 0.5}],
        "m2": [], "fed_funds": [],
    }
    sig = evaluate_signals(data)
    assert sig["credit_stress"] is True
    assert sig["hy_spread_latest"] == pytest.approx(HY_STRESS_THRESHOLD + 0.5, abs=0.001)


def test_evaluate_signals_no_credit_stress_when_hy_below_threshold():
    from services.market_indicators.macro import evaluate_signals, HY_STRESS_THRESHOLD
    data = {
        "yield_curve": [{"date": "2026-06-10", "value": 0.5}],
        "hy_spread": [{"date": "2026-06-10", "value": HY_STRESS_THRESHOLD - 1.0}],
        "m2": [], "fed_funds": [],
    }
    sig = evaluate_signals(data)
    assert sig["credit_stress"] is False


def test_evaluate_signals_graceful_on_empty_series():
    """결측(빈 시리즈)이면 플래그는 None/False, 예외 없음."""
    from services.market_indicators.macro import evaluate_signals
    sig = evaluate_signals({"yield_curve": [], "hy_spread": [], "m2": [], "fed_funds": []})
    assert sig["inverted"] is None
    assert sig["credit_stress"] is None
    assert sig["yield_curve_latest"] is None
    assert sig["hy_spread_latest"] is None


# ── _fetch_and_save_macro_signals: 4종 FRED merge + market_cache 저장 ──────────

def test_fetch_macro_signals_no_api_key_returns_error(monkeypatch):
    from services.market_indicators.macro import _fetch_and_save_macro_signals
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    result = _fetch_and_save_macro_signals()
    assert "error" in result


def test_fetch_macro_signals_fetches_four_series_and_saves(monkeypatch):
    from services.market_indicators.macro import _fetch_and_save_macro_signals
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    monkeypatch.setattr("services.market_indicators.macro._mc_load", lambda key: None)

    saved = {}
    monkeypatch.setattr("services.market_indicators.macro._mc_save",
                        lambda key, data: saved.update({"key": key, "data": data}))

    series_obs = {
        "T10Y2Y": [{"date": "2026-06-09", "value": "0.10"}, {"date": "2026-06-10", "value": "-0.20"}],
        "BAMLH0A0HYM2": [{"date": "2026-06-10", "value": "6.10"}],
        "M2SL": [{"date": "2026-05-01", "value": "21000.0"}],
        "DFF": [{"date": "2026-06-10", "value": "4.33"}],
    }

    def fake_get(url, params=None, timeout=None):
        sid = params["series_id"]
        return _fred_response(series_obs[sid])

    with patch("services.market_indicators.macro.requests.get", side_effect=fake_get):
        result = _fetch_and_save_macro_signals()

    # 저장 key + 4종 시리즈 merge
    assert saved["key"] == "macro_signals"
    assert len(result["yield_curve"]) == 2
    assert len(result["hy_spread"]) == 1
    assert len(result["m2"]) == 1
    assert len(result["fed_funds"]) == 1
    # 신호: 최신 금리차 -0.20 < 0 → 역전, HY 6.10 > 임계 → 신용 스트레스
    assert result["signals"]["inverted"] is True
    assert result["signals"]["credit_stress"] is True


def test_fetch_macro_signals_skips_fred_missing_value(monkeypatch):
    from services.market_indicators.macro import _fetch_and_save_macro_signals
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    monkeypatch.setattr("services.market_indicators.macro._mc_load", lambda key: None)
    monkeypatch.setattr("services.market_indicators.macro._mc_save", lambda key, data: None)

    def fake_get(url, params=None, timeout=None):
        return _fred_response([
            {"date": "2026-06-09", "value": "0.10"},
            {"date": "2026-06-10", "value": "."},   # FRED 결측
        ])

    with patch("services.market_indicators.macro.requests.get", side_effect=fake_get):
        result = _fetch_and_save_macro_signals()
    assert len(result["yield_curve"]) == 1


def test_fetch_macro_signals_graceful_on_network_error_returns_stored(monkeypatch):
    """FRED 호출 실패 시 저장값(있으면)을 반환하고 예외를 전파하지 않는다."""
    from services.market_indicators.macro import _fetch_and_save_macro_signals
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    stored = {"yield_curve": [{"date": "2026-06-01", "value": 0.5}],
              "hy_spread": [], "m2": [], "fed_funds": [], "signals": {}}
    monkeypatch.setattr("services.market_indicators.macro._mc_load",
                        lambda key: {"data": stored, "fetched_at": "2026-06-01T00:00:00Z"})

    def boom(*a, **k):
        raise Exception("network error")

    with patch("services.market_indicators.macro.requests.get", side_effect=boom):
        result = _fetch_and_save_macro_signals()
    assert result["yield_curve"] == stored["yield_curve"]


def test_fetch_macro_signals_incremental_uses_stored_last_date(monkeypatch):
    """저장값이 있으면 마지막 날짜 이후만 조회(observation_start)하고 merge 누적."""
    from services.market_indicators.macro import _fetch_and_save_macro_signals
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    stored = {
        "yield_curve": [{"date": "2026-06-09", "value": 0.10}],
        "hy_spread": [{"date": "2026-06-09", "value": 3.0}],
        "m2": [{"date": "2026-05-01", "value": 21000.0}],
        "fed_funds": [{"date": "2026-06-09", "value": 4.33}],
        "signals": {},
    }
    monkeypatch.setattr("services.market_indicators.macro._mc_load",
                        lambda key: {"data": stored, "fetched_at": "x"})
    monkeypatch.setattr("services.market_indicators.macro._mc_save", lambda key, data: None)

    starts = {}

    def fake_get(url, params=None, timeout=None):
        starts[params["series_id"]] = params.get("observation_start")
        return _fred_response([{"date": "2026-06-10", "value": "-0.20"}])

    with patch("services.market_indicators.macro.requests.get", side_effect=fake_get):
        result = _fetch_and_save_macro_signals()

    # 증분 조회: 저장 마지막 날짜를 start로 사용
    assert starts["T10Y2Y"] == "2026-06-09"
    # merge: 기존 1 + 신규 1 = 2 (날짜순)
    assert [p["date"] for p in result["yield_curve"]] == ["2026-06-09", "2026-06-10"]


# ── get_macro_signals: 저장값 읽기 (요청경로 외부 API 0) ────────────────────────

def test_get_macro_signals_reads_stored_no_live_fetch(monkeypatch):
    from services.market_indicators.macro import get_macro_signals
    stored = {
        "yield_curve": [{"date": "2026-06-10", "value": -0.2}],
        "hy_spread": [{"date": "2026-06-10", "value": 3.0}],
        "m2": [], "fed_funds": [],
        "signals": {"inverted": True, "credit_stress": False},
    }
    monkeypatch.setattr("services.market_indicators.macro._mc_load",
                        lambda key: {"data": stored, "fetched_at": "x"})

    with patch("services.market_indicators.macro.requests.get",
               side_effect=AssertionError("요청경로에서 FRED 라이브 호출 금지")):
        result = get_macro_signals()
    assert result["signals"]["inverted"] is True
    assert result["yield_curve"][0]["value"] == pytest.approx(-0.2, abs=0.001)


def test_get_macro_signals_empty_when_no_stored(monkeypatch):
    from services.market_indicators.macro import get_macro_signals
    monkeypatch.setattr("services.market_indicators.macro._mc_load", lambda key: None)
    with patch("services.market_indicators.macro.requests.get",
               side_effect=AssertionError("요청경로 라이브 호출 금지")):
        result = get_macro_signals()
    assert result["yield_curve"] == []
    assert result["signals"] == {}

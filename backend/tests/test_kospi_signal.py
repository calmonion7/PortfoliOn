"""task #154 S1: 다음날 코스피 방향 신호 — composite 공식·밴드·적중판정·reconcile·NaN가드.

네트워크 없음: yfinance/_yf_close_history 전부 mock.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from unittest.mock import patch, MagicMock
import pytest


# ── compute_signal: composite 공식 + 밴드 경계 ───────────────────────────────

def test_compute_signal_formula():
    from services.market_indicators.kospi_signal import compute_signal
    # (1.5 + 0.9 - (-0.3)) / 3 = 0.9
    composite, signal = compute_signal(1.5, 0.9, -0.3)
    assert composite == pytest.approx(0.9, abs=0.0001)
    assert signal == "bullish"


def test_compute_signal_band_boundary_exactly_positive_half_is_neutral():
    from services.market_indicators.kospi_signal import compute_signal
    # (1.5 + 0 - 0)/3 = 0.5 정확히 → 경계는 neutral(strict > 필요)
    composite, signal = compute_signal(1.5, 0.0, 0.0)
    assert composite == pytest.approx(0.5, abs=0.0001)
    assert signal == "neutral"


def test_compute_signal_band_boundary_exactly_negative_half_is_neutral():
    from services.market_indicators.kospi_signal import compute_signal
    composite, signal = compute_signal(-1.5, 0.0, 0.0)
    assert composite == pytest.approx(-0.5, abs=0.0001)
    assert signal == "neutral"


def test_compute_signal_just_above_positive_band_is_bullish():
    from services.market_indicators.kospi_signal import compute_signal
    composite, signal = compute_signal(1.53, 0.0, 0.0)
    assert composite == pytest.approx(0.51, abs=0.0001)
    assert signal == "bullish"


def test_compute_signal_just_below_negative_band_is_bearish():
    from services.market_indicators.kospi_signal import compute_signal
    composite, signal = compute_signal(-1.53, 0.0, 0.0)
    assert composite == pytest.approx(-0.51, abs=0.0001)
    assert signal == "bearish"


def test_compute_signal_missing_driver_returns_none():
    from services.market_indicators.kospi_signal import compute_signal
    composite, signal = compute_signal(1.0, None, 0.0)
    assert composite is None
    assert signal is None


# ── judge_hit ────────────────────────────────────────────────────────────────

def test_judge_hit_bullish():
    from services.market_indicators.kospi_signal import judge_hit
    assert judge_hit("bullish", 0.6) is True
    assert judge_hit("bullish", 0.4) is False
    assert judge_hit("bullish", 0.5) is False  # 경계 미달(strict >)


def test_judge_hit_bearish():
    from services.market_indicators.kospi_signal import judge_hit
    assert judge_hit("bearish", -0.6) is True
    assert judge_hit("bearish", -0.4) is False


def test_judge_hit_neutral():
    from services.market_indicators.kospi_signal import judge_hit
    assert judge_hit("neutral", 0.3) is True
    assert judge_hit("neutral", 0.5) is True   # 경계 포함
    assert judge_hit("neutral", 0.51) is False


def test_judge_hit_none_when_missing():
    from services.market_indicators.kospi_signal import judge_hit
    assert judge_hit(None, 0.5) is None
    assert judge_hit("bullish", None) is None


# ── NaN 가드 ──────────────────────────────────────────────────────────────────

def test_chg_pct_zero_prev_returns_none_not_crash():
    from services.market_indicators.kospi_signal import _chg_pct
    history = [{"date": "2026-07-01", "value": 0.0}, {"date": "2026-07-02", "value": 5.0}]
    assert _chg_pct(history) is None


def test_compute_signal_non_finite_composite_returns_none():
    from services.market_indicators.kospi_signal import compute_signal
    composite, signal = compute_signal(float("nan"), 1.0, 0.0)
    assert composite is None
    assert signal is None


# ── reconcile: pending 레코드 채우기 ──────────────────────────────────────────

class _FakeTs:
    def __init__(self, s):
        from datetime import date as _d
        y, m, d = map(int, s.split("-"))
        self._d = _d(y, m, d)

    def date(self):
        return self._d


class _FakeCol:
    def __init__(self, values):
        self.values = values


class _FakeHist:
    empty = False

    def __init__(self, dates, opens, closes):
        self.index = [_FakeTs(s) for s in dates]
        self._cols = {"Open": opens, "Close": closes}

    def __getitem__(self, key):
        return _FakeCol(self._cols[key])


def _kospi_history_mock():
    return _FakeHist(["2026-07-01", "2026-07-02"], [3000.0, 3050.0], [3010.0, 3100.0])


def test_reconcile_fills_pending_record():
    from services.market_indicators import kospi_signal as ks

    series = [
        {"date": "2026-07-01", "signal": "bullish", "composite_pct": 0.8,
         "drivers": {}, "actual_gap_pct": None, "actual_close_pct": None, "hit": None},
        {"date": "2026-07-02", "signal": "bearish", "composite_pct": -0.9,
         "drivers": {}, "actual_gap_pct": None, "actual_close_pct": None, "hit": None},
    ]

    hist = _kospi_history_mock()
    with patch.object(ks.yf, "Ticker") as MockTicker:
        MockTicker.return_value.history.return_value = hist
        result = ks._reconcile_actuals(series)

    # 07-01은 직전 거래일이 없어(첫 행) 계속 pending
    assert result[0]["actual_close_pct"] is None
    # 07-02: prev_close=3010(07-01 종가), open=3050, close=3100
    rec = result[1]
    assert rec["actual_gap_pct"] == pytest.approx((3050 - 3010) / 3010 * 100, abs=0.001)
    assert rec["actual_close_pct"] == pytest.approx((3100 - 3010) / 3010 * 100, abs=0.001)
    assert rec["hit"] is False  # bearish 신호인데 actual_close_pct는 +2.99% → miss


def test_reconcile_bearish_signal_miss_is_false():
    from services.market_indicators import kospi_signal as ks
    series = [
        {"date": "2026-07-01", "signal": "bearish", "composite_pct": -0.9,
         "drivers": {}, "actual_gap_pct": None, "actual_close_pct": None, "hit": None},
        {"date": "2026-07-02", "signal": "bearish", "composite_pct": -0.9,
         "drivers": {}, "actual_gap_pct": None, "actual_close_pct": None, "hit": None},
    ]
    hist = _kospi_history_mock()
    with patch.object(ks.yf, "Ticker") as MockTicker:
        MockTicker.return_value.history.return_value = hist
        result = ks._reconcile_actuals(series)
    # 07-02: close_pct = +2.99% → bearish 신호는 miss(False)
    assert result[1]["hit"] is False


def test_reconcile_noop_when_nothing_pending():
    from services.market_indicators import kospi_signal as ks
    series = [{"date": "2026-07-01", "signal": "neutral", "composite_pct": 0.1,
               "drivers": {}, "actual_gap_pct": 0.1, "actual_close_pct": 0.2, "hit": True}]
    with patch.object(ks.yf, "Ticker", side_effect=AssertionError("호출되면 안 됨")):
        result = ks._reconcile_actuals(series)
    assert result == series


# ── get_kospi_signal: 저장값만 읽기(라이브 호출 없음) + hit_rate 집계 ───────────

def test_get_kospi_signal_reads_stored_and_aggregates_hit_rate(monkeypatch):
    from services.market_indicators import kospi_signal as ks
    stored = {
        "series": [
            {"date": "2026-07-01", "signal": "bullish", "composite_pct": 0.8,
             "drivers": {"sp500": 1.0, "nasdaq": 1.0, "usdkrw": 0.0},
             "actual_gap_pct": 0.2, "actual_close_pct": 0.9, "hit": True},
            {"date": "2026-07-02", "signal": "bearish", "composite_pct": -0.9,
             "drivers": {"sp500": -1.0, "nasdaq": -1.0, "usdkrw": 0.0},
             "actual_gap_pct": 0.1, "actual_close_pct": 0.3, "hit": False},
            {"date": "2026-07-03", "signal": "neutral", "composite_pct": 0.1,
             "drivers": {"sp500": 0.1, "nasdaq": 0.1, "usdkrw": 0.0},
             "actual_gap_pct": 0.0, "actual_close_pct": 0.1, "hit": True},
        ],
        "drivers_history": {},
    }
    monkeypatch.setattr(ks, "_mc_load", lambda key: {"data": stored, "fetched_at": "2026-07-03T00:00:00Z"})
    with patch.object(ks.yf, "Ticker", side_effect=AssertionError("요청경로 라이브 호출 금지")):
        result = ks.get_kospi_signal()

    assert result["current"]["date"] == "2026-07-03"
    assert result["hit_rate"] == pytest.approx(0.5, abs=0.0001)  # bullish/bearish 2건 중 1적중
    assert result["neutral"] == {"total": 1, "hit": 1}


def test_get_kospi_signal_empty_when_no_stored(monkeypatch):
    from services.market_indicators import kospi_signal as ks
    monkeypatch.setattr(ks, "_mc_load", lambda key: None)
    result = ks.get_kospi_signal()
    assert result["current"] is None
    assert result["history"] == []
    assert result["hit_rate"] is None


# ── refresh_kospi_signal: 드라이버 fetch 실패 시 저장값 보존 ──────────────────

def test_refresh_preserves_stored_series_when_driver_fetch_fails(monkeypatch):
    from services.market_indicators import kospi_signal as ks
    stored = {"series": [{"date": "2026-07-01", "signal": "bullish", "composite_pct": 0.8,
                           "drivers": {}, "actual_gap_pct": 0.1, "actual_close_pct": 0.6, "hit": True}],
              "drivers_history": {"sp500": [], "nasdaq": [], "usdkrw": []}}
    monkeypatch.setattr(ks, "_mc_load", lambda key: {"data": stored, "fetched_at": "x"})
    saved = {}
    monkeypatch.setattr(ks, "_mc_save", lambda key, data: saved.update(data))
    monkeypatch.setattr(ks, "_yf_close_history", lambda sym, stored_h, precision=4: [])
    with patch.object(ks.yf, "Ticker", side_effect=AssertionError("KOSPI reconcile은 pending 없으면 미호출")):
        result = ks.refresh_kospi_signal()

    assert result["series"] == stored["series"]
    assert saved == {}  # fetch 실패면 저장 스킵


def test_refresh_appends_todays_record_on_success(monkeypatch):
    from services.market_indicators import kospi_signal as ks
    monkeypatch.setattr(ks, "_mc_load", lambda key: None)
    saved = {}
    monkeypatch.setattr(ks, "_mc_save", lambda key, data: saved.update(data))

    def fake_hist(sym, stored_h, precision=4):
        # sp500 +3%, nasdaq/usdkrw 변동 없음 → composite = (3+0-0)/3 = 1.0
        chg = {"^GSPC": 3.0, "^IXIC": 0.0, "USDKRW=X": 0.0}[sym]
        return [{"date": "2026-07-01", "value": 100.0}, {"date": "2026-07-02", "value": 100.0 * (1 + chg / 100)}]

    monkeypatch.setattr(ks, "_yf_close_history", fake_hist)
    with patch.object(ks.yf, "Ticker", side_effect=AssertionError("pending 없으면 KOSPI 미호출")):
        result = ks.refresh_kospi_signal()

    assert len(result["series"]) == 1
    rec = result["series"][0]
    assert rec["composite_pct"] == pytest.approx(1.0, abs=0.01)
    assert rec["signal"] == "bullish"
    assert saved  # 저장 호출됨

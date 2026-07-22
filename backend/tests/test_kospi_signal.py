"""task #154 S1: 다음날 코스피 방향 신호 — composite 공식·밴드·적중판정·reconcile·NaN가드.

네트워크 없음: yfinance/_yf_close_history 전부 mock.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from unittest.mock import patch, MagicMock
import pytest


# ── compute_signal: 채택 가중 composite 공식(task#203 S2) + 밴드 경계 ─────────
# 가중치 sp500=2·nasdaq=0.5·usdkrw=-0.5·sox=1, weight_sum=4 → composite=signed_sum/4.
# band는 이제 호출측(adaptive 계산값 등)이 명시적으로 넘긴다.

def test_compute_signal_formula():
    from services.market_indicators.kospi_signal import compute_signal
    # (2*1.0 + 0.5*0.8 - 0.5*(-0.4) + 1*0.6) / 4 = (2.0+0.4+0.2+0.6)/4 = 0.8
    composite, signal = compute_signal(1.0, 0.8, -0.4, 0.6, 0.5)
    assert composite == pytest.approx(0.8, abs=0.0001)
    assert signal == "bullish"


def test_compute_signal_band_boundary_exactly_positive_half_is_neutral():
    from services.market_indicators.kospi_signal import compute_signal
    # sp500만 1.0 → (2*1.0)/4 = 0.5 정확히 → 경계는 neutral(strict > 필요)
    composite, signal = compute_signal(1.0, 0.0, 0.0, 0.0, 0.5)
    assert composite == pytest.approx(0.5, abs=0.0001)
    assert signal == "neutral"


def test_compute_signal_band_boundary_exactly_negative_half_is_neutral():
    from services.market_indicators.kospi_signal import compute_signal
    composite, signal = compute_signal(-1.0, 0.0, 0.0, 0.0, 0.5)
    assert composite == pytest.approx(-0.5, abs=0.0001)
    assert signal == "neutral"


def test_compute_signal_just_above_positive_band_is_bullish():
    from services.market_indicators.kospi_signal import compute_signal
    composite, signal = compute_signal(1.02, 0.0, 0.0, 0.0, 0.5)
    assert composite == pytest.approx(0.51, abs=0.0001)
    assert signal == "bullish"


def test_compute_signal_just_below_negative_band_is_bearish():
    from services.market_indicators.kospi_signal import compute_signal
    composite, signal = compute_signal(-1.02, 0.0, 0.0, 0.0, 0.5)
    assert composite == pytest.approx(-0.51, abs=0.0001)
    assert signal == "bearish"


def test_compute_signal_missing_driver_returns_none():
    from services.market_indicators.kospi_signal import compute_signal
    composite, signal = compute_signal(1.0, None, 0.0, 0.0, 0.5)
    assert composite is None
    assert signal is None


def test_compute_signal_missing_sox_returns_none():
    from services.market_indicators.kospi_signal import compute_signal
    # 신규 드라이버(sox)도 결측이면 결측 가드에 걸림
    composite, signal = compute_signal(1.0, 0.5, 0.0, None, 0.5)
    assert composite is None
    assert signal is None


# ── judge_hit: 방향성=부호 기준, 중립=밴드 기준 (task#203) ───────────────────

def test_judge_hit_bullish_is_sign_based():
    from services.market_indicators.kospi_signal import judge_hit
    assert judge_hit("bullish", 0.6) is True
    assert judge_hit("bullish", 0.4) is True   # 마이그레이션: 밴드 미달이어도 부호만 맞으면 적중(구 band 기준은 False)
    assert judge_hit("bullish", 0.01) is True
    assert judge_hit("bullish", -0.1) is False


def test_judge_hit_bearish_is_sign_based():
    from services.market_indicators.kospi_signal import judge_hit
    assert judge_hit("bearish", -0.6) is True
    assert judge_hit("bearish", -0.4) is True  # 마이그레이션: 구 band 기준은 False
    assert judge_hit("bearish", 0.1) is False


def test_judge_hit_directional_zero_actual_is_miss():
    from services.market_indicators.kospi_signal import judge_hit
    assert judge_hit("bullish", 0.0) is False
    assert judge_hit("bearish", 0.0) is False


def test_judge_hit_neutral_uses_band():
    from services.market_indicators.kospi_signal import judge_hit
    assert judge_hit("neutral", 0.3) is True
    assert judge_hit("neutral", 0.5) is True   # 경계 포함
    assert judge_hit("neutral", 0.51) is False


def test_judge_hit_neutral_custom_band():
    from services.market_indicators.kospi_signal import judge_hit
    assert judge_hit("neutral", 0.9, band=1.0) is True
    assert judge_hit("neutral", 1.1, band=1.0) is False


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
    composite, signal = compute_signal(float("nan"), 1.0, 0.0, 0.0, 0.5)
    assert composite is None
    assert signal is None


# ── _adaptive_band: k×20일σ 밴드 (task#203 S3 채택 구성) ─────────────────────

def test_adaptive_band_computes_k_times_sigma20():
    from services.market_indicators import kospi_signal as ks
    import statistics
    # 21개 종가(20개 수익률, 5/1~5/21) — before_date 이전만 사용
    closes = [3000.0 + i * 3 for i in range(21)]
    dates = [f"2026-05-{i + 1:02d}" for i in range(21)]
    rows = {d: {"open": c, "close": c} for d, c in zip(dates, closes)}
    returns = [(closes[i] - closes[i - 1]) / closes[i - 1] * 100 for i in range(1, 21)]
    expected = round(0.5 * statistics.stdev(returns), 4)

    band = ks._adaptive_band(rows, "2026-06-01")  # before_date는 rows 전부보다 미래
    assert band == pytest.approx(expected, abs=0.0001)


def test_adaptive_band_falls_back_when_insufficient_history():
    from services.market_indicators import kospi_signal as ks
    rows = {"2026-05-01": {"open": 3000.0, "close": 3000.0}, "2026-05-02": {"open": 3010.0, "close": 3010.0}}
    assert ks._adaptive_band(rows, "2026-05-03") == ks.BAND
    assert ks._adaptive_band(None, "2026-05-03") == ks.BAND
    assert ks._adaptive_band({}, "2026-05-03") == ks.BAND


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


# ── reconcile: 전 레코드 hit 재계산(레거시 band 기준 retro-fix) ───────────────

def test_reconcile_recomputes_hit_for_already_filled_records_no_fetch_needed():
    from services.market_indicators import kospi_signal as ks
    series = [
        # 레거시 밴드기준 hit=False였던 강세 적중(부호기준으론 True) — retro-fix 대상
        {"date": "2026-07-01", "signal": "bullish", "composite_pct": 0.8,
         "drivers": {}, "actual_gap_pct": 0.1, "actual_close_pct": 0.3, "hit": False},
        # 레거시 밴드기준 hit=False였던 약세 적중(부호기준으론 True)
        {"date": "2026-07-02", "signal": "bearish", "composite_pct": -0.8,
         "drivers": {}, "actual_gap_pct": -0.1, "actual_close_pct": -0.1, "hit": False},
        # 레코드별 저장 band(1.0)로 중립 재판정
        {"date": "2026-07-03", "signal": "neutral", "composite_pct": 0.1, "band": 1.0,
         "drivers": {}, "actual_gap_pct": 0.1, "actual_close_pct": 0.8, "hit": False},
        # 방향성 신호 + actual==0 → miss로 재판정
        {"date": "2026-07-04", "signal": "bullish", "composite_pct": 0.6,
         "drivers": {}, "actual_gap_pct": 0.0, "actual_close_pct": 0.0, "hit": True},
    ]
    with patch.object(ks.yf, "Ticker", side_effect=AssertionError("전량 채워져 있으면 KOSPI 미호출")):
        result = ks._reconcile_actuals(series)

    assert result[0]["hit"] is True
    assert result[1]["hit"] is True
    assert result[2]["hit"] is True
    assert result[3]["hit"] is False


# ── reconcile: 휴장일 레코드 제거 ─────────────────────────────────────────────

def test_reconcile_drops_holiday_record_when_later_kospi_bar_exists():
    from services.market_indicators import kospi_signal as ks
    hist = _FakeHist(["2026-07-16", "2026-07-18"], [3000.0, 3050.0], [3010.0, 3060.0])
    series = [
        {"date": "2026-07-16", "signal": "neutral", "composite_pct": 0.1,
         "drivers": {}, "actual_gap_pct": None, "actual_close_pct": None, "hit": None},
        {"date": "2026-07-17", "signal": "bullish", "composite_pct": 0.8,
         "drivers": {}, "actual_gap_pct": None, "actual_close_pct": None, "hit": None},
        {"date": "2026-07-18", "signal": "bearish", "composite_pct": -0.8,
         "drivers": {}, "actual_gap_pct": None, "actual_close_pct": None, "hit": None},
        {"date": "2026-07-19", "signal": "neutral", "composite_pct": 0.1,
         "drivers": {}, "actual_gap_pct": None, "actual_close_pct": None, "hit": None},
    ]
    with patch.object(ks.yf, "Ticker") as MockTicker:
        MockTicker.return_value.history.return_value = hist
        result = ks._reconcile_actuals(series)

    dates = [r["date"] for r in result]
    assert "2026-07-17" not in dates  # 휴장일(코스피 봉 없음) + 이후 거래일(07-18) 존재 → 제거
    assert "2026-07-16" in dates      # 첫 봉(직전 종가 없어 pending 유지)은 보존
    assert "2026-07-18" in dates
    assert "2026-07-19" in dates      # 오늘 신호(뒤 봉 없음)는 보존


def test_reconcile_preserves_pending_record_with_no_later_kospi_bar():
    from services.market_indicators import kospi_signal as ks
    hist = _kospi_history_mock()  # 2026-07-01, 2026-07-02까지만
    series = [{"date": "2026-07-05", "signal": "neutral", "composite_pct": 0.1,
               "drivers": {}, "actual_gap_pct": None, "actual_close_pct": None, "hit": None}]
    with patch.object(ks.yf, "Ticker") as MockTicker:
        MockTicker.return_value.history.return_value = hist
        result = ks._reconcile_actuals(series)

    assert len(result) == 1
    assert result[0]["date"] == "2026-07-05"
    assert result[0]["actual_close_pct"] is None


def test_reconcile_does_not_drop_when_kospi_fetch_fails():
    from services.market_indicators import kospi_signal as ks
    series = [{"date": "2026-07-17", "signal": "bullish", "composite_pct": 0.6,
               "drivers": {}, "actual_gap_pct": None, "actual_close_pct": None, "hit": None}]
    with patch.object(ks.yf, "Ticker", side_effect=Exception("network down")):
        result = ks._reconcile_actuals(series)
    assert result == series  # 휴장일 판단 불가 시 보수적으로 유지


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


def test_refresh_saves_retro_fixed_hit_even_when_driver_fetch_fails(monkeypatch):
    """적대 리뷰 회귀: 드라이버 fetch 전량 실패 + pending 없음이어도, reconcile의
    retro-fix(레거시 밴드기준 hit→부호기준 재판정)로 hit이 바뀌면 저장돼야 한다."""
    from services.market_indicators import kospi_signal as ks
    # 레거시 밴드기준 hit=False였으나 부호기준(actual_close_pct=0.3>0, bullish)으론 True
    stored = {"series": [{"date": "2026-07-01", "signal": "bullish", "composite_pct": 0.8,
                           "drivers": {}, "actual_gap_pct": 0.1, "actual_close_pct": 0.3, "hit": False}],
              "drivers_history": {"sp500": [], "nasdaq": [], "usdkrw": [], "sox": []}}
    monkeypatch.setattr(ks, "_mc_load", lambda key: {"data": stored, "fetched_at": "x"})
    saved = {}
    monkeypatch.setattr(ks, "_mc_save", lambda key, data: saved.update(data))
    monkeypatch.setattr(ks, "_yf_close_history", lambda sym, stored_h, precision=4: [])
    with patch.object(ks.yf, "Ticker", side_effect=AssertionError("pending 없으면 KOSPI 미호출")):
        result = ks.refresh_kospi_signal()

    assert result["series"][0]["hit"] is True  # retro-fix 반영
    assert saved  # fetch 실패했어도 retro-fix로 hit이 바뀌었으니 저장돼야 함
    assert saved["series"][0]["hit"] is True


class _EmptyKospiHist:
    """적응형 밴드용 KOSPI fetch가 빈 응답일 때(σ20 계산 불가 → BAND 폴백)."""
    empty = True


def test_refresh_appends_todays_record_on_success(monkeypatch):
    from services.market_indicators import kospi_signal as ks
    monkeypatch.setattr(ks, "_mc_load", lambda key: None)
    saved = {}
    monkeypatch.setattr(ks, "_mc_save", lambda key, data: saved.update(data))

    def fake_hist(sym, stored_h, precision=4):
        # sp500+1%, nasdaq+2%, usdkrw-1%, sox+0.5% →
        # (2*1.0 + 0.5*2.0 - 0.5*(-1.0) + 1*0.5)/4 = (2+1+0.5+0.5)/4 = 1.0
        chg = {"^GSPC": 1.0, "^IXIC": 2.0, "USDKRW=X": -1.0, "^SOX": 0.5}[sym]
        return [{"date": "2026-07-01", "value": 100.0}, {"date": "2026-07-02", "value": 100.0 * (1 + chg / 100)}]

    monkeypatch.setattr(ks, "_yf_close_history", fake_hist)
    # 신규 레코드 생성 시 적응형 밴드 계산을 위해 KOSPI 히스토리를 fetch한다(빈 응답 →
    # σ20 계산 불가 → BAND=0.5 폴백). pending 없어 reconcile은 이 fetch를 재사용만 한다.
    with patch.object(ks.yf, "Ticker") as MockTicker:
        MockTicker.return_value.history.return_value = _EmptyKospiHist()
        result = ks.refresh_kospi_signal()

    assert MockTicker.return_value.history.call_count == 1  # band 계산·reconcile이 fetch 1회 공유
    assert len(result["series"]) == 1
    rec = result["series"][0]
    assert rec["composite_pct"] == pytest.approx(1.0, abs=0.01)
    assert rec["signal"] == "bullish"
    assert rec["band"] == ks.BAND  # KOSPI 히스토리 없음 → 고정 BAND 폴백
    assert rec["drivers"]["sox"] == pytest.approx(0.5, abs=0.01)
    assert saved  # 저장 호출됨


def test_refresh_uses_adaptive_band_from_kospi_history(monkeypatch):
    from services.market_indicators import kospi_signal as ks
    monkeypatch.setattr(ks, "_mc_load", lambda key: None)
    saved = {}
    monkeypatch.setattr(ks, "_mc_save", lambda key, data: saved.update(data))
    monkeypatch.setattr(ks, "_yf_close_history", lambda sym, stored_h, precision=4: [
        {"date": "2026-07-01", "value": 100.0}, {"date": "2026-07-02", "value": 101.0},
    ])

    closes = [3000.0 + i * 5 for i in range(21)]
    dates = [f"2026-05-{i + 1:02d}" for i in range(21)]
    hist = _FakeHist(dates, closes, closes)  # open=close 단순화, band 계산엔 close만 사용
    with patch.object(ks.yf, "Ticker") as MockTicker:
        MockTicker.return_value.history.return_value = hist
        result = ks.refresh_kospi_signal()

    returns = [(closes[i] - closes[i - 1]) / closes[i - 1] * 100 for i in range(1, 21)]
    import statistics
    expected_band = round(0.5 * statistics.stdev(returns), 4)
    rec = result["series"][0]
    assert rec["band"] == pytest.approx(expected_band, abs=0.0001)
    assert rec["band"] != ks.BAND

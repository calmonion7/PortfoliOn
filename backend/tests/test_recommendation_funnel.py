import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from datetime import date
from unittest.mock import patch

import pandas as pd


# ── 픽스처 빌더 ─────────────────────────────────────────────
# 유니버스 행: universe.build_universe 형태 {ticker,market,name,market_cap}
# screen은 Stage-1 싼 신호(market_cap·guru 멤버십)로 후보 top-K 선별,
# Stage-2는 종목별 OHLC/컨센서스/수급/지분공시 fetch를 mock.

def _u(ticker, market, name, cap, guru=False):
    return {"ticker": ticker, "market": market, "name": name,
            "market_cap": cap, "guru_member": guru}


def _ohlc(closes, highs=None, volumes=None):
    """과거→최신 OHLCV DataFrame (market.get_history_df 동형)."""
    n = len(closes)
    highs = highs or [c * 1.0 for c in closes]
    volumes = volumes or [1000] * n
    idx = pd.date_range("2026-01-01", periods=n, freq="D")
    return pd.DataFrame(
        {"Open": closes, "High": highs, "Low": [c * 0.9 for c in closes],
         "Close": closes, "Volume": volumes},
        index=idx,
    )


# ── (a) Stage-1: market_cap 내림차순 top-K 후보 선별 ──────────

def test_screen_candidates_top_k_by_cap():
    from services.recommendation.funnel import _screen_candidates
    uni = [
        _u("A", "KR", "A", 500),
        _u("B", "KR", "B", 300),
        _u("C", "KR", "C", 100),
        _u("D", "US", "D", 50),
    ]
    cands = _screen_candidates(uni, top_k=2)
    tickers = [c["ticker"] for c in cands]
    assert tickers == ["A", "B"]


def test_screen_candidates_guru_member_always_kept():
    from services.recommendation.funnel import _screen_candidates
    uni = [
        _u("A", "KR", "A", 500),
        _u("B", "KR", "B", 300),
        _u("G", "US", "Guru pick", 1, guru=True),  # 시총 최하위지만 구루 멤버
    ]
    cands = _screen_candidates(uni, top_k=2)
    tickers = {c["ticker"] for c in cands}
    assert "G" in tickers  # 구루 멤버십은 컷오프 밖이어도 포함


# ── (b) Stage-2: OHLC → 모멘텀 팩터 ──────────────────────────

def test_momentum_factors_from_ohlc():
    from services.recommendation.funnel import _momentum_factors
    # 30일 상승 추세: return_pct>0, near_52w_high 높음
    closes = [100 + i for i in range(60)]
    f = _momentum_factors(_ohlc(closes))
    assert f["return_pct"] is not None and f["return_pct"] > 0
    assert f["near_52w_high_pct"] is not None and f["near_52w_high_pct"] >= 99.0
    assert f["rsi"] is not None
    assert f["volume_surge_ratio"] is not None


def test_momentum_factors_empty_df_all_none():
    from services.recommendation.funnel import _momentum_factors
    f = _momentum_factors(pd.DataFrame())
    assert f == {"return_pct": None, "rsi": None,
                 "near_52w_high_pct": None, "volume_surge_ratio": None}


# ── (c) factors 조립: value/momentum/smart_money 결합 ─────────

def test_assemble_factors_kr():
    from services.recommendation.funnel import _assemble_factors
    cand = _u("005930", "KR", "삼성", 500)
    momentum = {"return_pct": 12.0, "rsi": 60.0, "near_52w_high_pct": 95.0,
                "volume_surge_ratio": 1.5}
    factors = _assemble_factors(
        cand, momentum=momentum, upside_pct=28.0,
        foreign_net_5d=400000, organ_net_5d=200000,
        insider_buy=True, guru_new_buy=None,
    )
    assert factors["value"] == {"upside_pct": 28.0}
    assert factors["momentum"] == momentum
    assert factors["smart_money"]["foreign_net_5d"] == 400000
    assert factors["smart_money"]["organ_net_5d"] == 200000
    assert factors["smart_money"]["insider_buy"] is True
    assert factors["smart_money"]["guru_new_buy"] is None


# ── (d) run_recommendation_batch: 전 흐름 와이어링 + store 인자 ──

def _patch_stage2(F, *, history, upside, supply, insider):
    """Stage-2 외부 fetch를 mock (per-ticker)."""
    return (
        patch.object(F, "_fetch_history", side_effect=lambda c: history.get(c["ticker"])),
        patch.object(F, "_consensus_upside", side_effect=lambda c, df: upside.get(c["ticker"])),
        patch.object(F, "_kr_supply", side_effect=lambda c: supply.get(c["ticker"], (None, None))),
        patch.object(F, "_kr_insider", side_effect=lambda c: insider.get(c["ticker"])),
    )


def test_run_batch_wires_and_stores():
    from services.recommendation import funnel as F

    uni = [_u("005930", "KR", "삼성", 500), _u("000660", "KR", "하이닉스", 300)]
    history = {"005930": _ohlc([100 + i for i in range(60)]),
               "000660": _ohlc([100 + i for i in range(60)])}
    upside = {"005930": 28.0, "000660": 10.0}
    supply = {"005930": (400000, 200000), "000660": (-100000, -50000)}
    insider = {"005930": True, "000660": False}

    captured = {}

    def _fake_replace(market, rows):
        captured["market"] = market
        captured["rows"] = rows

    p1, p2, p3, p4 = _patch_stage2(F, history=history, upside=upside,
                                   supply=supply, insider=insider)
    with patch.object(F, "build_universe", return_value=uni), \
         patch.object(F, "replace_recommendations", side_effect=_fake_replace), \
         p1, p2, p3, p4:
        stats = F.run_recommendation_batch("KR")

    assert stats["market"] == "KR"
    assert stats["universe"] == 2
    assert stats["candidates"] == 2
    assert stats["scored"] == 2
    # 통계 dict에 저유동성 카운트 포함(거래대금 평균 ≪ KR 1e9 경계 → 둘 다 저유동성)
    assert stats["low_liquidity"] == 2
    rows = captured["rows"]
    assert {r["ticker"] for r in rows} == {"005930", "000660"}
    # rank 1-base 점수 내림차순
    by_rank = {r["rank"]: r["ticker"] for r in rows}
    assert by_rank[1] == "005930"  # upside·수급 더 강함
    for r in rows:
        assert r["market"] == "KR"
        assert "score" in r and 0 <= r["score"] <= 100
        assert isinstance(r["factors"], dict)
        assert isinstance(r["flags"], list)
        assert r["base_date"] is not None
        # scored row에 low_liquidity 플래그 실림(bool)
        assert isinstance(r["low_liquidity"], bool)
        assert r["low_liquidity"] is True  # 거래량 1000 → 거래대금 ≪ 1e9


# ── (e1) 유동성 측정: 거래대금(Close*Volume) 평균 ─────────────

def test_avg_dollar_volume_normal():
    from services.recommendation.funnel import _avg_dollar_volume
    # Close 일정(=10), Volume 일정(=100) → 거래대금 1000 평균
    closes = [10.0] * 30
    volumes = [100] * 30
    df = _ohlc(closes, volumes=volumes)
    assert _avg_dollar_volume(df, window=20) == 1000.0


def test_avg_dollar_volume_fewer_rows_than_window():
    from services.recommendation.funnel import _avg_dollar_volume
    closes = [10.0] * 5
    volumes = [100] * 5
    df = _ohlc(closes, volumes=volumes)
    # window보다 적은 행이면 가용분(5행)만 평균 → 여전히 1000
    assert _avg_dollar_volume(df, window=20) == 1000.0


def test_avg_dollar_volume_missing_volume_none():
    from services.recommendation.funnel import _avg_dollar_volume
    closes = [10.0] * 30
    idx = pd.date_range("2026-01-01", periods=30, freq="D")
    df = pd.DataFrame({"Close": closes}, index=idx)  # Volume 결측
    assert _avg_dollar_volume(df) is None


def test_avg_dollar_volume_empty_or_none_df_none():
    from services.recommendation.funnel import _avg_dollar_volume
    assert _avg_dollar_volume(None) is None
    assert _avg_dollar_volume(pd.DataFrame()) is None


def test_avg_dollar_volume_nan_guard_none():
    from services.recommendation.funnel import _avg_dollar_volume
    import numpy as np
    # 전 행 NaN → 유효행 없음 → None (NaN/Inf 가드)
    closes = [np.nan] * 30
    volumes = [np.nan] * 30
    idx = pd.date_range("2026-01-01", periods=30, freq="D")
    df = pd.DataFrame({"Close": closes, "Volume": volumes}, index=idx)
    assert _avg_dollar_volume(df) is None


# ── (e2) 저유동성 판정: 시장별 경계 ───────────────────────────

def test_is_low_liquidity_us_below_and_above_threshold():
    from services.recommendation.funnel import _is_low_liquidity
    # US 경계 $1,000,000. 거래대금 평균 = Close*Volume.
    # 아래: 10 * 50,000 = 500,000 < 1M → True
    below = _ohlc([10.0] * 30, volumes=[50_000] * 30)
    assert _is_low_liquidity(below, "US") is True
    # 위: 10 * 200,000 = 2,000,000 ≥ 1M → False
    above = _ohlc([10.0] * 30, volumes=[200_000] * 30)
    assert _is_low_liquidity(above, "US") is False


def test_is_low_liquidity_kr_below_and_above_threshold():
    from services.recommendation.funnel import _is_low_liquidity
    # KR 경계 1,000,000,000 KRW.
    # 아래: 10,000 * 50,000 = 500,000,000 < 1e9 → True
    below = _ohlc([10_000.0] * 30, volumes=[50_000] * 30)
    assert _is_low_liquidity(below, "KR") is True
    # 위: 10,000 * 200,000 = 2,000,000,000 ≥ 1e9 → False
    above = _ohlc([10_000.0] * 30, volumes=[200_000] * 30)
    assert _is_low_liquidity(above, "KR") is False


def test_is_low_liquidity_unmeasurable_true():
    from services.recommendation.funnel import _is_low_liquidity
    # 측정 불가(빈 df) → True (미측정=discovery 제외, 'wrong<missing')
    assert _is_low_liquidity(pd.DataFrame(), "US") is True
    assert _is_low_liquidity(None, "KR") is True


def test_is_low_liquidity_default_market_us():
    from services.recommendation.funnel import _is_low_liquidity
    # market 기본값 US — 알 수 없는 market은 US 경계 적용
    # 10 * 50,000 = 500,000 < 1M(US) → True
    below = _ohlc([10.0] * 30, volumes=[50_000] * 30)
    assert _is_low_liquidity(below, "XX") is True
    # 10 * 200,000 = 2M ≥ 1M(US) → False
    above = _ohlc([10.0] * 30, volumes=[200_000] * 30)
    assert _is_low_liquidity(above, "XX") is False


# ── (e) all-None(전 종목 산출 불가) → replace 생략 ─────────────

def test_run_batch_all_none_skips_save():
    from services.recommendation import funnel as F

    uni = [_u("005930", "KR", "삼성", 500)]
    # 히스토리 없음·컨센서스 없음·수급 없음·지분 없음 → 점수 산출 근거 0
    history = {"005930": None}
    upside = {}
    supply = {}
    insider = {}

    called = {"replace": False}

    def _fake_replace(market, rows):
        called["replace"] = True

    p1, p2, p3, p4 = _patch_stage2(F, history=history, upside=upside,
                                   supply=supply, insider=insider)
    with patch.object(F, "build_universe", return_value=uni), \
         patch.object(F, "replace_recommendations", side_effect=_fake_replace), \
         p1, p2, p3, p4:
        stats = F.run_recommendation_batch("KR")

    assert called["replace"] is False
    assert stats["scored"] == 0


# ── (f) 종목별 fetch 실패는 로깅 후 graceful(부분 결과 저장) ──────

def test_run_batch_logs_and_continues_on_fetch_error(capsys):
    from services.recommendation import funnel as F

    uni = [_u("005930", "KR", "삼성", 500), _u("000660", "KR", "하이닉스", 300)]
    history = {"005930": _ohlc([100 + i for i in range(60)]),
               "000660": _ohlc([100 + i for i in range(60)])}
    upside = {"005930": 28.0, "000660": 10.0}
    supply = {"005930": (400000, 200000)}
    insider = {"005930": True}

    captured = {}

    def _fake_replace(market, rows):
        captured["rows"] = rows

    def _boom_supply(c):
        if c["ticker"] == "000660":
            raise RuntimeError("supply down")
        return supply.get(c["ticker"], (None, None))

    with patch.object(F, "build_universe", return_value=uni), \
         patch.object(F, "replace_recommendations", side_effect=_fake_replace), \
         patch.object(F, "_fetch_history", side_effect=lambda c: history.get(c["ticker"])), \
         patch.object(F, "_consensus_upside", side_effect=lambda c, df: upside.get(c["ticker"])), \
         patch.object(F, "_kr_supply", side_effect=_boom_supply), \
         patch.object(F, "_kr_insider", side_effect=lambda c: insider.get(c["ticker"])):
        stats = F.run_recommendation_batch("KR")

    # 실패 종목도 다른 팩터로 점수 산출(부분 결과) — 두 종목 모두 저장
    assert {r["ticker"] for r in captured["rows"]} == {"005930", "000660"}
    err = capsys.readouterr().err
    assert "000660" in err and "supply" in err.lower()

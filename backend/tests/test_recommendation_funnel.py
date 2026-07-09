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

def _u(ticker, market, name, cap, guru=False, tracked=False):
    return {"ticker": ticker, "market": market, "name": name,
            "market_cap": cap, "guru_member": guru, "tracked": tracked}


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
    # ADR-0021: US 행은 전량 통과, KR 행은 시총 내림차순 top_k 컷.
    # 구 코드: US "D"도 시총 정렬에 포함돼 tickers == ["A", "B"]를 단언했으나
    # 신 semantics(ADR-0021 §1)에서 US 전량 통과 → "D"도 결과에 포함된다.
    from services.recommendation.funnel import _screen_candidates
    uni = [
        _u("A", "KR", "A", 500),
        _u("B", "KR", "B", 300),
        _u("C", "KR", "C", 100),
        _u("D", "US", "D", 50),  # US → 전량 통과
    ]
    cands = _screen_candidates(uni, top_k=2)
    tickers = {c["ticker"] for c in cands}
    # KR: 상위 2(A, B) 통과, C 컷.  US: D 전량 통과.
    assert "A" in tickers and "B" in tickers
    assert "C" not in tickers
    assert "D" in tickers  # US 전량 통과 (ADR-0021)


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

def test_run_batch_logs_and_continues_on_fetch_error(caplog):
    import logging
    from services.recommendation import funnel as F
    caplog.set_level(logging.WARNING)

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
    assert "000660" in caplog.text and "supply" in caplog.text.lower()


# ── S1 (a) 시총 None·비구루 US 행은 전량 통과 ─────────────────────
# 구 코드: market_cap=None → 정렬 0 → top_k 밖 → 잘림 (red)

def test_screen_candidates_us_rows_always_pass():
    from services.recommendation.funnel import _screen_candidates
    uni = [
        _u("AAPL", "US", "Apple",     None),   # 시총 None, 비구루
        _u("MSFT", "US", "Microsoft", None),   # 시총 None, 비구루
        _u("A",    "KR", "A",         500),
        _u("B",    "KR", "B",         300),
    ]
    # top_k=1이면 구 코드는 시총 최상위 KR "A"만 통과 — US 둘은 잘림
    cands = _screen_candidates(uni, top_k=1)
    tickers = {c["ticker"] for c in cands}
    assert "AAPL" in tickers, "시총 None US 행이 통과해야 한다"
    assert "MSFT" in tickers, "시총 None US 행이 통과해야 한다"


# ── S1 (b) 시총 None·비구루·tracked 행(QQQ형)이 통과 ─────────────
# 구 코드: tracked 플래그 없음·시총 None → top_k 밖 → 잘림 (red)

def test_screen_candidates_tracked_rows_always_pass():
    from services.recommendation.funnel import _screen_candidates
    uni = [
        _u("QQQ", "US", "QQQ ETF",  None, guru=False, tracked=True),
        _u("COST","US", "Costco",   None, guru=False, tracked=True),
        _u("A",   "KR", "A",        500),
        _u("B",   "KR", "B",        300),
    ]
    cands = _screen_candidates(uni, top_k=1)
    tickers = {c["ticker"] for c in cands}
    assert "QQQ"  in tickers, "tracked 행은 시총·시장 무관 통과해야 한다"
    assert "COST" in tickers, "tracked 행은 시총·시장 무관 통과해야 한다"


# ── S1 (c) KR 비추적 행은 여전히 top_k 컷에 걸린다 (회귀 가드) ────
# 신구 모두 green이어야 한다

def test_screen_candidates_kr_untracked_still_cut():
    from services.recommendation.funnel import _screen_candidates
    uni = [
        _u("A", "KR", "A", 500),
        _u("B", "KR", "B", 300),
        _u("C", "KR", "C", 100),  # top_k=2 → 잘림
    ]
    cands = _screen_candidates(uni, top_k=2)
    tickers = {c["ticker"] for c in cands}
    assert "A" in tickers and "B" in tickers
    assert "C" not in tickers, "KR 비추적 행은 top_k 컷에 걸려야 한다"


# ── S2: US 목표가 배치 보강 (_backfill_us_consensus) ─────────────────
# 구 코드: _backfill_us_consensus 함수 자체 없음 → 세 테스트 전부 red (ImportError·call_count 불일치)

def test_backfill_us_consensus_calls_upsert_and_mart_when_no_asof():
    """(a) get_asof None인 US 후보 → upsert_raw_reports·refresh_mart 각 1회 호출."""
    from services.recommendation import funnel as F
    from unittest.mock import MagicMock

    cand = _u("AAPL", "US", "Apple", None)

    mock_upsert = MagicMock(return_value=3)   # 3건 upsert
    mock_mart   = MagicMock(return_value=None)
    mock_get_asof = MagicMock(return_value=None)  # 정본 없음

    with patch.object(F, "_backfill_us_consensus") as _spy:
        # _backfill_us_consensus 자체를 mock하면 내부 호출 검증 불가.
        # 대신 내부 의존성을 patch해 실 구현 호출.
        pass

    # 실 구현을 통해 내부 의존성 patch로 검증한다.
    import services.consensus as consensus_mod
    import services.consensus_pipeline as pipeline_mod

    with patch.object(consensus_mod, "get_asof", mock_get_asof), \
         patch.object(pipeline_mod, "upsert_raw_reports", mock_upsert), \
         patch.object(pipeline_mod, "refresh_mart", mock_mart):
        F._backfill_us_consensus(cand)

    assert mock_upsert.call_count == 1, "upsert_raw_reports는 정확히 1회 호출돼야 한다"
    assert mock_mart.call_count == 1,   "refresh_mart는 upsert 1건 이상 시 1회 호출돼야 한다"


def test_backfill_us_consensus_skips_mart_when_upsert_zero():
    """upsert 0건이면 refresh_mart 호출하지 않는다."""
    from services.recommendation import funnel as F
    from unittest.mock import MagicMock

    cand = _u("AAPL", "US", "Apple", None)

    mock_upsert   = MagicMock(return_value=0)   # 0건 upsert
    mock_mart     = MagicMock(return_value=None)
    mock_get_asof = MagicMock(return_value=None)  # 정본 없음

    import services.consensus as consensus_mod
    import services.consensus_pipeline as pipeline_mod

    with patch.object(consensus_mod, "get_asof", mock_get_asof), \
         patch.object(pipeline_mod, "upsert_raw_reports", mock_upsert), \
         patch.object(pipeline_mod, "refresh_mart", mock_mart):
        F._backfill_us_consensus(cand)

    assert mock_upsert.call_count == 1
    assert mock_mart.call_count == 0, "upsert 0건이면 refresh_mart를 호출하면 안 된다"


def test_backfill_us_consensus_skips_when_asof_exists():
    """(b) get_asof가 값을 주는 US 후보 → 보강 호출 0회."""
    from services.recommendation import funnel as F
    from unittest.mock import MagicMock

    cand = _u("AAPL", "US", "Apple", None)

    mock_upsert   = MagicMock(return_value=3)
    mock_mart     = MagicMock(return_value=None)
    mock_get_asof = MagicMock(return_value={"target_mean": 200.0})  # 정본 있음

    import services.consensus as consensus_mod
    import services.consensus_pipeline as pipeline_mod

    with patch.object(consensus_mod, "get_asof", mock_get_asof), \
         patch.object(pipeline_mod, "upsert_raw_reports", mock_upsert), \
         patch.object(pipeline_mod, "refresh_mart", mock_mart):
        F._backfill_us_consensus(cand)

    assert mock_upsert.call_count == 0, "정본 있으면 upsert 호출하면 안 된다"
    assert mock_mart.call_count == 0,   "정본 있으면 refresh_mart 호출하면 안 된다"


def test_backfill_us_consensus_skips_for_kr():
    """(c) KR 후보 → 보강 호출 0회."""
    from services.recommendation import funnel as F
    from unittest.mock import MagicMock

    cand = _u("005930", "KR", "삼성", 500)

    mock_upsert   = MagicMock(return_value=3)
    mock_mart     = MagicMock(return_value=None)
    mock_get_asof = MagicMock(return_value=None)  # 정본 없음이어도 KR이라 보강 안 함

    import services.consensus as consensus_mod
    import services.consensus_pipeline as pipeline_mod

    with patch.object(consensus_mod, "get_asof", mock_get_asof), \
         patch.object(pipeline_mod, "upsert_raw_reports", mock_upsert), \
         patch.object(pipeline_mod, "refresh_mart", mock_mart):
        F._backfill_us_consensus(cand)

    assert mock_upsert.call_count == 0, "KR 후보는 보강 호출하면 안 된다"
    assert mock_mart.call_count == 0,   "KR 후보는 refresh_mart 호출하면 안 된다"


def test_enrich_one_us_backfills_and_reflects_upside():
    """get_asof None인 US 후보 → 보강 후 upside가 _consensus_upside에 반영된다.

    _backfill_us_consensus를 mock해 side_effect로 get_asof가 값을 주도록 만들고
    _consensus_upside가 그 값을 받아 upside 비None인지 단언한다."""
    from services.recommendation import funnel as F

    cand = _u("AAPL", "US", "Apple", None)
    df = _ohlc([100 + i for i in range(60)])

    # backfill 후 get_asof가 값을 반환하도록 side_effect로 주입
    asof_values = [None, {"target_mean": 180.0}]  # 첫 호출(체크)=None, 두 번째(upside)=있음

    call_counts = {"backfill": 0}

    def _fake_backfill(c):
        call_counts["backfill"] += 1

    with patch.object(F, "_fetch_history", return_value=df), \
         patch.object(F, "_backfill_us_consensus", side_effect=_fake_backfill), \
         patch.object(F, "_consensus_upside", return_value=25.0), \
         patch.object(F, "_kr_supply", return_value=(None, None)), \
         patch.object(F, "_kr_insider", return_value=None):
        result = F._enrich_one(cand, guru_set=set())

    assert call_counts["backfill"] == 1, "_backfill_us_consensus는 US 후보에 1회 호출돼야 한다"
    assert result is not None
    assert result["factors"]["value"]["upside_pct"] == 25.0


def test_enrich_one_kr_no_backfill():
    """KR 후보에 _backfill_us_consensus 호출 0회."""
    from services.recommendation import funnel as F

    cand = _u("005930", "KR", "삼성", 500)
    df = _ohlc([100 + i for i in range(60)])

    call_counts = {"backfill": 0}

    def _fake_backfill(c):
        call_counts["backfill"] += 1

    with patch.object(F, "_fetch_history", return_value=df), \
         patch.object(F, "_backfill_us_consensus", side_effect=_fake_backfill), \
         patch.object(F, "_consensus_upside", return_value=10.0), \
         patch.object(F, "_kr_supply", return_value=(None, None)), \
         patch.object(F, "_kr_insider", return_value=None):
        F._enrich_one(cand, guru_set=set())

    assert call_counts["backfill"] == 0, "KR 후보에는 보강 호출하면 안 된다"


# ── S3 (c) 이름 carry/fetch 로직 ────────────────────────────────────────────
# 구 코드: _load_stored_names·_fetch_yf_name 함수 없음 → ImportError (red)

def test_load_stored_names_returns_name_map():
    """_load_stored_names가 stock_recommendations에서 name!=ticker 행을 {ticker: name} dict로 반환."""
    from services.recommendation import funnel as F

    # query 결과: name이 ticker와 다른 행만
    fake_rows = [
        {"ticker": "AAPL", "name": "Apple Inc."},
        {"ticker": "MSFT", "name": "Microsoft"},
    ]
    with patch.object(F, "query", return_value=fake_rows):
        result = F._load_stored_names()

    assert isinstance(result, dict), "_load_stored_names는 dict를 반환해야 한다"
    assert result.get("AAPL") == "Apple Inc."
    assert result.get("MSFT") == "Microsoft"


def test_name_carry_avoids_external_fetch(monkeypatch):
    """stored_names carry가 있으면 yfinance shortName fetch 0회."""
    from services.recommendation import funnel as F
    from unittest.mock import MagicMock

    mock_yf_fetch = MagicMock(return_value="should not be called")

    # AAPL이 stored_names에 이미 있으므로 외부 fetch 안 함
    stored = {"AAPL": "Apple Inc.", "MSFT": "Microsoft"}
    cand = {"ticker": "AAPL", "market": "US", "name": "AAPL"}  # name=ticker(미확보)

    with patch.object(F, "_fetch_yf_name", mock_yf_fetch):
        result_name = F._resolve_name(cand, stored)

    assert result_name == "Apple Inc.", "stored_names carry가 있으면 이름을 반환해야 한다"
    assert mock_yf_fetch.call_count == 0, "carry가 있으면 외부 fetch 0회여야 한다"


def test_name_no_carry_fetches_yf_once(monkeypatch):
    """stored_names에 없으면 _fetch_yf_name을 1회 호출한다."""
    from services.recommendation import funnel as F
    from unittest.mock import MagicMock

    mock_yf_fetch = MagicMock(return_value="Tesla Inc.")

    stored = {}  # carry 없음
    cand = {"ticker": "TSLA", "market": "US", "name": "TSLA"}  # name=ticker

    with patch.object(F, "_fetch_yf_name", mock_yf_fetch):
        result_name = F._resolve_name(cand, stored)

    assert result_name == "Tesla Inc.", "carry 없으면 yfinance에서 이름을 가져와야 한다"
    assert mock_yf_fetch.call_count == 1, "carry 없으면 외부 fetch 정확히 1회여야 한다"


def test_name_kr_not_fetched(monkeypatch):
    """KR 행은 name=ticker이어도 yfinance fetch 안 한다(KR은 이미 마스터 있음)."""
    from services.recommendation import funnel as F
    from unittest.mock import MagicMock

    mock_yf_fetch = MagicMock(return_value="Samsung")

    stored = {}
    cand = {"ticker": "005930", "market": "KR", "name": "005930"}  # name=ticker

    with patch.object(F, "_fetch_yf_name", mock_yf_fetch):
        result_name = F._resolve_name(cand, stored)

    # KR은 fetch 안 하고 ticker 그대로 반환해도 무방(tickers 마스터 JOIN이 read에서 처리)
    assert mock_yf_fetch.call_count == 0, "KR 행은 외부 name fetch를 하면 안 된다"


# ── S4: 배치 관측 로그 — universe·candidates·scored·elapsed 포함 ───────────
# 구 코드: 로그에 universe/candidates/elapsed 없음 → red

def test_run_batch_log_includes_universe_candidates_scored_elapsed(caplog):
    """배치 완료 로그에 universe·candidates·scored·경과초가 모두 포함돼야 한다."""
    import logging
    from services.recommendation import funnel as F
    caplog.set_level(logging.INFO)

    uni = [_u("005930", "KR", "삼성", 500), _u("000660", "KR", "하이닉스", 300)]
    history = {"005930": _ohlc([100 + i for i in range(60)]),
               "000660": _ohlc([100 + i for i in range(60)])}
    upside = {"005930": 28.0, "000660": 10.0}
    supply = {"005930": (400000, 200000), "000660": (-100000, -50000)}
    insider = {"005930": True, "000660": False}

    p1, p2, p3, p4 = _patch_stage2(F, history=history, upside=upside,
                                   supply=supply, insider=insider)
    with patch.object(F, "build_universe", return_value=uni), \
         patch.object(F, "replace_recommendations", side_effect=lambda m, r: None), \
         p1, p2, p3, p4:
        F.run_recommendation_batch("KR")

    # 로그 라인에 4가지 필드가 모두 있어야 한다
    assert "universe=" in caplog.text,    "로그에 universe= 필드 있어야 한다"
    assert "candidates=" in caplog.text,  "로그에 candidates= 필드 있어야 한다"
    assert "scored=" in caplog.text,      "로그에 scored= 필드 있어야 한다"
    assert "elapsed=" in caplog.text,     "로그에 elapsed= 필드(경과초) 있어야 한다"


# ── task#132 S2: yfinance 외부 콜 스로틀 (rate-limit 방어) ──────────

def test_fetch_yf_name_throttled():
    """이름 fetch는 yfinance 콜 직전 스로틀(sleep 1회) — 대량 연속 콜 rate-limit 방어."""
    from services.recommendation import funnel as F
    from unittest.mock import MagicMock

    fake_yf = MagicMock()
    fake_yf.Ticker.return_value.info = {"shortName": "U.S. Bancorp"}
    with patch.object(F.time, "sleep") as mock_sleep, \
         patch.dict(sys.modules, {"yfinance": fake_yf}):
        name = F._fetch_yf_name("USB")
    assert name == "U.S. Bancorp"
    mock_sleep.assert_called_once_with(F._YF_THROTTLE_S)


def test_backfill_us_consensus_throttled_only_when_fetching():
    """백필 스로틀은 실제 fetch 직전에만 — 정본 있음·KR 후보는 sleep 0회(비용 불변)."""
    from services.recommendation import funnel as F
    from unittest.mock import MagicMock
    import services.consensus as consensus_mod
    import services.consensus_pipeline as pipeline_mod

    # fetch 발생 케이스(정본 없음): sleep 1회
    with patch.object(consensus_mod, "get_asof", MagicMock(return_value=None)), \
         patch.object(pipeline_mod, "upsert_raw_reports", MagicMock(return_value=1)), \
         patch.object(pipeline_mod, "refresh_mart", MagicMock()), \
         patch.object(F.time, "sleep") as s1:
        F._backfill_us_consensus(_u("USB", "US", "USB", None))
    s1.assert_called_once_with(F._YF_THROTTLE_S)

    # 정본 있음: fetch 없음 → sleep 0회
    with patch.object(consensus_mod, "get_asof", MagicMock(return_value={"target_mean": 100.0})), \
         patch.object(F.time, "sleep") as s2:
        F._backfill_us_consensus(_u("USB", "US", "USB", None))
    s2.assert_not_called()

    # KR 후보: 보강 자체가 없음 → sleep 0회
    with patch.object(F.time, "sleep") as s3:
        F._backfill_us_consensus(_u("005930", "KR", "삼성전자", None))
    s3.assert_not_called()

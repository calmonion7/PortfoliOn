"""B65 — 발굴 배치의 전량 교체를 커버리지 임계로 가드한다.

기존 게이트는 `if scored:` 한 줄(all-or-nothing)이라 후보 100개 중 1개만 살아도
stock_recommendations를 통째 교체했다. 실패율 2%에서 「전부 실패」 확률은 사실상 0이므로
그 가드는 영원히 발동하지 않는다 — 대폭 축소가 무검증으로 통과한다.

축 4종:
  (a) 커버리지 < 임계 → replace 미호출 + status "partial"(직전 양호값 유지)
  (b) 대조군 — 커버리지 ≥ 임계 → 정상 교체 + status "success"
      ⚠️ 이 축이 없으면 「전부 스킵하기」가 통과한다.
  (c) 경계값 정확히 임계 → 저장(`<` 이지 `<=` 아님)
  (d) 전부 산출 불가 → 종래대로 미호출, 단 status는 "skipped"(partial과 구분)
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import logging
from unittest.mock import patch

import pandas as pd


def _u(ticker, market, name, cap):
    return {"ticker": ticker, "market": market, "name": name,
            "market_cap": cap, "guru_member": False, "tracked": False}


def _ohlc(closes):
    n = len(closes)
    idx = pd.date_range("2026-01-01", periods=n, freq="D")
    return pd.DataFrame(
        {"Open": closes, "High": closes, "Low": [c * 0.9 for c in closes],
         "Close": closes, "Volume": [1000] * n},
        index=idx,
    )


def _run(n_candidates, n_scored):
    """KR 후보 n_candidates개 중 n_scored개만 팩터 산출 가능 → (replace 호출 rows, stats)."""
    from services.recommendation import funnel as F

    uni = [_u(f"00{i:04d}", "KR", f"종목{i}", 500 - i) for i in range(n_candidates)]
    # 앞 n_scored개만 히스토리 보유 → 나머지는 팩터 전무(_has_signal False)로 탈락
    history = {u["ticker"]: _ohlc([100 + j for j in range(60)])
               for u in uni[:n_scored]}

    captured = {"rows": None, "calls": 0}

    def _fake_replace(market, rows):
        captured["rows"] = rows
        captured["calls"] += 1

    with patch.object(F, "build_universe", return_value=uni), \
         patch.object(F, "_load_stored_names", return_value={}), \
         patch.object(F, "replace_recommendations", side_effect=_fake_replace), \
         patch.object(F, "_fetch_history", side_effect=lambda c: history.get(c["ticker"])), \
         patch.object(F, "_consensus_upside", side_effect=lambda c, df: None), \
         patch.object(F, "_kr_supply", side_effect=lambda c: (None, None)), \
         patch.object(F, "_kr_insider", side_effect=lambda c: None):
        stats = F.run_recommendation_batch("KR")

    return captured, stats


# ── (a) 커버리지 < 임계 → 교체 스킵 ─────────────────────────────

def test_coverage_below_threshold_skips_replace(caplog):
    caplog.set_level(logging.WARNING)
    captured, stats = _run(n_candidates=4, n_scored=1)   # 25%

    assert stats["candidates"] == 4
    assert stats["scored"] == 1
    assert captured["calls"] == 0, "대폭 축소인데 전량 교체가 일어났다"
    assert stats["status"] == "partial"
    # 관측성 — 스킵이 로그로 드러나야 한다(갱신됨과 구분)
    assert "coverage" in caplog.text.lower()


# ── (b) 대조군: 정상 커버리지는 계속 저장된다 ───────────────────

def test_coverage_above_threshold_still_replaces():
    captured, stats = _run(n_candidates=4, n_scored=3)   # 75%

    assert captured["calls"] == 1
    assert len(captured["rows"]) == 3
    assert stats["status"] == "success"


# ── (c) 경계값: 정확히 임계면 저장한다(`<` 이지 `<=` 아님) ────────

def test_coverage_exactly_at_threshold_replaces():
    from services.recommendation.funnel import MIN_SCORED_COVERAGE
    assert MIN_SCORED_COVERAGE == 0.5

    captured, stats = _run(n_candidates=4, n_scored=2)   # 정확히 50%

    assert captured["calls"] == 1
    assert len(captured["rows"]) == 2
    assert stats["status"] == "success"


# ── (d) 전부 산출 불가 → 종래 스킵, 단 partial과 상태가 다르다 ───

def test_zero_scored_reports_skipped_not_partial():
    captured, stats = _run(n_candidates=4, n_scored=0)

    assert captured["calls"] == 0
    assert stats["scored"] == 0
    assert stats["status"] == "skipped"

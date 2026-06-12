"""consensus_svc.apply_asof / get_asof 단위테스트.

목표가·의견수 정본 = daily_consensus_mart의 base_date<=date 최신행(as-of-date),
없으면 consensus_history(date<=date) 폴백, 둘 다 없으면 no-op. 머지규칙:
buy/hold/sell은 행 있으면 항상, target_*은 non-null일 때만 덮어써 snapshot 동결값 보존. (ADR-0008)
"""
from unittest.mock import patch
from services import consensus as consensus_svc


def _snap():
    return {"target_mean": 100.0, "target_high": 120.0, "target_low": 90.0,
            "buy": 5, "hold": 2, "sell": 1, "name": "X"}


def test_apply_asof_mart_hit_overrides_all():
    mart_row = [{"target_mean": 200.0, "target_high": 220.0, "target_low": 180.0,
                 "buy": 10, "hold": 3, "sell": 0}]
    with patch("services.consensus.query", return_value=mart_row):
        out = consensus_svc.apply_asof(_snap(), "AAPL", "2026-06-12")
    assert out["target_mean"] == 200.0
    assert out["target_high"] == 220.0
    assert out["target_low"] == 180.0
    assert out["buy"] == 10 and out["hold"] == 3 and out["sell"] == 0
    assert out["name"] == "X"  # 무관 필드 보존


def test_apply_asof_history_fallback_when_mart_empty():
    hist_row = [{"target_high": 160.0, "target_mean": 150.0, "target_low": 140.0,
                 "buy": 7, "hold": 1, "sell": 2}]
    with patch("services.consensus.query", side_effect=[[], hist_row]):
        out = consensus_svc.apply_asof(_snap(), "AAPL", "2026-06-12")
    assert out["target_mean"] == 150.0
    assert out["buy"] == 7 and out["hold"] == 1 and out["sell"] == 2


def test_apply_asof_no_row_is_noop():
    with patch("services.consensus.query", side_effect=[[], []]):
        out = consensus_svc.apply_asof(_snap(), "AAPL", "2026-06-12")
    assert out["target_mean"] == 100.0  # snapshot 동결값 보존
    assert out["buy"] == 5


def test_apply_asof_target_null_preserves_snapshot_overrides_opinions():
    mart_row = [{"target_mean": None, "target_high": None, "target_low": None,
                 "buy": 9, "hold": 4, "sell": 1}]
    with patch("services.consensus.query", return_value=mart_row):
        out = consensus_svc.apply_asof(_snap(), "AAPL", "2026-06-12")
    assert out["target_mean"] == 100.0  # mart 목표가 NULL → snapshot 보존
    assert out["target_high"] == 120.0
    assert out["buy"] == 9 and out["hold"] == 4 and out["sell"] == 1  # 의견수는 덮어씀


def test_apply_asof_does_not_mutate_input_when_row_present():
    snap = _snap()
    mart_row = [{"target_mean": 200.0, "target_high": 220.0, "target_low": 180.0,
                 "buy": 10, "hold": 3, "sell": 0}]
    with patch("services.consensus.query", return_value=mart_row):
        consensus_svc.apply_asof(snap, "AAPL", "2026-06-12")
    assert snap["target_mean"] == 100.0  # 원본 불변(snapshot 캐시 보호)

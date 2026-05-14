import pytest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from services.guru_stats import compute_popularity, compute_manager_top3, compute_weighted

SAMPLE = [
    {
        "id": "mgr1", "name": "Manager A", "firm": "Firm A",
        "portfolio_value": 1_000_000_000, "num_stocks": 10,
        "top10": [
            {"rank": 1, "ticker": "AAPL", "name": "Apple Inc.", "name_kr": "애플",           "weight_pct": 40.0},
            {"rank": 2, "ticker": "MSFT", "name": "Microsoft",  "name_kr": "마이크로소프트", "weight_pct": 20.0},
            {"rank": 3, "ticker": "GOOG", "name": "Alphabet",   "name_kr": "",               "weight_pct": 10.0},
        ],
    },
    {
        "id": "mgr2", "name": "Manager B", "firm": "Firm B",
        "portfolio_value": 500_000_000, "num_stocks": 8,
        "top10": [
            {"rank": 1, "ticker": "AAPL", "name": "Apple Inc.", "name_kr": "애플", "weight_pct": 35.0},
            {"rank": 2, "ticker": "GOOG", "name": "Alphabet",   "name_kr": "",    "weight_pct": 25.0},
        ],
    },
]


def test_compute_popularity_counts_managers_per_ticker():
    result = compute_popularity(SAMPLE)
    by_ticker = {r["ticker"]: r for r in result}
    assert by_ticker["AAPL"]["count"] == 2
    assert by_ticker["MSFT"]["count"] == 1
    assert by_ticker["GOOG"]["count"] == 2


def test_compute_popularity_sorted_by_count_desc():
    result = compute_popularity(SAMPLE)
    counts = [r["count"] for r in result]
    assert counts == sorted(counts, reverse=True)


def test_compute_popularity_includes_name_fields():
    result = compute_popularity(SAMPLE)
    aapl = next(r for r in result if r["ticker"] == "AAPL")
    assert aapl["name"] == "Apple Inc."
    assert aapl["name_kr"] == "애플"


def test_compute_manager_top3_returns_top3_per_manager():
    result = compute_manager_top3(SAMPLE)
    assert len(result) == 2
    mgr_a = next(r for r in result if r["manager_name"] == "Manager A")
    assert len(mgr_a["top3"]) == 3
    assert mgr_a["top3"][0]["ticker"] == "AAPL"


def test_compute_manager_top3_includes_global_count():
    result = compute_manager_top3(SAMPLE)
    mgr_a = next(r for r in result if r["manager_name"] == "Manager A")
    aapl_entry = next(h for h in mgr_a["top3"] if h["ticker"] == "AAPL")
    assert aapl_entry["count"] == 2


def test_compute_weighted_inverse_rank():
    result = compute_weighted(SAMPLE)
    by_ticker = {r["ticker"]: r for r in result}
    # AAPL: rank1(1.0) + rank1(1.0) = 2.0
    assert by_ticker["AAPL"]["score"] == pytest.approx(2.0, abs=0.001)
    # MSFT: rank2(0.5) = 0.5
    assert by_ticker["MSFT"]["score"] == pytest.approx(0.5, abs=0.001)
    # GOOG: rank3(0.333) + rank2(0.5) = 0.833
    assert by_ticker["GOOG"]["score"] == pytest.approx(0.833, abs=0.001)


def test_compute_weighted_sorted_by_score_desc():
    result = compute_weighted(SAMPLE)
    scores = [r["score"] for r in result]
    assert scores == sorted(scores, reverse=True)

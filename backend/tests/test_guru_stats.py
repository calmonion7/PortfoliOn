import pytest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from services.guru_stats import compute_popularity, compute_weighted, compute_allocation

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


# ─────────────────────────────────────────────────────────────────────
# 구루 자산 배분(task#241) — 전 종목 층 티커별 투자금 합산
# ─────────────────────────────────────────────────────────────────────

# holdings 층엔 name_kr이 없다(크롤러가 top10에만 붙인다) — 조인 경로를 재현한다.
ALLOC_SAMPLE = [
    {
        "id": "mgr1", "portfolio_value": 1_000_000_000,
        "top10": [
            {"rank": 1, "ticker": "AAPL", "name": "Apple Inc.", "name_kr": "애플", "weight_pct": 40.0},
            {"rank": 2, "ticker": "MSFT", "name": "Microsoft",  "name_kr": "",     "weight_pct": 20.0},
        ],
        "holdings": [
            {"rank": 1, "ticker": "AAPL", "name": "Apple Inc.", "weight_pct": 40.0},
            # 신고 실값이 있으면 추정(20% × 10억 = 2억)을 무시하고 이 값을 쓴다
            {"rank": 2, "ticker": "MSFT", "name": "Microsoft", "weight_pct": 20.0, "value": 250_000_000},
        ],
    },
    {
        "id": "mgr2", "portfolio_value": 500_000_000,
        "top10": [{"rank": 1, "ticker": "AAPL", "name": "Apple Inc.", "name_kr": "애플", "weight_pct": 35.0}],
        "holdings": [{"rank": 1, "ticker": "AAPL", "name": "Apple Inc.", "weight_pct": 35.0}],
    },
    {
        # 포트폴리오 가치를 못 읽은 매니저 — 금액은 0이지만 보유 사실은 남는다
        "id": "mgr3", "portfolio_value": 0, "top10": [],
        "holdings": [{"rank": 1, "ticker": "XYZ", "name": "Xyz Corp.", "weight_pct": 10.0}],
    },
]


def test_compute_allocation_sums_value_with_reported_value_priority():
    result = compute_allocation(ALLOC_SAMPLE)
    by_ticker = {r["ticker"]: r for r in result["rows"]}
    # AAPL = 40% × 10억 + 35% × 5억 = 4억 + 1.75억 (둘 다 추정)
    assert by_ticker["AAPL"]["value"] == 575_000_000
    # MSFT는 신고 실값 우선 — 추정 2억이 아니라 2.5억
    assert by_ticker["MSFT"]["value"] == 250_000_000


def test_compute_allocation_counts_holders_even_without_value():
    by_ticker = {r["ticker"]: r for r in compute_allocation(ALLOC_SAMPLE)["rows"]}
    assert by_ticker["AAPL"]["holder_count"] == 2
    assert by_ticker["XYZ"]["holder_count"] == 1
    assert by_ticker["XYZ"]["value"] == 0


def test_compute_allocation_ratio_sums_to_100_and_sorted_desc():
    result = compute_allocation(ALLOC_SAMPLE)
    values = [r["value"] for r in result["rows"]]
    assert values == sorted(values, reverse=True)
    assert sum(r["ratio"] for r in result["rows"]) == pytest.approx(100.0, abs=0.01)


def test_compute_allocation_joins_name_kr_from_top10_layer():
    by_ticker = {r["ticker"]: r for r in compute_allocation(ALLOC_SAMPLE)["rows"]}
    assert by_ticker["AAPL"]["name_kr"] == "애플"     # top10 층에서 조인
    assert by_ticker["MSFT"]["name_kr"] == ""          # top10에 있으나 한글명 없음
    assert by_ticker["XYZ"]["name_kr"] == ""           # top10 층에 아예 없음
    assert by_ticker["XYZ"]["name"] == "Xyz Corp."     # 영문명 폴백용


def test_compute_allocation_header_totals():
    result = compute_allocation(ALLOC_SAMPLE)
    assert result["total_value"] == 825_000_000        # 575M + 250M + 0
    assert result["manager_count"] == 3
    assert result["ticker_count"] == 3


def test_compute_allocation_empty_is_graceful():
    assert compute_allocation([]) == {
        "total_value": 0, "manager_count": 0, "ticker_count": 0, "rows": [],
    }

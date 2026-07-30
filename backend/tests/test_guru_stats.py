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
    # task#247 S1: 코호트 메타 필드(all_manager_count 등)가 additive로 추가돼
    # 빈 입력의 응답 shape도 넓어진다 — 값은 전부 그대로(0/빈 dict/빈 리스트).
    assert compute_allocation([]) == {
        "total_value": 0, "manager_count": 0, "ticker_count": 0, "rows": [],
        "all_manager_count": 0, "all_total_value": 0, "periods": {}, "estimated_count": 0,
    }


# ── G4 (task#244): 오정렬이 만든 '그럴듯한 오값'을 교차검증으로 차단 ──────────
# dataroma 열이 밀리면 다른 숫자 열(예 Reported Price $185.06)이 _parse_portfolio_value를
# **성공** 통과해 185로 저장된다. `if value:`는 0만 걸러 파싱 성공을 진실로 신뢰하므로
# 그 값이 종목 투자금과 total(비율 분모)을 동시에 오염시킨다.
# 밴드 근거(라이브 3,927건): value/est의 median 0.9998·max 1.488·[1/2,2] 밖 0건.
MISALIGNED = [
    {
        "id": "mgr1", "portfolio_value": 10_000_000_000, "top10": [],
        "holdings": [
            # 오정렬: value=185(달러 단가) vs 추정 12% × 100억 = 12억 → 자릿수 7개 어긋남
            {"rank": 1, "ticker": "BAD", "name": "Bad Corp.", "weight_pct": 12.0, "value": 185},
            # 정상: 신고값이 추정(25억)과 1.2배 — 밴드 안이므로 신고값을 그대로 쓴다
            {"rank": 2, "ticker": "OK", "name": "Ok Corp.", "weight_pct": 25.0, "value": 3_000_000_000},
        ],
    },
]


def test_compute_allocation_rejects_misaligned_value_and_falls_back_to_estimate():
    by_ticker = {r["ticker"]: r for r in compute_allocation(MISALIGNED)["rows"]}
    # 옛 구현은 185를 그대로 합산했다 → 새 구현은 추정치 12억을 쓴다
    assert by_ticker["BAD"]["value"] == 1_200_000_000


def test_compute_allocation_keeps_reported_value_inside_band():
    by_ticker = {r["ticker"]: r for r in compute_allocation(MISALIGNED)["rows"]}
    assert by_ticker["OK"]["value"] == 3_000_000_000


def test_compute_allocation_total_and_ratio_not_poisoned_by_misalignment():
    result = compute_allocation(MISALIGNED)
    # 12억 + 30억 = 42억 (옛 구현은 185 + 30억 = 30억으로 분모가 어긋났다)
    assert result["total_value"] == 4_200_000_000
    by_ticker = {r["ticker"]: r for r in result["rows"]}
    assert by_ticker["BAD"]["ratio"] == pytest.approx(1_200_000_000 / 4_200_000_000 * 100, abs=0.01)


def test_compute_allocation_misaligned_row_still_counts_holder():
    """오값을 버려도 보유 사실은 남아야 인기순과 어긋나지 않는다."""
    by_ticker = {r["ticker"]: r for r in compute_allocation(MISALIGNED)["rows"]}
    assert by_ticker["BAD"]["holder_count"] == 1


def test_compute_allocation_logs_warning_on_misalignment(caplog):
    import logging
    with caplog.at_level(logging.WARNING):
        compute_allocation(MISALIGNED)
    assert any("value/추정 불일치" in r.message for r in caplog.records)


def test_compute_allocation_does_not_duplicate_warning_across_full_and_cohort_scan(caplog):
    """top이 지정되면 전체 스캔(메타용)과 코호트 스캔(본문용)이 같은 매니저를 두 번
    훑는다 — 공유 없이 각 스캔이 독립적으로 경고를 찍으면 같은 불일치 행에 대해
    경고가 두 번 남는다(리뷰 발견, task#247)."""
    import logging
    with caplog.at_level(logging.WARNING):
        compute_allocation(MISALIGNED, top=1)   # 매니저 1명 → 코호트=전체 스캔과 동일 대상
    warnings = [r for r in caplog.records if "value/추정 불일치" in r.message]
    assert len(warnings) == 1


def test_compute_allocation_without_portfolio_value_trusts_reported_value():
    """pv=0이면 추정치를 만들 수 없다 — 검증자가 없으므로 신고값을 신뢰한다(거부 아님)."""
    sample = [{"id": "m", "portfolio_value": 0, "top10": [],
               "holdings": [{"rank": 1, "ticker": "Z", "name": "Z", "weight_pct": 10.0, "value": 777}]}]
    by_ticker = {r["ticker"]: r for r in compute_allocation(sample)["rows"]}
    assert by_ticker["Z"]["value"] == 777


# ─────────────────────────────────────────────────────────────────────
# 서비스 코호트 절단 `top=` (task#247 S1) — 포트폴리오 규모 상위 N명만 합산
# ─────────────────────────────────────────────────────────────────────

# m1·m2는 portfolio_value 동값(300)으로 top 경계 타이브레이크(id 오름차순)를 만든다.
# m3은 period 있으나 신고값 없는 행(추정), m4는 period 자체가 없다.
COHORT_SAMPLE = [
    {"id": "m1", "portfolio_value": 300, "period": "Q1 2026", "top10": [],
     "holdings": [{"rank": 1, "ticker": "AAA", "name": "AAA Co", "weight_pct": 50.0, "value": 150}]},
    {"id": "m2", "portfolio_value": 300, "period": "Q1 2026", "top10": [],
     "holdings": [{"rank": 1, "ticker": "BBB", "name": "BBB Co", "weight_pct": 50.0, "value": 150}]},
    {"id": "m3", "portfolio_value": 200, "period": "Q4 2025", "top10": [],
     "holdings": [{"rank": 1, "ticker": "CCC", "name": "CCC Co", "weight_pct": 50.0}]},
    {"id": "m4", "portfolio_value": 100, "top10": [],
     "holdings": [{"rank": 1, "ticker": "DDD", "name": "DDD Co", "weight_pct": 50.0}]},
]


def test_compute_allocation_top_cutoff_changes_cohort_size_and_totals():
    result = compute_allocation(COHORT_SAMPLE, top=2)
    assert result["manager_count"] == 2
    assert result["ticker_count"] == 2
    assert result["total_value"] == 300
    assert {r["ticker"] for r in result["rows"]} == {"AAA", "BBB"}


def test_compute_allocation_top_tiebreak_is_deterministic_by_id():
    """m1·m2는 portfolio_value 동값(300) — top=1 경계에서 id 오름차순으로 m1만 뽑혀야
    하고, 입력 순서를 뒤집어도(섞어도) 같은 코호트가 나와야 한다."""
    forward = compute_allocation(COHORT_SAMPLE, top=1)
    shuffled = compute_allocation(list(reversed(COHORT_SAMPLE)), top=1)
    assert forward["rows"][0]["ticker"] == "AAA"
    assert forward == shuffled


def test_compute_allocation_ratio_sums_to_100_for_cohort():
    result = compute_allocation(COHORT_SAMPLE, top=2)
    assert sum(r["ratio"] for r in result["rows"]) == pytest.approx(100.0, abs=0.01)


def test_compute_allocation_manager_count_is_cohort_size():
    assert compute_allocation(COHORT_SAMPLE, top=2)["manager_count"] == 2
    assert compute_allocation(COHORT_SAMPLE)["manager_count"] == 4  # top=None → 전체


def test_compute_allocation_all_totals_invariant_to_top():
    full = compute_allocation(COHORT_SAMPLE)
    top1 = compute_allocation(COHORT_SAMPLE, top=1)
    top999 = compute_allocation(COHORT_SAMPLE, top=999)
    assert full["all_manager_count"] == top1["all_manager_count"] == top999["all_manager_count"] == 4
    assert full["all_total_value"] == top1["all_total_value"] == top999["all_total_value"] == 450


def test_compute_allocation_periods_counts_by_manager_period():
    cohort = compute_allocation(COHORT_SAMPLE, top=2)
    assert cohort["periods"] == {"Q1 2026": 2}

    full = compute_allocation(COHORT_SAMPLE)
    assert full["periods"] == {"Q1 2026": 2, "Q4 2025": 1}  # period 없는 m4는 세지 않음


def test_compute_allocation_estimated_count_zero_when_all_reported():
    assert compute_allocation(COHORT_SAMPLE, top=1)["estimated_count"] == 0


def test_compute_allocation_estimated_count_counts_missing_value_rows():
    full = compute_allocation(COHORT_SAMPLE)
    assert full["estimated_count"] == 2  # m3 CCC · m4 DDD 신고금액 없음


def test_compute_allocation_top_larger_than_manager_count_is_full():
    assert compute_allocation(COHORT_SAMPLE, top=999) == compute_allocation(COHORT_SAMPLE)


def test_compute_allocation_top1_single_manager_cohort():
    result = compute_allocation(COHORT_SAMPLE, top=1)
    assert result["manager_count"] == 1
    assert result["ticker_count"] == 1


def test_compute_allocation_empty_managers_with_top_is_graceful():
    result = compute_allocation([], top=10)
    assert result["manager_count"] == 0
    assert result["all_manager_count"] == 0
    assert result["all_total_value"] == 0
    assert result["periods"] == {}
    assert result["estimated_count"] == 0
    assert result["rows"] == []

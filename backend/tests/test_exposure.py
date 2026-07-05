from decimal import Decimal

import pytest

from services.exposure import compute_exposure


def test_currency_and_sector_grouping_with_etc_bucket():
    holdings = [
        {"ticker": "A", "name": "에이", "market": "KR", "quantity": 700},
        {"ticker": "B", "name": "비", "market": "KR", "quantity": 300},
        {"ticker": "U", "name": "유", "market": "US", "quantity": 10},
    ]
    quotes = {
        "A": {"price": 1000},   # 700,000
        "B": {"price": 1000},   # 300,000
        "U": {"price": 100},    # 100*10*1000 = 1,000,000
    }
    sector_map = {"A": "반도체"}  # B, U는 섹터 미상 -> 기타
    result = compute_exposure(holdings, quotes, fx=1000, sector_map=sector_map)

    # total = 700,000 + 300,000 + 1,000,000 = 2,000,000
    assert result["currency"]["KR"]["value_krw"] == pytest.approx(1_000_000)
    assert result["currency"]["KR"]["weight"] == pytest.approx(50.0)
    assert result["currency"]["US"]["value_krw"] == pytest.approx(1_000_000)
    assert result["currency"]["US"]["weight"] == pytest.approx(50.0)

    assert result["sector"]["반도체"]["weight"] == pytest.approx(35.0)  # A
    assert result["sector"]["기타"]["weight"] == pytest.approx(65.0)  # B + U


def test_top_n_and_weight_descending_order():
    holdings = [
        {"ticker": "A", "name": "A", "market": "KR", "quantity": 100},
        {"ticker": "B", "name": "B", "market": "KR", "quantity": 200},
        {"ticker": "C", "name": "C", "market": "KR", "quantity": 300},
        {"ticker": "D", "name": "D", "market": "KR", "quantity": 400},
    ]
    quotes = {t: {"price": 1000} for t in ["A", "B", "C", "D"]}
    result = compute_exposure(holdings, quotes, fx=None, sector_map={})

    tickers_in_order = [h["ticker"] for h in result["holdings"]]
    assert tickers_in_order == ["D", "C", "B", "A"]  # 비중 내림차순

    # total = 100+200+300+400 = 1000 (단위 1000원 * 수량)
    assert result["concentration"]["top3_pct"] == pytest.approx((400 + 300 + 200) / 1000 * 100)
    assert result["concentration"]["top5_pct"] == pytest.approx(100.0)  # 4종목 전부
    assert result["concentration"]["max_single"] == {"ticker": "D", "weight": pytest.approx(40.0)}


def test_single_name_warning_threshold_26_over_25_under_no_warning():
    """단일종목 비중이 아니라 '단일종목 임계'를 격리 검증 — 나머지는 여러 종목에 분산해
    비교대상 종목만 임계를 넘나들게 한다(두 종목뿐이면 상대편이 항상 75%로 자체 초과해버림)."""
    quotes = {t: {"price": 1000} for t in ["A", "B", "C", "D", "E"]}

    # A=26%, 나머지(B/C/D/E)는 각각 25% 미만으로 분산 -> A만으로 경고
    holdings = [
        {"ticker": "A", "name": "A", "market": "KR", "quantity": 26},
        {"ticker": "B", "name": "B", "market": "KR", "quantity": 20},
        {"ticker": "C", "name": "C", "market": "KR", "quantity": 20},
        {"ticker": "D", "name": "D", "market": "KR", "quantity": 20},
        {"ticker": "E", "name": "E", "market": "KR", "quantity": 14},
    ]
    result = compute_exposure(holdings, quotes, fx=None, sector_map={})
    assert result["warnings"]["single_name"] is True

    # 정확히 25% -> 경고 없음(그 아래/동일은 무경고, 임계는 초과만), 나머지도 전부 25% 이하
    holdings2 = [
        {"ticker": "A", "name": "A", "market": "KR", "quantity": 25},
        {"ticker": "B", "name": "B", "market": "KR", "quantity": 20},
        {"ticker": "C", "name": "C", "market": "KR", "quantity": 20},
        {"ticker": "D", "name": "D", "market": "KR", "quantity": 20},
        {"ticker": "E", "name": "E", "market": "KR", "quantity": 15},
    ]
    result2 = compute_exposure(holdings2, quotes, fx=None, sector_map={})
    assert result2["warnings"]["single_name"] is False


def test_sector_warning_threshold_41_over_40_under_no_warning():
    """섹터 그룹 합을 격리 검증 — 3개 섹터로 나눠 다른 섹터는 항상 40% 이하로 두고
    (반도체를 두 종목으로 쪼개 개별 단일종목 임계 25%엔 안 걸리게) 반도체 합만 40%를 넘나든다."""
    sectors = {"A1": "반도체", "A2": "반도체", "B": "화학", "C": "소재"}
    quotes = {t: {"price": 1000} for t in sectors}

    # 반도체(A1 21 + A2 20)=41%, 화학(B)=30%, 소재(C)=29% -> 섹터 경고
    holdings = [
        {"ticker": "A1", "name": "A1", "market": "KR", "quantity": 21},
        {"ticker": "A2", "name": "A2", "market": "KR", "quantity": 20},
        {"ticker": "B", "name": "B", "market": "KR", "quantity": 30},
        {"ticker": "C", "name": "C", "market": "KR", "quantity": 29},
    ]
    result = compute_exposure(holdings, quotes, fx=None, sector_map=sectors)
    assert result["warnings"]["sector"] is True

    # 반도체(A1 20 + A2 20)=정확히 40%, 화학 30%, 소재 30% -> 모든 섹터 40% 이하, 경고 없음
    holdings2 = [
        {"ticker": "A1", "name": "A1", "market": "KR", "quantity": 20},
        {"ticker": "A2", "name": "A2", "market": "KR", "quantity": 20},
        {"ticker": "B", "name": "B", "market": "KR", "quantity": 30},
        {"ticker": "C", "name": "C", "market": "KR", "quantity": 30},
    ]
    result2 = compute_exposure(holdings2, quotes, fx=None, sector_map=sectors)
    assert result2["warnings"]["sector"] is False


def test_currency_grouping_has_no_warning_field_leakage_from_thresholds():
    """통화는 정보성 — 아무리 쏠려도(100%) 별도 경고 플래그가 없다(단일종목/섹터 경고와 분리)."""
    holdings = [{"ticker": "A", "name": "A", "market": "KR", "quantity": 100}]
    quotes = {"A": {"price": 1000}}
    result = compute_exposure(holdings, quotes, fx=None, sector_map={})
    assert result["currency"]["KR"]["weight"] == pytest.approx(100.0)
    assert set(result["warnings"].keys()) == {"single_name", "sector"}


def test_empty_holdings_graceful_no_zero_division():
    result = compute_exposure([], {}, fx=1000, sector_map={})
    assert result["holdings"] == []
    assert result["currency"] == {}
    assert result["sector"] == {}
    assert result["concentration"]["max_single"] is None
    assert result["concentration"]["top3_pct"] == pytest.approx(0.0)
    assert result["warnings"]["single_name"] is False
    assert result["warnings"]["sector"] is False


def test_all_no_fx_holdings_full_total_zero_graceful():
    """전 종목 US, fx 없음 -> 전부 no_fx, full_total=0, 크래시 없이 빈/0 결과."""
    holdings = [{"ticker": "U", "name": "U", "market": "US", "quantity": 10}]
    quotes = {"U": {"price": 100}}
    result = compute_exposure(holdings, quotes, fx=None, sector_map={})
    assert result["holdings"] == []
    assert result["no_fx"]["tickers"] == ["U"]
    assert result["no_fx"]["count"] == 1
    assert result["concentration"]["max_single"] is None


def test_fx_none_and_fx_zero_both_mark_us_as_no_fx():
    holdings = [
        {"ticker": "A", "name": "A", "market": "KR", "quantity": 100},
        {"ticker": "U", "name": "U", "market": "US", "quantity": 10},
    ]
    quotes = {"A": {"price": 1000}, "U": {"price": 100}}

    result_none = compute_exposure(holdings, quotes, fx=None, sector_map={})
    assert "U" in result_none["no_fx"]["tickers"]

    result_zero = compute_exposure(holdings, quotes, fx=0, sector_map={})
    assert "U" in result_zero["no_fx"]["tickers"]
    # A만 집계 (100,000) -> KR 100%
    assert result_zero["currency"]["KR"]["weight"] == pytest.approx(100.0)
    assert "US" not in result_zero["currency"]


def test_decimal_quantity_and_fx_do_not_raise_type_error():
    """DB NUMERIC 재현 — avg_cost/quantity는 Decimal, 시세/fx는 float일 수 있음(혼산 방지)."""
    holdings = [
        {"ticker": "A", "name": "A", "market": "KR", "quantity": Decimal("700")},
        {"ticker": "U", "name": "U", "market": "US", "quantity": Decimal("10")},
    ]
    quotes = {"A": {"price": 1000.0}, "U": {"price": 100.0}}
    result = compute_exposure(holdings, quotes, fx=Decimal("1400"), sector_map={})

    # A: 1000*700=700,000  U: 100*10*1400=1,400,000 -> total 2,100,000
    by_ticker = {h["ticker"]: h for h in result["holdings"]}
    assert by_ticker["A"]["weight"] == pytest.approx(700_000 / 2_100_000 * 100)
    assert by_ticker["U"]["weight"] == pytest.approx(1_400_000 / 2_100_000 * 100)


def test_portfolio_beta_weighted_average_full_coverage():
    holdings = [
        {"ticker": "A", "name": "A", "market": "KR", "quantity": 700},
        {"ticker": "U", "name": "U", "market": "US", "quantity": 10},
    ]
    quotes = {"A": {"price": 1000}, "U": {"price": 100}}
    # A weight=70%, U weight=... fx=1000 -> U value_krw=100*10*1000=1,000,000, A=700,000 -> total 1,700,000
    result = compute_exposure(holdings, quotes, fx=1000, sector_map={}, beta_map={"A": 1.0, "U": 2.0})
    w_a = 700_000 / 1_700_000
    w_u = 1_000_000 / 1_700_000
    expected = (w_a * 1.0 + w_u * 2.0)  # weight * beta, weight already in fraction-equivalent (both covered -> no renorm needed)
    assert result["portfolio_beta"] == pytest.approx(expected)
    assert result["beta_coverage_pct"] == pytest.approx(100.0)
    assert result["beta_covered_count"] == 2
    assert result["beta_missing"] == []


def test_portfolio_beta_partial_coverage_renormalizes_over_covered_only():
    """beta 없는 종목은 분모(재정규화)에서 제외 — 커버된 집합만의 가중평균."""
    holdings = [
        {"ticker": "A", "name": "A", "market": "KR", "quantity": 500},
        {"ticker": "B", "name": "B", "market": "KR", "quantity": 500},
    ]
    quotes = {"A": {"price": 1000}, "B": {"price": 1000}}
    # A, B 각각 50% 비중. B는 beta 없음 -> 재정규화하면 A만으로 포트베타 = A의 beta
    result = compute_exposure(holdings, quotes, fx=None, sector_map={}, beta_map={"A": 1.5})
    assert result["portfolio_beta"] == pytest.approx(1.5)
    assert result["beta_coverage_pct"] == pytest.approx(50.0)
    assert result["beta_covered_count"] == 1
    assert result["beta_missing"] == ["B"]


def test_portfolio_beta_empty_beta_map_graceful_none():
    holdings = [{"ticker": "A", "name": "A", "market": "KR", "quantity": 100}]
    quotes = {"A": {"price": 1000}}
    result = compute_exposure(holdings, quotes, fx=None, sector_map={}, beta_map={})
    assert result["portfolio_beta"] is None
    assert result["beta_coverage_pct"] == pytest.approx(0.0)
    assert result["beta_covered_count"] == 0
    assert result["beta_missing"] == ["A"]


def test_portfolio_beta_defaults_to_none_when_beta_map_omitted():
    """beta_map 미전달(호출부 하위호환) -> portfolio_beta=None graceful, 크래시 없음."""
    holdings = [{"ticker": "A", "name": "A", "market": "KR", "quantity": 100}]
    quotes = {"A": {"price": 1000}}
    result = compute_exposure(holdings, quotes, fx=None, sector_map={})
    assert result["portfolio_beta"] is None

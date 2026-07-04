from decimal import Decimal

import pytest

from services.rebalance import compute_rebalance


def test_basic_two_holdings_equal_target_buy_sell_signs():
    holdings = [
        {"ticker": "A", "market": "KR", "current_price": 1000, "quantity": 700},  # 700,000 (70%)
        {"ticker": "B", "market": "KR", "current_price": 1000, "quantity": 300},  # 300,000 (30%)
    ]
    result = compute_rebalance(holdings, usdkrw=None, targets={"A": 50, "B": 50})
    by_ticker = {h["ticker"]: h for h in result["holdings"]}

    assert by_ticker["A"]["current_weight"] == pytest.approx(70.0)
    assert by_ticker["B"]["current_weight"] == pytest.approx(30.0)
    # A는 과체중(70%>50%) → 매도(음수), B는 저평가(30%<50%) → 매수(양수)
    assert by_ticker["A"]["suggested_trade_krw"] < 0
    assert by_ticker["B"]["suggested_trade_krw"] > 0
    assert by_ticker["A"]["suggested_trade_krw"] == pytest.approx(-200000)
    assert by_ticker["B"]["suggested_trade_krw"] == pytest.approx(200000)
    assert by_ticker["A"]["suggested_shares"] == -200
    assert by_ticker["B"]["suggested_shares"] == 200


def test_suggested_shares_rounds_even_when_not_evenly_divisible():
    """실거래 시세는 트레이드 금액이 주가로 딱 나눠떨어지는 경우가 거의 없다 —
    딱 나눠떨어질 때만 값을 주면 사실상 항상 None이 되는 버그였음(task#146 리뷰에서 발견)."""
    holdings = [
        {"ticker": "A", "market": "KR", "current_price": 53700, "quantity": 13},
        {"ticker": "B", "market": "KR", "current_price": 21200, "quantity": 5},
    ]
    result = compute_rebalance(holdings, usdkrw=None, targets={"A": 50, "B": 50})
    by_ticker = {h["ticker"]: h for h in result["holdings"]}
    assert by_ticker["A"]["suggested_shares"] is not None
    assert by_ticker["B"]["suggested_shares"] is not None
    assert isinstance(by_ticker["A"]["suggested_shares"], int)


def test_raw_target_sum_not_100_is_normalized():
    holdings = [
        {"ticker": "A", "market": "KR", "current_price": 1000, "quantity": 700},
        {"ticker": "B", "market": "KR", "current_price": 1000, "quantity": 300},
    ]
    result = compute_rebalance(holdings, usdkrw=None, targets={"A": 60, "B": 50})

    assert result["summary"]["raw_target_sum"] == pytest.approx(110)
    by_ticker = {h["ticker"]: h for h in result["holdings"]}
    normalized_sum = by_ticker["A"]["target_weight"] + by_ticker["B"]["target_weight"]
    assert normalized_sum == pytest.approx(100.0)


def test_untargeted_holding_excluded_from_suggestion_and_total():
    holdings = [
        {"ticker": "A", "market": "KR", "current_price": 1000, "quantity": 700},
        {"ticker": "C", "market": "KR", "current_price": 1000, "quantity": 500},  # 타겟 미설정
    ]
    result = compute_rebalance(holdings, usdkrw=None, targets={"A": 100})
    by_ticker = {h["ticker"]: h for h in result["holdings"]}

    assert by_ticker["C"]["untargeted"] is True
    assert by_ticker["C"]["target_weight"] is None
    assert by_ticker["C"]["suggested_trade_krw"] is None
    assert by_ticker["C"]["current_weight"] is None  # 정규화 대상(타겟 설정 종목) 총계에서 제외
    assert result["summary"]["has_untargeted"] is True
    # 총계는 A의 700,000만 (C의 500,000 미포함)
    assert result["summary"]["total_value_krw"] == pytest.approx(700000)
    assert by_ticker["A"]["current_weight"] == pytest.approx(100.0)


def test_us_holding_without_fx_excluded_as_no_fx():
    holdings = [
        {"ticker": "A", "market": "KR", "current_price": 1000, "quantity": 700},
        {"ticker": "U", "market": "US", "current_price": 100, "quantity": 10},
    ]
    result = compute_rebalance(holdings, usdkrw=None, targets={"A": 50, "U": 50})
    by_ticker = {h["ticker"]: h for h in result["holdings"]}

    assert by_ticker["U"]["no_fx"] is True
    assert by_ticker["U"]["current_value_krw"] is None
    assert result["summary"]["has_no_fx"] is True
    # 총계는 A만 포함 (U는 FX 없어 KRW 환산 불가 → 제외)
    assert result["summary"]["total_value_krw"] == pytest.approx(700000)


def test_decimal_inputs_do_not_raise_type_error():
    holdings = [
        {
            "ticker": "A",
            "market": "KR",
            "current_price": Decimal("1000"),
            "quantity": Decimal("700"),
        },
        {
            "ticker": "U",
            "market": "US",
            "current_price": Decimal("100"),
            "quantity": Decimal("10"),
        },
    ]
    result = compute_rebalance(
        holdings, usdkrw=Decimal("1400"), targets={"A": 50, "U": 50}
    )
    by_ticker = {h["ticker"]: h for h in result["holdings"]}

    # A: 1,000*700=700,000  U: 100*10*1400=1,400,000 -> total 2,100,000
    assert result["summary"]["total_value_krw"] == pytest.approx(2100000)
    assert by_ticker["A"]["current_weight"] == pytest.approx(700000 / 2100000 * 100)
    assert by_ticker["U"]["current_weight"] == pytest.approx(1400000 / 2100000 * 100)

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


def test_targets_are_not_normalized_full_portfolio_basis():
    """전체-포트 기준(task#147): 타겟은 전체 포트 대비 %라 정규화하지 않는다(raw 값 그대로)."""
    holdings = [
        {"ticker": "A", "market": "KR", "current_price": 1000, "quantity": 700},  # 70%
        {"ticker": "B", "market": "KR", "current_price": 1000, "quantity": 300},  # 30%
    ]
    result = compute_rebalance(holdings, usdkrw=None, targets={"A": 60, "B": 50})
    by_ticker = {h["ticker"]: h for h in result["holdings"]}

    assert result["summary"]["raw_target_sum"] == pytest.approx(110)
    # 정규화하지 않음 — raw 60/50 그대로
    assert by_ticker["A"]["target_weight"] == pytest.approx(60)
    assert by_ticker["B"]["target_weight"] == pytest.approx(50)
    assert by_ticker["A"]["drift_pp"] == pytest.approx(70 - 60)
    assert by_ticker["B"]["drift_pp"] == pytest.approx(30 - 50)


def test_untargeted_holding_shows_full_portfolio_weight_but_no_suggestion():
    """전체-포트 기준: 미설정 종목도 실제 비중을 표시(분모=전체 포트), 단 제안은 없음(hold)."""
    holdings = [
        {"ticker": "A", "market": "KR", "current_price": 1000, "quantity": 700},  # 700,000
        {"ticker": "C", "market": "KR", "current_price": 1000, "quantity": 500},  # 500,000 타겟 미설정
    ]
    result = compute_rebalance(holdings, usdkrw=None, targets={"A": 100})
    by_ticker = {h["ticker"]: h for h in result["holdings"]}

    # C(미설정): 실제 비중은 표시되지만 타겟/드리프트/제안은 없음
    assert by_ticker["C"]["untargeted"] is True
    assert by_ticker["C"]["current_weight"] == pytest.approx(500000 / 1200000 * 100)
    assert by_ticker["C"]["target_weight"] is None
    assert by_ticker["C"]["drift_pp"] is None
    assert by_ticker["C"]["suggested_trade_krw"] is None
    # 총계는 전체 포트(A+C 모두 포함)
    assert result["summary"]["total_value_krw"] == pytest.approx(1200000)
    assert by_ticker["A"]["current_weight"] == pytest.approx(700000 / 1200000 * 100)
    assert result["summary"]["has_untargeted"] is True
    # 합계 = 설정 타겟(100) + 미설정 현재비중(41.67) ≈ 141.67
    assert result["summary"]["allocation_sum"] == pytest.approx(100 + 500000 / 1200000 * 100)


def test_us_holding_without_fx_excluded_as_no_fx():
    holdings = [
        {"ticker": "A", "market": "KR", "current_price": 1000, "quantity": 700},
        {"ticker": "U", "market": "US", "current_price": 100, "quantity": 10},
    ]
    result = compute_rebalance(holdings, usdkrw=None, targets={"A": 50, "U": 50})
    by_ticker = {h["ticker"]: h for h in result["holdings"]}

    assert by_ticker["U"]["no_fx"] is True
    assert by_ticker["U"]["current_value_krw"] is None
    assert by_ticker["U"]["current_weight"] is None  # KRW 환산 불가 → 비중도 blank
    assert result["summary"]["has_no_fx"] is True
    # 총계는 A만 포함 (U는 FX 없어 KRW 환산 불가 → 제외)
    assert result["summary"]["total_value_krw"] == pytest.approx(700000)
    assert by_ticker["A"]["current_weight"] == pytest.approx(100.0)


def test_name_passthrough():
    holdings = [
        {"ticker": "A", "name": "에이종목", "market": "KR", "current_price": 1000, "quantity": 700},
    ]
    result = compute_rebalance(holdings, usdkrw=None, targets={"A": 100})
    assert result["holdings"][0]["name"] == "에이종목"


def test_full_total_zero_no_crash():
    """전 종목 no_fx(FX 없는 US)면 full_total=0 — 크래시 없이 current_weight None."""
    holdings = [
        {"ticker": "U", "market": "US", "current_price": 100, "quantity": 10},
    ]
    result = compute_rebalance(holdings, usdkrw=None, targets={"U": 100})
    row = result["holdings"][0]
    assert row["current_weight"] is None
    assert row["suggested_trade_krw"] is None
    assert result["summary"]["total_value_krw"] == pytest.approx(0)


def test_zero_fx_treated_as_no_fx_no_zero_division():
    """저장 FX가 0(무효)이면 US를 no_fx로 처리 — suggested_trade_krw/fx 0으로 나누기 방지."""
    holdings = [
        {"ticker": "A", "market": "KR", "current_price": 1000, "quantity": 700},
        {"ticker": "U", "market": "US", "current_price": 100, "quantity": 10},
    ]
    result = compute_rebalance(holdings, usdkrw=0, targets={"A": 50, "U": 50})
    by_ticker = {h["ticker"]: h for h in result["holdings"]}
    assert by_ticker["U"]["no_fx"] is True
    assert by_ticker["U"]["current_value_krw"] is None
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

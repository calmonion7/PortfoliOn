"""
Row→지표 매핑 고정 테스트 (Naver rowList index 드리프트 검출용).
"""
from unittest.mock import patch

import pytest

# 16-row fixture: 실제 Naver financeInfo 응답 구조 (1 period)
PERIOD_KEY = "202503"
_row_values = [
    "791405",   # 0 매출액
    "66853",    # 1 영업이익
    "82229",    # 2 당기순이익
    "70000",    # 3 지배주주순이익
    "12229",    # 4 비지배주주순이익
    "8.45",     # 5 영업이익률
    "10.39",    # 6 순이익률
    "9.24",     # 7 ROE
    "26.99",    # 8 부채비율
    "187.68",   # 9 당좌비율
    "500",      # 10 유보율
    "1186",     # 11 EPS
    "11.20",    # 12 PER
    "59059",    # 13 BPS
    "0.98",     # 14 PBR
    "1200",     # 15 주당배당금
]


def _make_naver_response(row9_value="187.68"):
    row_vals = list(_row_values)
    row_vals[9] = row9_value  # allow override for graceful test
    row_list = [
        {"columns": {PERIOD_KEY: {"value": v}}}
        for v in row_vals
    ]
    return {
        "financeInfo": {
            "trTitleList": [{"key": PERIOD_KEY, "isConsensus": "N"}],
            "rowList": row_list,
        }
    }


def test_kr_financials_ratios():
    from backend.services.market.kr import get_financials_kr

    with patch("backend.services.market.kr._naver_get", return_value=_make_naver_response()):
        results = get_financials_kr("005930")

    assert results, "결과가 비어있음"
    item = results[0]

    assert item["operating_margin"] == 8.45
    assert item["net_margin"] == 10.39
    assert item["roe"] == 9.24
    assert item["debt_ratio"] == 26.99
    assert item["quick_ratio"] == 187.68
    assert item["net_income"] == int(82229 * 1e8)


def test_kr_financials_quick_ratio_graceful_none():
    """row9 == '-' → quick_ratio is None (graceful)."""
    from backend.services.market.kr import get_financials_kr

    with patch("backend.services.market.kr._naver_get", return_value=_make_naver_response(row9_value="-")):
        results = get_financials_kr("005930")

    assert results[0]["quick_ratio"] is None

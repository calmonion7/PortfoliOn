"""
Naver rowList title→지표 매핑 고정 테스트(B61, task#303).

`_naver_row_val`은 title 문자열로 계정을 찾는다(위치 인덱스가 아니다) — 상류가 행
순서를 바꿔도 안전하고, title 자체가 바뀌면(위치 인덱스라면 아무 신호 없이 다른
계정을 읽어버리는 그 결함) None + logger.warning으로 신호를 낸다.
"""
import logging
from unittest.mock import patch

import pytest

# 16-row fixture: 실제 Naver financeInfo 응답 구조(8표본 실측, task#303) — title 순서
PERIOD_KEY = "202503"
_TITLES = [
    "매출액", "영업이익", "당기순이익", "지배주주순이익", "비지배주주순이익",
    "영업이익률", "순이익률", "ROE", "부채비율", "당좌비율", "유보율",
    "EPS", "PER", "BPS", "PBR", "주당배당금",
]
_row_values = [
    "791405",   # 매출액
    "66853",    # 영업이익
    "82229",    # 당기순이익
    "70000",    # 지배주주순이익
    "12229",    # 비지배주주순이익
    "8.45",     # 영업이익률
    "10.39",    # 순이익률
    "9.24",     # ROE
    "26.99",    # 부채비율
    "187.68",   # 당좌비율
    "500",      # 유보율
    "1186",     # EPS
    "11.20",    # PER
    "59059",    # BPS
    "0.98",     # PBR
    "1200",     # 주당배당금
]


def _make_naver_response(row9_value="187.68", rename=None, shuffle=False):
    """rename: {old_title: new_title} — 특정 행의 title만 바꿔치기(상류 라벨 변경 재현).
    shuffle: rowList 순서를 뒤집는다(위치 인덱스 의존을 드러내는 축)."""
    row_vals = list(_row_values)
    row_vals[9] = row9_value  # allow override for graceful test
    titles = [rename.get(t, t) for t in _TITLES] if rename else list(_TITLES)
    row_list = [
        {"title": t, "columns": {PERIOD_KEY: {"value": v}}}
        for t, v in zip(titles, row_vals)
    ]
    if shuffle:
        row_list = list(reversed(row_list))
    return {
        "financeInfo": {
            "trTitleList": [{"key": PERIOD_KEY, "isConsensus": "N"}],
            "rowList": row_list,
        }
    }


def test_kr_financials_ratios():
    from services.market.kr import get_financials_kr

    with patch("services.market.kr._naver_get", return_value=_make_naver_response()):
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
    from services.market.kr import get_financials_kr

    with patch("services.market.kr._naver_get", return_value=_make_naver_response(row9_value="-")):
        results = get_financials_kr("005930")

    assert results[0]["quick_ratio"] is None


def test_kr_financials_row_order_independent():
    """rowList 순서를 뒤집어도 title 매칭이라 값이 그대로다 — 고정 순서 픽스처는
    위치 인덱스 코드도 통과시켜 이빨이 없으므로, 이 축이 이빨의 전부다."""
    from services.market.kr import get_financials_kr

    with patch("services.market.kr._naver_get", return_value=_make_naver_response(shuffle=True)):
        results = get_financials_kr("005930")

    item = results[0]
    assert item["revenue"] == int(791405 * 1e8)
    assert item["operating_income"] == int(66853 * 1e8)
    assert item["net_income"] == int(82229 * 1e8)
    assert item["eps"] == 1186
    assert item["per"] == 11.2
    assert item["bps"] == 59059
    assert item["pbr"] == 0.98
    assert item["operating_margin"] == 8.45
    assert item["net_margin"] == 10.39
    assert item["roe"] == 9.24
    assert item["debt_ratio"] == 26.99
    assert item["quick_ratio"] == 187.68


def test_kr_financials_title_rename_returns_none_with_warning(caplog):
    """상류가 '매출액'을 '영업수익'으로 바꾸면 조용한 오값이 아니라 None + 경고가
    난다. 위치 인덱스는 상류가 title만 바꿔도(자리는 그대로) 아무 신호 없이 그
    자리 값을 계속 읽으므로, 이 축은 그 결함을 구현 전 상태에서 그대로 재현한다."""
    from services.market.kr import get_financials_kr

    resp = _make_naver_response(rename={"매출액": "영업수익"})
    with caplog.at_level(logging.WARNING, logger="services.market.kr"):
        with patch("services.market.kr._naver_get", return_value=resp):
            results = get_financials_kr("005930")

    item = results[0]
    assert item["revenue"] is None
    assert item["operating_income"] == int(66853 * 1e8)  # 다른 계정은 영향 없음

    warns = [r for r in caplog.records if "rowList title 미발견" in r.message]
    assert len(warns) == 1  # 기간 6회 루프에도 중복 방출 없음 — 호출당 1건으로 묶임
    assert "005930" in warns[0].message
    assert "매출액" in warns[0].message

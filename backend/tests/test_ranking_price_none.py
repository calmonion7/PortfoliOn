"""랭킹 현재가 파싱 실패는 0이 아니라 None (적대 검토 F6 — B66/B67의 세 번째 형제).

`market_investor_trend.close_price`(키움 2경로 + Naver)를 None 규약으로 통일했는데,
**같은 클래스의 세 번째 writer**가 남아 있었다: `ranking_service._kr_row`/`_us_row`의
`price`. 그리고 이쪽이 더 나쁘다 —

  - `close_price`는 프론트 소비처가 0건이지만(`grep -rn close_price frontend/src` → 0),
    `price`는 **화면에 그대로 렌더된다**(`Ranking.jsx:358` 카드 현재가 · `:491` 상세 행).
    사용자가 「0원」·「$0.00」을 현재가로 읽는다.
  - `market_rankings`는 **전량 DELETE+INSERT**라 직전 양호값 폴백이 없다.

비유한값 통로 2종도 함께 닫는다:
  ⓐ `_parse_int('Infinity')` → `int(float(...))`가 **OverflowError**(ValueError 아님)를
     내므로 `except (ValueError, TypeError)`가 못 잡고 전파된다(실측 확인).
  ⓑ `_us_row`의 `quote.get("regularMarketPrice") or 0`은 **`bool(nan) is True`**라 NaN을
     통과시키고, 뒤이은 `int(price * volume)`가 `int(nan)` ValueError로 US 랭킹 배치를
     통째로 죽인다(실측 확인).

⚠️ 표시 안전성 대조 — `fmtPrice`는 `val == null || !Number.isFinite(...)`에서 `'—'`를
반환하므로(`frontend/src/utils.js:7`, `utils.test.js`가 null·NaN 둘 다 단언) None을
보내도 프론트는 깨지지 않는다. 적대 검토는 `Ranking.jsx:358`에 null 가드가 없다며
프론트 동반 수정을 요구했지만 그것은 **무효**다(가드가 포매터 안에 있다).
"""
import math

import pytest

from services import ranking_service as rs


# ── ⓐ KR: Naver marketvalue ──

@pytest.mark.parametrize("bad", [None, "", "-", "N/A", "abc", "nan", "NaN",
                                 "Infinity", "-Infinity", "inf"])
def test_kr_price_none_on_parse_failure(bad):
    """거래정지·필드 부재·비유한 토큰 → 0원이 아니라 None."""
    row = rs._kr_row({"itemCode": "005930", "stockName": "삼성전자",
                      "closePriceRaw": bad})
    assert row["price"] is None, f"입력 {bad!r} → 0/비유한이 아니라 None이어야"


def test_kr_price_normal_control():
    """대조군 — 정상 입력은 계속 값을 낸다."""
    row = rs._kr_row({"itemCode": "005930", "stockName": "삼성전자",
                      "closePriceRaw": "71,200", "accumulatedTradingValueRaw": "1000",
                      "accumulatedTradingVolumeRaw": "20", "marketValueRaw": "4000000"})
    assert row["price"] == 71200
    assert (row["trading_value"], row["trading_volume"], row["market_cap"]) == (1000, 20, 4000000)


# ── ⓑ US: yfinance quote ──

@pytest.mark.parametrize("bad", [None, float("nan"), float("inf"), float("-inf"), "abc"])
def test_us_price_none_on_parse_failure(bad):
    row = rs._us_row({"symbol": "AAPL", "regularMarketPrice": bad,
                      "regularMarketVolume": 1000})
    assert row["price"] is None, f"입력 {bad!r} → None이어야"


@pytest.mark.parametrize("bad", [float("nan"), float("inf")])
def test_us_nonfinite_price_does_not_crash_trading_value(bad):
    """`int(nan * volume)`으로 US 랭킹 배치가 통째로 죽던 경로 — 이제 결측으로 흐른다."""
    row = rs._us_row({"symbol": "AAPL", "regularMarketPrice": bad,
                      "regularMarketVolume": 1000})
    assert row["trading_value"] is None
    assert row["trading_volume"] == 1000  # 같은 행의 정상 필드는 살아 있다


def test_us_price_normal_control():
    row = rs._us_row({"symbol": "AAPL", "shortName": "Apple Inc.",
                      "regularMarketPrice": 227.5, "regularMarketVolume": 1000,
                      "regularMarketChangePercent": "1.25", "marketCap": "3500000000"})
    assert row["price"] == 227.5
    assert row["trading_value"] == 227500
    assert row["change_pct"] == 1.25


# ── ⓒ 비유한값 통로: OverflowError가 새지 않는다 ──

@pytest.mark.parametrize("tok", ["Infinity", "-Infinity", "inf", "1e400"])
def test_parse_int_does_not_leak_overflow_error(tok):
    """`int(float('Infinity'))`는 ValueError가 아니라 OverflowError다 — 옛 except가 못 잡았다."""
    assert rs._parse_int(tok) == 0        # 수량/금액 필드의 0 폴백은 기존 계약(보존)


@pytest.mark.parametrize("tok", ["nan", "Infinity", "-inf"])
def test_parse_float_rejects_nonfinite(tok):
    """등락률(`change_pct`)에 비유한값이 실리면 응답 직렬화 500이 된다(allow_nan=False)."""
    v = rs._parse_float(tok)
    assert v is None or math.isfinite(v), f"{tok!r} → {v!r}"


def test_parse_float_normal_control():
    assert rs._parse_float("-1.25") == -1.25
    assert rs._parse_float("") is None


# ── ⓒ2 리터럴 0: 라이브에서 실제로 오는 형태 ──

@pytest.mark.parametrize("zero", ["0", "0.0", "-0", "+0", 0, 0.0])
def test_literal_zero_price_is_none(zero):
    """0원 현재가는 존재하지 않는다 — 파싱 성공이므로 다른 가드를 모두 통과한다.

    **라이브 실측(probe327b, 2026-08-22)**: Naver marketvalue KOSPI 2478행 중 **54행**이
    `closePriceRaw='0'`으로 온다(거래 0인 채권형 ETF·ETN). 통과시키면 랭킹 카드 현재가가
    「0원」으로 렌더된다. `market_investor_trend.close_price`와 같은 판정이다.
    """
    assert rs._parse_price(zero) is None


def test_live_shaped_zero_price_etn_row():
    """라이브 실행 형태 그대로 — 시세 0/거래 0인 ETN 행."""
    row = rs._kr_row({"itemCode": "550082", "stockName": "N2 KIS CD금리투자 ETN",
                      "closePriceRaw": "0", "fluctuationsRatio": "-100.00",
                      "accumulatedTradingVolumeRaw": "0",
                      "accumulatedTradingValueRaw": "0", "marketValueRaw": "1000",
                      "stockEndType": "etn"})
    assert row["price"] is None
    assert row["trading_volume"] == 0        # 수량 0은 유효값(거래 없음)
    assert row["is_etf"] is True


def test_smallest_valid_price_still_parsed_control():
    """대조군 — 1원/$0.01은 유효하다(임의 하한 임계를 두지 않았다)."""
    assert rs._parse_price("1") == 1.0
    assert rs._parse_price("0.01") == 0.01


# ── ⓓ 정렬·저장 경로가 None을 견딘다 ──

def test_top_n_sort_tolerates_none_price():
    """`price`는 정렬 metric이 아니지만 None 행이 정렬 경로를 통과해야 한다."""
    rows = [
        {"ticker": "A", "price": None, "trading_value": 10},
        {"ticker": "B", "price": 5.0, "trading_value": 20},
    ]
    ranked = rs._top_n_by(rows, "trading_value", n=2)
    assert [r["ticker"] for r in ranked] == ["B", "A"]
    assert ranked[1]["price"] is None   # None이 0으로 되살아나지 않는다

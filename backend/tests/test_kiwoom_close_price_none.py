"""close_price 파싱 실패는 0이 아니라 None (B66 키움 ka10059 · B67 키움 ka10014 · Naver 폴백).

`wrong < missing` — 종가 0원은 '실패'를 '유효 시세'로 위장한다(차트가 0으로 급락한 것처럼
보이고, 이후 어떤 소비처도 그것이 결측인지 알 수 없다). 반대로 순매수(foreign_net 등)의
0은 '순매수 없음'이라는 **유효값**이므로 그 폴백은 이 슬라이스가 건드리지 않는다 —
아래 대조군 ⓑ가 처방이 그쪽으로 번지지 않았음을 증언한다.

컬럼은 양쪽 다 nullable(app_schema.sql `close_price NUMERIC`)이고 라우터도
`_to_int(val) if val is not None else None`이라 None이 그대로 흐른다(행 스킵 불필요).
"""
import logging
from datetime import date
from unittest.mock import patch

import pytest

from services import investor_service as isvc
from services.kiwoom import investor as kinv
from services.kiwoom import shortsell as kss

# 파싱 실패 입력 — 센티널 4종 + 비수치 문자열 + 비유한값 3종
BAD_VALUES = [None, "", "-", "+", "N/A", "abc", "nan", "Infinity", "-inf"]


def _flow_row(dt: str, cur_prc, frgnr="+1000"):
    return {"dt": dt, "frgnr_invsr": frgnr, "orgn": "+0", "ind_invsr": "-1000",
            "cur_prc": cur_prc}


def _fetch_flows(rows):
    def fake_paged(api_id, body, category, list_key, max_items):
        return rows if api_id == "ka10059" else []
    with patch("services.kiwoom.client.request_paged", side_effect=fake_paged):
        return kinv.fetch_flows("005930")


# ── B66: 키움 ka10059 (수급) ──

def test_kiwoom_investor_close_price_none_on_parse_failure():
    for bad in BAD_VALUES:
        flows = _fetch_flows([_flow_row("20260612", bad)])
        assert flows[date(2026, 6, 12)]["close_price"] is None, f"입력 {bad!r} → 0이 아니라 None"


def test_kiwoom_investor_trend_rows_close_price_none_on_parse_failure():
    """병합 경로(fetch_trend_rows)까지 None이 보존된다 — 저장 직전 형태."""
    def fake_paged(api_id, body, category, list_key, max_items):
        return [_flow_row("20260612", "N/A")] if api_id == "ka10059" else []
    with patch("services.kiwoom.client.request_paged", side_effect=fake_paged):
        rows = kinv.fetch_trend_rows("005930")
    assert rows[0]["close_price"] is None
    assert rows[0]["foreign_net"] == 1000  # 같은 행의 정상 필드는 살아 있다


# ── B67: 키움 ka10014 (공매도) ──

def _ss_item(close_pric, qty="+100"):
    return {"dt": "20260612", "shrts_qty": qty, "shrts_trde_prica": "+7",
            "trde_wght": "+3.44", "ovr_shrts_qty": "+500", "close_pric": close_pric}


def test_kiwoom_shortsell_close_price_none_on_parse_failure():
    for bad in BAD_VALUES:
        rows = kss.parse_rows([_ss_item(bad)])
        assert rows[0]["close_price"] is None, f"입력 {bad!r} → 0이 아니라 None"


# ── Naver 폴백(같은 컬럼의 세 번째 writer) ──

def test_naver_close_price_none_on_parse_failure():
    """키움만 고치면 같은 market_investor_trend.close_price에 0과 None이 섞인다."""
    for bad in BAD_VALUES:
        row = isvc._map_row({"bizdate": "20260612", "closePrice": bad})
        assert row["close_price"] is None, f"입력 {bad!r} → 0이 아니라 None"


# ── 대조군 ⓐ: 정상 입력은 계속 값을 낸다 (처방이 정상값을 지우지 않았다) ──

def test_normal_close_price_still_parsed():
    flows = _fetch_flows([_flow_row("20260612", "+322500"), _flow_row("20260611", "-300000")])
    assert flows[date(2026, 6, 12)]["close_price"] == 322500
    assert flows[date(2026, 6, 11)]["close_price"] == 300000  # 부호 제거(절대값) 보존

    rows = kss.parse_rows([_ss_item("-71200")])
    assert rows[0]["close_price"] == 71200

    naver = isvc._map_row({"bizdate": "20260612", "closePrice": "329,000"})
    assert naver["close_price"] == 329000


# ── 대조군 ⓑ: 순매수의 0은 여전히 유효값 (처방이 과잉으로 번지지 않았다) ──

def test_net_flow_zero_stays_valid():
    """순매수 0은 '순매수 없음'이라는 사실이다 — None으로 바꾸면 정상 데이터가 사라진다.

    센티널('N/A' 등)→0 폴백도 의도적으로 보존한다(기존 계약, test_kiwoom_investor.py).
    실패와 진짜 0을 구별하는 것은 이 슬라이스 범위 밖이며, 이 단언이 '전부 None으로
    바꾸기'라는 과잉 처방을 막는 이빨이다."""
    flows = _fetch_flows([_flow_row("20260612", "+322500", frgnr="+0")])
    f = flows[date(2026, 6, 12)]
    assert f["foreign_net"] == 0 and f["organ_net"] == 0  # 진짜 0
    assert kinv._signed_int("N/A") == 0 and kinv._signed_int("") == 0  # 센티널 폴백 보존
    assert isvc._parse_signed_int("N/A") == 0

    rows = kss.parse_rows([_ss_item("+71200", qty="0")])
    assert rows[0]["short_volume"] == 0 and rows[0]["short_balance"] == 500


# ── 저장 경로: None이 그대로 흐른다 (0으로 되살리지 않는다) ──

def test_upsert_trend_passes_none_close_price_through():
    """`row.get("close_price") or 0`류 부활을 막는 이빨 축.

    두 store 모두 형제 복제이므로 양쪽을 함께 잰다. 컬럼이 nullable이라 행 스킵도 없다 —
    스킵하면 그 날의 순매수·공매도량(정상값)까지 함께 사라진다."""
    from services import short_sell_service as sss

    inv_rows = [{"base_date": date(2026, 6, 12), "foreign_net": 111, "organ_net": 0,
                 "individual_net": 0, "foreign_hold_ratio": 47.6, "close_price": None}]
    with patch("services.investor_service.execute_many") as m:
        isvc.upsert_trend("005930", inv_rows)
    params = m.call_args[0][1]
    assert len(params) == 1  # 행 스킵 없음
    assert params[0] == ("005930", date(2026, 6, 12), 111, 0, 0, 47.6, None)

    ss_rows = [{"base_date": date(2026, 6, 12), "short_volume": 10, "short_value": 7000,
                "short_ratio": 3.44, "short_balance": 500, "close_price": None}]
    with patch("services.short_sell_service.execute_many") as m:
        sss.upsert_trend("005930", ss_rows)
    params = m.call_args[0][1]
    assert len(params) == 1
    assert params[0] == ("005930", date(2026, 6, 12), 10, 7000, 3.44, 500, None)


# ── 적대 검토 LOW2: 형제 파서에서 OverflowError가 새지 않는다 ──

@pytest.mark.parametrize("tok", ["Infinity", "-Infinity", "inf", "1e400"])
def test_sibling_int_parsers_do_not_leak_overflow_error(tok):
    """`int(float("Infinity"))`는 ValueError가 아니라 **OverflowError**다.

    같은 파일에 `math.isfinite` 초크포인트를 만들면서 형제 파서(`_int`·`_signed_int`)가
    그 옆을 지나갔다 — 루트 CLAUDE.md의 「같은 파일의 다른 쓰기 경로가 그 옆을 지나가지
    않는지 grep할 것」 위반. 키움 ka10014가 `shrts_qty` 등에 그 토큰을 실으면
    `parse_rows`가 통째로 raise하고 broad except가 `[]`를 반환해 **그 종목의 공매도
    이력이 조용히 빈 결과**가 된다(수량 필드의 0 폴백 계약은 유지).
    """
    assert kinv._signed_int(tok) == 0
    assert kss._int(tok) == 0


def test_sibling_int_parsers_normal_control():
    """대조군 — 부호·콤마 처리와 0 폴백 계약이 그대로다."""
    assert kinv._signed_int("+5,414,215") == 5414215
    assert kinv._signed_int("-4,240,844") == -4240844
    assert kinv._signed_int("N/A") == 0
    assert kss._int("+7") == 7 and kss._int("") == 0


# ── 적대 검토 LOW3: 리터럴 0은 유효 시세가 아니다 ──

@pytest.mark.parametrize("zero", ["0", "0.0", "-0", "+0", "0.4"])
def test_literal_zero_close_price_is_none(zero):
    """소스가 결측을 `"0"`으로 채우면 파싱은 성공하지만 **0원 종가는 존재하지 않는다**.

    가드가 겨냥한 증상(「0원 종가가 저장된다」)이 이 입력에서 그대로 남아 있었다 —
    파싱 불가 토큰만 막고 *숫자 0*은 통과시켰기 때문이다. 같은 태스크의 싱크층은
    정반대로 판정했다(`consensus_pipeline.py`의 `tm > 0`: 「0은 유효 목표가가 아니라
    파싱 실패 표식」). 같은 커밋 안에서 0의 운명이 갈리지 않게 맞춘다.
    KR 주가는 1원 미만이 존재하지 않으므로 정상값을 지우지 않는다.
    """
    assert kinv._close_price(zero) is None
    assert kss._close_price(zero) is None
    assert isvc._parse_close_price(zero) is None


def test_smallest_valid_close_price_still_parsed_control():
    """대조군 — 1원은 유효하다(게이트가 `> 0`이고 `>= 1000` 같은 임의 임계가 아니다)."""
    assert kinv._close_price("1") == 1
    assert kss._close_price("-1") == 1
    assert isvc._parse_close_price("1") == 1


# ── 적대 검토 LOW4: 필드 키 부재·개명이 관측된다 ──

def test_all_none_close_price_batch_is_logged_kiwoom_investor(caplog):
    """가장 개연성 높은 실패는 **응답 필드 키 개명**인데 행별 `None` 조기반환이
    로그보다 앞에 있어 전량 None이 무음이었다(KIS `output` vs `output1/2/3` 오독과 같은
    클래스). 배치 단위 1회 집계 로그로 그 클래스를 관측 가능하게 만든다."""
    with caplog.at_level(logging.WARNING, logger="services.kiwoom.investor"):
        flows = _fetch_flows([{"dt": "20260612", "frgnr_invsr": "+1000",
                               "orgn": "+0", "ind_invsr": "-1000"}])  # cur_prc 키 부재
    assert flows[date(2026, 6, 12)]["close_price"] is None
    assert any("close_price 전량 결측" in r.getMessage() for r in caplog.records), \
        [r.getMessage() for r in caplog.records]


def test_all_none_close_price_batch_is_logged_kiwoom_shortsell(caplog):
    with caplog.at_level(logging.WARNING, logger="services.kiwoom.shortsell"):
        rows = kss.parse_rows([{"dt": "20260612", "shrts_qty": "+100",
                                "shrts_trde_prica": "+7", "trde_wght": "+3.44",
                                "ovr_shrts_qty": "+500"}])  # close_pric 키 부재
    assert rows[0]["close_price"] is None
    assert any("close_price 전량 결측" in r.getMessage() for r in caplog.records), \
        [r.getMessage() for r in caplog.records]


def test_partial_none_close_price_batch_logs_nothing_control(caplog):
    """대조군 — 일부만 결측이면 집계 경보를 내지 않는다(경보가 신호를 잃지 않게).

    전량 결측만 「키가 사라졌다」의 신호이고, 일부 결측은 정상적인 데이터 공백이다.
    """
    with caplog.at_level(logging.WARNING, logger="services.kiwoom.investor"):
        flows = _fetch_flows([_flow_row("20260612", "+322500"),
                              _flow_row("20260611", None)])
    assert flows[date(2026, 6, 12)]["close_price"] == 322500
    assert flows[date(2026, 6, 11)]["close_price"] is None
    assert not any("전량 결측" in r.getMessage() for r in caplog.records)

    caplog.clear()
    with caplog.at_level(logging.WARNING, logger="services.kiwoom.shortsell"):
        # ⚠️ 날짜를 달리해야 한다 — parse_rows는 dt 키 dict라 같은 날짜면 뒤 행이 앞 행을
        # 덮어써서 "일부 결측"이 아니라 "전량 결측"이 된다.
        rows = kss.parse_rows([{**_ss_item("+71200"), "dt": "20260612"},
                               {**_ss_item(None), "dt": "20260611"}])
    assert [r["close_price"] for r in rows] == [None, 71200]
    assert not any("전량 결측" in r.getMessage() for r in caplog.records)

"""KIS 국내선물 최근월물/일봉 단위테스트 — 코드공식·롤오버·output1/2/3 봉투 파싱(ADR-0022).

fixture는 라이브 프로브(A01609, 2026-07-07) 응답 모양을 그대로 고정한다."""
from datetime import date, datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo
from services.kis.futures import (
    _code, _candidate_quarter, _next_quarter, _front_month_code,
    get_front_month, fetch_daily,
)

# 라이브 프로브 고정 fixture (FHMIF10000000 inquire-price)
_PRICE_PAYLOAD = {
    "rt_cd": "0", "msg_cd": "MCA00000", "msg1": "정상처리 되었습니다.",
    "output1": {
        "hts_kor_isnm": "F 202609", "futs_prpr": "1247.50",
        "futs_prdy_vrss": "-56.45", "prdy_vrss_sign": "5",
        "futs_prdy_clpr": "1303.95", "futs_prdy_ctrt": "-4.33",
        "basis": "5.41", "mrkt_basis": "21.93", "futs_last_tr_date": "20260910",
    },
    "output2": {"bstp_cls_code": "0001", "hts_kor_isnm": "종합", "bstp_nmix_prpr": "7656.31"},
    "output3": {"bstp_cls_code": "2001", "hts_kor_isnm": "KOSPI200", "bstp_nmix_prpr": "1225.57"},
}

# 라이브 프로브 고정 fixture (FHKIF03020100 inquire-daily-fuopchartprice, 일부)
_DAILY_PAYLOAD = {
    "rt_cd": "0", "msg_cd": "MCA00000", "msg1": "정상처리 되었습니다.",
    "output1": {"hts_kor_isnm": "F 202609", "futs_prpr": "1247.50", "kospi200_nmix": "1225.57"},
    "output2": [
        {"stck_bsop_date": "20260707", "futs_prpr": "1247.50", "futs_oprc": "1273.55",
         "futs_hgpr": "1289.15", "futs_lwpr": "1188.05", "acml_vol": "167553", "mod_yn": "N"},
        {"stck_bsop_date": "20260706", "futs_prpr": "1303.95", "futs_oprc": "1310.00",
         "futs_hgpr": "1315.00", "futs_lwpr": "1300.00", "acml_vol": "90000", "mod_yn": "N"},
    ],
}


def test_code_formula():
    assert _code(2026, 9) == "A01609"
    assert _code(2026, 12) == "A01612"


def test_next_quarter_wraps_year():
    assert _next_quarter(2026, 9) == (2026, 12)
    assert _next_quarter(2026, 12) == (2027, 3)


def test_candidate_quarter_before_expiry_uses_current_month():
    assert _candidate_quarter(date(2026, 9, 5)) == (2026, 9)


def test_candidate_quarter_after_expiry_rolls_to_next():
    assert _candidate_quarter(date(2026, 9, 20)) == (2026, 12)


def test_candidate_quarter_non_quarter_month_picks_next():
    assert _candidate_quarter(date(2026, 7, 7)) == (2026, 9)


def test_front_month_code_matches_probe():
    assert _front_month_code(date(2026, 7, 7)) == "A01609"


def test_get_front_month_parses_output1_no_rollover():
    # 오늘(7/7)이 만기(9/10) 전이라 롤오버 없이 첫 후보 그대로
    with patch("services.kis.futures.client.request", return_value=_PRICE_PAYLOAD) as req:
        with patch("services.kis.futures.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 7, 7, tzinfo=ZoneInfo("Asia/Seoul"))
            info = get_front_month()
    assert info["code"] == "A01609"
    assert info["contract_name"] == "F 202609"
    assert info["price"] == 1247.50
    assert info["change_pct"] == -4.33
    assert info["basis"] == 21.93
    assert info["last_tr_date"] == "20260910"
    assert req.call_count == 1  # 롤오버 미발생 → 1콜


def test_get_front_month_rolls_over_past_expiry():
    # 9/14는 heuristic(day<=15)상 여전히 후보=9월물(A01609)이지만, 실제 만기(9/10)는
    # 이미 지나 futs_last_tr_date 기반 롤오버가 다음 분기(A01612)로 재조회해야 한다.
    def fake(tr_id, path, params, **kw):
        if params["FID_INPUT_ISCD"] == "A01609":
            return _PRICE_PAYLOAD
        return {"output1": {**_PRICE_PAYLOAD["output1"],
                            "hts_kor_isnm": "F 202612", "futs_last_tr_date": "20261210"}}

    with patch("services.kis.futures.client.request", side_effect=fake) as req:
        with patch("services.kis.futures.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 9, 14, tzinfo=ZoneInfo("Asia/Seoul"))
            info = get_front_month()
    assert info["code"] == "A01612"
    assert info["contract_name"] == "F 202612"
    assert req.call_count == 2  # 후보 조회 + 롤오버 재조회


def test_fetch_daily_parses_output2_ascending_abs_price():
    with patch("services.kis.futures.client.request", return_value=_DAILY_PAYLOAD):
        bars = fetch_daily("A01609", days=120)
    # newest-first(output2) → 오름차순으로 뒤집힘
    assert bars == [
        {"date": "2026-07-06", "close": 1303.95},
        {"date": "2026-07-07", "close": 1247.50},
    ]


def test_fetch_daily_trims_to_days():
    bars_payload = {"output2": [
        {"stck_bsop_date": f"202601{d:02d}", "futs_prpr": "1000.00"} for d in range(1, 11)
    ]}
    with patch("services.kis.futures.client.request", return_value=bars_payload):
        bars = fetch_daily("A01609", days=5)
    assert len(bars) == 5
    assert bars[-1]["date"] == "2026-01-01"  # 최신(원본 리스트 첫 항목)이 마지막(오름차순)

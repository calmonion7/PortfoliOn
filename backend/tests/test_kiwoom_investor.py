"""키움 수급 ka10059+ka10008 정규화·병합 단위테스트 (Phase 2 part 3, S1)."""
from datetime import date
from unittest.mock import patch
from services.kiwoom import investor as kinv


def test_signed_int_and_pct():
    assert kinv._signed_int("+2,906,596") == 2906596
    assert kinv._signed_int("-5933301") == -5933301
    assert kinv._signed_int("") == 0 and kinv._signed_int("-") == 0
    assert kinv._pct("+47.63") == 47.63
    assert kinv._pct("") is None


def test_to_date():
    assert kinv._to_date("20260612") == date(2026, 6, 12)
    assert kinv._to_date("bad") is None and kinv._to_date("") is None


def test_fetch_trend_rows_merges_flows_and_ratio_by_date():
    flows_rows = [
        {"dt": "20260612", "frgnr_invsr": "+2906596", "orgn": "+3295009",
         "ind_invsr": "-5933301", "cur_prc": "+322500"},
        {"dt": "20260611", "frgnr_invsr": "-100000", "orgn": "+50000",
         "ind_invsr": "+50000", "cur_prc": "-300000"},
    ]
    ratio_rows = [
        {"dt": "20260612", "wght": "+47.63"},
        # 20260611 보유율은 ka10008이 안 줌 → None 이어야
    ]

    def fake_paged(api_id, body, category, list_key, max_items):
        return flows_rows if api_id == "ka10059" else ratio_rows

    with patch("services.kiwoom.client.request_paged", side_effect=fake_paged):
        rows = kinv.fetch_trend_rows("005930")

    assert [r["base_date"] for r in rows] == [date(2026, 6, 11), date(2026, 6, 12)]  # 오름차순
    latest = rows[-1]
    assert latest["foreign_net"] == 2906596       # 수량(주), 부호 유지
    assert latest["organ_net"] == 3295009
    assert latest["individual_net"] == -5933301
    assert latest["close_price"] == 322500         # 부호 제거(절대값)
    assert latest["foreign_hold_ratio"] == 47.63
    assert rows[0]["foreign_hold_ratio"] is None    # ka10008 미커버 날짜 → None
    assert rows[0]["close_price"] == 300000

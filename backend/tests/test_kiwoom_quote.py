"""키움 ka10001 정규화 단위테스트 — 부호/콤마/억원 환산·빈값 엣지."""
from services.kiwoom.quote import _num, normalize_basic


def test_num_handles_sign_comma_and_empty():
    assert _num("+181400") == 181400.0
    assert _num("-47.41") == -47.41
    assert _num("1,234,500") == 1234500.0
    assert _num("") is None
    assert _num("-") is None
    assert _num("+") is None
    assert _num(None) is None


def test_normalize_basic_rising():
    # 현재가 75,000(상승), 전일대비 +1,500, 등락율 +2.04%, 시총 24,352억
    d = {
        "stk_nm": "삼성전자",
        "cur_prc": "+75000",
        "pred_pre": "+1500",
        "flu_rt": "+2.04",
        "mac": "24352",
    }
    q = normalize_basic(d)
    assert q["price"] == 75000.0
    assert q["daily_change_pct"] == 2.04
    assert q["prev_close"] == 73500          # 75000 - 1500
    assert q["market_cap"] == 24352 * 10**8  # 억원 → 원
    assert q["name"] == "삼성전자"


def test_normalize_basic_falling():
    # 하락: 전일대비 -2,000이면 prev_close는 현재가보다 높아야 한다
    d = {"stk_nm": "테스트", "cur_prc": "-48000", "pred_pre": "-2000", "flu_rt": "-4.00", "mac": "1000"}
    q = normalize_basic(d)
    assert q["price"] == 48000.0             # 부호 제거(절대값)
    assert q["daily_change_pct"] == -4.00
    assert q["prev_close"] == 50000          # 48000 - (-2000)


def test_normalize_basic_missing_fields():
    q = normalize_basic({"stk_nm": "", "cur_prc": "", "flu_rt": "", "pred_pre": "", "mac": ""})
    assert q["price"] is None
    assert q["daily_change_pct"] is None
    assert q["prev_close"] is None
    assert q["market_cap"] is None
    assert q["name"] is None

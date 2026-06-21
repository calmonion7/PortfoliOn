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


# ── 통합(SOR) 코드 변환 (Phase 3 part 2, S2) ──
def test_integrated_code_appends_AL():
    from services.kiwoom import client
    assert client.integrated_code("005930") == "005930_AL"
    assert client.integrated_code("005930_AL") == "005930_AL"   # 이미 접미사 → 그대로
    assert client.integrated_code("005930_NX") == "005930_NX"


# ── regular=True → KRX 정규장 평문 코드 (리포트 스냅샷, .forge/adr/0020, task#95) ──
def test_integrated_code_regular_uses_plain_krx():
    from services.kiwoom import client
    assert client.integrated_code("005930", regular=True) == "005930"   # 평문 KRX
    assert client.integrated_code("005930") == "005930_AL"              # 기본은 NXT _AL
    assert client.integrated_code("005930_AL", regular=True) == "005930_AL"  # 접미사 있으면 불변


def test_get_basic_info_regular_propagates_krx_code():
    """get_basic_info(regular=True)면 ka10001에 평문 KRX 코드, 기본이면 _AL."""
    from unittest.mock import patch
    from services.kiwoom import quote as kq
    with patch("services.kiwoom.client.request", return_value={}) as req:
        kq.get_basic_info("005930", regular=True)
    assert req.call_args.args[1]["stk_cd"] == "005930"
    with patch("services.kiwoom.client.request", return_value={}) as req:
        kq.get_basic_info("005930")
    assert req.call_args.args[1]["stk_cd"] == "005930_AL"


def test_fetch_bars_regular_propagates_krx_code():
    """fetch_bars(regular=True)면 일봉 TR에 평문 KRX 코드, 기본이면 _AL."""
    from unittest.mock import patch
    from services.kiwoom import chart as kc
    with patch("services.kiwoom.client.request_paged", return_value=[]) as req:
        kc.fetch_bars("005930", "daily", regular=True)
    assert req.call_args.args[1]["stk_cd"] == "005930"
    with patch("services.kiwoom.client.request_paged", return_value=[]) as req:
        kc.fetch_bars("005930", "daily")
    assert req.call_args.args[1]["stk_cd"] == "005930_AL"

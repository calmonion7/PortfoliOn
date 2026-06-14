"""KIS 국내 현재가(FHKST01010100) 정규화 단위테스트 — 부호/억원 환산·빈값 엣지."""
from services.kis.quote import _num, normalize_kr_basic


def test_num_handles_sign_comma_and_empty():
    assert _num("181400") == 181400.0
    assert _num("-47.41") == -47.41
    assert _num("1,234,500") == 1234500.0
    assert _num("") is None
    assert _num("-") is None
    assert _num(None) is None


def test_normalize_kr_basic_rising():
    # 현재가 75,000(상승), 기준가(전일종가) 73,500, 등락율 +2.04%, 시총 24,352억
    out = {
        "stck_prpr": "75000",
        "prdy_ctrt": "2.04",
        "stck_sdpr": "73500",
        "hts_avls": "24352",
    }
    q = normalize_kr_basic(out)
    assert q["price"] == 75000.0
    assert q["daily_change_pct"] == 2.04
    assert q["prev_close"] == 73500
    assert q["market_cap"] == 24352 * 10**8   # 억원 → 원
    assert q["name"] is None                   # 이 TR엔 종목명 없음(폴백 단계라 resolve_name이 처리)


def test_normalize_kr_basic_falling():
    # 하락: prdy_ctrt가 음수 부호를 그대로 가진다, 기준가 > 현재가
    out = {"stck_prpr": "48000", "prdy_ctrt": "-4.00", "stck_sdpr": "50000", "hts_avls": "1000"}
    q = normalize_kr_basic(out)
    assert q["price"] == 48000.0
    assert q["daily_change_pct"] == -4.00
    assert q["prev_close"] == 50000
    assert q["market_cap"] == 1000 * 10**8


def test_normalize_kr_basic_missing_fields():
    q = normalize_kr_basic({"stck_prpr": "", "prdy_ctrt": "", "stck_sdpr": "", "hts_avls": ""})
    assert q["price"] is None
    assert q["daily_change_pct"] is None
    assert q["prev_close"] is None
    assert q["market_cap"] is None
    assert q["name"] is None

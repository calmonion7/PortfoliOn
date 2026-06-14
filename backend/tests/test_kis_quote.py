"""KIS 현재가 정규화 단위테스트 — 국내(FHKST01010100) 부호/억원, 해외(price/dailyprice) probe·부호·커버리지."""
from unittest.mock import patch
from services.kis.quote import (
    _num, normalize_kr_basic,
    _apply_sign, _excd_candidates, _normalize_us_price, _normalize_us_daily,
    get_quote_us,
)


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


# ── 해외(미국) 현재가 ──
def test_apply_sign_uses_kis_sign_code():
    assert _apply_sign("1.23", "2") == 1.23    # 2 상승
    assert _apply_sign("1.23", "5") == -1.23   # 5 하락 → 부호 재부여
    assert _apply_sign("-1.23", "5") == -1.23  # 이미 음수여도 일관
    assert _apply_sign("0", "3") == 0.0        # 3 보합
    assert _apply_sign("1.23", "") == 1.23     # 부호 미상 → 파싱값
    assert _apply_sign("", "2") is None


def test_excd_candidates_hint_first_else_default():
    assert _excd_candidates("NASDAQ") == ("NAS", "NYS", "AMS")
    assert _excd_candidates("NYSE") == ("NYS", "NAS", "AMS")
    assert _excd_candidates("") == ("NAS", "NYS", "AMS")        # 힌트 없음 → 기본 순서
    assert _excd_candidates("UNKNOWN") == ("NAS", "NYS", "AMS")


def test_normalize_us_price():
    out = {"last": "267.74", "base": "265.00", "rate": "1.03", "sign": "2", "zdiv": "4"}
    q = _normalize_us_price(out)
    assert q["price"] == 267.74          # last 그대로(zdiv 미적용 — 공식 예제 동일)
    assert q["prev_close"] == 265.00
    assert q["daily_change_pct"] == 1.03


def test_normalize_us_daily_uses_latest_and_prev():
    bars = [
        {"xymd": "20260612", "clos": "150.00", "rate": "2.00", "sign": "2"},  # 최근(newest-first)
        {"xymd": "20260611", "clos": "147.06", "rate": "-0.5", "sign": "5"},  # 전일
    ]
    q = _normalize_us_daily(bars)
    assert q["price"] == 150.00
    assert q["prev_close"] == 147.06
    assert q["daily_change_pct"] == 2.00


def test_normalize_us_daily_empty():
    q = _normalize_us_daily([])
    assert q == {"price": None, "prev_close": None, "daily_change_pct": None}


def _ok(payload):
    return lambda tr_id, path, params, **kw: payload


def test_get_quote_us_price_hit_first_excd():
    # NAS에서 바로 last 반환 → dailyprice 미호출
    payload = {"output": {"last": "200.00", "base": "198.00", "rate": "1.01", "sign": "2"}}
    with patch("services.kis.quote.client.request", side_effect=_ok(payload)) as req:
        q = get_quote_us("AAPL", "NASDAQ")
    assert q["price"] == 200.00
    assert q["daily_change_pct"] == 1.01
    # 첫 호출이 price TR·NAS여야 한다
    args = req.call_args_list[0]
    assert args.args[0] == "HHDFS00000300"
    assert args.args[2]["EXCD"] == "NAS"


def test_get_quote_us_probes_to_next_excd():
    # NAS는 빈 last, NYS에서 적중
    def fake(tr_id, path, params, **kw):
        if tr_id == "HHDFS00000300" and params["EXCD"] == "NYS":
            return {"output": {"last": "55.50", "base": "55.00", "rate": "0.91", "sign": "2"}}
        return {"output": {"last": ""}}      # NAS·AMS 빈값
    with patch("services.kis.quote.client.request", side_effect=fake):
        q = get_quote_us("XYZ", "")          # 힌트 없음 → NAS→NYS
    assert q["price"] == 55.50


def test_get_quote_us_falls_back_to_dailyprice():
    # price는 전 EXCD 빈값(커버리지 밖) → dailyprice 종가 폴백
    def fake(tr_id, path, params, **kw):
        if tr_id == "HHDFS00000300":
            return {"output": {"last": ""}}
        # dailyprice
        return {"output2": [{"clos": "12.34", "rate": "1.5", "sign": "2"},
                            {"clos": "12.16"}]}
    with patch("services.kis.quote.client.request", side_effect=fake):
        q = get_quote_us("SMALLCAP", "NASDAQ")
    assert q["price"] == 12.34
    assert q["prev_close"] == 12.16
    assert q["daily_change_pct"] == 1.5


def test_get_quote_us_all_miss_returns_none_price():
    with patch("services.kis.quote.client.request",
               side_effect=_ok({"output": {"last": ""}, "output2": []})):
        q = get_quote_us("NOPE", "")
    assert q["price"] is None

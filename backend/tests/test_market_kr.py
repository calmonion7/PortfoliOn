"""get_quote_kr 키움 우선 + Naver 폴백 동작 (S3)."""
from unittest.mock import patch, MagicMock
import pandas as pd


def _patch_yf():
    # yfinance 보강 블록이 네트워크를 타지 않게 빈 히스토리로 mock
    m = MagicMock()
    m.history.return_value = pd.DataFrame({"Close": []})
    m.info = {}
    return patch("services.market.yf.Ticker", return_value=m)


def test_get_quote_kr_uses_kiwoom_when_available():
    kiwoom_norm = {"price": 75000.0, "daily_change_pct": 2.04, "prev_close": 73500,
                   "market_cap": 24352 * 10**8, "name": "삼성전자"}
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.quote.get_quote", return_value=kiwoom_norm):
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 75000.0
    assert q["daily_change_pct"] == 2.04
    assert q["name"] == "삼성전자"
    assert q["market"] == "KR"


def test_get_quote_kr_falls_back_to_naver_when_kiwoom_unconfigured():
    naver_basic = {"closePrice": "60000", "compareToPreviousClosePrice": "1000",
                   "fluctuationsRatio": "1.69", "marketValue": "100000", "stockName": "폴백종목"}
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=False), \
         patch("services.market.kr._naver_get", return_value=naver_basic):
        from services import market
        q = market.get_quote_kr("000660")
    assert q["price"] == 60000.0
    assert q["name"] == "폴백종목"
    assert q["daily_change_pct"] == 1.69


def test_get_quote_kr_falls_back_when_kiwoom_raises():
    naver_basic = {"closePrice": "50000", "compareToPreviousClosePrice": "-500",
                   "fluctuationsRatio": "-0.99", "marketValue": "80000", "stockName": "에러폴백"}
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.quote.get_quote", side_effect=RuntimeError("키움 장애")), \
         patch("services.kis.client.configured", return_value=False), \
         patch("services.market.kr._naver_get", return_value=naver_basic):
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 50000.0          # 키움 예외 + KIS 미설정 → Naver 폴백
    assert q["name"] == "에러폴백"


# ── KIS 백업 폴백: 키움 → KIS → Naver (.forge/adr/0011) ──
def test_get_quote_kr_uses_kis_when_kiwoom_fails():
    # 키움 실패(None) → KIS 백업이 응답 → Naver 미호출
    kis_norm = {"price": 64000.0, "daily_change_pct": -1.23, "prev_close": 64800,
                "market_cap": 12000 * 10**8, "name": None}
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.quote.get_quote", side_effect=RuntimeError("키움 장애")), \
         patch("services.kis.client.configured", return_value=True), \
         patch("services.kis.quote.get_quote_kr", return_value=kis_norm) as kis_call, \
         patch("services.market.kr._naver_get") as naver_call:
        from services import market
        q = market.get_quote_kr("000660")
    assert q["price"] == 64000.0
    assert q["daily_change_pct"] == -1.23
    assert q["name"] == "000660"          # KIS엔 종목명 없음 → 티커 유지(resolve_name이 후처리)
    kis_call.assert_called_once()
    naver_call.assert_not_called()        # KIS가 답했으므로 Naver 미호출


def test_get_quote_kr_skips_kis_when_kiwoom_ok():
    # 키움 성공 → KIS/Naver 둘 다 미호출
    kiwoom_norm = {"price": 75000.0, "daily_change_pct": 2.04, "prev_close": 73500,
                   "market_cap": 24352 * 10**8, "name": "삼성전자"}
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.quote.get_quote", return_value=kiwoom_norm), \
         patch("services.kis.quote.get_quote_kr") as kis_call, \
         patch("services.market.kr._naver_get") as naver_call:
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 75000.0
    kis_call.assert_not_called()
    naver_call.assert_not_called()


def test_get_quote_kr_kis_to_naver_when_kis_also_fails():
    # 키움 실패 + KIS 실패 → Naver 폴백
    naver_basic = {"closePrice": "30000", "compareToPreviousClosePrice": "300",
                   "fluctuationsRatio": "1.01", "marketValue": "5000", "stockName": "최종폴백"}
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.quote.get_quote", side_effect=RuntimeError("키움 장애")), \
         patch("services.kis.client.configured", return_value=True), \
         patch("services.kis.quote.get_quote_kr", side_effect=RuntimeError("KIS 장애")), \
         patch("services.market.kr._naver_get", return_value=naver_basic):
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 30000.0
    assert q["name"] == "최종폴백"


# ── 발산 가드: 시세가 일봉 종가와 2배 넘게 어긋나면 그 소스 폐기 (task#93) ──
def test_guard_discards_diverging_source_and_falls_back():
    # 키움 NXT가 일봉(354k)의 ~1/5인 70k 반환 → 폐기, Naver(354k)로 폴백.
    # KRX(regular=True)는 글리치 시에도 깨끗(354k)이라 교차검증이 Naver를 폐기하지 않는다.
    kiwoom_norm = {"price": 70000.0, "daily_change_pct": -2.0, "prev_close": 71000,
                   "market_cap": 4000 * 10**8, "name": "삼성전자"}
    krx_norm = {"price": 354000.0, "daily_change_pct": -2.34, "prev_close": 362500,
                "market_cap": 2000000 * 10**8, "name": "삼성전자"}
    naver_basic = {"closePrice": "354000", "compareToPreviousClosePrice": "-8500",
                   "fluctuationsRatio": "-2.34", "marketValue": "2000000", "stockName": "삼성전자"}
    def kq_side(ticker, regular=False):
        return krx_norm if regular else kiwoom_norm
    with _patch_yf(), \
         patch("services.market.kr._kr_closes_kiwoom", return_value=[350000.0, 352000.0, 354000.0]), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.quote.get_quote", side_effect=kq_side), \
         patch("services.kis.client.configured", return_value=False), \
         patch("services.market.kr._naver_get", return_value=naver_basic):
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 354000.0          # 70k 폐기 → Naver 354k
    assert q["daily_change_pct"] == -2.34


def test_guard_allows_price_within_range_and_short_circuits():
    # 키움 355k, 일봉 354k → 정상 범위 → 키움 채택, KIS/Naver 미호출(short-circuit 유지)
    kiwoom_norm = {"price": 355000.0, "daily_change_pct": 0.28, "prev_close": 354000,
                   "market_cap": 2000000 * 10**8, "name": "삼성전자"}
    with _patch_yf(), \
         patch("services.market.kr._kr_closes_kiwoom", return_value=[350000.0, 354000.0]), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.quote.get_quote", return_value=kiwoom_norm), \
         patch("services.kis.quote.get_quote_kr") as kis_call, \
         patch("services.market.kr._naver_get") as naver_call:
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 355000.0
    kis_call.assert_not_called()
    naver_call.assert_not_called()


def test_guard_disabled_without_chart_reference():
    # 일봉 참조 없음(키움 차트 실패) → 가드 생략, 키움 값 그대로(기존 동작 보존)
    kiwoom_norm = {"price": 70000.0, "daily_change_pct": -2.0, "prev_close": 71000,
                   "market_cap": 4000 * 10**8, "name": "삼성전자"}
    with _patch_yf(), \
         patch("services.market.kr._kr_closes_kiwoom", return_value=[]), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.quote.get_quote", return_value=kiwoom_norm), \
         patch("services.kis.quote.get_quote_kr") as kis_call, \
         patch("services.market.kr._naver_get") as naver_call:
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 70000.0           # 참조 없으면 검증 불가 → 폐기 안 함
    kis_call.assert_not_called()
    naver_call.assert_not_called()


# ── 전일종가 ±30% 가드 (KR 일일 가격제한폭, task#94) ──
def test_guard_30pct_catches_what_2x_misses():
    # 현재가 200000: 일봉 354000의 [0.5,2.0]엔 들지만(0.565) 전일종가 362500의 ±30% 밖(0.55) → 폐기
    kiwoom_norm = {"price": 200000.0, "daily_change_pct": -44.8, "prev_close": 362500,
                   "market_cap": 1200000 * 10**8, "name": "삼성전자"}
    naver_basic = {"closePrice": "354000", "compareToPreviousClosePrice": "-8500",
                   "fluctuationsRatio": "-2.34", "marketValue": "2000000", "stockName": "삼성전자"}
    with _patch_yf(), \
         patch("services.market.kr._kr_closes_kiwoom", return_value=[350000.0, 354000.0]), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.quote.get_quote", return_value=kiwoom_norm), \
         patch("services.kis.client.configured", return_value=False), \
         patch("services.market.kr._naver_get", return_value=naver_basic):
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 354000.0          # 전일종가 ±30% 밖 → Naver로 폴백


def test_guard_keeps_legal_limit_down_move():
    # 하한가(-30%): 254000 ≈ 362500*0.70 → ±30% 경계 내 → 정상 유지(합법 변동 false-reject 방지)
    kiwoom_norm = {"price": 254000.0, "daily_change_pct": -29.93, "prev_close": 362500,
                   "market_cap": 1500000 * 10**8, "name": "삼성전자"}
    with _patch_yf(), \
         patch("services.market.kr._kr_closes_kiwoom", return_value=[360000.0, 362500.0]), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.quote.get_quote", return_value=kiwoom_norm), \
         patch("services.kis.quote.get_quote_kr") as kis_call, \
         patch("services.market.kr._naver_get") as naver_call:
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 254000.0          # 합법 하한가는 폐기 금지
    kis_call.assert_not_called()
    naver_call.assert_not_called()


# ── regular=True → 키움 KRX 정규장 전파 (리포트 스냅샷, .forge/adr/0020, task#95) ──
def test_get_quote_kr_regular_propagates_to_kiwoom():
    # 리포트 경로(regular=True): 키움 시세·일봉 둘 다 KRX 정규장 코드로 호출돼야 한다
    kiwoom_basic = (355000.0, 0.28, 354000, 2000000 * 10**8, "삼성전자")
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.market.kr._kr_basic_kiwoom", return_value=kiwoom_basic) as kb, \
         patch("services.market.kr._kr_closes_kiwoom", return_value=[350000.0, 354000.0]) as kc:
        from services import market
        q = market.get_quote_kr("005930", regular=True)
    assert q["price"] == 355000.0                       # 키움 KRX 값 채택
    assert kb.call_args.kwargs.get("regular") is True   # _kr_pick_basic이 키움에 regular 전파
    assert kc.call_args.kwargs.get("regular") is True   # 시세검증 일봉 참조도 정규장


def test_get_quote_kr_default_keeps_nxt():
    # 기본(대시보드/라이브): regular 미지정 → 키움 NXT(regular=False) 유지(무변화)
    kiwoom_basic = (350500.0, 0.10, 350000, 2000000 * 10**8, "삼성전자")
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.market.kr._kr_basic_kiwoom", return_value=kiwoom_basic) as kb, \
         patch("services.market.kr._kr_closes_kiwoom", return_value=[349000.0, 350500.0]) as kc:
        from services import market
        market.get_quote_kr("005930")
    assert kb.call_args.kwargs.get("regular") is False
    assert kc.call_args.kwargs.get("regular") is False


# ── 독립 KRX 교차검증: 자기일관적 _AL 전체오염 차단 (.forge/adr/0020, task#96) ──
def test_price_sane_krx_crosscheck():
    from services.market.kr import _price_sane
    # 자기일관 NXT 글리치: price 70k·prev 71k(①통과)·NXT일봉 70k(②통과) → KRX 354k(③)가 잡음
    assert _price_sane(70000, 71000, 70000, krx_close=354000) is False
    # KRX 참조 없으면 ③ 생략 → ①②만, 자기일관이라 통과(블라인드 — 기존 동작)
    assert _price_sane(70000, 71000, 70000, krx_close=None) is True
    # 정상: NXT 350.5k vs KRX 354k → ③ 통과(정상 ~1% 괴리는 false-reject 안 함)
    assert _price_sane(350500, 350000, 350500, krx_close=354000) is True


def test_guard_krx_crosscheck_catches_self_consistent_al_glitch():
    # _AL 전체오염: NXT quote·prev·일봉(ref) 모두 70k → ①② 블라인드. KRX 354k가 ③로 잡고,
    # KIS 미설정·Naver는 글리치 ref(70k) 대비 ②로 폐기 → 깨끗한 KRX 참조를 반환.
    def kiwoom_side(ticker, regular=False):
        if regular:
            return (354000.0, -2.34, 362500, 2000000 * 10**8, "삼성전자")        # KRX 깨끗
        return (70000.0, -2.0, 71000, 4000 * 10**8, "삼성전자_NXT글리치")          # NXT 자기일관 글리치
    naver_basic = {"closePrice": "354000", "compareToPreviousClosePrice": "-8500",
                   "fluctuationsRatio": "-2.34", "marketValue": "2000000", "stockName": "삼성전자_네이버"}
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.market.kr._kr_basic_kiwoom", side_effect=kiwoom_side), \
         patch("services.market.kr._kr_closes_kiwoom", return_value=[70000.0, 70000.0]), \
         patch("services.kis.client.configured", return_value=False), \
         patch("services.market.kr._naver_get", return_value=naver_basic):
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 354000.0      # NXT 70k 폐기 → 깨끗한 KRX 참조
    assert q["name"] == "삼성전자"      # krx_ref 반환(네이버/NXT 글리치 아님)


def test_get_quote_kr_regular_skips_krx_crosscheck():
    # regular=True(리포트): 이미 KRX라 교차검증·추가 KRX 콜 스킵 → _kr_basic_kiwoom 1콜만
    kiwoom_basic = (354000.0, -2.34, 362500, 2000000 * 10**8, "삼성전자")
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.market.kr._kr_basic_kiwoom", return_value=kiwoom_basic) as kb, \
         patch("services.market.kr._kr_closes_kiwoom", return_value=[353000.0, 354000.0]):
        from services import market
        q = market.get_quote_kr("005930", regular=True)
    assert q["price"] == 354000.0
    assert kb.call_count == 1                          # krx_ref 추가 콜 없음
    assert kb.call_args.kwargs.get("regular") is True


def test_get_quote_kr_default_fetches_krx_ref():
    # regular=False: 독립 KRX 참조(regular=True) + NXT 소스(regular=False) = 2콜
    kiwoom_basic = (350500.0, 0.10, 350000, 2000000 * 10**8, "삼성전자")
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.market.kr._kr_basic_kiwoom", return_value=kiwoom_basic) as kb, \
         patch("services.market.kr._kr_closes_kiwoom", return_value=[349000.0, 350500.0]):
        from services import market
        market.get_quote_kr("005930")
    assert kb.call_count == 2
    regulars = [c.kwargs.get("regular") for c in kb.call_args_list]
    assert regulars == [True, False]   # krx_ref(regular=True) 먼저, 그 다음 NXT 소스

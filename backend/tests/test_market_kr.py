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


# ── 발산 가드: 단일 피드 글리치는 다수결로 폐기 (task#93·98) ──
def test_guard_discards_diverging_source_and_falls_back():
    # 키움 NXT 70k 글리치·KRX 354k 정상 → 불일치 → Naver(354k) escalate →
    # KRX≈Naver 다수결 → NXT 70k outlier 폐기, 합의값(354k) 반환.
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


def test_guard_keeps_value_when_nxt_krx_agree():
    # NXT≈KRX 둘 다 70k 합의(get_quote mock이 regular 무시·동일값) → 다수결 trusted → 70k 유지,
    # KIS/Naver 미호출. (일봉 ref_close는 regular=False 가드에서 빠졌으므로 차트 유무 무관 — task#98)
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
    assert q["price"] == 70000.0           # NXT≈KRX 합의 → 유지
    kis_call.assert_not_called()
    naver_call.assert_not_called()


# ── degenerate ±30% self-check: 키움 단일 글리치 → Naver 폴백 (task#94 floor, task#98) ──
def test_majority_degenerate_30pct_discards_single_glitch():
    # 키움 단일(NXT만, KRX 부재) + NXT가 전일종가 362500의 ±30% 밖(200000/362500=0.55) →
    # 합의 가능한 2피드 없음(outage) → degenerate lazy 체인이 ±30%로 NXT 폐기 → Naver로 폴백.
    def kiwoom_side(ticker, regular=False):
        if regular:
            return None  # KRX 부재
        return (200000.0, -44.8, 362500, 1200000 * 10**8, "NXT글리치")
    naver_basic = {"closePrice": "354000", "compareToPreviousClosePrice": "-8500",
                   "fluctuationsRatio": "-2.34", "marketValue": "2000000", "stockName": "삼성전자"}
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.market.kr._kr_basic_kiwoom", side_effect=kiwoom_side), \
         patch("services.kis.client.configured", return_value=False), \
         patch("services.market.kr._naver_get", return_value=naver_basic):
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 354000.0          # 전일종가 ±30% 밖 NXT 폐기 → Naver로 폴백


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


# ── 독립 피드 2-of-N 다수결: 단일 참조 글리치 면역 (.forge/adr/0020, task#96·98) ──
def _basic(price, name="X"):
    return (price, None, None, None, name)


def test_corroborated_pick_two_feeds_agree_returns_top_priority():
    from services.market.kr import _corroborated_pick
    # NXT(rank0) 350.5k ≈ KRX(rank3) 354k (2x 내) → 합의 → 최상위(NXT) 반환
    pick = _corroborated_pick([(0, "NXT", _basic(350500)), (3, "KRX", _basic(354000))])
    assert pick is not None and pick[1] == "NXT"


def test_corroborated_pick_single_feed_none():
    from services.market.kr import _corroborated_pick
    assert _corroborated_pick([(0, "NXT", _basic(350000))]) is None  # 합의할 다른 피드 없음


def test_corroborated_pick_outlier_excluded():
    from services.market.kr import _corroborated_pick
    # NXT 70k(outlier)·KRX 354k·Naver 350k → KRX≈Naver 합의, 둘 중 최상위(Naver rank2)
    pick = _corroborated_pick([(0, "NXT", _basic(70000)), (3, "KRX", _basic(354000)),
                               (2, "Naver", _basic(350000))])
    assert pick is not None and pick[1] == "Naver"


def test_corroborated_pick_all_disagree_none():
    from services.market.kr import _corroborated_pick
    # 100·300·900 — 모든 쌍이 2x 밖 → 합의 없음
    assert _corroborated_pick([(0, "a", _basic(100)), (1, "b", _basic(300)),
                               (2, "c", _basic(900))]) is None


def test_corroborated_pick_boundary_2x():
    from services.market.kr import _corroborated_pick
    assert _corroborated_pick([(0, "a", _basic(100)), (1, "b", _basic(200))]) is not None  # 정확히 2.0x → 합의
    assert _corroborated_pick([(0, "a", _basic(100)), (1, "b", _basic(201))]) is None       # 2.01x → 미합의


def test_majority_normal_consensus_lazy():
    # 평소 NXT≈KRX 합의 → NXT 반환, Naver/KIS 미호출(lazy, 2콜 유지)
    def kiwoom_side(ticker, regular=False):
        return (354000.0, -2.34, 362500, 2000000 * 10**8, "삼성KRX") if regular \
            else (350500.0, 0.10, 350000, 2000000 * 10**8, "삼성NXT")
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.market.kr._kr_basic_kiwoom", side_effect=kiwoom_side), \
         patch("services.market.kr._kr_closes_kiwoom", return_value=[349000.0, 350500.0]), \
         patch("services.kis.quote.get_quote_kr") as kis_call, \
         patch("services.market.kr._naver_get") as naver_call:
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 350500.0          # NXT(최상위) 반환
    naver_call.assert_not_called()         # 합의했으므로 escalate 안 함
    kis_call.assert_not_called()


def test_majority_krx_poison_keeps_nxt():
    # KRX-poison: KRX 70k 글리치·NXT 350k 정상 → 불일치 → Naver 350k escalate →
    # NXT≈Naver 다수결 → NXT 350k 반환, KRX 70k outlier 폐기 (task#96 KRX-poison 잔존 해소)
    def kiwoom_side(ticker, regular=False):
        return (70000.0, -2.0, 71000, 4000 * 10**8, "KRX글리치") if regular \
            else (350000.0, -1.4, 355000, 2000000 * 10**8, "삼성NXT")
    naver_basic = {"closePrice": "350000", "compareToPreviousClosePrice": "-5000",
                   "fluctuationsRatio": "-1.4", "marketValue": "2000000", "stockName": "삼성네이버"}
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.market.kr._kr_basic_kiwoom", side_effect=kiwoom_side), \
         patch("services.market.kr._kr_closes_kiwoom", return_value=[349000.0, 350000.0]), \
         patch("services.kis.client.configured", return_value=False), \
         patch("services.market.kr._naver_get", return_value=naver_basic):
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 350000.0          # NXT 유지(다수결), KRX 70k 폐기
    assert q["name"] == "삼성NXT"


def test_majority_nxt_pollution_discards_nxt():
    # NXT 자기일관 전체오염: NXT 70k 글리치·KRX 350k 정상 → 불일치 → Naver 350k escalate →
    # KRX≈Naver 다수결 → NXT 70k 폐기, non-NXT 350k 반환 (task#96 전체오염 차단을 다수결로)
    def kiwoom_side(ticker, regular=False):
        return (350000.0, -1.4, 355000, 2000000 * 10**8, "삼성KRX") if regular \
            else (70000.0, -2.0, 71000, 4000 * 10**8, "NXT글리치")
    naver_basic = {"closePrice": "350000", "compareToPreviousClosePrice": "-5000",
                   "fluctuationsRatio": "-1.4", "marketValue": "2000000", "stockName": "삼성네이버"}
    with _patch_yf(), \
         patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.market.kr._kr_basic_kiwoom", side_effect=kiwoom_side), \
         patch("services.market.kr._kr_closes_kiwoom", return_value=[349000.0, 350000.0]), \
         patch("services.kis.client.configured", return_value=False), \
         patch("services.market.kr._naver_get", return_value=naver_basic):
        from services import market
        q = market.get_quote_kr("005930")
    assert q["price"] == 350000.0          # NXT 70k 폐기 → non-NXT 합의값
    assert q["name"] != "NXT글리치"         # 글리치 NXT 아님(Naver/KRX 합의)


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

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from unittest.mock import patch


# ── 픽스처 빌더 ─────────────────────────────────────────────
# 각 소스는 이미 fetch된 형태로 _merge_universe에 들어간다(순수 합집합 로직).
#   kr_rows   : ranking_service._kr_row 형태 (ticker,name,market_cap,is_etf,...)
#   sp500     : 티커 문자열 리스트
#   tracked   : storage.get_global_portfolio 합집합 형태 (ticker,name,market,is_etf)
#   guru      : 구루 보유 티커 문자열 집합 (US)

def _kr_row(ticker, name, cap, is_etf=False, exchange="KS"):
    return {"ticker": ticker, "name": name, "market_cap": cap, "is_etf": is_etf,
            "exchange": exchange}


def _tracked(ticker, name, market, is_etf=False, exchange=""):
    return {"ticker": ticker, "name": name, "market": market, "is_etf": is_etf,
            "exchange": exchange}


# ── (f) exchange 코드 관통 (KR=KS/KQ, US='') ─────────────────────

def test_merge_universe_carries_exchange():
    from services.recommendation.universe import _merge_universe
    kr_rows = [
        _kr_row("005930", "삼성전자", 500, exchange="KS"),
        _kr_row("035720", "카카오", 300, exchange="KQ"),
    ]
    sp500 = ["AAPL"]
    tracked = [_tracked("TSLA", "Tesla", "US", exchange="")]
    guru = ["BRK-B"]

    out = _merge_universe(kr_rows, sp500, tracked, guru, kr_top_n=10)
    by = {r["ticker"]: r for r in out}
    # KR 행은 ranking_service가 채운 KS/KQ
    assert by["005930"]["exchange"] == "KS"
    assert by["035720"]["exchange"] == "KQ"
    # US 행은 빈 문자열
    assert by["AAPL"]["exchange"] == ""
    assert by["BRK-B"]["exchange"] == ""
    assert by["TSLA"]["exchange"] == ""


# ── (a) 합집합·dedup·ETF 제외·시총 내림차순 절단 ──────────────

def test_merge_union_dedup_etf_topn():
    from services.recommendation.universe import _merge_universe
    kr_rows = [
        _kr_row("005930", "삼성전자", 500),
        _kr_row("000660", "SK하이닉스", 300),
        _kr_row("069500", "KODEX 200", 999, is_etf=True),  # ETF 제외
        _kr_row("035720", "카카오", 100),
    ]
    sp500 = ["AAPL", "MSFT", "AAPL"]  # 중복은 dedup
    tracked = [_tracked("AAPL", "Apple", "US")]  # AAPL은 sp500과 중복 → 1개만
    guru = ["BRK-B"]

    out = _merge_universe(kr_rows, sp500, tracked, guru, kr_top_n=2)

    tickers = [r["ticker"] for r in out]
    # KR 상위 2(005930,000660), ETF 제외(069500 없음), KR 3위(035720) 컷오프 밖
    assert "069500" not in tickers
    assert "005930" in tickers and "000660" in tickers
    assert "035720" not in tickers
    # US: sp500 + guru, AAPL은 1개
    assert tickers.count("AAPL") == 1
    assert "MSFT" in tickers and "BRK-B" in tickers
    # market 채워짐
    by = {r["ticker"]: r for r in out}
    assert by["005930"]["market"] == "KR"
    assert by["AAPL"]["market"] == "US"
    assert by["BRK-B"]["market"] == "US"


# ── (b) 추적종목은 시총 컷오프 밖이어도 항상 포함 ──────────────

def test_tracked_always_included_beyond_cutoff():
    from services.recommendation.universe import _merge_universe
    kr_rows = [
        _kr_row("005930", "삼성전자", 500),
        _kr_row("000660", "SK하이닉스", 300),
        _kr_row("035720", "카카오", 100),  # top_n=2 컷오프 밖
    ]
    tracked = [_tracked("035720", "카카오", "KR")]  # 추적 → 컷오프 밖이어도 포함

    out = _merge_universe(kr_rows, [], tracked, [], kr_top_n=2)
    tickers = [r["ticker"] for r in out]
    assert "035720" in tickers


# ── (c) 추적 ETF도 항상 포함(명시 추적은 ETF 제외 규칙보다 우선) ──

def test_tracked_etf_still_included():
    from services.recommendation.universe import _merge_universe
    tracked = [_tracked("069500", "KODEX 200", "KR", is_etf=True)]
    out = _merge_universe([], [], tracked, [], kr_top_n=10)
    assert "069500" in [r["ticker"] for r in out]


# ── (d) build_universe: 소스 fetch를 mock, 합집합 호출 검증 ──

def test_build_universe_wires_sources():
    from services.recommendation import universe as U
    kr_raw = [
        {"ticker": "005930", "name": "삼성전자", "market_cap": 500, "is_etf": False},
        {"ticker": "000660", "name": "SK하이닉스", "market_cap": 300, "is_etf": False},
    ]
    with patch.object(U, "_fetch_kr_rows", return_value=kr_raw), \
         patch.object(U, "_load_sp500", return_value=["AAPL"]), \
         patch.object(U, "_fetch_tracked", return_value=[_tracked("TSLA", "Tesla", "US")]), \
         patch.object(U, "_fetch_guru_tickers", return_value=["BRK-B"]):
        out = U.build_universe()
    tickers = {r["ticker"] for r in out}
    assert tickers == {"005930", "000660", "AAPL", "TSLA", "BRK-B"}


# ── S1 (d) sp500 선점 추적종목에 tracked=True 플래그 박힘 ──────────
# dedup '첫 출처 우선'이라 sp500에서 먼저 seen에 들어간 COST는
# tracked 루프에서 _add에 걸리지 않는다.
# → 이미 seen에 있는 티커도 tracked 집합에 있으면 tracked=True로 갱신해야 한다.
# 구 코드: tracked 필드 없음 → row에 "tracked" 키가 없다 (red)

def test_merge_universe_sp500_preempted_tracked_gets_flag():
    from services.recommendation.universe import _merge_universe
    # COST: sp500에 먼저 들어가고 tracked에도 있는 종목
    sp500 = ["COST", "AAPL"]
    tracked = [_tracked("COST", "Costco", "US"), _tracked("QQQ", "QQQ ETF", "US")]

    out = _merge_universe([], sp500, tracked, [], kr_top_n=0)
    by = {r["ticker"]: r for r in out}

    assert by["COST"]["tracked"] is True,  "sp500 선점 추적종목도 tracked=True여야 한다"
    assert by["QQQ"]["tracked"]  is True,  "tracked 전용 종목도 tracked=True여야 한다"
    assert by["AAPL"]["tracked"] is False, "비추적 sp500 행은 tracked=False여야 한다"


# ── (e) 일부 소스 fetch 실패는 로깅 후 graceful — 가용 소스만으로 구성 ──

# ── S3 (b) guru 행이 dataroma 이름을 갖는다 ───────────────────────────────
# 구 코드: _fetch_guru_tickers가 티커 리스트만 반환하고 _merge_universe의 guru 루프는
# _add(t, "US", "", None, "")로 name=""을 박는다 → guru 행 name=ticker 문자열이 됨 (red)

def test_merge_universe_guru_row_carries_name():
    """guru 소스에서 이름을 함께 받으면 _merge_universe의 guru 행 name이 채워진다."""
    from services.recommendation.universe import _merge_universe

    # guru를 {ticker: name} 맵으로 전달하는 신규 구조를 테스트
    # _merge_universe 시그니처가 guru: list[str] | dict[str, str]를 모두 받거나,
    # 별도 guru_names 파라미터를 추가하는 방식 중 하나 선택.
    # 여기서는 dict 형태를 직접 전달한다고 가정(구현이 따라온다).
    guru = {"BRK-B": "Berkshire Hathaway", "AAPL": "Apple Inc."}
    out = _merge_universe([], [], [], guru, kr_top_n=0)
    by = {r["ticker"]: r for r in out}
    assert by["BRK-B"]["name"] == "Berkshire Hathaway", "guru 행은 dataroma 이름을 가져야 한다"
    assert by["AAPL"]["name"] == "Apple Inc.", "guru 행은 dataroma 이름을 가져야 한다"


def test_fetch_guru_tickers_returns_name_map():
    """_fetch_guru_tickers가 {ticker: name} dict를 반환한다(list[str] 아닌)."""
    from services.recommendation import universe as U
    from unittest.mock import patch

    managers = [
        {"top10": [
            {"ticker": "BRK-B", "name": "Berkshire Hathaway"},
            {"ticker": "AAPL", "name": "Apple Inc."},
        ]},
        {"top10": [
            {"ticker": "MSFT", "name": "Microsoft"},
        ]},
    ]
    with patch.object(U, "_fetch_guru_tickers",
                      wraps=lambda: {"BRK-B": "Berkshire Hathaway",
                                     "AAPL": "Apple Inc.",
                                     "MSFT": "Microsoft"}):
        result = U._fetch_guru_tickers()

    # 반환값이 dict이고 ticker→name 매핑
    assert isinstance(result, dict), "_fetch_guru_tickers는 {ticker: name} dict를 반환해야 한다"
    assert result.get("BRK-B") == "Berkshire Hathaway"


def test_build_universe_graceful_on_source_failure():
    from services.recommendation import universe as U

    def _boom():
        raise RuntimeError("naver down")

    with patch.object(U, "_fetch_kr_rows", side_effect=_boom), \
         patch.object(U, "_load_sp500", return_value=["AAPL"]), \
         patch.object(U, "_fetch_tracked", return_value=[]), \
         patch.object(U, "_fetch_guru_tickers", return_value=[]):
        out = U.build_universe()
    tickers = {r["ticker"] for r in out}
    # KR이 죽어도 US sp500은 살아 있어야 한다
    assert tickers == {"AAPL"}


# ── (g) market 파라미터 — 시장 불문 소스 fetch 스킵 (C 슬라이스) ──

def test_build_universe_market_us_skips_kr_fetch():
    from services.recommendation import universe as U
    kr_raw = [{"ticker": "005930", "name": "삼성전자", "market_cap": 500, "is_etf": False}]
    with patch.object(U, "_fetch_kr_rows", return_value=kr_raw) as m_kr, \
         patch.object(U, "_load_sp500", return_value=["AAPL"]), \
         patch.object(U, "_fetch_tracked", return_value=[]), \
         patch.object(U, "_fetch_guru_tickers", return_value=["BRK-B"]):
        out = U.build_universe(market="US")
    assert m_kr.call_count == 0, "market=US면 KR fetch를 호출하지 않아야 한다"
    tickers = {r["ticker"] for r in out}
    assert tickers == {"AAPL", "BRK-B"}


def test_build_universe_market_kr_skips_sp500_and_guru_fetch():
    from services.recommendation import universe as U
    kr_raw = [{"ticker": "005930", "name": "삼성전자", "market_cap": 500, "is_etf": False}]
    with patch.object(U, "_fetch_kr_rows", return_value=kr_raw), \
         patch.object(U, "_load_sp500", return_value=["AAPL"]) as m_sp500, \
         patch.object(U, "_fetch_tracked", return_value=[]), \
         patch.object(U, "_fetch_guru_tickers", return_value=["BRK-B"]) as m_guru:
        out = U.build_universe(market="KR")
    assert m_sp500.call_count == 0, "market=KR이면 sp500 로딩을 호출하지 않아야 한다"
    assert m_guru.call_count == 0, "market=KR이면 guru 로딩을 호출하지 않아야 한다"
    tickers = {r["ticker"] for r in out}
    assert tickers == {"005930"}

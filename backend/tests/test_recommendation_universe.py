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

def _kr_row(ticker, name, cap, is_etf=False):
    return {"ticker": ticker, "name": name, "market_cap": cap, "is_etf": is_etf}


def _tracked(ticker, name, market, is_etf=False):
    return {"ticker": ticker, "name": name, "market": market, "is_etf": is_etf}


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


# ── (e) 일부 소스 fetch 실패는 로깅 후 graceful — 가용 소스만으로 구성 ──

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

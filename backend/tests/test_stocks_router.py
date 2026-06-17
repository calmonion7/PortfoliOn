from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from routers.stocks import router
from auth import get_current_user, get_current_user_or_api_key


app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
client = TestClient(app)

SAMPLE_PORTFOLIO = {
    "stocks": [
        {"ticker": "LLY", "name": "일라이 릴리", "quantity": 3.0, "avg_cost": 886.6,
         "competitors": ["NVO"], "moat": "", "growth_plan": "", "recent_disclosures": ""}
    ],
    "watchlist": [
        {"ticker": "AVAV", "name": "에어로바이런먼트", "competitors": [], "moat": "", "growth_plan": "", "recent_disclosures": ""}
    ],
}


def test_get_stocks_returns_flat_list_with_type():
    with patch("routers.stocks.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO):
        resp = client.get("/api/stocks")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    holding = next(s for s in data if s["ticker"] == "LLY")
    watchlist = next(s for s in data if s["ticker"] == "AVAV")
    assert holding["type"] == "holding"
    assert watchlist["type"] == "watchlist"
    assert holding["name"] == "일라이 릴리"


def test_enrich_single_stock_returns_updated_fields():
    with patch("routers.stocks.storage.enrich_stock", return_value=True):
        resp = client.put("/api/stocks/LLY/enrich", json={
            "moat": "특허 포트폴리오",
            "growth_plan": "GLP 확장",
        })
    assert resp.status_code == 200
    body = resp.json()
    assert body["ticker"] == "LLY"
    assert set(body["updated"]) == {"moat", "growth_plan"}


def test_enrich_single_stock_returns_404_when_not_found():
    with patch("routers.stocks.storage.enrich_stock", return_value=False):
        resp = client.put("/api/stocks/FAKE/enrich", json={"moat": "x"})
    assert resp.status_code == 404


def test_enrich_single_stock_returns_400_when_no_fields():
    resp = client.put("/api/stocks/LLY/enrich", json={})
    assert resp.status_code == 400


def test_enrich_batch_returns_updated_and_not_found():
    def mock_enrich(ticker, fields):
        return ticker.upper() != "FAKE"

    with patch("routers.stocks.storage.enrich_stock", side_effect=mock_enrich):
        resp = client.put("/api/stocks/enrich/batch", json=[
            {"ticker": "LLY", "moat": "특허"},
            {"ticker": "FAKE", "moat": "x"},
        ])
    assert resp.status_code == 200
    body = resp.json()
    assert "LLY" in body["updated"]
    assert "FAKE" in body["not_found"]


def test_enrich_batch_returns_400_when_empty():
    resp = client.put("/api/stocks/enrich/batch", json=[])
    assert resp.status_code == 400


def test_enrich_batch_item_with_no_fields_appears_in_not_found():
    with patch("routers.stocks.storage.enrich_stock", return_value=True):
        resp = client.put("/api/stocks/enrich/batch", json=[
            {"ticker": "LLY"},
        ])
    assert resp.status_code == 200
    body = resp.json()
    assert "LLY" in body["not_found"]
    assert "LLY" not in body["updated"]


def test_enrich_single_stock_with_competitors():
    captured = {}

    def mock_enrich(ticker, fields):
        captured.update(fields)
        return True

    with patch("routers.stocks.storage.enrich_stock", side_effect=mock_enrich):
        resp = client.put("/api/stocks/LLY/enrich", json={"competitors": ["NVO", "AZN"]})
    assert resp.status_code == 200
    assert captured["competitors"] == ["NVO", "AZN"]


def test_enrich_batch_with_competitors():
    captured = {}

    def mock_enrich(ticker, fields):
        captured[ticker.upper()] = fields
        return True

    with patch("routers.stocks.storage.enrich_stock", side_effect=mock_enrich):
        resp = client.put("/api/stocks/enrich/batch", json=[
            {"ticker": "LLY", "competitors": ["NVO"]},
        ])
    assert resp.status_code == 200
    assert resp.json()["updated"] == ["LLY"]
    assert captured["LLY"]["competitors"] == ["NVO"]


def test_dashboard_returns_cards_for_holdings():
    portfolio = {
        "stocks": [
            {"ticker": "AAPL", "name": "Apple Inc.", "market": "US",
             "avg_cost": 150.0, "quantity": 10, "exchange": ""},
        ],
        "watchlist": [
            {"ticker": "TSLA", "name": "Tesla", "market": "US",
             "avg_cost": None, "quantity": None, "exchange": ""},
        ]
    }
    quote = {
        "ticker": "AAPL", "price": 185.2,
        "daily_change_pct": 1.4, "weekly_change_pct": 2.1, "monthly_change_pct": 5.8,
        "name": "Apple Inc.", "market": "US",
    }
    from pathlib import Path
    with patch("routers.stocks.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.stocks.market.get_quotes_batch", return_value={"AAPL": quote}), \
         patch("routers.stocks.SNAPSHOTS_DIR", Path("/nonexistent")), \
         patch("routers.stocks.REPORTS_DIR", Path("/nonexistent")), \
         patch("routers.stocks.dividends.get_dividend", return_value=None), \
         patch("routers.stocks.query", return_value=[]):
        resp = client.get("/api/stocks/dashboard")
    assert resp.status_code == 200
    data = resp.json()
    # 신규 shape: {"holdings": [...], "totals": {...}}
    cards = data["holdings"]
    # watchlist excluded — only holdings
    assert len(cards) == 1
    card = cards[0]
    assert card["ticker"] == "AAPL"
    assert card["current_price"] == 185.2
    assert card["daily_change_pct"] == 1.4
    assert card["weekly_change_pct"] == 2.1
    assert card["monthly_change_pct"] == 5.8
    assert card["rsi"] is None      # no snapshot
    assert card["target_mean"] is None
    # 무배당(get_dividend None) — graceful None/0
    assert card["annual_dividend_per_share"] is None
    assert card["dividend_yield"] is None
    assert card["yield_on_cost"] is None
    assert card["expected_annual_income"] is None


def test_dashboard_dividend_fields_per_holding():
    """배당 저장값이 있으면 per-holding 배당필드·yield_on_cost·expected_income을 계산."""
    import services.cache as cache_svc
    cache_svc.invalidate_dashboard()
    portfolio = {
        "stocks": [{"ticker": "KO", "name": "Coca-Cola", "market": "US",
                    "avg_cost": 50.0, "quantity": 10, "exchange": ""}],
        "watchlist": [],
    }
    quote = {"ticker": "KO", "price": 82.0, "daily_change_pct": 0.5,
             "weekly_change_pct": 1.0, "monthly_change_pct": 2.0, "market": "US"}
    div = {"annual_dividend_per_share": 2.0, "dividend_yield": 2.44,
           "currency": "USD", "source": "yfinance"}
    from pathlib import Path
    with patch("routers.stocks.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.stocks.market.get_quotes_batch", return_value={"KO": quote}), \
         patch("routers.stocks.SNAPSHOTS_DIR", Path("/nonexistent")), \
         patch("routers.stocks.REPORTS_DIR", Path("/nonexistent")), \
         patch("routers.stocks.dividends.get_dividend", return_value=div), \
         patch("routers.stocks.query", return_value=[]):
        resp = client.get("/api/stocks/dashboard")
    card = resp.json()["holdings"][0]
    assert card["annual_dividend_per_share"] == 2.0
    assert card["dividend_yield"] == 2.44
    assert card["yield_on_cost"] == 4.0           # 2.0/50.0*100
    assert card["expected_annual_income"] == 20.0  # 2.0*10


def test_dashboard_totals_krw_conversion_mixed_currency():
    """포트 총계: US$ 배당을 _to_krw(저장 FX)로 환산해 KR원과 합산. 평균 수익률=총배당/총평가."""
    import services.cache as cache_svc
    cache_svc.invalidate_dashboard()
    portfolio = {
        "stocks": [
            {"ticker": "KO", "name": "Coca-Cola", "market": "US",
             "avg_cost": 50.0, "quantity": 10, "exchange": ""},
            {"ticker": "005930.KS", "name": "삼성전자", "market": "KR",
             "avg_cost": 60000.0, "quantity": 100, "exchange": "KS"},
        ],
        "watchlist": [],
    }
    quotes = {
        "KO": {"ticker": "KO", "price": 80.0, "market": "US"},
        "005930.KS": {"ticker": "005930.KS", "price": 70000.0, "market": "KR"},
    }

    def fake_get_div(t):
        if t.upper() == "KO":
            return {"annual_dividend_per_share": 2.0, "dividend_yield": 2.5,
                    "currency": "USD", "source": "yfinance"}
        return {"annual_dividend_per_share": 1500.0, "dividend_yield": 2.1,
                "currency": "KRW", "source": "dart"}

    from pathlib import Path
    with patch("routers.stocks.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.stocks.market.get_quotes_batch", return_value=quotes), \
         patch("routers.stocks.SNAPSHOTS_DIR", Path("/nonexistent")), \
         patch("routers.stocks.REPORTS_DIR", Path("/nonexistent")), \
         patch("routers.stocks.dividends.get_dividend", side_effect=fake_get_div), \
         patch("routers.stocks._usdkrw_rate", return_value=1300.0), \
         patch("routers.stocks.supply_score.read_score", return_value=None), \
         patch("routers.stocks.insider_trades.compute_net_signal",
               return_value={"direction": "neutral", "net_shares": 0, "count": 0, "window_days": 90}), \
         patch("routers.stocks.query", return_value=[]):
        resp = client.get("/api/stocks/dashboard")
    totals = resp.json()["totals"]
    # 연 예상배당: KO 2.0*10=20$ → 26000원, 삼성 1500*100=150000원 → 합 176000원
    assert totals["total_expected_annual_income_krw"] == 176000.0
    # 총 평가액: KO 80*10=800$ → 1,040,000원, 삼성 70000*100=7,000,000원 → 합 8,040,000원
    assert totals["total_market_value_krw"] == 8040000.0
    # 평균 배당수익률 = 176000/8040000*100 ≈ 2.19%
    assert totals["avg_dividend_yield"] == round(176000.0 / 8040000.0 * 100, 2)


def test_dashboard_reads_stored_fx_no_live_call():
    """_usdkrw_rate는 market_cache 저장값만 읽는다(요청 경로 라이브 FX 호출 0)."""
    from routers import stocks as s
    captured = {}

    def fake_mc_load(key):
        captured["key"] = key
        return {"data": {"rates": {"usdkrw": {"current": 1325.5}}}}

    with patch("routers.stocks._mc_load", fake_mc_load):
        assert s._usdkrw_rate() == 1325.5
    assert captured["key"] == "fx"


def test_dashboard_us_regression_no_dividend_unchanged():
    """배당 없는 US 보유의 기존 평가/손익 경로 필드는 그대로(회귀 0)."""
    import services.cache as cache_svc
    cache_svc.invalidate_dashboard()
    portfolio = {
        "stocks": [{"ticker": "GOOGL", "name": "Alphabet", "market": "US",
                    "avg_cost": 100.0, "quantity": 5, "exchange": ""}],
        "watchlist": [],
    }
    quote = {"ticker": "GOOGL", "price": 150.0, "daily_change_pct": 1.0,
             "weekly_change_pct": 2.0, "monthly_change_pct": 3.0, "market": "US"}
    from pathlib import Path
    with patch("routers.stocks.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.stocks.market.get_quotes_batch", return_value={"GOOGL": quote}), \
         patch("routers.stocks.SNAPSHOTS_DIR", Path("/nonexistent")), \
         patch("routers.stocks.REPORTS_DIR", Path("/nonexistent")), \
         patch("routers.stocks.dividends.get_dividend", return_value=None), \
         patch("routers.stocks.query", return_value=[]):
        resp = client.get("/api/stocks/dashboard")
    card = resp.json()["holdings"][0]
    assert card["ticker"] == "GOOGL"
    assert card["current_price"] == 150.0
    assert card["avg_cost"] == 100.0
    assert card["quantity"] == 5
    assert card["expected_annual_income"] is None


def test_dashboard_uses_mart_asof_for_target_and_opinion():
    """대시보드 카드 목표가·의견수는 동결 snapshot이 아니라 mart as-of 정본에서 와 상세와 일치한다. ADR-0008."""
    import services.cache as cache_svc
    cache_svc.invalidate_dashboard()
    portfolio = {
        "stocks": [{"ticker": "AAPL", "name": "Apple Inc.", "market": "US",
                    "avg_cost": 150.0, "quantity": 10, "exchange": ""}],
        "watchlist": []
    }
    quote = {"ticker": "AAPL", "price": 185.2, "daily_change_pct": 1.4,
             "weekly_change_pct": 2.1, "monthly_change_pct": 5.8,
             "name": "Apple Inc.", "market": "US"}
    snap_row = [{"date": "2026-05-05",
                 "data": {"target_mean": 200.0, "buy": 3, "hold": 1, "sell": 0,
                          "daily_rsi": {"rsi": 50.0}, "volume_profile": {"poc": 180.0}}}]
    mart_row = [{"target_mean": 250.0, "target_high": 270.0, "target_low": 230.0,
                 "buy": 12, "hold": 2, "sell": 1}]
    with patch("routers.stocks.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.stocks.market.get_quotes_batch", return_value={"AAPL": quote}), \
         patch("routers.stocks.dividends.get_dividend", return_value=None), \
         patch("routers.stocks.query", return_value=snap_row), \
         patch("services.consensus.query", return_value=mart_row):
        resp = client.get("/api/stocks/dashboard")
    assert resp.status_code == 200
    card = resp.json()["holdings"][0]
    assert card["target_mean"] == 250.0   # snapshot 200 → mart as-of 250
    assert card["buy"] == 12 and card["hold"] == 2 and card["sell"] == 1


def test_dashboard_returns_empty_list_when_no_holdings():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("routers.stocks.storage.get_full_portfolio", return_value=portfolio):
        resp = client.get("/api/stocks/dashboard")
    assert resp.status_code == 200
    assert resp.json() == {"holdings": [], "totals": None}


def test_dashboard_card_includes_sector():
    import services.cache as cache_svc
    cache_svc.invalidate_dashboard()
    portfolio = {
        "stocks": [
            {"ticker": "AAPL", "name": "Apple Inc.", "market": "US",
             "avg_cost": 150.0, "quantity": 10, "exchange": ""},
        ],
        "watchlist": []
    }
    quote = {"price": 185.2, "daily_change_pct": 1.4,
             "weekly_change_pct": 2.1, "monthly_change_pct": 5.8}
    # sector는 이제 snapshot에서 오며, _norm_sector로 정규화된다(raw "Financial Services" → "Financials")
    snap_row = [{"date": "2026-05-05", "data": {"sector": "Financial Services", "daily_rsi": {"rsi": 50.0}}}]
    with patch("routers.stocks.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.stocks.market.get_quotes_batch", return_value={"AAPL": quote}), \
         patch("routers.stocks.dividends.get_dividend", return_value=None), \
         patch("routers.stocks.query", return_value=snap_row), \
         patch("services.consensus.query", return_value=[]):
        resp = client.get("/api/stocks/dashboard")
    assert resp.status_code == 200
    card = resp.json()["holdings"][0]
    assert card["sector"] == "Financials"


def test_dashboard_supply_kr_populated_us_null():
    """수급 스코어(ADR-0014): KR 보유만 저장값 {band,flags,as_of} 투영, US는 null."""
    import services.cache as cache_svc
    cache_svc.invalidate_dashboard()
    portfolio = {
        "stocks": [
            {"ticker": "005930.KS", "name": "삼성전자", "market": "KR",
             "avg_cost": 60000.0, "quantity": 100, "exchange": "KS"},
            {"ticker": "AAPL", "name": "Apple Inc.", "market": "US",
             "avg_cost": 150.0, "quantity": 10, "exchange": ""},
        ],
        "watchlist": [],
    }
    quotes = {
        "005930.KS": {"ticker": "005930.KS", "price": 70000.0, "market": "KR"},
        "AAPL": {"ticker": "AAPL", "price": 185.2, "market": "US"},
    }
    score_row = {"ticker": "005930.KS", "computed_date": "2026-06-17",
                 "band": "caution", "flags": ["공매도 비중 급증"],
                 "as_of": {"short_sell": "2026-06-16", "investor": "2026-06-16"}}
    from pathlib import Path
    with patch("routers.stocks.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.stocks.market.get_quotes_batch", return_value=quotes), \
         patch("routers.stocks.SNAPSHOTS_DIR", Path("/nonexistent")), \
         patch("routers.stocks.REPORTS_DIR", Path("/nonexistent")), \
         patch("routers.stocks.dividends.get_dividend", return_value=None), \
         patch("routers.stocks.supply_score.read_score",
               side_effect=lambda t: score_row if t.upper() == "005930.KS" else None), \
         patch("routers.stocks.insider_trades.compute_net_signal",
               return_value={"direction": "neutral", "net_shares": 0, "count": 0, "window_days": 90}), \
         patch("routers.stocks.query", return_value=[]):
        resp = client.get("/api/stocks/dashboard")
    cards = {c["ticker"]: c for c in resp.json()["holdings"]}
    kr = cards["005930.KS"]
    assert kr["supply"] == {"band": "caution", "flags": ["공매도 비중 급증"],
                            "as_of": {"short_sell": "2026-06-16", "investor": "2026-06-16"}}
    # US는 read_score 결과 무관하게 null (KR 게이트)
    assert cards["AAPL"]["supply"] is None


def test_dashboard_insider_kr_populated_us_null():
    """S6 내부자 신호: KR 보유만 compute_net_signal 투영, US는 null(additive)."""
    import services.cache as cache_svc
    cache_svc.invalidate_dashboard()
    portfolio = {
        "stocks": [
            {"ticker": "005930.KS", "name": "삼성전자", "market": "KR",
             "avg_cost": 60000.0, "quantity": 100, "exchange": "KS"},
            {"ticker": "AAPL", "name": "Apple Inc.", "market": "US",
             "avg_cost": 150.0, "quantity": 10, "exchange": ""},
        ],
        "watchlist": [],
    }
    quotes = {
        "005930.KS": {"ticker": "005930.KS", "price": 70000.0, "market": "KR"},
        "AAPL": {"ticker": "AAPL", "price": 185.2, "market": "US"},
    }
    signal = {"direction": "buy", "net_shares": 12000, "count": 3, "window_days": 90}
    from pathlib import Path
    with patch("routers.stocks.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.stocks.market.get_quotes_batch", return_value=quotes), \
         patch("routers.stocks.SNAPSHOTS_DIR", Path("/nonexistent")), \
         patch("routers.stocks.REPORTS_DIR", Path("/nonexistent")), \
         patch("routers.stocks.dividends.get_dividend", return_value=None), \
         patch("routers.stocks.supply_score.read_score", return_value=None), \
         patch("routers.stocks.insider_trades.compute_net_signal",
               return_value=signal) as cns, \
         patch("routers.stocks.query", return_value=[]):
        resp = client.get("/api/stocks/dashboard")
    cards = {c["ticker"]: c for c in resp.json()["holdings"]}
    assert cards["005930.KS"]["insider"] == signal
    # US는 KR 게이트로 null이며 compute_net_signal을 호출하지 않음
    assert cards["AAPL"]["insider"] is None
    assert all(c.args[0] == "005930.KS" for c in cns.call_args_list)


def test_supply_score_endpoint_returns_projection():
    score_row = {"ticker": "005930.KS", "computed_date": "2026-06-17",
                 "band": "favorable", "flags": ["공매도 비중 둔화"],
                 "as_of": {"short_sell": "2026-06-16", "investor": None}}
    with patch("routers.stocks.supply_score.read_score", return_value=score_row):
        resp = client.get("/api/stocks/005930.KS/supply-score")
    assert resp.status_code == 200
    assert resp.json() == {"band": "favorable", "flags": ["공매도 비중 둔화"],
                           "as_of": {"short_sell": "2026-06-16", "investor": None}}


def test_supply_score_endpoint_null_when_absent():
    with patch("routers.stocks.supply_score.read_score", return_value=None):
        resp = client.get("/api/stocks/AAPL/supply-score")
    assert resp.status_code == 200
    assert resp.json() is None


def test_get_stock_news_returns_list_and_calls_scraper():
    sample = [
        {"title": "삼성전자 신고가", "link": "https://x/1", "publisher": "한국경제", "published_at": "2026-06-06 09:00"},
        {"title": "반도체 업황 개선", "link": "https://x/2", "publisher": "매일경제", "published_at": "2026-06-05 18:00"},
    ]
    with patch("routers.stocks.scraper.get_news", return_value=sample) as mock_news:
        resp = client.get("/api/stocks/005930/news?market=KR")
    assert resp.status_code == 200
    assert resp.json() == {"news": sample}
    mock_news.assert_called_once_with("005930", "KR")


def test_get_stock_news_defaults_market_us():
    with patch("routers.stocks.scraper.get_news", return_value=[]) as mock_news:
        resp = client.get("/api/stocks/AAPL/news")
    assert resp.status_code == 200
    assert resp.json() == {"news": []}
    mock_news.assert_called_once_with("AAPL", "US")


def test_get_stock_news_invalid_market_400():
    resp = client.get("/api/stocks/AAPL/news?market=JP")
    assert resp.status_code == 400


def test_get_stock_news_scraper_error_returns_empty():
    with patch("routers.stocks.scraper.get_news", side_effect=RuntimeError("network")):
        resp = client.get("/api/stocks/AAPL/news?market=US")
    assert resp.status_code == 200
    assert resp.json() == {"news": []}

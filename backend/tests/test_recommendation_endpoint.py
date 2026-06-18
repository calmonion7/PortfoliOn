# backend/tests/test_recommendation_endpoint.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from datetime import date

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.recommendations import router
from auth import get_current_user, require_admin

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
app.dependency_overrides[require_admin] = lambda: "admin-id"
client = TestClient(app)


def _scored_rows():
    return [
        {
            "ticker": "AAPL", "name": "Apple", "market": "US",
            "score": 88.0, "flags": [{"label": "목표가 대비 +20%", "kind": "value"}],
            "rank": 1, "base_date": date(2026, 6, 18),
        },
        {
            "ticker": "005930", "name": "삼성전자", "market": "KR",
            "score": 75.0, "flags": [], "rank": 2, "base_date": date(2026, 6, 18),
        },
    ]


def _portfolio(stocks=None, watchlist=None):
    return {"stocks": stocks or [], "watchlist": watchlist or []}


def test_get_recommendations_returns_discovery_section():
    with patch("routers.recommendations.storage.get_full_portfolio", return_value=_portfolio()), \
         patch("routers.recommendations.recommendation.read_recommendations",
               return_value=_scored_rows()) as mock_read:
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    data = resp.json()
    # additive 섹션 키 객체
    assert set(data.keys()) >= {"as_of", "discovery"}
    assert isinstance(data["discovery"], list)
    # as_of = 가장 최신 base_date
    assert data["as_of"] == "2026-06-18"
    first = data["discovery"][0]
    assert first["ticker"] == "AAPL"
    assert first["score"] == 88.0
    assert first["rank"] == 1
    assert first["flags"] == [{"label": "목표가 대비 +20%", "kind": "value"}]
    # base_date는 응답 항목에 노출하지 않음(as_of로 대체)
    assert "base_date" not in first
    # read_recommendations 호출 인자: exclude_tickers=[] (추적종목 없음), limit 전달
    _, kwargs = mock_read.call_args
    assert kwargs.get("exclude_tickers") == []


def test_get_recommendations_excludes_caller_tracked():
    # stocks 비어있지 않음 → holdings read가 세 번째로 발화하므로 discovery 단언은
    # call_args(마지막)가 아닌 call_args_list[0](첫 호출=discovery)로 한다.
    # holdings 도달 경로의 외부 호출 0 보장을 위해 _latest_snapshots/_usdkrw_rate를 patch.
    tracked = [{"ticker": "AAPL"}, {"ticker": "005930"}]
    with patch("routers.recommendations.storage.get_full_portfolio",
               return_value=_portfolio(stocks=tracked)), \
         patch("routers.recommendations.recommendation.read_recommendations",
               return_value=[]) as mock_read, \
         patch("routers.recommendations._latest_snapshots", return_value={}), \
         patch("routers.recommendations._usdkrw_rate", return_value=None):
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    discovery_kwargs = mock_read.call_args_list[0].kwargs
    assert sorted(discovery_kwargs.get("exclude_tickers")) == ["005930", "AAPL"]


def test_get_recommendations_discovery_excludes_low_liquidity():
    # 저유동성은 discovery read에서만 제외(exclude_low_liquidity=True);
    # watchlist/holdings read엔 미부여(노출 유지). read는 patch라 추가 kwarg 허용.
    watchlist = [{"ticker": "AAPL", "name": "Apple", "market": "US"}]
    holdings = [{"ticker": "MSFT", "name": "Microsoft", "market": "US",
                 "quantity": 1, "avg_cost": 100.0, "exchange": ""}]

    def _read(*args, **kwargs):
        if kwargs.get("only_tickers"):
            return []
        return []

    with patch("routers.recommendations.storage.get_full_portfolio",
               return_value=_portfolio(stocks=holdings, watchlist=watchlist)), \
         patch("routers.recommendations.recommendation.read_recommendations",
               side_effect=_read) as mock_read, \
         patch("routers.recommendations._latest_snapshots", return_value={}), \
         patch("routers.recommendations._usdkrw_rate", return_value=None):
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    # 첫 호출=discovery → exclude_low_liquidity=True
    discovery_kwargs = mock_read.call_args_list[0].kwargs
    assert discovery_kwargs.get("exclude_low_liquidity") is True
    # 이후 watchlist/holdings read는 exclude_low_liquidity 미부여(또는 기본 False)
    for call in mock_read.call_args_list[1:]:
        assert call.kwargs.get("exclude_low_liquidity", False) is False


def test_get_recommendations_passes_limit():
    with patch("routers.recommendations.storage.get_full_portfolio", return_value=_portfolio()), \
         patch("routers.recommendations.recommendation.read_recommendations",
               return_value=[]) as mock_read:
        resp = client.get("/api/recommendations?limit=10")
    assert resp.status_code == 200
    _, kwargs = mock_read.call_args
    assert kwargs.get("limit") == 10


def test_get_recommendations_empty_graceful():
    with patch("routers.recommendations.storage.get_full_portfolio", return_value=_portfolio()), \
         patch("routers.recommendations.recommendation.read_recommendations",
               return_value=[]):
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    data = resp.json()
    assert data["discovery"] == []
    assert data["as_of"] is None


def test_get_recommendations_no_live_external_call():
    # 요청 경로에서 배치/외부 fetch 금지 — read_recommendations(저장값)만 호출
    with patch("routers.recommendations.storage.get_full_portfolio", return_value=_portfolio()), \
         patch("routers.recommendations.recommendation.read_recommendations",
               return_value=[]), \
         patch("routers.recommendations.recommendation.run_recommendation_batch") as mock_batch:
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    mock_batch.assert_not_called()


# --- watchlist 섹션 (part 3/4) ---

def test_get_recommendations_watchlist_scored_desc():
    """watchlist 종목 중 점수 있는 것 → data["watchlist"]에 score DESC로 포함."""
    watchlist = [
        {"ticker": "AAPL", "name": "Apple", "market": "US"},
        {"ticker": "005930", "name": "삼성전자", "market": "KR"},
    ]

    def _read(*args, **kwargs):
        if "only_tickers" in kwargs and kwargs["only_tickers"] is not None:
            return _scored_rows()  # score DESC: AAPL(88) → 005930(75)
        return []  # discovery

    with patch("routers.recommendations.storage.get_full_portfolio",
               return_value=_portfolio(watchlist=watchlist)), \
         patch("routers.recommendations.recommendation.read_recommendations",
               side_effect=_read):
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    data = resp.json()
    wl = data["watchlist"]
    assert [w["ticker"] for w in wl] == ["AAPL", "005930"]
    first = wl[0]
    assert first == {
        "ticker": "AAPL", "name": "Apple", "market": "US",
        "score": 88.0, "flags": [{"label": "목표가 대비 +20%", "kind": "value"}], "rank": 1,
        "exchange": "",
    }


def test_get_recommendations_watchlist_unscored_appended_last():
    """점수 없는 watchlist 종목 → 말미에 score=None, name/market은 watchlist dict값."""
    watchlist = [
        {"ticker": "AAPL", "name": "Apple", "market": "US"},
        {"ticker": "TSLA", "name": "Tesla", "market": "US"},  # 점수 없음
    ]
    scored = [{
        "ticker": "AAPL", "name": "Apple", "market": "US",
        "score": 88.0, "flags": [], "rank": 1, "base_date": date(2026, 6, 18),
    }]

    def _read(*args, **kwargs):
        if "only_tickers" in kwargs and kwargs["only_tickers"] is not None:
            return scored
        return []

    with patch("routers.recommendations.storage.get_full_portfolio",
               return_value=_portfolio(watchlist=watchlist)), \
         patch("routers.recommendations.recommendation.read_recommendations",
               side_effect=_read):
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    wl = resp.json()["watchlist"]
    assert [w["ticker"] for w in wl] == ["AAPL", "TSLA"]
    last = wl[-1]
    assert last == {
        "ticker": "TSLA", "name": "Tesla", "market": "US",
        "score": None, "flags": [], "rank": None, "exchange": "",
    }


def test_get_recommendations_discovery_and_watchlist_coexist():
    """discovery는 watchlist 추가와 무관하게 동일(additive) — 둘 다 응답에 존재."""
    watchlist = [{"ticker": "AAPL", "name": "Apple", "market": "US"}]
    discovery_rows = [{
        "ticker": "NVDA", "name": "Nvidia", "market": "US",
        "score": 95.0, "flags": [], "rank": 1, "base_date": date(2026, 6, 18),
    }]
    wl_rows = [{
        "ticker": "AAPL", "name": "Apple", "market": "US",
        "score": 88.0, "flags": [], "rank": 2, "base_date": date(2026, 6, 18),
    }]

    def _read(*args, **kwargs):
        if "only_tickers" in kwargs and kwargs["only_tickers"] is not None:
            return wl_rows
        return discovery_rows

    with patch("routers.recommendations.storage.get_full_portfolio",
               return_value=_portfolio(watchlist=watchlist)), \
         patch("routers.recommendations.recommendation.read_recommendations",
               side_effect=_read):
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    data = resp.json()
    assert [d["ticker"] for d in data["discovery"]] == ["NVDA"]
    assert [w["ticker"] for w in data["watchlist"]] == ["AAPL"]
    assert data["as_of"] == "2026-06-18"


def test_get_recommendations_empty_watchlist_no_second_read():
    """watchlist 비면 data["watchlist"]==[] 이고 두 번째 read_recommendations 호출 없음."""
    with patch("routers.recommendations.storage.get_full_portfolio", return_value=_portfolio()), \
         patch("routers.recommendations.recommendation.read_recommendations",
               return_value=[]) as mock_read:
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    assert resp.json()["watchlist"] == []
    # discovery 1회만 — only_tickers 호출(두 번째 read) 없음
    assert mock_read.call_count == 1
    for call in mock_read.call_args_list:
        assert "only_tickers" not in call.kwargs


def test_get_recommendations_exposes_exchange_all_sections():
    """발굴·관심·보유 세 섹션 모두 exchange 노출(점수 있음=read 값, 없음=stock dict 값)."""
    discovery_rows = [{"ticker": "005930", "name": "삼성전자", "market": "KR",
                       "score": 90.0, "flags": [], "rank": 1,
                       "base_date": date(2026, 6, 18), "exchange": "KS"}]
    wl_scored = [{"ticker": "035720", "name": "카카오", "market": "KR",
                  "score": 80.0, "flags": [], "rank": 2,
                  "base_date": date(2026, 6, 18), "exchange": "KQ"}]
    h_scored = [{"ticker": "000660", "name": "하이닉스", "market": "KR",
                 "score": 70.0, "flags": [], "rank": 3,
                 "base_date": date(2026, 6, 18), "exchange": "KS"}]
    # 점수 없는 fallback: watchlist TSLA(US), holdings AAPL(US)
    watchlist = [{"ticker": "035720", "name": "카카오", "market": "KR", "exchange": "KQ"},
                 {"ticker": "TSLA", "name": "Tesla", "market": "US", "exchange": ""}]
    holdings = [{"ticker": "000660", "name": "하이닉스", "market": "KR",
                 "quantity": 1, "avg_cost": 50000.0, "exchange": "KS"},
                {"ticker": "AAPL", "name": "Apple", "market": "US",
                 "quantity": 1, "avg_cost": 100.0, "exchange": ""}]

    def _read(*args, **kwargs):
        only = kwargs.get("only_tickers")
        if only:
            if "035720" in only:
                return wl_scored
            return h_scored
        return discovery_rows

    snaps = {"000660": ({"price": 60000.0}, date(2026, 6, 18)),
             "AAPL": ({"price": 120.0}, date(2026, 6, 18))}

    with patch("routers.recommendations.storage.get_full_portfolio",
               return_value=_portfolio(stocks=holdings, watchlist=watchlist)), \
         patch("routers.recommendations.recommendation.read_recommendations",
               side_effect=_read), \
         patch("routers.recommendations._latest_snapshots", return_value=snaps), \
         patch("routers.recommendations._usdkrw_rate", return_value=1300.0):
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    data = resp.json()
    # discovery (점수 있음 → read 값)
    assert {d["ticker"]: d["exchange"] for d in data["discovery"]} == {"005930": "KS"}
    # watchlist: 점수 있음(035720=KQ) + 점수 없음 fallback(TSLA=stock dict '')
    wl = {w["ticker"]: w["exchange"] for w in data["watchlist"]}
    assert wl["035720"] == "KQ"
    assert wl["TSLA"] == ""
    # holdings: 점수 있음(000660=KS) — AAPL은 점수 없음 fallback(stock dict '')
    h = {x["ticker"]: x["exchange"] for x in data["holdings"]}
    assert h["000660"] == "KS"
    assert h["AAPL"] == ""


def test_get_recommendations_requires_auth():
    no_auth = FastAPI()
    no_auth.include_router(router)
    c = TestClient(no_auth)
    resp = c.get("/api/recommendations")
    assert resp.status_code in (401, 403)


def test_refresh_triggers_batch():
    with patch("routers.recommendations.scheduler._recommendation_work") as mock_work, \
         patch("routers.recommendations.job_runs.record"):
        resp = client.post("/api/recommendations/refresh?market=KR")
    assert resp.status_code == 202
    assert resp.json() == {"ok": True}
    mock_work.assert_called_once_with("KR")


# --- holdings 섹션 (part 4/4) ---

def _holding(ticker, name, market, qty, avg_cost):
    return {"ticker": ticker, "name": name, "market": market,
            "quantity": qty, "avg_cost": avg_cost, "exchange": ""}


def test_get_recommendations_empty_holdings_no_third_read():
    """holdings 비면 data["holdings"]==[] 이고 세 번째 read(only_tickers) 미발화."""
    watchlist = [{"ticker": "AAPL", "name": "Apple", "market": "US"}]
    wl_rows = [{"ticker": "AAPL", "name": "Apple", "market": "US",
                "score": 88.0, "flags": [], "rank": 1, "base_date": date(2026, 6, 18)}]

    def _read(*args, **kwargs):
        if kwargs.get("only_tickers"):
            return wl_rows
        return []

    with patch("routers.recommendations.storage.get_full_portfolio",
               return_value=_portfolio(watchlist=watchlist)), \
         patch("routers.recommendations.recommendation.read_recommendations",
               side_effect=_read) as mock_read:
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    data = resp.json()
    assert data["holdings"] == []
    # discovery(1) + watchlist(1) = 2회; holdings read 없음
    assert mock_read.call_count == 2


def test_get_recommendations_holdings_add_action():
    """score>=70 AND weight<10 → 추매."""
    holdings = [
        _holding("AAPL", "Apple", "US", 1, 100.0),    # 가치 작음 → 저비중
        _holding("MSFT", "Microsoft", "US", 100, 100.0),  # 가치 큼 → 고비중
    ]
    scored = [
        {"ticker": "AAPL", "name": "Apple", "market": "US",
         "score": 85.0, "flags": [], "rank": 1, "base_date": date(2026, 6, 18)},
        {"ticker": "MSFT", "name": "Microsoft", "market": "US",
         "score": 50.0, "flags": [], "rank": 2, "base_date": date(2026, 6, 18)},
    ]

    def _read(*args, **kwargs):
        if kwargs.get("only_tickers"):
            return scored
        return []

    snaps = {"AAPL": ({"price": 120.0}, date(2026, 6, 18)),
             "MSFT": ({"price": 110.0}, date(2026, 6, 18))}

    with patch("routers.recommendations.storage.get_full_portfolio",
               return_value=_portfolio(stocks=holdings)), \
         patch("routers.recommendations.recommendation.read_recommendations",
               side_effect=_read), \
         patch("routers.recommendations._latest_snapshots", return_value=snaps), \
         patch("routers.recommendations._usdkrw_rate", return_value=1300.0):
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    holds = {h["ticker"]: h for h in resp.json()["holdings"]}
    # AAPL: score 85, 작은 가치 → 저비중(<10) → 추매
    assert holds["AAPL"]["action"] == "추매"
    # weight_pct·pnl_pct 키 존재
    assert holds["AAPL"]["pnl_pct"] == 20.0  # (120-100)/100*100
    assert holds["AAPL"]["weight_pct"] < 10.0
    # MSFT: score 50 → 추매/익절 조건 모두 미충족 → 홀딩
    assert holds["MSFT"]["action"] == "홀딩"
    assert holds["MSFT"]["weight_pct"] > 90.0


def test_get_recommendations_holdings_take_profit_action():
    """score<=40 AND pnl>=15 → 익절."""
    holdings = [_holding("TSLA", "Tesla", "US", 1, 100.0)]
    scored = [{"ticker": "TSLA", "name": "Tesla", "market": "US",
               "score": 30.0, "flags": [], "rank": 1, "base_date": date(2026, 6, 18)}]

    def _read(*args, **kwargs):
        if kwargs.get("only_tickers"):
            return scored
        return []

    with patch("routers.recommendations.storage.get_full_portfolio",
               return_value=_portfolio(stocks=holdings)), \
         patch("routers.recommendations.recommendation.read_recommendations",
               side_effect=_read), \
         patch("routers.recommendations._latest_snapshots",
               return_value={"TSLA": ({"price": 130.0}, date(2026, 6, 18))}), \
         patch("routers.recommendations._usdkrw_rate", return_value=1300.0):
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    h = resp.json()["holdings"][0]
    assert h["action"] == "익절"
    assert h["pnl_pct"] == 30.0


def test_get_recommendations_holdings_missing_score_or_price_holds():
    """score 없거나 price 결측 → 홀딩(데이터 부족)."""
    holdings = [
        _holding("AAPL", "Apple", "US", 1, 100.0),   # score 없음
        _holding("MSFT", "Microsoft", "US", 1, 100.0),  # price 결측
    ]

    def _read(*args, **kwargs):
        if kwargs.get("only_tickers"):
            # MSFT만 점수 있음
            return [{"ticker": "MSFT", "name": "Microsoft", "market": "US",
                     "score": 90.0, "flags": [], "rank": 1, "base_date": date(2026, 6, 18)}]
        return []

    snaps = {"AAPL": ({"price": 120.0}, date(2026, 6, 18)),
             "MSFT": ({"price": None}, None)}  # price 결측

    with patch("routers.recommendations.storage.get_full_portfolio",
               return_value=_portfolio(stocks=holdings)), \
         patch("routers.recommendations.recommendation.read_recommendations",
               side_effect=_read), \
         patch("routers.recommendations._latest_snapshots", return_value=snaps), \
         patch("routers.recommendations._usdkrw_rate", return_value=1300.0):
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    holds = {h["ticker"]: h for h in resp.json()["holdings"]}
    # AAPL: score None → 홀딩(데이터 부족)
    assert holds["AAPL"]["action"] == "홀딩"
    assert holds["AAPL"]["score"] is None
    assert holds["AAPL"]["reasons"] == ["데이터 부족"]
    # MSFT: price None → pnl/weight None → 홀딩(데이터 부족)
    assert holds["MSFT"]["action"] == "홀딩"
    assert holds["MSFT"]["pnl_pct"] is None
    assert holds["MSFT"]["weight_pct"] is None


def test_get_recommendations_holdings_kr_us_weight():
    """KR+US 혼재 — KRW 환산값으로 비중 계산."""
    holdings = [
        _holding("005930", "삼성전자", "KR", 10, 50000.0),  # KR: price*qty*1.0
        _holding("AAPL", "Apple", "US", 10, 100.0),         # US: price*qty*usdkrw
    ]
    scored = [
        {"ticker": "005930", "name": "삼성전자", "market": "KR",
         "score": 60.0, "flags": [], "rank": 1, "base_date": date(2026, 6, 18)},
        {"ticker": "AAPL", "name": "Apple", "market": "US",
         "score": 60.0, "flags": [], "rank": 2, "base_date": date(2026, 6, 18)},
    ]

    def _read(*args, **kwargs):
        if kwargs.get("only_tickers"):
            return scored
        return []

    # 005930: 60000*10*1 = 600,000 KRW
    # AAPL:   120*10*1300 = 1,560,000 KRW
    # 합 = 2,160,000 → 005930 비중 ≈ 27.78%, AAPL ≈ 72.22%
    snaps = {"005930": ({"price": 60000.0}, date(2026, 6, 18)),
             "AAPL": ({"price": 120.0}, date(2026, 6, 18))}

    def _fx():
        return 1300.0

    with patch("routers.recommendations.storage.get_full_portfolio",
               return_value=_portfolio(stocks=holdings)), \
         patch("routers.recommendations.recommendation.read_recommendations",
               side_effect=_read), \
         patch("routers.recommendations._latest_snapshots", return_value=snaps), \
         patch("routers.recommendations._usdkrw_rate", side_effect=_fx):
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    holds = {h["ticker"]: h for h in resp.json()["holdings"]}
    assert abs(holds["005930"]["weight_pct"] - 27.7777) < 0.1
    assert abs(holds["AAPL"]["weight_pct"] - 72.2222) < 0.1
    # 합 ≈ 100
    assert abs(holds["005930"]["weight_pct"] + holds["AAPL"]["weight_pct"] - 100.0) < 0.01


def test_get_recommendations_holdings_us_no_fx_excluded_from_weight():
    """US이고 usdkrw None → 환산 불가 → 분모 제외 & weight_pct None."""
    holdings = [
        _holding("005930", "삼성전자", "KR", 10, 50000.0),
        _holding("AAPL", "Apple", "US", 10, 100.0),
    ]
    scored = [
        {"ticker": "005930", "name": "삼성전자", "market": "KR",
         "score": 80.0, "flags": [], "rank": 1, "base_date": date(2026, 6, 18)},
        {"ticker": "AAPL", "name": "Apple", "market": "US",
         "score": 80.0, "flags": [], "rank": 2, "base_date": date(2026, 6, 18)},
    ]

    def _read(*args, **kwargs):
        if kwargs.get("only_tickers"):
            return scored
        return []

    snaps = {"005930": ({"price": 60000.0}, date(2026, 6, 18)),
             "AAPL": ({"price": 120.0}, date(2026, 6, 18))}

    with patch("routers.recommendations.storage.get_full_portfolio",
               return_value=_portfolio(stocks=holdings)), \
         patch("routers.recommendations.recommendation.read_recommendations",
               side_effect=_read), \
         patch("routers.recommendations._latest_snapshots", return_value=snaps), \
         patch("routers.recommendations._usdkrw_rate", return_value=None):
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    holds = {h["ticker"]: h for h in resp.json()["holdings"]}
    # AAPL: usdkrw None → weight None, 분모 제외 → KR 단독 100%
    assert holds["AAPL"]["weight_pct"] is None
    assert abs(holds["005930"]["weight_pct"] - 100.0) < 0.01


def test_get_recommendations_holdings_does_not_change_discovery_watchlist():
    """holdings 존재해도 discovery/watchlist 불변."""
    holdings = [_holding("MSFT", "Microsoft", "US", 1, 100.0)]
    watchlist = [{"ticker": "AAPL", "name": "Apple", "market": "US"}]
    discovery_rows = [{"ticker": "NVDA", "name": "Nvidia", "market": "US",
                       "score": 95.0, "flags": [], "rank": 1, "base_date": date(2026, 6, 18)}]
    wl_rows = [{"ticker": "AAPL", "name": "Apple", "market": "US",
                "score": 88.0, "flags": [], "rank": 2, "base_date": date(2026, 6, 18)}]
    h_rows = [{"ticker": "MSFT", "name": "Microsoft", "market": "US",
               "score": 70.0, "flags": [], "rank": 3, "base_date": date(2026, 6, 18)}]

    def _read(*args, **kwargs):
        only = kwargs.get("only_tickers")
        if only:
            # watchlist read는 AAPL, holdings read는 MSFT로 구분
            if "AAPL" in only:
                return wl_rows
            return h_rows
        return discovery_rows

    with patch("routers.recommendations.storage.get_full_portfolio",
               return_value=_portfolio(stocks=holdings, watchlist=watchlist)), \
         patch("routers.recommendations.recommendation.read_recommendations",
               side_effect=_read), \
         patch("routers.recommendations._latest_snapshots",
               return_value={"MSFT": ({"price": 120.0}, date(2026, 6, 18))}), \
         patch("routers.recommendations._usdkrw_rate", return_value=1300.0):
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    data = resp.json()
    assert [d["ticker"] for d in data["discovery"]] == ["NVDA"]
    assert [w["ticker"] for w in data["watchlist"]] == ["AAPL"]
    assert [h["ticker"] for h in data["holdings"]] == ["MSFT"]


def test_get_recommendations_no_live_external_call_with_holdings():
    """holdings 경로에서도 요청경로 외부 fetch 0 — read_recommendations·저장헬퍼만."""
    holdings = [_holding("MSFT", "Microsoft", "US", 1, 100.0)]
    scored = [{"ticker": "MSFT", "name": "Microsoft", "market": "US",
               "score": 70.0, "flags": [], "rank": 1, "base_date": date(2026, 6, 18)}]

    def _read(*args, **kwargs):
        if kwargs.get("only_tickers"):
            return scored
        return []

    with patch("routers.recommendations.storage.get_full_portfolio",
               return_value=_portfolio(stocks=holdings)), \
         patch("routers.recommendations.recommendation.read_recommendations",
               side_effect=_read), \
         patch("routers.recommendations.recommendation.run_recommendation_batch") as mock_batch, \
         patch("routers.recommendations._latest_snapshots",
               return_value={"MSFT": ({"price": 120.0}, date(2026, 6, 18))}), \
         patch("routers.recommendations._usdkrw_rate", return_value=1300.0):
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    mock_batch.assert_not_called()


def test_get_recommendations_holdings_snapshot_read_batched_once():
    """보유 N개와 무관하게 스냅샷 read는 배치 1회(_latest_snapshots) — 보유 티커 전체를 한 번에 전달."""
    holdings = [
        _holding("AAPL", "Apple", "US", 1, 100.0),
        _holding("MSFT", "Microsoft", "US", 1, 100.0),
        _holding("TSLA", "Tesla", "US", 1, 100.0),
    ]
    scored = [
        {"ticker": "AAPL", "name": "Apple", "market": "US",
         "score": 60.0, "flags": [], "rank": 1, "base_date": date(2026, 6, 18)},
        {"ticker": "MSFT", "name": "Microsoft", "market": "US",
         "score": 60.0, "flags": [], "rank": 2, "base_date": date(2026, 6, 18)},
        {"ticker": "TSLA", "name": "Tesla", "market": "US",
         "score": 60.0, "flags": [], "rank": 3, "base_date": date(2026, 6, 18)},
    ]

    def _read(*args, **kwargs):
        if kwargs.get("only_tickers"):
            return scored
        return []

    snaps = {"AAPL": ({"price": 120.0}, date(2026, 6, 18)),
             "MSFT": ({"price": 110.0}, date(2026, 6, 18)),
             "TSLA": ({"price": 130.0}, date(2026, 6, 18))}

    with patch("routers.recommendations.storage.get_full_portfolio",
               return_value=_portfolio(stocks=holdings)), \
         patch("routers.recommendations.recommendation.read_recommendations",
               side_effect=_read), \
         patch("routers.recommendations._latest_snapshots", return_value=snaps) as mock_batch, \
         patch("routers.recommendations._usdkrw_rate", return_value=1300.0):
        resp = client.get("/api/recommendations")
    assert resp.status_code == 200
    assert len(resp.json()["holdings"]) == 3
    # 보유 3개여도 스냅샷 배치 read는 1회, 인자는 보유 티커 전체
    mock_batch.assert_called_once()
    called_tickers = mock_batch.call_args.args[0]
    assert sorted(called_tickers) == ["AAPL", "MSFT", "TSLA"]

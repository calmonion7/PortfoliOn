import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest


def _kr_stock(item_code, name, value, volume, end_type="stock", exch="KS",
              price="10000", ratio="1.23", mcap="50000000000"):
    return {
        "itemCode": item_code,
        "stockName": name,
        "closePriceRaw": price,
        "fluctuationsRatio": ratio,
        "accumulatedTradingValueRaw": value,
        "accumulatedTradingVolumeRaw": volume,
        "marketValueRaw": mcap,
        "stockEndType": end_type,
        "stockExchangeType": {"code": exch},
    }


def test_parse_int_strips_commas():
    from services.ranking_service import _parse_int
    assert _parse_int("10,400,439,000,000") == 10_400_439_000_000
    assert _parse_int("31299200") == 31_299_200
    assert _parse_int("") == 0
    assert _parse_int("N/A") == 0
    assert _parse_int(None) == 0


def test_parse_float_handles_na_and_negative():
    from services.ranking_service import _parse_float
    assert _parse_float("-6.40") == pytest.approx(-6.40)
    assert _parse_float("0.00") == pytest.approx(0.0)
    assert _parse_float("N/A") is None
    assert _parse_float("") is None


def test_is_etf_maps_end_types():
    from services.ranking_service import _is_etf
    assert _is_etf("stock") is False
    assert _is_etf("etf") is True
    assert _is_etf("etn") is True
    assert _is_etf("ETF") is True   # case-insensitive
    assert _is_etf("") is False


def test_kr_row_extracts_fields():
    from services.ranking_service import _kr_row
    row = _kr_row(_kr_stock("005930", "삼성전자", "10400439000000", "31299200",
                            end_type="stock", exch="KS", price="329000",
                            ratio="-6.40", mcap="1923425700000000"))
    assert row["ticker"] == "005930"
    assert row["name"] == "삼성전자"
    assert row["price"] == 329000
    assert row["change_pct"] == pytest.approx(-6.40)
    assert row["trading_value"] == 10_400_439_000_000
    assert row["trading_volume"] == 31_299_200
    assert row["market_cap"] == 1_923_425_700_000_000
    assert row["is_etf"] is False
    assert row["exchange"] == "KS"


def test_top_n_by_value_sorts_desc_and_ranks():
    from services.ranking_service import _kr_row, _top_n_by
    rows = [
        _kr_row(_kr_stock("A", "A", value="100", volume="5")),
        _kr_row(_kr_stock("B", "B", value="300", volume="1")),
        _kr_row(_kr_stock("C", "C", value="200", volume="9")),
    ]
    top = _top_n_by(rows, "trading_value")
    assert [r["ticker"] for r in top] == ["B", "C", "A"]
    assert [r["rank"] for r in top] == [1, 2, 3]


def test_top_n_by_change_sorts_desc_and_ranks():
    from services.ranking_service import _kr_row, _top_n_by
    rows = [
        _kr_row(_kr_stock("A", "A", value="100", volume="5", ratio="5.0")),
        _kr_row(_kr_stock("B", "B", value="300", volume="1", ratio="-2.0")),
        _kr_row(_kr_stock("C", "C", value="200", volume="9", ratio="1.0")),
    ]
    top = _top_n_by(rows, "change_pct")
    assert [r["ticker"] for r in top] == ["A", "C", "B"]   # 상승률 내림차순
    assert [r["rank"] for r in top] == [1, 2, 3]


def test_top_n_by_volume_differs_from_value():
    from services.ranking_service import _kr_row, _top_n_by
    rows = [
        _kr_row(_kr_stock("A", "A", value="100", volume="5")),
        _kr_row(_kr_stock("B", "B", value="300", volume="1")),
        _kr_row(_kr_stock("C", "C", value="200", volume="9")),
    ]
    top = _top_n_by(rows, "trading_volume")
    assert [r["ticker"] for r in top] == ["C", "A", "B"]


def test_top_n_limits_to_n():
    from services.ranking_service import _kr_row, _top_n_by
    rows = [_kr_row(_kr_stock(str(i), str(i), value=str(i), volume="1")) for i in range(10)]
    top = _top_n_by(rows, "trading_value", n=3)
    assert len(top) == 3
    assert top[0]["ticker"] == "9"


def test_etf_filter_separates_stock_and_etf():
    from services.ranking_service import _kr_row
    rows = [
        _kr_row(_kr_stock("S", "stock1", "100", "1", end_type="stock")),
        _kr_row(_kr_stock("E", "etf1", "100", "1", end_type="etf")),
        _kr_row(_kr_stock("N", "etn1", "100", "1", end_type="etn")),
    ]
    etfs = [r for r in rows if r["is_etf"]]
    stocks = [r for r in rows if not r["is_etf"]]
    assert {r["ticker"] for r in etfs} == {"E", "N"}
    assert {r["ticker"] for r in stocks} == {"S"}


def test_us_row_computes_trading_value_price_times_volume():
    from services.ranking_service import _us_row
    row = _us_row({
        "symbol": "AAPL",
        "shortName": "Apple Inc.",
        "regularMarketPrice": 150.0,
        "regularMarketVolume": 1_000_000,
        "regularMarketChangePercent": 2.5,
        "marketCap": 3_000_000_000_000,
    })
    assert row["ticker"] == "AAPL"
    assert row["name"] == "Apple Inc."
    assert row["price"] == pytest.approx(150.0)
    assert row["trading_volume"] == 1_000_000
    assert row["trading_value"] == 150_000_000   # price * volume
    assert row["change_pct"] == pytest.approx(2.5)
    assert row["is_etf"] is False
    assert row["exchange"] == "US"


def test_us_row_handles_missing_price_or_volume():
    from services.ranking_service import _us_row
    row = _us_row({"symbol": "X", "shortName": "X Corp"})
    assert row["price"] == pytest.approx(0.0)
    assert row["trading_value"] == 0
    assert row["trading_volume"] == 0


def test_get_kr_rankings_returns_sorted_value_and_volume(monkeypatch):
    import services.ranking_service as svc

    def fake_market(market):
        if market == "KOSPI":
            return [
                _kr_stock("005930", "삼성전자", value="300", volume="2"),
                _kr_stock("069500", "KODEX200", value="50", volume="9", end_type="etf"),
            ]
        return [_kr_stock("035720", "카카오", value="200", volume="5")]

    monkeypatch.setattr(svc, "_fetch_naver_market", fake_market)
    result = svc.get_kr_rankings(n=10)
    assert [r["ticker"] for r in result["value"]] == ["005930", "035720", "069500"]
    assert [r["ticker"] for r in result["volume"]] == ["069500", "035720", "005930"]
    etf_row = next(r for r in result["value"] if r["ticker"] == "069500")
    assert etf_row["is_etf"] is True


def test_get_kr_rankings_includes_change_sorted_desc(monkeypatch):
    import services.ranking_service as svc

    def fake_market(market):
        if market == "KOSPI":
            return [
                _kr_stock("005930", "삼성전자", value="300", volume="2", ratio="0.5"),
                _kr_stock("069500", "KODEX200", value="50", volume="9", end_type="etf", ratio="3.0"),
            ]
        return [_kr_stock("035720", "카카오", value="200", volume="5", ratio="-1.0")]

    monkeypatch.setattr(svc, "_fetch_naver_market", fake_market)
    result = svc.get_kr_rankings(n=10)
    assert "change" in result
    assert [r["ticker"] for r in result["change"]] == ["069500", "005930", "035720"]


def test_get_us_rankings_returns_sorted(monkeypatch):
    import services.ranking_service as svc
    fake = {"quotes": [
        {"symbol": "AAPL", "shortName": "Apple", "regularMarketPrice": 100.0, "regularMarketVolume": 3},
        {"symbol": "F", "shortName": "Ford", "regularMarketPrice": 10.0, "regularMarketVolume": 50},
    ]}
    monkeypatch.setattr(svc.yf, "screen", lambda *a, **k: fake)
    result = svc.get_us_rankings(n=10)
    # value: AAPL=300, F=500 -> F first
    assert [r["ticker"] for r in result["value"]] == ["F", "AAPL"]
    # volume: F=50, AAPL=3 -> F first
    assert [r["ticker"] for r in result["volume"]] == ["F", "AAPL"]
    assert all(r["is_etf"] is False for r in result["value"])


def test_get_us_rankings_includes_change_sorted_desc(monkeypatch):
    import services.ranking_service as svc
    fake = {"quotes": [
        {"symbol": "AAPL", "shortName": "Apple", "regularMarketPrice": 100.0, "regularMarketVolume": 3, "regularMarketChangePercent": 1.0},
        {"symbol": "F", "shortName": "Ford", "regularMarketPrice": 10.0, "regularMarketVolume": 50, "regularMarketChangePercent": 4.0},
    ]}
    monkeypatch.setattr(svc.yf, "screen", lambda *a, **k: fake)
    result = svc.get_us_rankings(n=10)
    assert [r["ticker"] for r in result["change"]] == ["F", "AAPL"]


def test_fetch_naver_market_raises_on_partial_page_failure(monkeypatch):
    """일부 페이지 fetch 실패 시 RuntimeError — 잘린 데이터가 정상 스냅샷을 덮어쓰는 것을 차단."""
    import services.ranking_service as svc

    class _FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"totalCount": 250, "stocks": [_kr_stock("000001", "A", "100", "1")]}

    monkeypatch.setattr(svc.requests, "get", lambda *a, **k: _FakeResp())

    def boom(market, page):
        if page == 3:
            raise RuntimeError("timeout")
        return [_kr_stock("00000" + str(page), "P" + str(page), "10", "1")]

    monkeypatch.setattr(svc, "_fetch_naver_page", boom)
    with pytest.raises(RuntimeError, match="incomplete"):
        svc._fetch_naver_market("KOSPI")


# ── S2: DB 저장/조회 헬퍼 ──

class _FakeCursor:
    def __init__(self, log):
        self._log = log

    def execute(self, sql, params=None):
        self._log.append((sql, params))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeConn:
    def __init__(self, log):
        self._cursor = _FakeCursor(log)

    def cursor(self):
        return self._cursor

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _fake_get_connection(log):
    from contextlib import contextmanager

    @contextmanager
    def _cm():
        yield _FakeConn(log)

    return _cm


def test_replace_market_rankings_deletes_then_inserts_both_metrics(monkeypatch):
    import services.ranking_service as svc
    log: list = []
    monkeypatch.setattr(svc, "get_connection", _fake_get_connection(log))

    rankings = {
        "value": [
            {"rank": 1, "ticker": "005930", "name": "삼성전자", "price": 70000,
             "change_pct": -1.2, "trading_value": 300, "trading_volume": 2,
             "market_cap": 5_000_000, "is_etf": False, "exchange": "KS"},
        ],
        "volume": [
            {"rank": 1, "ticker": "069500", "name": "KODEX200", "price": 30000,
             "change_pct": 0.5, "trading_value": 50, "trading_volume": 9,
             "market_cap": 1_000_000, "is_etf": True, "exchange": "KS"},
        ],
    }
    svc.replace_market_rankings("KR", rankings)

    # first statement is the DELETE scoped to market
    assert "DELETE FROM market_rankings" in log[0][0]
    assert log[0][1] == ("KR",)
    # then one INSERT per metric row (value + volume)
    inserts = [s for s in log[1:] if "INSERT INTO market_rankings" in s[0]]
    assert len(inserts) == 2
    metrics_inserted = {s[1][1] for s in inserts}
    assert metrics_inserted == {"value", "volume"}
    # the value-metric insert carries the value row's ticker
    value_insert = next(s for s in inserts if s[1][1] == "value")
    assert value_insert[1][0] == "KR"        # market
    assert value_insert[1][3] == "005930"    # ticker
    assert value_insert[1][10] is False      # is_etf


def test_replace_market_rankings_inserts_change_metric(monkeypatch):
    import services.ranking_service as svc
    log: list = []
    monkeypatch.setattr(svc, "get_connection", _fake_get_connection(log))

    rankings = {
        "value": [
            {"rank": 1, "ticker": "V", "name": "v", "price": 1, "change_pct": 0.1,
             "trading_value": 3, "trading_volume": 1, "market_cap": 9, "is_etf": False, "exchange": "KS"},
        ],
        "volume": [
            {"rank": 1, "ticker": "VOL", "name": "vol", "price": 1, "change_pct": 0.2,
             "trading_value": 1, "trading_volume": 9, "market_cap": 9, "is_etf": False, "exchange": "KS"},
        ],
        "change": [
            {"rank": 1, "ticker": "CHG", "name": "chg", "price": 1, "change_pct": 5.0,
             "trading_value": 2, "trading_volume": 2, "market_cap": 9, "is_etf": False, "exchange": "KS"},
        ],
    }
    svc.replace_market_rankings("KR", rankings)

    inserts = [s for s in log[1:] if "INSERT INTO market_rankings" in s[0]]
    assert len(inserts) == 3
    metrics_inserted = {s[1][1] for s in inserts}
    assert metrics_inserted == {"value", "volume", "change"}
    change_insert = next(s for s in inserts if s[1][1] == "change")
    assert change_insert[1][3] == "CHG"     # ticker


def test_read_rankings_returns_rows_and_iso_base_ts(monkeypatch):
    import services.ranking_service as svc
    from datetime import datetime, timezone

    ts = datetime(2026, 6, 6, 1, 30, tzinfo=timezone.utc)
    captured: list = []

    def fake_query(sql, params=None):
        captured.append((sql, params))
        return [{"rank": 1, "ticker": "005930", "name": "삼성전자", "price": 70000,
                 "change_pct": -1.2, "trading_value": 300, "trading_volume": 2,
                 "market_cap": 5_000_000, "is_etf": False, "exchange": "KS", "base_ts": ts}]

    monkeypatch.setattr(svc, "query", fake_query)
    out = svc.read_rankings("KR", "value", type_filter="all", limit=50, offset=0)
    assert out["rows"][0]["ticker"] == "005930"
    assert out["base_ts"] == ts.isoformat()
    # all filter -> no is_etf predicate; limit/offset appended after market/metric
    sql, params = captured[0]
    assert "is_etf =" not in sql
    assert params == ("KR", "value", 50, 0)


def test_read_rankings_type_filter_adds_is_etf_predicate(monkeypatch):
    import services.ranking_service as svc
    captured: list = []
    monkeypatch.setattr(svc, "query", lambda sql, params=None: captured.append((sql, params)) or [])

    svc.read_rankings("US", "volume", type_filter="stock", limit=20, offset=40)
    sql, _ = captured[0]
    assert "is_etf = FALSE" in sql

    captured.clear()
    svc.read_rankings("KR", "value", type_filter="etf")
    sql, _ = captured[0]
    assert "is_etf = TRUE" in sql


def test_read_rankings_empty_returns_null_base_ts(monkeypatch):
    import services.ranking_service as svc
    monkeypatch.setattr(svc, "query", lambda sql, params=None: [])
    out = svc.read_rankings("KR", "value")
    assert out["rows"] == []
    assert out["base_ts"] is None

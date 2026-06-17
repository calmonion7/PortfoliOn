import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from datetime import date


# ── replace_recommendations (시장 단위 교체: DELETE market + per-ticker upsert) ──

def test_replace_recommendations_deletes_market_then_upserts(monkeypatch):
    """한 시장을 통째 교체 — 기존 행 DELETE 후 각 row upsert(ON CONFLICT)."""
    from services.recommendation import store
    calls = []
    monkeypatch.setattr(store, "execute", lambda sql, params=None: calls.append((sql, params)))

    store.replace_recommendations("KR", [
        {"ticker": "005930", "market": "KR", "score": 88.5,
         "factors": {"value": {"upside_pct": 28.0}}, "flags": [{"label": "목표가 대비 +28%", "kind": "value"}],
         "rank": 1, "base_date": date(2026, 6, 18)},
        {"ticker": "000660", "market": "KR", "score": 71.0,
         "factors": {}, "flags": [], "rank": 2, "base_date": date(2026, 6, 18)},
    ])

    # 첫 호출 = market 삭제
    del_sql, del_params = calls[0]
    assert "DELETE FROM stock_recommendations" in del_sql
    assert "market = %s" in del_sql
    assert del_params == ("KR",)

    # 이후 행마다 upsert(ON CONFLICT (ticker))
    assert len(calls) == 3
    ins_sql, ins_params = calls[1]
    assert "INSERT INTO stock_recommendations" in ins_sql
    assert "ON CONFLICT (ticker) DO UPDATE" in ins_sql
    assert ins_params[0] == "005930"
    assert ins_params[1] == "KR"
    assert ins_params[2] == 88.5
    # factors·flags는 JSON 직렬화 문자열
    assert '"upside_pct"' in ins_params[3]
    assert '"목표가 대비 +28%"' in ins_params[4]
    assert ins_params[5] == 1
    assert ins_params[6] == date(2026, 6, 18)


def test_replace_recommendations_empty_rows_only_deletes(monkeypatch):
    """rows가 비면 DELETE만 수행(insert 없음)."""
    from services.recommendation import store
    calls = []
    monkeypatch.setattr(store, "execute", lambda sql, params=None: calls.append((sql, params)))

    store.replace_recommendations("US", [])
    assert len(calls) == 1
    assert "DELETE FROM stock_recommendations" in calls[0][0]


# ── read_recommendations (점수순 정렬, 필터, limit, name 조인) ──

def _captured_query(monkeypatch, rows):
    from services.recommendation import store
    cap = {}

    def fake_query(sql, params=None):
        cap["sql"] = sql
        cap["params"] = params
        return rows

    monkeypatch.setattr(store, "query", fake_query)
    return cap


def test_read_recommendations_orders_by_score_desc(monkeypatch):
    from services.recommendation import store
    cap = _captured_query(monkeypatch, [
        {"ticker": "005930", "name": "삼성전자", "market": "KR", "score": 88.5,
         "flags": [{"label": "목표가 대비 +28%", "kind": "value"}], "rank": 1, "base_date": date(2026, 6, 18)},
    ])
    out = store.read_recommendations()
    assert "ORDER BY score DESC" in cap["sql"]
    assert out[0]["ticker"] == "005930"
    assert out[0]["name"] == "삼성전자"


def test_read_recommendations_markets_filter(monkeypatch):
    from services.recommendation import store
    cap = _captured_query(monkeypatch, [])
    store.read_recommendations(markets=["KR"])
    assert "market = ANY(%s)" in cap["sql"]
    assert ["KR"] in cap["params"]


def test_read_recommendations_exclude_tickers(monkeypatch):
    from services.recommendation import store
    cap = _captured_query(monkeypatch, [])
    store.read_recommendations(exclude_tickers=["005930", "AAPL"])
    assert "NOT (" in cap["sql"] or "!= ALL(%s)" in cap["sql"]
    assert ["005930", "AAPL"] in cap["params"]


def test_read_recommendations_only_tickers(monkeypatch):
    from services.recommendation import store
    cap = _captured_query(monkeypatch, [])
    store.read_recommendations(only_tickers=["005930"])
    assert "= ANY(%s)" in cap["sql"]
    assert ["005930"] in cap["params"]


def test_read_recommendations_limit(monkeypatch):
    from services.recommendation import store
    cap = _captured_query(monkeypatch, [])
    store.read_recommendations(limit=20)
    assert "LIMIT %s" in cap["sql"]
    assert 20 in cap["params"]


def test_read_recommendations_empty_only_tickers_returns_empty_without_query(monkeypatch):
    """only_tickers=[](교집합 빈 집합)이면 쿼리 없이 빈 결과(관심/보유 0종목 섹션)."""
    from services.recommendation import store
    called = {"q": False}
    monkeypatch.setattr(store, "query", lambda *a, **k: called.__setitem__("q", True) or [])
    out = store.read_recommendations(only_tickers=[])
    assert out == []
    assert called["q"] is False

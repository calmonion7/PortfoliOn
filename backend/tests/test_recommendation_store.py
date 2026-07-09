import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from datetime import date
from contextlib import contextmanager


def _mock_get_connection(monkeypatch, calls):
    """store.get_connection patch — cur.execute 호출을 calls에 (sql, params) 기록
    (단일 트랜잭션화(S4) 이후에도 옛 execute() 모킹과 동형 assertion을 유지)."""
    from services.recommendation import store

    class FakeCur:
        def execute(self, sql, params=None):
            calls.append((sql, params))
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False

    class FakeConn:
        def cursor(self):
            return FakeCur()

    @contextmanager
    def fake_conn():
        yield FakeConn()

    monkeypatch.setattr(store, "get_connection", fake_conn)


# ── replace_recommendations (시장 단위 교체: DELETE market + per-ticker upsert) ──

def test_replace_recommendations_deletes_market_then_upserts(monkeypatch):
    """한 시장을 통째 교체 — 기존 행 DELETE 후 각 row upsert(ON CONFLICT)."""
    from services.recommendation import store
    calls = []
    _mock_get_connection(monkeypatch, calls)

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
    # [2]=name (S3 추가), [3]=score, [4]=factors, [5]=flags, [6]=rank, [7]=base_date
    assert ins_params[3] == 88.5
    # factors·flags는 JSON 직렬화 문자열
    assert '"upside_pct"' in ins_params[4]
    assert '"목표가 대비 +28%"' in ins_params[5]
    assert ins_params[6] == 1
    assert ins_params[7] == date(2026, 6, 18)


def test_replace_recommendations_includes_low_liquidity(monkeypatch):
    """INSERT에 low_liquidity 컬럼·값(row.get('low_liquidity', False))을 8번째로 포함."""
    from services.recommendation import store
    calls = []
    _mock_get_connection(monkeypatch, calls)

    store.replace_recommendations("KR", [
        {"ticker": "005930", "market": "KR", "score": 88.5, "factors": {}, "flags": [],
         "rank": 1, "base_date": date(2026, 6, 18), "low_liquidity": True},
        {"ticker": "000660", "market": "KR", "score": 71.0, "factors": {}, "flags": [],
         "rank": 2, "base_date": date(2026, 6, 18)},
    ])

    ins_sql, ins_params = calls[1]
    assert "low_liquidity" in ins_sql
    # [2]=name, [3]=score, [4]=factors, [5]=flags, [6]=rank, [7]=base_date, [8]=low_liquidity (S3 인덱스 이동)
    assert ins_params[8] is True
    # 누락 시 기본 False
    _, ins2_params = calls[2]
    assert ins2_params[8] is False


def test_replace_recommendations_includes_exchange(monkeypatch):
    """INSERT에 exchange 컬럼·값(row.get('exchange') or '')을 9번째로 포함."""
    from services.recommendation import store
    calls = []
    _mock_get_connection(monkeypatch, calls)

    store.replace_recommendations("KR", [
        {"ticker": "005930", "market": "KR", "score": 88.5, "factors": {}, "flags": [],
         "rank": 1, "base_date": date(2026, 6, 18), "exchange": "KQ"},
        {"ticker": "000660", "market": "KR", "score": 71.0, "factors": {}, "flags": [],
         "rank": 2, "base_date": date(2026, 6, 18)},  # exchange 누락 → ''
    ])

    ins_sql, ins_params = calls[1]
    assert "exchange" in ins_sql
    assert "EXCLUDED.exchange" in ins_sql
    # [2]=name, [3]=score, [4]=factors, [5]=flags, [6]=rank, [7]=base_date, [8]=low_liquidity, [9]=exchange (S3 인덱스 이동)
    assert ins_params[9] == "KQ"
    # 누락 시 기본 ''
    _, ins2_params = calls[2]
    assert ins2_params[9] == ""


def test_read_recommendations_selects_exchange(monkeypatch):
    """SELECT에 r.exchange 포함, 반환 dict에 exchange 보존."""
    from services.recommendation import store
    cap = _captured_query(monkeypatch, [
        {"ticker": "005930", "name": "삼성전자", "market": "KR", "score": 88.5,
         "flags": [], "rank": 1, "base_date": date(2026, 6, 18), "exchange": "KQ"},
    ])
    out = store.read_recommendations()
    assert "r.exchange" in cap["sql"]
    assert out[0]["exchange"] == "KQ"


def test_replace_recommendations_empty_rows_only_deletes(monkeypatch):
    """rows가 비면 DELETE만 수행(insert 없음)."""
    from services.recommendation import store
    calls = []
    _mock_get_connection(monkeypatch, calls)

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


def test_read_recommendations_exclude_low_liquidity(monkeypatch):
    """exclude_low_liquidity=True면 WHERE에 low_liquidity = FALSE 절 추가."""
    from services.recommendation import store
    cap = _captured_query(monkeypatch, [])
    store.read_recommendations(exclude_low_liquidity=True)
    assert "r.low_liquidity = FALSE" in cap["sql"]


def test_read_recommendations_default_keeps_low_liquidity(monkeypatch):
    """기본(exclude_low_liquidity=False)이면 low_liquidity 절 미포함."""
    from services.recommendation import store
    cap = _captured_query(monkeypatch, [])
    store.read_recommendations()
    assert "low_liquidity" not in cap["sql"]


def test_read_recommendations_empty_only_tickers_returns_empty_without_query(monkeypatch):
    """only_tickers=[](교집합 빈 집합)이면 쿼리 없이 빈 결과(관심/보유 0종목 섹션)."""
    from services.recommendation import store
    called = {"q": False}
    monkeypatch.setattr(store, "query", lambda *a, **k: called.__setitem__("q", True) or [])
    out = store.read_recommendations(only_tickers=[])
    assert out == []
    assert called["q"] is False


# ── S3 (a) name COALESCE: 마스터에 없고 저장 name 있는 행 → 저장 name 반환 ──
# 구 코드: SELECT r.ticker, t.name ... → t.name=NULL(마스터 없음) → name=null (red)

def test_read_recommendations_coalesce_stored_name_when_master_absent(monkeypatch):
    """tickers 마스터에 없는 US 미추적 종목 행은 저장된 r.name으로 반환된다(null 아님)."""
    from services.recommendation import store

    # query가 반환하는 행: t.name=None(마스터 없음), r.name='Apple Inc.'(저장)
    # 구 코드는 SELECT에 r.name이 없어 t.name만 반환 → null
    # 신 코드는 COALESCE(t.name, r.name) → 'Apple Inc.'
    cap = _captured_query(monkeypatch, [
        {"ticker": "AAPL", "name": "Apple Inc.", "market": "US", "score": 75.0,
         "flags": [], "rank": 1, "base_date": date(2026, 7, 2), "exchange": ""},
    ])
    out = store.read_recommendations()
    # SQL에 COALESCE + r.name 포함 단언
    assert "COALESCE" in cap["sql"], "SELECT에 COALESCE(t.name, r.name)가 필요하다"
    assert "r.name" in cap["sql"], "r.name이 SELECT에 포함돼야 한다"
    assert out[0]["name"] == "Apple Inc."


def test_replace_recommendations_stores_name(monkeypatch):
    """INSERT에 name 컬럼·값이 포함된다."""
    from services.recommendation import store
    calls = []
    _mock_get_connection(monkeypatch, calls)

    store.replace_recommendations("US", [
        {"ticker": "AAPL", "market": "US", "score": 75.0,
         "factors": {}, "flags": [], "rank": 1, "base_date": date(2026, 7, 2),
         "name": "Apple Inc."},
    ])

    ins_sql, ins_params = calls[1]
    assert "name" in ins_sql, "INSERT에 name 컬럼이 있어야 한다"
    assert "EXCLUDED.name" in ins_sql, "ON CONFLICT에 name 갱신이 있어야 한다"
    assert "Apple Inc." in ins_params, "name 값이 파라미터에 포함돼야 한다"

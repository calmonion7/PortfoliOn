import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


class _FakeJsonResp:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


# ── _num: 방어적 숫자 정규화(부호 보존·파싱 실패 None) ──

def test_num_normalizes_and_preserves_sign():
    from services import insider_trades as svc
    assert svc._num("1,234") == 1234
    assert svc._num("-500") == -500          # 순매도 부호 보존
    assert svc._num("-") is None
    assert svc._num("") is None
    assert svc._num(None) is None
    assert svc._num("garbage") is None
    assert svc._num("12.50", integer=False) == 12.5
    assert svc._num("1,234", integer=False) == 1234.0


# ── S2: fetch_insider_trades (elestock/majorstock 매핑·skip·graceful) ──

def test_fetch_maps_elestock_and_majorstock(monkeypatch):
    """두 엔드포인트를 각각 호출하고 서로 다른 스키마를 한 line item으로 정규화한다."""
    from services import insider_trades as svc
    captured = []

    def fake_get(url, params=None, timeout=None):
        captured.append(url)
        if url.endswith("elestock.json"):
            return _FakeJsonResp({"status": "000", "list": [{
                "rcept_no": "20260515000001", "rcept_dt": "20260515",
                "corp_code": "00126380", "corp_name": "삼성전자",
                "repror": "홍길동", "isu_exctv_ofcps": "대표이사",
                "sp_stock_lmp_irds_cnt": "1,000",
                "sp_stock_lmp_cnt": "10,000", "sp_stock_lmp_rate": "0.50",
            }]})
        # majorstock.json — 순매도(음수 증감)
        return _FakeJsonResp({"status": "000", "list": [{
            "rcept_no": "20260510000002", "rcept_dt": "20260510",
            "corp_code": "00126380", "corp_name": "삼성전자",
            "repror": "국민연금", "report_tp": "변동",
            "stkqy_irds": "-2,000",
            "stkqy": "500,000", "stkrt": "5.20",
        }]})

    monkeypatch.setattr(svc.requests, "get", fake_get)
    rows = svc.fetch_insider_trades("00126380", days=30)

    assert any(u.endswith("elestock.json") for u in captured)
    assert any(u.endswith("majorstock.json") for u in captured)
    assert len(rows) == 2

    ins = next(r for r in rows if r["report_kind"] == "insider")
    assert ins["repror"] == "홍길동"
    assert ins["rel"] == "대표이사"
    assert ins["shares_change"] == 1000
    assert ins["shares_after"] == 10000
    assert ins["rate_after"] == 0.5
    assert ins["rcept_no"] == "20260515000001"

    maj = next(r for r in rows if r["report_kind"] == "major5")
    assert maj["repror"] == "국민연금"
    assert maj["rel"] == "변동"
    assert maj["shares_change"] == -2000     # 순매도 부호 보존
    assert maj["shares_after"] == 500000
    assert maj["rate_after"] == 5.2


def test_fetch_skips_rows_with_unparseable_change(monkeypatch):
    """증감수 파싱 불가('-'·결측) 행은 skip(기본값 폴백 금지)."""
    from services import insider_trades as svc

    def fake_get(url, params=None, timeout=None):
        if url.endswith("elestock.json"):
            return _FakeJsonResp({"status": "000", "list": [
                {"rcept_no": "A1", "rcept_dt": "20260101", "repror": "정상",
                 "isu_exctv_ofcps": "이사", "sp_stock_lmp_irds_cnt": "100",
                 "sp_stock_lmp_cnt": "200", "sp_stock_lmp_rate": "1.0"},
                {"rcept_no": "A2", "rcept_dt": "20260101", "repror": "증감없음",
                 "isu_exctv_ofcps": "이사", "sp_stock_lmp_irds_cnt": "-",
                 "sp_stock_lmp_cnt": "200", "sp_stock_lmp_rate": "1.0"},
                {"rcept_no": "", "rcept_dt": "20260101", "repror": "접수번호없음",
                 "isu_exctv_ofcps": "이사", "sp_stock_lmp_irds_cnt": "5",
                 "sp_stock_lmp_cnt": "10", "sp_stock_lmp_rate": "0.1"},
            ]})
        return _FakeJsonResp({"status": "013"})

    monkeypatch.setattr(svc.requests, "get", fake_get)
    rows = svc.fetch_insider_trades("00126380")
    assert len(rows) == 1
    assert rows[0]["repror"] == "정상"


def test_fetch_graceful_on_status_013_and_error(monkeypatch):
    """status 013(무데이터)·예외 모두 빈 리스트로 graceful."""
    from services import insider_trades as svc

    monkeypatch.setattr(svc.requests, "get",
                        lambda *a, **k: _FakeJsonResp({"status": "013"}))
    assert svc.fetch_insider_trades("00126380") == []

    def boom(*a, **k):
        raise RuntimeError("network down")

    monkeypatch.setattr(svc.requests, "get", boom)
    assert svc.fetch_insider_trades("00126380") == []


def test_fetch_passes_recent_window(monkeypatch):
    """bgn_de는 days 전, end_de는 오늘."""
    from datetime import datetime, timedelta
    from services import insider_trades as svc
    captured = {}

    def fake_get(url, params=None, timeout=None):
        captured["bgn_de"] = params.get("bgn_de")
        captured["end_de"] = params.get("end_de")
        captured["corp_code"] = params.get("corp_code")
        return _FakeJsonResp({"status": "013"})

    monkeypatch.setattr(svc.requests, "get", fake_get)
    svc.fetch_insider_trades("00164742", days=30)
    assert captured["bgn_de"] == (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
    assert captured["end_de"] == datetime.now().strftime("%Y%m%d")
    assert captured["corp_code"] == "00164742"


def test_fetch_reuses_backlog_corp_code_map():
    """corp_code 매핑은 backlog._get_corp_code_map 재사용."""
    from services import insider_trades as svc
    from services import backlog
    assert svc._get_corp_code_map is backlog._get_corp_code_map


# ── 멱등성: 같은 행 2회 적재 → row_hash 동일(중복 0) ──

def test_row_hash_is_deterministic_and_distinguishes_rows():
    from services import insider_trades as svc
    h1 = svc._row_hash("R1", "insider", "홍길동", 1000, 10000, 0.5)
    h2 = svc._row_hash("R1", "insider", "홍길동", 1000, 10000, 0.5)
    assert h1 == h2                                     # 동일 행 → 동일 해시(멱등)
    # 같은 rcept_no라도 다른 보고자/증감은 다른 행
    assert h1 != svc._row_hash("R1", "insider", "김철수", 1000, 10000, 0.5)
    assert h1 != svc._row_hash("R1", "insider", "홍길동", -1000, 10000, 0.5)


def test_upsert_dedups_on_row_hash(monkeypatch):
    """upsert는 row_hash 충돌 시 갱신 — 같은 종목 2회 적재해도 동일 해시(중복 0).
    S4: execute_many 1콜로 배치화됐으므로 execute_many를 mock."""
    from services import insider_trades as svc
    calls = []
    monkeypatch.setattr(svc, "execute_many", lambda sql, params_list: calls.append((sql, params_list)))

    rows = [{
        "report_kind": "insider", "rcept_no": "R1", "rcept_dt": "20260515",
        "repror": "홍길동", "rel": "대표이사",
        "shares_change": 1000, "shares_after": 10000, "rate_after": 0.5,
    }]
    svc.upsert_insider_trades("005930.KS", rows)
    svc.upsert_insider_trades("005930.KS", rows)   # 2회차

    assert len(calls) == 2
    sql, params_list = calls[0]
    assert "INSERT INTO stock_insider_trades" in sql
    assert "ON CONFLICT (row_hash) DO UPDATE" in sql
    assert params_list[0][1] == "005930.KS"                 # ticker upper
    # 두 호출의 row_hash(PK)가 동일 → DB에서 중복 0
    assert calls[0][1][0][0] == calls[1][1][0][0]


def test_get_insider_trades_orders_latest_and_adds_url(monkeypatch):
    from services import insider_trades as svc
    cap = {}

    def fake_query(sql, params):
        cap["sql"] = sql
        cap["params"] = params
        return [{
            "rcept_no": "20260515000001", "rcept_dt": "20260515",
            "report_kind": "insider", "repror": "홍길동", "rel": "대표이사",
            "shares_change": 1000, "shares_after": 10000, "rate_after": 0.5,
        }]

    monkeypatch.setattr(svc, "query", fake_query)
    rows = svc.get_insider_trades("005930.KS", limit=10)
    assert "ORDER BY rcept_dt DESC" in cap["sql"]
    assert cap["params"] == ("005930.KS", 10)
    assert rows[0]["dart_url"] == "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260515000001"
    assert rows[0]["rcept_dt"] == "20260515"


def test_fetch_and_save_skips_without_corp_code(monkeypatch):
    from services import insider_trades as svc
    monkeypatch.setattr(svc, "_corp_code", lambda t: None)
    monkeypatch.setattr(svc, "get_insider_trades", lambda t: [])
    upserts = []
    monkeypatch.setattr(svc, "upsert_insider_trades", lambda t, r: upserts.append(t))
    assert svc.fetch_and_save("AAPL") == []
    assert upserts == []


def test_fetch_all_filters_kr_holding_watchlist(monkeypatch):
    """커버리지 = KR + type∈{holding,watchlist} union."""
    from services import insider_trades as svc
    cap = {}

    def fake_query(sql, params=None):
        cap["sql"] = sql
        return [{"ticker": "005930.KS"}, {"ticker": "000660.KS"}]

    calls = []
    monkeypatch.setattr(svc, "query", fake_query)
    monkeypatch.setattr(svc, "fetch_and_save", lambda t: calls.append(t))

    result = svc.fetch_all_insider_trades()
    assert "market = 'KR'" in cap["sql"]
    assert "holding" in cap["sql"] and "watchlist" in cap["sql"]
    assert calls == ["005930.KS", "000660.KS"]
    assert result == {"total": 2, "ok": 2, "failed": 0}


def test_fetch_all_continues_on_error(monkeypatch):
    from services import insider_trades as svc
    monkeypatch.setattr(svc, "query", lambda sql, params=None: [{"ticker": "A"}, {"ticker": "B"}])

    def flaky(t):
        if t == "A":
            raise RuntimeError("boom")

    monkeypatch.setattr(svc, "fetch_and_save", flaky)
    assert svc.fetch_all_insider_trades() == {"total": 2, "ok": 1, "failed": 1}


# ── S3: compute_net_signal (부호·합이 raw 증감 합과 일치) ──

def test_compute_net_signal_buy(monkeypatch):
    from services import insider_trades as svc
    # raw 증감: +1000, +500, -200 = +1300 → buy
    monkeypatch.setattr(svc, "query",
                        lambda sql, params: [{"net_shares": 1300, "cnt": 3}])
    sig = svc.compute_net_signal("005930.KS")
    assert sig == {"direction": "buy", "net_shares": 1300, "count": 3, "window_days": 90}


def test_compute_net_signal_sell(monkeypatch):
    from services import insider_trades as svc
    monkeypatch.setattr(svc, "query",
                        lambda sql, params: [{"net_shares": -5000, "cnt": 2}])
    sig = svc.compute_net_signal("000660.KS")
    assert sig["direction"] == "sell"
    assert sig["net_shares"] == -5000
    assert sig["count"] == 2


def test_compute_net_signal_neutral_empty(monkeypatch):
    from services import insider_trades as svc
    monkeypatch.setattr(svc, "query",
                        lambda sql, params: [{"net_shares": 0, "cnt": 0}])
    sig = svc.compute_net_signal("005930.KS")
    assert sig == {"direction": "neutral", "net_shares": 0, "count": 0, "window_days": 90}


def test_compute_net_signal_passes_window(monkeypatch):
    from services import insider_trades as svc
    cap = {}

    def fake_query(sql, params):
        cap["sql"] = sql
        cap["params"] = params
        return [{"net_shares": 0, "cnt": 0}]

    monkeypatch.setattr(svc, "query", fake_query)
    svc.compute_net_signal("005930.KS")
    assert "SUM(shares_change)" in cap["sql"]
    assert cap["params"] == ("005930.KS", 90)          # INSIDER_NET_WINDOW_DAYS 기본
    assert svc.INSIDER_NET_WINDOW_DAYS == 90


# ── S1: main._migrate가 stock_insider_trades DDL 발행 ──

def test_migrate_creates_stock_insider_trades(monkeypatch):
    import main
    ddl = []
    import services.db as db
    monkeypatch.setattr(db, "execute", lambda sql, *a, **k: ddl.append(sql))
    main._migrate()
    joined = "\n".join(ddl)
    assert "CREATE TABLE IF NOT EXISTS stock_insider_trades" in joined
    assert "row_hash TEXT PRIMARY KEY" in joined
    assert "idx_insider_read" in joined

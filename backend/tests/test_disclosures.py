import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


class _FakeJsonResp:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


# ── S1: fetch_disclosures (per-type list.json → 핵심유형 stamp · 파싱 · URL) ──

def test_fetch_disclosures_queries_core_types_and_stamps(monkeypatch):
    """A/B/C/D 각각을 개별 호출하고, 응답에 없는 pblntf_ty를 질의값으로 stamp한다."""
    from services import disclosures as svc

    captured_types = []

    def fake_get(url, params=None, timeout=None):
        ty = params["pblntf_ty"]
        captured_types.append(ty)
        if ty == "A":
            return _FakeJsonResp({"status": "000", "list": [{
                "corp_code": "00126380", "corp_name": "삼성전자", "stock_code": "005930",
                "report_nm": "분기보고서 (2026.03)              ",
                "rcept_no": "20260515000001", "rcept_dt": "20260515",
            }]})
        if ty == "B":
            return _FakeJsonResp({"status": "000", "list": [{
                "corp_code": "00126380", "corp_name": "삼성전자", "stock_code": "005930",
                "report_nm": "주요사항보고서(자기주식취득결정)",
                "rcept_no": "20260510000002", "rcept_dt": "20260510",
            }]})
        # C: status 013 = 데이터 없음 (graceful)
        if ty == "C":
            return _FakeJsonResp({"status": "013", "message": "조회된 데이타가 없습니다."})
        # D
        return _FakeJsonResp({"status": "000", "list": [{
            "corp_code": "00126380", "corp_name": "삼성전자", "stock_code": "005930",
            "report_nm": "임원ㆍ주요주주특정증권등소유상황보고서",
            "rcept_no": "20260505000003", "rcept_dt": "20260505",
        }]})

    monkeypatch.setattr(svc.requests, "get", fake_get)

    rows = svc.fetch_disclosures("00126380", days=30)

    # 핵심 4유형 모두 질의
    assert set(captured_types) == {"A", "B", "C", "D"}
    # status 013(데이터 없음)은 빈 결과로 graceful
    types = {r["pblntf_ty"] for r in rows}
    assert types == {"A", "B", "D"}
    a = next(r for r in rows if r["pblntf_ty"] == "A")
    assert a["rcept_no"] == "20260515000001"
    assert a["rcept_dt"] == "20260515"
    assert a["report_nm"] == "분기보고서 (2026.03)"  # trailing whitespace 제거
    assert a["corp_name"] == "삼성전자"
    assert a["dart_url"] == "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260515000001"


def test_fetch_disclosures_passes_recent_window(monkeypatch):
    """bgn_de를 days 전으로 계산해 넘긴다."""
    from datetime import datetime, timedelta
    from services import disclosures as svc

    captured = {}

    def fake_get(url, params=None, timeout=None):
        captured.setdefault("bgn_de", params.get("bgn_de"))
        captured.setdefault("corp_code", params.get("corp_code"))
        return _FakeJsonResp({"status": "013"})

    monkeypatch.setattr(svc.requests, "get", fake_get)
    svc.fetch_disclosures("00164742", days=45)

    expected = (datetime.now() - timedelta(days=45)).strftime("%Y%m%d")
    assert captured["bgn_de"] == expected
    assert captured["corp_code"] == "00164742"


def test_fetch_disclosures_graceful_on_error(monkeypatch):
    """DART 호출 예외/HTTP 에러는 빈 리스트로 graceful."""
    from services import disclosures as svc

    def boom(*a, **k):
        raise RuntimeError("network down")

    monkeypatch.setattr(svc.requests, "get", boom)
    assert svc.fetch_disclosures("00126380") == []


def test_fetch_disclosures_skips_items_without_rcept_no(monkeypatch):
    """rcept_no 없는 항목은 제외(저장 키가 없어 무의미)."""
    from services import disclosures as svc

    def fake_get(url, params=None, timeout=None):
        if params["pblntf_ty"] == "A":
            return _FakeJsonResp({"status": "000", "list": [
                {"corp_name": "X", "report_nm": "정상", "rcept_no": "20260101000001", "rcept_dt": "20260101"},
                {"corp_name": "X", "report_nm": "rcept_no 없음", "rcept_no": "", "rcept_dt": "20260101"},
            ]})
        return _FakeJsonResp({"status": "013"})

    monkeypatch.setattr(svc.requests, "get", fake_get)
    rows = svc.fetch_disclosures("00126380")
    assert len(rows) == 1
    assert rows[0]["report_nm"] == "정상"


def test_fetch_disclosures_reuses_backlog_corp_code_map():
    """corp_code 매핑은 backlog._get_corp_code_map을 재사용한다(중복 구현 금지)."""
    from services import disclosures as svc
    from services import backlog
    assert svc._get_corp_code_map is backlog._get_corp_code_map


# ── S2: 저장소 (rcept_no dedup upsert · 최신순 조회) ──

def test_upsert_disclosures_dedups_on_rcept_no(monkeypatch):
    """upsert SQL은 rcept_no 충돌 시 갱신(중복 재수집이 행 수를 늘리지 않게)."""
    from services import disclosures as svc
    calls = []
    monkeypatch.setattr(svc, "execute", lambda sql, params: calls.append((sql, params)))

    svc.upsert_disclosures("005930.KS", [{
        "rcept_no": "20260515000001", "rcept_dt": "20260515",
        "report_nm": "분기보고서", "pblntf_ty": "A", "corp_name": "삼성전자",
    }])

    assert len(calls) == 1
    sql, params = calls[0]
    assert "INSERT INTO stock_disclosures" in sql
    assert "ON CONFLICT (rcept_no) DO UPDATE" in sql
    assert params[0] == "005930.KS"  # ticker upper
    assert params[1] == "20260515000001"


def test_get_disclosures_orders_latest_first_and_adds_url(monkeypatch):
    """get_disclosures는 rcept_dt desc 최신순 + dart_url 부여, limit 전달."""
    from services import disclosures as svc
    cap = {}

    def fake_query(sql, params):
        cap["sql"] = sql
        cap["params"] = params
        return [{
            "rcept_no": "20260515000001", "rcept_dt": "20260515",
            "report_nm": "분기보고서", "pblntf_ty": "A", "corp_name": "삼성전자",
        }]

    monkeypatch.setattr(svc, "query", fake_query)
    rows = svc.get_disclosures("005930.KS", limit=10)

    assert "ORDER BY rcept_dt DESC" in cap["sql"]
    assert cap["params"] == ("005930.KS", 10)
    assert rows[0]["dart_url"] == "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260515000001"
    assert rows[0]["rcept_dt"] == "20260515"


def test_fetch_and_save_skips_when_no_corp_code(monkeypatch):
    """corp_code 없으면(US/미매핑) 수집하지 않고 저장값만 반환(graceful 스킵)."""
    from services import disclosures as svc
    monkeypatch.setattr(svc, "_corp_code", lambda t: None)
    monkeypatch.setattr(svc, "get_disclosures", lambda t: [])
    upserts = []
    monkeypatch.setattr(svc, "upsert_disclosures", lambda t, r: upserts.append(t))
    assert svc.fetch_and_save("AAPL") == []
    assert upserts == []


def test_fetch_all_disclosures_filters_kr_holding_watchlist(monkeypatch):
    """KR + type∈{holding,watchlist}만 수집(US/비-KR 스킵)."""
    from services import disclosures as svc
    cap = {}

    def fake_query(sql, params=None):
        cap["sql"] = sql
        return [{"ticker": "005930.KS"}, {"ticker": "000660.KS"}]

    calls = []
    monkeypatch.setattr(svc, "query", fake_query)
    monkeypatch.setattr(svc, "fetch_and_save", lambda t: calls.append(t))

    result = svc.fetch_all_disclosures()
    assert "market = 'KR'" in cap["sql"]
    assert "holding" in cap["sql"] and "watchlist" in cap["sql"]
    assert calls == ["005930.KS", "000660.KS"]
    assert result == {"total": 2, "ok": 2, "failed": 0}


def test_fetch_all_disclosures_continues_on_error(monkeypatch):
    from services import disclosures as svc
    monkeypatch.setattr(svc, "query", lambda sql, params=None: [{"ticker": "A"}, {"ticker": "B"}])

    def flaky(t):
        if t == "A":
            raise RuntimeError("boom")

    monkeypatch.setattr(svc, "fetch_and_save", flaky)
    assert svc.fetch_all_disclosures() == {"total": 2, "ok": 1, "failed": 1}


def test_migrate_creates_stock_disclosures(monkeypatch):
    """main._migrate가 stock_disclosures 테이블 DDL을 발행한다(ADR-0006 런타임 정본)."""
    import main
    ddl = []
    import services.db as db
    monkeypatch.setattr(db, "execute", lambda sql, *a, **k: ddl.append(sql))
    main._migrate()
    joined = "\n".join(ddl)
    assert "CREATE TABLE IF NOT EXISTS stock_disclosures" in joined
    assert "rcept_no TEXT PRIMARY KEY" in joined
    assert "idx_disclosures_read" in joined


def test_migrate_adds_meeting_date_column(monkeypatch):
    """main._migrate가 meeting_date DATE 컬럼 추가 DDL을 발행한다(ADD COLUMN IF NOT EXISTS)."""
    import main
    ddl = []
    import services.db as db
    monkeypatch.setattr(db, "execute", lambda sql, *a, **k: ddl.append(sql))
    main._migrate()
    joined = "\n".join(ddl)
    assert "stock_disclosures ADD COLUMN IF NOT EXISTS meeting_date DATE" in joined

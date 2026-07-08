"""task #52: 배당 트래킹 income 뷰.

S1 수집(US yfinance + KR DART alotMatter), S2 저장소(stock_dividends upsert/조회 + _migrate),
S3 dividend_fetch 주배치 + 레지스트리 4표면, S4 대시보드 income 확장(per-holding + 포트
총계, _to_krw FX 환산)을 한 파일에서 검증한다.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest


class _FakeJsonResp:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


# ── S1: US yfinance 정규화 ─────────────────────────────────────────────

class _FakeYfTicker:
    def __init__(self, info):
        self.info = info


def test_us_dividend_from_info_rate_and_yield(monkeypatch):
    """US: t.info dividendRate(주당)·dividendYield(%)를 정규화. 통화 USD·source yfinance."""
    from services import dividends as svc
    monkeypatch.setattr(svc.yf, "Ticker", lambda sym: _FakeYfTicker(
        {"dividendRate": 2.12, "dividendYield": 2.57}))

    d = svc.fetch_us_dividend("KO", exchange="")
    assert d == {
        "annual_dividend_per_share": 2.12,
        "dividend_yield": 2.57,
        "currency": "USD",
        "source": "yfinance",
    }


def test_us_dividend_no_dividend_is_none(monkeypatch):
    """무배당 US 종목(dividendRate 없음)은 None graceful."""
    from services import dividends as svc
    monkeypatch.setattr(svc.yf, "Ticker", lambda sym: _FakeYfTicker(
        {"dividendRate": None, "dividendYield": None}))
    assert svc.fetch_us_dividend("GOOGL", exchange="") is None


def test_us_dividend_graceful_on_exception(monkeypatch):
    """yfinance 예외는 None graceful(빈 박제 아님)."""
    from services import dividends as svc

    def boom(sym):
        raise RuntimeError("yf down")

    monkeypatch.setattr(svc.yf, "Ticker", boom)
    assert svc.fetch_us_dividend("AAPL", exchange="") is None


# ── S1: KR DART alotMatter 정규화 ──────────────────────────────────────

_ALOT_OK = {
    "status": "000",
    "list": [
        {"se": "주당액면가액(원)", "stock_knd": "보통주", "thstrm": "100"},
        {"se": "주당 현금배당금(원)", "stock_knd": "보통주", "thstrm": "1,444"},
        {"se": "주당 현금배당금(원)", "stock_knd": "우선주", "thstrm": "1,445"},
        {"se": "현금배당수익률(%)", "stock_knd": "보통주", "thstrm": "1.90"},
        {"se": "현금배당수익률(%)", "stock_knd": "우선주", "thstrm": "2.40"},
    ],
}


def test_kr_dividend_from_alotmatter(monkeypatch):
    """KR: alotMatter 보통주 '주당 현금배당금(원)'·'현금배당수익률(%)' thstrm 추출. 콤마 제거."""
    from services import dividends as svc
    monkeypatch.setattr(svc, "_get_corp_code_map", lambda: {"005930": "00126380"})
    monkeypatch.setattr(svc.requests, "get", lambda *a, **k: _FakeJsonResp(_ALOT_OK))

    d = svc.fetch_kr_dividend("005930.KS")
    assert d["annual_dividend_per_share"] == 1444.0
    assert d["dividend_yield"] == 1.90
    assert d["currency"] == "KRW"
    assert d["source"] == "dart"


def test_kr_dividend_uses_recent_business_year(monkeypatch):
    """bsns_year는 최근 사업연도, reprt_code는 사업보고서 11011."""
    from services import dividends as svc
    monkeypatch.setattr(svc, "_get_corp_code_map", lambda: {"005930": "00126380"})
    cap = {}

    def fake_get(url, params=None, timeout=None):
        cap.update(params)
        return _FakeJsonResp(_ALOT_OK)

    monkeypatch.setattr(svc.requests, "get", fake_get)
    svc.fetch_kr_dividend("005930.KS")
    assert cap["reprt_code"] == "11011"
    assert cap["corp_code"] == "00126380"
    # 최근 사업연도(올해 또는 작년) — 4자리 연도
    assert len(cap["bsns_year"]) == 4 and cap["bsns_year"].isdigit()


def test_kr_dividend_no_corp_code_is_none(monkeypatch):
    """corp_code 미매핑(비-KR/누락)은 None graceful."""
    from services import dividends as svc
    monkeypatch.setattr(svc, "_get_corp_code_map", lambda: {})
    assert svc.fetch_kr_dividend("999999.KS") is None


def test_kr_dividend_status_not_000_is_none(monkeypatch):
    """DART status≠000(013 데이터없음 등)은 None graceful."""
    from services import dividends as svc
    monkeypatch.setattr(svc, "_get_corp_code_map", lambda: {"005930": "00126380"})
    monkeypatch.setattr(svc.requests, "get",
                        lambda *a, **k: _FakeJsonResp({"status": "013", "message": "데이터 없음"}))
    assert svc.fetch_kr_dividend("005930.KS") is None


def test_kr_dividend_dash_value_is_none(monkeypatch):
    """무배당(thstrm='-')은 주당배당이 None이라 전체 None graceful."""
    from services import dividends as svc
    monkeypatch.setattr(svc, "_get_corp_code_map", lambda: {"005930": "00126380"})
    monkeypatch.setattr(svc.requests, "get", lambda *a, **k: _FakeJsonResp({
        "status": "000",
        "list": [{"se": "주당 현금배당금(원)", "stock_knd": "보통주", "thstrm": "-"}],
    }))
    assert svc.fetch_kr_dividend("005930.KS") is None


def test_kr_dividend_reuses_backlog_corp_code_map():
    """corp_code 매핑은 backlog._get_corp_code_map을 재사용(중복 구현 금지)."""
    from services import dividends as svc
    from services import backlog
    assert svc._get_corp_code_map is backlog._get_corp_code_map


def test_kr_dividend_graceful_on_exception(monkeypatch):
    """DART 호출 예외는 None graceful."""
    from services import dividends as svc
    monkeypatch.setattr(svc, "_get_corp_code_map", lambda: {"005930": "00126380"})

    def boom(*a, **k):
        raise RuntimeError("network")

    monkeypatch.setattr(svc.requests, "get", boom)
    assert svc.fetch_kr_dividend("005930.KS") is None


# ── S2: 저장소 (upsert dedup · 조회 · _migrate) ────────────────────────

def test_upsert_dividend_dedups_on_ticker(monkeypatch):
    """upsert SQL은 ticker PK 충돌 시 갱신(재수집이 행 수를 늘리지 않게)."""
    from services import dividends as svc
    calls = []
    monkeypatch.setattr(svc, "execute", lambda sql, params: calls.append((sql, params)))

    svc.upsert_dividend("ko", {
        "annual_dividend_per_share": 2.12, "dividend_yield": 2.57,
        "currency": "USD", "source": "yfinance",
    })

    assert len(calls) == 1
    sql, params = calls[0]
    assert "INSERT INTO stock_dividends" in sql
    assert "ON CONFLICT (ticker) DO UPDATE" in sql
    assert params[0] == "KO"  # ticker upper
    assert params[1] == 2.12
    assert params[3] == "USD"


def test_get_dividend_returns_row_or_none(monkeypatch):
    from services import dividends as svc
    cap = {}

    def fake_query(sql, params):
        cap["params"] = params
        return [{
            "annual_dividend_per_share": 2.12, "dividend_yield": 2.57,
            "currency": "USD", "source": "yfinance",
        }]

    monkeypatch.setattr(svc, "query", fake_query)
    d = svc.get_dividend("ko")
    assert cap["params"] == ("KO",)
    assert d["annual_dividend_per_share"] == 2.12

    monkeypatch.setattr(svc, "query", lambda sql, params: [])
    assert svc.get_dividend("MISSING") is None


def test_migrate_creates_stock_dividends(monkeypatch):
    """main._migrate가 stock_dividends 테이블 DDL을 발행한다(ADR-0006 런타임 정본)."""
    import main
    ddl = []
    import services.db as db
    monkeypatch.setattr(db, "execute", lambda sql, *a, **k: ddl.append(sql))
    main._migrate()
    joined = "\n".join(ddl)
    assert "CREATE TABLE IF NOT EXISTS stock_dividends" in joined
    assert "ticker TEXT PRIMARY KEY" in joined


# ── S3: dividend_fetch 배치 + 레지스트리 4표면 ─────────────────────────

def test_fetch_all_dividends_routes_by_market(monkeypatch):
    """보유+관심을 시장별 분기: KR→DART, US→yfinance. 결측은 skip(upsert 안 함)."""
    from services import dividends as svc
    monkeypatch.setattr(svc, "query", lambda sql, params=None: [
        {"ticker": "005930.KS", "market": "KR"},
        {"ticker": "KO", "market": "US"},
        {"ticker": "GOOGL", "market": "US"},
    ])
    monkeypatch.setattr(svc, "fetch_kr_dividend",
                        lambda t: {"annual_dividend_per_share": 1444.0, "dividend_yield": 1.9,
                                   "currency": "KRW", "source": "dart"})

    def fake_us(t, exchange=""):
        if t == "GOOGL":
            return None  # 무배당
        return {"annual_dividend_per_share": 2.12, "dividend_yield": 2.57,
                "currency": "USD", "source": "yfinance"}

    monkeypatch.setattr(svc, "fetch_us_dividend", fake_us)
    upserts = []
    monkeypatch.setattr(svc, "upsert_dividend", lambda t, d: upserts.append(t))
    # 스케줄 경로는 독립 — 모킹해 hermetic 유지(yfinance/DB 미접촉).
    monkeypatch.setattr(svc, "fetch_dividend_schedule", lambda t, m, e: [])
    monkeypatch.setattr(svc, "replace_schedule", lambda t, rows: None)

    result = svc.fetch_all_dividends()
    assert set(upserts) == {"005930.KS", "KO"}  # GOOGL(무배당)은 upsert 제외
    # ok = 예외 없이 처리된 종목 수(무배당 GOOGL 포함 — 정상 처리, 저장만 skip).
    assert result == {"total": 3, "ok": 3, "failed": 0, "schedule_ok": 3}


def test_fetch_all_dividends_continues_on_error(monkeypatch):
    from services import dividends as svc
    monkeypatch.setattr(svc, "query", lambda sql, params=None: [
        {"ticker": "A", "market": "US"}, {"ticker": "B", "market": "US"}])

    def flaky(t, exchange=""):
        if t == "A":
            raise RuntimeError("boom")
        return {"annual_dividend_per_share": 1.0, "dividend_yield": 1.0,
                "currency": "USD", "source": "yfinance"}

    monkeypatch.setattr(svc, "fetch_us_dividend", flaky)
    monkeypatch.setattr(svc, "upsert_dividend", lambda t, d: None)
    monkeypatch.setattr(svc, "fetch_dividend_schedule", lambda t, m, e: [])
    monkeypatch.setattr(svc, "replace_schedule", lambda t, rows: None)
    # DPS fetch가 A에서 실패해도 스케줄(독립 경로)은 양쪽 성공 → schedule_ok=2.
    assert svc.fetch_all_dividends() == {"total": 2, "ok": 1, "failed": 1, "schedule_ok": 2}


def test_registry_has_dividend_fetch_common_market():
    """레지스트리에 dividend_fetch가 market=공통·category=report·editable·auto+manual로 존재."""
    from services import batch_registry
    e = batch_registry.get_batch("dividend_fetch")
    assert e is not None
    assert e["market"] == "공통"
    assert e["category"] == "report"
    assert e["editable"] is True
    assert set(e["trigger_kinds"]) == {"auto", "manual"}
    assert e["manual_endpoint"] == "/api/stocks/dividends/refresh"
    assert e["scheduler_job_id"] == "dividend_fetch"
    assert e["default_schedule"]["type"] == "weekly"


def test_scheduler_registers_dividend_fetch():
    """scheduler._JOB_FUNCS에 dividend_fetch가 등록(자동 lane)."""
    import scheduler
    assert "dividend_fetch" in scheduler._JOB_FUNCS


def test_scheduler_dividend_job_records_auto(monkeypatch):
    """자동 잡 본문이 job_runs.record('dividend_fetch','auto')로 기록."""
    import scheduler
    recorded = []
    from contextlib import contextmanager

    @contextmanager
    def fake_record(job_id, trigger):
        recorded.append((job_id, trigger))
        yield None

    monkeypatch.setattr(scheduler.job_runs, "record", fake_record)
    import services.dividends as svc
    monkeypatch.setattr(svc, "fetch_all_dividends", lambda: {"total": 0, "ok": 0, "failed": 0})
    scheduler._JOB_FUNCS["dividend_fetch"]()
    assert ("dividend_fetch", "auto") in recorded


def test_manual_dividend_refresh_records_manual(monkeypatch):
    """수동 엔드포인트 백그라운드 작업이 job_runs.record('dividend_fetch','manual')로 기록."""
    from routers import stocks as stocks_router
    recorded = []
    from contextlib import contextmanager

    @contextmanager
    def fake_record(job_id, trigger):
        recorded.append((job_id, trigger))
        yield None

    monkeypatch.setattr(stocks_router.job_runs, "record", fake_record)
    import services.dividends as svc
    monkeypatch.setattr(svc, "fetch_all_dividends", lambda: {"total": 0, "ok": 0, "failed": 0})
    stocks_router._run_dividends_all()
    assert ("dividend_fetch", "manual") in recorded


# ── 배당 스케줄 projection (task #158, ADR-0023) ────────────────────────

class _FakeDivSeries:
    def __init__(self, pairs):
        self._pairs = pairs

    def __len__(self):
        return len(self._pairs)

    def items(self):
        return iter(self._pairs)


class _FakeSchedTicker:
    def __init__(self, divs, calendar=None):
        self.dividends = _FakeDivSeries(divs)
        self.calendar = calendar or {}


def test_schedule_projects_kr_quarterly(monkeypatch):
    """KR 분기배당 이력 → 향후 분기 예상(projected, KRW, 직전 실금액, 지급일 없음)."""
    from services import dividends as svc
    from datetime import datetime, date
    divs = [(datetime(2025, 3, 28), 365.0), (datetime(2025, 6, 27), 367.0),
            (datetime(2025, 9, 29), 370.0), (datetime(2025, 12, 29), 566.0),
            (datetime(2026, 3, 30), 372.0)]
    monkeypatch.setattr(svc.yf, "Ticker", lambda s: _FakeSchedTicker(divs))
    monkeypatch.setattr(svc, "_today_kst", lambda: date(2026, 7, 8))
    rows = svc.fetch_dividend_schedule("005930", "KR", "KS")
    assert rows, "미래 예상 배당락이 생성돼야 함"
    assert all(r["status"] == "projected" for r in rows)      # KR은 전부 예상
    assert all(r["currency"] == "KRW" for r in rows)
    assert all(r["amount_per_share"] == 372.0 for r in rows)  # 직전 실금액
    assert all(r["pay_date"] is None for r in rows)           # KR 지급일 소스 없음
    assert all(r["ex_date"] >= date(2026, 7, 8) for r in rows)  # 오늘 이후만


def test_schedule_us_confirmed_with_paydate(monkeypatch):
    """US는 t.calendar 미래 배당락을 확정(confirmed)+지급일로, 이후는 예상."""
    from services import dividends as svc
    from datetime import datetime, date
    divs = [(datetime(2025, 8, 11), 0.26), (datetime(2025, 11, 10), 0.26),
            (datetime(2026, 2, 9), 0.26), (datetime(2026, 5, 11), 0.27)]
    cal = {"Ex-Dividend Date": date(2026, 8, 20), "Dividend Date": date(2026, 8, 25)}
    monkeypatch.setattr(svc.yf, "Ticker", lambda s: _FakeSchedTicker(divs, cal))
    monkeypatch.setattr(svc, "_today_kst", lambda: date(2026, 7, 8))
    rows = svc.fetch_dividend_schedule("AAPL", "US", "")
    assert rows[0]["status"] == "confirmed"
    assert rows[0]["ex_date"] == date(2026, 8, 20)
    assert rows[0]["pay_date"] == date(2026, 8, 25)
    assert rows[0]["currency"] == "USD"
    assert any(r["status"] == "projected" for r in rows[1:])


def test_schedule_insufficient_history_is_empty(monkeypatch):
    """이력 2건 미만(주기 추론 불가)은 빈 스케줄."""
    from services import dividends as svc
    from datetime import datetime, date
    monkeypatch.setattr(svc.yf, "Ticker", lambda s: _FakeSchedTicker([(datetime(2026, 3, 30), 372.0)]))
    monkeypatch.setattr(svc, "_today_kst", lambda: date(2026, 7, 8))
    assert svc.fetch_dividend_schedule("005930", "KR", "KS") == []


def test_snap_interval_buckets():
    from services import dividends as svc
    assert svc._snap_interval(91) == 91      # 분기
    assert svc._snap_interval(88) == 91
    assert svc._snap_interval(182) == 182    # 반기
    assert svc._snap_interval(365) == 365    # 연
    assert svc._snap_interval(30) == 30      # 표준 밖은 원값


# ── 배당 스케줄 클로버 방지 + 원자화 (task#160 #2·#4) ────────────────────

class _BoomDividends:
    """t.dividends 접근 시 예외 — yfinance rate-limit/네트워크 실패 모사."""
    @property
    def dividends(self):
        raise RuntimeError("yfinance rate limit")


def test_dividend_history_propagates_fetch_error(monkeypatch):
    """[#2] fetch 예외는 전파돼야 함 — genuine 무배당([])과 구분(실패 시 last-good 보존 신호)."""
    from services import dividends as svc
    monkeypatch.setattr(svc.yf, "Ticker", lambda s: _BoomDividends())
    with pytest.raises(RuntimeError):
        svc._dividend_history("005930.KS")


def test_fetch_all_skips_replace_on_schedule_failure(monkeypatch):
    """[#2] 스케줄 fetch 실패 종목은 replace_schedule 미호출(저장 스케줄 클로버 금지),
    genuine 무배당은 replace([])로 clear."""
    from services import dividends as svc
    monkeypatch.setattr(svc, "query", lambda sql, params=None: [
        {"ticker": "FAILS", "market": "US", "exchange": ""},
        {"ticker": "EMPTY", "market": "US", "exchange": ""}])
    monkeypatch.setattr(svc, "fetch_us_dividend", lambda t, exchange="": None)
    monkeypatch.setattr(svc, "fetch_kr_dividend", lambda t: None)
    monkeypatch.setattr(svc, "upsert_dividend", lambda t, d: None)

    def sched(t, m, e):
        if t == "FAILS":
            raise RuntimeError("yfinance down")
        return []  # genuine 무배당

    monkeypatch.setattr(svc, "fetch_dividend_schedule", sched)
    replaced = []
    monkeypatch.setattr(svc, "replace_schedule", lambda t, rows: replaced.append(t))
    svc.fetch_all_dividends()
    assert "FAILS" not in replaced   # 실패 → 기존 스케줄 보존(delete 안 함)
    assert "EMPTY" in replaced       # genuine empty → clear


def test_replace_schedule_single_transaction(monkeypatch):
    """[#4] replace_schedule은 단일 트랜잭션(delete+insert 한 커넥션) — 중단 시 전체 rollback."""
    from contextlib import contextmanager
    from services import dividends as svc
    verbs = []

    class FakeCur:
        def execute(self, sql, params=None):
            verbs.append(sql.strip().split()[0].upper())
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False

    class FakeConn:
        def cursor(self):
            return FakeCur()

    conns = {"n": 0}

    @contextmanager
    def fake_conn():
        conns["n"] += 1
        yield FakeConn()

    monkeypatch.setattr(svc, "get_connection", fake_conn)
    svc.replace_schedule("005930", [
        {"ex_date": "2026-09-26", "pay_date": None, "amount_per_share": 372.0,
         "currency": "KRW", "status": "projected", "source": "yfinance"},
        {"ex_date": "2026-12-26", "pay_date": None, "amount_per_share": 372.0,
         "currency": "KRW", "status": "projected", "source": "yfinance"},
    ])
    assert conns["n"] == 1              # 단일 커넥션(=단일 트랜잭션)
    assert verbs[0] == "DELETE"         # delete 먼저
    assert verbs.count("INSERT") == 2   # 행별 insert 2건

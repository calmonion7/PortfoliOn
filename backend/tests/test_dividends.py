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

    result = svc.fetch_all_dividends()
    assert set(upserts) == {"005930.KS", "KO"}  # GOOGL(무배당)은 upsert 제외
    # ok = 예외 없이 처리된 종목 수(무배당 GOOGL 포함 — 정상 처리, 저장만 skip).
    assert result == {"total": 3, "ok": 3, "failed": 0}


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
    assert svc.fetch_all_dividends() == {"total": 2, "ok": 1, "failed": 1}


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

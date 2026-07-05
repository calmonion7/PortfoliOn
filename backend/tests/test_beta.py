"""task #150 S1: 베타 백필 배치 (dividends 패턴 미러링).

fetch_all_betas 수집(US=yfinance beta/beta3Year 폴백, KR=calc_beta vs ^KS11),
저장소(stock_beta upsert/조회 + _migrate), beta_fetch 배치 레지스트리 4표면을
한 파일에서 검증한다.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd
import pytest


# ── US: yfinance beta / beta3Year 폴백 ──────────────────────────────────

class _FakeYfTicker:
    def __init__(self, info):
        self.info = info


def test_us_beta_from_info(monkeypatch):
    from services import beta as svc
    monkeypatch.setattr(svc.yf, "Ticker", lambda sym: _FakeYfTicker({"beta": 1.23}))
    assert svc.fetch_us_beta("AAPL", exchange="") == 1.23


def test_us_beta_falls_back_to_beta3year_when_beta_missing(monkeypatch):
    """ETF 등 beta 결측 시 beta3Year 폴백(QQQ 대응)."""
    from services import beta as svc
    monkeypatch.setattr(svc.yf, "Ticker", lambda sym: _FakeYfTicker({"beta": None, "beta3Year": 1.05}))
    assert svc.fetch_us_beta("QQQ", exchange="") == 1.05


def test_us_beta_both_missing_is_none(monkeypatch):
    from services import beta as svc
    monkeypatch.setattr(svc.yf, "Ticker", lambda sym: _FakeYfTicker({}))
    assert svc.fetch_us_beta("XYZ", exchange="") is None


def test_us_beta_zero_is_kept_not_replaced_by_beta3year(monkeypatch):
    """beta=0.0(유효값)이 falsy라 beta3Year로 조용히 치환되면 안 됨 (wrong<missing)."""
    from services import beta as svc
    monkeypatch.setattr(svc.yf, "Ticker", lambda sym: _FakeYfTicker({"beta": 0.0, "beta3Year": 1.4}))
    assert svc.fetch_us_beta("CASH", exchange="") == 0.0


def test_us_beta_graceful_on_exception(monkeypatch):
    from services import beta as svc

    def boom(sym):
        raise RuntimeError("yf down")

    monkeypatch.setattr(svc.yf, "Ticker", boom)
    assert svc.fetch_us_beta("AAPL", exchange="") is None


# ── KR: calc_beta vs ^KS11 ───────────────────────────────────────────────

def test_ks11_returns_strips_tz(monkeypatch):
    """^KS11 히스토리가 tz-aware면 tz_localize(None)으로 벗겨 KR daily_df(tz-naive)와 정합."""
    from services import beta as svc
    idx = pd.date_range("2026-01-01", periods=5, freq="D", tz="Asia/Seoul")
    df = pd.DataFrame({"Close": [100, 101, 102, 103, 104]}, index=idx)
    monkeypatch.setattr(svc.mkt, "get_history_df", lambda *a, **k: df)
    ret = svc._ks11_returns()
    assert ret.index.tz is None


def test_ks11_returns_none_when_empty(monkeypatch):
    from services import beta as svc
    monkeypatch.setattr(svc.mkt, "get_history_df", lambda *a, **k: pd.DataFrame())
    assert svc._ks11_returns() is None


def test_ks11_returns_none_on_exception(monkeypatch):
    from services import beta as svc

    def boom(*a, **k):
        raise RuntimeError("fetch failed")

    monkeypatch.setattr(svc.mkt, "get_history_df", boom)
    assert svc._ks11_returns() is None


def test_fetch_kr_beta_none_when_ks11_ret_missing(monkeypatch):
    """ks11_ret 없으면(^KS11 fetch 실패) daily_df도 받지 않고 즉시 None."""
    from services import beta as svc
    called = []
    monkeypatch.setattr(svc.mkt, "get_history_df", lambda *a, **k: called.append(1))
    assert svc.fetch_kr_beta("005930.KS", "", None) is None
    assert called == []


def test_fetch_kr_beta_uses_calc_beta(monkeypatch):
    """daily_df Close pct_change를 indicators.calc_beta에 넘긴다(재사용, 재구현 아님)."""
    from services import beta as svc
    idx = pd.date_range("2026-01-01", periods=5, freq="D")
    df = pd.DataFrame({"Close": [100, 102, 101, 103, 104]}, index=idx)
    monkeypatch.setattr(svc.mkt, "get_history_df", lambda *a, **k: df)
    monkeypatch.setattr(svc.indicators, "calc_beta", lambda s, i: 0.87)
    ks11_ret = pd.Series([0.01, 0.02], index=idx[:2])
    assert svc.fetch_kr_beta("005930.KS", "", ks11_ret) == 0.87


def test_fetch_kr_beta_empty_history_is_none(monkeypatch):
    from services import beta as svc
    monkeypatch.setattr(svc.mkt, "get_history_df", lambda *a, **k: pd.DataFrame())
    assert svc.fetch_kr_beta("005930.KS", "", pd.Series([0.01])) is None


def test_fetch_kr_beta_graceful_on_exception(monkeypatch):
    from services import beta as svc

    def boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr(svc.mkt, "get_history_df", boom)
    assert svc.fetch_kr_beta("005930.KS", "", pd.Series([0.01])) is None


# ── 저장소 (upsert dedup · 조회 · _migrate) ───────────────────────────────

def test_upsert_beta_dedups_on_ticker(monkeypatch):
    """upsert SQL은 ticker PK 충돌 시 갱신(재수집이 행 수를 늘리지 않게)."""
    from services import beta as svc
    calls = []
    monkeypatch.setattr(svc, "execute", lambda sql, params: calls.append((sql, params)))

    svc.upsert_beta("qqq", 1.05, "yfinance")

    assert len(calls) == 1
    sql, params = calls[0]
    assert "INSERT INTO stock_beta" in sql
    assert "ON CONFLICT (ticker) DO UPDATE" in sql
    assert params == ("QQQ", 1.05, "yfinance")


def test_get_beta_returns_value_or_none(monkeypatch):
    from services import beta as svc
    monkeypatch.setattr(svc, "query", lambda sql, params: [{"beta": 1.23}])
    assert svc.get_beta("aapl") == 1.23

    monkeypatch.setattr(svc, "query", lambda sql, params: [])
    assert svc.get_beta("MISSING") is None

    monkeypatch.setattr(svc, "query", lambda sql, params: [{"beta": None}])
    assert svc.get_beta("NULLBETA") is None


def test_migrate_creates_stock_beta(monkeypatch):
    """main._migrate가 stock_beta 테이블 DDL을 발행한다(ADR-0006 런타임 정본)."""
    import main
    ddl = []
    import services.db as db
    monkeypatch.setattr(db, "execute", lambda sql, *a, **k: ddl.append(sql))
    main._migrate()
    joined = "\n".join(ddl)
    assert "CREATE TABLE IF NOT EXISTS stock_beta" in joined
    assert "ticker TEXT PRIMARY KEY" in joined


# ── 배치 (fetch_all_betas + 레지스트리 4표면) ─────────────────────────────

def test_fetch_all_betas_routes_by_market(monkeypatch):
    """보유+관심을 시장별 분기: KR→calc_beta, US→yfinance. 결측은 skip(upsert 안 함)."""
    from services import beta as svc
    monkeypatch.setattr(svc, "query", lambda sql, params=None: [
        {"ticker": "005930.KS", "market": "KR", "exchange": "KS"},
        {"ticker": "AAPL", "market": "US", "exchange": ""},
        {"ticker": "ZZZ", "market": "US", "exchange": ""},
    ])
    monkeypatch.setattr(svc, "_ks11_returns", lambda: "fake-ks11-ret")
    monkeypatch.setattr(svc, "fetch_kr_beta", lambda t, ex, ks: 0.9)

    def fake_us(t, exchange=""):
        if t == "ZZZ":
            return None  # 결측
        return 1.1

    monkeypatch.setattr(svc, "fetch_us_beta", fake_us)
    upserts = []
    monkeypatch.setattr(svc, "upsert_beta", lambda t, b, s: upserts.append((t, b, s)))

    result = svc.fetch_all_betas()
    assert set(upserts) == {("005930.KS", 0.9, "kiwoom"), ("AAPL", 1.1, "yfinance")}
    # ok = 예외 없이 처리된 종목 수(결측 ZZZ 포함 — 정상 처리, 저장만 skip).
    assert result == {"total": 3, "ok": 3, "failed": 0}


def test_fetch_all_betas_skips_ks11_fetch_when_no_kr(monkeypatch):
    """KR 종목이 없으면 ^KS11 히스토리 fetch를 스킵(불필요 라이브 호출 회피, eco)."""
    from services import beta as svc
    monkeypatch.setattr(svc, "query", lambda sql, params=None: [
        {"ticker": "AAPL", "market": "US", "exchange": ""},
    ])
    called = []
    monkeypatch.setattr(svc, "_ks11_returns", lambda: called.append(1))
    monkeypatch.setattr(svc, "fetch_us_beta", lambda t, exchange="": 1.1)
    monkeypatch.setattr(svc, "upsert_beta", lambda t, b, s: None)
    svc.fetch_all_betas()
    assert called == []


def test_fetch_all_betas_continues_on_error(monkeypatch):
    from services import beta as svc
    monkeypatch.setattr(svc, "query", lambda sql, params=None: [
        {"ticker": "A", "market": "US", "exchange": ""},
        {"ticker": "B", "market": "US", "exchange": ""},
    ])

    def flaky(t, exchange=""):
        if t == "A":
            raise RuntimeError("boom")
        return 1.0

    monkeypatch.setattr(svc, "fetch_us_beta", flaky)
    monkeypatch.setattr(svc, "upsert_beta", lambda t, b, s: None)
    assert svc.fetch_all_betas() == {"total": 2, "ok": 1, "failed": 1}


def test_registry_has_beta_fetch_common_market():
    """레지스트리에 beta_fetch가 market=공통·category=report·editable·auto+manual로 존재."""
    from services import batch_registry
    e = batch_registry.get_batch("beta_fetch")
    assert e is not None
    assert e["market"] == "공통"
    assert e["category"] == "report"
    assert e["editable"] is True
    assert set(e["trigger_kinds"]) == {"auto", "manual"}
    assert e["manual_endpoint"] == "/api/stocks/beta/refresh"
    assert e["scheduler_job_id"] == "beta_fetch"
    assert e["default_schedule"]["type"] == "weekly"


def test_scheduler_registers_beta_fetch():
    """scheduler._JOB_FUNCS에 beta_fetch가 등록(자동 lane)."""
    import scheduler
    assert "beta_fetch" in scheduler._JOB_FUNCS


def test_scheduler_beta_job_records_auto(monkeypatch):
    """자동 잡 본문이 job_runs.record('beta_fetch','auto')로 기록."""
    import scheduler
    recorded = []
    from contextlib import contextmanager

    @contextmanager
    def fake_record(job_id, trigger):
        recorded.append((job_id, trigger))
        yield None

    monkeypatch.setattr(scheduler.job_runs, "record", fake_record)
    import services.beta as svc
    monkeypatch.setattr(svc, "fetch_all_betas", lambda: {"total": 0, "ok": 0, "failed": 0})
    scheduler._JOB_FUNCS["beta_fetch"]()
    assert ("beta_fetch", "auto") in recorded


def test_manual_beta_refresh_records_manual(monkeypatch):
    """수동 엔드포인트 백그라운드 작업이 job_runs.record('beta_fetch','manual')로 기록."""
    from routers import stocks as stocks_router
    recorded = []
    from contextlib import contextmanager

    @contextmanager
    def fake_record(job_id, trigger):
        recorded.append((job_id, trigger))
        yield None

    monkeypatch.setattr(stocks_router.job_runs, "record", fake_record)
    import services.beta as svc
    monkeypatch.setattr(svc, "fetch_all_betas", lambda: {"total": 0, "ok": 0, "failed": 0})
    stocks_router._run_betas_all()
    assert ("beta_fetch", "manual") in recorded

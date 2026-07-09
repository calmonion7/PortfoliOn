"""task 45 — 일일 리포트 시장별(KR/US) 2배치 분리.

S3: storage.expected_report_date(market) / expected_report_dates() 시각인지 계산.
S4: /api/report/list 응답 last_scheduled_date 객체 형태 + 종목 추가 시 market별 기대날짜.
"""
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from services import storage

_KST = ZoneInfo("Asia/Seoul")
# 2026-06-15는 월요일(weekday=0).
_MON_2030 = datetime(2026, 6, 15, 20, 30, tzinfo=_KST)
_MON_1000 = datetime(2026, 6, 15, 10, 0, tzinfo=_KST)
_MON_0600 = datetime(2026, 6, 15, 6, 0, tzinfo=_KST)
_MON_0800 = datetime(2026, 6, 15, 8, 0, tzinfo=_KST)

_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"]


def _sched(time, enabled=True, days=None):
    return {"enabled": enabled, "type": "weekly",
            "days": _WEEKDAYS if days is None else days, "time": time}


# ── S3: expected_report_date ────────────────────────────────────────────────

def test_kr_after_2030_returns_today(monkeypatch):
    """KR 배치(20:30)가 오늘 지났으면 오늘 날짜."""
    monkeypatch.setattr(storage.dates, "_now_kst", lambda: _MON_2030)
    monkeypatch.setattr(storage.dates, "get_batch_schedule", lambda jid: _sched("20:30"))
    assert storage.expected_report_date("KR") == "2026-06-15"


def test_kr_before_2030_returns_prev_weekday(monkeypatch):
    """KR 배치 시각 전(오전)이면 직전 영업일(금요일 2026-06-12)."""
    monkeypatch.setattr(storage.dates, "_now_kst", lambda: _MON_1000)
    monkeypatch.setattr(storage.dates, "get_batch_schedule", lambda jid: _sched("20:30"))
    assert storage.expected_report_date("KR") == "2026-06-12"


def test_us_after_0700_returns_today(monkeypatch):
    """US 배치(07:00)가 오늘 지났으면(오전 8시) 오늘."""
    monkeypatch.setattr(storage.dates, "_now_kst", lambda: _MON_0800)
    monkeypatch.setattr(storage.dates, "get_batch_schedule", lambda jid: _sched("07:00"))
    assert storage.expected_report_date("US") == "2026-06-15"


def test_us_before_0700_returns_prev_weekday(monkeypatch):
    """US 배치 시각 전(06:00)이면 직전 영업일(금요일)."""
    monkeypatch.setattr(storage.dates, "_now_kst", lambda: _MON_0600)
    monkeypatch.setattr(storage.dates, "get_batch_schedule", lambda jid: _sched("07:00"))
    assert storage.expected_report_date("US") == "2026-06-12"


def test_disabled_schedule_returns_today(monkeypatch):
    monkeypatch.setattr(storage.dates, "_now_kst", lambda: _MON_1000)
    monkeypatch.setattr(storage.dates, "get_batch_schedule", lambda jid: _sched("20:30", enabled=False))
    assert storage.expected_report_date("KR") == "2026-06-15"


def test_non_scheduled_weekday_returns_prev_scheduled(monkeypatch):
    """오늘이 스케줄 요일이 아니면(월요일인데 화·수만 스케줄) 직전 스케줄 요일."""
    monkeypatch.setattr(storage.dates, "_now_kst", lambda: _MON_2030)
    monkeypatch.setattr(storage.dates, "get_batch_schedule",
                        lambda jid: _sched("20:30", days=["tue", "wed"]))
    # 직전 스케줄 요일 = 지난주 수요일 2026-06-10
    assert storage.expected_report_date("KR") == "2026-06-10"


def test_missing_schedule_returns_today(monkeypatch):
    monkeypatch.setattr(storage.dates, "_now_kst", lambda: _MON_1000)
    monkeypatch.setattr(storage.dates, "get_batch_schedule", lambda jid: None)
    assert storage.expected_report_date("US") == "2026-06-15"


def test_expected_report_dates_returns_both_markets(monkeypatch):
    """expected_report_dates는 {KR, US} 객체 — KR/US 임계값이 달라 다른 날짜가 나올 수 있다."""
    monkeypatch.setattr(storage.dates, "_now_kst", lambda: _MON_1000)  # 10:00: US 07:00은 지남, KR 20:30은 전

    def sched(jid):
        return _sched("20:30") if jid == "daily_report_kr" else _sched("07:00")

    monkeypatch.setattr(storage.dates, "get_batch_schedule", sched)
    dates = storage.expected_report_dates()
    assert dates == {"KR": "2026-06-12", "US": "2026-06-15"}


# ── S3: market 분류 (US가 비-KR 전부를 흡수) ──────────────────────────────────

def test_unknown_market_treated_as_us(monkeypatch):
    """알 수 없는 market 문자열은 US 배치로 매핑(누락 방지)."""
    monkeypatch.setattr(storage.dates, "_now_kst", lambda: _MON_0800)
    seen = []
    monkeypatch.setattr(storage.dates, "get_batch_schedule",
                        lambda jid: seen.append(jid) or _sched("07:00"))
    storage.expected_report_date("HK")
    assert seen == ["daily_report_us"]


# ── S4: /api/report/list 응답 형태 ───────────────────────────────────────────

def test_list_response_last_scheduled_date_is_object(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routers.report import router
    from auth import get_current_user, get_current_user_or_api_key

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: "u1"
    app.dependency_overrides[get_current_user_or_api_key] = lambda: "u1"
    client = TestClient(app)

    with patch("routers.report.query", return_value=[]), \
         patch("routers.report.storage.get_full_portfolio", return_value={"stocks": [], "watchlist": []}), \
         patch("routers.report.storage.expected_report_dates",
               return_value={"KR": "2026-06-12", "US": "2026-06-15"}), \
         patch("routers.report.cache_svc.get_list", side_effect=lambda uid, f: f()):
        resp = client.get("/api/report/list")
    assert resp.status_code == 200
    lsd = resp.json()["last_scheduled_date"]
    assert lsd == {"KR": "2026-06-12", "US": "2026-06-15"}


# ── S4: 종목 추가 시 market별 기대날짜로 스냅샷 존재확인 ───────────────────────

def _add_client(module):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from auth import get_current_user
    app = FastAPI()
    app.include_router(module.router)
    app.dependency_overrides[get_current_user] = lambda: "u1"
    return TestClient(app)


def test_portfolio_add_kr_uses_kr_expected_date(monkeypatch):
    import routers.portfolio as portfolio
    client = _add_client(portfolio)
    captured = {}

    def db_q(sql, params=None):
        if "snapshots" in sql:
            captured["date"] = params[1]
            return [{"x": 1}]  # 존재 → 생성 큐잉 안 함
        return []

    with patch("routers.portfolio.storage.get_holdings", return_value=[]), \
         patch("routers.portfolio.storage.get_stocks", return_value=[]), \
         patch("routers.portfolio.storage.save_stocks"), \
         patch("routers.portfolio.storage.save_holdings"), \
         patch("routers.portfolio.cache_svc.invalidate_portfolio_caches"), \
         patch("routers.portfolio.market_svc.get_quote", return_value={}), \
         patch("routers.portfolio.market_svc.resolve_name", return_value="삼성전자"), \
         patch("routers.portfolio.storage.expected_report_date",
               side_effect=lambda m: "2026-06-12" if m == "KR" else "2026-06-15"), \
         patch("routers.portfolio.db_query", side_effect=db_q):
        resp = client.post("/api/portfolio", json={
            "ticker": "005930", "name": "삼성전자", "quantity": 1, "avg_cost": 70000.0,
            "market": "KR", "exchange": "KOSPI",
        })
    assert resp.status_code == 201
    assert captured["date"] == "2026-06-12"


def test_watchlist_add_us_uses_us_expected_date(monkeypatch):
    import routers.watchlist as watchlist
    client = _add_client(watchlist)
    captured = {}

    def db_q(sql, params=None):
        if "snapshots" in sql:
            captured["date"] = params[1]
            return [{"x": 1}]
        return []

    with patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.get_watchlist_tickers", return_value=[]), \
         patch("routers.watchlist.storage.get_stocks", return_value=[]), \
         patch("routers.watchlist.storage.save_stocks"), \
         patch("routers.watchlist.storage.save_watchlist_tickers"), \
         patch("routers.watchlist.cache_svc.invalidate_portfolio_caches"), \
         patch("routers.watchlist.market_svc.resolve_name", return_value="Apple"), \
         patch("routers.watchlist.storage.expected_report_date",
               side_effect=lambda m: "2026-06-12" if m == "KR" else "2026-06-15"), \
         patch("routers.watchlist.db_query", side_effect=db_q):
        resp = client.post("/api/watchlist", json={
            "ticker": "AAPL", "name": "Apple", "market": "US", "exchange": "",
        })
    assert resp.status_code == 201
    assert captured["date"] == "2026-06-15"

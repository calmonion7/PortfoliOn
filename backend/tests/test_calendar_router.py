import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from datetime import date
import pandas as pd

from routers.calendar import router
from auth import get_current_user


app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
client = TestClient(app)

SAMPLE_PORTFOLIO = {
    "stocks": [{"ticker": "AAPL", "type": "holding", "name": "Apple"}],
    "watchlist": [{"ticker": "TSLA", "type": "watchlist", "name": "Tesla"}],
}


def _mock_ticker(ticker):
    m = MagicMock()
    if ticker == "AAPL":
        # Ex-Dividend Date now sourced from calendar (exact), not estimated from dividends history
        m.calendar = {
            "Earnings Date": [date(2026, 5, 20)],
            "Ex-Dividend Date": date(2026, 5, 9),
        }
        m.dividends = pd.Series([], dtype=float)
    else:
        m.calendar = {}
        m.dividends = pd.Series([], dtype=float)
    return m


def test_calendar_returns_earnings_event(tmp_path):
    with patch("routers.calendar.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("routers.calendar.yf.Ticker", side_effect=_mock_ticker), \
         patch("routers.calendar._CACHE_DIR", tmp_path), \
         patch("routers.calendar.query", return_value=[]), \
         patch("routers.calendar.execute", return_value=1):
        resp = client.get("/api/calendar?month=2026-05")
    assert resp.status_code == 200
    events = resp.json()["events"]
    earnings = [e for e in events if e["type"] == "earnings"]
    assert len(earnings) == 1
    assert earnings[0]["ticker"] == "AAPL"
    assert earnings[0]["date"] == "2026-05-20"
    assert earnings[0]["stock_type"] == "holding"


def test_calendar_returns_dividend_event(tmp_path):
    # AAPL mock: Ex-Dividend Date = 2026-05-09 (exact, from t.calendar)
    with patch("routers.calendar.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("routers.calendar.yf.Ticker", side_effect=_mock_ticker), \
         patch("routers.calendar._CACHE_DIR", tmp_path), \
         patch("routers.calendar.query", return_value=[]), \
         patch("routers.calendar.execute", return_value=1):
        resp = client.get("/api/calendar?month=2026-05")
    events = resp.json()["events"]
    divs = [e for e in events if e["type"] == "dividend"]
    assert len(divs) == 1
    assert divs[0]["ticker"] == "AAPL"
    assert divs[0]["date"] == "2026-05-09"
    assert divs[0]["stock_type"] == "holding"


def test_calendar_empty_for_ticker_with_no_data(tmp_path):
    mock_cal = MagicMock()
    mock_cal.sessions_in_range.return_value = pd.DatetimeIndex(
        pd.date_range("2026-07-01", "2026-07-31", freq="B")
    )
    with patch("routers.calendar.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("routers.calendar.yf.Ticker", side_effect=_mock_ticker), \
         patch("routers.calendar._CACHE_DIR", tmp_path), \
         patch("routers.calendar.xcals.get_calendar", return_value=mock_cal), \
         patch("routers.calendar.query", return_value=[]), \
         patch("routers.calendar.execute", return_value=1):
        resp = client.get("/api/calendar?month=2026-07")
    assert resp.status_code == 200
    assert resp.json()["events"] == []


def test_calendar_invalid_month_returns_422():
    resp = client.get("/api/calendar?month=not-a-month")
    assert resp.status_code == 422


def test_calendar_tsla_watchlist_stock_type(tmp_path):
    portfolio = {
        "stocks": [],
        "watchlist": [{"ticker": "TSLA", "type": "watchlist", "name": "Tesla"}],
    }
    mock = MagicMock()
    mock.calendar = {"Earnings Date": [date(2026, 5, 15)]}
    mock.dividends = pd.Series([], dtype=float)
    with patch("routers.calendar._CACHE_DIR", tmp_path), \
         patch("routers.calendar.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.calendar.yf.Ticker", return_value=mock), \
         patch("routers.calendar.query", return_value=[]), \
         patch("routers.calendar.execute", return_value=1):
        resp = client.get("/api/calendar?month=2026-05")
    events = resp.json()["events"]
    assert events[0]["stock_type"] == "watchlist"


def test_stale_cache_is_regenerated(tmp_path):
    # Empty cache → forces recomputation and upsert with fresh events
    mock_cal = MagicMock()
    mock_cal.sessions_in_range.return_value = pd.DatetimeIndex([])
    mock_execute = MagicMock(return_value=1)
    with patch("routers.calendar.storage.get_full_portfolio", return_value={"stocks": [], "watchlist": []}), \
         patch("routers.calendar._CACHE_DIR", tmp_path), \
         patch("routers.calendar.xcals.get_calendar", return_value=mock_cal), \
         patch("routers.calendar.query", return_value=[]), \
         patch("routers.calendar.execute", mock_execute):
        resp = client.get("/api/calendar?month=2026-05")

    assert resp.status_code == 200
    # Should have holiday events (computed fresh, not empty stale result)
    events = resp.json()["events"]
    assert any(e["type"] in ("holiday_us", "holiday_kr") for e in events)
    # execute was called to save the new events
    assert mock_execute.called


def test_calendar_includes_nyse_holiday(tmp_path):
    import exchange_calendars as xcals
    import pandas as pd

    mock_cal = MagicMock()
    mock_cal.sessions_in_range.return_value = pd.DatetimeIndex([])  # no sessions → all weekdays are holidays
    # Only one weekday in range: 2026-05-25 is a Monday (Memorial Day)
    with patch("routers.calendar.storage.get_full_portfolio", return_value={"stocks": [], "watchlist": []}), \
         patch("routers.calendar._CACHE_DIR", tmp_path), \
         patch("routers.calendar.xcals.get_calendar", return_value=mock_cal), \
         patch("routers.calendar.query", return_value=[]), \
         patch("routers.calendar.execute", return_value=1):
        resp = client.get("/api/calendar?month=2026-05")

    assert resp.status_code == 200
    events = resp.json()["events"]
    us_holidays = [e for e in events if e["type"] == "holiday_us"]
    assert len(us_holidays) > 0
    assert all(e["ticker"] == "NYSE" for e in us_holidays)
    assert all(e["stock_type"] == "market" for e in us_holidays)


def test_calendar_includes_krx_holiday(tmp_path):
    import pandas as pd

    mock_cal = MagicMock()
    mock_cal.sessions_in_range.return_value = pd.DatetimeIndex([])
    with patch("routers.calendar.storage.get_full_portfolio", return_value={"stocks": [], "watchlist": []}), \
         patch("routers.calendar._CACHE_DIR", tmp_path), \
         patch("routers.calendar.xcals.get_calendar", return_value=mock_cal), \
         patch("routers.calendar.query", return_value=[]), \
         patch("routers.calendar.execute", return_value=1):
        resp = client.get("/api/calendar?month=2026-05")

    assert resp.status_code == 200
    events = resp.json()["events"]
    kr_holidays = [e for e in events if e["type"] == "holiday_kr"]
    assert len(kr_holidays) > 0
    assert all(e["ticker"] == "KRX" for e in kr_holidays)
    assert all(e["stock_type"] == "market" for e in kr_holidays)


# --- eco runnable checks: S1 ex-date parse + S2 FRED parse ---

from routers.calendar import _collect_dividend, _get_econ_events


def _run_collect_dividend(cal, month_start, month_end):
    events = []
    _collect_dividend(cal, "TEST", "holding", "Test Corp", month_start, month_end, events)
    return events


def test_exact_ex_date_in_month():
    cal = {"Ex-Dividend Date": date(2026, 6, 10)}
    events = _run_collect_dividend(cal, date(2026, 6, 1), date(2026, 6, 30))
    assert len(events) == 1
    assert events[0]["date"] == "2026-06-10"
    assert events[0]["type"] == "dividend"


def test_exact_ex_date_out_of_month():
    cal = {"Ex-Dividend Date": date(2026, 7, 10)}
    events = _run_collect_dividend(cal, date(2026, 6, 1), date(2026, 6, 30))
    assert events == []


def test_ex_date_none_graceful():
    events = _run_collect_dividend({"Ex-Dividend Date": None}, date(2026, 6, 1), date(2026, 6, 30))
    assert events == []


def test_ex_date_nat_graceful():
    import pandas as pd
    events = _run_collect_dividend({"Ex-Dividend Date": pd.NaT}, date(2026, 6, 1), date(2026, 6, 30))
    assert events == []


def test_ex_date_missing_key_graceful():
    events = _run_collect_dividend({}, date(2026, 6, 1), date(2026, 6, 30))
    assert events == []


def test_fred_releases_parse():
    """_get_econ_events: mocked FRED response → only curated names pass through."""
    fake_response = {
        "release_dates": [
            {"release_name": "Consumer Price Index", "date": "2026-06-11"},
            {"release_name": "Employment Situation", "date": "2026-06-05"},
            {"release_name": "Some Obscure Release", "date": "2026-06-15"},
            {"release_name": "Gross Domestic Product", "date": "2026-05-30"},  # out of month
        ]
    }
    mock_resp = MagicMock()
    mock_resp.json.return_value = fake_response
    mock_resp.raise_for_status.return_value = None

    with patch("routers.calendar.os.environ.get", return_value="fake-key"), \
         patch("routers.calendar.requests.get", return_value=mock_resp):
        events = _get_econ_events(date(2026, 6, 1), date(2026, 6, 30))

    assert len(events) == 2
    names = {e["name"] for e in events}
    assert "Consumer Price Index 발표" in names
    assert "Employment Situation 발표" in names
    assert all(e["type"] == "econ" for e in events)
    assert all(e["stock_type"] == "market" for e in events)
    assert all(e["ticker"] == "FRED" for e in events)


def test_fred_key_absent_returns_empty():
    """FRED_API_KEY absent → empty list, no error."""
    with patch("routers.calendar.os.environ.get", return_value=None):
        events = _get_econ_events(date(2026, 6, 1), date(2026, 6, 30))
    assert events == []


def test_fred_request_error_returns_empty():
    """FRED request failure → empty list gracefully."""
    with patch("routers.calendar.os.environ.get", return_value="fake-key"), \
         patch("routers.calendar.requests.get", side_effect=Exception("network error")):
        events = _get_econ_events(date(2026, 6, 1), date(2026, 6, 30))
    assert events == []


# --- KR forward earnings: yfinance .KS/.KQ suffix ---

def test_kr_earnings_uses_yf_sym_suffix(tmp_path):
    """KR stock (market=KR, exchange=KS) must use '005930.KS' not '005930'."""
    portfolio = {
        "stocks": [{"ticker": "005930", "type": "holding", "name": "삼성전자", "market": "KR", "exchange": "KS"}],
        "watchlist": [],
    }
    called_with = []

    def _mock_ticker(sym):
        called_with.append(sym)
        m = MagicMock()
        if sym == "005930.KS":
            m.calendar = {"Earnings Date": [date(2026, 7, 29)]}
        else:
            m.calendar = {}
        m.dividends = pd.Series([], dtype=float)
        return m

    with patch("routers.calendar.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.calendar.yf.Ticker", side_effect=_mock_ticker), \
         patch("routers.calendar._CACHE_DIR", tmp_path), \
         patch("routers.calendar.query", return_value=[]), \
         patch("routers.calendar.execute", return_value=1):
        resp = client.get("/api/calendar?month=2026-07")

    assert resp.status_code == 200
    # Must have called yf.Ticker with the .KS suffix, not bare ticker
    assert "005930.KS" in called_with, f"Expected '005930.KS' in {called_with}"
    assert "005930" not in called_with or all(c != "005930" for c in called_with), \
        f"Bare '005930' must not be used, got {called_with}"
    events = resp.json()["events"]
    earnings = [e for e in events if e["type"] == "earnings" and e["ticker"] == "005930"]
    assert len(earnings) == 1
    assert earnings[0]["date"] == "2026-07-29"


def test_kr_earnings_kosdaq_kq_suffix(tmp_path):
    """KOSDAQ stock (exchange=KQ) uses '247540.KQ' suffix."""
    portfolio = {
        "stocks": [{"ticker": "247540", "type": "holding", "name": "에코프로비엠", "market": "KR", "exchange": "KQ"}],
        "watchlist": [],
    }
    called_with = []

    def _mock_ticker(sym):
        called_with.append(sym)
        m = MagicMock()
        if sym == "247540.KQ":
            m.calendar = {"Earnings Date": [date(2026, 7, 29)]}
        else:
            m.calendar = {}
        m.dividends = pd.Series([], dtype=float)
        return m

    with patch("routers.calendar.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.calendar.yf.Ticker", side_effect=_mock_ticker), \
         patch("routers.calendar._CACHE_DIR", tmp_path), \
         patch("routers.calendar.query", return_value=[]), \
         patch("routers.calendar.execute", return_value=1):
        resp = client.get("/api/calendar?month=2026-07")

    assert resp.status_code == 200
    assert "247540.KQ" in called_with
    events = resp.json()["events"]
    earnings = [e for e in events if e["type"] == "earnings" and e["ticker"] == "247540"]
    assert len(earnings) == 1
    assert earnings[0]["date"] == "2026-07-29"


def test_kr_earnings_default_exchange_ks(tmp_path):
    """KR stock with no exchange field defaults to .KS suffix."""
    portfolio = {
        "stocks": [{"ticker": "017670", "type": "holding", "name": "SK텔레콤", "market": "KR"}],
        "watchlist": [],
    }
    called_with = []

    def _mock_ticker(sym):
        called_with.append(sym)
        m = MagicMock()
        m.calendar = {}
        m.dividends = pd.Series([], dtype=float)
        return m

    with patch("routers.calendar.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.calendar.yf.Ticker", side_effect=_mock_ticker), \
         patch("routers.calendar._CACHE_DIR", tmp_path), \
         patch("routers.calendar.query", return_value=[]), \
         patch("routers.calendar.execute", return_value=1):
        resp = client.get("/api/calendar?month=2026-08")

    assert resp.status_code == 200
    assert "017670.KS" in called_with

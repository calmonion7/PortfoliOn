import pytest
from pathlib import Path
from unittest.mock import patch


def test_get_stocks_returns_empty_when_file_missing():
    import services.storage as storage_mod
    original = storage_mod.DATA_DIR
    storage_mod.DATA_DIR = Path("/nonexistent_dir_that_does_not_exist")
    try:
        result = storage_mod.get_stocks()
    finally:
        storage_mod.DATA_DIR = original
    assert result == []


def test_save_and_load_stocks_roundtrip(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        stocks = [{"ticker": "NFLX", "name": "Netflix", "competitors": [], "moat": "", "growth_plan": ""}]
        storage_mod.save_stocks(stocks)
        loaded = storage_mod.get_stocks()
    assert loaded == stocks


def test_get_holdings_returns_empty_when_file_missing():
    import services.storage as storage_mod
    original = storage_mod.DATA_DIR
    storage_mod.DATA_DIR = Path("/nonexistent_dir_that_does_not_exist")
    try:
        result = storage_mod.get_holdings()
    finally:
        storage_mod.DATA_DIR = original
    assert result == []


def test_save_and_load_holdings_roundtrip(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        holdings = [{"ticker": "NFLX", "quantity": 10.0, "avg_cost": 85.59}]
        storage_mod.save_holdings(holdings)
        loaded = storage_mod.get_holdings()
    assert loaded == holdings


def test_get_watchlist_tickers_returns_empty_when_file_missing():
    import services.storage as storage_mod
    original = storage_mod.DATA_DIR
    storage_mod.DATA_DIR = Path("/nonexistent_dir_that_does_not_exist")
    try:
        result = storage_mod.get_watchlist_tickers()
    finally:
        storage_mod.DATA_DIR = original
    assert result == []


def test_save_and_load_watchlist_tickers_roundtrip(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        tickers = ["AAPL", "GOOG"]
        storage_mod.save_watchlist_tickers(tickers)
        loaded = storage_mod.get_watchlist_tickers()
    assert loaded == tickers


def test_get_full_portfolio_joins_holdings_and_watchlist(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        stocks = [
            {"ticker": "LLY", "name": "일라이 릴리", "competitors": ["NVO"], "moat": "Brand", "growth_plan": "GLP1"},
            {"ticker": "AVAV", "name": "에어로바이런먼트", "competitors": [], "moat": "", "growth_plan": ""},
        ]
        holdings = [{"ticker": "LLY", "quantity": 3.0, "avg_cost": 886.6}]
        tickers = ["AVAV"]
        storage_mod.save_stocks(stocks)
        storage_mod.save_holdings(holdings)
        storage_mod.save_watchlist_tickers(tickers)
        result = storage_mod.get_full_portfolio()
    assert len(result["stocks"]) == 1
    assert result["stocks"][0]["ticker"] == "LLY"
    assert result["stocks"][0]["quantity"] == 3.0
    assert result["stocks"][0]["avg_cost"] == 886.6
    assert result["stocks"][0]["moat"] == "Brand"
    assert len(result["watchlist"]) == 1
    assert result["watchlist"][0]["ticker"] == "AVAV"
    assert result["watchlist"][0]["name"] == "에어로바이런먼트"


def test_get_schedule_returns_default_when_file_missing():
    import services.storage as storage_mod
    original = storage_mod.DATA_DIR
    storage_mod.DATA_DIR = Path("/nonexistent_dir_that_does_not_exist")
    try:
        result = storage_mod.get_schedule()
    finally:
        storage_mod.DATA_DIR = original
    assert result["enabled"] is False
    assert result["time"] == "08:00"
    assert "mon" in result["days"]


def test_save_and_load_schedule_roundtrip(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        schedule = {"enabled": True, "time": "09:30", "days": ["mon", "fri"]}
        storage_mod.save_schedule(schedule)
        loaded = storage_mod.get_schedule()
    assert loaded == schedule


def test_enrich_stock_updates_existing_fields(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        storage_mod.save_stocks([
            {"ticker": "LLY", "name": "일라이 릴리", "competitors": [], "moat": "", "growth_plan": "", "recent_disclosures": ""}
        ])
        storage_mod.save_holdings([{"ticker": "LLY", "quantity": 3.0, "avg_cost": 886.6}])
        storage_mod.save_watchlist_tickers([])
        result = storage_mod.enrich_stock("LLY", {"moat": "특허 포트폴리오", "growth_plan": "GLP 확장"})
        loaded = storage_mod.get_stocks()
    assert result is True
    assert loaded[0]["moat"] == "특허 포트폴리오"
    assert loaded[0]["growth_plan"] == "GLP 확장"


def test_enrich_stock_returns_false_when_ticker_not_in_any_list(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        storage_mod.save_stocks([])
        storage_mod.save_holdings([])
        storage_mod.save_watchlist_tickers([])
        result = storage_mod.enrich_stock("FAKE", {"moat": "x"})
    assert result is False


def test_enrich_stock_creates_entry_when_in_watchlist_but_not_in_stocks(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        storage_mod.save_stocks([])
        storage_mod.save_holdings([])
        storage_mod.save_watchlist_tickers(["NVDA"])
        result = storage_mod.enrich_stock("NVDA", {"recent_disclosures": "Q1 호실적"})
        loaded = storage_mod.get_stocks()
    assert result is True
    assert loaded[0]["ticker"] == "NVDA"
    assert loaded[0]["recent_disclosures"] == "Q1 호실적"


def test_enrich_stock_case_insensitive(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        storage_mod.save_stocks([
            {"ticker": "AAPL", "name": "Apple", "competitors": [], "moat": "", "growth_plan": "", "recent_disclosures": ""}
        ])
        storage_mod.save_holdings([{"ticker": "AAPL", "quantity": 1, "avg_cost": 100.0}])
        storage_mod.save_watchlist_tickers([])
        result = storage_mod.enrich_stock("aapl", {"moat": "생태계"})
        loaded = storage_mod.get_stocks()
    assert result is True
    assert loaded[0]["moat"] == "생태계"


def test_get_guru_managers_returns_default_when_file_missing():
    import services.storage as storage_mod
    original = storage_mod.DATA_DIR
    storage_mod.DATA_DIR = Path("/nonexistent_dir_that_does_not_exist")
    try:
        result = storage_mod.get_guru_managers()
    finally:
        storage_mod.DATA_DIR = original
    assert result == {"last_updated": None, "managers": []}


def test_save_and_load_guru_managers_roundtrip(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        data = {
            "last_updated": "2026-05-14T10:00:00",
            "managers": [
                {
                    "id": "brk",
                    "name": "Warren Buffett",
                    "firm": "Berkshire Hathaway",
                    "portfolio_value": 350_000_000_000,
                    "num_stocks": 45,
                    "top10": [{"rank": 1, "ticker": "AAPL", "name": "Apple Inc.", "name_kr": "애플", "weight_pct": 42.1}],
                }
            ],
        }
        storage_mod.save_guru_managers(data)
        loaded = storage_mod.get_guru_managers()
    assert loaded == data


def test_get_guru_schedule_returns_default_when_file_missing():
    import services.storage as storage_mod
    original = storage_mod.DATA_DIR
    storage_mod.DATA_DIR = Path("/nonexistent_dir_that_does_not_exist")
    try:
        result = storage_mod.get_guru_schedule()
    finally:
        storage_mod.DATA_DIR = original
    assert result == {"enabled": False, "day": "sun", "time": "03:00"}


def test_save_and_load_guru_schedule_roundtrip(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        schedule = {"enabled": True, "day": "mon", "time": "04:00"}
        storage_mod.save_guru_schedule(schedule)
        loaded = storage_mod.get_guru_schedule()
    assert loaded == schedule

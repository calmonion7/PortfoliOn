from unittest.mock import patch


def test_get_watchlist_tickers_empty():
    from services import storage
    with patch("services.storage.query", return_value=[]):
        result = storage.get_watchlist_tickers("user-123")
    assert result == []


def test_get_watchlist_tickers_returns_list():
    from services import storage
    with patch("services.storage.query", return_value=[{"ticker": "AAPL"}, {"ticker": "TSLA"}]):
        result = storage.get_watchlist_tickers("user-123")
    assert result == ["AAPL", "TSLA"]


def test_get_holdings_empty():
    from services import storage
    with patch("services.storage.query", return_value=[]):
        result = storage.get_holdings("user-123")
    assert result == []


def test_enrich_stock_not_found():
    from services import storage
    with patch("services.storage.query", return_value=[]):
        result = storage.enrich_stock("AAPL", {"moat": "wide"})
    assert result is False


def test_enrich_stock_found():
    from services import storage
    with patch("services.storage.query", return_value=[{"ticker": "AAPL"}]), \
         patch("services.storage.execute", return_value=1):
        result = storage.enrich_stock("AAPL", {"moat": "wide"})
    assert result is True


def test_get_schedule_default():
    from services import storage
    with patch("services.storage.query", return_value=[]):
        result = storage.get_schedule()
    assert result["enabled"] is False
    assert "time" in result

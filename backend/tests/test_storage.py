from unittest.mock import MagicMock, patch


def _mock_db():
    """Return a chainable Supabase client mock."""
    db = MagicMock()
    chain = MagicMock()
    chain.execute.return_value.data = []
    db.table.return_value.select.return_value = chain
    db.table.return_value.insert.return_value = chain
    db.table.return_value.upsert.return_value = chain
    db.table.return_value.update.return_value = chain
    db.table.return_value.delete.return_value = chain
    return db


@patch("services.storage.get_db")
def test_get_watchlist_tickers_empty(mock_get_db):
    mock_db = _mock_db()
    mock_get_db.return_value = mock_db
    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []

    from services import storage
    result = storage.get_watchlist_tickers("user-123")
    assert result == []


@patch("services.storage.get_db")
def test_get_watchlist_tickers_returns_list(mock_get_db):
    mock_db = _mock_db()
    mock_get_db.return_value = mock_db
    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
        {"ticker": "AAPL"},
        {"ticker": "TSLA"},
    ]

    from services import storage
    result = storage.get_watchlist_tickers("user-123")
    assert result == ["AAPL", "TSLA"]


@patch("services.storage.get_db")
def test_get_holdings_empty(mock_get_db):
    mock_db = _mock_db()
    mock_get_db.return_value = mock_db
    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []

    from services import storage
    result = storage.get_holdings("user-123")
    assert result == []


@patch("services.storage.get_db")
def test_enrich_stock_not_found(mock_get_db):
    mock_db = _mock_db()
    mock_get_db.return_value = mock_db
    mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []

    from services import storage
    result = storage.enrich_stock("AAPL", {"moat": "wide"})
    assert result is False


@patch("services.storage.get_db")
def test_enrich_stock_found(mock_get_db):
    mock_db = _mock_db()
    mock_get_db.return_value = mock_db
    mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{"ticker": "AAPL"}]

    from services import storage
    result = storage.enrich_stock("AAPL", {"moat": "wide"})
    assert result is True


@patch("services.storage.get_db")
def test_get_schedule_default(mock_get_db):
    mock_db = _mock_db()
    mock_get_db.return_value = mock_db
    mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []

    from services import storage
    result = storage.get_schedule()
    assert result["enabled"] is False
    assert "time" in result

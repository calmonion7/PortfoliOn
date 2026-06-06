from unittest.mock import patch, MagicMock


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


# ── save_stocks: ETF 플래그(is_etf) 저장 ──────────────────────────────────────

def _capture_save_stocks(stock: dict):
    """save_stocks 실행 중 tickers INSERT의 (sql, params)를 캡처해 반환."""
    from services import storage
    mock_cur = MagicMock()
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    with patch("services.storage.get_connection") as gc:
        gc.return_value.__enter__.return_value = mock_conn
        storage.save_stocks("user-123", [stock])
    for call in mock_cur.execute.call_args_list:
        sql = call.args[0]
        if "INSERT INTO tickers" in sql:
            return sql, call.args[1]
    raise AssertionError("tickers INSERT not executed")


def test_save_stocks_marks_etf_true_for_etf_security_type():
    """security_type=='ETF'이면 tickers INSERT가 is_etf=True로 저장한다."""
    sql, params = _capture_save_stocks(
        {"ticker": "SPY", "name": "SPDR S&P 500", "market": "US", "security_type": "ETF"}
    )
    assert "is_etf" in sql
    assert params[-1] is True


def test_save_stocks_marks_etf_false_for_equity():
    """일반 주식(security_type 미지정/EQUITY)은 is_etf=False."""
    sql, params = _capture_save_stocks(
        {"ticker": "AAPL", "name": "Apple", "market": "US"}
    )
    assert params[-1] is False


def test_save_stocks_preserves_is_etf_on_conflict():
    """재저장 시 security_type 누락으로 is_etf가 FALSE로 덮이지 않게 OR 보존 가드가 있어야 한다."""
    sql, _ = _capture_save_stocks(
        {"ticker": "AAPL", "name": "Apple", "market": "US"}
    )
    assert "is_etf=tickers.is_etf OR EXCLUDED.is_etf" in sql

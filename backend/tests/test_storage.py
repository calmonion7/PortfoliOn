from unittest.mock import patch, MagicMock


def test_get_watchlist_tickers_empty():
    from services import storage
    with patch("services.storage.portfolio.query", return_value=[]):
        result = storage.get_watchlist_tickers("user-123")
    assert result == []


def test_get_watchlist_tickers_returns_list():
    from services import storage
    with patch("services.storage.portfolio.query", return_value=[{"ticker": "AAPL"}, {"ticker": "TSLA"}]):
        result = storage.get_watchlist_tickers("user-123")
    assert result == ["AAPL", "TSLA"]


def test_get_holdings_empty():
    from services import storage
    with patch("services.storage.portfolio.query", return_value=[]):
        result = storage.get_holdings("user-123")
    assert result == []


def test_enrich_stock_not_found():
    from services import storage
    with patch("services.storage.portfolio.query", return_value=[]):
        result = storage.enrich_stock("AAPL", {"moat": "wide"})
    assert result is False


def test_enrich_stock_found():
    from services import storage
    with patch("services.storage.portfolio.query", return_value=[{"ticker": "AAPL"}]), \
         patch("services.storage.portfolio.execute", return_value=1):
        result = storage.enrich_stock("AAPL", {"moat": "wide"})
    assert result is True


def test_get_schedule_default():
    from services import storage
    with patch("services.storage.schedule.query", return_value=[]):
        result = storage.get_schedule()
    assert result["enabled"] is False
    assert "time" in result


# ── batch_schedules ──────────────────────────────────────────────────────────

def test_get_batch_schedule_none_when_no_row():
    from services import storage
    with patch("services.storage.schedule.query", return_value=[]):
        result = storage.get_batch_schedule("daily_digest")
    assert result is None


def test_get_batch_schedule_returns_data():
    from services import storage
    spec = {"enabled": True, "type": "daily", "time": "08:00"}
    with patch("services.storage.schedule.query", return_value=[{"data": spec}]):
        result = storage.get_batch_schedule("daily_digest")
    assert result == spec


def test_save_batch_schedule_upsert():
    from services import storage
    spec = {"enabled": True, "type": "daily", "time": "08:00"}
    with patch("services.storage.schedule.execute") as ex:
        storage.save_batch_schedule("daily_digest", spec)
    sql = ex.call_args.args[0]
    assert "INSERT INTO batch_schedules" in sql
    assert "ON CONFLICT (job_id) DO UPDATE" in sql
    params = ex.call_args.args[1]
    assert params[0] == "daily_digest"


def test_get_all_batch_schedules_maps_job_id_to_spec():
    from services import storage
    rows = [
        {"job_id": "daily_digest", "data": {"enabled": True, "type": "daily", "time": "08:00"}},
        {"job_id": "backlog_fetch", "data": {"enabled": True, "type": "weekly", "days": ["sun"], "time": "04:00"}},
    ]
    with patch("services.storage.schedule.query", return_value=rows):
        result = storage.get_all_batch_schedules()
    assert result["daily_digest"]["time"] == "08:00"
    assert result["backlog_fetch"]["days"] == ["sun"]
    assert set(result.keys()) == {"daily_digest", "backlog_fetch"}


# ── save_stocks: ETF 플래그(is_etf) 저장 ──────────────────────────────────────

def _capture_save_stocks(stock: dict):
    """save_stocks 실행 중 tickers INSERT의 (sql, params)를 캡처해 반환."""
    from services import storage
    mock_cur = MagicMock()
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    with patch("services.storage.portfolio.get_connection") as gc:
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


# ── save_holdings / save_stocks: 종목명 ticker 클로버 방어 (stock-name-ticker-revert-fix) ──

def _capture_save_holdings(holding: dict):
    """save_holdings 실행 중 tickers INSERT의 (sql, params)를 캡처해 반환."""
    from services import storage
    mock_cur = MagicMock()
    mock_cur.fetchall.return_value = []
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    with patch("services.storage.portfolio.get_connection") as gc:
        gc.return_value.__enter__.return_value = mock_conn
        storage.save_holdings("user-123", [holding])
    for call in mock_cur.execute.call_args_list:
        sql = call.args[0]
        if "INSERT INTO tickers" in sql:
            return sql, call.args[1]
    raise AssertionError("tickers INSERT not executed")


def test_save_holdings_guards_name_clobber_when_name_missing():
    """name 없이 보유 저장 시 tickers UPSERT가 비파괴 가드(CASE WHEN)로 기존 name을 보존한다."""
    sql, _ = _capture_save_holdings({"ticker": "005930", "quantity": 10, "avg_cost": 70000})
    assert "EXCLUDED.name = EXCLUDED.ticker" in sql
    assert "tickers.name" in sql


def test_save_stocks_guards_name_clobber_when_name_missing():
    """name 없이 관심종목 저장 시에도 tickers UPSERT가 비파괴 가드로 기존 name을 보존한다."""
    sql, _ = _capture_save_stocks({"ticker": "005930", "market": "KR"})
    assert "EXCLUDED.name = EXCLUDED.ticker" in sql
    assert "tickers.name" in sql


# ── update_ticker_meta 빈 이름 가드 ─────────────────────────────────────────

def test_update_ticker_meta_skips_name_update_on_empty_name():
    """빈 이름("")으로 호출하면 tickers.name UPDATE가 나가지 않고 competitors만 갱신된다."""
    from services.storage.names import update_ticker_meta
    calls = []
    def fake_execute(sql, params):
        calls.append((sql, params))
    with patch("services.storage.names.execute", side_effect=fake_execute), \
         patch("services.storage.names.refresh_snapshot_names") as mock_refresh:
        update_ticker_meta("NVDA", "", ["AMD"])
    assert mock_refresh.call_count == 0, "빈 이름이면 refresh_snapshot_names를 호출하면 안 됨"
    assert len(calls) == 1
    assert "name" not in calls[0][0].split("SET")[1].split("WHERE")[0]
    # competitors는 갱신됐는지 확인
    assert calls[0][1][0] == '["AMD"]'


def test_update_ticker_meta_skips_name_update_on_whitespace_name():
    """공백만인 이름으로 호출해도 name UPDATE를 생략한다."""
    from services.storage.names import update_ticker_meta
    with patch("services.storage.names.execute") as mock_exec, \
         patch("services.storage.names.refresh_snapshot_names") as mock_refresh:
        update_ticker_meta("NVDA", "   ", [])
    mock_refresh.assert_not_called()
    # execute는 1번(competitors만) 호출
    assert mock_exec.call_count == 1
    sql = mock_exec.call_args[0][0]
    assert "name" not in sql.split("SET")[1].split("WHERE")[0]


def test_update_ticker_meta_skips_name_update_when_name_equals_ticker():
    """이름이 티커와 동일(대소문자 무시)이면 name UPDATE를 생략한다."""
    from services.storage.names import update_ticker_meta
    with patch("services.storage.names.execute") as mock_exec, \
         patch("services.storage.names.refresh_snapshot_names") as mock_refresh:
        update_ticker_meta("NVDA", "nvda", [])
    mock_refresh.assert_not_called()
    assert mock_exec.call_count == 1


def test_update_ticker_meta_updates_name_when_valid():
    """유효한 이름이면 기존과 동일하게 name + refresh_snapshot_names 모두 실행된다."""
    from services.storage.names import update_ticker_meta
    with patch("services.storage.names.execute") as mock_exec, \
         patch("services.storage.names.refresh_snapshot_names") as mock_refresh:
        update_ticker_meta("NVDA", "NVIDIA Corp", ["AMD"])
    mock_exec.assert_called_once()
    sql = mock_exec.call_args[0][0]
    assert "name" in sql
    mock_refresh.assert_called_once_with("NVDA", "NVIDIA Corp")


# ── target_weight (리밸런싱, task#146) ──────────────────────────────────────

def test_get_holdings_selects_target_weight():
    from services import storage
    with patch("services.storage.portfolio.query", return_value=[]) as mock_query:
        storage.get_holdings("user-123")
    assert "target_weight" in mock_query.call_args[0][0]


def test_get_full_portfolio_includes_target_weight_for_holdings():
    from services import storage
    row = {"ticker": "AAPL", "type": "holding", "quantity": 10, "avg_cost": 150.0,
           "target_price": None, "stop_price": None, "target_weight": 40.0,
           "name": "Apple", "market": "US", "exchange": "", "is_etf": False,
           "competitors": [], "moat": None, "growth_plan": None, "risks": None,
           "recent_disclosures": None, "insights": None}
    with patch("services.storage.portfolio.query", return_value=[row]):
        result = storage.get_full_portfolio("user-123")
    assert result["stocks"][0]["target_weight"] == 40.0


def test_save_holdings_upsert_preserves_target_weight_when_not_provided():
    """save_holdings는 target_weight를 넘기지 않아도(일반 수정 폼) 기존 값을 덮어쓰지 않는다(COALESCE)."""
    from services import storage
    mock_cur = MagicMock()
    mock_cur.fetchall.return_value = []
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    with patch("services.storage.portfolio.get_connection") as gc:
        gc.return_value.__enter__.return_value = mock_conn
        storage.save_holdings("user-123", [{"ticker": "AAPL", "quantity": 10, "avg_cost": 150.0}])
    sql, params = next(
        (c.args[0], c.args[1]) for c in mock_cur.execute.call_args_list
        if "INSERT INTO user_stocks" in c.args[0]
    )
    assert "COALESCE(EXCLUDED.target_weight, user_stocks.target_weight)" in sql
    assert params[-1] is None  # h.get("target_weight") → None


def test_set_target_weights_updates_each_ticker():
    from services import storage
    mock_cur = MagicMock()
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    with patch("services.storage.portfolio.get_connection") as gc:
        gc.return_value.__enter__.return_value = mock_conn
        storage.set_target_weights("user-123", {"aapl": 40, "TSLA": 60})
    calls = mock_cur.execute.call_args_list
    assert len(calls) == 2
    tickers_updated = {c.args[1][2] for c in calls}
    assert tickers_updated == {"AAPL", "TSLA"}

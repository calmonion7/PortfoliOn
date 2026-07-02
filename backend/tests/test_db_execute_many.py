# backend/tests/test_db_execute_many.py
from unittest.mock import MagicMock, patch, call


def test_execute_many_calls_execute_batch_once():
    """단일 커넥션 획득 + execute_batch 1회 호출."""
    mock_cur = MagicMock()
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__ = lambda s: mock_cur
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

    sql = "INSERT INTO t (v) VALUES (%s)"
    params_list = [(1,), (2,), (3,)]

    with patch("services.db.get_connection") as mock_gc, \
         patch("services.db.execute_batch") as mock_eb:
        mock_gc.return_value.__enter__ = lambda s: mock_conn
        mock_gc.return_value.__exit__ = MagicMock(return_value=False)

        from services.db import execute_many
        execute_many(sql, params_list)

    mock_gc.assert_called_once()
    mock_eb.assert_called_once_with(mock_cur, sql, params_list)


def test_execute_many_empty_list_no_op():
    """빈 params_list → 커넥션 미획득, execute_batch 미호출."""
    with patch("services.db.get_connection") as mock_gc, \
         patch("services.db.execute_batch") as mock_eb:

        from services.db import execute_many
        execute_many("INSERT INTO t (v) VALUES (%s)", [])

    mock_gc.assert_not_called()
    mock_eb.assert_not_called()

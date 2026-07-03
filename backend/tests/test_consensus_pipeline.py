"""consensus_pipeline 단위테스트."""
from unittest.mock import patch, call
import services.consensus_pipeline as pipeline


def test_mart_sql_has_having_guard():
    """_MART_SQL에 HAVING COUNT(*) > 0 가드가 포함돼야 한다.
    빠지면 empty CTE 시 NULL/0 행이 ON CONFLICT DO UPDATE로 기존 행을 덮어쓴다."""
    assert "HAVING COUNT(*) > 0" in pipeline._MART_SQL


def test_refresh_mart_empty_raw_reports_skips_upsert():
    """raw_reports 없을 때 execute가 실행되되 SQL에 HAVING 가드가 있어 0행 INSERT를 발생시킨다.
    (query-mock 한계: 실제 0행 검증은 라이브 스모크로 — 여기선 SQL 포함 여부만 단언)"""
    from datetime import date
    with patch("services.consensus_pipeline.execute") as mock_exec:
        mock_exec.return_value = 0
        pipeline.refresh_mart("AAPL", date(2026, 7, 1))
    sql_called = mock_exec.call_args[0][0]
    assert "HAVING COUNT(*) > 0" in sql_called

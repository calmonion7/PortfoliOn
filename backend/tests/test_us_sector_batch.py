"""us_sector_fetch 배치 배선 — 레지스트리·스케줄러·job_runs 4표면 일관성.

kr_sector_batch 미러.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from unittest.mock import patch, MagicMock

import scheduler
from services import batch_registry


def test_registry_entry_fields():
    entry = batch_registry.get_batch("us_sector_fetch")
    assert entry is not None
    assert entry["market"] == "US"
    assert entry["category"] == "market"
    assert entry["source"] == ["yfinance"]
    assert entry["manual_endpoint"] == "/api/analysis/sector/refresh-us"
    assert entry["editable"] is True
    assert set(entry["trigger_kinds"]) == {"auto", "manual"}
    assert entry["scheduler_job_id"] == "us_sector_fetch"
    assert entry["timezone"] == "Asia/Seoul"


def test_registry_default_schedule():
    sched = batch_registry.get_batch("us_sector_fetch")["default_schedule"]
    assert sched["enabled"] is True
    assert sched["type"] == "daily"
    assert sched["time"] == "07:20"


def test_scheduler_job_func_registered():
    assert "us_sector_fetch" in scheduler._JOB_FUNCS
    assert callable(scheduler._JOB_FUNCS["us_sector_fetch"])


def test_default_schedule_builds_valid_trigger():
    entry = batch_registry.get_batch("us_sector_fetch")
    trigger = scheduler._build_trigger(entry["default_schedule"], entry["timezone"])
    fields = {f.name: str(f) for f in trigger.fields}
    assert fields["hour"] == "7"
    assert fields["minute"] == "20"
    assert str(trigger.timezone) == "Asia/Seoul"


def test_batch_func_records_auto():
    """배치 본문이 us_sector_fetch id로 auto 기록 + refresh 호출."""
    recorded = []

    class _Ctx:
        def __enter__(self): return None
        def __exit__(self, *a): return False

    def fake_record(job_id, trigger):
        recorded.append((job_id, trigger))
        return _Ctx()

    with patch.object(scheduler.job_runs, "record", side_effect=fake_record), \
         patch("services.us_sector_service.refresh", return_value=[]) as ref:
        scheduler._fetch_us_sector()
    assert recorded == [("us_sector_fetch", "auto")]
    ref.assert_called_once()


def test_refresh_saves_when_sectors_have_data():
    """refresh: 데이터 있으면 _mc_save 호출."""
    sectors_data = [
        {"name": "Technology", "etf": "XLK", "return_1w": 1.0, "return_1mo": 2.0, "return_3mo": 5.0},
    ]
    with patch("services.us_sector_service._mc_save") as mock_save, \
         patch("services.us_sector_service.parallel_map", return_value=sectors_data):
        import services.us_sector_service as svc
        result = svc.refresh()
    mock_save.assert_called_once()
    assert result == sectors_data


def test_refresh_skips_save_when_all_none():
    """refresh: 전 섹터 None이면 _mc_save 미호출(직전값 유지)."""
    sectors_data = [
        {"name": "Technology", "etf": "XLK", "return_1w": None, "return_1mo": None, "return_3mo": None},
        {"name": "Financials",  "etf": "XLF", "return_1w": None, "return_1mo": None, "return_3mo": None},
    ]
    with patch("services.us_sector_service._mc_save") as mock_save, \
         patch("services.us_sector_service.parallel_map", return_value=sectors_data):
        import services.us_sector_service as svc
        svc.refresh()
    mock_save.assert_not_called()


def test_load_momentum_returns_empty_when_no_cache():
    with patch("services.us_sector_service._mc_load", return_value=None):
        import services.us_sector_service as svc
        assert svc.load_momentum() == []


def test_load_momentum_returns_sectors():
    sectors_data = [{"name": "Technology", "etf": "XLK", "return_1w": 1.0}]
    with patch("services.us_sector_service._mc_load",
               return_value={"data": {"sectors": sectors_data}}):
        import services.us_sector_service as svc
        assert svc.load_momentum() == sectors_data

"""kr_sector_fetch 배치 배선 (task 48, S4) — 레지스트리·스케줄러·job_runs 4표면 일관성."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from unittest.mock import patch

import scheduler
from services import batch_registry


def test_registry_entry_market_kr_market_category():
    entry = batch_registry.get_batch("kr_sector_fetch")
    assert entry is not None
    assert entry["market"] == "KR"
    assert entry["category"] == "market"
    assert entry["editable"] is True
    assert set(entry["trigger_kinds"]) == {"auto", "manual"}
    assert entry["manual_endpoint"] == "/api/analysis/sector/refresh-kr"
    assert entry["scheduler_job_id"] == "kr_sector_fetch"
    assert entry["timezone"] == "Asia/Seoul"


def test_registry_default_schedule_daily_after_close():
    sched = batch_registry.get_batch("kr_sector_fetch")["default_schedule"]
    assert sched["enabled"] is True
    assert sched["type"] == "daily"
    assert sched["time"] == "16:00"


def test_scheduler_job_func_registered():
    assert "kr_sector_fetch" in scheduler._JOB_FUNCS
    assert callable(scheduler._JOB_FUNCS["kr_sector_fetch"])


def test_default_schedule_builds_valid_trigger():
    entry = batch_registry.get_batch("kr_sector_fetch")
    trigger = scheduler._build_trigger(entry["default_schedule"], entry["timezone"])
    fields = {f.name: str(f) for f in trigger.fields}
    assert fields["hour"] == "16"
    assert fields["minute"] == "0"
    assert str(trigger.timezone) == "Asia/Seoul"


def test_batch_func_records_auto():
    """배치 본문이 kr_sector_fetch id로 auto 기록 + refresh 호출."""
    recorded = []

    class _Ctx:
        def __enter__(self): return None
        def __exit__(self, *a): return False

    def fake_record(job_id, trigger):
        recorded.append((job_id, trigger))
        return _Ctx()

    with patch.object(scheduler.job_runs, "record", side_effect=fake_record), \
         patch("services.kr_sector_service.refresh", return_value=[]) as ref:
        scheduler._fetch_kr_sector()
    assert recorded == [("kr_sector_fetch", "auto")]
    ref.assert_called_once()

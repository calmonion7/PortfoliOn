import json
import pytest
from pathlib import Path
from unittest.mock import patch

def test_get_portfolio_returns_empty_when_file_missing():
    with patch("services.storage.DATA_DIR", Path("/nonexistent")):
        from services import storage
        import importlib
        importlib.reload(storage)
        result = storage.get_portfolio()
    assert result == {"stocks": []}

def test_save_and_load_portfolio_roundtrip(tmp_path):
    import importlib
    import services.storage as storage_module
    with patch("services.storage.DATA_DIR", tmp_path):
        importlib.reload(storage_module)
        portfolio = {"stocks": [{"ticker": "NFLX", "quantity": 10, "avg_cost": 85.59}]}
        storage_module.save_portfolio(portfolio)
        loaded = storage_module.get_portfolio()
    assert loaded == portfolio

def test_get_schedule_returns_default_when_file_missing():
    with patch("services.storage.DATA_DIR", Path("/nonexistent")):
        import importlib
        import services.storage as storage_module
        importlib.reload(storage_module)
        result = storage_module.get_schedule()
    assert result["enabled"] is False
    assert result["time"] == "08:00"
    assert "mon" in result["days"]

def test_save_and_load_schedule_roundtrip(tmp_path):
    import importlib
    import services.storage as storage_module
    with patch("services.storage.DATA_DIR", tmp_path):
        importlib.reload(storage_module)
        schedule = {"enabled": True, "time": "09:30", "days": ["mon", "fri"]}
        storage_module.save_schedule(schedule)
        loaded = storage_module.get_schedule()
    assert loaded == schedule

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import json
from datetime import date
from unittest.mock import patch, MagicMock
import pandas as pd

SAMPLE_PORTFOLIO = {
    "stocks": [
        {"ticker": "AAPL", "name": "Apple", "quantity": 10, "avg_cost": 150.0, "market": "US", "exchange": ""},
    ],
    "watchlist": [
        {"ticker": "TSLA", "name": "Tesla", "market": "US", "exchange": ""},
    ],
}

SAMPLE_DIGEST = {
    "date": "2026-05-23",
    "generated_at": "2026-05-23T08:00:00+09:00",
    "portfolio_summary": {"total_value_usd": 1020.0, "daily_change_pct": 2.0, "daily_change_usd": 20.0},
    "stocks": [{"ticker": "AAPL", "name": "Apple", "change_pct": 2.0, "is_holding": True, "is_anomaly": False}],
    "events_7d": [],
    "anomalies": [],
}


def _normal_ticker(symbol):
    m = MagicMock()
    m.history.return_value = pd.DataFrame(
        {"Close": [100.0, 102.0]},
        index=pd.DatetimeIndex(["2026-05-22", "2026-05-23"]),
    )
    return m


def _big_drop_ticker(symbol):
    m = MagicMock()
    m.history.return_value = pd.DataFrame(
        {"Close": [100.0, 94.0]},
        index=pd.DatetimeIndex(["2026-05-22", "2026-05-23"]),
    )
    return m


def test_generate_stocks_list(tmp_path):
    import services.digest_service as ds
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("services.digest_service.yf.Ticker", side_effect=_normal_ticker), \
         patch("services.digest_service._get_events", return_value=[]):
        result = ds.generate(today=date(2026, 5, 23))
    assert len(result["stocks"]) == 2
    assert result["stocks"][0]["ticker"] == "AAPL"
    assert result["stocks"][0]["is_holding"] is True
    assert result["stocks"][1]["ticker"] == "TSLA"
    assert result["stocks"][1]["is_holding"] is False


def test_generate_detects_anomaly(tmp_path):
    import services.digest_service as ds
    portfolio = {
        "stocks": [{"ticker": "AAPL", "name": "Apple", "quantity": 5, "avg_cost": 100.0, "market": "US", "exchange": ""}],
        "watchlist": [],
    }
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=portfolio), \
         patch("services.digest_service.yf.Ticker", side_effect=_big_drop_ticker), \
         patch("services.digest_service._get_events", return_value=[]):
        result = ds.generate(today=date(2026, 5, 23))
    assert result["stocks"][0]["is_anomaly"] is True
    assert len(result["anomalies"]) == 1
    assert result["anomalies"][0]["ticker"] == "AAPL"


def test_generate_saves_snapshot(tmp_path):
    import services.digest_service as ds
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("services.digest_service.yf.Ticker", side_effect=_normal_ticker), \
         patch("services.digest_service._get_events", return_value=[]):
        ds.generate(today=date(2026, 5, 23))
    assert (tmp_path / "2026-05-23.json").exists()


def test_get_latest_returns_none_when_empty(tmp_path):
    import services.digest_service as ds
    with patch.object(ds, "DIGEST_DIR", tmp_path):
        assert ds.get_latest() is None


def test_get_latest_returns_most_recent(tmp_path):
    import services.digest_service as ds
    (tmp_path / "2026-05-22.json").write_text(json.dumps({"date": "2026-05-22"}), encoding="utf-8")
    (tmp_path / "2026-05-23.json").write_text(json.dumps({"date": "2026-05-23"}), encoding="utf-8")
    with patch.object(ds, "DIGEST_DIR", tmp_path):
        result = ds.get_latest()
    assert result["date"] == "2026-05-23"


def test_send_telegram_does_nothing_without_env(monkeypatch):
    import services.digest_service as ds
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    ds.send_telegram(SAMPLE_DIGEST)  # should not raise


def test_send_telegram_posts_when_env_set(monkeypatch):
    import services.digest_service as ds
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "testtoken")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "12345")
    with patch("services.digest_service.requests.post") as mock_post:
        mock_post.return_value.status_code = 200
        ds.send_telegram(SAMPLE_DIGEST)
    mock_post.assert_called_once()
    _, kwargs = mock_post.call_args
    assert kwargs["json"]["chat_id"] == "12345"

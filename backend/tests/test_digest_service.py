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
    "portfolio_summary": {"total_value_krw": 1407600.0, "daily_change_pct": 2.0, "daily_change_krw": 27600.0},
    "stocks": [{"ticker": "AAPL", "name": "Apple", "change_pct": 2.0, "is_holding": True, "is_anomaly": False}],
    "events_7d": [],
    "anomalies": [],
}


# batch quote helpers: {TICKER: {price, daily_change_pct, weekly_change_pct, monthly_change_pct}}
_BATCH_NORMAL = {
    "AAPL": {"price": 102.0, "daily_change_pct": 2.0, "weekly_change_pct": 1.0, "monthly_change_pct": 0.5},
    "TSLA": {"price": 200.0, "daily_change_pct": -1.0, "weekly_change_pct": 0.5, "monthly_change_pct": 2.0},
}
_BATCH_BIG_DROP = {
    "AAPL": {"price": 94.0, "daily_change_pct": -6.0, "weekly_change_pct": -5.0, "monthly_change_pct": -4.0},
}


def test_generate_stocks_list(tmp_path):
    import services.digest_service as ds
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("services.digest_service.get_quotes_batch", return_value=_BATCH_NORMAL), \
         patch("services.digest_service._get_usdkrw", return_value=1380), \
         patch("services.digest_service._get_events", return_value=[]), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        result = ds.generate("test-user-id", today=date(2026, 5, 23))
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
         patch("services.digest_service.get_quotes_batch", return_value=_BATCH_BIG_DROP), \
         patch("services.digest_service._get_usdkrw", return_value=1380), \
         patch("services.digest_service._get_events", return_value=[]), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        result = ds.generate("test-user-id", today=date(2026, 5, 23))
    assert result["stocks"][0]["is_anomaly"] is True
    assert len(result["anomalies"]) == 1
    assert result["anomalies"][0]["ticker"] == "AAPL"


def test_generate_saves_snapshot(tmp_path):
    import services.digest_service as ds
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("services.digest_service.get_quotes_batch", return_value=_BATCH_NORMAL), \
         patch("services.digest_service._get_usdkrw", return_value=1380), \
         patch("services.digest_service._get_events", return_value=[]), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        ds.generate("test-user-id", today=date(2026, 5, 23))
    assert (tmp_path / "test-user-id-2026-05-23.json").exists()


def test_get_latest_returns_none_when_empty(tmp_path):
    import services.digest_service as ds
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.query", side_effect=Exception("no db")):
        assert ds.get_latest("test-user-id") is None


def test_get_latest_returns_most_recent(tmp_path):
    import services.digest_service as ds
    (tmp_path / "test-user-id-2026-05-22.json").write_text(json.dumps({"date": "2026-05-22"}), encoding="utf-8")
    (tmp_path / "test-user-id-2026-05-23.json").write_text(json.dumps({"date": "2026-05-23"}), encoding="utf-8")
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.query", side_effect=Exception("no db")):
        result = ds.get_latest("test-user-id")
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


def test_generate_skips_stock_on_batch_empty(tmp_path):
    """get_quotes_batch가 빈 dict 반환하면 모든 종목 시세 없음 처리."""
    import services.digest_service as ds
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("services.digest_service.get_quotes_batch", return_value={}), \
         patch("services.digest_service._get_usdkrw", return_value=1380), \
         patch("services.digest_service._get_events", return_value=[]), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        result = ds.generate("test-user-id", today=date(2026, 5, 23))
    assert result["stocks"] == []
    assert result["portfolio_summary"]["total_value_krw"] == 0.0


def test_generate_portfolio_summary(tmp_path):
    import services.digest_service as ds
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("services.digest_service.get_quotes_batch", return_value=_BATCH_NORMAL), \
         patch("services.digest_service._get_usdkrw", return_value=1380), \
         patch("services.digest_service._get_events", return_value=[]), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        result = ds.generate("test-user-id", today=date(2026, 5, 23))
    # AAPL: 10주, price=102.0, daily_change_pct=2.0 → prev_close=100.0, usdkrw=1380
    assert result["portfolio_summary"]["total_value_krw"] == 1407600.0
    assert result["portfolio_summary"]["daily_change_krw"] == 27600.0
    assert result["portfolio_summary"]["daily_change_pct"] == 2.0


def test_generate_events_7d_filter(tmp_path):
    import services.digest_service as ds
    events = [
        {"ticker": "AAPL", "type": "earnings", "date": "2026-05-24", "stock_type": "holding", "name": "Apple"},
        {"ticker": "AAPL", "type": "earnings", "date": "2026-06-01", "stock_type": "holding", "name": "Apple"},  # outside 7 days
    ]
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("services.digest_service.get_quotes_batch", return_value=_BATCH_NORMAL), \
         patch("services.digest_service._get_usdkrw", return_value=1380), \
         patch("services.digest_service._get_events", return_value=events), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        result = ds.generate("test-user-id", today=date(2026, 5, 23))
    assert len(result["events_7d"]) == 1
    assert result["events_7d"][0]["ticker"] == "AAPL"
    assert result["events_7d"][0]["days_until"] == 1


KR_PORTFOLIO = {
    "stocks": [
        {"ticker": "005930.KS", "name": "삼성전자", "quantity": 10, "avg_cost": 70000.0, "market": "KR", "exchange": ""},
    ],
    "watchlist": [],
}


_BATCH_KR_NORMAL = {
    "005930.KS": {"price": 102.0, "daily_change_pct": 2.0, "weekly_change_pct": 1.0, "monthly_change_pct": 0.5},
}


def test_generate_includes_insider_trades_when_signal(tmp_path):
    """S6: 보유 종목에 순매수/순매도 신호가 있으면 insider_trades 필드에 부착.
    S7: compute_net_signals_batch 배치 경로로 mock 타깃 이동."""
    import services.digest_service as ds
    ticker = "005930.KS"
    sig = {"direction": "buy", "net_shares": 12000, "count": 3, "window_days": 90}
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=KR_PORTFOLIO), \
         patch("services.digest_service.get_quotes_batch", return_value=_BATCH_KR_NORMAL), \
         patch("services.digest_service._get_usdkrw", return_value=1380), \
         patch("services.digest_service._get_events", return_value=[]), \
         patch("services.disclosures.get_disclosures_batch", return_value=[]), \
         patch("services.insider_trades.compute_net_signals_batch", return_value={ticker: sig}), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        result = ds.generate("test-user-id", today=date(2026, 5, 23))
    assert "insider_trades" in result
    assert result["insider_trades"] == [
        {"ticker": "005930.KS", "direction": "buy", "net_shares": 12000, "count": 3},
    ]


def test_generate_insider_trades_excludes_neutral(tmp_path):
    """신호 없음(neutral)은 insider_trades 목록에서 제외(disclosures와 동형의 신호 필터).
    S7: compute_net_signals_batch 배치 경로로 mock 타깃 이동."""
    import services.digest_service as ds
    ticker = "005930.KS"
    sig = {"direction": "neutral", "net_shares": 0, "count": 0, "window_days": 90}
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=KR_PORTFOLIO), \
         patch("services.digest_service.get_quotes_batch", return_value=_BATCH_KR_NORMAL), \
         patch("services.digest_service._get_usdkrw", return_value=1380), \
         patch("services.digest_service._get_events", return_value=[]), \
         patch("services.disclosures.get_disclosures_batch", return_value=[]), \
         patch("services.insider_trades.compute_net_signals_batch", return_value={ticker: sig}), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        result = ds.generate("test-user-id", today=date(2026, 5, 23))
    assert result["insider_trades"] == []


def test_generate_nan_quote_does_not_break_serialization(tmp_path):
    """get_quotes_batch가 NaN price를 주면 시세 없음으로 처리 → total_value 오염 방지.
    starlette allow_nan=False 직렬화가 깨지지 않아야 한다(회귀 방지)."""
    import services.digest_service as ds
    _batch_nan = {"AAPL": {"price": float("nan"), "daily_change_pct": 2.0,
                           "weekly_change_pct": 0.0, "monthly_change_pct": 0.0}}
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("services.digest_service.get_quotes_batch", return_value=_batch_nan), \
         patch("services.digest_service._get_usdkrw", return_value=1380), \
         patch("services.digest_service._get_events", return_value=[]), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        result = ds.generate("test-user-id", today=date(2026, 5, 23))
    assert result["portfolio_summary"]["total_value_krw"] == 0.0
    assert result["stocks"] == []
    json.dumps(result, allow_nan=False)


def test_generate_insider_trades_graceful_on_error(tmp_path):
    """compute_net_signals_batch 예외는 배치 단위로 graceful skip(다이제스트 생성 무중단).
    S7: 배치 경로로 mock 타깃 이동."""
    import services.digest_service as ds
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=KR_PORTFOLIO), \
         patch("services.digest_service.get_quotes_batch", return_value=_BATCH_KR_NORMAL), \
         patch("services.digest_service._get_usdkrw", return_value=1380), \
         patch("services.digest_service._get_events", return_value=[]), \
         patch("services.disclosures.get_disclosures_batch", return_value=[]), \
         patch("services.insider_trades.compute_net_signals_batch", side_effect=Exception("db down")), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        result = ds.generate("test-user-id", today=date(2026, 5, 23))
    assert result["insider_trades"] == []


# ── S4: get_quotes_batch 교체 + 저장 FX ─────────────────────────────────────
# _BATCH_NORMAL / _BATCH_BIG_DROP (파일 상단 정의)을 재사용


def test_s4_no_yf_ticker_call(tmp_path):
    """S4: get_quotes_batch가 정확히 1회 호출된다(per-종목 개별 fetch 없음)."""
    import services.digest_service as ds
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("services.digest_service.get_quotes_batch", return_value=_BATCH_NORMAL) as mock_batch, \
         patch("services.digest_service._get_usdkrw", return_value=1380), \
         patch("services.digest_service._get_events", return_value=[]), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        ds.generate("test-user-id", today=date(2026, 5, 23))
    mock_batch.assert_called_once()


def test_s4_portfolio_summary_via_batch(tmp_path):
    """S4: get_quotes_batch 경로에서 portfolio_summary 계산 정합.
    AAPL 10주, price=102.0, daily_change_pct=2.0 → prev_close=102/(1.02)≈100.0
    total_value=102×10×1380=1407600, prev=100×10×1380=1380000
    daily_change_krw=27600, daily_change_pct=2.0."""
    import services.digest_service as ds
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("services.digest_service.get_quotes_batch", return_value=_BATCH_NORMAL), \
         patch("services.digest_service._get_usdkrw", return_value=1380), \
         patch("services.digest_service._get_events", return_value=[]), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        result = ds.generate("test-user-id", today=date(2026, 5, 23))
    assert result["portfolio_summary"]["total_value_krw"] == 1407600.0
    assert result["portfolio_summary"]["daily_change_krw"] == 27600.0
    assert result["portfolio_summary"]["daily_change_pct"] == 2.0


def test_s4_anomaly_via_batch(tmp_path):
    """S4: get_quotes_batch 경로에서 이상신호(|change_pct|>=5) 탐지."""
    import services.digest_service as ds
    portfolio = {
        "stocks": [{"ticker": "AAPL", "name": "Apple", "quantity": 5,
                    "avg_cost": 100.0, "market": "US", "exchange": ""}],
        "watchlist": [],
    }
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=portfolio), \
         patch("services.digest_service.get_quotes_batch", return_value=_BATCH_BIG_DROP), \
         patch("services.digest_service._get_usdkrw", return_value=1380), \
         patch("services.digest_service._get_events", return_value=[]), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        result = ds.generate("test-user-id", today=date(2026, 5, 23))
    assert result["stocks"][0]["is_anomaly"] is True
    assert result["anomalies"][0]["ticker"] == "AAPL"


def test_s4_fx_stored_value(tmp_path):
    """S4: 저장 FX 우선 사용 — _mc_load("fx")가 있으면 그 값을 쓴다."""
    import services.digest_service as ds
    stored_fx = {"data": {"rates": {"usdkrw": {"current": 1350.0}}}}
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("services.digest_service.get_quotes_batch", return_value=_BATCH_NORMAL), \
         patch("services.digest_service._mc_load", return_value=stored_fx), \
         patch("services.digest_service._get_events", return_value=[]), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        result = ds.generate("test-user-id", today=date(2026, 5, 23))
    # AAPL 10주 × 102.0 × 1350 = 1377000
    assert result["portfolio_summary"]["total_value_krw"] == 1377000.0


def test_s4_fx_fallback_on_no_stored(tmp_path):
    """S4: 저장 FX 없으면 _fetch_usdkrw_current() 라이브 폴백."""
    import services.digest_service as ds
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("services.digest_service.get_quotes_batch", return_value=_BATCH_NORMAL), \
         patch("services.digest_service._mc_load", return_value=None), \
         patch("services.digest_service._fetch_usdkrw_current", return_value=1400) as mock_live, \
         patch("services.digest_service._get_events", return_value=[]), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        result = ds.generate("test-user-id", today=date(2026, 5, 23))
    mock_live.assert_called_once()
    # AAPL 10주 × 102.0 × 1400 = 1428000
    assert result["portfolio_summary"]["total_value_krw"] == 1428000.0


def test_s4_batch_receives_market_field(tmp_path):
    """S4: get_quotes_batch 호출 시 stock dict에 market 필드가 포함돼 있어야 한다."""
    import services.digest_service as ds
    captured = {}

    def _capture_batch(stocks):
        captured["stocks"] = stocks
        return {}

    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("services.digest_service.get_quotes_batch", side_effect=_capture_batch), \
         patch("services.digest_service._get_usdkrw", return_value=1380), \
         patch("services.digest_service._get_events", return_value=[]), \
         patch("services.digest_service.execute", side_effect=Exception("no db")):
        ds.generate("test-user-id", today=date(2026, 5, 23))
    for s in captured["stocks"]:
        assert "market" in s, f"market 키 없음: {s}"

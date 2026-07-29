"""task#242: 빈 fetch 결과가 직전 양호값을 덮어쓰지 않는다 (무가드 5곳).

CLAUDE.md "빈/all-None 결과 캐시 박제 금지"(task#48·#50·#157·#160)를 적용한 5곳:
구루 매니저 · 원자재 · 국채 · M7 실적 · KR Top2 실적.
red 조건: 옛 구현은 저장 함수를 *실제로 호출*했다 → call_count로 단언한다(회고 #234 ④).
"""
from unittest.mock import patch
import logging


# ─────────────────────────── S1. 구루 매니저 ───────────────────────────

def test_save_guru_managers_skips_execute_on_empty():
    from services.storage.schedule import save_guru_managers
    with patch("services.storage.schedule.execute") as mock_exec:
        assert save_guru_managers({"last_updated": "x", "managers": []}) is False
        mock_exec.assert_not_called()


def test_save_guru_managers_writes_when_present():
    from services.storage.schedule import save_guru_managers
    with patch("services.storage.schedule.execute") as mock_exec:
        assert save_guru_managers({"last_updated": "x", "managers": [{"id": "1"}]}) is True
        assert mock_exec.call_count == 1


def test_run_crawl_warns_and_keeps_previous_on_empty(caplog, monkeypatch):
    import routers.guru as guru
    monkeypatch.setattr(guru, "scrape_all_managers", lambda *a, **k: [])
    with patch("services.storage.schedule.execute") as mock_exec:
        with caplog.at_level(logging.WARNING):
            guru._run_crawl()
    mock_exec.assert_not_called()
    assert any("빈 결과" in r.message for r in caplog.records)


def test_scheduler_guru_crawl_warns_and_keeps_previous_on_empty(caplog, monkeypatch):
    from scheduler import jobs
    monkeypatch.setattr("services.guru_scraper.scrape_all_managers", lambda *a, **k: [])
    with patch("services.storage.schedule.execute") as mock_exec:
        with caplog.at_level(logging.WARNING):
            jobs._run_guru_crawl()
    mock_exec.assert_not_called()
    assert any("빈 결과" in r.message for r in caplog.records)


# ──────────────────── S2. 원자재·국채 (요청경로) ────────────────────

def _no_memcache(monkeypatch, mod):
    monkeypatch.setattr(mod, "_get_cache", lambda *a, **k: None)
    monkeypatch.setattr(mod, "_set_cache", lambda *a, **k: None)


def test_get_commodities_returns_stored_and_skips_save_on_empty(monkeypatch):
    from services.market_indicators import commodities as mod
    stored = {"prices": {"gold": {"current": 2400.0, "change_pct": 0.1, "unit": "USD/oz"}},
              "history": {"gold": [{"date": "2026-07-01", "value": 2400.0}]}}
    _no_memcache(monkeypatch, mod)
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": stored, "fetched_at": None})
    monkeypatch.setattr(mod, "_fetch_commodity", lambda args: (args[0], None))
    with patch.object(mod, "_mc_save") as mock_save:
        assert mod.get_commodities() == stored
        mock_save.assert_not_called()


def test_get_commodities_empty_without_stored(monkeypatch):
    from services.market_indicators import commodities as mod
    _no_memcache(monkeypatch, mod)
    monkeypatch.setattr(mod, "_mc_load", lambda key: None)
    monkeypatch.setattr(mod, "_fetch_commodity", lambda args: (args[0], None))
    with patch.object(mod, "_mc_save") as mock_save:
        assert mod.get_commodities() == {"prices": {}, "history": {}}
        mock_save.assert_not_called()


def test_get_commodities_saves_on_success(monkeypatch):
    from services.market_indicators import commodities as mod
    _no_memcache(monkeypatch, mod)
    monkeypatch.setattr(mod, "_mc_load", lambda key: None)
    monkeypatch.setattr(mod, "_fetch_commodity", lambda args: (
        args[0], {"current": 1.0, "change_pct": 0.0, "unit": "u",
                  "history": [{"date": "2026-07-01", "value": 1.0}]}))
    with patch.object(mod, "_mc_save") as mock_save:
        data = mod.get_commodities()
        assert data["prices"] and mock_save.call_count == 1


def test_get_treasury_returns_stored_and_skips_save_on_empty(monkeypatch):
    from services.market_indicators import commodities as mod
    stored = {"rates": {"10y": {"current": 4.2, "change_bp": 1.0}},
              "history": {}, "spread": [], "_raw_histories": {}}
    _no_memcache(monkeypatch, mod)
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": stored, "fetched_at": None})
    monkeypatch.setattr(mod, "_fetch_treasury", lambda args: (args[0], None))
    with patch.object(mod, "_mc_save") as mock_save:
        assert mod.get_treasury() == stored
        mock_save.assert_not_called()


def test_get_treasury_empty_without_stored(monkeypatch):
    from services.market_indicators import commodities as mod
    _no_memcache(monkeypatch, mod)
    monkeypatch.setattr(mod, "_mc_load", lambda key: None)
    monkeypatch.setattr(mod, "_fetch_treasury", lambda args: (args[0], None))
    with patch.object(mod, "_mc_save") as mock_save:
        assert mod.get_treasury()["rates"] == {}
        mock_save.assert_not_called()


def test_get_treasury_saves_on_success(monkeypatch):
    from services.market_indicators import commodities as mod
    _no_memcache(monkeypatch, mod)
    monkeypatch.setattr(mod, "_mc_load", lambda key: None)
    monkeypatch.setattr(mod, "_fetch_treasury", lambda args: (
        args[0], {"current": 4.2, "change_bp": 1.0,
                  "history": [{"date": "2026-07-01", "value": 4.2}]}))
    with patch.object(mod, "_mc_save") as mock_save:
        data = mod.get_treasury()
        assert data["rates"] and mock_save.call_count == 1


# ─────────────── S3. M7·KR Top2 실적 (배치 force=True 경로) ───────────────

def test_m7_earnings_returns_stored_and_skips_save_on_empty(monkeypatch):
    from services.market_indicators import earnings as mod
    stored = {"quarters": [{"q": "2026Q1", "m7": 1.0, "rest": 2.0}], "unit": "십억달러"}
    monkeypatch.setattr(mod, "_get_sp500_tickers", lambda: [])
    monkeypatch.setattr(mod, "_get_yf_quarterly_net_income", lambda t: {})
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": stored, "fetched_at": None})
    with patch.object(mod, "_mc_save") as mock_save:
        assert mod._fetch_and_save_m7_earnings() == stored
        mock_save.assert_not_called()


def test_m7_earnings_saves_on_success(monkeypatch):
    from services.market_indicators import earnings as mod
    monkeypatch.setattr(mod, "_get_sp500_tickers", lambda: [])
    monkeypatch.setattr(mod, "_get_yf_quarterly_net_income", lambda t: {"2026Q1": 1.0})
    monkeypatch.setattr(mod, "_mc_load", lambda key: None)
    with patch.object(mod, "_mc_save") as mock_save:
        data = mod._fetch_and_save_m7_earnings()
        assert data["quarters"] and mock_save.call_count == 1


def test_kr_top2_earnings_returns_stored_and_skips_save_on_empty(monkeypatch):
    from services.market_indicators import earnings as mod
    stored = {"quarters": [{"q": "2026Q1", "top2": 1.0, "rest": 2.0, "estimated": False}],
              "unit": "억원"}
    monkeypatch.setattr(mod, "_get_kospi_tickers", lambda: [])
    monkeypatch.setattr(mod, "_get_naver_quarterly_net_income", lambda t: {})
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": stored, "fetched_at": None})
    with patch.object(mod, "_mc_save") as mock_save:
        assert mod._fetch_and_save_kr_top2_earnings() == stored
        mock_save.assert_not_called()


def test_kr_top2_earnings_saves_on_success(monkeypatch):
    from services.market_indicators import earnings as mod
    monkeypatch.setattr(mod, "_get_kospi_tickers", lambda: [])
    monkeypatch.setattr(mod, "_get_naver_quarterly_net_income", lambda t: {"2025Q1": 1.0})
    monkeypatch.setattr(mod, "_mc_load", lambda key: None)
    with patch.object(mod, "_mc_save") as mock_save:
        data = mod._fetch_and_save_kr_top2_earnings()
        assert data["quarters"] and mock_save.call_count == 1

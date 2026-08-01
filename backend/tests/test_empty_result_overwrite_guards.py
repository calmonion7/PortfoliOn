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


# ─── S2b. 원자재 개별 백필 (task#261 — gold만 실패해도 dict 전체 치환 금지) ───

def test_get_commodities_gold_fail_backfills_individually(monkeypatch):
    import math
    from services.market_indicators import commodities as mod
    gold_hist = [{"date": "2026-06-30", "value": 2350.0}, {"date": "2026-07-01", "value": 2400.0}]
    stored = {
        "prices": {
            "gold": {"current": 2400.0, "change_pct": 2.13, "unit": "USD/oz"},
            "oil": {"current": 70.0, "change_pct": 0.0, "unit": "USD/bbl"},
            "copper": {"current": 4.0, "change_pct": 0.0, "unit": "USD/lb"},
        },
        "history": {
            "gold": gold_hist,
            "oil": [{"date": "2026-07-01", "value": 70.0}],
            "copper": [{"date": "2026-07-01", "value": 4.0}],
        },
    }
    _no_memcache(monkeypatch, mod)
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": stored, "fetched_at": None})

    def fake_fetch(args):
        key, sym_unit, stored_history = args
        if key == "gold":
            return key, None
        return key, {"current": 99.0, "change_pct": 5.0, "unit": sym_unit[1],
                     "history": [{"date": "2026-07-02", "value": 99.0}]}

    monkeypatch.setattr(mod, "_fetch_commodity", fake_fetch)
    with patch.object(mod, "_mc_save") as mock_save:
        data = mod.get_commodities()

    assert data["prices"]["gold"]["current"] == 2400.0
    assert data["prices"]["gold"]["unit"] == "USD/oz"
    assert math.isfinite(data["prices"]["gold"]["change_pct"])
    assert data["history"]["gold"] == gold_hist
    assert data["prices"]["oil"]["current"] == 99.0
    assert data["prices"]["copper"]["current"] == 99.0
    assert mock_save.call_count == 1


def test_get_commodities_all_fail_returns_full_stored_no_backfill(monkeypatch):
    from services.market_indicators import commodities as mod
    stored = {
        "prices": {
            "gold": {"current": 2400.0, "change_pct": 2.13, "unit": "USD/oz"},
            "oil": {"current": 70.0, "change_pct": 0.0, "unit": "USD/bbl"},
            "copper": {"current": 4.0, "change_pct": 0.0, "unit": "USD/lb"},
        },
        "history": {
            "gold": [{"date": "2026-07-01", "value": 2400.0}],
            "oil": [{"date": "2026-07-01", "value": 70.0}],
            "copper": [{"date": "2026-07-01", "value": 4.0}],
        },
    }
    _no_memcache(monkeypatch, mod)
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": stored, "fetched_at": None})
    monkeypatch.setattr(mod, "_fetch_commodity", lambda args: (args[0], None))
    with patch.object(mod, "_mc_save") as mock_save:
        assert mod.get_commodities() == stored
        mock_save.assert_not_called()


def test_get_commodities_all_success_no_backfill_effect(monkeypatch):
    from services.market_indicators import commodities as mod
    stored = {
        "prices": {"gold": {"current": 1.0, "change_pct": 0.0, "unit": "USD/oz"}},
        "history": {"gold": [{"date": "2026-06-01", "value": 1.0}]},
    }
    _no_memcache(monkeypatch, mod)
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": stored, "fetched_at": None})
    monkeypatch.setattr(mod, "_fetch_commodity", lambda args: (
        args[0], {"current": 99.0, "change_pct": 1.0, "unit": args[1][1],
                  "history": [{"date": "2026-07-02", "value": 99.0}]}))
    with patch.object(mod, "_mc_save") as mock_save:
        data = mod.get_commodities()
    assert all(v["current"] == 99.0 for v in data["prices"].values())
    assert mock_save.call_count == 1


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


# ────── S3b. rest 성공률 하한 (task#261 — union 가드가 부분 실패를 놓친다) ──────

def _rest_income_fn(mod, success_rest):
    """M7/top2 자신은 항상 성공하고, rest는 `success_rest`에 든 티커만 성공한다."""
    def fn(ticker):
        if ticker in success_rest or ticker in mod.M7 or ticker in mod.KR_TOP2:
            return {"2026Q1": 1.0}
        return {}
    return fn


def test_m7_earnings_skips_save_when_rest_all_fail(caplog, monkeypatch):
    from services.market_indicators import earnings as mod
    stored = {"quarters": [{"q": "2026Q1", "m7": 9.0, "rest": 9.0}], "unit": "십억달러"}
    rest = [f"R{i}" for i in range(10)]
    monkeypatch.setattr(mod, "_get_sp500_tickers", lambda: mod.M7 + rest)
    monkeypatch.setattr(mod, "_get_yf_quarterly_net_income", _rest_income_fn(mod, set()))
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": stored, "fetched_at": None})
    with patch.object(mod, "_mc_save") as mock_save:
        with caplog.at_level(logging.INFO):
            assert mod._fetch_and_save_m7_earnings() == stored
        mock_save.assert_not_called()
    assert any("성공 0/10" in r.message for r in caplog.records)


def test_m7_earnings_skips_save_when_rest_below_coverage(caplog, monkeypatch):
    from services.market_indicators import earnings as mod
    stored = {"quarters": [{"q": "2026Q1", "m7": 9.0, "rest": 9.0}], "unit": "십억달러"}
    rest = [f"R{i}" for i in range(10)]
    monkeypatch.setattr(mod, "_get_sp500_tickers", lambda: mod.M7 + rest)
    monkeypatch.setattr(mod, "_get_yf_quarterly_net_income", _rest_income_fn(mod, set(rest[:4])))
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": stored, "fetched_at": None})
    with patch.object(mod, "_mc_save") as mock_save:
        with caplog.at_level(logging.INFO):
            assert mod._fetch_and_save_m7_earnings() == stored
        mock_save.assert_not_called()
    assert any("성공 4/10" in r.message for r in caplog.records)


def test_m7_earnings_saves_when_rest_meets_coverage(caplog, monkeypatch):
    from services.market_indicators import earnings as mod
    rest = [f"R{i}" for i in range(10)]
    monkeypatch.setattr(mod, "_get_sp500_tickers", lambda: mod.M7 + rest)
    monkeypatch.setattr(mod, "_get_yf_quarterly_net_income", _rest_income_fn(mod, set(rest[:6])))
    monkeypatch.setattr(mod, "_mc_load", lambda key: None)
    with patch.object(mod, "_mc_save") as mock_save:
        with caplog.at_level(logging.INFO):
            data = mod._fetch_and_save_m7_earnings()
        assert data["quarters"] and mock_save.call_count == 1
    assert any("성공 6/10" in r.message for r in caplog.records)


def test_kr_top2_earnings_skips_save_when_rest_all_fail(caplog, monkeypatch):
    from services.market_indicators import earnings as mod
    stored = {"quarters": [{"q": "2026Q1", "top2": 9.0, "rest": 9.0, "estimated": False}],
              "unit": "억원"}
    rest = [f"R{i}" for i in range(10)]
    monkeypatch.setattr(mod, "_get_kospi_tickers", lambda: mod.KR_TOP2 + rest)
    monkeypatch.setattr(mod, "_get_naver_quarterly_net_income", _rest_income_fn(mod, set()))
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": stored, "fetched_at": None})
    with patch.object(mod, "_mc_save") as mock_save:
        with caplog.at_level(logging.INFO):
            assert mod._fetch_and_save_kr_top2_earnings() == stored
        mock_save.assert_not_called()
    assert any("성공 0/10" in r.message for r in caplog.records)


def test_kr_top2_earnings_skips_save_when_rest_below_coverage(caplog, monkeypatch):
    from services.market_indicators import earnings as mod
    stored = {"quarters": [{"q": "2026Q1", "top2": 9.0, "rest": 9.0, "estimated": False}],
              "unit": "억원"}
    rest = [f"R{i}" for i in range(10)]
    monkeypatch.setattr(mod, "_get_kospi_tickers", lambda: mod.KR_TOP2 + rest)
    monkeypatch.setattr(mod, "_get_naver_quarterly_net_income", _rest_income_fn(mod, set(rest[:4])))
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": stored, "fetched_at": None})
    with patch.object(mod, "_mc_save") as mock_save:
        with caplog.at_level(logging.INFO):
            assert mod._fetch_and_save_kr_top2_earnings() == stored
        mock_save.assert_not_called()
    assert any("성공 4/10" in r.message for r in caplog.records)


def test_kr_top2_earnings_saves_when_rest_meets_coverage(caplog, monkeypatch):
    from services.market_indicators import earnings as mod
    rest = [f"R{i}" for i in range(10)]
    monkeypatch.setattr(mod, "_get_kospi_tickers", lambda: mod.KR_TOP2 + rest)
    monkeypatch.setattr(mod, "_get_naver_quarterly_net_income", _rest_income_fn(mod, set(rest[:6])))
    monkeypatch.setattr(mod, "_mc_load", lambda key: None)
    with patch.object(mod, "_mc_save") as mock_save:
        with caplog.at_level(logging.INFO):
            data = mod._fetch_and_save_kr_top2_earnings()
        assert data["quarters"] and mock_save.call_count == 1
    assert any("성공 6/10" in r.message for r in caplog.records)


# ── S3c. M7·Top2 *자신*의 부분 실패 (적대 리뷰 발견 — rest 가드는 분자를 안 본다) ──
# rest 커버리지 가드를 통과해도 M7/Top2 자신이 실패하면 union 가드(`if not quarters:`)는
# rest가 채운 quarters 때문에 발동하지 않고, `m7_by_q.get(q, 0)`이 분자를 0으로 박제한다.
# M7·Top2는 고정 명명 집합의 '합'이라 한 종목만 빠져도 합계가 정의상 틀리므로 완전성을 요구한다.

def _self_income_fn(failed_self):
    """`failed_self`에 든 티커만 실패하고 나머지(자신·rest)는 전부 성공한다."""
    def fn(ticker):
        return {} if ticker in failed_self else {"2026Q1": 1.0}
    return fn


def test_m7_earnings_skips_save_when_m7_itself_all_fail(caplog, monkeypatch):
    from services.market_indicators import earnings as mod
    stored = {"quarters": [{"q": "2026Q1", "m7": 999.0, "rest": 9.0}], "unit": "십억달러"}
    rest = [f"R{i}" for i in range(10)]
    monkeypatch.setattr(mod, "_get_sp500_tickers", lambda: mod.M7 + rest)
    monkeypatch.setattr(mod, "_get_yf_quarterly_net_income", _self_income_fn(set(mod.M7)))
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": stored, "fetched_at": None})
    with patch.object(mod, "_mc_save") as mock_save:
        with caplog.at_level(logging.INFO):
            assert mod._fetch_and_save_m7_earnings() == stored
        mock_save.assert_not_called()
    assert any(f"M7 성공 0/{len(mod.M7)}" in r.message for r in caplog.records)


def test_m7_earnings_skips_save_when_m7_itself_partially_fails(caplog, monkeypatch):
    from services.market_indicators import earnings as mod
    stored = {"quarters": [{"q": "2026Q1", "m7": 999.0, "rest": 9.0}], "unit": "십억달러"}
    rest = [f"R{i}" for i in range(10)]
    monkeypatch.setattr(mod, "_get_sp500_tickers", lambda: mod.M7 + rest)
    monkeypatch.setattr(mod, "_get_yf_quarterly_net_income", _self_income_fn({mod.M7[0]}))
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": stored, "fetched_at": None})
    with patch.object(mod, "_mc_save") as mock_save:
        with caplog.at_level(logging.INFO):
            assert mod._fetch_and_save_m7_earnings() == stored
        mock_save.assert_not_called()
    assert any(f"M7 성공 {len(mod.M7) - 1}/{len(mod.M7)}" in r.message for r in caplog.records)


def test_kr_top2_earnings_skips_save_when_top2_itself_partially_fails(caplog, monkeypatch):
    from services.market_indicators import earnings as mod
    stored = {"quarters": [{"q": "2026Q1", "top2": 999.0, "rest": 9.0, "estimated": False}],
              "unit": "억원"}
    rest = [f"R{i}" for i in range(10)]
    monkeypatch.setattr(mod, "_get_kospi_tickers", lambda: mod.KR_TOP2 + rest)
    monkeypatch.setattr(mod, "_get_naver_quarterly_net_income", _self_income_fn({mod.KR_TOP2[0]}))
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": stored, "fetched_at": None})
    with patch.object(mod, "_mc_save") as mock_save:
        with caplog.at_level(logging.INFO):
            assert mod._fetch_and_save_kr_top2_earnings() == stored
        mock_save.assert_not_called()
    assert any(f"KR Top2 성공 {len(mod.KR_TOP2) - 1}/{len(mod.KR_TOP2)}" in r.message
               for r in caplog.records)

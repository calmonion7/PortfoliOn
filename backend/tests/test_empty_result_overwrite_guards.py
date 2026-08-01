"""task#242: 빈 fetch 결과가 직전 양호값을 덮어쓰지 않는다 (무가드 5곳).

CLAUDE.md "빈/all-None 결과 캐시 박제 금지"(task#48·#50·#157·#160)를 적용한 5곳:
구루 매니저 · 원자재 · 국채 · M7 실적 · KR Top2 실적.
red 조건: 옛 구현은 저장 함수를 *실제로 호출*했다 → call_count로 단언한다(회고 #234 ④).
"""
from unittest.mock import patch
import logging


# ─────────────────────────── S1. 구루 매니저 ───────────────────────────

# task#267(BH7-H1) 이후 save_guru_managers는 dict를 반환하고 저장 전에 직전값을 read한다
# (부분 실패 백필). 그래서 이 절의 테스트는 반환을 ["saved"]로 보고 get_guru_managers를 목킹한다.

def test_save_guru_managers_skips_execute_on_empty():
    from services.storage.schedule import save_guru_managers
    with patch("services.storage.schedule.execute") as mock_exec:
        assert save_guru_managers({"last_updated": "x", "managers": []})["saved"] is False
        mock_exec.assert_not_called()


def test_save_guru_managers_writes_when_present():
    from services.storage.schedule import save_guru_managers
    with patch("services.storage.schedule.execute") as mock_exec, \
         patch("services.storage.schedule.get_guru_managers",
               return_value={"last_updated": None, "managers": []}):
        assert save_guru_managers({"last_updated": "x", "managers": [{"id": "1"}]})["saved"] is True
        assert mock_exec.call_count == 1


def test_run_crawl_warns_and_keeps_previous_on_empty(caplog, monkeypatch):
    import routers.guru as guru
    monkeypatch.setattr(guru, "scrape_all_managers", lambda *a, **k: ([], [{"id": "1"}]))
    with patch("services.storage.schedule.execute") as mock_exec:
        with caplog.at_level(logging.WARNING):
            guru._run_crawl()
    mock_exec.assert_not_called()
    assert any("빈 결과" in r.message for r in caplog.records)


def test_scheduler_guru_crawl_warns_and_keeps_previous_on_empty(caplog, monkeypatch):
    from scheduler import jobs
    monkeypatch.setattr("services.guru_scraper.scrape_all_managers",
                        lambda *a, **k: ([], [{"id": "1"}]))
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
    # rest 유니버스는 비면 안 된다 — 빈 리스트는 이제 "저장 생략"의 정당한 사유다(BH7-L5).
    # 이 테스트의 의도는 "정상 성공 → 저장"이므로 실제 rest 종목을 준다.
    monkeypatch.setattr(mod, "_get_sp500_tickers", lambda: ["AAA"])
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
    monkeypatch.setattr(mod, "_get_kospi_tickers", lambda: ["000001"])
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


# ── BH7-H1: 부분 크롤은 실패분을 직전값으로 백필한다 ──────────────────────────────
# 매니저는 서로 합산되지 않는 **독립 항목**이라 처방은 커버리지 임계가 아니라 개별 백필이다
# (CLAUDE.md ⭐가드 ③ⓒ). 임계를 쓰면 성공한 40명까지 함께 버리게 된다.

def _mgr(mid):
    return {"id": mid, "name": f"M{mid}", "holdings": [{"ticker": f"T{mid}"}]}


def _saved_payload(mock_exec):
    import json
    return json.loads(mock_exec.call_args[0][1][0])


def test_save_guru_managers_backfills_failed_from_stored_BH7_H1():
    """BH7-H1 — 83명 명부 중 40명만 성공해도 나머지 43명의 직전 데이터가 살아남는다."""
    from services.storage.schedule import save_guru_managers
    roster = [{"id": str(i)} for i in range(83)]
    stored = {"last_updated": "old", "managers": [_mgr(str(i)) for i in range(83)]}
    fresh = [dict(_mgr(str(i)), name="NEW") for i in range(40)]

    with patch("services.storage.schedule.execute") as mock_exec, \
         patch("services.storage.schedule.get_guru_managers", return_value=stored):
        stats = save_guru_managers({"last_updated": "new", "managers": fresh, "roster": roster})

    assert stats == {"saved": True, "fresh": 40, "stale": 43, "dropped": 0}
    payload = _saved_payload(mock_exec)
    assert len(payload["managers"]) == 83
    by_id = {m["id"]: m for m in payload["managers"]}
    assert by_id["0"]["name"] == "NEW"      # 성공분은 갱신
    assert by_id["50"]["name"] == "M50"     # 실패분은 직전값 보존
    assert "roster" not in payload          # 저장 blob 형태는 그대로


def test_save_guru_managers_all_fail_skips_write_BH7_H1():
    """BH7-H1 — 전량 실패 판정은 백필 *앞*에 있어야 한다. 뒤에 있으면 백필이 목록을
    채워 판정이 영영 발동하지 않는다(BH7-L1이 get_treasury에서 정확히 그렇게 죽어 있다)."""
    from services.storage.schedule import save_guru_managers
    stored = {"last_updated": "old", "managers": [_mgr("1")]}

    with patch("services.storage.schedule.execute") as mock_exec, \
         patch("services.storage.schedule.get_guru_managers", return_value=stored):
        stats = save_guru_managers({"last_updated": "new", "managers": [], "roster": [{"id": "1"}]})

    mock_exec.assert_not_called()
    assert stats["saved"] is False


def test_save_guru_managers_drops_retired_from_roster_BH7_H1():
    """BH7-H1 — 명부에서 사라진 매니저는 백필하지 않는다(영구 잔존 방지)."""
    from services.storage.schedule import save_guru_managers
    stored = {"last_updated": "old", "managers": [_mgr("a"), _mgr("gone")]}

    with patch("services.storage.schedule.execute") as mock_exec, \
         patch("services.storage.schedule.get_guru_managers", return_value=stored):
        stats = save_guru_managers({"last_updated": "new", "managers": [_mgr("a")],
                                    "roster": [{"id": "a"}, {"id": "b"}]})

    assert stats["dropped"] == 1
    ids = [m["id"] for m in _saved_payload(mock_exec)["managers"]]
    assert ids == ["a"]   # 'gone'은 드롭, 'b'는 저장값도 없으니 그냥 없음


# ══ 7차 버그헌트 — 도달하지 못하는 가드 2건 (BH7-L1 · BH7-L5) ═══════════════════

def _hist(v):
    return [{"date": "2026-07-30", "value": v}, {"date": "2026-07-31", "value": v}]


def test_get_treasury_all_fetch_fail_skips_save_with_stored_histories_BH7_L1(monkeypatch):
    """BH7-L1 — 전량실패 판정이 개별 백필 **뒤**에 있으면, 정상 운영 중(=저장 히스토리가
    차 있음)에는 백필이 rates를 채워 `if not rates:`가 **영영 발동하지 않는다**. 경고는
    안 찍히고 _mc_save가 그대로 돌아 fetched_at만 갱신된다.

    기존 테스트는 `_raw_histories`를 빈 {}로 둬서 이 결함을 은폐한다(백필할 게 없으니
    가드가 발동한다) — 그래서 이 테스트는 반드시 **채워진** fixture를 쓴다.
    """
    from services.market_indicators import commodities as mod
    stored = {"rates": {k: {"current": 4.2, "change_bp": 1.0} for k in ("3m", "2y", "10y", "30y")},
              "history": {}, "spread": [],
              "_raw_histories": {k: _hist(4.2) for k in ("3m", "2y", "10y", "30y")}}
    _no_memcache(monkeypatch, mod)
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": stored, "fetched_at": None})
    monkeypatch.setattr(mod, "_fetch_treasury", lambda args: (args[0], None))   # 전 만기 실패
    with patch.object(mod, "_mc_save") as mock_save, caplog_at_warning() as records:
        assert mod.get_treasury() == stored
        mock_save.assert_not_called()
    assert any("전 만기 fetch 실패" in r.message for r in records)


import contextlib


@contextlib.contextmanager
def caplog_at_warning():
    """caplog fixture 없이 WARNING 레코드를 모으는 최소 헬퍼(이 파일의 다른 테스트는
    caplog fixture를 쓰지만 여기선 patch 컨텍스트와 함께 써야 해 순서가 꼬인다)."""
    records = []

    class _H(logging.Handler):
        def emit(self, record):
            records.append(record)

    h = _H(level=logging.WARNING)
    root = logging.getLogger()
    root.addHandler(h)
    prev = root.level
    root.setLevel(logging.WARNING)
    try:
        yield records
    finally:
        root.removeHandler(h)
        root.setLevel(prev)


def test_m7_earnings_empty_universe_skips_save_BH7_L5(monkeypatch):
    """BH7-L5 — `if rest and rest_ok/len(rest) < _REST_MIN_COVERAGE`는 rest가 빈 리스트면
    **and 단락평가로 가드 전체를 건너뛴다**. 그 뒤 _merge_quarters([]) → {} → get(q, 0)이
    전 분기 rest를 0으로 채워 8분기 blob을 치환한다 — 6차 H1이 막으려던 실패 모드가
    '유니버스 공백' 경로로 되살아난다. M7 자체는 성공시켜 그 가드를 통과시킨다."""
    from services.market_indicators import earnings as mod
    stored = {"quarters": [{"q": "2026Q1", "m7": 1.0, "rest": 900.0}], "unit": "십억달러"}
    monkeypatch.setattr(mod, "_get_sp500_tickers", lambda: [])          # 유니버스 공백
    monkeypatch.setattr(mod, "_get_yf_quarterly_net_income", lambda t: {"2026Q1": 1.0})
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": stored, "fetched_at": None})
    with patch.object(mod, "_mc_save") as mock_save:
        assert mod._fetch_and_save_m7_earnings() == stored
        mock_save.assert_not_called()


def test_kr_top2_earnings_empty_universe_skips_save_BH7_L5(monkeypatch):
    """BH7-L5 — KR Top2도 같은 단락평가 구조(`:257`)."""
    from services.market_indicators import earnings as mod
    stored = {"quarters": [{"q": "2026Q1", "top2": 1.0, "rest": 900.0, "estimated": False}],
              "unit": "억원"}
    monkeypatch.setattr(mod, "_get_kospi_tickers", lambda: [])
    monkeypatch.setattr(mod, "_get_naver_quarterly_net_income", lambda t: {"2025Q1": 1.0})
    monkeypatch.setattr(mod, "_mc_load", lambda key: {"data": stored, "fetched_at": None})
    with patch.object(mod, "_mc_save") as mock_save:
        assert mod._fetch_and_save_kr_top2_earnings() == stored
        mock_save.assert_not_called()

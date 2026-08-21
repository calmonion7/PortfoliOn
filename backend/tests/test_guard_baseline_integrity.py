"""적대 검토 수복 — 「가드의 baseline이 붕괴하면 가드가 통째로 꺼진다」 클래스.

앞선 wave가 넣은 가드들이 **판정 기준(baseline)을 관용 로더 `_mc_load`에서 읽는다.**
그 로더는 조회 예외를 warning 후 `None`으로 접으므로 「DB 오류」와 「한 번도 저장 안 됨」이
같은 값이 되고, 그러면 가드가 fail-open으로 꺼진 채 **파괴적 저장이 그대로 진행**된다.
`_mc_save`(execute)와 `_mc_load`(query)는 별개 호출이라 「SELECT만 일시 실패 + INSERT 성공」
조합이 실제로 성립한다.

축 구성 — 각 가드마다 **「정상 입력은 계속 값을 낸다」 대조군을 쌍으로** 둔다.
없으면 「전부 스킵하기」가 통과한다(이 저장소가 비싸게 배운 실패 모드).

  §1 earnings 티커 축소 가드    — baseline 조회 실패 → 저장 생략 / 정상 조회 → 저장
  §2 econ 계열 소스-폴백        — 조회 실패는 전파(저장 미도달) / 부분 실패는 직전값 보존
  §3 econ 요청경로 _mc_delete   — 조회 실패에 삭제 금지 / 오염 데이터에만 삭제
  §4 us_sector 부분 백필        — 직전값 조회 실패 → 저장 생략 / 정상 조회 → 백필 후 저장
  §5 fx 신선도 판정             — 성공-but-빈응답도 stale / 새 데이터는 success
  §6 발굴 유니버스 붕괴          — 유일 대량 소스 실패는 전파 / 보조 소스 실패는 graceful
  §7 job_runs 배선              — 스킵·실패가 set_status로 드러남 / 정상은 무지정(success)
"""
import sys
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import logging

import pandas as pd
import pytest
from unittest.mock import MagicMock, patch


_POOL_ERR = RuntimeError("connection pool exhausted")


class _FakeRun:
    def __init__(self):
        self.calls = []

    def set_status(self, status, error=None):
        self.calls.append((status, error))


@pytest.fixture
def run_spy(monkeypatch):
    """(job_id, trigger) + set_status 호출을 함께 관측하는 job_runs.record 대역."""
    calls = []
    run = _FakeRun()

    @contextmanager
    def fake_record(job_id, trigger):
        calls.append((job_id, trigger))
        yield run

    import services.job_runs as job_runs
    monkeypatch.setattr(job_runs, "record", fake_record)
    return calls, run


# ── §1 earnings 티커 축소 가드의 baseline ────────────────────────────────────

def _earnings_env(monkeypatch, query_result):
    """cache.query를 통째로 대역. query_result가 Exception이면 raise."""
    import services.market_indicators.cache as C
    import services.market_indicators.earnings as E

    def _q(sql, params=None):
        if isinstance(query_result, Exception):
            raise query_result
        return query_result

    monkeypatch.setattr(C, "query", _q)
    saves = []
    monkeypatch.setattr(E, "_mc_save", lambda k, d: saves.append((k, d)))
    return E, saves


def test_ticker_guard_skips_save_when_baseline_unreadable(monkeypatch, caplog):
    """조회 실패 → baseline 0으로 붕괴하면 안 된다(3종목이 503종목을 대체하던 원 버그)."""
    caplog.set_level(logging.WARNING)
    E, saves = _earnings_env(monkeypatch, _POOL_ERR)

    out = E._tickers_with_cache(_SP500_KEY_NAME, E._SP500_SEED, lambda: ["AAPL", "MSFT", "NVDA"])

    assert saves == [], "baseline을 못 읽었는데 축소 결과를 저장했다"
    assert out != ["AAPL", "MSFT", "NVDA"], "미채택 결과를 그대로 반환했다"
    assert len(out) > 3, "정적 시드 폴백이 동작해야 한다(wrong < missing)"


def test_ticker_guard_control_normal_scrape_still_saves(monkeypatch):
    """대조군 — 조회가 정상이면 정상 스크레이프는 계속 저장된다."""
    stored = [{"data": {"tickers": [f"T{i}" for i in range(500)]},
               "fetched_at": None}]
    E, saves = _earnings_env(monkeypatch, [{"data": {"tickers": [f"T{i}" for i in range(500)]},
                                            "fetched_at": None}])
    del stored
    fresh = [f"T{i}" for i in range(502)]
    out = E._tickers_with_cache(_SP500_KEY_NAME, E._SP500_SEED, lambda: fresh)

    assert out == fresh
    assert saves and saves[0][1] == {"tickers": fresh}


_SP500_KEY_NAME = "sp500_tickers"


# ── §2 econ 계열 소스-폴백의 prev ────────────────────────────────────────────

def _fred_get(by_series):
    def _get(url, params=None, timeout=None):
        sid = (params or {}).get("series_id")
        outcome = by_series.get(sid)
        if isinstance(outcome, Exception):
            raise outcome
        resp = MagicMock()
        resp.json.return_value = {"observations": outcome or []}
        resp.raise_for_status = lambda: None
        return resp
    return _get


_STORED_ECON = {
    "cpi": [{"date": "2026-06-01", "value": 309.0}],
    "unemployment": [{"date": "2026-06-01", "value": 4.1}],
}
_OBS = [{"date": "2026-07-01", "value": "310.5"}]


def test_econ_propagates_db_read_failure_instead_of_clobbering(monkeypatch):
    """조회 실패 → 저장에 도달하지 못해야 한다(실패 계열이 []로 덮이던 원 버그)."""
    import services.market_indicators.cache as C
    import services.market_indicators.econ as econ

    monkeypatch.setenv("FRED_API_KEY", "test-key")
    monkeypatch.setattr(C, "query", lambda sql, params=None: (_ for _ in ()).throw(_POOL_ERR))
    saves = []
    monkeypatch.setattr(econ, "_mc_save", lambda k, d: saves.append((k, d)))
    econ._cache.pop("econ_indicators", None)

    with patch.object(econ.requests, "get",
                      side_effect=_fred_get({"CPIAUCSL": _OBS,
                                             "UNRATE": RuntimeError("FRED 500")})):
        with pytest.raises(Exception):
            econ._fetch_and_save_econ_indicators()

    assert saves == [], "조회 실패 상태에서 저장이 일어났다(누적 시계열 파괴)"


def test_econ_control_partial_failure_still_preserves_prev(monkeypatch):
    """대조군 — 조회가 정상이면 부분 실패는 종래대로 직전값을 보존하고 partial을 낸다."""
    import services.market_indicators.cache as C
    import services.market_indicators.econ as econ

    monkeypatch.setenv("FRED_API_KEY", "test-key")
    monkeypatch.setattr(C, "query", lambda sql, params=None: [
        {"data": _STORED_ECON, "fetched_at": None}])
    saves = {}
    monkeypatch.setattr(econ, "_mc_save", lambda k, d: saves.update({k: d}))
    econ._cache.pop("econ_indicators", None)

    with patch.object(econ.requests, "get",
                      side_effect=_fred_get({"CPIAUCSL": _OBS,
                                             "UNRATE": RuntimeError("FRED 500")})):
        result = econ._fetch_and_save_econ_indicators()

    assert result["_status"] == "partial"
    assert result["unemployment"] == _STORED_ECON["unemployment"]
    assert saves["econ_indicators"]["unemployment"] == _STORED_ECON["unemployment"]


# ── §3 econ 요청경로의 _mc_delete ───────────────────────────────────────────

def test_get_econ_does_not_delete_on_read_failure(monkeypatch):
    """조회 실패는 「저장값 없음」이 아니다 — 누적 행을 지우면 3년 이전 이력이 영구 소실된다."""
    import services.market_indicators.econ as econ

    monkeypatch.setenv("FRED_API_KEY", "test-key")
    monkeypatch.setattr(econ, "_mc_load", lambda key: None)  # 관용 로더의 붕괴 재현
    deletes = []
    monkeypatch.setattr(econ, "_mc_delete", lambda key: deletes.append(key))
    monkeypatch.setattr(econ, "_fetch_and_save_econ_indicators", lambda: {"cpi": [], "unemployment": []})
    econ._cache.pop("econ_indicators", None)

    econ.get_econ_indicators()

    assert deletes == [], "저장값을 못 읽은 상태에서 행을 삭제했다"


def test_get_econ_control_still_deletes_corrupted_row(monkeypatch):
    """대조군 — 오염 데이터(실업률에 CPI 값)는 종래대로 삭제하고 강제 재fetch한다."""
    import services.market_indicators.econ as econ

    monkeypatch.setenv("FRED_API_KEY", "test-key")
    poisoned = {"cpi": [], "unemployment": [{"date": "2026-06-01", "value": 309.0}]}
    monkeypatch.setattr(econ, "_mc_load", lambda key: {"data": poisoned, "fetched_at": None})
    deletes = []
    monkeypatch.setattr(econ, "_mc_delete", lambda key: deletes.append(key))
    monkeypatch.setattr(econ, "_fetch_and_save_econ_indicators",
                        lambda: {"cpi": [], "unemployment": []})
    econ._cache.pop("econ_indicators", None)

    econ.get_econ_indicators()

    assert deletes == ["econ_indicators"]


# ── §4 us_sector 부분 백필의 직전값 ─────────────────────────────────────────

_PARTIAL_SECTORS = [
    {"name": "Tech", "etf": "XLK", "return_1w": None, "return_1mo": None, "return_3mo": None},
    {"name": "Fin", "etf": "XLF", "return_1w": 1.0, "return_1mo": 2.0, "return_3mo": 3.0},
]


def _us_sector_env(monkeypatch, query_result):
    import services.market_indicators.cache as C
    import services.us_sector_service as US

    def _q(sql, params=None):
        if isinstance(query_result, Exception):
            raise query_result
        return query_result

    monkeypatch.setattr(C, "query", _q)
    monkeypatch.setattr(US, "parallel_map",
                        lambda fn, items, max_workers=1: [dict(s) for s in _PARTIAL_SECTORS])
    saves = []
    monkeypatch.setattr(US, "_mc_save", lambda k, d: saves.append((k, d)))
    return US, saves


def test_us_sector_partial_does_not_save_when_prev_unreadable(monkeypatch):
    """직전값 조회 실패 → 백필 불가 → all-None을 저장하면 어제 값이 영구 소실된다."""
    US, saves = _us_sector_env(monkeypatch, _POOL_ERR)

    with pytest.raises(Exception):
        US.refresh()

    assert saves == [], "백필 baseline을 못 읽었는데 all-None을 저장했다"


def test_us_sector_control_partial_backfills_and_saves(monkeypatch):
    """대조군 — 조회가 정상이면 부분 실패분은 직전값으로 백필되고 저장된다."""
    prev = {"sectors": [{"name": "Tech", "etf": "XLK",
                         "return_1w": 1.1, "return_1mo": 2.2, "return_3mo": 3.3}]}
    US, saves = _us_sector_env(monkeypatch, [{"data": prev, "fetched_at": None}])

    out = US.refresh()

    xlk = next(s for s in out if s["etf"] == "XLK")
    assert (xlk["return_1w"], xlk["return_1mo"], xlk["return_3mo"]) == (1.1, 2.2, 3.3)
    assert len(saves) == 1


# ── §5 fx 신선도 판정 — 실패 클래스 (b) 성공-but-빈응답 ──────────────────────

_FX_HIST = [{"date": "2026-08-02", "value": 1380.0}, {"date": "2026-08-03", "value": 1381.0}]


def _fx_env(monkeypatch, yf_frame):
    import services.market_indicators.cache as C
    import services.market_indicators.fx as FX

    stored = {"data": {"rates": {k: {"current": 1.0, "change_pct": 0.0} for k in FX._FX_SYMBOLS},
                       "_raw_history": {k: list(_FX_HIST) for k in FX._FX_SYMBOLS}},
              "fetched_at": None}
    monkeypatch.setattr(FX, "_mc_load", lambda key: stored)
    saves = []
    monkeypatch.setattr(FX, "_mc_save", lambda k, d: saves.append((k, d)))
    tk = MagicMock()
    tk.history.return_value = yf_frame
    monkeypatch.setattr(C, "yf", MagicMock(Ticker=MagicMock(return_value=tk)))
    FX._cache.pop("fx", None)
    return FX, saves


def test_fx_empty_yf_response_is_not_success(monkeypatch):
    """yfinance 레이트리밋은 예외가 아니라 **빈 DataFrame**이다 — 예외 가드를 그냥 통과한다."""
    FX, saves = _fx_env(monkeypatch, pd.DataFrame())

    out = FX._fetch_and_save_fx()

    assert out.get("_status") == "skipped", "전 심볼 빈응답인데 success로 보고했다"
    assert saves == [], "내용 무변경인데 fetched_at만 갱신했다"


def test_fx_control_fresh_points_report_success(monkeypatch):
    """대조군 — 새 종가가 오면 종래대로 success이고 저장도 일어난다."""
    idx = pd.DatetimeIndex(pd.to_datetime(["2026-08-04"]))
    FX, saves = _fx_env(monkeypatch, pd.DataFrame({"Close": [1390.0]}, index=idx))

    out = FX._fetch_and_save_fx()

    assert "_status" not in out, f"정상 갱신인데 상태가 실렸다: {out.get('_status')}"
    assert len(saves) == 1


# ── §6 발굴 유니버스 붕괴 — 유일 대량 소스의 실패 ───────────────────────────

def test_build_universe_kr_propagates_sole_bulk_source_failure():
    """market="KR"에서 KR fetch가 죽으면 유니버스는 tracked-only로 붕괴한다 —
    그 상태로 delete-rewrite에 흘러가지 않게 전파한다."""
    from services.recommendation import universe as U

    with patch.object(U, "_fetch_kr_rows", side_effect=RuntimeError("naver 200+0건")), \
         patch.object(U, "_fetch_tracked", return_value=[
             {"ticker": "005930", "name": "삼성전자", "market": "KR", "is_etf": False}]):
        with pytest.raises(RuntimeError):
            U.build_universe(market="KR")


def test_build_universe_us_propagates_sole_bulk_source_failure():
    from services.recommendation import universe as U

    with patch.object(U, "_load_sp500", side_effect=OSError("no file")), \
         patch.object(U, "_fetch_guru_tickers", return_value={}), \
         patch.object(U, "_fetch_tracked", return_value=[]):
        with pytest.raises(OSError):
            U.build_universe(market="US")


def test_build_universe_control_legacy_both_markets_still_degrades():
    """대조군 — market 미지정(양시장)은 sp500이 살아 있으므로 종래 graceful degrade."""
    from services.recommendation import universe as U

    with patch.object(U, "_fetch_kr_rows", side_effect=RuntimeError("naver down")), \
         patch.object(U, "_load_sp500", return_value=["AAPL"]), \
         patch.object(U, "_fetch_tracked", return_value=[]), \
         patch.object(U, "_fetch_guru_tickers", return_value=[]):
        out = U.build_universe()

    assert {r["ticker"] for r in out} == {"AAPL"}


def test_build_universe_control_kr_success_unaffected():
    """대조군 — 정상 fetch는 종래대로 유니버스를 만든다."""
    from services.recommendation import universe as U

    kr_raw = [{"ticker": "005930", "name": "삼성전자", "market_cap": 500, "is_etf": False}]
    with patch.object(U, "_fetch_kr_rows", return_value=kr_raw), \
         patch.object(U, "_fetch_tracked", return_value=[]):
        out = U.build_universe(market="KR")

    assert {r["ticker"] for r in out} == {"005930"}


# ── §7 job_runs 배선 — 스킵·실패가 배치현황에서 초록이면 관측이 없다 ─────────

def test_recommendation_auto_lane_reports_partial(run_spy, monkeypatch):
    calls, run = run_spy
    import scheduler
    from services import recommendation
    monkeypatch.setattr(recommendation, "run_recommendation_batch",
                        lambda market: {"market": market, "status": "partial"})

    scheduler._fetch_recommendation_kr()

    assert ("recommendation_kr", "auto") in calls
    assert run.calls == [("partial", None)]


def test_recommendation_auto_lane_reports_failed(run_spy, monkeypatch):
    calls, run = run_spy
    import scheduler
    from services import recommendation
    monkeypatch.setattr(recommendation, "run_recommendation_batch",
                        lambda market: (_ for _ in ()).throw(RuntimeError("universe collapse")))

    scheduler._fetch_recommendation_us()

    assert [c[0] for c in run.calls] == ["failed"]


def test_recommendation_auto_lane_control_success_is_unmarked(run_spy, monkeypatch):
    """대조군 — 정상 실행은 상태를 지정하지 않아 종래대로 success로 기록된다."""
    calls, run = run_spy
    import scheduler
    from services import recommendation
    monkeypatch.setattr(recommendation, "run_recommendation_batch",
                        lambda market: {"market": market, "status": "success"})

    scheduler._fetch_recommendation_kr()

    assert run.calls == []


def test_rankings_auto_lane_reports_skip_on_propagated_guard(run_spy, monkeypatch):
    """B1 가드는 예외로 DELETE를 막는다 — 잡이 그것을 삼키면 배치현황이 초록이 된다."""
    calls, run = run_spy
    import scheduler
    from services import ranking_service
    monkeypatch.setattr(ranking_service, "get_kr_rankings",
                        lambda: (_ for _ in ()).throw(RuntimeError("empty stocks")))
    monkeypatch.setattr(ranking_service, "replace_market_rankings",
                        lambda m, r: pytest.fail("가드가 걸렸는데 replace가 호출됐다"))

    scheduler._fetch_kr_rankings()

    assert ("kr_rankings_fetch", "auto") in calls
    assert [c[0] for c in run.calls] == ["skipped"]


def test_rankings_auto_lane_control_success_is_unmarked(run_spy, monkeypatch):
    calls, run = run_spy
    import scheduler
    from services import ranking_service
    monkeypatch.setattr(ranking_service, "get_us_rankings", lambda: [{"ticker": "AAPL"}])
    monkeypatch.setattr(ranking_service, "replace_market_rankings", lambda m, r: None)

    scheduler._fetch_us_rankings()

    assert run.calls == []


def test_kospi_signal_auto_lane_reports_failed(run_spy, monkeypatch):
    """`_mc_load_strict`가 전파한 DB 오류를 삼키면 180일 신호 이력 보존이 무음이 된다."""
    calls, run = run_spy
    import scheduler
    from services.market_indicators import kospi_signal
    monkeypatch.setattr(kospi_signal, "refresh_kospi_signal",
                        lambda: (_ for _ in ()).throw(_POOL_ERR))

    scheduler._refresh_kospi_signal()

    assert ("kospi_signal_fetch", "auto") in calls
    assert [c[0] for c in run.calls] == ["failed"]


def test_us_sector_auto_lane_reports_skip_on_all_none(run_spy, monkeypatch):
    calls, run = run_spy
    import scheduler
    from services import us_sector_service
    monkeypatch.setattr(us_sector_service, "refresh", lambda: [
        {"name": "Tech", "etf": "XLK", "return_1w": None, "return_1mo": None, "return_3mo": None}])

    scheduler._fetch_us_sector()

    assert ("us_sector_fetch", "auto") in calls
    assert [c[0] for c in run.calls] == ["skipped"]


def test_us_sector_auto_lane_reports_skip_on_empty_list(run_spy, monkeypatch):
    """빈 리스트도 `refresh()`의 조기 return 조건에 걸린다(`all(...)` over `[]`는 True) —
    두 레인의 판정이 그 조건과 어긋나면 저장 생략이 success로 기록된다."""
    calls, run = run_spy
    import scheduler
    from services import us_sector_service
    monkeypatch.setattr(us_sector_service, "refresh", lambda: [])

    scheduler._fetch_us_sector()

    assert [c[0] for c in run.calls] == ["skipped"]


def test_us_sector_auto_lane_control_success_is_unmarked(run_spy, monkeypatch):
    calls, run = run_spy
    import scheduler
    from services import us_sector_service
    monkeypatch.setattr(us_sector_service, "refresh", lambda: [
        {"name": "Tech", "etf": "XLK", "return_1w": 1.0, "return_1mo": 2.0, "return_3mo": 3.0}])

    scheduler._fetch_us_sector()

    assert run.calls == []


def test_us_sector_manual_lane_reports_skip_on_all_none(monkeypatch):
    """수동 레인도 「갱신됨」과 「생략」을 구분해야 한다 — `{"ok": true, "sectors": 11}`만
    돌려주면 전량 실패가 성공으로 읽힌다(admin 화면은 초록 토스트까지 띄운다)."""
    from contextlib import contextmanager
    import routers.analysis as A

    run = _FakeRun()

    @contextmanager
    def fake_record(job_id, trigger):
        yield run

    all_none = [{"name": "Tech", "etf": "XLK", "return_1w": None,
                 "return_1mo": None, "return_3mo": None}]
    with patch.object(A.job_runs, "record", fake_record), \
         patch.object(A.us_sector_service, "refresh", return_value=all_none), \
         patch.object(A.cache_svc, "invalidate_sector"):
        body = A.refresh_us_sector(_="admin")

    assert body["ok"] is False
    assert body["status"] == "skipped"
    assert [c[0] for c in run.calls] == ["skipped"]


def test_us_sector_manual_lane_control_success(monkeypatch):
    """대조군 — 정상 갱신은 ok:true·status:success이고 상태 지정도 없다."""
    from contextlib import contextmanager
    import routers.analysis as A

    run = _FakeRun()

    @contextmanager
    def fake_record(job_id, trigger):
        yield run

    ok_sectors = [{"name": "Tech", "etf": "XLK", "return_1w": 1.0,
                   "return_1mo": 2.0, "return_3mo": 3.0}]
    with patch.object(A.job_runs, "record", fake_record), \
         patch.object(A.us_sector_service, "refresh", return_value=ok_sectors), \
         patch.object(A.cache_svc, "invalidate_sector"):
        body = A.refresh_us_sector(_="admin")

    assert body["ok"] is True and body["status"] == "success"
    assert run.calls == []


def test_earnings_auto_lane_reports_failed(run_spy, monkeypatch):
    calls, run = run_spy
    import scheduler
    import services.market_indicators as MI
    monkeypatch.setattr(MI, "_fetch_and_save_m7_earnings",
                        lambda: (_ for _ in ()).throw(RuntimeError("yf down")))

    scheduler._refresh_earnings_us()

    assert ("earnings_us", "auto") in calls
    assert [c[0] for c in run.calls] == ["failed"]

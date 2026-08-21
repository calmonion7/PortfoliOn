"""B6·B41: 배치 관측성(키 미설정·전량 실패가 success로 고착) + fx 배치 신설.

B6 — `scheduler/jobs.py::_refresh_monthly_us`가 `_fetch_and_save_econ_indicators()`의 반환을
검사하지 않아 FRED_API_KEY 미설정에도 "Econ indicators refreshed" 로그를 남기고 job_runs가
success로 기록됐다. `record`는 본문이 예외를 *전파*할 때만 failed를 쓰므로, 예외를 삼키는
잡은 스스로 상태를 말해야 한다(`Run.set_status`).

B41 — market_cache 키 `fx`를 갱신하는 배치가 아예 없었다. 소비자(`routers/stocks.py`의
`_usdkrw_rate`·`services/digest_service.py`)는 나이 검사 없는 `_mc_load("fx")`이고
`get_or_refresh`의 ttl은 저장값에 걸리지 않으므로, 아무도 시장지표 탭을 안 열면 포트폴리오
KRW 환산이 무기한 stale해진다.

두 가드 모두 **「정상 입력은 계속 값을 낸다」 대조군 축을 쌍으로** 둔다 — 없으면
"전부 스킵하기"·"항상 skipped로 기록하기"가 통과한다.
"""
import sys
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from unittest.mock import MagicMock, patch


# ── 공용 헬퍼 ────────────────────────────────────────────────────────────────

class _FakeRun:
    """job_runs.record가 yield하는 핸들 대역 — set_status 호출을 그대로 모은다."""

    def __init__(self):
        self.calls = []

    def set_status(self, status, error=None):
        self.calls.append((status, error))


@pytest.fixture
def run_spy(monkeypatch):
    """(job_id, trigger) 기록 + set_status 호출을 함께 관측하는 record 대역."""
    calls = []
    run = _FakeRun()

    @contextmanager
    def fake_record(job_id, trigger):
        calls.append((job_id, trigger))
        yield run

    import services.job_runs as job_runs
    monkeypatch.setattr(job_runs, "record", fake_record)
    return calls, run


def _fred_get(by_series):
    """FRED observations 응답 대역. by_series[series_id]가 Exception이면 raise."""
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


_CPI = "CPIAUCSL"
_UNRATE = "UNRATE"
_OBS = [{"date": "2026-07-01", "value": "310.5"}]
_STORED_ECON = {
    "cpi": [{"date": "2026-06-01", "value": 309.0}],
    "unemployment": [{"date": "2026-06-01", "value": 4.1}],
}


def _econ_env(monkeypatch, stored=None, save=None):
    import services.market_indicators.econ as econ
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    # 저장값 조회는 **엄격 로더**다 — 관용 `_mc_load`가 조회 실패를 None으로 접으면 `prev=[]`가
    # 되어 실패 계열이 빈 배열로 저장된다(누적 시계열 파괴). 요청경로(get_econ_indicators)는
    # 여전히 관용 로더를 쓰므로 둘 다 대역을 둔다.
    monkeypatch.setattr(econ, "_mc_load_strict",
                        lambda key: {"data": stored} if stored is not None else None)
    monkeypatch.setattr(econ, "_mc_load",
                        lambda key: {"data": stored} if stored is not None else None)
    monkeypatch.setattr(econ, "_mc_save", save or (lambda key, data: None))
    econ._cache.pop("econ_indicators", None)
    return econ


# ── B6-① econ 저장·판정: 계열별 소스-폴백 (실패 클래스 3종) ──────────────────

def test_econ_partial_preserves_failed_series_and_marks_partial(monkeypatch):
    """(a) 예외 — 한 계열이 죽어도 다른 계열은 갱신되고, 죽은 계열은 직전값을 유지한다."""
    saved = {}
    econ = _econ_env(monkeypatch, stored=_STORED_ECON,
                     save=lambda key, data: saved.update({key: data}))
    with patch.object(econ.requests, "get",
                      side_effect=_fred_get({_CPI: _OBS, _UNRATE: RuntimeError("FRED 500")})):
        result = econ._fetch_and_save_econ_indicators()

    assert result["_status"] == "partial"
    # 실패한 계열은 직전값 그대로 — 빈 배열로 클로버되지 않는다
    assert result["unemployment"] == _STORED_ECON["unemployment"]
    assert result["cpi"][-1]["date"] == "2026-07-01"
    # `_status`는 저장 blob에 섞이지 않는다(_mc_save 뒤에 새 dict로 얹는다)
    assert "_status" not in saved["econ_indicators"]


def test_econ_empty_response_counts_as_failure(monkeypatch):
    """(b) 성공-but-빈응답 — 200/0건은 예외 가드를 그냥 통과하므로 별도로 실패 취급한다."""
    saved = {}
    econ = _econ_env(monkeypatch, stored=_STORED_ECON,
                     save=lambda key, data: saved.update({key: data}))
    with patch.object(econ.requests, "get",
                      side_effect=_fred_get({_CPI: _OBS, _UNRATE: []})):
        result = econ._fetch_and_save_econ_indicators()

    assert result["_status"] == "partial"
    assert result["unemployment"] == _STORED_ECON["unemployment"]


def test_econ_all_series_fail_skips_save(monkeypatch):
    """전 계열 실패 → 저장 생략 + skipped. fetched_at만 갱신되는 「초록 거짓말」 방지."""
    saved = {}
    econ = _econ_env(monkeypatch, stored=_STORED_ECON,
                     save=lambda key, data: saved.update({key: data}))
    with patch.object(econ.requests, "get",
                      side_effect=_fred_get({_CPI: RuntimeError("x"), _UNRATE: []})):
        result = econ._fetch_and_save_econ_indicators()

    assert result["_status"] == "skipped"
    assert saved == {}
    assert result["cpi"] == _STORED_ECON["cpi"]


def test_econ_no_api_key_returns_error_and_skips_save(monkeypatch):
    import services.market_indicators.econ as econ
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    saved = {}
    monkeypatch.setattr(econ, "_mc_save", lambda key, data: saved.update({key: data}))
    result = econ._fetch_and_save_econ_indicators()
    assert "error" in result
    assert saved == {}


def test_econ_control_all_success_saves_without_status(monkeypatch):
    """대조군 — 정상 응답은 계속 저장되고 `_status`가 붙지 않는다.

    이 축이 없으면 「전부 skipped로 반환하기」가 위 3축을 통과한다."""
    saved = {}
    econ = _econ_env(monkeypatch, stored=_STORED_ECON,
                     save=lambda key, data: saved.update({key: data}))
    with patch.object(econ.requests, "get",
                      side_effect=_fred_get({_CPI: _OBS, _UNRATE: _OBS})):
        result = econ._fetch_and_save_econ_indicators()

    assert "_status" not in result
    assert len(saved["econ_indicators"]["cpi"]) == 2       # 직전 1건 + 신규 1건 병합
    assert len(saved["econ_indicators"]["unemployment"]) == 2


def test_get_econ_indicators_never_leaks_status_key(monkeypatch):
    """요청경로 응답 shape 보존 — `_status`는 배치 레인 전용 메타다."""
    econ = _econ_env(monkeypatch, stored=None)
    with patch.object(econ.requests, "get",
                      side_effect=_fred_get({_CPI: _OBS, _UNRATE: RuntimeError("x")})):
        result = econ.get_econ_indicators()
    assert "_status" not in result
    assert "cpi" in result and "unemployment" in result


# ── B6-② auto 레인: job_runs 상태 반영 ───────────────────────────────────────

def test_scheduler_monthly_us_reflects_skipped_when_no_api_key(run_spy, monkeypatch, caplog):
    import scheduler
    calls, run = run_spy
    monkeypatch.setattr("services.market_indicators._fetch_and_save_econ_indicators",
                        lambda: {"error": "FRED_API_KEY 환경변수가 필요합니다."})
    with caplog.at_level("INFO"):
        scheduler._refresh_monthly_us()

    assert ("monthly_us", "auto") in calls
    assert run.calls == [("skipped", "FRED_API_KEY 환경변수가 필요합니다.")]
    assert "refreshed" not in caplog.text


def test_scheduler_monthly_us_reflects_partial(run_spy, monkeypatch, caplog):
    import scheduler
    _, run = run_spy
    monkeypatch.setattr("services.market_indicators._fetch_and_save_econ_indicators",
                        lambda: {"cpi": [], "unemployment": [], "_status": "partial"})
    with caplog.at_level("INFO"):
        scheduler._refresh_monthly_us()

    assert run.calls == [("partial", None)]
    assert "refreshed" not in caplog.text


def test_scheduler_monthly_us_control_success_stays_green(run_spy, monkeypatch, caplog):
    """대조군 — 정상 갱신은 상태 지정 없이(=success) "refreshed" 로그를 남긴다."""
    import scheduler
    _, run = run_spy
    monkeypatch.setattr("services.market_indicators._fetch_and_save_econ_indicators",
                        lambda: {"cpi": [{"date": "2026-07-01", "value": 310.5}],
                                 "unemployment": [{"date": "2026-07-01", "value": 4.2}]})
    with caplog.at_level("INFO"):
        scheduler._refresh_monthly_us()

    assert run.calls == []
    assert "Econ indicators refreshed" in caplog.text


# ── B6-③ manual 레인: admin 응답이 「갱신됨」과 「생략」을 구분 ────────────────

def _admin_client(router):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from auth import require_admin
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_admin] = lambda: "admin-id"
    return TestClient(app)


def test_manual_refresh_monthly_us_reports_skipped(run_spy, monkeypatch):
    import routers.market_indicators as mi
    calls, run = run_spy
    monkeypatch.setattr(mi, "_fetch_and_save_econ_indicators",
                        lambda: {"error": "FRED_API_KEY 환경변수가 필요합니다."})
    resp = _admin_client(mi.router).post("/api/market/refresh-monthly?market=US")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False and body["status"] == "skipped"
    assert ("monthly_us", "manual") in calls
    assert run.calls == [("skipped", "FRED_API_KEY 환경변수가 필요합니다.")]


def test_manual_refresh_monthly_us_control_success(run_spy, monkeypatch):
    """대조군 — 정상 갱신은 ok=true·status=success로 남는다."""
    import routers.market_indicators as mi
    _, run = run_spy
    monkeypatch.setattr(mi, "_fetch_and_save_econ_indicators",
                        lambda: {"cpi": [{"date": "2026-07-01", "value": 310.5}],
                                 "unemployment": []})
    resp = _admin_client(mi.router).post("/api/market/refresh-monthly?market=US")
    body = resp.json()
    assert body["ok"] is True and body["status"] == "success"
    assert body["cpi_points"] == 1
    assert run.calls == []


def test_manual_refresh_econ_orphan_reports_partial(run_spy, monkeypatch):
    import routers.market_indicators as mi
    calls, run = run_spy
    monkeypatch.setattr(mi, "_fetch_and_save_econ_indicators",
                        lambda: {"cpi": [], "unemployment": [], "_status": "partial"})
    resp = _admin_client(mi.router).post("/api/market/refresh-econ")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False and body["status"] == "partial"
    assert ("monthly_us", "manual") in calls
    assert run.calls == [("partial", None)]


# ── B41-① 레지스트리 엔트리 ──────────────────────────────────────────────────

def test_registry_has_fx_fetch():
    from services import batch_registry
    e = batch_registry.get_batch("fx_fetch")
    assert e is not None
    assert e["category"] == "market"
    assert e["editable"] is True
    assert e["trigger_kinds"] == ["auto", "manual"]
    assert e["scheduler_job_id"] == "fx_fetch"
    assert e["timezone"] == "Asia/Seoul"
    assert e["manual_endpoint"] == "/api/market/refresh-fx"
    assert e["default_schedule"]["enabled"] is True
    # market은 출처국 기준(ADR-0013). 교차통화 + 다시장 소비라 공통(beta_fetch·dividend_fetch 선례).
    assert e["market"] == "공통"
    # source = fetch 출처(usage와 반대 방향, CONVENTIONS §8)
    assert "yfinance" in e["source"]


def test_fx_fetch_is_wired_in_job_funcs():
    import scheduler
    assert "fx_fetch" in scheduler._JOB_FUNCS
    assert scheduler._JOB_FUNCS["fx_fetch"] is scheduler._refresh_fx


# ── B41-② `_fetch_fx`의 신선도 표시 (판정의 근거) ────────────────────────────

_STORED_RAW = [{"date": "2026-08-01", "value": 1300.0},
               {"date": "2026-08-02", "value": 1310.0}]


def test_fetch_fx_marks_stale_when_yfinance_fails_but_stored_exists(monkeypatch):
    """소스-폴백은 값을 채워 반환하므로, 표시가 없으면 「라이브 전멸」이 success로 보인다."""
    import services.market_indicators.fx as fx
    monkeypatch.setattr(fx, "_yf_close_history",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("yf down")))
    key, val = fx._fetch_fx(("usdkrw", "USDKRW=X", _STORED_RAW))
    assert key == "usdkrw"
    assert val["_stale"] is True
    assert val["current"] == pytest.approx(1310.0)


def test_fetch_fx_fresh_result_is_not_marked_stale(monkeypatch):
    """대조군 — 정상 fetch는 stale로 표시되지 않는다(전부 stale로 찍으면 위 축이 무의미)."""
    import services.market_indicators.fx as fx
    monkeypatch.setattr(fx, "_yf_close_history", lambda *a, **k: _STORED_RAW)
    _, val = fx._fetch_fx(("usdkrw", "USDKRW=X", []))
    assert not val.get("_stale")


# ── B41-③ 배치용 강제 갱신 함수 ──────────────────────────────────────────────

def _fx_env(monkeypatch, results, stored=None, saved=None):
    """`_fetch_fx`를 key→반환 dict 맵으로 대체한다(None이면 완전 실패)."""
    import services.market_indicators.fx as fx
    monkeypatch.setattr(fx, "_mc_load",
                        lambda key: {"data": stored} if stored is not None else None)
    monkeypatch.setattr(fx, "_mc_save",
                        (lambda key, data: saved.update({key: data})) if saved is not None
                        else (lambda key, data: None))
    monkeypatch.setattr(fx, "_fetch_fx", lambda args: (args[0], results.get(args[0])))
    fx._cache.pop("fx", None)
    return fx


_FRESH = {"current": 1400.0, "change_pct": 0.5, "history": _STORED_RAW,
          "_raw_history": _STORED_RAW}
_STALE = dict(_FRESH, _stale=True)
_STORED_FX = {"rates": {"usdkrw": {"current": 1350.0, "change_pct": 0.1},
                        "usdjpy": {"current": 155.32, "change_pct": -0.2},
                        "eurusd": {"current": 1.08, "change_pct": 0.0}},
              "history": {"usdkrw": _STORED_RAW}}


def test_fetch_and_save_fx_marks_skipped_when_nothing_fresh(monkeypatch):
    fx = _fx_env(monkeypatch, {"usdkrw": _STALE, "usdjpy": _STALE, "eurusd": _STALE},
                 stored=_STORED_FX)
    data = fx._fetch_and_save_fx()
    assert data["_status"] == "skipped"
    # 직전값은 그대로 서빙된다(가드가 정상 데이터를 지우지 않는다)
    assert data["rates"]["usdkrw"]["current"] == pytest.approx(1400.0)


def test_fetch_and_save_fx_marks_partial_when_one_symbol_stale(monkeypatch):
    fx = _fx_env(monkeypatch, {"usdkrw": _FRESH, "usdjpy": _STALE, "eurusd": _FRESH},
                 stored=_STORED_FX)
    data = fx._fetch_and_save_fx()
    assert data["_status"] == "partial"
    assert set(data["rates"]) == {"usdkrw", "usdjpy", "eurusd"}


def test_fetch_and_save_fx_control_all_fresh_has_no_status(monkeypatch):
    """대조군 — 전부 신선하면 `_status`가 없고 저장이 실제로 일어난다."""
    saved = {}
    fx = _fx_env(monkeypatch, {"usdkrw": _FRESH, "usdjpy": _FRESH, "eurusd": _FRESH},
                 stored=_STORED_FX, saved=saved)
    data = fx._fetch_and_save_fx()
    assert "_status" not in data
    assert "fx" in saved
    # `_status`·`_raw_history`는 저장 blob/응답 계약을 오염시키지 않는다
    assert "_status" not in saved["fx"]
    assert "_raw_history" not in data


def test_fetch_and_save_fx_bypasses_memory_cache(monkeypatch):
    """인메모리 TTL(3600s)을 비우지 않으면 배치가 캐시를 그대로 반환해 갱신이 no-op이 된다."""
    saved = {}
    fx = _fx_env(monkeypatch, {"usdkrw": _FRESH, "usdjpy": _FRESH, "eurusd": _FRESH},
                 stored=_STORED_FX, saved=saved)
    fx._set_cache("fx", {"rates": {"sentinel": {"current": 1.0, "change_pct": 0.0}}}, ttl=3600)
    data = fx._fetch_and_save_fx()
    assert "sentinel" not in data["rates"]
    assert "fx" in saved


def test_get_fx_contract_unchanged_by_batch_refactor(monkeypatch):
    """요청경로 계약 보존 — get_fx는 `_status`도 `_raw_history`도 노출하지 않는다."""
    fx = _fx_env(monkeypatch, {"usdkrw": _FRESH, "usdjpy": _STALE, "eurusd": _FRESH},
                 stored=_STORED_FX)
    data = fx.get_fx()
    assert "_status" not in data
    assert "_raw_history" not in data
    assert data["rates"]["usdkrw"]["current"] == pytest.approx(1400.0)


# ── B41-④ auto·manual 두 레인 ────────────────────────────────────────────────

def test_scheduler_refresh_fx_records_auto_and_reflects_skipped(run_spy, monkeypatch, caplog):
    import scheduler
    calls, run = run_spy
    monkeypatch.setattr("services.market_indicators.fx._fetch_and_save_fx",
                        lambda: {"rates": {}, "history": {}, "_status": "skipped"})
    with caplog.at_level("INFO"):
        scheduler._refresh_fx()
    assert ("fx_fetch", "auto") in calls
    assert run.calls == [("skipped", None)]
    assert "FX refreshed" not in caplog.text


def test_scheduler_refresh_fx_control_success_stays_green(run_spy, monkeypatch, caplog):
    """대조군 — 정상 갱신은 상태 지정 없이 "FX refreshed" 로그를 남긴다."""
    import scheduler
    _, run = run_spy
    monkeypatch.setattr("services.market_indicators.fx._fetch_and_save_fx",
                        lambda: {"rates": {"usdkrw": {"current": 1400.0}}, "history": {}})
    with caplog.at_level("INFO"):
        scheduler._refresh_fx()
    assert run.calls == []
    assert "FX refreshed" in caplog.text


def test_manual_refresh_fx_records_manual_and_reports_status(run_spy, monkeypatch):
    import routers.market_indicators as mi
    calls, run = run_spy
    monkeypatch.setattr(mi, "_fetch_and_save_fx",
                        lambda: {"rates": {"usdkrw": {"current": 1400.0, "change_pct": 0.1}},
                                 "history": {"usdkrw": _STORED_RAW}, "_status": "partial"})
    resp = _admin_client(mi.router).post("/api/market/refresh-fx")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False and body["status"] == "partial"
    assert body["usdkrw_points"] == 2
    assert ("fx_fetch", "manual") in calls
    assert run.calls == [("partial", None)]


def test_manual_refresh_fx_control_success(run_spy, monkeypatch):
    import routers.market_indicators as mi
    _, run = run_spy
    monkeypatch.setattr(mi, "_fetch_and_save_fx",
                        lambda: {"rates": {"usdkrw": {"current": 1400.0, "change_pct": 0.1}},
                                 "history": {"usdkrw": _STORED_RAW}})
    resp = _admin_client(mi.router).post("/api/market/refresh-fx")
    body = resp.json()
    assert body["ok"] is True and body["status"] == "success"
    assert run.calls == []


def test_manual_refresh_fx_blocks_non_admin(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from auth import get_current_user
    import routers.market_indicators as mi
    monkeypatch.setattr("auth.auth_service.get_user_by_id", lambda _id: {"role": "user"})
    app = FastAPI()
    app.include_router(mi.router)
    app.dependency_overrides[get_current_user] = lambda: "user-1"
    resp = TestClient(app).post("/api/market/refresh-fx")
    assert resp.status_code == 403

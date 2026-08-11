"""신규 창업 신청(Business Formation, FRED) — 부문별 소스-폴백 저장 가드.

CONVENTIONS §1.3: 끝 가드가 아니라 부문별 가드 — 예외/빈응답/부분 페이로드 3종을
전부 물어야 wrong < missing이 성립한다. market_cache 접근은 전부 mock(실 DB 금지).
"""
import sys
from contextlib import contextmanager
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from unittest.mock import patch, MagicMock


def _fred_response(obs):
    resp = MagicMock()
    resp.json.return_value = {"observations": obs}
    resp.raise_for_status = lambda: None
    return resp


# ── moving_average 순수함수 ────────────────────────────────────────────────────

def test_moving_average_computes_3point():
    from services.market_indicators.formation import moving_average
    series = [
        {"date": "2026-01-01", "value": 10.0},
        {"date": "2026-02-01", "value": 20.0},
        {"date": "2026-03-01", "value": 30.0},
        {"date": "2026-04-01", "value": 40.0},
    ]
    ma = moving_average(series)
    assert [p["date"] for p in ma] == ["2026-03-01", "2026-04-01"]
    assert ma[0]["value"] == pytest.approx(20.0)
    assert ma[1]["value"] == pytest.approx(30.0)


def test_moving_average_empty_when_fewer_than_window():
    from services.market_indicators.formation import moving_average
    series = [{"date": "2026-01-01", "value": 10.0}, {"date": "2026-02-01", "value": 20.0}]
    assert moving_average(series) == []


# ── _fetch_and_save_business_formation: 실패 클래스 3종 ────────────────────────

def test_fetch_formation_no_api_key_returns_error(monkeypatch):
    from services.market_indicators.formation import _fetch_and_save_business_formation
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    result = _fetch_and_save_business_formation()
    assert "error" in result


def test_fetch_formation_both_sectors_raise_skips_save(monkeypatch):
    """ⓐ 예외: 두 부문 fetch가 모두 raise → _mc_save 미호출 + 직전 저장값 반환."""
    from services.market_indicators.formation import _fetch_and_save_business_formation
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    stored = {
        "information": [{"date": "2026-05-01", "value": 12000.0}],
        "professional": [{"date": "2026-05-01", "value": 80000.0}],
    }
    monkeypatch.setattr("services.market_indicators.formation._mc_load",
                        lambda key: {"data": stored, "fetched_at": "x"})
    save_mock = MagicMock()
    monkeypatch.setattr("services.market_indicators.formation._mc_save", save_mock)

    def boom(*a, **k):
        raise Exception("network error")

    with patch("services.market_indicators.formation.requests.get", side_effect=boom):
        result = _fetch_and_save_business_formation()

    save_mock.assert_not_called()
    assert result["information"] == stored["information"]
    assert result["professional"] == stored["professional"]
    assert result["_status"] == "skipped"  # job_runs가 스킵을 성공과 구분하는 신호


def test_fetch_formation_both_sectors_empty_response_skips_save(monkeypatch):
    """ⓑ 성공-but-빈응답: 두 부문 모두 관측 0건 → _mc_save 미호출 + 직전 저장값 반환."""
    from services.market_indicators.formation import _fetch_and_save_business_formation
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    stored = {
        "information": [{"date": "2026-05-01", "value": 12000.0}],
        "professional": [{"date": "2026-05-01", "value": 80000.0}],
    }
    monkeypatch.setattr("services.market_indicators.formation._mc_load",
                        lambda key: {"data": stored, "fetched_at": "x"})
    save_mock = MagicMock()
    monkeypatch.setattr("services.market_indicators.formation._mc_save", save_mock)

    with patch("services.market_indicators.formation.requests.get",
               return_value=_fred_response([])):
        result = _fetch_and_save_business_formation()

    save_mock.assert_not_called()
    assert result["information"] == stored["information"]
    assert result["professional"] == stored["professional"]
    assert result["_status"] == "skipped"


def test_fetch_formation_partial_failure_saves_only_failed_sector_as_prev(monkeypatch):
    """ⓒ 부분 페이로드: 한 부문만 실패 → _mc_save 호출됨, 실패 부문==직전값·성공 부문==갱신값."""
    from services.market_indicators.formation import _fetch_and_save_business_formation
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    stored = {
        "information": [{"date": "2026-05-01", "value": 12000.0}],
        "professional": [{"date": "2026-05-01", "value": 80000.0}],
    }
    monkeypatch.setattr("services.market_indicators.formation._mc_load",
                        lambda key: {"data": stored, "fetched_at": "x"})
    saved = {}
    monkeypatch.setattr("services.market_indicators.formation._mc_save",
                        lambda key, data: saved.update({"key": key, "data": data}))

    def fake_get(url, params=None, timeout=None):
        if params["series_id"] == "BABANAICS51SAUS":  # information → 정상 신규값
            return _fred_response([{"date": "2026-06-01", "value": "12999.0"}])
        raise Exception("professional fetch failed")  # professional → 예외

    with patch("services.market_indicators.formation.requests.get", side_effect=fake_get):
        result = _fetch_and_save_business_formation()

    assert saved["key"] == "business_formation"
    assert "_status" not in saved["data"]  # 상태 메타는 저장 캐시에 섞이지 않음
    assert result["professional"] == stored["professional"]  # 실패 부문 = 직전값 보존
    assert [p["date"] for p in result["information"]] == ["2026-05-01", "2026-06-01"]  # 성공 부문 = 갱신
    assert result["_status"] == "partial"  # job_runs가 부분성공을 구분하는 신호


def test_fetch_formation_filters_nonfinite_values(monkeypatch):
    """FRED "NaN"/"Infinity" 문자열은 ValueError 없이 통과하므로 math.isfinite로 걸러야 한다."""
    from services.market_indicators.formation import _fetch_and_save_business_formation
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    monkeypatch.setattr("services.market_indicators.formation._mc_load", lambda key: None)
    monkeypatch.setattr("services.market_indicators.formation._mc_save", lambda key, data: None)

    def fake_get(url, params=None, timeout=None):
        return _fred_response([
            {"date": "2026-06-01", "value": "12999.0"},
            {"date": "2026-06-02", "value": "NaN"},
            {"date": "2026-06-03", "value": "Infinity"},
        ])

    with patch("services.market_indicators.formation.requests.get", side_effect=fake_get):
        result = _fetch_and_save_business_formation()

    assert [p["date"] for p in result["information"]] == ["2026-06-01"]


# ── scheduler 자동 배선: job_runs 상태 반영(auto 레인도 success 고착 금지) ──────────

def test_scheduler_wires_business_formation_fetch():
    import scheduler
    assert "business_formation_fetch" in scheduler._JOB_FUNCS


def test_scheduler_reflects_partial_status_to_job_runs(monkeypatch):
    """auto 레인이 항상 success로 찍히면 부분성공·스킵이 배치현황에서 증발한다
    (적대적 리뷰 Finding 1) — set_status로 실제 상태를 반영해야 한다."""
    import scheduler

    class _FakeRun:
        def __init__(self):
            self.calls = []

        def set_status(self, status, error=None):
            self.calls.append((status, error))

    fake_run = _FakeRun()

    @contextmanager
    def fake_record(job_id, trigger):
        yield fake_run

    import services.job_runs as job_runs
    monkeypatch.setattr(job_runs, "record", fake_record)
    monkeypatch.setattr(
        "services.market_indicators._fetch_and_save_business_formation",
        lambda: {"information": [], "professional": [], "_status": "partial"},
    )

    scheduler._refresh_business_formation()

    assert fake_run.calls == [("partial", None)]


def test_scheduler_reflects_skipped_status_when_no_api_key(monkeypatch):
    """FRED_API_KEY 미설정(또는 전 부문 실패)도 auto 레인에서 skipped로 남아야 한다."""
    import scheduler

    class _FakeRun:
        def __init__(self):
            self.calls = []

        def set_status(self, status, error=None):
            self.calls.append((status, error))

    fake_run = _FakeRun()

    @contextmanager
    def fake_record(job_id, trigger):
        yield fake_run

    import services.job_runs as job_runs
    monkeypatch.setattr(job_runs, "record", fake_record)
    monkeypatch.setattr(
        "services.market_indicators._fetch_and_save_business_formation",
        lambda: {"error": "FRED_API_KEY 환경변수가 필요합니다."},
    )

    scheduler._refresh_business_formation()

    assert fake_run.calls == [("skipped", "FRED_API_KEY 환경변수가 필요합니다.")]


# ── get_business_formation: 응답 계약 ──────────────────────────────────────────

def test_get_business_formation_derives_contract_from_stored(monkeypatch):
    from services.market_indicators.formation import get_business_formation
    stored = {
        "information": [
            {"date": "2026-04-01", "value": 10016.0},
            {"date": "2026-05-01", "value": 12800.0},
            {"date": "2026-06-01", "value": 12999.0},
        ],
        "professional": [],
    }
    monkeypatch.setattr("services.market_indicators.formation._mc_load",
                        lambda key: {"data": stored, "fetched_at": "x"})

    result = get_business_formation()

    info = result["information"]
    assert info["latest_raw"] == pytest.approx(12999.0)
    assert info["prev_raw"] == pytest.approx(12800.0)
    assert info["latest_date"] == "2026-06-01"
    assert len(info["ma3"]) == 1
    assert info["latest_ma3"] == pytest.approx((10016.0 + 12800.0 + 12999.0) / 3, abs=0.01)

    prof = result["professional"]
    assert prof == {"history": [], "ma3": [], "latest_raw": None, "latest_ma3": None,
                     "latest_date": None, "prev_raw": None}


def test_get_business_formation_empty_when_no_stored(monkeypatch):
    from services.market_indicators.formation import get_business_formation
    monkeypatch.setattr("services.market_indicators.formation._mc_load", lambda key: None)

    result = get_business_formation()

    assert set(result.keys()) == {"information", "professional"}
    for view in result.values():
        assert view == {"history": [], "ma3": [], "latest_raw": None, "latest_ma3": None,
                         "latest_date": None, "prev_raw": None}

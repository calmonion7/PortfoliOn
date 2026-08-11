"""고용 조사 2종(Labor Surveys, FRED) — 조사별 소스-폴백 저장 가드.

CONVENTIONS §1.3: 끝 가드가 아니라 조사별 가드 — 예외/빈응답/부분 페이로드 3종을
전부 물어야 wrong < missing이 성립한다. market_cache 접근은 전부 mock(실 DB 금지).
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from unittest.mock import patch, MagicMock


def _fred_response(obs):
    resp = MagicMock()
    resp.json.return_value = {"observations": obs}
    resp.raise_for_status = lambda: None
    return resp


# ── change_12m 순수함수 ────────────────────────────────────────────────────

def test_change_12m_computes_normal_case():
    from services.market_indicators.labor import change_12m
    series = [
        {"date": "2025-07-01", "value": 157000.0},
        {"date": "2026-07-01", "value": 158858.0},
    ]
    assert change_12m(series) == pytest.approx(1858.0)


def test_change_12m_empty_series_returns_none():
    from services.market_indicators.labor import change_12m
    assert change_12m([]) is None


def test_change_12m_returns_none_when_12_months_ago_missing():
    """12개월 전(2025-07) 관측이 결손이고 그 대신 인접한 2025-06·2025-08만 있다.
    인덱스 오프셋(series[-13])을 썼다면 index 0(2025-06-01)을 짚어 158858-156000=2858.0을
    조용히 반환했을 자리 — 날짜 키 매칭이면 그 날짜가 없으므로 None이어야 한다."""
    from services.market_indicators.labor import change_12m
    series = [
        {"date": "2025-06-01", "value": 156000.0},
        {"date": "2025-08-01", "value": 156500.0},
        {"date": "2025-09-01", "value": 156700.0},
        {"date": "2025-10-01", "value": 156900.0},
        {"date": "2025-11-01", "value": 157100.0},
        {"date": "2025-12-01", "value": 157300.0},
        {"date": "2026-01-01", "value": 157500.0},
        {"date": "2026-02-01", "value": 157700.0},
        {"date": "2026-03-01", "value": 157900.0},
        {"date": "2026-04-01", "value": 158100.0},
        {"date": "2026-05-01", "value": 158300.0},
        {"date": "2026-06-01", "value": 158500.0},
        {"date": "2026-07-01", "value": 158858.0},
    ]
    assert len(series) == 13  # 13개인데 정확히 index -13이 (틀린) 2025-06을 짚는다
    assert change_12m(series) is None


# ── _fetch_and_save_labor_surveys: 실패 클래스 3종 ────────────────────────

def test_fetch_labor_no_api_key_returns_error(monkeypatch):
    from services.market_indicators.labor import _fetch_and_save_labor_surveys
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    result = _fetch_and_save_labor_surveys()
    assert "error" in result


def test_fetch_labor_both_surveys_raise_skips_save(monkeypatch):
    """ⓐ 예외: 두 조사 fetch가 모두 raise → _mc_save 미호출 + 직전 저장값 반환."""
    from services.market_indicators.labor import _fetch_and_save_labor_surveys
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    stored = {
        "establishment": [{"date": "2026-05-01", "value": 158500.0}],
        "household": [{"date": "2026-05-01", "value": 161900.0}],
    }
    monkeypatch.setattr("services.market_indicators.labor._mc_load",
                        lambda key: {"data": stored, "fetched_at": "x"})
    save_mock = MagicMock()
    monkeypatch.setattr("services.market_indicators.labor._mc_save", save_mock)

    def boom(*a, **k):
        raise Exception("network error")

    with patch("services.market_indicators.labor.requests.get", side_effect=boom):
        result = _fetch_and_save_labor_surveys()

    save_mock.assert_not_called()
    assert result["establishment"] == stored["establishment"]
    assert result["household"] == stored["household"]
    assert result["_status"] == "skipped"  # job_runs가 스킵을 성공과 구분하는 신호


def test_fetch_labor_both_surveys_empty_response_skips_save(monkeypatch):
    """ⓑ 성공-but-빈응답: 두 조사 모두 관측 0건 → _mc_save 미호출 + 직전 저장값 반환."""
    from services.market_indicators.labor import _fetch_and_save_labor_surveys
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    stored = {
        "establishment": [{"date": "2026-05-01", "value": 158500.0}],
        "household": [{"date": "2026-05-01", "value": 161900.0}],
    }
    monkeypatch.setattr("services.market_indicators.labor._mc_load",
                        lambda key: {"data": stored, "fetched_at": "x"})
    save_mock = MagicMock()
    monkeypatch.setattr("services.market_indicators.labor._mc_save", save_mock)

    with patch("services.market_indicators.labor.requests.get",
               return_value=_fred_response([])):
        result = _fetch_and_save_labor_surveys()

    save_mock.assert_not_called()
    assert result["establishment"] == stored["establishment"]
    assert result["household"] == stored["household"]
    assert result["_status"] == "skipped"


def test_fetch_labor_partial_failure_saves_only_failed_survey_as_prev(monkeypatch):
    """ⓒ 부분 페이로드: 한 조사만 실패 → _mc_save 호출됨, 실패 조사==직전값·성공 조사==갱신값."""
    from services.market_indicators.labor import _fetch_and_save_labor_surveys
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    stored = {
        "establishment": [{"date": "2026-05-01", "value": 158500.0}],
        "household": [{"date": "2026-05-01", "value": 161900.0}],
    }
    monkeypatch.setattr("services.market_indicators.labor._mc_load",
                        lambda key: {"data": stored, "fetched_at": "x"})
    saved = {}
    monkeypatch.setattr("services.market_indicators.labor._mc_save",
                        lambda key, data: saved.update({"key": key, "data": data}))

    def fake_get(url, params=None, timeout=None):
        if params["series_id"] == "PAYEMS":  # establishment → 정상 신규값
            return _fred_response([{"date": "2026-06-01", "value": "158858.0"}])
        raise Exception("household fetch failed")  # household → 예외

    with patch("services.market_indicators.labor.requests.get", side_effect=fake_get):
        result = _fetch_and_save_labor_surveys()

    assert saved["key"] == "labor_surveys"
    assert "_status" not in saved["data"]  # 상태 메타는 저장 캐시에 섞이지 않음
    assert result["household"] == stored["household"]  # 실패 조사 = 직전값 보존
    assert [p["date"] for p in result["establishment"]] == ["2026-05-01", "2026-06-01"]  # 성공 조사 = 갱신
    assert result["_status"] == "partial"  # job_runs가 부분성공을 구분하는 신호


def test_fetch_labor_filters_nonfinite_values(monkeypatch):
    """FRED "NaN"/"Infinity" 문자열은 ValueError 없이 통과하므로 math.isfinite로 걸러야 한다."""
    from services.market_indicators.labor import _fetch_and_save_labor_surveys
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    monkeypatch.setattr("services.market_indicators.labor._mc_load", lambda key: None)
    monkeypatch.setattr("services.market_indicators.labor._mc_save", lambda key, data: None)

    def fake_get(url, params=None, timeout=None):
        return _fred_response([
            {"date": "2026-06-01", "value": "158858.0"},
            {"date": "2026-06-02", "value": "NaN"},
            {"date": "2026-06-03", "value": "Infinity"},
        ])

    with patch("services.market_indicators.labor.requests.get", side_effect=fake_get):
        result = _fetch_and_save_labor_surveys()

    assert [p["date"] for p in result["establishment"]] == ["2026-06-01"]


# ── get_labor_surveys: 응답 계약 ──────────────────────────────────────────

def test_get_labor_surveys_derives_contract_from_stored(monkeypatch):
    from services.market_indicators.labor import get_labor_surveys
    stored = {
        "establishment": [
            {"date": "2025-07-01", "value": 157000.0},
            {"date": "2026-06-01", "value": 158500.0},
            {"date": "2026-07-01", "value": 158858.0},
        ],
        "household": [],
    }
    monkeypatch.setattr("services.market_indicators.labor._mc_load",
                        lambda key: {"data": stored, "fetched_at": "x"})

    result = get_labor_surveys()

    est = result["establishment"]
    assert est["latest"] == pytest.approx(158858.0)
    assert est["latest_date"] == "2026-07-01"
    assert est["change_12m"] == pytest.approx(1858.0)
    assert est["history"] == stored["establishment"]

    hh = result["household"]
    assert hh == {"history": [], "latest": None, "latest_date": None, "change_12m": None}


def test_get_labor_surveys_empty_when_no_stored(monkeypatch):
    from services.market_indicators.labor import get_labor_surveys
    monkeypatch.setattr("services.market_indicators.labor._mc_load", lambda key: None)

    result = get_labor_surveys()

    assert set(result.keys()) == {"establishment", "household"}
    for view in result.values():
        assert view == {"history": [], "latest": None, "latest_date": None, "change_12m": None}

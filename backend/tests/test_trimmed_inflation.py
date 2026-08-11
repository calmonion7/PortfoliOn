"""절사평균 물가 4종(Trimmed Inflation, FRED) — 계열별 소스-폴백 저장 가드 + 단위 통일.

CONVENTIONS §1.3: 끝 가드가 아니라 계열별 가드 — 예외/빈응답/부분 페이로드 3종을
전부 물어야 wrong < missing이 성립한다. market_cache 접근은 전부 mock(실 DB 금지).

단위 혼동이 이 모듈의 최대 위험 — core_pce·headline_pce는 지수, dallas_trimmed·
cleveland_trimmed는 이미 YoY %다. get_trimmed_inflation()은 4종 모두 % 시계열로
통일해 반환해야 하고, 이미 %인 2종은 YoY를 두 번 적용하지 않아야 한다.
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


# ── yoy_from_index 순수함수 ──────────────────────────────────────────────

def test_yoy_from_index_empty_series_returns_empty():
    from services.market_indicators.inflation import yoy_from_index
    assert yoy_from_index([]) == []


def test_yoy_from_index_regression_matches_measured_core_and_headline_pce():
    """실측 기준값(2026-08-11 컨테이너 프로브, 2026-06) 재현 — 코어 PCE 3.29 · 헤드라인 PCE 3.67.
    지수 fixture(전년 125.00 → 당월 값)에서 YoY 파생이 그 값을 내는지 검증한다."""
    from services.market_indicators.inflation import yoy_from_index

    core = yoy_from_index([
        {"date": "2025-06-01", "value": 125.00},
        {"date": "2026-06-01", "value": 129.1125},
    ])
    assert core[-1]["value"] == pytest.approx(3.29)
    assert core[-1]["date"] == "2026-06-01"

    headline = yoy_from_index([
        {"date": "2025-06-01", "value": 125.00},
        {"date": "2026-06-01", "value": 129.5875},
    ])
    assert headline[-1]["value"] == pytest.approx(3.67)


def test_yoy_from_index_skips_gap_and_computes_others():
    """12개월 전 관측이 결손인 달만 생략하고 나머지 달은 정상 계산한다.
    인덱스 오프셋(series[i-12])이었다면 결손 이후 전 지점이 한 달씩 밀려 오계산됐을 자리."""
    from services.market_indicators.inflation import yoy_from_index

    months = [f"{i:02d}" for i in range(1, 13)]
    series = [{"date": f"2025-{m}-01", "value": 100.0} for m in months if m != "07"]  # 2025-07 결손
    series += [{"date": f"2026-{m}-01", "value": 105.0} for m in months]

    result = yoy_from_index(series)

    dates = {p["date"] for p in result}
    assert "2026-07-01" not in dates  # 2025-07 결손 → 이 지점만 생략
    assert len(result) == 11          # 2026년 12개월 중 결손 대응 1개월만 제외
    for p in result:
        assert p["value"] == pytest.approx(5.0)


def test_yoy_from_index_zero_denominator_skips_point():
    from services.market_indicators.inflation import yoy_from_index
    series = [
        {"date": "2025-06-01", "value": 0.0},
        {"date": "2026-06-01", "value": 105.0},
    ]
    assert yoy_from_index(series) == []


# ── _fetch_and_save_trimmed_inflation: 실패 클래스 3종 ─────────────────────

def _stored_fixture():
    return {
        "core_pce": [{"date": "2026-05-01", "value": 128.90}],
        "headline_pce": [{"date": "2026-05-01", "value": 129.30}],
        "dallas_trimmed": [{"date": "2026-05-01", "value": 2.20}],
        "cleveland_trimmed": [{"date": "2026-05-01", "value": 2.60}],
    }


def test_fetch_inflation_no_api_key_returns_error(monkeypatch):
    from services.market_indicators.inflation import _fetch_and_save_trimmed_inflation
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    result = _fetch_and_save_trimmed_inflation()
    assert "error" in result


def test_fetch_inflation_all_series_raise_skips_save(monkeypatch):
    """ⓐ 예외: 4계열 fetch가 모두 raise → _mc_save 미호출 + 직전 저장값 반환."""
    from services.market_indicators.inflation import _fetch_and_save_trimmed_inflation
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    stored = _stored_fixture()
    monkeypatch.setattr("services.market_indicators.inflation._mc_load",
                        lambda key: {"data": stored, "fetched_at": "x"})
    save_mock = MagicMock()
    monkeypatch.setattr("services.market_indicators.inflation._mc_save", save_mock)

    def boom(*a, **k):
        raise Exception("network error")

    with patch("services.market_indicators.inflation.requests.get", side_effect=boom):
        result = _fetch_and_save_trimmed_inflation()

    save_mock.assert_not_called()
    for key in stored:
        assert result[key] == stored[key]
    assert result["_status"] == "skipped"  # job_runs가 스킵을 성공과 구분하는 신호


def test_fetch_inflation_all_series_empty_response_skips_save(monkeypatch):
    """ⓑ 성공-but-빈응답: 4계열 모두 관측 0건 → _mc_save 미호출 + 직전 저장값 반환."""
    from services.market_indicators.inflation import _fetch_and_save_trimmed_inflation
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    stored = _stored_fixture()
    monkeypatch.setattr("services.market_indicators.inflation._mc_load",
                        lambda key: {"data": stored, "fetched_at": "x"})
    save_mock = MagicMock()
    monkeypatch.setattr("services.market_indicators.inflation._mc_save", save_mock)

    with patch("services.market_indicators.inflation.requests.get",
               return_value=_fred_response([])):
        result = _fetch_and_save_trimmed_inflation()

    save_mock.assert_not_called()
    for key in stored:
        assert result[key] == stored[key]
    assert result["_status"] == "skipped"


def test_fetch_inflation_partial_failure_saves_only_failed_series_as_prev(monkeypatch):
    """ⓒ 부분 페이로드: dallas_trimmed만 성공, 나머지 3계열 실패 →
    _mc_save 호출됨, 실패 계열==직전값 · 성공 계열==갱신값, 저장 payload에 _status 미유입."""
    from services.market_indicators.inflation import _fetch_and_save_trimmed_inflation
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    stored = _stored_fixture()
    monkeypatch.setattr("services.market_indicators.inflation._mc_load",
                        lambda key: {"data": stored, "fetched_at": "x"})
    saved = {}
    monkeypatch.setattr("services.market_indicators.inflation._mc_save",
                        lambda key, data: saved.update({"key": key, "data": data}))

    def fake_get(url, params=None, timeout=None):
        if params["series_id"] == "PCETRIM12M159SFRBDAL":  # dallas_trimmed → 정상 신규값
            return _fred_response([{"date": "2026-06-01", "value": "2.23"}])
        raise Exception("fetch failed")  # 나머지 3계열 → 예외

    with patch("services.market_indicators.inflation.requests.get", side_effect=fake_get):
        result = _fetch_and_save_trimmed_inflation()

    assert saved["key"] == "trimmed_inflation"
    assert "_status" not in saved["data"]  # 상태 메타는 저장 캐시에 섞이지 않음
    assert result["core_pce"] == stored["core_pce"]                    # 실패 계열 = 직전값 보존
    assert result["headline_pce"] == stored["headline_pce"]            # 실패 계열 = 직전값 보존
    assert result["cleveland_trimmed"] == stored["cleveland_trimmed"]  # 실패 계열 = 직전값 보존
    assert [p["date"] for p in result["dallas_trimmed"]] == ["2026-05-01", "2026-06-01"]  # 성공 계열 = 갱신
    assert result["_status"] == "partial"  # job_runs가 부분성공을 구분하는 신호


def test_fetch_inflation_filters_nonfinite_values(monkeypatch):
    """FRED "NaN"/"Infinity" 문자열은 ValueError 없이 통과하므로 math.isfinite로 걸러야 한다."""
    from services.market_indicators.inflation import _fetch_and_save_trimmed_inflation
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    monkeypatch.setattr("services.market_indicators.inflation._mc_load", lambda key: None)
    monkeypatch.setattr("services.market_indicators.inflation._mc_save", lambda key, data: None)

    def fake_get(url, params=None, timeout=None):
        return _fred_response([
            {"date": "2026-06-01", "value": "129.11"},
            {"date": "2026-06-02", "value": "NaN"},
            {"date": "2026-06-03", "value": "Infinity"},
        ])

    with patch("services.market_indicators.inflation.requests.get", side_effect=fake_get):
        result = _fetch_and_save_trimmed_inflation()

    assert [p["date"] for p in result["core_pce"]] == ["2026-06-01"]


# ── get_trimmed_inflation: 응답 계약 + 단위 통일 ────────────────────────────

def test_get_trimmed_inflation_unifies_units_index_derives_percent_passes_through(monkeypatch):
    from services.market_indicators.inflation import get_trimmed_inflation
    stored = {
        "core_pce": [
            {"date": "2025-06-01", "value": 125.00},
            {"date": "2026-06-01", "value": 129.1125},
        ],
        "headline_pce": [],
        "dallas_trimmed": [{"date": "2026-06-01", "value": 2.23}],
        "cleveland_trimmed": [],
    }
    monkeypatch.setattr("services.market_indicators.inflation._mc_load",
                        lambda key: {"data": stored, "fetched_at": "x"})

    result = get_trimmed_inflation()

    core = result["core_pce"]
    assert core["history"] == [{"date": "2026-06-01", "value": 3.29}]  # 지수 → YoY 파생
    assert core["latest"] == pytest.approx(3.29)
    assert core["latest_date"] == "2026-06-01"

    dallas = result["dallas_trimmed"]
    assert dallas["history"] == stored["dallas_trimmed"]  # 이미 % → 원값 그대로(YoY 재적용 없음)
    assert dallas["latest"] == pytest.approx(2.23)
    assert dallas["latest_date"] == "2026-06-01"

    assert result["headline_pce"] == {"history": [], "latest": None, "latest_date": None}
    assert result["cleveland_trimmed"] == {"history": [], "latest": None, "latest_date": None}


def test_get_trimmed_inflation_empty_when_no_stored(monkeypatch):
    from services.market_indicators.inflation import get_trimmed_inflation
    monkeypatch.setattr("services.market_indicators.inflation._mc_load", lambda key: None)

    result = get_trimmed_inflation()

    assert set(result.keys()) == {"core_pce", "headline_pce", "dallas_trimmed", "cleveland_trimmed"}
    for view in result.values():
        assert view == {"history": [], "latest": None, "latest_date": None}

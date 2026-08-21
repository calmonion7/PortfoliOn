"""KR AVG_PRC override 경로의 비유한값 가드 (B52).

`run_daily`의 KR 분기는 `upsert_raw_reports`의 `math.isfinite` 초크포인트를 **타지 않는다** —
`daily_consensus_mart`를 직접 UPDATE한다. 그래서 마트 정본에 이르는 경로가 둘이고,
`tests/test_consensus_target_nan.py`는 전자(raw_reports AVG())만 지킨다. 이 파일이 후자를 지킨다.

새는 이유 3종(전부 이 저장소가 실측한 성질):
  1. `float("nan")`·`float("inf")`·`float("Infinity")`는 ValueError를 던지지 않아
     `except (ValueError, KeyError)`를 그냥 통과한다.
  2. `bool(float("nan")) == True` → 옛 `if kr.get("target_mean"):` 진리값 가드가 NaN을 통과시켰다.
  3. PostgreSQL `numeric`은 NaN을 저장한다 → UPDATE가 성공하고 행이 영구 오염되며,
     그 값이 응답에 실리면 starlette `allow_nan=False`로 500이 된다.

가드는 2층이고 각 층이 막는 것이 다르다:
  - **소스층** `services/market/kr.py::get_analyst_data_kr` — 파싱 시점에 비유한값을 버린다
    (`target_mean`·`target_high`·`target_low`가 report_generator·routers/report로도 흘러가므로
     여기서 막아야 mart 밖 소비처까지 덮인다).
  - **싱크층** `services/consensus_pipeline.py::run_daily` — mart UPDATE 직전 게이트.
    소스가 아닌 제3의 provider로 바뀌어도 마트 정본을 지킨다. 0·음수도 여기서 배제한다.
"""
import json
import logging
from unittest.mock import MagicMock, patch

import pytest

import services.consensus_pipeline as pipeline
from services.market import kr as kr_mod
from services.utils import today_kst


# ---------------------------------------------------------------------------
# 소스층 — get_analyst_data_kr 파싱
# ---------------------------------------------------------------------------
def _fnguide_resp(items):
    resp = MagicMock()
    resp.raise_for_status.return_value = None
    resp.content = json.dumps({"comp": items}).encode("utf-8")
    return resp


def _analyst_kr(items):
    with patch.object(kr_mod.requests, "get", return_value=_fnguide_resp(items)):
        return kr_mod.get_analyst_data_kr("005930")


@pytest.mark.parametrize("token", ["nan", "NaN", "inf", "Infinity", "-Infinity"])
def test_source_nonfinite_avg_prc_is_dropped(token):
    """AVG_PRC의 비유한 토큰은 target_mean에 도달하지 않는다 (prices도 비어 폴백 없음)."""
    got = _analyst_kr([{"TARGET_PRC": token, "AVG_PRC": token, "RECOM_CD": "4.0"}])
    assert got["target_mean"] is None, f"AVG_PRC={token!r}이 target_mean으로 새어 나왔다"
    assert got["target_high"] is None
    assert got["target_low"] is None


def test_source_nonfinite_target_prc_excluded_from_mean_high_low():
    """TARGET_PRC 일부가 비유한이면 그 항목만 빠지고 나머지로 평균·최대·최소를 낸다.

    AVG_PRC가 비어 있을 때 폴백 `sum(prices)/len(prices)`가 NaN 하나로 통째 오염되던 경로."""
    got = _analyst_kr([
        {"TARGET_PRC": "nan",      "AVG_PRC": "", "RECOM_CD": "4.0"},
        {"TARGET_PRC": "90,000",   "AVG_PRC": "", "RECOM_CD": "4.0"},
        {"TARGET_PRC": "100,000",  "AVG_PRC": "", "RECOM_CD": "4.0"},
    ])
    assert got["target_mean"] == 95000.0
    assert got["target_high"] == 100000.0
    assert got["target_low"] == 90000.0


def test_source_normal_values_unchanged_control():
    """대조군 — 정상 입력은 계속 값을 낸다(가드가 정상 데이터를 지우지 않는다)."""
    got = _analyst_kr([
        {"TARGET_PRC": "90,000",  "AVG_PRC": "88,000", "RECOM_CD": "4.0"},
        {"TARGET_PRC": "100,000", "AVG_PRC": "88,000", "RECOM_CD": "2.0"},
    ])
    assert got["target_mean"] == 88000.0
    assert got["target_high"] == 100000.0
    assert got["target_low"] == 90000.0
    assert (got["buy"], got["hold"], got["sell"]) == (1, 0, 1)


# ---------------------------------------------------------------------------
# 싱크층 — run_daily의 mart UPDATE 게이트
# ---------------------------------------------------------------------------
def _run_daily_kr(analyst: dict):
    """KR 1종목으로 run_daily 실행. raw upsert·mart refresh는 격리하고 execute만 관측한다."""
    with patch.object(pipeline, "upsert_raw_reports", return_value=0), \
         patch.object(pipeline, "refresh_mart", return_value=None), \
         patch.object(pipeline, "execute", return_value=1) as mock_exec, \
         patch("services.market.get_analyst_data_kr", return_value=analyst):
        pipeline.run_daily([{"ticker": "005930", "market": "KR"}])
    return mock_exec


def _analyst_dict(target_mean):
    return {"target_mean": target_mean, "target_high": None, "target_low": None,
            "buy": 0, "hold": 0, "sell": 0}


@pytest.mark.parametrize("bad", [
    float("nan"), float("inf"), float("-inf"),
])
def test_sink_nonfinite_target_mean_never_updates_mart(bad):
    """비유한 target_mean은 UPDATE되지 않는다 — numeric은 NaN을 저장하므로 행이 영구 오염된다."""
    mock_exec = _run_daily_kr(_analyst_dict(bad))
    assert mock_exec.call_count == 0, f"target_mean={bad!r}이 마트에 UPDATE됐다"


@pytest.mark.parametrize("bad", [0, 0.0, -1.0, -88000.0])
def test_sink_nonpositive_target_mean_never_updates_mart(bad):
    """0·음수는 목표가로 성립하지 않는 실패 표식이므로 override를 생략한다.

    옛 `if kr.get("target_mean"):`는 0을 막았으나 음수는 truthy라 통과시켰다 —
    `math.isfinite`만으로 바꾸면 0까지 통과하게 되므로 `> 0`을 명시해 두 방향을 함께 못박는다.
    생략 시 raw_reports AVG()로 계산된 직전 값이 유지된다(wrong < missing)."""
    mock_exec = _run_daily_kr(_analyst_dict(bad))
    assert mock_exec.call_count == 0, f"target_mean={bad!r}이 마트에 UPDATE됐다"


def test_sink_none_target_mean_never_updates_mart():
    mock_exec = _run_daily_kr(_analyst_dict(None))
    assert mock_exec.call_count == 0


def test_sink_normal_target_mean_updates_mart_control():
    """대조군 — 정상 숫자는 계속 UPDATE된다."""
    mock_exec = _run_daily_kr(_analyst_dict(88000.0))
    assert mock_exec.call_count == 1
    sql, params = mock_exec.call_args_list[0][0][0], mock_exec.call_args_list[0][0][1]
    assert "UPDATE daily_consensus_mart" in sql
    assert params == (88000.0, "005930", today_kst())


def test_sink_skip_is_logged_as_skip_not_as_failure(caplog):
    """관측 — 스킵은 '생략' 마커로 남고 예외 경로('override failed')와 구별된다.

    이 축이 없으면 가드가 TypeError로 죽어 except에 삼켜진 경우와 정상 스킵이 같아 보인다."""
    with caplog.at_level(logging.WARNING, logger="services.consensus_pipeline"):
        mock_exec = _run_daily_kr(_analyst_dict(float("nan")))
    assert mock_exec.call_count == 0
    msgs = [r.getMessage() for r in caplog.records]
    assert any("AVG_PRC override 생략" in m for m in msgs), msgs
    assert not any("override failed" in m for m in msgs), msgs


def test_sink_update_path_logs_no_skip_marker_control(caplog):
    """대조군 — 갱신된 경우엔 생략 마커가 없다(로그로 갱신/생략이 갈린다)."""
    with caplog.at_level(logging.WARNING, logger="services.consensus_pipeline"):
        mock_exec = _run_daily_kr(_analyst_dict(88000.0))
    assert mock_exec.call_count == 1
    assert not any("AVG_PRC override 생략" in r.getMessage() for r in caplog.records)


# ---------------------------------------------------------------------------
# 2층 관통 — FnGuide 원응답에서 마트까지
# ---------------------------------------------------------------------------
def _run_daily_kr_live(items):
    with patch.object(pipeline, "upsert_raw_reports", return_value=0), \
         patch.object(pipeline, "refresh_mart", return_value=None), \
         patch.object(pipeline, "execute", return_value=1) as mock_exec, \
         patch.object(kr_mod.requests, "get", return_value=_fnguide_resp(items)):
        pipeline.run_daily([{"ticker": "005930", "market": "KR"}])
    return mock_exec


@pytest.mark.parametrize("token", ["nan", "inf", "Infinity"])
def test_end_to_end_nonfinite_fnguide_payload_never_reaches_mart(token):
    mock_exec = _run_daily_kr_live([{"TARGET_PRC": token, "AVG_PRC": token, "RECOM_CD": "4.0"}])
    assert mock_exec.call_count == 0, f"FnGuide {token!r} 응답이 마트까지 도달했다"


def test_end_to_end_normal_fnguide_payload_updates_mart_control():
    mock_exec = _run_daily_kr_live([{"TARGET_PRC": "90,000", "AVG_PRC": "88,000", "RECOM_CD": "4.0"}])
    assert mock_exec.call_count == 1
    assert mock_exec.call_args_list[0][0][1] == (88000.0, "005930", today_kst())

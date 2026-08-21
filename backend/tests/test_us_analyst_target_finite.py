"""US 애널리스트 목표가도 비유한값을 걸러낸다 (적대 검토 F5 — B52의 형제).

B52 수정이 소스층 가드를 `get_analyst_data_kr`에만 넣어, **같은 dispatcher의 US 분기**
(`services/market/__init__.py::get_analyst_data`)가 무가드로 남았다. 그 값이 NaN일 수
있다는 것은 이 코드베이스가 스스로 단언한 사실이다 — `consensus_pipeline.py`의 초크포인트
docstring이 「`apt.get("mean")` 진위 체크는 NaN이 truthy라 그대로 통과시킬 수 있다」고
적고 있고, 그 `apt`가 바로 같은 `analyst_price_targets`다. 즉 두 소비 경로 중
raw_reports는 막혔고 **스냅샷 경로는 안 막혔다**.

스냅샷 경로가 더 나쁜 이유: 파이썬 `json.dumps`는 기본 `allow_nan=True`라 리터럴 `NaN`
토큰을 만들지만 `snapshots.data`는 **jsonb NOT NULL**이라 PostgreSQL이
`invalid input syntax for type json`으로 거부한다 →
  ① `routers/report.py::refresh_analyst`가 500
  ② `report_generator` 일배치의 그 종목 스냅샷 저장 실패 → 그날 리포트가 조용히 누락
    (배치가 예외를 warning으로 삼킨다).
"""
from unittest.mock import MagicMock

import pytest

from services.market import get_analyst_data

NONFINITE = [float("nan"), float("inf"), float("-inf")]


def _ticker(targets, recs=None):
    t = MagicMock()
    t.analyst_price_targets = targets
    t.recommendations_summary = recs
    return t


@pytest.mark.parametrize("bad", NONFINITE)
@pytest.mark.parametrize("field", ["mean", "high", "low"])
def test_nonfinite_us_target_is_dropped(field, bad):
    """비유한 필드만 None이 되고 같은 dict의 정상 필드는 살아 있다(wrong < missing)."""
    targets = {"mean": 100.0, "high": 120.0, "low": 80.0}
    targets[field] = bad
    got = get_analyst_data("AAPL", market="US", _t=_ticker(targets))
    key = {"mean": "target_mean", "high": "target_high", "low": "target_low"}[field]
    assert got[key] is None, f"{field}={bad!r}이 {key}로 새어 나왔다"
    for other in ("target_mean", "target_high", "target_low"):
        if other != key:
            assert got[other] is not None, f"{other}까지 함께 지워졌다(과잉 처방)"


def test_all_nonfinite_us_targets_dropped():
    got = get_analyst_data(
        "AAPL", market="US",
        _t=_ticker({"mean": float("nan"), "high": float("inf"), "low": float("-inf")}))
    assert (got["target_mean"], got["target_high"], got["target_low"]) == (None, None, None)


def test_json_dumps_of_result_is_strict_serializable():
    """실제 파손 지점의 이빨 — `json.dumps(..., allow_nan=False)`가 통과해야 한다.

    NaN이 남아 있으면 `snapshots.data`(jsonb NOT NULL) INSERT가 PostgreSQL에서 거부된다.
    """
    import json
    got = get_analyst_data("AAPL", market="US",
                           _t=_ticker({"mean": float("nan"), "high": 1.0, "low": 1.0}))
    json.dumps(got, allow_nan=False)   # raise하면 실패


def test_normal_us_targets_unchanged_control():
    """대조군 — 정상 입력은 계속 값을 낸다(가드가 US 목표가를 통째로 지우지 않았다)."""
    recs = MagicMock()
    recs.empty = False
    recs.iloc = [{"strongBuy": 2, "buy": 3, "hold": 1, "sell": 0, "strongSell": 1}]
    got = get_analyst_data("AAPL", market="US",
                           _t=_ticker({"mean": 100.5, "high": 120.0, "low": 80.25}, recs))
    assert (got["target_mean"], got["target_high"], got["target_low"]) == (100.5, 120.0, 80.25)
    assert (got["buy"], got["hold"], got["sell"]) == (5, 1, 1)


def test_missing_targets_dict_still_none_control():
    got = get_analyst_data("AAPL", market="US", _t=_ticker({}))
    assert (got["target_mean"], got["target_high"], got["target_low"]) == (None, None, None)

"""upsert_raw_reports의 NaN target_price 초크포인트 회귀 테스트 (task B4).

_fetch_us_raw:184의 `float(row.get("currentPriceTarget") or 0) or None`과 :197·203의
`apt.get("mean")` 진위 체크는 NaN이 truthy라 그대로 통과시켜 raw_reports.target_price에
nan이 실릴 수 있다(AVG()가 daily_consensus_mart.avg_target_price로 전파, ADR-0008).
초크포인트는 fetcher 개별이 아니라 upsert_raw_reports 단일 INSERT 통로.

⚠️ 단 이 파일이 지키는 것은 마트에 이르는 **두 경로 중 하나**다 —
① raw_reports INSERT → _MART_SQL의 AVG()(여기) ② run_daily의 KR AVG_PRC override가
daily_consensus_mart를 직접 UPDATE(이 통로를 우회). ②의 핀은
tests/test_consensus_nan_override_guard.py이며, 이 파일 3축은 ②가 무가드로 되돌아가도
전부 초록이므로 "단일 통로가 정본까지 닫는다"로 읽지 말 것(B52).
"""
from unittest.mock import patch
import math
import services.consensus_pipeline as pipeline


def test_nan_target_normalized_to_none_others_unchanged():
    """(a) NaN target → INSERT 파라미터의 target_price는 None. 정상값·기존 None은 불변.
    (c) 마지막 호출(call_args)이 아니라 호출별(call_args_list)로 확인 + call_count로 시퀀스 고정."""
    fetched = [
        {"report_date": "2026-08-01", "brokerage_code": "A", "target_price": float("nan"), "raw_opinion": "Buy"},
        {"report_date": "2026-08-02", "brokerage_code": "B", "target_price": 150.0, "raw_opinion": "Hold"},
        {"report_date": "2026-08-03", "brokerage_code": "C", "target_price": None, "raw_opinion": "Sell"},
    ]
    with patch.object(pipeline, "_fetch_us_raw", return_value=fetched) as mock_fetch, \
         patch.object(pipeline, "execute", return_value=1) as mock_exec:
        n = pipeline.upsert_raw_reports("AAPL", "US", days=7)

    mock_fetch.assert_called_once_with("AAPL", 7)
    assert n == 3
    assert mock_exec.call_count == 3, "NaN 행도 opinion이 있으니 INSERT는 여전히 3건이어야 한다"

    params_a = mock_exec.call_args_list[0][0][1]
    params_b = mock_exec.call_args_list[1][0][1]
    params_c = mock_exec.call_args_list[2][0][1]
    # params 튜플: (report_date, ticker, brokerage_code, target_price, raw_opinion, opinion_score)
    assert params_a[3] is None, "NaN target은 None으로 정규화돼야 한다"
    assert params_b[3] == 150.0, "정상 target 값은 불변이어야 한다"
    assert params_c[3] is None, "기존 None target도 그대로 None이어야 한다"


def test_nan_target_and_no_opinion_row_is_dropped():
    """(b) target이 NaN이고 opinion도 빈 행은 정규화 뒤 필터에서 걸러져 INSERT 자체가 없다
    (정보가 0인 행이 target=None으로 살아남는 회귀를 막는 순서 핀)."""
    fetched = [
        {"report_date": "2026-08-01", "brokerage_code": "A", "target_price": float("nan"), "raw_opinion": ""},
    ]
    with patch.object(pipeline, "_fetch_us_raw", return_value=fetched), \
         patch.object(pipeline, "execute", return_value=1) as mock_exec:
        n = pipeline.upsert_raw_reports("AAPL", "US", days=7)

    assert n == 0
    mock_exec.assert_not_called()


def test_infinity_target_also_normalized():
    """math.isfinite 가드이므로 inf/-inf도 NaN과 동일하게 None 정규화된다."""
    fetched = [
        {"report_date": "2026-08-01", "brokerage_code": "A", "target_price": float("inf"), "raw_opinion": "Buy"},
    ]
    with patch.object(pipeline, "_fetch_us_raw", return_value=fetched), \
         patch.object(pipeline, "execute", return_value=1) as mock_exec:
        pipeline.upsert_raw_reports("AAPL", "US", days=7)

    assert mock_exec.call_args_list[0][0][1][3] is None

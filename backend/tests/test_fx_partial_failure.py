import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from unittest.mock import patch


def _fetch_fx_side_effect(args):
    """usdjpy fetch fails (exception path → None); usdkrw/eurusd succeed."""
    key, sym, stored_history = args
    if key == "usdjpy":
        return key, None
    return key, {"current": 1400.0, "change_pct": 0.5, "history": []}


def test_partial_fx_failure_preserves_last_good_value():
    from services.market_indicators import get_fx, _cache
    _cache.clear()

    stored_data = {
        "rates": {
            "usdkrw": {"current": 1350.0, "change_pct": 0.1},
            "usdjpy": {"current": 155.32, "change_pct": -0.2},
            "eurusd": {"current": 1.08, "change_pct": 0.0},
        },
        "history": {"usdkrw": []},
    }

    with patch("services.market_indicators.fx._mc_load", return_value={"data": stored_data}), \
         patch("services.market_indicators.fx._fetch_fx", side_effect=_fetch_fx_side_effect), \
         patch("services.market_indicators.fx._mc_save") as mock_save:
        result = get_fx()

    # persisted (mc_save'd) rates keep the seeded usdjpy value, not dropped
    saved_data = mock_save.call_args[0][1]
    assert saved_data["rates"]["usdjpy"] == {"current": 155.32, "change_pct": -0.2}
    # successful keys still get fresh values
    assert saved_data["rates"]["usdkrw"]["current"] == 1400.0
    # returned result matches what was persisted
    assert result["rates"]["usdjpy"]["current"] == 155.32


def test_all_fx_fetches_fail_keeps_stored_data_untouched():
    from services.market_indicators import get_fx, _cache
    _cache.clear()

    stored_data = {
        "rates": {
            "usdkrw": {"current": 1350.0, "change_pct": 0.1},
            "usdjpy": {"current": 155.32, "change_pct": -0.2},
            "eurusd": {"current": 1.08, "change_pct": 0.0},
        },
        "history": {"usdkrw": []},
    }

    with patch("services.market_indicators.fx._mc_load", return_value={"data": stored_data}), \
         patch("services.market_indicators.fx._fetch_fx", side_effect=lambda args: (args[0], None)), \
         patch("services.market_indicators.fx._mc_save") as mock_save:
        result = get_fx()

    # 전 심볼 실패 → **저장 자체를 하지 않는다.** 이 단언은 예전엔 "저장된 rates가 직전값과
    # 같다"였는데, 그 경로의 payload는 rates만 직전값을 복사하고 `history`·`_raw_history`는
    # `{}`였다 — 즉 "untouched"라는 이름과 달리 usdkrw 히스토리를 **지우는** 저장이었다.
    # 저장을 생략하면 이 테스트의 이름이 말하는 것이 실제로 성립한다(그리고 `fetched_at`도
    # 갱신되지 않아 나이 신호가 거짓이 되지 않는다).
    assert not mock_save.called
    # 응답은 여전히 직전 저장값으로 채워진다(소스-폴백은 그대로 동작한다)
    assert result["rates"]["usdkrw"]["current"] == 1350.0
    assert result["rates"]["usdjpy"]["current"] == 155.32
    assert result["rates"]["eurusd"]["current"] == 1.08

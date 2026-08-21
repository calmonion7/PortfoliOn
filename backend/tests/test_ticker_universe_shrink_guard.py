"""티커 유니버스 축소 가드 (B30) — `earnings._tickers_with_cache`.

옛 게이트는 `if tickers:`(all-or-nothing)라 **빈 목록만** 막고 **축소된 부분 목록은
그대로 7일 캐시에 박제**했다. 503종목 중 3종목만 긁혀도 그 3종목으로 이후 최소 1주간
S&P500/KOSPI 실적 비중이 계산된다(실패 클래스 (b) 성공-but-빈응답의 부분판).

같은 함수의 docstring은 이미 "빈/**부분** 목록을 박제하면"이라고 적고 있었으므로
문서가 코드보다 정확한 상태였다 — 이 파일이 그 간극을 못박는다.

판정 기준(baseline)은 **직전 저장값의 길이**다. 정적 시드를 기준으로 쓰지 않는 이유는
`earnings.py`의 `_TICKER_MIN_RETAIN` 주석에 근거와 함께 적혀 있다(KOSPI 시드 2182 vs
라이브 스크레이프 규모 불일치 → 첫 실행 영구 차단).
"""
import logging
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from services.market_indicators import earnings


def _stored(n, prefix="OLD", days=9):
    """만료된(=재스크레이프를 유발하는) 저장값 n건. 이것이 축소 판정의 기준이 된다."""
    return {"data": {"tickers": [f"{prefix}{i}" for i in range(n)]},
            "fetched_at": datetime.now(timezone.utc) - timedelta(days=days)}


def _scraped(n, prefix="NEW"):
    return [f"{prefix}{i}" for i in range(n)]


# ── ⓐ 축소된 스크레이프는 저장하지 않는다 ────────────────────────────────────

def test_shrunk_scrape_does_not_save_and_keeps_stored():
    """503 → 50(10%)은 저장 생략 + 직전 저장값 반환(직전 양호값 보존)."""
    stored = _stored(503)
    with patch.object(earnings, "_mc_load_strict", return_value=stored), \
         patch.object(earnings, "_mc_save") as mock_save:
        tickers = earnings._tickers_with_cache(
            "sp500_tickers", earnings._SP500_SEED, lambda: _scraped(50))
    assert not mock_save.called, "축소된 유니버스가 7일 캐시에 박제됐다"
    assert tickers == earnings._stored_tickers(stored)


def test_shrink_just_below_boundary_skips_save():
    """경계 바로 아래(89.8% = 452/503)도 축소로 판정한다."""
    with patch.object(earnings, "_mc_load_strict", return_value=_stored(503)), \
         patch.object(earnings, "_mc_save") as mock_save:
        earnings._tickers_with_cache(
            "sp500_tickers", earnings._SP500_SEED, lambda: _scraped(452))
    assert not mock_save.called


def test_kospi_shrunk_scrape_does_not_save():
    """가드는 공용 헬퍼에 있으므로 KOSPI 키도 같이 물린다(두 키 대칭)."""
    stored = _stored(900, prefix="0000")
    with patch.object(earnings, "_mc_load_strict", return_value=stored), \
         patch.object(earnings, "_mc_save") as mock_save, \
         patch.object(earnings, "_scrape_kospi", return_value=_scraped(12, "1111")):
        tickers = earnings._get_kospi_tickers()
    assert not mock_save.called
    assert tickers == earnings._stored_tickers(stored)


# ── ⓑ 대조군: 정상 입력은 계속 값을 내고 계속 저장된다 ──────────────────────

def test_full_scrape_still_saves_control():
    """대조군 — 정상 규모(동수)는 종래처럼 저장하고 스크레이프 결과를 반환한다.

    이 축이 없으면 "전부 스킵하기"가 위 3건을 통과한다.
    """
    fresh_list = _scraped(503)
    with patch.object(earnings, "_mc_load_strict", return_value=_stored(503)), \
         patch.object(earnings, "_mc_save") as mock_save:
        tickers = earnings._tickers_with_cache(
            "sp500_tickers", earnings._SP500_SEED, lambda: fresh_list)
    mock_save.assert_called_once_with("sp500_tickers", {"tickers": fresh_list})
    assert tickers == fresh_list


def test_shrink_boundary_at_ninety_percent_saves_control():
    """대조군 — 정확히 기준의 90%(453/503)는 정상 종목 교체로 보고 저장한다.

    비교 연산자를 못박는다(`<` vs `<=`). S&P500은 분기당 수 종목이 교체될 뿐이라
    10% 축소 허용은 정당한 변동을 죽이지 않는다.
    """
    ok = _scraped(453)
    with patch.object(earnings, "_mc_load_strict", return_value=_stored(503)), \
         patch.object(earnings, "_mc_save") as mock_save:
        tickers = earnings._tickers_with_cache(
            "sp500_tickers", earnings._SP500_SEED, lambda: ok)
    mock_save.assert_called_once_with("sp500_tickers", {"tickers": ok})
    assert tickers == ok


def test_growth_is_never_shrink_control():
    """대조군 — 유니버스가 늘어난 결과는 당연히 저장된다."""
    grown = _scraped(510)
    with patch.object(earnings, "_mc_load_strict", return_value=_stored(503)), \
         patch.object(earnings, "_mc_save") as mock_save:
        earnings._tickers_with_cache(
            "sp500_tickers", earnings._SP500_SEED, lambda: grown)
    mock_save.assert_called_once_with("sp500_tickers", {"tickers": grown})


# ── ⓒ 기준이 없는 첫 실행 — 가드가 자기교착을 만들지 않는다 ─────────────────

def test_first_run_without_baseline_saves_anything():
    """저장값이 **확인상 없으면**(첫 실행·DB 공백) 기준이 0이라 가드는 원리적으로 발동하지 않는다.

    이것이 없으면 "모든 첫 실행을 막아 영구 빈 상태"가 되는 자기교착이 생긴다
    (기준을 정적 시드로 잡았을 때 실제로 그렇게 된다 — `_TICKER_MIN_RETAIN` 주석 참조).

    ⚠️ **"기준 0"은 「행 없음」만 뜻한다 — 「조회 실패」는 여기 해당하지 않는다.** 관용
    `_mc_load`로 읽던 옛 구현에서는 둘이 같은 `None`이라 DB 오류가 이 경로로 새어 가드를
    통째로 껐다(3종목이 503종목을 덮은 원 버그의 재현 조건). 그래서 로더가 엄격판으로 바뀌었고,
    조회 실패 축은 `test_guard_baseline_integrity.py`가 별도로 못박는다.
    """
    small = _scraped(2)
    with patch.object(earnings, "_mc_load_strict", return_value=None), \
         patch.object(earnings, "_mc_save") as mock_save:
        tickers = earnings._tickers_with_cache(
            "sp500_tickers", earnings._SP500_SEED, lambda: small)
    mock_save.assert_called_once_with("sp500_tickers", {"tickers": small})
    assert tickers == small


def test_scrape_failure_still_falls_back_without_saving():
    """실패 클래스 (a) 예외는 종래 동작 그대로 — 가드 도입이 이 경로를 바꾸지 않는다."""
    stored = _stored(503)
    with patch.object(earnings, "_mc_load_strict", return_value=stored), \
         patch.object(earnings, "_mc_save") as mock_save:
        def boom():
            raise RuntimeError("boom")
        tickers = earnings._tickers_with_cache(
            "sp500_tickers", earnings._SP500_SEED, boom)
    assert not mock_save.called
    assert tickers == earnings._stored_tickers(stored)


# ── 관측성: 저장과 생략이 로그에서 구분된다 ──────────────────────────────────

def test_shrink_skip_is_distinguishable_in_logs(caplog):
    """저장 생략은 warning으로 축소 수치를 남기고, 정상 저장은 그 마커를 남기지 않는다."""
    with caplog.at_level(logging.WARNING, logger="services.market_indicators.earnings"):
        with patch.object(earnings, "_mc_load_strict", return_value=_stored(503)), \
             patch.object(earnings, "_mc_save"):
            earnings._tickers_with_cache(
                "sp500_tickers", earnings._SP500_SEED, lambda: _scraped(10))
        skipped = [r.message for r in caplog.records if "축소" in r.message]
        assert skipped, "저장 생략이 로그에 남지 않아 관측 불가하다"
        assert "10" in skipped[0] and "503" in skipped[0], skipped[0]

        caplog.clear()
        with patch.object(earnings, "_mc_load_strict", return_value=_stored(503)), \
             patch.object(earnings, "_mc_save"):
            earnings._tickers_with_cache(
                "sp500_tickers", earnings._SP500_SEED, lambda: _scraped(503))
        assert not [r for r in caplog.records if "축소" in r.message]

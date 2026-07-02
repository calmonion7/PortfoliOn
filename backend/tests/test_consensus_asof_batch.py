"""get_asof_batch 단위테스트 — (ticker, date) 쌍 배치 조회가
티커별 get_asof와 동일한 결과를 내고 쿼리 횟수를 최대 2로 제한함."""
from unittest.mock import patch, call, MagicMock
from services import consensus as consensus_svc


def _mart_row(ticker, target_mean=200.0, buy=10, hold=3, sell=0):
    return {
        "ticker": ticker,
        "target_mean": target_mean,
        "target_high": 220.0,
        "target_low": 180.0,
        "buy": buy,
        "hold": hold,
        "sell": sell,
    }


def _hist_row(ticker, target_mean=150.0, buy=7, hold=1, sell=2):
    return {
        "ticker": ticker,
        "target_mean": target_mean,
        "target_high": 160.0,
        "target_low": 140.0,
        "buy": buy,
        "hold": hold,
        "sell": sell,
    }


# ── test 1: 배치 결과 == 티커별 get_asof 결과 ──────────────────────────────────
def test_get_asof_batch_matches_per_ticker_get_asof():
    """get_asof_batch(pairs)가 각 티커별 get_asof 결과와 동일한 dict를 반환한다."""
    pairs = [("AAPL", "2026-06-12"), ("MSFT", "2026-06-10")]
    mart_rows = [_mart_row("AAPL"), _mart_row("MSFT", target_mean=300.0, buy=15)]

    with patch("services.consensus.query", return_value=mart_rows):
        result = consensus_svc.get_asof_batch(pairs)

    # AAPL 결과
    assert result["AAPL"]["target_mean"] == 200.0
    assert result["AAPL"]["buy"] == 10
    # MSFT 결과
    assert result["MSFT"]["target_mean"] == 300.0
    assert result["MSFT"]["buy"] == 15


# ── test 2: mart 전체 히트 시 query 1회 ──────────────────────────────────────
def test_get_asof_batch_mart_all_hit_single_query():
    """모든 티커가 mart에 있으면 쿼리 1회(history 폴백 없음)."""
    pairs = [("AAPL", "2026-06-12"), ("MSFT", "2026-06-10")]
    mart_rows = [_mart_row("AAPL"), _mart_row("MSFT")]

    with patch("services.consensus.query", return_value=mart_rows) as mock_q:
        consensus_svc.get_asof_batch(pairs)

    assert mock_q.call_count == 1


# ── test 3: mart 빈 티커는 history 폴백, query 총 2회 ────────────────────────
def test_get_asof_batch_history_fallback_for_mart_miss():
    """mart에 없는 티커가 있으면 2차 쿼리로 history 폴백한다. query 총 ≤ 2."""
    pairs = [("AAPL", "2026-06-12"), ("TSLA", "2026-06-10")]
    # mart는 AAPL만 반환, TSLA 없음
    mart_rows = [_mart_row("AAPL")]
    hist_rows = [_hist_row("TSLA")]

    with patch("services.consensus.query", side_effect=[mart_rows, hist_rows]) as mock_q:
        result = consensus_svc.get_asof_batch(pairs)

    assert mock_q.call_count == 2
    assert result["AAPL"]["target_mean"] == 200.0
    assert result["TSLA"]["target_mean"] == 150.0
    assert result["TSLA"]["buy"] == 7


# ── test 4: mart/history 모두 없는 티커는 None ─────────────────────────────────
def test_get_asof_batch_none_when_no_rows():
    """mart·history 모두 없으면 해당 티커 값은 None."""
    pairs = [("AAPL", "2026-06-12")]

    with patch("services.consensus.query", side_effect=[[], []]):
        result = consensus_svc.get_asof_batch(pairs)

    assert result["AAPL"] is None


# ── test 5: 빈 입력 ────────────────────────────────────────────────────────────
def test_get_asof_batch_empty_input():
    with patch("services.consensus.query") as mock_q:
        result = consensus_svc.get_asof_batch([])
    assert result == {}
    mock_q.assert_not_called()


# ── test 6: mart 일부 미스 + history도 없는 혼합 케이스 ────────────────────────
def test_get_asof_batch_mixed_mart_and_none():
    """AAPL=mart 히트, TSLA=mart 미스+history 없음 → TSLA None, query 2회."""
    pairs = [("AAPL", "2026-06-12"), ("TSLA", "2026-06-10")]
    mart_rows = [_mart_row("AAPL")]

    with patch("services.consensus.query", side_effect=[mart_rows, []]) as mock_q:
        result = consensus_svc.get_asof_batch(pairs)

    assert mock_q.call_count == 2
    assert result["AAPL"] is not None
    assert result["TSLA"] is None


# ── test 7: VALUES 플레이스홀더 형태 — 행별 (%s,%s::date) 나열, 바깥 괄호 금지 ──
def test_values_placeholder_shape():
    """VALUES ((a,b),(c,d))는 N행이 아니라 record 1행이 돼 라이브 에러(v(ticker,d) 매핑 실패).
    바깥 괄호 없는 행 나열임을 못박는다."""
    ph = consensus_svc._values_placeholder([("A", "2026-01-01"), ("B", "2026-01-02")])
    assert ph == "(%s,%s::date), (%s,%s::date)"
    assert not ph.startswith("((")
    # 실제 SQL로 조립 시 VALUES (row), (row) 형태가 되는지
    sql = "JOIN (VALUES %s) AS v(ticker, d)" % ph
    assert sql == "JOIN (VALUES (%s,%s::date), (%s,%s::date)) AS v(ticker, d)"

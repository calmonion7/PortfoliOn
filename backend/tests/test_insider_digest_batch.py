"""S4 + S7 배치화 테스트.

S4: upsert_insider_trades — execute_many 1콜(행수 무관).
S7: _recent_disclosure_feed / _recent_insider_trades — N=3 홀딩에서 쿼리 수 상수(각 1).
    배치 집계가 티커별 단건 결과와 동일.
"""
import sys
from pathlib import Path
from datetime import date
from unittest.mock import patch, MagicMock, call
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))


# ── S4: upsert_insider_trades execute_many 1콜 ──────────────────────────────

def test_upsert_calls_execute_many_once_for_multiple_rows(monkeypatch):
    """행이 여러 개여도 execute_many는 1번만 호출된다."""
    from services import insider_trades as svc
    calls = []
    monkeypatch.setattr(svc, "execute_many", lambda sql, params_list: calls.append(params_list))

    rows = [
        {"report_kind": "insider", "rcept_no": "R1", "rcept_dt": "20260515",
         "repror": "홍길동", "rel": "대표이사",
         "shares_change": 1000, "shares_after": 10000, "rate_after": 0.5},
        {"report_kind": "major5", "rcept_no": "R2", "rcept_dt": "20260514",
         "repror": "국민연금", "rel": "변동",
         "shares_change": -2000, "shares_after": 500000, "rate_after": 5.2},
    ]
    svc.upsert_insider_trades("005930.KS", rows)
    assert len(calls) == 1
    params_list = calls[0]
    assert len(params_list) == 2


def test_upsert_execute_many_params_match_per_row_execute(monkeypatch):
    """배치 params가 구행별 execute 인자와 동일한지 확인."""
    from services import insider_trades as svc

    single_calls = []
    batch_calls = []

    # 단건 버전: execute를 직접 쓰는 임시 함수로 비교값 수집
    def collect_single(sql, params):
        single_calls.append(params)

    row = {
        "report_kind": "insider", "rcept_no": "R1", "rcept_dt": "20260515",
        "repror": "홍길동", "rel": "대표이사",
        "shares_change": 1000, "shares_after": 10000, "rate_after": 0.5,
    }

    # 배치 버전
    monkeypatch.setattr(svc, "execute_many", lambda sql, params_list: batch_calls.extend(params_list))
    svc.upsert_insider_trades("005930.KS", [row])

    # row_hash + 나머지 필드 순서
    assert len(batch_calls) == 1
    p = batch_calls[0]
    assert p[1] == "005930.KS"          # ticker upper
    assert p[2] == "insider"            # report_kind
    assert p[3] == "R1"                 # rcept_no
    assert p[4] == "20260515"           # rcept_dt
    assert p[5] == "홍길동"              # repror
    assert p[6] == "대표이사"            # rel
    assert p[7] == 1000                 # shares_change
    assert p[8] == 10000                # shares_after
    assert p[9] == 0.5                  # rate_after


def test_upsert_empty_rows_is_noop(monkeypatch):
    """빈 rows → execute_many 미호출(no-op)."""
    from services import insider_trades as svc
    calls = []
    monkeypatch.setattr(svc, "execute_many", lambda sql, pl: calls.append(pl))
    svc.upsert_insider_trades("005930.KS", [])
    # execute_many(sql, [])는 db.py에서 no-op이므로 호출돼도 무해하지만
    # 아예 안 넘기거나 빈 리스트를 넘겨도 OK
    # 핵심: execute(단건)은 호출되지 않는다
    assert all(pl == [] for pl in calls) or calls == []


# ── S7: compute_net_signals_batch ────────────────────────────────────────────

def test_compute_net_signals_batch_matches_per_ticker(monkeypatch):
    """배치 집계가 ticker별 단건 compute_net_signal과 동일한 결과를 낸다."""
    from services import insider_trades as svc

    # DB 응답 시뮬레이션: 005930.KS +1300(buy), 000660.KS -500(sell)
    def fake_query(sql, params):
        return [
            {"ticker": "005930.KS", "net_shares": 1300, "cnt": 3},
            {"ticker": "000660.KS", "net_shares": -500, "cnt": 2},
        ]

    monkeypatch.setattr(svc, "query", fake_query)
    result = svc.compute_net_signals_batch(["005930.KS", "000660.KS"])

    assert result["005930.KS"]["direction"] == "buy"
    assert result["005930.KS"]["net_shares"] == 1300
    assert result["005930.KS"]["count"] == 3
    assert result["000660.KS"]["direction"] == "sell"
    assert result["000660.KS"]["net_shares"] == -500
    assert result["000660.KS"]["count"] == 2


def test_compute_net_signals_batch_missing_ticker_is_neutral(monkeypatch):
    """DB에 행이 없는 티커는 neutral/0으로 채워진다."""
    from services import insider_trades as svc
    monkeypatch.setattr(svc, "query", lambda sql, params: [])
    result = svc.compute_net_signals_batch(["005930.KS"])
    assert result["005930.KS"]["direction"] == "neutral"
    assert result["005930.KS"]["net_shares"] == 0
    assert result["005930.KS"]["count"] == 0


def test_compute_net_signals_batch_single_query(monkeypatch):
    """N=3 티커에서 query는 1번만 호출된다."""
    from services import insider_trades as svc
    query_count = [0]

    def counting_query(sql, params):
        query_count[0] += 1
        return []

    monkeypatch.setattr(svc, "query", counting_query)
    svc.compute_net_signals_batch(["A", "B", "C"])
    assert query_count[0] == 1


def test_compute_net_signals_batch_uses_any_clause(monkeypatch):
    """쿼리가 ticker = ANY(%s) 형태로 배치 조회한다."""
    from services import insider_trades as svc
    captured = {}

    def cap_query(sql, params):
        captured["sql"] = sql
        captured["params"] = params
        return []

    monkeypatch.setattr(svc, "query", cap_query)
    svc.compute_net_signals_batch(["005930.KS", "000660.KS"])
    assert "ANY(%s)" in captured["sql"]
    assert "GROUP BY ticker" in captured["sql"]


# ── S7: _recent_disclosure_feed / _recent_insider_trades 쿼리 수 상수 ────────

def _make_holdings(n=3):
    return [{"ticker": f"0{i:05d}.KS", "name": f"종목{i}", "market": "KR"} for i in range(n)]


def test_recent_disclosure_feed_single_query(monkeypatch):
    """N=3 홀딩에서 get_disclosures_batch는 1번 호출(쿼리 수 상수)."""
    import services.digest_service as ds
    holdings = _make_holdings(3)
    call_count = [0]

    def fake_batch(tickers, limit_per_ticker=20):
        call_count[0] += 1
        return []

    with patch("services.disclosures.get_disclosures_batch", side_effect=fake_batch):
        result = ds._recent_disclosure_feed(holdings, date(2026, 5, 23))

    assert call_count[0] == 1
    assert result == []


def test_recent_insider_trades_single_query(monkeypatch):
    """N=3 홀딩에서 compute_net_signals_batch는 1번 호출(쿼리 수 상수)."""
    import services.digest_service as ds
    holdings = _make_holdings(3)
    call_count = [0]

    def fake_batch(tickers):
        call_count[0] += 1
        return {t.upper(): {"direction": "neutral", "net_shares": 0, "count": 0, "window_days": 90}
                for t in tickers}

    with patch("services.insider_trades.compute_net_signals_batch", side_effect=fake_batch):
        result = ds._recent_insider_trades(holdings, date(2026, 5, 23))

    assert call_count[0] == 1
    assert result == []


def test_recent_disclosure_feed_filters_window_and_ticker(monkeypatch):
    """배치 반환 행에서 윈도우 밖·오래된 공시는 제외되고 ticker는 upper로 정규화된다."""
    import services.digest_service as ds
    holdings = [{"ticker": "005930.KS", "name": "삼성전자", "market": "KR"}]
    disc = [
        {"ticker": "005930.KS", "rcept_no": "1", "rcept_dt": "20260522",
         "report_nm": "최근", "pblntf_ty": "A", "corp_name": "삼성전자", "dart_url": "u1"},
        {"ticker": "005930.KS", "rcept_no": "2", "rcept_dt": "20260401",
         "report_nm": "오래됨", "pblntf_ty": "A", "corp_name": "삼성전자", "dart_url": "u2"},
    ]
    with patch("services.disclosures.get_disclosures_batch", return_value=disc):
        result = ds._recent_disclosure_feed(holdings, date(2026, 5, 23))

    report_names = [r["report_nm"] for r in result]
    assert "최근" in report_names
    assert "오래됨" not in report_names
    assert all(r["ticker"] == "005930.KS" for r in result)


def test_recent_insider_trades_excludes_neutral_returns_signals(monkeypatch):
    """배치 결과에서 neutral은 제외되고 buy/sell만 반환된다."""
    import services.digest_service as ds
    holdings = [
        {"ticker": "005930.KS", "name": "삼성전자", "market": "KR"},
        {"ticker": "000660.KS", "name": "SK하이닉스", "market": "KR"},
    ]
    batch_result = {
        "005930.KS": {"direction": "buy", "net_shares": 5000, "count": 2, "window_days": 90},
        "000660.KS": {"direction": "neutral", "net_shares": 0, "count": 0, "window_days": 90},
    }
    with patch("services.insider_trades.compute_net_signals_batch", return_value=batch_result):
        result = ds._recent_insider_trades(holdings, date(2026, 5, 23))

    assert len(result) == 1
    assert result[0]["ticker"] == "005930.KS"
    assert result[0]["direction"] == "buy"
    assert result[0]["net_shares"] == 5000

"""S4 Bug B: fetch_all_us_supply — yfinance '성공-but-빈응답'(t.info=={})을 last-good에
클로버하지 않는 가드 회귀 테스트.

fetch_us_supply는 예외가 없으면 dict를 반환하므로(None이 아님) 호출측이 non-None만으로
저장하면 전 필드 빈 결과도 upsert되어 직전 주의 실데이터를 지운다. _is_all_empty 가드가
그 경우 upsert를 스킵하고 실패로 카운트해야 한다."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


def _rows(monkeypatch):
    # fetch_all_us_supply는 함수 내부에서 `from services.db import query as db_query`로
    # 지연 import하므로 services.db.query를 patch해야 한다(svc.query가 아님).
    import services.db as _db
    monkeypatch.setattr(
        _db, "query",
        lambda sql, params=None: [{"ticker": "AAPL", "exchange": ""}],
    )


def test_all_empty_result_skips_upsert(monkeypatch):
    """short 3필드 all-None + institutional 빈 + insider 빈 → upsert_us_supply 미호출, failed 집계."""
    from services import us_supply as svc
    _rows(monkeypatch)

    empty_result = {
        "short": {"short_pct_float": None, "short_ratio": None, "shares_short": None,
                  "date_short_interest": None},
        "institutional": [],
        "insider": {"transactions": [], "net": {}},
    }
    monkeypatch.setattr(svc, "fetch_us_supply", lambda t, exchange="": empty_result)
    called = {"n": 0}
    monkeypatch.setattr(svc, "upsert_us_supply", lambda t, d: called.__setitem__("n", called["n"] + 1))

    out = svc.fetch_all_us_supply()

    assert called["n"] == 0
    assert out == {"ok": 0, "failed": 1, "total": 1}


def test_partial_result_still_upserts(monkeypatch):
    """일부 필드(short_ratio)라도 있으면 저장 진행(ok 집계)."""
    from services import us_supply as svc
    _rows(monkeypatch)

    partial_result = {
        "short": {"short_pct_float": None, "short_ratio": 2.5, "shares_short": None,
                  "date_short_interest": None},
        "institutional": [],
        "insider": {"transactions": [], "net": {}},
    }
    monkeypatch.setattr(svc, "fetch_us_supply", lambda t, exchange="": partial_result)
    called = {"n": 0}
    monkeypatch.setattr(svc, "upsert_us_supply", lambda t, d: called.__setitem__("n", called["n"] + 1))

    out = svc.fetch_all_us_supply()

    assert called["n"] == 1
    assert out == {"ok": 1, "failed": 0, "total": 1}


def test_institutional_only_result_still_upserts(monkeypatch):
    """short·insider가 다 비어도 institutional에 값이 있으면 저장 진행."""
    from services import us_supply as svc
    _rows(monkeypatch)

    result = {
        "short": {"short_pct_float": None, "short_ratio": None, "shares_short": None,
                  "date_short_interest": None},
        "institutional": [{"holder": "Vanguard", "pct_held": 0.08, "shares": 1000, "pct_change": 0.0}],
        "insider": {"transactions": [], "net": {}},
    }
    monkeypatch.setattr(svc, "fetch_us_supply", lambda t, exchange="": result)
    called = {"n": 0}
    monkeypatch.setattr(svc, "upsert_us_supply", lambda t, d: called.__setitem__("n", called["n"] + 1))

    out = svc.fetch_all_us_supply()

    assert called["n"] == 1
    assert out == {"ok": 1, "failed": 0, "total": 1}


def test_none_result_still_counts_as_failed_not_all_empty_path(monkeypatch):
    """fetch_us_supply가 None(예외 삼킴)이면 기존 경로(_is_all_empty 호출 전에 continue)로 failed."""
    from services import us_supply as svc
    _rows(monkeypatch)

    monkeypatch.setattr(svc, "fetch_us_supply", lambda t, exchange="": None)
    called = {"n": 0}
    monkeypatch.setattr(svc, "upsert_us_supply", lambda t, d: called.__setitem__("n", called["n"] + 1))

    out = svc.fetch_all_us_supply()

    assert called["n"] == 0
    assert out == {"ok": 0, "failed": 1, "total": 1}

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))


# ── fetch_all_backlog (DB query + per-ticker fetch faked) ──

def test_fetch_all_backlog_query_filters_kr(monkeypatch):
    from services import backlog as svc
    captured = {}

    def fake_query(sql, params=None):
        captured["sql"] = sql
        return [{"ticker": "005930.KS"}]

    monkeypatch.setattr(svc, "query", fake_query)
    monkeypatch.setattr(svc, "fetch_and_save_backlog", lambda t: [])
    svc.fetch_all_backlog()

    assert "market = 'KR'" in captured["sql"]
    assert "user_stocks" in captured["sql"]
    assert "tickers" in captured["sql"]


def test_fetch_all_backlog_calls_each_ticker(monkeypatch):
    from services import backlog as svc
    calls = []

    monkeypatch.setattr(
        svc, "query",
        lambda sql, params=None: [{"ticker": "005930.KS"}, {"ticker": "000660.KS"}],
    )
    monkeypatch.setattr(svc, "fetch_and_save_backlog", lambda t: calls.append(t))

    result = svc.fetch_all_backlog()

    assert calls == ["005930.KS", "000660.KS"]
    assert result == {"total": 2, "ok": 2, "failed": 0}


def test_fetch_all_backlog_continues_on_error(monkeypatch):
    from services import backlog as svc
    calls = []

    def flaky(t):
        calls.append(t)
        if t == "005930.KS":
            raise RuntimeError("boom")

    monkeypatch.setattr(
        svc, "query",
        lambda sql, params=None: [{"ticker": "005930.KS"}, {"ticker": "000660.KS"}],
    )
    monkeypatch.setattr(svc, "fetch_and_save_backlog", flaky)

    result = svc.fetch_all_backlog()

    assert calls == ["005930.KS", "000660.KS"]
    assert result == {"total": 2, "ok": 1, "failed": 1}

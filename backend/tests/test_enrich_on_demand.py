"""온디맨드 갱신 `POST /api/stocks/{ticker}/enrich/request` (task#354, ADR 260916-132605 결정 2).

서버 판정: 404(미존재) · unconfigured · fresh(7일 이내) · in_flight(TTL 15분) · stale→fire · fire_failed.
응답 계약은 항상 `{fired: bool, reason: str}`.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import get_current_user
from routers import stocks as stocks_mod
from routers.stocks import router

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
client = TestClient(app)

NOW = datetime.now(timezone.utc)


@pytest.fixture(autouse=True)
def _reset_inflight():
    stocks_mod._ENRICH_INFLIGHT.clear()
    yield
    stocks_mod._ENRICH_INFLIGHT.clear()


def _with(enriched_at, configured=True, fire_ok=True):
    rows = [] if enriched_at == "MISSING" else [{"enriched_at": enriched_at}]
    return (
        patch.object(stocks_mod, "query", return_value=rows),
        patch.object(stocks_mod.cowork_trigger, "configured", return_value=configured),
        patch.object(stocks_mod.cowork_trigger, "fire", return_value=fire_ok),
    )


def _post(t="AAPL"):
    return client.post(f"/api/stocks/{t}/enrich/request")


def test_unknown_ticker_404():
    q, c, f = _with("MISSING")
    with q, c, f as fire:
        r = _post("ZZZZ")
    assert r.status_code == 404
    fire.assert_not_called()


def test_unconfigured_does_not_fire():
    q, c, f = _with(None, configured=False)
    with q, c, f as fire:
        r = _post()
    assert r.status_code == 200 and r.json() == {"fired": False, "reason": "unconfigured"}
    fire.assert_not_called()


def test_fresh_within_7_days_does_not_fire():
    q, c, f = _with(NOW - timedelta(days=6, hours=23))
    with q, c, f as fire:
        r = _post()
    assert r.json() == {"fired": False, "reason": "fresh"}
    fire.assert_not_called()


def test_null_enriched_at_fires_with_exact_kwargs():
    q, c, f = _with(None)
    with q, c, f as fire:
        r = _post("aapl")
    assert r.json() == {"fired": True, "reason": "stale"}
    assert fire.call_count == 1
    kw = fire.call_args.kwargs
    assert kw["tickers"] == ["AAPL"] and kw["model"] == "opus" and kw["chunk"] == 1


def test_stale_over_7_days_fires():
    q, c, f = _with(NOW - timedelta(days=8))
    with q, c, f as fire:
        r = _post()
    assert r.json()["fired"] is True
    assert fire.call_count == 1


def test_second_call_while_in_flight_does_not_fire_again():
    q, c, f = _with(None)
    with q, c, f as fire:
        r1 = _post()
        r2 = _post()
    assert r1.json()["fired"] is True
    assert r2.json() == {"fired": False, "reason": "in_flight"}
    assert fire.call_count == 1


def test_fire_failure_releases_inflight_and_reports():
    q, c, f = _with(None, fire_ok=False)
    with q, c, f as fire:
        r1 = _post()
        r2 = _post()
    assert r1.json() == {"fired": False, "reason": "fire_failed"}
    assert r2.json()["reason"] == "fire_failed"  # 실패는 in-flight를 남기지 않는다
    assert fire.call_count == 2


def test_inflight_entry_expires_after_ttl():
    q, c, f = _with(None)
    with q, c, f as fire:
        _post()
        stocks_mod._ENRICH_INFLIGHT["AAPL"] -= stocks_mod._ENRICH_INFLIGHT_TTL + 1
        r = _post()
    assert r.json()["fired"] is True
    assert fire.call_count == 2


def test_anonymous_request_is_401_on_fresh_app():
    fresh = FastAPI()
    fresh.include_router(router)
    r = TestClient(fresh).post("/api/stocks/AAPL/enrich/request")
    assert r.status_code == 401

"""이름 백필 silent skip 보강 (task#88) — resolve_name이 실명을 못 찾아 건너뛴 후보를
응답 `skipped`로 표면화하고 진단 로그로 남기는지 검증. resolve_name은 조회 실패 시
티커 자체를 반환하므로 '일시실패'와 '실명없음'을 구분하지 못함 → 재시도 대신 표면화."""
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.stocks import router
from auth import get_current_user, require_admin

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
app.dependency_overrides[require_admin] = lambda: "admin-id"
client = TestClient(app)

CANDIDATES = [
    {"ticker": "AAA", "market": "US", "exchange": "NAS"},
    {"ticker": "BBB", "market": "KR", "exchange": ""},
    {"ticker": "CCC", "market": "US", "exchange": "NAS"},  # resolve 실패 → 티커형 반환(skip)
    {"ticker": "DDD", "market": "KR", "exchange": ""},      # resolve 실패 → 티커형 반환(skip)
]


def _fake_resolve(ticker, market="US", exchange="", user_name="", *a, **k):
    # 실명을 찾은 종목은 실명, 못 찾은 종목은 티커 자체(=resolve_name의 실패 폴백)를 반환
    return {"AAA": "알파", "BBB": "베타"}.get(ticker, ticker)


def _patches():
    return [
        patch("routers.stocks.storage.tickers_missing_name", return_value=CANDIDATES),
        patch("routers.stocks.market.resolve_name", side_effect=_fake_resolve),
        patch("routers.stocks.storage.set_ticker_name"),
        patch("routers.stocks.storage.reconcile_snapshot_names", return_value=[]),
        patch("routers.stocks.cache_svc.invalidate"),
        patch("routers.stocks.cache_svc.invalidate_list"),
        patch("routers.stocks.cache_svc.invalidate_portfolio_caches"),
    ]


def test_backfill_surfaces_skipped_in_response(capsys):
    ps = _patches()
    for p in ps:
        p.start()
    try:
        resp = client.post("/api/stocks/names/backfill")
    finally:
        for p in ps:
            p.stop()
    assert resp.status_code == 202
    body = resp.json()
    assert body["candidates"] == 4
    assert body["updated"] == 2
    # 핵심: 건너뛴 후보가 응답 skipped로 표면화 (updated엔 미포함)
    assert set(body["skipped"]) == {"CCC", "DDD"}


def test_backfill_logs_skipped_candidates(caplog):
    import logging
    caplog.set_level(logging.WARNING)
    ps = _patches()
    for p in ps:
        p.start()
    try:
        client.post("/api/stocks/names/backfill")
    finally:
        for p in ps:
            p.stop()
    out = caplog.text
    # 핵심: 건너뛴 후보가 진단 로그에 남아 silent가 아님
    assert "backfill" in out.lower()
    assert "CCC" in out and "DDD" in out
    # 성공한 종목은 skip 로그에 없음
    assert "skip AAA" not in out and "skip BBB" not in out

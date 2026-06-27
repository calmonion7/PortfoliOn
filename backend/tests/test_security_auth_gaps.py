"""task#108 보안: 무인증 mutation 엔드포인트가 인증을 강제하는지 + refresh token 1회용 회귀 검증.

각 테스트는 dependency override 없는 fresh app으로 실제 auth 의존성을 태운다
(conftest override는 main.app 한정이라 여기 fresh app엔 안 걸린다)."""
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.report import router as report_router
from routers.stocks import router as stocks_router
from routers.market_indicators import router as mi_router


def _client(*routers):
    app = FastAPI()
    for r in routers:
        app.include_router(r)
    return TestClient(app)


def test_refresh_analyst_requires_auth():
    assert _client(report_router).post("/api/report/AAPL/refresh-analyst").status_code == 401


def test_consensus_backfill_requires_auth():
    assert _client(report_router).post("/api/consensus/AAPL/backfill").status_code == 401


def test_dashboard_cache_delete_requires_auth():
    assert _client(stocks_router).delete("/api/stocks/dashboard/cache").status_code == 401


def test_refresh_market_requires_auth():
    assert _client(mi_router).post("/api/market/refresh-market").status_code == 401


def test_enrich_single_requires_auth():
    r = _client(stocks_router).put("/api/stocks/AAPL/enrich", json={"moat": "x"})
    assert r.status_code == 401


def test_enrich_batch_requires_auth():
    r = _client(stocks_router).put("/api/stocks/enrich/batch", json=[{"ticker": "AAPL", "moat": "x"}])
    assert r.status_code == 401


def test_consume_refresh_token_is_one_time():
    """refresh token은 사용 즉시 폐기(회전)되어 재사용 시 거부된다."""
    from services import auth_service
    future = datetime.now(timezone.utc) + timedelta(days=1)
    state = {"n": 0}

    def fake_query(sql, params):
        state["n"] += 1
        return [{"user_id": "u1", "expires_at": future}] if state["n"] == 1 else []

    with patch.object(auth_service, "query", side_effect=fake_query), \
         patch.object(auth_service, "execute") as mock_exec:
        assert auth_service.consume_refresh_token("tok") == "u1"
        mock_exec.assert_called_once()  # DELETE = 1회용 폐기
        assert auth_service.consume_refresh_token("tok") is None  # 재사용 거부

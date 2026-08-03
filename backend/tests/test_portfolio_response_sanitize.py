"""GET /api/portfolio 및 /api/portfolio/prices 응답의 NaN/Infinity sanitize 회귀 테스트.

starlette JSONResponse는 allow_nan=False라 응답 dict에 NaN/Infinity가 남으면 500.
- get_portfolio: DB NUMERIC→Decimal('NaN')이 흘러들 수 있는 자리(영구 500 표면, CLAUDE.md B3).
- get_portfolio_prices: 외부 시세(get_quotes_batch)가 실어오는 float('nan')이 흘러들 수 있는 자리.

main.app(conftest client fixture)으로 돌려야 한다 — RequestValidationError sanitizing 핸들러가
main.py에만 배선돼 있고 이 테스트들은 pydantic 검증이 아니라 정상 요청의 응답 직렬화를 검사하므로
그 핸들러와는 무관하지만, 관례상 라우터 동작은 실제 app을 통해 검증한다.
"""
from decimal import Decimal
from unittest.mock import patch

from services import cache as cache_svc


def test_get_portfolio_nan_decimal_field_sanitized_to_null(client):
    portfolio_with_nan = {
        "stocks": [{
            "ticker": "NFLX", "name": "Netflix", "quantity": 10,
            "avg_cost": Decimal("NaN"),
        }],
        "watchlist": [],
    }
    with patch("routers.portfolio.storage.get_full_portfolio", return_value=portfolio_with_nan):
        resp = client.get("/api/portfolio")
    assert resp.status_code == 200
    assert resp.json()["stocks"][0]["avg_cost"] is None


def test_get_portfolio_prices_nan_price_sanitized_to_null(client):
    cache_svc.invalidate_live_prices()  # 테스트 간 15s TTL 오염 방지(고정 user_id="test-user-id" 공유)
    portfolio = {"stocks": [{"ticker": "AAPL", "market": "US"}], "watchlist": []}
    quotes = {"AAPL": {"price": float("nan"), "daily_change_pct": 1.5}}
    try:
        with patch("routers.portfolio.storage.get_full_portfolio", return_value=portfolio), \
             patch("routers.portfolio.market_svc.get_quotes_batch", return_value=quotes):
            resp = client.get("/api/portfolio/prices")
    finally:
        cache_svc.invalidate_live_prices()  # 이 테스트가 남긴 캐시가 다른 테스트를 오염시키지 않도록
    assert resp.status_code == 200
    assert resp.json()["AAPL"]["current_price"] is None

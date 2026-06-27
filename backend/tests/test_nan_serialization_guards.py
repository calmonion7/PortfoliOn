"""task#109 정합성: NaN/inf가 응답을 오염시켜 starlette allow_nan=False 500을 내지 않는지 검증.

수정 전이면 두 테스트 모두 NaN이 응답에 섞여 직렬화 500(또는 allow_nan=False assert 실패)."""
import json

import pandas as pd
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.recommendations import router as rec_router
from auth import get_current_user


class _ConstTicker:
    """모든 심볼에 상수(제로분산) 90일 종가 → pct_change=0 → corr=NaN 유발."""
    def __init__(self, sym):
        pass

    def history(self, period=None):
        idx = pd.date_range("2026-01-01", periods=30, freq="D")
        return pd.DataFrame({"Close": [100.0] * 30}, index=idx)


def test_macro_correlation_zero_variance_serializes():
    from services import analysis_service
    holdings = [{"ticker": "AAPL", "quantity": 1, "market": "US", "exchange": ""}]
    with patch.object(analysis_service.yf, "Ticker", _ConstTicker):
        result = analysis_service.get_macro_correlation(holdings)
    # 제로분산 corr=NaN이 None으로 가드 → allow_nan=False 직렬화 통과(corr+scatter 전체, starlette 500 없음)
    json.dumps(result, allow_nan=False)
    assert all(c["corr_90d"] is None for c in result["correlations"])


_app = FastAPI()
_app.include_router(rec_router)
_app.dependency_overrides[get_current_user] = lambda: "test-user-id"
_client = TestClient(_app)


def test_recommendations_nan_price_serializes():
    holdings = [{"ticker": "MSFT", "name": "Microsoft", "market": "US",
                 "quantity": 1, "avg_cost": 100.0, "exchange": ""}]
    with patch("routers.recommendations.storage.get_full_portfolio",
               return_value={"stocks": holdings, "watchlist": []}), \
         patch("routers.recommendations.recommendation.read_recommendations", return_value=[]), \
         patch("routers.recommendations._latest_snapshots",
               return_value={"MSFT": ({"price": float("nan"), "market": "US"}, None)}), \
         patch("routers.recommendations._usdkrw_rate", return_value=1300.0):
        resp = _client.get("/api/recommendations")
    assert resp.status_code == 200  # NaN price가 500을 안 냄
    holding = resp.json()["holdings"][0]
    assert holding["pnl_pct"] is None
    assert holding["weight_pct"] is None

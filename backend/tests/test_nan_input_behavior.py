"""S2 — 입력 가드 3표면 행동 테스트 (B3).

배경: raw JSON 본문의 NaN/Infinity 토큰은 pydantic v2 float 필드를 기본 통과한다
(`allow_inf_nan=True` 디폴트). 그래서 `POST /api/portfolio`·`PUT /api/portfolio/rebalance/targets`·
`POST /api/watchlist/{ticker}/promote` 세 표면이 무가드였다.

⚠️ 422 핀은 conftest의 client(=main.app)를 쓴다 — bare FastAPI()에는 main.py:272의
RequestValidationError sanitizing 핸들러가 없어 422 detail의 NaN echo가 500으로 터진다.
검증은 pydantic 단계에서 끝나므로(핸들러 도달 전) 거부 케이스는 DB 모킹이 불필요하다.
통과 케이스(rebalance targets의 null/정상값)만 핸들러까지 도달하므로 storage를 모킹한다.
"""
import pytest
from pydantic import ValidationError

from routers.portfolio import Stock
from routers.watchlist import PromotePayload


# --- (a) POST /api/portfolio: NaN quantity → 422, not 500 ---

def test_add_stock_nan_quantity_returns_422_not_500(client):
    body = '{"ticker": "AAPL", "name": "Apple", "quantity": NaN, "avg_cost": 1.0}'
    resp = client.post("/api/portfolio", content=body, headers={"Content-Type": "application/json"})
    assert resp.status_code == 422
    data = resp.json()  # 500이면 여기서 이미 아니거나 파싱 실패 — 파싱 성공 자체가 sanitize 핸들러 결합 확인
    assert "detail" in data


# --- (b) PUT /api/portfolio/rebalance/targets ---

def test_rebalance_targets_nan_rejected(client):
    resp = client.put(
        "/api/portfolio/rebalance/targets",
        content='{"AAPL": NaN}',
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 422


def test_rebalance_targets_infinity_rejected(client):
    resp = client.put(
        "/api/portfolio/rebalance/targets",
        content='{"AAPL": Infinity}',
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 422


def test_rebalance_targets_null_passes_validation(client, monkeypatch):
    from services import storage, cache as cache_svc
    monkeypatch.setattr(storage, "get_holdings", lambda uid: [{"ticker": "AAPL"}])
    monkeypatch.setattr(storage, "set_target_weights", lambda uid, targets: None)
    monkeypatch.setattr(cache_svc, "invalidate_rebalance", lambda uid: None)
    resp = client.put("/api/portfolio/rebalance/targets", json={"AAPL": None})
    assert resp.status_code == 200


def test_rebalance_targets_normal_value_passes_validation(client, monkeypatch):
    from services import storage, cache as cache_svc
    monkeypatch.setattr(storage, "get_holdings", lambda uid: [{"ticker": "AAPL"}])
    monkeypatch.setattr(storage, "set_target_weights", lambda uid, targets: None)
    monkeypatch.setattr(cache_svc, "invalidate_rebalance", lambda uid: None)
    resp = client.put("/api/portfolio/rebalance/targets", json={"AAPL": 12.5})
    assert resp.status_code == 200
    assert resp.json()["targets"] == {"AAPL": 12.5}


# --- (c) POST /api/watchlist/{ticker}/promote: Infinity quantity → 422 ---
# 수정 전에는 Field(gt=0)이 NaN은 막아도(NaN > 0 은 항상 False) +Infinity는 막지 못한다
# (inf > 0 은 True) — 이게 red-first의 핵심 케이스.

def test_promote_infinity_quantity_rejected(client):
    resp = client.post(
        "/api/watchlist/AAPL/promote",
        content='{"quantity": Infinity, "avg_cost": 1}',
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 422


# --- (d) 모델 단위 핀: 키 생략·명시적 null·정상값 통과 / NaN·Infinity 거부 ---

def test_stock_model_optional_fields_omitted_pass():
    s = Stock(ticker="AAPL", name="Apple", quantity=1.0, avg_cost=1.0)
    assert s.target_price is None
    assert s.stop_price is None


def test_stock_model_optional_fields_explicit_null_pass():
    s = Stock.model_validate({
        "ticker": "AAPL", "name": "Apple", "quantity": 1.0, "avg_cost": 1.0,
        "target_price": None, "stop_price": None,
    })
    assert s.target_price is None
    assert s.stop_price is None


def test_stock_model_normal_values_pass():
    s = Stock(ticker="AAPL", name="Apple", quantity=10.0, avg_cost=150.5, target_price=200.0, stop_price=100.0)
    assert s.quantity == 10.0
    assert s.target_price == 200.0


def test_stock_model_rejects_nan_and_infinity():
    with pytest.raises(ValidationError):
        Stock(ticker="AAPL", name="Apple", quantity=float("nan"), avg_cost=1.0)
    with pytest.raises(ValidationError):
        Stock(ticker="AAPL", name="Apple", quantity=1.0, avg_cost=1.0, target_price=float("inf"))


def test_promote_payload_normal_values_pass():
    p = PromotePayload(quantity=1.0, avg_cost=1.0)
    assert p.quantity == 1.0
    assert p.avg_cost == 1.0


def test_promote_payload_rejects_nan_and_infinity():
    with pytest.raises(ValidationError):
        PromotePayload(quantity=float("nan"), avg_cost=1.0)
    with pytest.raises(ValidationError):
        PromotePayload(quantity=float("inf"), avg_cost=1.0)

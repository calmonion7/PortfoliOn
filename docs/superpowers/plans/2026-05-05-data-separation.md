# 종목 데이터 / 개인 데이터 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `portfolio.json` 하나로 관리하던 데이터를 `stocks.json`(종목 리서치), `holdings.json`(보유 수량/평단가), `watchlist.json`(관심종목 ticker)으로 분리한다.

**Architecture:** storage.py의 `get_portfolio`/`save_portfolio`를 파일별 함수로 교체하고, 두 라우터(portfolio, watchlist)가 새 함수를 사용하도록 교체한다. API 응답 형태는 프론트엔드 변경 없이 유지한다. 마이그레이션 스크립트가 기존 데이터를 새 구조로 분리한다.

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, pytest, unittest.mock

---

## 파일 구조

| 파일 | 변경 내용 |
|---|---|
| `backend/services/storage.py` | `get_portfolio`/`save_portfolio` 제거, 6개 새 함수 + `get_full_portfolio` 추가 |
| `backend/routers/portfolio.py` | 새 storage 함수 사용하도록 전면 교체 |
| `backend/routers/watchlist.py` | 새 storage 함수 사용하도록 전면 교체 |
| `backend/tests/test_storage.py` | 새 storage 함수 테스트로 전면 교체 |
| `backend/tests/test_portfolio_router.py` | 새 mock 패턴으로 전면 교체 |
| `backend/tests/test_watchlist_router.py` | 새 mock 패턴으로 전면 교체 |
| `backend/migrate_portfolio.py` | 신규 생성 — 일회성 마이그레이션 스크립트 |
| `backend/data/stocks.json` | 신규 생성 (마이그레이션으로) |
| `backend/data/holdings.json` | 신규 생성 (마이그레이션으로) |
| `backend/data/watchlist.json` | 신규 생성 (마이그레이션으로) |

---

## Task 1: storage.py 교체 (TDD)

**Files:**
- Modify: `backend/tests/test_storage.py`
- Modify: `backend/services/storage.py`

- [ ] **Step 1: test_storage.py 전체를 새 테스트로 교체**

`backend/tests/test_storage.py` 전체 내용을 아래로 교체:

```python
import pytest
from pathlib import Path
from unittest.mock import patch


def test_get_stocks_returns_empty_when_file_missing():
    import services.storage as storage_mod
    original = storage_mod.DATA_DIR
    storage_mod.DATA_DIR = Path("/nonexistent_dir_that_does_not_exist")
    try:
        result = storage_mod.get_stocks()
    finally:
        storage_mod.DATA_DIR = original
    assert result == []


def test_save_and_load_stocks_roundtrip(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        stocks = [{"ticker": "NFLX", "name": "Netflix", "competitors": [], "moat": "", "growth_plan": ""}]
        storage_mod.save_stocks(stocks)
        loaded = storage_mod.get_stocks()
    assert loaded == stocks


def test_get_holdings_returns_empty_when_file_missing():
    import services.storage as storage_mod
    original = storage_mod.DATA_DIR
    storage_mod.DATA_DIR = Path("/nonexistent_dir_that_does_not_exist")
    try:
        result = storage_mod.get_holdings()
    finally:
        storage_mod.DATA_DIR = original
    assert result == []


def test_save_and_load_holdings_roundtrip(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        holdings = [{"ticker": "NFLX", "quantity": 10.0, "avg_cost": 85.59}]
        storage_mod.save_holdings(holdings)
        loaded = storage_mod.get_holdings()
    assert loaded == holdings


def test_get_watchlist_tickers_returns_empty_when_file_missing():
    import services.storage as storage_mod
    original = storage_mod.DATA_DIR
    storage_mod.DATA_DIR = Path("/nonexistent_dir_that_does_not_exist")
    try:
        result = storage_mod.get_watchlist_tickers()
    finally:
        storage_mod.DATA_DIR = original
    assert result == []


def test_save_and_load_watchlist_tickers_roundtrip(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        tickers = ["AAPL", "GOOG"]
        storage_mod.save_watchlist_tickers(tickers)
        loaded = storage_mod.get_watchlist_tickers()
    assert loaded == tickers


def test_get_full_portfolio_joins_holdings_and_watchlist(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        stocks = [
            {"ticker": "LLY", "name": "일라이 릴리", "competitors": ["NVO"], "moat": "Brand", "growth_plan": "GLP1"},
            {"ticker": "AVAV", "name": "에어로바이런먼트", "competitors": [], "moat": "", "growth_plan": ""},
        ]
        holdings = [{"ticker": "LLY", "quantity": 3.0, "avg_cost": 886.6}]
        tickers = ["AVAV"]
        storage_mod.save_stocks(stocks)
        storage_mod.save_holdings(holdings)
        storage_mod.save_watchlist_tickers(tickers)
        result = storage_mod.get_full_portfolio()
    assert len(result["stocks"]) == 1
    assert result["stocks"][0]["ticker"] == "LLY"
    assert result["stocks"][0]["quantity"] == 3.0
    assert result["stocks"][0]["avg_cost"] == 886.6
    assert result["stocks"][0]["moat"] == "Brand"
    assert len(result["watchlist"]) == 1
    assert result["watchlist"][0]["ticker"] == "AVAV"
    assert result["watchlist"][0]["name"] == "에어로바이런먼트"


def test_get_schedule_returns_default_when_file_missing():
    import services.storage as storage_mod
    original = storage_mod.DATA_DIR
    storage_mod.DATA_DIR = Path("/nonexistent_dir_that_does_not_exist")
    try:
        result = storage_mod.get_schedule()
    finally:
        storage_mod.DATA_DIR = original
    assert result["enabled"] is False
    assert result["time"] == "08:00"
    assert "mon" in result["days"]


def test_save_and_load_schedule_roundtrip(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        schedule = {"enabled": True, "time": "09:30", "days": ["mon", "fri"]}
        storage_mod.save_schedule(schedule)
        loaded = storage_mod.get_schedule()
    assert loaded == schedule
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```
cd backend && python -m pytest tests/test_storage.py -v
```

Expected: `AttributeError: module 'services.storage' has no attribute 'get_stocks'` 로 FAILED

- [ ] **Step 3: storage.py 전체를 새 구현으로 교체**

`backend/services/storage.py` 전체 내용을 아래로 교체:

```python
import json
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).parent.parent / "data"


def _read_json(filename: str) -> Any:
    path = DATA_DIR / filename
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(filename: str, data: Any) -> None:
    path = DATA_DIR / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_stocks() -> list[dict]:
    data = _read_json("stocks.json")
    return data.get("stocks", []) if data else []


def save_stocks(stocks: list[dict]) -> None:
    _write_json("stocks.json", {"stocks": stocks})


def get_holdings() -> list[dict]:
    data = _read_json("holdings.json")
    return data.get("holdings", []) if data else []


def save_holdings(holdings: list[dict]) -> None:
    _write_json("holdings.json", {"holdings": holdings})


def get_watchlist_tickers() -> list[str]:
    data = _read_json("watchlist.json")
    return data.get("watchlist", []) if data else []


def save_watchlist_tickers(tickers: list[str]) -> None:
    _write_json("watchlist.json", {"watchlist": tickers})


def get_full_portfolio() -> dict:
    stocks = get_stocks()
    holdings = get_holdings()
    watchlist_tickers = get_watchlist_tickers()
    stocks_by_ticker = {s["ticker"]: s for s in stocks}
    _fallback = lambda t: {"ticker": t, "name": t, "competitors": [], "moat": "", "growth_plan": ""}
    holding_stocks = [
        {**stocks_by_ticker.get(h["ticker"], _fallback(h["ticker"])),
         "quantity": h["quantity"], "avg_cost": h["avg_cost"]}
        for h in holdings
    ]
    watchlist_stocks = [
        stocks_by_ticker.get(t, _fallback(t))
        for t in watchlist_tickers
    ]
    return {"stocks": holding_stocks, "watchlist": watchlist_stocks}


def get_schedule() -> dict:
    data = _read_json("schedule.json")
    return data if data is not None else {
        "enabled": False,
        "time": "08:00",
        "days": ["mon", "tue", "wed", "thu", "fri"],
    }


def save_schedule(schedule: dict) -> None:
    _write_json("schedule.json", schedule)
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```
cd backend && python -m pytest tests/test_storage.py -v
```

Expected: `9 passed`

- [ ] **Step 5: 커밋**

```
git add backend/services/storage.py backend/tests/test_storage.py
git commit -m "refactor: split storage into stocks/holdings/watchlist functions"
```

---

## Task 2: portfolio 라우터 교체 (TDD)

**Files:**
- Modify: `backend/tests/test_portfolio_router.py`
- Modify: `backend/routers/portfolio.py`

- [ ] **Step 1: test_portfolio_router.py 전체를 새 테스트로 교체**

`backend/tests/test_portfolio_router.py` 전체 내용을 아래로 교체:

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.portfolio import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)

SAMPLE_STOCKS = [
    {"ticker": "NFLX", "name": "Netflix", "competitors": ["DIS"], "moat": "Content", "growth_plan": "Gaming"}
]
SAMPLE_HOLDINGS = [
    {"ticker": "NFLX", "quantity": 10, "avg_cost": 85.59}
]
SAMPLE_FULL = {
    "stocks": [{"ticker": "NFLX", "name": "Netflix", "quantity": 10, "avg_cost": 85.59,
                "competitors": ["DIS"], "moat": "Content", "growth_plan": "Gaming"}],
    "watchlist": []
}


def test_get_portfolio_returns_full_portfolio():
    with patch("routers.portfolio.storage.get_full_portfolio", return_value=SAMPLE_FULL):
        resp = client.get("/api/portfolio")
    assert resp.status_code == 200
    assert resp.json()["stocks"][0]["ticker"] == "NFLX"


def test_add_stock_saves_to_holdings_and_stocks():
    with patch("routers.portfolio.storage.get_holdings", return_value=[]), \
         patch("routers.portfolio.storage.get_stocks", return_value=[]), \
         patch("routers.portfolio.storage.save_stocks") as mock_save_stocks, \
         patch("routers.portfolio.storage.save_holdings") as mock_save_holdings:
        resp = client.post("/api/portfolio", json={
            "ticker": "NVDA", "name": "Nvidia", "quantity": 5, "avg_cost": 200.0,
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 201
    saved_holdings = mock_save_holdings.call_args[0][0]
    assert saved_holdings[0]["ticker"] == "NVDA"
    assert saved_holdings[0]["quantity"] == 5
    saved_stocks = mock_save_stocks.call_args[0][0]
    assert saved_stocks[0]["ticker"] == "NVDA"


def test_add_duplicate_ticker_returns_400():
    with patch("routers.portfolio.storage.get_holdings", return_value=SAMPLE_HOLDINGS):
        resp = client.post("/api/portfolio", json={
            "ticker": "NFLX", "name": "Netflix", "quantity": 5, "avg_cost": 90.0,
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 400


def test_update_stock_modifies_holdings_and_stocks():
    with patch("routers.portfolio.storage.get_holdings", return_value=list(SAMPLE_HOLDINGS)), \
         patch("routers.portfolio.storage.get_stocks", return_value=list(SAMPLE_STOCKS)), \
         patch("routers.portfolio.storage.save_holdings") as mock_save_holdings, \
         patch("routers.portfolio.storage.save_stocks") as mock_save_stocks:
        resp = client.put("/api/portfolio/NFLX", json={
            "ticker": "NFLX", "name": "Netflix", "quantity": 20, "avg_cost": 90.0,
            "competitors": ["DIS"], "moat": "Brand", "growth_plan": "Gaming"
        })
    assert resp.status_code == 200
    saved_holdings = mock_save_holdings.call_args[0][0]
    assert saved_holdings[0]["quantity"] == 20
    saved_stocks = mock_save_stocks.call_args[0][0]
    assert saved_stocks[0]["moat"] == "Brand"


def test_delete_stock_removes_from_holdings_and_stocks_when_not_in_watchlist():
    with patch("routers.portfolio.storage.get_holdings", return_value=list(SAMPLE_HOLDINGS)), \
         patch("routers.portfolio.storage.get_watchlist_tickers", return_value=[]), \
         patch("routers.portfolio.storage.get_stocks", return_value=list(SAMPLE_STOCKS)), \
         patch("routers.portfolio.storage.save_holdings") as mock_save_holdings, \
         patch("routers.portfolio.storage.save_stocks") as mock_save_stocks:
        resp = client.delete("/api/portfolio/NFLX")
    assert resp.status_code == 200
    assert mock_save_holdings.call_args[0][0] == []
    assert mock_save_stocks.call_args[0][0] == []


def test_delete_stock_keeps_stock_data_when_in_watchlist():
    with patch("routers.portfolio.storage.get_holdings", return_value=list(SAMPLE_HOLDINGS)), \
         patch("routers.portfolio.storage.get_watchlist_tickers", return_value=["NFLX"]), \
         patch("routers.portfolio.storage.save_holdings"), \
         patch("routers.portfolio.storage.save_stocks") as mock_save_stocks:
        resp = client.delete("/api/portfolio/NFLX")
    assert resp.status_code == 200
    mock_save_stocks.assert_not_called()


def test_delete_nonexistent_ticker_returns_404():
    with patch("routers.portfolio.storage.get_holdings", return_value=[]):
        resp = client.delete("/api/portfolio/FAKE")
    assert resp.status_code == 404
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```
cd backend && python -m pytest tests/test_portfolio_router.py -v
```

Expected: `AttributeError` 또는 assertion fail로 FAILED (router가 아직 `get_full_portfolio` 사용 안 함)

- [ ] **Step 3: routers/portfolio.py 전체를 새 구현으로 교체**

`backend/routers/portfolio.py` 전체 내용을 아래로 교체:

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
from services import storage

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


class Stock(BaseModel):
    ticker: str
    name: str
    quantity: float
    avg_cost: float
    competitors: List[str] = []
    moat: str = ""
    growth_plan: str = ""


@router.get("")
def get_portfolio():
    return storage.get_full_portfolio()


@router.post("", status_code=201)
def add_stock(stock: Stock):
    holdings = storage.get_holdings()
    if stock.ticker.upper() in [h["ticker"].upper() for h in holdings]:
        raise HTTPException(status_code=400, detail=f"{stock.ticker} already exists")

    stocks = storage.get_stocks()
    if stock.ticker.upper() not in [s["ticker"].upper() for s in stocks]:
        stocks.append({
            "ticker": stock.ticker.upper(),
            "name": stock.name,
            "competitors": stock.competitors,
            "moat": stock.moat,
            "growth_plan": stock.growth_plan,
        })
        storage.save_stocks(stocks)

    new_holding = {"ticker": stock.ticker.upper(), "quantity": stock.quantity, "avg_cost": stock.avg_cost}
    holdings.append(new_holding)
    storage.save_holdings(holdings)

    return {**new_holding, "name": stock.name, "competitors": stock.competitors,
            "moat": stock.moat, "growth_plan": stock.growth_plan}


@router.put("/{ticker}")
def update_stock(ticker: str, stock: Stock):
    holdings = storage.get_holdings()
    h_idx = next((i for i, h in enumerate(holdings) if h["ticker"].upper() == ticker.upper()), None)
    if h_idx is None:
        raise HTTPException(status_code=404, detail=f"{ticker} not found")

    holdings[h_idx] = {"ticker": ticker.upper(), "quantity": stock.quantity, "avg_cost": stock.avg_cost}
    storage.save_holdings(holdings)

    stocks = storage.get_stocks()
    s_idx = next((i for i, s in enumerate(stocks) if s["ticker"].upper() == ticker.upper()), None)
    if s_idx is not None:
        stocks[s_idx] = {
            "ticker": ticker.upper(), "name": stock.name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan,
        }
        storage.save_stocks(stocks)

    return {**holdings[h_idx], "name": stock.name, "competitors": stock.competitors,
            "moat": stock.moat, "growth_plan": stock.growth_plan}


@router.delete("/{ticker}")
def delete_stock(ticker: str):
    holdings = storage.get_holdings()
    upper = ticker.upper()
    filtered = [h for h in holdings if h["ticker"].upper() != upper]
    if len(filtered) == len(holdings):
        raise HTTPException(status_code=404, detail=f"{ticker} not found")
    storage.save_holdings(filtered)

    watchlist = storage.get_watchlist_tickers()
    if upper not in [t.upper() for t in watchlist]:
        stocks = storage.get_stocks()
        storage.save_stocks([s for s in stocks if s["ticker"].upper() != upper])

    return {"deleted": upper}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```
cd backend && python -m pytest tests/test_portfolio_router.py -v
```

Expected: `6 passed`

- [ ] **Step 5: 커밋**

```
git add backend/routers/portfolio.py backend/tests/test_portfolio_router.py
git commit -m "refactor: portfolio router uses split storage functions"
```

---

## Task 3: watchlist 라우터 교체 (TDD)

**Files:**
- Modify: `backend/tests/test_watchlist_router.py`
- Modify: `backend/routers/watchlist.py`

- [ ] **Step 1: test_watchlist_router.py 전체를 새 테스트로 교체**

`backend/tests/test_watchlist_router.py` 전체 내용을 아래로 교체:

```python
from copy import deepcopy
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.watchlist import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)

SAMPLE_STOCKS = [
    {"ticker": "NFLX", "name": "Netflix", "competitors": [], "moat": "", "growth_plan": ""},
    {"ticker": "NVDA", "name": "Nvidia", "competitors": [], "moat": "", "growth_plan": ""},
]
SAMPLE_HOLDINGS = [{"ticker": "NFLX", "quantity": 10, "avg_cost": 85.59}]
SAMPLE_WATCHLIST = ["NVDA"]


def test_get_watchlist_returns_items():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=SAMPLE_WATCHLIST), \
         patch("routers.watchlist.storage.get_stocks", return_value=SAMPLE_STOCKS):
        resp = client.get("/api/watchlist")
    assert resp.status_code == 200
    assert resp.json()[0]["ticker"] == "NVDA"
    assert resp.json()[0]["name"] == "Nvidia"


def test_add_watchlist_stock_saves_ticker_and_stock_data():
    with patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.get_watchlist_tickers", return_value=[]), \
         patch("routers.watchlist.storage.get_stocks", return_value=[]), \
         patch("routers.watchlist.storage.save_stocks") as mock_save_stocks, \
         patch("routers.watchlist.storage.save_watchlist_tickers") as mock_save_watchlist:
        resp = client.post("/api/watchlist", json={
            "ticker": "TSLA", "name": "Tesla",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 201
    saved_tickers = mock_save_watchlist.call_args[0][0]
    assert "TSLA" in saved_tickers
    saved_stocks = mock_save_stocks.call_args[0][0]
    assert saved_stocks[0]["ticker"] == "TSLA"


def test_add_duplicate_in_holdings_returns_400():
    with patch("routers.watchlist.storage.get_holdings", return_value=SAMPLE_HOLDINGS), \
         patch("routers.watchlist.storage.get_watchlist_tickers", return_value=[]):
        resp = client.post("/api/watchlist", json={
            "ticker": "NFLX", "name": "Netflix",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 400


def test_add_duplicate_in_watchlist_returns_400():
    with patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.get_watchlist_tickers", return_value=SAMPLE_WATCHLIST):
        resp = client.post("/api/watchlist", json={
            "ticker": "NVDA", "name": "Nvidia",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 400


def test_update_watchlist_stock_updates_stocks_json():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=["NVDA"]), \
         patch("routers.watchlist.storage.get_stocks", return_value=[
             {"ticker": "NVDA", "name": "Nvidia", "competitors": [], "moat": "", "growth_plan": ""}
         ]), \
         patch("routers.watchlist.storage.save_stocks") as mock_save_stocks:
        resp = client.put("/api/watchlist/NVDA", json={
            "ticker": "NVDA", "name": "Nvidia",
            "competitors": ["AMD"], "moat": "GPU dominance", "growth_plan": "AI chips"
        })
    assert resp.status_code == 200
    saved = mock_save_stocks.call_args[0][0]
    assert saved[0]["moat"] == "GPU dominance"


def test_delete_watchlist_removes_from_watchlist_and_stocks():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=["NVDA"]), \
         patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.get_stocks", return_value=[
             {"ticker": "NVDA", "name": "Nvidia", "competitors": [], "moat": "", "growth_plan": ""}
         ]), \
         patch("routers.watchlist.storage.save_watchlist_tickers") as mock_save_watchlist, \
         patch("routers.watchlist.storage.save_stocks") as mock_save_stocks:
        resp = client.delete("/api/watchlist/NVDA")
    assert resp.status_code == 200
    assert mock_save_watchlist.call_args[0][0] == []
    assert mock_save_stocks.call_args[0][0] == []


def test_delete_watchlist_keeps_stock_data_when_in_holdings():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=["NFLX"]), \
         patch("routers.watchlist.storage.get_holdings", return_value=SAMPLE_HOLDINGS), \
         patch("routers.watchlist.storage.save_watchlist_tickers"), \
         patch("routers.watchlist.storage.save_stocks") as mock_save_stocks:
        resp = client.delete("/api/watchlist/NFLX")
    assert resp.status_code == 200
    mock_save_stocks.assert_not_called()


def test_delete_nonexistent_returns_404():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=[]):
        resp = client.delete("/api/watchlist/FAKE")
    assert resp.status_code == 404


def test_promote_moves_ticker_to_holdings():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=["NVDA"]), \
         patch("routers.watchlist.storage.get_holdings", return_value=[]), \
         patch("routers.watchlist.storage.get_stocks", return_value=[
             {"ticker": "NVDA", "name": "Nvidia", "competitors": ["AMD"], "moat": "GPU", "growth_plan": "AI"}
         ]), \
         patch("routers.watchlist.storage.save_watchlist_tickers") as mock_save_watchlist, \
         patch("routers.watchlist.storage.save_holdings") as mock_save_holdings:
        resp = client.post("/api/watchlist/NVDA/promote",
                           json={"quantity": 5, "avg_cost": 200.0})
    assert resp.status_code == 200
    saved_watchlist = mock_save_watchlist.call_args[0][0]
    assert "NVDA" not in saved_watchlist
    saved_holdings = mock_save_holdings.call_args[0][0]
    assert saved_holdings[0]["ticker"] == "NVDA"
    assert saved_holdings[0]["quantity"] == 5
    assert saved_holdings[0]["avg_cost"] == 200.0
    assert resp.json()["moat"] == "GPU"


def test_promote_nonexistent_returns_404():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=[]):
        resp = client.post("/api/watchlist/FAKE/promote",
                           json={"quantity": 1, "avg_cost": 100.0})
    assert resp.status_code == 404


def test_promote_already_in_holdings_returns_400():
    with patch("routers.watchlist.storage.get_watchlist_tickers", return_value=["NVDA"]), \
         patch("routers.watchlist.storage.get_holdings", return_value=[
             {"ticker": "NVDA", "quantity": 1, "avg_cost": 100.0}
         ]):
        resp = client.post("/api/watchlist/NVDA/promote",
                           json={"quantity": 5, "avg_cost": 200.0})
    assert resp.status_code == 400
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```
cd backend && python -m pytest tests/test_watchlist_router.py -v
```

Expected: `AttributeError` 또는 assertion fail로 FAILED (router가 아직 `get_watchlist_tickers` 사용 안 함)

- [ ] **Step 3: routers/watchlist.py 전체를 새 구현으로 교체**

`backend/routers/watchlist.py` 전체 내용을 아래로 교체:

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List
from services import storage

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


class WatchlistStock(BaseModel):
    ticker: str
    name: str
    competitors: List[str] = []
    moat: str = ""
    growth_plan: str = ""


class PromotePayload(BaseModel):
    quantity: float = Field(..., gt=0)
    avg_cost: float = Field(..., gt=0)


@router.get("")
def get_watchlist():
    tickers = storage.get_watchlist_tickers()
    stocks_by_ticker = {s["ticker"]: s for s in storage.get_stocks()}
    return [
        stocks_by_ticker.get(t, {"ticker": t, "name": t, "competitors": [], "moat": "", "growth_plan": ""})
        for t in tickers
    ]


@router.post("", status_code=201)
def add_watchlist_stock(stock: WatchlistStock):
    holdings = storage.get_holdings()
    watchlist = storage.get_watchlist_tickers()
    all_tickers = [h["ticker"].upper() for h in holdings] + [t.upper() for t in watchlist]
    if stock.ticker.upper() in all_tickers:
        raise HTTPException(status_code=400, detail=f"{stock.ticker} already exists")

    stocks = storage.get_stocks()
    if stock.ticker.upper() not in [s["ticker"].upper() for s in stocks]:
        stocks.append({
            "ticker": stock.ticker.upper(), "name": stock.name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan,
        })
        storage.save_stocks(stocks)

    watchlist.append(stock.ticker.upper())
    storage.save_watchlist_tickers(watchlist)

    return {"ticker": stock.ticker.upper(), "name": stock.name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan}


@router.put("/{ticker}")
def update_watchlist_stock(ticker: str, stock: WatchlistStock):
    watchlist = storage.get_watchlist_tickers()
    if ticker.upper() not in [t.upper() for t in watchlist]:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in watchlist")

    stocks = storage.get_stocks()
    idx = next((i for i, s in enumerate(stocks) if s["ticker"].upper() == ticker.upper()), None)
    if idx is not None:
        stocks[idx] = {
            "ticker": ticker.upper(), "name": stock.name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan,
        }
        storage.save_stocks(stocks)

    return {"ticker": ticker.upper(), "name": stock.name,
            "competitors": stock.competitors, "moat": stock.moat, "growth_plan": stock.growth_plan}


@router.delete("/{ticker}")
def delete_watchlist_stock(ticker: str):
    upper = ticker.upper()
    watchlist = storage.get_watchlist_tickers()
    if upper not in [t.upper() for t in watchlist]:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in watchlist")

    storage.save_watchlist_tickers([t for t in watchlist if t.upper() != upper])

    holdings = storage.get_holdings()
    if upper not in [h["ticker"].upper() for h in holdings]:
        stocks = storage.get_stocks()
        storage.save_stocks([s for s in stocks if s["ticker"].upper() != upper])

    return {"deleted": upper}


@router.post("/{ticker}/promote")
def promote_to_holdings(ticker: str, payload: PromotePayload):
    upper = ticker.upper()
    watchlist = storage.get_watchlist_tickers()
    if upper not in [t.upper() for t in watchlist]:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in watchlist")

    holdings = storage.get_holdings()
    if upper in [h["ticker"].upper() for h in holdings]:
        raise HTTPException(status_code=400, detail=f"{ticker} already exists in holdings")

    storage.save_watchlist_tickers([t for t in watchlist if t.upper() != upper])

    new_holding = {"ticker": upper, "quantity": payload.quantity, "avg_cost": payload.avg_cost}
    holdings.append(new_holding)
    storage.save_holdings(holdings)

    stocks = storage.get_stocks()
    stock_data = next(
        (s for s in stocks if s["ticker"].upper() == upper),
        {"ticker": upper, "name": upper, "competitors": [], "moat": "", "growth_plan": ""}
    )
    return {**stock_data, "quantity": payload.quantity, "avg_cost": payload.avg_cost}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```
cd backend && python -m pytest tests/test_watchlist_router.py -v
```

Expected: `11 passed`

- [ ] **Step 5: 전체 테스트 실행 — 회귀 없음 확인**

```
cd backend && python -m pytest -v
```

Expected: `37 passed` (storage +5, watchlist +1로 기존 31에서 증가)

- [ ] **Step 6: 커밋**

```
git add backend/routers/watchlist.py backend/tests/test_watchlist_router.py
git commit -m "refactor: watchlist router uses split storage functions"
```

---

## Task 4: 마이그레이션 스크립트 작성 및 실행

**Files:**
- Create: `backend/migrate_portfolio.py`

- [ ] **Step 1: migrate_portfolio.py 생성**

`backend/migrate_portfolio.py`를 아래 내용으로 생성:

```python
import json
import shutil
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"


def migrate():
    portfolio_path = DATA_DIR / "portfolio.json"
    if not portfolio_path.exists():
        print("portfolio.json not found — nothing to migrate.")
        return

    with open(portfolio_path, "r", encoding="utf-8") as f:
        portfolio = json.load(f)

    old_stocks = portfolio.get("stocks", [])
    old_watchlist = portfolio.get("watchlist", [])

    stocks = []
    for s in old_stocks:
        stocks.append({
            "ticker": s["ticker"],
            "name": s.get("name", s["ticker"]),
            "competitors": s.get("competitors", []),
            "moat": s.get("moat", ""),
            "growth_plan": s.get("growth_plan", ""),
        })
    for w in old_watchlist:
        stocks.append({
            "ticker": w["ticker"],
            "name": w.get("name", w["ticker"]),
            "competitors": w.get("competitors", []),
            "moat": w.get("moat", ""),
            "growth_plan": w.get("growth_plan", ""),
        })

    holdings = [
        {"ticker": s["ticker"], "quantity": s["quantity"], "avg_cost": s["avg_cost"]}
        for s in old_stocks
    ]

    watchlist_tickers = [w["ticker"] for w in old_watchlist]

    def write(filename, data):
        with open(DATA_DIR / filename, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    write("stocks.json", {"stocks": stocks})
    write("holdings.json", {"holdings": holdings})
    write("watchlist.json", {"watchlist": watchlist_tickers})

    shutil.copy(portfolio_path, DATA_DIR / "portfolio.json.bak")
    portfolio_path.unlink()

    print("Migration complete.")
    print(f"  stocks.json    : {len(stocks)} 종목")
    print(f"  holdings.json  : {len(holdings)} 보유종목")
    print(f"  watchlist.json : {len(watchlist_tickers)} 관심종목")
    print(f"  portfolio.json.bak : 백업 생성")


if __name__ == "__main__":
    migrate()
```

- [ ] **Step 2: 마이그레이션 실행**

```
cd backend && python migrate_portfolio.py
```

Expected output:
```
Migration complete.
  stocks.json    : 10 종목
  holdings.json  : 4 보유종목
  watchlist.json : 6 관심종목
  portfolio.json.bak : 백업 생성
```

- [ ] **Step 3: 생성된 파일 내용 확인**

```
cd backend && python -c "import json; print(json.dumps(json.load(open('data/stocks.json')), ensure_ascii=False, indent=2))"
cd backend && python -c "import json; print(json.dumps(json.load(open('data/holdings.json')), ensure_ascii=False, indent=2))"
cd backend && python -c "import json; print(json.dumps(json.load(open('data/watchlist.json')), ensure_ascii=False, indent=2))"
```

Expected: stocks.json에 10개 종목, holdings.json에 4개 보유 (LLY/TSLA/LHX/PLTR), watchlist.json에 6개 ticker

- [ ] **Step 4: 전체 테스트 — 마이그레이션 후에도 통과 확인**

```
cd backend && python -m pytest -v
```

Expected: `31 passed`

- [ ] **Step 5: 커밋**

```
git add backend/migrate_portfolio.py backend/data/stocks.json backend/data/holdings.json backend/data/watchlist.json
git commit -m "feat: migrate portfolio data to stocks/holdings/watchlist files"
```

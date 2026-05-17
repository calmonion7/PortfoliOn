# External API — Stock List & AI Enrich Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 외부 시스템(Claude Cowork)이 종목 목록을 조회하고 Claude 생성 분석(해자·성장계획·공시분석)을 저장할 수 있는 REST API를 추가한다.

**Architecture:** 신규 `routers/stocks.py` 파일에 외부용 엔드포인트 3개를 구현하고 `storage.enrich_stock()`으로 stocks.json을 업데이트한다. `recent_disclosures` 필드를 스키마에 추가하고 report_generator `_section6()`에서 활용한다.

**Tech Stack:** FastAPI, Pydantic v2, pytest + unittest.mock

---

## File Structure

| 파일 | 역할 |
|---|---|
| `backend/routers/stocks.py` | 신규 — GET /api/stocks, PUT enrich 2개 |
| `backend/main.py` | stocks 라우터 등록 |
| `backend/services/storage.py` | `enrich_stock()` 함수 추가, `_fallback()` 업데이트 |
| `backend/services/report_generator.py` | `_section6()`에 recent_disclosures 파라미터 추가 |
| `backend/data/stocks.json` | 모든 항목에 `recent_disclosures: ""` 필드 추가 |
| `backend/tests/test_stocks_router.py` | 신규 — 라우터 테스트 |
| `backend/tests/test_storage.py` | `enrich_stock()` 테스트 추가 |

---

## Task 1: `storage.enrich_stock()` 추가 & `_fallback()` 업데이트

**Files:**
- Modify: `backend/services/storage.py`
- Test: `backend/tests/test_storage.py`

- [ ] **Step 1: 테스트 작성 (실패 확인용)**

`backend/tests/test_storage.py` 끝에 추가:

```python
def test_enrich_stock_updates_existing_fields(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        storage_mod.save_stocks([
            {"ticker": "LLY", "name": "일라이 릴리", "competitors": [], "moat": "", "growth_plan": "", "recent_disclosures": ""}
        ])
        storage_mod.save_holdings([{"ticker": "LLY", "quantity": 3.0, "avg_cost": 886.6}])
        storage_mod.save_watchlist_tickers([])
        result = storage_mod.enrich_stock("LLY", {"moat": "특허 포트폴리오", "growth_plan": "GLP 확장"})
        loaded = storage_mod.get_stocks()
    assert result is True
    assert loaded[0]["moat"] == "특허 포트폴리오"
    assert loaded[0]["growth_plan"] == "GLP 확장"


def test_enrich_stock_returns_false_when_ticker_not_in_any_list(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        storage_mod.save_stocks([])
        storage_mod.save_holdings([])
        storage_mod.save_watchlist_tickers([])
        result = storage_mod.enrich_stock("FAKE", {"moat": "x"})
    assert result is False


def test_enrich_stock_creates_entry_when_in_watchlist_but_not_in_stocks(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        storage_mod.save_stocks([])
        storage_mod.save_holdings([])
        storage_mod.save_watchlist_tickers(["NVDA"])
        result = storage_mod.enrich_stock("NVDA", {"recent_disclosures": "Q1 호실적"})
        loaded = storage_mod.get_stocks()
    assert result is True
    assert loaded[0]["ticker"] == "NVDA"
    assert loaded[0]["recent_disclosures"] == "Q1 호실적"


def test_enrich_stock_case_insensitive(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        storage_mod.save_stocks([
            {"ticker": "AAPL", "name": "Apple", "competitors": [], "moat": "", "growth_plan": "", "recent_disclosures": ""}
        ])
        storage_mod.save_holdings([{"ticker": "AAPL", "quantity": 1, "avg_cost": 100.0}])
        storage_mod.save_watchlist_tickers([])
        result = storage_mod.enrich_stock("aapl", {"moat": "생태계"})
        loaded = storage_mod.get_stocks()
    assert result is True
    assert loaded[0]["moat"] == "생태계"
```

- [ ] **Step 2: 테스트 실패 확인**

```
cd backend && pytest tests/test_storage.py::test_enrich_stock_updates_existing_fields -v
```

Expected: `FAILED` — `AttributeError: module 'services.storage' has no attribute 'enrich_stock'`

- [ ] **Step 3: `storage.py` 구현**

`backend/services/storage.py`에서 `_fallback()` 수정 및 `enrich_stock()` 추가:

`get_full_portfolio()` 내부의 `_fallback` 함수를:
```python
    def _fallback(t: str) -> dict:
        return {"ticker": t, "name": t, "competitors": [], "moat": "", "growth_plan": ""}
```
다음으로 교체:
```python
    def _fallback(t: str) -> dict:
        return {"ticker": t, "name": t, "competitors": [], "moat": "", "growth_plan": "", "recent_disclosures": ""}
```

파일 끝(save_schedule 다음)에 추가:

```python
def enrich_stock(ticker: str, fields: dict) -> bool:
    """moat/growth_plan/recent_disclosures를 ticker의 stocks.json 항목에 저장.
    ticker가 holdings 또는 watchlist에 없으면 False 반환."""
    upper = ticker.upper()
    holdings = get_holdings()
    watchlist = get_watchlist_tickers()
    all_tickers = {h["ticker"].upper() for h in holdings} | {t.upper() for t in watchlist}
    if upper not in all_tickers:
        return False
    stocks = get_stocks()
    idx = next((i for i, s in enumerate(stocks) if s["ticker"].upper() == upper), None)
    if idx is not None:
        for k, v in fields.items():
            stocks[idx][k] = v
    else:
        entry = {"ticker": upper, "name": upper, "competitors": [],
                 "moat": "", "growth_plan": "", "recent_disclosures": ""}
        entry.update(fields)
        stocks.append(entry)
    save_stocks(stocks)
    return True
```

- [ ] **Step 4: 테스트 통과 확인**

```
cd backend && pytest tests/test_storage.py -v -k "enrich"
```

Expected: 4개 모두 PASSED

- [ ] **Step 5: 커밋**

```bash
git add backend/services/storage.py backend/tests/test_storage.py
git commit -m "feat: add enrich_stock() to storage and recent_disclosures to fallback"
```

---

## Task 2: `stocks.json` 데이터 마이그레이션

**Files:**
- Modify: `backend/data/stocks.json`

- [ ] **Step 1: stocks.json의 모든 항목에 `recent_disclosures` 추가**

`backend/data/stocks.json`을 열어 `"stocks"` 배열의 각 객체에 다음 필드를 추가:
```json
"recent_disclosures": ""
```

기존 항목 예시 (변경 전):
```json
{
  "ticker": "LLY",
  "name": "일라이 릴리",
  "competitors": ["NVO"],
  "moat": "",
  "growth_plan": ""
}
```

변경 후:
```json
{
  "ticker": "LLY",
  "name": "일라이 릴리",
  "competitors": ["NVO"],
  "moat": "",
  "growth_plan": "",
  "recent_disclosures": ""
}
```

모든 종목(watchlist 포함) 동일하게 적용.

- [ ] **Step 2: JSON 유효성 확인**

```
cd backend && python -c "import json; json.load(open('data/stocks.json', encoding='utf-8')); print('OK')"
```

Expected: `OK`

- [ ] **Step 3: 커밋**

```bash
git add backend/data/stocks.json
git commit -m "feat: add recent_disclosures field to all stocks.json entries"
```

---

## Task 3: `routers/stocks.py` 신규 생성

**Files:**
- Create: `backend/routers/stocks.py`
- Create: `backend/tests/test_stocks_router.py`

- [ ] **Step 1: 테스트 파일 작성**

`backend/tests/test_stocks_router.py` 신규 생성:

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.stocks import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)

SAMPLE_PORTFOLIO = {
    "stocks": [
        {"ticker": "LLY", "name": "일라이 릴리", "quantity": 3.0, "avg_cost": 886.6,
         "competitors": ["NVO"], "moat": "", "growth_plan": "", "recent_disclosures": ""}
    ],
    "watchlist": [
        {"ticker": "AVAV", "name": "에어로바이런먼트", "competitors": [], "moat": "", "growth_plan": "", "recent_disclosures": ""}
    ],
}


def test_get_stocks_returns_flat_list_with_type():
    with patch("routers.stocks.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO):
        resp = client.get("/api/stocks")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    holding = next(s for s in data if s["ticker"] == "LLY")
    watchlist = next(s for s in data if s["ticker"] == "AVAV")
    assert holding["type"] == "holding"
    assert watchlist["type"] == "watchlist"
    assert holding["name"] == "일라이 릴리"


def test_enrich_single_stock_returns_updated_fields():
    with patch("routers.stocks.storage.enrich_stock", return_value=True):
        resp = client.put("/api/stocks/LLY/enrich", json={
            "moat": "특허 포트폴리오",
            "growth_plan": "GLP 확장",
        })
    assert resp.status_code == 200
    body = resp.json()
    assert body["ticker"] == "LLY"
    assert set(body["updated"]) == {"moat", "growth_plan"}


def test_enrich_single_stock_returns_404_when_not_found():
    with patch("routers.stocks.storage.enrich_stock", return_value=False):
        resp = client.put("/api/stocks/FAKE/enrich", json={"moat": "x"})
    assert resp.status_code == 404


def test_enrich_single_stock_returns_400_when_no_fields():
    resp = client.put("/api/stocks/LLY/enrich", json={})
    assert resp.status_code == 400


def test_enrich_batch_returns_updated_and_not_found():
    def mock_enrich(ticker, fields):
        return ticker.upper() != "FAKE"

    with patch("routers.stocks.storage.enrich_stock", side_effect=mock_enrich):
        resp = client.put("/api/stocks/enrich/batch", json=[
            {"ticker": "LLY", "moat": "특허"},
            {"ticker": "FAKE", "moat": "x"},
        ])
    assert resp.status_code == 200
    body = resp.json()
    assert "LLY" in body["updated"]
    assert "FAKE" in body["not_found"]


def test_enrich_batch_returns_400_when_empty():
    resp = client.put("/api/stocks/enrich/batch", json=[])
    assert resp.status_code == 400
```

- [ ] **Step 2: 테스트 실패 확인**

```
cd backend && pytest tests/test_stocks_router.py -v
```

Expected: `ImportError` 또는 `ModuleNotFoundError` — `routers.stocks` 미존재

- [ ] **Step 3: `routers/stocks.py` 구현**

`backend/routers/stocks.py` 신규 생성:

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from services import storage

router = APIRouter(prefix="/api/stocks", tags=["stocks"])


class EnrichBody(BaseModel):
    moat: Optional[str] = None
    growth_plan: Optional[str] = None
    recent_disclosures: Optional[str] = None


class BatchEnrichItem(BaseModel):
    ticker: str
    moat: Optional[str] = None
    growth_plan: Optional[str] = None
    recent_disclosures: Optional[str] = None


@router.get("")
def get_stocks():
    portfolio = storage.get_full_portfolio()
    result = []
    for s in portfolio["stocks"]:
        result.append({"ticker": s["ticker"], "name": s.get("name", s["ticker"]), "type": "holding"})
    for s in portfolio["watchlist"]:
        result.append({"ticker": s["ticker"], "name": s.get("name", s["ticker"]), "type": "watchlist"})
    return result


@router.put("/enrich/batch")
def enrich_batch(items: List[BatchEnrichItem]):
    if not items:
        raise HTTPException(status_code=400, detail="No items provided")
    updated, not_found = [], []
    for item in items:
        fields = {k: v for k, v in item.model_dump().items() if k != "ticker" and v is not None}
        if not fields:
            continue
        ok = storage.enrich_stock(item.ticker, fields)
        (updated if ok else not_found).append(item.ticker.upper())
    return {"updated": updated, "not_found": not_found}


@router.put("/{ticker}/enrich")
def enrich_single(ticker: str, body: EnrichBody):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided")
    ok = storage.enrich_stock(ticker, fields)
    if not ok:
        raise HTTPException(status_code=404, detail="Ticker not found")
    return {"ticker": ticker.upper(), "updated": list(fields.keys())}
```

- [ ] **Step 4: 테스트 통과 확인**

```
cd backend && pytest tests/test_stocks_router.py -v
```

Expected: 6개 모두 PASSED

- [ ] **Step 5: 커밋**

```bash
git add backend/routers/stocks.py backend/tests/test_stocks_router.py
git commit -m "feat: add stocks router with GET /api/stocks and PUT enrich endpoints"
```

---

## Task 4: `main.py`에 stocks 라우터 등록

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: main.py 수정**

`backend/main.py`에서:
```python
from routers import portfolio, report, watchlist
```
를:
```python
from routers import portfolio, report, watchlist, stocks
```
로 교체.

그리고:
```python
app.include_router(portfolio.router)
app.include_router(report.router)
app.include_router(watchlist.router)
```
를:
```python
app.include_router(portfolio.router)
app.include_router(report.router)
app.include_router(watchlist.router)
app.include_router(stocks.router)
```
로 교체.

- [ ] **Step 2: 서버 기동 확인**

```
cd backend && python -c "from main import app; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: 커밋**

```bash
git add backend/main.py
git commit -m "feat: register stocks router in main.py"
```

---

## Task 5: `report_generator.py` — `_section6()`에 `recent_disclosures` 반영

**Files:**
- Modify: `backend/services/report_generator.py`
- Test: `backend/tests/test_report_generator.py`

- [ ] **Step 1: 테스트 추가**

`backend/tests/test_report_generator.py`에서 `SAMPLE_STOCK` 딕셔너리에 `recent_disclosures` 추가:

```python
SAMPLE_STOCK = {
    "ticker": "TEST",
    "name": "Test Corp",
    "quantity": 10,
    "avg_cost": 100.0,
    "competitors": [],
    "moat": "Strong brand",
    "growth_plan": "Expand to Asia",
    "recent_disclosures": "Q1 실적 호조",
}
```

그리고 파일 끝에 새 테스트 추가:

```python
def test_section6_includes_recent_disclosures_when_provided():
    from services.report_generator import _section6
    quote = {"prev_close": 118.0, "daily_change": "+1.69%"}
    news = [{"title": "Test news", "link": "http://x.com", "publisher": "Reuters", "published_at": "2026-05-07"}]
    result = _section6(quote, news, recent_disclosures="Q1 실적 호조: EPS 예상치 상회")
    assert "AI 분석" in result
    assert "Q1 실적 호조" in result
    assert "Test news" in result


def test_section6_skips_ai_section_when_empty():
    from services.report_generator import _section6
    quote = {}
    result = _section6(quote, [], recent_disclosures="")
    assert "AI 분석" not in result
```

- [ ] **Step 2: 테스트 실패 확인**

```
cd backend && pytest tests/test_report_generator.py::test_section6_includes_recent_disclosures_when_provided -v
```

Expected: `FAILED` — `TypeError: _section6() got an unexpected keyword argument 'recent_disclosures'`

- [ ] **Step 3: `_section6()` 시그니처 & 본문 수정**

`backend/services/report_generator.py`에서 `_section6` 함수:

```python
def _section6(quote: dict, news: list[dict]) -> str:
    lines = ["## 6️⃣ 최근 공시 & 주가 영향\n"]
    if quote.get("prev_close"):
        lines.append(f"**어제 종가:** ${quote['prev_close']:.2f}  |  **전일 대비:** {quote.get('daily_change', 'N/A')}\n")
    lines.append("### 최근 뉴스\n")
    if not news:
        lines.append("_(뉴스 없음)_")
    else:
        for item in news:
            lines.append(f"- [{item['title']}]({item['link']}) — {item['publisher']} ({item['published_at']})")
    return "\n".join(lines)
```

를 다음으로 교체:

```python
def _section6(quote: dict, news: list[dict], recent_disclosures: str = "") -> str:
    lines = ["## 6️⃣ 최근 공시 & 주가 영향\n"]
    if quote.get("prev_close"):
        lines.append(f"**어제 종가:** ${quote['prev_close']:.2f}  |  **전일 대비:** {quote.get('daily_change', 'N/A')}\n")
    if recent_disclosures:
        lines += ["### AI 분석\n", recent_disclosures, ""]
    lines.append("### 최근 뉴스\n")
    if not news:
        lines.append("_(뉴스 없음)_")
    else:
        for item in news:
            lines.append(f"- [{item['title']}]({item['link']}) — {item['publisher']} ({item['published_at']})")
    return "\n".join(lines)
```

그리고 같은 파일의 `generate_report()` 함수 내 sections 배열에서:
```python
        _section6(quote, news),
```
를:
```python
        _section6(quote, news, stock.get("recent_disclosures", "")),
```
로 교체.

- [ ] **Step 4: 테스트 통과 확인**

```
cd backend && pytest tests/test_report_generator.py -v
```

Expected: 모두 PASSED

- [ ] **Step 5: 커밋**

```bash
git add backend/services/report_generator.py backend/tests/test_report_generator.py
git commit -m "feat: show AI-generated recent_disclosures in report section 6"
```

---

## Task 6: 전체 테스트 통과 확인

- [ ] **Step 1: 전체 테스트 실행**

```
cd backend && pytest -v
```

Expected: 모두 PASSED (기존 테스트 포함)

- [ ] **Step 2: 최종 커밋 (변경사항이 있을 경우만)**

변경사항이 없으면 스킵.

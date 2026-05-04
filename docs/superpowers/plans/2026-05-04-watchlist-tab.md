# Watchlist Tab Feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portfolio 화면에 보유종목/관심종목 탭을 추가하고, 관심종목을 보유종목으로 전환하는 기능을 구현한다.

**Architecture:** `portfolio.json`에 `watchlist` 배열 키를 추가. 신규 `/api/watchlist` CRUD 라우터 + `promote` 엔드포인트. 프론트엔드 Portfolio 페이지에 탭 UI, StockModal mode 분기, PromoteModal 신규 컴포넌트.

**Tech Stack:** Python 3.11, FastAPI, Pydantic; React 18, axios

---

## File Map

| 파일 | 변경 |
|---|---|
| `backend/services/storage.py` | `get_portfolio()` watchlist 기본값 추가 |
| `backend/routers/watchlist.py` | 신규 — watchlist CRUD + promote |
| `backend/tests/test_watchlist_router.py` | 신규 — watchlist 엔드포인트 테스트 |
| `backend/routers/report.py` | `generate_one` watchlist 조회 추가 |
| `backend/main.py` | watchlist router 마운트 |
| `frontend/src/components/StockModal.jsx` | `mode` prop 분기 |
| `frontend/src/components/PromoteModal.jsx` | 신규 — 전환 모달 |
| `frontend/src/pages/Portfolio.jsx` | 탭 UI + watchlist 로직 |

---

## Task 1: Storage watchlist 기본값

**Files:**
- Modify: `backend/services/storage.py`

- [ ] **Step 1: `get_portfolio()` 수정**

`backend/services/storage.py`의 `get_portfolio` 함수를 다음으로 교체:

```python
def get_portfolio() -> dict:
    data = _read_json("portfolio.json")
    if data is None:
        return {"stocks": [], "watchlist": []}
    if "watchlist" not in data:
        data["watchlist"] = []
    return data
```

- [ ] **Step 2: 기존 테스트 통과 확인**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -m pytest tests/test_storage.py -v
```

Expected: 4 tests PASSED.

- [ ] **Step 3: Commit**

```powershell
git add backend/services/storage.py
git commit -m "feat: add watchlist default key to get_portfolio"
```

---

## Task 2: Watchlist 라우터 + 테스트

**Files:**
- Create: `backend/routers/watchlist.py`
- Create: `backend/tests/test_watchlist_router.py`

- [ ] **Step 1: 테스트 파일 작성**

`backend/tests/test_watchlist_router.py`:

```python
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.watchlist import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)

SAMPLE_PORTFOLIO = {
    "stocks": [
        {"ticker": "NFLX", "name": "Netflix", "quantity": 10, "avg_cost": 85.59,
         "competitors": [], "moat": "", "growth_plan": ""}
    ],
    "watchlist": [
        {"ticker": "NVDA", "name": "Nvidia", "competitors": [], "moat": "", "growth_plan": ""}
    ]
}

def test_get_watchlist_returns_items():
    with patch("routers.watchlist.storage.get_portfolio", return_value=SAMPLE_PORTFOLIO):
        resp = client.get("/api/watchlist")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["ticker"] == "NVDA"

def test_add_watchlist_stock():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("routers.watchlist.storage.get_portfolio", return_value=portfolio), \
         patch("routers.watchlist.storage.save_portfolio") as mock_save:
        resp = client.post("/api/watchlist", json={
            "ticker": "TSLA", "name": "Tesla",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 201
    saved = mock_save.call_args[0][0]
    assert saved["watchlist"][0]["ticker"] == "TSLA"

def test_add_duplicate_in_stocks_returns_400():
    with patch("routers.watchlist.storage.get_portfolio", return_value=SAMPLE_PORTFOLIO):
        resp = client.post("/api/watchlist", json={
            "ticker": "NFLX", "name": "Netflix",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 400

def test_add_duplicate_in_watchlist_returns_400():
    with patch("routers.watchlist.storage.get_portfolio", return_value=SAMPLE_PORTFOLIO):
        resp = client.post("/api/watchlist", json={
            "ticker": "NVDA", "name": "Nvidia",
            "competitors": [], "moat": "", "growth_plan": ""
        })
    assert resp.status_code == 400

def test_update_watchlist_stock():
    portfolio = {"stocks": [], "watchlist": [
        {"ticker": "NVDA", "name": "Nvidia", "competitors": [], "moat": "", "growth_plan": ""}
    ]}
    with patch("routers.watchlist.storage.get_portfolio", return_value=portfolio), \
         patch("routers.watchlist.storage.save_portfolio") as mock_save:
        resp = client.put("/api/watchlist/NVDA", json={
            "ticker": "NVDA", "name": "Nvidia",
            "competitors": ["AMD"], "moat": "GPU dominance", "growth_plan": "AI chips"
        })
    assert resp.status_code == 200
    saved = mock_save.call_args[0][0]
    assert saved["watchlist"][0]["moat"] == "GPU dominance"

def test_delete_watchlist_stock():
    portfolio = {"stocks": [], "watchlist": [
        {"ticker": "NVDA", "name": "Nvidia", "competitors": [], "moat": "", "growth_plan": ""}
    ]}
    with patch("routers.watchlist.storage.get_portfolio", return_value=portfolio), \
         patch("routers.watchlist.storage.save_portfolio") as mock_save:
        resp = client.delete("/api/watchlist/NVDA")
    assert resp.status_code == 200
    saved = mock_save.call_args[0][0]
    assert saved["watchlist"] == []

def test_delete_nonexistent_returns_404():
    with patch("routers.watchlist.storage.get_portfolio",
               return_value={"stocks": [], "watchlist": []}):
        resp = client.delete("/api/watchlist/FAKE")
    assert resp.status_code == 404

def test_promote_moves_to_stocks():
    portfolio = {"stocks": [], "watchlist": [
        {"ticker": "NVDA", "name": "Nvidia", "competitors": ["AMD"], "moat": "GPU", "growth_plan": "AI"}
    ]}
    with patch("routers.watchlist.storage.get_portfolio", return_value=portfolio), \
         patch("routers.watchlist.storage.save_portfolio") as mock_save:
        resp = client.post("/api/watchlist/NVDA/promote",
                           json={"quantity": 5, "avg_cost": 200.0})
    assert resp.status_code == 200
    saved = mock_save.call_args[0][0]
    assert saved["watchlist"] == []
    assert saved["stocks"][0]["ticker"] == "NVDA"
    assert saved["stocks"][0]["quantity"] == 5
    assert saved["stocks"][0]["avg_cost"] == 200.0
    assert saved["stocks"][0]["moat"] == "GPU"

def test_promote_nonexistent_returns_404():
    with patch("routers.watchlist.storage.get_portfolio",
               return_value={"stocks": [], "watchlist": []}):
        resp = client.post("/api/watchlist/FAKE/promote",
                           json={"quantity": 1, "avg_cost": 100.0})
    assert resp.status_code == 404

def test_promote_already_in_stocks_returns_400():
    portfolio = {
        "stocks": [{"ticker": "NVDA", "name": "Nvidia", "quantity": 1, "avg_cost": 100.0,
                    "competitors": [], "moat": "", "growth_plan": ""}],
        "watchlist": [{"ticker": "NVDA", "name": "Nvidia", "competitors": [], "moat": "", "growth_plan": ""}]
    }
    with patch("routers.watchlist.storage.get_portfolio", return_value=portfolio):
        resp = client.post("/api/watchlist/NVDA/promote",
                           json={"quantity": 5, "avg_cost": 200.0})
    assert resp.status_code == 400
```

- [ ] **Step 2: 테스트 실패 확인**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -m pytest tests/test_watchlist_router.py -v
```

Expected: ImportError for `routers.watchlist`.

- [ ] **Step 3: `routers/watchlist.py` 구현**

`backend/routers/watchlist.py` 생성:

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
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
    quantity: float
    avg_cost: float


def _all_tickers(portfolio: dict) -> list[str]:
    return [s["ticker"].upper() for s in portfolio["stocks"]] + \
           [s["ticker"].upper() for s in portfolio["watchlist"]]


@router.get("")
def get_watchlist():
    return storage.get_portfolio()["watchlist"]


@router.post("", status_code=201)
def add_watchlist_stock(stock: WatchlistStock):
    portfolio = storage.get_portfolio()
    if stock.ticker.upper() in _all_tickers(portfolio):
        raise HTTPException(status_code=400, detail=f"{stock.ticker} already exists")
    portfolio["watchlist"].append({**stock.model_dump(), "ticker": stock.ticker.upper()})
    storage.save_portfolio(portfolio)
    return portfolio["watchlist"][-1]


@router.put("/{ticker}")
def update_watchlist_stock(ticker: str, stock: WatchlistStock):
    portfolio = storage.get_portfolio()
    idx = next(
        (i for i, s in enumerate(portfolio["watchlist"])
         if s["ticker"].upper() == ticker.upper()),
        None,
    )
    if idx is None:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in watchlist")
    portfolio["watchlist"][idx] = {**stock.model_dump(), "ticker": ticker.upper()}
    storage.save_portfolio(portfolio)
    return portfolio["watchlist"][idx]


@router.delete("/{ticker}")
def delete_watchlist_stock(ticker: str):
    portfolio = storage.get_portfolio()
    original_len = len(portfolio["watchlist"])
    portfolio["watchlist"] = [
        s for s in portfolio["watchlist"] if s["ticker"].upper() != ticker.upper()
    ]
    if len(portfolio["watchlist"]) == original_len:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in watchlist")
    storage.save_portfolio(portfolio)
    return {"deleted": ticker.upper()}


@router.post("/{ticker}/promote")
def promote_to_holdings(ticker: str, payload: PromotePayload):
    portfolio = storage.get_portfolio()
    watch_idx = next(
        (i for i, s in enumerate(portfolio["watchlist"])
         if s["ticker"].upper() == ticker.upper()),
        None,
    )
    if watch_idx is None:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in watchlist")
    stock_tickers = [s["ticker"].upper() for s in portfolio["stocks"]]
    if ticker.upper() in stock_tickers:
        raise HTTPException(status_code=400, detail=f"{ticker} already exists in holdings")
    watch_stock = portfolio["watchlist"].pop(watch_idx)
    new_stock = {**watch_stock, "quantity": payload.quantity, "avg_cost": payload.avg_cost}
    portfolio["stocks"].append(new_stock)
    storage.save_portfolio(portfolio)
    return new_stock
```

- [ ] **Step 4: 테스트 통과 확인**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -m pytest tests/test_watchlist_router.py -v
```

Expected: 10 tests PASSED.

- [ ] **Step 5: Commit**

```powershell
git add backend/routers/watchlist.py backend/tests/test_watchlist_router.py
git commit -m "feat: watchlist CRUD API with promote endpoint"
```

---

## Task 3: main.py + report.py 수정

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/routers/report.py`

- [ ] **Step 1: `main.py`에 watchlist router 추가**

`backend/main.py`의 import 줄을 수정:

```python
from routers import portfolio, report, watchlist
```

`app.include_router(report.router)` 아래에 추가:

```python
app.include_router(watchlist.router)
```

- [ ] **Step 2: `report.py`의 `generate_one` 수정**

`generate_one` 함수를 다음으로 교체:

```python
@router.post("/report/generate/{ticker}", status_code=202)
def generate_one(ticker: str, background_tasks: BackgroundTasks):
    portfolio = storage.get_portfolio()
    stock = next(
        (s for s in portfolio["stocks"] if s["ticker"].upper() == ticker.upper()), None
    )
    if not stock:
        stock = next(
            (s for s in portfolio.get("watchlist", [])
             if s["ticker"].upper() == ticker.upper()), None
        )
    if not stock:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in portfolio or watchlist")
    background_tasks.add_task(_run_generation, [stock])
    return {"message": f"Generating report for {ticker.upper()}"}
```

- [ ] **Step 3: 전체 테스트 통과 확인**

```powershell
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -m pytest tests/ -v
```

Expected: 모든 tests PASSED.

- [ ] **Step 4: Commit**

```powershell
git add backend/main.py backend/routers/report.py
git commit -m "feat: mount watchlist router, report generate_one supports watchlist"
```

---

## Task 4: StockModal mode prop 추가

**Files:**
- Modify: `frontend/src/components/StockModal.jsx`

- [ ] **Step 1: StockModal 교체**

`frontend/src/components/StockModal.jsx` 전체를 다음으로 교체:

```jsx
import { useState, useEffect } from 'react'

const HOLDING_EMPTY = { ticker: '', name: '', quantity: '', avg_cost: '', competitors: '', moat: '', growth_plan: '' }
const WATCHLIST_EMPTY = { ticker: '', name: '', competitors: '', moat: '', growth_plan: '' }

export default function StockModal({ stock, onSave, onClose, mode = 'holding' }) {
  const empty = mode === 'watchlist' ? WATCHLIST_EMPTY : HOLDING_EMPTY
  const [form, setForm] = useState(empty)
  const isEdit = !!stock

  useEffect(() => {
    if (stock) {
      setForm({ ...empty, ...stock, competitors: stock.competitors?.join(', ') || '' })
    } else {
      setForm(empty)
    }
  }, [stock, mode])

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  const handleSubmit = (e) => {
    e.preventDefault()
    const base = {
      ticker: form.ticker.trim().toUpperCase(),
      name: form.name.trim(),
      competitors: form.competitors.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
      moat: form.moat.trim(),
      growth_plan: form.growth_plan.trim(),
    }
    if (mode === 'holding') {
      onSave({ ...base, quantity: parseFloat(form.quantity), avg_cost: parseFloat(form.avg_cost) })
    } else {
      onSave(base)
    }
  }

  const holdingFields = [
    ['ticker', '티커 (예: NFLX)', 'text', !isEdit],
    ['name', '회사명', 'text', false],
    ['quantity', '보유 수량', 'number', false],
    ['avg_cost', '평균 매입가 ($)', 'number', false],
    ['competitors', '경쟁사 티커 (쉼표 구분)', 'text', false],
  ]

  const watchlistFields = [
    ['ticker', '티커 (예: NVDA)', 'text', !isEdit],
    ['name', '회사명', 'text', false],
    ['competitors', '경쟁사 티커 (쉼표 구분)', 'text', false],
  ]

  const fields = mode === 'watchlist' ? watchlistFields : holdingFields
  const title = mode === 'watchlist'
    ? (isEdit ? '관심종목 수정' : '관심종목 추가')
    : (isEdit ? '종목 수정' : '종목 추가')

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        <form onSubmit={handleSubmit}>
          {fields.map(([field, label, type, required]) => (
            <div className="form-field" key={field}>
              <label>{label}</label>
              <input
                type={type}
                value={form[field] ?? ''}
                onChange={set(field)}
                required={required}
                disabled={field === 'ticker' && isEdit}
                step={type === 'number' ? '0.01' : undefined}
              />
            </div>
          ))}
          <div className="form-field">
            <label>경제적 해자</label>
            <textarea rows={2} value={form.moat} onChange={set('moat')} />
          </div>
          <div className="form-field">
            <label>장기 성장 계획</label>
            <textarea rows={2} value={form.growth_plan} onChange={set('growth_plan')} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="submit" className="btn-primary">저장</button>
            <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```powershell
git add frontend/src/components/StockModal.jsx
git commit -m "feat: StockModal mode prop for holding/watchlist"
```

---

## Task 5: PromoteModal 컴포넌트 생성

**Files:**
- Create: `frontend/src/components/PromoteModal.jsx`

- [ ] **Step 1: PromoteModal 생성**

`frontend/src/components/PromoteModal.jsx`:

```jsx
import { useState } from 'react'

export default function PromoteModal({ ticker, onConfirm, onClose }) {
  const [quantity, setQuantity] = useState('')
  const [avgCost, setAvgCost] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    onConfirm({ quantity: parseFloat(quantity), avg_cost: parseFloat(avgCost) })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 320 }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom: 4 }}>보유종목으로 전환</h2>
        <p style={{ color: '#80cbc4', fontSize: 14, marginBottom: 16 }}>{ticker}</p>
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label>수량</label>
            <input
              type="number"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              required
              step="0.01"
              min="0.01"
            />
          </div>
          <div className="form-field">
            <label>평균 매입가 ($)</label>
            <input
              type="number"
              value={avgCost}
              onChange={e => setAvgCost(e.target.value)}
              required
              step="0.01"
              min="0.01"
            />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="submit" className="btn-primary">전환</button>
            <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```powershell
git add frontend/src/components/PromoteModal.jsx
git commit -m "feat: PromoteModal for watchlist-to-holding conversion"
```

---

## Task 6: Portfolio.jsx 탭 UI + watchlist 로직

**Files:**
- Modify: `frontend/src/pages/Portfolio.jsx`

- [ ] **Step 1: Portfolio.jsx 전체 교체**

`frontend/src/pages/Portfolio.jsx`:

```jsx
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import StockModal from '../components/StockModal'
import PromoteModal from '../components/PromoteModal'

const TAB_STYLE = (active) => ({
  padding: '8px 20px',
  cursor: 'pointer',
  border: 'none',
  borderBottom: active ? '2px solid #4fc3f7' : '2px solid transparent',
  background: 'transparent',
  color: active ? '#4fc3f7' : '#888',
  fontWeight: active ? 600 : 400,
  fontSize: 15,
})

export default function Portfolio() {
  const [activeTab, setActiveTab] = useState('holdings')
  const [stocks, setStocks] = useState([])
  const [watchlist, setWatchlist] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [promoteTarget, setPromoteTarget] = useState(null)
  const [error, setError] = useState('')

  const fetchAll = useCallback(async () => {
    const [portfolioRes, watchlistRes] = await Promise.all([
      axios.get('/api/portfolio'),
      axios.get('/api/watchlist'),
    ])
    setStocks(portfolioRes.data.stocks || [])
    setWatchlist(watchlistRes.data || [])
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleSave = async (stockData) => {
    try {
      if (activeTab === 'holdings') {
        if (editing) {
          await axios.put(`/api/portfolio/${editing.ticker}`, stockData)
        } else {
          await axios.post('/api/portfolio', stockData)
        }
      } else {
        if (editing) {
          await axios.put(`/api/watchlist/${editing.ticker}`, stockData)
        } else {
          await axios.post('/api/watchlist', stockData)
        }
      }
      setModalOpen(false)
      setEditing(null)
      setError('')
      fetchAll()
    } catch (err) {
      setError(err.response?.data?.detail || '저장 실패')
    }
  }

  const handleDelete = async (ticker) => {
    if (!window.confirm(`${ticker}를 삭제하시겠습니까?`)) return
    if (activeTab === 'holdings') {
      await axios.delete(`/api/portfolio/${ticker}`)
    } else {
      await axios.delete(`/api/watchlist/${ticker}`)
    }
    fetchAll()
  }

  const handlePromote = async ({ quantity, avg_cost }) => {
    try {
      await axios.post(`/api/watchlist/${promoteTarget}/promote`, { quantity, avg_cost })
      setPromoteTarget(null)
      setActiveTab('holdings')
      fetchAll()
    } catch (err) {
      setError(err.response?.data?.detail || '전환 실패')
      setPromoteTarget(null)
    }
  }

  const openEdit = (stock) => { setEditing(stock); setModalOpen(true) }
  const openAdd = () => { setEditing(null); setModalOpen(true) }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h1 style={{ color: '#90caf9' }}>내 포트폴리오</h1>
        <button className="btn-primary" onClick={openAdd}>+ 종목 추가</button>
      </div>

      {/* 탭 */}
      <div style={{ display: 'flex', borderBottom: '1px solid #333', marginBottom: 16 }}>
        <button style={TAB_STYLE(activeTab === 'holdings')} onClick={() => setActiveTab('holdings')}>
          보유종목 ({stocks.length})
        </button>
        <button style={TAB_STYLE(activeTab === 'watchlist')} onClick={() => setActiveTab('watchlist')}>
          관심종목 ({watchlist.length})
        </button>
      </div>

      {error && <p style={{ color: '#ef5350', marginBottom: 8 }}>{error}</p>}

      {/* 보유종목 탭 */}
      {activeTab === 'holdings' && (
        <table>
          <thead>
            <tr>
              <th>티커</th><th>회사명</th><th>수량</th><th>평단가</th><th>경쟁사</th><th>관리</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map(stock => (
              <tr key={stock.ticker}>
                <td><strong>{stock.ticker}</strong></td>
                <td>{stock.name}</td>
                <td>{stock.quantity}</td>
                <td>${stock.avg_cost?.toFixed(2)}</td>
                <td style={{ fontSize: 12, color: '#aaa' }}>{stock.competitors?.join(', ') || '-'}</td>
                <td>
                  <button className="btn-secondary" style={{ marginRight: 6 }} onClick={() => openEdit(stock)}>수정</button>
                  <button className="btn-danger" onClick={() => handleDelete(stock.ticker)}>삭제</button>
                </td>
              </tr>
            ))}
            {stocks.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: '#666', padding: 32 }}>종목을 추가해 주세요</td></tr>
            )}
          </tbody>
        </table>
      )}

      {/* 관심종목 탭 */}
      {activeTab === 'watchlist' && (
        <table>
          <thead>
            <tr>
              <th>티커</th><th>회사명</th><th>경쟁사</th><th>관리</th>
            </tr>
          </thead>
          <tbody>
            {watchlist.map(stock => (
              <tr key={stock.ticker}>
                <td><strong>{stock.ticker}</strong></td>
                <td>{stock.name}</td>
                <td style={{ fontSize: 12, color: '#aaa' }}>{stock.competitors?.join(', ') || '-'}</td>
                <td>
                  <button className="btn-secondary" style={{ marginRight: 6 }} onClick={() => openEdit(stock)}>수정</button>
                  <button
                    className="btn-primary"
                    style={{ marginRight: 6, background: '#2e7d32' }}
                    onClick={() => setPromoteTarget(stock.ticker)}
                  >
                    보유로 전환
                  </button>
                  <button className="btn-danger" onClick={() => handleDelete(stock.ticker)}>삭제</button>
                </td>
              </tr>
            ))}
            {watchlist.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: '#666', padding: 32 }}>관심종목을 추가해 주세요</td></tr>
            )}
          </tbody>
        </table>
      )}

      {modalOpen && (
        <StockModal
          stock={editing}
          mode={activeTab === 'watchlist' ? 'watchlist' : 'holding'}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditing(null) }}
        />
      )}

      {promoteTarget && (
        <PromoteModal
          ticker={promoteTarget}
          onConfirm={handlePromote}
          onClose={() => setPromoteTarget(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```powershell
git add frontend/src/pages/Portfolio.jsx
git commit -m "feat: portfolio page with holdings/watchlist tabs and promote flow"
```

---

## Verification

```powershell
# 1. 전체 백엔드 테스트
cd "C:\Users\Kim Tae Hyung\myProject\backend"
python -m pytest tests/ -v
```

Expected: 전체 PASSED (기존 21 + 신규 10 = 31개).

브라우저 http://localhost:5173 에서:

1. 관심종목 탭 → NVDA 추가 → 보유종목 탭에 NVDA 추가 시도 → 에러 확인
2. 관심종목 NVDA → "보유로 전환" → 수량/평단가 입력 → 보유종목 탭으로 자동 이동 확인
3. 관심종목에서 리포트 생성: `POST /api/report/generate/NVDA` 정상 응답 확인

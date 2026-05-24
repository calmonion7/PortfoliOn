# Analytics Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone Analytics page with sector allocation (donut chart) and opportunity bubble chart (upside% × return% × holding weight).

**Architecture:** Reuse `GET /api/dashboard` by adding a `sector` field to each card. The frontend Analytics page fetches this single endpoint and renders two Recharts charts. No new backend endpoints required.

**Tech Stack:** FastAPI, yfinance, Naver mobile API, React 18, Recharts 3

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `backend/services/market.py` | Add `sector`/`industry` to `get_quote` + `get_quote_kr` returns |
| Modify | `backend/routers/stocks.py` | Include `sector` in `_build_card` |
| Modify | `backend/tests/test_market.py` | Tests for sector in quote responses |
| Modify | `backend/tests/test_stocks_router.py` | Test for sector in dashboard card |
| Modify | `frontend/src/App.jsx` | Add `/analytics` route + nav link |
| Create | `frontend/src/pages/Analytics.jsx` | Full Analytics page (SectorAllocation + OpportunityBubble) |

---

### Task 1: Discover Naver basic API sector field

**Files:**
- Read: `backend/services/market.py`

- [ ] **Step 1: Inspect Naver basic API response for a KR ticker**

```bash
cd backend && .venv/bin/python -c "
from services.market import _naver_get
import json
d = _naver_get('005930', 'basic')
print('--- sector-related keys ---')
print({k: v for k, v in d.items() if any(w in str(k).lower() for w in ['industry', 'sector', '업종', '분류'])})
print('--- all keys ---')
print(list(d.keys()))
"
```

- [ ] **Step 2: Record the field name**

Note the field name from output. Common candidates: `industryCodeType`, `업종명`, `industryCategoryCode`. This value is used in Task 2 Step 8. If no sector field exists, skip Task 2 Step 8 (yfinance fallback is sufficient).

---

### Task 2: Add sector to get_quote (US) and get_quote_kr (KR)

**Files:**
- Modify: `backend/services/market.py`
- Test: `backend/tests/test_market.py`

- [ ] **Step 1: Write failing test for sector in US get_quote**

Add to `backend/tests/test_market.py`:

```python
def test_get_quote_includes_sector():
    mock = _make_mock_ticker()
    mock.info["sector"] = "Technology"
    mock.info["industry"] = "Consumer Electronics"
    with patch("services.market.yf.Ticker", return_value=mock):
        from services import market
        import importlib; importlib.reload(market)
        result = market.get_quote("AAPL")
    assert result["sector"] == "Technology"
    assert result["industry"] == "Consumer Electronics"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && .venv/bin/python -m pytest tests/test_market.py::test_get_quote_includes_sector -v
```
Expected: FAIL — `KeyError: 'sector'`

- [ ] **Step 3: Add sector/industry to get_quote success return**

In `backend/services/market.py`, in `get_quote()`, the success `return` dict (currently ends with `"market": market`). Add two fields:

```python
        return {
            "ticker": ticker,
            "name": info.get("shortName", ticker),
            "price": float(current),
            "prev_close": round(prev_close, 2) if prev_close else None,
            "daily_change": f"{daily_change_pct:+.2f}%" if daily_change_pct is not None else "N/A",
            "daily_change_pct": daily_change_pct,
            "weekly_change_pct": weekly_change_pct,
            "monthly_change_pct": monthly_change_pct,
            "market_cap": info.get("marketCap"),
            "ytd_return": round(ytd_return, 2) if ytd_return else None,
            "market": market,
            "sector": info.get("sector", "") or "",
            "industry": info.get("industry", "") or "",
        }
```

Also update the error return in `get_quote()`:

```python
    except Exception as e:
        return {
            "ticker": ticker, "name": ticker, "price": None,
            "prev_close": None, "daily_change": "N/A",
            "daily_change_pct": None, "weekly_change_pct": None, "monthly_change_pct": None,
            "market_cap": None, "ytd_return": None, "market": market,
            "sector": "", "industry": "", "error": str(e),
        }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && .venv/bin/python -m pytest tests/test_market.py::test_get_quote_includes_sector -v
```
Expected: PASS

- [ ] **Step 5: Write failing test for KR sector fallback**

Add to `backend/tests/test_market.py`:

```python
def test_get_quote_kr_sector_from_yfinance_fallback():
    naver_basic = {
        "closePrice": "75000",
        "compareToPreviousClosePrice": "500",
        "fluctuationsRatio": "0.67",
        "marketValue": "447000000000000",
        "stockName": "삼성전자",
    }
    mock_yf = MagicMock()
    mock_yf.info = {"sector": "Technology", "industry": "Semiconductors"}
    dates = pd.date_range("2026-01-02", periods=100, freq="B")
    mock_yf.history.return_value = pd.DataFrame(
        {"Close": [74000.0] + [75000.0] * 99},
        index=dates,
    )
    with patch("services.market._naver_get", return_value=naver_basic), \
         patch("services.market.yf.Ticker", return_value=mock_yf):
        from services import market
        import importlib; importlib.reload(market)
        result = market.get_quote_kr("005930")
    assert result["sector"] == "Technology"
    assert "industry" in result
```

- [ ] **Step 6: Run test — note pass/fail**

```bash
cd backend && .venv/bin/python -m pytest tests/test_market.py::test_get_quote_kr_sector_from_yfinance_fallback -v
```

If PASS: `get_quote_kr` already returns sector from yfinance. Skip to Step 8.
If FAIL: the KR return dict lacks `sector` — fix in Step 7.

- [ ] **Step 7: (If needed) Fix KR error return to include sector**

In `backend/services/market.py`, `get_quote_kr()` error return already has `"sector": "", "industry": ""` — confirm it's present. If missing, add them matching the US error return pattern.

- [ ] **Step 8: Add Naver basic sector parse (if field found in Task 1)**

If Task 1 revealed a sector field, in `get_quote_kr()` replace:
```python
        sector = ""
        industry = ""
```
with:
```python
        sector = str(d.get("<FIELD_FROM_TASK_1>") or "") or ""  # Naver업종 first
        industry = ""
```
This runs before the yfinance block, which will override `sector` if it gets a non-empty value.

If Task 1 found no field, leave `sector = ""` as-is — the yfinance block at line ~115 already sets it.

- [ ] **Step 9: Run all market tests**

```bash
cd backend && .venv/bin/python -m pytest tests/test_market.py -v
```
Expected: all PASS

- [ ] **Step 10: Commit**

```bash
git add backend/services/market.py backend/tests/test_market.py
git commit -m "feat: add sector/industry fields to get_quote and get_quote_kr"
```

---

### Task 3: Add sector to dashboard endpoint

**Files:**
- Modify: `backend/routers/stocks.py:188-204`
- Test: `backend/tests/test_stocks_router.py`

- [ ] **Step 1: Write failing test**

Add to `backend/tests/test_stocks_router.py`:

```python
def test_dashboard_card_includes_sector():
    portfolio = {
        "stocks": [
            {"ticker": "AAPL", "name": "Apple Inc.", "market": "US",
             "avg_cost": 150.0, "quantity": 10, "exchange": ""},
        ],
        "watchlist": []
    }
    quote = {
        "ticker": "AAPL", "price": 185.2,
        "daily_change_pct": 1.4, "weekly_change_pct": 2.1, "monthly_change_pct": 5.8,
        "name": "Apple Inc.", "market": "US",
        "sector": "Technology", "industry": "Consumer Electronics",
    }
    from pathlib import Path
    with patch("routers.stocks.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.stocks.market.get_quote", return_value=quote), \
         patch("routers.stocks.SNAPSHOTS_DIR", Path("/nonexistent")), \
         patch("routers.stocks.REPORTS_DIR", Path("/nonexistent")):
        resp = client.get("/api/stocks/dashboard")
    assert resp.status_code == 200
    card = resp.json()[0]
    assert card["sector"] == "Technology"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && .venv/bin/python -m pytest tests/test_stocks_router.py::test_dashboard_card_includes_sector -v
```
Expected: FAIL — `KeyError: 'sector'`

- [ ] **Step 3: Add sector to _build_card**

In `backend/routers/stocks.py`, in `_build_card`, add `"sector"` to the return dict (after `"snapshot_date"`):

```python
        return {
            "ticker": ticker,
            "name": stock.get("name", ticker),
            "market": stock.get("market", "US"),
            "avg_cost": stock.get("avg_cost"),
            "quantity": stock.get("quantity"),
            "current_price": quote.get("price"),
            "daily_change_pct": quote.get("daily_change_pct"),
            "weekly_change_pct": quote.get("weekly_change_pct"),
            "monthly_change_pct": quote.get("monthly_change_pct"),
            "rsi": rsi,
            "target_mean": target_mean,
            "buy": buy,
            "hold": hold,
            "sell": sell,
            "snapshot_date": snapshot_date,
            "sector": quote.get("sector") or "기타",
        }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && .venv/bin/python -m pytest tests/test_stocks_router.py::test_dashboard_card_includes_sector -v
```
Expected: PASS

- [ ] **Step 5: Run all stocks router tests**

```bash
cd backend && .venv/bin/python -m pytest tests/test_stocks_router.py -v
```
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add backend/routers/stocks.py backend/tests/test_stocks_router.py
git commit -m "feat: add sector field to dashboard endpoint response"
```

---

### Task 4: Add /analytics route and nav link

**Files:**
- Modify: `frontend/src/App.jsx`
- Create: `frontend/src/pages/Analytics.jsx` (stub)

- [ ] **Step 1: Create stub Analytics.jsx**

Create `frontend/src/pages/Analytics.jsx`:

```jsx
export default function Analytics() {
  return <div style={{ color: 'var(--text)' }}>Analytics</div>
}
```

- [ ] **Step 2: Add import and route in App.jsx**

In `frontend/src/App.jsx`, add import after the Market import:

```jsx
import Analytics from './pages/Analytics'
```

In the nav links array, insert `['/analytics', '분석']` between `'/market'` and `'/guru'`:

```jsx
{[['/', '종목 관리'], ['/reports', '리포트'], ['/calendar', '캘린더'], ['/digest', '다이제스트'], ['/market', '시장지표'], ['/analytics', '분석'], ['/guru', '구루'], ['/settings', '설정']].map(([to, label]) => (
```

In `<Routes>`, add after the Market route:

```jsx
<Route path="/analytics" element={<Analytics />} />
```

- [ ] **Step 3: Verify in browser**

With dev server running (`cd frontend && npm run dev`), navigate to `http://localhost:5173/analytics`. Should show "Analytics" text. "분석" link in nav should highlight when active.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx frontend/src/pages/Analytics.jsx
git commit -m "feat: add /analytics route and nav link (stub)"
```

---

### Task 5: SectorAllocation chart

**Files:**
- Modify: `frontend/src/pages/Analytics.jsx`

- [ ] **Step 1: Implement Analytics.jsx with SectorAllocation**

Replace the stub with:

```jsx
import { useState, useEffect } from 'react'
import axios from 'axios'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from 'recharts'

const SECTOR_COLORS = [
  '#4fc3f7', '#81c784', '#ffb74d', '#f06292',
  '#ce93d8', '#80cbc4', '#fff176', '#a5d6a7',
  '#ef9a9a', '#90caf9',
]

function SectorAllocation({ cards }) {
  const total = cards.reduce((s, c) => s + (c.quantity ?? 0) * (c.current_price ?? 0), 0)

  const sectorMap = {}
  for (const c of cards) {
    const val = (c.quantity ?? 0) * (c.current_price ?? 0)
    if (!val) continue
    const key = c.sector || '기타'
    sectorMap[key] = (sectorMap[key] ?? 0) + val
  }

  const data = Object.entries(sectorMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({
      name,
      value,
      pct: total ? (value / total * 100).toFixed(1) : '0.0',
    }))

  const fmt = (v) =>
    v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
    : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M`
    : `$${v.toFixed(0)}`

  return (
    <div style={{ marginBottom: 48 }}>
      <h3 style={{ color: 'var(--text)', marginBottom: 16 }}>섹터 배분</h3>
      <div style={{ display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap' }}>
        <ResponsiveContainer width={260} height={260}>
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={70} outerRadius={110} paddingAngle={2}>
              {data.map((_, i) => (
                <Cell key={i} fill={SECTOR_COLORS[i % SECTOR_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v, n, p) => [`${p.payload.pct}%`, n]}
              contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
        <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', paddingRight: 16, color: 'var(--text-muted)', fontWeight: 400 }}>섹터</th>
              <th style={{ textAlign: 'right', paddingRight: 12, color: 'var(--text-muted)', fontWeight: 400 }}>비중</th>
              <th style={{ textAlign: 'right', color: 'var(--text-muted)', fontWeight: 400 }}>시가</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={d.name}>
                <td style={{ paddingRight: 16, paddingTop: 4, color: 'var(--text)' }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: 2,
                    background: SECTOR_COLORS[i % SECTOR_COLORS.length],
                    display: 'inline-block', marginRight: 6, verticalAlign: 'middle',
                  }} />
                  {d.name}
                </td>
                <td style={{ textAlign: 'right', paddingRight: 12, paddingTop: 4, color: 'var(--text)' }}>
                  {d.pct}%
                </td>
                <td style={{ textAlign: 'right', paddingTop: 4, color: 'var(--text-muted)' }}>
                  {fmt(d.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function OpportunityBubble() {
  return null
}

export default function Analytics() {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/dashboard')
      .then(r => { setCards(r.data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>불러오는 중...</div>
  if (error) return <div style={{ color: '#ef9a9a' }}>오류: {error}</div>
  if (!cards.length) return <div style={{ color: 'var(--text-muted)' }}>보유종목 없음</div>

  return (
    <div>
      <h2 style={{ color: 'var(--text)', marginBottom: 32 }}>포트폴리오 분석</h2>
      <SectorAllocation cards={cards} />
      <OpportunityBubble cards={cards} />
    </div>
  )
}
```

- [ ] **Step 2: Verify SectorAllocation in browser**

Navigate to `http://localhost:5173/analytics`.
- Donut chart renders with colored slices
- Legend table shows sector name, %, market value
- No console errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Analytics.jsx
git commit -m "feat: add SectorAllocation donut chart to Analytics page"
```

---

### Task 6: OpportunityBubble chart

**Files:**
- Modify: `frontend/src/pages/Analytics.jsx`

- [ ] **Step 1: Add Recharts ScatterChart imports**

In `frontend/src/pages/Analytics.jsx`, update the recharts import line:

```jsx
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ReferenceLine, Label,
} from 'recharts'
```

- [ ] **Step 2: Replace OpportunityBubble null stub with full implementation**

Replace `function OpportunityBubble() { return null }` with:

```jsx
const CustomDot = (props) => {
  const { cx, cy, payload } = props
  const r = Math.max(6, Math.sqrt(payload.weight) * 4)
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={payload.fill} fillOpacity={0.75} stroke={payload.fill} />
      <text x={cx} y={cy - r - 4} textAnchor="middle" fontSize={10} fill="var(--text)">
        {payload.ticker}
      </text>
    </g>
  )
}

function OpportunityBubble({ cards }) {
  const totalVal = cards.reduce((s, c) => s + (c.quantity ?? 0) * (c.current_price ?? 0), 0)

  const included = []
  const excluded = []

  for (const c of cards) {
    const price = c.current_price
    const avgCost = c.avg_cost
    const target = c.target_mean
    if (!price || !avgCost || !target) {
      excluded.push(c.ticker)
      continue
    }
    const upside = parseFloat(((target - price) / price * 100).toFixed(1))
    const returnPct = parseFloat(((price - avgCost) / avgCost * 100).toFixed(1))
    const weight = totalVal ? c.quantity * price / totalVal * 100 : 1
    included.push({
      ticker: c.ticker,
      upside,
      returnPct,
      weight,
      fill: upside > 0 ? '#81c784' : '#ef9a9a',
    })
  }

  return (
    <div>
      <h3 style={{ color: 'var(--text)', marginBottom: 8 }}>기회 버블 차트</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 16 }}>
        X: 컨센서스 업사이드% &nbsp;·&nbsp; Y: 평단가 대비 수익률% &nbsp;·&nbsp; 버블 크기: 포트폴리오 비중
      </p>
      <ResponsiveContainer width="100%" height={420}>
        <ScatterChart margin={{ top: 24, right: 32, bottom: 32, left: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis type="number" dataKey="upside" name="업사이드" unit="%" stroke="var(--text-muted)" tick={{ fontSize: 11 }}>
            <Label value="업사이드 %" position="insideBottom" offset={-16} fill="var(--text-muted)" fontSize={11} />
          </XAxis>
          <YAxis type="number" dataKey="returnPct" name="수익률" unit="%" stroke="var(--text-muted)" tick={{ fontSize: 11 }}>
            <Label value="수익률 %" angle={-90} position="insideLeft" offset={10} fill="var(--text-muted)" fontSize={11} />
          </YAxis>
          <ReferenceLine x={0} stroke="var(--text-muted)" strokeDasharray="4 2" />
          <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="4 2" />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={({ payload }) => {
              if (!payload?.length) return null
              const d = payload[0].payload
              return (
                <div style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  padding: '8px 12px', borderRadius: 6, fontSize: 12,
                }}>
                  <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{d.ticker}</div>
                  <div style={{ color: 'var(--text-muted)' }}>
                    업사이드: <span style={{ color: 'var(--text)' }}>{d.upside}%</span>
                  </div>
                  <div style={{ color: 'var(--text-muted)' }}>
                    수익률: <span style={{ color: 'var(--text)' }}>{d.returnPct}%</span>
                  </div>
                  <div style={{ color: 'var(--text-muted)' }}>
                    비중: <span style={{ color: 'var(--text)' }}>{d.weight.toFixed(1)}%</span>
                  </div>
                </div>
              )
            }}
          />
          <Scatter data={included} shape={<CustomDot />} />
        </ScatterChart>
      </ResponsiveContainer>
      {excluded.length > 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 8 }}>
          컨센서스 목표가 없어 제외: {excluded.join(', ')}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify bubble chart in browser**

Navigate to `http://localhost:5173/analytics`.
- Bubble chart renders below sector chart
- Ticker labels appear above each bubble
- Hover tooltip shows ticker, upside%, return%, weight%
- Reference lines at X=0 and Y=0 visible
- Excluded tickers listed if any
- No console errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Analytics.jsx
git commit -m "feat: add OpportunityBubble scatter chart to Analytics page"
```

---

### Task 7: Full test suite verification

- [ ] **Step 1: Run all backend tests**

```bash
cd backend && .venv/bin/python -m pytest -v
```
Expected: all PASS

- [ ] **Step 2: Smoke-check existing pages in browser**

- `/` — Portfolio dashboard cards load normally
- `/reports` — Report list loads
- `/market` — Market indicators load

No regressions in existing pages.

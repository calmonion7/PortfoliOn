# AnalysisHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 섹터 ETF 모멘텀 히트맵과 매크로-포트폴리오 상관관계 분석을 제공하는 `/analysis` 독립 페이지 구축

**Architecture:** 백엔드는 `analysis_service.py`(계산 로직)와 `analysis.py`(라우터) 2파일 추가, 기존 `cache.py`에 TTLCache 2개 추가. 프론트는 `AnalysisHub.jsx`(허브) + `SectorTab.jsx` + `MacroTab.jsx` 3파일 추가, `App.jsx` 라우팅/내비에 1항목 추가.

**Tech Stack:** Python/FastAPI, yfinance, pandas, numpy, React 18, recharts

---

## File Map

| Action | Path |
|--------|------|
| Modify | `backend/services/cache.py` |
| Create | `backend/services/analysis_service.py` |
| Create | `backend/routers/analysis.py` |
| Modify | `backend/main.py` |
| Create | `backend/tests/test_analysis_router.py` |
| Create | `frontend/src/pages/AnalysisHub.jsx` |
| Create | `frontend/src/pages/SectorTab.jsx` |
| Create | `frontend/src/pages/MacroTab.jsx` |
| Modify | `frontend/src/App.jsx` |

---

## Task 1: cache.py에 섹터·매크로 캐시 추가

**Files:**
- Modify: `backend/services/cache.py`

- [ ] **Step 1: 파일 끝에 캐시 2개 추가**

`backend/services/cache.py` 파일 끝에 아래 4줄 추가:

```python
_sector_cache = TTLCache(300.0)
_macro_cache = TTLCache(300.0)


def get_sector(loader) -> dict:
    return _sector_cache.get(loader)


def get_macro(loader) -> dict:
    return _macro_cache.get(loader)
```

- [ ] **Step 2: 커밋**

```bash
git add backend/services/cache.py
git commit -m "feat: analysis용 sector·macro TTLCache 추가"
```

---

## Task 2: 섹터 엔드포인트 테스트 작성 (failing)

**Files:**
- Create: `backend/tests/test_analysis_router.py`

- [ ] **Step 1: 테스트 파일 생성**

```python
# backend/tests/test_analysis_router.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import pandas as pd
import numpy as np

from routers.analysis import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def _make_hist(seed: int, n: int = 70) -> MagicMock:
    rng = np.random.default_rng(seed)
    closes = 100.0 + np.cumsum(rng.standard_normal(n))
    dates = pd.date_range(end=pd.Timestamp("2026-05-24"), periods=n, freq="B")
    mock = MagicMock()
    mock.history.return_value = pd.DataFrame({"Close": closes}, index=dates)
    return mock


def test_sector_returns_11_etfs():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("services.analysis_service.yf.Ticker", return_value=_make_hist(0)), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_sector", side_effect=lambda loader: loader()):
        resp = client.get("/api/analysis/sector")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["sectors"]) == 11
    etfs = [s["etf"] for s in data["sectors"]]
    for etf in ["XLK", "XLF", "XLV", "XLE", "XLI", "XLY", "XLP", "XLB", "XLU", "XLRE", "XLC"]:
        assert etf in etfs


def test_sector_includes_return_fields():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("services.analysis_service.yf.Ticker", return_value=_make_hist(0)), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_sector", side_effect=lambda loader: loader()):
        resp = client.get("/api/analysis/sector")
    s = resp.json()["sectors"][0]
    assert "return_1w" in s
    assert "return_1mo" in s
    assert "return_3mo" in s


def test_sector_portfolio_overlay():
    portfolio = {
        "stocks": [{"ticker": "AAPL", "sector": "Technology", "quantity": 5}],
        "watchlist": [],
    }
    with patch("services.analysis_service.yf.Ticker", return_value=_make_hist(0)), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_sector", side_effect=lambda loader: loader()):
        resp = client.get("/api/analysis/sector")
    assert resp.json()["portfolio_sectors"]["AAPL"] == "Technology"


def test_macro_returns_four_correlations():
    portfolio = {
        "stocks": [
            {"ticker": "AAPL", "market": "US", "exchange": "", "quantity": 5},
            {"ticker": "MSFT", "market": "US", "exchange": "", "quantity": 3},
        ],
        "watchlist": [],
    }
    def mock_ticker(sym):
        return _make_hist(abs(hash(sym)) % 97)
    with patch("services.analysis_service.yf.Ticker", side_effect=mock_ticker), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_macro", side_effect=lambda loader: loader()):
        resp = client.get("/api/analysis/macro-correlation")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["correlations"]) == 4
    tickers = [c["ticker"] for c in data["correlations"]]
    assert "TLT" in tickers
    assert "^VIX" in tickers


def test_macro_empty_for_no_holdings():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_macro", side_effect=lambda loader: loader()):
        resp = client.get("/api/analysis/macro-correlation")
    assert resp.status_code == 200
    assert resp.json() == {"correlations": [], "scatter": []}


def test_macro_scatter_contains_indicator_field():
    portfolio = {
        "stocks": [{"ticker": "AAPL", "market": "US", "exchange": "", "quantity": 10}],
        "watchlist": [],
    }
    def mock_ticker(sym):
        return _make_hist(abs(hash(sym)) % 97)
    with patch("services.analysis_service.yf.Ticker", side_effect=mock_ticker), \
         patch("routers.analysis.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.analysis.cache_svc.get_macro", side_effect=lambda loader: loader()):
        resp = client.get("/api/analysis/macro-correlation")
    scatter = resp.json()["scatter"]
    if scatter:
        assert "indicator" in scatter[0]
        assert "macro_delta" in scatter[0]
        assert "portfolio_return" in scatter[0]
```

- [ ] **Step 2: 테스트 실패 확인 (routers.analysis 없으므로 ImportError 예상)**

```bash
cd backend && .venv/bin/python -m pytest tests/test_analysis_router.py -v 2>&1 | head -20
```

Expected: `ModuleNotFoundError: No module named 'routers.analysis'`

---

## Task 3: analysis_service.py 구현

**Files:**
- Create: `backend/services/analysis_service.py`

- [ ] **Step 1: 파일 생성**

```python
# backend/services/analysis_service.py
import numpy as np
import pandas as pd
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor

SECTOR_ETFS = [
    {"name": "Technology",             "etf": "XLK"},
    {"name": "Financials",             "etf": "XLF"},
    {"name": "Health Care",            "etf": "XLV"},
    {"name": "Energy",                 "etf": "XLE"},
    {"name": "Industrials",            "etf": "XLI"},
    {"name": "Consumer Discretionary", "etf": "XLY"},
    {"name": "Consumer Staples",       "etf": "XLP"},
    {"name": "Materials",              "etf": "XLB"},
    {"name": "Utilities",              "etf": "XLU"},
    {"name": "Real Estate",            "etf": "XLRE"},
    {"name": "Communication Services", "etf": "XLC"},
]

MACRO_TICKERS = [
    {"label": "미국 10년물 금리", "ticker": "TLT"},
    {"label": "달러 인덱스",     "ticker": "UUP"},
    {"label": "유가",            "ticker": "USO"},
    {"label": "공포 지수",       "ticker": "^VIX"},
]


def _calc_return(closes: pd.Series, days: int):
    if len(closes) < days + 1:
        return None
    return round((float(closes.iloc[-1]) / float(closes.iloc[-days - 1]) - 1) * 100, 2)


def _fetch_etf(entry: dict) -> dict:
    try:
        hist = yf.Ticker(entry["etf"]).history(period="90d")["Close"].dropna()
        return {
            "name": entry["name"],
            "etf": entry["etf"],
            "return_1w": _calc_return(hist, 5),
            "return_1mo": _calc_return(hist, 21),
            "return_3mo": _calc_return(hist, 63),
        }
    except Exception:
        return {"name": entry["name"], "etf": entry["etf"],
                "return_1w": None, "return_1mo": None, "return_3mo": None}


def get_sector_momentum(holdings: list) -> dict:
    with ThreadPoolExecutor(max_workers=11) as ex:
        sectors = list(ex.map(_fetch_etf, SECTOR_ETFS))
    portfolio_sectors = {
        h["ticker"].upper(): h.get("sector") or "기타"
        for h in holdings
    }
    return {"sectors": sectors, "portfolio_sectors": portfolio_sectors}


def _fetch_holding_closes(item: dict):
    ticker = item["ticker"].upper()
    market = item.get("market", "US")
    exchange = item.get("exchange", "")
    qty = item.get("quantity", 0)
    sym = f"{ticker}.{exchange or 'KS'}" if market == "KR" else ticker
    try:
        closes = yf.Ticker(sym).history(period="90d")["Close"].dropna()
        if len(closes) < 20 or not qty:
            return None
        return closes, qty
    except Exception:
        return None


def get_macro_correlation(holdings: list) -> dict:
    with ThreadPoolExecutor(max_workers=30) as ex:
        results = list(ex.map(_fetch_holding_closes, holdings))
    results = [r for r in results if r is not None]

    if not results:
        return {"correlations": [], "scatter": []}

    ret_series = {}
    raw_weights = {}
    for i, (closes, qty) in enumerate(results):
        ret_series[i] = closes.pct_change().dropna()
        raw_weights[i] = qty * float(closes.iloc[-1])

    df = pd.DataFrame(ret_series).dropna()
    if df.empty or len(df) < 10:
        return {"correlations": [], "scatter": []}

    total_w = sum(raw_weights.values())
    if total_w == 0:
        return {"correlations": [], "scatter": []}

    w_arr = np.array([raw_weights[i] / total_w for i in range(len(results))])
    portfolio_ret = pd.Series(df.values @ w_arr, index=df.index)

    correlations = []
    scatter = []

    for m in MACRO_TICKERS:
        try:
            macro_hist = yf.Ticker(m["ticker"]).history(period="90d")["Close"].dropna()
            macro_delta = macro_hist.pct_change().dropna()
            idx = portfolio_ret.index.intersection(macro_delta.index)
            if len(idx) < 10:
                correlations.append({"indicator": m["label"], "ticker": m["ticker"], "corr_90d": None})
                continue
            p = portfolio_ret.loc[idx]
            md = macro_delta.loc[idx]
            corr = round(float(p.corr(md)), 3)
            correlations.append({"indicator": m["label"], "ticker": m["ticker"], "corr_90d": corr})
            for dt, mv, pv in zip(idx, md.values, p.values):
                scatter.append({
                    "date": str(dt.date()),
                    "indicator": m["ticker"],
                    "macro_delta": round(float(mv) * 100, 4),
                    "portfolio_return": round(float(pv) * 100, 4),
                })
        except Exception:
            correlations.append({"indicator": m["label"], "ticker": m["ticker"], "corr_90d": None})

    return {"correlations": correlations, "scatter": scatter}
```

---

## Task 4: analysis.py 라우터 구현 + main.py 등록

**Files:**
- Create: `backend/routers/analysis.py`
- Modify: `backend/main.py`

- [ ] **Step 1: 라우터 파일 생성**

```python
# backend/routers/analysis.py
from fastapi import APIRouter
from services import storage, cache as cache_svc
from services.analysis_service import get_sector_momentum, get_macro_correlation

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.get("/sector")
def sector():
    def _build():
        holdings = storage.get_full_portfolio().get("stocks", [])
        return get_sector_momentum(holdings)
    return cache_svc.get_sector(_build)


@router.get("/macro-correlation")
def macro_correlation():
    def _build():
        holdings = storage.get_full_portfolio().get("stocks", [])
        return get_macro_correlation(holdings)
    return cache_svc.get_macro(_build)
```

- [ ] **Step 2: main.py에 라우터 등록**

`backend/main.py`의 import 줄 수정:

```python
from routers import portfolio, report, watchlist, stocks, guru, calendar, digest, analytics
from routers.market_indicators import router as market_indicators_router
from routers.analysis import router as analysis_router
```

그리고 `app.include_router(analytics.router)` 아래에 추가:

```python
app.include_router(analysis_router)
```

---

## Task 5: 테스트 통과 확인 + 커밋

**Files:**
- Test: `backend/tests/test_analysis_router.py`

- [ ] **Step 1: 전체 테스트 실행**

```bash
cd backend && .venv/bin/python -m pytest tests/test_analysis_router.py -v
```

Expected: `6 passed`

- [ ] **Step 2: 기존 테스트 회귀 확인**

```bash
cd backend && .venv/bin/python -m pytest --tb=short -q 2>&1 | tail -10
```

Expected: 기존 테스트 모두 pass

- [ ] **Step 3: 커밋**

```bash
git add backend/services/analysis_service.py backend/routers/analysis.py backend/main.py backend/tests/test_analysis_router.py
git commit -m "feat: analysis 백엔드 추가 (섹터 모멘텀·매크로 상관관계)"
```

---

## Task 6: AnalysisHub.jsx 생성 (허브 셸)

**Files:**
- Create: `frontend/src/pages/AnalysisHub.jsx`

- [ ] **Step 1: 파일 생성**

MarketHub.jsx와 동일한 탭 패턴 사용:

```jsx
// frontend/src/pages/AnalysisHub.jsx
import { useState } from 'react'
import SectorTab from './SectorTab'
import MacroTab from './MacroTab'

const TABS = [
  { key: 'sector', label: '섹터' },
  { key: 'macro',  label: '매크로' },
]

export default function AnalysisHub() {
  const [tab, setTab] = useState('sector')

  const tabStyle = (active) => ({
    padding: '6px 14px', borderRadius: 16,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-btn)' : 'transparent',
    color: active ? 'white' : 'var(--text-muted)',
    cursor: 'pointer', fontSize: 13,
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {TABS.map(t => (
          <button key={t.key} style={tabStyle(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'sector' && <SectorTab />}
      {tab === 'macro'  && <MacroTab />}
    </div>
  )
}
```

---

## Task 7: SectorTab.jsx 구현

**Files:**
- Create: `frontend/src/pages/SectorTab.jsx`

- [ ] **Step 1: 파일 생성**

```jsx
// frontend/src/pages/SectorTab.jsx
import { useState, useEffect } from 'react'
import axios from 'axios'

const PERIODS = ['return_1w', 'return_1mo', 'return_3mo']
const PERIOD_LABELS = { return_1w: '1주', return_1mo: '1개월', return_3mo: '3개월' }

function returnColor(v) {
  if (v === null || v === undefined) return 'transparent'
  const neutral = [42, 42, 58]
  const pos = [79, 195, 100]
  const neg = [239, 100, 100]
  const t = Math.min(Math.abs(v) / 10, 1)
  const to = v >= 0 ? pos : neg
  return `rgb(${Math.round(neutral[0] + t * (to[0] - neutral[0]))},${Math.round(neutral[1] + t * (to[1] - neutral[1]))},${Math.round(neutral[2] + t * (to[2] - neutral[2]))})`
}

export default function SectorTab() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/analysis/sector')
      .then(r => { setData(r.data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>섹터 데이터 불러오는 중...</div>
  if (error) return <div style={{ color: '#ef9a9a' }}>오류: {error}</div>
  if (!data) return null

  const { sectors, portfolio_sectors } = data
  const heldSectors = new Set(Object.values(portfolio_sectors))

  return (
    <div>
      <h2 style={{ color: 'var(--text)', marginBottom: 8 }}>섹터 모멘텀</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 24 }}>
        S&P500 섹터 ETF 기준 수익률 · ★ 보유 종목이 있는 섹터
      </p>
      <table style={{ borderCollapse: 'separate', borderSpacing: '0 3px', fontSize: 13, width: '100%', maxWidth: 620 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', paddingBottom: 8, color: 'var(--text-muted)', fontWeight: 400 }}>섹터</th>
            <th style={{ textAlign: 'center', padding: '0 12px 8px', color: 'var(--text-muted)', fontWeight: 400 }}>ETF</th>
            {PERIODS.map(p => (
              <th key={p} style={{ textAlign: 'right', padding: '0 8px 8px', color: 'var(--text-muted)', fontWeight: 400, minWidth: 68 }}>
                {PERIOD_LABELS[p]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sectors.map(s => (
            <tr key={s.etf}>
              <td style={{ padding: '4px 12px 4px 0', color: 'var(--text)' }}>
                {heldSectors.has(s.name) ? `★ ${s.name}` : s.name}
              </td>
              <td style={{ padding: '4px 12px', color: 'var(--text-muted)', textAlign: 'center', fontSize: 11 }}>{s.etf}</td>
              {PERIODS.map(p => (
                <td key={p} style={{
                  padding: '3px 8px',
                  textAlign: 'right',
                  background: returnColor(s[p]),
                  color: s[p] !== null ? 'white' : 'var(--text-muted)',
                  borderRadius: 4,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {s[p] !== null ? `${s[p] > 0 ? '+' : ''}${s[p]}%` : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {Object.keys(portfolio_sectors).length > 0 && (
        <p style={{ marginTop: 20, fontSize: 12, color: 'var(--text-muted)' }}>
          보유 종목: {Object.entries(portfolio_sectors).map(([t, s]) => `${t}(${s})`).join(' · ')}
        </p>
      )}
    </div>
  )
}
```

---

## Task 8: MacroTab.jsx 구현

**Files:**
- Create: `frontend/src/pages/MacroTab.jsx`

- [ ] **Step 1: 파일 생성**

```jsx
// frontend/src/pages/MacroTab.jsx
import { useState, useEffect } from 'react'
import axios from 'axios'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  ReferenceLine, Tooltip, ResponsiveContainer, Label,
} from 'recharts'

const INDICATOR_LABELS = {
  'TLT': '미국 10년물 금리',
  'UUP': '달러 인덱스',
  'USO': '유가',
  '^VIX': '공포 지수',
}

function corrColor(v) {
  if (v === null || v === undefined) return 'var(--text-muted)'
  const neutral = [69, 90, 100]
  const pos = [79, 195, 247]
  const neg = [239, 154, 154]
  const t = Math.min(Math.abs(v), 1)
  const to = v >= 0 ? pos : neg
  return `rgb(${Math.round(neutral[0] + t * (to[0] - neutral[0]))},${Math.round(neutral[1] + t * (to[1] - neutral[1]))},${Math.round(neutral[2] + t * (to[2] - neutral[2]))})`
}

export default function MacroTab() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    axios.get('/api/analysis/macro-correlation')
      .then(r => {
        setData(r.data)
        setLoading(false)
        if (r.data.correlations.length) setSelected(r.data.correlations[0].ticker)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>매크로 데이터 불러오는 중...</div>
  if (error) return <div style={{ color: '#ef9a9a' }}>오류: {error}</div>
  if (!data || !data.correlations.length) return (
    <div style={{ color: 'var(--text-muted)' }}>보유종목 없음 또는 데이터 부족</div>
  )

  const { correlations, scatter } = data
  const scatterData = scatter.filter(d => d.indicator === selected)

  return (
    <div>
      <h2 style={{ color: 'var(--text)', marginBottom: 8 }}>매크로 상관관계</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 24 }}>
        매크로 지표 일별 변동률 vs 포트폴리오 가중평균 수익률 · 90일 Pearson 상관계수 · 행 클릭 시 산점도 표시
      </p>

      <table style={{ borderCollapse: 'collapse', fontSize: 13, marginBottom: 32 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 20px 8px 0', color: 'var(--text-muted)', fontWeight: 400 }}>지표</th>
            <th style={{ textAlign: 'center', padding: '4px 16px 8px', color: 'var(--text-muted)', fontWeight: 400 }}>티커</th>
            <th style={{ textAlign: 'right', padding: '4px 0 8px', color: 'var(--text-muted)', fontWeight: 400 }}>상관계수</th>
          </tr>
        </thead>
        <tbody>
          {correlations.map(c => (
            <tr
              key={c.ticker}
              onClick={() => setSelected(c.ticker)}
              style={{
                cursor: 'pointer',
                background: selected === c.ticker ? 'var(--bg-card)' : 'transparent',
                borderRadius: 4,
              }}
            >
              <td style={{ padding: '7px 20px 7px 0', color: 'var(--text)' }}>{c.indicator}</td>
              <td style={{ padding: '7px 16px', color: 'var(--text-muted)', textAlign: 'center', fontSize: 11 }}>{c.ticker}</td>
              <td style={{ padding: '7px 0', textAlign: 'right' }}>
                <span style={{
                  color: corrColor(c.corr_90d),
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 600,
                }}>
                  {c.corr_90d !== null ? c.corr_90d.toFixed(3) : '—'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {scatterData.length > 0 && (
        <div>
          <h3 style={{ color: 'var(--text)', marginBottom: 8, fontSize: 14 }}>
            {INDICATOR_LABELS[selected] || selected} vs 포트폴리오 수익률 (90일)
          </h3>
          <ResponsiveContainer width="100%" height={360}>
            <ScatterChart margin={{ top: 16, right: 24, bottom: 32, left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" dataKey="macro_delta" name="매크로 변동" unit="%" stroke="var(--text-muted)" tick={{ fontSize: 11 }}>
                <Label value="매크로 변동 %" position="insideBottom" offset={-16} fill="var(--text-muted)" fontSize={11} />
              </XAxis>
              <YAxis type="number" dataKey="portfolio_return" name="포트폴리오 수익률" unit="%" stroke="var(--text-muted)" tick={{ fontSize: 11 }}>
                <Label value="수익률 %" angle={-90} position="insideLeft" offset={10} fill="var(--text-muted)" fontSize={11} />
              </YAxis>
              <ReferenceLine x={0} stroke="var(--text-muted)" strokeDasharray="4 2" />
              <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="4 2" />
              <Tooltip
                content={({ payload }) => {
                  if (!payload?.length) return null
                  const d = payload[0].payload
                  return (
                    <div style={{
                      background: 'var(--bg-card)', border: '1px solid var(--border)',
                      padding: '8px 12px', borderRadius: 6, fontSize: 12,
                    }}>
                      <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{d.date}</div>
                      <div style={{ color: 'var(--text-muted)' }}>
                        매크로: <span style={{ color: 'var(--text)' }}>{d.macro_delta}%</span>
                      </div>
                      <div style={{ color: 'var(--text-muted)' }}>
                        수익률: <span style={{ color: 'var(--text)' }}>{d.portfolio_return}%</span>
                      </div>
                    </div>
                  )
                }}
              />
              <Scatter data={scatterData} fill="var(--accent)" fillOpacity={0.6} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
```

---

## Task 9: App.jsx 라우팅 + 내비게이션 추가

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: import 추가**

`frontend/src/App.jsx` 상단 import 목록에 추가:

```jsx
import AnalysisHub from './pages/AnalysisHub'
```

- [ ] **Step 2: 내비게이션 배열에 항목 추가**

기존:
```jsx
{[['/', '종목관리'], ['/research', '리서치'], ['/market', '시장'], ['/guru', '구루'], ['/settings', '설정']].map(
```

변경:
```jsx
{[['/', '종목관리'], ['/research', '리서치'], ['/market', '시장'], ['/analysis', '분석'], ['/guru', '구루'], ['/settings', '설정']].map(
```

- [ ] **Step 3: Routes에 Route 추가**

`<Route path="/guru" element={<Guru />} />` 위에 추가:

```jsx
<Route path="/analysis" element={<AnalysisHub />} />
```

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/AnalysisHub.jsx frontend/src/pages/SectorTab.jsx frontend/src/pages/MacroTab.jsx frontend/src/App.jsx
git commit -m "feat: AnalysisHub 프론트엔드 추가 (섹터·매크로 탭)"
```

---

## Task 10: 최종 동작 확인

- [ ] **Step 1: 서버 실행 (터미널 2개 또는 start.sh)**

```bash
# 백엔드
cd backend && .venv/bin/python -m uvicorn main:app --reload --port 8000

# 프론트엔드 (별도 터미널)
cd frontend && npm run dev
```

- [ ] **Step 2: 확인 항목**

1. `http://localhost:5173` 접속 → 내비게이션에 "분석" 항목 표시
2. "분석" 클릭 → "섹터" / "매크로" 탭 렌더링
3. 섹터 탭: 11행 테이블, 색상 셀, 보유 종목 섹터에 ★
4. 매크로 탭: 상관계수 테이블 → 행 클릭 시 산점도 표시
5. `GET /api/analysis/sector` 브라우저 직접 호출 → JSON 응답

- [ ] **Step 3: 전체 테스트 최종 확인**

```bash
cd backend && .venv/bin/python -m pytest -q
```

Expected: 모든 테스트 pass

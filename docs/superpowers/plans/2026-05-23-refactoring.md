# Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코드 중복 제거, watchlist promote 버그 수정, Reports.jsx 컴포넌트 분리 — 동작 변경 없음.

**Architecture:** (1) cache.py의 TTL 패턴을 TTLCache 클래스로 통합. (2) watchlist promote 시 dashboard 캐시 무효화 추가. (3) Reports.jsx(1981줄)를 6개 파일로 분리.

**Tech Stack:** Python/FastAPI, pytest, React 18, Vite

---

## Task 1: cache.py — TTLCache 클래스 도입

**Files:**
- Modify: `backend/services/cache.py`
- Modify: `backend/tests/test_cache.py`

`_list_cache`와 `_dashboard_cache`가 동일한 `{"data": None, "ts": 0.0}` 구조를 반복. `TTLCache` 클래스로 통합하고 공개 API는 그대로 유지한다.

- [ ] **Step 1: 테스트가 내부 구조에 의존하는 부분 확인**

```bash
cd backend && grep -n "_list_cache\|_dashboard_cache" tests/test_cache.py
```

Expected: `_list_cache["data"]`와 `_list_cache["ts"]`를 직접 접근하는 줄 발견.

- [ ] **Step 2: 기존 테스트 먼저 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_cache.py -v
```

Expected: 전부 PASS.

- [ ] **Step 3: cache.py 전체를 새 버전으로 교체**

`backend/services/cache.py`를 아래 내용으로 교체:

```python
import time
from collections import OrderedDict
from typing import Optional


class TTLCache:
    def __init__(self, ttl: float):
        self._ttl = ttl
        self._data = None
        self._ts = 0.0

    def get(self, loader):
        now = time.time()
        if self._data is not None and now - self._ts < self._ttl:
            return self._data
        self._data = loader()
        self._ts = now
        return self._data

    def invalidate(self):
        self._data = None
        self._ts = 0.0


_snapshots: OrderedDict[str, dict] = OrderedDict()
_list_cache = TTLCache(5.0)
_dashboard_cache = TTLCache(300.0)
_MAX = 200


def get_snapshot(ticker: str, date: str, loader) -> Optional[dict]:
    key = f"{ticker.upper()}/{date}"
    if key in _snapshots:
        _snapshots.move_to_end(key)
        return _snapshots[key]
    data = loader()
    if data is not None:
        if len(_snapshots) >= _MAX:
            _snapshots.popitem(last=False)
        _snapshots[key] = data
    return data


def invalidate(ticker: str) -> None:
    prefix = f"{ticker.upper()}/"
    for k in [k for k in _snapshots if k.startswith(prefix)]:
        del _snapshots[k]
    invalidate_list()
    invalidate_dashboard()


def invalidate_dashboard() -> None:
    _dashboard_cache.invalidate()


def get_dashboard(loader) -> list:
    return _dashboard_cache.get(loader)


def invalidate_list() -> None:
    _list_cache.invalidate()


def get_list(loader) -> dict:
    return _list_cache.get(loader)
```

- [ ] **Step 4: test_cache.py에서 내부 접근 부분 수정**

`_clear()` 헬퍼가 `_list_cache["data"]` / `_list_cache["ts"]`를 직접 접근하므로 `invalidate_*` 공개 함수로 교체:

```python
def _clear():
    import services.cache as c
    c._snapshots.clear()
    c.invalidate_list()
    c.invalidate_dashboard()
```

`test_get_list_refreshes_after_ttl`에서 `monkeypatch.setattr(c, "_list_cache", ...)` 패턴도 TTLCache 내부로 교체:

```python
def test_get_list_refreshes_after_ttl(monkeypatch):
    import services.cache as c
    _clear()
    calls = []
    def loader():
        calls.append(1)
        return {"data": "list"}
    c.get_list(loader)
    # ts를 0으로 만들어 TTL 만료 시뮬레이션
    c._list_cache._ts = 0.0
    c.get_list(loader)
    assert len(calls) == 2
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_cache.py -v
```

Expected: 전부 PASS.

- [ ] **Step 6: 전체 테스트 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest -v
```

Expected: 전부 PASS.

- [ ] **Step 7: 커밋**

```bash
git add backend/services/cache.py backend/tests/test_cache.py
git commit -m "refactor: unify TTL cache pattern with TTLCache class in cache.py"
```

---

## Task 2: watchlist.py — promote 시 dashboard 캐시 무효화

**Files:**
- Modify: `backend/routers/watchlist.py`
- Modify: `backend/tests/test_watchlist_router.py`

`promote_to_holdings`가 watchlist → holdings로 이동시키면서 `invalidate_dashboard()` 미호출. dashboard 5분 캐시에 새 종목이 나타나지 않는 버그.

- [ ] **Step 1: 버그 재현 테스트 작성**

`backend/tests/test_watchlist_router.py`의 `test_promote_moves_ticker_to_holdings` 아래에 추가:

```python
def test_promote_invalidates_dashboard_cache():
    import services.cache as cache_svc
    from unittest.mock import patch
    with patch("routers.watchlist.cache_svc") as mock_cache:
        with patch("services.storage.get_watchlist_tickers", return_value=["NVDA"]), \
             patch("services.storage.get_holdings", return_value=[]), \
             patch("services.storage.get_stocks", return_value=[{"ticker": "NVDA", "name": "Nvidia", "market": "US", "exchange": ""}]), \
             patch("services.storage.save_watchlist_tickers"), \
             patch("services.storage.save_holdings"), \
             patch("routers.watchlist.calendar_router.clear_cache"), \
             patch("routers.calendar.clear_cache"):
            resp = client.post("/api/watchlist/NVDA/promote", json={"quantity": 10, "avg_cost": 500.0})
        assert resp.status_code == 200
        mock_cache.invalidate_dashboard.assert_called_once()
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_watchlist_router.py::test_promote_invalidates_dashboard_cache -v
```

Expected: FAIL — `invalidate_dashboard` not called.

- [ ] **Step 3: watchlist.py 수정**

`backend/routers/watchlist.py` 상단 import에 추가:
```python
from services import cache as cache_svc
```

`promote_to_holdings` 함수에서 `return` 직전에 추가:
```python
    calendar_router.clear_cache()
    cache_svc.invalidate_dashboard()   # ← 추가

    return {**stock_data, "quantity": payload.quantity, "avg_cost": payload.avg_cost}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_watchlist_router.py -v
```

Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add backend/routers/watchlist.py backend/tests/test_watchlist_router.py
git commit -m "fix: invalidate dashboard cache on watchlist promote to holdings"
```

---

## Task 3: stocks.py — `_latest_snapshot` 모듈 레벨 이동

**Files:**
- Modify: `backend/routers/stocks.py`

`_latest_snapshot` 함수가 `get_dashboard` 핸들러 내부에 중첩 정의되어 있어 단위 테스트 불가.

- [ ] **Step 1: `_latest_snapshot` 추출**

`backend/routers/stocks.py`에서 `REPORTS_DIR` 정의 바로 아래(현재 `router = APIRouter(...)` 전)에 함수 추가:

```python
def _latest_snapshot(ticker: str) -> tuple:
    for base in (SNAPSHOTS_DIR, REPORTS_DIR):
        ticker_dir = base / ticker
        if ticker_dir.exists():
            dates = sorted([f.stem for f in ticker_dir.glob("*.json")], reverse=True)
            if dates:
                path = ticker_dir / f"{dates[0]}.json"
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                    return data, dates[0]
                except Exception:
                    pass
    return None, None
```

그리고 `get_dashboard` 안의 중첩 함수 `_latest_snapshot` 정의 블록(9줄)을 삭제한다.

- [ ] **Step 2: 테스트 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_stocks_router.py -v
```

Expected: 전부 PASS.

- [ ] **Step 3: 커밋**

```bash
git add backend/routers/stocks.py
git commit -m "refactor: move _latest_snapshot to module level in stocks.py"
```

---

## Task 4: Reports.jsx — 공유 헬퍼 분리

**Files:**
- Create: `frontend/src/components/reports/reportUtils.js`

여러 컴포넌트에서 공용으로 쓰는 상수, 순수 함수, 소형 컴포넌트를 한 파일에 모은다.

`Reports.jsx`의 1~287줄 중 여러 컴포넌트가 사용하는 항목:

| 이름 | 종류 | 사용처 |
|------|------|--------|
| `TH` | style 상수 | Reports(list), DetailTab(RsiTable), Sections, HistoryTab |
| `TD` | style 상수 | 위와 동일 |
| `fmtN` | 함수 | DetailTab(RsiTable) |
| `rsiColor` | 함수 | DetailTab(RsiTable) |
| `fmtGap` | 함수 | DetailTab(GapCell) |
| `GapCell` | 컴포넌트 | DetailTab(RsiTable) |
| `TargetTooltip` | 컴포넌트 | Reports(list view) |
| `MetricCard` | 컴포넌트 | ConsensusChart |
| `_weather` | 함수 | ConsensusChart, DetailTab, FinancialsChart, Reports |
| `overallWeather` | 함수 | Reports(list), DetailTab |
| `SectionTitle` | 컴포넌트 | ConsensusChart, DetailTab, FinancialsChart |

- [ ] **Step 1: `frontend/src/components/reports/` 디렉토리 생성 확인**

```bash
mkdir -p frontend/src/components/reports
```

- [ ] **Step 2: `reportUtils.js` 생성**

`frontend/src/components/reports/reportUtils.js` 파일 생성:

```js
import { useState, useRef } from 'react'
import { fmtPrice as fmt } from '../../utils'

export const TH = { padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', fontSize: 11, color: 'var(--text-muted)', position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-surface)' }
export const TD = { padding: '5px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)', fontSize: 12 }

export const fmtN = (val) => val != null ? val : 'N/A'

export const rsiColor = (rsi) => {
  if (rsi == null) return 'var(--text-muted)'
  const hue = Math.round(120 - (rsi / 100) * 120)
  return `hsl(${hue}, 60%, 60%)`
}

export const fmtGap = (target, price) => {
  if (target == null || !price) return null
  const pct = (target - price) / price * 100
  return { text: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, positive: pct >= 0 }
}

export const _weather = (score) => {
  if (score <= 0) return { icon: '☀️', label: '맑음' }
  if (score <= 1) return { icon: '⛅', label: '구름 조금' }
  if (score <= 2) return { icon: '☁️', label: '흐림' }
  return { icon: '🌧️', label: '비' }
}

export const overallWeather = (summary) => {
  if (!summary) return null
  const scores = []
  if (summary.price && summary.target_mean) {
    const gap = (summary.target_mean - summary.price) / summary.price * 100
    const total = (summary.buy ?? 0) + (summary.hold ?? 0) + (summary.sell ?? 0)
    const buyPct = total > 0 ? (summary.buy ?? 0) / total * 100 : 50
    if (gap >= 15 && buyPct >= 60) scores.push(0)
    else if (gap >= 5 && buyPct >= 45) scores.push(1)
    else if (gap >= -5) scores.push(2)
    else scores.push(3)
  }
  const rsi = summary.daily_rsi?.rsi
  if (rsi != null) {
    if (rsi < 30) scores.push(0)
    else if (rsi < 45) scores.push(1)
    else if (rsi < 65) scores.push(2)
    else scores.push(3)
  }
  if (!scores.length) return null
  return _weather(Math.round(scores.reduce((a, b) => a + b, 0) / scores.length))
}

export const SectionTitle = ({ children, weather }) => (
  <div style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 12, letterSpacing: '0.3px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
    <span>{children}</span>
    {weather && <span title={weather.label} style={{ fontSize: 14, lineHeight: 1 }}>{weather.icon}</span>}
  </div>
)

export const MetricCard = ({ label, value, sub, valueColor }) => (
  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px' }}>
    <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 2 }}>{label}</div>
    <div style={{ fontWeight: 700, fontSize: 12, color: valueColor ?? 'var(--text)' }}>{value}</div>
    {sub && <div style={{ color: 'var(--text-muted)', fontSize: 9, marginTop: 1 }}>{sub}</div>}
  </div>
)

export const GapCell = ({ target, price, baseColor, highlight, market }) => {
  const gap = fmtGap(target, price)
  return (
    <td style={{ ...TD, color: baseColor, background: highlight ? 'var(--bg-hover)' : undefined, border: highlight ? '2px solid var(--accent)' : undefined, fontWeight: highlight ? 700 : undefined }}>
      {target != null ? <>{fmt(target, market)}{gap && <span style={{ color: gap.positive ? '#81c784' : '#ef9a9a' }}>({gap.text})</span>}</> : 'N/A'}
    </td>
  )
}

export function TargetTooltip({ s }) {
  const [visible, setVisible] = useState(false)
  const ref = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const total = (s?.buy ?? 0) + (s?.hold ?? 0) + (s?.sell ?? 0)
  const pct = (n) => total > 0 ? ` (${Math.round(n / total * 100)}%)` : ''
  const gap = s?.target_mean != null && s?.price != null
    ? ((s.target_mean - s.price) / s.price * 100)
    : null

  const handleMouseEnter = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left })
    setVisible(true)
  }

  return (
    <div ref={ref} style={{ display: 'inline-block', position: 'relative' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setVisible(false)}
    >
      {s ? fmt(s.target_mean, s.market) : 'N/A'}
      {gap != null && <div style={{ color: gap >= 0 ? '#81c784' : '#ef9a9a', fontSize: 10 }}>{gap >= 0 ? '+' : ''}{gap.toFixed(1)}%</div>}
      {visible && s?.target_mean != null && (
        <div style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          zIndex: 9999,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '10px 14px',
          minWidth: 200,
          fontSize: 12,
          color: 'var(--text)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          pointerEvents: 'none',
          lineHeight: 1.8,
        }}>
          <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 6, fontSize: 11 }}>목표가 근거</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
            <span style={{ color: 'var(--text-muted)' }}>평균</span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{fmt(s.target_mean, s.market)}{gap != null && <span style={{ color: gap >= 0 ? '#81c784' : '#ef9a9a', marginLeft: 4 }}>{gap >= 0 ? '+' : ''}{gap.toFixed(1)}%</span>}</span>
            <span style={{ color: 'var(--text-muted)' }}>최고</span>
            <span style={{ color: '#81c784' }}>{fmt(s.target_high, s.market)}</span>
            <span style={{ color: 'var(--text-muted)' }}>최저</span>
            <span style={{ color: '#ef9a9a' }}>{fmt(s.target_low, s.market)}</span>
            <span style={{ color: 'var(--text-muted)' }}>애널리스트</span>
            <span>{total > 0 ? `${total}명` : 'N/A'}</span>
            <span style={{ color: 'var(--text-muted)' }}>Buy</span>
            <span style={{ color: '#81c784' }}>{s.buy ?? 0}{pct(s.buy ?? 0)}</span>
            <span style={{ color: 'var(--text-muted)' }}>Hold</span>
            <span>{s.hold ?? 0}{pct(s.hold ?? 0)}</span>
            <span style={{ color: 'var(--text-muted)' }}>Sell</span>
            <span style={{ color: '#ef9a9a' }}>{s.sell ?? 0}{pct(s.sell ?? 0)}</span>
            {s.finviz_recom != null && <>
              <span style={{ color: 'var(--text-muted)' }}>Finviz</span>
              <span>{s.finviz_recom} <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>(1=강매수)</span></span>
            </>}
          </div>
        </div>
      )}
    </div>
  )
}
```

> **주의:** `_weather`/`overallWeather`의 구현이 Reports.jsx 원본과 정확히 일치하는지 확인. 원본 Reports.jsx 252~280줄을 참조.

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/components/reports/reportUtils.js
git commit -m "refactor: extract shared report helpers to reportUtils.js"
```

---

## Task 5: ConsensusChart.jsx 추출

**Files:**
- Create: `frontend/src/components/reports/ConsensusChart.jsx`
- Modify: `frontend/src/pages/Reports.jsx` (ConsensusChart 정의 제거, import 추가)

Reports.jsx 289~654줄의 `ConsensusChart` 함수.

- [ ] **Step 1: `ConsensusChart.jsx` 생성**

`frontend/src/components/reports/ConsensusChart.jsx`를 생성한다. 내용은 Reports.jsx 289~654줄을 그대로 복사하되, 파일 상단에 필요한 import를 추가한다:

```js
import { useState, useEffect, useCallback, useMemo } from 'react'
import axios from 'axios'
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LabelList, Legend } from 'recharts'
import { fmtPrice as fmt } from '../../utils'
import { TH, TD, fmtN, _weather, SectionTitle, MetricCard } from './reportUtils'

export default function ConsensusChart({ ticker, market }) {
  // ... Reports.jsx 290~654줄 그대로
}
```

마지막 줄에 `export default`가 붙어 있어야 한다.

- [ ] **Step 2: Reports.jsx에서 ConsensusChart 제거 후 import 교체**

Reports.jsx에서:
1. 289~654줄(ConsensusChart 함수 전체) 삭제
2. 파일 상단 import 블록 아래에 추가:
   ```js
   import ConsensusChart from '../components/reports/ConsensusChart'
   ```

- [ ] **Step 3: 개발 서버 실행 후 Reports 페이지 확인**

```bash
cd frontend && npm run dev
```

브라우저에서 Reports 페이지 → 종목 선택 → Summary 탭 → ConsensusChart 정상 렌더링 확인.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/components/reports/ConsensusChart.jsx frontend/src/pages/Reports.jsx
git commit -m "refactor: extract ConsensusChart from Reports.jsx"
```

---

## Task 6: FinancialsChart.jsx 추출

**Files:**
- Create: `frontend/src/components/reports/FinancialsChart.jsx`
- Modify: `frontend/src/pages/Reports.jsx`

Reports.jsx 788~1163줄의 `FinancialsChart` 함수.
FinancialsChart는 내부에서 자체 `TH`, `TD`를 React 컴포넌트로 재정의한다 (reportUtils의 style 상수와 별개). 내부 정의 그대로 유지한다.

- [ ] **Step 1: `FinancialsChart.jsx` 생성**

`frontend/src/components/reports/FinancialsChart.jsx` 생성:

```js
import { useState } from 'react'
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { fmtPrice as fmt } from '../../utils'
import { _weather, SectionTitle } from './reportUtils'

export default function FinancialsChart({ financials, financialsAnnual, market }) {
  // ... Reports.jsx 789~1163줄 그대로
}
```

- [ ] **Step 2: Reports.jsx에서 FinancialsChart 제거 후 import 교체**

Reports.jsx에서:
1. 788~1163줄(FinancialsChart 함수 전체) 삭제
2. import 블록에 추가:
   ```js
   import FinancialsChart from '../components/reports/FinancialsChart'
   ```

- [ ] **Step 3: 브라우저에서 Financials 탭 정상 동작 확인**

Reports 페이지 → 종목 선택 → Summary 탭 하단의 재무 차트 확인.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/components/reports/FinancialsChart.jsx frontend/src/pages/Reports.jsx
git commit -m "refactor: extract FinancialsChart from Reports.jsx"
```

---

## Task 7: DetailTab.jsx 추출

**Files:**
- Create: `frontend/src/components/reports/DetailTab.jsx`
- Modify: `frontend/src/pages/Reports.jsx`

Reports.jsx의 `PriceLevelChart`(99~181줄), `RsiTable`(183~242줄), `DetailSummaryTab`(656~787줄)을 하나의 파일로 묶는다.

- [ ] **Step 1: `DetailTab.jsx` 생성**

`frontend/src/components/reports/DetailTab.jsx` 생성:

```js
import { useState } from 'react'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'
import { fmtPrice as fmt } from '../../utils'
import { TH, TD, fmtN, rsiColor, GapCell, SectionTitle, _weather } from './reportUtils'
import ConsensusChart from './ConsensusChart'
import FinancialsChart from './FinancialsChart'

function PriceLevelChart({ rsiData, price, vp, target, title, market }) {
  // ... Reports.jsx 100~181줄 그대로
}

function RsiTable({ dailyRsi, weeklyRsi, monthlyRsi, price, vp, target, market }) {
  // ... Reports.jsx 183~242줄 그대로
}

export default function DetailSummaryTab({ summary, ticker }) {
  // ... Reports.jsx 656~785줄 그대로
}
```

- [ ] **Step 2: Reports.jsx에서 3개 함수 제거 후 import 교체**

Reports.jsx에서:
1. 99~181줄(`PriceLevelChart`), 183~242줄(`RsiTable`), 656~785줄(`DetailSummaryTab`) 삭제
2. 99줄 위치에 있던 이 함수들이 삭제됨으로써 `MetricCard`(244), `_weather`(252), `overallWeather`(259), `SectionTitle`(282) 정의들이 남게 됨 — 이 중 `MetricCard`, `SectionTitle`, `_weather`, `overallWeather`는 이미 `reportUtils.js`에 있으므로 Reports.jsx에서 해당 정의도 삭제한다.
3. import 블록에 추가:
   ```js
   import DetailSummaryTab from '../components/reports/DetailTab'
   ```

- [ ] **Step 3: 브라우저에서 Summary 탭 전체 확인**

Reports 페이지 → 종목 선택 → Summary 탭 → PriceLevelChart, RsiTable, ConsensusChart 정상 표시.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/components/reports/DetailTab.jsx frontend/src/pages/Reports.jsx
git commit -m "refactor: extract PriceLevelChart, RsiTable, DetailSummaryTab to DetailTab.jsx"
```

---

## Task 8: HistoryTab.jsx 추출

**Files:**
- Create: `frontend/src/components/reports/HistoryTab.jsx`
- Modify: `frontend/src/pages/Reports.jsx`

Reports.jsx 1239~1397줄의 `HistoryTab` 함수.

- [ ] **Step 1: `HistoryTab.jsx` 생성**

`frontend/src/components/reports/HistoryTab.jsx` 생성:

```js
import { useState, useEffect } from 'react'
import axios from 'axios'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { fmtPrice as fmt } from '../../utils'
import { TH, TD } from './reportUtils'

export default function HistoryTab({ ticker, dates, market }) {
  // ... Reports.jsx 1240~1397줄 그대로
}
```

- [ ] **Step 2: Reports.jsx에서 HistoryTab 제거 후 import 교체**

Reports.jsx에서:
1. 1239~1397줄 삭제
2. import 블록에 추가:
   ```js
   import HistoryTab from '../components/reports/HistoryTab'
   ```

- [ ] **Step 3: 브라우저에서 History 탭 확인**

Reports 페이지 → 종목 선택 → History 탭 정상 동작 확인.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/components/reports/HistoryTab.jsx frontend/src/pages/Reports.jsx
git commit -m "refactor: extract HistoryTab from Reports.jsx"
```

---

## Task 9: Sections.jsx 추출

**Files:**
- Create: `frontend/src/components/reports/Sections.jsx`
- Modify: `frontend/src/pages/Reports.jsx`

Reports.jsx의 `ReportSectionText`, `ReportSectionCompetitors`, `ReportSectionNews`.

- [ ] **Step 1: `Sections.jsx` 생성**

`frontend/src/components/reports/Sections.jsx` 생성:

```js
import { fmtPrice as fmt } from '../../utils'
import { TH, TD } from './reportUtils'

export function ReportSectionText({ title, text }) {
  // ... Reports.jsx 1164~1172줄 그대로
}

export function ReportSectionCompetitors({ competitors, market }) {
  // ... Reports.jsx 1174~1211줄 그대로
}

export function ReportSectionNews({ disclosures, news }) {
  // ... Reports.jsx 1213~1237줄 그대로
}
```

- [ ] **Step 2: Reports.jsx에서 3개 함수 제거 후 import 교체**

Reports.jsx에서:
1. 1164~1237줄 삭제
2. import 블록에 추가:
   ```js
   import { ReportSectionText, ReportSectionCompetitors, ReportSectionNews } from '../components/reports/Sections'
   ```

- [ ] **Step 3: 브라우저에서 Summary 탭 하단 섹션 확인**

Reports 페이지 → 종목 선택 → Summary 탭 → 사업영역, 최근공시 섹션 표시 확인.

- [ ] **Step 4: Reports.jsx에서 사용하지 않게 된 import 정리**

Reports.jsx 파일 최상단 import에서 더 이상 쓰지 않는 항목 제거:
- `TH`, `TD`, `fmtN`, `rsiColor`, `fmtGap`, `GapCell`, `TargetTooltip`, `_weather`, `overallWeather`, `SectionTitle`, `MetricCard` 등 reportUtils.js에서 온 것 중 Reports.jsx에서 직접 쓰는 것만 남긴다.
- `TargetTooltip`, `overallWeather`는 Reports 메인(list view)에서 여전히 사용하므로 남긴다.
- `TH`, `TD`도 list view 테이블에서 사용하므로 남긴다.

최종 Reports.jsx 상단 import:
```js
import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import { TAB_STYLE, fmtPrice as fmt } from '../utils'
import { TH, TD, TargetTooltip, overallWeather } from '../components/reports/reportUtils'
import ConsensusChart from '../components/reports/ConsensusChart'
import DetailSummaryTab from '../components/reports/DetailTab'
import FinancialsChart from '../components/reports/FinancialsChart'
import HistoryTab from '../components/reports/HistoryTab'
import { ReportSectionText, ReportSectionCompetitors, ReportSectionNews } from '../components/reports/Sections'
```

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/reports/Sections.jsx frontend/src/pages/Reports.jsx
git commit -m "refactor: extract ReportSection* components to Sections.jsx, clean up Reports.jsx imports"
```

---

## Task 10: 최종 검증 및 줄 수 확인

- [ ] **Step 1: 백엔드 전체 테스트**

```bash
cd backend && .venv/bin/python -m pytest -v
```

Expected: 전부 PASS.

- [ ] **Step 2: 프론트엔드 파일 크기 확인**

```bash
wc -l frontend/src/pages/Reports.jsx frontend/src/components/reports/*.jsx frontend/src/components/reports/reportUtils.js
```

Expected: Reports.jsx 400줄 내외, 각 컴포넌트 파일 400줄 이하.

- [ ] **Step 3: 브라우저 전체 탭 검증**

Reports 페이지에서 다음을 순서대로 확인:
1. 종목 목록(보유/관심) 표시
2. 종목 클릭 → Summary 탭: 컨센서스, PriceLevelChart, RsiTable, FinancialsChart
3. Summary 탭 하단: 사업영역(competitors), 최근공시/뉴스
4. Consensus 탭: ConsensusChart 차트
5. History 탭: 날짜 선택, 트렌드, 비교
6. Portfolio 페이지 → 대시보드 탭 → 종목 promote 후 새로고침 시 새 종목 표시

- [ ] **Step 4: 최종 커밋**

```bash
git push origin feat/dashboard-cache
```

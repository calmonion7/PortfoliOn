# 이벤트 캘린더 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보유종목·관심종목의 실적 발표일·배당락일을 월간 그리드 캘린더로 표시하는 `/calendar` 페이지 추가

**Architecture:** 백엔드 `GET /api/calendar?month=YYYY-MM` 엔드포인트가 yfinance로 이벤트를 수집하고 6시간 인메모리 캐시로 반환. 프론트는 보유/관심 탭 전환 + 월 이동이 가능한 월간 그리드 캘린더.

**Tech Stack:** Python/FastAPI, yfinance, React 18, axios

---

## File Map

| 파일 | 작업 |
|------|------|
| `backend/routers/calendar.py` | 신규 생성 — `/api/calendar` 엔드포인트 |
| `backend/main.py` | 수정 — calendar 라우터 등록 |
| `backend/tests/test_calendar_router.py` | 신규 생성 — 라우터 테스트 |
| `frontend/src/pages/Calendar.jsx` | 신규 생성 — 캘린더 페이지 |
| `frontend/src/App.jsx` | 수정 — `/calendar` 라우트 + 네비 링크 추가 |

---

### Task 1: 백엔드 calendar 라우터

**Files:**
- Create: `backend/routers/calendar.py`
- Create: `backend/tests/test_calendar_router.py`
- Modify: `backend/main.py`

- [ ] **Step 1: 테스트 파일 작성**

`backend/tests/test_calendar_router.py` 생성:

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from datetime import date
import pandas as pd

from routers.calendar import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)

SAMPLE_PORTFOLIO = {
    "stocks": [{"ticker": "AAPL", "type": "holding", "name": "Apple"}],
    "watchlist": [{"ticker": "TSLA", "type": "watchlist", "name": "Tesla"}],
}


def _mock_ticker(ticker):
    m = MagicMock()
    if ticker == "AAPL":
        m.calendar = {"Earnings Date": [date(2026, 5, 20)]}
        m.dividends = pd.Series(
            [0.25, 0.25, 0.25],
            index=pd.DatetimeIndex([
                pd.Timestamp("2025-08-09", tz="UTC"),
                pd.Timestamp("2025-11-07", tz="UTC"),
                pd.Timestamp("2026-02-07", tz="UTC"),
            ]),
        )
    else:
        m.calendar = {}
        m.dividends = pd.Series([], dtype=float)
    return m


def test_calendar_returns_earnings_event():
    with patch("routers.calendar.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("routers.calendar.yf.Ticker", side_effect=_mock_ticker):
        resp = client.get("/api/calendar?month=2026-05")
    assert resp.status_code == 200
    events = resp.json()["events"]
    earnings = [e for e in events if e["type"] == "earnings"]
    assert len(earnings) == 1
    assert earnings[0]["ticker"] == "AAPL"
    assert earnings[0]["date"] == "2026-05-20"
    assert earnings[0]["stock_type"] == "holding"


def test_calendar_returns_dividend_event():
    # AAPL: last div 2026-02-07, avg interval ~91 days → next ~2026-05-09 (in May)
    with patch("routers.calendar.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("routers.calendar.yf.Ticker", side_effect=_mock_ticker):
        resp = client.get("/api/calendar?month=2026-05")
    events = resp.json()["events"]
    divs = [e for e in events if e["type"] == "dividend"]
    assert len(divs) == 1
    assert divs[0]["ticker"] == "AAPL"
    assert divs[0]["stock_type"] == "holding"


def test_calendar_empty_for_ticker_with_no_data():
    with patch("routers.calendar.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("routers.calendar.yf.Ticker", side_effect=_mock_ticker):
        resp = client.get("/api/calendar?month=2026-07")
    assert resp.status_code == 200
    assert resp.json()["events"] == []


def test_calendar_invalid_month_returns_422():
    resp = client.get("/api/calendar?month=not-a-month")
    assert resp.status_code == 422


def test_calendar_tsla_watchlist_stock_type():
    # TSLA has no events in _mock_ticker, so add earnings to it
    portfolio = {
        "stocks": [],
        "watchlist": [{"ticker": "TSLA", "type": "watchlist", "name": "Tesla"}],
    }
    mock = MagicMock()
    mock.calendar = {"Earnings Date": [date(2026, 5, 15)]}
    mock.dividends = pd.Series([], dtype=float)
    with patch("routers.calendar.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.calendar.yf.Ticker", return_value=mock):
        resp = client.get("/api/calendar?month=2026-05")
    events = resp.json()["events"]
    assert events[0]["stock_type"] == "watchlist"
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_calendar_router.py -v 2>&1 | head -30
```

Expected: `ModuleNotFoundError` 또는 `ImportError` (라우터 파일 없음)

- [ ] **Step 3: `backend/routers/calendar.py` 작성**

```python
from __future__ import annotations
import time
import calendar as cal_lib
from datetime import date, timedelta
from fastapi import APIRouter, Query
import yfinance as yf
from services import storage

router = APIRouter(prefix="/api", tags=["calendar"])

_cache: dict[str, tuple[list, float]] = {}
_TTL = 6 * 3600


@router.get("/calendar")
def get_calendar(month: str = Query(..., pattern=r"^\d{4}-\d{2}$")):
    return {"events": _get_events(month)}


def _get_events(month: str) -> list[dict]:
    now = time.time()
    if month in _cache:
        data, ts = _cache[month]
        if now - ts < _TTL:
            return data

    year, mon = map(int, month.split("-"))
    month_start = date(year, mon, 1)
    month_end = date(year, mon, cal_lib.monthrange(year, mon)[1])

    portfolio = storage.get_full_portfolio()
    all_stocks = (
        [{"ticker": s["ticker"], "stock_type": "holding"} for s in portfolio["stocks"]]
        + [{"ticker": s["ticker"], "stock_type": "watchlist"} for s in portfolio["watchlist"]]
    )

    events: list[dict] = []
    for stock in all_stocks:
        try:
            t = yf.Ticker(stock["ticker"])
            _collect_earnings(t, stock["ticker"], stock["stock_type"], month_start, month_end, events)
            _collect_dividend(t, stock["ticker"], stock["stock_type"], month_start, month_end, events)
        except Exception:
            continue

    _cache[month] = (events, now)
    return events


def _collect_earnings(t, ticker, stock_type, start, end, events):
    cal = t.calendar
    if not cal or "Earnings Date" not in cal:
        return
    dates = cal["Earnings Date"]
    if not isinstance(dates, list):
        dates = [dates]
    for d in dates:
        if hasattr(d, "date"):
            d = d.date()
        if isinstance(d, date) and start <= d <= end:
            events.append({
                "date": d.isoformat(),
                "ticker": ticker,
                "type": "earnings",
                "stock_type": stock_type,
            })


def _collect_dividend(t, ticker, stock_type, start, end, events):
    divs = t.dividends
    if divs is None or len(divs) < 2:
        return
    dates = [d.date() if hasattr(d, "date") else d for d in divs.index[-4:]]
    if len(dates) < 2:
        return
    intervals = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
    avg_interval = round(sum(intervals) / len(intervals))
    next_div = dates[-1] + timedelta(days=avg_interval)
    if start <= next_div <= end:
        events.append({
            "date": next_div.isoformat(),
            "ticker": ticker,
            "type": "dividend",
            "stock_type": stock_type,
        })
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_calendar_router.py -v
```

Expected: 5 tests PASSED

- [ ] **Step 5: `backend/main.py`에 라우터 등록**

`from routers import portfolio, report, watchlist, stocks, guru` 줄을:

```python
from routers import portfolio, report, watchlist, stocks, guru, calendar
```

로 변경하고, `app.include_router(guru.router)` 아래에 추가:

```python
app.include_router(calendar.router)
```

- [ ] **Step 6: 전체 백엔드 테스트 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest --tb=short -q 2>&1 | tail -10
```

Expected: 기존 테스트 모두 PASSED, 실패 없음

- [ ] **Step 7: 커밋**

```bash
git add backend/routers/calendar.py backend/tests/test_calendar_router.py backend/main.py
git commit -m "feat: add GET /api/calendar endpoint with earnings and dividend events"
```

---

### Task 2: 프론트엔드 Calendar 페이지

**Files:**
- Create: `frontend/src/pages/Calendar.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: `frontend/src/pages/Calendar.jsx` 작성**

```jsx
import { useState, useEffect } from 'react'
import axios from 'axios'
import { TAB_STYLE } from '../utils'

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

function MonthGrid({ year, month, events }) {
  const firstDay = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const byDate = {}
  for (const e of events) {
    if (!byDate[e.date]) byDate[e.date] = []
    byDate[e.date].push(e)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: 'var(--border)' }}>
      {DAY_LABELS.map(d => (
        <div key={d} style={{ background: 'var(--bg-surface)', padding: '6px', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
          {d}
        </div>
      ))}
      {cells.map((day, i) => {
        const dateStr = day
          ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          : null
        const dayEvents = dateStr ? (byDate[dateStr] || []) : []
        return (
          <div key={i} style={{ background: day ? 'var(--bg-card)' : 'var(--bg)', minHeight: 72, padding: 4 }}>
            {day && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{day}</div>
            )}
            {dayEvents.map((e, j) => (
              <div
                key={j}
                style={{
                  fontSize: 10,
                  padding: '1px 4px',
                  borderRadius: 3,
                  marginBottom: 2,
                  background: e.type === 'earnings' ? '#1a2a4a' : '#1a3a2a',
                  color: e.type === 'earnings' ? '#4fc3f7' : '#81c784',
                  border: `1px solid ${e.type === 'earnings' ? '#2a4a6a' : '#2e6b4a'}`,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {e.ticker} {e.type === 'earnings' ? '실적' : '배당락'}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export default function Calendar() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [stockType, setStockType] = useState('holding')
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    const m = `${year}-${String(month).padStart(2, '0')}`
    axios.get(`/api/calendar?month=${m}`)
      .then(r => setEvents(r.data.events))
      .finally(() => setLoading(false))
  }, [year, month])

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  const filtered = events.filter(e => e.stock_type === stockType)

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {[['holding', '보유종목'], ['watchlist', '관심종목']].map(([key, label]) => (
            <button key={key} onClick={() => setStockType(key)} style={TAB_STYLE(stockType === key)}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={prevMonth}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', padding: '2px 10px', borderRadius: 4, fontSize: 16 }}
          >‹</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', minWidth: 90, textAlign: 'center' }}>
            {year}년 {month}월
          </span>
          <button
            onClick={nextMonth}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', padding: '2px 10px', borderRadius: 4, fontSize: 16 }}
          >›</button>
        </div>
      </div>

      {loading
        ? <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>불러오는 중...</div>
        : <MonthGrid year={year} month={month} events={filtered} />
      }

      <div style={{ marginTop: 10, display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
        <span style={{ background: '#1a2a4a', color: '#4fc3f7', padding: '1px 6px', borderRadius: 3, border: '1px solid #2a4a6a' }}>실적</span>
        <span style={{ background: '#1a3a2a', color: '#81c784', padding: '1px 6px', borderRadius: 3, border: '1px solid #2e6b4a' }}>배당락</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `frontend/src/App.jsx` 수정**

`import Settings from './pages/Settings'` 아래에 추가:

```jsx
import Calendar from './pages/Calendar'
```

네비 링크 배열 `[['/', '종목 관리'], ['/reports', '리포트'], ['/guru', '구루'], ['/settings', '설정']]`을:

```jsx
[['/', '종목 관리'], ['/reports', '리포트'], ['/calendar', '캘린더'], ['/guru', '구루'], ['/settings', '설정']]
```

로 변경.

`<Route path="/guru" ...>` 위에 추가:

```jsx
<Route path="/calendar" element={<Calendar />} />
```

- [ ] **Step 3: 개발 서버 동작 확인**

```bash
# 백엔드
cd backend && .venv/bin/python -m uvicorn main:app --reload --port 8000

# 프론트엔드 (별도 터미널)
cd frontend && npm run dev
```

브라우저에서 `http://localhost:5173/calendar` 접속:
- "캘린더" 네비 링크 표시 확인
- 보유종목 / 관심종목 탭 전환 확인
- 월 이동(‹ ›) 버튼 동작 확인
- 이벤트 뱃지 (실적=파란색, 배당락=초록색) 표시 확인

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/Calendar.jsx frontend/src/App.jsx
git commit -m "feat: add /calendar page with monthly event grid for earnings and dividends"
```

# Daily Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Daily Digest page and scheduled job that summarizes portfolio price changes, upcoming events, and anomalies — with optional Telegram delivery.

**Architecture:** `digest_service.py` generates snapshots to `backend/data/digest/YYYY-MM-DD.json` reusing existing yfinance and calendar logic. `digest_router.py` exposes two endpoints. APScheduler runs the job at 08:00 KST daily and calls `send_telegram()` if env vars are set.

**Tech Stack:** Python/FastAPI, APScheduler + yfinance + requests (backend), React 18 + axios (frontend), plain CSS

---

## File Map

| Action  | File                                         |
|---------|----------------------------------------------|
| Create  | `backend/services/digest_service.py`         |
| Create  | `backend/routers/digest.py`                  |
| Create  | `backend/tests/test_digest_service.py`       |
| Create  | `backend/tests/test_digest_router.py`        |
| Create  | `frontend/src/pages/Digest.jsx`              |
| Modify  | `backend/main.py`                            |
| Modify  | `backend/scheduler.py`                       |
| Modify  | `frontend/src/App.jsx`                       |

---

## Task 1: digest_service.py — core logic

**Files:**
- Create: `backend/services/digest_service.py`
- Create: `backend/tests/test_digest_service.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_digest_service.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import json
from datetime import date
from unittest.mock import patch, MagicMock
import pandas as pd

SAMPLE_PORTFOLIO = {
    "stocks": [
        {"ticker": "AAPL", "name": "Apple", "quantity": 10, "avg_cost": 150.0, "market": "US", "exchange": ""},
    ],
    "watchlist": [
        {"ticker": "TSLA", "name": "Tesla", "market": "US", "exchange": ""},
    ],
}

SAMPLE_DIGEST = {
    "date": "2026-05-23",
    "generated_at": "2026-05-23T08:00:00+09:00",
    "portfolio_summary": {"total_value_usd": 1020.0, "daily_change_pct": 2.0, "daily_change_usd": 20.0},
    "stocks": [{"ticker": "AAPL", "name": "Apple", "change_pct": 2.0, "is_holding": True, "is_anomaly": False}],
    "events_7d": [],
    "anomalies": [],
}


def _normal_ticker(symbol):
    m = MagicMock()
    m.history.return_value = pd.DataFrame(
        {"Close": [100.0, 102.0]},
        index=pd.DatetimeIndex(["2026-05-22", "2026-05-23"]),
    )
    return m


def _big_drop_ticker(symbol):
    m = MagicMock()
    m.history.return_value = pd.DataFrame(
        {"Close": [100.0, 94.0]},
        index=pd.DatetimeIndex(["2026-05-22", "2026-05-23"]),
    )
    return m


def test_generate_stocks_list(tmp_path):
    import services.digest_service as ds
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("services.digest_service.yf.Ticker", side_effect=_normal_ticker), \
         patch("services.digest_service._get_events", return_value=[]):
        result = ds.generate(today=date(2026, 5, 23))
    assert len(result["stocks"]) == 2
    assert result["stocks"][0]["ticker"] == "AAPL"
    assert result["stocks"][0]["is_holding"] is True
    assert result["stocks"][1]["ticker"] == "TSLA"
    assert result["stocks"][1]["is_holding"] is False


def test_generate_detects_anomaly(tmp_path):
    import services.digest_service as ds
    portfolio = {
        "stocks": [{"ticker": "AAPL", "name": "Apple", "quantity": 5, "avg_cost": 100.0, "market": "US", "exchange": ""}],
        "watchlist": [],
    }
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=portfolio), \
         patch("services.digest_service.yf.Ticker", side_effect=_big_drop_ticker), \
         patch("services.digest_service._get_events", return_value=[]):
        result = ds.generate(today=date(2026, 5, 23))
    assert result["stocks"][0]["is_anomaly"] is True
    assert len(result["anomalies"]) == 1
    assert result["anomalies"][0]["ticker"] == "AAPL"


def test_generate_saves_snapshot(tmp_path):
    import services.digest_service as ds
    with patch.object(ds, "DIGEST_DIR", tmp_path), \
         patch("services.digest_service.storage.get_full_portfolio", return_value=SAMPLE_PORTFOLIO), \
         patch("services.digest_service.yf.Ticker", side_effect=_normal_ticker), \
         patch("services.digest_service._get_events", return_value=[]):
        ds.generate(today=date(2026, 5, 23))
    assert (tmp_path / "2026-05-23.json").exists()


def test_get_latest_returns_none_when_empty(tmp_path):
    import services.digest_service as ds
    with patch.object(ds, "DIGEST_DIR", tmp_path):
        assert ds.get_latest() is None


def test_get_latest_returns_most_recent(tmp_path):
    import services.digest_service as ds
    (tmp_path / "2026-05-22.json").write_text(json.dumps({"date": "2026-05-22"}), encoding="utf-8")
    (tmp_path / "2026-05-23.json").write_text(json.dumps({"date": "2026-05-23"}), encoding="utf-8")
    with patch.object(ds, "DIGEST_DIR", tmp_path):
        result = ds.get_latest()
    assert result["date"] == "2026-05-23"


def test_send_telegram_does_nothing_without_env(monkeypatch):
    import services.digest_service as ds
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    ds.send_telegram(SAMPLE_DIGEST)  # should not raise


def test_send_telegram_posts_when_env_set(monkeypatch):
    import services.digest_service as ds
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "testtoken")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "12345")
    with patch("services.digest_service.requests.post") as mock_post:
        mock_post.return_value.status_code = 200
        ds.send_telegram(SAMPLE_DIGEST)
    mock_post.assert_called_once()
    _, kwargs = mock_post.call_args
    assert kwargs["json"]["chat_id"] == "12345"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && .venv/bin/python -m pytest tests/test_digest_service.py -v
```
Expected: `ImportError` — `services.digest_service` does not exist yet

- [ ] **Step 3: Implement digest_service.py**

```python
# backend/services/digest_service.py
from __future__ import annotations
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
import yfinance as yf

from services import storage
from services.market import _yf_sym
from routers.calendar import _get_events

DIGEST_DIR = Path(__file__).parent.parent / "data" / "digest"
DIGEST_DIR.mkdir(exist_ok=True)
ANOMALY_THRESHOLD = 5.0


def generate(today: date = None) -> dict:
    if today is None:
        today = date.today()

    portfolio = storage.get_full_portfolio()
    holdings = portfolio.get("stocks", [])
    watchlist = portfolio.get("watchlist", [])
    all_stocks = holdings + watchlist
    holding_tickers = {h["ticker"].upper() for h in holdings}

    def _fetch_quote(stock):
        ticker = stock["ticker"].upper()
        sym = _yf_sym(ticker, stock.get("market", "US"), stock.get("exchange", ""))
        try:
            hist = yf.Ticker(sym).history(period="2d")
            if len(hist) >= 2:
                prev_close = float(hist["Close"].iloc[-2])
                current = float(hist["Close"].iloc[-1])
                change_pct = round((current - prev_close) / prev_close * 100, 2)
                return ticker, {"prev_close": prev_close, "current": current, "change_pct": change_pct}
        except Exception:
            pass
        return ticker, None

    quotes: dict = {}
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(_fetch_quote, s): s for s in all_stocks}
        for future in as_completed(futures):
            ticker, data = future.result()
            if data:
                quotes[ticker] = data

    total_value = sum(
        h.get("quantity", 0) * quotes[h["ticker"].upper()]["current"]
        for h in holdings
        if h["ticker"].upper() in quotes and h.get("quantity")
    )
    total_prev = sum(
        h.get("quantity", 0) * quotes[h["ticker"].upper()]["prev_close"]
        for h in holdings
        if h["ticker"].upper() in quotes and h.get("quantity")
    )
    daily_change_usd = round(total_value - total_prev, 2)
    daily_change_pct = round(daily_change_usd / total_prev * 100, 2) if total_prev > 0 else 0.0

    stocks_list = []
    anomalies = []
    for stock in sorted(all_stocks, key=lambda s: (0 if s["ticker"].upper() in holding_tickers else 1)):
        ticker = stock["ticker"].upper()
        q = quotes.get(ticker)
        if q is None:
            continue
        is_anomaly = abs(q["change_pct"]) >= ANOMALY_THRESHOLD
        stocks_list.append({
            "ticker": ticker,
            "name": stock.get("name", ticker),
            "change_pct": q["change_pct"],
            "is_holding": ticker in holding_tickers,
            "is_anomaly": is_anomaly,
        })
        if is_anomaly:
            anomalies.append({
                "ticker": ticker,
                "change_pct": q["change_pct"],
                "reason": f"{'상승' if q['change_pct'] > 0 else '하락'} {abs(q['change_pct']):.1f}%",
            })

    end_date = today + timedelta(days=7)
    month_str = today.strftime("%Y-%m")
    next_month_str = (today.replace(day=1) + timedelta(days=32)).strftime("%Y-%m")
    all_events = _get_events(month_str)
    if next_month_str != month_str:
        all_events = all_events + _get_events(next_month_str)

    events_7d = sorted(
        [
            {
                "ticker": ev["ticker"],
                "event_type": ev["type"],
                "date": ev["date"],
                "days_until": (date.fromisoformat(ev["date"]) - today).days,
            }
            for ev in all_events
            if today <= date.fromisoformat(ev["date"]) <= end_date
        ],
        key=lambda x: x["date"],
    )

    kst = timezone(timedelta(hours=9))
    digest = {
        "date": today.isoformat(),
        "generated_at": datetime.now(kst).isoformat(timespec="seconds"),
        "portfolio_summary": {
            "total_value_usd": round(total_value, 2),
            "daily_change_pct": daily_change_pct,
            "daily_change_usd": daily_change_usd,
        },
        "stocks": stocks_list,
        "events_7d": events_7d,
        "anomalies": anomalies,
    }

    path = DIGEST_DIR / f"{today.isoformat()}.json"
    path.write_text(json.dumps(digest, ensure_ascii=False, indent=2), encoding="utf-8")
    return digest


def get_latest() -> dict | None:
    files = sorted(DIGEST_DIR.glob("*.json"), reverse=True)
    if not files:
        return None
    return json.loads(files[0].read_text(encoding="utf-8"))


def send_telegram(digest: dict) -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return

    summary = digest["portfolio_summary"]
    sign = "+" if summary["daily_change_pct"] >= 0 else ""
    lines = [
        f"📊 Daily Digest — {digest['date']}",
        f"포트폴리오: ${summary['total_value_usd']:,.0f}  "
        f"{sign}{summary['daily_change_pct']:.1f}% ({sign}${summary['daily_change_usd']:,.0f})",
    ]

    if digest["anomalies"]:
        lines.append("\n⚠ 이상신호")
        for a in digest["anomalies"]:
            s = "+" if a["change_pct"] >= 0 else ""
            lines.append(f"  {a['ticker']}  {s}{a['change_pct']:.1f}%")

    if digest["events_7d"]:
        lines.append("\n📅 향후 7일 이벤트")
        for ev in digest["events_7d"][:5]:
            label = "실적" if ev["event_type"] == "earnings" else "배당"
            lines.append(f"  D-{ev['days_until']}  {ev['ticker']}  {label}")

    lines.append("\n종목별 등락")
    for s in digest["stocks"]:
        sign2 = "+" if s["change_pct"] >= 0 else ""
        lines.append(f"  {s['ticker']}  {sign2}{s['change_pct']:.1f}%")

    try:
        requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": "\n".join(lines)},
            timeout=10,
        )
    except Exception as e:
        print(f"[Digest] Telegram send failed: {e}")
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && .venv/bin/python -m pytest tests/test_digest_service.py -v
```
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/digest_service.py backend/tests/test_digest_service.py
git commit -m "feat: add digest_service with generate/get_latest/send_telegram"
```

---

## Task 2: digest_router.py — API endpoints

**Files:**
- Create: `backend/routers/digest.py`
- Create: `backend/tests/test_digest_router.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_digest_router.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.digest import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)

SAMPLE_DIGEST = {
    "date": "2026-05-23",
    "generated_at": "2026-05-23T08:00:00+09:00",
    "portfolio_summary": {"total_value_usd": 1000.0, "daily_change_pct": 1.0, "daily_change_usd": 10.0},
    "stocks": [{"ticker": "AAPL", "name": "Apple", "change_pct": 2.0, "is_holding": True, "is_anomaly": False}],
    "events_7d": [],
    "anomalies": [],
}


def test_get_latest_returns_digest():
    with patch("routers.digest.digest_service.get_latest", return_value=SAMPLE_DIGEST):
        resp = client.get("/api/digest/latest")
    assert resp.status_code == 200
    assert resp.json()["date"] == "2026-05-23"


def test_get_latest_returns_404_when_none():
    with patch("routers.digest.digest_service.get_latest", return_value=None):
        resp = client.get("/api/digest/latest")
    assert resp.status_code == 404


def test_post_generate_returns_digest():
    with patch("routers.digest.digest_service.generate", return_value=SAMPLE_DIGEST):
        resp = client.post("/api/digest/generate")
    assert resp.status_code == 200
    assert resp.json()["date"] == "2026-05-23"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && .venv/bin/python -m pytest tests/test_digest_router.py -v
```
Expected: `ImportError` — `routers.digest` does not exist yet

- [ ] **Step 3: Implement digest_router.py**

```python
# backend/routers/digest.py
from fastapi import APIRouter, HTTPException
from services import digest_service

router = APIRouter(prefix="/api", tags=["digest"])


@router.get("/digest/latest")
def get_latest():
    data = digest_service.get_latest()
    if data is None:
        raise HTTPException(status_code=404, detail="No digest available yet. Generate one first.")
    return data


@router.post("/digest/generate")
def generate():
    return digest_service.generate()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && .venv/bin/python -m pytest tests/test_digest_router.py -v
```
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/routers/digest.py backend/tests/test_digest_router.py
git commit -m "feat: add digest router GET /api/digest/latest and POST /api/digest/generate"
```

---

## Task 3: Wire backend — main.py + scheduler.py

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/scheduler.py`

- [ ] **Step 1: Add digest router to main.py**

In `backend/main.py` line 9, add `digest` to the import:

```python
# Before:
from routers import portfolio, report, watchlist, stocks, guru, calendar
# After:
from routers import portfolio, report, watchlist, stocks, guru, calendar, digest
```

After `app.include_router(calendar.router)` (currently line 51), add:

```python
app.include_router(digest.router)
```

- [ ] **Step 2: Add daily digest job to scheduler.py**

In `backend/scheduler.py`, after the `_GURU_JOB_ID` line, add:

```python
_DIGEST_JOB_ID = "daily_digest"
```

After the `_run_guru_crawl` function, add:

```python
def _run_digest():
    from services import digest_service
    try:
        d = digest_service.generate()
        digest_service.send_telegram(d)
        print("[Scheduler] Daily digest generated")
    except Exception as e:
        print(f"[Scheduler] Daily digest failed: {e}")
```

In `start()`, add the digest job before `_scheduler.start()`:

```python
def start():
    _reschedule()
    _reschedule_guru()
    _scheduler.add_job(
        _run_digest,
        CronTrigger(hour=8, minute=0, timezone="Asia/Seoul"),
        id=_DIGEST_JOB_ID,
        replace_existing=True,
    )
    _scheduler.start()
```

- [ ] **Step 3: Run full test suite to check for regressions**

```bash
cd backend && .venv/bin/python -m pytest -v
```
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add backend/main.py backend/scheduler.py
git commit -m "feat: wire digest router and add daily 08:00 KST scheduler job"
```

---

## Task 4: Digest.jsx + App.jsx — frontend

**Files:**
- Create: `frontend/src/pages/Digest.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Create Digest.jsx**

```jsx
// frontend/src/pages/Digest.jsx
import { useState, useEffect } from 'react'
import axios from 'axios'

export default function Digest() {
  const [digest, setDigest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { fetchLatest() }, [])

  async function fetchLatest() {
    setLoading(true)
    setError(null)
    try {
      const r = await axios.get('/api/digest/latest')
      setDigest(r.data)
    } catch (e) {
      if (e.response?.status !== 404) setError('데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    setError(null)
    try {
      const r = await axios.post('/api/digest/generate')
      setDigest(r.data)
    } catch {
      setError('생성에 실패했습니다.')
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: 16 }}>로딩 중...</div>

  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: 'var(--text)' }}>Daily Digest</h2>
        {digest && <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{digest.date}</span>}
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            marginLeft: 'auto',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            borderRadius: 4,
            padding: '4px 10px',
            cursor: refreshing ? 'wait' : 'pointer',
          }}
        >
          {refreshing ? '생성 중...' : '↺ 새로고침'}
        </button>
      </div>

      {error && <div style={{ color: '#e57373', marginBottom: 12 }}>{error}</div>}

      {!digest ? (
        <div style={{ color: 'var(--text-muted)' }}>
          아직 생성된 Digest가 없습니다. 새로고침 버튼을 눌러 생성하세요.
        </div>
      ) : (
        <>
          {digest.anomalies.length > 0 && (
            <div style={{
              background: 'rgba(229,115,115,0.1)',
              border: '1px solid rgba(229,115,115,0.3)',
              borderRadius: 6,
              padding: '10px 14px',
              marginBottom: 12,
            }}>
              <div style={{ color: '#e57373', fontWeight: 600, marginBottom: 6 }}>⚠ 이상신호</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {digest.anomalies.map(a => (
                  <span key={a.ticker} style={{ color: a.change_pct >= 0 ? '#81c784' : '#e57373', fontSize: 13 }}>
                    {a.ticker} {a.change_pct >= 0 ? '+' : ''}{a.change_pct.toFixed(1)}%
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '12px 16px',
            marginBottom: 12,
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 6 }}>포트폴리오 요약</div>
            <div style={{ display: 'flex', gap: 20, alignItems: 'baseline' }}>
              <span style={{ color: 'var(--text)', fontSize: 18, fontWeight: 600 }}>
                ${digest.portfolio_summary.total_value_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <span style={{
                color: digest.portfolio_summary.daily_change_pct >= 0 ? '#81c784' : '#e57373',
                fontSize: 13,
              }}>
                {digest.portfolio_summary.daily_change_pct >= 0 ? '+' : ''}
                {digest.portfolio_summary.daily_change_pct.toFixed(1)}%
                &nbsp;({digest.portfolio_summary.daily_change_usd >= 0 ? '+' : ''}$
                {Math.abs(digest.portfolio_summary.daily_change_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })})
              </span>
            </div>
          </div>

          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '12px 16px',
            marginBottom: 12,
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>종목별 등락</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {digest.stocks.map(s => (
                <div key={s.ticker} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text)', fontSize: 13 }}>
                    {s.ticker}
                    {!s.is_holding && (
                      <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>관심</span>
                    )}
                  </span>
                  <span style={{ color: s.change_pct >= 0 ? '#81c784' : '#e57373', fontSize: 13 }}>
                    {s.change_pct >= 0 ? '+' : ''}{s.change_pct.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {digest.events_7d.length > 0 && (
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '12px 16px',
            }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>향후 7일 이벤트</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {digest.events_7d.map((ev, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 13 }}>
                    <span style={{ color: 'var(--accent)', minWidth: 36 }}>D-{ev.days_until}</span>
                    <span style={{ color: 'var(--text)' }}>{ev.ticker}</span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {ev.event_type === 'earnings' ? '실적발표' : '배당락일'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire into App.jsx**

In `frontend/src/App.jsx`:

After `import Calendar from './pages/Calendar'` (line 7), add:
```javascript
import Digest from './pages/Digest'
```

On line 36, add `'/digest'` to the nav array:
```javascript
{[['/', '종목 관리'], ['/reports', '리포트'], ['/calendar', '캘린더'], ['/digest', '다이제스트'], ['/guru', '구루'], ['/settings', '설정']].map(([to, label]) => (
```

After `<Route path="/calendar" element={<Calendar />} />` (line 75), add:
```jsx
<Route path="/digest" element={<Digest />} />
```

- [ ] **Step 3: Start servers and verify in browser**

```bash
# Terminal 1:
cd backend && .venv/bin/python -m uvicorn main:app --reload --port 8000
# Terminal 2:
cd frontend && npm run dev
```

Open http://localhost:5173/digest and verify:
1. "다이제스트" nav link appears and is active when on that page
2. Page shows "아직 생성된 Digest가 없습니다." on first load (no snapshot exists)
3. Clicking "↺ 새로고침" shows "생성 중..." while waiting and then renders the digest
4. Portfolio summary shows total value and daily change with correct color (green/red)
5. All portfolio stocks appear in the list with +/- change percentages
6. Events section appears only if events exist in the next 7 days
7. Anomaly banner appears only for stocks with ≥5% moves

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Digest.jsx frontend/src/App.jsx
git commit -m "feat: add Digest page and nav link"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run complete backend test suite**

```bash
cd backend && .venv/bin/python -m pytest -v
```
Expected: all existing tests + 10 new digest tests PASS, 0 failures

- [ ] **Step 2: Verify Telegram env vars (optional)**

To test Telegram delivery, set env vars and trigger manually:
```bash
export TELEGRAM_BOT_TOKEN=your_bot_token
export TELEGRAM_CHAT_ID=your_chat_id
cd backend && .venv/bin/python -c "
from services import digest_service
d = digest_service.get_latest()
if d:
    digest_service.send_telegram(d)
    print('Sent!')
else:
    print('No digest yet — generate one first via POST /api/digest/generate')
"
```

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -p
git commit -m "fix: address any issues found during final verification"
```

# 컨센서스 추이 차트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리포트 상세 화면의 증권사 컨센서스 섹션 아래에 날짜별 평균목표가·투자의견 추이 차트를 추가하고, 수동 버튼 및 스케줄러로 데이터를 수집한다.

**Architecture:** 컨센서스 데이터는 `backend/data/consensus/{ticker}.json`에 날짜별 배열로 누적 저장한다. 수집 로직은 `services/consensus.py`에 분리하고, FastAPI 라우터와 스케줄러 양쪽에서 호출한다. 프론트엔드는 recharts(기존 라이브러리)로 라인차트+스택바차트를 렌더링하며, 표시 시점에 연속 중복값을 필터링한다.

**Tech Stack:** Python/FastAPI, pytest, React 18 + recharts (기존), axios

---

## File Map

| 역할 | 파일 | 변경 |
|------|------|------|
| 컨센서스 수집·조회 로직 | `backend/services/consensus.py` | 신규 |
| API 엔드포인트 2개 | `backend/routers/report.py` | 수정 |
| 스케줄러 통합 | `backend/scheduler.py` | 수정 |
| 라우터 테스트 | `backend/tests/test_consensus_router.py` | 신규 |
| 프론트엔드 차트+버튼 | `frontend/src/pages/Reports.jsx` | 수정 |

---

## Task 1: consensus 서비스 파일 작성

**Files:**
- Create: `backend/services/consensus.py`
- Test: `backend/tests/test_consensus_router.py` (Task 2에서 함께 추가)

- [ ] **Step 1: `backend/services/consensus.py` 생성**

```python
from __future__ import annotations
import json
from datetime import date
from pathlib import Path

CONSENSUS_DIR = Path(__file__).parent.parent / "data" / "consensus"
REPORTS_DIR = Path(__file__).parent.parent / "reports"


def get_history(ticker: str) -> list[dict]:
    path = CONSENSUS_DIR / f"{ticker.upper()}.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def collect(ticker: str) -> dict | None:
    """최신 리포트 JSON에서 컨센서스를 읽어 날짜별 파일에 누적한다. 데이터 없으면 None 반환."""
    upper = ticker.upper()
    ticker_dir = REPORTS_DIR / upper
    if not ticker_dir.exists():
        return None
    json_files = sorted(ticker_dir.glob("*.json"), reverse=True)
    if not json_files:
        return None
    summary = json.loads(json_files[0].read_text(encoding="utf-8"))
    target_mean = summary.get("target_mean")
    buy = summary.get("buy")
    hold = summary.get("hold")
    sell = summary.get("sell")
    if all(v is None for v in [target_mean, buy, hold, sell]):
        return None
    entry = {
        "date": str(date.today()),
        "target_mean": target_mean,
        "buy": buy,
        "hold": hold,
        "sell": sell,
    }
    CONSENSUS_DIR.mkdir(parents=True, exist_ok=True)
    path = CONSENSUS_DIR / f"{upper}.json"
    existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    existing = [e for e in existing if e["date"] != entry["date"]]
    existing.append(entry)
    existing.sort(key=lambda e: e["date"], reverse=True)
    path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    return entry
```

- [ ] **Step 2: 커밋**

```bash
git add backend/services/consensus.py
git commit -m "feat: consensus 수집·조회 서비스 추가"
```

---

## Task 2: API 엔드포인트 추가 + 테스트

**Files:**
- Modify: `backend/routers/report.py` (파일 하단 `@router.get("/schedule")` 앞에 삽입)
- Create: `backend/tests/test_consensus_router.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
# backend/tests/test_consensus_router.py
import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.report import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)

SAMPLE_SUMMARY = {
    "target_mean": 352000.0, "buy": 25, "hold": 0, "sell": 0,
    "price": 275500.0, "market": "KR",
}


def test_get_consensus_empty(tmp_path):
    with patch("services.consensus.CONSENSUS_DIR", tmp_path):
        resp = client.get("/api/consensus/005930")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_consensus_returns_data(tmp_path):
    (tmp_path / "005930.json").write_text(
        json.dumps([{"date": "2026-05-19", "target_mean": 352000, "buy": 25, "hold": 0, "sell": 0}]),
        encoding="utf-8",
    )
    with patch("services.consensus.CONSENSUS_DIR", tmp_path):
        resp = client.get("/api/consensus/005930")
    assert resp.status_code == 200
    assert resp.json()[0]["target_mean"] == 352000


def test_collect_consensus_saves_entry(tmp_path):
    reports_tmp = tmp_path / "reports"
    reports_tmp.mkdir()
    consensus_tmp = tmp_path / "consensus"
    ticker_dir = reports_tmp / "005930"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-19.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    with patch("services.consensus.REPORTS_DIR", reports_tmp), \
         patch("services.consensus.CONSENSUS_DIR", consensus_tmp):
        resp = client.post("/api/consensus/005930")
    assert resp.status_code == 200
    assert resp.json()["target_mean"] == 352000.0


def test_collect_consensus_no_report(tmp_path):
    reports_tmp = tmp_path / "reports"
    reports_tmp.mkdir()
    consensus_tmp = tmp_path / "consensus"
    with patch("services.consensus.REPORTS_DIR", reports_tmp), \
         patch("services.consensus.CONSENSUS_DIR", consensus_tmp):
        resp = client.post("/api/consensus/UNKNOWN")
    assert resp.status_code == 400


def test_collect_consensus_upsert_same_date(tmp_path):
    reports_tmp = tmp_path / "reports"
    reports_tmp.mkdir()
    consensus_tmp = tmp_path / "consensus"
    consensus_tmp.mkdir()
    ticker_dir = reports_tmp / "005930"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-19.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    (consensus_tmp / "005930.json").write_text(
        json.dumps([{"date": "2026-05-19", "target_mean": 300000, "buy": 20, "hold": 2, "sell": 1}]),
        encoding="utf-8",
    )
    with patch("services.consensus.REPORTS_DIR", reports_tmp), \
         patch("services.consensus.CONSENSUS_DIR", consensus_tmp):
        client.post("/api/consensus/005930")
    saved = json.loads((consensus_tmp / "005930.json").read_text())
    same_date = [e for e in saved if e["date"] == "2026-05-19"]
    assert len(same_date) == 1
    assert same_date[0]["target_mean"] == 352000.0
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && python -m pytest tests/test_consensus_router.py -v
```
Expected: `ImportError` 또는 `404` — 아직 엔드포인트가 없으므로 실패

- [ ] **Step 3: `backend/routers/report.py` 에 엔드포인트 추가**

파일 상단 import 섹션 (`from services import storage, report_generator` 아래)에 추가:

```python
from services import consensus as consensus_svc
```

그리고 `@router.get("/schedule")` 바로 앞에 삽입:

```python
@router.get("/consensus/{ticker}")
def get_consensus(ticker: str):
    return consensus_svc.get_history(ticker)


@router.post("/consensus/{ticker}")
def collect_consensus(ticker: str):
    entry = consensus_svc.collect(ticker)
    if entry is None:
        raise HTTPException(status_code=400, detail="리포트를 먼저 생성하세요")
    return entry
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend && python -m pytest tests/test_consensus_router.py -v
```
Expected: 5개 PASSED

- [ ] **Step 5: 기존 테스트 깨지지 않는지 확인**

```bash
cd backend && python -m pytest -v
```
Expected: 전체 PASSED (기존 테스트 포함)

- [ ] **Step 6: 커밋**

```bash
git add backend/routers/report.py backend/tests/test_consensus_router.py
git commit -m "feat: GET/POST /api/consensus/{ticker} 엔드포인트 추가"
```

---

## Task 3: 스케줄러 통합

**Files:**
- Modify: `backend/scheduler.py`

- [ ] **Step 1: `backend/scheduler.py` 수정**

파일 상단 import 줄 (`from services import storage, report_generator`) 을 다음으로 교체:

```python
from services import storage, report_generator
from services import consensus as consensus_svc
```

`_generate_all` 함수를 다음으로 교체:

```python
def _generate_all():
    portfolio = storage.get_portfolio()
    for stock in portfolio.get("stocks", []):
        try:
            report_generator.generate_report(stock)
            print(f"[Scheduler] Report generated for {stock['ticker']}")
        except Exception as e:
            print(f"[Scheduler] Failed for {stock['ticker']}: {e}")
        try:
            consensus_svc.collect(stock["ticker"])
            print(f"[Scheduler] Consensus collected for {stock['ticker']}")
        except Exception as e:
            print(f"[Scheduler] Consensus collection failed for {stock['ticker']}: {e}")
```

- [ ] **Step 2: 기존 테스트 통과 확인**

```bash
cd backend && python -m pytest -v
```
Expected: 전체 PASSED

- [ ] **Step 3: 커밋**

```bash
git add backend/scheduler.py
git commit -m "feat: 스케줄러에서 리포트 생성 후 컨센서스 자동 수집"
```

---

## Task 4: 프론트엔드 — ConsensusChart 컴포넌트 + 버튼

**Files:**
- Modify: `frontend/src/pages/Reports.jsx`

- [ ] **Step 1: React import에 `useMemo` 추가**

`Reports.jsx` 1번째 줄:

```js
// 변경 전
import { useState, useEffect, useCallback, useRef } from 'react'
// 변경 후
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
```

- [ ] **Step 2: `ConsensusChart` 컴포넌트 추가**

`Reports.jsx`에서 `function DetailSummaryTab` 정의 바로 앞에 아래 컴포넌트를 삽입한다.

```jsx
function ConsensusChart({ ticker, market }) {
  const [data, setData] = useState([])
  const [collecting, setCollecting] = useState(false)
  const [error, setError] = useState(null)

  const fetchData = useCallback(() => {
    if (!ticker) return
    axios.get(`/api/consensus/${ticker}`)
      .then(({ data }) => setData(data))
      .catch(() => {})
  }, [ticker])

  useEffect(() => { fetchData() }, [fetchData])

  const collect = async () => {
    setCollecting(true)
    setError(null)
    try {
      await axios.post(`/api/consensus/${ticker}`)
      fetchData()
    } catch (e) {
      setError(e.response?.data?.detail || '수집 실패')
    } finally {
      setCollecting(false)
    }
  }

  const deduped = useMemo(() => {
    if (!data.length) return []
    const asc = [...data].reverse()
    return asc.filter((item, i) => {
      if (i === 0) return true
      const prev = asc[i - 1]
      return !(
        item.target_mean === prev.target_mean &&
        item.buy === prev.buy &&
        item.hold === prev.hold &&
        item.sell === prev.sell
      )
    })
  }, [data])

  const axisStyle = { fontSize: 10, fill: '#78909c' }
  const chartMargin = { top: 4, right: 8, left: 0, bottom: 0 }

  const targetTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: '#1a1a2e', border: '1px solid #3a4a6a', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
        <div style={{ color: '#80cbc4', fontWeight: 700, marginBottom: 4 }}>{label}</div>
        <div style={{ color: '#ffcc80' }}>평균목표가: {fmt(payload[0].value, market)}</div>
      </div>
    )
  }

  const opinionTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const total = payload.reduce((s, p) => s + (p.value ?? 0), 0)
    return (
      <div style={{ background: '#1a1a2e', border: '1px solid #3a4a6a', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
        <div style={{ color: '#80cbc4', fontWeight: 700, marginBottom: 4 }}>{label}</div>
        {payload.map(p => (
          <div key={p.dataKey} style={{ color: p.fill, marginBottom: 2 }}>
            {p.name}: {p.value ?? 0}{total > 0 ? ` (${Math.round((p.value ?? 0) / total * 100)}%)` : ''}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ background: '#111827', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ color: '#80cbc4', fontWeight: 700, fontSize: 12, letterSpacing: '0.3px' }}>📈 컨센서스 추이</div>
        <button
          onClick={collect}
          disabled={collecting}
          style={{
            background: 'transparent', border: '1px solid #444',
            color: collecting ? '#4fc3f7' : '#aaa',
            borderRadius: 3, padding: '2px 8px', fontSize: 11,
            cursor: collecting ? 'default' : 'pointer',
          }}
        >
          {collecting ? '수집 중...' : '수집'}
        </button>
      </div>
      {error && <div style={{ color: '#ef9a9a', fontSize: 11, marginBottom: 6 }}>{error}</div>}
      {deduped.length === 0 ? (
        <div style={{ color: '#546e7a', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>
          아직 수집된 데이터가 없습니다. 수집 버튼을 눌러주세요.
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 10, color: '#ffcc80', marginBottom: 2 }}>평균목표가</div>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={deduped} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
                <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => fmt(v, market)} tick={axisStyle} axisLine={false} tickLine={false} width={60} />
                <Tooltip content={targetTooltip} />
                <Line type="monotone" dataKey="target_mean" name="평균목표가" stroke="#ffcc80" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, color: '#aaa', marginBottom: 2 }}>애널리스트 의견</div>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={deduped} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
                <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={20} />
                <Tooltip content={opinionTooltip} />
                <Bar dataKey="buy" name="매수" stackId="a" fill="#43a047" />
                <Bar dataKey="hold" name="중립" stackId="a" fill="#616161" />
                <Bar dataKey="sell" name="매도" stackId="a" fill="#b71c1c" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#78909c', marginTop: 4 }}>
            {[['#43a047', '매수'], ['#616161', '중립'], ['#b71c1c', '매도']].map(([color, label]) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, background: color, display: 'inline-block', borderRadius: 2 }} />
                {label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: `DetailSummaryTab`에 `ticker` prop 추가 및 차트 렌더링**

`DetailSummaryTab` 시그니처 변경:

```jsx
// 변경 전
function DetailSummaryTab({ summary }) {
// 변경 후
function DetailSummaryTab({ summary, ticker }) {
```

`DetailSummaryTab` return 내부, 증권사 컨센서스 `<div>` 닫는 태그 바로 뒤에 추가:

```jsx
      {/* 컨센서스 추이 */}
      <ConsensusChart ticker={ticker} market={summary.market} />
```

위치는 기존 코드에서 아래 구조 사이:

```jsx
        </div>  {/* ← 증권사 컨센서스 섹션 닫힘 */}

        {/* 여기에 ConsensusChart 삽입 */}

        {/* 2행: 매물대·RSI 현황 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
```

- [ ] **Step 4: `DetailSummaryTab` 호출부에 `ticker` prop 전달**

`Reports.jsx` 내 `DetailSummaryTab` 호출부 (약 1169번째 줄):

```jsx
// 변경 전
<DetailSummaryTab summary={detail.summary} />
// 변경 후
<DetailSummaryTab summary={detail.summary} ticker={selected.ticker} />
```

- [ ] **Step 5: 프론트엔드 빌드 오류 없는지 확인**

```bash
cd frontend && npm run build 2>&1 | tail -20
```
Expected: `✓ built in` (에러 없음)

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/pages/Reports.jsx
git commit -m "feat: 컨센서스 추이 차트 컴포넌트 및 수집 버튼 추가"
```

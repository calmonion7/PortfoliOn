# 스냅샷 히스토리 탭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reports 상세 뷰에 📅 히스토리 탭을 추가하여 종목별 스냅샷을 트렌드 차트와 날짜 비교 테이블로 조회할 수 있게 한다.

**Architecture:** 백엔드에 `/report/{ticker}/history` 엔드포인트를 추가해 트렌드용 경량 배열을 반환하고, 프론트엔드 Reports.jsx에 `HistoryTab` 컴포넌트와 탭 항목을 추가한다. 상세 비교는 기존 `/report/{ticker}/{date}` API를 재사용한다.

**Tech Stack:** Python/FastAPI, pytest, React 18, recharts, axios

---

## 파일 변경 목록

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `backend/routers/report.py` | 수정 | `/report/{ticker}/history` 엔드포인트 추가 |
| `backend/tests/test_report_router.py` | 수정 | history 엔드포인트 테스트 추가 |
| `frontend/src/pages/Reports.jsx` | 수정 | `HistoryTab` 컴포넌트 + 탭 항목 추가 |

---

## Task 1: 백엔드 — `/report/{ticker}/history` 엔드포인트

**Files:**
- Modify: `backend/routers/report.py:151` (기존 `GET /report/{ticker}/{date_str}` 바로 앞에 삽입)
- Test: `backend/tests/test_report_router.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_report_router.py` 파일 끝에 추가:

```python
SAMPLE_SUMMARY_WITH_RSI = {
    "ticker": "LLY", "name": "일라이 릴리", "date": "2026-05-05",
    "price": 890.0, "target_mean": 980.0, "target_high": 1100.0, "target_low": 850.0,
    "buy": 15, "hold": 3, "sell": 1,
    "daily_rsi": {"rsi": 45.2, "target_20": 800.0},
    "weekly_rsi": {"rsi": 55.1, "target_20": 780.0},
    "monthly_rsi": {"rsi": 62.3, "target_20": 760.0},
}

SAMPLE_SUMMARY_2 = {
    "ticker": "LLY", "name": "일라이 릴리", "date": "2026-05-06",
    "price": 900.0, "target_mean": 990.0, "target_high": 1110.0, "target_low": 860.0,
    "buy": 16, "hold": 3, "sell": 1,
    "daily_rsi": {"rsi": 47.0, "target_20": 810.0},
    "weekly_rsi": {"rsi": 56.0, "target_20": 790.0},
    "monthly_rsi": None,
}


def test_get_history_returns_sorted_lean_array(tmp_path):
    ticker_dir = tmp_path / "LLY"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-05.json").write_text(
        json.dumps(SAMPLE_SUMMARY_WITH_RSI), encoding="utf-8"
    )
    (ticker_dir / "2026-05-06.json").write_text(
        json.dumps(SAMPLE_SUMMARY_2), encoding="utf-8"
    )
    with patch("routers.report.SNAPSHOTS_DIR", tmp_path), \
         patch("routers.report.REPORTS_DIR", tmp_path / "legacy"):
        resp = client.get("/api/report/LLY/history")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["date"] == "2026-05-05"
    assert data[1]["date"] == "2026-05-06"
    assert data[0]["price"] == 890.0
    assert data[0]["target_mean"] == 980.0
    assert data[0]["target_high"] == 1100.0
    assert data[0]["target_low"] == 850.0
    assert data[0]["buy"] == 15
    assert data[0]["hold"] == 3
    assert data[0]["sell"] == 1
    assert data[0]["rsi_daily"] == 45.2
    assert data[0]["rsi_weekly"] == 55.1
    assert data[0]["rsi_monthly"] == 62.3


def test_get_history_handles_null_rsi(tmp_path):
    ticker_dir = tmp_path / "LLY"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-06.json").write_text(
        json.dumps(SAMPLE_SUMMARY_2), encoding="utf-8"
    )
    with patch("routers.report.SNAPSHOTS_DIR", tmp_path), \
         patch("routers.report.REPORTS_DIR", tmp_path / "legacy"):
        resp = client.get("/api/report/LLY/history")
    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["rsi_monthly"] is None


def test_get_history_empty_when_no_snapshots(tmp_path):
    with patch("routers.report.SNAPSHOTS_DIR", tmp_path), \
         patch("routers.report.REPORTS_DIR", tmp_path / "legacy"):
        resp = client.get("/api/report/LLY/history")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_history_fallback_to_reports_dir(tmp_path):
    legacy_dir = tmp_path / "legacy"
    legacy_ticker = legacy_dir / "LLY"
    legacy_ticker.mkdir(parents=True)
    (legacy_ticker / "2026-05-01.json").write_text(
        json.dumps(SAMPLE_SUMMARY_WITH_RSI), encoding="utf-8"
    )
    snapshots_dir = tmp_path / "snapshots"
    snapshots_dir.mkdir()
    with patch("routers.report.SNAPSHOTS_DIR", snapshots_dir), \
         patch("routers.report.REPORTS_DIR", legacy_dir):
        resp = client.get("/api/report/LLY/history")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd backend && python -m pytest tests/test_report_router.py::test_get_history_returns_sorted_lean_array -v
```

Expected: `FAILED` — `404 Not Found` (엔드포인트 없음)

- [ ] **Step 3: 엔드포인트 구현**

`backend/routers/report.py`에서 `@router.get("/report/{ticker}/{date_str}")` 바로 위 (line 151)에 삽입:

```python
@router.get("/report/{ticker}/history")
def get_history(ticker: str):
    upper = ticker.upper()
    result = []
    for base in (SNAPSHOTS_DIR, REPORTS_DIR):
        ticker_dir = base / upper
        if not ticker_dir.exists():
            continue
        for f in sorted(ticker_dir.glob("*.json")):
            raw = json.loads(f.read_text(encoding="utf-8"))
            result.append({
                "date": f.stem,
                "price": raw.get("price"),
                "target_mean": raw.get("target_mean"),
                "target_high": raw.get("target_high"),
                "target_low": raw.get("target_low"),
                "buy": raw.get("buy"),
                "hold": raw.get("hold"),
                "sell": raw.get("sell"),
                "rsi_daily": (raw.get("daily_rsi") or {}).get("rsi"),
                "rsi_weekly": (raw.get("weekly_rsi") or {}).get("rsi"),
                "rsi_monthly": (raw.get("monthly_rsi") or {}).get("rsi"),
            })
        break
    return sorted(result, key=lambda x: x["date"])
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd backend && python -m pytest tests/test_report_router.py -k "history" -v
```

Expected: 4개 테스트 모두 `PASSED`

- [ ] **Step 5: 기존 테스트 회귀 확인**

```bash
cd backend && python -m pytest tests/test_report_router.py -v
```

Expected: 전체 `PASSED` (기존 테스트 포함)

- [ ] **Step 6: 커밋**

```bash
git add backend/routers/report.py backend/tests/test_report_router.py
git commit -m "feat: add GET /report/{ticker}/history endpoint"
```

---

## Task 2: 프론트엔드 — `HistoryTab` 컴포넌트

**Files:**
- Modify: `frontend/src/pages/Reports.jsx` (line 1102 이후, `export default function Reports()` 바로 앞에 삽입)

- [ ] **Step 1: `HistoryTab` 컴포넌트 추가**

`Reports.jsx`의 line 1103 (`export default function Reports() {` 바로 앞)에 삽입:

```jsx
function HistoryTab({ ticker, dates, market }) {
  const [history, setHistory] = useState([])
  const [histLoading, setHistLoading] = useState(false)
  const [histError, setHistError] = useState(null)
  const [trendTab, setTrendTab] = useState('target')
  const [compareA, setCompareA] = useState(null)
  const [compareB, setCompareB] = useState(null)
  const [snapshotA, setSnapshotA] = useState(null)
  const [snapshotB, setSnapshotB] = useState(null)

  useEffect(() => {
    if (!ticker) return
    setHistLoading(true)
    setHistError(null)
    axios.get(`/api/report/${ticker}/history`)
      .then(({ data }) => {
        setHistory(data)
        if (data.length > 0) setCompareA(data[data.length - 1].date)
        if (data.length > 1) setCompareB(data[data.length - 2].date)
      })
      .catch(() => setHistError('히스토리 데이터를 불러올 수 없습니다.'))
      .finally(() => setHistLoading(false))
  }, [ticker])

  useEffect(() => {
    if (!ticker || !compareA) return
    axios.get(`/api/report/${ticker}/${compareA}`)
      .then(({ data }) => setSnapshotA(data.summary))
      .catch(() => setSnapshotA(null))
  }, [ticker, compareA])

  useEffect(() => {
    if (!ticker || !compareB) return
    axios.get(`/api/report/${ticker}/${compareB}`)
      .then(({ data }) => setSnapshotB(data.summary))
      .catch(() => setSnapshotB(null))
  }, [ticker, compareB])

  if (histLoading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>로딩 중...</p>
  if (histError) return <p style={{ color: '#ef9a9a', fontSize: 13 }}>{histError}</p>
  if (history.length === 0) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>히스토리 데이터가 없습니다.</p>

  const xTickFormatter = (date) => date?.slice(5) ?? ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 트렌드 섹션 */}
      <div>
        <div style={{ display: 'flex', gap: 0, marginBottom: 12 }}>
          {[{ key: 'target', label: '목표가' }, { key: 'rsi', label: 'RSI' }].map(({ key, label }) => (
            <button key={key} onClick={() => setTrendTab(key)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12,
              padding: '4px 14px',
              borderBottom: trendTab === key ? '2px solid var(--accent)' : '2px solid transparent',
              color: trendTab === key ? 'var(--accent)' : 'var(--text-muted)',
              fontWeight: trendTab === key ? 600 : 400,
              marginBottom: -1,
            }}>{label}</button>
          ))}
        </div>

        {trendTab === 'target' && (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={history} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tickFormatter={xTickFormatter} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={60} tickFormatter={(v) => v != null ? fmt(v, market) : ''} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 11 }}
                formatter={(v, name) => [v != null ? fmt(v, market) : 'N/A', name]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="target_high" name="최고" stroke="#81c784" strokeWidth={1} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="target_mean" name="평균" stroke="var(--accent)" strokeWidth={2} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="target_low" name="최저" stroke="#ef9a9a" strokeWidth={1} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="price" name="현재가" stroke="#90caf9" strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}

        {trendTab === 'rsi' && (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={history} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tickFormatter={xTickFormatter} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={30} />
              <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={70} stroke="#ef9a9a" strokeDasharray="4 2" label={{ value: '과매수', fill: '#ef9a9a', fontSize: 10 }} />
              <ReferenceLine y={30} stroke="#81c784" strokeDasharray="4 2" label={{ value: '과매도', fill: '#81c784', fontSize: 10 }} />
              <Line type="monotone" dataKey="rsi_daily" name="일" stroke="var(--accent)" strokeWidth={2} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="rsi_weekly" name="주" stroke="#90caf9" strokeWidth={1.5} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="rsi_monthly" name="월" stroke="#ce93d8" strokeWidth={1.5} dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 날짜 비교 섹션 */}
      <div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
          <select value={compareA ?? ''} onChange={e => setCompareA(e.target.value)}
            style={{ background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontSize: 12 }}>
            {dates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>vs</span>
          <select value={compareB ?? ''} onChange={e => setCompareB(e.target.value)}
            style={{ background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontSize: 12 }}>
            {dates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {dates.length < 2
          ? <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>비교할 날짜가 없습니다.</p>
          : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ ...TH, textAlign: 'left' }}>항목</th>
                    <th style={TH}>{compareA}</th>
                    <th style={TH}>{compareB}</th>
                    <th style={TH}>변화</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: '현재가', keyA: snapshotA?.price, keyB: snapshotB?.price, fmt: (v) => fmt(v, market) },
                    { label: '목표가(평균)', keyA: snapshotA?.target_mean, keyB: snapshotB?.target_mean, fmt: (v) => fmt(v, market) },
                    { label: '목표가(최고)', keyA: snapshotA?.target_high, keyB: snapshotB?.target_high, fmt: (v) => fmt(v, market) },
                    { label: '목표가(최저)', keyA: snapshotA?.target_low, keyB: snapshotB?.target_low, fmt: (v) => fmt(v, market) },
                    { label: 'Buy', keyA: snapshotA?.buy, keyB: snapshotB?.buy, fmt: (v) => v ?? 'N/A' },
                    { label: 'Hold', keyA: snapshotA?.hold, keyB: snapshotB?.hold, fmt: (v) => v ?? 'N/A' },
                    { label: 'Sell', keyA: snapshotA?.sell, keyB: snapshotB?.sell, fmt: (v) => v ?? 'N/A' },
                    { label: 'RSI(일)', keyA: snapshotA?.daily_rsi?.rsi, keyB: snapshotB?.daily_rsi?.rsi, fmt: (v) => v != null ? v.toFixed(1) : 'N/A' },
                    { label: 'RSI(주)', keyA: snapshotA?.weekly_rsi?.rsi, keyB: snapshotB?.weekly_rsi?.rsi, fmt: (v) => v != null ? v.toFixed(1) : 'N/A' },
                    { label: 'RSI(월)', keyA: snapshotA?.monthly_rsi?.rsi, keyB: snapshotB?.monthly_rsi?.rsi, fmt: (v) => v != null ? v.toFixed(1) : 'N/A' },
                  ].map(({ label, keyA, keyB, fmt: fmtFn }) => {
                    const delta = (keyA != null && keyB != null)
                      ? ((keyA - keyB) / Math.abs(keyB) * 100)
                      : null
                    return (
                      <tr key={label}>
                        <td style={{ ...TD, textAlign: 'left', color: 'var(--text-muted)' }}>{label}</td>
                        <td style={TD}>{fmtFn(keyA)}</td>
                        <td style={TD}>{fmtFn(keyB)}</td>
                        <td style={{ ...TD, color: delta == null ? 'var(--text-muted)' : delta >= 0 ? '#81c784' : '#ef9a9a' }}>
                          {delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )
        }
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 탭 항목 추가**

`Reports.jsx` line 1612의 탭 배열:

변경 전:
```jsx
{[
  { key: 'summary', label: '📊 요약' },
  { key: 'technical', label: '📈 기술적 분석' },
  { key: 'report', label: '📄 리포트' },
].map(({ key, label }) => (
```

변경 후:
```jsx
{[
  { key: 'summary', label: '📊 요약' },
  { key: 'technical', label: '📈 기술적 분석' },
  { key: 'report', label: '📄 리포트' },
  { key: 'history', label: '📅 히스토리' },
].map(({ key, label }) => (
```

- [ ] **Step 3: 탭 콘텐츠 연결**

`Reports.jsx`에서 `activeDetailTab === 'report'` 블록 끝 (line 1675, `})}` 이후)에 추가:

```jsx
{!loading && activeDetailTab === 'history' && (
  <HistoryTab
    ticker={selected.ticker}
    dates={reportList[selected.ticker]?.dates ?? []}
    market={reportList[selected.ticker]?.market ?? 'US'}
  />
)}
```

- [ ] **Step 4: 개발 서버 실행 및 수동 검증**

```bash
cd frontend && npm run dev
```

브라우저에서 확인:
1. Reports 페이지에서 스냅샷이 있는 종목(예: AAPL) 클릭
2. `📅 히스토리` 탭 클릭
3. 네트워크 탭에서 `/api/report/AAPL/history` 요청 **1건**만 발생하는지 확인
4. 목표가/RSI 서브탭 전환 확인
5. 날짜 드롭다운 변경 → 비교 테이블 업데이트 확인
6. 기존 요약/기술적 분석/리포트 탭 동작 회귀 없는지 확인

- [ ] **Step 5: 스냅샷 1개 종목 엣지케이스 확인**

스냅샷이 1개인 종목을 Reports에서 클릭 후 히스토리 탭에서 "비교할 날짜가 없습니다." 메시지 확인.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/pages/Reports.jsx
git commit -m "feat: add history tab with trend charts and date comparison"
```

---

## Task 3: 최종 검증 및 마무리

- [ ] **Step 1: 백엔드 전체 테스트**

```bash
cd backend && python -m pytest -v
```

Expected: 전체 `PASSED`

- [ ] **Step 2: 성공 기준 체크리스트**

- [ ] AAPL 히스토리 탭 진입 시 `/history` 요청 1개만 발생
- [ ] 날짜 2개 선택 시 비교 테이블 정상 렌더
- [ ] 스냅샷 1개 종목에서 "비교할 날짜가 없습니다" 표시
- [ ] 기존 요약/기술적 분석/리포트 탭 동작 회귀 없음

- [ ] **Step 3: 최종 커밋**

```bash
git add .
git commit -m "feat: snapshot history tab complete"
```

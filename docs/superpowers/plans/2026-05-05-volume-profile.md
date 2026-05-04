# 매물대 (Volume Profile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1년 일봉 거래량 프로파일에서 POC/HVN/LVN을 추출해 목록화면 컬럼과 상세화면 테이블로 표시한다.

**Architecture:** `indicators.py`에 `get_volume_profile(df, bins=50)` 추가 → `report_generator.py`에서 기존 `daily_df`를 그대로 전달해 summary JSON과 `_section8` 마크다운 저장 → `Reports.jsx`에서 POC 컬럼(목록)과 `VolumeProfileTable` 컴포넌트(상세) 렌더링.

**Tech Stack:** Python 3.11, numpy, pandas, React 18

---

## 파일 구조

| 파일 | 변경 내용 |
|---|---|
| `backend/services/indicators.py` | `get_volume_profile` 신규 추가 |
| `backend/tests/test_indicators.py` | VP 테스트 2개 추가 |
| `backend/services/report_generator.py` | VP 호출, summary에 volume_profile 추가, `_section8` 신규 |
| `backend/tests/test_report_generator.py` | mock 확장, VP JSON/섹션 테스트 2개 추가 |
| `frontend/src/pages/Reports.jsx` | POC 컬럼, VolumeProfileTable 컴포넌트 |

---

## Task 1: indicators.py — get_volume_profile (TDD)

**Files:**
- Modify: `backend/tests/test_indicators.py`
- Modify: `backend/services/indicators.py`

- [ ] **Step 1: test_indicators.py에 테스트 2개 추가**

`backend/tests/test_indicators.py` 파일 끝에 추가:

```python
def test_get_volume_profile_returns_poc_hvn_lvn():
    from services.indicators import get_volume_profile
    prices = np.concatenate([
        np.ones(80) * 100.0,
        np.ones(40) * 120.0,
        np.ones(40) * 80.0,
        np.linspace(80, 120, 40),
    ])
    volumes = np.concatenate([
        np.ones(80) * 1_000_000,
        np.ones(40) * 500_000,
        np.ones(40) * 400_000,
        np.ones(40) * 50_000,
    ])
    df = pd.DataFrame({"Close": prices, "Volume": volumes})
    result = get_volume_profile(df, bins=50)
    assert "poc" in result
    assert "hvn" in result
    assert "lvn" in result
    assert result["poc"] is not None
    assert abs(result["poc"] - 100.0) < 5.0
    assert len(result["hvn"]) <= 3
    assert isinstance(result["hvn"], list)
    assert isinstance(result["lvn"], list)

def test_get_volume_profile_returns_empty_on_insufficient_data():
    from services.indicators import get_volume_profile
    assert get_volume_profile(pd.DataFrame()) == {"poc": None, "hvn": [], "lvn": []}
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```
cd backend && python -m pytest tests/test_indicators.py::test_get_volume_profile_returns_poc_hvn_lvn tests/test_indicators.py::test_get_volume_profile_returns_empty_on_insufficient_data -v
```

Expected: `ImportError` 또는 `AttributeError: module has no attribute 'get_volume_profile'`

- [ ] **Step 3: indicators.py에 get_volume_profile 추가**

`backend/services/indicators.py` 끝에 추가:

```python
def get_volume_profile(df: pd.DataFrame, bins: int = 50) -> dict:
    empty = {"poc": None, "hvn": [], "lvn": []}
    if df.empty or "Close" not in df.columns or "Volume" not in df.columns:
        return empty
    data = df[["Close", "Volume"]].dropna()
    if len(data) < 10:
        return empty
    prices = data["Close"].values
    volumes = data["Volume"].values
    min_p, max_p = prices.min(), prices.max()
    if max_p <= min_p:
        return empty

    bin_edges = np.linspace(min_p, max_p, bins + 1)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
    indices = np.clip(np.searchsorted(bin_edges[1:], prices), 0, bins - 1)
    bin_volumes = np.zeros(bins)
    for i, v in zip(indices, volumes):
        bin_volumes[i] += v

    poc_idx = int(np.argmax(bin_volumes))
    poc = round(float(bin_centers[poc_idx]), 2)

    hvn_indices: list[int] = []
    for idx in np.argsort(bin_volumes)[::-1]:
        if len(hvn_indices) >= 3:
            break
        if not any(abs(int(idx) - h) <= 1 for h in hvn_indices):
            hvn_indices.append(int(idx))
    hvn = sorted([round(float(bin_centers[i]), 2) for i in hvn_indices])

    lvn: list[float] = []
    if len(hvn) >= 2:
        active = bin_volumes[bin_volumes > 0]
        threshold = float(np.percentile(active, 20)) if len(active) > 0 else 0.0
        lo, hi = min(hvn), max(hvn)
        lvn = sorted([
            round(float(bin_centers[i]), 2)
            for i in range(bins)
            if 0 < bin_volumes[i] <= threshold and lo < bin_centers[i] < hi
        ])

    return {"poc": poc, "hvn": hvn, "lvn": lvn}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```
cd backend && python -m pytest tests/test_indicators.py -v
```

Expected: `8 passed`

- [ ] **Step 5: 커밋**

```
git add backend/services/indicators.py backend/tests/test_indicators.py
git commit -m "feat: add get_volume_profile — POC/HVN/LVN from 1y daily OHLCV"
```

---

## Task 2: report_generator.py — VP 호출 + summary + section8 (TDD)

**Files:**
- Modify: `backend/tests/test_report_generator.py`
- Modify: `backend/services/report_generator.py`

- [ ] **Step 1: test_report_generator.py 업데이트 — mock 확장 + 테스트 2개 추가**

`backend/tests/test_report_generator.py`의 `_mock_all()` 함수 안 `"services.report_generator.indicators.get_support_resistance"` 줄 **다음에** 아래 항목 추가:

```python
        "services.report_generator.indicators.get_volume_profile": MagicMock(return_value={
            "poc": 115.0,
            "hvn": [95.0, 115.0, 135.0],
            "lvn": [105.0, 125.0],
        }),
```

파일 끝에 테스트 2개 추가:

```python
def test_generate_report_summary_includes_volume_profile(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        md_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    json_path = Path(md_path).with_suffix(".json")
    summary = json.loads(json_path.read_text(encoding="utf-8"))
    assert "volume_profile" in summary
    assert summary["volume_profile"]["poc"] == 115.0
    assert summary["volume_profile"]["hvn"] == [95.0, 115.0, 135.0]
    assert summary["volume_profile"]["lvn"] == [105.0, 125.0]

def test_generate_report_section8_includes_volume_profile(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        md_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    content = Path(md_path).read_text(encoding="utf-8")
    assert "⑧ 매물대" in content
    assert "$115.00" in content
    assert "$95.00" in content
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```
cd backend && python -m pytest tests/test_report_generator.py::test_generate_report_summary_includes_volume_profile tests/test_report_generator.py::test_generate_report_section8_includes_volume_profile -v
```

Expected: 2 FAILED

- [ ] **Step 3: report_generator.py 업데이트**

`generate_report` 함수에서 `sr = indicators.get_support_resistance(...)` 줄 **바로 다음에** 추가:

```python
    vp = indicators.get_volume_profile(daily_df) if not daily_df.empty else {"poc": None, "hvn": [], "lvn": []}
```

`sections` 리스트에 `_section8(vp)` 추가:

```python
    sections = [
        _header(stock, quote, today),
        _section1(quote, competitor_quotes),
        _section2(financials),
        _section3(analyst, finviz),
        _section4(stock),
        _section5(stock),
        _section6(quote, news),
        _section7(timeframe_rsi, sr),
        _section8(vp),
    ]
```

`summary` dict에 `"volume_profile": vp` 추가:

```python
    summary = {
        "ticker": ticker,
        "name": stock.get("name", ticker),
        "date": today,
        "price": quote.get("price"),
        "target_mean": analyst.get("target_mean") or finviz.get("finviz_target"),
        "buy": analyst.get("buy", 0),
        "hold": analyst.get("hold", 0),
        "sell": analyst.get("sell", 0),
        "finviz_recom": finviz.get("finviz_recom"),
        "daily_rsi": timeframe_rsi.get("daily", {}),
        "volume_profile": vp,
    }
```

파일 끝에 `_section8` 함수 추가:

```python
def _section8(vp: dict) -> str:
    if not vp or vp.get("poc") is None:
        return ""
    poc = f"${vp['poc']:.2f}"
    hvn_str = " / ".join(f"${v:.2f}" for v in vp.get("hvn", [])) or "N/A"
    lvn_str = " / ".join(f"${v:.2f}" for v in vp.get("lvn", [])) or "N/A"
    lines = [
        "## ⑧ 매물대 분석 (Volume Profile, 1년 일봉)\n",
        "| POC | HVN (지지·저항 후보) | LVN (매물 공백) |",
        "|---|---|---|",
        f"| {poc} | {hvn_str} | {lvn_str} |",
    ]
    return "\n".join(lines)
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```
cd backend && python -m pytest tests/test_report_generator.py -v
```

Expected: `5 passed`

- [ ] **Step 5: 전체 회귀 확인**

```
cd backend && python -m pytest -v
```

Expected: `46 passed`

- [ ] **Step 6: 커밋**

```
git add backend/services/report_generator.py backend/tests/test_report_generator.py
git commit -m "feat: add volume_profile to report summary and section8 markdown"
```

---

## Task 3: Reports.jsx — POC 컬럼 + VolumeProfileTable

**Files:**
- Modify: `frontend/src/pages/Reports.jsx`

- [ ] **Step 1: VolumeProfileTable 컴포넌트 추가 + POC 컬럼 + 상세화면 렌더링**

`frontend/src/pages/Reports.jsx`에서 `RsiTable` 함수 **바로 아래**(58번째 줄 이후)에 `VolumeProfileTable` 컴포넌트 추가:

```jsx
function VolumeProfileTable({ vp }) {
  if (!vp || vp.poc == null) return null
  const hvnStr = vp.hvn?.length ? vp.hvn.map(v => `$${Number(v).toFixed(2)}`).join(' / ') : 'N/A'
  const lvnStr = vp.lvn?.length ? vp.lvn.map(v => `$${Number(v).toFixed(2)}`).join(' / ') : 'N/A'
  return (
    <div style={{ marginBottom: 16, overflowX: 'auto', background: '#111', borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ color: '#80cbc4', fontWeight: 600, fontSize: 12, marginBottom: 8 }}>매물대 분석 (Volume Profile, 1년 일봉)</div>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, color: '#ccc' }}>
        <thead>
          <tr style={{ background: '#1a2a3a' }}>
            <th style={TH}>POC</th>
            <th style={{ ...TH, color: '#81c784' }}>HVN (지지·저항)</th>
            <th style={{ ...TH, color: '#ffcc80' }}>LVN (매물 공백)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...TD, fontWeight: 600 }}>{fmt(vp.poc)}</td>
            <td style={{ ...TD, color: '#81c784' }}>{hvnStr}</td>
            <td style={{ ...TD, color: '#ffcc80' }}>{lvnStr}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
```

목록화면 `<thead>`에서 `현재가` 열 **다음에** `POC` 열 추가:

```jsx
                  <th style={TH}>현재가</th>
                  <th style={TH}>POC</th>
                  <th style={TH}>평균목표가</th>
```

목록화면 `<tbody>` 행에서 현재가 셀 **다음에** POC 셀 추가:

```jsx
                      <td style={TD}>{s ? fmt(s.price) : 'N/A'}</td>
                      <td style={TD}>{s?.volume_profile ? fmt(s.volume_profile.poc) : 'N/A'}</td>
                      <td style={TD}>{s ? fmt(s.target_mean) : 'N/A'}</td>
```

상세화면에서 `RsiTable` **바로 아래**에 `VolumeProfileTable` 추가:

```jsx
            {!loading && detail.summary?.daily_rsi && <RsiTable dailyRsi={detail.summary.daily_rsi} />}
            {!loading && detail.summary?.volume_profile && <VolumeProfileTable vp={detail.summary.volume_profile} />}
            {!loading && detail.content && <MarkdownViewer content={detail.content} ticker={selected.ticker} />}
```

- [ ] **Step 2: 백엔드 최종 회귀 확인**

```
cd backend && python -m pytest -v
```

Expected: `46 passed`

- [ ] **Step 3: 커밋**

```
git add frontend/src/pages/Reports.jsx
git commit -m "feat: add POC column to report list and VolumeProfileTable to detail view"
```

# 컨센서스 히스토리 백필 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FnGuide(KR) 및 yfinance(US)에서 과거 컨센서스 데이터를 가져와 백필하는 기능을 추가한다.

**Architecture:** `services/consensus.py`에 `backfill(ticker, market)` 함수를 추가해 KR은 FnGuide `03_A{gicode}.json`에서 날짜별 집계, US는 yfinance `recommendations`에서 월별 스냅샷을 가져온다. 새 엔드포인트 `POST /api/consensus/{ticker}/backfill`이 market을 최신 리포트 JSON에서 읽어 backfill을 호출한다. 프론트엔드 `ConsensusChart`에 "히스토리" 버튼을 추가한다.

**Tech Stack:** Python/requests, yfinance, FastAPI, pytest, React 18 + axios

---

## 데이터 소스 정리

| 시장 | 소스 | 제공 기간 | target_mean |
|------|------|-----------|-------------|
| KR | FnGuide `03_A{gicode}.json` | 최근 ~6주 날짜별 | ✅ AVG_PRC 필드 |
| US | yfinance `ticker.recommendations` | 최근 4개월 (월별) | ❌ None |

---

## File Map

| 역할 | 파일 | 변경 |
|------|------|------|
| 백필 로직 | `backend/services/consensus.py` | 수정 |
| backfill 엔드포인트 | `backend/routers/report.py` | 수정 |
| 테스트 | `backend/tests/test_consensus_router.py` | 수정 |
| 히스토리 버튼 | `frontend/src/pages/Reports.jsx` | 수정 |

---

## Task 1: backfill 로직 추가 (`services/consensus.py`)

**Files:**
- Modify: `backend/services/consensus.py`

- [ ] **Step 1: `backend/services/consensus.py` 전체를 아래 내용으로 교체**

```python
from __future__ import annotations
import json
from collections import defaultdict
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


def backfill(ticker: str, market: str) -> list[dict]:
    """외부 소스에서 과거 컨센서스를 가져와 기존에 없는 날짜만 추가한다."""
    upper = ticker.upper()
    existing = get_history(upper)
    existing_dates = {e["date"] for e in existing}

    fetched = _fetch_kr(upper) if market == "KR" else _fetch_us(upper)
    to_add = [e for e in fetched if e["date"] not in existing_dates]

    if not to_add:
        return []

    CONSENSUS_DIR.mkdir(parents=True, exist_ok=True)
    path = CONSENSUS_DIR / f"{upper}.json"
    merged = existing + to_add
    merged.sort(key=lambda e: e["date"], reverse=True)
    path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    return to_add


def _fetch_kr(ticker: str) -> list[dict]:
    """FnGuide에서 최근 ~6주 날짜별 컨센서스 수집."""
    import requests
    url = f"https://comp.fnguide.com/SVO2/json/data/01_06/03_A{ticker}.json"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://comp.fnguide.com/",
    }
    try:
        r = requests.get(url, headers=headers, timeout=8)
        r.raise_for_status()
        data = json.loads(r.content.decode("utf-8-sig"))
    except Exception:
        return []

    by_date: dict[str, list] = defaultdict(list)
    for item in data.get("comp", []):
        est_dt = item.get("EST_DT", "")
        if est_dt:
            by_date[est_dt].append(item)

    result = []
    for est_dt, items in sorted(by_date.items()):
        avg_prc_str = items[0].get("AVG_PRC", "")
        try:
            target_mean = float(avg_prc_str.replace(",", "")) if avg_prc_str else None
        except ValueError:
            target_mean = None
        recom_codes = []
        for item in items:
            try:
                recom_codes.append(float(item["RECOM_CD"]))
            except (ValueError, KeyError):
                pass
        result.append({
            "date": est_dt.replace("/", "-"),
            "target_mean": target_mean,
            "buy":  sum(1 for c in recom_codes if c >= 3.5),
            "hold": sum(1 for c in recom_codes if 2.5 <= c < 3.5),
            "sell": sum(1 for c in recom_codes if c < 2.5),
        })
    return result


def _fetch_us(ticker: str) -> list[dict]:
    """yfinance recommendations에서 최근 4개월 월별 컨센서스 수집."""
    try:
        import yfinance as yf
        recs = yf.Ticker(ticker).recommendations
        if recs is None or recs.empty:
            return []
    except Exception:
        return []

    result = []
    for _, row in recs.iterrows():
        period = str(row.get("period", ""))
        if not period.endswith("m"):
            continue
        result.append({
            "date": _period_to_date(period),
            "target_mean": None,
            "buy":  int(row.get("strongBuy", 0)) + int(row.get("buy", 0)),
            "hold": int(row.get("hold", 0)),
            "sell": int(row.get("sell", 0)) + int(row.get("strongSell", 0)),
        })
    return result


def _period_to_date(period: str) -> str:
    """yfinance period 문자열('0m', '-1m' 등)을 해당 월 1일 ISO 날짜로 변환."""
    offset = int(period.replace("m", ""))
    today = date.today()
    month = today.month + offset
    year = today.year
    while month <= 0:
        month += 12
        year -= 1
    return date(year, month, 1).isoformat()
```

- [ ] **Step 2: 커밋**

```bash
git add backend/services/consensus.py
git commit -m "feat: 컨센서스 backfill 함수 추가 (FnGuide KR / yfinance US)"
```

---

## Task 2: backfill 엔드포인트 추가 + 테스트

**Files:**
- Modify: `backend/routers/report.py`
- Modify: `backend/tests/test_consensus_router.py`

- [ ] **Step 1: 실패 테스트 추가**

`backend/tests/test_consensus_router.py` 파일 맨 끝에 아래 테스트를 추가한다:

```python
# --- backfill 테스트 ---

def test_backfill_kr(tmp_path):
    import requests as req_module
    reports_tmp = tmp_path / "reports"
    reports_tmp.mkdir()
    consensus_tmp = tmp_path / "consensus"
    ticker_dir = reports_tmp / "005930"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-19.json").write_text(
        json.dumps({"market": "KR", "target_mean": 352000}), encoding="utf-8"
    )
    mock_data = {
        "comp": [
            {"EST_DT": "2026/05/04", "TARGET_PRC": "320,000", "RECOM_CD": "5.00", "AVG_PRC": "310,000"},
            {"EST_DT": "2026/05/18", "TARGET_PRC": "350,000", "RECOM_CD": "5.00", "AVG_PRC": "330,000"},
        ]
    }
    mock_bytes = json.dumps(mock_data).encode("utf-8-sig")
    mock_resp = MagicMock()
    mock_resp.content = mock_bytes
    mock_resp.raise_for_status = lambda: None
    with patch("services.consensus.REPORTS_DIR", reports_tmp), \
         patch("services.consensus.CONSENSUS_DIR", consensus_tmp), \
         patch("requests.get", return_value=mock_resp):
        resp = client.post("/api/consensus/005930/backfill")
    assert resp.status_code == 200
    data = resp.json()
    assert data["added"] == 2
    dates = [e["date"] for e in data["entries"]]
    assert "2026-05-04" in dates
    assert "2026-05-18" in dates
    assert data["entries"][0]["target_mean"] == 310000.0


def test_backfill_us(tmp_path):
    import pandas as pd
    reports_tmp = tmp_path / "reports"
    reports_tmp.mkdir()
    consensus_tmp = tmp_path / "consensus"
    ticker_dir = reports_tmp / "AAPL"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-19.json").write_text(
        json.dumps({"market": "US", "target_mean": 200}), encoding="utf-8"
    )
    mock_recs = pd.DataFrame([
        {"period": "0m",  "strongBuy": 7, "buy": 23, "hold": 16, "sell": 1, "strongSell": 1},
        {"period": "-1m", "strongBuy": 7, "buy": 25, "hold": 14, "sell": 1, "strongSell": 1},
    ])
    mock_ticker = MagicMock()
    mock_ticker.recommendations = mock_recs
    with patch("services.consensus.REPORTS_DIR", reports_tmp), \
         patch("services.consensus.CONSENSUS_DIR", consensus_tmp), \
         patch("yfinance.Ticker", return_value=mock_ticker):
        resp = client.post("/api/consensus/AAPL/backfill")
    assert resp.status_code == 200
    data = resp.json()
    assert data["added"] == 2
    assert data["entries"][0]["buy"] == 30   # strongBuy(7) + buy(23)
    assert data["entries"][0]["hold"] == 16
    assert data["entries"][0]["target_mean"] is None


def test_backfill_skips_existing_dates(tmp_path):
    import pandas as pd
    from datetime import date as dt_date
    reports_tmp = tmp_path / "reports"
    reports_tmp.mkdir()
    consensus_tmp = tmp_path / "consensus"
    consensus_tmp.mkdir()
    ticker_dir = reports_tmp / "AAPL"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-19.json").write_text(
        json.dumps({"market": "US", "target_mean": 200}), encoding="utf-8"
    )
    today_first = dt_date.today().replace(day=1).isoformat()
    (consensus_tmp / "AAPL.json").write_text(
        json.dumps([{"date": today_first, "target_mean": 200, "buy": 30, "hold": 16, "sell": 2}]),
        encoding="utf-8",
    )
    mock_recs = pd.DataFrame([
        {"period": "0m", "strongBuy": 7, "buy": 23, "hold": 16, "sell": 1, "strongSell": 1},
    ])
    mock_ticker = MagicMock()
    mock_ticker.recommendations = mock_recs
    with patch("services.consensus.REPORTS_DIR", reports_tmp), \
         patch("services.consensus.CONSENSUS_DIR", consensus_tmp), \
         patch("yfinance.Ticker", return_value=mock_ticker):
        resp = client.post("/api/consensus/AAPL/backfill")
    assert resp.status_code == 200
    assert resp.json()["added"] == 0


def test_backfill_no_report(tmp_path):
    reports_tmp = tmp_path / "reports"
    reports_tmp.mkdir()
    consensus_tmp = tmp_path / "consensus"
    with patch("services.consensus.REPORTS_DIR", reports_tmp), \
         patch("services.consensus.CONSENSUS_DIR", consensus_tmp), \
         patch("routers.report.REPORTS_DIR", reports_tmp):
        resp = client.post("/api/consensus/UNKNOWN/backfill")
    assert resp.status_code == 400
```

`test_consensus_router.py` 파일 상단 `from unittest.mock import patch` 줄을 다음으로 교체한다:

```python
from unittest.mock import patch, MagicMock
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd /Users/calmonion/Project/PortfoliOn/backend && .venv/bin/python -m pytest tests/test_consensus_router.py::test_backfill_kr -v
```

Expected: `404` 또는 `AttributeError` — 엔드포인트 미존재

- [ ] **Step 3: `backend/routers/report.py`에 backfill 엔드포인트 추가**

기존 `@router.post("/consensus/{ticker}")` 엔드포인트 바로 아래(`@router.get("/schedule")` 앞)에 추가:

```python
@router.post("/consensus/{ticker}/backfill")
def backfill_consensus(ticker: str):
    upper = ticker.upper()
    ticker_dir = REPORTS_DIR / upper
    if not ticker_dir.exists():
        raise HTTPException(status_code=400, detail="리포트를 먼저 생성하세요")
    json_files = sorted(ticker_dir.glob("*.json"), reverse=True)
    if not json_files:
        raise HTTPException(status_code=400, detail="리포트를 먼저 생성하세요")
    summary = json.loads(json_files[0].read_text(encoding="utf-8"))
    market = summary.get("market", "US")
    added = consensus_svc.backfill(upper, market)
    return {"added": len(added), "entries": added}
```

`report.py` 상단에 `import json` 이 없다면 추가한다. (현재 이미 있음 — 1번째 줄 확인)

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd /Users/calmonion/Project/PortfoliOn/backend && .venv/bin/python -m pytest tests/test_consensus_router.py -v
```

Expected: 9개 모두 PASSED (기존 5개 + 신규 4개)

- [ ] **Step 5: 전체 테스트 통과 확인**

```bash
cd /Users/calmonion/Project/PortfoliOn/backend && .venv/bin/python -m pytest -v 2>&1 | tail -10
```

Expected: 기존 통과 테스트 유지

- [ ] **Step 6: 커밋**

```bash
git add backend/routers/report.py backend/tests/test_consensus_router.py
git commit -m "feat: POST /api/consensus/{ticker}/backfill 엔드포인트 추가"
```

---

## Task 3: 프론트엔드 — "히스토리" 버튼 추가

**Files:**
- Modify: `frontend/src/pages/Reports.jsx`

- [ ] **Step 1: `ConsensusChart` 컴포넌트에 backfill 상태와 함수 추가**

`Reports.jsx`에서 `ConsensusChart` 함수 내부, `const [collecting, setCollecting] = useState(false)` 줄 아래에 추가:

```jsx
const [backfilling, setBackfilling] = useState(false)
```

`collect` 함수 아래에 추가:

```jsx
  const backfill = async () => {
    setBackfilling(true)
    setError(null)
    try {
      await axios.post(`/api/consensus/${ticker}/backfill`)
      fetchData()
    } catch (e) {
      setError(e.response?.data?.detail || '히스토리 가져오기 실패')
    } finally {
      setBackfilling(false)
    }
  }
```

- [ ] **Step 2: "히스토리" 버튼을 "수집" 버튼 왼쪽에 추가**

현재 헤더 버튼 영역:

```jsx
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
```

다음으로 교체 (두 버튼을 gap 포함 flex로 묶음):

```jsx
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={backfill}
            disabled={backfilling || collecting}
            style={{
              background: 'transparent', border: '1px solid #444',
              color: backfilling ? '#4fc3f7' : '#aaa',
              borderRadius: 3, padding: '2px 8px', fontSize: 11,
              cursor: (backfilling || collecting) ? 'default' : 'pointer',
            }}
          >
            {backfilling ? '가져오는 중...' : '히스토리'}
          </button>
          <button
            onClick={collect}
            disabled={collecting || backfilling}
            style={{
              background: 'transparent', border: '1px solid #444',
              color: collecting ? '#4fc3f7' : '#aaa',
              borderRadius: 3, padding: '2px 8px', fontSize: 11,
              cursor: (collecting || backfilling) ? 'default' : 'pointer',
            }}
          >
            {collecting ? '수집 중...' : '수집'}
          </button>
        </div>
```

- [ ] **Step 3: 빌드 오류 없는지 확인**

```bash
cd /Users/calmonion/Project/PortfoliOn/frontend && npm run build 2>&1 | tail -10
```

Expected: `✓ built in`

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/Reports.jsx
git commit -m "feat: 컨센서스 추이에 히스토리 가져오기 버튼 추가"
```

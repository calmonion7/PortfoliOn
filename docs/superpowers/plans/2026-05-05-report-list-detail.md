# 리포트 목록/상세 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리포트 페이지를 요약 테이블(목록화면)과 마크다운+RSI 상세(상세화면)로 분리하고, RSI 예상 타점을 20/25/30/70/75/80으로 확장한다.

**Architecture:** 리포트 생성 시 `{date}.json` 요약 파일을 마크다운과 함께 저장하고, `/api/report/list`와 `/api/report/{ticker}/{date}` 두 엔드포인트가 summary를 함께 반환한다. 프론트엔드는 `view` 상태로 목록/상세 전환을 관리한다.

**Tech Stack:** Python 3.11, FastAPI, pandas, yfinance, React 18, axios

---

## 파일 구조

| 파일 | 변경 내용 |
|---|---|
| `backend/services/indicators.py` | `get_timeframe_rsi` — target_20/25/75/80 추가 |
| `backend/tests/test_indicators.py` | 새 필드 검증 추가 |
| `backend/services/report_generator.py` | JSON 저장, `_section7` 컬럼 확장, `import json` |
| `backend/tests/test_report_generator.py` | mock 업데이트, JSON/section7 테스트 추가 |
| `backend/routers/report.py` | list에 summary 포함, get_report에 summary 추가, `import json` |
| `backend/tests/test_report_router.py` | 신규 — list/get_report summary 테스트 |
| `frontend/src/pages/Reports.jsx` | 목록/상세 분리 전면 교체 |

---

## Task 1: indicators.py — RSI 타점 확장 (TDD)

**Files:**
- Modify: `backend/tests/test_indicators.py`
- Modify: `backend/services/indicators.py`

- [ ] **Step 1: test_indicators.py의 `test_get_timeframe_rsi_returns_all_timeframes` 업데이트**

`backend/tests/test_indicators.py`의 `test_get_timeframe_rsi_returns_all_timeframes` 함수를 아래로 교체:

```python
def test_get_timeframe_rsi_returns_all_timeframes():
    mock_ticker = MagicMock()
    df = pd.DataFrame({
        "Close": _make_price_series(100),
        "High": _make_price_series(100) + 1,
        "Low": _make_price_series(100) - 1,
    })
    mock_ticker.history.return_value = df
    with patch("services.indicators.yf.Ticker", return_value=mock_ticker):
        from services import indicators
        import importlib; importlib.reload(indicators)
        result = indicators.get_timeframe_rsi("TEST")
    assert "daily" in result
    assert "weekly" in result
    assert "monthly" in result
    for tf in ["daily", "weekly", "monthly"]:
        assert "rsi" in result[tf]
        assert "target_20" in result[tf]
        assert "target_25" in result[tf]
        assert "target_30" in result[tf]
        assert "target_70" in result[tf]
        assert "target_75" in result[tf]
        assert "target_80" in result[tf]
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```
cd backend && python -m pytest tests/test_indicators.py::test_get_timeframe_rsi_returns_all_timeframes -v
```

Expected: `KeyError: 'target_20'` 로 FAILED

- [ ] **Step 3: indicators.py의 `get_timeframe_rsi` 업데이트**

`backend/services/indicators.py`의 `get_timeframe_rsi` 함수를 아래로 교체:

```python
def get_timeframe_rsi(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    result = {}
    configs = [
        ("daily",   {"period": "1y",  "interval": "1d"}),
        ("weekly",  {"period": "5y",  "interval": "1wk"}),
        ("monthly", {"period": "10y", "interval": "1mo"}),
    ]
    for tf, params in configs:
        try:
            df = t.history(**params)
            if df.empty:
                result[tf] = {
                    "rsi": None,
                    "target_20": None, "target_25": None, "target_30": None,
                    "target_70": None, "target_75": None, "target_80": None,
                }
                continue
            rsi = calc_rsi(df["Close"])
            current_rsi = round(float(rsi.iloc[-1]), 2)
            result[tf] = {
                "rsi": current_rsi,
                "target_20": calc_rsi_target_price(df["Close"], rsi, 20.0),
                "target_25": calc_rsi_target_price(df["Close"], rsi, 25.0),
                "target_30": calc_rsi_target_price(df["Close"], rsi, 30.0),
                "target_70": calc_rsi_target_price(df["Close"], rsi, 70.0),
                "target_75": calc_rsi_target_price(df["Close"], rsi, 75.0),
                "target_80": calc_rsi_target_price(df["Close"], rsi, 80.0),
            }
        except Exception:
            result[tf] = {
                "rsi": None,
                "target_20": None, "target_25": None, "target_30": None,
                "target_70": None, "target_75": None, "target_80": None,
            }
    return result
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```
cd backend && python -m pytest tests/test_indicators.py -v
```

Expected: `6 passed`

- [ ] **Step 5: 커밋**

```
git add backend/services/indicators.py backend/tests/test_indicators.py
git commit -m "feat: expand RSI targets to 20/25/30/70/75/80 in get_timeframe_rsi"
```

---

## Task 2: report_generator.py — JSON 저장 + section7 확장 (TDD)

**Files:**
- Modify: `backend/tests/test_report_generator.py`
- Modify: `backend/services/report_generator.py`

- [ ] **Step 1: test_report_generator.py 업데이트 — mock 확장 + 테스트 2개 추가**

`backend/tests/test_report_generator.py` 전체를 아래로 교체:

```python
import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
import contextlib
import pandas as pd

SAMPLE_STOCK = {
    "ticker": "TEST",
    "name": "Test Corp",
    "quantity": 10,
    "avg_cost": 100.0,
    "competitors": [],
    "moat": "Strong brand",
    "growth_plan": "Expand to Asia",
}

def _mock_all():
    df = pd.DataFrame({
        "Close": [100.0 + i for i in range(50)],
        "High":  [101.0 + i for i in range(50)],
        "Low":   [99.0  + i for i in range(50)],
    })
    return {
        "services.report_generator.market.get_quote": MagicMock(return_value={
            "ticker": "TEST", "name": "Test Corp", "price": 120.0,
            "prev_close": 118.0, "daily_change": "+1.69%",
            "market_cap": 500_000_000_000, "ytd_return": 15.0,
        }),
        "services.report_generator.market.get_financials": MagicMock(return_value=[
            {"period": "2025-Q4", "revenue": 10_000_000_000, "operating_income": 2_000_000_000},
        ]),
        "services.report_generator.market.get_analyst_data": MagicMock(return_value={
            "target_mean": 150.0, "target_high": 200.0, "target_low": 120.0,
            "buy": 15, "hold": 5, "sell": 2,
        }),
        "services.report_generator.indicators.get_timeframe_rsi": MagicMock(return_value={
            "daily": {
                "rsi": 55.0,
                "target_20": 80.0, "target_25": 85.0, "target_30": 90.0,
                "target_70": 130.0, "target_75": 135.0, "target_80": 140.0,
            },
            "weekly": {
                "rsi": 60.0,
                "target_20": 75.0, "target_25": 80.0, "target_30": 85.0,
                "target_70": 140.0, "target_75": 145.0, "target_80": 150.0,
            },
            "monthly": {
                "rsi": 50.0,
                "target_20": 70.0, "target_25": 75.0, "target_30": 80.0,
                "target_70": 145.0, "target_75": 150.0, "target_80": 155.0,
            },
        }),
        "services.report_generator.indicators.get_support_resistance": MagicMock(return_value={
            "week52_high": 135.0, "week52_low": 90.0,
            "ema20": 118.0, "ema50": 115.0, "ema200": 110.0,
        }),
        "services.report_generator.scraper.scrape_finviz_consensus": MagicMock(return_value={
            "finviz_recom": 1.8,
        }),
        "services.report_generator.scraper.get_news": MagicMock(return_value=[
            {"title": "Test news", "link": "https://example.com",
             "publisher": "Reuters", "published_at": "2026-05-04 09:00"}
        ]),
        "services.report_generator.charts.generate_revenue_chart": MagicMock(return_value=""),
        "services.report_generator.charts.generate_rsi_chart": MagicMock(return_value=""),
        "services.report_generator.yf.Ticker": MagicMock(
            return_value=MagicMock(history=MagicMock(return_value=df))
        ),
    }

def test_generate_report_creates_markdown_file(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        md_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    assert md_path.endswith(".md")
    content = Path(md_path).read_text(encoding="utf-8")
    assert "Test Corp" in content
    assert "① 사업영역" in content
    assert "② 매출" in content
    assert "③ 증권사" in content
    assert "④ 경제적 해자" in content
    assert "Strong brand" in content
    assert "⑤ 장기 성장 계획" in content
    assert "Expand to Asia" in content
    assert "⑥ 최근 공시" in content
    assert "⑦ 매수/매도" in content

def test_generate_report_saves_json_summary(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        md_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    json_path = Path(md_path).with_suffix(".json")
    assert json_path.exists(), "JSON summary file should be created alongside markdown"
    summary = json.loads(json_path.read_text(encoding="utf-8"))
    assert summary["ticker"] == "TEST"
    assert summary["name"] == "Test Corp"
    assert summary["target_mean"] == 150.0
    assert summary["buy"] == 15
    assert summary["hold"] == 5
    assert summary["sell"] == 2
    assert summary["finviz_recom"] == 1.8
    assert "daily_rsi" in summary
    assert summary["daily_rsi"]["rsi"] == 55.0
    assert summary["daily_rsi"]["target_20"] == 80.0

def test_generate_report_section7_includes_expanded_rsi_columns(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        md_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    content = Path(md_path).read_text(encoding="utf-8")
    assert "RSI20" in content
    assert "RSI25" in content
    assert "RSI75" in content
    assert "RSI80" in content
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```
cd backend && python -m pytest tests/test_report_generator.py -v
```

Expected: `test_generate_report_saves_json_summary` FAILED (FileNotFoundError),  
`test_generate_report_section7_includes_expanded_rsi_columns` FAILED (AssertionError)

- [ ] **Step 3: report_generator.py 업데이트**

`backend/services/report_generator.py` 상단에 `import json` 추가:

```python
from pathlib import Path
from datetime import date
import json
import pandas as pd
import yfinance as yf

from services import market, indicators, scraper, charts
```

`generate_report` 함수에서 `md_path.write_text(...)` 이후, `return str(md_path)` 직전에 아래 코드 추가:

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
    }
    json_path = output_dir / f"{today}.json"
    json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
```

`_section7` 함수 전체를 아래로 교체:

```python
def _section7(timeframe_rsi: dict, sr: dict) -> str:
    lines = [
        "## ⑦ 매수/매도 타점\n",
        "### RSI 현황\n",
        "| 시간대 | 현재 RSI | RSI20 | RSI25 | RSI30 | RSI70 | RSI75 | RSI80 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for tf, label in [("daily", "일봉"), ("weekly", "주봉"), ("monthly", "월봉")]:
        d = timeframe_rsi.get(tf, {})
        rsi = f"{d['rsi']:.1f}" if d.get("rsi") else "N/A"
        t20 = f"${d['target_20']:.2f}" if d.get("target_20") else "N/A"
        t25 = f"${d['target_25']:.2f}" if d.get("target_25") else "N/A"
        t30 = f"${d['target_30']:.2f}" if d.get("target_30") else "N/A"
        t70 = f"${d['target_70']:.2f}" if d.get("target_70") else "N/A"
        t75 = f"${d['target_75']:.2f}" if d.get("target_75") else "N/A"
        t80 = f"${d['target_80']:.2f}" if d.get("target_80") else "N/A"
        lines.append(f"| {label} | {rsi} | {t20} | {t25} | {t30} | {t70} | {t75} | {t80} |")
    lines += [
        "\n### 지지·저항 & EMA\n",
        "| 항목 | 값 |",
        "|---|---|",
        f"| 52주 고점 | ${sr['week52_high']:.2f} |" if sr.get("week52_high") else "| 52주 고점 | N/A |",
        f"| 52주 저점 | ${sr['week52_low']:.2f} |" if sr.get("week52_low") else "| 52주 저점 | N/A |",
        f"| EMA(20) | ${sr['ema20']:.2f} |" if sr.get("ema20") else "| EMA(20) | N/A |",
        f"| EMA(50) | ${sr['ema50']:.2f} |" if sr.get("ema50") else "| EMA(50) | N/A |",
        f"| EMA(200) | ${sr['ema200']:.2f} |" if sr.get("ema200") else "| EMA(200) | N/A |",
        "\n![RSI Chart](./rsi_chart.png)",
    ]
    return "\n".join(lines)
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```
cd backend && python -m pytest tests/test_report_generator.py -v
```

Expected: `3 passed`

- [ ] **Step 5: 커밋**

```
git add backend/services/report_generator.py backend/tests/test_report_generator.py
git commit -m "feat: save JSON summary per report, expand section7 RSI columns"
```

---

## Task 3: report.py — list/get_report에 summary 추가 (TDD)

**Files:**
- Create: `backend/tests/test_report_router.py`
- Modify: `backend/routers/report.py`

- [ ] **Step 1: test_report_router.py 신규 생성**

`backend/tests/test_report_router.py`를 아래 내용으로 생성:

```python
import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.report import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)

FULL_PORTFOLIO = {
    "stocks": [{"ticker": "LLY", "quantity": 3.0, "avg_cost": 886.6,
                "name": "일라이 릴리", "competitors": [], "moat": "", "growth_plan": ""}],
    "watchlist": [],
}

SAMPLE_SUMMARY = {
    "ticker": "LLY", "name": "일라이 릴리", "date": "2026-05-05",
    "price": 890.0, "target_mean": 980.0, "buy": 15, "hold": 3, "sell": 1,
    "finviz_recom": 1.8,
    "daily_rsi": {
        "rsi": 45.2,
        "target_20": 800.0, "target_25": 830.0, "target_30": 860.0,
        "target_70": 940.0, "target_75": 960.0, "target_80": 975.0,
    },
}


def test_list_reports_includes_summary(tmp_path):
    ticker_dir = tmp_path / "LLY"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-05.md").write_text("# report", encoding="utf-8")
    (ticker_dir / "2026-05-05.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    with patch("routers.report.REPORTS_DIR", tmp_path), \
         patch("routers.report.storage.get_full_portfolio", return_value=FULL_PORTFOLIO):
        resp = client.get("/api/report/list")
    assert resp.status_code == 200
    data = resp.json()
    assert "LLY" in data
    assert data["LLY"]["summary"]["target_mean"] == 980.0
    assert data["LLY"]["summary"]["daily_rsi"]["target_20"] == 800.0


def test_list_reports_summary_null_when_no_json(tmp_path):
    ticker_dir = tmp_path / "LLY"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-05.md").write_text("# report", encoding="utf-8")
    with patch("routers.report.REPORTS_DIR", tmp_path), \
         patch("routers.report.storage.get_full_portfolio", return_value=FULL_PORTFOLIO):
        resp = client.get("/api/report/list")
    assert resp.status_code == 200
    assert resp.json()["LLY"]["summary"] is None


def test_get_report_includes_summary(tmp_path):
    ticker_dir = tmp_path / "LLY"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-05.md").write_text("# LLY report content", encoding="utf-8")
    (ticker_dir / "2026-05-05.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    with patch("routers.report.REPORTS_DIR", tmp_path):
        resp = client.get("/api/report/LLY/2026-05-05")
    assert resp.status_code == 200
    assert "LLY report content" in resp.json()["content"]
    assert resp.json()["summary"]["daily_rsi"]["rsi"] == 45.2
    assert resp.json()["summary"]["target_mean"] == 980.0


def test_get_report_summary_null_when_no_json(tmp_path):
    ticker_dir = tmp_path / "LLY"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-05.md").write_text("# LLY report content", encoding="utf-8")
    with patch("routers.report.REPORTS_DIR", tmp_path):
        resp = client.get("/api/report/LLY/2026-05-05")
    assert resp.status_code == 200
    assert resp.json()["summary"] is None
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```
cd backend && python -m pytest tests/test_report_router.py -v
```

Expected: `test_list_reports_includes_summary` FAILED (KeyError 'summary'),  
`test_get_report_includes_summary` FAILED (KeyError 'summary')

- [ ] **Step 3: report.py 업데이트**

`backend/routers/report.py` 전체를 아래로 교체:

```python
import json
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pathlib import Path
from services import storage, report_generator

router = APIRouter(prefix="/api", tags=["report"])

REPORTS_DIR = Path(__file__).parent.parent / "reports"


@router.post("/report/generate", status_code=202)
def generate_all(background_tasks: BackgroundTasks):
    portfolio = storage.get_full_portfolio()
    stocks = portfolio.get("stocks", []) + portfolio.get("watchlist", [])
    if not stocks:
        raise HTTPException(status_code=400, detail="No stocks in portfolio or watchlist")
    background_tasks.add_task(_run_generation, stocks)
    return {"message": f"Generating reports for {len(stocks)} stock(s)"}


@router.post("/report/generate/{ticker}", status_code=202)
def generate_one(ticker: str, background_tasks: BackgroundTasks):
    portfolio = storage.get_full_portfolio()
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


def _run_generation(stocks: list):
    for stock in stocks:
        try:
            report_generator.generate_report(stock)
        except Exception as e:
            print(f"[Report] Failed for {stock['ticker']}: {e}")


def _read_summary(json_path: Path) -> dict | None:
    if json_path.exists():
        return json.loads(json_path.read_text(encoding="utf-8"))
    return None


@router.get("/report/list")
def list_reports():
    portfolio = storage.get_full_portfolio()
    holding_tickers = {s["ticker"].upper() for s in portfolio.get("stocks", [])}
    watchlist_tickers = {s["ticker"].upper() for s in portfolio.get("watchlist", [])}

    result = {}
    if not REPORTS_DIR.exists():
        return result
    for ticker_dir in sorted(REPORTS_DIR.iterdir()):
        if ticker_dir.is_dir():
            dates = sorted([f.stem for f in ticker_dir.glob("*.md")], reverse=True)
            if dates:
                ticker = ticker_dir.name.upper()
                category = "holdings" if ticker in holding_tickers else \
                           "watchlist" if ticker in watchlist_tickers else "other"
                summary = _read_summary(ticker_dir / f"{dates[0]}.json")
                result[ticker_dir.name] = {"dates": dates, "category": category, "summary": summary}
    return result


@router.get("/report/{ticker}/{date_str}")
def get_report(ticker: str, date_str: str):
    upper = ticker.upper()
    path = REPORTS_DIR / upper / f"{date_str}.md"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Report not found")
    summary = _read_summary(REPORTS_DIR / upper / f"{date_str}.json")
    return {
        "ticker": upper,
        "date": date_str,
        "content": path.read_text(encoding="utf-8"),
        "summary": summary,
    }


@router.get("/schedule")
def get_schedule():
    return storage.get_schedule()


@router.put("/schedule")
def update_schedule(schedule: dict):
    required = {"enabled", "time", "days"}
    if not required.issubset(schedule.keys()):
        raise HTTPException(
            status_code=400, detail=f"Missing fields: {required - schedule.keys()}"
        )
    storage.save_schedule(schedule)
    return schedule
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```
cd backend && python -m pytest tests/test_report_router.py -v
```

Expected: `4 passed`

- [ ] **Step 5: 전체 테스트 회귀 확인**

```
cd backend && python -m pytest -v
```

Expected: `42 passed` (기존 38 + 신규 4)

- [ ] **Step 6: 커밋**

```
git add backend/routers/report.py backend/tests/test_report_router.py
git commit -m "feat: include summary in report list and get_report endpoints"
```

---

## Task 4: Reports.jsx — 목록/상세 분리

**Files:**
- Modify: `frontend/src/pages/Reports.jsx`

- [ ] **Step 1: Reports.jsx 전체를 아래로 교체**

`frontend/src/pages/Reports.jsx` 전체 내용을 아래로 교체:

```jsx
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import MarkdownViewer from '../components/MarkdownViewer'

const TAB_STYLE = (active) => ({
  padding: '6px 14px',
  cursor: 'pointer',
  border: 'none',
  borderBottom: active ? '2px solid #4fc3f7' : '2px solid transparent',
  background: 'transparent',
  color: active ? '#4fc3f7' : '#888',
  fontWeight: active ? 600 : 400,
  fontSize: 13,
})

const TH = { padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid #333', whiteSpace: 'nowrap', fontSize: 11, color: '#aaa' }
const TD = { padding: '5px 10px', textAlign: 'right', borderBottom: '1px solid #1e1e1e', fontSize: 12 }

const fmt = (val) => val != null ? `$${Number(val).toFixed(2)}` : 'N/A'
const fmtN = (val) => val != null ? val : 'N/A'

function RsiTable({ dailyRsi }) {
  if (!dailyRsi) return null
  return (
    <div style={{ marginBottom: 16, overflowX: 'auto', background: '#111', borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ color: '#80cbc4', fontWeight: 600, fontSize: 12, marginBottom: 8 }}>RSI 예상 타점 (일봉)</div>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, color: '#ccc' }}>
        <thead>
          <tr style={{ background: '#1a2a3a' }}>
            <th style={{ ...TH, color: '#81c784' }}>RSI20</th>
            <th style={{ ...TH, color: '#81c784' }}>RSI25</th>
            <th style={{ ...TH, color: '#81c784' }}>RSI30</th>
            <th style={{ ...TH, color: '#aaa' }}>현재RSI</th>
            <th style={{ ...TH, color: '#ef9a9a' }}>RSI70</th>
            <th style={{ ...TH, color: '#ef9a9a' }}>RSI75</th>
            <th style={{ ...TH, color: '#ef9a9a' }}>RSI80</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...TD, color: '#81c784' }}>{fmt(dailyRsi.target_20)}</td>
            <td style={{ ...TD, color: '#81c784' }}>{fmt(dailyRsi.target_25)}</td>
            <td style={{ ...TD, color: '#81c784' }}>{fmt(dailyRsi.target_30)}</td>
            <td style={TD}>{fmtN(dailyRsi.rsi)}</td>
            <td style={{ ...TD, color: '#ef9a9a' }}>{fmt(dailyRsi.target_70)}</td>
            <td style={{ ...TD, color: '#ef9a9a' }}>{fmt(dailyRsi.target_75)}</td>
            <td style={{ ...TD, color: '#ef9a9a' }}>{fmt(dailyRsi.target_80)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export default function Reports() {
  const [reportList, setReportList] = useState({})
  const [selected, setSelected] = useState({ ticker: null, date: null })
  const [detail, setDetail] = useState({ content: '', summary: null })
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(null)
  const [activeTab, setActiveTab] = useState('holdings')
  const [view, setView] = useState('list')

  const fetchList = useCallback(() => {
    axios.get('/api/report/list').then(({ data }) => setReportList(data))
  }, [])

  useEffect(() => { fetchList() }, [])

  useEffect(() => {
    if (!selected.ticker || !selected.date) return
    setLoading(true)
    axios.get(`/api/report/${selected.ticker}/${selected.date}`)
      .then(({ data }) => setDetail({ content: data.content, summary: data.summary }))
      .finally(() => setLoading(false))
  }, [selected])

  const openDetail = (ticker, date) => {
    setSelected({ ticker, date })
    setView('detail')
  }

  const generateOne = async (ticker) => {
    setGenerating(ticker)
    try {
      await axios.post(`/api/report/generate/${ticker}`)
      setTimeout(() => { fetchList(); setGenerating(null) }, 2000)
    } catch {
      setGenerating(null)
    }
  }

  const holdingsCount = Object.values(reportList).filter(v => v.category === 'holdings').length
  const watchlistCount = Object.values(reportList).filter(v => v.category === 'watchlist').length
  const tabEntries = Object.entries(reportList).filter(([, v]) => v.category === activeTab)
  const otherEntries = Object.entries(reportList).filter(([, v]) => v.category === 'other')

  const renderTickerItem = (ticker, info) => (
    <div key={ticker} style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ color: '#80cbc4', fontWeight: 600, fontSize: 13 }}>{ticker}</span>
        <button
          onClick={() => generateOne(ticker)}
          disabled={generating === ticker}
          style={{ background: 'transparent', border: '1px solid #444', color: generating === ticker ? '#666' : '#aaa', borderRadius: 3, padding: '1px 6px', fontSize: 11, cursor: generating === ticker ? 'default' : 'pointer' }}
        >
          {generating === ticker ? '생성중' : '생성'}
        </button>
      </div>
      {info.dates.map(date => (
        <div
          key={date}
          onClick={() => openDetail(ticker, date)}
          style={{ padding: '3px 8px', cursor: 'pointer', borderRadius: 4, fontSize: 12, background: selected.ticker === ticker && selected.date === date && view === 'detail' ? '#1565c0' : 'transparent', color: selected.ticker === ticker && selected.date === date && view === 'detail' ? 'white' : '#aaa' }}
        >
          {date}
        </div>
      ))}
    </div>
  )

  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 120px)' }}>
      {/* 좌측 사이드바 */}
      <div style={{ width: 210, overflowY: 'auto', borderRight: '1px solid #333', paddingRight: 16, flexShrink: 0 }}>
        <h3 style={{ color: '#90caf9', marginBottom: 8 }}>리포트 목록</h3>
        <div style={{ display: 'flex', borderBottom: '1px solid #333', marginBottom: 12 }}>
          <button style={TAB_STYLE(activeTab === 'holdings')} onClick={() => setActiveTab('holdings')}>보유 ({holdingsCount})</button>
          <button style={TAB_STYLE(activeTab === 'watchlist')} onClick={() => setActiveTab('watchlist')}>관심 ({watchlistCount})</button>
        </div>
        {tabEntries.length === 0 && <p style={{ color: '#666', fontSize: 12 }}>리포트 없음</p>}
        {tabEntries.map(([t, info]) => renderTickerItem(t, info))}
        {otherEntries.length > 0 && (
          <>
            <div style={{ color: '#555', fontSize: 11, marginTop: 12, marginBottom: 6 }}>기타</div>
            {otherEntries.map(([t, info]) => renderTickerItem(t, info))}
          </>
        )}
      </div>

      {/* 우측 패널 */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: view === 'list' ? 'auto' : 'hidden' }}>
        {view === 'list' ? (
          /* 목록화면 */
          tabEntries.length === 0 ? (
            <div style={{ textAlign: 'center', marginTop: 80, color: '#666' }}>
              <p>리포트가 없습니다.</p>
              <p style={{ marginTop: 8, fontSize: 13 }}>설정 페이지에서 "지금 생성" 버튼을 눌러 첫 리포트를 만드세요.</p>
            </div>
          ) : (
            <table style={{ borderCollapse: 'collapse', color: '#ccc', width: '100%' }}>
              <thead>
                <tr style={{ background: '#1a2a3a', position: 'sticky', top: 0 }}>
                  <th style={{ ...TH, textAlign: 'left' }}>종목명 (티커)</th>
                  <th style={TH}>현재가</th>
                  <th style={TH}>평균목표가</th>
                  <th style={{ ...TH, color: '#81c784' }}>Buy</th>
                  <th style={TH}>Hold</th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>Sell</th>
                  <th style={TH}>Finviz</th>
                  <th style={{ ...TH, color: '#81c784' }}>RSI20</th>
                  <th style={{ ...TH, color: '#81c784' }}>RSI25</th>
                  <th style={{ ...TH, color: '#81c784' }}>RSI30</th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>RSI70</th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>RSI75</th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>RSI80</th>
                </tr>
              </thead>
              <tbody>
                {tabEntries.map(([ticker, info]) => {
                  const s = info.summary
                  const dr = s?.daily_rsi
                  return (
                    <tr
                      key={ticker}
                      onClick={() => openDetail(ticker, info.dates[0])}
                      style={{ cursor: 'pointer', borderBottom: '1px solid #222' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#1a2a3a'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ ...TD, textAlign: 'left', color: '#80cbc4', fontWeight: 600 }}>
                        {s?.name || ticker} <span style={{ color: '#666', fontWeight: 400 }}>({ticker})</span>
                      </td>
                      <td style={TD}>{s ? fmt(s.price) : 'N/A'}</td>
                      <td style={TD}>{s ? fmt(s.target_mean) : 'N/A'}</td>
                      <td style={{ ...TD, color: '#81c784' }}>{s ? fmtN(s.buy) : 'N/A'}</td>
                      <td style={TD}>{s ? fmtN(s.hold) : 'N/A'}</td>
                      <td style={{ ...TD, color: '#ef9a9a' }}>{s ? fmtN(s.sell) : 'N/A'}</td>
                      <td style={TD}>{s ? fmtN(s.finviz_recom) : 'N/A'}</td>
                      <td style={{ ...TD, color: '#81c784' }}>{dr ? fmt(dr.target_20) : 'N/A'}</td>
                      <td style={{ ...TD, color: '#81c784' }}>{dr ? fmt(dr.target_25) : 'N/A'}</td>
                      <td style={{ ...TD, color: '#81c784' }}>{dr ? fmt(dr.target_30) : 'N/A'}</td>
                      <td style={{ ...TD, color: '#ef9a9a' }}>{dr ? fmt(dr.target_70) : 'N/A'}</td>
                      <td style={{ ...TD, color: '#ef9a9a' }}>{dr ? fmt(dr.target_75) : 'N/A'}</td>
                      <td style={{ ...TD, color: '#ef9a9a' }}>{dr ? fmt(dr.target_80) : 'N/A'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        ) : (
          /* 상세화면 */
          <div>
            <button
              onClick={() => setView('list')}
              style={{ background: 'transparent', border: '1px solid #444', color: '#aaa', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer', marginBottom: 16 }}
            >
              ← 목록으로
            </button>
            {loading && <p style={{ color: '#aaa' }}>로딩 중...</p>}
            {!loading && detail.summary?.daily_rsi && <RsiTable dailyRsi={detail.summary.daily_rsi} />}
            {!loading && detail.content && <MarkdownViewer content={detail.content} ticker={selected.ticker} />}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 최종 백엔드 테스트 — 회귀 없음 확인**

```
cd backend && python -m pytest -v
```

Expected: `42 passed`

- [ ] **Step 3: 커밋**

```
git add frontend/src/pages/Reports.jsx
git commit -m "feat: split reports into list table and detail view with RSI section"
```

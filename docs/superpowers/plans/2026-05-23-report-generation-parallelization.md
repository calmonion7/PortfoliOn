# Report Generation Parallelization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리포트 생성 속도를 종목 내 I/O 병렬화 + 종목 간 병렬화로 단축한다 (10종목 기준 ~100초 → ~6초).

**Architecture:** `generate_report`의 8개 순차 네트워크 호출을 `ThreadPoolExecutor`로 동시 실행하고, `_run_generation`의 순차 루프도 `ThreadPoolExecutor(max_workers=5)`로 교체한다.

**Tech Stack:** Python `concurrent.futures.ThreadPoolExecutor`, FastAPI BackgroundTasks, yfinance, pytest + unittest.mock

---

## File Map

| File | Change |
|------|--------|
| `backend/services/report_generator.py` | `generate_report` — 순차 I/O → ThreadPoolExecutor 병렬 |
| `backend/routers/report.py` | `_run_generation` — 순차 루프 → ThreadPoolExecutor 병렬 |
| `backend/tests/test_report_generator.py` | 기존 테스트 유지 + 병렬 호출 확인 테스트 추가 |
| `backend/tests/test_report_router.py` | 기존 테스트 유지 + 병렬 생성 완료 확인 테스트 추가 |

---

## Task 1: generate_report 내부 I/O 병렬화

**Files:**
- Modify: `backend/services/report_generator.py:1-8` (import 추가), `backend/services/report_generator.py:13-114` (함수 본체 교체)
- Test: `backend/tests/test_report_generator.py`

### 사전 확인

- [ ] **Step 1: 기존 테스트 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_report_generator.py -v
```

Expected: 5개 테스트 모두 PASS

### 구현

- [ ] **Step 2: `report_generator.py` import에 `ThreadPoolExecutor` 추가**

`backend/services/report_generator.py` 파일 첫 줄 블록을 아래로 교체:

```python
from pathlib import Path
from datetime import date, timedelta
from concurrent.futures import ThreadPoolExecutor
import json
import pandas as pd
import yfinance as yf

from services import market as mkt, indicators, scraper
from services.utils import sanitize as _sanitize
```

- [ ] **Step 3: `generate_report` 함수 본체를 병렬 버전으로 교체**

`generate_report` 함수 전체 (lines 13–114)를 아래로 교체:

```python
def generate_report(stock: dict, output_base_dir: Path = SNAPSHOTS_DIR) -> str:
    ticker = stock["ticker"]
    market = stock.get("market", "US")
    exchange = stock.get("exchange", "")
    yf_sym = mkt._yf_sym(ticker, market, exchange)
    today = date.today().strftime("%Y-%m-%d")
    output_dir = output_base_dir / ticker
    output_dir.mkdir(parents=True, exist_ok=True)

    competitors = stock.get("competitors", [])

    with ThreadPoolExecutor(max_workers=8) as ex:
        f_quote     = ex.submit(mkt.get_quote, ticker, market, exchange)
        f_fin       = ex.submit(mkt.get_financials, ticker, market, exchange)
        f_fin_ann   = ex.submit(mkt.get_annual_financials, ticker, market, exchange)
        f_analyst   = ex.submit(mkt.get_analyst_data, ticker, market, exchange)
        f_rsi       = ex.submit(indicators.get_timeframe_rsi, yf_sym)
        f_history   = ex.submit(yf.Ticker(yf_sym).history, period="1y")
        f_info      = ex.submit(lambda: yf.Ticker(yf_sym).info) if market == "US" else None
        f_finviz    = ex.submit(scraper.scrape_finviz_consensus, ticker) if market == "US" else None
        f_news      = ex.submit(scraper.get_news, ticker, market)
        f_comps     = [ex.submit(mkt.get_quote, c, market, exchange) for c in competitors]

    quote             = f_quote.result()
    financials        = f_fin.result()
    financials_annual = f_fin_ann.result()
    analyst           = f_analyst.result()
    timeframe_rsi     = f_rsi.result()
    daily_df          = f_history.result()
    finviz            = f_finviz.result() if f_finviz else {}
    news              = f_news.result()
    competitor_quotes = [f.result() for f in f_comps]

    vp = indicators.get_volume_profile(daily_df)

    high_20d = round(float(daily_df["High"].tail(20).max()), 2) if not daily_df.empty else None
    _cur = quote.get("price")
    drop_from_high_20d = round((_cur - high_20d) / high_20d * 100, 2) if high_20d and _cur else None

    if market == "KR":
        sector = quote.get("sector", "")
        industry = quote.get("industry", "")
        current_price = quote.get("price")
        actual_f = [f for f in financials if not f.get("is_consensus")]
        eps_list = [f["eps"] for f in actual_f if f.get("eps") is not None]
        trailing_eps = sum(eps_list[:4]) if len(eps_list) >= 2 else None
        trailing_per = round(current_price / trailing_eps, 1) if current_price and trailing_eps else None
        consensus_f = next((f for f in financials if f.get("is_consensus") and f.get("eps")), None)
        forward_per = round(current_price / (consensus_f["eps"] * 4), 1) if current_price and consensus_f else None
        actual_bps = next((f["bps"] for f in actual_f if f.get("bps") is not None), None)
        pbr = round(current_price / actual_bps, 2) if current_price and actual_bps else None
    else:
        try:
            _info = f_info.result()
            sector = _info.get("sector", "")
            industry = _info.get("industry", "")
            trailing_per = _info.get("trailingPE")
            forward_per = _info.get("forwardPE")
            pbr = _info.get("priceToBook")
        except Exception:
            sector, industry = "", ""
            trailing_per = forward_per = pbr = None

    summary = {
        "ticker": ticker,
        "name": stock.get("name", ticker),
        "date": today,
        "market": market,
        "price": quote.get("price"),
        "target_mean": analyst.get("target_mean") or finviz.get("finviz_target"),
        "target_high": analyst.get("target_high"),
        "target_low": analyst.get("target_low"),
        "buy": analyst.get("buy", 0),
        "hold": analyst.get("hold", 0),
        "sell": analyst.get("sell", 0),
        "finviz_recom": finviz.get("finviz_recom"),
        "daily_rsi": timeframe_rsi.get("daily", {}),
        "weekly_rsi": timeframe_rsi.get("weekly", {}),
        "monthly_rsi": timeframe_rsi.get("monthly", {}),
        "volume_profile": vp,
        "financials": financials,
        "financials_annual": financials_annual,
        "sector": sector,
        "industry": industry,
        "per": round(trailing_per, 2) if trailing_per else None,
        "forward_per": round(forward_per, 2) if forward_per else None,
        "pbr": round(pbr, 2) if pbr else None,
        "high_20d": high_20d,
        "drop_from_high_20d": drop_from_high_20d,
        "moat": stock.get("moat", ""),
        "growth_plan": stock.get("growth_plan", ""),
        "recent_disclosures": stock.get("recent_disclosures", ""),
        "risks": stock.get("risks", ""),
        "competitors_data": [
            {
                "ticker": q.get("ticker") or c,
                "name": q.get("name", ""),
                "price": q.get("price"),
                "market_cap": q.get("market_cap"),
                "ytd_return": q.get("ytd_return"),
            }
            for c, q in zip(
                [ticker] + list(competitors),
                [quote] + competitor_quotes,
            )
        ],
        "news": news,
    }

    json_path = output_dir / f"{today}.json"
    json_path.write_text(json.dumps(_sanitize(summary), ensure_ascii=False, indent=2), encoding="utf-8")
    return str(json_path)
```

### 검증

- [ ] **Step 4: 기존 테스트가 여전히 통과하는지 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_report_generator.py -v
```

Expected: 5개 테스트 모두 PASS

- [ ] **Step 5: 병렬 호출 확인 테스트 추가**

`backend/tests/test_report_generator.py` 파일 끝에 추가:

```python
def test_generate_report_calls_all_io_functions(tmp_path):
    mocks = _mock_all()
    with contextlib.ExitStack() as stack:
        patched = {target: stack.enter_context(patch(target, mock)) for target, mock in mocks.items()}
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        report_generator.generate_report(SAMPLE_STOCK, tmp_path)

    patched["services.report_generator.mkt.get_quote"].assert_called()
    patched["services.report_generator.mkt.get_financials"].assert_called_once()
    patched["services.report_generator.mkt.get_annual_financials"].assert_called_once()
    patched["services.report_generator.mkt.get_analyst_data"].assert_called_once()
    patched["services.report_generator.indicators.get_timeframe_rsi"].assert_called_once()
    patched["services.report_generator.scraper.get_news"].assert_called_once()
```

- [ ] **Step 6: 새 테스트 포함 전체 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_report_generator.py -v
```

Expected: 6개 테스트 모두 PASS

- [ ] **Step 7: Commit**

```bash
git add backend/services/report_generator.py backend/tests/test_report_generator.py
git commit -m "perf: parallelize within-stock I/O calls in generate_report"
```

---

## Task 2: _run_generation 종목 간 병렬화

**Files:**
- Modify: `backend/routers/report.py:1-5` (import 추가), `backend/routers/report.py:83-98` (함수 교체)
- Test: `backend/tests/test_report_router.py`

### 사전 확인

- [ ] **Step 1: 기존 라우터 테스트 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_report_router.py -v
```

Expected: 전체 PASS

### 구현

- [ ] **Step 2: `report.py` import에 `ThreadPoolExecutor` 추가**

`backend/routers/report.py` 상단 import 블록을 아래로 교체:

```python
from __future__ import annotations
import json
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pathlib import Path
from services import storage, report_generator
from services import consensus as consensus_svc
from services import cache as cache_svc
from services.utils import sanitize as _sanitize
```

- [ ] **Step 3: `_run_generation` 함수를 병렬 버전으로 교체**

`backend/routers/report.py`의 `_run_generation` 함수 (lines 83–98)를 아래로 교체:

```python
def _run_generation(stocks: list):
    _progress.update({"running": True, "done": 0, "total": len(stocks), "current": ""})

    def _process_one(stock):
        _progress["current"] = stock["ticker"]
        try:
            report_generator.generate_report(stock)
            cache_svc.invalidate(stock["ticker"])
            consensus_svc.collect(stock["ticker"])
        except Exception as e:
            print(f"[Report] Failed for {stock['ticker']}: {e}")
        _progress["done"] += 1

    with ThreadPoolExecutor(max_workers=5) as executor:
        list(executor.map(_process_one, stocks))

    _progress.update({"running": False, "current": ""})
```

### 검증

- [ ] **Step 4: 기존 테스트 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_report_router.py -v
```

Expected: 전체 PASS

- [ ] **Step 5: 병렬 생성 완료 확인 테스트 추가**

`backend/tests/test_report_router.py` 파일 끝에 추가:

```python
def test_generate_all_runs_all_stocks(tmp_path):
    two_stocks = {
        "stocks": [
            {"ticker": "AAPL", "quantity": 1.0, "avg_cost": 150.0, "name": "Apple", "competitors": [], "moat": "", "growth_plan": ""},
            {"ticker": "MSFT", "quantity": 1.0, "avg_cost": 300.0, "name": "Microsoft", "competitors": [], "moat": "", "growth_plan": ""},
        ],
        "watchlist": [],
    }
    generated = []

    def _fake_generate(stock):
        generated.append(stock["ticker"])
        return "/tmp/fake.json"

    with patch("routers.report.storage.get_full_portfolio", return_value=two_stocks), \
         patch("routers.report.report_generator.generate_report", side_effect=_fake_generate), \
         patch("routers.report.cache_svc.invalidate"), \
         patch("routers.report.consensus_svc.collect"):
        resp = client.post("/api/report/generate")
    assert resp.status_code == 202
    assert set(generated) == {"AAPL", "MSFT"}
```

- [ ] **Step 6: 새 테스트 포함 전체 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_report_router.py -v
```

Expected: 전체 PASS

- [ ] **Step 7: 전체 테스트 스위트 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/ -v --ignore=tests/test_market.py
```

Expected: 전체 PASS (`test_market.py`는 실제 네트워크 호출이 있어 제외)

- [ ] **Step 8: Commit**

```bash
git add backend/routers/report.py backend/tests/test_report_router.py
git commit -m "perf: parallelize cross-stock report generation with ThreadPoolExecutor"
```

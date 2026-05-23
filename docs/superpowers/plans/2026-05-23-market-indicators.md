# 시장지표 페이지 (Market Indicators) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/market` 페이지 신규 구현 — 미국 국채금리, M7 vs S&P 500 ex-M7 순이익, 삼성+하이닉스 vs KOSPI 200 ex-Top2 순이익, 한국 수출 반도체 vs 비반도체 4개 섹션.

**Architecture:** 신규 백엔드 서비스(`market_indicators_service.py`)가 4개 데이터 소스(yfinance, Naver API, Wikipedia, KRX)를 조회하고, 신규 라우터(`market_indicators.py`)가 4개 엔드포인트를 제공. 프론트엔드 `Market.jsx`는 recharts로 렌더링. 서비스 내 TTL 인메모리 캐시(treasury 1시간, earnings 24시간)와 파일 캐시(구성종목 7일, 수출데이터 30일) 병행 사용.

**Tech Stack:** Python/FastAPI, yfinance, requests, BeautifulSoup4, concurrent.futures.ThreadPoolExecutor, React 18, recharts 3.x

---

## File Map

| 파일 | 액션 | 역할 |
|---|---|---|
| `backend/services/market_indicators_service.py` | 신규 | 4개 데이터 함수 + 헬퍼 |
| `backend/routers/market_indicators.py` | 신규 | 4개 GET 엔드포인트 |
| `backend/tests/test_market_indicators.py` | 신규 | 유닛 테스트 (외부 API 전부 mock) |
| `backend/main.py` | 수정 | 라우터 마운트 추가 |
| `frontend/src/pages/Market.jsx` | 신규 | 4섹션 페이지 (recharts) |
| `frontend/src/App.jsx` | 수정 | nav 링크 + route 추가 |

---

## Task 1: 서비스 파일 스캐폴드 + 국채금리 (Treasury)

**Files:**
- Create: `backend/services/market_indicators_service.py`
- Create: `backend/tests/test_market_indicators.py`

### 1-1. 테스트 먼저 작성

- [ ] `backend/tests/test_market_indicators.py` 생성:

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
import pandas as pd
from unittest.mock import patch, MagicMock


# ── helpers ──────────────────────────────────────────────────────────────────

def _make_hist(values: list[float]) -> pd.DataFrame:
    idx = pd.date_range("2026-01-01", periods=len(values), freq="D")
    return pd.DataFrame({"Close": values}, index=idx)


# ── get_treasury ──────────────────────────────────────────────────────────────

def test_get_treasury_returns_four_rates():
    from services.market_indicators_service import get_treasury
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([4.50, 4.55])
        result = get_treasury()
    assert set(result["rates"].keys()) == {"3m", "5y", "10y", "30y"}


def test_get_treasury_change_bp():
    from services.market_indicators_service import get_treasury
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([4.50, 4.55])
        result = get_treasury()
    # change = (4.55 - 4.50) * 100 = 5 bp
    assert result["rates"]["10y"]["change_bp"] == pytest.approx(5.0, abs=0.1)


def test_get_treasury_spread_is_10y_minus_3m():
    from services.market_indicators_service import get_treasury, _cache
    _cache.clear()
    def mock_hist_by_sym(sym):
        mock = MagicMock()
        val = 4.55 if sym == "^TNX" else 5.00 if sym == "^TYX" else 4.00 if sym == "^FVX" else 3.50
        mock.history.return_value = _make_hist([val - 0.05, val])
        return mock
    with patch("services.market_indicators_service.yf.Ticker", side_effect=mock_hist_by_sym):
        result = get_treasury()
    # spread = 10y(4.55) - 3m(3.50) = 1.05
    assert len(result["spread"]) > 0
    assert result["spread"][-1]["value"] == pytest.approx(1.05, abs=0.01)


def test_get_treasury_caches_result():
    from services.market_indicators_service import get_treasury, _cache
    _cache.clear()
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([4.50, 4.55])
        get_treasury()
        call_count_1 = mock_t.call_count
        get_treasury()
        call_count_2 = mock_t.call_count
    assert call_count_1 == call_count_2  # second call hits cache, no new yf calls
```

- [ ] 테스트 실행 — FAIL 확인:
```bash
cd backend && .venv/bin/python -m pytest tests/test_market_indicators.py -v 2>&1 | tail -20
```
Expected: `ModuleNotFoundError` (서비스 없음)

### 1-2. 서비스 파일 구현

- [ ] `backend/services/market_indicators_service.py` 생성:

```python
from __future__ import annotations
import os
import json
import time
import pandas as pd
import yfinance as yf
import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DATA_DIR = os.path.join(_BASE_DIR, "data")

_NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://m.stock.naver.com/",
    "Accept": "application/json, text/plain, */*",
}
_NAVER_BASE = "https://m.stock.naver.com/api/stock"

# 인메모리 TTL 캐시
_cache: dict = {}


def _get_cache(key: str) -> dict | None:
    entry = _cache.get(key)
    if entry and time.time() < entry["expires"]:
        return entry["data"]
    return None


def _set_cache(key: str, data: dict, ttl: int) -> None:
    _cache[key] = {"data": data, "expires": time.time() + ttl}


# ── Treasury ──────────────────────────────────────────────────────────────────

_TREASURY_SYMBOLS = {"3m": "^IRX", "5y": "^FVX", "10y": "^TNX", "30y": "^TYX"}


def _fetch_treasury(args: tuple[str, str]) -> tuple[str, dict | None]:
    key, sym = args
    try:
        hist = yf.Ticker(sym).history(period="1y", interval="1d")
        if hist.empty:
            return key, None
        close = hist["Close"].dropna()
        current = round(float(close.iloc[-1]), 3)
        prev = round(float(close.iloc[-2]), 3) if len(close) > 1 else current
        history = [
            {"date": str(d.date()), "value": round(float(v), 3)}
            for d, v in zip(close.index, close.values)
        ]
        return key, {
            "current": current,
            "change_bp": round((current - prev) * 100, 1),
            "history": history,
        }
    except Exception:
        return key, None


def get_treasury() -> dict:
    cached = _get_cache("treasury")
    if cached:
        return cached

    with ThreadPoolExecutor(max_workers=4) as ex:
        results = dict(ex.map(_fetch_treasury, _TREASURY_SYMBOLS.items()))

    rates = {
        k: {"current": v["current"], "change_bp": v["change_bp"]}
        for k, v in results.items() if v
    }
    history = {k: v["history"] for k, v in results.items() if v and k in ("3m", "10y")}

    spread: list[dict] = []
    if results.get("10y") and results.get("3m"):
        h10 = {d["date"]: d["value"] for d in results["10y"]["history"]}
        h3m = {d["date"]: d["value"] for d in results["3m"]["history"]}
        spread = [
            {"date": dt, "value": round(h10[dt] - h3m[dt], 3)}
            for dt in sorted(set(h10) & set(h3m))
        ]

    data = {"rates": rates, "history": history, "spread": spread}
    _set_cache("treasury", data, ttl=3600)
    return data
```

- [ ] 테스트 실행 — PASS 확인:
```bash
cd backend && .venv/bin/python -m pytest tests/test_market_indicators.py -v 2>&1 | tail -20
```
Expected: 4개 PASS

- [ ] 커밋:
```bash
git add backend/services/market_indicators_service.py backend/tests/test_market_indicators.py
git commit -m "feat: add market_indicators_service with treasury yields"
```

---

## Task 2: S&P 500 구성종목 + M7 순이익

**Files:**
- Modify: `backend/services/market_indicators_service.py` (함수 4개 추가)
- Modify: `backend/tests/test_market_indicators.py` (테스트 추가)

### 2-1. 테스트 먼저 작성

- [ ] `backend/tests/test_market_indicators.py` 끝에 추가:

```python
# ── _get_sp500_tickers ────────────────────────────────────────────────────────

def test_get_sp500_tickers_parses_wikipedia(tmp_path, monkeypatch):
    from services.market_indicators_service import _get_sp500_tickers
    monkeypatch.setattr(
        "services.market_indicators_service._SP500_CACHE",
        str(tmp_path / "sp500.json"),
    )
    fake_html = """
    <table id="constituents"><tbody>
      <tr><th>Symbol</th></tr>
      <tr><td>AAPL</td><td>Apple</td></tr>
      <tr><td>BRK.B</td><td>Berkshire</td></tr>
    </tbody></table>
    """
    with patch("services.market_indicators_service.requests.get") as mock_get:
        mock_get.return_value.text = fake_html
        tickers = _get_sp500_tickers()
    assert "AAPL" in tickers
    assert "BRK-B" in tickers  # dot converted to dash


def test_get_sp500_tickers_uses_file_cache(tmp_path, monkeypatch):
    from services.market_indicators_service import _get_sp500_tickers
    cache_file = tmp_path / "sp500.json"
    cache_file.write_text('["AAPL", "MSFT"]')
    import os; os.utime(cache_file, None)  # touch (recent mtime)
    monkeypatch.setattr(
        "services.market_indicators_service._SP500_CACHE", str(cache_file)
    )
    with patch("services.market_indicators_service.requests.get") as mock_get:
        tickers = _get_sp500_tickers()
        assert not mock_get.called  # should NOT hit network
    assert tickers == ["AAPL", "MSFT"]


# ── get_m7_earnings ───────────────────────────────────────────────────────────

def test_get_m7_earnings_structure():
    from services.market_indicators_service import get_m7_earnings, _cache
    _cache.clear()
    fake_ni = {"2025Q1": 25.0, "2025Q2": 28.0}
    with patch("services.market_indicators_service._get_sp500_tickers", return_value=["AAPL", "MSFT", "JPM"]), \
         patch("services.market_indicators_service._get_yf_quarterly_net_income", return_value=fake_ni):
        result = get_m7_earnings()
    assert "quarters" in result
    assert "unit" in result
    assert all({"q", "m7", "rest"} <= set(q.keys()) for q in result["quarters"])


def test_get_m7_earnings_rest_excludes_m7():
    from services.market_indicators_service import get_m7_earnings, M7, _cache
    _cache.clear()
    called_tickers: list[str] = []

    def capture_ni(ticker):
        called_tickers.append(ticker)
        return {"2025Q1": 10.0}

    with patch("services.market_indicators_service._get_sp500_tickers", return_value=["AAPL", "JPM", "V"]), \
         patch("services.market_indicators_service._get_yf_quarterly_net_income", side_effect=capture_ni):
        get_m7_earnings()
    # JPM and V should be in rest (not M7), AAPL is in M7
    rest_tickers = [t for t in called_tickers if t not in M7]
    assert "JPM" in rest_tickers
    assert "V" in rest_tickers
```

- [ ] 테스트 실행 — FAIL 확인:
```bash
cd backend && .venv/bin/python -m pytest tests/test_market_indicators.py::test_get_sp500_tickers_parses_wikipedia tests/test_market_indicators.py::test_get_m7_earnings_structure -v 2>&1 | tail -15
```
Expected: `AttributeError` 또는 `ImportError`

### 2-2. 구현 추가

- [ ] `backend/services/market_indicators_service.py`의 `get_treasury()` 함수 아래에 추가:

```python
# ── M7 Earnings ───────────────────────────────────────────────────────────────

M7 = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"]
_SP500_CACHE = os.path.join(_DATA_DIR, "sp500_tickers.json")


def _get_sp500_tickers() -> list[str]:
    if os.path.exists(_SP500_CACHE):
        if time.time() - os.path.getmtime(_SP500_CACHE) < 86400 * 7:
            with open(_SP500_CACHE) as f:
                return json.load(f)

    url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
    soup = BeautifulSoup(r.text, "html.parser")
    table = soup.find("table", {"id": "constituents"})
    tickers = [
        row.find_all("td")[0].text.strip().replace(".", "-")
        for row in table.find_all("tr")[1:]
        if row.find_all("td")
    ]

    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_SP500_CACHE, "w") as f:
        json.dump(tickers, f)
    return tickers


def _get_yf_quarterly_net_income(ticker: str) -> dict[str, float]:
    """Returns {quarter_label: net_income_billions} e.g. {'2025Q1': 25.3}"""
    try:
        fin = yf.Ticker(ticker).quarterly_financials
        if fin.empty or "Net Income" not in fin.index:
            return {}
        row = fin.loc["Net Income"]
        result: dict[str, float] = {}
        for col in row.index:
            val = row[col]
            if pd.notna(val):
                q = (col.month - 1) // 3 + 1
                result[f"{col.year}Q{q}"] = float(val) / 1e9
        return result
    except Exception:
        return {}


def _merge_quarters(results: list[dict[str, float]], n: int = 8) -> dict[str, float]:
    from collections import defaultdict
    total: dict[str, float] = defaultdict(float)
    for r in results:
        for q, v in r.items():
            total[q] += v
    quarters = sorted(total.keys())[-n:]
    return {q: round(total[q], 2) for q in quarters}


def get_m7_earnings() -> dict:
    cached = _get_cache("m7_earnings")
    if cached:
        return cached

    sp500 = _get_sp500_tickers()
    rest = [t for t in sp500 if t not in M7]

    with ThreadPoolExecutor(max_workers=20) as ex:
        m7_data = list(ex.map(_get_yf_quarterly_net_income, M7))
        rest_data = list(ex.map(_get_yf_quarterly_net_income, rest))

    m7_by_q = _merge_quarters(m7_data)
    rest_by_q = _merge_quarters(rest_data)
    quarters = sorted(set(m7_by_q) | set(rest_by_q))[-8:]

    data = {
        "quarters": [
            {"q": q, "m7": m7_by_q.get(q, 0), "rest": rest_by_q.get(q, 0)}
            for q in quarters
        ],
        "unit": "십억달러",
    }
    _set_cache("m7_earnings", data, ttl=86400)
    return data
```

- [ ] 테스트 실행 — PASS 확인:
```bash
cd backend && .venv/bin/python -m pytest tests/test_market_indicators.py -v 2>&1 | tail -20
```
Expected: 전체 PASS (treasury 4개 + sp500/m7 4개)

- [ ] 커밋:
```bash
git add backend/services/market_indicators_service.py backend/tests/test_market_indicators.py
git commit -m "feat: add S&P 500 constituent scraping and M7 earnings service"
```

---

## Task 3: KOSPI 200 구성종목 + 한국 Top2 순이익

**Files:**
- Modify: `backend/services/market_indicators_service.py`
- Modify: `backend/tests/test_market_indicators.py`

### 3-1. 테스트 먼저 작성

- [ ] `backend/tests/test_market_indicators.py` 끝에 추가:

```python
# ── _get_kospi200_tickers ─────────────────────────────────────────────────────

def test_get_kospi200_tickers_parses_krx(tmp_path, monkeypatch):
    from services.market_indicators_service import _get_kospi200_tickers
    monkeypatch.setattr(
        "services.market_indicators_service._KOSPI200_CACHE",
        str(tmp_path / "kospi200.json"),
    )
    fake_response = {"output": [{"ISU_SRT_CD": "005930"}, {"ISU_SRT_CD": "000660"}]}
    with patch("services.market_indicators_service.requests.post") as mock_post:
        mock_post.return_value.json.return_value = fake_response
        tickers = _get_kospi200_tickers()
    assert "005930" in tickers
    assert "000660" in tickers


def test_get_kospi200_tickers_uses_file_cache(tmp_path, monkeypatch):
    from services.market_indicators_service import _get_kospi200_tickers
    cache_file = tmp_path / "kospi200.json"
    cache_file.write_text('["005930","000660","005380"]')
    import os; os.utime(cache_file, None)
    monkeypatch.setattr(
        "services.market_indicators_service._KOSPI200_CACHE", str(cache_file)
    )
    with patch("services.market_indicators_service.requests.post") as mock_post:
        tickers = _get_kospi200_tickers()
        assert not mock_post.called
    assert "005380" in tickers


# ── _get_naver_quarterly_net_income ──────────────────────────────────────────

def test_get_naver_quarterly_net_income_parses_row():
    from services.market_indicators_service import _get_naver_quarterly_net_income
    fake_resp = {
        "financeInfo": {
            "rowList": [
                {"title": "매출액", "columns": {"202503": {"value": "100,000"}}},
                {"title": "영업이익", "columns": {"202503": {"value": "20,000"}}},
                {"title": "당기순이익", "columns": {
                    "202503": {"value": "122,257"},
                    "202506": {"value": "150,000"},
                }},
            ]
        }
    }
    with patch("services.market_indicators_service.requests.get") as mock_get:
        mock_get.return_value.json.return_value = fake_resp
        mock_get.return_value.raise_for_status = lambda: None
        result = _get_naver_quarterly_net_income("005930")
    assert "2025Q1" in result
    assert result["2025Q1"] == pytest.approx(122257.0, rel=0.01)
    assert "2025Q2" in result


# ── get_kr_top2_earnings ──────────────────────────────────────────────────────

def test_get_kr_top2_earnings_structure():
    from services.market_indicators_service import get_kr_top2_earnings, _cache
    _cache.clear()
    with patch("services.market_indicators_service._get_kospi200_tickers",
               return_value=["005930", "000660", "005380"]), \
         patch("services.market_indicators_service._get_naver_quarterly_net_income",
               return_value={"2025Q1": 100000.0, "2025Q2": 120000.0}):
        result = get_kr_top2_earnings()
    assert "quarters" in result
    assert result["unit"] == "억원"
    assert all({"q", "top2", "rest"} <= set(q.keys()) for q in result["quarters"])


def test_get_kr_top2_earnings_rest_excludes_top2():
    from services.market_indicators_service import get_kr_top2_earnings, KR_TOP2, _cache
    _cache.clear()
    called: list[str] = []

    def capture(ticker):
        called.append(ticker)
        return {"2025Q1": 50000.0}

    with patch("services.market_indicators_service._get_kospi200_tickers",
               return_value=["005930", "000660", "005380"]), \
         patch("services.market_indicators_service._get_naver_quarterly_net_income",
               side_effect=capture):
        get_kr_top2_earnings()
    rest_tickers = [t for t in called if t not in KR_TOP2]
    assert "005380" in rest_tickers
    assert "005930" not in rest_tickers
```

- [ ] 테스트 실행 — FAIL 확인:
```bash
cd backend && .venv/bin/python -m pytest tests/test_market_indicators.py -k "kospi or naver or kr_top2" -v 2>&1 | tail -15
```

### 3-2. 구현 추가

- [ ] `backend/services/market_indicators_service.py`의 `get_m7_earnings()` 아래에 추가:

```python
# ── KR Top2 Earnings ──────────────────────────────────────────────────────────

KR_TOP2 = ["005930", "000660"]
_KOSPI200_CACHE = os.path.join(_DATA_DIR, "kospi200_tickers.json")


def _get_kospi200_tickers() -> list[str]:
    if os.path.exists(_KOSPI200_CACHE):
        if time.time() - os.path.getmtime(_KOSPI200_CACHE) < 86400 * 7:
            with open(_KOSPI200_CACHE) as f:
                return json.load(f)

    from datetime import date
    today = date.today().strftime("%Y%m%d")
    url = "http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd"
    headers = {
        "Referer": "http://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd",
        "User-Agent": "Mozilla/5.0",
    }
    payload = {
        "bld": "dbms/MDC/STAT/standard/MDCSTAT00601",
        "mktId": "STK",
        "indTpCd": "2",
        "indTpCd2": "103",
        "strtDd": today,
        "endDd": today,
        "share": "1",
        "money": "1",
        "csvxls_isNo": "false",
    }
    r = requests.post(url, data=payload, headers=headers, timeout=15)
    tickers = [item["ISU_SRT_CD"] for item in r.json().get("output", []) if "ISU_SRT_CD" in item]

    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_KOSPI200_CACHE, "w") as f:
        json.dump(tickers, f)
    return tickers


def _get_naver_quarterly_net_income(ticker: str) -> dict[str, float]:
    """ticker: 6자리 KRX 코드. Returns {quarter_label: value_in_억원}"""
    try:
        r = requests.get(
            f"{_NAVER_BASE}/{ticker}/finance/quarter",
            headers=_NAVER_HEADERS,
            timeout=8,
        )
        r.raise_for_status()
        rows = r.json().get("financeInfo", {}).get("rowList", [])
        ni_row = next((row for row in rows if row.get("title") == "당기순이익"), None)
        if ni_row is None:
            return {}
        result: dict[str, float] = {}
        for col_key, col_data in ni_row.get("columns", {}).items():
            val = col_data.get("value", "")
            if val and val != "-":
                try:
                    v = float(val.replace(",", ""))
                    year, month = int(col_key[:4]), int(col_key[4:])
                    q = (month - 1) // 3 + 1
                    result[f"{year}Q{q}"] = v
                except (ValueError, IndexError):
                    pass
        return result
    except Exception:
        return {}


def get_kr_top2_earnings() -> dict:
    cached = _get_cache("kr_top2_earnings")
    if cached:
        return cached

    kospi200 = _get_kospi200_tickers()
    rest = [t for t in kospi200 if t not in KR_TOP2]

    with ThreadPoolExecutor(max_workers=20) as ex:
        top2_data = list(ex.map(_get_naver_quarterly_net_income, KR_TOP2))
        rest_data = list(ex.map(_get_naver_quarterly_net_income, rest))

    top2_by_q = _merge_quarters(top2_data)
    rest_by_q = _merge_quarters(rest_data)
    quarters = sorted(set(top2_by_q) | set(rest_by_q))[-8:]

    data = {
        "quarters": [
            {"q": q, "top2": top2_by_q.get(q, 0), "rest": rest_by_q.get(q, 0)}
            for q in quarters
        ],
        "unit": "억원",
    }
    _set_cache("kr_top2_earnings", data, ttl=86400)
    return data
```

- [ ] 테스트 실행 — PASS 확인:
```bash
cd backend && .venv/bin/python -m pytest tests/test_market_indicators.py -v 2>&1 | tail -20
```
Expected: 전체 PASS

- [ ] 커밋:
```bash
git add backend/services/market_indicators_service.py backend/tests/test_market_indicators.py
git commit -m "feat: add KOSPI 200 constituent fetch and KR top2 earnings service"
```

---

## Task 4: 한국 수출 데이터 (KITA Open API)

**Files:**
- Modify: `backend/services/market_indicators_service.py`
- Modify: `backend/tests/test_market_indicators.py`

> **사전 준비:** KITA Open API 키 발급 필요.
> 1. https://www.kita.net 에서 회원가입
> 2. 개발자 포털 > Open API 신청 (무료)
> 3. 발급된 키를 환경변수로 설정: `export KITA_API_KEY=<your_key>`
> 키 없이도 코드는 동작 (빈 데이터 + 안내 메시지 반환).

### 4-1. 테스트 먼저 작성

- [ ] `backend/tests/test_market_indicators.py` 끝에 추가:

```python
# ── get_kr_exports ────────────────────────────────────────────────────────────

def test_get_kr_exports_no_api_key_returns_error(tmp_path, monkeypatch):
    from services.market_indicators_service import get_kr_exports
    monkeypatch.setattr(
        "services.market_indicators_service._EXPORTS_CACHE",
        str(tmp_path / "kr_exports.json"),
    )
    monkeypatch.delenv("KITA_API_KEY", raising=False)
    result = get_kr_exports()
    assert result["months"] == []
    assert "error" in result


def test_get_kr_exports_uses_file_cache(tmp_path, monkeypatch):
    from services.market_indicators_service import get_kr_exports
    cache_file = tmp_path / "kr_exports.json"
    cached_data = {"months": [{"month": "202501", "semiconductor": 100.0, "non_semiconductor": 200.0}]}
    cache_file.write_text(json.dumps(cached_data))
    import os; os.utime(cache_file, None)
    monkeypatch.setattr(
        "services.market_indicators_service._EXPORTS_CACHE", str(cache_file)
    )
    with patch("services.market_indicators_service.requests.get") as mock_get:
        result = get_kr_exports()
        assert not mock_get.called  # cache hit
    assert result["months"][0]["semiconductor"] == 100.0


def test_get_kr_exports_with_api_key(tmp_path, monkeypatch):
    from services.market_indicators_service import get_kr_exports
    monkeypatch.setattr(
        "services.market_indicators_service._EXPORTS_CACHE",
        str(tmp_path / "kr_exports.json"),
    )
    monkeypatch.setenv("KITA_API_KEY", "test-key-123")
    fake_response = {
        "items": {
            "item": [
                {"period": "202501", "itmNm": "반도체", "expAmt": "10000000000"},
                {"period": "202501", "itmNm": "자동차", "expAmt": "5000000000"},
                {"period": "202502", "itmNm": "반도체", "expAmt": "11000000000"},
            ]
        }
    }
    with patch("services.market_indicators_service.requests.get") as mock_get:
        mock_get.return_value.json.return_value = fake_response
        result = get_kr_exports()
    months = {m["month"]: m for m in result["months"]}
    assert "202501" in months
    assert months["202501"]["semiconductor"] > 0
    assert months["202501"]["non_semiconductor"] > 0
```

- [ ] 테스트 실행 — FAIL 확인:
```bash
cd backend && .venv/bin/python -m pytest tests/test_market_indicators.py -k "exports" -v 2>&1 | tail -15
```

### 4-2. 구현 추가

- [ ] `backend/services/market_indicators_service.py`의 `get_kr_top2_earnings()` 아래에 추가:

```python
# ── Korean Export Data ────────────────────────────────────────────────────────

_EXPORTS_CACHE = os.path.join(_DATA_DIR, "kr_exports.json")


def _months_ago(n: int) -> str:
    from datetime import date
    today = date.today()
    month = today.month - n
    year = today.year + (month - 1) // 12
    month = ((month - 1) % 12) + 1
    return f"{year}{month:02d}"


def get_kr_exports() -> dict:
    # 파일 캐시 (30일)
    if os.path.exists(_EXPORTS_CACHE):
        if time.time() - os.path.getmtime(_EXPORTS_CACHE) < 86400 * 30:
            with open(_EXPORTS_CACHE) as f:
                return json.load(f)

    api_key = os.environ.get("KITA_API_KEY")
    if not api_key:
        # 만료된 캐시라도 있으면 반환
        if os.path.exists(_EXPORTS_CACHE):
            with open(_EXPORTS_CACHE) as f:
                return json.load(f)
        return {"months": [], "error": "KITA_API_KEY 환경변수가 필요합니다. https://www.kita.net 에서 발급 후 설정하세요."}

    # KITA Open API 조회
    # 참고: https://www.kita.net/kita/biz/weave/openapi/
    # 정확한 엔드포인트/파라미터는 KITA 개발자 포털에서 확인 필요
    url = "https://api.kita.net/openApi/service/ItemTradeService/getItemExpImpList"
    params = {
        "serviceKey": api_key,
        "startDate": _months_ago(12),
        "endDate": _months_ago(0),
        "type": "json",
    }
    r = requests.get(url, params=params, timeout=15)
    items = r.json().get("items", {}).get("item", [])

    months_semi: dict[str, float] = {}
    months_rest: dict[str, float] = {}
    for item in items:
        ym = item.get("period", "")
        amt = float(str(item.get("expAmt", "0")).replace(",", ""))
        if "반도체" in item.get("itmNm", ""):
            months_semi[ym] = months_semi.get(ym, 0) + amt
        else:
            months_rest[ym] = months_rest.get(ym, 0) + amt

    all_months = sorted(set(months_semi) | set(months_rest))
    data = {
        "months": [
            {
                "month": m,
                "semiconductor": round(months_semi.get(m, 0) / 1e8, 1),
                "non_semiconductor": round(months_rest.get(m, 0) / 1e8, 1),
            }
            for m in all_months
        ]
    }
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_EXPORTS_CACHE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    return data
```

- [ ] 테스트 실행 — PASS 확인:
```bash
cd backend && .venv/bin/python -m pytest tests/test_market_indicators.py -v 2>&1 | tail -20
```
Expected: 전체 PASS

- [ ] 커밋:
```bash
git add backend/services/market_indicators_service.py backend/tests/test_market_indicators.py
git commit -m "feat: add Korean export data service with KITA API + file cache fallback"
```

---

## Task 5: 라우터 + main.py 마운트

**Files:**
- Create: `backend/routers/market_indicators.py`
- Modify: `backend/main.py`

### 5-1. 라우터 생성

- [ ] `backend/routers/market_indicators.py` 생성:

```python
from fastapi import APIRouter, HTTPException
from services.market_indicators_service import (
    get_treasury,
    get_m7_earnings,
    get_kr_top2_earnings,
    get_kr_exports,
)

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("/treasury")
def treasury():
    try:
        return get_treasury()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/m7-earnings")
def m7_earnings():
    try:
        return get_m7_earnings()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/kr-top2-earnings")
def kr_top2_earnings():
    try:
        return get_kr_top2_earnings()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/kr-exports")
def kr_exports():
    try:
        return get_kr_exports()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

### 5-2. main.py에 라우터 마운트

- [ ] `backend/main.py` 확인:
```bash
grep -n "router\|include_router" backend/main.py | head -20
```

- [ ] `backend/main.py`에서 다른 라우터 import 줄 아래에 추가:
```python
from routers.market_indicators import router as market_indicators_router
```

- [ ] 다른 `app.include_router()` 줄 아래에 추가:
```python
app.include_router(market_indicators_router)
```

### 5-3. 스모크 테스트

- [ ] 백엔드 서버 실행 (별도 터미널):
```bash
cd backend && .venv/bin/python -m uvicorn main:app --reload --port 8000
```

- [ ] 엔드포인트 확인:
```bash
curl -s http://localhost:8000/api/market/treasury | python3 -m json.tool | head -20
```
Expected: `{"rates": {"3m": {...}, "5y": {...}, "10y": {...}, "30y": {...}}, "history": {...}, "spread": [...]}`

- [ ] 커밋:
```bash
git add backend/routers/market_indicators.py backend/main.py
git commit -m "feat: add market indicators router and mount to main app"
```

---

## Task 6: 프론트엔드 Market.jsx

**Files:**
- Create: `frontend/src/pages/Market.jsx`

- [ ] `frontend/src/pages/Market.jsx` 생성:

```jsx
import { useState, useEffect } from 'react'
import axios from 'axios'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ── 공통 스타일 ──────────────────────────────────────────────────────────────

const CARD_STYLE = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '12px 16px',
}

const SECTION_STYLE = {
  marginBottom: 40,
}

const SECTION_HEADER_STYLE = {
  color: 'var(--text)',
  fontSize: 16,
  fontWeight: 600,
  marginBottom: 16,
  borderBottom: '1px solid var(--border)',
  paddingBottom: 8,
}

function LoadingBox() {
  return (
    <div style={{ ...CARD_STYLE, color: 'var(--text-muted)', fontSize: 13, padding: 24 }}>
      데이터 수집 중입니다. 처음 로드 시 수분 소요될 수 있습니다...
    </div>
  )
}

function ErrorBox({ msg }) {
  return (
    <div style={{ ...CARD_STYLE, color: '#e57373', fontSize: 13, padding: 16 }}>
      {msg || '데이터를 불러오지 못했습니다.'}
    </div>
  )
}

// ── 국채금리 섹션 ─────────────────────────────────────────────────────────────

function TreasurySection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/market/treasury')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>미국 국채금리</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>미국 국채금리</h3><ErrorBox /></div>

  const LABELS = { '3m': '3개월', '5y': '5년', '10y': '10년', '30y': '30년' }
  const rates = data.rates || {}

  // 차트 데이터: 3m과 10y 히스토리를 merge
  const h3m = Object.fromEntries((data.history?.['3m'] || []).map(d => [d.date, d.value]))
  const h10y = Object.fromEntries((data.history?.['10y'] || []).map(d => [d.date, d.value]))
  const chartData = Object.keys({...h3m, ...h10y}).sort().slice(-252).map(date => ({
    date: date.slice(5),  // MM-DD
    '3개월': h3m[date] ?? null,
    '10년': h10y[date] ?? null,
    '스프레드': h3m[date] != null && h10y[date] != null
      ? Math.round((h10y[date] - h3m[date]) * 1000) / 1000
      : null,
  }))

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>미국 국채금리</h3>

      {/* 금리 카드 4개 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {['3m', '5y', '10y', '30y'].map(key => {
          const r = rates[key]
          const up = r?.change_bp > 0
          const down = r?.change_bp < 0
          return (
            <div key={key} style={{ ...CARD_STYLE, minWidth: 110, flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{LABELS[key]}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
                {r ? `${r.current.toFixed(2)}%` : '-'}
              </div>
              {r && (
                <div style={{
                  fontSize: 12,
                  color: up ? '#81c784' : down ? '#e57373' : 'var(--text-muted)',
                  marginTop: 2,
                }}>
                  {up ? '▲' : down ? '▼' : '─'} {Math.abs(r.change_bp).toFixed(1)}bp
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 히스토리 차트 */}
      {chartData.length > 0 && (
        <div style={{ ...CARD_STYLE }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            3개월 / 10년 금리 추이 (1년) + 스프레드(10Y-3M)
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                     interval={Math.floor(chartData.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }}
                labelStyle={{ color: 'var(--text-muted)' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Line type="monotone" dataKey="10년" stroke="#4fc3f7" dot={false} strokeWidth={1.5} />
              <Line type="monotone" dataKey="3개월" stroke="#81c784" dot={false} strokeWidth={1.5} />
              <Line type="monotone" dataKey="스프레드" stroke="#ffb74d" dot={false} strokeWidth={1} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── M7 vs 나머지 순이익 섹션 ───────────────────────────────────────────────────

function M7EarningsSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/market/m7-earnings')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>M7 vs 나머지 S&P 500 순이익</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>M7 vs 나머지 S&P 500 순이익</h3><ErrorBox /></div>

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>M7 vs 나머지 S&P 500 순이익</h3>
      <div style={{ ...CARD_STYLE }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          분기별 순이익 합산 ({data.unit}) — AAPL·MSFT·GOOGL·AMZN·NVDA·META·TSLA vs S&P 500 ex-M7
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.quarters} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="q" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <Tooltip
              contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="m7" name="M7" fill="#4fc3f7" radius={[2, 2, 0, 0]} />
            <Bar dataKey="rest" name="나머지" fill="#546e7a" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── 삼성+하이닉스 vs KOSPI 200 나머지 섹션 ───────────────────────────────────

function KrTop2Section() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/market/kr-top2-earnings')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>삼성전자+SK하이닉스 vs KOSPI 200 나머지 순이익</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>삼성전자+SK하이닉스 vs KOSPI 200 나머지 순이익</h3><ErrorBox /></div>

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>삼성전자+SK하이닉스 vs KOSPI 200 나머지 순이익</h3>
      <div style={{ ...CARD_STYLE }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          분기별 순이익 합산 ({data.unit}) — 삼성전자(005930) + SK하이닉스(000660) vs KOSPI 200 나머지
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.quarters} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="q" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <Tooltip
              contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="top2" name="삼성+하이닉스" fill="#4fc3f7" radius={[2, 2, 0, 0]} />
            <Bar dataKey="rest" name="나머지 KOSPI 200" fill="#546e7a" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── 한국 수출 섹션 ────────────────────────────────────────────────────────────

function KrExportsSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/market/kr-exports')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>한국 수출: 반도체 vs 비반도체</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>한국 수출: 반도체 vs 비반도체</h3><ErrorBox /></div>

  if (data.error) {
    return (
      <div style={SECTION_STYLE}>
        <h3 style={SECTION_HEADER_STYLE}>한국 수출: 반도체 vs 비반도체</h3>
        <div style={{ ...CARD_STYLE, fontSize: 13, color: 'var(--text-muted)' }}>
          <p>{data.error}</p>
          <p style={{ marginTop: 8 }}>
            <code>KITA_API_KEY</code> 환경변수 설정 후 서버를 재시작하세요.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>한국 수출: 반도체 vs 비반도체</h3>
      <div style={{ ...CARD_STYLE }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          월별 수출액 (억달러) — 반도체 vs 비반도체
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.months} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                   tickFormatter={v => v.slice(2)} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <Tooltip
              contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="semiconductor" name="반도체" fill="#4fc3f7" radius={[2, 2, 0, 0]} />
            <Bar dataKey="non_semiconductor" name="비반도체" fill="#546e7a" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

export default function Market() {
  return (
    <div style={{ maxWidth: 900 }}>
      <h2 style={{ color: 'var(--text)', marginBottom: 24 }}>시장지표</h2>
      <TreasurySection />
      <M7EarningsSection />
      <KrTop2Section />
      <KrExportsSection />
    </div>
  )
}
```

- [ ] 커밋:
```bash
git add frontend/src/pages/Market.jsx
git commit -m "feat: add Market.jsx with 4 indicator sections (recharts)"
```

---

## Task 7: App.jsx 라우팅 연결

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] `frontend/src/App.jsx` 상단 import 블록에 추가 (다른 import들과 함께):
```jsx
import Market from './pages/Market'
```

- [ ] nav 링크 배열에 `['/market', '시장지표']` 추가:
```jsx
// 변경 전:
{[['/', '종목 관리'], ['/reports', '리포트'], ['/calendar', '캘린더'], ['/digest', '다이제스트'], ['/guru', '구루'], ['/settings', '설정']].map(...)}

// 변경 후:
{[['/', '종목 관리'], ['/reports', '리포트'], ['/calendar', '캘린더'], ['/digest', '다이제스트'], ['/market', '시장지표'], ['/guru', '구루'], ['/settings', '설정']].map(...)}
```

- [ ] Routes 블록에 route 추가 (다른 Route들과 함께):
```jsx
<Route path="/market" element={<Market />} />
```

- [ ] 프론트엔드 개발 서버 실행:
```bash
cd frontend && npm run dev
```

- [ ] 브라우저에서 `http://localhost:5173/market` 접속 — 4개 섹션 렌더링 확인

- [ ] 커밋:
```bash
git add frontend/src/App.jsx
git commit -m "feat: wire /market route and nav link in App.jsx"
```

---

## Self-Review 체크리스트

### 스펙 커버리지

| 스펙 요구사항 | 구현 태스크 |
|---|---|
| 미국 국채금리 — 금리 카드 (3M/5Y/10Y/30Y) | Task 1 + Task 6 |
| 미국 국채금리 — 히스토리 차트 + 스프레드 | Task 1 + Task 6 |
| M7 순이익 — S&P 500 ex-M7 전체 | Task 2 + Task 6 |
| 삼성+하이닉스 — KOSPI 200 ex-Top2 전체 | Task 3 + Task 6 |
| 한국 수출 반도체 vs 비반도체 | Task 4 + Task 6 |
| ThreadPoolExecutor 병렬 조회 (max 20) | Task 2, 3 |
| 인메모리 캐시 (treasury 1h, earnings 24h) | Task 1 |
| 파일 캐시 (구성종목 7d, 수출 30d) | Task 2, 3, 4 |
| KITA API 키 없을 때 graceful fallback | Task 4 |
| App.jsx nav + route | Task 7 |

### 타입/이름 일관성

- `_merge_quarters()` → Task 2에서 정의, Task 3에서 재사용 ✓
- `_get_cache()` / `_set_cache()` → Task 1에서 정의, Task 2-4에서 재사용 ✓
- API 응답 키: `"quarters"`, `"m7"`, `"rest"`, `"top2"` — 프론트와 일치 ✓
- `"semiconductor"`, `"non_semiconductor"` — 프론트와 일치 ✓

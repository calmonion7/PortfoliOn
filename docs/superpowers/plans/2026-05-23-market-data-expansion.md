# Market Data Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Market 페이지에 환율, VIX, 원자재, 경제지표(CPI/실업률) 4개 섹션 추가.

**Architecture:** `market_indicators_service.py`에 함수 4개 추가(yfinance + FRED API), `market_indicators.py` 라우터에 엔드포인트 4개 추가, `Market.jsx`에 섹션 컴포넌트 4개 추가. 기존 패턴(인메모리 TTL 캐시, ThreadPoolExecutor, 섹션별 독립 fetch)을 그대로 따름.

**Tech Stack:** Python/FastAPI, yfinance, requests (FRED API), React 18, recharts

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `backend/services/market_indicators_service.py` | Modify | `_FX_SYMBOLS`, `_COMMODITY_SYMBOLS` 상수 + `_fetch_fx`, `get_fx`, `get_vix`, `_fetch_commodity`, `get_commodities`, `get_econ_indicators` 함수 추가 |
| `backend/routers/market_indicators.py` | Modify | `/fx`, `/vix`, `/commodities`, `/econ-indicators` 엔드포인트 추가 + import 확장 |
| `backend/tests/test_market_indicators.py` | Modify | 4개 함수 테스트 추가 |
| `frontend/src/pages/Market.jsx` | Modify | `FxSection`, `VixSection`, `CommoditiesSection`, `EconIndicatorsSection` 컴포넌트 추가 + 렌더링 순서 삽입 |

---

## Task 1: `get_fx()` 서비스 함수

**Files:**
- Modify: `backend/services/market_indicators_service.py`
- Test: `backend/tests/test_market_indicators.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_market_indicators.py` 파일 끝에 추가:

```python
# ── get_fx ────────────────────────────────────────────────────────────────────

def test_get_fx_returns_three_rates():
    from services.market_indicators_service import get_fx, _cache
    _cache.clear()
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([1350.0, 1370.5])
        result = get_fx()
    assert set(result["rates"].keys()) == {"usdkrw", "usdjpy", "eurusd"}


def test_get_fx_change_pct():
    from services.market_indicators_service import get_fx, _cache
    _cache.clear()
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([1000.0, 1010.0])
        result = get_fx()
    # change = (1010 - 1000) / 1000 * 100 = 1.0%
    assert result["rates"]["usdkrw"]["change_pct"] == pytest.approx(1.0, abs=0.01)


def test_get_fx_history_usdkrw_only():
    from services.market_indicators_service import get_fx, _cache
    _cache.clear()
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([1350.0, 1370.5])
        result = get_fx()
    assert "usdkrw" in result["history"]
    assert "usdjpy" not in result["history"]


def test_get_fx_caches_result():
    from services.market_indicators_service import get_fx, _cache
    _cache.clear()
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([1350.0, 1370.5])
        get_fx()
        count1 = mock_t.call_count
        get_fx()
        count2 = mock_t.call_count
    assert count1 == count2
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_market_indicators.py::test_get_fx_returns_three_rates -v
```
Expected: `FAILED` — `ImportError` 또는 `AttributeError` (함수 미존재)

- [ ] **Step 3: `get_fx()` 구현**

`backend/services/market_indicators_service.py`의 `get_kr_exports` 함수 바로 위에 추가:

```python
# ── FX ────────────────────────────────────────────────────────────────────────

_FX_SYMBOLS = {"usdkrw": "USDKRW=X", "usdjpy": "USDJPY=X", "eurusd": "EURUSD=X"}


def _fetch_fx(args: tuple[str, str]) -> tuple[str, dict | None]:
    key, sym = args
    try:
        hist = yf.Ticker(sym).history(period="1y", interval="1d")
        if hist.empty:
            return key, None
        close = hist["Close"].dropna()
        current = round(float(close.iloc[-1]), 4)
        prev = round(float(close.iloc[-2]), 4) if len(close) > 1 else current
        change_pct = round((current - prev) / prev * 100, 2) if prev else 0.0
        history = [
            {"date": str(d.date()), "value": round(float(v), 4)}
            for d, v in zip(close.index, close.values)
        ]
        return key, {"current": current, "change_pct": change_pct, "history": history}
    except Exception:
        return key, None


def get_fx() -> dict:
    cached = _get_cache("fx")
    if cached:
        return cached

    with ThreadPoolExecutor(max_workers=3) as ex:
        results = dict(ex.map(_fetch_fx, _FX_SYMBOLS.items()))

    rates = {
        k: {"current": v["current"], "change_pct": v["change_pct"]}
        for k, v in results.items()
        if v
    }
    history = {"usdkrw": results["usdkrw"]["history"]} if results.get("usdkrw") else {}

    data = {"rates": rates, "history": history}
    _set_cache("fx", data, ttl=3600)
    return data
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_market_indicators.py -k "get_fx" -v
```
Expected: 4개 PASSED

- [ ] **Step 5: 커밋**

```bash
git add backend/services/market_indicators_service.py backend/tests/test_market_indicators.py
git commit -m "feat: add get_fx() service function with yfinance (USDKRW, USDJPY, EURUSD)"
```

---

## Task 2: `get_vix()` 서비스 함수

**Files:**
- Modify: `backend/services/market_indicators_service.py`
- Test: `backend/tests/test_market_indicators.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_market_indicators.py` 끝에 추가:

```python
# ── get_vix ───────────────────────────────────────────────────────────────────

def test_get_vix_returns_current_and_change():
    from services.market_indicators_service import get_vix, _cache
    _cache.clear()
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([19.5, 18.2])
        result = get_vix()
    assert result["current"] == pytest.approx(18.2, abs=0.01)
    assert result["change"] == pytest.approx(-1.3, abs=0.01)


def test_get_vix_has_history():
    from services.market_indicators_service import get_vix, _cache
    _cache.clear()
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([18.0, 19.0, 20.0])
        result = get_vix()
    assert len(result["history"]) == 3
    assert result["history"][0]["value"] == pytest.approx(18.0, abs=0.01)


def test_get_vix_caches_result():
    from services.market_indicators_service import get_vix, _cache
    _cache.clear()
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([18.0, 19.0])
        get_vix()
        count1 = mock_t.call_count
        get_vix()
        count2 = mock_t.call_count
    assert count1 == count2
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_market_indicators.py::test_get_vix_returns_current_and_change -v
```
Expected: `FAILED`

- [ ] **Step 3: `get_vix()` 구현**

`get_fx()` 함수 바로 아래에 추가:

```python
# ── VIX ───────────────────────────────────────────────────────────────────────

def get_vix() -> dict:
    cached = _get_cache("vix")
    if cached:
        return cached

    try:
        hist = yf.Ticker("^VIX").history(period="1y", interval="1d")
        close = hist["Close"].dropna()
        current = round(float(close.iloc[-1]), 2)
        prev = round(float(close.iloc[-2]), 2) if len(close) > 1 else current
        change = round(current - prev, 2)
        history = [
            {"date": str(d.date()), "value": round(float(v), 2)}
            for d, v in zip(close.index, close.values)
        ]
        data: dict = {"current": current, "change": change, "history": history}
    except Exception:
        data = {"current": None, "change": None, "history": []}

    _set_cache("vix", data, ttl=3600)
    return data
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_market_indicators.py -k "get_vix" -v
```
Expected: 3개 PASSED

- [ ] **Step 5: 커밋**

```bash
git add backend/services/market_indicators_service.py backend/tests/test_market_indicators.py
git commit -m "feat: add get_vix() service function"
```

---

## Task 3: `get_commodities()` 서비스 함수

**Files:**
- Modify: `backend/services/market_indicators_service.py`
- Test: `backend/tests/test_market_indicators.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_market_indicators.py` 끝에 추가:

```python
# ── get_commodities ───────────────────────────────────────────────────────────

def test_get_commodities_returns_three_prices():
    from services.market_indicators_service import get_commodities, _cache
    _cache.clear()
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([2300.0, 2350.0])
        result = get_commodities()
    assert set(result["prices"].keys()) == {"gold", "oil", "copper"}


def test_get_commodities_change_pct():
    from services.market_indicators_service import get_commodities, _cache
    _cache.clear()
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([2000.0, 2100.0])
        result = get_commodities()
    # change = (2100 - 2000) / 2000 * 100 = 5.0%
    assert result["prices"]["gold"]["change_pct"] == pytest.approx(5.0, abs=0.01)


def test_get_commodities_has_history_for_all():
    from services.market_indicators_service import get_commodities, _cache
    _cache.clear()
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([100.0, 101.0])
        result = get_commodities()
    assert set(result["history"].keys()) == {"gold", "oil", "copper"}


def test_get_commodities_unit_labels():
    from services.market_indicators_service import get_commodities, _cache
    _cache.clear()
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([100.0, 101.0])
        result = get_commodities()
    assert result["prices"]["gold"]["unit"] == "USD/oz"
    assert result["prices"]["oil"]["unit"] == "USD/bbl"
    assert result["prices"]["copper"]["unit"] == "USD/lb"


def test_get_commodities_caches_result():
    from services.market_indicators_service import get_commodities, _cache
    _cache.clear()
    with patch("services.market_indicators_service.yf.Ticker") as mock_t:
        mock_t.return_value.history.return_value = _make_hist([100.0, 101.0])
        get_commodities()
        count1 = mock_t.call_count
        get_commodities()
        count2 = mock_t.call_count
    assert count1 == count2
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_market_indicators.py::test_get_commodities_returns_three_prices -v
```
Expected: `FAILED`

- [ ] **Step 3: `get_commodities()` 구현**

`get_vix()` 바로 아래에 추가:

```python
# ── Commodities ───────────────────────────────────────────────────────────────

_COMMODITY_SYMBOLS: dict[str, tuple[str, str]] = {
    "gold":   ("GC=F", "USD/oz"),
    "oil":    ("CL=F", "USD/bbl"),
    "copper": ("HG=F", "USD/lb"),
}


def _fetch_commodity(args: tuple[str, tuple[str, str]]) -> tuple[str, dict | None]:
    key, (sym, unit) = args
    try:
        hist = yf.Ticker(sym).history(period="1y", interval="1d")
        if hist.empty:
            return key, None
        close = hist["Close"].dropna()
        current = round(float(close.iloc[-1]), 2)
        prev = round(float(close.iloc[-2]), 2) if len(close) > 1 else current
        change_pct = round((current - prev) / prev * 100, 2) if prev else 0.0
        history = [
            {"date": str(d.date()), "value": round(float(v), 2)}
            for d, v in zip(close.index, close.values)
        ]
        return key, {"current": current, "change_pct": change_pct, "unit": unit, "history": history}
    except Exception:
        return key, None


def get_commodities() -> dict:
    cached = _get_cache("commodities")
    if cached:
        return cached

    with ThreadPoolExecutor(max_workers=3) as ex:
        results = dict(ex.map(_fetch_commodity, _COMMODITY_SYMBOLS.items()))

    prices = {
        k: {"current": v["current"], "change_pct": v["change_pct"], "unit": v["unit"]}
        for k, v in results.items()
        if v
    }
    history = {k: v["history"] for k, v in results.items() if v}

    data = {"prices": prices, "history": history}
    _set_cache("commodities", data, ttl=3600)
    return data
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_market_indicators.py -k "get_commodities" -v
```
Expected: 5개 PASSED

- [ ] **Step 5: 커밋**

```bash
git add backend/services/market_indicators_service.py backend/tests/test_market_indicators.py
git commit -m "feat: add get_commodities() service function (gold, oil, copper via yfinance)"
```

---

## Task 4: `get_econ_indicators()` 서비스 함수

**Files:**
- Modify: `backend/services/market_indicators_service.py`
- Test: `backend/tests/test_market_indicators.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_market_indicators.py` 끝에 추가:

```python
# ── get_econ_indicators ───────────────────────────────────────────────────────

def test_get_econ_indicators_no_api_key_returns_error(monkeypatch):
    from services.market_indicators_service import get_econ_indicators, _cache
    _cache.clear()
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    result = get_econ_indicators()
    assert "error" in result


def test_get_econ_indicators_returns_cpi_and_unemployment(monkeypatch):
    from services.market_indicators_service import get_econ_indicators, _cache
    _cache.clear()
    monkeypatch.setenv("FRED_API_KEY", "test-key")

    fake_obs = [
        {"date": "2024-01-01", "value": "308.5"},
        {"date": "2024-02-01", "value": "309.0"},
    ]
    fake_response = MagicMock()
    fake_response.json.return_value = {"observations": fake_obs}
    fake_response.raise_for_status = lambda: None

    with patch("services.market_indicators_service.requests.get", return_value=fake_response):
        result = get_econ_indicators()

    assert "cpi" in result
    assert "unemployment" in result
    assert len(result["cpi"]) == 2
    assert result["cpi"][0]["value"] == pytest.approx(308.5, abs=0.01)


def test_get_econ_indicators_skips_missing_values(monkeypatch):
    from services.market_indicators_service import get_econ_indicators, _cache
    _cache.clear()
    monkeypatch.setenv("FRED_API_KEY", "test-key")

    fake_obs = [
        {"date": "2024-01-01", "value": "308.5"},
        {"date": "2024-02-01", "value": "."},   # FRED 결측값
    ]
    fake_response = MagicMock()
    fake_response.json.return_value = {"observations": fake_obs}
    fake_response.raise_for_status = lambda: None

    with patch("services.market_indicators_service.requests.get", return_value=fake_response):
        result = get_econ_indicators()

    assert len(result["cpi"]) == 1


def test_get_econ_indicators_caches_result(monkeypatch):
    from services.market_indicators_service import get_econ_indicators, _cache
    _cache.clear()
    monkeypatch.setenv("FRED_API_KEY", "test-key")

    fake_response = MagicMock()
    fake_response.json.return_value = {"observations": [{"date": "2024-01-01", "value": "3.7"}]}
    fake_response.raise_for_status = lambda: None

    with patch("services.market_indicators_service.requests.get", return_value=fake_response) as mock_get:
        get_econ_indicators()
        count1 = mock_get.call_count
        get_econ_indicators()
        count2 = mock_get.call_count
    assert count1 == count2
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_market_indicators.py::test_get_econ_indicators_no_api_key_returns_error -v
```
Expected: `FAILED`

- [ ] **Step 3: `get_econ_indicators()` 구현**

`get_commodities()` 바로 아래에 추가:

```python
# ── Economic Indicators (FRED) ─────────────────────────────────────────────────

def get_econ_indicators() -> dict:
    cached = _get_cache("econ_indicators")
    if cached:
        return cached

    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        return {"error": "FRED_API_KEY 환경변수가 필요합니다. https://fred.stlouisfed.org/docs/api/api_key.html 에서 무료 발급 후 설정하세요."}

    from datetime import date as _date
    start = _date(_date.today().year - 3, 1, 1).isoformat()

    def _fetch_series(series_id: str) -> list[dict]:
        r = requests.get(
            "https://api.stlouisfed.org/fred/series/observations",
            params={
                "series_id": series_id,
                "api_key": api_key,
                "file_type": "json",
                "observation_start": start,
            },
            timeout=10,
        )
        r.raise_for_status()
        return [
            {"date": obs["date"], "value": float(obs["value"])}
            for obs in r.json().get("observations", [])
            if obs.get("value") not in (".", None, "")
        ]

    try:
        cpi = _fetch_series("CPIAUCSL")
        unemployment = _fetch_series("UNRATE")
    except Exception:
        return {"cpi": [], "unemployment": []}

    data = {"cpi": cpi, "unemployment": unemployment}
    _set_cache("econ_indicators", data, ttl=86400)
    return data
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_market_indicators.py -k "get_econ_indicators" -v
```
Expected: 4개 PASSED

- [ ] **Step 5: 전체 테스트 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_market_indicators.py -v
```
Expected: 모두 PASSED

- [ ] **Step 6: 커밋**

```bash
git add backend/services/market_indicators_service.py backend/tests/test_market_indicators.py
git commit -m "feat: add get_econ_indicators() with FRED API (CPI, unemployment rate)"
```

---

## Task 5: 라우터 엔드포인트 4개 추가

**Files:**
- Modify: `backend/routers/market_indicators.py`

- [ ] **Step 1: import 확장 + 엔드포인트 추가**

`backend/routers/market_indicators.py`의 import 블록을 교체:

```python
from fastapi import APIRouter, HTTPException
from services.market_indicators_service import (
    get_treasury,
    get_m7_earnings,
    get_kr_top2_earnings,
    get_kr_exports,
    get_fx,
    get_vix,
    get_commodities,
    get_econ_indicators,
)
```

파일 끝에 추가:

```python
@router.get("/fx")
def fx():
    try:
        return get_fx()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/vix")
def vix():
    try:
        return get_vix()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/commodities")
def commodities():
    try:
        return get_commodities()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/econ-indicators")
def econ_indicators():
    try:
        return get_econ_indicators()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

- [ ] **Step 2: 서버 임시 기동 후 엔드포인트 확인**

```bash
cd backend && .venv/bin/python -m uvicorn main:app --port 8000 &
sleep 3
curl -s http://localhost:8000/api/market/vix | python3 -m json.tool | head -5
kill %1
```
Expected: `{"current": ..., "change": ..., "history": [...]}`

- [ ] **Step 3: 커밋**

```bash
git add backend/routers/market_indicators.py
git commit -m "feat: add /fx, /vix, /commodities, /econ-indicators endpoints"
```

---

## Task 6: 프론트엔드 `FxSection`

**Files:**
- Modify: `frontend/src/pages/Market.jsx`

- [ ] **Step 1: `FxSection` 컴포넌트 추가**

`Market.jsx`의 `TreasurySection` 함수 바로 앞에 추가:

```jsx
function FxSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/market/fx')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>환율</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>환율</h3><ErrorBox /></div>

  const FX_LABELS = { usdkrw: 'USD/KRW', usdjpy: 'USD/JPY', eurusd: 'EUR/USD' }
  const rates = data.rates || {}
  const usdkrwHistory = (data.history?.usdkrw || []).slice(-252)

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>환율</h3>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {['usdkrw', 'usdjpy', 'eurusd'].map(key => {
          const r = rates[key]
          const up = r?.change_pct > 0
          const down = r?.change_pct < 0
          return (
            <div key={key} style={{ ...CARD_STYLE, minWidth: 110, flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{FX_LABELS[key]}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                {r ? r.current.toLocaleString() : '-'}
              </div>
              {r && (
                <div style={{ fontSize: 12, color: up ? '#81c784' : down ? '#e57373' : 'var(--text-muted)', marginTop: 2 }}>
                  {up ? '▲' : down ? '▼' : '─'} {Math.abs(r.change_pct).toFixed(2)}%
                </div>
              )}
            </div>
          )
        })}
      </div>
      {usdkrwHistory.length > 0 && (
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>USD/KRW 추이 (1년)</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={usdkrwHistory} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                     tickFormatter={v => v.slice(5)} interval={Math.floor(usdkrwHistory.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }}
                       labelStyle={{ color: 'var(--text-muted)' }} />
              <Line type="monotone" dataKey="value" name="USD/KRW" stroke="#4fc3f7" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `Market()` return 블록 교체**

`Market.jsx`의 `export default function Market()` 전체를 다음으로 교체:

```jsx
export default function Market() {
  return (
    <div style={{ maxWidth: 900 }}>
      <h2 style={{ color: 'var(--text)', marginBottom: 24 }}>시장지표</h2>
      <TreasurySection />
      <FxSection />
      <M7EarningsSection />
      <KrTop2Section />
      <KrExportsSection />
    </div>
  )
}
```

(VixSection, CommoditiesSection, EconIndicatorsSection은 Task 7~9에서 추가)

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/pages/Market.jsx
git commit -m "feat: add FxSection to Market page (USD/KRW, USD/JPY, EUR/USD)"
```

---

## Task 7: 프론트엔드 `VixSection`

**Files:**
- Modify: `frontend/src/pages/Market.jsx`

- [ ] **Step 1: `VixSection` 컴포넌트 추가**

`FxSection` 함수 바로 아래에 추가:

```jsx
function VixSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/market/vix')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>공포탐욕지수 (VIX)</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>공포탐욕지수 (VIX)</h3><ErrorBox /></div>

  const vix = data.current
  const vixColor = vix >= 30 ? '#e57373' : vix >= 20 ? '#ffb74d' : '#81c784'
  const vixLabel = vix >= 30 ? '공포' : vix >= 20 ? '주의' : '탐욕'
  const history = (data.history || []).slice(-252)

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>공포탐욕지수 (VIX)</h3>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div style={{ ...CARD_STYLE, minWidth: 140 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>VIX 현재값</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: vixColor }}>
            {vix != null ? vix.toFixed(1) : '-'}
          </div>
          <div style={{ fontSize: 12, color: vixColor, marginTop: 2 }}>{vixLabel}</div>
          {data.change != null && (
            <div style={{ fontSize: 12, color: data.change > 0 ? '#e57373' : '#81c784', marginTop: 4 }}>
              {data.change > 0 ? '▲' : '▼'} {Math.abs(data.change).toFixed(2)}
            </div>
          )}
        </div>
      </div>
      {history.length > 0 && (
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>VIX 추이 (1년)</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={history} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                     tickFormatter={v => v.slice(5)} interval={Math.floor(history.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={[0, 'auto']} />
              <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }}
                       labelStyle={{ color: 'var(--text-muted)' }} />
              <ReferenceLine y={30} stroke="#e57373" strokeDasharray="4 2" label={{ value: '30', fill: '#e57373', fontSize: 10 }} />
              <Line type="monotone" dataKey="value" name="VIX" stroke="#ffb74d" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `Market()` return에 `VixSection` 삽입**

```jsx
export default function Market() {
  return (
    <div style={{ maxWidth: 900 }}>
      <h2 style={{ color: 'var(--text)', marginBottom: 24 }}>시장지표</h2>
      <TreasurySection />
      <FxSection />
      <VixSection />
      <M7EarningsSection />
      <KrTop2Section />
      <KrExportsSection />
    </div>
  )
}
```

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/pages/Market.jsx
git commit -m "feat: add VixSection to Market page with fear/greed color coding"
```

---

## Task 8: 프론트엔드 `CommoditiesSection`

**Files:**
- Modify: `frontend/src/pages/Market.jsx`

- [ ] **Step 1: `CommoditiesSection` 컴포넌트 추가**

`VixSection` 함수 바로 아래에 추가:

```jsx
function CommoditiesSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/market/commodities')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>원자재</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>원자재</h3><ErrorBox /></div>

  const LABELS = { gold: '금 (Gold)', oil: 'WTI 원유', copper: '구리 (Copper)' }
  const prices = data.prices || {}
  const history = data.history || {}

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>원자재</h3>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {['gold', 'oil', 'copper'].map(key => {
          const p = prices[key]
          const up = p?.change_pct > 0
          const down = p?.change_pct < 0
          return (
            <div key={key} style={{ ...CARD_STYLE, minWidth: 120, flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{LABELS[key]}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                {p ? `$${p.current.toLocaleString()}` : '-'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p?.unit}</div>
              {p && (
                <div style={{ fontSize: 12, color: up ? '#81c784' : down ? '#e57373' : 'var(--text-muted)', marginTop: 2 }}>
                  {up ? '▲' : down ? '▼' : '─'} {Math.abs(p.change_pct).toFixed(2)}%
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {[
          { key: 'gold', label: '금', color: '#ffd54f' },
          { key: 'oil',  label: 'WTI', color: '#4fc3f7' },
          { key: 'copper', label: '구리', color: '#ff8a65' },
        ].map(({ key, label, color }) => {
          const h = (history[key] || []).slice(-252)
          if (!h.length) return null
          return (
            <div key={key} style={{ ...CARD_STYLE, flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{label} 추이 (1년)</div>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={h} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                         tickFormatter={v => v.slice(5)} interval={Math.floor(h.length / 4)} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 11 }}
                           labelStyle={{ color: 'var(--text-muted)' }} />
                  <Line type="monotone" dataKey="value" name={label} stroke={color} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `Market()` return에 `CommoditiesSection` 삽입**

```jsx
export default function Market() {
  return (
    <div style={{ maxWidth: 900 }}>
      <h2 style={{ color: 'var(--text)', marginBottom: 24 }}>시장지표</h2>
      <TreasurySection />
      <FxSection />
      <VixSection />
      <CommoditiesSection />
      <M7EarningsSection />
      <KrTop2Section />
      <KrExportsSection />
    </div>
  )
}
```

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/pages/Market.jsx
git commit -m "feat: add CommoditiesSection to Market page (gold, WTI, copper)"
```

---

## Task 9: 프론트엔드 `EconIndicatorsSection`

**Files:**
- Modify: `frontend/src/pages/Market.jsx`

- [ ] **Step 1: `EconIndicatorsSection` 컴포넌트 추가**

`CommoditiesSection` 함수 바로 아래에 추가:

```jsx
function EconIndicatorsSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/market/econ-indicators')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>경제지표 (미국)</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>경제지표 (미국)</h3><ErrorBox /></div>

  if (data.error) {
    return (
      <div style={SECTION_STYLE}>
        <h3 style={SECTION_HEADER_STYLE}>경제지표 (미국)</h3>
        <div style={{ ...CARD_STYLE, fontSize: 13, color: 'var(--text-muted)' }}>
          <p>{data.error}</p>
        </div>
      </div>
    )
  }

  const charts = [
    { key: 'cpi', label: 'CPI (소비자물가지수)', color: '#ce93d8', unit: '' },
    { key: 'unemployment', label: '실업률', color: '#80cbc4', unit: '%' },
  ]

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>경제지표 (미국)</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {charts.map(({ key, label, color, unit }) => {
          const h = data[key] || []
          return (
            <div key={key} style={{ ...CARD_STYLE, flex: 1, minWidth: 280 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{label} (3년)</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={h} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                         tickFormatter={v => v.slice(0, 7)} interval={Math.floor(h.length / 5)} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} domain={['auto', 'auto']}
                         tickFormatter={v => `${v}${unit}`} />
                  <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 11 }}
                           labelStyle={{ color: 'var(--text-muted)' }}
                           formatter={v => [`${v}${unit}`, label]} />
                  <Line type="monotone" dataKey="value" name={label} stroke={color} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `Market()` return — 최종 완성 상태로 교체**

```jsx
export default function Market() {
  return (
    <div style={{ maxWidth: 900 }}>
      <h2 style={{ color: 'var(--text)', marginBottom: 24 }}>시장지표</h2>
      <TreasurySection />
      <FxSection />
      <VixSection />
      <CommoditiesSection />
      <EconIndicatorsSection />
      <M7EarningsSection />
      <KrTop2Section />
      <KrExportsSection />
    </div>
  )
}
```

- [ ] **Step 3: 전체 백엔드 테스트 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/ -v --tb=short
```
Expected: 모두 PASSED

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/Market.jsx
git commit -m "feat: add EconIndicatorsSection to Market page (CPI, unemployment via FRED)"
```

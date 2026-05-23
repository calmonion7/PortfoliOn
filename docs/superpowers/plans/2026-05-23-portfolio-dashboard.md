# Portfolio Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 포트폴리오 페이지에 "대시보드" 탭을 추가해 보유종목 카드 그리드로 날씨 신호·변동률·수익률·RSI를 한눈에 표시한다.

**Architecture:** 백엔드 `market.get_quote`에 주간/월간 변동률 필드를 추가하고, `GET /api/dashboard` 엔드포인트가 보유종목 목록·최신 스냅샷·현재 시세를 병렬로 집계해 반환한다. 프론트엔드 `Portfolio.jsx`에 대시보드 탭과 `DashboardGrid` / `DashboardCard` 컴포넌트를 추가한다.

**Tech Stack:** Python/FastAPI, yfinance, Naver Finance API, React 18, plain CSS (CSS variables)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/services/market.py` | Modify | `get_quote` / `get_quote_kr`에 `daily_change_pct`, `weekly_change_pct`, `monthly_change_pct` float 필드 추가 |
| `backend/routers/stocks.py` | Modify | `GET /api/dashboard` 엔드포인트 추가 |
| `backend/tests/test_market.py` | Modify | 새 필드 존재 검증 테스트 추가 |
| `backend/tests/test_stocks_router.py` | Modify | `/api/dashboard` 엔드포인트 테스트 추가 |
| `frontend/src/pages/Portfolio.jsx` | Modify | 대시보드 탭 + `DashboardGrid` + `DashboardCard` + `overallWeather` 추가 |

---

## Task 1: market.get_quote에 주간/월간 변동률 추가

**Files:**
- Modify: `backend/services/market.py` (get_quote 함수 ~line 370, get_quote_kr 함수 ~line 81)
- Test: `backend/tests/test_market.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_market.py` 끝에 아래 함수를 추가한다:

```python
def test_get_quote_includes_weekly_monthly_change_fields():
    with patch("services.market.yf.Ticker", return_value=_make_mock_ticker()):
        from services import market
        import importlib; importlib.reload(market)
        result = market.get_quote("TEST")
    assert "daily_change_pct" in result
    assert "weekly_change_pct" in result
    assert "monthly_change_pct" in result
    for key in ("daily_change_pct", "weekly_change_pct", "monthly_change_pct"):
        assert result[key] is None or isinstance(result[key], float)
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_market.py::test_get_quote_includes_weekly_monthly_change_fields -v
```

Expected: `FAILED` with `AssertionError: assert 'weekly_change_pct' in {...}`

- [ ] **Step 3: get_quote (US) 수정**

`backend/services/market.py`의 `get_quote` 함수에서 `hist` 계산 직후 블록을 아래로 교체한다.

기존 코드 (line ~382–395):
```python
        current = info.get("currentPrice") or info.get("regularMarketPrice") or 0.0
        prev_close = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else None
        ytd_start = float(hist["Close"].iloc[0]) if not hist.empty else None
        daily_change_pct = ((current - prev_close) / prev_close * 100) if prev_close else None
        ytd_return = ((current - ytd_start) / ytd_start * 100) if ytd_start else None
        return {
            "ticker": ticker,
            "name": info.get("shortName", ticker),
            "price": float(current),
            "prev_close": round(prev_close, 2) if prev_close else None,
            "daily_change": f"{daily_change_pct:+.2f}%" if daily_change_pct is not None else "N/A",
            "market_cap": info.get("marketCap"),
            "ytd_return": round(ytd_return, 2) if ytd_return else None,
            "market": market,
        }
```

교체 코드:
```python
        current = info.get("currentPrice") or info.get("regularMarketPrice") or 0.0
        prev_close = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else None
        week_ago = float(hist["Close"].iloc[-6]) if len(hist) >= 6 else None
        month_ago = float(hist["Close"].iloc[-23]) if len(hist) >= 23 else None
        ytd_start = float(hist["Close"].iloc[0]) if not hist.empty else None
        daily_change_pct = round((current - prev_close) / prev_close * 100, 2) if prev_close else None
        weekly_change_pct = round((current - week_ago) / week_ago * 100, 2) if week_ago else None
        monthly_change_pct = round((current - month_ago) / month_ago * 100, 2) if month_ago else None
        ytd_return = ((current - ytd_start) / ytd_start * 100) if ytd_start else None
        return {
            "ticker": ticker,
            "name": info.get("shortName", ticker),
            "price": float(current),
            "prev_close": round(prev_close, 2) if prev_close else None,
            "daily_change": f"{daily_change_pct:+.2f}%" if daily_change_pct is not None else "N/A",
            "daily_change_pct": daily_change_pct,
            "weekly_change_pct": weekly_change_pct,
            "monthly_change_pct": monthly_change_pct,
            "market_cap": info.get("marketCap"),
            "ytd_return": round(ytd_return, 2) if ytd_return else None,
            "market": market,
        }
```

또한 같은 함수의 except 블록 return에도 세 필드를 추가한다:
```python
    except Exception as e:
        return {
            "ticker": ticker, "name": ticker, "price": None,
            "prev_close": None, "daily_change": "N/A",
            "daily_change_pct": None, "weekly_change_pct": None, "monthly_change_pct": None,
            "market_cap": None, "ytd_return": None, "market": market, "error": str(e),
        }
```

- [ ] **Step 4: get_quote_kr 수정**

`backend/services/market.py`의 `get_quote_kr` 함수에서 inner try 블록을 아래로 교체한다.

기존 inner try 블록:
```python
        ytd_return = None
        try:
            yf_t = yf.Ticker(f"{ticker}.{exchange or 'KS'}")
            hist = yf_t.history(period="1y")
            if not hist.empty and price:
                start = float(hist["Close"].iloc[0])
                ytd_return = round((price - start) / start * 100, 2)
            yf_info = yf_t.info
            sector = yf_info.get("sector", "") or ""
            industry = yf_info.get("industry", "") or ""
        except Exception:
            pass
```

교체 코드:
```python
        ytd_return = None
        weekly_change_pct = None
        monthly_change_pct = None
        try:
            yf_t = yf.Ticker(f"{ticker}.{exchange or 'KS'}")
            hist = yf_t.history(period="1y")
            if not hist.empty and price:
                start = float(hist["Close"].iloc[0])
                ytd_return = round((price - start) / start * 100, 2)
                if len(hist) >= 6:
                    week_ago = float(hist["Close"].iloc[-6])
                    weekly_change_pct = round((price - week_ago) / week_ago * 100, 2)
                if len(hist) >= 23:
                    month_ago = float(hist["Close"].iloc[-23])
                    monthly_change_pct = round((price - month_ago) / month_ago * 100, 2)
            yf_info = yf_t.info
            sector = yf_info.get("sector", "") or ""
            industry = yf_info.get("industry", "") or ""
        except Exception:
            pass
```

그리고 `get_quote_kr`의 return dict에 세 필드를 추가한다:
```python
        return {
            "ticker": ticker,
            "name": name,
            "price": price,
            "prev_close": round(prev_close, 0) if prev_close is not None else None,
            "daily_change": daily_change,
            "daily_change_pct": ratio,
            "weekly_change_pct": weekly_change_pct,
            "monthly_change_pct": monthly_change_pct,
            "market_cap": int(mc) if mc else None,
            "ytd_return": ytd_return,
            "market": "KR",
            "sector": sector,
            "industry": industry,
        }
```

또한 except 블록 return에도 추가한다:
```python
    except Exception as e:
        return {
            "ticker": ticker, "name": ticker, "price": None, "prev_close": None,
            "daily_change": "N/A",
            "daily_change_pct": None, "weekly_change_pct": None, "monthly_change_pct": None,
            "market_cap": None, "ytd_return": None,
            "market": "KR", "sector": "", "industry": "", "error": str(e),
        }
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_market.py::test_get_quote_includes_weekly_monthly_change_fields -v
```

Expected: `PASSED`

- [ ] **Step 6: 기존 market 테스트 전체 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_market.py -v
```

Expected: 전체 PASSED (기존 테스트 깨지지 않음)

- [ ] **Step 7: 커밋**

```bash
git add backend/services/market.py backend/tests/test_market.py
git commit -m "feat: add daily/weekly/monthly change pct floats to get_quote"
```

---

## Task 2: GET /api/dashboard 엔드포인트 추가

**Files:**
- Modify: `backend/routers/stocks.py`
- Test: `backend/tests/test_stocks_router.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_stocks_router.py` 끝에 아래를 추가한다:

```python
def test_dashboard_returns_cards_for_holdings():
    portfolio = {
        "stocks": [
            {"ticker": "AAPL", "name": "Apple Inc.", "market": "US",
             "avg_cost": 150.0, "quantity": 10, "exchange": ""},
        ],
        "watchlist": [
            {"ticker": "TSLA", "name": "Tesla", "market": "US",
             "avg_cost": None, "quantity": None, "exchange": ""},
        ]
    }
    quote = {
        "ticker": "AAPL", "price": 185.2,
        "daily_change_pct": 1.4, "weekly_change_pct": 2.1, "monthly_change_pct": 5.8,
        "name": "Apple Inc.", "market": "US",
    }
    from pathlib import Path
    with patch("routers.stocks.storage.get_full_portfolio", return_value=portfolio), \
         patch("routers.stocks.market.get_quote", return_value=quote), \
         patch("routers.stocks.SNAPSHOTS_DIR", Path("/nonexistent")), \
         patch("routers.stocks.REPORTS_DIR", Path("/nonexistent")):
        resp = client.get("/api/dashboard")
    assert resp.status_code == 200
    data = resp.json()
    # 보유종목만 포함 (관심종목 TSLA 제외)
    assert len(data) == 1
    card = data[0]
    assert card["ticker"] == "AAPL"
    assert card["current_price"] == 185.2
    assert card["daily_change_pct"] == 1.4
    assert card["weekly_change_pct"] == 2.1
    assert card["monthly_change_pct"] == 5.8
    assert card["rsi"] is None      # 스냅샷 없음
    assert card["target_mean"] is None


def test_dashboard_returns_empty_list_when_no_holdings():
    portfolio = {"stocks": [], "watchlist": []}
    with patch("routers.stocks.storage.get_full_portfolio", return_value=portfolio):
        resp = client.get("/api/dashboard")
    assert resp.status_code == 200
    assert resp.json() == []
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_stocks_router.py::test_dashboard_returns_cards_for_holdings tests/test_stocks_router.py::test_dashboard_returns_empty_list_when_no_holdings -v
```

Expected: `FAILED` (404 Not Found — 엔드포인트 없음)

- [ ] **Step 3: stocks.py에 임포트 및 상수 추가**

`backend/routers/stocks.py` 상단 기존 import 블록 끝에 추가한다:

```python
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from services import market

SNAPSHOTS_DIR = Path(__file__).parent.parent / "snapshots"
REPORTS_DIR = Path(__file__).parent.parent / "reports"
```

- [ ] **Step 4: /api/dashboard 엔드포인트 구현**

`backend/routers/stocks.py` 파일 끝에 아래 함수를 추가한다:

```python
@router.get("/dashboard")
def get_dashboard():
    portfolio = storage.get_full_portfolio()
    holdings = portfolio.get("stocks", [])
    if not holdings:
        return []

    def _latest_snapshot(ticker: str) -> tuple[dict | None, str | None]:
        for base in (SNAPSHOTS_DIR, REPORTS_DIR):
            ticker_dir = base / ticker
            if ticker_dir.exists():
                dates = sorted([f.stem for f in ticker_dir.glob("*.json")], reverse=True)
                if dates:
                    path = ticker_dir / f"{dates[0]}.json"
                    try:
                        data = json.loads(path.read_text(encoding="utf-8"))
                        return data, dates[0]
                    except Exception:
                        pass
        return None, None

    def _build_card(stock: dict) -> dict:
        ticker = stock["ticker"].upper()
        snapshot, snapshot_date = _latest_snapshot(ticker)
        quote = market.get_quote(ticker, stock.get("market", "US"), stock.get("exchange", ""))

        rsi = None
        target_mean = buy = hold = sell = None
        if snapshot:
            rsi = (snapshot.get("daily_rsi") or {}).get("rsi")
            target_mean = snapshot.get("target_mean")
            buy = snapshot.get("buy")
            hold = snapshot.get("hold")
            sell = snapshot.get("sell")

        return {
            "ticker": ticker,
            "name": stock.get("name", ticker),
            "market": stock.get("market", "US"),
            "avg_cost": stock.get("avg_cost"),
            "quantity": stock.get("quantity"),
            "current_price": quote.get("price"),
            "daily_change_pct": quote.get("daily_change_pct"),
            "weekly_change_pct": quote.get("weekly_change_pct"),
            "monthly_change_pct": quote.get("monthly_change_pct"),
            "rsi": rsi,
            "target_mean": target_mean,
            "buy": buy,
            "hold": hold,
            "sell": sell,
            "snapshot_date": snapshot_date,
        }

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(_build_card, s): s for s in holdings}
        results = [f.result() for f in as_completed(futures)]

    return results
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_stocks_router.py::test_dashboard_returns_cards_for_holdings tests/test_stocks_router.py::test_dashboard_returns_empty_list_when_no_holdings -v
```

Expected: `PASSED`

- [ ] **Step 6: 기존 stocks 테스트 전체 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_stocks_router.py -v
```

Expected: 전체 PASSED

- [ ] **Step 7: 커밋**

```bash
git add backend/routers/stocks.py backend/tests/test_stocks_router.py
git commit -m "feat: add GET /api/dashboard endpoint for portfolio card data"
```

---

## Task 3: Portfolio.jsx에 대시보드 탭 + 카드 그리드 추가

**Files:**
- Modify: `frontend/src/pages/Portfolio.jsx`

이 태스크는 단일 JSX 파일 수정이므로 TDD 대신 단계별로 코드를 추가하고 브라우저에서 검증한다.

- [ ] **Step 1: `_weather`와 `overallWeather` 헬퍼 함수 추가**

`frontend/src/pages/Portfolio.jsx`에서 `const MarketBadge = ...` 선언 바로 위에 아래를 추가한다:

```jsx
const _weather = (score) => {
  if (score <= 0) return { icon: '☀️', label: '맑음' }
  if (score <= 1) return { icon: '⛅', label: '구름 조금' }
  if (score <= 2) return { icon: '☁️', label: '흐림' }
  return { icon: '🌧️', label: '비' }
}

const overallWeather = (item) => {
  const scores = []
  if (item.current_price && item.target_mean) {
    const gap = (item.target_mean - item.current_price) / item.current_price * 100
    const total = (item.buy ?? 0) + (item.hold ?? 0) + (item.sell ?? 0)
    const buyPct = total > 0 ? (item.buy ?? 0) / total * 100 : 50
    if (gap >= 15 && buyPct >= 60) scores.push(0)
    else if (gap >= 5 && buyPct >= 45) scores.push(1)
    else if (gap >= -5) scores.push(2)
    else scores.push(3)
  }
  if (item.rsi != null) {
    if (item.rsi < 30) scores.push(0)
    else if (item.rsi < 45) scores.push(1)
    else if (item.rsi < 65) scores.push(2)
    else scores.push(3)
  }
  if (!scores.length) return null
  return _weather(Math.round(scores.reduce((a, b) => a + b, 0) / scores.length))
}
```

- [ ] **Step 2: `DashboardCard` 컴포넌트 추가**

`overallWeather` 함수 바로 아래에 추가한다:

```jsx
const DashboardCard = ({ item }) => {
  const weather = overallWeather(item)
  const pnlPct = item.current_price != null && item.avg_cost != null
    ? (item.current_price - item.avg_cost) / item.avg_cost * 100
    : null
  const consPct = item.current_price && item.target_mean
    ? (item.target_mean - item.current_price) / item.current_price * 100
    : null

  const fmtPct = (v) => v == null ? '—' : `${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%`
  const pctColor = (v) => v == null ? 'var(--text-muted)' : v >= 0 ? 'var(--positive)' : 'var(--negative)'

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        {weather && <span style={{ fontSize: 16 }} title={weather.label}>{weather.icon}</span>}
        <strong style={{ fontSize: 14 }}>{item.ticker}</strong>
        <MarketBadge market={item.market || 'US'} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{item.name}</div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>
          {item.current_price == null ? '—' : fmtPrice(item.current_price, item.market)}
        </span>
        <span style={{ fontSize: 12, color: pctColor(item.daily_change_pct) }}>
          {fmtPct(item.daily_change_pct)} 오늘
        </span>
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 12, marginBottom: 10 }}>
        <span style={{ color: pctColor(item.weekly_change_pct) }}>주간 {fmtPct(item.weekly_change_pct)}</span>
        <span style={{ color: pctColor(item.monthly_change_pct) }}>월간 {fmtPct(item.monthly_change_pct)}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
        <span style={{ color: 'var(--text-muted)' }}>수익률</span>
        <span style={{ color: pctColor(pnlPct), fontWeight: 600 }}>{fmtPct(pnlPct)}</span>
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between', fontSize: 12,
        borderTop: '1px solid var(--border)', paddingTop: 6,
      }}>
        <span style={{ color: 'var(--text-muted)' }}>
          RSI <strong style={{ color: 'var(--text)' }}>{item.rsi != null ? item.rsi.toFixed(1) : '—'}</strong>
        </span>
        <span style={{ color: pctColor(consPct) }}>
          컨센서스 {consPct != null ? `${consPct >= 0 ? '+' : ''}${consPct.toFixed(0)}%` : '—'}
        </span>
      </div>
    </div>
  )
}

const DashboardGrid = ({ cards, loading }) => {
  if (loading) return <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>불러오는 중...</p>
  if (!cards.length) return <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>보유종목이 없습니다.</p>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
      {cards.map(item => <DashboardCard key={item.ticker} item={item} />)}
    </div>
  )
}
```

- [ ] **Step 3: Portfolio 컴포넌트에 대시보드 상태와 fetch 추가**

`Portfolio()` 함수 안의 기존 `useState` 선언들 끝에 추가한다 (line ~29 근처):

```jsx
  const [dashboardCards, setDashboardCards] = useState([])
  const [dashboardLoading, setDashboardLoading] = useState(false)
```

`fetchAll` 함수 아래에 `fetchDashboard` 함수를 추가한다:

```jsx
  const fetchDashboard = useCallback(async () => {
    setDashboardLoading(true)
    try {
      const res = await axios.get('/api/dashboard')
      setDashboardCards(res.data || [])
    } catch {
      // 오류 시 빈 배열 유지
    } finally {
      setDashboardLoading(false)
    }
  }, [])
```

- [ ] **Step 4: 대시보드 탭 버튼 추가**

`Portfolio.jsx`의 탭 목록 부분:

```jsx
      {/* 탭 */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
        <button style={TAB_STYLE(activeTab === 'holdings')} onClick={() => setActiveTab('holdings')}>
          보유종목 ({stocks.length})
        </button>
        <button style={TAB_STYLE(activeTab === 'watchlist')} onClick={() => setActiveTab('watchlist')}>
          관심종목 ({watchlist.length})
        </button>
      </div>
```

위를 아래로 교체한다:

```jsx
      {/* 탭 */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
        <button style={TAB_STYLE(activeTab === 'holdings')} onClick={() => setActiveTab('holdings')}>
          보유종목 ({stocks.length})
        </button>
        <button style={TAB_STYLE(activeTab === 'watchlist')} onClick={() => setActiveTab('watchlist')}>
          관심종목 ({watchlist.length})
        </button>
        <button
          style={TAB_STYLE(activeTab === 'dashboard')}
          onClick={() => { setActiveTab('dashboard'); fetchDashboard() }}
        >
          대시보드
        </button>
      </div>
```

- [ ] **Step 5: 대시보드 탭 콘텐츠 렌더링 추가**

`Portfolio.jsx`의 `{error && ...}` 줄 바로 아래, 기존 `{/* 보유종목 탭 */}` 블록 위에 아래를 삽입한다:

```jsx
      {/* 대시보드 탭 */}
      {activeTab === 'dashboard' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn-secondary" onClick={fetchDashboard} disabled={dashboardLoading}>
              ↺ 새로고침
            </button>
          </div>
          <DashboardGrid cards={dashboardCards} loading={dashboardLoading} />
        </>
      )}
```

또한 대시보드 탭에서는 검색/필터 행이 보일 필요가 없다. 기존 검색/필터 `<div>` 블록 전체를 아래처럼 조건부로 감싼다 (`<div>` 내부는 건드리지 않는다):

```jsx
      {/* 검색 + 시장 필터 — 대시보드 탭에서는 숨김 */}
      {activeTab !== 'dashboard' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="🔍 티커 또는 회사명 검색..."
            style={{
              flex: 1, padding: '7px 12px', background: 'var(--input-bg)',
              border: '1px solid var(--input-border)', borderRadius: 4,
              color: 'var(--text)', fontSize: 13,
            }}
          />
          {['ALL', 'US', 'KR'].map(m => (
            <button
              key={m}
              onClick={() => setMarketFilter(m)}
              style={{
                padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                background: marketFilter === m ? 'var(--bg-surface)' : 'var(--bg-card)',
                color: marketFilter === m ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {m === 'ALL' ? `전체 (${activeTab === 'holdings' ? stocks.length : watchlist.length})`
                : m === 'US' ? `🇺🇸 US (${activeTab === 'holdings' ? usHoldings : usWatch})`
                : `🇰🇷 KR (${activeTab === 'holdings' ? krHoldings : krWatch})`}
            </button>
          ))}
        </div>
      )}
```

- [ ] **Step 6: 브라우저에서 기능 확인**

서버 실행:
```bash
# 백엔드
cd backend && .venv/bin/python -m uvicorn main:app --reload --port 8000

# 프론트엔드 (다른 터미널)
cd frontend && npm run dev
```

브라우저에서 `http://localhost:5173` 접속 후:
1. "포트폴리오" 페이지로 이동
2. "대시보드" 탭 클릭 → 로딩 스피너 표시 후 카드 그리드 렌더링 확인
3. 각 카드에 날씨 아이콘, 티커, 현재가, 변동률, 수익률, RSI 표시 확인
4. 스냅샷 없는 종목은 RSI·컨센서스 칸이 `—`로 표시 확인
5. "↺ 새로고침" 버튼 클릭 시 재조회 확인
6. "보유종목" / "관심종목" 탭 전환 후 검색/필터 정상 작동 확인

- [ ] **Step 7: 전체 백엔드 테스트 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest -v
```

Expected: 전체 PASSED

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/pages/Portfolio.jsx
git commit -m "feat: add dashboard tab with stock card grid to Portfolio page"
```

# Calendar Holiday Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 캘린더 페이지에 NYSE(미국)·KRX(한국) 휴장일을 이벤트 칩으로 표시한다.

**Architecture:** `exchange_calendars` 패키지로 NYSE·KRX 휴장일을 조회하여 기존 실적/배당 이벤트와 함께 `/api/calendar` 응답에 포함시킨다. 프론트엔드는 `type: "holiday_us"` / `type: "holiday_kr"` 이벤트를 각각 붉은/파란 칩으로 렌더링한다. 캐시 구조는 변경 없이 유지된다.

**Tech Stack:** Python `exchange_calendars`, FastAPI, React 18

---

## File Map

| File | Action | 변경 내용 |
|------|--------|-----------|
| `backend/requirements.txt` | Modify | `exchange_calendars` 추가 |
| `backend/routers/calendar.py` | Modify | `_get_holidays()` 추가, `_get_events()`에서 호출 |
| `backend/tests/test_calendar_router.py` | Modify | 휴장일 이벤트 포함 테스트 추가 |
| `frontend/src/pages/Calendar.jsx` | Modify | 휴장일 스타일·렌더링·범례 추가 |

---

## Task 1: exchange_calendars 패키지 설치

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: 패키지 설치**

```bash
cd backend && .venv/bin/pip install exchange_calendars
```

Expected output: `Successfully installed exchange_calendars-...`

- [ ] **Step 2: 동작 확인**

```bash
cd backend && .venv/bin/python -c "
import exchange_calendars as xcals
cal = xcals.get_calendar('XNYS')
import pandas as pd
start = pd.Timestamp('2026-01-01')
end = pd.Timestamp('2026-01-31')
holidays = [h for h in cal.holidays().holidays if start <= h <= end]
print('NYSE Jan 2026 holidays:', [str(h.date()) for h in holidays])
"
```

Expected: `NYSE Jan 2026 holidays: ['2026-01-01', '2026-01-19']` (신년·MLK Day)

- [ ] **Step 3: requirements.txt 추가**

`backend/requirements.txt` 끝에 한 줄 추가:

```
exchange_calendars>=4.5
```

- [ ] **Step 4: 커밋**

```bash
git add backend/requirements.txt
git commit -m "chore: add exchange_calendars dependency"
```

---

## Task 2: 백엔드 — _get_holidays 구현

**Files:**
- Modify: `backend/routers/calendar.py`
- Modify: `backend/tests/test_calendar_router.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_calendar_router.py` 끝에 추가:

```python
def test_calendar_includes_nyse_holiday(tmp_path):
    import exchange_calendars as xcals
    import pandas as pd

    mock_cal = MagicMock()
    mock_cal.holidays.return_value = MagicMock(
        holidays=pd.DatetimeIndex(["2026-05-25"])  # Memorial Day
    )

    with patch("routers.calendar.storage.get_full_portfolio", return_value={"stocks": [], "watchlist": []}), \
         patch("routers.calendar._CACHE_DIR", tmp_path), \
         patch("routers.calendar.xcals.get_calendar", return_value=mock_cal):
        resp = client.get("/api/calendar?month=2026-05")

    assert resp.status_code == 200
    events = resp.json()["events"]
    us_holidays = [e for e in events if e["type"] == "holiday_us"]
    assert len(us_holidays) == 1
    assert us_holidays[0]["date"] == "2026-05-25"
    assert us_holidays[0]["ticker"] == "NYSE"
    assert us_holidays[0]["stock_type"] == "market"


def test_calendar_includes_krx_holiday(tmp_path):
    import pandas as pd

    mock_cal = MagicMock()
    mock_cal.holidays.return_value = MagicMock(
        holidays=pd.DatetimeIndex(["2026-05-05"])  # 어린이날
    )

    with patch("routers.calendar.storage.get_full_portfolio", return_value={"stocks": [], "watchlist": []}), \
         patch("routers.calendar._CACHE_DIR", tmp_path), \
         patch("routers.calendar.xcals.get_calendar", return_value=mock_cal):
        resp = client.get("/api/calendar?month=2026-05")

    assert resp.status_code == 200
    events = resp.json()["events"]
    kr_holidays = [e for e in events if e["type"] == "holiday_kr"]
    assert len(kr_holidays) == 1
    assert kr_holidays[0]["date"] == "2026-05-05"
    assert kr_holidays[0]["ticker"] == "KRX"
    assert kr_holidays[0]["stock_type"] == "market"
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_calendar_router.py::test_calendar_includes_nyse_holiday tests/test_calendar_router.py::test_calendar_includes_krx_holiday -v
```

Expected: FAIL (AttributeError 또는 ImportError)

- [ ] **Step 3: calendar.py 상단에 import 추가**

`backend/routers/calendar.py` 상단의 import 블록에 추가:

```python
import exchange_calendars as xcals
```

- [ ] **Step 4: _get_holidays 함수 추가**

`backend/routers/calendar.py`에서 `_collect_dividend` 함수 아래에 추가:

```python
def _get_holidays(month_start: date, month_end: date) -> list[dict]:
    results = []
    for exchange, label, holiday_type in [
        ("XNYS", "NYSE", "holiday_us"),
        ("XKRX", "KRX",  "holiday_kr"),
    ]:
        try:
            cal = xcals.get_calendar(exchange)
            for h in cal.holidays().holidays:
                d = h.date()
                if month_start <= d <= month_end:
                    results.append({
                        "date": d.isoformat(),
                        "ticker": label,
                        "name": f"{label} 휴장",
                        "type": holiday_type,
                        "stock_type": "market",
                    })
        except Exception as e:
            print(f"calendar: holiday fetch failed {exchange}: {e}", file=sys.stderr)
    return results
```

- [ ] **Step 5: _get_events에서 _get_holidays 호출**

`backend/routers/calendar.py`의 `_get_events` 함수에서 `path.write_text(...)` 바로 앞에 추가:

현재:
```python
    path.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    return events
```

변경 후:
```python
    events.extend(_get_holidays(month_start, month_end))
    path.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    return events
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_calendar_router.py -v
```

Expected: 모든 테스트 PASS

- [ ] **Step 7: 커밋**

```bash
git add backend/routers/calendar.py backend/tests/test_calendar_router.py
git commit -m "feat: NYSE·KRX 휴장일을 캘린더 이벤트에 포함"
```

---

## Task 3: 프론트엔드 — 휴장일 칩 표시

**Files:**
- Modify: `frontend/src/pages/Calendar.jsx`

- [ ] **Step 1: EVENT_STYLE에 휴장일 스타일 추가**

`Calendar.jsx`의 `EVENT_STYLE` 객체:

현재:
```js
const EVENT_STYLE = {
  holding_earnings:  { background: '#1a2a4a', color: '#4fc3f7', border: '1px solid #2a4a6a' },
  holding_dividend:  { background: '#1a3a2a', color: '#81c784', border: '1px solid #2e6b4a' },
  watchlist_earnings: { background: 'transparent', color: '#3a8aaa', border: '1px dashed #2a4a6a' },
  watchlist_dividend: { background: 'transparent', color: '#4a7a5a', border: '1px dashed #2e6b4a' },
}
```

변경 후:
```js
const EVENT_STYLE = {
  holding_earnings:  { background: '#1a2a4a', color: '#4fc3f7', border: '1px solid #2a4a6a' },
  holding_dividend:  { background: '#1a3a2a', color: '#81c784', border: '1px solid #2e6b4a' },
  watchlist_earnings: { background: 'transparent', color: '#3a8aaa', border: '1px dashed #2a4a6a' },
  watchlist_dividend: { background: 'transparent', color: '#4a7a5a', border: '1px dashed #2e6b4a' },
  holiday_us: { background: '#2a1a1a', color: '#ef9a9a', border: '1px solid #5a2a2a' },
  holiday_kr: { background: '#1a1a2a', color: '#90caf9', border: '1px solid #2a2a5a' },
}
```

- [ ] **Step 2: 칩 텍스트 렌더링 수정**

`Calendar.jsx`의 이벤트 칩 텍스트 부분:

현재:
```jsx
                  {e.ticker} {e.type === 'earnings' ? '실적' : '배당락'}
```

변경 후:
```jsx
                  {e.type === 'holiday_us' || e.type === 'holiday_kr'
                    ? e.name
                    : `${e.ticker} ${e.type === 'earnings' ? '실적' : '배당락'}`}
```

- [ ] **Step 3: 범례에 휴장일 항목 추가**

`Calendar.jsx`의 범례 부분:

현재:
```jsx
      <div style={{ marginTop: 10, display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <span style={{ ...EVENT_STYLE.holding_earnings, padding: '1px 6px', borderRadius: 3 }}>보유 실적</span>
        <span style={{ ...EVENT_STYLE.holding_dividend, padding: '1px 6px', borderRadius: 3 }}>보유 배당락</span>
        <span style={{ ...EVENT_STYLE.watchlist_earnings, padding: '1px 6px', borderRadius: 3 }}>관심 실적</span>
        <span style={{ ...EVENT_STYLE.watchlist_dividend, padding: '1px 6px', borderRadius: 3 }}>관심 배당락</span>
      </div>
```

변경 후:
```jsx
      <div style={{ marginTop: 10, display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <span style={{ ...EVENT_STYLE.holding_earnings, padding: '1px 6px', borderRadius: 3 }}>보유 실적</span>
        <span style={{ ...EVENT_STYLE.holding_dividend, padding: '1px 6px', borderRadius: 3 }}>보유 배당락</span>
        <span style={{ ...EVENT_STYLE.watchlist_earnings, padding: '1px 6px', borderRadius: 3 }}>관심 실적</span>
        <span style={{ ...EVENT_STYLE.watchlist_dividend, padding: '1px 6px', borderRadius: 3 }}>관심 배당락</span>
        <span style={{ ...EVENT_STYLE.holiday_us, padding: '1px 6px', borderRadius: 3 }}>NYSE 휴장</span>
        <span style={{ ...EVENT_STYLE.holiday_kr, padding: '1px 6px', borderRadius: 3 }}>KRX 휴장</span>
      </div>
```

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/Calendar.jsx
git commit -m "feat: 캘린더에 NYSE·KRX 휴장일 칩 표시"
```

---

## Task 4: 통합 확인

- [ ] **Step 1: 전체 테스트 실행**

```bash
cd backend && .venv/bin/python -m pytest tests/test_calendar_router.py -v
```

Expected: 7개 테스트 모두 PASS

- [ ] **Step 2: 서버 재시작 후 API 확인**

```bash
curl -s "http://localhost:8000/api/calendar?month=2026-05" | python3 -c "
import json, sys
events = json.load(sys.stdin)['events']
holidays = [e for e in events if 'holiday' in e['type']]
print('휴장일 이벤트:', len(holidays))
for h in holidays:
    print(f\"  {h['date']} {h['ticker']} ({h['type']})\")
"
```

Expected: NYSE·KRX 휴장일 목록 출력

- [ ] **Step 3: 브라우저에서 캘린더 페이지 확인**

`http://localhost:5173/research` → 캘린더 탭 이동 후:
- NYSE 휴장일: 붉은 칩으로 "NYSE 휴장" 표시
- KRX 휴장일: 파란 칩으로 "KRX 휴장" 표시
- 범례 하단에 두 항목 추가됨
- 기존 실적/배당 이벤트 정상 표시 확인

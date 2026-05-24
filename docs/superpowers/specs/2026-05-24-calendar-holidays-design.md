# Calendar Holiday Display — Design Spec

**Date:** 2026-05-24  
**Scope:** 캘린더 페이지에 미국(NYSE) + 한국(KRX) 휴장일을 이벤트 칩으로 표시

---

## Goal

캘린더에서 실적/배당 이벤트와 함께 NYSE·KRX 휴장일을 확인할 수 있게 한다. 미래 휴장일 포함, 자동 갱신.

---

## Backend

### 의존성 추가

```
exchange_calendars
```

`backend/.venv/bin/pip install exchange_calendars`

### `backend/routers/calendar.py` 수정

`_get_events(month)` 내부에서 기존 주식 이벤트 수집 후 휴장일을 추가로 병합한다.

```python
def _get_holidays(month: str, year: int, mon: int, month_start, month_end) -> list[dict]:
    import exchange_calendars as xcals
    events = []
    for exchange, label, holiday_type in [
        ("XNYS", "NYSE", "holiday_us"),
        ("XKRX", "KRX", "holiday_kr"),
    ]:
        try:
            cal = xcals.get_calendar(exchange)
            holidays = cal.holidays().holidays  # pandas DatetimeIndex
            for h in holidays:
                d = h.date()
                if month_start <= d <= month_end:
                    events.append({
                        "date": d.isoformat(),
                        "ticker": label,
                        "name": f"{label} 휴장",
                        "type": holiday_type,
                        "stock_type": "market",
                    })
        except Exception as e:
            print(f"calendar: holiday fetch failed {exchange}: {e}", file=sys.stderr)
    return events
```

`_get_events` 마지막에 `events.extend(_get_holidays(...))` 호출.

### 캐시

기존 파일 캐시(`data/calendar/YYYY-MM.json`) 구조 그대로 사용. 휴장일도 동일 캐시에 포함.

---

## Frontend

### `Calendar.jsx` — EVENT_STYLE 추가

```js
holiday_us: { background: '#2a1a1a', color: '#ef9a9a', border: '1px solid #5a2a2a' },
holiday_kr: { background: '#1a1a2a', color: '#90caf9', border: '1px solid #2a2a5a' },
```

### 이벤트 칩 텍스트

```jsx
{e.type === 'earnings' ? '실적'
 : e.type === 'dividend' ? '배당락'
 : e.name}  // "NYSE 휴장" / "KRX 휴장"
```

### 범례 추가

```jsx
<span style={{ ...EVENT_STYLE.holiday_us, padding: '1px 6px', borderRadius: 3 }}>NYSE 휴장</span>
<span style={{ ...EVENT_STYLE.holiday_kr, padding: '1px 6px', borderRadius: 3 }}>KRX 휴장</span>
```

---

## Out of Scope

- 휴장일 필터링 UI (토글 등)
- 반휴장(조기 마감일) 표시
- 공휴일 이름 표시 (예: "Thanksgiving")

---

## Success Criteria

- `/api/calendar?month=YYYY-MM` 응답에 `type: "holiday_us"` / `type: "holiday_kr"` 이벤트 포함
- 캘린더 UI에서 붉은 칩(NYSE), 파란 칩(KRX)으로 표시됨
- 기존 실적/배당 이벤트에 영향 없음

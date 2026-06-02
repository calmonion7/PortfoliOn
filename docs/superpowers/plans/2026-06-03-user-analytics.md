# 사용자 행동 Analytics 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자 행동 이벤트를 수집하고 admin이 기능별 사용량·사용자별 패턴을 모니터링할 수 있는 Analytics 페이지를 추가한다.

**Architecture:** 하이브리드 추적 — FastAPI 미들웨어가 API 호출 기반 이벤트(종목 추가/삭제/리포트 생성 등)를 자동 수집하고, 프론트엔드가 `POST /api/events`로 UI 전용 이벤트(탭 이동, 리포트 뷰 오픈 등)를 전송한다. admin 전용 `/admin-analytics` 페이지에서 집계 대시보드와 사용자별 드릴다운을 제공한다.

**Tech Stack:** Python/FastAPI, psycopg2, Starlette BaseHTTPMiddleware, React 18, recharts (이미 프로젝트에 있음)

**Note:** 설계 스펙의 `stock_modal_open` 이벤트는 실제 코드에서 StockModal이 종목 추가/편집용으로만 쓰이므로 `report_view_open`(Reports.jsx에서 리포트 상세 오픈 시)으로 대체한다.

---

## 파일 구조

**신규 생성:**
- `backend/migrations/001_user_events.sql` — DB 마이그레이션
- `backend/middleware/__init__.py` — 패키지 초기화
- `backend/middleware/event_tracker.py` — FastAPI 미들웨어
- `backend/routers/events.py` — 프론트 이벤트 수신 엔드포인트
- `backend/tests/test_events_router.py` — events 라우터 테스트
- `backend/tests/test_event_tracker.py` — 미들웨어 테스트
- `frontend/src/utils/analytics.js` — 이벤트 전송 유틸리티
- `frontend/src/pages/AdminAnalytics.jsx` — admin 전용 대시보드 페이지

**기존 수정:**
- `backend/app_schema.sql` — user_events 테이블 추가
- `backend/routers/admin.py` — analytics 엔드포인트 4개 추가
- `backend/tests/test_admin_router.py` — analytics 엔드포인트 테스트 추가
- `backend/main.py` — events 라우터 + 미들웨어 등록
- `frontend/src/App.jsx` — admin analytics 라우트 + nav 아이템 추가
- `frontend/src/components/MobileNav.jsx` — nav 이벤트 추적 추가
- `frontend/src/pages/Portfolio.jsx` — 서브탭 + 검색 이벤트 추적
- `frontend/src/pages/Research.jsx` — 서브탭 이벤트 추적
- `frontend/src/pages/Reports.jsx` — 리포트 뷰/탭 이벤트 추적

---

## Task 1: DB 마이그레이션

**Files:**
- Create: `backend/migrations/001_user_events.sql`
- Modify: `backend/app_schema.sql`

- [ ] **Step 1: 마이그레이션 SQL 파일 생성**

```sql
-- backend/migrations/001_user_events.sql
CREATE TABLE IF NOT EXISTS user_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  event_name  text NOT NULL,
  properties  jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_events_user_id    ON user_events(user_id);
CREATE INDEX IF NOT EXISTS idx_user_events_created_at ON user_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_events_name       ON user_events(event_name);
```

- [ ] **Step 2: app_schema.sql에 테이블 추가**

`backend/app_schema.sql` 파일 맨 끝 (`-- 성능 인덱스` 블록 바로 위)에 추가:

```sql
-- 사용자 행동 이벤트
CREATE TABLE user_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  event_name  text NOT NULL,
  properties  jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT NOW()
);
```

그리고 인덱스 블록에 추가:

```sql
CREATE INDEX idx_user_events_user_id    ON user_events(user_id);
CREATE INDEX idx_user_events_created_at ON user_events(created_at DESC);
CREATE INDEX idx_user_events_name       ON user_events(event_name);
```

- [ ] **Step 3: 실행 중인 Docker 컨테이너에 마이그레이션 적용**

```bash
docker exec -i portfolion-postgres-1 psql -U postgres -d portfolion \
  < backend/migrations/001_user_events.sql
```

예상 출력:
```
CREATE TABLE
CREATE INDEX
CREATE INDEX
CREATE INDEX
```

- [ ] **Step 4: 테이블 생성 확인**

```bash
docker exec portfolion-postgres-1 psql -U postgres -d portfolion \
  -c "\d user_events"
```

예상 출력: 컬럼 목록 (id, user_id, event_name, properties, created_at)

- [ ] **Step 5: 커밋**

```bash
git add backend/migrations/001_user_events.sql backend/app_schema.sql
git commit -m "feat: user_events 테이블 + 마이그레이션 추가"
```

---

## Task 2: Backend — 이벤트 수신 라우터

**Files:**
- Create: `backend/routers/events.py`
- Create: `backend/tests/test_events_router.py`

- [ ] **Step 1: 테스트 작성**

```python
# backend/tests/test_events_router.py
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch
from routers.events import router
from auth import get_current_user

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "user-1"
client = TestClient(app)


def test_valid_event_returns_200():
    with patch("routers.events.execute") as mock_exec:
        resp = client.post("/api/events", json={"event_name": "nav_portfolio", "properties": {}})
    assert resp.status_code == 200
    assert mock_exec.called


def test_invalid_event_name_ignored():
    with patch("routers.events.execute") as mock_exec:
        resp = client.post("/api/events", json={"event_name": "unknown_event", "properties": {}})
    assert resp.status_code == 200
    assert not mock_exec.called


def test_event_with_properties_saved():
    with patch("routers.events.execute") as mock_exec:
        resp = client.post(
            "/api/events",
            json={"event_name": "report_view_open", "properties": {"ticker": "AAPL"}},
        )
    assert resp.status_code == 200
    call_args = mock_exec.call_args[0]
    assert "report_view_open" in call_args[1]
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_events_router.py -v
```

예상: `ImportError` (routers/events.py 없음)

- [ ] **Step 3: 라우터 구현**

```python
# backend/routers/events.py
import json
from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel
from auth import get_current_user
from services.db import execute

VALID_EVENTS = {
    "nav_portfolio", "nav_research", "nav_market", "nav_guru", "nav_settings",
    "tab_holdings", "tab_watch", "tab_analysis", "tab_dash",
    "tab_reports", "tab_digest", "tab_calendar",
    "report_view_open", "report_tab_switch",
    "stock_search",
}

router = APIRouter(prefix="/api/events", tags=["events"])


class EventBody(BaseModel):
    event_name: str
    properties: dict = {}


def _persist(user_id: str, event_name: str, properties: dict):
    try:
        execute(
            "INSERT INTO user_events (user_id, event_name, properties) VALUES (%s, %s, %s)",
            (user_id, event_name, json.dumps(properties)),
        )
    except Exception:
        pass


@router.post("")
def track_event(
    body: EventBody,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user),
):
    if body.event_name not in VALID_EVENTS:
        return {"ok": True}
    background_tasks.add_task(_persist, user_id, body.event_name, body.properties)
    return {"ok": True}
```

- [ ] **Step 4: 테스트 실행 — PASS 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_events_router.py -v
```

예상: 3개 테스트 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/routers/events.py backend/tests/test_events_router.py
git commit -m "feat: POST /api/events 이벤트 수신 라우터 추가"
```

---

## Task 3: Backend — Analytics 엔드포인트

**Files:**
- Modify: `backend/routers/admin.py`
- Modify: `backend/tests/test_admin_router.py`

- [ ] **Step 1: 테스트 작성 (test_admin_router.py 맨 끝에 추가)**

```python
# --- Analytics endpoints ---

SUMMARY_ROWS = [
    {"event_name": "nav_portfolio", "cnt": 5},
    {"event_name": "nav_research",  "cnt": 3},
]
DAU_ROWS = [{"dau": 2}]
TOTAL_ROWS = [{"total": 8}]

USERS_ROWS = [
    {"user_id": "user-1", "email": "a@test.com", "total_events": 8, "last_active": "2026-06-03T10:00:00+00:00"},
]

HISTORY_ROWS = [
    {"event_name": "nav_portfolio", "properties": {}, "created_at": "2026-06-03T10:00:00+00:00"},
]


def test_analytics_summary_returns_data():
    with patch("routers.admin.query", side_effect=[DAU_ROWS, TOTAL_ROWS, SUMMARY_ROWS]):
        resp = client.get("/api/admin/analytics/summary?days=7")
    assert resp.status_code == 200
    data = resp.json()
    assert "dau" in data
    assert "total_events" in data
    assert "top_events" in data


def test_analytics_events_timeline():
    timeline_rows = [{"date": "2026-06-03", "event_name": "nav_portfolio", "count": 3}]
    with patch("routers.admin.query", return_value=timeline_rows):
        resp = client.get("/api/admin/analytics/events?days=7")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_analytics_users_list():
    with patch("routers.admin.query", return_value=USERS_ROWS):
        resp = client.get("/api/admin/analytics/users")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["email"] == "a@test.com"


def test_analytics_user_history():
    with patch("routers.admin.query", return_value=HISTORY_ROWS):
        resp = client.get("/api/admin/analytics/users/user-1")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_admin_router.py -k "analytics" -v
```

예상: FAIL (엔드포인트 없음)

- [ ] **Step 3: admin.py에 analytics 엔드포인트 추가 (파일 맨 끝에 추가)**

```python
# --- Analytics (admin only) ---
from datetime import datetime, timedelta, timezone as _tz


def _cutoff(days: int):
    if days >= 9999:
        return datetime(2000, 1, 1, tzinfo=_tz.utc)
    return datetime.now(_tz.utc) - timedelta(days=days)


@router.get("/analytics/summary")
def analytics_summary(days: int = 7, admin_id: str = Depends(require_admin)):
    cut = _cutoff(days)
    dau_rows   = query(
        "SELECT COUNT(DISTINCT user_id) AS dau FROM user_events WHERE created_at >= %s",
        (cut,),
    )
    total_rows = query(
        "SELECT COUNT(*) AS total FROM user_events WHERE created_at >= %s",
        (cut,),
    )
    top_rows   = query(
        "SELECT event_name, COUNT(*) AS cnt FROM user_events "
        "WHERE created_at >= %s GROUP BY event_name ORDER BY cnt DESC LIMIT 10",
        (cut,),
    )
    return {
        "dau":          dau_rows[0]["dau"] if dau_rows else 0,
        "total_events": total_rows[0]["total"] if total_rows else 0,
        "top_events":   [{"name": r["event_name"], "count": r["cnt"]} for r in top_rows],
    }


@router.get("/analytics/events")
def analytics_events(days: int = 7, admin_id: str = Depends(require_admin)):
    cut = _cutoff(days)
    rows = query(
        "SELECT DATE(created_at) AS date, event_name, COUNT(*) AS count "
        "FROM user_events WHERE created_at >= %s "
        "GROUP BY DATE(created_at), event_name ORDER BY date DESC",
        (cut,),
    )
    return [{"date": str(r["date"]), "event_name": r["event_name"], "count": r["count"]} for r in rows]


@router.get("/analytics/users")
def analytics_users(admin_id: str = Depends(require_admin)):
    rows = query(
        "SELECT e.user_id, u.email, COUNT(*) AS total_events, MAX(e.created_at) AS last_active "
        "FROM user_events e JOIN users u ON u.id = e.user_id "
        "GROUP BY e.user_id, u.email ORDER BY total_events DESC"
    )
    return [
        {
            "user_id":      str(r["user_id"]),
            "email":        r["email"],
            "total_events": r["total_events"],
            "last_active":  r["last_active"].isoformat() if r["last_active"] else None,
        }
        for r in rows
    ]


@router.get("/analytics/users/{user_id}")
def analytics_user_history(user_id: str, limit: int = 200, admin_id: str = Depends(require_admin)):
    rows = query(
        "SELECT event_name, properties, created_at FROM user_events "
        "WHERE user_id = %s ORDER BY created_at DESC LIMIT %s",
        (user_id, limit),
    )
    return [
        {
            "event_name":  r["event_name"],
            "properties":  r["properties"],
            "created_at":  r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]
```

- [ ] **Step 4: 테스트 실행 — PASS 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_admin_router.py -k "analytics" -v
```

예상: 4개 테스트 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/routers/admin.py backend/tests/test_admin_router.py
git commit -m "feat: /api/admin/analytics/* 엔드포인트 4개 추가"
```

---

## Task 4: Backend — 미들웨어

**Files:**
- Create: `backend/middleware/__init__.py`
- Create: `backend/middleware/event_tracker.py`
- Create: `backend/tests/test_event_tracker.py`
- Modify: `backend/main.py`

- [ ] **Step 1: 테스트 작성**

```python
# backend/tests/test_event_tracker.py
import re
import pytest
from middleware.event_tracker import _match_route, _extract_user_id_from_header


def test_match_portfolio_post():
    result = _match_route("POST", "/api/portfolio")
    assert result is not None
    event_name, ticker_source, _ = result
    assert event_name == "stock_add"
    assert ticker_source == "body"


def test_match_portfolio_delete():
    result = _match_route("DELETE", "/api/portfolio/AAPL")
    assert result is not None
    event_name, ticker_source, m = result
    assert event_name == "stock_delete"
    assert m.group(1) == "AAPL"


def test_match_watchlist_promote():
    result = _match_route("POST", "/api/watchlist/TSLA/promote")
    assert result is not None
    event_name, ticker_source, m = result
    assert event_name == "stock_promote"
    assert m.group(1) == "TSLA"


def test_match_report_generate():
    result = _match_route("POST", "/api/report/generate/MSFT")
    assert result is not None
    event_name, ticker_source, m = result
    assert event_name == "report_generate"
    assert m.group(1) == "MSFT"


def test_match_guru_crawl():
    result = _match_route("POST", "/api/guru/crawl")
    assert result is not None
    event_name, _, _ = result
    assert event_name == "guru_crawl"


def test_no_match_for_get():
    assert _match_route("GET", "/api/portfolio") is None


def test_no_match_for_unknown_path():
    assert _match_route("POST", "/api/unknown/path") is None


def test_extract_user_id_valid(monkeypatch):
    import os
    from jose import jwt
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    token = jwt.encode({"sub": "user-1"}, "test-secret", algorithm="HS256")
    result = _extract_user_id_from_header(f"Bearer {token}")
    assert result == "user-1"


def test_extract_user_id_invalid():
    result = _extract_user_id_from_header("Bearer invalid-token")
    assert result is None


def test_extract_user_id_no_header():
    assert _extract_user_id_from_header("") is None
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_event_tracker.py -v
```

예상: `ImportError` (모듈 없음)

- [ ] **Step 3: middleware 패키지 생성**

```python
# backend/middleware/__init__.py
```
(빈 파일)

- [ ] **Step 4: 미들웨어 구현**

```python
# backend/middleware/event_tracker.py
import asyncio
import json
import os
import re

from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

_TRACKED = [
    ("POST",   re.compile(r"^/api/portfolio$"),                 "stock_add",       "body"),
    ("DELETE", re.compile(r"^/api/portfolio/([^/]+)$"),         "stock_delete",    "path:1"),
    ("POST",   re.compile(r"^/api/watchlist$"),                 "stock_add",       "body"),
    ("DELETE", re.compile(r"^/api/watchlist/([^/]+)$"),         "stock_delete",    "path:1"),
    ("POST",   re.compile(r"^/api/watchlist/([^/]+)/promote$"), "stock_promote",   "path:1"),
    ("POST",   re.compile(r"^/api/report/generate/([^/]+)$"),   "report_generate", "path:1"),
    ("POST",   re.compile(r"^/api/guru/crawl$"),                "guru_crawl",      None),
]


def _match_route(method: str, path: str):
    for req_method, pattern, event_name, ticker_source in _TRACKED:
        if method == req_method:
            m = pattern.match(path)
            if m:
                return event_name, ticker_source, m
    return None


def _extract_user_id_from_header(auth_header: str) -> str | None:
    if not auth_header.startswith("Bearer "):
        return None
    try:
        payload = jwt.decode(auth_header[7:], os.environ["JWT_SECRET"], algorithms=["HS256"])
        return payload.get("sub")
    except (JWTError, KeyError):
        return None


async def _save_event(user_id: str, event_name: str, properties: dict):
    from services.db import execute
    try:
        execute(
            "INSERT INTO user_events (user_id, event_name, properties) VALUES (%s, %s, %s)",
            (user_id, event_name, json.dumps(properties)),
        )
    except Exception:
        pass


class EventTrackerMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        matched = _match_route(request.method, request.url.path)

        cached_body = None
        if matched and matched[1] == "body":
            cached_body = await request.body()

        response = await call_next(request)

        if matched and 200 <= response.status_code < 300:
            event_name, ticker_source, m = matched
            user_id = _extract_user_id_from_header(request.headers.get("Authorization", ""))
            if user_id:
                props = {}
                if ticker_source == "body" and cached_body:
                    try:
                        props["ticker"] = json.loads(cached_body).get("ticker", "").upper()
                    except Exception:
                        pass
                elif ticker_source and ticker_source.startswith("path:"):
                    props["ticker"] = m.group(int(ticker_source[5:])).upper()
                props = {k: v for k, v in props.items() if v}
                asyncio.create_task(_save_event(user_id, event_name, props))

        return response
```

- [ ] **Step 5: 테스트 실행 — PASS 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_event_tracker.py -v
```

예상: 10개 테스트 모두 PASS

- [ ] **Step 6: main.py에 라우터 + 미들웨어 등록**

`backend/main.py`의 import 블록에 추가:
```python
from routers.events import router as events_router
from middleware.event_tracker import EventTrackerMiddleware
```

`app.add_middleware(SessionMiddleware, ...)` 라인 바로 아래에 추가:
```python
app.add_middleware(EventTrackerMiddleware)
```

`app.include_router(admin_router)` 라인 바로 위에 추가:
```python
app.include_router(events_router)
```

- [ ] **Step 7: 서버 기동 확인 (로컬)**

```bash
cd backend && .venv/bin/python -m uvicorn main:app --port 8000 --reload
```

예상: `Application startup complete.` (에러 없음)
확인 후 `Ctrl+C`.

- [ ] **Step 8: 커밋**

```bash
git add backend/middleware/__init__.py backend/middleware/event_tracker.py \
        backend/tests/test_event_tracker.py backend/main.py
git commit -m "feat: EventTrackerMiddleware — API 호출 이벤트 자동 수집"
```

---

## Task 5: Frontend — 이벤트 추적 유틸리티

**Files:**
- Create: `frontend/src/utils/analytics.js`

- [ ] **Step 1: 유틸리티 파일 생성**

```js
// frontend/src/utils/analytics.js
export function trackEvent(eventName, properties = {}) {
  fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ event_name: eventName, properties }),
  }).catch(() => {})
}
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/src/utils/analytics.js
git commit -m "feat: trackEvent 프론트엔드 이벤트 추적 유틸리티 추가"
```

---

## Task 6: Frontend — Nav 이벤트 추적

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/MobileNav.jsx`

- [ ] **Step 1: App.jsx — TopNav에 추적 추가**

`frontend/src/App.jsx` 상단 import에 추가:
```js
import { trackEvent } from './utils/analytics'
```

`TopNav` 컴포넌트 내 `const { menuPermissions, loading }` 라인을:
```js
const { menuPermissions, role, loading } = useAuth() || { menuPermissions: [], role: null, loading: true }
```

`const allItems = [...]` 블록 아래 `const navItems = ...` 라인을:
```js
const adminItem = role === 'admin' ? [{ to: '/admin-analytics', label: '애널리틱스', key: 'analytics' }] : []
const navItems = loading ? [] : [
  ...allItems.filter(item => menuPermissions.includes(item.key)),
  ...adminItem,
]
```

NavLink 렌더링 부분에서 `{ to, label, end }` → `{ to, label, end, key }` + onClick 추가:
```jsx
{navItems.map(({ to, label, end, key }) => (
  <NavLink key={to} to={to} end={end}
    onClick={() => trackEvent('nav_' + key)}
    className={({ isActive }) => 'topnav-tab' + (isActive ? ' is-active' : '')}>
    {label}
  </NavLink>
))}
```

Routes 블록에 admin-analytics 라우트 추가 (기존 `/dev/showcase` 라우트 위):
```jsx
<Route path="/admin-analytics" element={<AdminAnalytics />} />
```

import 블록에 `AdminAnalytics` 추가:
```js
import AdminAnalytics from './pages/AdminAnalytics'
```

- [ ] **Step 2: MobileNav.jsx — nav 이벤트 추적 추가**

`frontend/src/components/MobileNav.jsx` 상단에 추가:
```js
import { trackEvent } from '../utils/analytics'
```

NavLink 렌더링에서 `{ to, label, Icon, end }` → `{ to, label, Icon, end, key }` + onClick:
```jsx
{tabs.map(({ to, label, Icon, end, key }) => (
  <NavLink key={to} to={to} end={end}
    onClick={() => trackEvent('nav_' + key)}
    className={({ isActive }) => isActive ? 'is-active' : ''}>
    <Icon />
    <span>{label}</span>
  </NavLink>
))}
```

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/App.jsx frontend/src/components/MobileNav.jsx
git commit -m "feat: nav 탭 클릭 이벤트 추적 추가"
```

---

## Task 7: Frontend — Portfolio·Research 서브탭 추적

**Files:**
- Modify: `frontend/src/pages/Portfolio.jsx`
- Modify: `frontend/src/pages/Research.jsx`

- [ ] **Step 1: Portfolio.jsx — 서브탭 + 검색 이벤트**

`frontend/src/pages/Portfolio.jsx` 상단 import에 추가:
```js
import { trackEvent } from '../utils/analytics'
```

서브탭 버튼들 (`tab === 'holdings'` 등) 의 `onClick`에 추적 추가:

기존:
```jsx
<button className={tab === 'holdings' ? 'is-active' : ''} onClick={() => setTab('holdings')}>
```
변경:
```jsx
<button className={tab === 'holdings' ? 'is-active' : ''} onClick={() => { setTab('holdings'); trackEvent('tab_holdings') }}>
```

기존:
```jsx
<button className={tab === 'watch' ? 'is-active' : ''} onClick={() => setTab('watch')}>
```
변경:
```jsx
<button className={tab === 'watch' ? 'is-active' : ''} onClick={() => { setTab('watch'); trackEvent('tab_watch') }}>
```

기존:
```jsx
<button className={tab === 'dash' ? 'is-active' : ''} onClick={() => { setTab('dash'); fetchDashboard() }}>
```
변경:
```jsx
<button className={tab === 'dash' ? 'is-active' : ''} onClick={() => { setTab('dash'); fetchDashboard(); trackEvent('tab_dash') }}>
```

기존:
```jsx
<button className={tab === 'analysis' ? 'is-active' : ''} onClick={() => setTab('analysis')}>
```
변경:
```jsx
<button className={tab === 'analysis' ? 'is-active' : ''} onClick={() => { setTab('analysis'); trackEvent('tab_analysis') }}>
```

검색창(`m-list-search`)에 `onBlur` 추가:
```jsx
onBlur={e => { if (e.target.value.trim()) trackEvent('stock_search', { query: e.target.value.trim() }) }}
```

- [ ] **Step 2: Research.jsx — 서브탭 이벤트**

`frontend/src/pages/Research.jsx` 상단 import에 추가:
```js
import { trackEvent } from '../utils/analytics'
```

Research.jsx의 탭 버튼 3개 onClick에 추적 추가:

기존:
```jsx
<button className={tab === 'reports' ? 'is-active' : ''} onClick={() => setTab('reports')}>리포트</button>
<button className={tab === 'digest' ? 'is-active' : ''} onClick={() => setTab('digest')}>다이제스트</button>
<button className={tab === 'calendar' ? 'is-active' : ''} onClick={() => setTab('calendar')}>캘린더</button>
```
변경:
```jsx
<button className={tab === 'reports' ? 'is-active' : ''} onClick={() => { setTab('reports'); trackEvent('tab_reports') }}>리포트</button>
<button className={tab === 'digest' ? 'is-active' : ''} onClick={() => { setTab('digest'); trackEvent('tab_digest') }}>다이제스트</button>
<button className={tab === 'calendar' ? 'is-active' : ''} onClick={() => { setTab('calendar'); trackEvent('tab_calendar') }}>캘린더</button>
```

Research.jsx는 두 개의 탭 렌더 블록이 있음(데스크탑/모바일). 두 블록 모두 동일하게 수정.

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/pages/Portfolio.jsx frontend/src/pages/Research.jsx
git commit -m "feat: Portfolio·Research 서브탭 + 검색 이벤트 추적 추가"
```

---

## Task 8: Frontend — 리포트 뷰/탭 이벤트 추적

**Files:**
- Modify: `frontend/src/pages/Reports.jsx`

- [ ] **Step 1: Reports.jsx — 이벤트 추적 추가**

`frontend/src/pages/Reports.jsx` 상단 import에 추가:
```js
import { trackEvent } from '../utils/analytics'
```

리포트 상세 오픈 함수(line ~87) 찾기:
```js
setSelected({ ticker, date })
setView('detail')
```

`setView('detail')` 바로 아래에 추가:
```js
trackEvent('report_view_open', { ticker })
```

결과 (두 줄):
```js
setSelected({ ticker, date })
setView('detail')
trackEvent('report_view_open', { ticker })
setActiveDetailTab('summary')
```

상세 탭 전환 버튼(line ~727):
```jsx
onClick={() => setActiveDetailTab(key)}
```
변경:
```jsx
onClick={() => { setActiveDetailTab(key); trackEvent('report_tab_switch', { tab: key }) }}
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/src/pages/Reports.jsx
git commit -m "feat: 리포트 뷰 오픈·탭 전환 이벤트 추적 추가"
```

---

## Task 9: Frontend — AdminAnalytics 페이지

**Files:**
- Create: `frontend/src/pages/AdminAnalytics.jsx`

- [ ] **Step 1: AdminAnalytics 페이지 구현**

```jsx
// frontend/src/pages/AdminAnalytics.jsx
import { useState, useEffect } from 'react'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

const DAYS_OPTIONS = [
  { label: '7일', value: 7 },
  { label: '30일', value: 30 },
  { label: '전체', value: 9999 },
]

export default function AdminAnalytics() {
  const [days, setDays] = useState(7)
  const [summary, setSummary] = useState(null)
  const [users, setUsers] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [histLoading, setHistLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get(`/api/admin/analytics/summary?days=${days}`),
      api.get('/api/admin/analytics/users'),
    ]).then(([s, u]) => {
      setSummary(s.data)
      setUsers(u.data)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [days])

  const showUserHistory = (userId) => {
    setSelectedUser(userId)
    setHistLoading(true)
    api.get(`/api/admin/analytics/users/${userId}`)
      .then(r => setHistory(r.data))
      .catch(() => setHistory([]))
      .finally(() => setHistLoading(false))
  }

  if (loading) return <LoadingSpinner label="로딩 중..." />

  return (
    <div style={{ padding: '24px 16px', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ color: 'var(--text)', margin: 0 }}>사용자 Analytics</h2>
        <div className="tabs">
          {DAYS_OPTIONS.map(o => (
            <button key={o.value}
              className={days === o.value ? 'is-active' : ''}
              onClick={() => setDays(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 32 }}>
          {[
            { label: '오늘 DAU',       value: summary.dau },
            { label: `${days}일 총 이벤트`, value: summary.total_events },
            { label: 'Top 기능',        value: summary.top_events[0]?.name ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px' }}>
              <div style={{ color: 'var(--text-3)', fontSize: 11, marginBottom: 4 }}>{label}</div>
              <div style={{ color: 'var(--text)', fontSize: 22, fontWeight: 700 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Top Events Bar Chart */}
      {summary?.top_events?.length > 0 && (
        <div style={{ marginBottom: 40 }}>
          <h3 style={{ color: 'var(--text)', marginBottom: 12, fontSize: 14 }}>기능별 사용 랭킹 (상위 10개)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={summary.top_events} margin={{ top: 0, right: 0, bottom: 40, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-3)', fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
              <YAxis tick={{ fill: 'var(--text-3)', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }} />
              <Bar dataKey="count" fill="var(--accent)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Users Table */}
      {selectedUser ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <button onClick={() => setSelectedUser(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', color: 'var(--text-3)', fontSize: 12 }}>← 목록</button>
            <h3 style={{ color: 'var(--text)', margin: 0, fontSize: 14 }}>이벤트 히스토리 (최근 200건)</h3>
          </div>
          {histLoading ? <LoadingSpinner label="로딩 중..." /> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['이벤트', 'properties', '시각'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-3)', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px', color: 'var(--text)', fontFamily: 'monospace' }}>{row.event_name}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-3)', fontFamily: 'monospace' }}>{JSON.stringify(row.properties)}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-3)' }}>{row.created_at ? new Date(row.created_at).toLocaleString('ko-KR') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div>
          <h3 style={{ color: 'var(--text)', marginBottom: 12, fontSize: 14 }}>사용자별 통계</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['이메일', '총 이벤트', '마지막 활동', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-3)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.user_id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px', color: 'var(--text)' }}>{u.email}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--text)' }}>{u.total_events}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--text-3)' }}>{u.last_active ? new Date(u.last_active).toLocaleDateString('ko-KR') : '—'}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <button onClick={() => showUserHistory(u.user_id)}
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', color: 'var(--text-3)', fontSize: 11 }}>
                      상세
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>데이터 없음</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/src/pages/AdminAnalytics.jsx
git commit -m "feat: AdminAnalytics 페이지 추가 (admin 전용)"
```

---

## Task 10: 통합 검증

- [ ] **Step 1: 전체 백엔드 테스트 실행**

```bash
cd backend && .venv/bin/python -m pytest tests/ -v --tb=short
```

예상: 기존 테스트 포함 전체 PASS (새 테스트 포함)

- [ ] **Step 2: 로컬 서버 기동 후 수동 검증**

```bash
# 백엔드
cd backend && .venv/bin/python -m uvicorn main:app --port 8000 --reload
# 프론트엔드 (별도 터미널)
cd frontend && npm run dev
```

확인 항목:
1. admin 계정으로 로그인 → nav에 "애널리틱스" 탭 표시 확인
2. 탭 이동 → 브라우저 네트워크 탭에서 `POST /api/events` 호출 확인
3. 리포트 탭 → 종목 클릭 → `report_view_open` 이벤트 발생 확인
4. 종목 추가 → `/api/portfolio` POST → 미들웨어가 `stock_add` 저장 확인
5. `/admin-analytics` 접근 → 요약 카드 + 차트 + 사용자 테이블 렌더링 확인
6. 사용자 "상세" 버튼 → 이벤트 히스토리 표시 확인

- [ ] **Step 3: user 계정으로 로그인 — "애널리틱스" 탭 미표시 확인**

- [ ] **Step 4: 최종 커밋 (변경사항 없으면 생략)**

```bash
git status
```

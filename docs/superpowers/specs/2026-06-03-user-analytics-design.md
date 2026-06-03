# 사용자 행동 Analytics 기능 설계

**날짜:** 2026-06-03  
**상태:** 승인됨

---

## 개요

사용자가 어떤 메뉴·기능을 얼마나 사용하는지 수집하고, admin이 모니터링할 수 있는 Analytics 페이지를 추가한다.

---

## 수집 범위

페이지 방문 + 주요 액션 (넓은 범위). 전체 이벤트 스트림은 아니며, 의미 있는 행동만 명시적으로 추적한다.

### 이벤트 목록

| event_name | 수집 방식 | properties |
|------------|-----------|------------|
| `nav_portfolio` | 프론트 | — |
| `nav_research` | 프론트 | — |
| `nav_market` | 프론트 | — |
| `nav_guru` | 프론트 | — |
| `nav_settings` | 프론트 | — |
| `tab_holdings` | 프론트 | — |
| `tab_watchlist` | 프론트 | — |
| `tab_analysis` | 프론트 | — |
| `tab_reports` | 프론트 | — |
| `tab_calendar` | 프론트 | — |
| `tab_digest` | 프론트 | — |
| `stock_modal_open` | 프론트 | `{ticker}` |
| `report_tab_switch` | 프론트 | `{tab}` |
| `stock_search` | 프론트 | `{query}` |
| `stock_add` | 백엔드 미들웨어 | `{ticker}` |
| `stock_delete` | 백엔드 미들웨어 | `{ticker}` |
| `stock_promote` | 백엔드 미들웨어 | `{ticker}` |
| `report_generate` | 백엔드 미들웨어 | `{ticker}` |
| `guru_crawl` | 백엔드 미들웨어 | — |

---

## DB 스키마

```sql
CREATE TABLE user_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  event_name  text NOT NULL,
  properties  jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_user_events_user_id    ON user_events(user_id);
CREATE INDEX idx_user_events_created_at ON user_events(created_at DESC);
CREATE INDEX idx_user_events_name       ON user_events(event_name);
```

`app_schema.sql`에 추가하고, 기존 Docker 컨테이너에는 수동 마이그레이션 스크립트로 적용한다.

---

## 백엔드

### 1. FastAPI 미들웨어 (`backend/middleware/event_tracker.py`)

요청 완료 후 `asyncio.create_task`로 비동기 fire-and-forget 저장. 응답 속도에 영향 없음.

추적 라우트 매핑:
```
POST   /api/stocks             → stock_add      body에서 ticker 추출
DELETE /api/stocks/{ticker}    → stock_delete   path에서 ticker 추출
POST   /api/stocks/*/promote   → stock_promote  path에서 ticker 추출
POST   /api/report/generate    → report_generate body에서 ticker 추출
POST   /api/guru/crawl         → guru_crawl     —
```

인증 없는 요청(user_id 없음)은 기록하지 않는다.

`backend/main.py`에 미들웨어 등록.

### 2. 이벤트 수신 엔드포인트 (`backend/routers/events.py`)

```
POST /api/events
인증: require_auth (admin 불필요)
Body: { event_name: str, properties: dict }
응답: 200 OK (즉시 반환, 저장은 백그라운드)
```

알 수 없는 event_name은 저장하지 않는다 (화이트리스트 검증).

### 3. Analytics API (`backend/routers/admin.py`에 추가)

모든 엔드포인트는 `require_admin`.

```
GET /api/admin/analytics/summary?days=7
  응답: { dau: int, total_events: int, top_events: [{name, count}] }

GET /api/admin/analytics/events?days=7
  응답: [{ date, event_name, count }]  (일별 이벤트별 집계, 차트용)

GET /api/admin/analytics/users
  응답: [{ user_id, email, total_events, last_active }]

GET /api/admin/analytics/users/{user_id}?limit=200
  응답: [{ event_name, properties, created_at }]
```

---

## 프론트엔드

### 추적 유틸리티 (`frontend/src/utils/analytics.js`)

```js
export function trackEvent(eventName, properties = {}) {
  fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ event_name: eventName, properties }),
  }).catch(() => {})
}
```

로그인 전 호출은 백엔드에서 인증 오류 → 무시.

### 추적 추가 위치

| 파일 | 이벤트 |
|------|--------|
| nav 컴포넌트 (탭 클릭 핸들러) | `nav_*` 5종 |
| `Portfolio.jsx` (서브탭 클릭) | `tab_holdings` `tab_watchlist` `tab_analysis` |
| `Research.jsx` (서브탭 클릭) | `tab_reports` `tab_calendar` `tab_digest` |
| `StockModal.jsx` (오픈 시 useEffect/onOpen) | `stock_modal_open` `{ticker}` |
| `reports/DetailTab.jsx` (탭 전환) | `report_tab_switch` `{tab}` |
| `Portfolio.jsx` (검색 blur/enter) | `stock_search` `{query}` |

### Analytics 페이지 (`frontend/src/pages/AdminAnalytics.jsx`)

admin 전용. nav에 "Analytics" 항목 추가 (admin role 시에만 노출).

**레이아웃:**

```
[ 기간 필터: 7일 / 30일 / 전체 ]

[ DAU ]  [ 오늘 이벤트 ]  [ 7일 총 이벤트 ]  [ Top 기능 ]

[ 기능별 사용 랭킹 — BarChart (recharts), 상위 10개 이벤트 ]

[ 사용자 테이블: 이메일 | 총 이벤트 | 마지막 활동 | 상세 보기 ]
  └→ 상세: 해당 사용자 이벤트 히스토리 테이블 (최근 200건)
```

차트는 기존 프로젝트의 recharts를 재사용.

---

## 마이그레이션

기존 Docker 컨테이너에 테이블이 없으므로, 별도 SQL 파일(`backend/migrations/001_user_events.sql`)을 제공하고 README에 적용 방법을 명시한다.

---

## 범위 외

- 세션 트래킹 (session_id 없음)
- 이벤트 보존 기간/자동 삭제 정책
- 실시간 스트리밍 대시보드
- Market Hub 서브탭 추적

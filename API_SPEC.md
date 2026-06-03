# PortfoliOn API 명세서

> **Base URL:** `http://localhost:8000`  
> **Content-Type:** `application/json`  
> **CORS 허용 Origin:** `http://localhost:3000`, `http://localhost:5173`

---

## 목차

- [Health](#health)
- [Auth (인증)](#auth-인증)
- [Admin (관리자)](#admin-관리자)
- [Portfolio (보유종목)](#portfolio-보유종목)
- [Watchlist (관심종목)](#watchlist-관심종목)
- [Stocks (종목 정보)](#stocks-종목-정보)
- [Report (리포트)](#report-리포트)
- [Consensus (컨센서스)](#consensus-컨센서스)
- [Schedule (자동 스케줄)](#schedule-자동-스케줄)
- [Calendar (이벤트 캘린더)](#calendar-이벤트-캘린더)
- [Digest (일일 다이제스트)](#digest-일일-다이제스트)
- [Market (시장 지표)](#market-시장-지표)
- [Guru (구루 분석)](#guru-구루-분석)
- [Analytics (분석)](#analytics-분석)
- [Analysis (포트폴리오 분석)](#analysis-포트폴리오-분석)
- [공통 스키마](#공통-스키마)
- [공통 에러 응답](#공통-에러-응답)

---

## Health

### `GET /health`

서버 상태 확인.

**Response `200`**
```json
{ "status": "ok" }
```

---

## Auth (인증)

> **Prefix:** `/api/auth`

### `POST /api/auth/register`

이메일/비밀번호로 신규 회원가입.

**Request Body**
```json
{
  "email": "user@example.com",
  "password": "secret"
}
```

**Response `201`**
```json
{ "message": "registered" }
```

**Error `400`** — 이미 존재하는 이메일

---

### `POST /api/auth/login`

이메일/비밀번호 로그인.

**Request Body**
```json
{
  "email": "user@example.com",
  "password": "secret"
}
```

**Response `200`**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ..."
}
```

**Error `401`** — 잘못된 이메일/비밀번호

---

### `POST /api/auth/refresh`

Access token 갱신.

**Request Body**
```json
{ "refresh_token": "eyJ..." }
```

**Response `200`**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ..."
}
```

**Error `401`** — 유효하지 않거나 만료된 refresh token

---

### `POST /api/auth/logout`

로그아웃 (refresh token 무효화).

**Request Body**
```json
{ "refresh_token": "eyJ..." }
```

**Response `200`**
```json
{ "message": "logged out" }
```

---

### `GET /api/auth/me`

현재 로그인 사용자 정보 조회.

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "user_id": "uuid",
  "email": "user@example.com",
  "role": "user",
  "menu_permissions": ["portfolio", "research", "market"]
}
```

**Error `401`** — 인증 필요

---

### `GET /api/auth/oauth/google`

Google OAuth 로그인 시작. Google 로그인 페이지로 리다이렉트.

---

### `GET /api/auth/oauth/google/callback`

Google OAuth 콜백. 처리 후 `?access_token=...&refresh_token=...` 쿼리 파라미터와 함께 프론트엔드로 리다이렉트.

---

### `GET /api/auth/oauth/github`

GitHub OAuth 로그인 시작. GitHub 로그인 페이지로 리다이렉트.

---

### `GET /api/auth/oauth/github/callback`

GitHub OAuth 콜백. 처리 후 `?access_token=...&refresh_token=...` 쿼리 파라미터와 함께 프론트엔드로 리다이렉트.

---

## Admin (관리자)

> **Prefix:** `/api/admin`  
> **Auth:** 모든 엔드포인트에 admin role 필요

허용 메뉴 목록: `portfolio`, `research`, `market`, `analysis`, `guru`, `settings`

### `GET /api/admin/users`

전체 사용자 목록 및 권한 조회.

**Response `200`**
```json
[
  {
    "id": "uuid",
    "email": "user@example.com",
    "role": "user",
    "permissions": {
      "portfolio": true,
      "research": false,
      "market": true,
      "analysis": false,
      "guru": false,
      "settings": false
    }
  }
]
```

---

### `PUT /api/admin/users/{user_id}/permissions`

특정 사용자의 메뉴 권한 수정.

**Path Parameter:** `user_id` — 사용자 UUID

**Request Body**
```json
{
  "permissions": {
    "portfolio": true,
    "research": true,
    "market": true,
    "analysis": false,
    "guru": false,
    "settings": false
  }
}
```

**Response `200`**
```json
{ "ok": true }
```

---

### `POST /api/admin/users/bulk-permissions`

여러 사용자의 권한 일괄 수정.

**Request Body**
```json
{
  "user_ids": ["uuid1", "uuid2"],
  "permissions": {
    "portfolio": true,
    "research": true
  }
}
```

**Response `200`**
```json
{ "ok": true, "updated": 2 }
```

---

## Portfolio (보유종목)

### `GET /api/portfolio`

전체 포트폴리오 조회. 보유종목(`stocks`)과 관심종목(`watchlist`) 모두 반환.

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "stocks": [
    {
      "ticker": "AAPL",
      "name": "Apple Inc.",
      "quantity": 10,
      "avg_cost": 150.0,
      "competitors": ["MSFT", "GOOGL"],
      "moat": "생태계 락인, 브랜드",
      "growth_plan": "서비스 매출 확대",
      "risks": "규제 리스크, 중국 매출 의존도",
      "recent_disclosures": "2024Q4 실적 발표..."
    }
  ],
  "watchlist": [
    {
      "ticker": "TSLA",
      "name": "Tesla Inc.",
      "competitors": [],
      "moat": "",
      "growth_plan": "",
      "risks": "",
      "recent_disclosures": ""
    }
  ]
}
```

---

### `POST /api/portfolio`

보유종목 추가.

**Auth:** Bearer token 필요

**Request Body**
```json
{
  "ticker": "AAPL",
  "name": "Apple Inc.",
  "quantity": 10,
  "avg_cost": 150.0,
  "competitors": ["MSFT", "GOOGL"],
  "moat": "생태계 락인",
  "growth_plan": "서비스 매출 확대"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `ticker` | string | ✅ | 종목 코드 (자동 대문자 변환) |
| `name` | string | ✅ | 종목명 |
| `quantity` | float | ✅ | 보유 수량 |
| `avg_cost` | float | ✅ | 평균 매입 단가 |
| `competitors` | string[] | ❌ | 경쟁사 티커 목록 (기본값: `[]`) |
| `moat` | string | ❌ | 경제적 해자 설명 (기본값: `""`) |
| `growth_plan` | string | ❌ | 성장 계획 메모 (기본값: `""`) |

**Response `201`**
```json
{
  "ticker": "AAPL",
  "quantity": 10,
  "avg_cost": 150.0,
  "name": "Apple Inc.",
  "competitors": ["MSFT", "GOOGL"],
  "moat": "생태계 락인",
  "growth_plan": "서비스 매출 확대"
}
```

**Error `400`** — 이미 보유 중인 ticker

---

### `PUT /api/portfolio/{ticker}`

보유종목 수정.

**Auth:** Bearer token 필요

**Path Parameter:** `ticker` — 종목 코드

**Request Body** — `POST /api/portfolio`와 동일한 스키마

**Response `200`** — 수정된 종목 객체

**Error `404`** — ticker 없음

---

### `DELETE /api/portfolio/{ticker}`

보유종목 삭제. 삭제 후 해당 종목이 관심종목에 없으면 자동으로 관심종목으로 이동.

**Auth:** Bearer token 필요

**Path Parameter:** `ticker` — 종목 코드

**Response `200`**
```json
{ "moved_to_watchlist": "AAPL" }
```

**Error `404`** — ticker 없음

---

## Watchlist (관심종목)

### `GET /api/watchlist`

관심종목 목록 조회.

**Auth:** Bearer token 필요

**Response `200`**
```json
[
  {
    "ticker": "TSLA",
    "name": "Tesla Inc.",
    "competitors": [],
    "moat": "",
    "growth_plan": ""
  }
]
```

---

### `POST /api/watchlist`

관심종목 추가.

**Auth:** Bearer token 필요

**Request Body**
```json
{
  "ticker": "TSLA",
  "name": "Tesla Inc.",
  "competitors": [],
  "moat": "",
  "growth_plan": ""
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `ticker` | string | ✅ | 종목 코드 |
| `name` | string | ✅ | 종목명 |
| `competitors` | string[] | ❌ | 경쟁사 티커 목록 |
| `moat` | string | ❌ | 경제적 해자 |
| `growth_plan` | string | ❌ | 성장 계획 |

**Response `201`** — 추가된 종목 객체

**Error `400`** — 이미 보유종목 또는 관심종목에 존재

---

### `PUT /api/watchlist/{ticker}`

관심종목 정보 수정.

**Auth:** Bearer token 필요

**Path Parameter:** `ticker` — 종목 코드

**Request Body** — `POST /api/watchlist`와 동일한 스키마

**Response `200`** — 수정된 종목 객체

**Error `404`** — watchlist에 없는 ticker

---

### `DELETE /api/watchlist/{ticker}`

관심종목 삭제.

**Auth:** Bearer token 필요

**Path Parameter:** `ticker` — 종목 코드

**Response `200`**
```json
{ "deleted": "TSLA" }
```

**Error `404`** — watchlist에 없는 ticker

---

### `POST /api/watchlist/{ticker}/promote`

관심종목 → 보유종목으로 승격.

**Auth:** Bearer token 필요

**Path Parameter:** `ticker` — 종목 코드

**Request Body**
```json
{
  "quantity": 5,
  "avg_cost": 200.0
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `quantity` | float | ✅ | 매입 수량 (0 초과) |
| `avg_cost` | float | ✅ | 평균 매입 단가 (0 초과) |

**Response `200`**
```json
{
  "ticker": "TSLA",
  "name": "Tesla Inc.",
  "competitors": [],
  "moat": "",
  "growth_plan": "",
  "quantity": 5,
  "avg_cost": 200.0
}
```

**Error `404`** — watchlist에 없는 ticker  
**Error `400`** — 이미 보유종목에 존재

---

## Stocks (종목 정보)

### `GET /api/stocks`

보유종목 + 관심종목 전체 목록 (ticker, name, type만 반환).

**Auth:** Bearer token 필요

**Response `200`**
```json
[
  { "ticker": "AAPL", "name": "Apple Inc.", "type": "holding" },
  { "ticker": "TSLA", "name": "Tesla Inc.", "type": "watchlist" }
]
```

| `type` 값 | 설명 |
|-----------|------|
| `"holding"` | 보유종목 |
| `"watchlist"` | 관심종목 |

---

### `PUT /api/stocks/{ticker}/enrich`

단일 종목의 분석 정보 업데이트. 제공된 필드만 덮어씀.

**Auth:** Bearer token 필요

**Path Parameter:** `ticker` — 종목 코드

**Request Body**
```json
{
  "moat": "브랜드 파워, 네트워크 효과",
  "growth_plan": "AI 서비스 확대",
  "risks": "규제 리스크, 경쟁 심화, 매크로 불확실성",
  "recent_disclosures": "2024-11-01: 4분기 실적 가이던스 상향...",
  "competitors": ["MSFT", "GOOGL"]
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `moat` | string | ❌ | 경제적 해자 |
| `growth_plan` | string | ❌ | 성장 계획 |
| `risks` | string | ❌ | 리스크 요인 |
| `recent_disclosures` | string | ❌ | 최근 공시/뉴스 요약 |
| `competitors` | string[] | ❌ | 경쟁사 티커 목록 |

> 최소 1개 이상의 필드를 포함해야 함.

**Response `200`**
```json
{
  "ticker": "AAPL",
  "updated": ["moat", "growth_plan", "recent_disclosures"]
}
```

**Error `400`** — 업데이트할 필드 없음  
**Error `404`** — 보유종목 또는 관심종목에 없는 ticker

---

### `PUT /api/stocks/enrich/batch`

여러 종목 분석 정보 일괄 업데이트.

> ⚠️ **주의:** 이 엔드포인트는 `PUT /api/stocks/{ticker}/enrich`보다 먼저 라우팅됩니다. `{ticker}` 자리에 `enrich`를 사용하지 마세요.

**Auth:** Bearer token 필요

**Request Body**
```json
[
  {
    "ticker": "AAPL",
    "moat": "생태계 락인",
    "growth_plan": "서비스 매출 확대",
    "risks": "규제 리스크, 중국 매출 의존도",
    "recent_disclosures": "4분기 실적 발표",
    "competitors": ["MSFT"]
  },
  {
    "ticker": "TSLA",
    "moat": "전기차 선도 브랜드",
    "growth_plan": "에너지 사업 확대",
    "risks": "경쟁 심화, 수요 둔화"
  }
]
```

각 항목은 `ticker` (필수) + `PUT /api/stocks/{ticker}/enrich` Request Body와 동일한 선택 필드.

**Response `200`**
```json
{
  "updated": ["AAPL", "TSLA"],
  "not_found": ["NVDA"]
}
```

---

### `GET /api/stocks/search`

종목 검색 (한글 → Naver, 영문 → yfinance).

**Query Parameters**

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `q` | string | ✅ | 검색어 (최소 1자) |
| `market` | string | ❌ | `"KR"` \| `"US"` \| `"ALL"` (기본값: `"ALL"`) |

**Response `200`**
```json
[
  {
    "ticker": "005930",
    "name": "삼성전자",
    "market": "KR",
    "exchange": "KS",
    "exchange_display": "KSE"
  },
  {
    "ticker": "AAPL",
    "name": "Apple Inc.",
    "market": "US",
    "exchange": "",
    "exchange_display": "NasdaqGS"
  }
]
```

---

### `GET /api/stocks/dashboard`

보유종목 대시보드 카드 목록 (현재가, 수익률, RSI, 컨센서스). TTL 300s 캐시.

**Auth:** Bearer token 필요

**Response `200`**
```json
[
  {
    "ticker": "AAPL",
    "name": "Apple Inc.",
    "market": "US",
    "avg_cost": 150.0,
    "quantity": 10,
    "current_price": 175.5,
    "daily_change_pct": 1.2,
    "weekly_change_pct": 3.4,
    "monthly_change_pct": 8.1,
    "rsi": 62.3,
    "target_mean": 210.0,
    "buy": 15,
    "hold": 8,
    "sell": 2,
    "snapshot_date": "2026-05-20",
    "sector": "Technology"
  }
]
```

보유종목이 없으면 빈 배열 `[]` 반환.

---

### `DELETE /api/stocks/dashboard/cache`

대시보드 인메모리 캐시 강제 초기화.

**Response `200`**
```json
{ "cleared": true }
```

---

## Report (리포트)

### `GET /api/report/progress`

리포트 생성 진행 상황 조회. 생성 중일 때 폴링용으로 사용.

**Response `200`**
```json
{
  "running": true,
  "done": 2,
  "total": 5,
  "current": "AAPL"
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `running` | boolean | 생성 진행 중 여부 |
| `done` | integer | 완료된 종목 수 |
| `total` | integer | 전체 대상 종목 수 |
| `current` | string | 현재 처리 중인 ticker (완료 시 `""`) |

---

### `GET /api/report/backfill/progress`

리포트 백필 진행 상황 조회.

**Response `200`**
```json
{
  "running": true,
  "done": 10,
  "total": 60,
  "current": "AAPL (2026-03-15)"
}
```

---

### `POST /api/report/backfill`

과거 `days`일치 리포트 일괄 생성 (비동기, admin 전용).

**Auth:** admin role 필요

**Query Parameters**

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `days` | integer | ❌ | 백필 일수 (기본값: `60`) |

**Response `202`**
```json
{ "message": "Backfill started for 60 days" }
```

---

### `POST /api/report/generate`

전체 포트폴리오 + 관심종목 리포트 생성 (비동기, admin 전용).

**Auth:** admin role 필요

**Response `202`**
```json
{ "message": "Generating reports for 5 stock(s)" }
```

**Error `400`** — 포트폴리오와 관심종목 모두 비어있을 때

---

### `POST /api/report/generate/{ticker}`

특정 종목 리포트 생성 (비동기).

**Auth:** Bearer token 필요

**Path Parameter:** `ticker` — 종목 코드

**Response `202`**
```json
{ "message": "Generating report for AAPL" }
```

**Error `404`** — 포트폴리오 또는 관심종목에 없는 ticker

---

### `GET /api/report/list`

생성된 리포트 목록 조회.

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "AAPL": {
    "dates": ["2024-11-15", "2024-11-01"],
    "category": "holdings",
    "summary": {
      "score": 85,
      "recommendation": "매수",
      "one_liner": "AI 수혜 + 서비스 성장 지속"
    }
  },
  "TSLA": {
    "dates": ["2024-11-10"],
    "category": "watchlist",
    "summary": null
  }
}
```

| `category` 값 | 설명 |
|---------------|------|
| `"holdings"` | 보유종목 |
| `"watchlist"` | 관심종목 |
| `"other"` | 포트폴리오에서 제거된 종목 |

---

### `GET /api/report/{ticker}/history`

종목의 가격·애널리스트 데이터 히스토리 조회. 차트 표시용.

**Path Parameter:** `ticker` — 종목 코드

**Response `200`**
```json
[
  {
    "date": "2026-05-20",
    "price": 175.5,
    "target_mean": 210.0,
    "target_high": 240.0,
    "target_low": 180.0,
    "buy": 15,
    "hold": 8,
    "sell": 2,
    "rsi_daily": 62.3,
    "rsi_weekly": 58.1,
    "rsi_monthly": 55.0
  }
]
```

---

### `GET /api/report/{ticker}/{date_str}`

특정 날짜의 리포트 내용 조회.

**Path Parameters**
- `ticker` — 종목 코드
- `date_str` — 날짜 문자열 (예: `2024-11-15`, `GET /api/report/list`의 `dates` 배열 값)

**Response `200`**
```json
{
  "ticker": "AAPL",
  "date": "2024-11-15",
  "content": "# AAPL 분석 리포트\n\n...",
  "summary": {
    "score": 85,
    "recommendation": "매수",
    "one_liner": "AI 수혜 + 서비스 성장 지속"
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `content` | string | Markdown 형식의 리포트 본문 |
| `summary` | object \| null | 요약 JSON (없으면 `null`) |

**Error `404`** — 해당 날짜의 리포트 없음

---

### `POST /api/report/{ticker}/refresh-analyst`

특정 종목의 최신 애널리스트 데이터를 yfinance에서 즉시 갱신.

**Path Parameter:** `ticker` — 종목 코드

**Response `200`**
```json
{
  "target_mean": 210.0,
  "target_high": 240.0,
  "target_low": 180.0,
  "buy": 15,
  "hold": 8,
  "sell": 2,
  "price": 175.5,
  "drop_from_high_20d": -3.2
}
```

---

## Consensus (컨센서스)

### `GET /api/consensus/batch/progress`

컨센서스 일괄 수집 진행 상황 조회.

**Response `200`**
```json
{
  "running": true,
  "done": 3,
  "total": 10,
  "current": "AAPL"
}
```

---

### `POST /api/consensus/batch`

전체 포트폴리오·관심종목 컨센서스 일괄 수집 (비동기).

**Auth:** Bearer token 필요

**Response `202`**
```json
{ "message": "Consensus batch started for 10 tickers" }
```

---

### `GET /api/consensus/{ticker}`

특정 종목의 컨센서스 히스토리 조회.

**Path Parameter:** `ticker` — 종목 코드

**Response `200`**
```json
[
  {
    "date": "2026-05-20",
    "target_mean": 210.0,
    "target_high": 240.0,
    "target_low": 180.0,
    "buy": 15,
    "hold": 8,
    "sell": 2
  }
]
```

---

### `POST /api/consensus/{ticker}`

특정 종목의 최신 컨센서스 수집 (동기).

**Path Parameter:** `ticker` — 종목 코드

**Response `200`** — 수집된 컨센서스 항목

---

### `POST /api/consensus/{ticker}/backfill`

특정 종목의 컨센서스 데이터 백필 (snapshot DB 기반).

**Path Parameter:** `ticker` — 종목 코드

**Response `200`**
```json
{
  "added": 12,
  "entries": [...]
}
```

---

## Schedule (자동 스케줄)

### `GET /api/schedule`

리포트 자동 생성 스케줄 조회.

**Response `200`**
```json
{
  "enabled": true,
  "time": "08:00",
  "days": ["mon", "tue", "wed", "thu", "fri"]
}
```

---

### `PUT /api/schedule`

리포트 자동 생성 스케줄 업데이트.

**Request Body**
```json
{
  "enabled": true,
  "time": "08:00",
  "days": ["mon", "tue", "wed", "thu", "fri"]
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `enabled` | boolean | ✅ | 스케줄 활성화 여부 |
| `time` | string | ✅ | 실행 시간 (`"HH:MM"` 형식) |
| `days` | string[] | ✅ | 실행 요일 목록 |

**`days` 허용 값:** `"mon"`, `"tue"`, `"wed"`, `"thu"`, `"fri"`, `"sat"`, `"sun"`

**Response `200`** — 저장된 스케줄 객체 그대로 반환

**Error `400`** — `enabled`, `time`, `days` 중 하나라도 누락 시

---

## Calendar (이벤트 캘린더)

### `GET /api/calendar`

보유종목·관심종목의 실적 발표일·배당락일 조회. 데이터는 yfinance에서 수집하며 DB(`calendar_cache`)에 캐싱.

**Auth:** Bearer token 필요

**Query Parameter**

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `month` | string | ✅ | 조회할 월 (`YYYY-MM` 형식, 예: `2026-05`) |

**Response `200`**
```json
{
  "events": [
    {
      "date": "2026-05-20",
      "ticker": "AAPL",
      "name": "애플",
      "type": "earnings",
      "stock_type": "holding"
    },
    {
      "date": "2026-05-09",
      "ticker": "MSFT",
      "name": "마이크로소프트",
      "type": "dividend",
      "stock_type": "watchlist"
    },
    {
      "date": "2026-05-26",
      "ticker": "MARKET",
      "name": "Memorial Day",
      "type": "holiday_us",
      "stock_type": "market"
    }
  ]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `date` | string | 이벤트 날짜 (`YYYY-MM-DD`) |
| `ticker` | string | 종목 코드 |
| `name` | string | 종목명 또는 공휴일명 |
| `type` | string | `"earnings"` \| `"dividend"` \| `"holiday_us"` \| `"holiday_kr"` |
| `stock_type` | string | `"holding"` \| `"watchlist"` \| `"market"` |

> **배당락일 추정:** yfinance 배당 이력에서 최근 4회 지급 간격의 평균으로 다음 배당락일을 예측합니다. 배당 이력이 2회 미만인 종목은 생략됩니다.

**Error `422`** — `month` 파라미터가 `YYYY-MM` 형식이 아닌 경우

---

### `DELETE /api/calendar/cache`

특정 월의 캘린더 캐시를 삭제합니다. 다음 `GET /api/calendar` 요청 시 yfinance에서 재수집합니다.

**Auth:** Bearer token 필요

**Query Parameter**

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `month` | string | ✅ | 초기화할 월 (`YYYY-MM` 형식) |

**Response `200`**
```json
{ "cleared": "2026-05" }
```

**Error `422`** — `month` 파라미터가 `YYYY-MM` 형식이 아닌 경우

---

## Digest (일일 다이제스트)

### `GET /api/digest/latest`

가장 최근 생성된 다이제스트 조회.

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "date": "2026-05-23",
  "generated_at": "2026-05-23T08:00:00",
  "content": "## 오늘의 포트폴리오 요약\n..."
}
```

**Error `404`** — 아직 생성된 다이제스트 없음

---

### `POST /api/digest/generate`

다이제스트 즉시 생성 (동기).

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "date": "2026-05-23",
  "generated_at": "2026-05-23T12:00:00",
  "content": "## 오늘의 포트폴리오 요약\n..."
}
```

---

## Market (시장 지표)

### `GET /api/market/treasury`

미국 국채 금리 (2년, 10년). Supabase `market_cache`에서 읽고 없으면 yfinance 조회.

**Response `200`**
```json
{ "us2y": 4.85, "us10y": 4.42 }
```

---

### `GET /api/market/fx`

주요 환율 (yfinance).

**Response `200`**
```json
{ "usd_krw": 1380.5, "usd_jpy": 156.2, "eur_usd": 1.082 }
```

---

### `GET /api/market/vix`

VIX 공포지수.

**Response `200`**
```json
{ "value": 18.4, "label": "보통" }
```

---

### `GET /api/market/commodities`

주요 원자재 가격.

**Response `200`**
```json
{ "gold": 2345.6, "wti": 78.3, "copper": 4.52 }
```

---

### `GET /api/market/econ-indicators`

경제지표 (FRED API). `FRED_API_KEY` 환경변수 필요.

**Response `200`**
```json
{ "cpi_yoy": 3.2, "unemployment": 3.9 }
```

---

### `GET /api/market/m7-earnings`

M7 빅테크 최근 실적 요약.

**Response `200`** — 종목 배열 (각 항목: ticker, eps_actual, eps_estimate, surprise_pct 등)

---

### `GET /api/market/kr-top2-earnings`

삼성전자·SK하이닉스 최근 실적 요약.

**Response `200`** — 종목 배열

---

### `GET /api/market/kr-exports`

한국 수출 지표. `KITA_API_KEY`(관세청 API) 미설정 시 UN Comtrade 공개 API 폴백.

**Response `200`** — 월별 수출 데이터 객체

---

### `POST /api/market/refresh-earnings`

M7·KR Top2 실적 데이터 캐시 초기화 후 재수집.

**Response `200`**
```json
{
  "ok": true,
  "m7_quarters": 20,
  "kr_quarters": 16
}
```

---

### `POST /api/market/refresh-econ`

경제지표(CPI, 실업률) 캐시 초기화 후 FRED API 재수집.

**Response `200`**
```json
{
  "ok": true,
  "cpi_points": 36,
  "unemp_points": 36
}
```

---

### `POST /api/market/refresh-market`

FX·VIX·국채·원자재 캐시 초기화 후 yfinance 1년치 재수집.

**Response `200`**
```json
{
  "ok": true,
  "fx_points": 252,
  "vix_points": 252,
  "treasury_points": 252,
  "commodities_gold_points": 252
}
```

---

## Guru (구루 분석)

### `GET /api/guru/managers`

dataroma 기반 구루 매니저 전체 목록.

**Response `200`**
```json
{
  "last_updated": "2026-05-23T08:00:00",
  "managers": [
    {
      "name": "Warren Buffett",
      "firm": "Berkshire Hathaway",
      "portfolio_value": 350000000000,
      "num_stocks": 45,
      "top10": ["AAPL", "BAC", "AXP"]
    }
  ]
}
```

---

### `GET /api/guru/stats/popularity`

여러 구루가 보유한 종목을 보유자 수 기준으로 랭킹.

**Response `200`** — `[{ "ticker": "AAPL", "count": 12 }, ...]`

---

### `GET /api/guru/stats/manager-top3`

각 구루의 포트폴리오 상위 3개 종목.

**Response `200`** — `[{ "manager": "...", "top3": ["AAPL", "MSFT", "BRK.B"] }, ...]`

---

### `GET /api/guru/stats/weighted`

포트폴리오 내 순위 기반 가중치(1/rank) 합산 추천 점수.

**Response `200`** — `[{ "ticker": "AAPL", "score": 5.23 }, ...]`

---

### `GET /api/guru/crawl/progress`

구루 크롤링 진행 상황 조회.

**Response `200`**
```json
{ "running": true, "done": 3, "total": 20, "current": "Warren Buffett" }
```

---

### `POST /api/guru/crawl`

dataroma 전체 매니저 크롤링 시작 (비동기, admin 전용).

**Auth:** admin role 필요

**Response `202`**
```json
{ "message": "Crawl started" }
```

**Error `409`** — 크롤링 이미 진행 중

---

### `GET /api/guru/schedule`

구루 크롤링 자동 스케줄 조회.

**Response `200`**
```json
{ "enabled": true, "day": "sun", "time": "07:00" }
```

---

### `PUT /api/guru/schedule`

구루 크롤링 자동 스케줄 업데이트.

**Request Body**
```json
{ "enabled": true, "day": "sun", "time": "07:00" }
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `enabled` | boolean | ✅ | 스케줄 활성화 여부 |
| `day` | string | ✅ | 요일 (`"mon"` ~ `"sun"`) |
| `time` | string | ✅ | 실행 시간 (`"HH:MM"` 형식) |

**Response `200`** — 저장된 스케줄 그대로 반환

**Error `400`** — `enabled`, `day`, `time` 중 누락 시

---

## Analytics (분석)

### `GET /api/analytics/correlation`

보유 종목 간 90일 수익률 상관관계 행렬. TTL 300s 캐시.

**Auth:** Bearer token 필요

- 종목이 2개 미만이거나, 데이터 20일 미만인 종목은 제외됨
- KR 종목은 `.KS` 또는 `.KQ` 심볼로 조회

**Response `200`**
```json
{
  "tickers": ["AAPL", "MSFT", "NVDA"],
  "matrix": [
    [1.0,   0.823, 0.741],
    [0.823, 1.0,   0.689],
    [0.741, 0.689, 1.0  ]
  ]
}
```

종목 수 부족 시:
```json
{ "tickers": [], "matrix": [] }
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `tickers` | string[] | 상관관계 계산에 포함된 종목 코드 목록 |
| `matrix` | number[][] | `tickers[i]`와 `tickers[j]`의 상관계수 (`matrix[i][j]`) |

---

## Analysis (포트폴리오 분석)

> **Prefix:** `/api/analysis`  
> **Auth:** Bearer token 필요

### `GET /api/analysis/sector`

보유종목 섹터 모멘텀 분석. 섹터 ETF(XLK, XLV 등 11종) 기반 모멘텀 데이터와 보유종목의 섹터 배분을 결합. TTL 300s 캐시.

**Response `200`**
```json
{
  "sector_momentum": [
    {
      "sector": "Technology",
      "etf": "XLK",
      "momentum_1m": 3.2,
      "momentum_3m": 8.1,
      "momentum_6m": 15.4
    }
  ],
  "holdings_by_sector": {
    "Technology": ["AAPL", "MSFT"],
    "Healthcare": ["JNJ"]
  }
}
```

---

### `GET /api/analysis/macro-correlation`

보유종목과 매크로 지표(TLT·UUP·USO·^VIX) 간 상관관계 분석. TTL 300s 캐시.

**Response `200`**
```json
{
  "tickers": ["AAPL", "MSFT"],
  "macro": ["TLT", "UUP", "USO", "^VIX"],
  "matrix": [
    [-0.32, 0.12, 0.45, -0.67],
    [-0.28, 0.09, 0.38, -0.71]
  ]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `tickers` | string[] | 보유종목 코드 목록 |
| `macro` | string[] | 매크로 지표 티커 목록 |
| `matrix` | number[][] | `matrix[i][j]` = `tickers[i]`와 `macro[j]`의 상관계수 |

---

## 공통 스키마

### Stock (보유종목)

```json
{
  "ticker": "AAPL",
  "name": "Apple Inc.",
  "quantity": 10,
  "avg_cost": 150.0,
  "competitors": ["MSFT", "GOOGL"],
  "moat": "생태계 락인, 브랜드",
  "growth_plan": "서비스 매출 확대",
  "risks": "규제 리스크, 중국 매출 의존도",
  "recent_disclosures": "2024Q4 실적 발표..."
}
```

### WatchlistStock (관심종목)

```json
{
  "ticker": "TSLA",
  "name": "Tesla Inc.",
  "competitors": [],
  "moat": "",
  "growth_plan": "",
  "risks": "",
  "recent_disclosures": ""
}
```

---

## 공통 에러 응답

모든 에러는 아래 형식으로 반환됩니다.

```json
{ "detail": "에러 메시지" }
```

| HTTP 상태 | 의미 |
|-----------|------|
| `400` | 잘못된 요청 (중복, 필드 누락 등) |
| `401` | 인증 필요 (토큰 없음 또는 만료) |
| `403` | 권한 없음 (admin 전용 엔드포인트) |
| `404` | 리소스 없음 |
| `409` | 충돌 (이미 진행 중인 작업 등) |
| `422` | 요청 바디 유효성 검사 실패 (FastAPI 기본) |

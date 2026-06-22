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
- [Calendar (이벤트 캘린더)](#calendar-이벤트-캘린더)
- [Digest (일일 다이제스트)](#digest-일일-다이제스트)
- [Market (시장 지표)](#market-시장-지표)
- [Guru (구루 분석)](#guru-구루-분석)
- [Batches (자동 배치 현황·스케줄)](#batches-자동-배치-현황스케줄)
- [Analytics (분석)](#analytics-분석)
- [Analysis (포트폴리오 분석)](#analysis-포트폴리오-분석)
- [Recommendations (종목 추천·발굴)](#recommendations-종목-추천발굴)
- [Rankings](#rankings)
- [Investor (수급 스크리닝)](#investor-수급-스크리닝)
- [Events (행동 로그)](#events-행동-로그)
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


### `GET /api/auth/oauth/token`

OAuth 로그인 콜백 후 프론트가 전달받은 일회성 `code`를 실제 토큰으로 교환한다. 콜백이 토큰을 임시 저장하고 `?oauth=<code>`로 리다이렉트하면, 프론트가 이 엔드포인트로 code를 보내 access/refresh 토큰을 받아간다(code는 1회 소비).

**Auth:** 불필요

**Request** — query parameters

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `code` | string | yes | OAuth 콜백이 발급한 일회성 교환 코드 |

**Response `200`**
```json
{
  "access_token": "<jwt>",
  "refresh_token": "<token>",
  "token_type": "bearer"
}
```

**Error `400`** — Invalid or expired OAuth code

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

### `DELETE /api/admin/stocks/{ticker}`

관리자 전용. 한 종목을 **모든 사용자**의 보유·관심(`user_stocks`)에서 제거한다. 리서치 리포트 "그외" 탭(`scope=all` + `is_mine=false`, 다른 사용자가 담았으나 관리자 본인은 안 담은 종목)의 정리용. 스냅샷(리포트 데이터)은 건드리지 않아 보이지 않는 고아로 남는다. 없는 종목이어도 `200`(idempotent, `deleted: 0`).

**Auth:** admin 권한 필요 (`403` if not admin)

**Response `200`**
```json
{ "deleted": 2, "ticker": "AAPL" }
```


### `DELETE /api/admin/users/{user_id}`

관리자 전용. 특정 사용자를 삭제한다. 삭제 전 `user_stocks`·`user_menu_permissions`·`refresh_tokens`·`digests`·`calendar_cache`의 연관 행을 먼저 제거한 뒤 `users` 행을 삭제한다. 어드민 계정(`403`)·소셜 로그인 계정(`403`)은 삭제할 수 없고, 존재하지 않는 사용자는 `404`.

**Auth:** admin 권한 필요 (`403` if not admin)

**Request**

**Path Parameter:** `user_id` — 사용자 UUID

**Response `200`**
```json
{ "ok": true }
```

### `GET /api/admin/analytics/events`

관리자 전용. 지정 기간(`days`) 동안의 일자별·이벤트명별 발생 건수 집계를 날짜 내림차순으로 반환한다(`user_events` 기반).

**Auth:** admin 권한 필요 (`403` if not admin)

**Request**

| Query | Type | Default | 설명 |
|-------|------|---------|------|
| `days` | int | `7` | 집계 기간(일). `9999` 이상이면 전체 기간 |

**Response `200`**
```json
[
  {
    "date": "2026-06-20",
    "event_name": "page_view",
    "count": 42
  }
]
```

### `GET /api/admin/analytics/summary`

관리자 전용. 지정 기간(`days`) 동안의 활성 사용자 수(DAU=고유 user_id), 총 이벤트 수, 상위 이벤트 10종을 요약 반환한다(`user_events` 기반).

**Auth:** admin 권한 필요 (`403` if not admin)

**Request**

| Query | Type | Default | 설명 |
|-------|------|---------|------|
| `days` | int | `7` | 집계 기간(일). `9999` 이상이면 전체 기간 |

**Response `200`**
```json
{
  "dau": 12,
  "total_events": 350,
  "top_events": [
    { "name": "page_view", "count": 120 }
  ]
}
```

### `GET /api/admin/analytics/users`

관리자 전용. 이벤트를 발생시킨 사용자별 총 이벤트 수와 마지막 활동 시각을 총 이벤트 수 내림차순으로 반환한다(`user_events` ⋈ `users`).

**Auth:** admin 권한 필요 (`403` if not admin)

**Response `200`**
```json
[
  {
    "user_id": "uuid",
    "email": "user@example.com",
    "total_events": 87,
    "last_active": "2026-06-21T08:30:00+00:00"
  }
]
```

### `GET /api/admin/analytics/users/{user_id}`

관리자 전용. 특정 사용자의 최근 이벤트 이력을 시각 내림차순으로 반환한다(최대 `limit`건). `properties`는 이벤트 저장 시의 JSON 페이로드를 그대로 담는다.

**Auth:** admin 권한 필요 (`403` if not admin)

**Request**

**Path Parameter:** `user_id` — 사용자 UUID

| Query | Type | Default | 설명 |
|-------|------|---------|------|
| `limit` | int | `200` | 반환 이벤트 최대 건수 |

**Response `200`**
```json
[
  {
    "event_name": "page_view",
    "properties": { "path": "/portfolio" },
    "created_at": "2026-06-21T08:30:00+00:00"
  }
]
```

### `GET /api/admin/default-permissions`

관리자 전용. 신규 사용자에게 적용되는 기본 메뉴 권한을 조회한다(`default_menu_permissions`). 저장된 값이 없는 메뉴는 `false`로 채운다. 메뉴 키: `portfolio`·`research`·`market`·`guru`·`settings`.

**Auth:** admin 권한 필요 (`403` if not admin)

**Response `200`**
```json
{
  "portfolio": true,
  "research": true,
  "market": false,
  "guru": false,
  "settings": false
}
```

### `PUT /api/admin/default-permissions`

관리자 전용. 신규 사용자 기본 메뉴 권한을 수정한다(`default_menu_permissions` upsert). `ALL_MENUS`(`portfolio`·`research`·`market`·`guru`·`settings`)에 없는 키는 무시한다. 응답은 전체 메뉴 기준의 갱신 후 권한 맵(미지정 메뉴는 `false`).

**Auth:** admin 권한 필요 (`403` if not admin)

**Request Body**
```json
{
  "permissions": {
    "portfolio": true,
    "research": true,
    "market": false
  }
}
```

**Response `200`**
```json
{
  "portfolio": true,
  "research": true,
  "market": false,
  "guru": false,
  "settings": false
}
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
| `ticker` | string | ✅ | 종목 코드 (strip·자동 대문자 변환, `^[A-Za-z0-9.\-]{1,15}$` 형식 검증 — 공백/잡문자/빈값/과길이 거부) |
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

**Error `422`** — `ticker`가 `^[A-Za-z0-9.\-]{1,15}$` 형식이 아닌 경우 (공백/잡문자/빈값/과길이)

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


### `GET /api/portfolio/prices`

보유+관심 종목의 라이브 시세(현재가·등락률)를 일괄 조회. 장중 자동폴링 대상이라 user당 15초 캐시로 다중 폴링 레이트리밋을 방어한다.

**Auth:** Bearer token 필요

**Response `200`** — ticker → {현재가, 등락률} 맵
```json
{
  "AAPL": {
    "current_price": 195.32,
    "change_pct": 1.24
  },
  "005930": {
    "current_price": 71200,
    "change_pct": -0.56
  }
}
```

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
| `ticker` | string | ✅ | 종목 코드 (strip·자동 대문자 변환, `^[A-Za-z0-9.\-]{1,15}$` 형식 검증 — 공백/잡문자/빈값/과길이 거부) |
| `name` | string | ✅ | 종목명 |
| `competitors` | string[] | ❌ | 경쟁사 티커 목록 |
| `moat` | string | ❌ | 경제적 해자 |
| `growth_plan` | string | ❌ | 성장 계획 |

**Response `201`** — 추가된 종목 객체

**Error `400`** — 이미 보유종목 또는 관심종목에 존재

**Error `422`** — `ticker`가 `^[A-Za-z0-9.\-]{1,15}$` 형식이 아닌 경우 (공백/잡문자/빈값/과길이)

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

보유종목 대시보드 카드 목록 (현재가, 수익률, RSI, 컨센서스, 배당) + 포트폴리오 총계. TTL 300s 캐시.

**Auth:** Bearer token 필요

**Response `200`** — `{ "holdings": [...], "totals": {...} | null }`
```json
{
  "holdings": [
    {
      "ticker": "AAPL",
      "name": "Apple Inc.",
      "market": "US",
      "exchange": "",
      "avg_cost": 150.0,
      "quantity": 10,
      "current_price": 175.5,
      "daily_change_pct": 1.2,
      "weekly_change_pct": 3.4,
      "monthly_change_pct": 8.1,
      "rsi": 62.3,
      "poc": 168.0,
      "vah": 180.0,
      "val": 160.0,
      "hvn": [],
      "target_mean": 210.0,
      "buy": 15,
      "hold": 8,
      "sell": 2,
      "snapshot_date": "2026-05-20",
      "sector": "Technology",
      "annual_dividend_per_share": 1.0,
      "dividend_yield": 0.57,
      "yield_on_cost": 0.67,
      "expected_annual_income": 10.0,
      "supply": null,
      "insider": null
    }
  ],
  "totals": {
    "total_expected_annual_income_krw": 13800.0,
    "total_market_value_krw": 2420900.0,
    "avg_dividend_yield": 0.57
  }
}
```

| 필드 (per-holding 배당) | 타입 | 설명 |
|------|------|------|
| `annual_dividend_per_share` | float \| null | 연 주당배당(통화는 종목 통화: US=USD/KR=KRW). 저장된 배당값만 읽음(라이브 호출 0), 무배당/미수집은 `null` |
| `dividend_yield` | float \| null | 배당수익률(%) |
| `yield_on_cost` | float \| null | 매수가 대비 수익률(%) = `annual_dividend_per_share / avg_cost × 100`. `avg_cost` 없으면 `null` |
| `expected_annual_income` | float \| null | 연 예상배당 = `annual_dividend_per_share × quantity`(종목 통화). `quantity` 없으면 `null` |

| 필드 (수급 스코어) | 타입 | 설명 |
|------|------|------|
| `supply` | object \| null | 수급 종합 스코어(ADR-0014). **KR 종목만** 저장값(`stock_supply_score`)을 투영, US·미산출은 `null`. 저장값만 읽음(라이브 호출 0). 형태: `{ "band": ..., "flags": [...], "as_of": {...} }` |
| `supply.band` | string | 밴드 enum 3종: `"favorable"` \| `"neutral"` \| `"caution"` |
| `supply.flags` | string[] | 근거 플래그(한국어 문자열 리스트, 예: `"공매도 비중 급증"`, `"외인/기관 동반 순매도"`, `"외인/기관 데이터 부족"`). 켜진 신호 없으면 `[]` |
| `supply.as_of` | object | 입력 데이터 기준일 `{ "short_sell": "YYYY-MM-DD" \| null, "investor": "YYYY-MM-DD" \| null }`. 결측 소스는 `null` |

> **band enum ↔ 표시 매핑** (프론트 표시용): `favorable` = 우호, `neutral` = 중립, `caution` = 경계. 저장값은 locale-독립 영문 enum이고, 한국어 표시는 소비처(프론트)가 매핑한다.

| 필드 (내부자 신호) | 타입 | 설명 |
|------|------|------|
| `insider` | object \| null | 내부자·5%지분 순매수 신호. **KR 종목만** 저장값(`stock_insider_trades`)을 윈도(기본 90일) 집계, US·미매핑은 `null`. 저장값만 읽음(라이브 DART 0). 형태: `{ "direction": ..., "net_shares": ..., "count": ..., "window_days": ... }` |
| `insider.direction` | string | 방향 enum 3종: `"buy"`(net>0) \| `"sell"`(net<0) \| `"neutral"`(net==0 또는 데이터 없음) |
| `insider.net_shares` | int | 윈도 내 `shares_change` 합(부호 보존). 순매수면 양수, 순매도면 음수 |
| `insider.count` | int | 윈도 내 집계된 보고 행 수 |
| `insider.window_days` | int | 집계 윈도(달력일, 기본 90) |

| 필드 (`totals`) | 타입 | 설명 |
|------|------|------|
| `total_expected_annual_income_krw` | float | 연 예상배당 합계(KRW 환산: US$×usdkrw, KR원×1) |
| `total_market_value_krw` | float | 평가금액 합계(KRW 환산) |
| `avg_dividend_yield` | float \| null | 포트 평균 배당수익률(%) = 총배당/총평가. 평가금액 0이면 `null` |

> `totals`의 KRW 환산은 저장된 FX(`market_cache` `fx`의 `usdkrw`)만 사용한다. US 종목에 환율이 없으면 그 종목은 총계에서 제외(달러를 원으로 오합산 방지). 보유종목이 없으면 `{ "holdings": [], "totals": null }` 반환.

---

### `DELETE /api/stocks/dashboard/cache`

대시보드 인메모리 캐시 강제 초기화.

**Response `200`**
```json
{ "cleared": true }
```

---

### `GET /api/stocks/{ticker}/supply-score`

종목 수급 종합 스코어(ADR-0014) 저장값(`stock_supply_score`) 조회. 저장값만 읽음(라이브 호출 0). 미산출(US·결측 포함)이면 `null`.

**Auth:** Bearer token 필요

**Response `200`** — 산출값이 있으면 객체, 없으면 `null`
```json
{
  "band": "neutral",
  "flags": ["공매도 비중 급증", "외인/기관 데이터 부족"],
  "as_of": { "short_sell": "2026-06-16", "investor": null }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `band` | string | 밴드 enum 3종: `"favorable"`(우호) \| `"neutral"`(중립) \| `"caution"`(경계) |
| `flags` | string[] | 근거 플래그(한국어 문자열 리스트). 켜진 신호 없으면 `[]` |
| `as_of` | object | 입력 데이터 기준일 `{ "short_sell": "YYYY-MM-DD" \| null, "investor": "YYYY-MM-DD" \| null }` |

> 대시보드 응답의 `supply` 필드와 동일 형태·동일 저장원. 밴드 enum ↔ 표시 매핑은 `GET /api/stocks/dashboard` 절 참고.

---

### `POST /api/stocks/dividends/refresh`

보유·관심 종목의 배당(연 주당배당·배당수익률)을 시장별 소스에서 전 종목 재수집해 `stock_dividends`에 저장. US=yfinance, KR=DART alotMatter. 백그라운드 실행(`dividend_fetch` 배치 manual lane). **admin 전용.**

**Auth:** Bearer token + admin

**Response `202`**
```json
{ "message": "배당 전 종목 수집 시작" }
```

> `dividend_fetch` 자동 배치(`GET /api/batches`)와 동일 수집 로직. 무배당/결측 종목은 저장하지 않음(빈 박제 방지).

---

### `POST /api/stocks/supply-score/refresh`

보유·관심 KR 종목 수급 종합 스코어(ADR-0014)를 저장된 공매도(`market_short_sell`)+외인/기관(`market_investor_trend`) 시계열에서 전 종목 재산출해 `stock_supply_score`에 저장. 백그라운드 실행(`supply_score_fetch` 배치 manual lane). **admin 전용.**

**Auth:** Bearer token + admin

**Response `202`**
```json
{ "message": "수급 종합 스코어 전 종목 산출 시작" }
```

> `supply_score_fetch` 자동 배치(`GET /api/batches`)와 동일 산출 로직. 양쪽 시계열이 모두 결측인 종목은 저장하지 않음(직전 양호값 유지, 빈 박제 방지).

---

### `POST /api/stocks/names/backfill`

종목명이 비었거나 종목번호(티커)로 박힌 종목을 quote 실명으로 일괄 교정 (KR=키움 stk_nm/Naver, US=yfinance shortName). `tickers.name`과 기존 스냅샷의 박제 name을 동기 갱신. **admin 전용.**

**Auth:** Bearer token + admin

**Response `202`**
```json
{ "ok": true, "candidates": 12, "updated": 9, "skipped": ["CFRHF", "HKHHF"], "reconciled": 2 }
```

- `candidates` 교정 대상 수(name=''이거나 name=ticker) · `updated` 실제 실명으로 갱신된 수 · `skipped` 실명을 못 찾아 건너뛴 티커 목록(quote 일시실패 가능 — 결과가 예상보다 작으면 재실행 권장; 서버에 진단 로그도 남김) · `reconciled` 스냅샷 name 동기화 수.

---

### `GET /api/stocks/{ticker}/short-sell`

종목 공매도 추이 시계열 (KR 전용, 키움 ka10014 → `market_short_sell`). `base_date` 오름차순. 데이터 없으면 `items` 빈 배열.

**Query**: `days` (기본 252, 1~1000)

**Response `200`**
```json
{
  "ticker": "005930",
  "items": [
    {
      "base_date": "2026-06-12",
      "short_volume": 1067591,
      "short_value": 351129846000,
      "short_ratio": 3.44,
      "short_balance": 19509651,
      "close_price": 322500
    }
  ]
}
```

- `short_volume` 공매도 거래량(주) · `short_value` 공매도 거래대금(원) · `short_ratio` 공매도 비중(%) · `short_balance` 공매도 잔량(주, 미상환) · `close_price` 종가(원).

---

### `POST /api/short-sell/refresh`

공매도 추이 배치(`short_sell_fetch`) 수동 실행. **admin 전용.** 보유/관심 KR 종목의 공매도 시계열을 키움에서 갱신.

**Auth:** Bearer token + admin

**Response `202`**
```json
{ "ok": true }
```


### `GET /api/stocks/{ticker}/investor-trend`

KR 종목의 일자별 투자자별 수급 추이(외국인/기관/개인 순매수, 외국인 보유비율, 종가) 시계열을 조회. `investor_service.read_series` 저장값을 반환한다.

**Auth:** 불필요

**Request** — query parameters

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `days` | int | 252 | 조회 일수 (1~1000) |

**Response `200`**
```json
{
  "ticker": "005930",
  "items": [
    {
      "base_date": "2026-06-20",
      "foreign_net": 123456,
      "organ_net": -45678,
      "individual_net": -77778,
      "foreign_hold_ratio": 52.34,
      "close_price": 71200
    }
  ]
}
```

### `GET /api/stocks/{ticker}/news`

종목 최근 뉴스(최대 5건)를 on-demand 조회. 리포트가 없는 랭킹 종목 등에서 쓰며 `scraper.get_news`를 재사용한다(KR=Naver, US=yfinance). 공개 read.

**Auth:** 불필요

**Request** — query parameters

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `market` | string | `US` | `KR` 또는 `US` (그 외 값은 400) |

**Response `200`**
```json
{
  "news": [
    {
      "title": "종목 관련 기사 제목",
      "link": "https://...",
      "publisher": "매체명",
      "published_at": "2026-06-20 09:22"
    }
  ]
}
```

**Error `400`** — market이 KR/US가 아님

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
    "market": "US",
    "exchange": "",
    "is_etf": false,
    "summary": {
      "score": 85,
      "recommendation": "매수",
      "one_liner": "AI 수혜 + 서비스 성장 지속"
    }
  },
  "TSLA": {
    "dates": ["2024-11-10"],
    "category": "watchlist",
    "market": "US",
    "exchange": "",
    "is_etf": false,
    "summary": null
  }
}
```

| `category` 값 | 설명 |
|---------------|------|
| `"holdings"` | 보유종목 |
| `"watchlist"` | 관심종목 |
| `"other"` | 포트폴리오에서 제거된 종목 |

- `is_etf` — ETF 여부(`tickers.is_etf` 기준). ETF는 애널리스트 의견이 없어 관심(watchlist) "⚠ 경고" 서브탭/카운트에서 제외된다.

응답에는 종목 맵과 함께 `last_scheduled_date`가 포함된다. 일일 리포트 배치가 시장별(`daily_report_kr`/`daily_report_us`)로 분리되어 시장마다 기대 리포트 날짜가 다르므로, 값은 시장별 기대날짜 **객체**다.

```json
{ "last_scheduled_date": { "KR": "2026-06-12", "US": "2026-06-15" } }
```

> `last_scheduled_date`는 과거에 단일 문자열(`"2026-05-20"`)이었으나 시장별 객체 `{ "KR": ..., "US": ... }`로 형태가 변경되었다(외부 소비자 파싱 영향).

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

### `GET /api/report/{ticker}/backlog`

종목의 수주잔고(Order Backlog) 분기별 이력 조회. KR 종목 리포트 상세의 '수주잔고 추이' 차트가 사용. **Auth 불필요.**

**Response `200`**
```json
[
  { "quarter": "2025Q3", "amount": 1031207.96, "unit": "억원", "source": "dart",
    "segments": [ { "sector": "항공", "entity": "한화에어로스페이스㈜", "amount": 314106.0 } ] },
  { "quarter": "2024Q4", "amount": null, "unit": "억원", "source": "pending", "segments": null }
]
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `quarter` | string | 분기 (`YYYYQn`) |
| `amount` | number\|null | 수주잔고 총액(억원). `pending`이면 null |
| `unit` | string | 원본 표 단위(저장은 억원 정규화) |
| `source` | string | `"dart"`(코드 자동추출·검산 통과) \| `"llm"`(Cowork 수기) \| `"pending"`(미채움) |
| `segments` | `{sector,entity,amount}[]`\|null | 다중엔티티 연결 종목의 사업부문>법인별 분해(억원). 없으면 null |

---

### `GET /api/report/backlog/pending`

코드 자동 파싱(검산)에 실패해 분석 대기 중인 항목과 추출 지침(prompt)을 반환. Claude Cowork가 소비. **Auth:** `X-API-Key` 또는 로그인.

**Response `200`**
```json
{
  "prompt": "다음은 한 종목 정기보고서에서 추출한 [재무 컨텍스트]와 [수주 원문]입니다 ...",
  "items": [
    { "ticker": "000720", "quarter": "2025Q1",
      "raw_text": "[재무 컨텍스트] (단위: 억원, 연결재무제표)\n  매출액: ...\n\n회사명 | 품목 | ... | 수주잔고\n...",
      "unit": "억원" }
  ]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `prompt` | string | 수주잔고 추출 지침(단위 정규화·외화·다중엔티티·공사진행·"틀린 값<누락") |
| `items[]` | array | 대기 항목 (`ticker`, `quarter`, `raw_text`=재무 컨텍스트+수주 원문 결합, `unit`) |

> 다중엔티티 연결 종목은 코드가 `dart`+segments로 자동 채워 pending에 없음. `items` 빈 배열이면 대기 없음.

---

### `PUT /api/report/{ticker}/backlog`

Cowork가 추출한 수주잔고 수치를 저장. `source`가 `'pending'`/`'llm'`인 행만 갱신(`'dart'` 보호). **Auth:** `X-API-Key` 또는 로그인.

**Request Body** — 분기별 배열
```json
[
  { "quarter": "2024Q3", "amount": 85432.0 },
  { "quarter": "2025Q4", "amount": 1168007.29,
    "segments": [ { "sector": "방산", "entity": "한화에어로스페이스㈜", "amount": 372199.02 } ] }
]
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `quarter` | string | ✅ | 분기 (`YYYYQn`) |
| `amount` | number | ✅ | 수주잔고 총액(억원). segments가 있으면 그 합과 일치 |
| `segments` | `{sector,entity,amount}[]` | ⬜ | 사업부문>법인별 분해(억원). 미제공 시 기존값 유지(COALESCE) |

**Response `200`** — `{ "ticker": "012450", "saved": 2 }`

---

### `POST /api/report/backlog/refresh-all`

전 KR 종목 수주잔고 재수집(DART document.xml 스윕). 백그라운드 실행, 즉시 202. **Auth:** admin.

**Response `202`** — `{ "message": "수주잔고 전 종목 수집 시작" }`

---

### `POST /api/report/{ticker}/backlog/refresh`

단일 종목 수주잔고 재수집. **Auth:** admin.

**Response `202`** — `{ "ticker": "012450", "count": 6, "entries": [ ... ] }`

---

### `GET /api/report/{ticker}/disclosures`

종목의 DART 공시 피드 조회 (최신순). KR 종목 리포트 상세의 '최신 공시' 섹션이 사용. `disclosure_fetch` 배치가 채우는 `stock_disclosures` 테이블에서 읽으며, **Cowork가 enrich하는 `recent_disclosures`(애널리스트 코멘터리)와는 별도 store**다. **Auth 불필요.**

**Response `200`**
```json
[
  { "rcept_no": "20260612000123", "rcept_dt": "2026-06-12", "report_nm": "주요사항보고서(유상증자결정)",
    "pblntf_ty": "B", "corp_name": "삼성전자", "dart_url": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260612000123" }
]
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `rcept_no` | string | DART 접수번호 (dedup 키) |
| `rcept_dt` | string\|null | 접수일자 (`YYYY-MM-DD`) |
| `report_nm` | string | 공시 제목 |
| `pblntf_ty` | string | 공시 유형: `A`(정기) \| `B`(주요사항) \| `C`(발행) \| `D`(지분) — 핵심 유형만 수집 |
| `corp_name` | string | 회사명 |
| `dart_url` | string | DART 원문 뷰어 URL |

> 비-KR 종목·corp_code 미매핑 종목은 빈 배열을 반환한다.

---

### `POST /api/report/disclosures/refresh`

전 KR 종목(보유+관심) DART 공시 피드 재수집(`disclosure_fetch` 배치 수동 트리거). 백그라운드 실행, 즉시 202. **Auth:** admin.

**Response `202`** — `{ "message": "공시 피드 전 종목 수집 시작" }`

---

### `GET /api/report/{ticker}/insider-trades`

종목의 내부자·5%지분 변동 공시 피드 + 순매수/순매도 신호 조회 (최신순). KR 종목 리포트 상세의 '내부자·5% 지분변동' 섹션이 사용. `insider_fetch` 배치가 채우는 `stock_insider_trades` 테이블에서 읽으며(DART `elestock.json`=임원·주요주주 소유보고 / `majorstock.json`=5% 대량보유보고 정규화), **Cowork가 enrich하는 `recent_disclosures`(애널리스트 코멘터리)와는 별도 store**다. 저장값만 읽고 요청경로 라이브 DART 호출은 0. **Auth 불필요.**

**Response `200`**
```json
{
  "trades": [
    { "rcept_no": "20260612000123", "rcept_dt": "2026-06-12", "report_kind": "insider",
      "repror": "홍길동", "rel": "대표이사", "shares_change": 12000, "shares_after": 320000,
      "rate_after": 0.54, "dart_url": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260612000123" }
  ],
  "signal": { "direction": "buy", "net_shares": 12000, "count": 3, "window_days": 90 }
}
```

| 필드 (`trades[]`) | 타입 | 설명 |
|------|------|------|
| `rcept_no` | string | DART 접수번호 |
| `rcept_dt` | string\|null | 접수일자 (`YYYY-MM-DD`) |
| `report_kind` | string | 공시 종류: `insider`(임원·주요주주 소유보고, elestock) \| `major5`(5% 대량보유보고, majorstock) |
| `repror` | string\|null | 보고자명 |
| `rel` | string\|null | 회사와의 관계 |
| `shares_change` | int\|null | 증감 주식 수(부호 보존: 양수=취득, 음수=처분) |
| `shares_after` | int\|null | 변동 후 보유 주식 수 |
| `rate_after` | float\|null | 변동 후 지분율(%) |
| `dart_url` | string | DART 원문 뷰어 URL |

| 필드 (`signal`) | 타입 | 설명 |
|------|------|------|
| `direction` | string | 윈도 순신호 enum 3종: `buy`(net>0) \| `sell`(net<0) \| `neutral`(net==0 또는 데이터 없음) |
| `net_shares` | int | 윈도 내 `shares_change` 합(부호 보존) |
| `count` | int | 윈도 내 집계된 보고 행 수 |
| `window_days` | int | 집계 윈도(달력일, 기본 90) |

> 비-KR 종목·corp_code 미매핑 종목은 `trades` 빈 배열·`signal.direction` `"neutral"`을 반환한다.

---

### `POST /api/report/insider-trades/refresh`

전 KR 종목(보유+관심) 내부자·5%지분 공시 피드 재수집(`insider_fetch` 배치 수동 트리거). 백그라운드 실행, 즉시 202. **Auth:** admin.

**Response `202`** — `{ "message": "내부자 지분공시 전 종목 수집 시작" }`

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

### `POST /api/consensus/{ticker}/backfill`

특정 종목의 컨센서스 데이터를 정본 `daily_consensus_mart`로 백필 (raw_reports upsert 후 마트 재계산, ADR-0008). snapshot에서 market을 읽어 파이프라인을 호출한다.

**Path Parameter:** `ticker` — 종목 코드

**Query Parameters:**
- `days` (int, 기본 `180`) — 백필 기간
- `force` (bool, 기본 `false`) — 기존 마트 구간 삭제 후 재계산

**Response `200`**
```json
{
  "added": 12
}
```
`added` — 파이프라인이 upsert한 raw_reports 행 수.

---

## Batches (자동 배치 현황·스케줄)

### `GET /api/batches`

자동 배치(22종) 현황 조회. 각 배치의 메타데이터 + 다음 실행 시각 + 최근 실행 로그를 반환하며, 편집 가능한 배치에는 현재 스케줄 스펙도 포함한다.

> 일일 리포트는 시장별로 `daily_report_kr`(기본 20:30 KST, KR 종목)·`daily_report_us`(기본 07:00 KST, US 종목) 2종으로 분리되어 있다(단일 `daily_report`는 더 이상 존재하지 않음). 실적·월간 지표도 같은 방식으로 시장별 분리됨: 실적은 `earnings_kr`(KR Top2)·`earnings_us`(M7), 월간 지표는 `monthly_kr`(KR 수출)·`monthly_us`(FRED 경제지표). 단일 `earnings_refresh`/`monthly_refresh`는 더 이상 존재하지 않는다. 매크로 신호 수집 `macro_signals_fetch`(매일 06:00 KST, `market="US"` — FRED 출처)는 수동 트리거 `POST /api/market/refresh-macro-signals`를 갖는다. KR 업종 모멘텀 수집 `kr_sector_fetch`(매일 16:00 KST, `market="KR"`)는 수동 트리거 `POST /api/analysis/sector/refresh-kr`를 갖는다. DART 공시 피드 수집 `disclosure_fetch`(매일 07:30 KST, `market="KR"`)는 수동 트리거 `POST /api/report/disclosures/refresh`를 갖는다. 내부자·5%지분 공시 신호 수집 `insider_fetch`(매일 07:45 KST, `market="KR"` — DART 출처)는 수동 트리거 `POST /api/report/insider-trades/refresh`를 갖는다. 배당 수집 `dividend_fetch`(`market="공통"`, 매주 일 05:00 KST, US=yfinance/KR=DART alotMatter)는 수동 트리거 `POST /api/stocks/dividends/refresh`를 갖는다.

**Auth:** Bearer token 필요

**Response `200`** — 배치 객체 배열
```json
[
  {
    "id": "daily_digest",
    "label": "일일 다이제스트",
    "category": "report",
    "market": "공통",
    "source": ["보유종목 다이제스트 집계"],
    "usage": ["다이제스트 탭"],
    "editable": true,
    "timezone": "Asia/Seoul",
    "scheduler_job_id": "daily_digest",
    "manual_endpoint": "/api/digest/generate-all",
    "trigger_kinds": ["auto", "manual"],
    "next_run": "2026-06-08T08:00:00+09:00",
    "recent_runs": [],
    "schedule": { "enabled": true, "type": "daily", "time": "08:00" }
  }
]
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `market` | string | 배치 분류: `"KR"`(국내) \| `"US"`(해외) \| `"공통"`. 출처국 기준이라 FRED 경제지표(`monthly_us`)는 해외로 분류(ADR-0013) |
| `source` | string[] | 배치가 데이터를 fetch하는 출처(예: `["키움", "KIS", "Naver"]`). 소비 UI인 `usage`와 반대 방향(fetch vs. 사용처) |
| `editable` | boolean | 스케줄 편집 가능 여부 |
| `timezone` | string | 잡 타임존(편집 불가 고정값). 편집 가능 배치에만 존재 |
| `schedule` | object \| null | 현재 스케줄 스펙(저장값 없으면 기본 스펙). 편집 불가 배치(`consensus`)는 `null` |

> 편집 불가 배치 `consensus`에는 `editable`/`timezone`/`schedule` 관련 필드가 없거나 `schedule: null`이다.

---

### `GET /api/batches/{job_id}/schedule`

편집 가능한 배치의 스케줄 스펙 조회. 저장값이 없으면 해당 배치의 기본 스펙을 반환한다.

**Auth:** Bearer token 필요

**Response `200`** — 스케줄 스펙(아래 PUT의 스펙 스키마와 동일)

**Error `404`** — 알 수 없는 `job_id` 또는 편집 불가 배치(`consensus`)

---

### `PUT /api/batches/{job_id}/schedule`

편집 가능한 배치의 스케줄 스펙 저장 후 즉시 리스케줄.

**Auth:** admin 권한 필요

**Request Body** — 스케줄 스펙. `type`에 따라 필드가 달라진다.

| `type` | 추가 필드 | 예시 |
|--------|-----------|------|
| `"daily"` | `time` | `{"enabled": true, "type": "daily", "time": "08:00"}` |
| `"weekly"` | `days`, `time` | `{"enabled": true, "type": "weekly", "days": ["mon","fri"], "time": "08:00"}` |
| `"monthly"` | `day_of_month`, `time` | `{"enabled": true, "type": "monthly", "day_of_month": 1, "time": "02:00"}` |
| `"interval"` | `every_minutes`, `start_hour`, `end_hour` | `{"enabled": true, "type": "interval", "every_minutes": 10, "start_hour": 9, "end_hour": 15}` |

| 필드 | 타입 | 설명 |
|------|------|------|
| `enabled` | boolean | 스케줄 활성화 여부(필수) |
| `type` | string | `"daily"` \| `"weekly"` \| `"monthly"` \| `"interval"` |
| `time` | string | `"HH:MM"` (daily/weekly/monthly) |
| `days` | string[] | weekly: `mon`~`sun`의 비공집 부분집합 |
| `day_of_month` | int | monthly: 1~31 |
| `every_minutes` | int | interval: ≥ 5 |
| `start_hour` / `end_hour` | int | interval: 0~23, `start_hour ≤ end_hour` |

> 타임존은 배치별 고정값(편집 불가). `us_rankings_fetch`만 `America/New_York`, 나머지는 `Asia/Seoul`.

**Response `200`** — 저장된 스케줄 스펙 그대로 반환

**Error `400`** — 스펙 검증 실패(잘못된 `type`/`time`/`days`/`day_of_month`/`every_minutes`/시간 범위 등)
**Error `404`** — 알 수 없는 `job_id` 또는 편집 불가 배치(`consensus`)

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
  "generated_at": "2026-05-23T08:00:00+09:00",
  "portfolio_summary": { "total_value_krw": 12345678, "daily_change_pct": 1.2, "daily_change_krw": 145000 },
  "stocks": [ { "ticker": "AAPL", "change_pct": -0.8 } ],
  "events_7d": [ { "ticker": "005930", "event_type": "earnings", "date": "2026-05-28", "days_until": 5 } ],
  "anomalies": [ { "ticker": "TSLA", "change_pct": 7.3 } ],
  "disclosures": [
    { "ticker": "005930", "rcept_dt": "20260522", "report_nm": "주요사항보고서(유상증자결정)",
      "pblntf_ty": "B", "corp_name": "삼성전자", "dart_url": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=..." }
  ],
  "insider_trades": [
    { "ticker": "005930", "direction": "buy", "net_shares": 12000, "count": 3 }
  ]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `disclosures[]` | array | 보유 KR 종목의 최근 DART 공시 피드(`stock_disclosures`에서 읽음). Cowork 코멘터리 `recent_disclosures`와 무관 |
| `insider_trades[]` | array | 보유 KR 종목 중 내부자·5%지분 순매수/순매도 신호가 있는 종목(`stock_insider_trades` 윈도 집계). neutral(신호 없음)은 제외. 각 항목 `{ "ticker", "direction": "buy"\|"sell", "net_shares"(부호 보존), "count" }` |

**Error `404`** — 아직 생성된 다이제스트 없음

---

### `POST /api/digest/generate`

다이제스트 즉시 생성 (동기). 응답 형태는 `GET /api/digest/latest`와 동일(`disclosures`·`insider_trades` 포함).

**Auth:** Bearer token 필요


### `POST /api/digest/generate-all`

전체 holding 사용자의 일일 다이제스트를 생성하고 텔레그램으로 전송 (스케줄러 `_run_digest`와 동일 로직의 수동 트리거). `daily_digest` job_run으로 기록된다.

**Auth:** admin 권한 필요 (403 if not admin)

**Response `200`**
```json
{
  "ok": true,
  "users": 5
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

### `GET /api/market/macro-signals`

FRED 매크로 신호 4종 시계열 + 핵심 신호 플래그. `market_cache`에 저장된 값만 반환하며 요청 경로에서 라이브 FRED 호출은 없다(데이터는 `macro_signals_fetch` 일배치/수동 refresh가 채운다). 저장값이 없으면 각 시리즈는 빈 배열, `signals`는 `{}`.

**Response `200`**
```json
{
  "yield_curve": [{ "date": "2026-06-13", "value": 0.32 }],
  "hy_spread":   [{ "date": "2026-06-13", "value": 3.18 }],
  "m2":          [{ "date": "2026-05-01", "value": 21800.0 }],
  "fed_funds":   [{ "date": "2026-06-13", "value": 4.33 }],
  "signals": {
    "inverted": false,
    "credit_stress": false,
    "yield_curve_latest": 0.32,
    "hy_spread_latest": 3.18
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `yield_curve` | object[] | 10Y-2Y 국채 금리차(FRED `T10Y2Y`, 일간 %p). `value<0`이면 수익률곡선 역전 |
| `hy_spread` | object[] | ICE BofA US HY OAS(FRED `BAMLH0A0HYM2`, 일간 %). 급확대 시 신용 스트레스 |
| `m2` | object[] | M2 통화량(FRED `M2SL`, 월간 십억달러) |
| `fed_funds` | object[] | 연방기금 실효금리(FRED `DFF`, 일간 %) |
| `signals.inverted` | boolean \| null | 최신 금리차 `<0`(침체 경고). 시리즈 없으면 `null` |
| `signals.credit_stress` | boolean \| null | 최신 HY 스프레드 `≥5.0%`(신용 스트레스 임계). 시리즈 없으면 `null` |
| `signals.yield_curve_latest` | number \| null | 최신 금리차 값 |
| `signals.hy_spread_latest` | number \| null | 최신 HY 스프레드 값 |

각 시계열 항목은 `{ "date": "YYYY-MM-DD", "value": number }` 형태.

---

### `POST /api/market/refresh-macro-signals`

FRED 매크로 신호 4종(`T10Y2Y`/`BAMLH0A0HYM2`/`M2SL`/`DFF`) 수동 재수집. 마지막 저장일 이후만 증분 조회해 `market_cache`에 병합 저장하고, 신호 플래그를 재평가한다. 실행이력은 일배치와 동일한 `macro_signals_fetch` id로 기록한다.

**Auth:** admin 권한 필요

**Response `200`**
```json
{
  "ok": true,
  "yield_curve_points": 760,
  "signals": {
    "inverted": false,
    "credit_stress": false,
    "yield_curve_latest": 0.32,
    "hy_spread_latest": 3.18
  }
}
```

> `FRED_API_KEY` 미설정 시 수집은 실패하며 저장값은 변경되지 않는다.

---

### `POST /api/market/refresh-earnings`

시장별 실적 데이터 재수집. `?market=KR`은 KR Top2(삼성전자·SK하이닉스)를, `?market=US`는 M7을 갱신하며, 각 시장은 자기 배치 id(`earnings_kr`/`earnings_us`)로 실행이력을 기록한다.

**Auth:** admin 권한 필요

**Query Parameter**

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|---------|------|------|--------|------|
| `market` | string | — | `KR` | `KR`(KR Top2) \| `US`(M7) |

**Response `200`** — `market`에 따라 필드가 달라진다.
```json
{ "ok": true, "market": "KR", "kr_quarters": 16 }
```
```json
{ "ok": true, "market": "US", "m7_quarters": 20 }
```

**Error `400`** — `market`이 `KR`/`US`가 아님

---

### `POST /api/market/refresh-econ`

FRED 경제지표(CPI, 실업률) 단독 재수집. 별도 배치 id 없이 해외 월간 배치 `monthly_us`로 흡수 기록한다(`refresh-monthly?market=US`와 동일 동작).

**Auth:** admin 권한 필요

**Response `200`**
```json
{
  "ok": true,
  "cpi_points": 36,
  "unemp_points": 36
}
```

---

### `POST /api/market/refresh-monthly`

시장별 월간 지표 재수집. `?market=KR`은 KR 수출을, `?market=US`는 FRED 경제지표(CPI·실업률)를 갱신하며, 각 시장은 자기 배치 id(`monthly_kr`/`monthly_us`)로 실행이력을 기록한다.

**Auth:** admin 권한 필요

**Query Parameter**

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|---------|------|------|--------|------|
| `market` | string | — | `US` | `KR`(KR 수출) \| `US`(FRED 경제지표) |

**Response `200`** — `market`에 따라 필드가 달라진다.
```json
{ "ok": true, "market": "KR", "export_points": 60 }
```
```json
{ "ok": true, "market": "US", "cpi_points": 36, "unemp_points": 36 }
```

**Error `400`** — `market`이 `KR`/`US`가 아님

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


### `GET /api/market/lending`

금융위원회 공공데이터 API에서 적재한 내외국인 대차잔고(대여·차입) 시계열을 반환한다. `market_lending_balance` 테이블의 최근 36개월치를 날짜 오름차순으로 읽으며, 잔고 금액은 백만 단위(`/1_000_000`)로 환산된다. 수급지표 탭 `LendingSection`이 소비한다.

**Auth:** 불필요

**Response `200`**
```json
{
  "history": [
    {
      "date": "2026-05-01",
      "domestic_borrow": 12.34,
      "foreign_borrow": 56.78,
      "domestic_lend": 9.01,
      "foreign_lend": 23.45,
      "borrow_foreign_ratio": 82.1
    }
  ],
  "latest": {
    "date": "2026-05-01",
    "domestic_borrow": 12.34,
    "foreign_borrow": 56.78,
    "domestic_lend": 9.01,
    "foreign_lend": 23.45,
    "borrow_foreign_ratio": 82.1
  }
}
```

> 적재 데이터가 없으면 `{ "history": [], "latest": null }`을 반환한다.

### `POST /api/market/lending/sync`

금융위원회 대차잔고 API(`GetStocLendBorrInfoService_V2`)에서 전체 페이지를 조회해 `market_lending_balance`에 upsert한다. 실행이력은 `lending_fetch` 배치 id(manual lane)로 기록한다. `KOFIA_API_KEY` 필요.

**Auth:** admin 권한 필요 (403 if not admin)

**Response `200`**
```json
{ "ok": true, "rows": 222 }
```

> `rows`는 upsert한 행 수(API에서 받은 `basDt` 8자리 유효 항목 수).

### `GET /api/market/leverage`

KOFIA 통계 API로 적재한 신용잔고·반대매매·시총 시계열(`market_leverage_indicators`)을 읽어 과열/모멘텀 시그널을 계산해 반환한다. 시그널은 전체 기간 기준으로 계산하고, `history`는 최근 90일만 반환한다(신용잔고는 조 원, 미수금·고객예탁금은 억 원 단위 환산). 수급지표 탭 `LeverageSection`이 소비한다.

**Auth:** 불필요

**Response `200`**
```json
{
  "history": [
    {
      "date": "2026-06-19",
      "kospi_credit": 12.34,
      "kosdaq_credit": 5.67,
      "total_credit": 18.01,
      "credit_ratio": 0.7421,
      "liquidation_ratio": 3.12,
      "misu_amt": 1234.5,
      "customer_deposit": 567890.0
    }
  ],
  "signals": {
    "credit_ratio_alert": false,
    "credit_ratio_p90": 0.8123,
    "margin_call_signal": null,
    "credit_momentum": "NEUTRAL"
  },
  "latest": {
    "date": "2026-06-19",
    "kospi_credit": 12.34,
    "kosdaq_credit": 5.67,
    "total_credit": 18.01,
    "credit_ratio": 0.7421,
    "liquidation_ratio": 3.12,
    "misu_amt": 1234.5,
    "customer_deposit": 567890.0
  }
}
```

> `margin_call_signal`은 반대매매 급증 시 `"ALERT"`, 평시 `null`. `credit_momentum`은 `ACCELERATING` \| `DECELERATING` \| `NEUTRAL`. 적재 데이터가 없으면 `history: []`, `latest: null`, 시그널은 기본값을 반환한다.

### `GET /api/market/leverage/coverage`

`market_leverage_indicators`에 적재된 레버리지 데이터의 현황(총 건수, 최소/최대 날짜, 연도별 분포)을 반환한다. 백필 진행 UI(`LeverageBackfillSettings`)가 적재 범위를 표시하는 데 쓴다.

**Auth:** 불필요

**Response `200`**
```json
{
  "total": 1234,
  "min_date": "2021-01-04",
  "max_date": "2026-06-19",
  "by_year": [
    { "year": 2021, "count": 248, "min": "2021-01-04", "max": "2021-12-30" },
    { "year": 2022, "count": 246, "min": "2022-01-03", "max": "2022-12-29" }
  ]
}
```

> 적재 데이터가 없으면 `total: 0`, `min_date`/`max_date`는 `null`, `by_year`는 빈 배열.

### `GET /api/market/leverage/backfill/progress`

진행 중(또는 직전)인 레버리지 백필 작업의 진행상황을 반환한다. 백그라운드 백필 태스크가 갱신하는 인메모리 진행 상태(`_backfill_progress`)를 그대로 노출한다.

**Auth:** 불필요

**Response `200`**
```json
{
  "running": true,
  "done": 2,
  "total": 6,
  "current": "2023년",
  "error": ""
}
```

> `total`은 백필 대상 연도(청크) 수, `done`은 완료된 청크 수, `current`는 처리 중 연도(완료 시 `"완료"`). 특정 연도 수집 실패 시 `error`에 `"<연도>: <메시지>"`가 담긴다. 백필을 한 번도 돌리지 않았으면 `running: false`, `done: 0`, `total: 0`, `current`/`error`는 빈 문자열.

### `POST /api/market/leverage/backfill`

지정 연도 범위(`start_year`~`end_year`)의 신용잔고·반대매매·시총을 KOFIA API에서 백그라운드로 백필한다(이미 DB에 있는 날짜는 건너뜀). 즉시 응답하고 작업은 백그라운드로 진행되며, 진행상황은 `GET /api/market/leverage/backfill/progress`로 폴링한다. 실행이력은 `leverage_fetch` 배치 id(manual lane)로 기록한다. `KOFIA_API_KEY` 필요.

**Auth:** admin 권한 필요 (403 if not admin)

**Request**

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|---------|------|------|--------|------|
| `start_year` | int | — | `2021` | 백필 시작 연도 |
| `end_year` | int | — | `2026` | 백필 종료 연도 |

**Response `200`**
```json
{ "ok": true, "start_year": 2021, "end_year": 2026 }
```

**Error `409`** — 이미 백필이 실행 중(`{"detail": "이미 백필이 실행 중입니다."}`)

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

보유종목 섹터 모멘텀 분석. TTL 300s 캐시. `market` 쿼리 파라미터로 시장을 분기한다.

**Query Parameters**

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `market` | string | `"US"` | `"US"`(미지정 포함) = 섹터 ETF 기반 yfinance 경로. `"KR"` = 키움 KRX 업종 지수 모멘텀(배치 사전계산값) |

**`market=US`(기본)** — 섹터 ETF(XLK, XLV 등 11종) 기반 모멘텀 데이터와 보유종목의 섹터 배분을 결합.

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

**`market=KR`** — 키움 업종 지수(KRX KOSPI 업종) 모멘텀. `kr_sector_fetch` 배치가 사전계산해 `market_cache`에 저장한 값을 읽고(배치 미실행 시 `sectors`는 빈 배열), 보유 KR 종목을 업종에 매핑해 함께 반환한다.

**Response `200`**
```json
{
  "sectors": [
    {
      "name": "전기/전자",
      "code": "013",
      "return_1w": 1.8,
      "return_1mo": 4.2,
      "return_3mo": 9.5
    }
  ],
  "portfolio_sectors": {
    "005930": "전기/전자"
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `sectors` | object[] | KRX 업종별 모멘텀. `name`(업종명) · `code`(키움 업종코드) · `return_1w`/`return_1mo`/`return_3mo`(1주/1개월/3개월 수익률 %, 데이터 부족 시 `null`) |
| `portfolio_sectors` | object | `{보유 KR 종목코드: 업종명}`. 업종 미상 종목은 키 누락(비-KR 종목은 미포함) |

---

### `POST /api/analysis/sector/refresh-kr`

KR 업종 모멘텀 수동 갱신. 전 KRX 업종의 키움 지수 series를 다시 받아 모멘텀을 계산·저장(`market_cache`)하고 섹터 캐시를 무효화한다. `kr_sector_fetch` 배치와 동일 본문을 수동 실행하는 엔드포인트.

**Auth:** admin 권한 필요

**Response `200`**
```json
{ "ok": true, "sectors": 24 }
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `ok` | boolean | 성공 여부 |
| `sectors` | int | 갱신·저장된 업종 수 |

**Error `500`** — 키움 조회/저장 실패 시 `detail`에 사유 포함

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

## Recommendations (종목 추천·발굴)

2단 깔때기·점진 유니버스로 정량 점수를 사전계산(배치)해 `stock_recommendations`에 저장하고, 조회는 저장값만 읽는다(요청 경로 외부 호출 0). 점수는 종목 공유(per-ticker)이고, 섹션은 요청 시 호출자 추적종목 기준으로 분기한다(ADR-0015 §6). 응답은 섹션 키 객체(additive).

### `GET /api/recommendations`

발굴·관심·보유 액션 세 섹션 반환. `discovery`는 글로벌 점수 유니버스에서 호출자 추적종목(보유+관심)을 제외하고 점수 내림차순으로 반환한다(저유동성 종목은 점수·저장은 유지하되 `discovery`에서만 제외 — `watchlist`/`holdings`엔 미적용). `watchlist`는 호출자 관심종목을 저장 점수로 점수 내림차순 정렬해 반환한다(점수 없는 관심종목은 `score=null`로 말미 append). `holdings`는 호출자 보유종목에 저장 EOD 가격·저장 FX로 계산한 비중·평가손익을 붙이고 정량 점수 기반 행동(`action`=추매/익절/홀딩)과 한국어 사유를 도출해 반환한다. 새 점수 계산 없이 저장값만 재사용한다.

**인증**: 필요 (로그인 사용자).

**쿼리 파라미터**

| 파라미터 | 타입 | 기본 | 설명 |
|----------|------|------|------|
| `limit` | int (1~200) | 50 | 발굴(`discovery`) 항목 상한 (`watchlist`엔 미적용) |

**응답** `200 OK`

```json
{
  "as_of": "2026-06-18",
  "discovery": [
    {
      "ticker": "AAPL",
      "name": "Apple",
      "market": "US",
      "score": 88.0,
      "flags": [{ "label": "목표가 대비 +20%", "kind": "value" }],
      "rank": 1,
      "exchange": ""
    }
  ],
  "watchlist": [
    {
      "ticker": "005930",
      "name": "삼성전자",
      "market": "KR",
      "score": 75.0,
      "flags": [],
      "rank": 2,
      "exchange": "KS"
    }
  ],
  "holdings": [
    {
      "ticker": "TSLA",
      "name": "Tesla",
      "market": "US",
      "score": 82.0,
      "flags": [{ "label": "12개월 모멘텀 +35%", "kind": "momentum" }],
      "rank": 5,
      "exchange": "",
      "action": "추매",
      "reasons": ["점수 82점(>= 70)으로 매력 상위", "비중 6.2%(< 10%)로 추가 여력 있음"],
      "pnl_pct": 24.3,
      "weight_pct": 6.2
    }
  ]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `as_of` | string\|null | 발굴+관심+보유 항목 중 최신 `base_date`(ISO date), 없으면 `null` |
| `discovery` | object[] | 발굴 종목(점수 내림차순, 추적종목 제외) |
| `discovery[].score` | number | 정량 점수 0~100 |
| `discovery[].flags` | object[] | 정량 근거 `{label, kind}`. `kind`=팩터군(`value`\|`momentum`\|`smart_money`\|`missing`), 색 아님 |
| `discovery[].rank` | int\|null | 시장 내 점수 내림차순 순위(1-base) |
| `discovery[].exchange` | string | 거래소 코드(KR=`KS`\|`KQ`, US=`""`). 결측 시 `""` |
| `watchlist` | object[] | 호출자 관심종목 재정렬(점수 내림차순). 항목 shape는 `discovery`와 동일. 점수 없는 관심종목은 `score=null`·`flags=[]`·`rank=null`로 말미 append |
| `holdings` | object[] | 호출자 보유종목 액션. 기본 shape는 `discovery`와 동일하며 아래 4필드 추가. 점수 없는 보유종목은 `score=null`·`flags=[]`·`rank=null`. 보유종목 없으면 `[]` |
| `holdings[].action` | string | 행동 신호 `추매`\|`익절`\|`홀딩`(점수·비중·손익 규칙으로 도출, ADR-0015 §5) |
| `holdings[].reasons` | string[] | 행동 근거 한국어 한 줄 목록(정량 사유). 데이터 부족 시 `["데이터 부족"]` |
| `holdings[].pnl_pct` | number\|null | 평가손익률(%). 가격·평단가 결측 시 `null` |
| `holdings[].weight_pct` | number\|null | 포트폴리오 내 KRW 환산 비중(%). 가치 환산 불가 시 `null` |

### `POST /api/recommendations/refresh`

해당 시장의 추천 점수 배치를 백그라운드로 트리거한다(저장값 재계산).

**인증**: admin 전용.

**쿼리 파라미터**

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `market` | `KR`\|`US` | 예 | 갱신 대상 시장 |

**응답** `202 Accepted`

```json
{ "ok": true }
```

배치 잡 id는 `recommendation_kr`/`recommendation_us`로 `job_runs`에 기록된다.

---

## Rankings

### `GET /api/rankings`

KR/US 시장 랭킹 조회. 배치가 사전계산해 `market_rankings` 테이블에 저장한 값을 읽는다 (요청 경로 라이브 호출 없음). 랭킹 탭이 거래대금·거래량·등락률 상위 종목을 카드 그리드로 표시할 때 사용. 무한스크롤용 `limit`/`offset` 지원.

**Auth:** 불필요

**Request**

| 쿼리 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `market` | string | `KR` | 시장 (`KR` \| `US`) |
| `metric` | string | `value` | 랭킹 기준 (`value`=거래대금 \| `volume`=거래량 \| `change`=등락률 상승) |
| `type` | string | `all` | 종목 유형 필터 (`all` \| `stock` \| `etf`, `is_etf` 기준) |
| `limit` | int | `20` | 페이지 크기 (1~200) |
| `offset` | int | `0` | 오프셋 (0 이상) |

허용 외 값은 `400`. (`market` is not KR/US → `market must be KR or US`, `metric` 오류 → `metric must be value, volume, or change`, `type` 오류 → `type must be all, stock, or etf`)

**Response `200`**
```json
{
  "items": [
    {
      "rank": 1,
      "ticker": "005930",
      "name": "삼성전자",
      "price": 71000.0,
      "change_pct": 1.43,
      "trading_value": 1234567890.0,
      "trading_volume": 12345678,
      "market_cap": 423000000000000.0,
      "is_etf": false,
      "exchange": "KOSPI"
    }
  ],
  "base_ts": "2026-06-21T16:00:00",
  "market": "KR",
  "metric": "value"
}
```
`base_ts`는 데이터 기준 시각 ISO 문자열(데이터 없으면 `null`).

### `POST /api/rankings/refresh`

해당 시장 랭킹을 즉시 재수집해 `market_rankings` 테이블을 교체한다 (KR=키움, US 소스). `job_runs`에 시장별 id(`kr_rankings_fetch`/`us_rankings_fetch`)로 manual 실행 기록.

**Auth:** admin 권한 필요 (`403` if not admin)

**Request**

| 쿼리 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `market` | string | `KR` | 시장 (`KR` \| `US`) |

허용 외 `market`은 `400` (`market must be KR or US`).

**Response `200`**
```json
{ "ok": true, "market": "KR" }
```

---

## Investor (수급 스크리닝)

### `GET /api/investor/screening`

KR 랭킹 universe 종목별 최신 수급(외국인/기관/개인 순매수 + 외국인 보유율)을 외국인 보유율 내림차순으로 조회. 수급 스크리닝 화면이 사용하며, `market_investor_trend` 테이블의 종목별 최신 `base_date` 행을 읽는다. 무한스크롤용 `limit`/`offset` 지원.

**Auth:** 불필요

**Request**

| 쿼리 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `limit` | int | `50` | 페이지 크기 (1~200) |
| `offset` | int | `0` | 오프셋 (0 이상) |

**Response `200`**
```json
{
  "items": [
    {
      "ticker": "005930",
      "name": "삼성전자",
      "base_date": "2026-06-20",
      "foreign_net": 1234567,
      "organ_net": -234567,
      "individual_net": -1000000,
      "foreign_hold_ratio": 52.34,
      "close_price": 71000
    }
  ],
  "latest_date": "2026-06-20"
}
```
`latest_date`는 반환 items 중 가장 최근 `base_date`(없으면 `null`). 순매수/종가는 정수, 보유율은 float, 결측은 `null`.

### `POST /api/investor/refresh`

KR 랭킹 종목 수급 추이를 백그라운드로 갱신한다 (스케줄러 `_investor_trend_work` 로직). 즉시 `202`로 응답하고 수집은 BackgroundTask로 비동기 수행하며, `job_runs`에 `investor_trend_fetch` manual로 기록.

**Auth:** admin 권한 필요 (`403` if not admin)

**Response `202`**
```json
{ "ok": true }
```

---

## Events (행동 로그)

### `POST /api/events`

사용자 행동 이벤트를 수집해 `user_events` 테이블에 비동기 저장(BackgroundTask). `event_name`은 화이트리스트(`VALID_EVENTS`)로 검증하며, **허용 외 이벤트는 저장 없이 조용히 `{ "ok": true }` 반환**(에러 아님). 허용 이벤트: `nav_portfolio`, `nav_research`, `nav_market`, `nav_guru`, `nav_settings`, `tab_holdings`, `tab_watch`, `tab_analysis`, `tab_dash`, `tab_reports`, `tab_digest`, `tab_calendar`, `tab_ranking`, `report_view_open`, `report_tab_switch`, `ranking_row_click`, `stock_search`.

**Auth:** Bearer token 필요

**Request Body**
```json
{
  "event_name": "report_view_open",
  "properties": { "ticker": "005930" }
}
```
`properties`는 선택(기본 `{}`).

**Response `200`**
```json
{ "ok": true }
```
(화이트리스트 통과 여부와 무관하게 항상 `{ "ok": true }`. 저장은 admin이 `GET /api/admin/analytics`로 집계 조회.)

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

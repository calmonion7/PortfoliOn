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
- [Analyst Reports (애널리스트 리포트 발행물)](#analyst-reports-애널리스트-리포트-발행물)
- [Tech Reports (선도기술 리포트)](#tech-reports-선도기술-리포트)
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

Google OAuth 콜백. 처리 후 `?oauth=<code>` 쿼리 파라미터와 함께 프론트엔드로 리다이렉트(토큰은 실리지 않는다 — 프론트가 그 code를 `GET /api/auth/oauth/token`으로 교환한다, 아래 참조).

---

### `GET /api/auth/oauth/github`

GitHub OAuth 로그인 시작. GitHub 로그인 페이지로 리다이렉트.

---

### `GET /api/auth/oauth/github/callback`

GitHub OAuth 콜백. 처리 후 `?oauth=<code>` 쿼리 파라미터와 함께 프론트엔드로 리다이렉트(토큰은 실리지 않는다 — 프론트가 그 code를 `GET /api/auth/oauth/token`으로 교환한다, 아래 참조).


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

### `GET /api/admin/analyst-targets`

**전역** 자동 발행 대상 목록 (task#224). `analyst_target`은 `tickers` 공유 마스터 플래그이므로, 세션 스코프인 `GET /api/stocks`(본인 보유·관심)로는 **타 사용자 종목에 켜진 지정이 보이지 않아 해제도 못 한다** — 이 엔드포인트는 소유자와 무관하게 지정된 전 종목을 반환한다. admin 화면의 "자동 발행 대상 관리" 목록이 이걸 쓴다.

**Auth:** admin Bearer token (`require_admin`) — 화면 전용, API 키 불가

**Response `200`**
```json
[
  { "ticker": "035420", "name": "NAVER", "market": "KR" },
  { "ticker": "GOOGL", "name": "Alphabet Inc.", "market": "US" }
]
```

`name`이 비면 ticker로, `market`이 비면 `"US"`로 폴백. 정렬은 ticker 오름차순.

---

### `PUT /api/admin/analyst-targets/{ticker}`

애널리스트 리포트 **자동 발행 대상** 지정/해제 (전역 opt-in, task#214). 루틴은 `analyst_target=true`인 종목만 자동 발행 후보로 삼는다(목록이 비면 자동 발행 스킵). 보유·관심 무관 지정 가능.

**Auth:** admin Bearer token 또는 `X-API-Key` (`require_admin_or_api_key`)

**Request Body**
```json
{ "enabled": true }
```

**Response `200`**
```json
{ "ok": true, "ticker": "005930", "analyst_target": true }
```

**Error `404`** — 종목 마스터(`tickers`)에 없는 종목

---

### `POST /api/admin/cowork/fire`

Claude Code 루틴 수동 fire (ADR-0028 이벤트 구동 분석 파이프라인). 일일 배치 완료 시 자동 fire되는 것과 같은 루틴을 즉시 깨운다. `text` 생략/빈값이면 기본 본문 사용 — **정책을 여기 열거하지 않고** "프롬프트(`scripts/cowork-routine-prompt.md`)에 정의된 전 정책을 순서대로 검토해 수행하라"만 지시한다(task#279 — 트리거 본문이 정책을 열거하면 프롬프트의 "트리거 우선" 규칙 때문에 stale 목록이 정본을 이겨버린다). 정책 정본(enrich 회전 갱신·애널리스트 리포트 발행·선도기술 리포트 발행 3종의 조건·상한)은 프롬프트 파일에만 있다.

**Auth:** admin Bearer token 또는 `X-API-Key` (`require_admin_or_api_key`)

**Request Body**
```json
{ "text": "005930 enrich 후 애널리스트 리포트 발행" }
```

**Response `200`**
```json
{ "ok": true, "text": "005930 enrich 후 애널리스트 리포트 발행" }
```
(`text` 생략/빈값이면 응답은 `{ "ok": true, "text": "수동 트리거 — 프롬프트에 정의된 전 정책을 순서대로 검토해 수행하라." }`)

**Error `503`** — `COWORK_ROUTINE_FIRE_URL`/`COWORK_ROUTINE_FIRE_TOKEN` 미설정 (휴면)
**Error `502`** — fire POST 실패 (서버 로그 확인)

---

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
      "target_price": 220.0,
      "stop_price": 140.0,
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
  "target_price": 220.0,
  "stop_price": 140.0,
  "competitors": ["MSFT", "GOOGL"],
  "moat": "생태계 락인",
  "growth_plan": "서비스 매출 확대",
  "market": "US",
  "exchange": "",
  "security_type": "EQUITY"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `ticker` | string | ✅ | 종목 코드 (strip·자동 대문자 변환, `^[A-Za-z0-9.\-]{1,15}$` 형식 검증 — 공백/잡문자/빈값/과길이 거부) |
| `name` | string | ✅ | 종목명 |
| `quantity` | float | ✅ | 보유 수량 |
| `avg_cost` | float | ✅ | 평균 매입 단가 |
| `target_price` | float\|null | ❌ | 사용자 목표가(익절, native 통화, 기본값: `null`) — 애널리스트 컨센서스 목표가와 별개 |
| `stop_price` | float\|null | ❌ | 사용자 손절가(native 통화, 기본값: `null`) |
| `competitors` | string[] | ❌ | 경쟁사 티커 목록 (기본값: `[]`) |
| `moat` | string | ❌ | 경제적 해자 설명 (기본값: `""`) |
| `growth_plan` | string | ❌ | 성장 계획 메모 (기본값: `""`) |
| `market` | string | ❌ | 시장 구분 `US`\|`KR` (기본값: `"US"`) |
| `exchange` | string | ❌ | KR 거래소 접미사 `KS`\|`KQ`(yfinance/키움 심볼용, 기본값: `""`) |
| `security_type` | string | ❌ | 증권 유형 `EQUITY`\|`ETF` (기본값: `"EQUITY"`) — `ETF`면 컨센서스 백필 없이 리포트만 생성 |

**Response `201`**
```json
{
  "ticker": "AAPL",
  "quantity": 10,
  "avg_cost": 150.0,
  "target_price": 220.0,
  "stop_price": 140.0,
  "market": "US",
  "exchange": "",
  "name": "Apple Inc.",
  "competitors": ["MSFT", "GOOGL"],
  "moat": "생태계 락인",
  "growth_plan": "서비스 매출 확대",
  "report_queued": true
}
```

`report_queued` — 해당 시장의 기대 리포트 날짜(`expected_report_date`)에 스냅샷이 이미 있으면 `false`(신규 생성 큐잉 안 함), 없으면 `true`.

**Error `400`** — 이미 보유 중인 ticker

**Error `422`** — `ticker`가 `^[A-Za-z0-9.\-]{1,15}$` 형식이 아닌 경우 (공백/잡문자/빈값/과길이) · `quantity`/`avg_cost`/`target_price`/`stop_price`가 NaN/Infinity인 경우 · KR 상장폐지 종목(등록 불가)

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

### `GET /api/portfolio/dividends`

보유·관심 종목의 **다가오는 배당 스케줄**(향후 12개월)을 배당락일 오름차순으로 조회 + 보유 종목의 12개월 예상 수령액(KRW 환산 합계). 배치(`dividend_fetch`)가 사전계산한 `stock_dividend_schedule`을 읽으며 **요청 경로 라이브 호출 0**. KR/그 외는 이력 기반 **예상(projected)**, US는 `t.calendar` 최근접 건을 **확정(confirmed)**+지급일로 보강한다(ADR-0023). 지급일(`pay_date`)은 US만, KR은 `null`.

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "items": [
    {
      "ticker": "005930",
      "name": "삼성전자",
      "market": "KR",
      "stock_type": "holding",
      "ex_date": "2026-09-26",
      "pay_date": null,
      "amount_per_share": 372.0,
      "currency": "KRW",
      "status": "projected",
      "quantity": 100,
      "expected_amount": 37200.0
    },
    {
      "ticker": "AAPL",
      "name": "Apple",
      "market": "US",
      "stock_type": "watchlist",
      "ex_date": "2026-08-20",
      "pay_date": "2026-08-25",
      "amount_per_share": 0.27,
      "currency": "USD",
      "status": "confirmed",
      "quantity": null,
      "expected_amount": null
    }
  ],
  "summary": {
    "total_expected_12m_krw": 37200.0,
    "holdings_with_dividend": 1,
    "fx_usdkrw": 1385.2
  }
}
```

관심 종목(`stock_type: "watchlist"`)은 수량이 없어 `quantity`·`expected_amount`가 `null`. `total_expected_12m_krw`는 보유 종목의 예상 수령액을 KRW로 환산한 합계(US$는 저장 FX `fx_usdkrw`로 환산, FX 없으면 해당 US 종목은 합계서 제외).

---

### `GET /api/portfolio/rebalance`

보유 종목의 목표 비중(사용자 설정) 대비 현재 비중 드리프트 + 목표 도달 조정금액(KRW)을 계산. 스코프는 보유 종목만(현금·관심종목 제외). **주문 실행은 범위 밖 — 읽기전용 계산기.**

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "holdings": [
    {
      "ticker": "AAPL",
      "name": "Apple",
      "market": "US",
      "current_value_krw": 2500000,
      "current_weight": 41.7,
      "target_weight": 40.0,
      "drift_pp": 1.7,
      "suggested_trade_krw": -100000,
      "suggested_shares": -1,
      "untargeted": false,
      "no_fx": false
    },
    {
      "ticker": "035420",
      "name": "NAVER",
      "market": "KR",
      "current_value_krw": 1500000,
      "current_weight": 25.0,
      "target_weight": null,
      "drift_pp": null,
      "suggested_trade_krw": null,
      "suggested_shares": null,
      "untargeted": true,
      "no_fx": false
    }
  ],
  "summary": {
    "total_value_krw": 6000000,
    "raw_target_sum": 40.0,
    "untargeted_weight_sum": 25.0,
    "allocation_sum": 65.0,
    "has_untargeted": true,
    "has_no_fx": false
  }
}
```

현재 비중은 **전체 포트폴리오 기준**이다 — KRW 환산 가능한 모든 보유(타겟·미설정 무관, `no_fx` 제외)가 분모. 타겟 설정 종목만 드리프트/제안을 계산하고, 미설정 종목은 실제 비중만 표시하며 제안은 없다(hold). 타겟은 전체 포트 대비 %라 정규화하지 않는다.

| 필드 | 설명 |
|------|------|
| `holdings[].name` | 종목명(공유 마스터 `tickers.name`) |
| `holdings[].current_value_krw` | 현재 평가액(KRW 환산). US는 저장 FX(`market_cache` 'fx') 사용, 없으면 `no_fx=true`로 계산 제외 |
| `holdings[].current_weight` | **전체 포트폴리오** 대비 현재 비중(%). 미설정 종목도 표시됨. `no_fx` 종목만 `null` |
| `holdings[].target_weight` | 사용자가 설정한 목표 비중(%, 전체 포트 대비) — 미설정 시 `null`(`untargeted=true`). 정규화하지 않음 |
| `holdings[].drift_pp` | 현재 비중 − 목표 비중(퍼센트 포인트). 양수=과체중(매도), 음수=저체중(매수). 미설정/no_fx 시 `null` |
| `holdings[].suggested_trade_krw` | 목표 도달을 위한 조정금액(KRW). 양수=매수, 음수=매도. 미설정/no_fx 시 `null` |
| `holdings[].suggested_shares` | 조정 주식 수(현재가 기준 반올림한 정수). 미설정/no_fx 시 `null` |
| `holdings[].untargeted` | 목표 비중 미설정 종목 여부. 현재 비중은 표시되나 제안은 없음(hold) |
| `holdings[].no_fx` | US 종목인데 저장 FX가 없어 KRW 환산 불가(비중·계산 제외) |
| `summary.total_value_krw` | **전체 포트폴리오** 총 평가액(`no_fx` 제외 모든 보유) |
| `summary.raw_target_sum` | 사용자가 설정한 목표 비중 원값의 합(정규화하지 않음) |
| `summary.untargeted_weight_sum` | 미설정 종목들의 현재 비중 합 |
| `summary.allocation_sum` | 설정 타겟 + 미설정 현재비중 합. 100%면 포트 전액 배분(`no_fx` 제외) |

---

### `GET /api/portfolio/exposure`

보유 종목의 통화(시장)·섹터·단일종목 3축 노출·집중도를 전체 포트폴리오 KRW 환산 비중으로 계산. 스코프는 보유 종목만(관심종목 제외). 임계 초과 시 경고 플래그(단일종목·섹터)를 반환한다.

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "holdings": [
    { "ticker": "AAPL", "name": "Apple", "market": "US", "value_krw": 2500000, "weight": 41.7 },
    { "ticker": "035420", "name": "NAVER", "market": "KR", "value_krw": 1500000, "weight": 25.0 }
  ],
  "currency": {
    "US": { "value_krw": 2500000, "weight": 41.7 },
    "KR": { "value_krw": 1500000, "weight": 25.0 }
  },
  "sector": {
    "Technology": { "value_krw": 2500000, "weight": 41.7 },
    "기타": { "value_krw": 1500000, "weight": 25.0 }
  },
  "concentration": {
    "top3_pct": 66.7,
    "top5_pct": 66.7,
    "max_single": { "ticker": "AAPL", "weight": 41.7 }
  },
  "warnings": {
    "single_name": true,
    "sector": true
  },
  "portfolio_beta": 1.15,
  "beta_coverage_pct": 41.7,
  "beta_covered_count": 1,
  "beta_missing": ["035420"],
  "no_fx": {
    "tickers": ["MSFT"],
    "count": 1
  }
}
```

비중 기준은 리밸런싱과 동일한 **전체 포트폴리오 KRW 환산 분모**다(`no_fx` 종목 제외). 섹터를 모르는 종목(리포트 미생성 US·업종 역인덱스 배치 전 KR)은 `기타`로 묶인다.

| 필드 | 설명 |
|------|------|
| `holdings[]` | 종목별 비중 내림차순. `no_fx` 종목은 제외 |
| `currency` | `market`(KR/US) 기준 그룹 합. 정보성 표시 — 경고 없음 |
| `sector` | 섹터별 그룹 합(미상은 `기타`) |
| `concentration.top3_pct` / `top5_pct` | 비중 상위 3/5종목 합(%) |
| `concentration.max_single` | 최대 비중 단일종목(`ticker`, `weight`). 보유 없으면 `null` |
| `warnings.single_name` | 어떤 종목이든 비중 25% 초과 시 `true` |
| `warnings.sector` | 어떤 섹터든 비중 40% 초과 시 `true` |
| `portfolio_beta` | `stock_beta`(사전계산 저장값) 기준 베타 있는 보유의 비중가중평균. 커버 0이면 `null` |
| `beta_coverage_pct` | 베타 커버된 보유 비중 합 / 전체 비중 합(%) |
| `beta_covered_count` | 베타가 있는 보유 종목 수 |
| `beta_missing` | 베타 없는 보유 종목 티커 목록 |
| `no_fx.tickers` / `count` | 저장 FX 없어 KRW 환산 불가한 US 종목 목록/개수(집계에서 제외됨) |

---

### `PUT /api/portfolio/rebalance/targets`

보유 종목별 목표 비중(%)을 배치 저장. 값이 `null`이면 해당 종목의 목표 비중을 삭제(컬럼 NULL). 합은 100이 아니어도 저장 가능(정규화하지 않음). 보유 중이 아닌 티커는 무시된다.

**Auth:** Bearer token 필요

**Request Body** — ticker → 목표 비중(%) 맵. 값 `null`은 타겟 삭제.
```json
{
  "AAPL": 40,
  "005930": 60,
  "035420": null
}
```

**Response `200`**
```json
{
  "updated": 2,
  "targets": {
    "AAPL": 40,
    "005930": 60
  }
}
```

**Error `422`** — 목표 비중 값이 NaN/Infinity인 경우(`null`은 삭제 의미로 허용, 그 외 값은 유한해야 함)

---

### `PATCH /api/portfolio/{ticker}/pin`

추적 종목(보유/관심 무관)의 고정핀 토글. 리포트 목록에서 현재 뷰 안 최상단 정렬용 표시일 뿐, 정렬 자체는 프론트에서 처리한다.

**Auth:** Bearer token 필요

**Request Body**
```json
{ "pinned": true }
```

**Response `200`**
```json
{ "ticker": "AAPL", "pinned": true }
```

**Response `404`** — 해당 유저의 보유/관심 종목이 아님

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
**Error `422`** — `quantity`/`avg_cost`가 0 이하이거나 NaN/Infinity인 경우

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

**Auth:** 어드민 JWT 또는 `X-API-Key`(Cowork) 필요 (`require_admin_or_api_key`) — 일반 사용자 JWT는 403 (task#108)

**Path Parameter:** `ticker` — 종목 코드

**Request Body**
```json
{
  "moat": "브랜드 파워, 네트워크 효과",
  "growth_plan": "AI 서비스 확대",
  "risks": "규제 리스크, 경쟁 심화, 매크로 불확실성",
  "recent_disclosures": "2024-11-01: 4분기 실적 가이던스 상향...",
  "key_resource": {
    "resource": "인력 (Human Capital)",
    "thesis": "우수 인력 확보·유지가 경쟁력의 핵심",
    "metrics": [
      { "label": "직원수", "unit": "명", "series": [{"period": "2025Q1", "value": 1200}] }
    ],
    "drivers": [
      { "title": "스톡옵션·RSU", "description": "핵심인력 리텐션용 주식보상 규모/조건" }
    ],
    "one_liner": "1인당 생산성은 상승세이나 이직률 관리가 관건"
  },
  "competitor_edge": {
    "axis": "원가경쟁력",
    "entries": [
      { "ticker": "MSFT", "edge": "클라우드 인프라 규모의 경제 우위", "position": "동등" }
    ],
    "one_liner": "생태계 락인은 강하나 원가 경쟁력은 대등한 수준"
  },
  "market_outlook": {
    "market_name": "글로벌 AI 서비스 시장",
    "size_current": { "value": 200, "unit": "십억달러", "year": 2025 },
    "size_forecast": { "value": 600, "unit": "십억달러", "year": 2029 },
    "cagr_pct": 31.5,
    "sources": ["Gartner (2026-01)"],
    "one_liner": "AI 서비스 시장은 연 31%대 고성장 국면"
  },
  "competitors": ["MSFT", "GOOGL"]
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `moat` | string | ❌ | 경제적 해자 |
| `growth_plan` | string | ❌ | 성장 계획 |
| `risks` | string | ❌ | 리스크 요인 |
| `recent_disclosures` | string | ❌ | 최근 공시/뉴스 요약 |
| `key_resource` | object | ❌ | 업종별 핵심 자원(인력/생산능력/파이프라인 등) + 분기별 지표 추이 + 유지 동력. 저장 후 리포트 심층분석 탭 "핵심 자원" 섹션에 표시 |
| `key_resource.resource` | string | ❌ | 핵심자원 라벨 (예: `"인력 (Human Capital)"`) |
| `key_resource.thesis` | string | ❌ | 왜 이 자원이 경쟁력인지 한줄 논지 |
| `key_resource.metrics` | `{label, unit, series}[]` | ❌ | 분기별 지표 목록. `series`는 `{period, value}[]`, `period` 형식 `YYYYQn`(예: `"2025Q1"`) |
| `key_resource.drivers` | `{title, description}[]` | ❌ | 자원 유지 동력(리텐션 인센티브) 목록 |
| `key_resource.one_liner` | string | ❌ | 한 줄 종합 요약 |
| `competitor_edge` | object | ❌ | 경쟁사 대비 사업 경쟁력의 상대 위치(업종별 비교축 기준). 저장 후 리포트 심층분석 탭 "경쟁사 기술·경쟁력 비교" 섹션에 표시. **Peer 할인/할증**(밸류에이션 멀티플 기반 자동 계산 상대위치)**과는 별개** |
| `competitor_edge.axis` | string | ❌ | 업종에 맞는 비교축 라벨 (예: `"원가경쟁력"`) |
| `competitor_edge.one_liner` | string | ❌ | 한 줄 종합 요약 |
| `competitor_edge.entries` | `{ticker, name, edge, position}[]` | ❌ | 경쟁사별 비교 목록. `ticker`로 `competitors_data`와 조인 |
| `market_outlook` | object | ❌ | 회사가 속한 전방시장의 규모·성장 전망. 저장 후 리포트 심층분석 탭 "시장 전망" 섹션에 표시. `growth_plan`(회사 전략)**과는 별개** |
| `market_outlook.market_name` | string | ❌ | 시장 정의 (예: `"글로벌 HBM 시장"`) |
| `market_outlook.size_current` | `{value, unit, year}` | ❌ | 현재 시장 규모 |
| `market_outlook.size_forecast` | `{value, unit, year}` | ❌ | 전망 시장 규모 |
| `market_outlook.cagr_pct` | number | ❌ | 연평균 성장률(%) |
| `market_outlook.company_share_pct` | number | ❌ | 회사의 해당 시장 점유율(%) |
| `market_outlook.position` | string | ❌ | 시장 내 위치 (예: `"1위"`) |
| `market_outlook.sources` | string[] | ✅(값 포함 시) | 근거 출처 목록. **출처 없는 값은 저장하지 말 것** |
| `market_outlook.one_liner` | string | ❌ | 한 줄 종합 요약 |
| `market_outlook.segments` | `{name,period,revenue_share_pct,...}[]` | ❌ | 부문별 매출 비중·시장 규모·자사 점유율 분해("사업부문 시장 분석"). 필드 상세·기입 지침은 `CLAUDE_COWORK_API.md` 참조. **`GET /api/report/{ticker}/backlog`의 `segments`(수주잔고 「사업부문 분해」, `{sector,entity,amount}[]`)와는 별개 개념** |
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

**Auth:** 어드민 JWT 또는 `X-API-Key`(Cowork) 필요 (`require_admin_or_api_key`) — 일반 사용자 JWT는 403 (task#108)

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

**Auth:** Bearer token 필요

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

### `GET /api/stocks/compare`

보유+관심 종목 2~4개의 밸류에이션·재무·기술 지표를 최신 스냅샷에서 나란히 비교. 신규 수집 없음(박제 read-only) — 요청경로 라이브 fetch 0.

**Auth:** Bearer token 필요

**Query Parameters**

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `tickers` | string | ✅ | 콤마구분 티커 목록, 최대 4개(초과 시 `400`) |

**Response `200`**
```json
{
  "tickers": [
    {"ticker": "AAPL", "name": "Apple Inc.", "available": true},
    {"ticker": "FAKE", "name": "FAKE", "available": false}
  ],
  "metrics": [
    {
      "key": "per", "group": "valuation", "direction": "lower",
      "values": {"AAPL": 28.5, "FAKE": null},
      "best": ["AAPL"]
    },
    {
      "key": "rsi", "group": "technical", "direction": null,
      "values": {"AAPL": 55.2, "FAKE": null},
      "best": []
    }
  ]
}
```
- `metrics[].key`: `per`·`pbr`·`psr`·`ev_ebitda`·`target_mean`·`upside`(밸류에이션) / `roe`·`operating_margin`·`debt_ratio`·`fcf`(재무) / `rsi`·`week52_position`·`hv`·`beta`(기술).
- `metrics[].direction`: `"lower"`(낮을수록 좋음) / `"higher"`(높을수록 좋음) / `null`(방향 애매 — RSI·베타·52주 위치·목표가는 하이라이트 대상 아님, `best`는 항상 `[]`).
- `metrics[].best`: 결측/비유한 제외 후 방향상 최적값의 ticker 목록(동률은 공동 best). 전부 결측이면 `[]`.
- 스냅샷 없는 ticker는 `available: false` + 모든 지표 `null`(비교 불가 graceful, 예외 없음).
- 목표가(`target_mean`)·상승여력(`upside`)은 `daily_consensus_mart` as-of 정본을 사용(ADR-0008, 스냅샷 동결값 아님).
- 베타(`beta`)는 `stock_beta` 저장값(배치 산출, 요청경로 라이브 계산 없음).

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
      "target_price": 220.0,
      "stop_price": 140.0,
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

| 필드 (사용자 목표가/손절가) | 타입 | 설명 |
|------|------|------|
| `target_price` | float \| null | 사용자 설정 목표가(익절, 종목 통화). 미설정은 `null`. 거리%는 프론트가 `current_price`와 계산해 "목표가까지 +X%"로 표시 — 애널리스트 `target_mean`(컨센서스)과 별개 축 |
| `stop_price` | float \| null | 사용자 설정 손절가(종목 통화). 미설정은 `null` |

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

호출자 자신의 대시보드 인메모리 캐시를 초기화(user_id 스코프 — 전역이 아니다).

**Auth:** Bearer token 필요 (`get_current_user`, task#108)

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

### `POST /api/stocks/beta/refresh`

보유·관심 종목의 베타(시장 민감도)를 시장별 소스에서 전 종목 재수집해 `stock_beta`에 저장. US=yfinance(`beta`, 없으면 `beta3Year` 폴백)·KR=`calc_beta` vs `^KS11`. 백그라운드 실행(`beta_fetch` 배치 manual lane). **admin 전용.**

**Auth:** Bearer token + admin

**Response `202`**
```json
{ "message": "베타 전 종목 수집 시작" }
```

> `beta_fetch` 자동 배치(`GET /api/batches`)와 동일 수집 로직. 결측 종목은 저장하지 않음(빈 박제 방지). 포트폴리오 노출 탭의 베타가중 노출은 이 저장값만 읽는다(요청경로 라이브 계산 없음).

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

**Auth:** Bearer token 필요

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

**Auth:** Bearer token 필요

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

종목 최근 뉴스(최대 10건, 링크 기준 중복제거·published_at 최신순)를 on-demand 조회. 리포트가 없는 랭킹 종목 등에서 쓰며 `scraper.get_news`를 재사용한다(KR=Naver, US=yfinance). 공개 read.

**Auth:** Bearer token 필요

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

**Auth:** Bearer token 필요

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

**Auth:** Bearer token 필요

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

**Auth:** Bearer token 필요

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

**Auth:** Bearer token 또는 `X-API-Key` (`get_current_user_or_api_key`) — Cowork enrich 워크플로우가 읽는다

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
    "one_liner": "AI 수혜 + 서비스 성장 지속",
    "ev_ebitda": 21.4,
    "competitors_data": [
      { "ticker": "AAPL", "name": "Apple Inc.", "price": 227.5, "market_cap": 3450000000000, "ytd_return": 18.2, "is_self": true, "per": 32.1, "pbr": 48.5, "psr": 8.1, "ev_ebitda": 21.4 },
      { "ticker": "MSFT", "name": "Microsoft Corporation", "price": 430.2, "market_cap": 3200000000000, "ytd_return": 15.6, "is_self": false, "per": 34.8, "pbr": 11.2, "psr": 12.3, "ev_ebitda": 24.9 }
    ]
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `content` | string | Markdown 형식의 리포트 본문 |
| `summary` | object \| null | 요약 JSON (없으면 `null`) |
| `summary.ev_ebitda` | number \| null | 해당 종목의 EV/EBITDA 배수. KR·US 모두 yfinance `enterpriseToEbitda` 소스(KR은 task#169부터 채워짐 — 이전엔 항상 `null` 고정, ADR-0024) |
| `summary.competitors_data` | object[] | 경쟁사 비교 데이터. 자기 종목(`is_self: true`)을 포함해 시가총액 내림차순 정렬 |
| `summary.competitors_data[].psr` | number \| null | 주가매출비율(additive, task#169). KR=Naver TTM 계산(메인 종목과 동일 로직), US=yfinance `priceToSalesTrailing12Months` |
| `summary.competitors_data[].ev_ebitda` | number \| null | EV/EBITDA 배수(additive, task#169). KR·US 모두 yfinance `enterpriseToEbitda` (KR은 `.KS`→`.KQ` 순 폴백 조회, 실패 시 `null`) |

> **경쟁사(peer) 멀티플은 이상치가 `null`로 빠질 수 있습니다(task#248, 판정축 교체 task#249)** — `per`·`pbr`·`psr`·`ev_ebitda`는 외부 소스(yfinance·Naver)의 단위 혼선 오값이 파싱을 성공해 들어올 수 있어, 리포트 생성 시 **값이 있는 peer 전체와 자기 종목을 합한 중앙값(기준 표본) 대비 배수가 `[1/5, 5]` 밖인 지표만** 결측 처리합니다(종목 단위 배제가 아니라 지표 단위, wrong<missing). 자기 종목(`is_self: true`)은 **판정 대상은 아니지만 기준 표본에는 포함**되며, 기준 표본이 3개 미만이거나 중앙값이 0 이하면 판정을 생략합니다.

**Error `404`** — 해당 날짜의 리포트 없음

---

### `POST /api/report/{ticker}/refresh-analyst`

특정 종목의 최신 애널리스트 데이터를 yfinance에서 즉시 갱신.

**Auth:** Bearer token 필요 — **호출자의 보유·관심 목록에 있는 종목 또는 admin**만 허용(`get_current_user` + 본문 소유권 검사, task#291, B50 닫힘). `POST /consensus/{ticker}/backfill`과 같은 헬퍼(`report._require_owner_or_admin`)를 쓴다. 검사는 스냅샷 조회보다 먼저라 미소유·비admin 호출은 DB에 닿지 않는다.

**Path Parameter:** `ticker` — 종목 코드

**Response `200`** — 응답은 yfinance에서 실제로 갱신된 필드만 담는다(전부 결측이면 `502`)
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

**Error `403`** — 해당 종목이 호출자의 보유·관심 목록에 없고 admin도 아님
**Error `404`** — 해당 종목의 스냅샷 없음 (리포트를 먼저 생성해야 함)

---

### `GET /api/report/{ticker}/backlog`

종목의 수주잔고(Order Backlog) 분기별 이력 조회. KR 종목 리포트 상세의 '수주잔고 추이' 차트가 사용.

**Auth:** Bearer token 필요

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
| `items[]` | array | 대기 항목 (`ticker`, `quarter`, `raw_text`=재무 컨텍스트+수주 원문 결합, `unit`=원본 단위 — KRW 외 외화 표 캡션이면 `"기타"`) |

> 다중엔티티 연결 종목은 코드가 `dart`+segments로 자동 채워 pending에 없음. `items` 빈 배열이면 대기 없음.

---

### `PUT /api/report/{ticker}/backlog`

Cowork가 추출한 수주잔고 수치를 저장. `source`가 `'pending'`/`'llm'`인 행만 갱신(`'dart'` 보호). **Auth:** admin 로그인 또는 `X-API-Key`.

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

종목의 DART 공시 피드 조회 (최신순). KR 종목 리포트 상세의 '최신 공시' 섹션이 사용. `disclosure_fetch` 배치가 채우는 `stock_disclosures` 테이블에서 읽으며, **Cowork가 enrich하는 `recent_disclosures`(애널리스트 코멘터리)와는 별도 store**다.

**Auth:** Bearer token 필요

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

종목의 내부자·5%지분 변동 공시 피드 + 순매수/순매도 신호 조회 (최신순). KR 종목 리포트 상세의 '내부자·5% 지분변동' 섹션이 사용. `insider_fetch` 배치가 채우는 `stock_insider_trades` 테이블에서 읽으며(DART `elestock.json`=임원·주요주주 소유보고 / `majorstock.json`=5% 대량보유보고 정규화), **Cowork가 enrich하는 `recent_disclosures`(애널리스트 코멘터리)와는 별도 store**다. 저장값만 읽고 요청경로 라이브 DART 호출은 0.

**Auth:** Bearer token 필요

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

### `POST /api/report/agm/refresh`

전 KR 종목(보유+관심) 주총 개최일 재수집(`agm_fetch` 배치 수동 트리거). 백그라운드 실행, 즉시 202. **Auth:** admin.

**Response `202`** — `{ "message": "주총 일시 전 종목 수집 시작" }`

---

### `GET /api/report/{ticker}/us-supply`

종목의 US 공매도 비중 + 기관 보유 스냅샷 조회. `us_supply_fetch` 배치가 채우는 `us_supply_snapshot` 테이블에서 읽으며, 요청경로 라이브 yfinance 호출 없음. KR 종목·무데이터 시 `short: null, institutional: []` graceful. **Auth:** user(API 키 가능).

**Response `200`**
```json
{
  "short": {
    "short_pct_float": 0.0098,
    "short_ratio": 2.5,
    "shares_short": 75000000,
    "date_short_interest": "2026-05-01"
  },
  "institutional": [
    { "holder": "Vanguard Group Inc", "pct_held": 0.0812, "shares": 1234000, "pct_change": 0.002 }
  ],
  "fetched_at": "2026-06-29T06:00:00"
}
```

---

### `POST /api/report/us-supply/refresh`

전 US 종목(보유+관심) 공매도 비중·기관 보유 재수집(`us_supply_fetch` 배치 수동 트리거). 백그라운드 실행, 즉시 202. **Auth:** admin.

**Response `202`** — `{ "message": "US 공매도·기관 보유 전 종목 수집 시작" }`

---

### `GET /api/report/{ticker}/us-insider`

종목의 US 내부자 거래(Form4) 조회. `us_supply_fetch` 배치가 채우는 `us_supply_snapshot.insider_transactions` / `insider_net`에서 읽으며, 요청경로 라이브 yfinance 호출 없음. KR 종목·무데이터 시 `transactions: [], net: {}` graceful. **Auth:** user(API 키 가능).

**Response `200`**
```json
{
  "transactions": [
    {
      "insider": "Tim Cook",
      "position": "CEO",
      "transaction": "Sale",
      "shares": 100000,
      "value": 18500000.0,
      "start_date": "2026-05-10",
      "ownership": "Direct"
    }
  ],
  "net": {
    "net_shares": -95000,
    "pct_buy": 0.0476,
    "pct_sell": 0.9524,
    "total_held": 3200000
  },
  "fetched_at": "2026-06-29T06:00:00"
}
```

---

## Consensus (컨센서스)

### `GET /api/consensus/batch/progress`

컨센서스 일괄 수집 진행 상황 조회.

**Auth:** Bearer token 필요

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

**Auth:** Bearer token 필요

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

**Auth:** Bearer token 필요 — **호출자의 보유·관심 목록에 있는 종목 또는 admin**만 허용(`get_current_user` + 본문 소유권 검사, task#291, B50 닫힘 — 이전엔 인증만 하면 자기 포트폴리오 밖 임의 종목을 백필할 수 있었다). `POST /report/{ticker}/refresh-analyst`와 같은 헬퍼(`report._require_owner_or_admin`)를 쓴다. 검사는 스냅샷 조회보다 먼저라 미소유·비admin 호출은 DB에 닿지 않는다. 프론트 소비처는 `ConsensusChart.jsx`의 「백필」 버튼이며 role 게이팅이 없으므로 admin 전용으로 좁히지 않았다.

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

**Error `403`** — 해당 종목이 호출자의 보유·관심 목록에 없고 admin도 아님
**Error `400`** — 해당 종목의 스냅샷 없음 (리포트를 먼저 생성해야 함)

---

## Analyst Reports (애널리스트 리포트 발행물)

발행물 누적형 애널리스트 리포트 (ADR-0027). 판단·서사(투자의견·논지·적정주가 밴드·산정방식·투자포인트·리스크)는 Cowork가 온디맨드로 제출하고, 숫자 데이터 블록(발행 시점 시세·forward 추정·피어 멀티플·PER 밴드·컨센서스 목표가)은 서버가 그 종목의 **최신 스냅샷**에서 발행 순간 자동 첨부해 문서를 자기완결적으로 박제한다. 문서는 발행 후 불변 — 수정이 필요하면 새 판을 발행(같은 날 재발행만 그날 판을 교체).

### `POST /api/analyst-reports/{ticker}`

애널리스트 리포트 발행. 스냅샷이 없는 종목은 `409`로 거부(데이터 블록을 채울 수 없음 — 먼저 리포트 생성 필요).

**Auth:** `X-API-Key` 또는 admin Bearer token (`require_admin_or_api_key`)

**Path Parameter:** `ticker` — 종목 코드

**Request Body**
```json
{
  "rating": "buy",
  "title": "HBM 증설이 이끄는 실적 재평가",
  "fair_value_low": 80000,
  "fair_value_high": 95000,
  "valuation_method": "과거 5년 PER 밴드 평균 12배에 2026F EPS 적용",
  "points": [
    { "title": "HBM 캐파 2배 증설", "body": "핵심 논리 1~2문장.",
      "metrics": [
        { "label": "2026F 영업이익", "value": "383.2조원", "change_pct": 779.0 },
        { "label": "forward PER", "value": "5.9배" }
      ] },
    { "title": "파운드리 적자 축소", "body": "가동률 회복으로 ..." }
  ],
  "risks": "리스크1 한 문장\n리스크2 한 문장"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `rating` | string | ✅ | 투자의견 — `buy` \| `neutral` \| `sell` |
| `title` | string | ✅ | 한줄 논지 (리포트 제목) |
| `fair_value_low` | number | ✅ | 적정주가 밴드 하단 (≤ high) |
| `fair_value_high` | number | ✅ | 적정주가 밴드 상단 |
| `valuation_method` | string | ✅ | 산정방식 서술 (1~2문장) |
| `points` | array | ✅ | 투자포인트 `{title, body, metrics?}` **2~3개** — `metrics`는 지표 칩 `{label, value, change_pct?}` 최대 4개(additive, 생략 시 `[]`) |
| `risks` | string | ✅ | 리스크 요인 — 줄바꿈(`\n`) 구분 시 불릿 렌더 |

**Response `201`**
```json
{ "ok": true, "ticker": "005930", "published_date": "2026-07-25" }
```

**Error `403`** — Bearer token 인증됐으나 admin 아님
**Error `409`** — 해당 종목의 스냅샷 없음 (발행 전제조건 미충족)
**Error `422`** — rating enum 위반 · points 개수(2~3) 위반 · 밴드 역전(low > high) · NaN/Infinity 값 · 필수 필드 누락

---

### `GET /api/analyst-reports`

발행물 목록 — **종목당 최신 1건**만 (요약, 발행일 최신순). 목록의 정체성은 "그 종목에 대한 현재 판단"이며, 과거 판(이력)은 `GET /api/analyst-reports/{ticker}`가 전 판을 반환한다 (ADR-0027 개정, task#222).

**Auth:** Bearer token 또는 `X-API-Key` (API key는 루틴의 발행 가드레일 판단용, task#213 — 최신 1건이 "최신 발행 7일+ 경과" 판단에 정확한 형태)

**Response `200`**
```json
{
  "reports": [
    {
      "ticker": "005930",
      "published_date": "2026-07-25",
      "rating": "buy",
      "title": "HBM 증설이 이끄는 실적 재평가",
      "fair_value_low": 80000,
      "fair_value_high": 95000,
      "name": "삼성전자",
      "market": "KR"
    }
  ]
}
```

---

### `GET /api/analyst-reports/{ticker}`

종목별 발행 판 **전체** 목록 (최신순). 발행물이 없으면 빈 배열. 문서 상세의 이력 네비게이션(이전 판 이동)이 이 응답을 쓴다 — 목록 엔드포인트와 달리 dedup하지 않는다.

**Auth:** Bearer token 또는 `X-API-Key`

**Response `200`**
```json
{ "ticker": "005930", "reports": [ { "published_date": "2026-07-25", "rating": "buy", "...": "..." } ] }
```

---

### `DELETE /api/analyst-reports/{ticker}`

그 종목의 발행물 **전 판 삭제** (이력 포함). 발행물은 불변 문서지만 오발행·대상 해제 종목 정리 수단으로 종목 단위 삭제만 제공한다 — 판 단위 삭제는 없다(잘못된 판 하나는 새 판 발행으로 덮는다, ADR-0027 개정 · task#222).

**Auth:** Bearer token (**admin 세션 전용** — `X-API-Key` 불가. 루틴에 삭제 권한을 주지 않는다)

**Response `200`**
```json
{ "ok": true, "ticker": "005930", "deleted": 3 }
```

**Errors:** `403` 비admin · `404` 해당 종목 발행물 없음

---

### `GET /api/analyst-reports/{ticker}/{published_date}`

발행물 상세 — Cowork 판단 필드 전체 + 서버 첨부 데이터 블록(`data`).

**Auth:** Bearer token 또는 `X-API-Key`

**Path Parameters:** `ticker` — 종목 코드, `published_date` — `YYYY-MM-DD`

**Response `200`**
```json
{
  "ticker": "005930",
  "published_date": "2026-07-25",
  "rating": "buy",
  "title": "HBM 증설이 이끄는 실적 재평가",
  "fair_value_low": 80000,
  "fair_value_high": 95000,
  "valuation_method": "과거 5년 PER 밴드 평균 12배에 2026F EPS 적용",
  "points": [ { "title": "...", "body": "..." } ],
  "risks": "...",
  "name": "삼성전자",
  "market": "KR",
  "data": {
    "snapshot_date": "2026-07-25",
    "price": 354000.0,
    "market": "KR",
    "name": "삼성전자",
    "consensus": { "target_mean": 400000.0, "buy": 25, "hold": 2, "sell": 0,
                   "target_high": 450000.0, "target_low": 320000.0, "opinion_score": 4.13,
                   "analyst_count": 2, "base_date": "2026-07-25" },
    "consensus_detail": {
      "brokerages": [
        { "brokerage": "NH투자증권", "opinion": "매수", "target_price": 430000.0, "opinion_score": 5.0, "report_date": "2026-07-24" },
        { "brokerage": "미래에셋증권", "opinion": "매수", "target_price": 420000.0, "opinion_score": 5.0, "report_date": "2026-07-22" }
      ]
    },
    "financials_annual": [
      { "period": "2024", "revenue": 300870900000000, "operating_income": 32725900000000, "eps": 4950, "per": 10.7, "is_consensus": false },
      { "period": "2026", "revenue": 365000000000000, "operating_income": 62000000000000, "eps": 9100, "per": null, "is_consensus": true }
    ],
    "competitors": [
      { "ticker": "000660", "name": "SK하이닉스", "is_self": false, "per": 8.2, "pbr": 2.1, "psr": 3.5, "ev_ebitda": 5.9, "rd_intensity": 10.2 }
    ],
    "per_band": { "min": 8.9, "max": 21.2, "avg": 13.4, "current": 12.1, "forward": 9.8 },
    "market_outlook": {
      "segments": [
        { "name": "메모리", "period": "2024", "revenue_share_pct": 58.3, "prev_period": "2023", "prev_revenue_share_pct": 51.0,
          "market": { "size": 1200, "unit": "억달러", "year": 2024, "size_forecast": 1900, "forecast_year": 2030, "cagr_pct": 8.0 },
          "share_pct": 12.0, "share_pct_forecast": 14.0, "note": "HBM 수요 확대", "sources": ["Gartner 2024"] }
      ]
    }
  }
}
```

`data.consensus` — 발행 시점 박제. `target_mean`·`buy`/`hold`/`sell`은 스냅샷 값(단 `target_mean`이 null이면 mart 평균 `avg_target_price`로 보충), `target_high`/`target_low`/`opinion_score`는 `daily_consensus_mart` 최신 행에서 additive 확장(task#260, 파이프라인 미커버 종목은 확장 필드 부재).
`analyst_count`는 **`consensus_detail.brokerages`의 행수**이며 표와 항상 일치한다(없으면 `null` → 화면 `—`). mart의 `analyst_count`는 US 집계 sentinel `__consensus__`를 세는 반면 증권사 목록은 그것을 제외해 둘이 어긋났었다(task#268).
`base_date`는 **바로 그 `target_mean`의 기준일**이다 — 스냅샷 값을 채택하면 스냅샷 날짜, mart 평균으로 보충하면 mart 기준일(task#268; 이전에는 출처와 무관하게 항상 mart 날짜였다).
같은 날 **재발행** 시 컨센서스 근거 조회가 일시 실패하면, 이미 저장돼 있던 그날 판의 `consensus_detail`과 결측 확장 필드를 **보존**한다(전체 치환으로 근거가 사라지던 것 — task#268). 보존은 같은 `(ticker, published_date)` 행에서만 하며, 다른 날 발행은 과거 판의 근거를 끌어오지 않는다.
`data.consensus_detail.brokerages` — 발행 순간 raw_reports 90일 창(마트 base_date 앵커) `DISTINCT ON(brokerage_code)` 최신 의견, 최신순. US 집계 sentinel `__consensus__`는 제외. 파이프라인 미커버 종목(구발행물 포함)은 `consensus_detail` 자체가 없음 — 프론트는 이때 컨센서스 섹션을 생략(graceful).
`data.financials_annual` — 비컨센서스 최근 3개년 + forward 컨센서스 행(`is_consensus: true`), `period` 오름차순. US는 `operating_income`이 `null`일 수 있음(yfinance forward 미제공 — graceful).
`data.per_band` — 과거 연간 PER(비컨센서스, 최근 최대 6개)의 min/max/avg + 현재/forward PER. 재료 부족(<2개)이면 `null`.
`data.market_outlook` — 스냅샷 `market_outlook.segments`가 있을 때만 첨부(발행 시점 박제). 없으면 `data`에 이 키 자체가 없음(구발행물 포함 — 프론트는 이때 "사업부문 시장 분석" 섹션을 생략). **수주잔고의 「사업부문 분해」(`GET /api/report/{ticker}/backlog`의 `segments`)와는 별개 개념** — 이쪽은 시장 전망 하위 부문별 매출비중·시장규모·자사 점유율이다. 필드 상세는 위 enrich `market_outlook.segments` 표 참조.

**Error `404`** — 해당 ticker+date 발행물 없음

---

## Tech Reports (선도기술 리포트)

기술 단위 발행물 (ADR-0033) — 종목이 아니라 기술(재사용 로켓·전고체 배터리·SMR·로봇) 단위로 발행한다. 대상 4종은 백엔드 상수 `TECH_TOPICS`가 정본(`reusable-rocket`·`solid-state-battery`·`smr`·`robotics`) — 그 밖의 slug는 경로 검증 단계(핸들러 진입 전)에서 `422`. 발행물은 불변, 같은 `(slug, published_date)` 재발행만 그날 판을 교체(analyst-reports와 동형).

### `POST /api/tech-reports/{slug}`

선도기술 리포트 발행.

**Auth:** `X-API-Key` 또는 admin Bearer token (`require_admin_or_api_key`)

**Path Parameter:** `slug` — `reusable-rocket` \| `solid-state-battery` \| `smr` \| `robotics` (그 밖의 값은 `422`)

**Request Body**
```json
{
  "published_date": "2026-08-03",
  "title": "재사용 발사체, 궤도당 비용을 다시 쓴다",
  "description": "1단 재사용이 발사비를 낮추는 구조를 설명한다.",
  "difficulty": { "score": 4, "rationale": "극저온 추진제 재점화가 어렵다." },
  "players": [
    { "name": "SpaceX", "country": "US", "state_led": false, "ticker": null,
      "tech_level": 5, "gap_years": 0, "leader_name": "SpaceX",
      "share_pct": 60.0, "note": "재사용 1위", "category": "궤도급 완전재사용" }
  ],
  "challenges": [ { "title": "재점화 신뢰성", "body": "다회 재점화 엔진 내구성." } ],
  "related": { "prerequisites": ["정밀 유도항법"], "derivatives": [], "complements": [], "competitors": [] },
  "market": {
    "history": [ { "year": 2024, "size": { "value": 12.5, "currency": "USD", "unit": "bn" } } ],
    "forecast": [ { "year": 2030, "size": { "value": 30.5, "currency": "USD", "unit": "bn" } } ],
    "cagr_pct": 12.3, "share_basis": "발사 횟수 기준", "as_of": "2026-08-03",
    "estimates": [
      { "institution": "Morgan Stanley", "year": 2030, "size": { "value": 33.5, "currency": "USD", "unit": "bn" }, "scope": null, "is_basis": true },
      { "institution": "McKinsey", "year": 2030, "size": { "value": 32.0, "currency": "USD", "unit": "bn" }, "scope": "발사 서비스만", "is_basis": null }
    ]
  },
  "sources": [ { "title": "NASA", "url": null } ],
  "key_points": [
    { "title": "발사비가 한 자릿수로 내려왔다",
      "metrics": [ { "label": "kg당 발사비", "value": "2,700달러", "change_pct": -22.0 },
                   { "label": "연간 발사", "value": "134회" } ],
      "body": "1단 회수 성공률이 안정되며 단위비용이 소모형 대비 1/5 수준이 됐다." }
  ],
  "milestones": [
    { "year": 2015, "actor": "SpaceX", "event": "1단 지상 회수 성공", "status": "done" },
    { "year": 2026, "actor": "SpaceX", "event": "Starship 궤도 재사용 실증", "status": "in_progress" },
    { "year": 2030, "actor": null, "event": "완전 재사용 상업 운용", "status": "planned" }
  ]
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `published_date` | string | ✅ | `YYYY-MM-DD` |
| `title` | string | ✅ | 한줄 제목 |
| `description` | string | | 상세 기술설명 (생략 시 `""`) |
| `difficulty` | object | ✅ | `{score: 1~5, rationale}` — 기술 난이도 |
| `players` | array | | 주요업체 `{name, country, state_led, ticker?, tech_level: 1~5, gap_years?, leader_name?, share_pct?, note?, category?}` — `share_pct`를 실으면 `market.share_basis`가 반드시 있어야 함(교차검증, 없으면 `422`) |
| `players[].category` | string\|생략 | | 계보 분류(자유 문자열) — 노형 계열 등 기술별 묶음. 화면이 「계보 분류」 그룹 칩으로 렌더하며, 어느 업체에도 없으면 그 섹션이 통째로 생략된다 |
| `challenges` | array | | 기술 난제 `{title, body}` |
| `related` | object | | 관계 티커/기술 `{prerequisites, derivatives, complements, competitors}`(각 문자열 배열) |
| `market` | object | ✅ | `{history: [{year, size}], forecast: [{year, size}], cagr_pct?, share_basis?, as_of, estimates?}` — `size`는 `{value, currency: USD\|KRW, unit: mn\|bn\|tn}`. `history`(실측)와 `forecast`(예상)는 별개 배열 |
| `market.estimates` | array\|생략 | | 기관별 시장 추정치(ADR-0034 개정) **최대 6건**(초과 시 `422`) — `{institution: ≤40자, year, size, scope?: ≤40자, is_basis?}`. `size`는 `market.history`와 같은 구조 필드(문자열 금지)이고, 배열 내 `size.currency`·`size.unit`·`year`는 전부 동일해야 함(다르면 `422` — 섞이면 막대 길이·배수 비교가 거짓말한다). `scope`만 집계 범위 차이를 적는 **표시용 문자열**. `is_basis: true`(성장 곡선이 채택한 기관)는 배열 내 **최대 1건**(2건 이상 `422`) |
| `sources` | array | ✅ | 출처 `{title, url?}` **최소 1개** |
| `key_points` | array\|생략 | | 핵심 포인트 카드 `{title, body, metrics?}` — `metrics`는 **최대 4개**(초과 시 `422`)이고 각 항목은 `{label: ≤40자, value: ≤40자, change_pct?}`. `value`는 **표시용 문자열**("1.1조원"·"22%")이고 `change_pct`만 숫자(양수=상승·음수=하락 색, `0`도 유효값이라 무표기와 다르다). 그래프를 그리는 수치가 아니므로 문자열이다(ADR-0034) |
| `milestones` | array\|생략 | | 진척 타임라인 `{year: int, actor?, event, status}` — `status`는 `done` \| `in_progress` \| `planned` **3값 enum**(그 밖은 `422`). 구체 단계명은 기술마다 다르므로 `event` 자유 문자열이 담고 색·마커는 이 enum이 정한다 |

`value`(`MoneyValue` — `market.history`/`forecast`/`estimates[].size` 전부 포함)·`cagr_pct`·`share_pct`·`key_points[].metrics[].change_pct`는 `NaN`/`Infinity` 거부(`422`) — 불변 문서 오염 방지. `gap_years`·`category`·`key_points`·`milestones`·`market.estimates` 등 선택 필드는 키 생략과 명시적 `null` 모두 허용(`Optional`, task#250 함정 회피).

**Response `201`**
```json
{ "ok": true, "slug": "reusable-rocket", "published_date": "2026-08-03" }
```

**Error `422`** — 미등록 slug · enum 밖 `currency`/`unit`/`milestones[].status` · NaN/Infinity 값 · `sources` 0개 · `key_points[].metrics` 5개 이상 · `market.estimates` 7건 이상 · `market.estimates` 내 `currency`/`unit`/`year` 불일치 · `market.estimates[].is_basis=true` 2건 이상 · `share_pct` 있고 `share_basis` 없음 · 필수 필드 누락

---

각 조회 응답의 발행물 행(`report`)은 **발행 요청 필드 전체(위 표) + 서버 부여 필드 2개**로 구성된다 — `id`(내부 PK, 정렬·비교 용도 외 의미 없음)와 `created_at`(그 판이 저장·갱신된 시각, 재발행 시 갱신).

⚠️ **선택 필드는 응답에서 `null`로 나온다 — 빈 배열이 아니다.** `key_points`·`milestones`를 담지 않고 발행한 판(2026-08-04 이전 전 판 포함)은 컬럼이 SQL NULL이라 `"key_points": null`·`"milestones": null`이고, `metrics`를 생략한 포인트도 `"metrics": null`이다. 소비자는 배열 자리의 `null`을 그대로 `.map()`·`.length`에 넘기지 말 것. `players[].category`는 그보다 앞서 발행된 판에는 **키 자체가 없다**(JSONB에 박제된 옛 형태 — `undefined`). `market.estimates`도 같은 함정이다 — 이 필드가 스키마에 생기기 **이전**에 발행된 판(2026-08-04 이전 전 판 포함)은 JSONB `market`에 이 키 자체가 없어(`undefined`, `players[].category`와 동일 케이스) `null`과 구분해야 한다. 반면 그 **이후** 발행된 판은 요청에서 생략해도 서버가 `"estimates": null`을 채워 저장하므로(다른 선택 필드와 동일) 키는 늘 있다.

### `GET /api/tech-reports`

목록 — **기술당 최신 1건**(발행일 최신순). 요약본이 아니라 위 발행물 행 **전체**를 반환한다.

**Auth:** Bearer token 또는 `X-API-Key`

**Response `200`**
```json
{ "reports": [ { "id": 4, "slug": "smr", "published_date": "2026-08-03", "title": "...", "...": "...", "created_at": "2026-08-03T09:00:00" } ] }
```

---

### `GET /api/tech-reports/{slug}`

그 기술의 발행 판 **전체** 목록(최신순, dedup 없음 — 문서 상세 이력 네비게이션용).

**Auth:** Bearer token 또는 `X-API-Key`

**Path Parameter:** `slug` — `422` if 미등록

**Response `200`**
```json
{ "slug": "smr", "reports": [ { "id": 4, "published_date": "2026-08-03", "title": "...", "...": "...", "created_at": "2026-08-03T09:00:00" } ] }
```

---

### `GET /api/tech-reports/{slug}/{published_date}`

발행물 단건 — 발행 시 제출된 필드 전체(`title`·`description`·`difficulty`·`players`·`challenges`·`related`·`market`·`sources`·`key_points`·`milestones`) + `id`·`created_at`.

**Auth:** Bearer token 또는 `X-API-Key`

**Path Parameters:** `slug` — `422` if 미등록, `published_date` — `YYYY-MM-DD`

**Response `200`**
```json
{
  "id": 4, "slug": "smr", "published_date": "2026-08-03",
  "title": "재사용 발사체, 궤도당 비용을 다시 쓴다",
  "description": "1단 재사용이 발사비를 낮추는 구조를 설명한다.",
  "difficulty": { "score": 4, "rationale": "극저온 추진제 재점화가 어렵다." },
  "players": [ { "name": "SpaceX", "country": "US", "state_led": false, "ticker": null,
                 "tech_level": 5, "gap_years": 0, "leader_name": "SpaceX",
                 "share_pct": 60.0, "note": "재사용 1위", "category": "궤도급 완전재사용" } ],
  "challenges": [ { "title": "재점화 신뢰성", "body": "다회 재점화 엔진 내구성." } ],
  "related": { "prerequisites": ["정밀 유도항법"], "derivatives": [], "complements": [], "competitors": [] },
  "market": {
    "history": [ { "year": 2024, "size": { "value": 12.5, "currency": "USD", "unit": "bn" } } ],
    "forecast": [ { "year": 2030, "size": { "value": 30.5, "currency": "USD", "unit": "bn" } } ],
    "cagr_pct": 12.3, "share_basis": "발사 횟수 기준", "as_of": "2026-08-03",
    "estimates": [
      { "institution": "Morgan Stanley", "year": 2030, "size": { "value": 33.5, "currency": "USD", "unit": "bn" }, "scope": null, "is_basis": true },
      { "institution": "McKinsey", "year": 2030, "size": { "value": 32.0, "currency": "USD", "unit": "bn" }, "scope": "발사 서비스만", "is_basis": null }
    ]
  },
  "sources": [ { "title": "NASA", "url": null } ],
  "key_points": [ { "title": "발사비가 한 자릿수로 내려왔다",
                    "metrics": [ { "label": "kg당 발사비", "value": "2,700달러", "change_pct": -22.0 },
                                 { "label": "연간 발사", "value": "134회", "change_pct": null } ],
                    "body": "1단 회수 성공률이 안정되며 단위비용이 소모형 대비 1/5 수준이 됐다." } ],
  "milestones": [ { "year": 2015, "actor": "SpaceX", "event": "1단 지상 회수 성공", "status": "done" },
                  { "year": 2030, "actor": null, "event": "완전 재사용 상업 운용", "status": "planned" } ],
  "created_at": "2026-08-03T09:00:00"
}
```

**Error `404`** — 해당 slug+date 발행물 없음, 또는 `published_date`가 `YYYY-MM-DD` 형식이 아님(DB 캐스트 500 방지, `analyst-reports` 관용구와 동형)

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

### `GET /api/batches/fomc-coverage`

FOMC 정책결정일 하드코딩 목록(`calendar._FOMC_DATES`)의 커버리지 상태. 배치 허브가 소진 임박 시 '갱신 필요' 경고를 띄우는 데 쓴다(FOMC 날짜 자동 크롤 없이 무음 미표시 방지, ADR/CONCERNS §7). FOMC는 배치가 아니라 하드코딩 목록이라 `GET /api/batches` 배열에 넣지 않고 별도 엔드포인트로 분리(배열 reshape 회피).

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "last_date": "2027-12-08",
  "months_left": 17.2,
  "needs_update": false,
  "threshold_months": 6
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `last_date` | string | `_FOMC_DATES`의 마지막(최신) 날짜 = 커버리지 소진일 |
| `months_left` | float | 오늘부터 `last_date`까지 개월수(소진되면 음수) |
| `needs_update` | boolean | `months_left < threshold_months`이면 `true` — 프론트는 이때만 경고 표시 |
| `threshold_months` | int | 경고 임계(기본 6개월) |

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
| `type` | string | `"earnings"` \| `"dividend"` \| `"agm"` \| `"econ"` \| `"holiday_us"` \| `"holiday_kr"` |
| `stock_type` | string | `"holding"` \| `"watchlist"` \| `"market"` |

> **실적 발표일(earnings):** US+KR 모두 커버. yfinance `t.calendar['Earnings Date']`에서 수집하며, KR 종목은 `.KS`(KOSPI) / `.KQ`(KOSDAQ) 접미사를 붙인 심볼(`yf.Ticker(f"{ticker}.{exchange}")`)로 조회해 미래 날짜만 필터링한다.
>
> **배당락일(dividend):** US 종목은 `t.calendar['Ex-Dividend Date']`의 확정 ex-date 사용. 과거 추정 방식(4회 평균 간격)은 더 이상 사용하지 않음.
>
> **경제지표 발표일(econ):** FRED `/fred/releases/dates`에서 수집한 주요 US 경제지표 발표 일정(CPI·고용보고서·GDP·PPI). `ticker="FRED"`, `stock_type="market"`. `FRED_API_KEY` 미설정 시 FRED 항목은 비어 있음. **FOMC 정책결정일**도 같은 `type="econ"` 이벤트로 포함(`ticker="FOMC"`, `name="FOMC 정책결정"`); 정적 목록(`_FOMC_DATES`, ~2027-12 커버)에서 제공되어 `FRED_API_KEY` 없이도 항상 노출됨.
>
> **주주총회(agm):** KR 보유·관심 종목의 주총 개최일(`stock_disclosures.meeting_date`). `disclosure_fetch` 배치(매일 07:30 KST)가 사전 수집한 저장값만 읽음(요청 시 라이브 DART 호출 없음).

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
  ],
  "news": [
    { "ticker": "AAPL", "title": "종목 관련 기사 제목", "link": "https://...",
      "publisher": "매체명", "published_at": "2026-05-23 09:22" }
  ]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `disclosures[]` | array | 보유 KR 종목의 최근 DART 공시 피드(`stock_disclosures`에서 읽음). Cowork 코멘터리 `recent_disclosures`와 무관 |
| `insider_trades[]` | array | 보유 KR 종목 중 내부자·5%지분 순매수/순매도 신호가 있는 종목(`stock_insider_trades` 윈도 집계). neutral(신호 없음)은 제외. 각 항목 `{ "ticker", "direction": "buy"\|"sell", "net_shares"(부호 보존), "count" }` |
| `news[]` | array | 보유+관심 종목의 최근 뉴스. 스냅샷(`snapshots.data.news`)에서 종목당 최신 2건만 읽음(라이브 스크레이프 없음). 스냅샷 없거나 news 비면 그 종목은 제외 |

**Error `404`** — 아직 생성된 다이제스트 없음

---

### `POST /api/digest/generate`

다이제스트 즉시 생성 (동기). 응답 형태는 `GET /api/digest/latest`와 동일(`disclosures`·`insider_trades`·`news` 포함).

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

**Auth:** Bearer token 필요

**Response `200`**
```json
{ "us2y": 4.85, "us10y": 4.42 }
```

---

### `GET /api/market/fx`

주요 환율 (yfinance).

**Auth:** Bearer token 필요

**Response `200`**
```json
{ "usd_krw": 1380.5, "usd_jpy": 156.2, "eur_usd": 1.082 }
```

---

### `GET /api/market/vix`

VIX 공포지수.

**Auth:** Bearer token 필요

**Response `200`**
```json
{ "value": 18.4, "label": "보통" }
```

---

### `GET /api/market/commodities`

주요 원자재 가격.

**Auth:** Bearer token 필요

**Response `200`**
```json
{ "gold": 2345.6, "wti": 78.3, "copper": 4.52 }
```

---

### `GET /api/market/econ-indicators`

경제지표 (FRED API). `FRED_API_KEY` 환경변수 필요.

**Auth:** Bearer token 필요

**Response `200`**
```json
{ "cpi_yoy": 3.2, "unemployment": 3.9 }
```

---

### `GET /api/market/m7-earnings`

M7 빅테크 최근 실적 요약.

**Auth:** Bearer token 필요

**Response `200`** — 종목 배열 (각 항목: ticker, eps_actual, eps_estimate, surprise_pct 등)

---

### `GET /api/market/kr-top2-earnings`

삼성전자·SK하이닉스 최근 실적 요약.

**Auth:** Bearer token 필요

**Response `200`** — 종목 배열

---

### `GET /api/market/kr-exports`

한국 수출 지표. `KITA_API_KEY`(관세청 API) 미설정 시 UN Comtrade 공개 API 폴백.

**Auth:** Bearer token 필요

**Response `200`** — 월별 수출 데이터 객체

---

### `GET /api/market/macro-signals`

FRED 매크로 신호 4종 시계열 + 핵심 신호 플래그. `market_cache`에 저장된 값만 반환하며 요청 경로에서 라이브 FRED 호출은 없다(데이터는 `macro_signals_fetch` 일배치/수동 refresh가 채운다). 저장값이 없으면 각 시리즈는 빈 배열, `signals`는 `{}`.

**Auth:** Bearer token 필요

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

### `GET /api/market/business-formation`

FRED 신규 창업 신청(Business Formation Statistics) 2개 부문(정보·전문/과학/기술서비스) 월별 시계열 + 3개월 이동평균(3MA). `market_cache`에 저장된 값만 반환하며 요청 경로에서 라이브 FRED 호출은 없다(데이터는 `business_formation_fetch` 일배치/수동 refresh가 채운다). ⚠️ 창업 **신청** 건수이며 실제 창업 여부와는 다르다. 저장값이 없으면 각 부문의 `history`/`ma3`는 빈 배열, `latest_*`·`prev_raw`는 `null`.

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "information": {
    "history": [{ "date": "2026-05-01", "value": 4200.0 }],
    "ma3": [{ "date": "2026-05-01", "value": 4150.33 }],
    "latest_raw": 4200.0,
    "latest_ma3": 4150.33,
    "latest_date": "2026-05-01",
    "prev_raw": 4080.0
  },
  "professional": {
    "history": [{ "date": "2026-05-01", "value": 12500.0 }],
    "ma3": [{ "date": "2026-05-01", "value": 12310.67 }],
    "latest_raw": 12500.0,
    "latest_ma3": 12310.67,
    "latest_date": "2026-05-01",
    "prev_raw": 12200.0
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `information` | object | 정보 부문(NAICS 51, FRED `BABANAICS51SAUS`) |
| `professional` | object | 전문·과학·기술서비스 부문(NAICS 54, FRED `BABANAICS54SAUS`) |
| `*.history` | object[] | 월별 원계열(계절조정, `{ "date": "YYYY-MM-DD", "value": number }`) |
| `*.ma3` | object[] | 원계열의 3개월 단순이동평균(앞 2개월은 값 부족으로 제외) |
| `*.latest_raw` | number \| null | 최신 원계열 값 |
| `*.latest_ma3` | number \| null | 최신 3MA 값 |
| `*.latest_date` | string \| null | 최신 관측월 |
| `*.prev_raw` | number \| null | 전월 원계열 값(전월대비 계산용) |

---

### `GET /api/market/labor-surveys`

미국 고용 조사 2종의 월별 시계열 + 최신값 + 12개월 전 대비 변화. 기업조사(`establishment`, FRED `PAYEMS` 비농업 임금근로자)와 가계조사(`household`, FRED `CE16OV` 16세 이상 취업자)는 같은 고용 규모를 서로 다른 방법론으로 재는 별개 시계열이라(가계=자영업·농업 포함, 기업=재직 복수면 중복집계) 절대 수준 차는 상시 존재하며 그 자체로 신호가 아니다 — 같은 기간 증감 부호가 갈리는 추이의 발산이 신호다. `market_cache`에 저장된 값만 반환하며 요청 경로에서 라이브 FRED 호출은 없다(데이터는 `labor_surveys_fetch` 일배치/수동 refresh가 채운다). 저장값이 없으면 각 조사의 `history`는 빈 배열, `latest`·`latest_date`·`change_12m`은 `null`.

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "establishment": {
    "history": [{ "date": "2026-05-01", "value": 158858.0 }],
    "latest": 158858.0,
    "latest_date": "2026-05-01",
    "change_12m": 1858.0
  },
  "household": {
    "history": [{ "date": "2026-05-01", "value": 162720.0 }],
    "latest": 162720.0,
    "latest_date": "2026-05-01",
    "change_12m": 620.0
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `establishment` | object | 기업조사(FRED `PAYEMS`, 계절조정·천 명) |
| `household` | object | 가계조사(FRED `CE16OV`, 계절조정·천 명) |
| `*.history` | object[] | 월별 시계열(`{ "date": "YYYY-MM-DD", "value": number }`) |
| `*.latest` | number \| null | 최신 값 |
| `*.latest_date` | string \| null | 최신 관측월 |
| `*.change_12m` | number \| null | 최신값 − 12개월 전 값(날짜 매칭, 결손 시 `null`) |

---

### `GET /api/market/trimmed-inflation`

미국 절사평균 물가 4종의 월별 시계열, YoY % 단위로 통일. 코어 PCE(`core_pce`, FRED `PCEPILFE`)·헤드라인 PCE(`headline_pce`, FRED `PCEPI`)는 지수라 응답에서 YoY %로 파생하고, Dallas Fed 절사평균(`dallas_trimmed`, FRED `PCETRIM12M159SFRBDAL`)·Cleveland Fed 16% 절사평균(`cleveland_trimmed`, FRED `TRMMEANCPIM159SFRBCLE`)은 FRED가 이미 YoY %로 발행해 원값 그대로 노출한다(두 번 YoY 적용 안 함). 코어는 *식품·에너지라는 정해진 범주*를 항상 빼고, 절사평균은 *그 달에 극단이었던 품목*을 그때그때 빼는 서로 다른 방법론이다 — 코어가 오르는데 절사평균이 안 오르면 소수 품목 탓이라는 해석이 나온다. `market_cache`에 저장된 값만 반환하며 요청 경로에서 라이브 FRED 호출은 없다(데이터는 `trimmed_inflation_fetch` 일배치/수동 refresh가 채운다). 저장값이 없으면 각 계열의 `history`는 빈 배열, `latest`·`latest_date`는 `null`.

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "core_pce": {
    "history": [{ "date": "2026-05-01", "value": 2.72 }],
    "latest": 2.72,
    "latest_date": "2026-05-01"
  },
  "headline_pce": {
    "history": [{ "date": "2026-05-01", "value": 2.64 }],
    "latest": 2.64,
    "latest_date": "2026-05-01"
  },
  "dallas_trimmed": {
    "history": [{ "date": "2026-05-01", "value": 2.9 }],
    "latest": 2.9,
    "latest_date": "2026-05-01"
  },
  "cleveland_trimmed": {
    "history": [{ "date": "2026-05-01", "value": 3.1 }],
    "latest": 3.1,
    "latest_date": "2026-05-01"
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `core_pce` | object | 코어 PCE(FRED `PCEPILFE`, 지수→YoY % 파생) |
| `headline_pce` | object | 헤드라인 PCE(FRED `PCEPI`, 지수→YoY % 파생) |
| `dallas_trimmed` | object | Dallas Fed 절사평균 PCE(FRED `PCETRIM12M159SFRBDAL`, 원천 YoY %) |
| `cleveland_trimmed` | object | Cleveland Fed 16% 절사평균 CPI(FRED `TRMMEANCPIM159SFRBCLE`, 원천 YoY %) |
| `*.history` | object[] | 월별 시계열(`{ "date": "YYYY-MM-DD", "value": number }`), 4종 모두 단위는 YoY % |
| `*.latest` | number \| null | 최신 YoY % 값 |
| `*.latest_date` | string \| null | 최신 관측월 |

---

### `GET /api/market/indices`

글로벌 주요 지수(S&P 500·KOSPI·KOSDAQ) 최근 시계열 + S&P 500 Shiller CAPE 밸류에이션. `market_cache`에 저장된 값만 반환하며 요청 경로에서 라이브 외부 호출은 없다(데이터는 `indices_fetch` 일배치가 채운다). 저장값이 없으면 `indices`는 `{}`, `valuation`은 `{}`.

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "indices": {
    "gspc":  { "current": 7354.02, "change_pct": -0.05, "history": [{ "date": "2026-06-26", "value": 7354.02 }] },
    "ks11":  { "current": 2780.5,  "change_pct":  0.12, "history": [{ "date": "2026-06-26", "value": 2780.5  }] },
    "kq11":  { "current":  910.3,  "change_pct": -0.30, "history": [{ "date": "2026-06-26", "value":  910.3  }] }
  },
  "valuation": {
    "sp500_cape": { "current": 40.7, "mean": 17.39, "median": 16.1, "min": 4.78, "max": 44.19 }
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `indices.gspc` | object | S&P 500 (`^GSPC`, yfinance) |
| `indices.ks11` | object | KOSPI (`^KS11`, yfinance) |
| `indices.kq11` | object | KOSDAQ (`^KQ11`, yfinance) |
| `indices.*.current` | number \| null | 최신 종가 |
| `indices.*.change_pct` | number \| null | 전일 대비 등락률(%) |
| `indices.*.history` | object[] | 최근 90일 종가 시계열(`{ "date": "YYYY-MM-DD", "value": number }`) |
| `valuation.sp500_cape` | object | S&P 500 Shiller CAPE(PER10) — multpl.com 스크래핑 |
| `valuation.sp500_cape.current` | number \| null | 최신 CAPE 값 |
| `valuation.sp500_cape.mean` | number | 장기 평균 |
| `valuation.sp500_cape.median` | number | 장기 중앙값 |
| `valuation.sp500_cape.min` | number | 역사적 최솟값 |
| `valuation.sp500_cape.max` | number | 역사적 최댓값 |

---

### `GET /api/market/fear-greed`

CNN 공포·탐욕 지수(Fear & Greed, US 전용, 비공식 엔드포인트). `market_cache`에 저장된 값을 요청경로 증분 갱신(fx/vix와 동일 패턴, `indices_fetch` 같은 배치 없음 — `batch_registry` 무등록). CNN이 봇차단(418 등)으로 실패하면 직전 저장값을 반환하고, 저장값도 없으면 `null`.

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "score": 44.85,
  "rating": "fear",
  "timestamp": "2026-07-05T12:00:00+00:00",
  "previous_close": 45.02,
  "previous_1_week": 50.13,
  "previous_1_month": 60.44,
  "history": [{ "date": "2026-06-05", "value": 52.3 }]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `score` | number | 현재 지수(0~100, 0=극단적 공포·100=극단적 탐욕) |
| `rating` | string | 등급(`extreme fear`/`fear`/`neutral`/`greed`/`extreme greed`) |
| `timestamp` | string | CNN 산출 시각 |
| `previous_close` | number \| null | 전일 값 |
| `previous_1_week` | number \| null | 1주 전 값 |
| `previous_1_month` | number \| null | 1개월 전 값 |
| `history` | object[] | 최근 추이(`{ "date": "YYYY-MM-DD", "value": number }`, 최근 최대 60포인트) |

응답 전체가 `null`이면 저장값이 아직 없음(첫 요청 CNN 실패 등).

---

### `GET /api/market/kospi-futures`

코스피200 선물(최근월물, KIS) 현재가·등락률·베이시스 + 일봉 종가 시계열(~120봉). 요청경로 전체 윈도우 단발 조회(배치 없음, ADR-0022 — 최근월물 코드가 분기마다 바뀌어 증분/스티칭은 계약을 섞는다). KIS 미설정 시 dormant(빈 응답). fetch 실패 시 `market_cache` 직전 저장값을 반환(fx.py 수동 폴백 패턴 — `get_or_refresh`는 stale-fallback 안 함), 저장값도 없으면 `current: null`.

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "current": {
    "price": 1247.50,
    "change_pct": -4.33,
    "basis": 5.41,
    "contract": "F 202609",
    "last_tr_date": "20260910"
  },
  "history": [{ "date": "2026-07-06", "close": 1303.95 }]
}
```

`current`가 `null`일 때(KIS 미설정 또는 저장값 없이 fetch 실패)만 추가로 `"configured": false | true` 필드가 실린다(둘을 구분하기 위한 additive 필드 — false=KIS 미설정 dormant, true=설정됐으나 일시적 fetch 실패·저장값 없음). `current`가 값을 가지면(라이브 성공 또는 저장값 폴백) `configured` 필드는 없다.

| 필드 | 타입 | 설명 |
|------|------|------|
| `current.price` | number \| null | 최근월물 현재가 |
| `current.change_pct` | number \| null | 전일 대비 등락률(%) |
| `current.basis` | number \| null | 베이시스(선물가 - 현물가) |
| `current.contract` | string \| null | 계약명(예: `F 202609`) |
| `current.last_tr_date` | string \| null | 최종거래일(`YYYYMMDD`) |
| `history` | object[] | 일봉 종가 시계열(`{ "date": "YYYY-MM-DD", "close": number }`) |
| `configured` | boolean | `current`가 null일 때만 존재. `false`=KIS 미설정, `true`=설정됐으나 일시적 fetch 실패 |

`current`가 `null`이면 dormant(KIS 미설정, `configured: false`) 또는 저장값 없이 fetch 실패(`configured: true`).

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

### `POST /api/market/refresh-business-formation`

FRED 신규 창업 신청 2개 부문 수동 재수집. 부문별 독립 fetch — 한 부문이 실패해도 다른 부문은 갱신되고, 실패한 부문은 직전 저장값을 그대로 보존한다. 실행이력은 일배치와 동일한 `business_formation_fetch` id로 기록한다. `status`가 `ok`와 별도로 실리는 이유: `ok`만 보면 부분성공·스킵도 "갱신됨"으로 오인하기 쉽다.

**Auth:** admin 권한 필요

**Response `200`** (전부 갱신)
```json
{
  "ok": true,
  "status": "success",
  "information_points": 72,
  "professional_points": 72
}
```

**Response `200`** (한 부문만 실패 — `status: "partial"`, `ok: false`. 실패 부문은 직전 저장값 그대로라 `_points`는 두 부문 다 채워져 보인다)
```json
{
  "ok": false,
  "status": "partial",
  "information_points": 72,
  "professional_points": 71
}
```

**Response `200`** (`FRED_API_KEY` 미설정 또는 전 부문 실패 — 저장 생략, `status: "skipped"`, `ok: false`)
```json
{
  "ok": false,
  "status": "skipped",
  "error": "FRED_API_KEY 환경변수가 필요합니다."
}
```

---

### `POST /api/market/refresh-labor-surveys`

미국 고용 조사 2종(`PAYEMS`·`CE16OV`) 수동 재수집. 조사별 독립 fetch — 한 조사가 실패해도 다른 조사는 갱신되고, 실패한 조사는 직전 저장값을 그대로 보존한다. 실행이력은 일배치와 동일한 `labor_surveys_fetch` id로 기록한다. `status`가 `ok`와 별도로 실리는 이유: `ok`만 보면 부분성공·스킵도 "갱신됨"으로 오인하기 쉽다.

**Auth:** admin 권한 필요

**Response `200`** (전부 갱신)
```json
{
  "ok": true,
  "status": "success",
  "establishment_points": 65,
  "household_points": 65
}
```

**Response `200`** (한 조사만 실패 — `status: "partial"`, `ok: false`. 실패 조사는 직전 저장값 그대로라 `_points`는 두 조사 다 채워져 보인다)
```json
{
  "ok": false,
  "status": "partial",
  "establishment_points": 65,
  "household_points": 64
}
```

**Response `200`** (`FRED_API_KEY` 미설정 — 저장 생략, `status: "skipped"`, `ok: false`)
```json
{
  "ok": false,
  "status": "skipped",
  "error": "FRED_API_KEY 환경변수가 필요합니다."
}
```

전 조사 실패(키는 설정됐으나 양쪽 fetch 모두 실패)도 저장 생략·`status: "skipped"`이지만 이 경우 `error` 필드 없이 `_points`가 직전 저장값 기준으로 실린다.

---

### `POST /api/market/refresh-trimmed-inflation`

절사평균 물가 4종(`PCEPILFE`·`PCEPI`·`PCETRIM12M159SFRBDAL`·`TRMMEANCPIM159SFRBCLE`) 수동 재수집. 계열별 독립 fetch — 한 계열이 실패해도 다른 계열은 갱신되고, 실패한 계열은 직전 저장값을 그대로 보존한다. 실행이력은 일배치와 동일한 `trimmed_inflation_fetch` id로 기록한다. `status`가 `ok`와 별도로 실리는 이유: `ok`만 보면 부분성공·스킵도 "갱신됨"으로 오인하기 쉽다.

**Auth:** admin 권한 필요

**Response `200`** (전부 갱신)
```json
{
  "ok": true,
  "status": "success",
  "core_pce_points": 105,
  "headline_pce_points": 105,
  "dallas_trimmed_points": 65,
  "cleveland_trimmed_points": 65
}
```

**Response `200`** (일부 계열만 실패 — `status: "partial"`, `ok: false`. 실패 계열은 직전 저장값 그대로라 `_points`는 4종 다 채워져 보인다)
```json
{
  "ok": false,
  "status": "partial",
  "core_pce_points": 105,
  "headline_pce_points": 105,
  "dallas_trimmed_points": 65,
  "cleveland_trimmed_points": 64
}
```

**Response `200`** (`FRED_API_KEY` 미설정 — 저장 생략, `status: "skipped"`, `ok: false`)
```json
{
  "ok": false,
  "status": "skipped",
  "error": "FRED_API_KEY 환경변수가 필요합니다."
}
```

전 계열 실패(키는 설정됐으나 4종 fetch 모두 실패)도 저장 생략·`status: "skipped"`이지만 이 경우 `error` 필드 없이 `_points`가 직전 저장값 기준으로 실린다.

---

### `GET /api/market/kospi-signal`

다음날 코스피 방향 신호(오버나잇 프록시) 시계열 + 최신 신호 + 누적 적중률. `market_cache`(`kospi_signal`)에 저장된 값만 반환하며 요청 경로에서 라이브 yfinance 호출은 없다(데이터는 `kospi_signal_fetch` 평일 배치/수동 refresh가 채운다). 신호는 S&P500·나스닥·USD/KRW·필라델피아 반도체지수(SOX)의 가중 등락률 합성치(가중치 S&P500=2·나스닥=0.5·USD/KRW=−0.5(원화약세=비우호로 역방향 반영)·SOX=1, `composite=Σ(가중치×등락률)/Σ|가중치|`; 1년 백테스트로 채택된 구성, task#203)를 그날의 밴드(코스피 20일 실현변동성(σ)×0.5, 데이터 부족 시 고정 0.5%p 폴백)로 강세/중립/약세 판정하고, 다음 배치 실행 시 KOSPI 실제 시가·종가 데이터가 확보되는 대로 소급 채운다(고정 지연일수 없음). 저장값이 없으면 `current`는 `null`, `history`는 빈 배열.

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "current": {
    "date": "2026-07-07",
    "signal": "bullish",
    "composite_pct": 0.68,
    "band": 0.42,
    "drivers": { "sp500": 0.9, "nasdaq": 1.1, "usdkrw": -0.2, "sox": 1.3 }
  },
  "history": [
    {
      "date": "2026-07-06",
      "signal": "bullish",
      "composite_pct": 0.72,
      "band": 0.38,
      "drivers": { "sp500": 0.8, "nasdaq": 1.0, "usdkrw": -0.3, "sox": 1.1 },
      "actual_gap_pct": 0.15,
      "actual_close_pct": 0.55,
      "hit": true
    }
  ],
  "hit_rate": 0.58,
  "neutral": { "total": 12, "hit": 7 },
  "timestamp": "2026-07-07T08:30:00+09:00"
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `current` | object \| null | 최신 신호(오늘자, 아직 실제 결과 미확정) |
| `current.signal` | string | `bullish`(강세) \| `neutral`(중립) \| `bearish`(약세) |
| `current.composite_pct` | number \| null | 가중 등락률 합성치(`Σ(가중치×등락률)/Σ|가중치|`, 위 채택 구성 참조) |
| `current.band` | number | 그날 사용된 밴드(%p). 적응형(코스피 20일σ×0.5) — 매일 값이 다를 수 있다 |
| `current.drivers` | object | 구성 요소별 전일 대비 등락률(%) — `sp500`·`nasdaq`·`usdkrw`·`sox` |
| `history` | object[] | 최근 약 180일 시계열(신호+확정된 실제 결과) |
| `history[].band` | number | 그 레코드 생성 당시 사용된 밴드(%p). task#203 이전 레거시 레코드는 이 필드 자체가 없을 수 있다(저장값엔 소급 기입되지 않으며, 적중 판정 시에만 내부적으로 `0.5` 기본 적용) |
| `history[].actual_gap_pct` | number \| null | `(코스피 시가 − 전일 종가) / 전일 종가 × 100`(확정 전 `null`) |
| `history[].actual_close_pct` | number \| null | `(코스피 종가 − 전일 종가) / 전일 종가 × 100`(적중 판정 기준) |
| `history[].hit` | boolean \| null | 적중 판정. 방향성(`bullish`/`bearish`)은 실제 등락률의 **부호**가 신호와 일치하면 적중(크기 무관, 0은 miss). `neutral`은 `\|실제 등락률\| <= history[].band`. 미확정이면 `null` |
| `hit_rate` | number \| null | 방향성 신호(`bullish`+`bearish`, 확정된 것만)의 적중률. 방향성 신호가 없으면 `null` |
| `neutral.total` / `neutral.hit` | number | `neutral` 신호 중 확정 건수 / 적중 건수(별도 집계, `hit_rate`에 미포함) |
| `timestamp` | string \| null | 마지막 저장 시각 |

---

### `POST /api/market/refresh-kospi-signal`

코스피 방향 신호 수동 재수집. 드라이버(S&P500·나스닥·USD/KRW·SOX) 히스토리를 증분 갱신해 오늘자 신호를 산출·저장하고, 과거 미확정 항목은 KOSPI 실제 시가/종가 데이터가 확보되는 대로 소급 채운다. 실행이력은 일배치와 동일한 `kospi_signal_fetch` id로 기록한다.

**Auth:** admin 권한 필요

**Response `200`**
```json
{
  "ok": true,
  "series_points": 128,
  "latest": {
    "date": "2026-07-07",
    "signal": "bullish",
    "composite_pct": 0.68,
    "band": 0.42,
    "drivers": { "sp500": 0.9, "nasdaq": 1.1, "usdkrw": -0.2, "sox": 1.3 },
    "actual_gap_pct": null,
    "actual_close_pct": null,
    "hit": null
  }
}
```

> 드라이버 중 하나라도 fetch 실패 시 저장 시계열은 변경하지 않고(직전 저장값 유지) 소급 확정만 반영한다.

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
{ "ok": true, "market": "KR", "export_points": 12, "saved": true }
```
```json
{ "ok": true, "market": "US", "cpi_points": 36, "unemp_points": 36 }
```

`market=KR`의 `export_points`는 수집된 **월 수**(`months` 길이)다. `saved`는 실제 저장 여부 — 외부 API가 빈 결과(항목 0건)를 주면 직전 양호값을 보존하기 위해 저장을 생략하고 `saved: false`와 함께 **직전 저장값의** 월 수를 반환한다(task#243).

**Error `400`** — `market`이 `KR`/`US`가 아님

---

### `POST /api/market/refresh-market`

FX·VIX·국채·원자재 캐시 초기화 후 yfinance 1년치 재수집.

**Auth:** 어드민 전용 (`require_admin`, task#108)

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

**Auth:** Bearer token 필요

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

**Auth:** Bearer token 필요

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

**Auth:** Bearer token 필요

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

**Auth:** Bearer token 필요

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

dataroma 기반 구루 매니저 전체 목록. 상세 전용 계층인 전 종목 `holdings`와 전량매도 `sold_out`은 목록 응답에 포함되지 않음(상세 엔드포인트 참조).

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "last_updated": "2026-05-23T08:00:00",
  "managers": [
    {
      "name": "Warren Buffett",
      "firm": "Berkshire Hathaway",
      "portfolio_value": 350000000000,
      "period": "Q1 2026",
      "portfolio_date": "2026-03-31",
      "num_stocks": 45,
      "top10": ["AAPL", "BAC", "AXP"]
    }
  ]
}
```

`period`/`portfolio_date`는 그 매니저의 **최신 13F 신고 분기**다 — 매니저마다 다를 수 있으므로(신고 시점 차) 전역 상수로 취급하지 말 것.

---

### `GET /api/guru/managers/{manager_id}`

특정 구루 매니저 1명의 전체 상세(보유 전 종목 `holdings`, 전량매도 `sold_out` 포함). `GET /api/guru/managers`(목록)는 페이로드 절약을 위해 그 둘을 벗겨 반환하므로, 필요하면 이 엔드포인트를 쓴다.

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "id": "brk",
  "name": "Warren Buffett",
  "firm": "Berkshire Hathaway",
  "portfolio_value": 350000000000,
  "period": "Q1 2026",
  "portfolio_date": "2026-03-31",
  "num_stocks": 45,
  "top10": [{ "rank": 1, "ticker": "AAPL", "name": "Apple Inc.", "name_kr": "애플", "weight_pct": 42.1,
              "activity": { "kind": "add", "share_pct": 203.99, "port_pct": 3.98 } }],
  "holdings": [{ "rank": 1, "ticker": "AAPL", "name": "Apple Inc.", "weight_pct": 42.1,
                 "activity": { "kind": "add", "share_pct": 203.99, "port_pct": 3.98 } }],
  "sold_out": [{ "ticker": "V", "name": "Visa Inc.", "port_pct": 1.06 }]
}
```

**`activity`(직전 분기 대비 활동)** — dataroma 신고 기준. **변동이 없는 종목엔 이 키가 아예 없다**(빈 객체가 아님).

| 필드 | 뜻 |
|------|-----|
| `kind` | `buy`(신규매수) · `add`(추가매수) · `reduce`(축소). locale-독립 저장 enum이고 표시 라벨은 프론트가 붙인다 |
| `share_pct` | **주식수** 증감률(%). `kind: "buy"`는 직전 보유가 0이라 `null` |
| `port_pct` | 이번 분기 거래분이 **현재 포트폴리오에서 차지하는 비중**(%). 무부호 — 방향은 `kind`가 갖는다. 활동 페이지가 실패·절단되면 `null`(그래도 `kind`/`share_pct`는 남는다) |

⚠️ `port_pct`는 `이전비중 → 현재비중` **차이가 아니다**. `현재비중 × 증감주식수/현재주식수`이므로 `weight_pct - port_pct`로 이전 분기 비중을 역산하면 틀린다.

**`sold_out`** — 이번 분기에 **전량매도**한 종목(보유 목록엔 없으므로 별도 계층). `port_pct`는 직전 비중.

없는 `manager_id`는 `404`.

---

### `GET /api/guru/stats/popularity`

여러 구루가 보유한 종목을 보유자 수 기준으로 랭킹.

**Auth:** Bearer token 필요

**Response `200`** — `[{ "ticker": "AAPL", "count": 12 }, ...]`

---

### `GET /api/guru/stats/weighted`

포트폴리오 내 순위 기반 가중치(1/rank) 합산 추천 점수.

**Auth:** Bearer token 필요

**Response `200`** — `[{ "ticker": "AAPL", "score": 5.23 }, ...]`

---

### `GET /api/guru/stats/allocation`

**포트폴리오 규모(13F 신고 자산) 상위 `top`명 코호트**의 **전 종목 층**(`holdings`)을 티커별로 합산한 자산 배분 랭킹. 투자금 내림차순 정렬.

**Query:** `top`(선택, 정수 ≥1) — 코호트 크기. 생략하면 전 구루(83명)를 코호트로 집계(기존 동작). `top`이 매니저 수보다 크면 자연히 전체와 동일. 코호트 선별은 `portfolio_value` 내림차순, 동값은 `id` 오름차순 보조키로 결정적이다(같은 입력 → 항상 같은 코호트).

투자금은 dataroma 신고 금액(`value`)이 정본이고, 그 값이 없는 행에 한해 `weight_pct/100 × portfolio_value`로 추정한다. `ratio`의 분모는 **코호트** 투자금 총합(`total_value`)이라 전 행의 `ratio` 합은 100이다(코호트 기준 — 전체가 아니다). 듀얼클래스(GOOGL/GOOG 등)는 별개 티커로 센다. `name_kr`은 `top10` 층에서 티커로 조인하며, 없으면 빈 문자열(소비측이 `name` 폴백).

**Auth:** Bearer token 필요

**Response `200`**

```json
{
  "last_updated": "2026-07-30T10:00:00",
  "total_value": 766300000000,
  "manager_count": 10,
  "all_manager_count": 83,
  "all_total_value": 1077000000000,
  "ticker_count": 412,
  "periods": { "Q1 2026": 10 },
  "estimated_count": 37,
  "rows": [
    { "ticker": "AAPL", "name": "Apple Inc.", "name_kr": "애플",
      "value": 67300000000, "ratio": 8.7744, "holder_count": 9 }
  ]
}
```

- `last_updated` — `GET /api/guru/managers`와 동일한 크롤 시각(라우터 레벨 passthrough, 코호트와 무관).
- `total_value`/`ticker_count`/`rows`/`ratio` — **코호트** 기준(`top` 적용 후).
- `manager_count` — 코호트 크기(`top` 생략 시에만 83).
- `all_manager_count`/`all_total_value` — **전체 83명** 기준 매니저 수·집계 투자금 합(`top`과 무관하게 항상 동일). `all_total_value`는 Σ`portfolio_value`가 **아니다** — `holdings` 층을 동일한 value/추정 교차검증으로 합산한 값이라 소폭 다르다(예 $1,077.8B vs $1,077.0B). `total_value / all_total_value`가 코호트의 전체 대비 비중이다.
- `periods` — 코호트 매니저의 신고분기(`period`) 구성 dict(예 `{"Q1 2026": 10}`). `period` 없는 매니저는 세지 않는다.
- `estimated_count` — 코호트 안에서 신고 금액(`value`)이 없어 추정한 보유 행 수.

---

### `GET /api/guru/crawl/progress`

구루 크롤링 진행 상황 조회.

**Auth:** Bearer token 필요

**Response `200`**
```json
{
  "running": false, "done": 83, "total": 83, "current": "",
  "result": "partial", "fresh": 40, "stale": 43, "dropped": 0, "held": 43
}
```

| 필드 | 의미 |
|------|------|
| `running` | 크롤 진행 중 여부 |
| `done` / `total` | 진행률(**시도** 기준 — 저장 건수가 아니다) |
| `current` | 현재 수집 중인 매니저명 |
| `result` | 종료 사유 — `saved`(전원 갱신) \| `partial`(일부 직전값 유지 또는 명부 축소 보류) \| `skipped`(빈 결과, 저장 생략) \| `failed`. 크롤 진행 중에는 `null` |
| `fresh` | 이번 회차에 실제로 갱신된 매니저 수 |
| `stale` | 개별 수집 실패로 직전값을 유지한 매니저 수 |
| `dropped` | 명부에서 사라져 은퇴로 반영·제거된 매니저 수 |
| `held` | 명부가 직전 저장분의 80% 미만으로 축소돼 **삭제를 보류**한 매니저 수. 0보다 크면 명부(dataroma 마크업) 확인이 필요하다 |

`result`/`fresh`/`stale`/`dropped`/`held`는 크롤이 끝나기 전에는 `null`이다.

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
{ "ok": true, "sectors": 24, "index": 26 }
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `ok` | boolean | 성공 여부 |
| `sectors` | int | 갱신·저장된 업종 수 |
| `index` | int | 저장된 보유→업종 역인덱스의 종목 수. 역인덱스 fetch가 빈 결과면 직전값을 보존하므로(task#243) 이 값이 갱신 전과 같을 수 있다 |

**Error `500`** — 키움 조회/저장 실패 시 `detail`에 사유 포함

---

### `POST /api/analysis/sector/refresh-us`

US 섹터 모멘텀 수동 갱신. 11개 섹터 ETF(XLK·XLF 등)의 yfinance 시계열을 다시 받아 모멘텀을 계산·저장(`market_cache`)하고 섹터 캐시를 무효화한다. `us_sector_fetch` 배치와 동일 본문을 수동 실행하는 엔드포인트.

**Auth:** admin 권한 필요

**Response `200`**
```json
{ "ok": true, "sectors": 11 }
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `ok` | boolean | 성공 여부 |
| `sectors` | int | 갱신·저장된 섹터 수 |

**Error `500`** — yfinance 조회/저장 실패 시 `detail`에 사유 포함

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
| `market` | `KR`\|`US` | - | 발굴(`discovery`) 섹션 시장 필터. 미지정 시 전 시장 통합 반환 (`watchlist`/`holdings`엔 미적용) |

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
      "exchange": "KS",
      "enriched": true
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
| `watchlist` | object[] | 호출자 관심종목 재정렬(점수 내림차순). 기본 shape는 `discovery`와 동일하며 아래 1필드 추가. 점수 없는 관심종목은 `score=null`·`flags=[]`·`rank=null`로 말미 append |
| `watchlist[].enriched` | boolean | AI 분석 존재 여부(`enriched_at` 기준). 분석이 채워진 종목은 `true`, 미채움은 `false` |
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

**Auth:** Bearer token 필요

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

**Auth:** Bearer token 필요

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

사용자 행동 이벤트를 수집해 `user_events` 테이블에 비동기 저장(BackgroundTask). `event_name`은 화이트리스트(`VALID_EVENTS`)로 검증하며, **허용 외 이벤트는 저장 없이 조용히 `{ "ok": true }` 반환**(에러 아님). 허용 이벤트: `nav_portfolio`, `nav_research`, `nav_market`, `nav_guru`, `nav_settings`, `tab_holdings`, `tab_watch`, `tab_analysis`, `tab_dash`, `tab_reports`, `tab_digest`, `tab_calendar`, `tab_ranking`, `tab_compare`, `report_view_open`, `report_tab_switch`, `ranking_row_click`, `ranking_watch_toggle`, `stock_search`.

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

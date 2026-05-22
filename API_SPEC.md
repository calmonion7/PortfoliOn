# PortfoliOn API 명세서

> **Base URL:** `http://localhost:8000`  
> **Content-Type:** `application/json`  
> **CORS 허용 Origin:** `http://localhost:3000`, `http://localhost:5173`

---

## 목차

- [Health](#health)
- [Portfolio (보유종목)](#portfolio-보유종목)
- [Watchlist (관심종목)](#watchlist-관심종목)
- [Stocks (종목 정보)](#stocks-종목-정보)
- [Report (리포트)](#report-리포트)
- [Schedule (자동 스케줄)](#schedule-자동-스케줄)
- [Calendar (이벤트 캘린더)](#calendar-이벤트-캘린더)
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

## Portfolio (보유종목)

### `GET /api/portfolio`

전체 포트폴리오 조회. 보유종목(`stocks`)과 관심종목(`watchlist`) 모두 반환.

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

**Path Parameter:** `ticker` — 종목 코드

**Request Body** — `POST /api/portfolio`와 동일한 스키마

**Response `200`** — 수정된 종목 객체

**Error `404`** — ticker 없음

---

### `DELETE /api/portfolio/{ticker}`

보유종목 삭제. 삭제 후 해당 종목이 관심종목에 없으면 자동으로 관심종목으로 이동.

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

**Path Parameter:** `ticker` — 종목 코드

**Request Body** — `POST /api/watchlist`와 동일한 스키마

**Response `200`** — 수정된 종목 객체

**Error `404`** — watchlist에 없는 ticker

---

### `DELETE /api/watchlist/{ticker}`

관심종목 삭제.

**Path Parameter:** `ticker` — 종목 코드

**Response `200`**
```json
{ "deleted": "TSLA" }
```

**Error `404`** — watchlist에 없는 ticker

---

### `POST /api/watchlist/{ticker}/promote`

관심종목 → 보유종목으로 승격.

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

### `POST /api/report/generate`

전체 포트폴리오 + 관심종목 리포트 생성 (비동기).

**Response `202`**
```json
{ "message": "Generating reports for 5 stock(s)" }
```

**Error `400`** — 포트폴리오와 관심종목 모두 비어있을 때

---

### `POST /api/report/generate/{ticker}`

특정 종목 리포트 생성 (비동기).

**Path Parameter:** `ticker` — 종목 코드

**Response `202`**
```json
{ "message": "Generating report for AAPL" }
```

**Error `404`** — 포트폴리오 또는 관심종목에 없는 ticker

---

### `GET /api/report/list`

생성된 리포트 목록 조회.

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

보유종목·관심종목의 실적 발표일·배당락일 조회. 데이터는 yfinance에서 수집하며 `backend/data/calendar/YYYY-MM.json`으로 파일 캐시.

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
    }
  ]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `date` | string | 이벤트 날짜 (`YYYY-MM-DD`) |
| `ticker` | string | 종목 코드 |
| `name` | string | 종목명 (없으면 ticker와 동일) |
| `type` | string | `"earnings"` (실적 발표일) \| `"dividend"` (배당락일 추정) |
| `stock_type` | string | `"holding"` (보유종목) \| `"watchlist"` (관심종목) |

> **배당락일 추정:** yfinance 배당 이력에서 최근 4회 지급 간격의 평균으로 다음 배당락일을 예측합니다. 배당 이력이 2회 미만인 종목은 생략됩니다.

> **캐시:** 월별 파일 캐시 (`backend/data/calendar/YYYY-MM.json`). 종목 추가·삭제·이동 시 자동 전체 삭제. 수동 초기화는 `DELETE /api/calendar/cache` 사용.

**Error `422`** — `month` 파라미터가 `YYYY-MM` 형식이 아닌 경우

---

### `DELETE /api/calendar/cache`

특정 월의 캘린더 캐시 파일을 삭제합니다. 다음 `GET /api/calendar` 요청 시 yfinance에서 재수집합니다.

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
| `404` | 리소스 없음 |
| `422` | 요청 바디 유효성 검사 실패 (FastAPI 기본) |

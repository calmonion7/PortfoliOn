# PortfoliOn — Claude Cowork 외부 API

> Claude Cowork가 종목 목록을 조회하고, AI가 생성한 분석 정보를 PortfoliOn 백엔드에 저장하기 위한 API입니다.

**Base URL:** `https://portfolion.taebro.com`  
**Content-Type:** `application/json`

---

## 워크플로우

### 종목 분석 (enrich)
```
1. GET /api/stocks               → 분석 대상 종목 목록 조회
2. (선택) GET /api/report/list   → 기존 리포트 날짜 확인
3. (선택) GET /api/report/{ticker}/{date_str}  → 기존 리포트 내용 참조
4. (AI가 각 종목 분석 수행)
5. PUT /api/stocks/enrich/batch  → 분석 결과 일괄 저장
   또는
   PUT /api/stocks/{ticker}/enrich  → 종목 1개 저장
6. POST /api/report/generate     → 전체 리포트 재생성 (enrich 후 반드시 실행)
```

### 수주잔고 분석 (backlog)
```
1. GET /api/report/backlog/pending   → 분석 대기 중인 수주잔고 목록 조회
2. (AI가 각 항목의 raw_text에서 수주잔고 수치를 분기별로 추출)
3. PUT /api/report/{ticker}/backlog  → 분석 결과 저장 (ticker별 반복)
```

---

## 인증

외부 API(Claude Cowork)는 API Key 방식으로 인증합니다.

모든 요청에 아래 헤더를 포함합니다.

```
X-API-Key: {COWORK_API_KEY}
```

`COWORK_API_KEY`는 서버의 `backend/.env.docker`에 설정된 값입니다.

**Error `401`** — API Key 누락 또는 불일치

---

## 엔드포인트

### `GET /api/stocks`

전체 유저의 보유종목과 관심종목 목록을 반환합니다 (전 유저 합산, ticker 중복 제거).

**Auth:** `X-API-Key` 헤더

**Response `200`**
```json
[
  { "ticker": "LLY",    "name": "일라이 릴리",      "type": "holding",   "market": "US" },
  { "ticker": "012450", "name": "한화에어로스페이스", "type": "watchlist", "market": "KR" }
]
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `ticker` | string | 종목 코드 |
| `name` | string | 종목명 (없으면 ticker 값) |
| `type` | string | `"holding"` (보유종목) \| `"watchlist"` (관심종목) |
| `market` | string | `"US"` \| `"KR"` |

---

### `GET /api/report/list`

생성된 리포트 목록과 날짜를 조회합니다. 기존 리포트가 있으면 참조해 중복 분석을 피할 수 있습니다.

**Auth:** `X-API-Key` 헤더

**Response `200`**
```json
{
  "stocks": {
    "LLY": {
      "dates": ["2026-05-20", "2026-05-01"],
      "category": "holdings",
      "market": "US",
      "summary": {
        "name": "Eli Lilly and Company",
        "price": 823.45,
        "sector": "Healthcare",
        "target_mean": 950.0,
        "buy": 18,
        "hold": 4,
        "sell": 0,
        "daily_rsi": { "rsi": 58.3 },
        "weekly_rsi": { "rsi": 62.1 },
        "monthly_rsi": null,
        "volume_profile": { "poc": 810.0 }
      }
    },
    "AVAV": {
      "dates": ["2026-05-15"],
      "category": "watchlist",
      "market": "US",
      "summary": null
    }
  },
  "last_scheduled_date": "2026-05-20"
}
```

> 종목 데이터는 `response["stocks"]` 아래에 있습니다. `summary`는 리포트가 없으면 `null`.

---

### `GET /api/report/{ticker}/{date_str}`

특정 날짜의 리포트 스냅샷 데이터를 조회합니다. 기존 분석을 참조할 때 사용합니다.

**Auth:** 불필요

**Path Parameters**
- `ticker` — 종목 코드 (예: `LLY`)
- `date_str` — 날짜 (`YYYY-MM-DD`, `GET /api/report/list` 의 `dates` 값)

**Response `200`**
```json
{
  "ticker": "LLY",
  "date": "2026-05-20",
  "summary": {
    "name": "Eli Lilly and Company",
    "price": 823.45,
    "sector": "Healthcare",
    "industry": "Drug Manufacturers",
    "target_mean": 950.0,
    "target_high": 1100.0,
    "target_low": 750.0,
    "buy": 18,
    "hold": 4,
    "sell": 0,
    "moat": "특허 포트폴리오와 제조 규모의 경제",
    "growth_plan": "GLP-2 파이프라인 확장",
    "risks": "GLP-1 경쟁 심화, 약가 규제 리스크"
  }
}
```

> `summary`는 DB에 저장된 스냅샷 전체 데이터입니다. `content`(마크다운) 필드는 없습니다.

**Error `404`** — 해당 날짜의 리포트 없음

---

### `PUT /api/stocks/{ticker}/enrich`

단일 종목의 AI 분석 정보를 저장합니다. 포함된 필드만 덮어쓰고 나머지는 기존 값을 유지합니다.

**Auth:** `X-API-Key` 헤더

**Path Parameter:** `ticker` — 종목 코드 (예: `LLY`)

**Request Body**
```json
{
  "moat": {
    "rating": "wide",
    "rating_source": "Morningstar",
    "summary": "특허·브랜드·R&D 인프라 기반의 최상급 경쟁 우위",
    "factors": [
      { "title": "독점적 특허 기반의 가격 결정력", "description": "티르제파티드 기반 제품은 2036년까지 특허 보호." },
      { "title": "고객 전환 비용 및 브랜드 충성도", "description": "장기 투약 특성으로 이탈률이 매우 낮음." }
    ]
  },
  "growth_plan": {
    "strategy": "비만 시장 독점 확대 + 차세대 치료 영역 선점",
    "initiatives": [
      { "title": "경구용 비만 치료제 파운다요 FDA 승인", "description": "2026-04 세계 최초 경구용 비만 치료제 FDA 승인.", "status": "launched", "timeline": "2026-04" },
      { "title": "레타트루티드 임상 3상", "description": "삼중 작용제, 압도적 임상 데이터 확보 중.", "status": "phase3", "timeline": null }
    ]
  },
  "risks": {
    "factors": [
      { "category": "경쟁", "title": "후발 주자 맹추격", "description": "노보 노디스크·암젠 등이 더 저렴한 비만약 개발 중.", "severity": "high" },
      { "category": "가격", "title": "약가 인하 압박", "description": "보험·정부 협상으로 실질 단가 하락. 최근 분기 미국 -7%.", "severity": "medium" }
    ]
  },
  "recent_disclosures": {
    "period": "2026Q1",
    "headline": "1분기 어닝 서프라이즈 + 연간 가이던스 대폭 상향",
    "metrics": [
      { "label": "매출액", "actual": "$19.8B", "consensus": "$17.6B", "vs_consensus": "+12.5%", "note": "YoY +56%" },
      { "label": "Non-GAAP EPS", "actual": "$8.55", "consensus": "$6.97", "vs_consensus": "+22.6%", "note": null }
    ],
    "events": [
      { "title": "연간 매출 가이던스 상향", "description": "820~850억 달러로 20억 달러 상향.", "impact": "positive" }
    ],
    "price_impact": "실적 발표 당일 +6~10% 급등",
    "one_liner": "비만 치료제 독점 해자로 매출 56% 폭증. 약가 인하·후발 추격은 모니터링 필요."
  },
  "insights": {
    "stance": "관망",
    "entry": [
      "20일 고점 대비 -10% 이상 눌림 + 분기 가이던스 상향 확인 시 분할 매수",
      "약가 협상 불확실성 해소 뉴스 확인 시"
    ],
    "avoid": [
      "경쟁사 동등 효능 비만약 FDA 승인 임박",
      "PER 40배 이상 과열 구간"
    ],
    "one_liner": "독점 해자는 견고하나 밸류 부담. 눌림목에서 분할 진입, 경쟁 승인 이벤트 전 비중 확대는 자제."
  },
  "competitors": ["NVO", "AMGN"]
}
```

**`moat` 객체 필드**

| 필드 | 타입 | 설명 |
|------|------|------|
| `rating` | string | `"wide"` \| `"narrow"` \| `"none"` |
| `rating_source` | string | 출처 (예: `"Morningstar"`) |
| `summary` | string | 한 줄 요약 |
| `factors` | `{title, description}[]` | 해자 구성 요소 목록 |

**`growth_plan` 객체 필드**

| 필드 | 타입 | 설명 |
|------|------|------|
| `strategy` | string | 전략 개요 |
| `initiatives` | `{title, description, status, timeline}[]` | 성장 이니셔티브 목록 |
| `initiatives[].status` | string | `"launched"` \| `"phase3"` \| `"phase2"` \| `"announced"` \| `"completed"` |
| `initiatives[].timeline` | string\|null | 타임라인 (예: `"2026-04"`) |

**`risks` 객체 필드**

| 필드 | 타입 | 설명 |
|------|------|------|
| `factors` | `{category, title, description, severity}[]` | 리스크 목록 |
| `factors[].category` | string | 분류 (예: `"경쟁"`, `"가격"`, `"공급"`, `"법적"`) |
| `factors[].severity` | string | `"high"` \| `"medium"` \| `"low"` |

**`recent_disclosures` 객체 필드**

| 필드 | 타입 | 설명 |
|------|------|------|
| `period` | string | 기준 분기 (예: `"2026Q1"`) |
| `headline` | string | 핵심 이벤트 요약 |
| `metrics` | `{label, actual, consensus, vs_consensus, note}[]` | 실적 지표 테이블 |
| `metrics[].vs_consensus` | string | `+/-XX.X%` 형식 (색상 분기용) |
| `events` | `{title, description, impact}[]` | 주요 이벤트 목록 |
| `events[].impact` | string | `"positive"` \| `"negative"` \| `"neutral"` |
| `price_impact` | string | 주가 반응 요약 |
| `one_liner` | string | 종합 한 줄 요약 |

**`insights` 객체 필드** — 전문가 관점의 권고성 진입/회피 가이드

| 필드 | 타입 | 설명 |
|------|------|------|
| `stance` | string | `"진입"` \| `"관망"` \| `"회피"` — 현재 시점 종합 판단 |
| `entry` | string\|string[] | 진입(매수) 권고 조건. "전문가는 이럴 때 진입한다" 관점 |
| `avoid` | string\|string[] | 회피(관망/매도) 권고 조건. "이럴 때는 피하라" 관점 |
| `one_liner` | string | 한 줄 종합 권고 |

> `insights`는 가격·실적·이벤트를 종합해 "지금 어떻게 대응할지"를 권고하는 필드입니다. 단정적 매매 신호가 아니라 **조건부 가이드**로 작성하세요 (예: `"~ 확인 시 분할 매수"`). `entry`·`avoid`는 문자열 또는 문자열 배열 모두 가능합니다.

> 모든 객체 필드는 선택적입니다. 최소 1개 이상의 최상위 필드를 포함해야 합니다.
>
> **레거시 호환:** 기존 string 값도 그대로 저장/표시됩니다.

**Response `200`**
```json
{
  "ticker": "LLY",
  "updated": ["moat", "growth_plan", "risks", "recent_disclosures", "insights", "competitors"]
}
```

**Errors**

| 상태 | 설명 |
|------|------|
| `400` | 업데이트할 필드가 없음 |
| `401` | 인증 필요 |
| `404` | 보유종목 또는 관심종목에 없는 ticker |

---

### `PUT /api/stocks/enrich/batch`

여러 종목의 AI 분석 정보를 한 번에 저장합니다.

**Auth:** `X-API-Key` 헤더

**Request Body** — 종목 배열 (`ticker` 필수, 나머지 선택. 각 필드 스키마는 단건 enrich와 동일)
```json
[
  {
    "ticker": "LLY",
    "moat": { "rating": "wide", "summary": "특허·R&D 인프라 기반 최상급 경쟁 우위", "factors": [...] },
    "growth_plan": { "strategy": "비만 시장 독점 확대", "initiatives": [...] },
    "risks": { "factors": [...] },
    "recent_disclosures": { "period": "2026Q1", "headline": "어닝 서프라이즈", "metrics": [...], "events": [...], "one_liner": "..." },
    "insights": { "stance": "관망", "entry": "눌림목 + 가이던스 상향 확인 시 분할 매수", "avoid": "경쟁 비만약 FDA 승인 임박", "one_liner": "독점 해자 견고하나 밸류 부담, 눌림 진입 권장" },
    "competitors": ["NVO", "AZN"]
  },
  {
    "ticker": "AVAV",
    "moat": { "rating": "narrow", "summary": "방위산업 규제 장벽과 운용 노하우", "factors": [...] },
    "risks": { "factors": [...] }
  }
]
```

**Response `200`**
```json
{
  "updated": ["LLY", "AVAV"],
  "not_found": ["NVDA"]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `updated` | string[] | 정상 저장된 ticker 목록 |
| `not_found` | string[] | 전역 tickers 테이블에 없거나 업데이트 필드가 없어서 건너뛴 ticker 목록 |

**Errors**

| 상태 | 설명 |
|------|------|
| `400` | 배열이 비어 있음 |
| `401` | 인증 필요 |

---

### `GET /api/report/backlog/pending`

DART에서 수주잔고 섹션 텍스트를 가져왔으나 자동 파싱에 실패한 항목 목록입니다. Claude Cowork가 `raw_text`를 읽어 수치를 추출한 뒤 PUT으로 저장합니다.

**Auth:** `X-API-Key` 헤더

**Response `200`**
```json
[
  {
    "ticker": "012450",
    "quarter": "2024Q3",
    "raw_text": "수주잔고\n당기말\n전기말\n...",
    "unit": "억원"
  }
]
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `ticker` | string | 종목 코드 (KR 6자리) |
| `quarter` | string | 분기 (예: `"2024Q3"`, 형식 `YYYYQn`) |
| `raw_text` | string | DART 보고서 섹션 원문 텍스트 (최대 8000자) |
| `unit` | string | 금액 단위 (항상 `"억원"`) |

> 빈 배열이면 분석 대기 항목 없음.

---

### `PUT /api/report/{ticker}/backlog`

Claude Cowork가 `raw_text`에서 추출한 수주잔고 수치를 저장합니다. 해당 ticker·quarter의 `source`가 `'pending'`인 행만 업데이트됩니다.

**Auth:** `X-API-Key` 헤더

**Path Parameter:** `ticker` — 종목 코드 (예: `012450`)

**Request Body** — 분기별 수치 배열
```json
[
  { "quarter": "2024Q3", "amount": 85432.0 },
  { "quarter": "2024Q2", "amount": 79210.5 }
]
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `quarter` | string | ✅ | 분기 (`YYYY Q[1-4]`) |
| `amount` | number | ✅ | 수주잔고 금액 (억원) |

**Response `200`**
```json
{ "ticker": "012450", "saved": 2 }
```

**Errors**

| 상태 | 설명 |
|------|------|
| `401` | 인증 필요 |

---

### `POST /api/report/generate`

enrich 완료 후 전체 종목의 리포트 스냅샷을 재생성합니다. 백그라운드에서 실행되며 즉시 202를 반환합니다.

**Auth:** `X-API-Key` 헤더

**Query Parameters** (모두 선택)

| 파라미터 | 설명 |
|----------|------|
| `tickers` | 쉼표 구분 티커 목록 (생략 시 전체 종목) |
| `date` | 스냅샷 날짜 `YYYY-MM-DD` (생략 시 오늘) |

**Response `202`**
```json
{ "message": "Generating reports for 92 stock(s)" }
```

> 생성 완료까지 수 분 소요. 완료 여부는 `GET /api/report/progress`로 확인 가능.

---

## 공통 에러 형식

```json
{ "detail": "에러 메시지" }
```

---

## 저장 후 효과

`enrich` API로 저장한 값은 리포트 생성 시 자동으로 반영됩니다.

- **`moat`** — 리포트 "경제적 해자" 섹션에 표시
- **`growth_plan`** — 리포트 "장기 성장 계획" 섹션에 표시
- **`risks`** — 리포트 "리스크" 섹션에 표시
- **`recent_disclosures`** — 리포트 "최근 공시 & 주가 영향" 섹션 상단에 표시
- **`insights`** — 리포트 "권고 인사이트(진입/회피 가이드)" 섹션에 표시
- **`competitors`** — 경쟁사 비교 섹션에 반영

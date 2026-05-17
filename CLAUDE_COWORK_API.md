# PortfoliOn — Claude Cowork 외부 API

> Claude Cowork가 종목 목록을 조회하고, AI가 생성한 분석 정보를 PortfoliOn 백엔드에 저장하기 위한 API입니다.

**Base URL:** `http://localhost:8000`  
**Content-Type:** `application/json`

---

## 워크플로우

```
1. GET /api/stocks          → 분석 대상 종목 목록 조회
2. (AI가 각 종목 분석 수행)
3. PUT /api/stocks/enrich/batch  → 분석 결과 일괄 저장
   또는
   PUT /api/stocks/{ticker}/enrich  → 종목 1개 저장
```

---

## 엔드포인트

### `GET /api/stocks`

보유종목과 관심종목 전체 목록을 반환합니다.

**Response `200`**
```json
[
  { "ticker": "LLY",  "name": "일라이 릴리", "type": "holding" },
  { "ticker": "AVAV", "name": "AVAV",        "type": "watchlist" }
]
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `ticker` | string | 종목 코드 |
| `name` | string | 종목명 (없으면 ticker 값) |
| `type` | string | `"holding"` (보유종목) \| `"watchlist"` (관심종목) |

---

### `PUT /api/stocks/{ticker}/enrich`

단일 종목의 AI 분석 정보를 저장합니다. 포함된 필드만 덮어쓰고 나머지는 기존 값을 유지합니다.

**Path Parameter:** `ticker` — 종목 코드 (예: `LLY`)

**Request Body**
```json
{
  "moat": "특허 포트폴리오와 제조 규모의 경제로 진입 장벽 형성",
  "growth_plan": "2027년까지 GLP-2 파이프라인 확장 및 비만 치료제 시장 선점",
  "risks": "GLP-1 경쟁 심화, 약가 규제 리스크, 임상 실패 가능성",
  "recent_disclosures": "2026-05 Q1 실적: EPS $4.82 (예상치 상회), 연간 가이던스 상향",
  "competitors": ["NVO", "AZN"]
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `moat` | string | ❌ | 경제적 해자 분석 |
| `growth_plan` | string | ❌ | 장기 성장 계획 분석 |
| `risks` | string | ❌ | 리스크 요인 분석 |
| `recent_disclosures` | string | ❌ | 최근 공시 및 주가 영향 요약 |
| `competitors` | string[] | ❌ | 경쟁사 티커 목록 |

> 최소 1개 이상의 필드를 포함해야 합니다.

**Response `200`**
```json
{
  "ticker": "LLY",
  "updated": ["moat", "growth_plan", "risks", "recent_disclosures", "competitors"]
}
```

**Errors**

| 상태 | 설명 |
|------|------|
| `400` | 업데이트할 필드가 없음 |
| `404` | 보유종목 또는 관심종목에 없는 ticker |

---

### `PUT /api/stocks/enrich/batch`

여러 종목의 AI 분석 정보를 한 번에 저장합니다.

**Request Body** — 종목 배열 (각 항목은 `ticker` 필수, 나머지는 선택)
```json
[
  {
    "ticker": "LLY",
    "moat": "특허 포트폴리오와 제조 규모의 경제",
    "growth_plan": "GLP-2 파이프라인 확장",
    "risks": "GLP-1 경쟁 심화, 약가 규제 리스크",
    "recent_disclosures": "Q1 EPS $4.82 예상치 상회",
    "competitors": ["NVO", "AZN"]
  },
  {
    "ticker": "AVAV",
    "moat": "방위산업 규제 장벽과 운용 노하우",
    "growth_plan": "자율비행 시스템 민간 시장 확대",
    "risks": "방산 예산 삭감, 기술 유출 위험"
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
| `not_found` | string[] | 포트폴리오에 없어서 건너뛴 ticker 목록 |

**Errors**

| 상태 | 설명 |
|------|------|
| `400` | 배열이 비어 있음 |

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
- **`competitors`** — 경쟁사 비교 섹션에 반영

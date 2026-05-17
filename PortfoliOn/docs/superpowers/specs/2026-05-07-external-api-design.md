# 외부 API — 종목 목록 조회 & AI 정보 업데이트

**날짜:** 2026-05-07  
**범위:** `backend/routers/stocks.py` 신규 + 관련 백엔드 파일 수정

---

## 목표

Claude Cowork 등 외부 시스템이:
1. 종목 목록을 조회하고
2. Claude가 생성한 투자 분석(경제적 해자·장기 성장 계획·최근 공시 & 주가 영향)을 이 백엔드에 저장할 수 있도록 외부용 API를 추가한다.

---

## 엔드포인트

### 1. `GET /api/stocks`

holdings + watchlist 전체를 flat list로 반환. 최소 필드만 포함.

**응답 예시:**
```json
[
  { "ticker": "LLY",  "name": "일라이 릴리", "type": "holding" },
  { "ticker": "AVAV", "name": "AVAV",        "type": "watchlist" }
]
```

- `type`: `"holding"` | `"watchlist"`
- 이름이 없으면 ticker를 name으로 사용

---

### 2. `PUT /api/stocks/{ticker}/enrich`

한 종목의 AI 생성 필드를 저장. 세 필드 모두 선택적(Optional) — 보내지 않으면 기존 값 유지.

**요청 바디:**
```json
{
  "moat": "특허 포트폴리오와 제조 규모의 경제...",
  "growth_plan": "2027년까지 GLP-2 파이프라인 확장...",
  "recent_disclosures": "2026-05 Q1 실적 발표: EPS $4.82 예상치 상회..."
}
```

**응답:**
```json
{ "ticker": "LLY", "updated": ["moat", "growth_plan", "recent_disclosures"] }
```

**에러:**
- 존재하지 않는 ticker → `404 { "detail": "Ticker not found" }`
- 바디가 비어 있음 → `400 { "detail": "No fields provided" }`

---

### 3. `PUT /api/stocks/enrich/batch`

여러 종목을 한 번에 처리.

**요청 바디:**
```json
[
  { "ticker": "LLY",  "moat": "...", "growth_plan": "..." },
  { "ticker": "TSLA", "recent_disclosures": "..." }
]
```

**응답:**
```json
{ "updated": ["LLY", "TSLA"], "not_found": [] }
```

- 존재하지 않는 ticker는 `not_found` 배열에 포함, 나머지는 정상 처리
- 배열이 비어 있으면 `400`

---

## 데이터 스키마 변경

### `portfolio.json` 종목 객체에 `recent_disclosures` 필드 추가

```json
{
  "ticker": "LLY",
  "name": "일라이 릴리",
  "quantity": 3.0,
  "avg_cost": 886.6,
  "competitors": ["NVO"],
  "moat": "",
  "growth_plan": "",
  "recent_disclosures": ""
}
```

watchlist 항목도 동일하게 추가.

---

## 리포트 생성 변경

`backend/services/report_generator.py` `_section6()` 수정:

- `stock.get("recent_disclosures")` 값이 있으면 해당 내용을 섹션 상단에 표시
- 이후 기존 스크래핑 뉴스(`scraper.get_news()`)를 동일하게 표시 (폴백이 아닌 병행)

최종 섹션 구조:
```
## 6️⃣ 최근 공시 & 주가 영향

### AI 분석
<recent_disclosures 내용> (있을 때만)

### 최근 뉴스
- [...뉴스 목록...]
```

---

## 변경 파일 요약

| 파일 | 변경 |
|---|---|
| `backend/routers/stocks.py` | 신규 생성 — GET /api/stocks, PUT enrich 2개 |
| `backend/main.py` | stocks 라우터 등록 (`/api` 접두사) |
| `backend/services/storage.py` | `enrich_stock()` 함수 추가 |
| `backend/services/report_generator.py` | `_section6()`에 recent_disclosures 반영 |
| `backend/data/portfolio.json` | 모든 종목에 `recent_disclosures: ""` 필드 추가 |

---

## 범위 외

- 인증/API 키 보호 없음 (추후 추가 가능)
- Claude API 직접 호출 없음 (Claude Cowork가 담당)
- 프론트엔드 변경 없음

# 데이터 구조 정규화 설계

**날짜:** 2026-05-20  
**브랜치:** data-normalization  
**목표:** JSON 파일 스키마를 DB 전환 대비 정규화하고, 마크다운 파일 기반 리포트를 JSON API + 프론트엔드 섹션 컴포넌트 렌더링으로 전환

---

## 1. 데이터 스키마

### 1.1 통합 `backend/data/stocks.json`

기존 3개 파일(`holdings.json`, `watchlist.json`, `stocks.json`)을 단일 파일로 통합.

```json
{
  "stocks": [
    {
      "ticker": "LLY",
      "name": "일라이 릴리",
      "market": "US",
      "exchange": "",
      "type": "holding",
      "quantity": 3.0,
      "avg_cost": 886.6,
      "competitors": ["NVO", "PFE", "AZN", "MRK"],
      "moat": "...",
      "growth_plan": "...",
      "recent_disclosures": "...",
      "risks": "..."
    }
  ]
}
```

**필드 정의:**
- `type`: `"holding"` | `"watchlist"` — portfolio 소속 구분
- `quantity`, `avg_cost`: holding만 사용, watchlist는 `null`
- `market`: 기본값 `"US"`, 한국 종목은 `"KR"`
- `exchange`: KR 종목은 `"KS"` 등, US는 `""`

**DB 매핑:** `stocks` 테이블 1개, `type` 컬럼으로 구분.

**기존 파일 처리:** `holdings.json`, `watchlist.json`은 마이그레이션 후 삭제. 기존 `stocks.json`은 통합 파일로 교체.

### 1.2 스냅샷 `backend/snapshots/{TICKER}/{DATE}.json`

기존 `backend/reports/{TICKER}/{DATE}.json`과 동일 스키마에 필드 추가.

**추가 필드 (현재 마크다운에만 존재):**
```json
{
  "moat": "...",
  "growth_plan": "...",
  "recent_disclosures": "...",
  "risks": "...",
  "competitors_data": [
    { "ticker": "NVO", "name": "...", "price": 44.28, "market_cap": ..., "ytd_return": -31.9 }
  ],
  "news": [
    { "title": "...", "link": "...", "publisher": "...", "published_at": "..." }
  ]
}
```

**제거:** 마크다운 파일(`{DATE}.md`) 생성 완전 중단.

**DB 매핑:** `daily_snapshots(ticker, date, ...)` 테이블.

### 1.3 캐시 정책

- `GET /api/report/{ticker}/{date}` → `functools.lru_cache` 또는 dict 기반 LRU, 최대 200 항목
- `GET /api/report/list` → 5초 TTL in-memory 캐시
- 리포트 생성 완료 시 해당 ticker 캐시 즉시 무효화

---

## 2. 백엔드 변경

### 2.1 `services/storage.py`

- `get_full_portfolio()`: 통합 `stocks.json` 읽어서 `type` 필드로 분리 반환
  ```python
  return {
    "stocks": [s for s in stocks if s["type"] == "holding"],
    "watchlist": [s for s in stocks if s["type"] == "watchlist"],
  }
  ```
- 기존 호출부 인터페이스 유지 — 라우터/서비스 변경 불필요
- `save_holdings()`, `save_watchlist()` → 통합 파일 업데이트로 내부 구현 변경

### 2.2 `services/report_generator.py`

- 저장 경로: `backend/reports/` → `backend/snapshots/`
- 마크다운 생성 코드 전체 제거 (`_header`, `_section*` 함수들 삭제)
- JSON 스냅샷에 `moat`, `growth_plan`, `recent_disclosures`, `risks`, `competitors_data`, `news` 추가

### 2.3 `services/cache.py` (신규)

```python
# 30줄 이내 경량 캐시
_snapshot_cache: dict[str, dict] = {}  # "TICKER/DATE" → data
_list_cache = {"data": None, "ts": 0.0}
LIST_TTL = 5.0
MAX_SNAPSHOT = 200

def get_snapshot(ticker: str, date: str, loader) -> dict: ...
def invalidate(ticker: str): ...
def invalidate_list(): ...
```

### 2.4 `routers/report.py`

- `GET /api/report/{ticker}/{date}`: `content` 필드 제거, `summary` JSON만 반환
- 스냅샷 경로를 `reports/` → `snapshots/`로 변경
- 캐시 레이어 적용

### 2.5 API 응답 변경

```json
// GET /api/report/{ticker}/{date} — 변경 후
{
  "ticker": "LLY",
  "date": "2026-05-20",
  "summary": { ...전체 스냅샷 JSON... }
}
// "content" 필드 제거
```

---

## 3. 프론트엔드 변경

### 3.1 제거

- `frontend/src/components/MarkdownViewer.jsx` 삭제
- `Reports.jsx`에서 `content` 사용 코드 제거

### 3.2 신규 섹션 컴포넌트 (`Reports.jsx` 내부 또는 별도 파일)

| 컴포넌트 | 데이터 소스 | 현재 마크다운 섹션 |
|---|---|---|
| `ReportHeader` | `summary.price`, `summary.market` | 헤더 |
| `ReportSection1` | `summary.competitors_data` | 1️⃣ 사업영역 & 시장순위 |
| `ReportSection2` | `summary.risks` | 2️⃣ 리스크 |
| `ReportSection3` | `summary.moat` | 3️⃣ 경제적 해자 |
| `ReportSection4` | `summary.growth_plan` | 4️⃣ 장기 성장 계획 |
| `ReportSection5` | `summary.recent_disclosures`, `summary.news` | 5️⃣ 최근 공시 & 뉴스 |

기존 차트(RSI, 재무, 컨센서스)는 `summary` JSON 동일 필드 사용 — 변경 없음.

### 3.3 텍스트 섹션 렌더링

`moat`, `risks`, `growth_plan`, `recent_disclosures`는 plain text → `<p>` 태그로 렌더링. 마크다운 파싱 불필요.

---

## 4. 마이그레이션 절차

1. 기존 `backend/data/holdings.json` + `watchlist.json` + `stocks.json` → 통합 `stocks.json` 생성 (일회성 스크립트)
   - watchlist 항목 중 `stocks.json`에 분석 데이터 없는 종목은 `moat`, `risks` 등 `null`로 초기화
2. 신규 스냅샷은 `backend/snapshots/`에 저장
3. 기존 `backend/reports/` 데이터: **그대로 유지** (삭제 안 함). 라우터는 `snapshots/` 우선 조회, 없으면 `reports/` fallback
4. `backend/main.py`의 `/reports/` 정적 파일 서빙 제거 (마크다운 파일 불필요)

---

## 5. 테스트 범위

- `storage.py`: 통합 파일 읽기/쓰기, holdings/watchlist 분리 반환
- `report_generator.py`: JSON 생성 확인, 마크다운 미생성 확인
- `cache.py`: TTL 만료, 무효화, LRU 동작
- 프론트엔드: 각 섹션 컴포넌트 props 렌더링 (수동 확인)

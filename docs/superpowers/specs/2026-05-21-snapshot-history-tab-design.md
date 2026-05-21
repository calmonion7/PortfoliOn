# 스냅샷 히스토리 탭 설계

## 개요

Reports 페이지 상세 뷰에 `📅 히스토리` 탭을 추가한다. 같은 종목의 날짜별 스냅샷을 트렌드 차트와 날짜 비교 테이블로 조회할 수 있다.

**진입점:** Reports 페이지 → 종목 클릭 → 상세 뷰 → `📅 히스토리` 탭

---

## 백엔드

### 새 엔드포인트

```
GET /api/report/{ticker}/history
```

**응답 (날짜 오름차순 배열):**

```json
[
  {
    "date": "2026-02-20",
    "price": 127626.52,
    "target_mean": 222900.0,
    "target_high": 300000.0,
    "target_low": 165000.0,
    "buy": 19,
    "hold": 1,
    "sell": 0,
    "rsi_daily": 73.07,
    "rsi_weekly": 79.18,
    "rsi_monthly": 84.9
  }
]
```

- `daily_rsi.rsi`, `weekly_rsi.rsi`, `monthly_rsi.rsi` 를 평탄화하여 반환
- null 필드는 null 포함 (프론트에서 처리)
- 캐싱: 기존 `cache_svc` 활용

**등록 위치:** `backend/routers/report.py`에서 `/report/{ticker}/{date_str}` 보다 **앞에** 등록해야 "history"가 date_str로 파싱되지 않음

**변경 파일:** `backend/routers/report.py` (~25줄 추가)

---

## 프론트엔드

### 탭 추가

기존 탭 배열에 항목 추가:

```js
{ key: 'history', label: '📅 히스토리' }
```

### 새 컴포넌트: `HistoryTab`

`Reports.jsx` 내 다른 함수형 컴포넌트들과 동일한 패턴으로 추가.

**Props:**

| Prop | 타입 | 설명 |
|------|------|------|
| `ticker` | string | 종목 코드 |
| `dates` | string[] | 해당 종목의 전체 날짜 목록 (report list에서 이미 보유) |

**내부 상태:**

| 상태 | 설명 |
|------|------|
| `history` | `/report/{ticker}/history` 응답 배열 |
| `compareA` | 비교 날짜 A (기본: 가장 최근 날짜) |
| `compareB` | 비교 날짜 B (기본: 두 번째로 최근 날짜) |
| `snapshotA` | 날짜 A의 full snapshot |
| `snapshotB` | 날짜 B의 full snapshot |

### 레이아웃

```
┌─────────────────────────────────────────┐
│  트렌드 섹션                              │
│  [목표가] [RSI]  ← 서브탭 2개             │
│                                          │
│  목표가 탭:                               │
│    Line: target_mean / target_high /     │
│           target_low                     │
│    Bar : buy 수                          │
│                                          │
│  RSI 탭:                                 │
│    Line: rsi_daily / rsi_weekly /        │
│           rsi_monthly                    │
│    ReferenceLine: 30 (과매도), 70 (과매수) │
├─────────────────────────────────────────┤
│  날짜 비교 섹션                           │
│  [날짜A ▼]              [날짜B ▼]         │
│  ┌──────────────┬──────────────┐         │
│  │ 현재가        │ 현재가        │         │
│  │ 목표가(평균)  │ 목표가(평균)  │         │
│  │ 목표가(최고)  │ 목표가(최고)  │         │
│  │ 목표가(최저)  │ 목표가(최저)  │         │
│  │ Buy/Hold/Sell│ Buy/Hold/Sell│         │
│  │ RSI 일/주/월 │ RSI 일/주/월 │         │
│  └──────────────┴──────────────┘         │
│  변화 요약: 목표가 +X%, Buy +N명 ...      │
└─────────────────────────────────────────┘
```

**차트 라이브러리:** 기존 `recharts` 그대로 사용  
**스타일:** 기존 `TH`, `TD`, `var(--accent)`, `var(--border)` 등 그대로

**변경 파일:** `frontend/src/pages/Reports.jsx` (~150줄 추가)

---

## 데이터 흐름

히스토리 탭 진입 → `GET /api/report/{ticker}/history` → `history` 배열 저장 → 트렌드 차트 렌더

날짜A/B 선택 (기본: 최근 2개) → `GET /api/report/{ticker}/{dateA}`, `GET /api/report/{ticker}/{dateB}` (기존 API, 캐싱 적용) → 비교 테이블 렌더

---

## 엣지 케이스

| 상황 | 처리 |
|------|------|
| 스냅샷 0개 | 탭 전체에 "히스토리 데이터가 없습니다" |
| 스냅샷 1개 | 비교 섹션에 "비교할 날짜가 없습니다", 트렌드는 단일 포인트 표시 |
| 특정 날짜 필드 null | 차트 `connectNulls={false}` 로 갭 처리 |
| `/history` 요청 실패 | 에러 메시지 인라인 표시 |

---

## 성공 기준

- AAPL 히스토리 탭 진입 시 `/history` 요청 1개만 발생 (64개 아님)
- 날짜 2개 선택 시 비교 테이블 정상 렌더
- 스냅샷 1개 종목에서 비교 섹션 graceful 처리 확인
- 기존 요약/기술적 분석/리포트 탭 동작 회귀 없음

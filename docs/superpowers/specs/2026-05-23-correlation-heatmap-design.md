# Correlation Heatmap — Design Spec

**Date:** 2026-05-23  
**Status:** Approved

---

## Goal

Analytics 페이지에 종목 간 상관관계 히트맵을 추가한다. 보유종목 90일 종가 데이터로 Pearson 상관관계 행렬을 계산해 SVG 히트맵으로 시각화한다.

---

## Architecture

### Data Flow

```
Analytics.jsx 마운트
  → GET /api/analytics/correlation
      ├── stocks.json 보유종목 목록
      ├── yfinance .history(period="90d") × 각 종목 (ThreadPoolExecutor 병렬)
      ├── pandas DataFrame → .corr() (Pearson)
      └── NxN 행렬 반환
  → Analytics.jsx
      └── CorrelationHeatmap (SVG)
```

### Caching

`backend/services/cache.py`의 `TTLCache` 패턴 재사용, TTL 300s.  
종목 추가/삭제/수정 시 기존 대시보드 캐시와 함께 correlation 캐시도 무효화.

---

## Backend

### New: `backend/routers/analytics.py`

`GET /api/analytics/correlation`

**Logic:**
1. `storage.get_full_portfolio()` → holdings 목록
2. 보유종목 2개 미만이면 `{"tickers": [], "matrix": []}` 반환
3. `ThreadPoolExecutor`로 각 종목 `yf.Ticker(sym).history(period="90d")["Close"]` 병렬 수집
4. 데이터 부족 종목(< 20 거래일) 제외
5. `pd.DataFrame(closes).corr()` → 값을 `round(v, 3)`
6. TTL 캐시 적용 (300s)

**Response 200:**
```json
{
  "tickers": ["AAPL", "MSFT", "005930"],
  "matrix": [
    [1.0,  0.82, 0.31],
    [0.82, 1.0,  0.28],
    [0.31, 0.28, 1.0]
  ]
}
```

**Edge cases:**
- 보유종목 0~1개: `{"tickers": [], "matrix": []}`
- 특정 종목 yfinance 실패: 해당 종목 제외 후 나머지로 계산
- 전체 실패: `{"tickers": [], "matrix": []}`

### Modify: `backend/main.py`

analytics 라우터 마운트:
```python
from routers import analytics
app.include_router(analytics.router, prefix="/api/analytics")
```

### Modify: `backend/services/cache.py`

`invalidate_dashboard()` 호출 시 correlation 캐시도 함께 무효화.  
또는 `invalidate_analytics()` 별도 메서드 추가 후 종목 변경 이벤트에서 호출.

---

## Frontend

### Modify: `frontend/src/pages/Analytics.jsx`

**새 컴포넌트 `CorrelationHeatmap`:**

- `useEffect`로 `GET /api/analytics/correlation` 별도 호출
- `tickers.length < 2`이거나 빈 응답이면 "보유종목 2개 이상 필요" 메시지 표시
- SVG `<rect>` 셀 격자 렌더링:
  - 셀 크기: 48×48px
  - 색상 보간: `1.0` → `#4fc3f7` / `0.0` → `var(--bg-card)` / `-1.0` → `#ef9a9a`
  - 셀 내 수치 텍스트 (fontSize 10, 소수점 2자리)
- 행/열 레이블: ticker명 (fontSize 11)
- SVG 전체 크기: `(n+1) * 48` × `(n+1) * 48` (레이블 포함)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `backend/routers/analytics.py` | `/api/analytics/correlation` 엔드포인트 |
| Modify | `backend/main.py` | analytics 라우터 마운트 |
| Modify | `backend/services/cache.py` | correlation 캐시 무효화 추가 |
| Create | `backend/tests/test_analytics_router.py` | 엔드포인트 테스트 |
| Modify | `frontend/src/pages/Analytics.jsx` | `CorrelationHeatmap` 컴포넌트 추가 |

---

## Success Criteria

1. `GET /api/analytics/correlation` 보유종목 2개 이상 시 NxN 행렬 반환
2. 대각선 값 = 1.0, 행렬 대칭
3. Analytics 페이지 하단에 히트맵 렌더링 (셀 색상 + 수치)
4. 종목 1개 이하 시 "보유종목 2개 이상 필요" 메시지
5. 기존 섹터 배분 / 버블 차트 영향 없음

---

## Out of Scope

- 기간 선택 UI (60일/90일/1년 토글)
- 특정 상관관계 임계값 알림
- 상관관계 변화 추이 차트

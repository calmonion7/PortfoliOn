# 이벤트 캘린더 설계

**날짜:** 2026-05-22  
**상태:** 승인됨

## 개요

보유종목·관심종목의 실적 발표일과 배당락일을 월간 그리드 캘린더로 표시하는 신규 페이지.

## 요구사항

- 월간 그리드 캘린더 UI
- 보유종목 / 관심종목 탭 전환
- 이벤트 타입: 실적 발표일(earnings), 배당락일(ex-dividend)
- 데이터 소스: yfinance

## 아키텍처

### 백엔드

**엔드포인트:** `GET /api/calendar?month=YYYY-MM`

- `stocks.json`에서 보유+관심 ticker 목록 읽기
- yfinance로 각 ticker의 실적일·배당락일 조회
- 해당 월에 해당하는 이벤트만 필터링하여 반환
- 캐시 TTL: 6시간 (월별 키)

**응답 스키마:**
```json
{
  "events": [
    { "date": "2026-05-19", "ticker": "LLY", "type": "earnings", "stock_type": "holding" },
    { "date": "2026-05-21", "ticker": "AAPL", "type": "dividend", "stock_type": "watchlist" }
  ]
}
```

**데이터 수집 방법:**
- 실적일: `yf.Ticker(ticker).calendar` → `Earnings Date` 필드
- 배당락일: `yf.Ticker(ticker).dividends` → 최근 배당 주기로 다음 배당락일 추정

**파일:** `backend/routers/calendar.py` (신규), `backend/main.py`에 라우터 등록

### 프론트엔드

**파일:** `frontend/src/pages/Calendar.jsx` (신규)

**UI 구조:**
```
[보유종목] [관심종목]   ← 토글 탭
< 2026년 5월 >         ← 월 이동
[월간 그리드]
  - 날짜 셀에 ticker + 이벤트 뱃지
  - 실적: 파란색 뱃지, 배당락: 초록색 뱃지
```

**네비게이션:** 기존 App.jsx에 `/calendar` 라우트 + 사이드바/헤더 링크 추가

## 엣지 케이스

- yfinance에 실적일 데이터 없는 종목: 해당 종목 이벤트 생략 (에러 아님)
- 배당 이력 없는 종목(무배당): 배당락일 생략
- 동일 날짜에 여러 종목 이벤트: 셀 내에 여러 뱃지 표시

## 범위 외

- 텔레그램 알림 연동
- 경제 지표 이벤트 (FOMC 등)
- 이벤트 상세 클릭 시 모달

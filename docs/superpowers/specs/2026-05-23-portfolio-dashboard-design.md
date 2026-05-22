# Portfolio Dashboard — Design Spec

**Date:** 2026-05-23  
**Status:** Approved

---

## Goal

포트폴리오 페이지에 "대시보드" 탭을 추가해 보유종목 전체를 카드 그리드로 한눈에 파악한다.  
각 카드는 AI 날씨 신호, 현재가/변동률, 평단가 대비 수익률, RSI·컨센서스 요약을 표시한다.

---

## Architecture

### Data Flow

```
대시보드 탭 클릭
  → GET /api/dashboard
      ├─ stocks.json — 보유종목 목록 (ticker, name, market, avg_cost, quantity)
      ├─ 각 종목 최신 스냅샷 로드 (RSI, target_mean, buy/hold/sell, snapshot price)
      └─ yfinance / Naver 현재 시세 조회 (current_price, daily/weekly/monthly change)
  → 클라이언트 — overallWeather() 계산 후 카드 그리드 렌더링
```

### Backend Changes

**`backend/services/market.py`**

`get_quote()` 반환 dict에 두 필드 추가:
- `weekly_change_pct: float | None` — yfinance `.history(period='5d')` 기준 5영업일 변동률
- `monthly_change_pct: float | None` — yfinance `.history(period='1mo')` 기준 1개월 변동률

한국 종목은 Naver API가 주간/월간 변동을 제공하지 않으면 yfinance fallback 사용.

**`backend/routers/stocks.py`**

새 엔드포인트 `GET /api/dashboard` 추가:

```
Response 200:
[
  {
    "ticker": "AAPL",
    "name": "Apple Inc.",
    "market": "US",
    "avg_cost": 150.0,
    "quantity": 10,
    "current_price": 185.20,
    "daily_change_pct": 1.4,
    "weekly_change_pct": 2.1,
    "monthly_change_pct": 5.8,
    "rsi": 62.3,
    "target_mean": 210.0,
    "buy": 28,
    "hold": 8,
    "sell": 2,
    "snapshot_date": "2026-05-20"
  },
  ...
]
```

- 보유종목만 포함 (관심종목 제외)
- 시세 조회는 ThreadPoolExecutor(max_workers=10)로 병렬 처리 (캘린더 라우터 패턴 동일)
- 스냅샷이 없는 종목은 시세 필드만 반환 (RSI·컨센서스는 null)

### Frontend Changes

**`frontend/src/pages/Portfolio.jsx`**

1. 탭 목록에 `대시보드` 추가 (`activeTab === 'dashboard'` 분기)
2. 같은 파일 안에 `DashboardGrid` 컴포넌트 구현 (별도 파일 불필요)
3. `overallWeather()` 로직은 Reports.jsx와 동일한 계산식 — 그대로 복사해 Portfolio.jsx 내에 정의

---

## Card Layout

```
┌────────────────────────────────┐
│ ☀️  AAPL  🇺🇸 US                │  날씨 아이콘 + 티커 + 마켓 배지
│ Apple Inc.                     │  종목명
│                                │
│  $185.20        ▲ +1.4% 오늘   │  현재가 + 일간 변동
│  주간 ▲+2.1%    월간 ▲+5.8%   │  주간/월간 변동
│                                │
│  수익률 ▲+23.5%  (10주 보유)   │  평단가 대비 수익률
│  RSI 62.3       컨센서스 +18%  │  리스크 지표
└────────────────────────────────┘
```

- **날씨 아이콘**: `overallWeather({ target_mean, price, buy, hold, sell, daily_rsi })` 계산
- **수익률**: `(current_price - avg_cost) / avg_cost * 100`
- **컨센서스 괴리율**: `(target_mean - current_price) / current_price * 100`
- **변동률 색상**: 양수 → 초록, 음수 → 빨강, 0 → 회색
- **스냅샷 없는 종목**: 날씨·RSI·컨센서스 칸을 `—` 표시

---

## Error Handling

- 시세 조회 실패 시 해당 종목 카드는 `current_price: null`로 반환, 프론트엔드에서 `—` 표시
- 보유종목이 없으면 빈 상태 메시지 표시

---

## Out of Scope

- 관심종목 대시보드 (보유종목만)
- 실시간 자동 새로고침 (수동 새로고침만)
- 차트 미니 프리뷰 (카드에 숫자만)

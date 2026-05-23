# Market Data Expansion — Design Spec

**Date:** 2026-05-23  
**Status:** Approved

## 목표

Market 페이지에 환율, VIX, 원자재, 경제지표(CPI/실업률) 4개 섹션 추가.

---

## 백엔드

### 파일

`backend/services/market_indicators_service.py` — 기존 파일에 함수 추가.

### 추가 함수

#### `get_fx() → dict`

- 데이터 소스: yfinance (`USDKRW=X`, `USDJPY=X`, `EURUSD=X`)
- 반환:
  ```json
  {
    "rates": {
      "usdkrw": {"current": 1370.5, "change_pct": -0.3},
      "usdjpy": {"current": 155.2, "change_pct": 0.1},
      "eurusd": {"current": 1.085, "change_pct": 0.2}
    },
    "history": {
      "usdkrw": [{"date": "2025-05-23", "value": 1370.5}]
    }
  }
  ```
- history는 `usdkrw`만 1년 일별 데이터 포함 (차트용)
- change_pct: 전일 대비 %
- TTL: 3600초

#### `get_vix() → dict`

- 데이터 소스: yfinance (`^VIX`)
- 반환:
  ```json
  {
    "current": 18.2,
    "change": -0.5,
    "history": [{"date": "2025-05-23", "value": 18.2}]
  }
  ```
- history: 1년 일별
- TTL: 3600초

#### `get_commodities() → dict`

- 데이터 소스: yfinance (`GC=F`=금, `CL=F`=WTI원유, `HG=F`=구리)
- 반환:
  ```json
  {
    "prices": {
      "gold":   {"current": 2350.0, "change_pct": 0.5, "unit": "USD/oz"},
      "oil":    {"current": 78.5,   "change_pct": -1.2, "unit": "USD/bbl"},
      "copper": {"current": 4.2,    "change_pct": 0.3,  "unit": "USD/lb"}
    },
    "history": {
      "gold":   [{"date": "...", "value": ...}],
      "oil":    [{"date": "...", "value": ...}],
      "copper": [{"date": "...", "value": ...}]
    }
  }
  ```
- history: 각 1년 일별
- TTL: 3600초

#### `get_econ_indicators() → dict`

- 데이터 소스: FRED API
  - CPI: series `CPIAUCSL` (월별, 미국 소비자물가지수)
  - 실업률: series `UNRATE` (월별, 미국 실업률)
- FRED API URL: `https://api.stlouisfed.org/fred/series/observations`
- FRED_API_KEY 환경변수 필요. 없으면 `{"error": "FRED_API_KEY 환경변수가 필요합니다."}` 반환.
- 반환:
  ```json
  {
    "cpi": [{"date": "2024-01-01", "value": 308.5}],
    "unemployment": [{"date": "2024-01-01", "value": 3.7}]
  }
  ```
- 기간: 최근 3년 (observation_start = 3년 전)
- TTL: 86400초 (24시간, 월간 발표)

### 라우터

`backend/routers/market_indicators.py`에 엔드포인트 4개 추가:

```
GET /api/market/fx
GET /api/market/vix
GET /api/market/commodities
GET /api/market/econ-indicators
```

각 엔드포인트: 해당 서비스 함수 호출 후 그대로 반환. 에러 시 500.

---

## 프론트엔드

### 파일

`frontend/src/pages/Market.jsx` — 섹션 컴포넌트 4개 추가.

### 추가 컴포넌트

#### `FxSection`

- 카드 3개: USD/KRW, USD/JPY, EUR/USD (현재값 + 전일 대비 %)
- 라인 차트: USD/KRW 1년 추이 (recharts LineChart)

#### `VixSection`

- 카드 1개: VIX 현재값
  - 색상: `≥30` 빨강, `20~30` 주황, `<20` 초록
- 라인 차트: VIX 1년 추이 + y=30 기준선 (ReferenceLine)

#### `CommoditiesSection`

- 카드 3개: 금, WTI, 구리 (현재가 + 단위 + 전일 대비 %)
- 라인 차트: 3종 겹친 1년 추이 (정규화 없이 각각 다른 축 사용 — YAxis 없이 상대 변화 표현하거나 각각 별도 차트)
  - **구체화:** 3개를 별도 소형 차트(height 140)로 가로 배열. 하나의 차트에 3종을 겹치면 가격 단위 차이로 의미 없음.

#### `EconIndicatorsSection`

- CPI와 실업률 차트를 가로로 나란히 배치 (각 `ResponsiveContainer` width 50%)
- 각각 라인 차트, 기간 3년

### 렌더링 순서

```
미국 국채금리
환율                    ← 신규
VIX (공포탐욕지수)       ← 신규
원자재                  ← 신규
경제지표 (CPI/실업률)    ← 신규
M7 vs S&P 500 순이익
삼성+하이닉스 vs KOSPI 200 순이익
한국 수출
```

---

## 환경변수

| 변수 | 용도 | 발급처 |
|------|------|--------|
| `FRED_API_KEY` | CPI/실업률 조회 | https://fred.stlouisfed.org/docs/api/api_key.html (무료) |

기존 `KITA_API_KEY`와 동일 패턴: 없으면 에러 메시지 반환, UI에서 안내 표시.

---

## 테스트 범위

- `get_fx()`, `get_vix()`, `get_commodities()`, `get_econ_indicators()` 단위 테스트
- FRED_API_KEY 없을 때 error 필드 반환 확인
- 캐시 hit/miss 동작 확인

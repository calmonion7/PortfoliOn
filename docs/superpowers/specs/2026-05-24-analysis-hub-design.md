# AnalysisHub 설계 스펙

**날짜:** 2026-05-24  
**범위:** 섹터 모멘텀 분석 + 매크로-포트폴리오 상관관계 분석  
**위치:** 새 독립 페이지 `/analysis` (내비게이션 1개 추가)

---

## 아키텍처 개요

### 새로 추가되는 파일

| 파일 | 역할 |
|------|------|
| `frontend/src/pages/AnalysisHub.jsx` | 탭 2개짜리 허브 페이지 |
| `backend/routers/analysis.py` | 섹터·매크로 엔드포인트 |
| `backend/services/analysis_service.py` | 데이터 계산 로직 |

### 데이터 흐름

```
yfinance (섹터 ETF 11종)
  → analysis_service.get_sector_momentum()
  → GET /api/analysis/sector

yfinance (TLT·UUP·USO·^VIX) + 포트폴리오 수익률
  → analysis_service.get_macro_correlation()
  → GET /api/analysis/macro-correlation
```

### 기존 코드 재활용

- `backend/routers/analytics.py` — 상관관계 계산 패턴
- `backend/services/cache.py` — 인메모리 캐시 (TTL 300s)
- `frontend/src/pages/MarketHub.jsx` — 탭 허브 UI 패턴
- `frontend/src/pages/Research.jsx` — 허브 페이지 구조 패턴

---

## 섹터 탭

### UI 구성

- **수익률 히트맵** — 섹터 ETF 11종, 기간 선택 (1주/1개월/3개월)
  - 셀 색상: 녹색(강세) ↔ 적색(약세), 상대적 강도 기준
- **포트폴리오 오버레이** — 보유 종목이 속한 섹터에 마커 표시
  - 섹터 매핑: yfinance `info.sector` 사용

### 섹터 ETF 11종 (하드코딩)

| ETF | 섹터 |
|-----|------|
| XLK | Technology |
| XLF | Financials |
| XLV | Health Care |
| XLE | Energy |
| XLI | Industrials |
| XLY | Consumer Discretionary |
| XLP | Consumer Staples |
| XLB | Materials |
| XLU | Utilities |
| XLRE | Real Estate |
| XLC | Communication Services |

### API

```
GET /api/analysis/sector
Response:
{
  "sectors": [
    { "name": "Technology", "etf": "XLK", "return_1w": 2.3, "return_1mo": 5.1, "return_3mo": 12.4 },
    ...
  ],
  "portfolio_sectors": {
    "AAPL": "Technology",
    "JPM": "Financials",
    ...
  }
}
```

**캐시:** TTL 300s

---

## 매크로 탭

### UI 구성

- **상관관계 테이블** — 매크로 지표 4종 vs 포트폴리오 수익률, 90일 기준
  - 상관계수 값 표시 + 색상 코딩 (양의 상관=녹색, 음의 상관=적색)
- **산점도** — 지표 선택 시
  - X축: 선택한 매크로 지표 일별 변동율
  - Y축: 포트폴리오 일별 수익률
  - 90일 데이터 포인트

### 매크로 지표 4종

| 지표 | 티커 | 의미 |
|------|------|------|
| 미국 10년물 금리 | TLT | 금리 방향 프록시 (역방향) |
| 달러 인덱스 | UUP | DXY 프록시 |
| 유가 | USO | WTI 프록시 |
| 공포 지수 | ^VIX | 시장 변동성 |

### API

```
GET /api/analysis/macro-correlation
Response:
{
  "correlations": [
    { "indicator": "미국 10년물 금리", "ticker": "TLT", "corr_90d": -0.42 },
    { "indicator": "달러 인덱스", "ticker": "UUP", "corr_90d": -0.18 },
    { "indicator": "유가", "ticker": "USO", "corr_90d": 0.31 },
    { "indicator": "공포 지수", "ticker": "^VIX", "corr_90d": -0.67 }
  ],
  "scatter": [
    { "date": "2026-02-23", "indicator": "TLT", "macro_delta": 0.3, "portfolio_return": -0.5 },
    ...
  ]
}
```

**포트폴리오 수익률 계산:** 보유 종목 가중평균 (현재가 기준 비중), 기존 `analytics.py` 로직 재사용  
**캐시:** TTL 300s

---

## 내비게이션 변경

`frontend/src/App.jsx` 또는 내비게이션 컴포넌트에 항목 1개 추가:

```
포트폴리오 | 리서치 | 시장 | 분석 | 구루 | 설정
```

---

## 성공 기준

1. `/analysis` 페이지 접근 시 섹터·매크로 탭 렌더링
2. 섹터 히트맵: 11개 ETF 수익률 표시, 기간 전환 동작
3. 포트폴리오 섹터 오버레이: 보유 종목 섹터 마커 표시
4. 매크로 테이블: 4개 지표 상관계수 표시
5. 산점도: 지표 선택 시 90일 데이터 포인트 표시
6. 캐시 TTL 300s 적용 (서버 재시작 후 첫 요청만 느림)

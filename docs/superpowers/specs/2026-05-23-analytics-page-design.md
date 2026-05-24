# Analytics Page — Design Spec

**Date:** 2026-05-23  
**Status:** Approved

---

## Goal

별도 Analytics 페이지를 신설해 포트폴리오 분석 두 가지를 제공한다:
1. **섹터 배분** — 보유 시가 기준 섹터 비중 도넛 차트
2. **기회 버블 차트** — 업사이드% × 수익률% × 보유비중 시각화

---

## Architecture

### Data Flow

```
Analytics 페이지 마운트
  → GET /api/dashboard  (기존 엔드포인트, sector 필드 추가)
      ├── stocks.json — 보유종목 (ticker, name, market, avg_cost, quantity)
      ├── 최신 스냅샷 — target_mean, buy, hold, sell
      ├── 현재 시세 — current_price
      └── 섹터 — Naver basic / yfinance
  → Analytics.jsx
      ├── SectorAllocation (PieChart)
      └── OpportunityBubble (ScatterChart)
```

### 섹터 수집 계층

| 순서 | 조건 | 소스 |
|------|------|------|
| 1 | KR 종목 | Naver `/basic` 응답 업종 필드 파싱 |
| 2 | KR fallback | yfinance `.KS` info `sector` |
| 3 | US 종목 | yfinance `.info["sector"]` |
| 4 | 최종 fallback | `"기타"` |

---

## Backend Changes

### `backend/services/market.py`

`get_quote_kr()` 내 섹터 파싱 로직 개선:
- Naver `/basic` 응답에서 업종 필드 추출 시도 (예: `industryCodeType`, `업종명` 등 실제 응답 확인 후 적용)
- 실패 시 기존 yfinance fallback 유지

### `backend/routers/stocks.py`

`GET /api/dashboard` 응답 각 항목에 `sector: str` 필드 추가.
- `get_quote()` / `get_quote_kr()` 반환값의 `sector` 를 그대로 포함

---

## Frontend Changes

### `frontend/src/pages/Analytics.jsx` (신규)

두 섹션으로 구성:

**SectorAllocation**
- Recharts `PieChart` (innerRadius 있는 도넛)
- 기준값: `quantity × current_price` (보유 시가)
- 섹터 없는 종목 → "기타"로 병합
- 우측 범례: 섹터명 / 비중% / 시가 합계

**OpportunityBubble**
- Recharts `ScatterChart`
- X축: 업사이드% = `(target_mean - current_price) / current_price × 100`
- Y축: 수익률% = `(current_price - avg_cost) / avg_cost × 100`
- 버블 크기: 포트폴리오 내 비중% = `quantity × current_price / Σ(전체 시가)`
- 4분면 구분선: X=0, Y=0 (Recharts `ReferenceLine`)
- 버블마다 ticker 라벨 (`CustomLabel`)
- 컨센서스 목표가(target_mean) 없는 종목 제외 → 하단 "제외: TICKER, ..." 표시

### 사이드바 / 라우터

- `/analytics` 라우트 추가
- 사이드바에 "분석" 메뉴 항목 추가 (기존 스타일 유지)

---

## Out of Scope (2단계)

- 상관관계 히트맵 — 주가 히스토리 60일치 시계열 수집 파이프라인 필요
- 알림 시스템, 배당 달력, 수익실현 계산

---

## Success Criteria

1. Analytics 페이지에서 `GET /api/dashboard` 단일 호출로 두 차트 모두 렌더링
2. 섹터 배분: 전체 보유종목 100% 표시 (기타 포함)
3. 버블 차트: 컨센서스 있는 종목만 표시, 없는 종목 목록 하단 표기
4. 기존 페이지(Portfolio, Reports 등) 동작 변화 없음

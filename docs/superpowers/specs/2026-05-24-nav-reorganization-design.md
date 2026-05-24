# Nav & Code Reorganization Design

**Date:** 2026-05-24  
**Status:** Approved

## Goal

현재 8개 상단 내비게이션 항목을 5개로 줄이고, 관련 기능을 허브 페이지로 통합한다.  
Market.jsx (715줄)를 섹션별 컴포넌트로 분리하여 파일 크기를 적정 수준으로 낮춘다.

---

## 1. Navigation Change

| Before (8) | After (5) |
|---|---|
| 종목관리 | 종목관리 (유지) |
| 리포트 | **리서치** (리포트 + 캘린더 + 다이제스트 탭) |
| 캘린더 | ↑ |
| 다이제스트 | ↑ |
| 시장지표 | **시장** (시장지표 + 분석 탭) |
| 분석 | ↑ |
| 구루 | 구루 (유지) |
| 설정 | 설정 (유지) |

---

## 2. Routing

```
/          → Portfolio
/research  → Research  (default tab: 리포트)
/market    → MarketHub (default tab: 시장지표)
/guru      → Guru
/settings  → Settings

삭제: /calendar, /digest, /analytics
```

---

## 3. New Files

### `frontend/src/pages/Research.jsx`
- 탭: 리포트 | 캘린더 | 다이제스트
- 탭 스타일: Settings 방식(밑줄)
- 기존 `Reports`, `Calendar`, `Digest` 컴포넌트를 그대로 렌더링
- 자체 로직 없음 (~40줄)

### `frontend/src/pages/MarketHub.jsx`
- 탭: 시장지표 | 분석
- 탭 스타일: Guru 방식(pill 버튼)
- 기존 `Market`, `Analytics` 컴포넌트를 그대로 렌더링
- 자체 로직 없음 (~40줄)

---

## 4. Market.jsx Refactor

현재 715줄짜리 파일을 섹션 컴포넌트로 분리.

**신규 디렉토리:** `frontend/src/components/market/`

| 파일 | 내용 | 예상 줄 수 |
|---|---|---|
| `FxSection.jsx` | FX 환율 차트 | ~63 |
| `VixSection.jsx` | VIX 지수 | ~59 |
| `CommoditiesSection.jsx` | 원자재 (금/WTI/구리) | ~74 |
| `EconIndicatorsSection.jsx` | 경제지표 (FRED) | ~62 |
| `TreasurySection.jsx` | 미국채 금리 | ~82 |
| `M7EarningsSection.jsx` | Magnificent 7 분기 순이익 | ~93 |
| `KrTop2Section.jsx` | KOSPI Top2 실적 | ~97 |
| `KrExportsSection.jsx` | 한국 수출 (반도체 vs 비반도체) | ~123 |
| `marketUtils.js` | `krFmt`, `isEstimated` 헬퍼 | ~20 |

**변경 후 `Market.jsx`:** fetch + 컴포넌트 조합만 담당 (~80줄)

**데이터 흐름:** Market.jsx가 `/api/market-indicators` fetch → 각 섹션에 props 전달 (섹션 자체 fetch 없음)

---

## 5. Unchanged

- `Reports.jsx`, `Calendar.jsx`, `Digest.jsx`, `Analytics.jsx` — 내용 변경 없음
- `Guru.jsx`, `Settings.jsx`, `ReportSchedule.jsx`, `GuruCrawlSettings.jsx` — 변경 없음
- 백엔드 코드 전체 — 변경 없음
- API 구조, 데이터 모델 — 변경 없음

---

## 6. App.jsx Changes

- import: `Research`, `MarketHub` 추가 / `Calendar`, `Digest`, `Analytics` 제거
- nav 배열: 5개 항목으로 교체
- Routes: `/research`, `/market` 추가 / `/calendar`, `/digest`, `/analytics` 제거

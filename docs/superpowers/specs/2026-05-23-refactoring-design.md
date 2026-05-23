# Refactoring Design — 2026-05-23

## Goals

코드 중복 제거, 버그 수정, 큰 파일 분리. 동작 변경 없음.

## Scope

### Backend

#### 1. `backend/services/cache.py` — TTL 패턴 통합

**문제:** `_list_cache`와 `_dashboard_cache`가 동일한 `{"data": None, "ts": 0.0}` 구조와 동일한 get/invalidate 로직을 반복.

**변경:**
- `TTLCache` 클래스 추가 (`__init__(ttl)`, `get(loader)`, `invalidate()`)
- `_list_cache = TTLCache(5.0)`, `_dashboard_cache = TTLCache(300.0)`
- 공개 API 유지: `get_list`, `invalidate_list`, `get_dashboard`, `invalidate_dashboard`

#### 2. `backend/routers/watchlist.py` — promote 버그 수정

**문제:** `promote_to_holdings`가 watchlist → holdings로 이동시키면서 `cache_svc.invalidate_dashboard()` 미호출. 대시보드가 캐시에서 새 종목을 못 보여주는 버그.

**변경:**
- `watchlist.py`에 `from services import cache as cache_svc` 추가
- `promote_to_holdings` 반환 직전에 `cache_svc.invalidate_dashboard()` 호출

#### 3. `backend/routers/stocks.py` — `_latest_snapshot` 모듈 레벨 이동

**문제:** `_latest_snapshot(ticker)` 함수가 `get_dashboard` 핸들러 내부 중첩 함수로 정의됨.

**변경:**
- `_latest_snapshot` 함수를 `REPORTS_DIR` 정의 바로 아래 모듈 레벨로 이동

### Frontend

#### 4. `Reports.jsx` 컴포넌트 분리

**문제:** 1981줄 단일 파일. 유지보수 어려움.

**변경:** `frontend/src/components/reports/` 디렉토리 생성 후 분리.

| 파일 | 내용 | 예상 줄 수 |
|------|------|-----------|
| `ConsensusChart.jsx` | ConsensusChart 컴포넌트 + TargetTooltip, GapCell 헬퍼 | ~370줄 |
| `FinancialsChart.jsx` | FinancialsChart 컴포넌트 | ~380줄 |
| `DetailTab.jsx` | DetailSummaryTab + PriceLevelChart + RsiTable + MetricCard | ~220줄 |
| `HistoryTab.jsx` | HistoryTab 컴포넌트 | ~165줄 |
| `Sections.jsx` | ReportSectionText, ReportSectionCompetitors, ReportSectionNews | ~80줄 |
| `Reports.jsx` (잔여) | 목록, 선택, 레이아웃, 탭 조합 | ~400줄 |

각 컴포넌트는 Reports.jsx에서 import. 공유 상수(TH, TD, fmtN 등)는 Reports.jsx에 남기거나 쓰는 컴포넌트로 이동.

## 범위 밖

- `market_indicators_service.py` 내부 캐시 — 패턴 달라서 통합 시 복잡도 증가
- 기타 정상 동작 중인 코드 변경 없음

## 검증 기준

- 백엔드: `pytest` 통과
- 프론트엔드: Reports 페이지 전체 탭 정상 동작, 대시보드 promote 후 캐시 무효화 확인
- 동작 변경 없음

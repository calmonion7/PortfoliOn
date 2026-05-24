# Stock Search Autocomplete Design

**Date:** 2026-05-23  
**Status:** Approved

## Problem

종목 추가 시 ticker와 name을 수동으로 입력해야 해서 불편하다. 티커 일부만 쳐도 종목 목록이 나와 선택하면 name + 현재가가 자동 입력되어야 한다.

## Approach

백엔드에 yfinance 기반 검색 엔드포인트를 추가하고, 프론트엔드 StockModal에 드롭다운 자동완성 UI를 붙인다.

## Backend

**새 엔드포인트:** `GET /api/stocks/search?q={query}`  
**파일:** `backend/routers/stocks.py`

- `yfinance.Search(query).quotes`로 종목 검색
- 결과에서 `symbol`, `shortname`/`longname`, `exchange` 추출
- 상위 5개 결과에 한해 `yf.Ticker(symbol).fast_info.last_price`로 현재가 조회
- 응답 스키마:
  ```json
  [
    { "ticker": "AAPL", "name": "Apple Inc.", "current_price": 189.5, "market": "US" }
  ]
  ```
- `market` 판별: exchange가 `KSE` 또는 `KOE`이면 `"KR"`, 아니면 `"US"`
- `q`가 비어있거나 2자 미만이면 빈 배열 반환

## Frontend

**수정 파일:** `frontend/src/components/StockModal.jsx`

- ticker 입력 필드에 300ms 디바운스 적용 후 `/api/stocks/search?q=` 호출
- 결과를 입력 필드 바로 아래 드롭다운 목록으로 표시 (ticker + name + 현재가)
- 항목 클릭 시:
  - `ticker` 필드 자동 입력
  - `name` 필드 자동 입력
  - 현재가는 단가(`avg_cost`) 입력란 옆에 참고 텍스트로 표시
- 드롭다운은 외부 클릭 시 닫힘
- 로딩 중: 입력 필드 옆 스피너
- 결과 없음: "검색 결과 없음" 텍스트
- 종목 선택 후에도 ticker를 수동으로 수정하면 드롭다운 재표시

## Out of Scope

- 검색 결과 캐싱
- KR 종목 전용 Naver 검색 연동
- 자동완성 결과의 페이지네이션

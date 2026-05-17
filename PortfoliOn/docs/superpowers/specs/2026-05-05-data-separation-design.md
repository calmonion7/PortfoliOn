# 종목 데이터 / 개인 데이터 분리 설계

**날짜:** 2026-05-05  
**상태:** 승인됨

## 배경

현재 `portfolio.json` 하나에 종목 리서치 데이터(name, competitors, moat, growth_plan)와 개인 보유 데이터(quantity, avg_cost)가 혼재되어 있다. 향후 로그인 및 다중 사용자 지원, DB 전환을 고려해 데이터 레이어를 분리한다.

## 목표

- 종목 데이터(공유)와 개인 데이터(사용자별)를 물리적으로 분리
- 각 파일이 미래 DB 테이블 하나에 1:1 대응되도록 설계
- 다중 사용자 지원 시 `user_id` 필드 추가만으로 확장 가능
- 기존 API 응답 형태 유지 (프론트엔드 변경 최소화)

## 데이터 파일 구조

### `backend/data/stocks.json` — 종목 리서치 데이터 (공유)

holdings + watchlist에 등록된 모든 종목의 리서치 노트.

```json
{
  "stocks": [
    {
      "ticker": "LLY",
      "name": "일라이 릴리",
      "competitors": ["NVO"],
      "moat": "",
      "growth_plan": ""
    }
  ]
}
```

미래 DB 테이블: `stocks(ticker PK, name, competitors, moat, growth_plan)`

### `backend/data/holdings.json` — 개인 보유 데이터

```json
{
  "holdings": [
    { "ticker": "LLY", "quantity": 3.0, "avg_cost": 886.6 }
  ]
}
```

미래 DB 테이블: `holdings(user_id, ticker FK, quantity, avg_cost)`

### `backend/data/watchlist.json` — 개인 관심종목

ticker 목록만 저장. 리서치 데이터는 stocks.json에서 조인.

```json
{
  "watchlist": ["AVAV", "FSLR", "RTX"]
}
```

미래 DB 테이블: `watchlist(user_id, ticker FK)`

## 백엔드 설계

### storage.py

기존 `get_portfolio()` / `save_portfolio()`를 제거하고 파일별 함수로 교체.

| 함수 | 역할 |
|---|---|
| `get_stocks()` / `save_stocks()` | stocks.json 읽기/쓰기 |
| `get_holdings()` / `save_holdings()` | holdings.json 읽기/쓰기 |
| `get_watchlist_tickers()` / `save_watchlist_tickers()` | watchlist.json 읽기/쓰기 |
| `get_full_portfolio()` | stocks + holdings + watchlist 조인, report_generator용 |

`get_full_portfolio()` 반환 형태 (기존 API와 동일):
```json
{
  "stocks": [{ "ticker": "LLY", "name": "...", "quantity": 3.0, "avg_cost": 886.6, "competitors": [], "moat": "", "growth_plan": "" }],
  "watchlist": [{ "ticker": "AVAV", "name": "...", "competitors": [], "moat": "", "growth_plan": "" }]
}
```

### routers/portfolio.py

- `get_portfolio()` → `get_holdings()` + `get_stocks()` 조인하여 응답
- `add_stock()` → stocks.json에 추가 (없으면), holdings.json에 추가
- `update_stock()` → stocks.json + holdings.json 각각 업데이트
- `delete_stock()` → holdings.json에서 제거, watchlist에도 없으면 stocks.json에서도 제거

### routers/watchlist.py

- `get_watchlist()` → watchlist.json tickers + stocks.json 조인하여 응답
- `add_watchlist_stock()` → stocks.json에 추가 (없으면), watchlist.json에 ticker 추가
- `update_watchlist_stock()` → stocks.json 업데이트
- `delete_watchlist_stock()` → watchlist.json에서 제거, holdings에도 없으면 stocks.json에서도 제거
- `promote_to_holdings()` → watchlist.json에서 ticker 제거, holdings.json에 추가, stocks.json 유지

### report_generator.py

`get_full_portfolio()` 사용. 변경 없음.

## 테스트 업데이트

`test_storage.py`, `test_portfolio_router.py`, `test_watchlist_router.py`의 fixture와 mock을 새 storage 함수에 맞게 수정한다. `get_portfolio` / `save_portfolio` mock을 `get_stocks`, `get_holdings`, `get_watchlist_tickers` mock으로 교체.

## 마이그레이션

`backend/migrate_portfolio.py` — 일회성 스크립트.

1. `portfolio.json` 읽기
2. stocks.json: holdings + watchlist 전체 종목의 리서치 데이터 추출
3. holdings.json: stocks 배열에서 ticker, quantity, avg_cost만 추출
4. watchlist.json: watchlist 배열에서 ticker만 추출
5. 3개 파일 저장
6. `portfolio.json` → `portfolio.json.bak` 백업

## 확장 경로

로그인 추가 시:
- `holdings.json` 항목에 `user_id` 추가 → `holdings` 테이블로 직접 import
- `watchlist.json` 항목에 `user_id` 추가 → `watchlist` 테이블로 직접 import
- `stocks.json` → `stocks` 공유 테이블로 import (변경 없음)

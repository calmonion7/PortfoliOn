# Portfolio 보유종목/관심종목 탭 분리 — Design Spec

**Date:** 2026-05-04

## Context

현재 Portfolio 화면은 보유종목 단일 목록만 관리한다. 매수 전 관심 있는 종목을 별도로 추적하고, 매수 결정 시 보유종목으로 전환하는 워크플로우가 필요하다.

---

## Data Model

`portfolio.json`에 `watchlist` 키 추가. `stocks` 와 동일 파일에 저장.

```json
{
  "stocks": [
    {
      "ticker": "NFLX",
      "name": "Netflix",
      "quantity": 10.0,
      "avg_cost": 85.59,
      "competitors": ["DIS", "WBD"],
      "moat": "...",
      "growth_plan": "..."
    }
  ],
  "watchlist": [
    {
      "ticker": "NVDA",
      "name": "Nvidia",
      "competitors": ["AMD", "INTC"],
      "moat": "...",
      "growth_plan": "..."
    }
  ]
}
```

**중복 방지:** `stocks` + `watchlist` 전체에서 동일 티커 존재 시 추가/전환 불가(400).

`storage.get_portfolio()` — `watchlist` 키 없을 경우 `[]` 기본값 반환.

---

## Backend

### Pydantic Models

```python
class WatchlistStock(BaseModel):
    ticker: str
    name: str
    competitors: List[str] = []
    moat: str = ""
    growth_plan: str = ""

class PromotePayload(BaseModel):
    quantity: float
    avg_cost: float
```

### 신규 엔드포인트 (`routers/watchlist.py`, prefix `/api/watchlist`)

| Method | Path | 동작 |
|---|---|---|
| GET | `/api/watchlist` | watchlist 반환 |
| POST | `/api/watchlist` | 추가 (전체 중복 체크) |
| PUT | `/api/watchlist/{ticker}` | 수정 |
| DELETE | `/api/watchlist/{ticker}` | 삭제 |
| POST | `/api/watchlist/{ticker}/promote` | 보유종목으로 전환 |

**promote 로직:**
1. watchlist에서 ticker 조회 (없으면 404)
2. stocks에 동일 ticker 없는지 확인 (있으면 400)
3. watchlist에서 제거, stocks에 `{ ...watchlist_stock, quantity, avg_cost }` 추가
4. `save_portfolio()` 호출
5. 추가된 stock 반환

### 기존 변경

`routers/report.py` — `generate_one` 엔드포인트: `portfolio.stocks` 에 없으면 `portfolio.watchlist` 도 조회하여 관심종목 리포트도 생성 가능하게 수정.

### 테스트 (`tests/test_watchlist_router.py`)

- GET watchlist
- POST 추가 성공
- POST 중복 티커 (stocks에 있는 것) → 400
- PUT 수정
- DELETE 삭제
- POST promote 성공 → watchlist 제거, stocks 추가 확인
- POST promote 이미 stocks에 있는 경우 → 400

---

## Frontend

### Portfolio.jsx 변경

상단에 탭 UI 추가:

```
[ 보유종목 ]  [ 관심종목 ]
```

`activeTab` state (`'holdings' | 'watchlist'`)로 표시 목록 분기.

### 보유종목 탭 (기존 유지)

| 티커 | 회사명 | 수량 | 평단가 | 경쟁사 | 관리 |
|---|---|---|---|---|---|
| | | | | | [수정] [삭제] |

### 관심종목 탭

| 티커 | 회사명 | 경쟁사 | 관리 |
|---|---|---|---|
| | | | [수정] [보유로 전환] [삭제] |

### StockModal 분기

`mode` prop 추가: `'holding'` | `'watchlist'`

- `holding`: 기존 필드 전체 (티커, 회사명, 수량, 평단가, 경쟁사, 해자, 성장계획)
- `watchlist`: 수량/평단가 제외 (티커, 회사명, 경쟁사, 해자, 성장계획)

### PromoteModal (신규)

"보유로 전환" 클릭 시 팝업. 수량/평단가만 입력.

```
보유로 전환: NVDA
─────────────────
수량: [     ]
평균 매입가 ($): [     ]
[확인]  [취소]
```

- 확인 → `POST /api/watchlist/{ticker}/promote` 호출
- 성공 → 모달 닫기, 탭을 '보유종목'으로 전환, 목록 새로고침

---

## Files Changed

| 파일 | 변경 유형 |
|---|---|
| `backend/routers/watchlist.py` | 신규 |
| `backend/tests/test_watchlist_router.py` | 신규 |
| `backend/main.py` | watchlist router 마운트 추가 |
| `backend/services/storage.py` | `get_portfolio()` watchlist 기본값 추가 |
| `backend/routers/report.py` | generate_one watchlist 조회 추가 |
| `frontend/src/pages/Portfolio.jsx` | 탭 UI + watchlist 로직 |
| `frontend/src/components/StockModal.jsx` | `mode` prop 분기 |
| `frontend/src/components/PromoteModal.jsx` | 신규 |

---

## Verification

1. `python -m pytest tests/ -v` — 전체 통과
2. 관심종목에 NVDA 추가 → 보유종목에도 NVDA 추가 시도 → 400 에러 확인
3. "보유로 전환" → 수량/평단가 입력 → 관심종목 탭에서 사라지고 보유종목 탭에 나타나는지 확인
4. 관심종목에서 리포트 생성 가능한지 확인

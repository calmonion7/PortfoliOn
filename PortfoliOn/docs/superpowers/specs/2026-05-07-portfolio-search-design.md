# 종목 관리 화면 검색 기능

**날짜:** 2026-05-07  
**범위:** `frontend/src/pages/Portfolio.jsx` 단독 수정

---

## 목표

보유종목/관심종목 두 탭을 아우르는 통합 검색창을 추가해 티커 또는 회사명으로 빠르게 종목을 찾을 수 있게 한다.

---

## 동작 방식

- 탭 바 아래, 테이블 위에 검색 입력창 표시
- 입력 즉시 실시간 필터링 — API 호출 없이 프론트 상태만 변경
- **티커 + 회사명** 대소문자 구분 없이 검색
- 탭 전환 시에도 검색어 유지 (두 탭 동시 필터링)
- 검색어 없으면 전체 목록 표시

---

## UI 레이아웃

탭 바와 테이블 사이:

```
[보유종목] [관심종목]                    [＋ 종목 추가]
────────────────────────────────────────────────────
🔍  티커 또는 회사명 검색...
────────────────────────────────────────────────────
| 티커 | 회사명 | 수량 | 평단가 | 경쟁사 | 관리 |
```

- 검색창 스타일: 기존 다크 테마, `background: #0d1117`, `border: 1px solid #2a3a4a`, `color: #ccc`
- placeholder: `"🔍 티커 또는 회사명 검색..."`
- 너비: 전체 폭 (`width: 100%`)

---

## 상태 변경

```js
const [searchQuery, setSearchQuery] = useState('')
```

필터링 로직:

```js
const q = searchQuery.trim().toLowerCase()
const filteredStocks = stocks.filter(s =>
  !q ||
  s.ticker.toLowerCase().includes(q) ||
  (s.name || '').toLowerCase().includes(q)
)
const filteredWatchlist = watchlist.filter(s =>
  !q ||
  s.ticker.toLowerCase().includes(q) ||
  (s.name || '').toLowerCase().includes(q)
)
```

---

## 변경 파일

| 파일 | 변경 |
|---|---|
| `frontend/src/pages/Portfolio.jsx` | `searchQuery` state 추가, 필터링 로직, 검색 입력 UI |

---

## 범위 외

- 백엔드 변경 없음
- 자동완성, 하이라이팅 없음
- 검색 결과 없을 때 빈 테이블 표시 (별도 "결과 없음" 메시지 없음)

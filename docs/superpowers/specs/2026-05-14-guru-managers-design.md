# 구루 매니저 기능 설계

## 개요

dataroma.com에서 포트폴리오 매니저 데이터를 크롤링하여 저장하고, 설정 페이지 내에서 매니저 목록과 추천 통계를 제공하는 기능.

---

## 데이터 구조

### `backend/data/guru_managers.json`

```json
{
  "last_updated": "2026-05-14T10:00:00",
  "managers": [
    {
      "id": "brk",
      "name": "Warren Buffett",
      "firm": "Berkshire Hathaway Inc",
      "portfolio_value": 350000000000,
      "num_stocks": 45,
      "top10": [
        { "rank": 1, "ticker": "AAPL", "name": "Apple Inc.", "name_kr": "애플", "weight_pct": 42.1 },
        { "rank": 2, "ticker": "BAC", "name": "Bank of America Corp", "name_kr": "뱅크오브아메리카", "weight_pct": 10.3 }
      ]
    }
  ]
}
```

- `name_kr`: Naver Finance API 조회 성공 시 채움, 실패 시 `""` (빈 문자열)
- `weight_pct`: 포트폴리오 내 비중(%)
- 가중치 통계(`1/rank`)는 저장하지 않고 API 응답 시 실시간 계산

### `backend/data/guru_schedule.json`

```json
{
  "enabled": false,
  "day": "sun",
  "time": "03:00"
}
```

---

## 백엔드

### 새 파일

- `backend/services/guru_scraper.py` — dataroma 크롤링 + Naver 한글명 조회
- `backend/routers/guru.py` — API 엔드포인트
- `backend/services/storage.py` — guru 관련 함수 추가

### API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| `GET` | `/api/guru/managers` | 전체 매니저 목록 + top10 |
| `GET` | `/api/guru/stats/popularity` | 전체 종목 인기순 (카운트) |
| `GET` | `/api/guru/stats/manager-top3` | 매니저별 탑3 + 카운트 |
| `GET` | `/api/guru/stats/weighted` | 역수 가중치 합산 통계 |
| `POST` | `/api/guru/crawl` | 크롤링 시작 (비동기) |
| `GET` | `/api/guru/crawl/progress` | `{ running, done, total, current }` |
| `GET` | `/api/guru/schedule` | 구루 스케줄 조회 |
| `PUT` | `/api/guru/schedule` | 구루 스케줄 업데이트 |

### 크롤링 흐름

```
1. dataroma /m/managers.php → 전체 매니저 ID + 기본 정보 수집
2. 매니저별 /m/holdings.php?m={id} → firm, portfolio_value, num_stocks, top10 수집
3. top10 각 ticker → Naver Finance API로 name_kr 조회 (실패 시 빈 문자열)
4. guru_managers.json 저장
```

진행률은 기존 report의 progress 패턴과 동일: `{ running, done, total, current }`

### 가중치 계산 기준

역수 방식: `score = 1 / rank`

| 순위 | 점수 |
|------|------|
| 1위 | 1.000 |
| 2위 | 0.500 |
| 3위 | 0.333 |
| 4위 | 0.250 |
| 5위 | 0.200 |
| 6위 | 0.167 |
| 7위 | 0.143 |
| 8위 | 0.125 |
| 9위 | 0.111 |
| 10위 | 0.100 |

종목별 가중치 합계 = 해당 종목을 보유한 모든 매니저의 `1/rank` 합산

---

## 프론트엔드

### 네비게이션 구조

Settings 페이지 내부를 탭으로 분리:

```
설정
├── 리포트 스케줄   (기존 내용 이동)
└── 구루 매니저    (신규)
    ├── 매니저 목록
    ├── 추천 통계
    └── 크롤링 설정
```

### 구루 매니저 > 매니저 목록

dataroma 스타일 테이블:

| # | Manager | Firm | Portfolio Value | Stocks | Top 10 |
|---|---------|------|-----------------|--------|--------|
| 1 | Warren Buffett | Berkshire Hathaway Inc | $350.0B | 45 | AAPL BAC KO AXP CVX ... |
| 2 | Bill Ackman | Pershing Square Capital | $12.3B | 7 | HLT CMG QSR ... |

- Top 10은 티커 배지로 표시, 순번 순서(rank) 유지
- Portfolio Value: B(억), M(백만) 단위 약식 표기

### 구루 매니저 > 추천 통계

**① 전체 인기순 (카운트)**

| 종목 | 영문명 | 한글명 | 매니저 수 |
|------|--------|--------|----------|
| AAPL | Apple Inc. | 애플 | 47 |
| MSFT | Microsoft Corp | 마이크로소프트 | 38 |

**② 매니저별 탑3**

각 매니저의 1~3위 종목과 함께, 해당 종목을 top10에 보유한 전체 매니저 수(카운트)를 표시.

| Manager | 1위 | 카운트 | 2위 | 카운트 | 3위 | 카운트 |
|---------|-----|--------|-----|--------|-----|--------|
| Warren Buffett | AAPL | 47명 | BAC | 23명 | KO | 31명 |
| Bill Ackman | HLT | 12명 | CMG | 8명 | QSR | 6명 |

**③ 가중치 통계 (역수 합산)**

기준 설명 표시: `1위=1.000, 2위=0.500, 3위=0.333, ..., 10위=0.100`

| 종목 | 한글명 | 가중치 합계 |
|------|--------|------------|
| AAPL | 애플 | 23.45 |
| MSFT | 마이크로소프트 | 18.92 |

### 구루 매니저 > 크롤링 설정

- "지금 갱신" 버튼 + 진행률 바 (`████████░░ 80% (80/100) 현재: Bill Ackman`)
- 자동 갱신: 요일 단일 선택 + 시간 입력 + 저장 버튼
- 마지막 갱신 시각 표시

### 새 파일

- `frontend/src/pages/Settings.jsx` — 탭 분리 수정 (기존 파일)
- `frontend/src/pages/GuruManagers.jsx` — 매니저 목록
- `frontend/src/pages/GuruStats.jsx` — 통계 3종
- `frontend/src/pages/GuruCrawlSettings.jsx` — 크롤링/스케줄 설정

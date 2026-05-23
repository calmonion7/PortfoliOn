# 시장지표 페이지 설계 (Market Indicators)

**날짜:** 2026-05-23  
**범위:** 신규 `/market` 페이지 — 국내/미국 거시 시장지표 4개 섹션

---

## 1. 페이지 구성

URL: `/market`, 내비게이션 링크: "시장지표"

섹션 순서 (상단→하단):

1. **미국 국채금리** — 금리 카드 + 히스토리 차트
2. **M7 vs 나머지 순이익** — 분기별 BarChart
3. **삼성+하이닉스 vs 나머지 KOSPI 순이익** — 분기별 BarChart
4. **한국 수출: 반도체 vs 비반도체** — 월별 BarChart

---

## 2. 데이터 소스

| 섹션 | 소스 | 캐시 TTL |
|---|---|---|
| 국채금리 | yfinance (^IRX, ^FVX, ^TNX, ^TYX) | 1시간 |
| M7 순이익 | yfinance `.quarterly_financials["Net Income"]` | 24시간 |
| 한국 Top2+나머지 | Naver API `finance/quarter` (기존 `_naver_get` 패턴) | 24시간 |
| 수출 통계 | KITA stat 스크래핑 + 파일 캐시 (`data/kr_exports.json`) | 30일 |

### 티커/종목 정의

**M7:** AAPL · MSFT · GOOGL · AMZN · NVDA · META · TSLA

**S&P 나머지: S&P 500 ex-M7 (~493종)**  
Wikipedia `List_of_S%26P_500_companies` 에서 구성종목 스크래핑 → M7 제외 → yfinance 병렬 조회 (ThreadPoolExecutor, max 20)  
캐시 없을 때 첫 호출은 수분 소요, 이후 24시간 캐시.

**KOSPI Top2:** 005930 (삼성전자) · 000660 (SK하이닉스)

**KOSPI 나머지: KOSPI 200 ex-Top2 (~198종)**  
KRX 데이터포털 (`data.krx.co.kr`) 에서 KOSPI 200 구성종목 조회 → Top2 제외 → Naver API 병렬 조회 (ThreadPoolExecutor, max 20)  
캐시 없을 때 첫 호출은 수분 소요, 이후 24시간 캐시.

---

## 3. 백엔드

### 신규 파일

**`backend/services/market_indicators_service.py`**  
데이터 페칭 로직 4개 함수:

- `get_treasury()` → yfinance로 ^IRX/^FVX/^TNX/^TYX 현재값 + 1년 일별 히스토리
- `get_m7_earnings()` → M7 7종 + S&P 500 ex-M7 전체 분기별 Net Income 합산, 최근 8분기. 구성종목은 Wikipedia 스크래핑 후 캐시, yfinance ThreadPoolExecutor(max 20) 병렬 조회.
- `get_kr_top2_earnings()` → 삼성+하이닉스 2종 + KOSPI 200 ex-Top2 전체 분기별 순이익, Naver API ThreadPoolExecutor(max 20) 병렬 조회, 최근 8분기. 구성종목은 KRX 데이터포털에서 조회 후 캐시.
- `get_kr_exports()` → KITA stat 스크래핑, 월별 반도체/비반도체 수출액, 최근 12개월. 결과를 `data/kr_exports.json`에 캐시 (30일).

캐싱은 기존 `services/cache.py`의 `get_cached` / `set_cache` 패턴 사용.

**`backend/routers/market_indicators.py`**  
```
GET /api/market/treasury
GET /api/market/m7-earnings
GET /api/market/kr-top2-earnings
GET /api/market/kr-exports
```
각 엔드포인트는 서비스 함수 1:1 호출, 에러 시 500 반환.

### 수정 파일

**`backend/main.py`** — `market_indicators` 라우터 마운트 추가

---

## 4. 프론트엔드

### 신규 파일

**`frontend/src/pages/Market.jsx`**

- 4개 섹션 각각 독립된 `useEffect`로 개별 API 호출 (섹션별 로딩 상태)
- recharts 사용: `LineChart` (국채금리 히스토리), `BarChart` (나머지 3개)
- 기존 CSS 변수 (`--bg-card`, `--text`, `--accent`, `--border`) 준수
- 각 섹션 구조: 섹션 헤더 → 수치 카드(있는 경우) → 차트

**국채금리 섹션 상세:**
- 수치 카드 4개: 3M(^IRX) / 5Y(^FVX) / 10Y(^TNX) / 30Y(^TYX) — 현재값(%) + 전일대비(±bp)
- LineChart: 3M과 10Y 1년 일별 히스토리, 스프레드(10Y-3M) 보조선 (yfinance에 2Y 직접 심볼 없음)

**순이익 차트 상세:**
- BarChart, X축: 분기 라벨 (e.g. "24Q3"), Y축: 억달러 or 조원
- 두 계열 나란히: "M7" (파란계열) vs "나머지" (회색계열)

**수출 차트 상세:**
- BarChart, X축: 월 (e.g. "2025-04"), Y축: 억달러
- 두 계열: "반도체" vs "비반도체"

### 수정 파일

**`frontend/src/App.jsx`**
- nav 링크 배열에 `['/market', '시장지표']` 추가
- `import Market` 및 `<Route path="/market" element={<Market />} />` 추가

---

## 5. 에러/엣지 케이스

- yfinance 조회 실패: 해당 섹션 `null` 반환, 프론트에서 "데이터를 불러오지 못했습니다" 표시
- KITA 스크래핑 실패: 캐시 파일 존재 시 캐시 반환, 없으면 빈 배열 반환 + 에러 메시지
- Naver API / yfinance 종목 일부 실패: 실패 종목 제외하고 나머지로 합산 (부분 데이터 허용)
- 첫 로드 지연 안내: 캐시 없을 때 프론트에서 "데이터 수집 중입니다. 수분 소요될 수 있습니다." 표시

---

## 6. 범위 외

- 실시간 자동 갱신 (웹소켓/polling) — 없음, 수동 새로고침 버튼으로 충분
- 수출 데이터 자동 월별 스케줄 갱신 — 없음 (캐시 만료 시 다음 조회 시 자동 갱신)
- 개별 종목 클릭 드릴다운 — 없음

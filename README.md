# PortfoliOn

주식 포트폴리오 관리 & 리포트 생성 앱

## 빠른 시작

### Windows

```bat
start.bat
```

### macOS / Linux

```bash
./start.sh
```

백엔드(8000)와 프론트엔드(5173) 서버를 백그라운드로 실행합니다.

## 서버 종료

### Windows

```bat
stop.bat
```

### macOS / Linux

```bash
./stop.sh
```

## 수동 실행

### Windows

```bat
cd backend
venv\Scripts\python -m uvicorn main:app --reload --port 8000
```

```bat
cd frontend
npm run dev
```

### macOS / Linux

```bash
cd backend
.venv/bin/python -m uvicorn main:app --reload --port 8000
```

```bash
cd frontend
npm run dev
```

## 로그

**Windows**: `%TEMP%\portfolion-backend.log`, `%TEMP%\portfolion-frontend.log`

**macOS / Linux**: `/tmp/portfolion-backend.log`, `/tmp/portfolion-frontend.log`

## 화면 구성

### 포트폴리오
보유종목과 관심종목을 탭으로 구분해서 관리합니다.

| 기능 | 설명 |
|------|------|
| 보유종목 추가/수정/삭제 | 티커, 종목명, 매수가, 수량, 시장(KR/US) 입력 |
| 관심종목 추가/수정/삭제 | 티커, 종목명 등록 |
| 관심종목 → 보유종목 승격 | 관심종목에서 매수가/수량 입력 후 보유종목으로 이동 |
| 검색 · 시장 필터 | 종목명/티커 검색, KR/US 필터 |

### 리포트
보유·관심종목에 대한 AI 분석 리포트를 확인합니다.

| 기능 | 설명 |
|------|------|
| 리포트 열람 | 종목별 Markdown 리포트 (Claude AI 생성) |
| 주가 · RSI 차트 | 최근 주가 추이 및 RSI 지표 시각화 |
| 목표주가 분석 | 증권사 컨센서스 목표가 및 괴리율 표시 |
| 즉시 생성 | 전체 종목 리포트 즉시 생성, 진행률 표시 |

### 이벤트 캘린더
보유·관심종목의 실적 발표일과 배당락일을 월간 달력으로 확인합니다.

| 기능 | 설명 |
|------|------|
| 월간 그리드 | 날짜 셀에 이벤트 뱃지 표시 (실적=파란색, 배당락=초록색) |
| 보유/관심 전환 | 탭으로 보유종목 ↔ 관심종목 이벤트 전환 |
| 월 이동 | ‹ › 버튼으로 이전·다음 달 탐색 |
| 종목명 툴팁 | 뱃지에 마우스 오버 시 한글 종목명 표시 |

### 시장 지표

FX, VIX, 원자재, 경제지표를 한 화면에서 확인합니다.

| 기능 | 설명 |
|------|------|
| FX | USD/KRW, USD/JPY, EUR/USD 실시간 환율 (yfinance) |
| VIX | 공포지수, 공포/탐욕 색상 코딩 |
| 원자재 | 금, WTI 원유, 구리 가격 |
| 경제지표 | CPI, 실업률 (FRED API, `FRED_API_KEY` 필요) |
| M7 실적 | AAPL·MSFT·GOOGL·AMZN·NVDA·META·TSLA 분기 순이익 vs 나머지 S&P 500, 비중(%) 꺾은선 |
| 한국 KOSPI Top2 실적 | 삼성전자+SK하이닉스 분기 순이익 vs KOSPI 나머지 전체, 비중(%) 꺾은선 |
| 한국 수출 | 반도체(HS 8542) vs 비반도체 월별 수출액, 반도체 비중(%) 꺾은선 (관세청 API, `KITA_API_KEY` 미설정 시 UN Comtrade 폴백) |

### 일일 다이제스트

보유·관심종목 요약을 매일 자동 생성합니다.

| 기능 | 설명 |
|------|------|
| 자동 생성 | 매일 08:00 KST 스케줄 |
| 즉시 생성 | `POST /api/digest/generate` |
| 최신 조회 | `GET /api/digest/latest` |

### 구루 매니저
[dataroma](https://www.dataroma.com) 기반으로 유명 가치투자자(구루)들의 포트폴리오를 분석합니다.

**매니저 목록 탭**

| 기능 | 설명 |
|------|------|
| 구루 목록 조회 | 매니저명, 소속 펌, 포트폴리오 가치, 보유 종목 수, Top 10 종목 |
| 정렬 | 종목 수 / 포트폴리오 가치 / 매니저명 기준 정렬 |
| 검색 | 매니저명 · 펌명 검색 |
| 관심종목 추가/삭제 | Top 10 종목 배지 클릭으로 관심종목 등록·해제 |

**추천 통계 탭**

| 기능 | 설명 |
|------|------|
| 인기순 | 여러 구루가 보유한 종목을 보유자 수 기준으로 랭킹 |
| 매니저별 탑3 | 각 구루의 포트폴리오 상위 3개 종목 |
| 가중치 통계 | 포트폴리오 내 순위 기반 가중치(1/rank)를 합산한 추천 점수 |
| 관심종목 추가/삭제 | 통계 목록에서 바로 관심종목 등록·해제 |

### 애널리틱스

보유 종목 간 상관관계를 히트맵으로 시각화합니다.

| 기능 | 설명 |
|------|------|
| 상관관계 히트맵 | 보유 종목 90일 수익률 기반 상관계수 SVG 히트맵 |
| 자동 캐시 | TTL 300s 캐시, 종목 변경 시 자동 무효화 |

### 분석 허브 (AnalysisHub)

섹터 모멘텀과 매크로 상관관계를 분석합니다.

| 기능 | 설명 |
|------|------|
| 섹터 모멘텀 | 11개 섹터 ETF(XLK 등) 기준 최근 1개월 수익률 비교 |
| 매크로 상관관계 | 보유 종목 vs TLT/UUP/USO/VIX 90일 상관관계 히트맵 |

### 설정

**리포트 설정**

| 기능 | 설명 |
|------|------|
| 자동 스케줄 | 요일·시간 지정으로 리포트 자동 생성 활성화 |
| 즉시 생성 | 전체 종목 리포트 지금 생성, 진행률 표시 |

**구루 설정**

| 기능 | 설명 |
|------|------|
| 자동 크롤링 스케줄 | 요일·시간 지정으로 dataroma 데이터 자동 수집 |
| 즉시 크롤링 | 지금 바로 전체 매니저 데이터 수집, 진행률 표시 |

---

## 접속 주소

### 로컬

| 서비스 | 주소 |
|--------|------|
| 프론트엔드 | http://localhost:5173 |
| 백엔드 API | http://localhost:8000 |
| API 문서 | http://localhost:8000/docs |

### 배포

| 서비스 | 주소 |
|--------|------|
| 프론트엔드 | https://portfoli-on.vercel.app |
| 백엔드 API | https://portfolion-1.onrender.com |

## 개발 스펙

### 개발 환경 요구사항

| 항목 | 최소 버전 |
|------|-----------|
| Python | 3.9+ |
| Node.js | 18+ |
| npm | 9+ |

### 기술 스택

**백엔드**

| 라이브러리 | 버전 | 용도 |
|-----------|------|------|
| Python | 3.9+ | 런타임 |
| FastAPI | 0.104+ | REST API 프레임워크 |
| uvicorn | 0.24+ | ASGI 서버 |
| APScheduler | 3.10+ | 리포트/크롤링 자동 스케줄 |
| yfinance | 0.2.40+ | 주가 데이터 (미국 주식) |
| pandas | 2.1+ | 데이터 처리 |
| numpy | 1.26+ | 수치 연산 |
| matplotlib | 3.8+ | 차트 이미지 생성 |
| requests / httpx | 2.31+ / 0.25+ | HTTP 클라이언트 |
| beautifulsoup4 | 4.12+ | HTML 파싱 (Naver, dataroma) |
| pytest | 7.4+ | 테스트 |

**프론트엔드**

| 라이브러리 | 버전 | 용도 |
|-----------|------|------|
| React | 19 | UI 프레임워크 |
| Vite | 8 | 빌드 도구 |
| react-router-dom | 7 | 클라이언트 라우팅 |
| axios | 1.16+ | HTTP 클라이언트 |
| recharts | 3.8+ | 주가·RSI 차트 |
| react-markdown + remark-gfm | 10 / 4 | Markdown 리포트 렌더링 |

### 아키텍처 개요

```
Browser (React/Vite :5173 / Vercel)
        │  REST API
        ▼
FastAPI (:8000 / Render)
 ├─ routers/        # portfolio, watchlist, stocks, report, guru,
 │                  # calendar, digest, market_indicators, analytics, analysis
 ├─ services/       # market(yfinance+Naver), charts, indicators,
 │                  # report_generator(Claude AI), scraper, consensus,
 │                  # digest_service, market_indicators_service, cache, utils
 │
 ├─ Supabase PostgreSQL  ← 종목/스냅샷/스케줄/캘린더/시장지표 캐시
 └─ data/           # 정적 참조 데이터 (sp500_tickers.json, kospi_tickers.json)
```

**데이터 흐름**

- 주가 데이터: yfinance(미국) / Naver Finance API(한국) → Supabase snapshots
- 리포트 생성: Claude AI API(`ANTHROPIC_API_KEY` 필요) → Supabase snapshots 테이블
- 시장 지표: yfinance incremental fetch → Supabase market_cache 영구 저장
- 구루 데이터: dataroma 크롤링 → Supabase guru_managers 테이블

**API 설계 원칙**

- RESTful JSON API, 전체 스펙은 `API_SPEC.md` 참조
- Claude AI 연동용 외부 API는 `CLAUDE_COWORK_API.md` 참조
- CORS 허용 출처: `localhost:3000`, `localhost:5173`, `portfoli-on.vercel.app`

---

## 프로젝트 구조

```
PortfoliOn/
├── start.bat / start.sh   # 로컬 서버 실행
├── stop.bat  / stop.sh    # 로컬 서버 종료
├── docs/                  # ARCHITECTURE, CONFIGURATION, DEVELOPMENT,
│                          # GETTING-STARTED, TESTING, API.md
├── backend/
│   ├── main.py
│   ├── scheduler.py       # APScheduler 설정
│   ├── auth.py            # Supabase JWT 검증 (ES256/JWKS)
│   ├── supabase_schema.sql # Supabase 테이블 DDL
│   ├── routers/           # portfolio, watchlist, stocks, report, guru,
│   │                      # calendar, digest, market_indicators, analytics, analysis
│   ├── services/          # storage(Supabase), market, charts, indicators,
│   │                      # report_generator, scraper, consensus, guru_scraper,
│   │                      # digest_service, market_indicators_service, cache, utils, db
│   └── data/              # sp500_tickers.json, kospi_tickers.json (정적 참조)
└── frontend/
    └── src/
        ├── pages/         # Portfolio, Research(허브), MarketHub(허브), AnalysisHub(허브),
        │                  # Guru, Settings, Digest, Market, Analytics, Calendar
        ├── components/    # StockModal, PromoteModal, reports/, market/
        ├── supabase.js    # Supabase 클라이언트 + 로그인
        └── utils.js       # 공통 유틸리티 (TAB_STYLE, fmtPrice)
```

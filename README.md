# PortfoliOn

주식 포트폴리오 관리 & AI 리포트 생성 앱

## 인프라

Mac 로컬 Docker 4-컨테이너 구성. Cloudflare Tunnel로 외부 접근 가능.

| 컨테이너 | 역할 |
|---------|------|
| nginx | HTTP(:80) 서빙, /api/* → backend:8000 프록시 |
| backend | FastAPI(:8000) |
| postgres | PostgreSQL 16, pgdata 볼륨 |
| cloudflared | Cloudflare Tunnel (portfolion.taebro.com → localhost:80) |

## 빠른 시작

```bash
docker compose up -d
```

### 로컬 개발 (Docker 없이)

```bash
# 백엔드
cd backend && .venv/bin/python -m uvicorn main:app --reload --port 8000

# 프론트엔드
cd frontend && npm run dev
```

## 접속 주소

| 서비스 | 주소 |
|--------|------|
| 프론트엔드 (로컬) | http://localhost:5173 |
| 백엔드 API (로컬) | http://localhost:8000 |
| API 문서 | http://localhost:8000/docs |
| 외부 접근 | https://portfolion.taebro.com |

## 환경변수

`backend/.env.docker` 파일에 설정:

```
POSTGRES_PASSWORD=...
JWT_SECRET=...
SESSION_SECRET=...
ANTHROPIC_API_KEY=...
FRED_API_KEY=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

루트 `.env` 파일에 `POSTGRES_PASSWORD` 추가 (docker-compose 보간용).

## 초기 DB 설정

PostgreSQL 스키마를 순서대로 실행:

```bash
# 1. 인증 스키마 (users, refresh_tokens)
docker exec -i portfolion-postgres psql -U postgres -d portfolion < backend/auth_schema.sql

# 2. 앱 스키마 (tickers, user_stocks, snapshots, ...)
docker exec -i portfolion-postgres psql -U postgres -d portfolion < backend/app_schema.sql
```

Admin 계정 설정:

```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```

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
| 즉시 생성 | 전체 종목 리포트 즉시 생성, 진행률 표시 (admin only) |

### 이벤트 캘린더

보유·관심종목의 실적 발표일과 배당락일을 월간 달력으로 확인합니다.

| 기능 | 설명 |
|------|------|
| 월간 그리드 | 날짜 셀에 이벤트 뱃지 표시 (실적=파란색, 배당락=초록색) |
| 보유/관심 전환 | 탭으로 보유종목 ↔ 관심종목 이벤트 전환 |
| 월 이동 | ‹ › 버튼으로 이전·다음 달 탐색 |

### 시장 지표

FX, VIX, 원자재, 경제지표를 한 화면에서 확인합니다.

| 기능 | 설명 |
|------|------|
| FX | USD/KRW, USD/JPY, EUR/USD 환율 (전일 대비 등락 표시) |
| VIX | 공포지수, 공포/탐욕 색상 코딩 |
| 원자재 | 금, WTI 원유, 구리 가격 |
| 경제지표 | CPI, 실업률 (FRED API) |
| M7 실적 | AAPL·MSFT·GOOGL·AMZN·NVDA·META·TSLA 분기 순이익 vs 나머지 S&P 500 |
| 한국 KOSPI Top2 실적 | 삼성전자+SK하이닉스 vs KOSPI 나머지 |
| 한국 수출 | 반도체 vs 비반도체 월별 수출액 (관세청 API, 미설정 시 UN Comtrade 폴백) |

### 일일 다이제스트

보유·관심종목 요약을 매일 08:00 KST 자동 생성합니다.

### 구루 매니저

[dataroma](https://www.dataroma.com) 기반으로 유명 가치투자자들의 포트폴리오를 분석합니다.

| 기능 | 설명 |
|------|------|
| 매니저 목록 | 포트폴리오 가치, 보유 종목 수, Top 10 종목 |
| 추천 통계 | 여러 구루가 공통 보유한 종목 랭킹, 가중치 점수 |
| 즉시 크롤링 | 지금 바로 전체 매니저 데이터 수집 (admin only) |

### 애널리틱스

보유 종목 간 상관관계를 히트맵으로 시각화합니다.

### 분석 허브

섹터 모멘텀(11개 섹터 ETF)과 매크로 상관관계(TLT/UUP/USO/VIX)를 분석합니다.

### 설정

| 기능 | 설명 |
|------|------|
| 리포트 스케줄 | 요일·시간 지정 자동 생성 (admin only) |
| 구루 스케줄 | 요일·시간 지정 자동 크롤링 (admin only) |
| 권한 관리 | 사용자별 메뉴 접근 권한 설정 (admin only) |

---

## 개발 환경 요구사항

| 항목 | 최소 버전 |
|------|-----------|
| Python | 3.9+ |
| Node.js | 18+ |
| Docker | 24+ |

## 기술 스택

**백엔드**

| 라이브러리 | 용도 |
|-----------|------|
| FastAPI | REST API 프레임워크 |
| uvicorn | ASGI 서버 |
| psycopg2 | PostgreSQL 드라이버 |
| python-jose | HS256 JWT 인증 |
| APScheduler | 리포트/크롤링 자동 스케줄 |
| yfinance | 주가 데이터 (미국 주식) |
| pandas / numpy | 데이터 처리 |
| matplotlib | 차트 이미지 생성 |
| beautifulsoup4 | HTML 파싱 (Naver, dataroma) |

**프론트엔드**

| 라이브러리 | 용도 |
|-----------|------|
| React 18 + Vite | UI 프레임워크 + 빌드 도구 |
| react-router-dom | 클라이언트 라우팅 |
| axios | HTTP 클라이언트 |
| recharts | 주가·차트 |
| react-markdown | Markdown 리포트 렌더링 |

## 아키텍처

```
Browser (React/Vite :5173)
        │  REST API
        ▼
    nginx (:80)
        │  /api/* proxy
        ▼
FastAPI (:8000)
 ├─ routers/    portfolio, watchlist, stocks, report, guru,
 │              calendar, digest, market_indicators, analytics,
 │              analysis, auth, admin
 ├─ services/   market(yfinance+Naver), charts, report_generator(Claude AI),
 │              consensus, digest_service, market_indicators_service,
 │              auth_service, cache, db, errors, parallel, progress
 │
 └─ PostgreSQL 16
     ├─ users / refresh_tokens   (인증)
     ├─ tickers / user_stocks    (종목)
     ├─ snapshots                (리포트)
     ├─ schedules / guru_*       (스케줄)
     ├─ digests / consensus_history
     ├─ calendar_cache / market_cache
     └─ user_menu_permissions    (권한)
```

## 프로젝트 구조

```
PortfoliOn/
├── docker-compose.yml
├── backend/
│   ├── main.py
│   ├── scheduler.py
│   ├── auth_schema.sql        # 인증 스키마 (먼저 실행)
│   ├── app_schema.sql         # 앱 스키마
│   ├── routers/
│   ├── services/
│   └── data/                  # sp500_tickers.json, kospi_tickers.json
└── frontend/
    └── src/
        ├── pages/
        ├── components/
        └── contexts/          # AuthContext (role + 메뉴 권한)
```

## 참고 문서

- `API_SPEC.md` — REST API 전체 스펙
- `CLAUDE_COWORK_API.md` — Claude AI 연동용 외부 API

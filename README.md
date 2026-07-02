# PortfoliOn

주식 포트폴리오 관리 & AI 리포트 생성 앱 (다중 사용자 SPA)

## 인프라

Mac 로컬 Docker 구성 + Cloudflare Tunnel로 외부 접근. `docker compose`는 4개 컨테이너를 띄운다.

| 컨테이너 | 역할 |
|---------|------|
| nginx | HTTP(:80) 서빙, `/api/*` → backend:8000 프록시, `frontend/dist` 정적 서빙 |
| backend | FastAPI(:8000) |
| postgres | PostgreSQL 16, pgdata 볼륨 |
| certbot | HTTPS 인증서 자동 갱신 |

**Cloudflare Tunnel**(`portfolion.taebro.com` → `localhost:80`)은 compose 컨테이너가 아니라 **launchd**로 실행한다. launchd는 cloudflared와 자동 배포 폴러(`git push origin main` 시 재배포)도 함께 구동한다.

## 빠른 시작

```bash
docker compose up -d
```

> 배포는 `git push origin main`으로 자동화돼 있다. 수동 `docker compose build` / `up` 재빌드는 하지 않는다 — 폴러가 origin/main을 따라 재배포한다.

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

`backend/.env.docker`에 설정 (루트 `.env`에도 `POSTGRES_PASSWORD`를 두어 docker-compose 보간에 사용):

```
# 필수
POSTGRES_PASSWORD=...
JWT_SECRET=...
SESSION_SECRET=...

# 시세·데이터 소스 키 (미설정 시 해당 기능 휴면)
KIWOOM_APP_KEY=...        # KR 1차 시세(키움 REST, 읽기전용)
KIWOOM_SECRET_KEY=...
KIWOOM_BASE_URL=...
KIS_APP_KEY=...           # KR+US 백업 시세(한국투자증권, 읽기전용)
KIS_APP_SECRET=...
KIS_BASE_URL=...
FRED_API_KEY=...          # 경제지표(미 연준)
KOFIA_API_KEY=...         # 신용잔고·반대매매·대차잔고
DART_API_KEY=...          # 수주잔고
KITA_API_KEY=...          # 관세청 수출(미설정 시 UN Comtrade 폴백)

# OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

# 기타
TELEGRAM_BOT_TOKEN=...    # 일일 다이제스트 발송
TELEGRAM_CHAT_ID=...
COWORK_API_KEY=...        # 외부 AI(Cowork) enrich API 인증
FRONTEND_URL=...          # CORS 허용 origin
```

> 백엔드에는 **LLM/Anthropic 호출이 없다**. AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API(`CLAUDE_COWORK_API.md`)로 작성하며, 백엔드 리포트 생성은 시장 데이터 스냅샷만 만든다.

## 초기 DB 설정

PostgreSQL 스키마를 순서대로 실행 (인증 → 앱):

```bash
# 1. 인증 스키마 (users, refresh_tokens)
docker exec -i portfolion-postgres psql -U postgres -d portfolion < backend/auth_schema.sql

# 2. 앱 스키마 (tickers, user_stocks, snapshots, ...)
docker exec -i portfolion-postgres psql -U postgres -d portfolion < backend/app_schema.sql
```

> 신규 테이블/컬럼은 기동 시 `main._migrate()`의 `CREATE TABLE IF NOT EXISTS`가 정본이다(app_schema.sql은 빈 DB 최초 1회만 적용).

Admin 계정 설정:

```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```

## 화면 구성

내비게이션은 5개 탭(+ admin 전용 1개)으로 구성된다. 홈(`/`)은 리서치다.

### 포트폴리오 (Portfolio, `/portfolio`)

포트폴리오 집계 대시보드와 분석 탭. (보유·관심 종목 추가·수정·삭제·승격은 리서치 리포트 탭에서 한다.)

| 기능 | 설명 |
|------|------|
| 대시보드 | 보유 종목 P&L·비중, 배당 트래킹(배당수익률·매수가 대비 수익률·연 예상배당), 포트폴리오 KRW 환산 총계 |
| 분석 탭 | 섹터 모멘텀(US=11개 섹터 ETF / KR=KRX 업종 모멘텀, KR/US 토글), 매크로 상관(TLT/UUP/USO/VIX), 보유 종목 상관관계 히트맵 |

### 리서치 (Research 허브, 홈 `/`)

| 탭 | 설명 |
|------|------|
| 리포트 | 종목별 4탭(요약·심층분석·리포트·이력), 주가·RSI 차트, 목표가 컨센서스·괴리율, 수주잔고, 공매도·수급 추이(수급 종합 밴드·근거 헤더, KR 종목만), 내부자·5% 지분변동(신호 배지, KR), 최신 공시(DART), 상대 밸류에이션(종목 PSR·EV/EBITDA + 경쟁사 PER/PBR 비교); 심층분석 지표 탭 → 기술·수급 서브탭에 52주 고/저·EMA 20/50/200·추세 요약·베타·역사적 변동성(HV) 표시, US 종목에 공매도 비중(유통주식 대비·Days to Cover·잔량)·기관 보유 상위(보유비중·전분기 대비)·내부자 거래(Form4: 6개월 순매수 요약 + 거래 목록)·보유 구루 드릴다운(13F 역인덱스: 운용역명·운용사·포트폴리오 비중·Top10 순위, /api/guru/managers 재사용) 추가. 즉시 생성·과거 백필(admin). 보유/관심 종목 관리(라이브 P&L·편집·삭제·승격·추가)도 여기서 한다. admin은 "그외" 탭(타 사용자 종목)에서 전체 사용자 제거도 가능 |
| 랭킹 | 거래대금·거래량·등락률 상위(KR/US) + 외국인/기관/개인 수급(랭킹·리포트 상세 공유) |
| 추천 | 보유 액션(추매/익절/홀딩 신호·평가손익·비중), 관심 재정렬(점수순), 발굴 종목 카드(합성 점수·근거 플래그·딥다이브로 관심 추가) |
| 다이제스트 | 보유·관심 종목 요약 + 최신 공시 + 내부자 순매수 라인 매일 자동 생성(텔레그램 발송) |
| 캘린더 | 실적 발표일(US+KR, yfinance)·배당락일(US: 정확한 ex-date)·주총 일정(KR, DART)·경제지표 발표일(FRED)·FOMC 정책결정일(정적, FRED_API_KEY 불필요) 월간 그리드 |

### 시장 (MarketHub)

| 탭 | 설명 |
|------|------|
| 시장지표 | 국채, FX, VIX, 원자재, 경제지표(FRED), 매크로 신호(금리차·HY 스프레드·M2·기준금리 + 신호 해석), M7/KR Top2 실적, KR 수출, 글로벌 지수(S&P 500·KOSPI·KOSDAQ 레벨·등락률·시계열) + S&P 500 Shiller CAPE 밸류에이션 |
| 수급지표 | 신용잔고·반대매매, 내외국인 대차잔고 |

### 구루 (Guru)

[dataroma](https://www.dataroma.com) 기반 유명 가치투자자 포트폴리오 분석.

| 기능 | 설명 |
|------|------|
| 매니저 목록 | 포트폴리오 가치, 보유 종목 수, Top 10 |
| 추천 통계 | 여러 구루 공통 보유 종목 랭킹·가중치 |
| 즉시 크롤링 | 전체 매니저 데이터 즉시 수집 (admin) |

### 설정 (Settings)

| 기능 | 설명 |
|------|------|
| 배치 현황 허브 | 전 배치의 주기·데이터 소스(fetch 출처)·사용처·다음 실행·실행 이력 열람. 스케줄 편집·즉시 실행은 admin. 국내/해외/공통 시장 탭으로 구분 |
| 권한 관리 | 사용자별 메뉴 접근 권한 (admin) |

### 행동 (AdminAnalytics, admin 전용)

사용자 행동 이벤트 집계 분석 (`/admin-analytics`).

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
| FastAPI / uvicorn | REST API + ASGI 서버 |
| psycopg2 | PostgreSQL 드라이버 |
| python-jose | HS256 JWT 인증 |
| APScheduler | 배치(리포트·크롤링·시세·지표) 자동 스케줄 |
| yfinance | US 주가·시장 데이터 (US 1차 소스) |
| 키움 / 한국투자증권(KIS) REST | KR 시세(1차=키움, 백업=KIS), US 백업 시세 — 읽기전용 |
| pandas / numpy | 데이터 처리 |
| beautifulsoup4 / lxml | HTML 파싱 (Naver, dataroma, DART) |

**프론트엔드**

| 라이브러리 | 용도 |
|-----------|------|
| React 19 + Vite 8 (rolldown) | UI 프레임워크 + 빌드 도구 |
| react-router-dom 7 | 클라이언트 라우팅 |
| axios | HTTP 클라이언트 |
| recharts (+d3) | 주가·지표 차트 |

## 아키텍처

```
Browser (React 19 / Vite 8 :5173)
        │  REST API
        ▼
    nginx (:80)   ─ /api/* proxy + frontend/dist 정적 서빙
        ▼
FastAPI (:8000)
 ├─ routers/    portfolio, watchlist, stocks, report, guru, calendar,
 │              digest, market_indicators, analytics, analysis, auth,
 │              admin, events, batches, rankings, investor, short_sell
 ├─ services/   market(yfinance+키움/KIS+Naver), charts, indicators,
 │              report_generator(시장데이터 스냅샷·LLM 미호출),
 │              consensus / consensus_pipeline, digest_service,
 │              market_indicators/(fx·vix·commodities·earnings·econ·exports·macro),
 │              leverage_service, lending_service, ranking_service,
 │              investor_service, short_sell_service, supply_score, backlog, disclosures, insider_trades,
 │              dividends, analysis_service, kr_sector_service, us_sector_service,
 │              guru_scraper / guru_stats, batch_registry, job_runs,
 │              kiwoom/, kis/, auth_service, cache, db, errors, parallel, progress
 ├─ scheduler.py  APScheduler 배치(시장별 분리 포함)
 │
 └─ PostgreSQL 16
     ├─ users / refresh_tokens                  (인증)
     ├─ tickers / user_stocks / stock_dividends / stock_supply_score   (종목·배당·수급 스코어)
     ├─ snapshots / raw_reports / stock_disclosures / stock_insider_trades   (리포트·공시·내부자)
     ├─ schedules / guru_schedules / guru_managers   (스케줄·구루)
     ├─ digests / consensus_history / daily_consensus_mart
     ├─ calendar_cache / market_cache
     ├─ user_menu_permissions / default_menu_permissions   (권한)
     ├─ user_events                              (행동 로그)
     └─ market_leverage_indicators / market_lending_balance   (수급지표)
```

> AI 분석 텍스트는 백엔드가 생성하지 않는다 — 외부 Cowork 클라이언트가 enrich API로 작성한다.

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
│   │   ├── market_indicators/ # fx·vix·commodities·earnings·econ·exports
│   │   ├── kiwoom/            # 키움 REST(KR 시세, 읽기전용)
│   │   └── kis/               # 한국투자증권 REST(KR+US 백업 시세)
│   └── data/                  # sp500_tickers.json, kospi_tickers.json (정적 참조)
└── frontend/
    └── src/
        ├── pages/             # Portfolio, Research·MarketHub 허브, Guru, Settings 등
        ├── components/
        └── contexts/          # AuthContext (role + 메뉴 권한)
```

## 참고 문서

- `API_SPEC.md` — REST API 전체 스펙
- `CLAUDE_COWORK_API.md` — 외부 AI(Cowork) 연동용 API (리포트 enrich)
- `KIWOOM_API.md` — 키움 REST 연동 카탈로그·경계
- `KIS_API.md` — 한국투자증권(KIS) 백업 시세 연동 카탈로그·경계
- `CLAUDE.md` — 프로젝트 컨텍스트·아키텍처·gotcha (개발 가이드)

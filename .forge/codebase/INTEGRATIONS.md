---
last_mapped_commit: 1bbea86804f93c6f544092809ff8ed13977e5975
mapped: 2026-06-06
---

# 외부 연동 (INTEGRATIONS)

PortfoliOn이 의존하는 외부 데이터베이스, API, 인증 제공자, 서드파티 서비스 목록이다. 각 항목은 용도, 호출 위치(파일 경로), 필요한 환경변수/키를 기술한다.

## 데이터베이스

### PostgreSQL (Docker)

- **용도**: 기본 영구 저장소. 사용자/인증, 종목 마스터, 보유·관심 종목, 리포트 스냅샷, 스케줄, 구루 데이터, 다이제스트, 컨센서스 히스토리, 캘린더 캐시, 시장지표 캐시, 메뉴 권한, 사용자 행동 로그, 신용/대차 시계열 등 거의 모든 런타임 데이터를 보관.
- **호출 위치**: `backend/services/db.py` — `psycopg2` `ThreadedConnectionPool`(minconn=1, maxconn=10), `query`/`execute` 헬퍼. 컨테이너 정의는 `docker-compose.yml`의 `postgres` 서비스(`postgres:16-alpine`). 스키마 초기화는 `backend/auth_schema.sql` → `backend/app_schema.sql` 순서로 마운트.
- **필요 키/env**: `DATABASE_URL` (DSN). 컨테이너 비밀번호는 `POSTGRES_PASSWORD`.

## 시장/금융 데이터 API

### yfinance (Yahoo Finance)

- **용도**: 주가 시세, 재무, 종목 info, 히스토리, 뉴스(US), 캘린더(실적일), 시장지표(FX/VIX/원자재/국채/실적) 등 핵심 시장 데이터 조회.
- **호출 위치**: `backend/services/market.py`, `backend/services/report_generator.py`, `backend/services/indicators.py`, `backend/services/consensus.py`, `backend/services/consensus_pipeline.py`, `backend/services/analysis_service.py`, `backend/services/ranking_service.py`, `backend/services/scraper.py`, `backend/services/digest_service.py`, `backend/services/market_indicators/cache.py`, `backend/services/market_indicators/earnings.py`, `backend/routers/stocks.py`, `backend/routers/report.py`, `backend/routers/calendar.py`, `backend/routers/analytics.py`.
- **필요 키/env**: 없음 (인증 불필요, 공개 엔드포인트). yfinance 호출은 `ThreadPoolExecutor`로 병렬화됨.

### Naver 금융 (비공식 API/HTML)

- **용도**: 한국 종목 시세·재무, 종목 검색 자동완성, 한국 종목 뉴스, 애널리스트 리서치 리포트(컨센서스), 시가총액 랭킹, M7/KR Top2 실적, 구루(US) 데이터.
- **호출 위치 및 엔드포인트**:
  - `backend/services/market.py` — `https://m.stock.naver.com/api/stock` (한국 종목 시세/재무)
  - `backend/routers/stocks.py` — `https://ac.stock.naver.com/ac` (종목 검색 자동완성)
  - `backend/services/scraper.py` — `https://m.stock.naver.com/api/news/stock/{ticker}`, 기사 `https://n.news.naver.com/...` (한국 뉴스)
  - `backend/services/consensus.py`, `backend/services/consensus_pipeline.py` — `https://m.stock.naver.com/api/research/stock/{ticker}` (리서치 리포트/컨센서스)
  - `backend/services/ranking_service.py` — `https://m.stock.naver.com/api/stocks/marketValue` (시총 랭킹)
  - `backend/services/market_indicators/earnings.py` — `https://m.stock.naver.com/api/stock`, `https://finance.naver.com/sise/sise_market_sum.naver`
  - `backend/services/guru_scraper.py` — `https://api.stock.naver.com/stock` (구루 US 데이터)
- **필요 키/env**: 없음. 요청 시 `Referer: https://m.stock.naver.com/` 헤더 사용.

### Finviz (HTML 스크래핑)

- **용도**: US 종목 애널리스트 컨센서스(recom)·목표주가 스크래핑.
- **호출 위치**: `backend/services/scraper.py` — `https://finviz.com/quote.ashx?t={ticker}` (BeautifulSoup 파싱).
- **필요 키/env**: 없음.

### FRED (St. Louis Fed) API

- **용도**: 미국 경제지표(CPI=`CPIAUCSL`, 실업률=`UNRATE`) 시계열 조회.
- **호출 위치**: `backend/services/market_indicators/econ.py` — `https://api.stlouisfed.org/fred/series/observations`. PostgreSQL `market_cache`에 증분 저장.
- **필요 키/env**: `FRED_API_KEY` (미설정 시 에러 반환).

### 관세청(Korea Customs Service) 공공데이터 API + UN Comtrade 폴백

- **용도**: 한국 월별 수출 데이터(반도체 HS 8542 / 비반도체) 조회.
- **호출 위치**: `backend/services/market_indicators/exports.py`
  - 1차: 관세청 — `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList` (XML 응답 파싱)
  - 폴백: UN Comtrade — `https://comtradeapi.un.org/public/v1/preview/C/M/HS` (reporterCode 410=대한민국)
- **필요 키/env**: `KITA_API_KEY` (실제로는 관세청 serviceKey). 미설정 시 자동으로 UN Comtrade 공개 API로 폴백.

### KOFIA / 공공데이터포털 (금융위원회) API

- **용도**: 신용잔고·반대매매·시가총액 등 레버리지 지표, 내외국인 대차잔고 시계열 수집.
- **호출 위치**:
  - `backend/services/leverage_service.py` — `https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService`, `https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService` → `market_leverage_indicators` 테이블
  - `backend/services/lending_service.py` — `https://apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2/getNatiAndForeLendAndBorrBalaCo_V2` → `market_lending_balance` 테이블
  - 백필 스크립트: `backend/run_backfill.py`
- **필요 키/env**: `KOFIA_API_KEY` (leverage·lending 공통). 미설정 시 요청 실패.

### DART (금융감독원 전자공시) OpenAPI

- **용도**: 한국 상장사 수주잔고(Order Backlog) 수집(corpCode·공시목록·문서 파싱, 파싱 실패 시 raw_text DB 저장 후 Claude Cowork 처리).
- **호출 위치**: `backend/services/backlog.py` — `https://opendart.fss.or.kr/api` (corpCode.xml, list.json, index.json 등).
- **필요 키/env**: `DART_API_KEY`.

## 인증 제공자 (OAuth)

### Google OAuth 2.0

- **용도**: Google 소셜 로그인 (openid email profile 스코프).
- **호출 위치**: `backend/routers/auth.py`
  - authorize: `https://accounts.google.com/o/oauth2/v2/auth`
  - token 교환: `https://oauth2.googleapis.com/token` (httpx 비동기). id_token 페이로드를 base64로 직접 디코딩해 email/sub 추출.
  - redirect_uri: `{FRONTEND_URL}/api/auth/oauth/google/callback`
- **필요 키/env**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FRONTEND_URL`.

### GitHub OAuth

- **용도**: GitHub 소셜 로그인 (user:email 스코프).
- **호출 위치**: `backend/routers/auth.py`
  - authorize: `https://github.com/login/oauth/authorize`
  - token 교환: `https://github.com/login/oauth/access_token`
  - 프로필/이메일: `https://api.github.com/user`, `https://api.github.com/user/emails`
  - redirect_uri: `{FRONTEND_URL}/api/auth/oauth/github/callback`
- **필요 키/env**: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `FRONTEND_URL`.

### 자체 JWT 인증

- **용도**: HS256 JWT 발급/검증(액세스+리프레시), bcrypt 비밀번호 해시. OAuth/이메일 로그인 후 토큰 발급.
- **호출 위치**: `backend/services/auth_service.py`(발급), `backend/auth.py`(검증·`get_current_user`/`require_admin`), `backend/middleware/event_tracker.py`(미들웨어 디코드).
- **필요 키/env**: `JWT_SECRET`, `SESSION_SECRET`(Starlette `SessionMiddleware`·OAuth state HMAC, `backend/main.py`·`backend/routers/auth.py`).

### Claude Cowork API Key

- **용도**: 외부 Claude AI가 종목 분석을 읽고 쓰기 위한 API 키 인증(`X-API-Key` 헤더). JWT 대신 API 키로 admin 작업 허용.
- **호출 위치**: `backend/auth.py` — `get_current_user_or_api_key`/`require_admin_or_api_key`에서 `X-API-Key` 헤더와 비교. 외부 스펙은 `CLAUDE_COWORK_API.md`.
- **필요 키/env**: `COWORK_API_KEY`.

## 서드파티 서비스 / 알림

### Telegram Bot API

- **용도**: 일일 다이제스트(포트폴리오 요약·이상신호·임박 이벤트)를 텔레그램으로 푸시 발송.
- **호출 위치**: `backend/services/digest_service.py` — `send_telegram(digest)`. 토큰/챗ID 미설정 시 발송을 조용히 생략.
- **필요 키/env**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

### Anthropic API

- **용도**: 문서·`backend/.env.docker.example`상 AI 리포트 생성용으로 명시. 다만 현재 `backend/` 파이썬 코드에는 직접 호출이 없으며, 리포트 생성(`backend/services/report_generator.py`)은 yfinance·Naver·Finviz만 사용. 키는 외부 Claude Cowork 워크플로우가 소비하는 것으로 추정.
- **필요 키/env**: `ANTHROPIC_API_KEY`.

## 네트워크 / 인프라

### Cloudflare Tunnel

- **용도**: 외부 도메인 `portfolion.taebro.com` → 로컬 `localhost:80` 노출(현행 배포 방식). launchd로 cloudflared 자동 실행.
- **참조 위치**: `README.md`, `CLAUDE.md`, `CLAUDE_COWORK_API.md`(Base URL `https://portfolion.taebro.com`). nginx는 HTTP(80)만 서빙(`nginx/nginx.conf`).
- **필요 키/env**: cloudflared 자체 토큰(소스 외부에서 관리).

### Cloudflare DNS API (대체 DDNS 경로)

- **용도**: 동적 IP 환경에서 `portfolion.taebro.com` A 레코드를 현재 공인 IP로 갱신(cron 5분 주기). 현행 외부 접근은 Cloudflare Tunnel이 담당하며, 본 스크립트는 대체/보조 DDNS 경로.
- **호출 위치**: `scripts/ddns_update.sh` — `https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/dns_records/{RECORD_ID}` (PATCH), 공인 IP 조회는 `https://api.ipify.org`.
- **필요 키/env**: `CF_ZONE_ID`, `CF_RECORD_ID`, `CF_API_TOKEN`.

### Let's Encrypt (certbot)

- **용도**: TLS 인증서 발급·자동 갱신(12시간 주기). docker-compose의 `certbot` 컨테이너. 현재 nginx 443 블록은 주석 처리 상태.
- **참조 위치**: `docker-compose.yml`(certbot 서비스), `nginx/nginx.conf`(주석 처리된 443 블록 및 acme-challenge webroot), `docs/ops/deploy.md`.
- **필요 키/env**: 없음(webroot 챌린지 방식, 도메인 검증).

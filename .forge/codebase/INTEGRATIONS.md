---
last_mapped_commit: 91173837359c5f157349a51501f72efa7342c3fa
mapped: 2026-06-20
---

# INTEGRATIONS

PortfoliOn의 외부 API·데이터 소스·데이터베이스·인증·스케줄러·배포 통합을 정리한다. 각 항목은 관련 서비스 파일과 환경변수 **키 이름**(값 아님)을 명시한다. 라이브러리/버전은 `STACK.md` 참조.

## External APIs & Data Sources (시세·재무·시장 데이터)

### yfinance (US 1차 시세/재무/히스토리)
- 라이브러리(`yfinance`)로 Yahoo Finance를 직접 호출. 별도 API 키 없음.
- US 종목 시세·섹터/시총·히스토리·재무·캘린더(실적일)·상관관계의 1차 소스.
- 서비스: `backend/services/market/us.py`, `backend/services/market_indicators/`(fx/vix/commodities/treasury 등 `_yf_close_history`), `backend/services/analysis_service.py`(SECTOR_ETFS·MACRO_TICKERS), `backend/services/consensus_pipeline.py`(upgrades_downgrades), `backend/services/indicators.py`. 호출처는 `routers/stocks.py`·`report.py`·`analysis.py`·`analytics.py`·`calendar.py` 등.

### Naver (KR 시세/재무 폴백)
- 모바일 증권 비공식 JSON API. 키 없음. base URL `https://m.stock.naver.com/api/stock`, `Referer: https://m.stock.naver.com/`.
- 서비스: `backend/services/market/kr.py`(`_naver_get`/`_kr_basic_naver`/`finance/quarter`/`finance/annual`). KR 시세 체인의 최종 폴백(상폐 종목은 HTTP 409로 검출).

### 키움증권 (Kiwoom REST, KR 읽기전용 1차 — 시세/업종/수급/랭킹/공매도)
- base URL 기본 `https://api.kiwoom.com`(override: `KIWOOM_BASE_URL`). OAuth2 client_credentials 토큰(`/oauth2/token`), TR 요청은 `POST /api/dostk/{category}`(헤더 `api-id`/`authorization`). 인프로세스 토큰 싱글톤·401 재발급·직렬 throttle(min 0.25s)·연속조회(cont-yn/next-key) 지원.
- 클라이언트: `backend/services/kiwoom/client.py`. 모듈: `quote.py`(ka10001 현재가), `sector.py`(ka20006/ka20002 KRX 업종 모멘텀), `investor.py`(수급), `chart.py`(차트), `shortsell.py`(공매도). KR전용·읽기전용·서버측 단일키 경계는 ADR-0009.
- 환경변수: `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY`, `KIWOOM_BASE_URL`(옵션). 키 미설정 시 `configured()` False로 휴면 → 호출측이 폴백.
- KR 시세 체인: `market/kr.py`가 **키움 → KIS → Naver** 순서.

### 한국투자증권 (KIS REST, KR+US 읽기전용 *백업* 시세)
- base URL 기본 실전 `https://openapi.koreainvestment.com:9443`(override: `KIS_BASE_URL`, 모의투자 도메인). OAuth2 토큰 `POST /oauth2/tokenP`, 시세 조회는 GET `/uapi/...`(헤더 `tr_id`/`appkey`/`appsecret`/`custtype=P`). 토큰 발급 1분당 1회 제한(EGW00133) 방어로 강제 재발급 60s 가드.
- 클라이언트: `backend/services/kis/client.py`. 모듈: `quote.py`(국내 `FHKST01010100`; 해외 `HHDFS00000300`/`HHDFS76240000`, EXCD NAS→NYS→AMS probe). 경계는 ADR-0011.
- 환경변수: `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_BASE_URL`(옵션). 키 미설정이 안전 기본값(휴면). KR은 키움 다음 백업, US는 yfinance 다음 백업.

### DART (전자공시, KR 재무/공시/수주잔고/배당/내부자거래)
- 금융감독원 OpenDART. base `https://opendart.fss.or.kr/api`, 공시 뷰어 `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=...`. KR 전용·키 필수, status 013(무데이터)은 graceful 빈 응답.
- 서비스: `backend/services/backlog.py`(+`backlog_parser.py`, 수주잔고 — `/api/document.xml` 원문 파싱), `backend/services/disclosures.py`(공시 피드 `list.json`, 핵심유형 A/B/C/D 개별 호출), `backend/services/dividends.py`(KR 배당 `alotMatter.json`), `backend/services/insider_trades.py`(내부자거래).
- 환경변수: `DART_API_KEY`.

### FRED (미국 연준 경제/매크로 시계열)
- St. Louis Fed FRED. endpoint `https://api.stlouisfed.org/fred/series/observations`.
- 서비스: `backend/services/market_indicators/econ.py`(경제지표), `backend/services/market_indicators/macro.py`(매크로 신호 T10Y2Y/BAMLH0A0HYM2/M2SL/DFF). 키 미설정 시 수집 실패(저장값 무변경).
- 환경변수: `FRED_API_KEY`.

### KOFIA / 공공데이터포털 (신용잔고·반대매매·대차잔고)
- 공공데이터포털(data.go.kr) REST.
  - `backend/services/leverage_service.py`: `https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService`(KOFIA 통계, 신용잔고/반대매매) + `.../GetMarketIndexInfoService`(시총).
  - `backend/services/lending_service.py`: `https://apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2`(금융위 내외국인 대차잔고).
- 두 서비스 모두 동일 키 사용. 환경변수: `KOFIA_API_KEY`. 미설정 시 요청 실패.

### KITA / 관세청 (KR 수출 데이터)
- `KITA_API_KEY`는 실제로는 **관세청(Korea Customs Service)** 키: `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList`. 키 미설정 시 **UN Comtrade** 공개 API(`https://comtradeapi.un.org/public/v1/preview/C/M/HS`)로 자동 폴백.
- 서비스: `backend/services/market_indicators/exports.py`. 환경변수: `KITA_API_KEY`(옵션 — 폴백 존재).

### Telegram (다이제스트 푸시)
- `https://api.telegram.org/bot{token}/sendMessage`로 일일 다이제스트 전송.
- 서비스: `backend/services/digest_service.py`(`send_telegram`). 환경변수: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

## Authentication

### JWT (HS256) + Refresh Token
- 액세스 토큰: `jose.jwt`로 HS256 인코딩, 만료 1시간. 리프레시 토큰: `secrets.token_urlsafe(64)`, 만료 30일, `refresh_tokens` 테이블 저장.
- 서비스: `backend/services/auth_service.py`(`issue_tokens`/`verify_access_token`/`consume_refresh_token`). 의존성 게이트: `backend/auth.py`(`get_current_user`, `HTTPBearer`). 라우터: `backend/routers/auth.py`, `routers/admin.py`(role 게이팅).
- 비밀번호 해시: `bcrypt`. 환경변수: `JWT_SECRET`.

### Cowork API Key (외부 Claude 클라이언트용)
- 헤더 `X-API-Key`로 인증(sentinel user_id `__api_key__`). enrich/분석 쓰기 엔드포인트가 사용(`CLAUDE_COWORK_API.md`).
- 검증: `backend/auth.py`. 환경변수: `COWORK_API_KEY`.

### Google OAuth 2.0
- 인가 `https://accounts.google.com/o/oauth2/v2/auth`, 토큰 `https://oauth2.googleapis.com/token`. redirect URI = `FRONTEND_URL` + `/api/auth/oauth/google/callback`. 콜백에서 `httpx`로 토큰 교환 후 `upsert_oauth_user(provider="google")`.
- 라우터: `backend/routers/auth.py`(`/oauth/google`, `/oauth/google/callback`). 환경변수: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

### GitHub OAuth
- 인가 `https://github.com/login/oauth/authorize`, 토큰 `https://github.com/login/oauth/access_token`, 프로필 `https://api.github.com/user`(+`/user/emails`).
- 라우터: `backend/routers/auth.py`(`/oauth/github`, `/oauth/github/callback`). 환경변수: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.

### Session Middleware
- Starlette `SessionMiddleware`(`itsdangerous` 서명) — OAuth 흐름 보조. 환경변수: `SESSION_SECRET`.

## Database

### Docker PostgreSQL 16
- `postgres:16-alpine` 컨테이너, DB/USER `portfolion`, 볼륨 `pgdata`. init SQL: `01-auth.sql`(=`backend/auth_schema.sql`) → `02-app.sql`(=`backend/app_schema.sql`) 순서.
- 연결: `backend/services/db.py` — psycopg2 `ThreadedConnectionPool`(minconn=1/maxconn=20) 싱글톤, `query`/`execute`/`get_connection` 헬퍼. 환경변수: `DATABASE_URL`, `POSTGRES_PASSWORD`(docker-compose).
- 기동 시 idempotent 마이그레이션(`backend/main.py` `_migrate`): `ADD COLUMN IF NOT EXISTS`/`CREATE TABLE IF NOT EXISTS`로 `backlog_history.segments`, `batch_schedules`, `market_short_sell`, `stock_disclosures`, `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations` 등을 안전 적용.
- 주요 테이블·역할은 `CLAUDE.md` Data Model 표 참조(글로서리는 CONTEXT.md). 로컬 JSON 파일은 런타임 캐시 용도(`backend/data/consensus/`, `backend/data/calendar/`, `backend/snapshots/`).

## Schedulers / Batch Jobs

### APScheduler (AsyncIOScheduler)
- 패키지: `backend/scheduler/`(`_state.py`=`AsyncIOScheduler` 싱글톤, `schedule.py`=`CronTrigger` 빌드/리스케줄, `jobs.py`=잡 함수, `__init__.py`). `backend/main.py` lifespan에서 `sched.start()`/`sched.stop()`.
- 배치 카탈로그: `backend/services/batch_registry.py`(`BATCHES`, 각 배치의 `market`(KR/US/공통)·`source`·`usage`·schedule을 보유). 스케줄 스펙→트리거 변환은 `backend/services/schedule_spec.py`(`build_trigger_kwargs`). 편집 가능 스케줄은 `batch_schedules` 테이블 저장. 실행이력은 `backend/services/job_runs.py`(`job_runs` 테이블, auto/manual/backfill lane).
- 대표 잡(개요): 일일 리포트 시장 분리(`daily_report_kr` ~20:30 KST / `daily_report_us` ~07:00 KST), 다이제스트(08:00 KST → Telegram), 매크로 신호(06:00 KST), 공시 피드(07:30 KST), KR 업종 모멘텀(16:00 KST), 수주잔고/배당(주간), 실적/월간(KR/US 분리). 잡 노출: `GET /api/batches`.
- lifespan 워밍: 캘린더 캐시(`_warm_calendar_cache`)·시장 캐시(`_warm_market_cache`)를 데몬 스레드로 선적재.

## Deployment

### 인프라 (Mac 로컬 Docker 4-컨테이너)
- `docker-compose.yml`: `postgres`(16-alpine, pgdata 볼륨) / `backend`(`./backend` 빌드, `env_file: ./backend/.env.docker`) / `nginx`(alpine, 80·443 노출, `frontend/dist`·`nginx/nginx.conf`·certbot 볼륨 `:ro`) / `certbot`(certbot/certbot, 12h마다 `certbot renew`).
- **nginx**(`nginx/nginx.conf`): HTTP(80) 서빙, `/api/`·`/health` → `backend:8000` 프록시, `/.well-known/acme-challenge/`(certbot), `index.html`/`sw.js`/`workbox-*.js` no-cache, Vite 해시 자산 장기 immutable 캐시, SPA fallback `try_files $uri /index.html`. 443 SSL 블록은 주석 상태.
- **프론트 서빙**: nginx가 `./frontend/dist`를 `:ro` 볼륨마운트로 직접 서빙 — 로컬 `npm run build`가 즉시 라이브.
- 환경변수: `backend/.env.docker`(키 이름만; `.env.docker.example`이 템플릿), `.env`(루트, docker-compose 보간), `FRONTEND_URL`(CORS·OAuth redirect).
- CORS origins(`backend/main.py`): `http://localhost:3000`, `http://localhost:5173`, `FRONTEND_URL`.

### Cloudflare Tunnel + launchd (외부 노출/자동화)
- **Cloudflare Tunnel**: `portfolion.taebro.com` → `localhost:80`. `cloudflared`는 compose 컨테이너가 아니라 launchd로 실행.
- **launchd**: `cloudflared` + `docker compose` 자동 기동. 자동 배포 폴러 `com.portfolion.auto-deploy-poll`이 2분마다 `scripts/auto-deploy-poll.sh`를 돌려 `origin/main`이 로컬 HEAD보다 앞서면 `git reset --hard origin/main` 후 `deploy.sh` 실행(락파일 `/tmp/portfolion-deploy.lock`).
- **deploy.sh**: ① `frontend && npm install && npm run build` ② `docker build ./backend` ③ 컨테이너 교체. `git push origin main`이 자동 배포 트리거(수동 `docker compose build/up` 금지).
- 보조 스크립트: `scripts/ddns_update.sh`(DDNS), Playwright UAT 스크립트(`scripts/*.js`).

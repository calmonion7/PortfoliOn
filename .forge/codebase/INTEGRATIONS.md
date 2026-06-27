---
last_mapped_commit: 74f5ca940c42a3ee866a45ccccfe24ac701a04d9
mapped: 2026-06-27
---

# 외부 연동

**분석 일자:** 2026-06-27

## API & 외부 서비스

### KR 시세 — 키움증권 REST (1차)
- 코드: `backend/services/kiwoom/client.py` (토큰 발급 `POST /oauth2/token`, 요청 헬퍼 `request(api_id, body, category)` = `POST /api/dostk/{category}`), `quote.py`(ka10001), `chart.py`(ka10081 일봉), `sector.py`(ka20006/ka20002 업종), `investor.py`, `shortsell.py`.
- 베이스 URL: `https://api.kiwoom.com` (`client.py:27`, `KIWOOM_BASE_URL`로 override).
- 인증: `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY`. 토큰 인프로세스 싱글톤(캐시 12h, 401 시 재발급 재시도), 직렬 throttle 0.25s.
- 경계: KR 읽기전용 시세만, 계좌·주문 미연동 (ADR-0009). `configured()` False면 휴면 → 호출측 폴백.
- 코드 선택: `client.integrated_code(stk_cd, regular=False)` — 기본 `_AL`(NXT 통합), `regular=True`면 평문 KRX(정규장 종가, 리포트 스냅샷용).

### KR 시세 — 한국투자증권(KIS) REST (백업)
- 코드: `backend/services/kis/client.py` (토큰 `POST /oauth2/tokenP`, 요청 `request(tr_id, path, params)` = GET `/uapi/...`), `quote.py`(국내 `FHKST01010100`, 해외 price `HHDFS00000300`·dailyprice `HHDFS76240000`).
- 베이스 URL: `https://openapi.koreainvestment.com:9443` (실전 기본, `client.py:30`, `KIS_BASE_URL`로 모의 override).
- 인증: `KIS_APP_KEY`, `KIS_APP_SECRET`. 토큰 싱글톤(캐시 23h, 발급 1분당 1회 EGW00133 방어 60s 가드), throttle 0.05s.
- 경계: KR+US 읽기전용 백업, 주문·계좌 미연동 (ADR-0011). `configured()` False면 휴면.

### KR 시세 — Naver (폴백)
- 코드: `backend/services/market/kr.py` (`_naver_get`, `_kr_basic_naver`).
- 엔드포인트: `https://m.stock.naver.com/api/stock/{ticker}/basic` 등 (`kr.py:12`). 자격증명 불필요(공개 API, `Referer` 헤더만).
- KR 시세 체인: 키움 NXT → KIS → Naver → 키움 KRX. 독립 피드 2-of-N 다수결 합의(`_corroborated_pick`, `kr.py`).

### KR 펀더멘털 — FnGuide (스크래핑)
- 코드: `backend/services/market/kr.py` (`comp.fnguide.com/SVO2/...`, `kr.py:30`).
- 자격증명 불필요(`_FNGUIDE_HEADERS`).

### US 시세/펀더멘털 — yfinance (1차)
- 코드: `backend/services/market/us.py` (`yf.Ticker`, `yf.download`). 가격·섹터·시총·히스토리·배치 1콜.
- 자격증명 불필요. US 체인: yfinance → KIS(백업).

### 환율 — open.er-api.com
- 코드: `backend/services/market_indicators/fx.py:11` — `https://open.er-api.com/v6/latest/USD` (현재 USDKRW). 히스토리는 yfinance FX 심볼(`USDKRW=X`/`USDJPY=X`/`EURUSD=X`, `fx.py:6`).
- 자격증명 불필요.

### 경제/매크로 지표 — FRED (St. Louis Fed)
- 코드: `backend/services/market_indicators/econ.py`, `backend/services/market_indicators/macro.py` — `https://api.stlouisfed.org/fred/series/observations`.
- 인증: `FRED_API_KEY` (미설정 시 `{"error": ...}` 반환, 수집 실패).
- macro 시계열: `T10Y2Y`(금리차)·`BAMLH0A0HYM2`(HY OAS)·`M2SL`·`DFF`.

### KR 공시·기업정보 — DART (금융감독원 OpenDART)
- 코드: `backend/services/disclosures.py`(공시 list.json), `backend/services/backlog.py`(수주잔고 document.xml), `backend/services/dividends.py`(KR 배당 alotMatter), `backend/services/insider_trades.py`(내부자 거래).
- 베이스 URL: `https://opendart.fss.or.kr/api` (뷰어 `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=`).
- 인증: `DART_API_KEY` (KR 전용·필수). status 013(무데이터)은 graceful 빈 결과.

### KR 신용잔고·반대매매·시총 — KOFIA / 공공데이터포털
- 코드: `backend/services/leverage_service.py` — `https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService`(KOFIA 통계) + `https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService`(시장지수).
- 인증: `KOFIA_API_KEY`. 미설정 시 요청 실패. → `market_leverage_indicators` 테이블.

### KR 내외국인 대차잔고 — 금융위원회 / 공공데이터포털
- 코드: `backend/services/lending_service.py` — `https://apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2`.
- 인증: `KOFIA_API_KEY` (leverage_service와 동일 키). → `market_lending_balance` 테이블.

### KR 수출입 — 관세청 / UN Comtrade
- 코드: `backend/services/market_indicators/exports.py` — `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList`(관세청).
- 인증: `KITA_API_KEY`(실제 관세청 키). 미설정 시 UN Comtrade 공개 API 폴백(`https://comtradeapi.un.org/public/v1/preview/C/M/HS`, `exports.py:9`).

### 구루 보유종목 — Dataroma (스크래핑)
- 코드: `backend/services/guru_scraper.py` — `https://www.dataroma.com/m`(managers/holdings HTML 파싱) + Naver US 보강(`api.stock.naver.com/stock`).
- 자격증명 불필요(`_HEADERS`).

### 알림 — Telegram Bot API
- 코드: `backend/services/digest_service.py`, `backend/scheduler/jobs.py`, 라우터 `backend/routers/digest.py` — `https://api.telegram.org/bot{token}`.
- 인증: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. 다이제스트(08:00 KST) 발송용.

> 참고 URL(코드 내 상수/문서용, 능동 호출 아님): `finviz.com/quote.ashx`, `finance.naver.com/sise`, `en.wikipedia.org`(S&P 목록).

## 데이터 저장

**데이터베이스 (기본 저장소):**
- PostgreSQL 16 — Docker 컨테이너 `postgres:16-alpine` (`docker-compose.yml:5`).
- 접속: `DATABASE_URL` 환경변수 (`backend/services/db.py:26`). 풀: `psycopg2 ThreadedConnectionPool` minconn=1/maxconn=20.
- 스키마: `backend/auth_schema.sql`(users, refresh_tokens) → `backend/app_schema.sql`(앱 테이블) 순서. 컨테이너 init은 `docker-entrypoint-initdb.d`로 마운트(`docker-compose.yml:14-15`). 기동 시 추가 idempotent DDL은 `backend/main.py:54` `_migrate()` (backlog_history.segments, batch_schedules, market_short_sell, stock_disclosures, stock_dividends, stock_supply_score, stock_insider_trades, stock_recommendations 등).
- 볼륨: `pgdata` (`docker-compose.yml:52-53`).

**파일 캐시 (gitignored, 런타임 캐시 용도):**
- `backend/data/calendar/YYYY-MM.json` — 월별 캘린더 (`backend/routers/calendar.py`).
- `backend/data/consensus/` — per-ticker 컨센서스.
- `backend/snapshots/` — per-ticker/date 리포트 JSON (`backend/main.py:27`).
- `backend/reports/` — 레거시 리포트(read-only 폴백).
- 정적 참조 데이터: `backend/data/sp500_tickers.json`, `backend/data/kospi_tickers.json` 등.

**인메모리 캐시:**
- `backend/services/cache.py` — 6종(snapshot LRU 200, list TTL 5s, dashboard/correlation/sector/macro TTL 300s).

## 인증 & 신원 (Authentication & Identity)

**자체 인증:**
- 코드: `backend/services/auth_service.py`, `backend/routers/auth.py`.
- 방식: 이메일/비밀번호 — `bcrypt` 해싱, HS256 JWT(`python-jose`, `JWT_SECRET`). access 토큰 1h, refresh 30d(`auth_service.py:14-15`, `refresh_tokens` 테이블).

**OAuth 프로바이더:**
- Google — `https://accounts.google.com/o/oauth2/v2/auth` → 토큰 `https://oauth2.googleapis.com/token` (`backend/routers/auth.py:145,160`). 인증: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.
- GitHub — `https://github.com/login/oauth/authorize` → `https://github.com/login/oauth/access_token`, 프로필 `https://api.github.com/user` (`auth.py:191,203,212`). 인증: `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`.
- OAuth redirect 베이스: `FRONTEND_URL`. 임시 코드 교환(`_oauth_codes`, 120s TTL, `auth.py:24`). 사용자 매핑: `auth_service.upsert_oauth_user(email, provider, sub)`.

**역할/권한:**
- `users.role` (`user`|`admin`). admin 게이트는 `require_admin` (`backend/auth.py`).
- 메뉴별 권한: `user_menu_permissions` 테이블 + `default_menu_permissions`. 관리 `PUT /api/admin/users/:id/permissions`.

**외부 Cowork API 인증:**
- `COWORK_API_KEY` (`backend/auth.py`) — 외부 Claude Cowork 클라이언트가 enrich API 호출 시 사용. 명세 `CLAUDE_COWORK_API.md`.

## 모니터링 & 관측성

**에러 추적:** 외부 서비스 미연동. 도메인 에러는 `backend/services/errors.py`.

**로그:** Python `print`/표준 출력 기반(컨테이너 stdout). 외부 로그 수집 미연동.

**사용자 행동 분석:** 자체 구현 — `backend/middleware/event_tracker.py` + `backend/routers/events.py` → `user_events` 테이블. admin 집계 `GET /api/admin/analytics`.

**배치 실행 이력:** `backend/services/job_runs.py` → `job_runs` 테이블(ADR-0001).

## CI/CD & 배포

**호스팅:**
- Mac 로컬 Docker 4컨테이너 (`docker-compose.yml`: postgres/backend/nginx/certbot). 외부 노출은 Cloudflare Tunnel(`cloudflared`, launchd, compose 외부) → `portfolion.taebro.com` → localhost:80.
- nginx가 HTTP(80)/HTTPS(443) 서빙 + `/api/*` → backend:8000 프록시 (`nginx/nginx.conf`). 프론트는 `frontend/dist` `:ro` 마운트 직접 서빙.

**CI 파이프라인:**
- GitHub Actions self-hosted 러너 — `.github/workflows/deploy.yml` (`on: push: branches: [main]`, `runs-on: self-hosted`). `git reset --hard origin/main` 후 `bash deploy.sh`.
- 폴러 폴백 — `scripts/auto-deploy-poll.sh` (launchd `com.portfolion.auto-deploy-poll`, 2분 주기, `origin/main`이 로컬 HEAD보다 앞설 때만 실행).
- `deploy.sh` 단계: ① 프론트 빌드(`npm install && npm run build`) ② 백엔드 이미지 `docker build` ③ 백엔드 컨테이너 stop/rm/run ④ (동시 배포 방지 락 `/tmp/portfolion-deploy.lock`).

**HTTPS 인증서:**
- certbot 컨테이너(`certbot/certbot`) — 12h 주기 `certbot renew` (`docker-compose.yml:50`). 인증서는 `./certbot/conf` 볼륨, nginx가 `:ro` 마운트.

**DDNS:**
- `scripts/ddns_update.sh`.

## 환경 구성

**필수 env (`os.environ[...]`, 미설정 시 기동/요청 실패):**
- `DATABASE_URL`, `SESSION_SECRET`, `JWT_SECRET`, `FRONTEND_URL`, `GOOGLE_CLIENT_ID`/`SECRET`, `GITHUB_CLIENT_ID`/`SECRET`.

**선택 env (`os.environ.get`, 미설정 시 해당 연동 휴면/폴백):**
- `FRED_API_KEY`, `DART_API_KEY`, `KOFIA_API_KEY`, `KITA_API_KEY`, `KIWOOM_APP_KEY`/`SECRET_KEY`/`BASE_URL`, `KIS_APP_KEY`/`SECRET`/`BASE_URL`, `COWORK_API_KEY`, `TELEGRAM_BOT_TOKEN`/`CHAT_ID`, `ANTHROPIC_API_KEY`(미사용).

**시크릿 위치:**
- `backend/.env.docker` (컨테이너 `env_file`), 루트 `.env`(docker-compose 보간용). 템플릿 `backend/.env.docker.example`. 모두 gitignore 대상으로 다루며 값 인용 금지.

## 웹훅 & 콜백

**Incoming:**
- OAuth 콜백 — `GET /api/auth/oauth/google/callback`, `GET /api/auth/oauth/github/callback` (`backend/routers/auth.py:148,194`).
- 외부 Cowork enrich 콜인 — `CLAUDE_COWORK_API.md`의 enrich 엔드포인트(예: `PUT /api/report/{ticker}/...`), `COWORK_API_KEY` 인증.

**Outgoing:**
- Telegram 다이제스트 발송 (`backend/services/digest_service.py`).
- 외부 시세/공시/지표 API 폴링(배치 스케줄, `backend/scheduler/jobs.py`). 모두 풀(pull)이며 외부로의 능동 웹훅 통지 없음.

---

*Integration audit: 2026-06-27*

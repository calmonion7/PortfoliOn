---
last_mapped_commit: 27346baec719306d5c2be8f259cc448ca4f64f4a
mapped: 2026-06-13
---

# INTEGRATIONS

외부 API·데이터베이스·인증 공급자·스케줄 데이터 소스 목록과 각 연동의 서비스 파일 경로.

## 데이터베이스 — PostgreSQL 16

- **드라이버/풀**: `backend/services/db.py` — `psycopg2`의 `ThreadedConnectionPool`(minconn=1, maxconn=10). DSN은 `DATABASE_URL` 환경변수. `query()`(SELECT, RealDictCursor) / `execute()`(INSERT/UPDATE/DELETE) 헬퍼 제공.
- **스키마 초기화**: `docker-compose.yml`이 `backend/auth_schema.sql`(01-auth.sql) → `backend/app_schema.sql`(02-app.sql) 순으로 `docker-entrypoint-initdb.d`에 마운트. auth 스키마가 app보다 먼저 실행돼야 한다.
  - `backend/auth_schema.sql` — `users`, `refresh_tokens`.
  - `backend/app_schema.sql` — `tickers`, `snapshots`, `user_stocks`, `schedules`, `guru_managers`, `guru_schedules`, `batch_schedules`, `digests`, `consensus_history`, `calendar_cache`, `market_cache`, `user_menu_permissions`, `default_menu_permissions`, `raw_reports`, `daily_consensus_mart`, `user_events`, `market_leverage_indicators`, `market_lending_balance`, `backlog_history`, `market_rankings`, `market_investor_trend`, `job_runs`.
- **런타임 마이그레이션**: `backend/main.py`의 `_migrate()`가 기동 시 idempotent DDL 적용 — `backlog_history.segments JSONB`(ADD COLUMN IF NOT EXISTS), `batch_schedules`(CREATE TABLE IF NOT EXISTS). 추가로 `backend/scheduler.py`의 `_seed_batch_schedules`가 편집 가능 배치의 스케줄 행을 시드.
- **인메모리 캐시**(DB 아님): `backend/services/cache.py` — snapshot/list/dashboard/correlation/sector/macro 6종.

## yfinance (시세·재무·애널리스트)

- US/글로벌 시세·재무·정보 수집. 핵심: `backend/services/market.py`(`_yf_sym` 심볼 변환 등), `backend/services/report_generator.py`(리포트 생성 시 `yfinance` history/info 조회), `backend/services/consensus_pipeline.py`(US 컨센서스 — `Ticker.upgrades_downgrades` / `analyst_price_targets`), `backend/services/indicators.py`, `backend/services/ranking_service.py`(US 랭킹), `backend/routers/calendar.py`(어닝 캘린더, ThreadPoolExecutor 병렬). 시장지표 incremental fetch는 `backend/services/market_indicators/`(`fx.py`, `commodities.py`, `earnings.py`)의 `_yf_close_history`/`_merge_history`.

## Naver Finance API (KR 시세·재무·뉴스·리서치)

- 인증 키 없는 모바일/오픈 API. KR 종목의 시세·재무·컨센서스·뉴스·구루 한글명에 사용.
  - `backend/services/market.py` — `https://m.stock.naver.com/api/stock/{ticker}/...`(basic, finance/quarter, finance/annual)로 KR 시세·재무.
  - `backend/services/scraper.py` — `https://m.stock.naver.com/api/news/stock/{ticker}` 뉴스, `n.news.naver.com` 기사 본문.
  - `backend/services/consensus_pipeline.py` — KR 컨센서스 fallback으로 `https://m.stock.naver.com/api/research/stock/{ticker}` 리서치(FnGuide 우선, Naver Research fallback).
  - `backend/services/guru_scraper.py` — `https://api.stock.naver.com/stock/{code}/basic`로 US 종목 한글명 보강.
  - `backend/services/investor_service.py`, `backend/services/ranking_service.py`도 Naver 소스를 사용.

## 키움 REST API (KR 읽기전용 시세 소스)

- 오너 개인계좌 자격증명(서버측 단일 키)으로 KR 시세 조회. **KR 전용·읽기전용** 경계(ADR-0009). `backend/services/kiwoom/client.py` — `KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`/`KIWOOM_BASE_URL`(`.env.docker`)로 au10001 토큰 발급(인프로세스 싱글톤, 401 재발급 재시도) + `request(api_id, body, category)`(`POST {base}/api/dostk/{category}`, 헤더 `api-id`/`authorization Bearer`, return_code≠0→예외, 직렬 throttle). `kiwoom/quote.py` ka10001(주식기본정보) 조회·정규화(부호포함 문자열·시총 억원→원). `market.get_quote_kr`이 **키움 우선 + Naver 폴백**으로 KR 현재가를 받는다(`get_quotes_batch` KR도 이 함수 경유). 전체 TR 카탈로그·대체 로드맵: 루트 `KIWOOM_API.md`. 계좌·주문 TR·실시간 WebSocket(0B/0D)·KR 차트/수급/랭킹 대체는 후속 Phase(미착수).

## FnGuide (KR 컨센서스 1차 소스)

- KR 컨센서스 원천(Naver Research fallback의 우선 소스). `backend/services/consensus_pipeline.py` — `https://comp.fnguide.com/SVO2/json/data/01_06/03_A{ticker}.json`.

## Dataroma (구루 보유 종목)

- 구루(슈퍼투자자) 운용역·보유 종목 크롤. `backend/services/guru_scraper.py` — `https://www.dataroma.com/m`. 스케줄 잡 `guru_crawl`(`backend/scheduler.py`)이 주기 수집해 `guru_managers` 테이블에 저장.

## FRED API (미 경제지표)

- St. Louis Fed FRED API로 경제지표 시계열. `backend/services/market_indicators/econ.py` — `https://api.stlouisfed.org/fred/series/observations`. 키 `FRED_API_KEY`(미설정 시 에러 반환). 스케줄 잡 `monthly_refresh`(`backend/scheduler.py`)로 갱신, `market_cache`에 영구 저장.

## KOFIA / 공공데이터포털 (신용잔고·반대매매·시총)

- 금융투자협회 통계 공공데이터 API로 KR 신용잔고·반대매매·시가총액. `backend/services/leverage_service.py` — `https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService`(`getGrantingOfCreditBalanceInfo` 등) + `.../GetMarketIndexInfoService`. 키 `KOFIA_API_KEY`(미설정 시 요청 실패). 스케줄 잡 `leverage_fetch` → `market_leverage_indicators` 테이블.

## 금융위원회 공공데이터 API (내외국인 대차잔고)

- 대차거래 잔고. `backend/services/lending_service.py` — `https://apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2`. 키 `KOFIA_API_KEY` 공유(leverage_service와 동일 키). 스케줄 잡 `lending_fetch` → `market_lending_balance` 테이블. 엔드포인트 `GET /api/market-indicators/lending`, `POST /api/market-indicators/lending/sync`(admin).

## 관세청(KITA) / UN Comtrade (KR 수출)

- KR 수출 통계. `backend/services/market_indicators/exports.py` — 1차: 관세청 `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList`(키 `KITA_API_KEY`, 실제로는 관세청 키). 키 미설정/실패 시 UN Comtrade 공개 API `https://comtradeapi.un.org/public/v1/preview/C/M/HS`로 자동 폴백. 스케줄 잡 `monthly_refresh`로 갱신, `market_cache`에 저장.

## DART OpenAPI (수주잔고)

- 금융감독원 전자공시(DART) OpenAPI로 KR 종목 수주잔고 원문 수집. `backend/services/backlog.py` — base `https://opendart.fss.or.kr/api`, `corpCode.xml`(기업 고유번호), `list.json`(공시 목록), `document.xml`(공시서류원본 ZIP, 멤버 디코드·결합). 키 `DART_API_KEY`. 자동 추출+검산 성공 시 `source='dart'`, 실패 시 `source='pending'`으로 두고 Cowork가 채움. 스케줄 잡 `backlog_fetch`(주간) + 수동 `POST /api/report/backlog/refresh-all`(admin). `backlog_history` 테이블. (근거: `.forge/adr/`의 ADR-0002/0003/0005/0006.)

## 인증 공급자 — Google / GitHub OAuth + 로컬 JWT

- `backend/routers/auth.py` — OAuth 토큰 교환을 `httpx`로 직접 구현(authlib의 자동 흐름이 아님). HMAC 서명 state(`SESSION_SECRET`)로 CSRF 방지, 임시 코드로 토큰 교환.
  - **Google**: authorize `https://accounts.google.com/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token`. 키 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. redirect_uri = `FRONTEND_URL` + `/api/auth/oauth/google/callback`.
  - **GitHub**: authorize `https://github.com/login/oauth/authorize`, token `https://github.com/login/oauth/access_token`, 프로필 `https://api.github.com/user` + `/user/emails`. 키 `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.
  - OAuth 사용자 upsert: `backend/services/auth_service.py`의 `upsert_oauth_user`.
- **로컬 JWT/비밀번호**: `backend/services/auth_service.py` — `python-jose`(HS256, 키 `JWT_SECRET`) access 토큰(1h)·refresh 토큰(30d, `refresh_tokens` 테이블), `bcrypt` 비밀번호 해싱. 신규 사용자에 `default_menu_permissions` 적용.
- **Cowork API 키 인증**: `backend/auth.py` — `X-API-Key` 헤더가 `COWORK_API_KEY`와 일치하면 인증 통과(`get_current_user_or_api_key`, `require_admin_or_api_key`). 외부 Claude Cowork가 종목 분석·수주잔고 수치를 쓰는 경로(`PUT /api/stocks/{ticker}/enrich`, `PUT /api/stocks/enrich/batch`, `PUT /api/report/{ticker}/backlog` 등)에 사용. 명세: `CLAUDE_COWORK_API.md`.

## Anthropic API (리포트 생성)

- 환경변수 `ANTHROPIC_API_KEY`가 `backend/.env.docker`에 정의돼 있고 `CLAUDE.md`는 "리포트 생성에 필요"하다고 기술한다. 다만 현재 백엔드 Python 코드(`backend/services/report_generator.py` 포함)에는 Anthropic/Claude SDK 직접 호출이 검색되지 않는다 — 리포트 본문 생성은 yfinance/Naver/스크래퍼 데이터 조립(`backend/services/report_generator.py`)으로 이뤄지고, AI 분석 텍스트(`raw_reports`)·enrich 필드는 외부 Claude Cowork가 Cowork API 키로 쓰는 구조다. (즉 LLM 호출은 코드 인프로세스가 아니라 외부 Cowork 클라이언트 측에 있다.)

## Telegram (다이제스트 발송)

- 일일 다이제스트를 텔레그램으로 전송. `backend/services/digest_service.py`의 `send_telegram` — `https://api.telegram.org/bot{token}/sendMessage`. 환경변수 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`(`os.getenv`, 미설정 시 전송 스킵; `.env.docker`에는 미포함). 스케줄 잡 `daily_digest`(`backend/scheduler.py`)가 `generate` 후 호출.

## Cloudflare Tunnel (외부 노출)

- `portfolion.taebro.com → localhost:80`을 cloudflared Tunnel로 노출(launchd 자동실행, `docker-compose.yml`엔 미포함 — `CLAUDE.md`/`README.md`). DNS A 레코드 DDNS 갱신은 `scripts/ddns_update.sh`(Cloudflare API `https://api.cloudflare.com/client/v4/zones/...`, 환경변수 `CF_ZONE_ID`/`CF_RECORD_ID`/`CF_API_TOKEN`, cron 5분). 들어온 트래픽은 nginx(`nginx/nginx.conf`)가 정적 프론트(`frontend/dist`) 서빙 + `/api/`·`/health` → `backend:8000` 프록시.

## TLS 인증서 — certbot / Let's Encrypt

- `docker-compose.yml`의 `certbot` 서비스가 12시간마다 `certbot renew` 실행. nginx가 `/.well-known/acme-challenge/`(`./certbot/www`) 및 인증서(`./certbot/conf` → `/etc/letsencrypt`)를 `:ro` 마운트(`nginx/nginx.conf`, `docker-compose.yml`).

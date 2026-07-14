---
last_mapped_commit: 8e37e2ca03c09e76a31dd227d4c252f19246a11a
mapped: 2026-07-14
---

# INTEGRATIONS

PortfoliOn의 외부 API·데이터베이스·인증 연동 지도. 각 연동을 게이트하는 env 키 이름을 함께 표기(값은 미기재).

## Database — PostgreSQL 16

- **접속 계층**: `backend/services/db.py` — `psycopg2` `ThreadedConnectionPool`(maxconn 20), DSN은 `DATABASE_URL`. `query`/`execute`/`execute_many` 헬퍼.
- **스키마 파일**: `backend/auth_schema.sql`(먼저 실행) → `backend/app_schema.sql`. compose가 초기화 시 `01-auth.sql`/`02-app.sql`로 마운트.
- **기동 마이그레이션**: `backend/main.py:_migrate()`가 `lifespan`에서 idempotent DDL(`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`) 실행. 신규 컬럼/테이블은 `app_schema.sql`과 `_migrate` 양쪽에 추가해야 라이브 반영.
- **인증 스키마 테이블**(`auth_schema.sql`): `users`(id UUID, email, password_hash, oauth_provider, oauth_sub, role `user`|`admin`), `refresh_tokens`(user_id FK, token, expires_at). `pgcrypto` 확장(`gen_random_uuid`).
- **앱 스키마 테이블**(`app_schema.sql` + `_migrate`): `tickers`(종목 마스터, enriched_at·is_etf·key_resource 등), `snapshots`(ticker+date, jsonb), `user_stocks`(user+ticker, type holding|watchlist, target_price/stop_price/target_weight/pinned), `schedules`/`guru_managers`/`guru_schedules`(전역 단일 행), `batch_schedules`(job_id별), `digests`, `consensus_history`, `calendar_cache`, `market_cache`(key별 지표 캐시), `user_menu_permissions`/`default_menu_permissions`, `raw_reports`, `daily_consensus_mart`, `user_events`, `market_leverage_indicators`, `market_lending_balance`, `backlog_history`(segments JSONB), `market_rankings`, `market_investor_trend`, `market_short_sell`, `stock_disclosures`(meeting_date 포함), `stock_dividends`, `stock_dividend_schedule`, `stock_beta`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`(name/low_liquidity/exchange 컬럼), `us_supply_snapshot`, `job_runs`.
- **로컬 파일 캐시**(gitignore): `backend/data/consensus/`(per-ticker 컨센서스), `backend/snapshots/`(스냅샷 폴백), `backend/reports/`(레거시 read-only).

## Authentication

- **JWT**: `backend/services/auth_service.py` — `python-jose`로 HS256 서명(`JWT_SECRET`). Access token 만료 1시간, refresh token(`secrets.token_urlsafe(64)`) 30일. Refresh는 1회용(consume 시 DELETE 후 재발급, 탈취 재사용 차단). 비밀번호는 `bcrypt` 해시.
- **의존성 게이트**(`backend/auth.py`): `get_current_user`(Bearer JWT 필수), `get_current_user_or_api_key`(Bearer JWT **또는** `X-API-Key` 헤더 = `COWORK_API_KEY`), `require_admin`(role=admin), `require_admin_or_api_key`. API 키 인증 시 sentinel user_id `__api_key__`.
- **인증 라우터**(`backend/routers/auth.py`, prefix `/api/auth`): `/register`, `/login`, `/refresh`, `/logout`, `/me`(role=admin이면 전체 메뉴, 아니면 `user_menu_permissions`), OAuth 엔드포인트, `/oauth/token`(임시 code→토큰 교환, 인메모리 `_oauth_codes` 120초 만료).
- **세션 미들웨어**: `SessionMiddleware`(`SESSION_SECRET`). OAuth state는 `SESSION_SECRET` 기반 HMAC-SHA256 서명(`_make_state`/`_verify_state`).
- **메뉴 권한**: `ALL_MENUS = ["portfolio","research","market","analysis","guru","settings"]`. `user_menu_permissions`/`default_menu_permissions` 테이블, admin은 `PUT /api/admin/users/:id/permissions`로 관리. 프론트 `AuthContext`가 로그인 시 로드해 nav 필터링.
- **프론트 토큰 저장**: `localStorage`의 `access_token`/`refresh_token`. `frontend/src/api.js` axios 인터셉터가 첨부/401 처리.

### OAuth (Google, GitHub)

- **Google**(`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`): `/api/auth/oauth/google` → `accounts.google.com/o/oauth2/v2/auth`(scope `openid email profile`), 콜백에서 `oauth2.googleapis.com/token` 교환(`httpx`), id_token 페이로드를 base64 직접 디코딩(jose at_hash 검증 회피).
- **GitHub**(`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`): `/api/auth/oauth/github` → `github.com/login/oauth/authorize`(scope `user:email`), 콜백에서 access token 교환 후 `api.github.com/user`·`/user/emails`로 프로필/이메일 조회.
- 공통: `redirect_uri`는 `FRONTEND_URL` + 콜백 경로. 성공 시 `upsert_oauth_user` + `apply_default_permissions` → 토큰 발급 후 임시 code로 프론트 리다이렉트.

## Market data sources

### yfinance (US 1차 시세)

- `backend/services/market/` — `__init__.py`가 `import yfinance as yf`. `us.py`가 US 시세/재무/히스토리 소스. `get_quote`(US 분기)는 yfinance 우선, 예외/시세부재 시 KIS 백업(`_us_quote_kis`) 폴백. `get_history_df`는 그 외 마켓 yfinance. 게이트 env 없음(공개). yfinance 퍼센트 필드는 소수분수(0~1) 스케일.

### 키움 (Kiwoom, KR 1차 시세 — 읽기전용)

- `backend/services/kiwoom/` — `client.py`(토큰 발급 `POST /oauth2/token`, 인프로세스 싱글톤, `api-id` 헤더 TR 요청 `POST /api/dostk/{category}`, `return_code≠0`→예외, 직렬 throttle 0.25s, 401 재발급 재시도). `quote.py`(ka10001 현재가), `chart.py`(ka10081/82/83 일/주/월봉), `sector.py`(ka20006/ka20002 업종), `investor.py`, `shortsell.py`.
- **게이트**: `KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`(+ `KIWOOM_BASE_URL`, 기본 `https://api.kiwoom.com`). `configured()`가 두 키 존재 확인, 미설정 시 호출측이 폴백.
- **거래소 코드**: `integrated_code(stk_cd, regular=False)` — 기본 `_AL`(NXT 통합/SOR), `regular=True`면 평문 KRX 코드(리포트 스냅샷용).
- KR 시세 체인: `market.get_quote_kr` = 키움 → KIS → Naver.

### KIS (한국투자증권, KR+US 백업 시세 — 읽기전용)

- `backend/services/kis/` — `client.py`(토큰 발급 `POST /oauth2/tokenP`, `tr_id` 헤더 GET `/uapi/...`, `rt_cd≠"0"`→예외, throttle 0.05s, 발급 1분 1회 EGW00133 방어 60s 가드), `quote.py`(국내 `FHKST01010100`, 해외 `HHDFS00000300`/`HHDFS76240000`), `futures.py`(국내선물옵션 시세 `FHMIF10000000`/`FHKIF03020100`, output1/2/3 분할 응답).
- **게이트**: `KIS_APP_KEY`/`KIS_APP_SECRET`(+ `KIS_BASE_URL`, 기본 실전 `https://openapi.koreainvestment.com:9443`, 모의는 override). `configured()` 미설정 시 휴면(기존 체인만 동작 — 안전 기본값).

### Naver (KR 폴백 시세·리서치)

- `backend/services/market/kr.py`·`market/__init__.py`(`_kr_basic_naver`), `scraper.py`, `consensus_pipeline.py`, `guru_scraper.py`, `investor_service.py`, `ranking_service.py`, `report_generator.py`, `recommendation/universe.py`. 공개 API(`m.stock.naver.com/api/stock/{code}/...`) — 게이트 env 없음. KR 시세 체인 최종 폴백 + 컨센서스/구루/랭킹 데이터.

### DART (전자공시, KR 전용)

- 베이스 `https://opendart.fss.or.kr/api`. 사용처: `backend/services/disclosures.py`(공시 피드 list.json), `backlog.py`(수주잔고 document.xml), `agm.py`(주총 일정), `insider_trades.py`(내부자 거래), `dividends.py`(KR 배당 alotMatter.json), `market/kr.py`(재무제표 fnlttSinglAcnt/fnlttSinglAcntAll).
- **게이트**: `DART_API_KEY`. 미설정 시 해당 KR 기능 휴면, DART status 013(무데이터)은 graceful 빈 결과.

### FRED (미 연준 경제데이터)

- 사용처: `backend/services/market_indicators/econ.py`(경제지표), `macro.py`(매크로 신호 시계열 T10Y2Y/BAMLH0A0HYM2/M2SL/DFF).
- **게이트**: `FRED_API_KEY`. 미설정 시 수집 실패(저장값 무변경).

### KOFIA / 공공데이터포털 (금융투자협회·정부 오픈API)

- 사용처: `backend/services/leverage_service.py`(신용잔고·반대매매·시총 → `market_leverage_indicators`), `lending_service.py`(내외국인 대차잔고 `GetStocLendBorrInfoService_V2` → `market_lending_balance`).
- **게이트**: `KOFIA_API_KEY`(두 서비스 공용). 미설정 시 요청 실패.

### KITA / 관세청 (KR 수출)

- `backend/services/market_indicators/exports.py` — `KITA_API_KEY`는 실제로 **관세청(Korea Customs Service)** API 키(`apis.data.go.kr/1220000/Itemtrade`). 미설정 시 UN Comtrade 공개 API(`comtradeapi.un.org`)로 자동 폴백.
- **게이트**: `KITA_API_KEY`(선택 — 미설정이면 Comtrade 폴백).

### 기타 시장지표 (yfinance 기반, 게이트 env 없음)

- `backend/services/market_indicators/` — `fx.py`(FX/VIX), `commodities.py`(원자재/국채), `indices.py`(시장지수 레벨 + S&P500 Shiller CAPE는 `multpl.com` 크롤), `earnings.py`(M7/KR Top2), `sentiment.py`(CNN Fear&Greed 크롤), `kospi_futures.py`/`kospi_signal.py`(KIS 선물). 대부분 `market_cache` 테이블에 증분 저장.

## External consumer API (Cowork)

- 외부 Claude Cowork 클라이언트가 종목 분석 텍스트를 enrich API로 작성(`CLAUDE_COWORK_API.md`). `X-API-Key` = `COWORK_API_KEY`로 인증(`require_admin_or_api_key`). 백엔드에는 LLM/Anthropic 호출 없음(`ANTHROPIC_API_KEY`는 `.env.docker`에 잔존하나 미사용).

## Cloudflare Tunnel

- `portfolion.taebro.com` → `localhost:80`. `cloudflared`는 Docker compose 컨테이너가 아니라 launchd 서비스로 실행. HTTPS 인증서는 compose의 `certbot` 컨테이너가 갱신(nginx 443 블록은 현재 `nginx/nginx.conf`에서 주석 처리).

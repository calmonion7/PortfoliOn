---
last_mapped_commit: 44629f27cfb796dbd2120b7002a99e3d82f7c725
mapped: 2026-07-24
---

# INTEGRATIONS — 외부 API·DB·인증·연동

PortfoliOn의 외부 연동 실측 매핑. 엔드포인트 세부 스키마는 `API_SPEC.md`(전체 REST)·`CLAUDE_COWORK_API.md`(외부 Cowork)를 참조. 시크릿 값은 미기재(변수명만).

## 시세 소스 (주가·재무·배당)

- **yfinance (US 1차 시세·재무·배당·내부자)** — `backend/services/market/us.py`. 전체 US 티커·섹터/시총/히스토리·배치 1콜(`yf.download`). 캘린더(`backend/routers/calendar.py`)·기술지표(`backend/services/indicators.py`)도 사용. 키 불요.
- **키움 REST (KR 1차 시세)** — `backend/services/kiwoom/`. `client.py`: 베이스 `https://api.kiwoom.com`(`KIWOOM_BASE_URL` override), `/oauth2/token`으로 토큰 발급(인프로세스 싱글톤, 401 재발급), `request(api_id, body, category)` → `POST /api/dostk/{category}`(헤더 `api-id`/`authorization`). 인증: `KIWOOM_APP_KEY`·`KIWOOM_SECRET_KEY`. 모듈: `quote.py`(ka10001 현재가), `chart.py`(ka10081 일봉), `investor.py`(수급), `sector.py`(ka20006/ka20002 업종 모멘텀), `shortsell.py`. **읽기전용 TR만**(계좌·주문 미연동).
- **KIS 한국투자증권 (KR+US 백업 시세)** — `backend/services/kis/`. `client.py`: 베이스 `https://openapi.koreainvestment.com:9443`(`KIS_BASE_URL` override, 기본 실전), `/oauth2/tokenP` 토큰 발급(EGW00133 방어 60s 가드), `request(tr_id, path, params)` → `GET /uapi/...`(헤더 `tr_id`/`appkey`/`appsecret`/`custtype=P`, `rt_cd≠"0"`→예외). 인증: `KIS_APP_KEY`·`KIS_APP_SECRET`. 모듈: `quote.py`(국내 `FHKST01010100`·해외 `HHDFS00000300`/`HHDFS76240000`), `futures.py`(선물옵션 `FHMIF10000000`/`FHKIF03020100`, 응답 `output1/2/3` 분할). **키 미설정이 안전 기본값**(`configured()` False면 휴면).
  - KR 시세 체인: 키움 → KIS → Naver. US 시세 체인: yfinance → KIS.
- **Naver (KR 폴백·US 구루·리서치·뉴스)** — `backend/services/market/kr.py`(`m.stock.naver.com/api`·`api.stock.naver.com`·`finance.naver.com`·`ac.stock.naver.com`), 리서치/컨센서스(`consensus_pipeline.py`), 뉴스(`n.news.naver.com`), US 구루 종목명(`guru_scraper.py`의 `api.stock.naver.com`). 키 불요(공개 API).
- **FnGuide (KR 시총 폴백·컨센서스)** — `comp.fnguide.com` (`SVD_main.asp`·SVO2 JSON). `backend/services/market/kr.py`(`_fnguide_market_cap`), `consensus_pipeline.py`, `market/__init__.py`. 키 불요.
- **환율 폴백** — `open.er-api.com/v6/latest/USD`, `backend/services/market_indicators/fx.py`.

## 공시·재무·기업데이터 (DART)

- **DART (금융감독원 전자공시)** — `https://opendart.fss.or.kr/api` + 원문 `https://dart.fss.or.kr/dsaf001/main.do`. 인증 `DART_API_KEY`(KR 전용, 미설정 시 휴면).
  - `backend/services/disclosures.py` — 공시 피드(`list.json` 유형별 A·B·C·D 호출 → `stock_disclosures`).
  - `backend/services/backlog.py` — 수주잔고(`document.xml` ZIP 원문 파싱 → `backlog_history`).
  - `backend/services/dividends.py` — KR 배당(`alotMatter.json`).
  - `backend/services/agm.py` — 주총 일정(no-type `list.json` + `document.xml` 회의일 파싱 → `stock_disclosures.meeting_date`).
  - `backend/services/insider_trades.py` — 내부자 거래.
  - `backend/services/market/kr.py` — KR 연간 재무(`fnlttSinglAcntAll`, FCF·이자보상) + R&D 집약도(`get_rd_intensity_kr`).

## 거시·경제지표

- **FRED (St. Louis Fed)** — `https://api.stlouisfed.org/fred/series/observations`·`/releases/dates`. 인증 `FRED_API_KEY`. `backend/services/market_indicators/econ.py`(경제지표), `macro.py`(매크로 신호 4종: `T10Y2Y`·`BAMLH0A0HYM2`·`M2SL`·`DFF`). 캘린더 `econ` 이벤트(`/releases/dates`)도 사용.
- **KOFIA / 공공데이터포털** — `https://apis.data.go.kr`. 인증 `KOFIA_API_KEY`(leverage·lending 공용).
  - `backend/services/leverage_service.py` — 신용잔고·반대매매·시총(`GetKofiaStatisticsInfoService` + `GetMarketIndexInfoService`) → `market_leverage_indicators`.
  - `backend/services/lending_service.py` — 내외국인 대차잔고(`GetStocLendBorrInfoService_V2`) → `market_lending_balance`.
- **관세청 + UN Comtrade (KR 수출)** — `backend/services/market_indicators/exports.py`. 1차 관세청 `apis.data.go.kr/1220000/Itemtrade/getItemtradeList`(인증 `KITA_API_KEY` = 실제로는 관세청 키), 미설정 시 UN Comtrade `comtradeapi.un.org/public/v1/preview` 공개 API 폴백.
- **CNN Fear & Greed** — `https://production.dataviz.cnn.io/index/fearandgreed/graphdata`(`edition.cnn.com` Referer). `backend/services/market_indicators/sentiment.py`. VIX식 수동 폴백(실패 시 `_mc_load` 직전값). 키 불요.
- **multpl.com (S&P500 Shiller CAPE)** — `https://www.multpl.com/shiller-pe`(BeautifulSoup 크롤). `backend/services/market_indicators/indices.py`. FRED엔 CAPE 시리즈 없음. 키 불요.

## 구루·랭킹·기타 스크레이핑

- **Dataroma (구루 보유 종목)** — `https://www.dataroma.com/m`(`managers.php`·`holdings.php`). `backend/services/guru_scraper.py`, `recommendation/universe.py`, `batch_registry.py`. 키 불요.
- **Finviz** — `https://finviz.com/quote.ashx`. `backend/services/scraper.py`, `report_generator.py`. 키 불요.
- **Wikipedia (S&P500 목록)** — `en.wikipedia.org/wiki/List_of_S...`. 키 불요.

## 알림

- **Telegram (다이제스트 푸시)** — `https://api.telegram.org/bot`. 인증 `TELEGRAM_BOT_TOKEN`·`TELEGRAM_CHAT_ID`. `backend/services/digest_service.py`, `backend/scheduler/jobs.py`.

## 인증 (사용자 로그인 · OAuth)

- **로컬 계정**: `backend/services/auth_service.py` — `bcrypt` 패스워드 해시, JWT **HS256**(`jose.jwt`, 시크릿 `JWT_SECRET`). `refresh_tokens` 테이블로 리프레시.
- **Google OAuth**: `backend/routers/auth.py` — `accounts.google.com/o/oauth2/v2/auth`(authorize) → `oauth2.googleapis.com/token`(exchange). 인증 `GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET`. redirect `FRONTEND_URL + /api/auth/oauth/google/callback`.
- **GitHub OAuth**: `github.com/login/oauth/authorize`·`/access_token` + `api.github.com/user`·`/user/emails`. 인증 `GITHUB_CLIENT_ID`·`GITHUB_CLIENT_SECRET`.
- OAuth 콜백은 임시 코드(`_store_oauth_tokens`, 120s TTL)로 토큰 교환 후 프론트로 리다이렉트. `upsert_oauth_user(email, provider, sub)`가 `users`에 upsert.
- **세션**: `SessionMiddleware`(시크릿 `SESSION_SECRET`).
- **외부 Cowork API 키**: `COWORK_API_KEY` — `require_admin_or_api_key` 게이트(`backend/routers/stocks.py`·`report.py`, enrich/backlog 쓰기). 명세 `CLAUDE_COWORK_API.md`.
- ⚠️ `ANTHROPIC_API_KEY`는 `.env.docker`에 남아있으나 **백엔드 미사용**(백엔드에 LLM 호출 없음; AI 분석 텍스트는 외부 Cowork가 enrich API로 작성).

## 데이터베이스 (PostgreSQL 16)

- **드라이버/연결**: `psycopg2` `ThreadedConnectionPool`(maxconn 20), DSN = `DATABASE_URL`. `backend/services/db.py`.
- **스키마 실행 순서**: `backend/auth_schema.sql` → `backend/app_schema.sql`(docker init). 라이브 추가 컬럼/테이블은 `main.py:_migrate()`의 idempotent DDL.
- **테이블 목록** (schema 파일 + `_migrate` 기준):
  - 인증: `users`, `refresh_tokens`
  - 종목/포트폴리오: `tickers`, `user_stocks`, `snapshots`, `raw_reports`
  - 스케줄/배치: `schedules`, `guru_schedules`, `guru_managers`, `batch_schedules`, `job_runs`
  - 컨센서스/다이제스트: `consensus_history`, `daily_consensus_mart`, `digests`
  - 캘린더/공시: `calendar_cache`, `stock_disclosures`
  - 시장지표: `market_cache`, `market_leverage_indicators`, `market_lending_balance`, `market_rankings`, `market_investor_trend`, `market_short_sell`
  - 종목 부가데이터: `stock_dividends`, `stock_dividend_schedule`, `stock_beta`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`, `backlog_history`, `us_supply_snapshot`
  - 권한/이벤트: `user_menu_permissions`, `default_menu_permissions`, `user_events`
- **로컬 파일 캐시**(gitignored, 런타임): `backend/data/consensus/`(per-ticker), `backend/snapshots/`(per-ticker/date JSON). 정적 참조: `backend/data/sp500_tickers.json`·`kospi_tickers.json`.

## 참조 카탈로그 (루트 문서)

- `KIWOOM_API.md` — 키움 전체 API 카탈로그·대체 로드맵.
- `KIS_API.md` — KIS 전체 카탈로그.
- `API_SPEC.md` — 전체 REST 엔드포인트(source of truth).
- `CLAUDE_COWORK_API.md` — 외부 Cowork enrich/backlog API.

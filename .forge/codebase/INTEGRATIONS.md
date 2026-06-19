---
last_mapped_commit: 163c29cbd89d9b1d2aa5a101670e9fa34ceb21c4
mapped: 2026-06-19
---

# INTEGRATIONS — 외부 API / DB / 인증 / 데이터 소스

PortfoliOn이 의존하는 외부 통합의 구현 팩트. (모든 시크릿은 환경변수 이름으로만 표기.)

## 1. 데이터베이스

- **PostgreSQL 16** (Docker `postgres:16-alpine`, 볼륨 `pgdata`). 접속: `services/db.py`가 `psycopg2` `ThreadedConnectionPool`(maxconn=20), DSN은 `DATABASE_URL`.
- 스키마 적용 순서: `backend/auth_schema.sql`(컨테이너 init `01-auth.sql`) → `backend/app_schema.sql`(`02-app.sql`).
- **인증 스키마** (`auth_schema.sql`): `users`, `refresh_tokens`.
- **앱 스키마** (`app_schema.sql`): `tickers`, `snapshots`, `user_stocks`, `schedules`, `guru_managers`, `guru_schedules`, `batch_schedules`, `digests`, `consensus_history`, `calendar_cache`, `market_cache`, `user_menu_permissions`, `default_menu_permissions`, `raw_reports`, `daily_consensus_mart`, `user_events`, `market_leverage_indicators`, `market_lending_balance`, `backlog_history`, `market_rankings`, `market_investor_trend`, `market_short_sell`, `stock_disclosures`, `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`, `job_runs`.
- 기동 시 `main.py._migrate()`가 idempotent DDL로 보강하는 테이블: `backlog_history.segments`(컬럼), `batch_schedules`, `market_short_sell`, `stock_disclosures`, `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`(+ `low_liquidity`/`exchange` 컬럼).
- **로컬 파일 캐시** (gitignored, DB 아님): `backend/data/consensus/`(per-ticker), `backend/data/calendar/YYYY-MM.json`(월별), `backend/snapshots/`, `backend/reports/`(레거시 read-only).

## 2. 인증 (Auth)

- **JWT (HS256)**: `python-jose` `jose.jwt`. 검증은 `backend/auth.py` (`get_current_user` 등), 발급은 `services/auth_service.py` (`jwt.encode(..., algorithm="HS256")`). 시크릿 env `JWT_SECRET`.
- **비밀번호**: `bcrypt` (`auth_service.py` `hashpw`/`checkpw`).
- **세션**: starlette `SessionMiddleware`, `SESSION_SECRET`.
- **Google OAuth** (`backend/routers/auth.py`): authorize `https://accounts.google.com/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token`. env `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. redirect_uri = `FRONTEND_URL + /api/auth/oauth/google/callback`.
- **GitHub OAuth** (`backend/routers/auth.py`): authorize `https://github.com/login/oauth/authorize`, token `https://github.com/login/oauth/access_token`, profile `https://api.github.com/user`, emails `https://api.github.com/user/emails`. env `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`.
- OAuth 콜백 후 임시 코드(`_oauth_codes`, 120s TTL)로 토큰 교환. `httpx` 사용.
- **API Key 인증** (외부 Cowork): 헤더 `X-API-Key`, env `COWORK_API_KEY`. `get_current_user_or_api_key`/`require_admin_or_api_key` (`backend/auth.py`). 명세: `CLAUDE_COWORK_API.md`.
- **역할(role)**: `users.role` (`user`|`admin`). `require_admin`이 admin 전용 엔드포인트 게이팅.

## 3. 시세 / 시장 데이터 소스

### yfinance (US 1차 + 일부 KR 보조)
- `backend/services/market.py` (`import yfinance as yf`) — US 시세/섹터/시총/히스토리 1차 소스, US 실패 시 KIS 백업으로 폴백.
- `services/ranking_service.py` — `yfinance` most_actives 스크린(US 랭킹).
- `services/consensus_pipeline.py` — US 컨센서스(`yfinance` `t.upgrades_downgrades`).
- `services/market_indicators/cache.py`, `earnings.py` — FX/VIX/원자재/국채/실적 yfinance incremental fetch.

### Naver (KR 시세/리서치/수급/랭킹)
- `services/market.py`: 시세 `https://m.stock.naver.com/api/stock/{ticker}/...`, 재무 `https://comp.fnguide.com/...`(FnGuide).
- `services/ranking_service.py`: `https://m.stock.naver.com/api/stocks/marketValue` (KOSPI/KOSDAQ 시총 페이지네이션).
- `services/investor_service.py`: 수급 추이 Naver 폴백 (`_fetch_trend_naver`).
- `services/consensus_pipeline.py`: KR 컨센서스 `https://m.stock.naver.com/api/research/stock/{ticker}` + FnGuide `https://comp.fnguide.com/SVO2/json/...`.
- `services/guru_scraper.py`: US 종목명 보조 `https://api.stock.naver.com/stock`.

### 키움증권 REST API (KR 1차, 읽기전용)
- `backend/services/kiwoom/` (client/quote/chart/sector/investor/shortsell). base `https://api.kiwoom.com` (env `KIWOOM_BASE_URL` override 가능). env `KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`.
- 토큰 인프로세스 싱글톤(12h 캐시, 401 재발급 재시도), 직렬 throttle(min 0.25s). 미설정 시 휴면(`configured()` False → 호출측 폴백).
- 용도: KR 현재가(ka10001), 업종 모멘텀(ka20006/ka20002), 수급, 공매도, 차트. **읽기전용 — 계좌/주문 미연동** (경계 `.forge/adr/0009`). 카탈로그: 루트 `KIWOOM_API.md`.
- `market.get_quote_kr` 체인: **키움 → KIS → Naver**.

### 한국투자증권(KIS) REST API (KR/US 백업, 읽기전용)
- `backend/services/kis/` (client/quote). base `https://openapi.koreainvestment.com:9443` (env `KIS_BASE_URL` override). 토큰 `/oauth2/tokenP`. env `KIS_APP_KEY`/`KIS_APP_SECRET`.
- 토큰 싱글톤(23h 캐시), 발급 1분 1회 제한(EGW00133) 방어 60s 가드, 직렬 throttle(0.05s). 미설정 시 휴면(키 없으면 기존 동작 무변화).
- 용도: KR 현재가(`FHKST01010100`), US 가격(`HHDFS00000300`+`HHDFS76240000`, EXCD NAS→NYS→AMS probe). KR 2차 폴백, US는 yfinance→KIS 폴백. **읽기전용** (경계 `.forge/adr/0011`). 카탈로그: 루트 `KIS_API.md`.

## 4. 공시 / 재무 데이터 소스 (DART)

- **DART (전자공시, opendart.fss.or.kr)** — base `https://opendart.fss.or.kr/api`, 인증 파라미터 `crtfc_key`, env `DART_API_KEY` 필수. KR 전용. status 013(무데이터) graceful.
  - `services/backlog.py` — 수주잔고. `list.json`(보고서 rcept_no) → `document.xml`(ZIP 원문) 파싱. corp_code 매핑 `_get_corp_code_map`.
  - `services/disclosures.py` — 공시 피드. `list.json`을 핵심유형 A/B/C/D **각각** 호출(응답에 `pblntf_ty` 미echo → 질의값 stamp). 뷰어 URL `https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}`. → `stock_disclosures`.
  - `services/dividends.py` — KR 배당. `alotMatter.json`(사업보고서 reprt_code=11011, 주당 현금배당금·시가배당률). US 배당은 yfinance `t.info`. → `stock_dividends`.
  - **`services/insider_trades.py` (신규)** — 내부자/5% 지분공시. `elestock.json`(임원·주요주주 소유상황 → `insider`) + `majorstock.json`(5%룰 대량보유 → `major5`) 각각 호출. corp_code 매핑은 `backlog._get_corp_code_map` 재사용. 뷰어 URL 동일. row_hash dedup upsert → `stock_insider_trades`. S3 순매수 신호는 저장값 SQL 집계(요청경로 라이브 DART 0). KR 전용·`DART_API_KEY` 필수.

## 5. 경제 / 거시 / 통계 데이터 소스

- **FRED (St. Louis Fed)** — `https://api.stlouisfed.org/fred/series/observations`. env `FRED_API_KEY` 필수(미설정 시 수집 실패).
  - `services/market_indicators/econ.py` — 경제지표.
  - `services/market_indicators/macro.py` — 매크로 신호(T10Y2Y/BAMLH0A0HYM2/M2SL/DFF).
- **KOFIA / 공공데이터포털 (apis.data.go.kr/1160100)** — env `KOFIA_API_KEY` (leverage/lending 공용).
  - `services/leverage_service.py` — 신용잔고/반대매매/시총. `GetKofiaStatisticsInfoService`, `GetMarketIndexInfoService`. → `market_leverage_indicators`.
  - `services/lending_service.py` — 내외국인 대차잔고. `https://apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2`. → `market_lending_balance`.
- **관세청(Korea Customs Service) / UN Comtrade** — KR 수출. `services/market_indicators/exports.py`.
  - 1차: 관세청 `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList`, env `KITA_API_KEY` (실제로는 관세청 키). 키 미설정/실패 시 폴백.
  - 폴백: UN Comtrade 공개 API `https://comtradeapi.un.org/public/v1/preview/C/M/HS`.

## 6. 기타 외부 스크래핑 소스

- **dataroma** — `services/guru_scraper.py`. base `https://www.dataroma.com/m` (managers.php / holdings.php). US 구루 보유 종목 크롤. → `guru_managers`.
- **FnGuide** — `https://comp.fnguide.com/...`. `services/market.py`·`consensus_pipeline.py`에서 KR 재무/컨센서스 보조.

## 7. 추천(발굴) 서브시스템 데이터 소스 (신규)

`backend/services/recommendation/` (`.forge/adr/0015`). 백엔드 LLM 호출 0 — 정량만. 외부 fetch는 **배치 경로에서만**(요청/기동 경로 라이브 호출 금지).
- `universe.py` — 유니버스 빌드: ① KR 시총 상위 N(`ranking_service` Naver 스냅샷 `_fetch_naver_market` KOSPI/KOSDAQ), ② US S&P500(`backend/data/sp500_tickers.json` 정적), ③ 전 유저 추적종목(`storage.get_global_portfolio`, DB `user_stocks`), ④ US 구루 보유(`storage.get_guru_managers` → dataroma 캐시). 합집합·dedup·ETF 제외.
- `funnel.py` — 후보 한정 후 OHLC 히스토리(`market.get_history_df`: KR 키움→yfinance 폴백), 컨센서스(`services.consensus`), 수급(`services.investor_service`), 내부자(`services.insider_trades`) 신호 수집. RSI는 `services.indicators.calc_rsi`.
- `scoring.py` — 밸류/모멘텀/스마트머니 가중 합성(순수 함수, DB·네트워크 무의존). 색 매핑은 프론트.
- `store.py` — `stock_recommendations` 테이블 read/write(`replace_recommendations`).
- 즉, 추천 서브시스템은 **신규 외부 소스를 추가하지 않고** 기존 통합(Naver 랭킹, yfinance/키움 히스토리, DART 내부자, Naver 수급, dataroma 구루, 정적 S&P500 파일)을 재사용한다.

## 8. 외부에 노출하는 API (제공 측)

- 본 백엔드가 외부 Claude Cowork 클라이언트에 enrich/read API 제공 — 인증은 `X-API-Key`(`COWORK_API_KEY`). 명세 `CLAUDE_COWORK_API.md`, 전체 REST 레퍼런스 `API_SPEC.md`.

## 9. 비고

- **백엔드에 LLM/Anthropic SDK 연동 없음** — `requirements.txt`에 anthropic 부재. `ANTHROPIC_API_KEY`는 `.env.docker`에 남아있으나 미사용. AI 분석 텍스트는 외부 Cowork가 enrich API로 작성.
- 레거시 Supabase 키(`backend/.env`의 `SUPABASE_*`)는 Docker 전환으로 사실상 미사용(런타임 DB는 Docker PostgreSQL).

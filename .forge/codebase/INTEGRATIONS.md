---
last_mapped_commit: f835958b49b4a4d7ce30254fd610ed6362462311
mapped: 2026-06-22
---

# INTEGRATIONS

PortfoliOn이 연동하는 외부 시스템(시세·재무·공시·거시지표 데이터 소스, DB, 인증, 터널)과 그 배선 위치.

## 시세 소스 (Quote / Price)

### yfinance (US 1차, KR 보조)
- `backend/services/market/__init__.py` — 시세 진입점. `_get_quote_uncached`가 US는 `yf.Ticker(...).info`/`.history`, 배치는 `yf.download`(`get_quotes_batch`, US 1콜 raw 일봉)로 처리. `get_history_df`도 비-KR은 yfinance.
- `backend/services/market/us.py` — US 연간 재무(`get_income_stmt`/`get_balance_sheet`/`earnings_estimate`/`revenue_estimate`).
- `backend/services/market/kr.py` — KR sector/industry/시총 보조(키움에 해당 TR 없음), 키움 일봉 실패 시 변동률 폴백.
- 그 외: `backend/services/dividends.py`(US 배당 `t.info` dividendRate/dividendYield), `backend/services/analysis_service.py`(섹터 ETF·매크로 티커 상관), `backend/services/market_indicators/`(fx·commodities·earnings 등 yfinance incremental fetch).
- 제공: US 종목 가격/전일종가/변동률/시총/섹터/히스토리, 분석용 ETF·매크로 자산 시계열.

### Naver 모바일 주식 API (KR 폴백)
- `backend/services/market/kr.py` — `_NAVER_BASE = "https://m.stock.naver.com/api/stock"`, `_kr_basic_naver`(현재가 `/basic`), `get_financials_kr`/`get_annual_financials_kr`(`/finance/quarter`·`/finance/annual`).
- 키움→KIS 실패 시 최종 KR 현재가 폴백이자 분기/연간 재무 소스. 상폐 종목은 409로 검출. 인증 없는 공개 API(브라우저 User-Agent 헤더 사용).

### 키움(Kiwoom) REST API (KR 1차)
- `backend/services/kiwoom/client.py` — `KIWOOM_BASE_URL`(기본 `https://api.kiwoom.com`)·`KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`로 `/oauth2/token` 토큰 발급(인프로세스 싱글톤, 직렬 throttle 0.25s, 401 재발급 재시도). `request(api_id, body, category)` → `POST /api/dostk/{category}`. `integrated_code(stk_cd, regular)`: 기본 `_AL`(NXT 통합코드), `regular=True`면 평문 KRX 코드(정규장).
- TR 매핑: `quote.py`(ka10001 주식기본정보), `chart.py`(ka10081 일봉/ka10082 주봉/ka10083 월봉), `investor.py`(ka10059 투자자별 순매수 + ka10008 외국인 보유율), `sector.py`(ka20006 업종일봉 + ka20002 업종별주가, KRX 업종 모멘텀), `shortsell.py`(ka10014 공매도추이).
- 읽기전용 시세 소스 전용(계좌·주문 미연동). 경계: `.forge/adr/0009`. 전체 카탈로그: `KIWOOM_API.md`.
- 제공: KR 현재가/시총/일·주·월봉/투자자 수급/외국인 보유율/업종 모멘텀/공매도 추이.

### KIS 한국투자증권 REST API (KR·US 백업)
- `backend/services/kis/client.py` — `KIS_APP_KEY`/`KIS_APP_SECRET`/`KIS_BASE_URL`(기본 실전 `https://openapi.koreainvestment.com:9443`)로 `/oauth2/tokenP` 토큰 발급(싱글톤, throttle 0.05s, EGW00133 발급 1분 제한 방어 60s 가드, 401 재시도). `request(tr_id, path, params)` → GET `/uapi/...`, 헤더 `tr_id`/`appkey`/`appsecret`/`custtype=P`.
- `backend/services/kis/quote.py` — 국내 현재가 `FHKST01010100`, 해외(US) 현재가 `HHDFS00000300`+일봉 `HHDFS76240000`(EXCD NAS→NYS→AMS probe).
- 폴백 위치: KR `backend/services/market/kr.py`(`_kr_basic_kis`, 키움 다음·Naver 앞), US `backend/services/market/us.py`(`_us_quote_kis`, yfinance 다음).
- **키 미설정이 안전 기본값**(`client.configured()` False면 휴면). 읽기전용 시세 전용. 경계: `.forge/adr/0011`. 전체 카탈로그: `KIS_API.md`.
- 제공: KR/US 백업 현재가/전일종가/일간변동률(KR은 시총 추가, US는 가격만·15분 지연).

### FnGuide (KR 보조)
- `backend/services/market/kr.py` — `_fnguide_market_cap`(`comp.fnguide.com/SVO2/asp/SVD_main.asp`, HTML 정규식으로 시가총액), `get_analyst_data_kr`(`comp.fnguide.com/SVO2/json/data/01_06/03_A{ticker}.json`, 목표가·투자의견 buy/hold/sell). 인증 없는 공개 페이지(Referer 헤더).
- 제공: KR 시총 보강, KR 애널리스트 목표가/컨센서스.

## 공시·재무 (DART)

DART OpenAPI: 베이스 `https://opendart.fss.or.kr/api`, 인증 `DART_API_KEY`. KR 전용.

- `backend/services/backlog.py` — 수주잔고. corpCode.xml(`{stock_code: corp_code}` 매핑, 1주 메모리 캐시)→list.json(보고서 rcept_no)→document.xml(ZIP 원문). 파싱은 `backend/services/backlog_parser.py`. corp_code 매핑(`_get_corp_code_map`)을 disclosures·dividends가 재사용.
- `backend/services/disclosures.py` — 공시 피드. list.json을 핵심 유형 A·B·C·D 각각 호출(응답에 `pblntf_ty` 미echo)해 `stock_disclosures` 테이블에 rcept_no dedup upsert. 뷰어 URL `dart.fss.or.kr/dsaf001/main.do?rcpNo=`.
- `backend/services/dividends.py` — KR 배당. alotMatter.json(사업보고서 `reprt_code=11011`)의 '주당 현금배당금'·'현금배당수익률' 보통주 당기값.
- `backend/services/insider_trades.py` — 내부자·5% 지분 보고(DART, 뷰어 URL 동일).
- 제공: 수주잔고 원문/공시 목록/연간 배당/내부자·지분 변동.

## 거시·시장 지표

### FRED (St. Louis Fed)
- 베이스 `https://api.stlouisfed.org/fred/series/observations`, 인증 `FRED_API_KEY`.
- `backend/services/market_indicators/econ.py` — CPI(`CPIAUCSL`)·실업률(`UNRATE`).
- `backend/services/market_indicators/macro.py` — 4종 매크로 신호 시계열: 금리차(`T10Y2Y`)·HY OAS(`BAMLH0A0HYM2`)·M2(`M2SL`)·기준금리(`DFF`), `evaluate_signals`로 역전/신용스트레스 판정. `GET /api/market/macro-signals`.
- 증분 fetch 후 `market_cache` 영구 저장. 키 미설정 시 수집 실패(저장값 무변경).
- 제공: 미국 경제지표·매크로 거시 신호.

### 관세청 / UN Comtrade (KR 수출)
- `backend/services/market_indicators/exports.py` — 1차 관세청(`apis.data.go.kr/1220000/Itemtrade/getItemtradeList`, 인증 `KITA_API_KEY` — 실제로는 관세청 키), 키 미설정/실패 시 UN Comtrade 공개 API(`comtradeapi.un.org/public/v1/preview/C/M/HS`) 폴백. 반도체(HS 8542) vs 비반도체 수출.
- 제공: 월별 KR 반도체/비반도체 수출액.

### KOFIA / 공공데이터포털 (수급지표)
인증 `KOFIA_API_KEY`(leverage·lending 공용).
- `backend/services/leverage_service.py` — `apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService`(신용잔고·반대매매)·`GetMarketIndexInfoService`(시총/지수) → `market_leverage_indicators` 테이블.
- `backend/services/lending_service.py` — `apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2`(내외국인 대차잔고) → `market_lending_balance` 테이블. `GET /api/market-indicators/lending`.
- 제공: KR 신용잔고/반대매매/시총, 내외국인 대차잔고.

### 시장 지표 캐시
- `backend/services/market_indicators/cache.py` — `_mc_load`/`_mc_save`로 PostgreSQL `market_cache` 테이블 읽기/쓰기(fx/vix/commodities/treasury/econ/m7/krtop2/krexports/macro_signals 등). 각 서브모듈이 `_merge_history`/`_yf_close_history`로 yfinance incremental fetch. 배치가 사전계산→요청은 저장값만 읽음.

## 인증 (Auth)

- `backend/services/auth_service.py` — 이메일/비밀번호(bcrypt) + JWT HS256(`JWT_SECRET`, access 1h/refresh 30d, `users`·`refresh_tokens` 테이블). `python-jose`로 인코딩/디코딩.
- `backend/routers/auth.py` — OAuth(직접 HTTP 플로우, 콜백 redirect_uri는 `FRONTEND_URL` 기반):
  - **Google**: `accounts.google.com/o/oauth2/v2/auth` → `oauth2.googleapis.com/token`(인증 `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`), id_token payload에서 email/sub 추출.
  - **GitHub**: `github.com/login/oauth/authorize` → `github.com/login/oauth/access_token` → `api.github.com/user`·`/user/emails`(인증 `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`).
  - `auth_service.upsert_oauth_user(email, provider, sub)`로 계정 연결/생성.
- 세션: `SessionMiddleware`(secret `SESSION_SECRET`, `backend/main.py`).
- admin 역할(`users.role`)은 리포트 생성·Guru 크롤·교차사용자 동작(`/api/admin/*`) 게이팅.

## 외부 쓰기 API (Cowork)

- `CLAUDE_COWORK_API.md` — 외부 Claude Cowork 클라이언트가 enrich API로 AI 분석 텍스트를 작성. 인증 `COWORK_API_KEY`. 백엔드 자체에는 LLM/Anthropic 호출 없음(`ANTHROPIC_API_KEY`는 `.env.docker`에 남아있으나 미사용).

## 데이터베이스 (PostgreSQL 16)

- `docker-compose.yml` `postgres` 서비스(`postgres:16-alpine`, 볼륨 `pgdata`, 포트 5432). 초기화 SQL: `backend/auth_schema.sql`(users·refresh_tokens) → `backend/app_schema.sql`(tickers·user_stocks·snapshots·schedules·guru_*·digests·consensus_history·calendar_cache·market_cache·user_menu_permissions·user_events·market_leverage_indicators·market_lending_balance 등).
- 접속: `backend/services/db.py` — `psycopg2 ThreadedConnectionPool`(minconn 1/maxconn 20), DSN은 `DATABASE_URL`. `get_connection`(context manager, 자동 commit/rollback)·`query`·`execute` 헬퍼.
- 로컬 파일 캐시(gitignored): `backend/data/consensus/`(per-ticker 컨센서스), `backend/data/calendar/`(월별 캘린더). 정적 참조 데이터만 git에: `backend/data/sp500_tickers.json`·`kospi_tickers.json`.

## 네트워크 / 터널

- **Cloudflare Tunnel** — `portfolion.taebro.com` → `localhost:80`. cloudflared는 docker compose 컨테이너가 아니라 launchd로 실행(`CLAUDE.md` 배포 절). HTTPS 종단은 터널이 담당(nginx 443 블록은 주석 처리).
- **Cloudflare DDNS** — `scripts/ddns_update.sh`, Cloudflare API(`api.cloudflare.com/client/v4/zones/.../dns_records`)로 A 레코드 갱신. 인증 `CF_ZONE_ID`/`CF_RECORD_ID`/`CF_API_TOKEN`(스크립트 env).
- **certbot** — `docker-compose.yml` `certbot/certbot` 컨테이너가 12시간마다 `certbot renew`(letsencrypt 인증서).
- 배포 절차/도메인 설정: `docs/ops/deploy.md`.

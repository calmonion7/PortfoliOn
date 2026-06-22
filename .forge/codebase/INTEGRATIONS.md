---
last_mapped_commit: b6193c3837f4125a41930c36a2b3ae2ef198dc3c
mapped: 2026-06-22
---

# INTEGRATIONS

PortfoliOn이 연동하는 외부 API·데이터베이스·인증 제공자와 각 연동의 코드 위치/제공 데이터.

## Database — PostgreSQL 16 (Docker)

- **연결**: `backend/services/db.py` — `psycopg2` `ThreadedConnectionPool`(minconn=1, maxconn=20), DSN은 `DATABASE_URL` env.
- **컨테이너**: `docker-compose.yml` `postgres` 서비스(`postgres:16-alpine`, DB `portfolion`, 포트 5432, `pgdata` 볼륨).
- **스키마 초기화**: `backend/auth_schema.sql`(01-auth) → `backend/app_schema.sql`(02-app) 순서로 `docker-entrypoint-initdb.d` 마운트.
- **저장소 추상화**: `backend/services/storage/` (앱 데이터), `backend/services/job_runs.py`(배치 실행 이력) 등이 `db.query`/`db.execute`로 접근. PostgreSQL이 기본 저장소이고 로컬 JSON 파일(`backend/data/consensus/`, `backend/data/calendar/`)은 런타임 캐시 용도.

## Auth Providers

### Google OAuth
- **위치**: `backend/routers/auth.py`.
- `GET /api/auth/oauth/google` → `https://accounts.google.com/o/oauth2/v2/auth` 리다이렉트 (scope `openid email profile`, state CSRF 가드).
- 콜백에서 `https://oauth2.googleapis.com/token`으로 코드 교환(`httpx.AsyncClient`), `id_token` JWT 페이로드를 base64 직접 디코딩(jose at_hash 검증 우회)해 email/sub 추출.
- env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

### GitHub OAuth
- **위치**: `backend/routers/auth.py`.
- `GET /api/auth/oauth/github` → `https://github.com/login/oauth/authorize` 리다이렉트 (scope `user:email`).
- 콜백에서 `https://github.com/login/oauth/access_token` 코드 교환 후 `https://api.github.com/user`·`/user/emails`로 프로필/이메일 조회. primary+verified 이메일 선택.
- env: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.

### 자체 인증 (JWT)
- **위치**: `backend/services/auth_service.py`.
- HS256 JWT 액세스 토큰(1h) + opaque refresh 토큰(30d, `refresh_tokens` 테이블). `JWT_SECRET` env. 비밀번호 bcrypt 해시. OAuth 사용자는 `upsert_oauth_user`로 provider+sub 연결.

### Cowork 외부 API 인증
- **위치**: `backend/auth.py` — `COWORK_API_KEY` env로 외부 Claude Cowork 클라이언트 요청 검증(enrich/분석 쓰기 API, `CLAUDE_COWORK_API.md`).

## Market Data APIs

### yfinance (US 1차 + 일부 KR 폴백)
- **위치**: `backend/services/market/us.py`, `backend/services/market/__init__.py`, `backend/services/market/kr.py`.
- US 시세·시총·섹터/산업·히스토리 1차 소스. 배치는 `yf.download` 1콜로 다중 심볼 일봉 종가 일괄 조회(`get_quotes_batch`). KR은 섹터/산업이 키움 TR에 없어 yfinance로 보완(`kr.py`), 차트 폴백.
- 기타 yfinance 소비처: `backend/services/consensus_pipeline.py`(US `upgrades_downgrades`/`analyst_price_targets`), `backend/services/dividends.py`(US 배당 `t.info` dividendRate/dividendYield), `backend/services/ranking_service.py`, `backend/services/market_indicators/`(FX/VIX/원자재/국채 `_yf_close_history`).

### Naver Stock API
- **위치**: `backend/services/market/kr.py` (`https://m.stock.naver.com/api/stock`, `_naver_get`/`_kr_basic_naver`/재무 `finance/quarter`).
- KR 현재가·시총 폴백(키움/KIS 실패 시 마지막 폴백), 분기 재무.
- 기타 Naver 소비처: `backend/services/ranking_service.py`(`https://m.stock.naver.com/api/stocks/marketValue`, KOSPI+KOSDAQ 랭킹 페이지 병렬 fetch), `backend/services/consensus_pipeline.py`(`/api/research/stock/{ticker}` 리서치 리포트), `backend/services/scraper.py`(`/api/news/stock/{ticker}` 뉴스), `backend/services/guru_scraper.py`(`https://api.stock.naver.com/stock` US 종목).

### 키움 (Kiwoom) REST API — KR 시세 1차
- **클라이언트**: `backend/services/kiwoom/client.py` — `KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY` env로 `POST /oauth2/token` 발급(인프로세스 싱글톤, 401/403 재발급 재시도, 직렬 throttle 0.25s). base URL `KIWOOM_BASE_URL`(기본 `https://api.kiwoom.com`). 요청은 `POST /api/dostk/{category}`, 헤더 `api-id`/`authorization`. `integrated_code(stk_cd, regular)`로 NXT 통합코드(`_AL`, 기본) vs 평문 KRX 코드(`regular=True`) 분기.
- **읽기전용 시세 소스로만** (계좌·주문 미연동, 경계 ADR-0009). 서버측 단일 키.
- TR별 모듈:
  - `quote.py` — ka10001(주식기본정보): KR 현재가·기준가·시총. `market.get_quote_kr`이 키움 1차로 사용.
  - `chart.py` — ka10081(일봉)/ka10082(주봉)/ka10083(월봉) OHLC → DataFrame. `market.get_history_df` KR 1차.
  - `sector.py` — ka20006(업종일봉 종가 series) + ka20002(업종별주가 종목매핑). KOSPI 업종 모멘텀.
  - `investor.py` — ka10059+ka10008 병합(투자자별 수급).
  - `shortsell.py` — ka10014(공매도 추이).
- 사전계산 소비처: `backend/services/kr_sector_service.py`, `backend/services/investor_service.py`, `backend/services/short_sell_service.py`. 카탈로그: `KIWOOM_API.md`.

### KIS (한국투자증권) REST API — 백업 시세 소스
- **클라이언트**: `backend/services/kis/client.py` — `KIS_APP_KEY`/`KIS_APP_SECRET` env로 `POST /oauth2/tokenP` 발급(인프로세스 싱글톤, EGW00133 발급 1분당 1회 방어 60s 가드, 401 재발급 재시도, throttle 0.05s). base URL `KIS_BASE_URL`(기본 실전 `https://openapi.koreainvestment.com:9443`). 요청 `GET /uapi/...`, 헤더 `tr_id`/`appkey`/`appsecret`/`custtype=P`.
- **KR+US 읽기전용 *백업*** (주문·계좌 미연동, 경계 ADR-0011). 키 미설정이 안전 기본값(`configured()` False면 휴면).
- TR (`backend/services/kis/quote.py`):
  - KR `FHKST01010100`(현재가) — `market.get_quote_kr` 체인의 키움 다음 폴백.
  - US `HHDFS00000300`(price) + `HHDFS76240000`(dailyprice), EXCD NAS→NYS→AMS probe — `market.get_quote_us`의 yfinance 다음 폴백.
- 카탈로그: `KIS_API.md`.

### FnGuide (스크레이핑)
- **위치**: `backend/services/market/kr.py`(`https://comp.fnguide.com/SVO2/asp/SVD_main.asp`, `_fnguide_market_cap` KR 시총 폴백), `backend/services/consensus_pipeline.py`(`https://comp.fnguide.com/SVO2/json/data/01_06/03_A{ticker}.json` KR 컨센서스). BeautifulSoup 파싱. 인증 없음(공개 페이지/JSON).

### Finviz / 기타 스크레이핑
- `backend/services/scraper.py` — `https://finviz.com/quote.ashx`(US 종목 데이터), Naver 뉴스.
- `backend/services/guru_scraper.py` — `https://www.dataroma.com/m`(구루 보유 종목).

## Government / Macro Data APIs

### DART (전자공시, opendart.fss.or.kr)
- **위치**: `backend/services/backlog.py`, `backend/services/disclosures.py`, `backend/services/dividends.py`, `backend/services/insider_trades.py`. base `https://opendart.fss.or.kr/api`. env `DART_API_KEY` 필수(KR 전용).
- 제공 데이터:
  - `backlog.py` — `list.json`(최근 보고서 rcept_no) + `document.xml`(ZIP 원문) → 수주잔고 파싱.
  - `disclosures.py` — `list.json`(corp_code별 핵심유형 A·B·C·D 각각 호출) → 공시 피드(`stock_disclosures`).
  - `dividends.py` — `alotMatter.json`(사업보고서 reprt_code=11011) → KR 배당.
  - `insider_trades.py` — 내부자·5%지분 보고. 뷰어 링크 `https://dart.fss.or.kr/dsaf001/main.do`.

### FRED (St. Louis Fed)
- **위치**: `backend/services/market_indicators/econ.py`, `backend/services/market_indicators/macro.py`. base `https://api.stlouisfed.org/fred/series/observations`. env `FRED_API_KEY` 필수.
- 제공: 경제지표(econ), 매크로 신호 시계열(macro — T10Y2Y 금리차·BAMLH0A0HYM2 HY OAS·M2SL·DFF 기준금리).

### KOFIA / 공공데이터포털 (apis.data.go.kr)
- **위치**: `backend/services/leverage_service.py`(`https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService`·`GetMarketIndexInfoService` — 신용잔고·반대매매·시총), `backend/services/lending_service.py`(`https://apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2` — 내외국인 대차잔고). env `KOFIA_API_KEY`(두 서비스 공유).

### 관세청 / UN Comtrade (KR 수출)
- **위치**: `backend/services/market_indicators/exports.py`. `KITA_API_KEY` env(실제로는 관세청 Korea Customs Service 키)가 있으면 `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList`, 없으면 `https://comtradeapi.un.org/public/v1/preview/C/M/HS`(UN Comtrade 공개 API)로 자동 폴백.

## Infra / Networking

### Cloudflare Tunnel
- `cloudflared`가 `portfolion.taebro.com` → `localhost:80`을 터널링. docker compose 컨테이너가 **아니라** launchd로 실행(인프라 외부). compose는 nginx(80/443) + certbot(인증서)만.
- 보조: `scripts/ddns_update.sh` — Cloudflare DNS 레코드 갱신(`https://api.cloudflare.com/client/v4/zones/...`, `CF_ZONE_ID`/`CF_API_TOKEN` 환경 — 스크립트 전용, `.env.docker` 아님).

## Batch Source 매핑

배치별 fetch 출처는 `backend/services/batch_registry.py`의 `source` 필드에 명시(예: 일일 리포트 `["키움","KIS","Naver","FnGuide"]`, 컨센서스 `["FnGuide","Naver","yfinance"]`, 수출 `["관세청","UN Comtrade"]`, 경제/매크로 `["FRED"]`, 레버리지 `["KOFIA"]`, 대차 `["금융위"]`, 랭킹 `["Naver"]`, 수급/공매도/업종 `["키움"]`/`["키움","Naver"]`). `GET /api/batches`로 노출.

---
last_mapped_commit: 78e6f09a65ee76a7af351da7b7d417a13b6de820
mapped: 2026-07-09
---

# INTEGRATIONS — 외부 API / DB / 인증 / 웹훅

구현 사실만(용어 정의는 CONTEXT.md). 각 항목: 용도 · 파일 경로 · 키/설정. 경로는 리포 루트 기준.

## 데이터베이스 — PostgreSQL (Docker)

- **엔진**: `postgres:16-alpine`(`docker-compose.yml`), DB/USER `portfolion`, 볼륨 `pgdata`, 포트 5432.
- **접속 계층**: `backend/services/db.py` — psycopg2 `ThreadedConnectionPool`(minconn 1, **maxconn 20** — calendar 15·analysis 11 ThreadPool 동시성보다 크게), DSN = `os.environ["DATABASE_URL"]`. 헬퍼 `query`/`execute`/`execute_many`(`execute_batch`), `get_connection` 컨텍스트매니저(commit/rollback/putconn).
- **스키마**: 신규 설치 `backend/auth_schema.sql`(users, refresh_tokens) → `backend/app_schema.sql`(앱 테이블 전체), docker-entrypoint-initdb.d 마운트. 라이브 증분은 `backend/main.py:_migrate()`(idempotent DDL; `stock_disclosures`·`stock_dividends`·`stock_beta`·`stock_supply_score`·`stock_insider_trades`·`stock_recommendations`·`us_supply_snapshot`·`market_short_sell` 등 생성/컬럼추가).
- **인메모리 캐시**: `backend/services/cache.py`(snapshot LRU·list·dashboard·correlation·sector·macro TTL). PostgreSQL 영구 캐시 `market_cache`는 `backend/services/market_indicators/cache.py`(`_mc_load`/`_mc_save`).

## 시세/시장 데이터 소스

### yfinance (US 1차 시세·히스토리)
- **용도**: US 종목 quote/history/섹터/시총, 배치 `yf.download` 1콜, 시장지표(FX·VIX·원자재·국채·지수).
- **파일**: `backend/services/market/__init__.py`(`get_quote`·`get_quotes_batch`·`get_history_df`), `backend/services/market/us.py`, `backend/services/market_indicators/`(`fx.py`·`commodities.py`·`indices.py`·`earnings.py` 등).
- **키**: 없음(공개). rate-limit 방어로 종목당 TTL 캐시.

### Naver (KR 시세 폴백 + 리서치/뉴스/컨센서스)
- **용도**: KR quote 폴백(키움·KIS 실패 시), 애널리스트 컨센서스/리서치, 종목 검색·자동완성, 뉴스, 시총 랭킹.
- **엔드포인트**: `m.stock.naver.com/api/stock/{code}/...`, `api.stock.naver.com/stock/...`, `m.stock.naver.com/api/research/stock/`, `finance.naver.com/sise/sise_market_sum.naver`, `ac.stock.naver.com/ac`(자동완성), `n.news.naver.com`.
- **파일**: `backend/services/market/kr.py`(`_kr_basic_naver` — retry-once), `consensus_pipeline.py`, `scraper.py`, `ranking_service.py`, `investor_service.py`, `market_indicators/earnings.py`, `recommendation/universe.py`, `report_generator.py`.
- **키**: 없음(공개 모바일 API).

### 키움증권 REST (KR 1차 시세, 읽기전용)
- **용도**: KR 현재가(ka10001)·일봉/주봉/월봉 차트(ka10081/82/83)·투자자별 수급·업종 모멘텀(ka20006/ka20002)·공매도. **읽기전용 시세만**, 계좌·주문 미연동(경계 ADR-0009).
- **파일**: `backend/services/kiwoom/` — `client.py`(토큰·요청 헬퍼), `quote.py`·`chart.py`·`investor.py`·`sector.py`·`shortsell.py`.
- **인증/설정**(`client.py`): base URL `KIWOOM_BASE_URL`(기본 `https://api.kiwoom.com`), 자격 `KIWOOM_APP_KEY`+`KIWOOM_SECRET_KEY`. 토큰 `POST /oauth2/token`(client_credentials, 인프로세스 싱글톤 캐시 12h, 401/403 시 1회 재발급 재시도). 요청 `POST /api/dostk/{category}`(헤더 `api-id`/`authorization`, `return_code≠0`→`KiwoomError`, 직렬 throttle 0.25s). 미설정 시 `configured()` False → 호출측 폴백.

### 한국투자증권 KIS REST (KR+US 백업 시세, 읽기전용)
- **용도**: 시세 백업 — KR 체인 키움→**KIS**→Naver, US 체인 yfinance→**KIS**. 국내현재가(`FHKST01010100`), 해외가(`HHDFS00000300`/`HHDFS76240000`), 국내선물옵션(`FHMIF10000000`·`FHKIF03020100`, output1/2/3 분할). 주문·계좌 미연동(경계 ADR-0011/0022).
- **파일**: `backend/services/kis/` — `client.py`(토큰·요청), `quote.py`(`_kr_basic_kis`·`get_quote_us`), `futures.py`(코스피200 선물).
- **인증/설정**(`client.py`): base URL `KIS_BASE_URL`(기본 실전 `https://openapi.koreainvestment.com:9443`), 자격 `KIS_APP_KEY`+`KIS_APP_SECRET`. 토큰 `POST /oauth2/tokenP`(싱글톤 캐시 23h, EGW00133 발급 1분당 1회 방어로 강제 재발급 60s 가드). 요청 GET `/uapi/...`(헤더 `tr_id`/`appkey`/`appsecret`/`custtype=P`, `rt_cd≠"0"`→`KisError`, throttle 0.05s). 미설정 시 `configured()` False → 휴면(기존 체인만 동작).

## 정부/공공 데이터 API

### DART (전자공시, opendart.fss.or.kr)
- **용도**: 수주잔고(document.xml 원문), 공시 피드(list.json), 주주총회 일정, 내부자 거래, KR 배당(alotMatter), KR 재무제표(fnlttSinglAcnt/fnlttSinglAcntAll).
- **파일**: `backend/services/backlog.py`·`backlog_parser.py`, `disclosures.py`, `agm.py`, `insider_trades.py`, `dividends.py`, `market/kr.py`.
- **엔드포인트**: `https://opendart.fss.or.kr/api/...`, 문서뷰어 `dart.fss.or.kr/dsaf001/main.do`. **키**: `DART_API_KEY`(필수, 미설정 시 KR 공시/재무 휴면). status 013(무데이터)은 graceful.

### FRED (미 세인트루이스 연준, api.stlouisfed.org)
- **용도**: 경제지표·매크로 신호 시계열(금리차·HY OAS·M2·기준금리), 경제 릴리스 캘린더.
- **파일**: `backend/services/market_indicators/econ.py`·`macro.py`, `backend/routers/calendar.py`(`/releases/dates`).
- **엔드포인트**: `https://api.stlouisfed.org/fred/series/observations`, `.../fred/releases/dates`. **키**: `FRED_API_KEY`(미설정 시 수집 실패·저장값 무변경).

### KOFIA / 공공데이터포털 (apis.data.go.kr, 서비스 1160100)
- **용도**: 신용잔고·반대매매·시총(레버리지 지표), 내외국인 대차잔고, KR 수출 통계·시장지수.
- **파일**: `backend/services/leverage_service.py`(`GetKofiaStatisticsInfoService`·`GetMarketIndexInfoService`), `lending_service.py`(`GetStocLendBorrInfoService_V2`), `market_indicators/exports.py`, 백필 `backend/run_backfill.py`.
- **엔드포인트**: `https://apis.data.go.kr/1160100/...`. **키**: `KOFIA_API_KEY`(leverage/lending 공용, 미설정 시 요청 실패).

### KITA / 관세청 (apis.data.go.kr, 서비스 1220000) + UN Comtrade 폴백
- **용도**: KR 품목별 수출입 무역통계.
- **파일**: `backend/services/market_indicators/exports.py`.
- **엔드포인트**: `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList`, 폴백 `https://comtradeapi.un.org/public/v1/preview/C/M/HS`(공개). **키**: `KITA_API_KEY`(실제로 **관세청** 키; 미설정 시 UN Comtrade 자동 폴백).

## 인증 / OAuth

- **자체 인증**(`backend/services/auth_service.py`, `backend/auth.py`): 비밀번호 `bcrypt`, JWT `python-jose` **HS256**(`JWT_SECRET`, access 1h). Refresh 토큰은 `refresh_tokens` 테이블 저장·**1회용 회전**(사용 즉시 폐기, task#108). 세션 `SessionMiddleware`(`SESSION_SECRET`).
- **Google OAuth**(`backend/routers/auth.py`): authorize `https://accounts.google.com/o/oauth2/v2/auth`, 토큰 `https://oauth2.googleapis.com/token`. 키 `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. redirect_uri = `FRONTEND_URL + /api/auth/oauth/google/callback`. 임시 code로 토큰 교환(`_oauth_codes`, 120s TTL).
- **GitHub OAuth**(`backend/routers/auth.py`): authorize `https://github.com/login/oauth/authorize`, 토큰 `https://github.com/login/oauth/access_token`, 유저 `https://api.github.com/user`·`/user/emails`. 키 `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`.
- **역할/권한**: `users.role`(user|admin), `require_admin`. 메뉴 권한 `user_menu_permissions`/`default_menu_permissions`.

## 외부 Cowork API (인바운드)

- **용도**: 외부 Claude Cowork 클라이언트가 종목 분석 텍스트 enrich·backlog 채움을 write(`CLAUDE_COWORK_API.md` 스코프).
- **인증**(`backend/auth.py`): `X-API-Key` 헤더 = `COWORK_API_KEY`, 또는 JWT Bearer. 의존성 `require_admin_or_api_key`/`get_current_user_or_api_key`.
- **소비 엔드포인트**: `backend/routers/stocks.py`(`enrich_batch`·`enrich_single`), `backend/routers/report.py`(`generate_all`·backlog).

## 웹훅 / 알림 (아웃바운드)

- **Telegram**(`backend/services/digest_service.py:send_telegram`): 일일 다이제스트를 `https://api.telegram.org/bot{token}/sendMessage`로 전송. 키 `TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHAT_ID`(`os.getenv`, 미설정 시 스킵). 트리거 `backend/routers/digest.py`.

## 기타 웹 데이터 소스 (키 없음, 크롤/공개 JSON)

- **FnGuide**(`comp.fnguide.com`): KR 재무/컨센서스 — `backend/services/consensus_pipeline.py`, `market/kr.py`(`SVO2/json/...`, `SVD_main.asp`).
- **Finviz**(`finviz.com/quote.ashx`): US 보조 지표 — `backend/services/scraper.py`, `report_generator.py`.
- **Dataroma**(`dataroma.com/m`): 구루(슈퍼투자자) 보유 종목 — `backend/services/guru_scraper.py`, `recommendation/universe.py`, `batch_registry.py`.
- **multpl.com**(`www.multpl.com/shiller-pe`): S&P500 Shiller CAPE(requests+BeautifulSoup 크롤) — `backend/services/market_indicators/indices.py`.
- **CNN Fear & Greed**(`production.dataviz.cnn.io/index/fearandgreed/graphdata`): 시장 심리 지수 — `backend/services/market_indicators/sentiment.py`(취약 소스 → VIX식 수동 last-good 폴백).
- **open.er-api.com**(`/v6/latest/USD`): FX 환율 폴백 — `backend/services/market_indicators/fx.py`.
- **Wikipedia**(`en.wikipedia.org/wiki/List_of_S...`): S&P500 구성종목 — `backend/services/recommendation/universe.py`.

## 코드에 존재하나 미사용

- **Anthropic / LLM**: `ANTHROPIC_API_KEY`가 `backend/.env.docker`에 남아있으나 **백엔드에서 사용하지 않음**(`requirements.txt`에 anthropic 없음, `services`/`routers`에 호출 코드 0건). AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API로 작성(백엔드 `report_generator`는 시장 데이터 스냅샷만 생성).
- **Supabase**: `backend/.env`·`frontend/.env`·`supabase/`·`supabase_schema.sql`에 잔재가 있으나 현 Docker 인프라에서 미사용(레거시).

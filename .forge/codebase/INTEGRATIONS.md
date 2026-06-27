---
last_mapped_commit: f1839804fa84342f9e30cc6dc919d5e5abba7b8d
mapped: 2026-06-28
---

# 외부 연동 (INTEGRATIONS)

PortfoliOn이 호출하는 외부 API·데이터베이스·인증 제공자·스케줄러를 정리한 구현 사실 지도다. (언어/의존성/환경변수 정의는 `STACK.md` 참조.)

## 시세 / 종목 데이터 소스

### yfinance (US 1차)
- `backend/services/market/us.py`, `backend/services/market/__init__.py` — `yf.Ticker`로 US 시세·섹터·시총·히스토리. 배치 시세는 `yf.download` 1콜.
- 재무: `backend/services/market/us.py`의 `get_annual_financials_us`가 `t.get_income_stmt()`/`get_balance_sheet()`/`get_cashflow(freq='yearly', as_dict=False)` **메서드**를 사용(무공백 라벨). 프로퍼티(`.cash_flow`)는 공백 라벨이라 사용 금지.
- 라벨 매칭 헬퍼 `_yf_val`은 `backend/services/market/format.py:61`(exact 매칭, 불일치 시 조용히 None).

### Naver 모바일 증권 API (KR 폴백 시세·재무·랭킹)
- 베이스 `https://m.stock.naver.com/api/stock` (`backend/services/market/kr.py:15` `_NAVER_BASE`), 헤더 Referer `https://m.stock.naver.com/` (`_NAVER_HEADERS`).
- `_naver_get(ticker, path)` — `basic`(현재가), `finance/quarter`·`finance/annual`(재무 row).
- 랭킹: `https://m.stock.naver.com/api/stocks/marketValue` (`backend/services/ranking_service.py:15`) — KOSPI/KOSDAQ 페이지네이션 fetch (ThreadPoolExecutor).
- FnGuide(보조): `https://comp.fnguide.com/SVO2/asp/SVD_main.asp` (`backend/services/market/kr.py:32`, `_fnguide_market_cap` 시총).

### 키움증권 REST (KR 1차 시세 — 읽기전용)
- 클라이언트 `backend/services/kiwoom/client.py` — 베이스 `KIWOOM_BASE_URL`(기본 `https://api.kiwoom.com`), 토큰 인프로세스 싱글톤(401 재발급 재시도), 요청 `POST /api/dostk/{category}`(헤더 `api-id`/`authorization`, `return_code≠0`→예외, 직렬 throttle). 자격증명 `KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`.
- `integrated_code(stk_cd, regular)` — `regular=False`(기본)=`_AL`(NXT 통합 SOR 코드), `regular=True`=평문 KRX 코드.
- TR 매핑:
  - `backend/services/kiwoom/quote.py` — `ka10001`(주식기본정보, 현재가).
  - `backend/services/kiwoom/chart.py` — `ka10081`(일봉)/`ka10082`(주봉)/`ka10083`(월봉).
  - `backend/services/kiwoom/sector.py` — `ka20006`(업종일봉 종가)/`ka20002`(업종별주가 종목매핑), KRX KOSPI 업종 모멘텀(조회 TR만).
  - `backend/services/kiwoom/investor.py` — `ka10059`(투자자별 순매수 수량)/`ka10008`(외국인 보유율).
  - `backend/services/kiwoom/shortsell.py` — `ka10014`(공매도 추이, list_key `shrts_trnsn`).
- 경계: KR 읽기전용 시세 소스 전용(계좌·주문 미연동). 전체 카탈로그 루트 `KIWOOM_API.md`.

### 한국투자증권(KIS) REST (KR+US 백업 시세 — 읽기전용)
- 클라이언트 `backend/services/kis/client.py` — 베이스 `KIS_BASE_URL`(기본 실전 `https://openapi.koreainvestment.com:9443`), 토큰 `/oauth2/tokenP` 발급(인프로세스 싱글톤, EGW00133 방어 60s 가드), 요청 GET `/uapi/...`(헤더 `tr_id`/`appkey`/`appsecret`/`custtype=P`, `rt_cd≠"0"`→예외). 자격증명 `KIS_APP_KEY`/`KIS_APP_SECRET`. `configured()` False면 휴면.
- TR (`backend/services/kis/quote.py`):
  - 국내 `FHKST01010100`(현재가).
  - 해외 `HHDFS00000300`(price) + `HHDFS76240000`(dailyprice), EXCD NAS→NYS→AMS probe.
- 폴백 위치: KR 체인 키움→KIS→Naver (`backend/services/market/kr.py`의 `_kr_basic_kis`), US 체인 yfinance→KIS (`backend/services/market/us.py`의 `_us_quote_kis`). 전체 카탈로그 루트 `KIS_API.md`.

### KR 시세 합의(다수결) 로직
- `backend/services/market/kr.py` — `get_quote_kr`이 독립 피드(키움 NXT/KRX·KIS·Naver) 2-of-N 다수결(`_corroborated_pick`)로 글리치 제거. `regular=True`(리포트 스냅샷)는 KRX 정규장, `regular=False`(대시보드)는 NXT.

## 전자공시(DART) — `https://opendart.fss.or.kr/api`

KR 전용·`DART_API_KEY` 필수. 베이스 `_DART_BASE = "https://opendart.fss.or.kr/api"`.

- **수주잔고** `backend/services/backlog.py` — `corpCode.xml`(corp_code 매핑, 1주 캐시), `list.json`(보고서 rcept_no), `document.xml`(ZIP 원문 디코드), `fnlttSinglAcnt.json`(주요계정 재무).
- **공시 피드** `backend/services/disclosures.py` — `list.json`을 핵심유형 A·B·C·D **각각** 개별 호출(응답에 `pblntf_ty` 미echo) → `stock_disclosures` 테이블 upsert. status 013은 graceful 빈 리스트.
- **내부자 거래** `backend/services/insider_trades.py` — `elestock.json`(임원·주요주주 소유상황) + `majorstock.json`(5%룰 대량보유) → `stock_insider_trades`.
- **배당(KR)** `backend/services/dividends.py` — `alotMatter.json`(사업보고서 reprt_code 11011, 주당 현금배당·배당수익률) → `stock_dividends`. (US 배당은 yfinance `t.info`.)
- **재무(KR 연간)** `backend/services/market/kr.py` — `fnlttSinglAcntAll`(전체 재무제표, `fs_div` CFS/OFS 요청 필수)로 FCF·이자보상배율; `account_id`(XBRL 표준)로 매칭.

## 거시·경제 지표

### FRED — `https://api.stlouisfed.org/fred/series/observations`
- `backend/services/market_indicators/econ.py:23` — FRED 경제지표(`FRED_API_KEY` 필요).
- `backend/services/market_indicators/macro.py:41` — 매크로 신호 4종 시계열(T10Y2Y·BAMLH0A0HYM2·M2SL·DFF).

### 공공데이터포털 (data.go.kr) — `KOFIA_API_KEY`
- 레버리지 `backend/services/leverage_service.py` — `https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService`(신용잔고·반대매매) + `.../GetMarketIndexInfoService`(시총) → `market_leverage_indicators`.
- 대차잔고 `backend/services/lending_service.py` — `https://apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2`(금융위 내외국인 대차잔고) → `market_lending_balance`. (`KOFIA_API_KEY` 동일 키 사용.)

### KR 수출 — `KITA_API_KEY`(실제 관세청)
- `backend/services/market_indicators/exports.py` — 관세청 `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList`(키 설정 시) ↔ UN Comtrade `https://comtradeapi.un.org/public/v1/preview/C/M/HS`(미설정 시 폴백) → `market_cache`.

### 시장지표 캐시 패턴
- `backend/services/market_indicators/` — `cache.py`(`_mc_load`/`_mc_save`로 `market_cache` 읽기/쓰기), 서브모듈이 `_merge_history`/`_yf_close_history`로 yfinance 증분 fetch. fx/vix/commodities/treasury/earnings(M7·KR Top2) 포함.

## 구루(Guru) 스크레이핑
- `backend/services/guru_scraper.py` — Dataroma `https://www.dataroma.com/m`(매니저/포트폴리오, BeautifulSoup 파싱) + Naver US `https://api.stock.naver.com/stock`(종목명).

## 데이터베이스 (PostgreSQL 16)

- 연결: `backend/services/db.py` — `psycopg2` `ThreadedConnectionPool(minconn=1, maxconn=20)`, DSN은 `DATABASE_URL`. `RealDictCursor` 사용, `get_connection()` 컨텍스트매니저가 commit/rollback.
- 컨테이너: `postgres:16-alpine` (`docker-compose.yml`, `pgdata` 볼륨).

### 스키마 파일 (실행 순서: auth → app)
- `backend/auth_schema.sql` — `users`, `refresh_tokens`.
- `backend/app_schema.sql` — `tickers`, `snapshots`, `user_stocks`, `schedules`, `guru_managers`, `guru_schedules`, `batch_schedules`, `digests`, `consensus_history`, `calendar_cache`, `market_cache`, `user_menu_permissions`, `default_menu_permissions`, `raw_reports`, `daily_consensus_mart`, `user_events`, `market_leverage_indicators`, `market_lending_balance`, `backlog_history`, `market_rankings`, `market_investor_trend`, `market_short_sell`, `stock_disclosures`, `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`, `job_runs`.
- `backend/supabase_schema.sql` — 레거시(Supabase 마이그레이션 이전 흔적).

### 기동 시 멱등 마이그레이션
- `backend/main.py`의 `_migrate()` (`@app.on_event("startup")`, `main.py:147`) — `CREATE TABLE IF NOT EXISTS`/`ALTER` 일부 테이블(batch_schedules, market_short_sell, stock_disclosures, stock_dividends, stock_supply_score, stock_insider_trades, stock_recommendations, backlog_history.segments)을 기동마다 멱등 보정.

## 인증 제공자

### JWT (HS256)
- `backend/auth.py` — `HTTPBearer`로 Bearer 토큰 검증, `jose.jwt.decode(..., algorithms=["HS256"])`, 시크릿 `JWT_SECRET`.
- `backend/services/auth_service.py` — `jwt.encode`로 access 토큰 발급, `refresh_tokens` 테이블로 리프레시 토큰 회전.

### OAuth (Google / GitHub)
- `backend/routers/auth.py` — `authlib` + Starlette `SessionMiddleware`(`SESSION_SECRET`).
- Google: authorize `https://accounts.google.com/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token`. 콜백 `/api/auth/oauth/google/callback`. (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`)
- GitHub: authorize `https://github.com/login/oauth/authorize`, token `https://github.com/login/oauth/access_token`. 콜백 `/api/auth/oauth/github/callback`. (`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`)
- 토큰 교환은 임시 코드(`_oauth_codes`, 120s 만료) → `/api/auth/oauth/token`으로 프론트가 교환.

### API 키 (Cowork)
- `backend/auth.py:42` — `X-API-Key` 헤더를 `COWORK_API_KEY`와 비교, 일치 시 sentinel user_id `__api_key__` 반환. `get_current_user_or_api_key`/`require_admin_or_api_key` 의존성으로 enrich·리포트 엔드포인트 게이팅.

### CORS / 세션 미들웨어 (`backend/main.py`)
- `SessionMiddleware`(secret `SESSION_SECRET`), `EventTrackerMiddleware`(사용자 행동 로깅), `CORSMiddleware`(origins `localhost:3000`·`localhost:5173`·`FRONTEND_URL`).

## 스케줄러 / 아웃바운드 호출

- 패키지 `backend/scheduler/` — `_state.py`가 `apscheduler.schedulers.asyncio.AsyncIOScheduler` 싱글톤, `schedule.py`가 `CronTrigger`(timezone `Asia/Seoul`)로 잡 등록 + 빈 캐시 시드(`_seed_rankings_if_empty`/`_seed_kr_sector_if_empty`). `main.py:148`에서 기동.
- 잡 정의 `backend/scheduler/jobs.py` (모두 외부 API/DB로 아웃바운드): 일일 리포트(`_generate_kr`/`_generate_us`), 구루 크롤(`_run_guru_crawl`), 월간/실적 KR·US(`_refresh_monthly_*`/`_refresh_earnings_*`), 매크로 신호(`_refresh_macro_signals`), 다이제스트(`_run_digest`), 레버리지/대차/수주잔고/공시/내부자/배당(`_fetch_*`), 랭킹·수급·공매도·수급점수·추천·KR 업종(`_fetch_*`).
- 배치 메타데이터 정본: `backend/services/batch_registry.py`(`BATCHES`, 각 배치 `source`/`usage`/`market`), 실행 이력 `backend/services/job_runs.py`(`job_runs` 테이블).
- **다이제스트 Telegram 아웃바운드(선택)**: `backend/services/digest_service.py:267` — `https://api.telegram.org/bot{token}/sendMessage` (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` 설정 시).
- **인바운드 웹훅 없음**: OAuth 콜백 외에 외부에서 들어오는 webhook 수신 엔드포인트는 발견되지 않음.

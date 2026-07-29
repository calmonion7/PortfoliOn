---
last_mapped_commit: 91bac67ddb3ca7277a850fa6840a0fce0f7344cf
mapped: 2026-07-30
---

# 외부 연동 (INTEGRATIONS)

DB·외부 API·인증 제공자·아웃바운드 웹훅·배치 데이터 소스와 **각각을 호출하는 코드 경로**를 기록한다.
런타임/의존성/환경변수 정의는 자매 문서 `STACK.md` 참조.

집계: 외부 호스트 **19개** — 자격증명 필요 6계열(키움·KIS·DART·FRED·KOFIA·관세청) +
OAuth 2계열 + 아웃바운드 2계열(Telegram·Cowork fire), 나머지는 **무인증**(스크래핑/공개 API).

사용 HTTP 라이브러리:
- **`requests`** — 외부 API 대부분(동기 서비스 전량)
- **`httpx.AsyncClient`** — `backend/routers/auth.py` 뿐(OAuth 토큰 교환)
- **`yfinance`** — 약 20개 모듈
- **`beautifulsoup4`** — HTML 스크래핑
`urllib.request`·`aiohttp`·`websocket`·`selenium`·`pykrx`·`FinanceDataReader`는 **어디에도 없다**.

---

## 1. 데이터베이스 — PostgreSQL

### 접속 계층 — `backend/services/db.py` (69줄)

- 드라이버 `psycopg2`, 풀 `psycopg2.pool.ThreadedConnectionPool`,
  모듈 전역 `_pool`을 `threading.Lock()` 이중검사로 지연 생성(`_get_pool`).
- **`minconn=1`, `maxconn=20`**. 주석(23-24줄): psycopg2 풀은 소진 시 블록이 아니라
  **`PoolError`를 던지므로** 최대 ThreadPool 동시성(calendar 15·analysis 11)보다 크게 잡았다.
- DSN은 `os.environ["DATABASE_URL"]` — 기본값 없음(`KeyError`).
- `get_connection()`은 contextmanager: `getconn` → yield → `commit`,
  예외 시 `rollback` + 재전파, `finally`에서 `putconn`.
- 헬퍼 3종: `query(sql, params) -> list[dict]`(`RealDictCursor`),
  `execute(sql, params) -> int`(rowcount), `execute_many(sql, params_list) -> None`
  (`execute_batch`, 빈 리스트는 커넥션조차 안 잡는 no-op).

⚠️ `backend/scheduler/jobs.py`의 `_investor_trend_work`(299줄)·`_short_sell_work`(427줄)는
워커를 8로 캡하며 주석에 *"DB 풀(maxconn=10) 초과 방지"*라 적었는데 **실제 `maxconn`은 20**이다(주석 stale).

### 컨테이너 및 초기화

`docker-compose.yml`의 `postgres` 서비스: `postgres:16-alpine`, DB/사용자 `portfolion`,
비밀번호 `${POSTGRES_PASSWORD:-portfolion}`, **5432 호스트 노출**, `pgdata` 볼륨,
`pg_isready -U portfolion` 헬스체크(backend가 `service_healthy` 대기).

스키마는 initdb 스크립트로 마운트되며 **파일명 접두사가 순서를 강제**한다(`docker-compose.yml:14-15`):
`backend/auth_schema.sql` → `01-auth.sql`, `backend/app_schema.sql` → `02-app.sql`.

순서 의존성의 실체: `auth_schema.sql`이 `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`
(`gen_random_uuid()` 기본값용)와 `users`를 만들고, `app_schema.sql`의 5개 테이블
(`user_stocks`·`digests`·`calendar_cache`·`user_menu_permissions`·`user_events`)이
`user_id uuid REFERENCES users(id) ON DELETE CASCADE`를 건다.

⚠️ **initdb 스크립트는 빈 `pgdata` 볼륨에서만 실행된다**(`app_schema.sql:358-363`에 명시).
기존 프로덕션 DB는 `git push` 배포로 새 DDL을 받지 못한다 — 그래서
`backend/main.py:_migrate()`가 존재한다.

### 테이블 (총 34개)

`backend/auth_schema.sql` (2): `users`(PK `id UUID`, `email` UNIQUE, `role` 기본 `'user'`),
`refresh_tokens`(PK `id UUID`, `token` UNIQUE, `user_id` FK CASCADE).

`backend/app_schema.sql` (32):

| 테이블 | PK |
|--------|-----|
| `tickers` | `ticker` |
| `snapshots` | `(ticker, date)` |
| `user_stocks` | `(user_id, ticker)` |
| `schedules` / `guru_managers` / `guru_schedules` | `id integer CHECK (id = 1)` — 싱글톤 3종, INSERT로 시드 |
| `batch_schedules` | `job_id text` |
| `digests` | `(user_id, date)` |
| `consensus_history` | `(ticker, date)` |
| `calendar_cache` | `(user_id, month)` |
| `market_cache` | `key text` |
| `user_menu_permissions` | `(user_id, menu)` |
| `default_menu_permissions` | `menu text` |
| `raw_reports` | `(report_date, ticker, brokerage_code)` |
| `daily_consensus_mart` | `(base_date, ticker)` |
| `user_events` | `id bigserial` |
| `market_leverage_indicators` / `market_lending_balance` | `base_date date` |
| `backlog_history` | `(ticker, quarter)` |
| `market_rankings` | `(market, metric, rank)` |
| `market_investor_trend` / `market_short_sell` | `(ticker, base_date)` |
| `stock_disclosures` | `rcept_no text` (DART 접수번호가 dedup 키) |
| `stock_dividends` / `stock_beta` / `stock_supply_score` / `stock_recommendations` / `us_supply_snapshot` | `ticker text` |
| `stock_dividend_schedule` | `(ticker, ex_date)` |
| `stock_insider_trades` | `row_hash text` — `rcept_no\|report_kind\|repror\|shares_change\|shares_after\|rate_after`의 md5 (한 `rcept_no`가 보고자 여러 행을 낳으므로) |
| `job_runs` | `id bigserial` |
| `analyst_reports` | `id bigserial` + `UNIQUE (ticker, published_date)` |

인덱스 14+개(`idx_*_read` 패턴이 주). 테이블 아닌 저장소도 있다:
`kr_sector_momentum`·`us_sector_momentum`은 **`market_cache` 키**이고
(`backend/services/kr_sector_service.py:4`, `us_sector_service.py:4`),
`_oauth_codes`는 인프로세스 dict(`backend/routers/auth.py:24`).

### 기동 마이그레이션 — `backend/main.py:_migrate()` (60-238줄)

`lifespan` 최초 단계. 약 20개 독립 `try/except → logger.warning("[Migrate] …")` 블록,
각각 `services.db.execute`를 지역 import. 전부 idempotent이며 실패해도 기동은 계속된다.

- 테이블 11개 `CREATE TABLE IF NOT EXISTS`: `batch_schedules`, `market_short_sell`,
  `stock_disclosures`, `stock_dividends`, `stock_dividend_schedule`, `stock_beta`,
  `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`,
  `us_supply_snapshot`, `analyst_reports`
- 컬럼 14개 `ADD COLUMN IF NOT EXISTS`: `backlog_history.segments`,
  `stock_disclosures.meeting_date`, `stock_recommendations.{low_liquidity,exchange,name}`,
  `us_supply_snapshot.{insider_transactions,insider_net}`,
  `user_stocks.{target_price,stop_price,target_weight,pinned}`,
  `tickers.{key_resource,competitor_edge,market_outlook,analyst_target}`
- 인덱스 5개

**`_migrate()`는 `app_schema.sql`의 진부분집합이다** — `_migrate()`에만 있는 테이블/컬럼은 없다.
다만 내부 드리프트가 있다: `_migrate()`의 CREATE 본문은 슬라이스 당시 스냅샷이라
`stock_recommendations`(CREATE에 `name` 없음)·`us_supply_snapshot`(insider 2컬럼 없음)·
`stock_disclosures`(`meeting_date` 없음)은 뒤따르는 별개 try블록의 `ALTER`가 보충한다.
그리고 `market_investor_trend`는 `_migrate()`에 **없다** — `market_lending_balance`는
`backend/services/lending_service.py:58`이 자체 `CREATE TABLE IF NOT EXISTS`로 자가치유하지만
`market_investor_trend`엔 그런 폴백이 없어 라이브 DB에서는 수동 `psql` 적용에 의존한다.

**신규 컬럼 DoD**: `app_schema.sql`과 `_migrate()`를 **쌍으로** 고쳐야 한다. 한쪽만 고치면
배포 직후 그 컬럼을 쓰는 INSERT/SELECT가 컬럼 부재로 깨진다.

### 캐시 계층 (DB 밖)

`backend/services/cache.py` — 인메모리 6종: snapshot(LRU 200), list(TTL 5s),
dashboard/correlation/sector/macro(각 TTL 300s). 종목 추가·수정·삭제 시 뒤 4종 자동 무효화.
`backend/services/market_indicators/cache.py`가 `_mc_load`/`_mc_save`로 `market_cache` 테이블을 읽고 쓴다.

⚠️ **`get_or_refresh(key, fetch_fn, ttl)`의 `ttl`은 저장값에 걸리지 않는다**
(`market_indicators/cache.py:110`) — `_mc_load`가 행을 주면 **나이 불문 반환**하고 `ttl`은
인메모리 캐시 수명만 지배한다. 즉 한 번 `market_cache`에 저장되면 `force=True`가 올 때까지
사실상 영구 서빙이며, 실제 재조회자는 `force=True`를 주는 배치뿐이다. 15개 키 전체에 적용되는 성질.
또 `get_or_refresh`는 **fetch 실패 시 직전 저장값으로 폴백하지 않는다**(실패를 전파) —
취약한 소스는 §2.11의 VIX식 수동 폴백을 써야 한다.

---

## 2. 시장·금융 데이터 API

### 2.1 yfinance (Yahoo Finance) — 무인증

US 1차 시세·재무·히스토리 정본. `import yfinance as yf` 사용처 주요 목록:

| 파일 | 함수 | 사용 표면 |
|------|------|-----------|
| `backend/services/market/__init__.py` | `_get_quote_uncached`(77-80), `get_quotes_batch`(164), `get_history_df`(226), `get_financials`(238), `get_analyst_data`(334) | `Ticker.info`, `.history`, `yf.download(period="3mo", auto_adjust=False, group_by="ticker")` |
| `backend/services/market/us.py` | `get_annual_financials_us`(14) | `get_income_stmt()`/`get_balance_sheet()`/`get_cashflow()` |
| `backend/services/market/kr.py` | `get_quote_kr`(272-288) | `Ticker(f"{ticker}.KS").info` — sector/industry/marketCap 갭필만 |
| `backend/services/market_indicators/cache.py` | `_yf_close_history`(85-94) | 지표 공통 fetcher (`start=` 증분 또는 `period="1y"`) |
| `backend/services/market_indicators/fx.py` | `_fetch_fx`, `get_vix` | `USDKRW=X`, `USDJPY=X`, `EURUSD=X`, `^VIX` |
| `backend/services/market_indicators/indices.py` | `_fetch_index` | `^GSPC`, `^KS11`, `^KQ11` |
| `backend/services/market_indicators/commodities.py` | `_fetch_commodity`, `_fetch_treasury` | `GC=F`, `CL=F`, `HG=F`, `^IRX`, `^FVX`, `^TNX`, `^TYX` |
| `backend/services/market_indicators/kospi_signal.py` | `_fetch_kospi_rows`(94) | `^KS11` |
| `backend/services/market_indicators/earnings.py` | `_get_yf_quarterly_net_income`(157) | `.quarterly_financials` |
| `backend/services/us_supply.py` | `fetch_us_supply`(99-103) | `.info`, `.institutional_holders`, `.insider_transactions`, `.insider_purchases` |
| `backend/services/dividends.py` | `fetch_us_dividend`(50), `_dividend_history`(234), `fetch_dividend_schedule`(281) | `.info`, `.dividends`, `.calendar` |
| `backend/services/consensus_pipeline.py` | `_fetch_us_raw`(166-198) | `.upgrades_downgrades`, `.analyst_price_targets`, `.info` |
| `backend/services/ranking_service.py` | `get_us_rankings`(142) | `yf.screen("most_actives", count=250)` |
| `backend/services/beta.py` | 38 | `.info` |
| `backend/services/scraper.py` | `get_news`(120) | `.news` |
| `backend/services/report_generator.py` | 89, 123, 172, 282, 498 | `.info`(`enterpriseToEbitda`), `.history` |
| `backend/services/recommendation/funnel.py` | 288 | `.info` |
| `backend/routers/stocks.py` | `search_stocks`(165) | `yf.Search(q, max_results=12, enable_fuzzy_query=True)` |
| `backend/routers/analytics.py` | 23 | `.history(period="90d")` |
| `backend/routers/calendar.py`, `backend/routers/report.py` | 실적일 / `.history(period="1mo")`(545) | |

**함정 2종.** ① `get_income_stmt()` 등 **메서드**는 무공백 index 라벨(`OperatingCashFlow`),
`.income_stmt`/`.cash_flow` **프로퍼티**는 공백 라벨(`Operating Cash Flow`)이다.
`market/format.py::_yf_val`은 exact 매칭이라 라벨이 어긋나면 **예외 없이 조용히 None**을 준다 —
`market/us.py`는 메서드 계열로 통일해야 한다. ② yfinance 퍼센트 필드는 **소수분수**다
(`info.shortPercentOfFloat` 0.0098 = 0.98%, `institutional_holders.pctHeld`,
`insider_purchases`의 `% Buy/Sell Shares`, `info.dividendYield`) — 표시는 ×100.
둘 다 **단위테스트가 응답을 mock해 못 잡고 라이브에서만 드러난다**.

`backend/main.py:24`가 `yfinance` 로거를 WARNING으로 억제한다.

### 2.2 Naver — 무인증 (브라우저 헤더 위장)

호스트 4개. 모두 `Referer: https://m.stock.naver.com/` + Chrome User-Agent 딕트를 쓴다.

| 엔드포인트 | 파일 · 함수 |
|-----------|-------------|
| `https://m.stock.naver.com/api/stock/{ticker}/{basic\|finance/quarter\|finance/annual\|trend}` | `backend/services/market/kr.py` — `_NAVER_BASE`(16), `_naver_get`(19), `_kr_basic_naver`(57), `get_financials_kr`(324), `get_annual_financials_kr`(414) |
| `…/api/stock/{ticker}/trend` | `backend/services/investor_service.py` — `_fetch_trend_naver`(59-69) |
| `…/api/stocks/marketValue/{market}?page=&pageSize=100` | `backend/services/ranking_service.py` — `_NAVER_MARKETVALUE`(17), `_fetch_naver_page`(88), `_fetch_naver_market`(95) |
| `…/api/news/stock/{ticker}` + 링크 템플릿 `https://n.news.naver.com/mnews/article/{office_id}/{article_id}` | `backend/services/scraper.py` — `get_news_kr`(62-91) |
| `…/api/research/stock/{ticker}?pageSize=200` 및 `…/{ticker}/{rid}` | `backend/services/consensus_pipeline.py` — `_fetch_kr_raw`(62, 81), `fetch_detail` |
| `…/api/stock/{ticker}/finance/quarter` | `backend/services/market_indicators/earnings.py` — `_get_naver_quarterly_net_income`(175) |
| `https://api.stock.naver.com/stock/{code}/basic` (`TICKER` → `TICKER.O` 순차 시도) | `backend/services/guru_scraper.py` — `_NAVER_US_BASE`(11), `get_name_kr`(30) |
| `https://ac.stock.naver.com/ac?q=&target=stock` (자동완성) | `backend/routers/stocks.py` — `_search_naver`(98) |
| `https://finance.naver.com/sise/sise_market_sum.naver?sosok=0&page=N` (euc-kr 디코드, 정규식 `code=([0-9]{6})`) | `backend/services/market_indicators/earnings.py` — `_scrape_kospi`(136) |

**주목**: `_kr_basic_naver`는 HTTP 에러를 **의도적으로 전파**한다 — Naver `409`가 상장폐지 감지 수단이다
(`get_quote_kr`:310 `delisted = isinstance(e, _req.exceptions.HTTPError) and ...status_code == 409`).

Naver는 **forward 실적일을 제공하지 않는다**(`irScheduleInfo`=null, `/finance`·`/consensus` 404) —
캘린더 KR 실적일은 yfinance `.KS`/`.KQ`가 유일 소스다(§2.14).

### 2.3 FnGuide — 무인증 (`Referer: https://comp.fnguide.com/`)

| 엔드포인트 | 파일 · 함수 |
|-----------|-------------|
| `https://comp.fnguide.com/SVO2/asp/SVD_main.asp?gicode=A{ticker}` (HTML 정규식 → 시가총액) | `backend/services/market/kr.py` — `_fnguide_market_cap`(30-42) |
| `https://comp.fnguide.com/SVO2/json/data/01_06/03_{gicode}.json` | `backend/services/market/kr.py` — `get_analyst_data_kr`(626-631) |
| `https://comp.fnguide.com/SVO2/json/data/01_06/03_A{ticker}.json` (`utf-8-sig` 디코드) | `backend/services/consensus_pipeline.py` — `_fetch_kr_fnguide`(125-129) |

### 2.4 키움(Kiwoom) REST — `KIWOOM_APP_KEY` / `KIWOOM_SECRET_KEY`

클라이언트 `backend/services/kiwoom/client.py`(`requests`).
베이스 `os.getenv("KIWOOM_BASE_URL", "https://api.kiwoom.com")`.
엔드포인트: `POST /oauth2/token`(`_issue_token`:62), `POST /api/dostk/{category}`(`_request`:146).

휴면 가드(34-37줄):
```python
def configured() -> bool:
    """자격증명이 설정돼 있어야 키움을 시도한다(미설정 시 호출측이 폴백)."""
    app_key, secret_key = _creds()
    return bool(app_key and secret_key)
```
미설정 시 `request()`/`request_paged()`는 `KiwoomAuthError`를 던지지만
**모든 호출측이 `client.configured()`를 먼저 검사하고 폴백**하므로 실효는 휴면이다.
토큰 싱글톤 12시간 캐시(`_TOKEN_CACHE_SEC`), 0.25s 직렬 throttle(`_MIN_INTERVAL`),
401/403 시 강제 재발급 1회 + 재시도.

| TR (`api-id`) | category | 파일 · 함수 |
|---------------|----------|-------------|
| `ka10001` 기본정보/현재가 | `stkinfo` | `kiwoom/quote.py` — `get_basic_info`(26), `get_quote`(60) |
| `ka10081`/`ka10082`/`ka10083` 일·주·월봉 | `chart` | `kiwoom/chart.py` — `_TF`(14-16), `fetch_bars`(59), `history_df`, `daily_closes` |
| `ka10059` 투자자별 순매수 | `frgnistt` | `kiwoom/investor.py` — `fetch_flows`(51) |
| `ka10008` 외국인 보유율 | `frgnistt` | `kiwoom/investor.py` — `fetch_foreign_ratio`(71) |
| `ka20006` 업종 시세 | — | `kiwoom/sector.py` — `fetch_sector_closes`(92) |
| `ka20002` 업종 구성종목 | — | `kiwoom/sector.py` — `fetch_sector_stocks`(111) |
| `ka10014` 공매도 추이 | — | `kiwoom/shortsell.py` — `fetch_rows`(77) |

**코드 선택 단일 분기점** `integrated_code(stk_cd, regular=False)`(40-49줄):
기본 False면 `_AL`(SOR/NXT 통합코드), `regular=True`면 평문 KRX 코드.
`_AL`은 평시에도 NXT 시간외가(KRX 정규장과 ~1% 차)를 반환한다.
읽기전용 시세만 연동 — 계좌·주문 미연동. 카탈로그는 루트 `KIWOOM_API.md`.

### 2.5 KIS 한국투자증권 REST — `KIS_APP_KEY` / `KIS_APP_SECRET`

클라이언트 `backend/services/kis/client.py`(`requests`).
베이스 `os.getenv("KIS_BASE_URL", "https://openapi.koreainvestment.com:9443")`(실전; 모의는 override).
엔드포인트: `POST /oauth2/tokenP`(`_issue_token`:55), `GET {path}`(`_request`:122).
가드는 키움과 동형(`configured()`:37-40 → 미설정 시 `KisAuthError`, 호출측이 선검사해 휴면).
토큰 23시간 캐시, **`_REISSUE_MIN_INTERVAL = 60`**(KIS `EGW00133` "발급 1분당 1회" 방어), 0.05s throttle.

| `tr_id` | path | 파일 · 함수 |
|---------|------|-------------|
| `FHKST01010100` | `/uapi/domestic-stock/v1/quotations/inquire-price` | `kis/quote.py` — `get_kr_basic_info`(32), `get_quote_kr`(62) |
| `HHDFS00000300` | `/uapi/overseas-price/v1/quotations/price` | `kis/quote.py` — `get_quote_us`(139) |
| `HHDFS76240000` | `/uapi/overseas-price/v1/quotations/dailyprice` | `kis/quote.py` — `get_quote_us`(150) |
| `FHMIF10000000` | `/uapi/domestic-futureoption/v1/quotations/inquire-price` | `kis/futures.py` — `_fetch_price`(46), `get_front_month` |
| `FHKIF03020100` | `/uapi/domestic-futureoption/v1/quotations/inquire-daily-fuopchartprice` | `kis/futures.py` — `fetch_daily`(79) |

⚠️ **국내선물옵션 시세 TR은 응답 봉투가 `output1`/`output2`/`output3`으로 분할된다** —
주식 현재가의 단수 `output`과 다르다. `d.get("output")`만 읽으면 `rt_cd=0`인데 늘 빈값이라
"코드/파라미터 오류"로 오진한다. output1=계약 quote(`futs_prpr`·`mrkt_basis`·`futs_last_tr_date`),
output2=일봉 리스트, output3=기초 KOSPI200 지수. 표시 베이시스는 `mrkt_basis`(선물−현물)이며
이론 `basis`(이론가−현물)와 **필드명이 유사하고 값이 다르다**.
읽기전용 시세만 연동. 카탈로그는 루트 `KIS_API.md`.

### 2.6 DART 전자공시 — `DART_API_KEY` (쿼리 파라미터 `crtfc_key`)

베이스 `https://opendart.fss.or.kr/api`. 6개 모듈이 각자 `_DART_BASE` + `_dart_key()`를 정의한다.

| 파일 | 엔드포인트 | 함수 |
|------|-----------|------|
| `backend/services/disclosures.py`(28) | `/list.json` × 4유형(`_CORE_TYPES = ("A","B","C","D")`) | `fetch_disclosures`(50), `fetch_and_save`, `fetch_all_disclosures` |
| `backend/services/insider_trades.py`(29) | `/elestock.json`, `/majorstock.json`(`_REPORTS` 39-50) | `fetch_insider_trades`(125) |
| `backend/services/dividends.py`(29) | `/alotMatter.json`(`reprt_code=11011`) | `fetch_kr_dividend`(114) |
| `backend/services/agm.py`(112) | `/list.json` (**`pblntf_ty` 미지정** no-type 호출) | `_fetch_agm_list`(126), `fetch_agm_meeting_dates` |
| `backend/services/backlog.py`(52) | `/corpCode.xml`(ZIP, `_CORP_CODE_URL`:53), `/list.json`, `/document.xml`(ZIP), `/fnlttSinglAcnt.json` | `_get_corp_code_map`(73), `_get_recent_reports`(102), `_get_document_text`(130), `get_financials`(306) |
| `backend/services/market/kr.py`(385) | `/fnlttSinglAcntAll.json`(CFS→OFS 루프), `/list.json` | `get_annual_financials_kr`(480), `get_rd_intensity_kr`(562) |

뷰어 링크 템플릿(fetch 안 함, UI 저장용):
`_DART_VIEWER = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}"`.

**키 부재 처리가 모듈마다 다르다.**
- 명시 가드(휴면): `agm.py`:162-163(`logger.info("[AGM] DART_API_KEY 미설정 — skip")`),
  `market/kr.py`:459-461, `market/kr.py`:549-551
- 가드 없음(빈 `crtfc_key`를 보내고 DART `status != "000"`에 의존):
  `disclosures.fetch_disclosures`, `insider_trades.fetch_insider_trades`,
  `dividends.fetch_kr_dividend`, `backlog`의 4함수 — 각기 `try/except` + `logger.warning`으로
  `[]`/`{}`/`None`을 반환(graceful이지만 왕복 낭비). `status 013`(무데이터)은 빈 리스트로 취급.

`agm.py`엔 `_DART_THROTTLE = 0.3` 직렬 sleep이 있다.

**API 형태 함정 3종.**
① `fnlttSinglAcntAll`(전체 재무제표)은 `fs_div`(CFS/OFS)를 **요청 필수값**으로 받고
(누락 시 `status 100`), **응답을 행별 `fs_div`로 필터하면 안 된다** — fs_div를 요청한 응답은
단일 fs라 행에 그 필드를 echo하지 않아 전 행이 스킵된다. 반면 `fnlttSinglAcnt`(주요계정)는
fs_div 없이 호출해 응답에서 행별로 필터한다(둘을 복붙하면 깨짐).
② 계정 매칭은 회사별로 표기가 흔들리는 `account_nm`이 아니라 **`account_id`**(XBRL 표준)로.
③ `list.json`은 응답에 `pblntf_ty`를 **echo하지 않아** "단일 호출 후 응답필드 필터"가 불가하다 —
그래서 `disclosures.py`는 A·B·C·D를 개별 호출해 질의 유형을 항목에 stamp한다.
그런데 **`pblntf_ty`를 지정하면 주총 공시가 0건**이라, AGM은 유형 미지정 호출로만 발견된다 —
`agm.py`가 자체 no-type 호출 + `ON CONFLICT(rcept_no)`로 행을 self-insert하는 이유다.

### 2.7 FRED (St. Louis Fed) — `FRED_API_KEY`

베이스 `https://api.stlouisfed.org`, `requests`.

| 엔드포인트 | 파일 · 함수 | 시리즈 |
|-----------|-------------|--------|
| `/fred/series/observations` | `backend/services/market_indicators/macro.py` — `_fetch_series`(44) | `_SERIES`(12-17): `T10Y2Y`, `BAMLH0A0HYM2`, `M2SL`, `DFF` |
| `/fred/series/observations` | `backend/services/market_indicators/econ.py` — `_fetch_series`(27) | `CPIAUCSL`, `UNRATE` |
| `/fred/releases/dates` | `backend/routers/calendar.py`:233-243 | `_FRED_RELEASES` allowlist로 필터 |

키 부재 시 **예외 없이 에러 페이로드/부분결과**를 반환한다:
`macro.py`:59-61 → `{"error": "FRED_API_KEY 환경변수가 필요합니다."}`,
`econ.py`:13-15 및 64-66(가입 URL 포함 메시지),
`routers/calendar.py`:229-231 → `if not api_key: return events`
(FOMC 하드코딩 날짜는 그대로 반환되므로 캘린더가 완전히 비지는 않는다).
fetch 실패는 `_mc_load(...)` 저장 시계열로 폴백(`macro.py`:74-76, `econ.py`:43-45).

⚠️ **FRED엔 S&P CAPE 시리즈가 없다** — FRED의 "Case-Shiller"는 *주택가격* 지수다. CAPE는 §2.11.

### 2.8 KOFIA / 공공데이터포털 — `KOFIA_API_KEY`

베이스 `https://apis.data.go.kr`, `requests`, 헤더 `{"User-Agent": "Mozilla/5.0"}`.
⚠️ 키를 `params=`가 아니라 **f-string URL 안에 `serviceKey`로 직접 박아** 넣는다.

| 베이스 + operation | 파일 · 함수 |
|-------------------|-------------|
| `/1160100/service/GetKofiaStatisticsInfoService/getGrantingOfCreditBalanceInfo` | `backend/services/leverage_service.py` — `_kofia_get`(28), `_fetch_credit_balance`(67) |
| `…/GetKofiaStatisticsInfoService/getSecuritiesMarketTotalCapitalInfo` | 같은 파일 — `_fetch_market_fund`(85) |
| `/1160100/service/GetMarketIndexInfoService/getStockMarketIndex` | 같은 파일 — `_fetch_market_cap`(105) |
| `/1160100/GetStocLendBorrInfoService_V2/getNatiAndForeLendAndBorrBalaCo_V2` | `backend/services/lending_service.py` — `_BASE`(8), `_OP`(9), `_api_get`(12-21), `_fetch_all` |
| 위 3개 중복 정의 | `backend/run_backfill.py` — `_KOFIA_BASE`/`_INDEX_BASE`(14-15), `_kofia_get`(30) — 호스트 단독 스크립트, **로컬 DSN 하드코딩**(12줄) |

**키 부재 시 서비스에 가드가 없다.** `os.environ.get("KOFIA_API_KEY", "")`가 빈 `serviceKey`를 만들고
요청이 나가며 비정상 응답에서 맨 예외를 던진다(`leverage_service.py`:37-39,
`lending_service.py`:16-17). CLI만 가드한다(`run_backfill.py`:203-205 → `exit(1)`).
두 서비스 모두 `page_size=1000` 직렬 페이지네이션 + 페이지 간 `time.sleep(0.3)`/`0.5`.
`lending_service.py`는 두 API를 **동일 키로 공유**한다(금융위 `GetStocLendBorrInfoService_V2`).

### 2.9 관세청 Korea Customs + UN Comtrade 폴백

`backend/services/market_indicators/exports.py`(`requests` + `xml.etree.ElementTree`).
`KITA_API_KEY`라는 이름이지만 **실제로는 관세청 키**다.

| 소스 | URL | 함수 |
|------|-----|------|
| 관세청 품목별 무역통계 | `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList`(40) — XML, 반도체 `hsSgn=8542`, 월별 총액은 `ThreadPoolExecutor(max_workers=6)` | `_fetch_customs_exports`(37), 내부 `_fetch_month_total`(56) |
| UN Comtrade | `_COMTRADE_URL = "https://comtradeapi.un.org/public/v1/preview/C/M/HS"`(13) — `reporterCode=410`, `cmdCode=TOTAL`/`8542`, `flowCode=X` | `_fetch_comtrade_exports`(82) |

폴백 체인 — `_fetch_and_save_kr_exports`(105-131):
```python
data = _fetch_customs_exports(api_key) if api_key else _fetch_comtrade_exports()
```
1. 키 있으면 관세청, 없으면 **조용히** Comtrade로 소스 전환(에러 아님)
2. 예외 → `_fetch_comtrade_exports()` 재시도(111-113)
3. 2차 예외 → 저장값에 `{"stale": True}` 태그, 없으면 `{"months": [], "error": ...}`
4. **성공-but-빈응답 가드**(121-125): `if not data.get("months")` → 직전값 유지 + `stale: True`, 저장 생략

### 2.10 dataroma (구루 13F) — 무인증

`backend/services/guru_scraper.py`(`requests` + `BeautifulSoup("html.parser")`),
베이스 `_BASE = "https://www.dataroma.com/m"`(10).

| path | 함수 |
|------|------|
| `/managers.php` | `scrape_manager_ids`(116) |
| `/holdings.php?m={manager_id}` | `scrape_holdings`(175) — 셀렉터 `div#f_name`, `p#p2`, `table#grid` |
| `/m_activity.php?m={id}&typ=a[&L={page}]` | `scrape_activity`(311) — 최대 `_ACT_MAX_PAGES = 10`쪽, 쪽 간 `time.sleep(0.35)` |

**2계층 구조, A가 정본**: `scrape_all_managers`(371) → `scrape_holdings`(계층 A — kind·share_pct 정본)
→ `_enrich_activity`(331, 계층 B — `port_pct`와 전량매도만 보강). B 실패는 로깅 후 스킵(341-343),
분기 불일치면 B를 통째 폐기(348-354). 한글명은 Naver(`get_name_kr`, §2.2)에서 오며
in-run `name_kr_cache` + `time.sleep(0.1)`, 매니저당 `time.sleep(0.5)`.

### 2.11 multpl.com — Shiller CAPE, 무인증

`backend/services/market_indicators/indices.py` — `_fetch_cape`(100-104):
`requests.get("https://www.multpl.com/shiller-pe", timeout=10, headers={"User-Agent": "Mozilla/5.0"})`
→ `_parse_multpl_cape`(42, BeautifulSoup, `#current` div 정규식 `Ratio:\s*(\d+\.?\d*)` + 통계 `<tr>` 테이블).
실패 시 `None`을 반환하고 `get_indices`:133-134가 `stored_data["valuation"]["sp500_cape"]`로 폴백.
로컬 `lxml` 부재 때문에 **`BeautifulSoup(html, "html.parser")`** 를 쓴다.

### 2.12 CNN Fear & Greed — 무인증

`backend/services/market_indicators/sentiment.py` —
`_CNN_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"`(10),
`_fetch_fear_greed`(29)가 브라우저 완전 위장 헤더 `_CNN_HEADERS`(11-20: Chrome 124 UA,
`Origin: https://edition.cnn.com`, `Referer: https://edition.cnn.com/`, `sec-ch-ua` 3종)로 호출.
`get_fear_greed`(61) 폴백: 인메모리 캐시 → 라이브 fetch → `_mc_load("fear_greed")` → `None`.
언제든 막힐 수 있는 소스라 `get_or_refresh`가 아닌 **VIX식 수동 폴백**을 쓴 사례다(§1 캐시 주의 참조).

### 2.13 기타 무인증 소스

| 소스 | 파일 · 함수 | 상세 |
|------|-------------|------|
| **Finviz** | `backend/services/scraper.py` — `scrape_finviz_consensus`(17-43) | `https://finviz.com/quote.ashx?t={ticker}`, BeautifulSoup `table.snapshot-table2` → `Recom`/`Target Price`. 실패 시 `{}` |
| **open.er-api.com** | `backend/services/market_indicators/fx.py` — `_fetch_usdkrw_current`(12-20) | `https://open.er-api.com/v6/latest/USD`(timeout 5) → `.rates.KRW`. `usdkrw` 키 체인의 3번째 |
| **Wikipedia** | `backend/services/market_indicators/earnings.py` — `_scrape_sp500`(116-126) | `https://en.wikipedia.org/wiki/List_of_S%26P_500_companies`, `table#constituents`. `_tickers_with_cache`(90)가 감싼다: `market_cache` 저장값 → stale 저장값(110-112) → 온디스크 시드 `_read_seed`(79) |

⚠️ 티커 목록 캐시는 이제 **`market_cache`**(키 `sp500_tickers`·`kospi_tickers`)에 있고
`backend/data/{sp500,kospi}_tickers.json`은 **read-only 시드**로 격하됐다.
과거 이 파일을 캐시로 겸용(read+write)해 전체 테스트 실행이 추적 데이터를 오염시켰다.

### 2.14 `exchange_calendars` — 네트워크 없음

`backend/routers/calendar.py`:12 `import exchange_calendars as xcals`,
`_get_holidays`:278에서 `xcals.get_calendar("XNYS")`/`"XKRX"` + `sessions_in_range`를
`pd.date_range(freq="B")`와 diff. **라이브러리에 휴장일 규칙이 번들돼 있어 HTTP가 없다.**
`holidays` 패키지·KRX API·`pykrx`·`FinanceDataReader`는 백엔드에 전무하다.

캘린더 이벤트 타입별 소스: `earnings`(yfinance `t.calendar["Earnings Date"]`,
KR은 `{code}.KS`/`.KQ` — **`_yf_sym(ticker, market, exchange)`로 접미사를 반드시 붙일 것**,
raw ticker면 KR 0건), `dividend`(US 확정 ex-date `t.calendar["Ex-Dividend Date"]`),
`econ`(FRED `/releases/dates`), `agm`(`stock_disclosures.meeting_date`, §2.6),
`holiday_us`/`holiday_kr`(exchange_calendars). yfinance 호출은
`ThreadPoolExecutor(max_workers=30)`로 병렬화된다. 라이브 캐시는 `calendar_cache` 테이블
(user_id+month)이고, 종목 추가·삭제·승격 시 `invalidate_portfolio_caches(user_id)` →
`calendar.clear_cache(user_id)`가 해당 행을 삭제한다.

---

## 3. 폴백 체인 (함수 단위)

### KR 현재가 — `backend/services/market/kr.py`

`get_quote_kr`(239) → `_kr_pick_basic`(191)에서 분기한다.

**`regular=True`(리포트 스냅샷)** → `_kr_pick_regular`(145):
키움(KRX) → KIS → Naver 순으로 `_price_sane`(114 — 전일종가 ±30% **및** 키움 일봉의 ≤2배)를
통과하는 첫 값. 전부 실패하면 첫 non-null.

**`regular=False`(라이브 대시보드)** → **2-of-N 다수결**(단순 체인이 아니다):
1. `_kr_basic_kiwoom(regular=True)` + `_kr_basic_kiwoom(regular=False)` 2콜 →
   `_corroborated_pick`(132). 합의하면 NXT 반환 — **KIS/Naver는 호출조차 안 한다**(평시 비용 무변).
2. 불일치면 `_kr_basic_kis` → `_kr_basic_naver`를 추가 호출해 최대 4피드 다수결로
   outlier(글리치)를 폐기.
3. 그래도 합의 불가 → `_kr_pick_degenerate_lazy`(167): 키움NXT → KIS → Naver → 키움KRX를
   지연 평가하며, 2단계 결과를 재사용한다(236줄 `kis=esc.get("KIS"), naver=esc.get("Naver")`).

합의 기준은 **독립 피드끼리 ±2배([0.5, 2.0]) 이내**다. prev_close·일봉(ref_close)은 NXT와
같은 피드라 별도 표가 아니다(변동률 계산용으로만 남는다).
마지막으로 yfinance가 sector/industry/marketCap을 갭필하고(271-291),
Naver에 `marketValue`가 없으면 `_fnguide_market_cap`이 채운다(`_kr_basic_naver`:63).

**시세 기준 이원화**: 리포트 스냅샷 = KRX 정규장(`regular=True`) / 라이브 대시보드 = NXT.
같은 종목이 리포트와 대시보드에 ~1% 다른 현재가를 보이는 건 의도된 기준 차다.
리포트 writer만 opt-in한다(`report_generator`의 당일·백필 daily_df·get_quote·경쟁사,
`report.py:refresh_analyst`). `get_quote` TTL 캐시 키에 `regular`가 포함돼 두 기준이 섞이지 않는다.

`report_generator.generate_report`에는 **박제-시 독립피드 게이트**(KR 전용)가 있다:
저장 직전 KRX와 독립인 ref 피드로 `price`·일봉 기준종가를 2배 교차검증해 어긋나면
그 종목 박제를 **스킵**한다(직전 양호 스냅샷 유지 — wrong < missing). ref 피드는
① 네이버 retry-once(`_kr_basic_naver`, 첫 예외 시 0.5s 후 재시도) → ② 실패·None이면 KIS 폴백.
**ref 전무면 박제 스킵 + loud 로그**. `backfill_ticker`(과거 날짜)는 현재가 대조 불가라 미적용.

> ⚠️ 정정(ADR-0020 amendment): 과거 "005930이 정확히 70000.0으로 박제" 사례의 원인은
> 피드 글리치가 아니라 **로컬 pytest가 prod DB에 fixture를 직접 쓴 오염**이 유력하고,
> 실제 해결은 conftest `_block_real_db` 가드였다. 라운드 70k가 또 보이면
> 피드 글리치 전에 **테스트 오염을 먼저 의심**할 것. 다수결·게이트 자체는 진짜 글리치 방어로 유효.

### 그 외 체인

| 대상 | 체인 | 위치 |
|------|------|------|
| US 현재가 | yfinance → `_us_quote_kis`(`market/us.py`:163) → `_us_none_quote`(194). 예외 경로(113)와 **"성공했지만 price 없음"** 경로(116) 둘 다 KIS로 간다 | `market/__init__.py::_get_quote_uncached`(71) |
| 배치 시세 | US `yf.download` → 티커별 `get_quote`(176); KR `_kr_closes_kiwoom` → `get_quote`(189, KR 전체 체인 재진입) | `market/__init__.py::get_quotes_batch`(147) |
| 히스토리 | KR 키움 `ka10081/82/83`(`kclient.configured()` 가드) → `yf.Ticker().history()` → 빈 DataFrame(229) | `market/__init__.py::get_history_df`(204) |
| 투자자 수급 | 키움 `fetch_trend_rows`(configured + 행 non-empty) → `_fetch_trend_naver`(89) | `investor_service.py::fetch_trend`(72) |
| 공매도 | 키움 `ka10014` 단독 → `[]`. docstring:3 *"순수 신규 데이터라 폴백 소스 없음"* | `short_sell_service.py::fetch_trend`(13) |
| KR 컨센서스 | `_fetch_kr_fnguide`(FnGuide) → Naver Research 목록 + 리포트별 상세(`ThreadPoolExecutor(max_workers=5)`) | `consensus_pipeline.py::_fetch_kr_raw`(46) |
| US 컨센서스 | `.upgrades_downgrades` → `.analyst_price_targets` + `info.recommendationKey` | `consensus_pipeline.py::_fetch_us_raw`(161) |
| FX | yfinance `_yf_close_history` → 저장 history → (usdkrw만) open.er-api.com → `None`; 이후 `get_fx`:73-77이 실패한 키만 저장값으로 복원 | `market_indicators/fx.py::_fetch_fx`(23) |
| KOSPI200 선물 | `client.configured()` 가드 → `dict(_EMPTY)`+`configured: False`; 이후 KIS → 인메모리 캐시 → `_mc_load` → `configured: True`인 빈 dict | `market_indicators/kospi_futures.py::get_kospi_futures`(39) |
| KR 업종 모멘텀 | 키움 `ka20006`/`ka20002` 단독, 폴백 없음(`_fetch_one_sector`:56, `parallel_map(max_workers=4)`) | `kr_sector_service.py` |
| 지표 공통 | `get_or_refresh`(110) + `_mc_load`/`_mc_save`가 "라이브 → 최종 저장값" 계층 | `market_indicators/cache.py` |

### 3.1 빈 결과 가드 — 안전한 형태와 취약한 형태

19개 저장 지점 전수 적용 결과, 안전·취약은 **가드의 위치**로 갈렸다.

**안전(소스-폴백)** — 빈 결과가 필드에 도달하기 전에 직전값이 채워지므로 마지막 `_mc_save`가
무엇을 쓰든 잃을 게 없다(구조적 가드):
- `market_indicators/fx.py`:36-40 — fetch 실패 시 `stored_history`를 담아 **반환**
- `market_indicators/cache.py`:69-72 — `_merge_history(prev, [])`가 **prev를 그대로 반환**
- `services/dividends.py`:388-392 — `fetch_dividend_schedule(...)`를 `replace_schedule` **진입 전에** 평가

**취약했던 형태(끝 가드)** — `exports`·`commodities`·`earnings`·`kr_sector`는 판정을
저장 직전 한 지점에 뒀고, 그 지점이 놓친 실패 클래스로 전부 새어나갔다.
끝 가드를 쓸 수밖에 없다면 **실패 클래스 3종을 모두** 물어야 한다:
1. **예외** — `try/except`
2. **성공-but-빈응답** — `rt_cd=0` / HTTP 200 with 0 items. 예외 가드를 그냥 통과한다
   (`exports`가 `all_months`를 `total>0`으로 만들어 200/0건에 `{"months": []}`를 반환한 게 실례)
3. **부분 페이로드** — 한 페이로드의 *일부 필드*만 가드. `kr_sector`가 `sectors`만 보고
   같은 payload의 `index`를 빠뜨려 `build_sector_index()=={}`가 보유→업종 매핑을 지웠다.
   대응은 필드별 직전값 보존(`index = build_sector_index() or load_sector_index()`)

**delete-rewrite(replace) 갱신은 특히 파괴적**이다 — fetch 실패를 빈 결과로 삼키면
save를 생략하는 게 아니라 **직전 양호값을 DELETE로 파괴**한다(`dividends.replace_schedule`).
근본 신호는 fetch 성공 여부이므로 fetch 함수가 예외를 `[]`로 삼키지 말고 **전파**해
호출측이 replace를 통째 스킵하게 해야 한다. delete+insert는 **단일 트랜잭션**으로.

요청경로도 같다 — `market_indicators/kospi_futures.py`가 처음엔 `_fetch` *예외*만 가드해
KIS가 `rt_cd=0`에 빈 output을 주면 all-None dict를 박제하며 직전 양호값을 클로버했다.
`indices.py`의 `if any(v is not None ...)`처럼 **값 수준 가드**가 필요하다.

저장을 스킵할 때는 **admin 응답·로그가 "갱신됨"과 "생략·직전값 유지"를 구분**해야 관측이 성립한다 —
`job_runs`는 본문이 예외를 전파할 때만 `failed`라 스킵을 초록으로 기록한다.

---

## 4. 인증 제공자

### 4.1 Google OAuth 2.0 — `backend/routers/auth.py`

`httpx.AsyncClient`를 쓰는 **유일한** 모듈이다.

| 단계 | 엔드포인트 | 함수 |
|------|-----------|------|
| 리다이렉트 | `https://accounts.google.com/o/oauth2/v2/auth`(150) | `oauth_google`(140) |
| 토큰 교환 | `https://oauth2.googleapis.com/token`(165, `AsyncClient().post`) | `oauth_google_callback`(154) |

env: `GOOGLE_CLIENT_ID`(145, 166), `GOOGLE_CLIENT_SECRET`(167),
`FRONTEND_URL`(142, 162, 182 — `redirect_uri` 베이스 = `FRONTEND_URL + "/api/auth/oauth/google/callback"`).

⚠️ **`id_token`은 서명 검증 없이 디코드된다**(175-177줄):
```python
import base64 as _b64, json as _json
_payload = id_token.split(".")[1] + "=="
userinfo = _json.loads(_b64.urlsafe_b64decode(_payload))
```
TLS 토큰 엔드포인트에서 직접 받은 토큰이라는 전제에 의존한다
(과거 jose의 `at_hash` 검증 오류를 우회하며 이 형태가 됐다). 형태 검사는
`id_token.count(".") < 2`뿐(172줄).

### 4.2 GitHub OAuth — `backend/routers/auth.py`

| 단계 | 엔드포인트 | 함수 |
|------|-----------|------|
| 리다이렉트 | `https://github.com/login/oauth/authorize`(196) | `oauth_github`(187) |
| 토큰 교환 | `https://github.com/login/oauth/access_token`(208) | `oauth_github_callback`(200) |
| 프로필 | `https://api.github.com/user`(217), `https://api.github.com/user/emails`(218) | 동일 |

env: `GITHUB_CLIENT_ID`(191, 210), `GITHUB_CLIENT_SECRET`(211).
현재 `.env.docker`에서 두 값이 **빈 문자열**이라 실질 미동작이다(`STACK.md` §6.4).

### 4.3 OAuth 공통 메커닉

- **state nonce**: `_make_state`(47) / `_verify_state`(52)가
  `_HMAC_SECRET = os.environ.get("SESSION_SECRET", "dev-secret").encode()`(45)로 HMAC 서명.
  ⚠️ `SESSION_SECRET` 미설정 시 **소스에 적힌 폴백 키를 조용히 사용**한다
  (`main.py:262`는 같은 변수를 `os.environ[...]`으로 읽어 기동을 막으므로 실배포에선 도달 불가).
- **코드 교환 릴레이**: 콜백이 토큰을 프론트에 직접 주지 않고 `_store_oauth_tokens`(26)로
  인프로세스 dict `_oauth_codes`(24)에 **120초** 보관한 뒤 `?oauth=<code>`로 리다이렉트하고,
  프론트가 `GET /api/auth/oauth/token`(232)으로 교환한다. `_pop_oauth_tokens`(36)는 `pop`이라
  동시 교환에도 `KeyError`가 없다. 만료 항목은 저장 시 함께 청소된다(29-31).
- **리다이렉트 캐시 금지**: `_no_cache_redirect`(132) — 서비스워커/브라우저가 OAuth 콜백을
  캐시해 로그인이 깨지던 문제 대응.
- 실패는 예외가 아니라 `{FRONTEND_URL}/?error=oauth_denied|oauth_failed`로 리다이렉트한다.
- OAuth 사용자 upsert: `auth_service.upsert_oauth_user(email, provider, sub)` →
  `apply_default_permissions(user_id)`(`default_menu_permissions` 적용) → `issue_tokens`.

### 4.4 자체 JWT — `backend/auth.py`

- 알고리즘 **HS256**, 시크릿 `os.environ["JWT_SECRET"]`, 라이브러리 `python-jose`.
  `HTTPBearer(auto_error=False)`로 받는다.
- `get_current_user(creds)` — 토큰 없으면 401, `jwt.decode` 실패/`sub` 부재면 401.
- `get_current_user_or_api_key(request, creds)` — `X-API-Key` 헤더가 있으면 **그 경로만** 검사
  (`COWORK_API_KEY`와 일치해야 하고, 불일치면 즉시 401), 없으면 JWT.
  API 키 인증 시 sentinel user_id `"__api_key__"`(`_API_KEY_USER_ID`)를 반환한다.
- `require_admin(user_id)` — `auth_service.get_user_by_id`로 `role == "admin"` 확인, 아니면 403.
  ⚠️ **API 키를 거부하는 설계**다(키로 호출하면 401).
- `require_admin_or_api_key(request, user_id)` — sentinel이면 통과, 아니면 admin 검사.
- 프론트 저장: `localStorage`의 `access_token`/`refresh_token`, 401 응답 시 자동 삭제 + `/`로 이동
  (`frontend/src/api.js` 인터셉터).
- 리프레시 토큰은 `refresh_tokens` 테이블. 라우트는 `POST /api/auth/{register,login,refresh,logout}`,
  `GET /api/auth/me`.
- admin 승격은 DB 직접: `UPDATE users SET role = 'admin' WHERE email = '…'`.
- 메뉴 권한은 `user_menu_permissions`(user_id+menu). 허용 목록은 `backend/routers/admin.py`의
  `ALL_MENUS`, 프론트 `AuthContext`가 로그인 시 로드해 nav를 필터링한다.
  ⚠️ nav 게이팅과 API 게이팅은 별개다 — 정책은 **"공개 read는 없다"**(ADR-0029)다.

**인증 의존성 추가 시 함정**: 다수 테스트가 conftest의 `client`가 아니라 모듈 상단에서
`FastAPI()`를 직접 만들어 `app.dependency_overrides`로 auth를 우회한다. conftest는
`main.app`의 `get_current_user`만 override하므로 자체-app 테스트엔 안 걸린다.
다만 **선제적으로 전수 override를 추가하지 말 것** — 형제 read가 먼저 인증돼 있으면
그 테스트 앱이 이미 override를 등록해 둔 경우가 많다.
**순서: 의존성을 붙인 뒤 전체 스위트를 먼저 돌리고 실제로 깨지는 것만 고친다.**
그리고 인증 게이팅을 바꾸는 슬라이스는 착수 시
`grep -n '\*\*Auth:\*\* 불필요' API_SPEC.md`를 먼저 돌릴 것 — doc-sync 테스트는
엔드포인트 *존재*만 보므로 auth 산문 drift를 잡지 못한다. 남아도 되는 `불필요`는
`GET /api/auth/oauth/token` 등 `auth.py` 공개 엔드포인트뿐이다.

### 4.5 인바운드 API 키 (Cowork)

`COWORK_API_KEY` — 외부 Cowork/루틴이 `X-API-Key` 헤더로 enrich·발행 API를 호출할 때 쓴다.
검증은 `backend/auth.py`:46, 상수 시간 비교가 아닌 `==` 비교다.
빈 문자열이면 **어떤 키도 401**이 되어 사실상 키 인증이 닫힌다.
계약은 `CLAUDE_COWORK_API.md`(Base URL `https://portfolion.taebro.com`).

---

## 5. 아웃바운드 알림 · 웹훅

### 5.1 Telegram Bot API

`backend/services/digest_service.py` — `send_telegram`(269-313):
`requests.post(f"https://api.telegram.org/bot{token}/sendMessage", ...)`(307-308).
env `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
가드(272-273): `if not token or not chat_id: return` → 완전 휴면. 전송 실패는 catch + 로깅만.
호출처: `backend/routers/digest.py`:36, `backend/scheduler/jobs.py`:143.

⚠️ **현재 프로덕션에서 휴면 상태다** — 두 변수가 `backend/.env.docker`에 없고
실행 중 컨테이너 환경에도 키 자체가 없다(`STACK.md` §6.4). README는 이 기능을 문서화하고 있다.

### 5.2 Cowork 루틴 fire (자체 호스트 웹훅)

`backend/services/cowork_trigger.py` — `fire(text)`(25-44):
`requests.post(url, headers={"Authorization": f"Bearer {...}"}, json={"text": text}, timeout=15)`.
URL 자체가 설정값이라 **코드에 리터럴이 없다**.

레포에서 가장 깔끔한 휴면 가드(21-22줄):
```python
def configured() -> bool:
    return bool(os.environ.get("COWORK_ROUTINE_FIRE_URL") and os.environ.get("COWORK_ROUTINE_FIRE_TOKEN"))
```
`fire()`:27-28 `if not configured(): return False`. docstring:6 *"미설정 시 휴면(dormant-safe)"*.
**절대 raise하지 않는다** — 실패는 로깅만 하고 배치 본문을 깨뜨리지 않는다(best-effort).
`>= 300`이면 `logger.warning`(HTTP 코드 + 본문 200자) 후 False.

수신측은 레포 내 `scripts/cowork-fire-listener.py`(호스트 launchd 데몬):
**`PORT = 8787` 하드코딩**, `127.0.0.1` 바인드,
`POST /fire`에서 `Authorization: Bearer <COWORK_ROUTINE_FIRE_TOKEN>` 검사.
정책 프롬프트는 `scripts/cowork-routine-prompt.md`로 버전관리된다.
발사 시점: 일일 리포트 배치 완료 직후 자동 + admin 수동 `POST /api/admin/cowork/fire`.

> 백엔드는 이 POST 1개 외에 **LLM을 호출하지 않는다**(`anthropic` 미의존, `ANTHROPIC_API_KEY` read 0건).

---

## 6. 스케줄 · 배치 데이터 소스

### 6.1 스케줄러

`backend/scheduler/_state.py`(7줄, 순환참조 차단용 leaf 모듈): APScheduler **`AsyncIOScheduler()`** —
**잡스토어 미지정 = 기본 `MemoryJobStore`**라 잡은 기동마다 DB에서 재구성된다.
**스케줄러 레벨 타임존이 없다** — 잡별로 레지스트리 `entry["timezone"]`을
`CronTrigger(timezone=...)`에 넘긴다(`backend/scheduler/schedule.py`:16).
`us_rankings_fetch` 하나만 `America/New_York`, 나머지는 `Asia/Seoul`.

`backend/scheduler/__init__.py::start()`(63-72) 순서:
`_seed_batch_schedules()` → editable 항목마다 `_reschedule_job(id)` → `_check_missed_report()` →
`_seed_rankings_if_empty()` → `_seed_kr_sector_if_empty()` → `_seed_us_sector_if_empty()` →
`_scheduler.start()`. `stop()`은 `shutdown(wait=False)`, `reload(job_id)`는 재스케줄.

스펙 → 트리거 변환은 `backend/services/schedule_spec.py`:
`validate_schedule_spec`(time `^([01]\d|2[0-3]):[0-5]\d$`, days ⊆ mon–sun,
day_of_month 1..31, `every_minutes >= 5`, `0 <= start_hour <= end_hour <= 23`),
`build_trigger_kwargs`, `describe_schedule`(비활성 시 `"자동실행 꺼짐"`).
**전부 `CronTrigger`다** — `interval` 타입도 `minute="*/N"`으로 표현된다.
`misfire_grace_time`은 non-`None`일 때만 전달한다(`None`을 넘기면 APScheduler가 무제한으로 해석).

영속화는 **`batch_schedules`**(`job_id` PK, `data` jsonb) —
`backend/services/storage/schedule.py`의 `get_batch_schedule`/`save_batch_schedule`
(`ON CONFLICT DO UPDATE`)/`get_all_batch_schedules`. `_seed_batch_schedules`(86-95)는
행이 없을 때만 쓰고 **절대 덮어쓰지 않는다**. `_seed_spec_for`(43-83)에 레거시 승계가 있다:
`daily_report_kr/_us`는 은퇴한 통합 `daily_report` 행에서 `enabled`·`days`를 물려받되
`time`은 레지스트리 기본값으로 override하고, `guru_crawl`은 `guru_schedules` 싱글톤을
weekly 스펙으로 변환하며, `earnings_kr/us`·`monthly_kr/us`는 은퇴한
`earnings_refresh`/`monthly_refresh` 행을 그대로 물려받는다.
→ **옛 id를 *읽는* 시드 마이그레이션은 정당한 잔존**이다("잔존 0"은 stale *소비* 기준).

기동 갭 복구 `_check_missed_report_for(job_id, market)`(98-145):
오늘 KST 요일이 스펙 `days`에 있고 예정 시각이 지났으면 `snapshots`를 조회해
**누락 종목만** 사용자별로 재생성한다(과거의 "하나라도 있으면 전체 스킵" 로직이
부분 누락을 방치했다).

### 6.2 실행 이력 — `backend/services/job_runs.py`

테이블 **`job_runs`**, `KEEP = 20`(job_id별 최신 20행만 유지).
`record(job_id, trigger)`는 `run_id`를 yield하는 contextmanager:
`INSERT ... status='running' RETURNING id` → 프루닝 DELETE → 정상 종료 시 `status='success'`,
예외 시 `status='failed'` + `error` 저장 후 **재전파**.
상태 `running|success|failed`, 트리거 `auto|manual`.
쓰기 경로는 graceful degrade — 계측 실패 시 `run_id = None` sentinel로 두고 배치 본문은 계속 돈다.

⚠️ **docstring(25-30줄)이 관측 구멍을 명시한다**: `failed`는 본문이 예외를 *전파*할 때만 기록되는데,
`jobs.py`의 잡 본문 상당수가 `try/except → logger.warning`으로 예외를 **삼킨다**.
따라서 부분/전체 실패가 `success`로 기록된다 —
*"허브의 success를 '내부 오류 없음'으로 과신하면 안 된다."*
읽기: `recent(job_id, n=20)`, `recent_map(job_ids)`(`ROW_NUMBER() OVER (PARTITION BY ...)`).
`trigger="manual"` 호출처는 라우터 전반 27곳(`report.py`·`market_indicators.py`·`stocks.py`·
`rankings.py`·`analysis.py`·`recommendations.py`·`investor.py`·`short_sell.py`·`digest.py`·
`guru.py`·`leverage_service.py`:210).

### 6.3 배치 레지스트리 — `backend/services/batch_registry.py`

`BATCHES` **29개**(모듈 docstring은 "20개"라 stale). 각 항목이 `market`(KR/US/공통)·
`source`(fetch 출처)·`usage`(소비 UI)를 갖고 `GET /api/batches`가 그대로 노출한다.
분류는 **출처국 기준**이라 FRED 경제지표는 `monthly_us`다.
`_JOB_FUNCS`(`backend/scheduler/jobs.py`:485-514)는 **28개** — `consensus`만 없다
(`scheduler_job_id: None`, daily_report_kr/us에 내장).

| id | market | source | 기본 스케줄 |
|----|--------|--------|-------------|
| `daily_report_kr` | KR | 키움, KIS, Naver, FnGuide | 주 mon–fri 20:30 (`enabled: False`) |
| `daily_report_us` | US | yfinance, Finviz | 주 mon–fri 07:00 (`enabled: False`) |
| `consensus` | 공통 | FnGuide, Naver, yfinance | 없음(`editable: False`) |
| `daily_digest` | 공통 | 보유종목 시세 집계 | 매일 08:00 |
| `backlog_fetch` | KR | DART | 주 일 04:00 |
| `dividend_fetch` | 공통 | yfinance, DART | 주 일 05:00 |
| `beta_fetch` | 공통 | yfinance, 키움 | 주 일 05:30 |
| `disclosure_fetch` | KR | DART | 매일 07:30 |
| `agm_fetch` | KR | DART | 매일 08:00 |
| `insider_fetch` | KR | DART | 매일 07:45 |
| `earnings_kr` | KR | Naver | 주 일 03:00 |
| `earnings_us` | US | yfinance | 주 일 03:00 |
| `monthly_kr` | KR | 관세청, UN Comtrade | 월 1일 02:00 |
| `monthly_us` | US | FRED | 월 1일 02:00 |
| `macro_signals_fetch` | US | FRED | 매일 06:00 |
| `kospi_signal_fetch` | KR | yfinance | 주 mon–fri 08:30 |
| `leverage_fetch` | KR | KOFIA | 매일 07:00 (auto only) |
| `lending_fetch` | KR | 금융위 | 월 5일 08:00 (auto only) |
| `kr_rankings_fetch` | KR | Naver | 10분 간격, 9–15시 |
| `us_rankings_fetch` | US | yfinance | 10분 간격, 9–16시 (**`America/New_York`**) |
| `investor_trend_fetch` | KR | 키움, Naver | 매일 18:00 |
| `short_sell_fetch` | KR | 키움 | 매일 18:30 |
| `supply_score_fetch` | KR | 키움, Naver | 매일 19:00 |
| `kr_sector_fetch` | KR | 키움 | 매일 16:00 |
| `us_sector_fetch` | US | yfinance | 매일 07:20 |
| `guru_crawl` | 공통 | dataroma | 주 일 03:00 (`enabled: False`, auto only) |
| `recommendation_kr` | KR | Naver, 키움, yfinance, DART | 매일 20:30 |
| `recommendation_us` | US | yfinance, dataroma | 매일 07:00 |
| `us_supply_fetch` | US | yfinance | 주 일 06:00 |

집계: KR 15 · US 8 · 공통 6. 카테고리: report 12 · market 16 · guru 1.
`misfire_grace_time = 82800`(23시간)은 `daily_report_kr/us`에만.

**배치 id·source 관리 규칙**
- fetch 소스를 바꾸면 그 배치의 **`source`도 갱신(DoD)** — 안 하면 배치 현황이 틀린 출처를 표시한다.
  `source`(어디서 끌어오는가) ↔ `usage`(어디서 쓰는가)는 **반대 방향**이다.
- id를 **빼면** 그 id를 쓰는 모든 표면을 전수 grep: ① 데이터 read ② 표시 문자열(`schedule_desc`)
  ③ **`job_runs.record(id, ...)` 모든 lane — auto뿐 아니라 manual·backfill까지** ④ 그 id를 단언하는 테스트.
  옛 id로 record하면 배치 현황 실행이력에서 조용히 증발한다.
- id를 **추가할 때도** 테스트의 count/set 하드코딩을 전수 grep:
  `grep -rn "BATCHES) ==\|len(data) ==\|EXPECTED_IDS" backend/tests/` — exact-count 단언이
  `test_scheduler_seed`·`test_batch_market_split`·`test_batches_router`·`test_macro_signals_batch`
  4파일에 흩어져 있다.
- **요청·기동 경로에서 외부 API를 라이브 호출하지 말 것** — 배치가 사전계산해
  `market_cache`/테이블에 저장하고 요청은 저장값만 읽는다. 외부 fetch 실패는 조용히 삼키지 말고
  로깅하고, 빈/all-None 결과는 캐시에 박제하지 않는다(§3.1).

---

## 7. 네트워크 · 인프라

### 7.1 Cloudflare Tunnel (현행 외부 노출 경로)

`portfolion.taebro.com` → `localhost:80`. **compose 컨테이너가 아니라 호스트 launchd로 실행**되며
레포에 plist가 없다(설정은 호스트 `~/Library/LaunchAgents`). 참조: `README.md`:16, `CLAUDE.md`:123-124,
`CLAUDE_COWORK_API.md`:5(Base URL). 토큰은 소스 밖에서 관리된다.
TLS를 Cloudflare가 종단하므로 `nginx/nginx.conf`의 443 블록은 **전체 주석 처리**돼 있다.

### 7.2 nginx (`nginx/nginx.conf`)

전체 교체 conf(`/etc/nginx/nginx.conf`에 마운트). 단일 `:80` 서버, `server_name _`.
- `/.well-known/acme-challenge/` → `/var/www/certbot`
- `/health`, `/api/` → `proxy_pass http://backend:8000`
  (`Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` 전달)
- `= /index.html` 및 `~* ^/(sw\.js|workbox-[^/]+\.js)$` → `no-cache, no-store, must-revalidate`
  (해시 없는 파일명이라 캐시 금지)
- 해시 자산(`js|css|png|jpg|jpeg|gif|ico|svg|woff2?`) → `public, max-age=31536000, immutable`
- `/` → `try_files $uri /index.html`(SPA fallback)

컨테이너 간 이름 해석은 `deploy.sh`의 `--network-alias backend`(네트워크 `portfolion_default`)에 의존한다.

### 7.3 Cloudflare DNS API (보조 DDNS 경로)

`scripts/ddns_update.sh` — `https://api.cloudflare.com/client/v4/zones/{ZONE}/dns_records/{RECORD}`에
`PATCH`로 A 레코드를 현재 공인 IP(`https://api.ipify.org` 조회)로 갱신. 마지막 IP는
`/tmp/ddns_last_ip`에 캐시. env `CF_ZONE_ID`·`CF_RECORD_ID`·`CF_API_TOKEN`(하나라도 없으면 exit 1),
헤더 주석은 cron `*/5`를 제안한다. 현행 외부 접근은 Tunnel이 담당하므로 이 경로는 대체/보조다.

### 7.4 Let's Encrypt / certbot

`docker-compose.yml`의 4번째 서비스(`certbot/certbot`):
`trap exit TERM; while :; do certbot renew; sleep 12h & wait $${!}; done`.
볼륨 `./certbot/conf`(gitignored — 인증서·계정키), `./certbot/www`.
nginx가 두 볼륨을 `:ro`로 마운트한다. 443 블록이 주석이라 현재 실사용 경로는 아니다.

### 7.5 배포 경로 (GitHub Actions + 폴러)

- **주 경로**: `.github/workflows/deploy.yml` — `push: [main]` → `runs-on: self-hosted` →
  하드코딩 경로 `cd /Users/calmonion/Project/PortfoliOn` → `git fetch origin` →
  `git reset --hard origin/main` → `bash deploy.sh`. checkout 액션도 secrets 참조도 없다.
  전용 러너는 `~/actions-runner-portfolion`(launchd `actions.runner.calmonion7-PortfoliOn.macbook-portfolion`).
- **폴백**: `scripts/auto-deploy-poll.sh`(launchd `com.portfolion.auto-deploy-poll`, 2분).
  `/tmp/portfolion-deploy.lock`이 있으면 skip, `HEAD != origin/main`이면(**양방향**)
  `git reset --hard origin/main` 후 `deploy.sh`. 로그는
  `~/Library/Logs/com.portfolion.auto-deploy-poll.log`.
  → 메인 체크아웃의 **커밋 안 한 tracked 편집과 push 안 한 로컬 커밋 모두** 다음 폴(≤2분)에 소실된다.
  `.forge/` 등 untracked는 `reset --hard` 대상이 아니라 안전.
- 두 경로가 **같은 락 파일**을 공유해 동시 배포를 막는다.
- 배포가 안 되면 폴러 footgun을 단정하기 전에 **러너부터 의심**할 것:
  `gh run list`(잡이 `queued`/`cancelled(24h)`면 러너 부재),
  `gh api repos/calmonion7/PortfoliOn/actions/runners --jq '.runners[]|{name,status}'`.
  단 커밋 소실 판정은 `git log -1`이 아니라 **`git rev-parse HEAD` vs `origin/main` + `gh run list`**로.

### 7.6 프론트 서빙 경로

nginx가 `frontend/dist`를 `:ro` 볼륨마운트로 직접 서빙하므로 로컬
`cd frontend && npm run build`가 **즉시 라이브**다(서빙 번들 해시 = 로컬 빌드 해시로 검증 가능).
**백엔드 변경은 재배포 후에야 라이브**이므로, 프론트만 먼저 빌드하면 백엔드 의존 기능이 미동작한다.
`deploy.sh`가 `docker run`으로 backend/nginx를 교체하므로 **backend 컨테이너는
`docker compose ps`에 안 잡힌다** — uptime은 `docker ps`로 확인한다.

---

## 8. 라이브 UAT 하니스 (연동 검증 수단)

- **서비스워커가 `/api/*`를 가로챈다**(`frontend/vite.config.js` `runtimeCaching`) →
  Playwright `page.route` 응답 인터셉트가 안 먹는다. 응답 주입 기반 UAT는 컨텍스트를
  **`serviceWorkers: 'block'`** 으로 만들 것.
- 테스트 계정은 **비admin**(`test@portfolion.com`)이라 **admin 전용 표면은 원리적으로 UAT 불가**다.
  착수 전에 셋 중 하나를 골라 DoD에 적을 것: ① 게이트를 `require_admin_or_api_key`로 열어
  API 키로 positive 검증(Cowork-facing 쓰기 컨벤션과 맞을 때만 — `require_admin`은 **API 키를 거부**한다)
  ② vitest + 기능경로 API로 닫고 버튼 렌더는 사용자 화면 확인으로 이월 ③ admin 크레덴셜을 받음.
- 컨테이너 라이브 프로브 관용구:
  `docker exec -i portfolion-backend-1 python - < probe.py`.
  외부데이터 증상("다른 지표는 다 나오는데 하나만 빈")은 **라이브 프로브 선행** —
  히스토리 부족(행수 < 14)과 fetch 실패(0행)가 즉시 갈린다.
- 라이브 프로브도 **fetch 200뿐 아니라 응답 봉투 파싱까지** 확인해야 완성이다(§2.5의 output1/2/3 함정).
- `app.routes`를 순회하는 감사 스크립트는 **배포 환경에서도 돌려 숫자가 실제로 나오는지** 확인할 것 —
  FastAPI 0.138.1에서 0을 세고 그게 거짓 통과로 보인다(`STACK.md` §1.1).

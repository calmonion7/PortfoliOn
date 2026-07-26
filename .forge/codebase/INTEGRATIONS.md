---
last_mapped_commit: e815fb8e452f74713f9082fafeeb9e7d60334d0e
mapped: 2026-07-26
---

# INTEGRATIONS — 외부 API·데이터 소스·DB·인증·트리거

외부 연동 실측 매핑. 엔드포인트 스키마 세부는 `API_SPEC.md`(전체 REST)·`CLAUDE_COWORK_API.md`(Cowork/루틴 쓰기 API)를 참조. 도메인 용어 정의는 `.forge/CONTEXT.md` 소관. **시크릿 값 미기재 — 변수명만.**

## 1. 시세 소스 (주가·재무·배당)

| 소스 | 소유 모듈 | 인증 키 | 실패/폴백 |
|------|-----------|---------|-----------|
| **yfinance** (US 1차 · 지수 · ETF) | `backend/services/market/us.py`, `market/__init__.py`, 그 외 **19개 모듈** import | 없음 | 예외 → 호출측 graceful(`_us_none_quote`), US quote는 **KIS 백업**으로 폴백 |
| **키움 REST** (KR 1차) | `backend/services/kiwoom/` — `client.py`·`quote.py`·`chart.py`·`investor.py`·`sector.py`·`shortsell.py` | `KIWOOM_APP_KEY`·`KIWOOM_SECRET_KEY`(+`KIWOOM_BASE_URL`) | `configured()` False면 휴면 → KIS/Naver 폴백. `return_code≠0` → `KiwoomError` |
| **KIS 한국투자증권** (KR+US 백업 · 국내선물) | `backend/services/kis/` — `client.py`·`quote.py`·`futures.py` | `KIS_APP_KEY`·`KIS_APP_SECRET`(+`KIS_BASE_URL`) | 키 미설정이 **안전 기본값**(휴면, 기존 동작 무변화). `rt_cd≠"0"` → `KisError` |
| **Naver** (KR 폴백 · 리서치 · 뉴스 · 랭킹 · US 종목명) | `backend/services/market/kr.py`, `ranking_service.py`, `investor_service.py`, `consensus_pipeline.py`, `scraper.py`, `guru_scraper.py`, `market_indicators/earnings.py`, `routers/stocks.py:99` | 없음(공개 API, `Referer: m.stock.naver.com` 헤더 필수) | 예외 → 호출측 None/빈 결과. `_kr_basic_naver`는 retry-once |
| **FnGuide** (KR 시총 폴백 · 컨센서스) | `backend/services/market/kr.py:33,626`(`SVD_main.asp`·`SVO2 JSON`), `consensus_pipeline.py:125` | 없음(`Referer: comp.fnguide.com`) | 예외 → `logger.warning` + 빈 결과 |
| **open.er-api.com** (USD/KRW 현물 폴백) | `backend/services/market_indicators/fx.py:14` | 없음 | yfinance FX 실패 + 저장 히스토리 없을 때만 호출 |

### 키움 클라이언트 (`backend/services/kiwoom/client.py`)

- 베이스 `https://api.kiwoom.com`, 토큰 `POST /oauth2/token`(인프로세스 싱글톤, 캐시 12h, 401 시 강제 재발급 1회 재시도), 요청 `POST /api/dostk/{category}` + 헤더 `api-id`/`authorization`. 직렬 throttle `_MIN_INTERVAL 0.25s`. 페이지네이션 `request_paged(..., list_key, max_items)`(`cont_yn`/`next_key`).
- `integrated_code(stk_cd, regular=False)` — 단일 분기점. 기본 `_AL`(SOR/NXT 확장시간), `regular=True`면 평문 KRX 코드(정규장 종가). 리포트 스냅샷 writer만 `regular=True` opt-in(ADR-0020).
- 사용 TR: `ka10001`(주식기본정보) · `ka10081/82/83`(일·주·월봉) · `ka10059`+`ka10008`(투자자 순매수·외국인 보유율) · `ka10014`(공매도 추이) · `ka20006`+`ka20002`(업종 일봉·업종별 주가). **읽기전용 조회 TR만** — 계좌·주문 미연동(ADR-0009).

### KIS 클라이언트 (`backend/services/kis/client.py`)

- 베이스 `https://openapi.koreainvestment.com:9443`(실전), 토큰 `POST /oauth2/tokenP`(캐시 23h, **발급 1분당 1회 제한 EGW00133 방어로 강제 재발급 60s 가드**, 401 재시도), 요청 `GET /uapi/...` + 헤더 `tr_id`/`appkey`/`appsecret`/`custtype=P`. throttle 0.05s.
- 사용 TR: `FHKST01010100`(국내 현재가) · `HHDFS00000300`+`HHDFS76240000`(해외 현재가·일봉, EXCD NAS→NYS→AMS probe) · **`FHMIF10000000`+`FHKIF03020100`(국내선물 현재가·일봉 — 응답이 `output1`/`output2`/`output3`으로 분할, 단수 `output` 아님)**.
- 경계: 읽기전용 시세만(ADR-0011, 선물은 ADR-0022).

### KR 시세 체인 (`backend/services/market/kr.py`)

- `get_quote_kr(ticker, exchange, regular)` → `_kr_pick_basic`(regular=False) / `_kr_pick_regular`(regular=True).
- 피드 함수 3종: `_kr_basic_kiwoom`(NXT `_AL` / KRX 평문) · `_kr_basic_kis` · `_kr_basic_naver`.
- regular=False는 **독립 피드 2-of-N 다수결**(`_corroborated_pick`, ±2x [0.5,2.0] 합의) + lazy escalation(평시 키움 2콜 → 불일치 시 KIS·Naver 추가). 전 피드 합의 불가/단일 피드면 `_kr_pick_degenerate_lazy`(자기 prev_close ±30% 자가검증).
- US 체인: `market/__init__.py:_get_quote_uncached` → yfinance → `us.py:_us_quote_kis`.

## 2. 공시·재무·기업 데이터 (DART)

베이스 `https://opendart.fss.or.kr/api`, 원문 뷰어 `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=…`. 인증 `DART_API_KEY`(KR 전용, 미설정 시 전부 휴면). status 013(무데이터)은 graceful 빈 리스트.

| 모듈 | DART 엔드포인트 | 산출 |
|------|-----------------|------|
| `backend/services/disclosures.py` | `list.json`(핵심유형 A·B·C·D **각각 개별 호출** — 응답이 `pblntf_ty`를 echo하지 않아 필터 불가) | `stock_disclosures`(rcept_no dedup upsert) |
| `backend/services/agm.py` | `list.json`(**pblntf_ty 미지정** no-type 호출) + `document.xml` 본문 회의일 2전략 파싱 | `stock_disclosures.meeting_date` → 캘린더 `agm` 이벤트 |
| `backend/services/backlog.py` | `corpCode.xml`(코드 매핑) · `list.json` · `document.xml`(ZIP 전 멤버 디코드) · `fnlttSinglAcnt.json`(재무 컨텍스트) | `backlog_history`(`source='dart'` 자동추출 / `'pending'`) |
| `backend/services/insider_trades.py` | `elestock.json`(임원·주요주주) · `majorstock.json`(5%룰) | `stock_insider_trades`(결정적 `row_hash` 멱등 upsert) |
| `backend/services/dividends.py` | `alotMatter.json`(KR 배당) | `stock_dividends`·`stock_dividend_schedule` |
| `backend/services/market/kr.py:481` | `fnlttSinglAcntAll.json`(**요청에 `fs_div` 필수**, 응답은 행별 `fs_div` echo 없음) — `account_id` 매칭(`ifrs-full_*`) | 연간 FCF·CapEx·이자보상 |
| `backend/services/market/kr.py:563` | `list.json` + 사업보고서 원문 | R&D 집약도(`get_rd_intensity_kr`) |

- `corp_code` 매핑은 `backlog._get_corp_code_map()`이 소유하고 disclosures·agm·insider_trades가 재사용.

## 3. 거시·경제·시장지표

| 소스 | 모듈 | 키 | 실패/폴백 |
|------|------|-----|-----------|
| **FRED** `api.stlouisfed.org/fred/series/observations` | `market_indicators/econ.py`(경제지표) · `macro.py`(`T10Y2Y`·`BAMLH0A0HYM2`·`M2SL`·`DFF`) | `FRED_API_KEY` | 키 없으면 `{"error": …}`/저장값 반환. fetch 실패 시 `stored_data` 유지 |
| **FRED** `/fred/releases/dates` | `backend/routers/calendar.py:234`(`_get_econ_events`) | `FRED_API_KEY` | 실패 시 `logger.warning` + 이벤트 생략. **FOMC 날짜는 `_FOMC_DATES` 정적 목록이라 키 없어도 항상 포함** |
| **KOFIA / 공공데이터포털** `apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService` + `GetMarketIndexInfoService` | `backend/services/leverage_service.py`, `backend/run_backfill.py` | `KOFIA_API_KEY` | 미설정 시 요청 실패 → `market_leverage_indicators` 미갱신 |
| **금융위원회** `apis.data.go.kr/1160100/GetStocLendBorrInfoService_V2` | `backend/services/lending_service.py` | `KOFIA_API_KEY`(공용) | 실패 시 `market_lending_balance` 미갱신 |
| **관세청** `apis.data.go.kr/1220000/Itemtrade/getItemtradeList` (XML) | `market_indicators/exports.py:40` | `KITA_API_KEY`(**이름과 달리 관세청 키**) | 키 없거나 실패 → UN Comtrade 폴백 → 그것도 실패 시 `_mc_load` 직전값, 없으면 `{"months":[], "error":…}` |
| **UN Comtrade** `comtradeapi.un.org/public/v1/preview/C/M/HS` | `market_indicators/exports.py:13` | 없음 | 위 폴백 체인의 2차 |
| **CNN Fear & Greed** `production.dataviz.cnn.io/index/fearandgreed/graphdata` | `market_indicators/sentiment.py` | 없음(브라우저 위장 헤더 + `edition.cnn.com` Origin/Referer) | **VIX식 수동 폴백**(성공 시 `_mc_save`, 실패 시 `_mc_load` 직전값, 없으면 None) — `get_or_refresh`는 stale-fallback 안 하므로 필수 |
| **multpl.com** `www.multpl.com/shiller-pe` (BeautifulSoup 크롤) | `market_indicators/indices.py:101` | 없음 | FRED엔 S&P CAPE 시리즈 없음. 실패 시 `if any(v is not None)` 지속 가드로 last-good 유지 |
| **yfinance 지수** `^GSPC`·`^KS11`·`^KQ11`·`^IXIC`·`^SOX`·`USDKRW=X`·`^VIX`·원자재·국채 | `market_indicators/indices.py`·`fx.py`·`commodities.py`·`kospi_signal.py` | 없음 | `_yf_close_history` 증분 병합, 빈 응답 시 저장 히스토리 반환 |
| **Wikipedia** `en.wikipedia.org/wiki/List_of_S%26P_500_companies` | `market_indicators/earnings.py:54` | 없음 | 예외 → graceful |
| **Naver 시장 스냅샷** `finance.naver.com/sise/sise_market_sum.naver`·`m.stock.naver.com/api/stocks/marketValue` | `market_indicators/earnings.py:78`, `ranking_service.py:17` | 없음 | 페이지 일부 실패 시 `_fetch_naver_market`가 `RuntimeError`(빈 결과 박제 방지) |

### `market_cache` 캐시 규약 (`backend/services/market_indicators/cache.py`)

- 2단 캐시: 인메모리 `_get_cache/_set_cache(ttl)` → DB `_mc_load/_mc_save`(테이블 `market_cache`, key PK upsert + `fetched_at`).
- `get_or_refresh(key, fetch_fn, ttl)`는 "저장값 있으면 fetch 스킵"만 한다 — **fetch 실패 시 직전값 폴백은 안 함**(실패 전파). 취약한 소스는 수동 폴백 패턴 필수(`fx.py`·`sentiment.py`·`kospi_futures.py`).
- 히스토리는 `_merge_history`(date 키 병합) + `_filter_outliers`(중앙값 ±5x) + 366일 트림.
- 사용 키(실측): `fx`·`vix`·`commodities`·`treasury`·`econ_indicators`·`macro_signals`·`kr_exports`·`m7_earnings`·`kr_top2_earnings`·`indices`·`fear_greed`·`kospi_futures`·`kospi_signal`·`kr_sector_momentum`(`kr_sector_service.py`)·`us_sector_momentum`(`us_sector_service.py`).
- ⚠️ 값 수준 가드: `kospi_futures.py`는 `rt_cd=0`인데 `output1`/history가 비면 `_mc_save`를 **생략**하고 last-good을 반환(성공-but-빈응답 클로버 방지, wrong<missing).

## 4. 스크레이핑 · 기타

| 소스 | 모듈 | 용도 |
|------|------|------|
| **Dataroma** `www.dataroma.com/m` | `backend/services/guru_scraper.py`, `recommendation/universe.py` | 구루 운용역·보유 종목, US 추천 유니버스 |
| **Finviz** `finviz.com/quote.ashx` | `backend/services/scraper.py:19` | US 컨센서스 스냅샷(`snapshot-table2`) |
| **Naver 뉴스** `m.stock.naver.com/api/news/stock/{ticker}` → `n.news.naver.com/mnews/article/...` | `backend/services/scraper.py:63,91` | 종목 뉴스 |
| **Naver US** `api.stock.naver.com/stock/{code}/basic` | `guru_scraper.py:21` | US 종목 한글명(`.O` 서픽스 재시도) |

## 5. 알림 · 트리거 (outbound)

| 대상 | 모듈 | 키 | 실패 |
|------|------|-----|------|
| **Telegram** `api.telegram.org/bot{token}/sendMessage` | `backend/services/digest_service.py:308` (`send_telegram`) | `TELEGRAM_BOT_TOKEN`·`TELEGRAM_CHAT_ID` | 둘 중 하나라도 없으면 조용히 return. 예외는 `logger.warning`. ⚠️ **`.env.docker`에 이름 없음 → 현재 휴면** |
| **루틴 fire** (로컬 헤드리스 `claude -p`) | `backend/services/cowork_trigger.py` → `scripts/cowork-fire-listener.py` | `COWORK_ROUTINE_FIRE_URL`·`COWORK_ROUTINE_FIRE_TOKEN` | `configured()` False면 no-op. HTTP≥300·예외 모두 `logger.warning` + `False`, **절대 raise 안 함** |

### 루틴 fire 파이프라인 (ADR-0028 개정본)

- 발신: ① `backend/scheduler/jobs.py:39-43` — `_generate_all` 종료 직후, **`job_runs.record` 블록 밖**(배치 성공/실패와 독립). ② `POST /api/admin/cowork/fire`(`backend/routers/admin.py:228-240`, `require_admin_or_api_key`; 미설정 **503**, fire 실패 **502**).
- 페이로드 `{"text": …}` + `Authorization: Bearer {…FIRE_TOKEN}`, timeout 15s. 현행 URL은 `host.docker.internal:8787/fire`(컨테이너→호스트).
- 수신: `scripts/cowork-fire-listener.py` — **`127.0.0.1:8787`**, `POST /fire`만(그 외 404), Bearer 검증(`backend/.env.docker`의 `COWORK_ROUTINE_FIRE_TOKEN`과 대조, 불일치 401). body `text`는 4000자 절단.
- 실행: `scripts/cowork-routine-prompt.md`를 읽어 `{{COWORK_API_KEY}}`를 spawn 시점에 치환 → `subprocess.Popen(["claude","-p",prompt,"--model","sonnet","--allowedTools","Bash,WebSearch,WebFetch,Read,Write"])`, `cwd=~/portfolion-routine-runs/<타임스탬프>/`, stdout/stderr→`run.log`, `start_new_session=True`. **대기 없이 200 반환**(fire-and-forget, 콜백 없음 · 큐 없음 → 동시 fire는 병렬 spawn).
- 프롬프트 정책: BASE `https://portfolion.taebro.com`, `X-API-Key` 헤더, curl만 허용(레포/파일시스템 작업 금지). 2단계 — ① enrich rolling(`enriched_at` null 우선·오래된 순 **최대 5종목**, 8개 한글 필드 `PUT /api/stocks/enrich/batch` 후 `POST /api/report/generate` 필수) ② 발행(`analyst_target=true` 종목만, 최신 발행 7일+ 또는 유의미 변화, **회당 최대 2종목**, 409 시 리포트 재생성 후 5분 뒤 1회 재시도).
- 관측 수단 = `enriched_at`·발행물 존재 여부(사후 확인)뿐.

## 6. 인증 · 인가

| 방식 | 소유 모듈 | 키 |
|------|-----------|-----|
| 로컬 계정 | `backend/services/auth_service.py` — `bcrypt` 해시 + JWT **HS256**(`jose.jwt`), `refresh_tokens` 테이블 | `JWT_SECRET` |
| Google OAuth | `backend/routers/auth.py:142-182` — `accounts.google.com/o/oauth2/v2/auth` → `oauth2.googleapis.com/token`(httpx), redirect `FRONTEND_URL + /api/auth/oauth/google/callback` | `GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET` |
| GitHub OAuth | `backend/routers/auth.py:189-229` — `github.com/login/oauth/authorize` → `/access_token` → `api.github.com/user`·`/user/emails` | `GITHUB_CLIENT_ID`·`GITHUB_CLIENT_SECRET` |
| 세션 | `SessionMiddleware`(`backend/main.py:262`) + `routers/auth.py:45` `_HMAC_SECRET` | `SESSION_SECRET` |
| 외부 쓰기(Cowork/루틴) | `X-API-Key` 헤더 검증(`backend/auth.py:44`), 사용자 sentinel `__api_key__` | `COWORK_API_KEY` |

- **FastAPI 의존성 4종**(`backend/auth.py`): `get_current_user`(Bearer JWT만) · `get_current_user_or_api_key`(API-Key 또는 JWT) · `require_admin`(`users.role == 'admin'`) · `require_admin_or_api_key`.
- OAuth 콜백은 임시 코드 저장(`_store_oauth_tokens`, TTL 120s) 후 프론트가 `/api/auth/oauth/token`으로 교환. `upsert_oauth_user(email, provider, sub)`가 `users` upsert.
- 메뉴 권한: `user_menu_permissions`(+`default_menu_permissions`) — `PUT /api/admin/users/:id/permissions`, 허용 목록은 `backend/routers/admin.py`의 `ALL_MENUS`. 프론트 `frontend/src/contexts/AuthContext.jsx`가 `GET /api/auth/me`로 로드해 nav 필터.
- ⚠️ `ANTHROPIC_API_KEY`는 `.env.docker`/example에 잔존하나 **코드 참조 0**(백엔드 LLM 호출 없음).
- ⚠️ `authlib`가 requirements에 있으나 import 0 — OAuth는 httpx 직접 구현.

## 7. PostgreSQL 16

- 드라이버·풀: `backend/services/db.py` — `ThreadedConnectionPool(minconn=1, maxconn=20, dsn=os.environ["DATABASE_URL"])`, `RealDictCursor`, `execute_batch`. 헬퍼 `query`/`execute`/`execute_many` + `get_connection()`(commit/rollback/putconn).
- 스키마 실행 순서 `backend/auth_schema.sql` → `backend/app_schema.sql`(compose init, 빈 pgdata 초회만). **라이브 반영 정본은 `backend/main.py:_migrate()`** 의 idempotent DDL.

### 테이블 (auth_schema 2 + app_schema 31, `_migrate` 포함)

| 그룹 | 테이블 |
|------|--------|
| 인증·권한 | `users`, `refresh_tokens`, `user_menu_permissions`, `default_menu_permissions` |
| 종목·포트폴리오 | `tickers`(공유 마스터 — `enriched_at`·`moat`·`key_resource`·`competitor_edge`·`market_outlook`·**`analyst_target`**), `user_stocks`(`type`·`target_price`·`stop_price`·`target_weight`·`pinned`) |
| 리포트·발행물 | `snapshots`(ticker+date JSON), `raw_reports`, **`analyst_reports`**(`ticker`+`published_date` UNIQUE, `rating`·`title`·`fair_value_low/high`·`valuation_method`·`points` JSONB·`risks`·`data` JSONB) |
| 스케줄·실행이력 | `schedules`, `guru_schedules`, `guru_managers`, `batch_schedules`, `job_runs` |
| 컨센서스·다이제스트 | `consensus_history`, `daily_consensus_mart`, `digests` |
| 캘린더·공시 | `calendar_cache`(user_id+month), `stock_disclosures`(`rcept_no` PK + `meeting_date`) |
| 시장지표 | `market_cache`(key PK), `market_leverage_indicators`, `market_lending_balance`, `market_rankings`, `market_investor_trend`, `market_short_sell` |
| 종목 부가데이터 | `stock_dividends`, `stock_dividend_schedule`, `stock_beta`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`(+`low_liquidity`·`exchange`·`name`), `backlog_history`(+`segments` JSONB), `us_supply_snapshot`(+`insider_transactions`·`insider_net`) |
| 행동 로그 | `user_events`(`backend/routers/events.py` `VALID_EVENTS` 화이트리스트, `backend/middleware/event_tracker.py`) |

- 로컬 파일 캐시(gitignored): `backend/data/consensus/`(per-ticker) · `backend/snapshots/`(per-ticker/date JSON) · `backend/reports/`(레거시 read-only). 캘린더 파일 캐시는 제거됨(`backend/data/calendar/`는 빈 디렉터리 잔존) — 라이브 캐시는 `calendar_cache` 테이블.
- 정적 참조(커밋): `backend/data/sp500_tickers.json` · `backend/data/kospi_tickers.json`. 그 외 `backend/data/*.json`(holdings·watchlist·stocks·guru_managers·schedule·kr_exports)은 gitignore된 레거시 파일 store 잔존물.

## 8. 배치 ↔ 외부 소스 매트릭스

`backend/services/batch_registry.py`의 29 엔트리. `source`=fetch 출처(변경 시 레지스트리도 갱신해야 배치 현황이 정확), `usage`=소비 UI. 요청 경로는 **저장값만 읽고** 외부 fetch를 하지 않는 것이 원칙.

| 배치 id | 외부 소스 | market | 기본 스케줄 |
|---------|-----------|--------|-------------|
| `daily_report_kr` | 키움·KIS·Naver·FnGuide | KR | mon–fri 20:30 (**기본 disabled**) |
| `daily_report_us` | yfinance·Finviz | US | mon–fri 07:00 (**기본 disabled**) |
| `consensus` | FnGuide·Naver·yfinance | 공통 | 스케줄 없음(daily_report 내부) |
| `daily_digest` | (보유종목 시세 집계) + Telegram 발신 | 공통 | daily 08:00 |
| `backlog_fetch` | DART | KR | sun 04:00 |
| `dividend_fetch` | yfinance·DART | 공통 | sun 05:00 |
| `beta_fetch` | yfinance·키움 | 공통 | sun 05:30 |
| `disclosure_fetch` | DART | KR | daily 07:30 |
| `agm_fetch` | DART | KR | daily 08:00 |
| `insider_fetch` | DART | KR | daily 07:45 |
| `earnings_kr` / `earnings_us` | Naver / yfinance | KR / US | sun 03:00 |
| `monthly_kr` / `monthly_us` | 관세청·UN Comtrade / FRED | KR / US | 매월 1일 02:00 |
| `macro_signals_fetch` | FRED | US | daily 06:00 |
| `kospi_signal_fetch` | yfinance(`^GSPC`·`^IXIC`·`USDKRW=X`·`^SOX`·`^KS11`) | KR | mon–fri 08:30 |
| `leverage_fetch` | KOFIA | KR | daily 07:00 (auto만) |
| `lending_fetch` | 금융위 | KR | 매월 5일 08:00 (auto만 — 단 `POST /api/market/lending/sync` 수동 경로 존재) |
| `kr_rankings_fetch` / `us_rankings_fetch` | Naver / yfinance | KR / US | 10분 간격(9–15시 / 9–16시 **`America/New_York`**) |
| `investor_trend_fetch` | 키움·Naver | KR | daily 18:00 |
| `short_sell_fetch` | 키움(`ka10014`) | KR | daily 18:30 |
| `supply_score_fetch` | **외부 호출 없음**(저장 시계열 파생) | KR | daily 19:00 |
| `kr_sector_fetch` / `us_sector_fetch` | 키움 / yfinance | KR / US | daily 16:00 / 07:20 |
| `guru_crawl` | dataroma | 공통 | sun 03:00 (**기본 disabled**, auto만) |
| `recommendation_kr` / `recommendation_us` | Naver·키움·yfinance·DART / yfinance·dataroma | KR / US | daily 20:30 / 07:00 |
| `us_supply_fetch` | yfinance(`info`·`institutional_holders`) | US | sun 06:00 |

- 기동 시드(빈 캐시 채움): `_seed_rankings_if_empty`(Naver·yfinance) · `_seed_kr_sector_if_empty`(키움) · `_seed_us_sector_if_empty`(yfinance).
- ⚠️ 대부분의 잡이 `job_runs.record` 블록 **안**에서 내부 예외를 삼켜, 전면 실패에도 `success`로 기록될 수 있다(`backend/services/job_runs.py:25-30` 주석).

## 9. inbound 웹훅

- 애플리케이션 레벨 웹훅 수신 엔드포인트는 **없다**. 외부에서 들어오는 트리거는 ① GitHub → self-hosted 러너(`.github/workflows/deploy.yml`, push 이벤트) ② 백엔드 → 로컬 리스너(`127.0.0.1:8787/fire`, §5) 두 경로뿐.

## 10. 참조 카탈로그

- `KIWOOM_API.md` — 키움 전체 API 카탈로그·대체 로드맵.
- `KIS_API.md` — KIS 전체 카탈로그.
- `API_SPEC.md` — 전체 REST 엔드포인트(source of truth). 존재 drift는 `backend/tests/test_api_doc_sync.py`가 자동검출.
- `CLAUDE_COWORK_API.md` — Cowork/루틴 enrich·backlog·발행 API(스코프: 외부 쓰기 워크플로우 전용).

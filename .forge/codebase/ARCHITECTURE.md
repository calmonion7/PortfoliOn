---
last_mapped_commit: b6193c3837f4125a41930c36a2b3ae2ef198dc3c
mapped: 2026-06-22
---

# ARCHITECTURE

PortfoliOn은 FastAPI 백엔드(포트 8000)와 React 19 + Vite 프론트(포트 5173)로 구성된 단일 저장소 풀스택 앱이다. 데이터는 Docker PostgreSQL 16에 영구 저장하고, 로컬 JSON(`backend/snapshots/`, `backend/data/`)은 런타임 캐시·폴백으로만 쓴다. 배포는 Mac 로컬 Docker 4-컨테이너(nginx·backend·postgres·certbot) + Cloudflare Tunnel.

## Backend — 패턴과 레이어

레이어 패턴은 `routers → services → db`의 단방향 의존이다.

- **Entry point**: `backend/main.py` — `FastAPI(lifespan=...)` 앱을 만들고, `lifespan`에서 ① `_migrate()`(기동 시 idempotent `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` DDL — `backlog_history.segments`, `batch_schedules`, `market_short_sell`, `stock_disclosures`, `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`) ② `scheduler.start()` ③ 백그라운드 스레드로 캘린더·시장지표 캐시 워밍을 실행한다. 미들웨어 2종을 `add_middleware`로 장착(`SessionMiddleware`, `EventTrackerMiddleware`) + CORS. 18개 라우터를 `app.include_router`로 마운트한다(`auth, portfolio, report, watchlist, stocks, guru, calendar, digest, market_indicators, analytics, analysis, events, rankings, investor, short_sell, batches, recommendations, admin`).
- **Routers** (`backend/routers/`): HTTP 표면. FastAPI `Depends`로 인증을 게이트한다 — `backend/auth.py`가 `get_current_user`(JWT HS256, `HTTPBearer`), `get_current_user_or_api_key`(JWT 또는 `_API_KEY_HEADER` 매칭 → `_API_KEY_USER_ID="__api_key__"`), `require_admin`, `require_admin_or_api_key`를 제공.
- **Services** (`backend/services/`): 도메인 로직. 외부 시세/스크래핑/DB 접근을 캡슐화. 라우터는 service 함수를 호출하고 service는 `services/db.py`로 DB에 접근한다.
- **DB** (`backend/services/db.py`): `psycopg2.pool.ThreadedConnectionPool`(minconn=1, **maxconn=20** — calendar 15·analysis 11 등 ThreadPool 동시성보다 크게; 풀 소진 시 블록이 아니라 `PoolError`를 던지므로). `@contextmanager get_connection()`(commit/rollback/putconn 자동), `query(sql, params)→list[dict]`(`RealDictCursor`), `execute(sql, params)→rowcount`. `DATABASE_URL` env로 연결.
- **Scheduler** (`backend/scheduler/` 패키지, 루트 레벨 — `services` 아님): APScheduler. `backend/main.py`가 `import scheduler as sched`로 직접 적재.

### services 패키지 분리 (ADR-0017)

구 단일 파일이던 `storage`·`market`이 패키지로 쪼개졌고, 패키지 `__init__.py`가 서브모듈의 공개 + 외부참조 private 심볼을 루트로 re-export해 `storage.X`/`market.X` 모듈 속성 접근 표면을 보존한다.

- `services/storage/`: `__init__.py`(re-export), `portfolio.py`(user_stocks/tickers CRUD·enrich), `names.py`(종목명 dual-source 동기화), `schedule.py`(스케줄·구루·배치 스케줄 행), `dates.py`(시장별 기대 리포트 날짜).
- `services/market/`: `__init__.py`(`get_quote`/`get_quotes_batch`/`get_history_df`/`get_financials`/`get_analyst_data`/`resolve_name` 등 공개 진입점), `format.py`(`_yf_sym`·`_norm_sector`·단위 변환), `kr.py`(KR 시세 소스 체인 + 발산 가드), `us.py`(US KIS 백업·none-quote).
- `services/market_indicators/`: `cache.py`(`_mc_load`/`_mc_save` — PostgreSQL `market_cache` 읽기/쓰기), `fx.py`, `commodities.py`, `earnings.py`, `econ.py`(FRED), `exports.py`(KR 수출), `macro.py`(FRED 매크로 신호 + `evaluate_signals`).
- `services/kiwoom/`: KR 읽기전용 시세 소스(ADR-0009). `client.py`, `quote.py`(ka10001), `chart.py`(ka10081/82/83 일봉/주봉/월봉), `sector.py`, `investor.py`, `shortsell.py`.
- `services/kis/`: KR+US 읽기전용 *백업* 시세 소스(ADR-0011). `client.py`, `quote.py`.
- `services/recommendation/`: `universe.py`·`scoring.py`·`funnel.py`·`store.py`·`actions.py`.

## 요청 → 시세(quote) → 스냅샷(snapshot) 흐름

핵심 파이프라인은 **시세 조회 → 일배치 스냅샷 박제 → 요청 시 저장값 read**다.

1. **시세 조회** — `services/market/__init__.py:get_quote(ticker, market, exchange, _t, regular)`가 종목 단위 TTL 캐시(`cache.get_quote_cached`, 60s, 키에 `regular` 포함 → 정규장/NXT 충돌 방지)를 거쳐 `_get_quote_uncached`로 위임. `market=="KR"`이면 `get_quote_kr`(아래 체인), 그 외는 yfinance `t.info`+`t.history("1y")`로 price·prev_close·daily/weekly/monthly 변동률·sector·marketCap을 만들고, yfinance 실패/빈값이면 `_us_quote_kis`(KIS 백업) → `_us_none_quote`.
2. **스냅샷 생성**(`services/report_generator.py:generate_report`) — 일배치(또는 admin 수동)가 호출. `ThreadPoolExecutor(max_workers=8)`로 quote·financials·annual·analyst·RSI·finviz(US)·news·경쟁사 quote를 병렬 조회한 뒤, `indicators.get_volume_profile`·20일 고점 등을 합쳐 `summary` dict를 만든다. **`summary["price"]`가 None이면 `ValueError("주가 데이터 없음")`로 그 종목을 그날 박제에서 제외**(`generate_report_with_retry`가 1회 재시도). 박제는 `_sanitize(summary)`(NaN/inf 제거) 후 ① 로컬 `snapshots/{ticker}/{today}.json` write ② `INSERT ... ON CONFLICT (ticker, date) DO UPDATE`로 `snapshots` 테이블 upsert.
3. **요청 시 read** — `GET /api/report/list`(`routers/report.py:list_reports`)는 `snapshots` 테이블에서 ticker별 최신 날짜·data를 읽어 목록을 만들고, 목표가·의견수는 `consensus_svc.apply_asof`로 `daily_consensus_mart`에서 as-of 보정(ADR-0008). 상세는 `GET /api/report/{ticker}/{date}`.

## 대시보드 `/api/stocks/dashboard` — graceful per-card build

`routers/stocks.py:get_dashboard`는 **holdings=N이면 항상 N카드를 반환하고 절대 500-to-empty로 무너지지 않는** 것이 설계 불변식이다(task#102).

- 응답 형태는 `{"holdings": [card...], "totals": {...}|null}`(holdings 없으면 `{holdings:[], totals:None}`). 결과는 `cache.get_dashboard(user_id, _build_all)`로 user당 300s 캐시.
- `_build_all()`: ① `market.get_quotes_batch(holdings)`(US는 `yf.download` 1콜 raw 종가, KR은 키움 일봉 종가 시리즈 1콜)를 시도하되 **throw해도 삼키고 `quotes={}`로 진행**(시세 없이 카드 빌드 → price None, 폴링이 채움). ② `ThreadPoolExecutor`로 종목별 `_safe(stock)`를 map.
- `_safe`는 `_build_card`(snapshot에서 RSI·volume_profile·목표가, `dividends.get_dividend` 저장값, KR이면 `supply_score.read_score`·`insider_trades.compute_net_signal`을 조합)를 시도하고, **그 카드 enrichment가 throw하면 그 종목만 `_minimal_card`로 폴백**(식별/보유 정보 + quote 시세, 나머지 None)해 전체 실패를 막는다.
- `_portfolio_totals`는 통화 혼재를 KRW로 환산(US$×`_usdkrw_rate`, KR×1). **US 카드에 환율이 없으면 그 종목을 총계에서 제외**(달러를 원으로 오합산 방지). FX는 저장 `market_cache 'fx'`만 읽어 요청 경로 라이브 FX 호출 0.

## KR 시세 소스 체인 + 발산 가드

`services/market/kr.py:get_quote_kr(ticker, exchange, regular)`가 KR 현재가의 단일 진입점이다. 소스 우선순위는 **키움 → KIS → Naver**이며(`_kr_basic_kiwoom`/`_kr_basic_kis`/`_kr_basic_naver` 각각 미설정/실패/빈 price면 None), 글리치 방어 가드가 `regular` 플래그로 갈린다.

- **`regular=False`(NXT 라이브, 대시보드 기본) — 독립 피드 2-of-N 다수결(task#98)**: `_kr_pick_basic`이 키움 NXT(`_AL`)와 키움 KRX(평문코드) 2콜을 먼저 받아 `_corroborated_pick`(어느 피드 가격이 *다른* 피드 ≥1개와 2x[0.5,2.0] 이내로 합의하면 trusted, trusted 중 우선순위 최상위 rank 반환)에 넣는다. NXT≈KRX 합의면 NXT를 반환(평소 경로, KIS/Naver 미호출). 불일치(어느 한쪽 글리치)면 KIS·Naver를 escalate해 최대 4피드 다수결로 합의된 최상위를 채택하고 outlier(글리치)를 폐기 — KRX-poison(KRX 단일 글리치)과 NXT 자기일관 전체오염을 둘 다 잡는다. 키움 부재/단일(글리치 아닌 outage)이거나 전 피드 합의 불가면 `_kr_pick_degenerate_lazy`(NXT→KIS→Naver→KRX 첫 `_price_sane` 통과, 단일 피드는 자기 전일종가 ±30% 자가검증).
- **`regular=True`(리포트 스냅샷, KRX 정규장, ADR-0020)**: `_kr_pick_regular` — 키움(KRX)→KIS→Naver 첫 유효 + `_price_sane`(① 전일종가 ±30% KR 일일 제한폭, ② 키움 일봉 종가의 [0.5,2.0] 독립 TR 교차검증). 이미 KRX 정규장가라 다수결·독립 KRX 교차검증은 미적용.
- **박제-시 독립피드 게이트**(report_generator, KR, task#101): `regular=True` 박제 직전에 KRX와 독립인 **Naver 현재가**로 `summary["price"]`·일봉 종가를 2x 교차검증. 어긋나면 `ValueError("KRX 시세 글리치 의심")`로 그 종목 박제를 스킵(직전 양호 스냅샷 유지, wrong<missing). KRX 두 TR(quote·일봉)이 함께 글리치하는 자기일관 오염은 같은 KRX 피드라 `_price_sane`이 못 잡으므로 이 게이트가 백스톱.
- **코드선택 단일 분기점**: `kiwoom/client.py:integrated_code(stk_cd, regular)` — 기본 False=`{code}_AL`(NXT 통합 SOR 코드), True=평문 KRX 코드. `regular`가 시세 체인(`get_quote`→`get_quote_kr`→`kiwoom.quote.get_quote`)과 차트 체인(`get_history_df`→`kiwoom.chart`)으로 전파된다. 리포트 writer만 `regular=True`로 opt-in(`report_generator`의 daily_df/get_quote/경쟁사, `report.py:refresh_analyst`); RSI·대시보드(`get_quotes_batch`)·종목추가·`resolve_name`은 NXT 기본 유지 → 같은 종목이 리포트와 대시보드에 ~1% 다른 현재가를 보일 수 있는 건 의도된 기준 차.
- **시세 정규화**: 키움 ka10001 응답은 부호 포함 문자열·시총 억원 단위라 `kiwoom/quote.py:normalize_basic`이 price=|cur_prc|, market_cap=mac×1e8 등으로 변환.

## 배치 / 스케줄러 흐름

`backend/scheduler/` 패키지(루트 레벨)가 APScheduler를 운영한다.

- `__init__.py:start()` — ① `_seed_batch_schedules()`(편집 배치에 `batch_schedules` 행 없으면 시드, idempotent 마이그레이션) ② editable 배치마다 `_reschedule_job` ③ `_check_missed_report()`(기동 시 시장별 당일 스케줄이 지났는데 스냅샷 없으면 즉시 보충) ④ `_seed_rankings_if_empty`·`_seed_kr_sector_if_empty` ⑤ `_scheduler.start()`.
- `_state.py`: `_scheduler`(BackgroundScheduler) 등 공유 상태(leaf 모듈 — 부분초기화 순환 회피).
- `jobs.py`: 모든 잡 함수(`_generate_kr`/`_generate_us`, `_run_digest`, `_fetch_*` 등)와 **`_JOB_FUNCS` dict**(job_id → 함수, 23개)를 정의. 각 잡은 `with job_runs.record(job_id, "auto"):` 컨텍스트로 실행 이력을 `job_runs` 테이블에 남기고 외부 fetch 실패를 로깅(silent except 금지).
- `schedule.py`: `_reschedule_job`(`batch_registry.get_batch`로 메타 조회 → `storage.get_batch_schedule` 스펙 → `_build_trigger`로 `CronTrigger` 생성 → `_scheduler.add_job`; disabled면 잡 제거만), `_build_trigger`(`schedule_spec.build_trigger_kwargs`), `_seed_spec_for`(기동 마이그레이션 — 옛 `daily_report`/`guru_schedules`/`earnings_refresh`/`monthly_refresh` 행을 신규 id로 승계), `_check_missed_report_for`.
- `services/batch_registry.py`: `BATCHES` 정적 메타데이터(20개) — job_id는 스케줄러 잡 id 및 `job_runs.record` id와 일치해야 한다. 각 배치에 `market`(KR/US/공통, 출처국 기준 — ADR-0013), `source`(fetch 출처), `usage`(소비 UI), `editable`, `default_schedule` 등. `GET /api/batches`가 그대로 노출.
- 일일 리포트는 시장별로 분리: `daily_report_kr`(기본 20:30 KST, NXT 마감 후)·`daily_report_us`(기본 07:00 KST). 잡 본문 `_generate_all(market, job_id)`이 전 사용자 user_stocks를 `_in_market`(KR=`market=='KR'`, US=비-KR 전부)으로 파티션해 `generate_report_with_retry` + `_pipeline.run_daily`(컨센서스). 실적/월간도 `earnings_kr`/`earnings_us`, `monthly_kr`/`monthly_us`로 분리.

## Frontend — 패턴과 데이터 흐름

- **Entry**: `frontend/src/main.jsx` → `App.jsx`. `App.jsx`가 OAuth 콜백 코드 교환·localStorage 토큰을 처리하고, `ToastProvider`→`AuthProvider`→`BrowserRouter`로 감싼다.
- **인증/권한**: `contexts/AuthContext.jsx`가 로그인 시 `menuPermissions`·`role`을 로드. `App.jsx`의 `TopNav`가 `menuPermissions`로 nav 탭(`research`/`portfolio`/`market`/`guru`/`settings`)을 필터링하고 admin이면 `행동` 탭 추가.
- **라우팅(허브 구조)**: 5개 라우트가 페이지를 hub로 묶는다. `/`·`/research` → `Research`(홈 허브 — 리포트·추천·랭킹·캘린더·다이제스트 탭), `/market` → `MarketHub`(시장지표·수급지표 탭), `/portfolio` → `Portfolio`(대시보드·분석), `/guru`, `/settings`, `/admin-analytics`. `/analysis`는 `/portfolio`로 리다이렉트. 허브는 `useState(tab)`으로 하위 페이지(`Reports`/`Ranking`/`Recommendations`/`Calendar`/`Digest` 등)를 조건부 렌더.
- **데이터 훅**: `hooks/usePortfolioData.js`가 포트폴리오 상태의 단일 소스 — `GET /api/portfolio`(보유/관심) + `GET /api/portfolio/prices`(시세 머지) + `GET /api/stocks/dashboard`(`{holdings, totals}` 형태로 카드/총계 분리 파싱) + FX/digest를 fetch하고, **장중 자동폴링**(15초 베이스, KR 개장 매 틱·US만 개장 매 4틱·둘 다 닫힘/숨김탭 휴지) `refreshLivePrices`로 가격/등락만 갱신, `priceTick`으로 가격 플래시를 발화. 기타 훅: `useReportList`·`useReportFilters`·`useStockManagement`·`useReportGeneration`·`useAuth`·`useTheme`·`useIsMobile`·`usePriceFlash`.

## Key abstractions

- **종목명 dual-source**: `tickers.name`(공유 마스터, 종목관리 목록) vs `snapshots.data.name`(리포트 생성 시 박제). `storage.names`의 `refresh_snapshot_names`/`reconcile_snapshot_names`로 동기화. `save_stocks`의 tickers UPSERT는 들어온 name이 NULL/빈값/티커면 기존 name 보존(클로버 방지 가드, `name=CASE WHEN ...`).
- **공유 액션버튼**: `components/reports/StockActions.jsx`(task#103) — 보유/관심 카드의 수정·승격·삭제·전체삭제 버튼의 단일 소스. `StockCard.jsx`(그리드, `layout='card'`)와 `TickerListItem.jsx`(사이드바, `layout='list'`)에 byte-identical로 중복돼 있던 블록을 통합. **가시성은 category가 아니라 `is_mine`으로 게이트**(`is_mine===false`=타인 종목, 리서치 '그외' 탭이면 전체삭제 `/api/admin`만; 본인 종목이면 수정·[관심→보유 승격]·삭제) — admin `scope=all` 목록이 비소유 종목에도 category를 붙여 user-scoped 핸들러가 404로 깨지던 task#97 회귀 방지.
- **`is_mine` 마킹**(`report.py:list_reports`/`_mk_entry`): admin이 `scope=all`로 조회할 때만 `my_tickers`(호출자 본인 user_stocks)와 대조해 항목에 `is_mine`을 부여.
- **캐시 계층**(`services/cache.py`): `TTLCache` 기반 — snapshot LRU(50), list(60s), dashboard(300s), correlation/sector/macro(300s), quote(60s, 키에 regular 포함), live_prices(15s). `invalidate(ticker)`가 종목 변경 시 snapshot·list·dashboard·correlation·sector·macro·live_prices를 일괄 무효화(storage→cache는 지연 import로 순환참조 회피).

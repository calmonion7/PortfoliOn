---
last_mapped_commit: a07e6406ac475d8ef7b5c2b0df2af9c99383cbd5
mapped: 2026-07-04
---

# ARCHITECTURE — PortfoliOn

전체 패턴, 레이어, 데이터 흐름, 핵심 진입점. (파일 위치 정본은 `STRUCTURE.md`.)

## 전체 형태

- **백엔드**: Python / FastAPI (포트 8000). 진입점 `backend/main.py`.
- **프론트엔드**: React 19 + Vite (rolldown 번들러, 포트 5173). 진입점 `frontend/src/main.jsx` → `frontend/src/App.jsx`.
- **저장소**: Docker PostgreSQL (정본). 로컬 JSON 파일은 런타임 캐시 용도.
- **배포**: Mac 로컬 Docker 4-컨테이너(nginx / backend / postgres / certbot) + Cloudflare Tunnel. nginx가 `frontend/dist`를 직접 서빙하고 `/api/*`를 backend:8000으로 프록시.

## 백엔드 레이어링

요청은 아래 4계층을 통과한다.

1. **앱 진입 — `backend/main.py`**
   - `load_dotenv()` → 라우터 import → `app = FastAPI(..., lifespan=lifespan)`.
   - 미들웨어: `SessionMiddleware`(`SESSION_SECRET`), `EventTrackerMiddleware`(`backend/middleware/event_tracker.py`), `CORSMiddleware`(origins = `localhost:3000`, `localhost:5173`, `FRONTEND_URL` env).
   - `app.include_router(...)`로 18개 라우터를 마운트(`backend/main.py:179-196`). auth 라우터가 먼저, admin 라우터가 마지막.
   - `/health` (`GET`/`HEAD`) 헬스체크.
   - `lifespan` (`backend/main.py:158-163`): 기동 시 `_migrate()` → `sched.start()` → `_warm_market_cache()`(데몬 스레드), 종료 시 `sched.stop()`.

2. **라우터 — `backend/routers/`** (모두 `APIRouter`)
   - `prefix="/api/..."` + `Depends(...)`로 인증 게이팅. 인증 의존성은 라우터가 아니라 **`backend/auth.py`**에 정의: `get_current_user`, `get_current_user_or_api_key`, `require_admin`, `require_admin_or_api_key`, 그리고 API 키 상수(`_API_KEY_HEADER="X-API-Key"`, `COWORK_API_KEY` env, 센티넬 `_API_KEY_USER_ID="__api_key__"`).
   - 대표: `backend/routers/report.py`(`prefix="/api"`), `stocks.py`, `portfolio.py`, `watchlist.py`, `recommendations.py`, `market_indicators.py`, `analysis.py`, `rankings.py`, `investor.py`, `short_sell.py`, `batches.py`, `admin.py`, `auth.py`(`prefix="/api/auth"`) 등.
   - 라우터는 얇게 유지 — 실제 로직은 서비스 계층에 위임.
   - 라우팅 함정(구체 경로 먼저 등록): `PUT /api/stocks/enrich/batch`는 `PUT /api/stocks/{ticker}/enrich`보다 **먼저**. 마찬가지로 `GET /api/portfolio/rebalance`·`PUT /api/portfolio/rebalance/targets`는 `PUT/DELETE /api/portfolio/{ticker}`보다 **먼저** 등록해야 `rebalance`가 ticker로 라우팅되지 않는다.

3. **서비스 — `backend/services/`**
   - 도메인 로직·외부 API 연동·DB 접근·집계. 라우터가 여기서 import해 호출.
   - DB 접근 정본: **`backend/services/db.py`** — `ThreadedConnectionPool(minconn=1, maxconn=20, dsn=DATABASE_URL)` 싱글톤 + `get_connection()`(commit/rollback 컨텍스트) + `query()` / `execute()` / `execute_many()`(`execute_batch`). ThreadPool 워커 수(calendar 15·analysis 11)보다 maxconn을 크게 둔다 — 풀 소진 시 psycopg2가 블록이 아니라 PoolError를 던지므로.
   - god-file은 **패키지 재-export 패턴**(ADR-0017)으로 분할: `services/storage/`(`__init__.py`가 `portfolio`·`names`·`schedule`·`dates` + `services.db`의 심볼을 루트로 re-export), `services/market/`(`format`·`kr`·`us`), `services/recommendation/`(`universe`·`scoring`·`funnel`·`store`·`actions`), `services/market_indicators/`. 외부 소비처는 `storage.X`·`market.X`처럼 모듈 속성으로 조회하므로 모든 심볼이 패키지 루트에 존재해야 한다.
   - **순수 계산 서비스**: 일부 서비스는 DB/외부호출 없는 순수 함수다. `services/rebalance.py`의 `compute_rebalance(holdings, usdkrw, targets)`가 대표(아래 리밸런싱 흐름) — 테스트 용이, 라우터가 데이터를 모아 넘기고 결과만 sanitize해 반환.

4. **데이터 — PostgreSQL / 로컬 파일**
   - 스키마: `backend/auth_schema.sql`(users, refresh_tokens — 반드시 먼저) → `backend/app_schema.sql`(앱 테이블).
   - 정적 참조 데이터만 git 추적: `backend/data/sp500_tickers.json`, `backend/data/kospi_tickers.json`.
   - 런타임 데이터는 전부 PostgreSQL. 로컬 JSON/디렉터리는 gitignored 캐시.

## 멱등 기동 마이그레이션 (ADR-0006)

- `app_schema.sql`은 **신규 설치용**이고 라이브 DB는 기동 시 `_migrate()`만 탄다(`backend/main.py:39-155`).
- 각 DDL을 개별 `try/except`로 감싸 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`로 실행 — 실패해도 다음 DDL로 진행(경고만 로깅).
- **DoD**: 신규 컬럼은 `app_schema.sql`과 `main._migrate` **둘 다** 손봐야 배포에 반영된다. 한쪽만 고치면 그 컬럼을 쓰는 INSERT/SELECT가 컬럼 부재로 깨진다.
- 현재 `_migrate`가 관리하는 테이블/컬럼: `backlog_history.segments`, `batch_schedules`, `market_short_sell`, `stock_disclosures`(+`meeting_date`), `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`(+`low_liquidity`/`exchange`/`name`), `us_supply_snapshot`(+`insider_transactions`/`insider_net`), `user_stocks.target_price`/`stop_price`/`target_weight`.

## 스케줄러 — `backend/scheduler/` 패키지 (단일 scheduler.py 아님)

APScheduler `AsyncIOScheduler` 기반. 부분초기화 순환 회피를 위해 leaf 모듈로 분할:

- **`_state.py`** — 공유 상태/상수: `_scheduler = AsyncIOScheduler()`, `_DIGEST_JOB_ID`, `_VALID_DAYS`.
- **`jobs.py`** — 잡 함수 전체 + 매핑 `_JOB_FUNCS`(job_id → 함수). 각 잡은 `with job_runs.record(job_id, "auto"):`로 감싸고, 내부 예외는 대부분 try/except로 삼켜 로깅(스케줄러가 죽지 않게). `_generate_all(market, job_id)`가 KR/US 리포트 배치의 공통 본문, `_in_market()`이 시장 파티션(KR=`market=='KR'`, US=그 외 전부). 배치-백킹 뷰용 기동 시드: `_seed_rankings_if_empty`·`_seed_kr_sector_if_empty`·`_seed_us_sector_if_empty`.
- **`schedule.py`** — 트리거 빌드·리스케줄·시드·누락복구: `_build_trigger`(`CronTrigger` + `schedule_spec.build_trigger_kwargs`), `_reschedule_job`(storage 스펙대로 잡 재등록, disabled면 제거만), `_seed_spec_for`/`_seed_batch_schedules`(기동 idempotent 스케줄 마이그레이션), `_check_missed_report`/`_check_missed_report_for`(기동 시 시장별 당일 스케줄이 지났는데 스냅샷 없으면 부분 누락 복구).
- **`__init__.py`** — 배선: leaf 모듈들의 심볼을 명시 re-export(private 포함) + `start()`(`_seed_batch_schedules` → editable 배치 전부 `_reschedule_job` → `_check_missed_report` → 시드 → `_scheduler.start()`), `stop()`, `reload(job_id)`.
- `misfire_grace_time` 미지정 시 인자를 아예 빼서 APScheduler 기본값(1초)을 쓴다 — `None`을 넘기면 '유예 무제한'으로 해석되어 거동이 바뀐다(`daily_report_kr/us`만 82800초 명시).

## 배치 레지스트리 패턴 — `backend/services/batch_registry.py`

- `BATCHES` = 30개 배치의 정적 메타데이터 리스트. `get_batch(job_id)`로 조회(내부 `_BY_ID` dict).
- 각 항목의 핵심 속성:
  - `id` = 스케줄러 잡 id **및** `job_runs.record(id, ...)` 호출 id와 반드시 일치.
  - `market` — `KR`/`US`/`공통` (출처국 기준 분류, ADR-0013).
  - `source` — 데이터 fetch **출처**(예: `["키움","KIS","Naver"]`). 배치의 fetch 소스를 바꾸면 여기도 갱신(DoD).
  - `usage` — 그 데이터가 **소비되는 UI**(예: `["리포트 탭"]`). source와 방향 반대.
  - `editable`, `trigger_kinds`(auto/manual), `manual_endpoint`, `scheduler_job_id`, `timezone`, `default_schedule`.
- `consensus`는 자체 스케줄러 잡이 없다(`daily_report_kr/us`에 내장, `scheduler_job_id: None`).
- `GET /api/batches`(`backend/routers/batches.py`)가 이 메타데이터 + `job_runs.recent_map`을 합쳐 배치 현황 허브에 노출.
- 시장별 분리: 일일 리포트 `daily_report_kr`(20:30 KST)·`daily_report_us`(07:00 KST, ADR-0012), 실적 `earnings_kr`/`earnings_us`, 월간 `monthly_kr`/`monthly_us`, 섹터 `kr_sector_fetch`/`us_sector_fetch`, 랭킹/추천도 KR/US 쌍.
- **함정**: 배치 id 추가/제거 시 `job_runs.record` 모든 lane(auto/manual/backfill) + 테스트의 count/set 하드코딩 단언(`test_scheduler_seed`·`test_batch_market_split`·`test_batches_router`·`test_macro_signals_batch`)을 전수 grep.

## 배치 실행로그 — `backend/services/job_runs.py`

- `record(job_id, trigger)` 컨텍스트매니저: enter 시 `running` 행 INSERT(RETURNING id) + job_id당 최신 20건만 보관(prune). 정상 종료 시 `success`, 본문 예외 시 `failed`(+error)로 UPDATE 후 재raise.
- **관측 전용** — 계측 write-path 실패는 삼키고 본문(배치)을 그대로 실행(`run_id=None` 센티넬). read-path도 graceful degrade(`recent`/`recent_map` 예외 시 `[]`).
- 주의: `failed`는 본문이 예외를 **전파**할 때만 기록. 다수 잡이 내부 예외를 try/except로 삼키므로 `success`가 '내부 오류 없음'을 보장하지 않는다.

## 캐싱 레이어

### 1. 인메모리 캐시 — `backend/services/cache.py`

`TTLCache` 클래스 + 프로세스 전역 캐시들:

- `_snapshots` — LRU (`OrderedDict`, `_MAX=50`), 키 `TICKER/date`.
- `_list_cache` — TTL 60s (리포트 목록, 키 `__global__`).
- `_dashboard_cache` — TTL 300s (user_id별).
- `_correlation_cache` — TTL 300s (user_id별).
- `_sector_cache` — TTL 300s (키 `user_id:market` — US/KR 충돌 방지).
- `_macro_cache` — TTL 300s (user_id별).
- `_quote_cache` — TTL 60s (`get_quote` 종목 단위, rate-limit 방어).
- `_live_prices_cache` — TTL 15s (`/api/portfolio/prices` 장중 폴링 전용, user당).

종목 추가/수정/삭제 시 `invalidate(ticker)`가 snapshot·list·dashboard·correlation·sector·macro·live_prices를 일괄 무효화. `invalidate_portfolio_caches()`는 calendar 파일 캐시까지 함께 비운다.

### 2. `market_cache` 테이블 — `backend/services/market_indicators/cache.py`

배치-백킹 시장지표의 영구 캐시. `_mc_load`/`_mc_save`/`_mc_delete`로 PostgreSQL `market_cache`(key/data/fetched_at) 읽기·쓰기. 인메모리 `_cache`(TTL) 위에 DB 계층을 얹은 `get_or_refresh(key, fetch_fn, ttl, force)`: TTL 인메모리 → `_mc_load` → `fetch_fn()`. `_merge_history`/`_yf_close_history`로 yfinance 증분 fetch(마지막 날짜 이후만), `_filter_outliers`로 median±5x 이탈 제거.

### "배치가 사전계산, 요청은 저장값만 읽는다" 규칙

외부 API(키움·FRED·yfinance 등)에 의존하는 뷰(랭킹·KR/US 업종 모멘텀·추천·수급 스코어·매크로 신호·시장지표)는 **요청·기동 경로에서 라이브 외부 호출을 하지 않는다**. 배치가 사전계산해 `market_cache` 또는 전용 테이블(`stock_recommendations`·`market_rankings`·`stock_supply_score` 등)에 저장하고, GET 엔드포인트는 저장값만 읽는다. 배치는 ① 실패를 조용히 삼키지 말고 로깅, ② 빈/all-None 결과를 캐시에 박제하지 말 것(직전 양호값 유지). (ADR-0014/0015)

예외 — **요청경로 증분** 패턴: FX/VIX/원자재/국채/시장지수(`indices.py`)는 스케줄 배치 없이 요청 시 TTL캐시→`_mc_load`→라이브 fetch→`_mc_save`+폴백으로 증분 갱신(`batch_registry` 무등록).

## 시세 소스 체인 — `backend/services/market/`

- **진입점**: `services/market/__init__.py`의 `get_quote(ticker, market, exchange, regular)` — 종목 단위 TTL 캐시(키에 `regular` 포함) → `_get_quote_uncached` → market 분기.
- **US**: yfinance(`t.info` + `t.history`) 1차 → 실패/빈 시세 시 **KIS 백업**(`_us_quote_kis`, ADR-0011). 일괄은 `get_quotes_batch`가 `yf.download` 1콜.
- **KR** (`services/market/kr.py` `get_quote_kr`): 키움 → KIS → Naver 체인. `regular` 플래그로 기준 이원화(ADR-0020):
  - `regular=False`(기본, NXT 시간외 `_AL`, 라이브 대시보드): **2-of-N 독립 피드 다수결**(`_kr_pick_basic`/`_corroborated_pick`) — 어떤 현재가 피드가 다른 독립 피드 ≥1개와 ±2x([0.5,2.0]) 이내로 합의해야 신뢰, trusted 중 우선순위(키움 NXT→KIS→Naver→키움 KRX) 최상위 반환. lazy escalation(평소 키움 NXT+KRX 2콜, 불일치 시 KIS/Naver 추가 호출). 전 피드 합의 불가는 degenerate(우선순위 첫 피드를 prev_close ±30% 자가검증).
  - `regular=True`(리포트 스냅샷): KRX 정규장 종가. 다수결 미적용, `_kr_pick_regular`(prev±30% + 일봉 2x). 리포트 writer만 opt-in.
  - `_price_sane`: prev_close ±30%(KR 일일 가격제한폭) + 키움 일봉 ref_close [0.5,2.0] 교차검증.
- **박제-시 독립피드 게이트**(`report_generator.generate_report`, KR): 저장 직전 KRX와 독립인 ref 피드(네이버 retry-once → KIS 폴백)로 price·일봉 기준종가를 2x 교차검증, 어긋나면 그 종목 박제 스킵(wrong<missing). ref 전무 시에도 스킵.
- 히스토리(매물대/RSI): `get_history_df` — KR은 키움(ka10081/82/83) 우선 → yfinance 폴백. `get_financials`/`get_annual_financials`/`get_analyst_data`도 KR/US 분기.
- 시세 기준 이원화로 리포트(354k)와 대시보드(350.5k)가 ~1% 다른 현재가를 보일 수 있는 건 의도된 차이.

## 리포트 생성 흐름 — `backend/services/report_generator.py`

- `generate_report(stock, ..., target_date)` — 시장 데이터 스냅샷 생성(**백엔드에 LLM/Anthropic 호출 없음**; AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API로 작성, `CLAUDE_COWORK_API.md`).
- `generate_report_with_retry(stock, ...)` — 스케줄러/누락복구가 호출.
- `backfill_ticker(stock, days, ...)` — 과거 날짜 백필(현재가 대조 불가라 박제 게이트 미적용).
- 컨센서스는 `consensus_pipeline.run_daily(stocks)`가 별도로 처리(리포트 배치에 내장).

## 리밸런싱 계산 흐름 — `backend/services/rebalance.py` (task#146/#147)

- **순수 함수** `compute_rebalance(holdings, usdkrw, targets)` — DB/외부호출 없이 보유 종목의 현재 비중·드리프트(pp)·목표 도달 조정금액(₩·주)만 계산. 주문 실행은 범위 밖(읽기전용 계산기).
- **전체 포트폴리오 기준**(task#147): 현재 비중 분모 = KRW 환산 가능한 **모든** 보유의 합. 타겟은 전체 포트 대비 %라 정규화하지 않는다. 타겟 설정 종목만 드리프트/제안을 내고, 미설정 종목은 실제 비중만 표시하고 hold(제안 없음 — sell-all 함정 회피).
- **결측 처리**: `_finite_float`로 None/Decimal/비유한값을 정규화. `usdkrw≤0`/None이면 US 보유를 `no_fx`(KRW 환산 불가 → 총계·비중서 제외), KR은 fx=1.0. 가격/수량 무효는 결과에서 제외.
- **라우터** (`backend/routers/portfolio.py`): `GET /api/portfolio/rebalance`가 보유목록 + `get_quotes_batch` 시세 + 저장 FX(`_usdkrw_rate`, `routers/stocks.py` 재사용)를 `compute_rebalance`에 넘기고 `sanitize`(NaN/inf→None)해 반환. `PUT /api/portfolio/rebalance/targets`(`Dict[str, Optional[float]]`, `Body(...)`)는 보유 종목만 스코프로 걸러 `storage.set_target_weights` 저장(값 null=타겟 삭제=컬럼 NULL).
- **저장** (`backend/services/storage/portfolio.py`): `set_target_weights`(None→NULL 배치 UPDATE). `save_holdings`의 UPSERT는 `target_weight`만 `COALESCE(EXCLUDED, 기존값)`로 preserve-on-null — 일반 보유종목 수정 폼(`Stock` 모델)엔 `target_weight` 필드가 없어 단순 덮어쓰기면 리밸런싱 타겟이 리셋되기 때문(`target_price`/`stop_price`는 폼에 있어 덮어쓰기 — 비대칭).
- **프론트** (`frontend/src/pages/RebalanceTab.jsx`): Portfolio 분석 탭의 "리밸런싱" 서브탭(섹터/매크로/상관 옆). 종목별 목표 비중 입력→저장, 드리프트·조정금액(매수/매도 라벨+부호, KR 색 관례 혼동 회피 위해 방향색 미적용) 표시.

## 프론트엔드 데이터 흐름

`main.jsx` → `App.jsx`:

1. **인증 부트스트랩** (`App.jsx`): URL의 `oauth`/`token`/`refresh` 파라미터 처리 → `localStorage`에 `access_token`/`refresh_token` 저장. 없으면 `<LoginPage />`.
2. **Provider 래핑**: `ToastProvider` → `AuthProvider` → `BrowserRouter`.
3. **`AuthContext`** (`contexts/AuthContext.jsx`): 로그인 시 `GET /api/auth/me`로 `role`·`menu_permissions` 로드. `useAuth()`로 소비.
4. **권한 필터 nav** (`App.jsx` TopNav + `components/MobileNav.jsx`): `menuPermissions.includes(item.key)`로 탭 필터링. admin이면 `/admin-analytics`('행동') 추가.
5. **라우트**: `/`·`/research` → `Research`(허브), `/portfolio` → `Portfolio`, `/market` → `MarketHub`, `/guru`, `/settings`, `/admin-analytics`, `/dev/showcase`. `/analysis`는 `/portfolio`로 리다이렉트.
6. **API 클라이언트** (`api.js`): axios 인스턴스. request 인터셉터가 `Authorization: Bearer` 주입, response 인터셉터가 401 시 토큰 제거 + 홈 리다이렉트. baseURL은 `VITE_API_BASE_URL`(미설정 시 상대경로 — 로컬은 vite proxy가 `/api/*`→`localhost:8000`).

### pages → hooks → components

- **pages** (`frontend/src/pages/`): 라우트 레벨 + 허브 탭. `Research`(리포트·추천·랭킹·다이제스트·캘린더 탭 컴포지션), `MarketHub`(시장지표·수급지표), `Portfolio`(대시보드 탭 + 분석 탭: 섹터/매크로/상관관계/리밸런싱 서브탭). 각 허브가 하위 페이지(`Reports`·`Ranking`·`Recommendations`·`Digest`·`Calendar`·`Market`·`Analytics`·`SectorTab`·`MacroTab`·`RebalanceTab`)를 탭으로 렌더.
- **hooks** (`frontend/src/hooks/`): 데이터 페칭·상태. `usePortfolioData`(`/api/portfolio` 목록 + `/api/portfolio/prices` 장중 폴링 + `/api/stocks/dashboard` 카드/합산), `useStockManagement`, `useReportList`, `useReportFilters`, `useReportGeneration`, `useAuth`, `usePriceFlash`, `useTheme`, `useIsMobile`.
- **components** (`frontend/src/components/`): 표현 계층. 서브폴더 `portfolio/`·`reports/`·`market/`·`ui/`·`recommendations/`. `StockActions.jsx`(카드/리스트 공용 액션 버튼, `is_mine`으로 게이트), 재사용 UI 프리미티브는 `ui/`.

## 이벤트 추적 — `backend/middleware/event_tracker.py`

`EventTrackerMiddleware`가 화이트리스트 경로(POST/DELETE portfolio·watchlist·promote·report generate·guru crawl)를 매칭해 `user_events` 테이블에 비동기 기록. 프론트는 `utils/analytics.js`의 `trackEvent`로 `POST /api/events` 보조 수집.

## 핵심 진입점 요약

| 목적 | 파일 |
|------|------|
| 백엔드 앱 진입 | `backend/main.py` |
| 라우터 마운트 | `backend/main.py:179-196` |
| 기동 마이그레이션 | `backend/main.py:39-155` (`_migrate`) |
| 인증 의존성 | `backend/auth.py` |
| DB 풀/헬퍼 | `backend/services/db.py` |
| 스케줄러 배선 | `backend/scheduler/__init__.py` |
| 잡 함수/매핑 | `backend/scheduler/jobs.py` (`_JOB_FUNCS`) |
| 배치 메타데이터 | `backend/services/batch_registry.py` (`BATCHES`) |
| 인메모리 캐시 | `backend/services/cache.py` |
| 시장지표 DB 캐시 | `backend/services/market_indicators/cache.py` |
| 시세 진입점 | `backend/services/market/__init__.py` (`get_quote`) |
| 리밸런싱 계산 | `backend/services/rebalance.py` (`compute_rebalance`) |
| 프론트 앱 진입 | `frontend/src/main.jsx` → `frontend/src/App.jsx` |
| 프론트 API 클라이언트 | `frontend/src/api.js` |
| 인증 컨텍스트 | `frontend/src/contexts/AuthContext.jsx` |
| API 명세(정본) | `API_SPEC.md`, `CLAUDE_COWORK_API.md` |

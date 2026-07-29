---
last_mapped_commit: 91bac67ddb3ca7277a850fa6840a0fce0f7344cf
mapped: 2026-07-30
---

# ARCHITECTURE — PortfoliOn

구현 사실만 기록한다. 용어의 *의미*는 `.forge/CONTEXT.md` 관할이며 여기서 정의하지 않는다.

---

## 1. 전체 패턴

**레이어드 3-tier 모놀리스 + 시간구동 배치.**

| 층 | 실체 | 위치 |
|---|---|---|
| 프론트 | React 19 SPA (Vite 8/rolldown, plain CSS, PWA) | `frontend/src/` |
| API | FastAPI 단일 앱 (uvicorn, port 8000) | `backend/main.py` + `backend/routers/` |
| 도메인/어댑터 | 서비스 모듈 + 외부 API 어댑터 패키지 | `backend/services/` |
| 배치 | APScheduler 인프로세스 스케줄러 | `backend/scheduler/` |
| 저장 | PostgreSQL 16 (정본) + 인메모리 캐시 + 파일 폴백 | `backend/app_schema.sql`, `backend/services/db.py`, `backend/services/cache.py` |

프레임워크 계층은 얇다 — ORM 없이 `psycopg2` 원시 SQL(`backend/services/db.py`)을 쓰고, 라우터는 요청 검증·인증 의존성·응답 조립만 하며 계산은 `services/`에 있다.

**백엔드에 LLM 호출이 없다.** `backend/requirements.txt`에 anthropic/openai 계열이 없고, AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API로 써넣는다(`CLAUDE_COWORK_API.md`). 유일한 LLM 접점은 `backend/services/cowork_trigger.py`의 트리거 POST 1개(ADR-0028)다.

---

## 2. 런타임 토폴로지

- `docker-compose.yml` — 4 서비스: `postgres`(16-alpine, `pgdata` 볼륨, `auth_schema.sql`→`app_schema.sql` 순서로 initdb 마운트), `backend`(`backend/Dockerfile` 빌드, `backend/.env.docker` env_file), `nginx`(80/443), `certbot`.
- `nginx/nginx.conf` — `/api/`·`/health` → `http://backend:8000` 프록시. 나머지는 `/usr/share/nginx/html`(= `frontend/dist` `:ro` 마운트) 정적 서빙 + `try_files $uri /index.html` SPA 폴백. 캐시 정책 3단: `index.html`·`sw.js`/`workbox-*.js` no-store, 해시 자산(js/css/img/woff2) `max-age=31536000 immutable`.
- `deploy.sh` — 프론트 빌드 → 백엔드 이미지 빌드 → `backend`/`nginx` 컨테이너 `docker run` 교체 → `/health` 확인. `/tmp/portfolion-deploy.lock`으로 동시배포 차단(러너 + 폴러).
- `.github/workflows/deploy.yml` — self-hosted 러너 배포 경로. 폴백 폴러는 `scripts/auto-deploy-poll.sh`.
- 로컬 개발: `start.sh`/`start.bat`(양 서버), Vite dev 프록시 `/api` → `localhost:8000`(`frontend/vite.config.js`).

---

## 3. 백엔드 진입점 — `backend/main.py`

한 파일이 다섯 가지를 한다(순서가 의미 있음):

1. **로깅 배선** — `_configure_logging()`이 모듈 임포트 *전에* 1회 실행. `basicConfig(level=INFO)` + `urllib3`/`yfinance`/`apscheduler`/`asyncio`를 WARNING으로 억제 + `uvicorn*` 로거 `propagate=False`(중복 emit 차단).
2. **기동 idempotent 마이그레이션** — `_migrate()`(ADR-0006). `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`만 쓰고 각 블록이 개별 `try/except`+`logger.warning`이라 하나가 실패해도 기동은 계속된다. **라이브 DB는 이 함수만 타고 `app_schema.sql`은 신규 설치용**이라, 새 컬럼/테이블은 두 곳 모두 필요하다.
3. **미들웨어** — `SessionMiddleware`(OAuth용, `SESSION_SECRET`), `EventTrackerMiddleware`(`backend/middleware/event_tracker.py`), `CORSMiddleware`(`localhost:3000`·`localhost:5173`·`FRONTEND_URL`).
4. **라우터 마운트** — 19개(§4 표). `auth_router`가 첫째, `admin_router`가 마지막.
5. **검증 에러 핸들러** — `_validation_error_handler`가 `RequestValidationError`의 `detail`을 `services.utils.sanitize`로 통과시킨다. 입력 NaN을 거부하면 422 detail이 그 NaN을 echo하고 starlette `allow_nan=False`가 500으로 바꾸는 경로를 앱 전역에서 막는다.

`lifespan`(asynccontextmanager): `_migrate()` → `sched.start()` → `_warm_market_cache()`를 데몬 스레드로 → (종료 시) `sched.stop()`.

`GET|HEAD /health` 는 `main.py`에 직접 정의된 유일한 엔드포인트다.

---

## 4. 라우터 층 — `backend/routers/`

19개 라우터, 전부 `main.py`에서 `include_router`. prefix 스타일이 두 가지로 갈린다.

| 파일 | prefix | 비고 |
|---|---|---|
| `auth.py` | `/api/auth` | 공개 엔드포인트 존재(ADR-0029 예외) |
| `portfolio.py` | `/api/portfolio` | |
| `watchlist.py` | `/api/watchlist` | |
| `stocks.py` | `/api/stocks` | 최대 파일(≈30KB), 대시보드 빌드 포함 |
| `guru.py` | `/api/guru` | |
| `market_indicators.py` | `/api/market` | ⚠️ `/api/market-indicators`는 존재하지 않는다 |
| `analysis.py` | `/api/analysis` | |
| `analytics.py` | `/api/analytics` | |
| `admin.py` | `/api/admin` | `ALL_MENUS` 정의처 |
| `events.py` | `/api/events` | |
| `recommendations.py` | `/api/recommendations` | |
| `analyst_reports.py` | `/api/analyst-reports` | ADR-0027 |
| `report.py` | `/api` | 데코레이터에 `/report/...` 전체 경로 |
| `calendar.py` | `/api` | `/calendar`, `/calendar/cache` |
| `digest.py` | `/api` | `/digest/latest` 등 |
| `batches.py` | `/api` | `/batches`, `/batches/{job_id}/schedule` |
| `rankings.py` | `/api` | `/rankings`, `/rankings/refresh` |
| `investor.py` | `/api` | `/investor/*` + `/stocks/{ticker}/investor-trend` |
| `short_sell.py` | `/api` | `/short-sell/refresh` + `/stocks/{ticker}/short-sell` |

`/api` prefix 라우터가 존재하는 이유는 **한 라우터가 두 자원 네임스페이스에 걸치는 경우**다 — `investor.py`·`short_sell.py`가 `/stocks/{ticker}/...` 하위 경로를 함께 소유한다.

**라우터 등록 순서 함정**: `PUT /api/stocks/enrich/batch`는 `PUT /api/stocks/{ticker}/enrich` **앞에** 있어야 `enrich`가 ticker 값으로 잡히지 않는다(`backend/routers/stocks.py:379` vs `:394`). `report.py`에도 같은 이유의 순서 주석이 있다(`backlog`가 `date_str`로 매칭되는 문제, `routers/report.py:417` 근처).

---

## 5. 인증·권한

`backend/auth.py`가 FastAPI 의존성 4종을 제공한다(전부 HS256 JWT, `JWT_SECRET`):

| 의존성 | 통과 조건 |
|---|---|
| `get_current_user` | Bearer JWT → `payload["sub"]` |
| `get_current_user_or_api_key` | `X-API-Key == COWORK_API_KEY` (→ 센티넬 `"__api_key__"`) 또는 JWT |
| `require_admin` | JWT + `users.role == 'admin'`. **API 키를 거부한다** |
| `require_admin_or_api_key` | API 키 또는 admin JWT |

역할 조회는 `backend/services/auth_service.py`. 메뉴 권한은 `user_menu_permissions`/`default_menu_permissions` 테이블 + `backend/routers/admin.py`의 `ALL_MENUS`, 프론트에서는 `frontend/src/contexts/AuthContext.jsx`가 로그인 시 로드해 nav를 필터한다.

행동 로그는 두 경로: 미들웨어 자동 수집(`backend/middleware/event_tracker.py`의 `_TRACKED` 7패턴, 2xx일 때만 `asyncio.create_task`로 비동기 INSERT) + 프론트 명시 호출(`frontend/src/utils/analytics.js` → `POST /api/events`, `backend/routers/events.py`의 `VALID_EVENTS` 화이트리스트).

---

## 6. 서비스 층 — `backend/services/`

세 부류가 한 디렉터리에 섞여 있다.

### 6.1 인프라/공용
- `db.py` — `ThreadedConnectionPool(minconn=1, maxconn=20)` + `get_connection()` 컨텍스트매니저(자동 commit/rollback/putconn) + `query`/`execute`/`execute_many`. 풀 소진 시 psycopg2는 블록이 아니라 `PoolError`를 던지므로 `maxconn`이 최대 ThreadPool 동시성보다 커야 한다(주석에 근거 명시).
- `cache.py` — 인메모리 캐시(§8.1).
- `utils.py` — `today_kst()`(KST 시장-날짜; bare `date.today()` 대체), `sanitize()`(NaN/inf→None 재귀), `is_valid_ticker`/`TICKER_RE`, `find_ticker*` 헬퍼.
- `errors.py` — `not_found`/`already_exists` HTTPException 팩토리.
- `parallel.py` — `parallel_map(func, items, max_workers=10)`.
- `progress.py` — `ProgressTracker`(구루 크롤 등 백그라운드 작업 진행률).
- `job_runs.py` — 배치 실행로그 컨텍스트매니저(§7.3).
- `batch_registry.py` — 배치 정적 메타데이터(§7.1).
- `schedule_spec.py` — 스케줄 스펙 → APScheduler cron kwargs(`build_trigger_kwargs`).
- `storage/` — 앱 상태 저장소 파사드(§6.4).

### 6.2 외부 API 어댑터 (읽기전용 경계)
| 패키지 | 경계 ADR | 구성 |
|---|---|---|
| `services/market/` | — | `__init__.py`(`get_quote`·`get_quotes_batch`·`get_history_df`·`get_financials`·`get_annual_financials`·`get_analyst_data`·`resolve_name`), `kr.py`(≈31KB, 최대), `us.py`, `format.py`(`_norm_sector`·`_yf_val` 등) |
| `services/kiwoom/` | ADR-0009 | `client.py`(토큰 싱글톤·`request(api_id, body, category)`·`integrated_code(regular=)`), `quote.py`, `chart.py`, `investor.py`, `sector.py`, `shortsell.py` |
| `services/kis/` | ADR-0011/0022 | `client.py`(`/oauth2/tokenP`, 60s 재발급 가드), `quote.py`(국내+해외), `futures.py` |
| `services/market_indicators/` | — | 12모듈(§8.2) |

`services/scraper.py`(Finviz/BeautifulSoup), `services/guru_scraper.py`(dataroma)도 외부 소스 어댑터다.

### 6.3 도메인 서비스
분석·산출: `indicators.py`, `beta.py`, `exposure.py`, `rebalance.py`, `analysis_service.py`(SECTOR_ETFS·MACRO_TICKERS 상관), `supply_score.py`, `guru_stats.py`, `us_supply.py`, `us_sector_service.py`, `kr_sector_service.py`, `ranking_service.py`, `investor_service.py`, `short_sell_service.py`, `leverage_service.py`, `lending_service.py`, `dividends.py`, `consensus.py`(as-of 정본 조회, ADR-0008), `consensus_pipeline.py`, `insider_trades.py`, `disclosures.py`, `agm.py`, `backlog.py` + `backlog_parser.py`, `analyst_reports.py`, `digest_service.py`, `report_generator.py`(≈31KB, 스냅샷 생성/백필), `recommendation/`(§6.5), `auth_service.py`, `cowork_trigger.py`.

`*_service.py` 접미사는 일관 규칙이 아니다 — `dividends.py`/`beta.py`처럼 접미사 없는 도메인 모듈도 있다(§STRUCTURE 네이밍 참조).

### 6.4 저장소 파사드 — `backend/services/storage/`
ADR-0017의 "god file → 패키지 re-export" 패턴. `__init__.py`가 4 서브모듈 + `services.db` 헬퍼를 **전 심볼 re-export**하므로 외부 소비처는 `storage.X` 모듈 속성으로만 접근한다(직접 심볼 import 0건, `__init__.py` 주석 명시).

| 서브모듈 | 담당 |
|---|---|
| `portfolio.py` | `get_stocks`/`save_stocks`/`get_holdings`/`save_holdings`/`get_watchlist_tickers`/`get_full_portfolio`/`get_all_stocks`/`get_global_portfolio`/`enrich_stock`/`set_target_weights`/`set_pinned` + `_ENRICH_KEYS`·`_ANALYST_KEYS`·`_JSON_TEXT_FIELDS` |
| `names.py` | `refresh_snapshot_names`/`set_ticker_name`/`reconcile_snapshot_names`/`tickers_missing_name`/`update_ticker_meta`/`_invalidate_name_caches` — `tickers.name`(마스터)와 `snapshots.data.name`(박제) 이중 저장소 동기화 |
| `schedule.py` | `get_schedule`/`get_guru_*`/`save_guru_*`/`get_batch_schedule`/`save_batch_schedule`/`get_all_batch_schedules` |
| `dates.py` | `expected_report_date(market)`/`expected_report_dates()`/`_now_kst` + `_REPORT_BATCH_BY_MARKET = {"KR": "daily_report_kr", "US": "daily_report_us"}` |

### 6.5 추천 엔진 — `backend/services/recommendation/`
ADR-0015/0016. `__init__.py`가 공개 API를 re-export: `build_universe`(`universe.py`), `score_stock`/`derive_flags`(`scoring.py`), `run_recommendation_batch`(`funnel.py`, ≈19KB), `replace_recommendations`/`read_recommendations`(`store.py`), `derive_holding_action`(`actions.py`). docstring에 배치-백킹 규약을 못박아 뒀다 — "배치가 점수를 사전계산해 `stock_recommendations`에 저장하고, `GET /api/recommendations`는 저장값만 읽는다".

---

## 7. 배치 경로

### 7.1 레지스트리 — `backend/services/batch_registry.py`
`BATCHES` 리스트(현재 **30개 항목**) + `_BY_ID` 인덱스 + `get_batch(job_id)`. 각 항목 필드:

`id` · `label` · `category`(`report`|`market`|`guru`) · `schedule_desc` · `usage`(소비 UI) · `source`(fetch 출처) · `editable` · `trigger_kinds` · `manual_endpoint` · `scheduler_job_id` · `timezone` · `misfire_grace_time`(옵션) · `market`(`KR`|`US`|`공통`, 출처국 기준 — ADR-0013) · `default_schedule`.

`id`는 **세 곳에서 동일해야 하는 계약**이다: APScheduler job id ↔ `job_runs.record(id, …)` ↔ `batch_schedules.job_id`. `consensus`만 자체 잡이 없어 `scheduler_job_id: None`(일일 리포트에 내장).

시장 분리 쌍: `daily_report_kr`/`daily_report_us`(ADR-0012), `earnings_kr`/`earnings_us`, `monthly_kr`/`monthly_us`, `recommendation_kr`/`recommendation_us`, `kr_sector_fetch`/`us_sector_fetch`, `kr_rankings_fetch`/`us_rankings_fetch`.

### 7.2 스케줄러 패키지 — `backend/scheduler/`
**단일 `scheduler.py`가 아니라 루트 레벨 패키지**다(`services` 하위도 아님).

| 파일 | 역할 |
|---|---|
| `_state.py` | `_scheduler`(APScheduler 인스턴스)·`_DIGEST_JOB_ID`·`_VALID_DAYS` — leaf 모듈로 두어 부분초기화 순환을 피한다 |
| `jobs.py` | 잡 함수 전부 + `_JOB_FUNCS` 딕셔너리(job_id → 함수, 현재 28엔트리) + `_in_market`(KR = `market=='KR'`, US = 그 외 전부) + `_seed_*_if_empty` 3종 |
| `schedule.py` | `_build_trigger`·`_reschedule_job`·`_seed_spec_for`·`_seed_batch_schedules`·`_check_missed_report(_for)` |
| `__init__.py` | 배선 + `start()`/`stop()`/`reload(job_id)` 공개 API. 잡 함수·스케줄 심볼을 **private까지 명시 re-export**(`import *`가 underscore를 건너뛰므로) |

`start()` 순서: `_seed_batch_schedules()` → editable 배치마다 `_reschedule_job()` → `_check_missed_report()` → `_seed_rankings_if_empty()` → `_seed_kr_sector_if_empty()` → `_seed_us_sector_if_empty()` → `_scheduler.start()`.

- `_reschedule_job`: `batch_schedules` 스펙을 읽어 잡 재등록. `enabled: false`면 제거만. `misfire_grace_time`이 레지스트리에 없으면 **인자 자체를 뺀다**(None을 넘기면 APScheduler가 '유예 무제한'으로 해석).
- `_seed_batch_schedules`: 행이 없을 때만 시드(idempotent). `_seed_spec_for`가 은퇴 id(`daily_report`·`earnings_refresh`·`monthly_refresh`)와 레거시 store(`schedules`·`guru_schedules`)에서 스펙을 승계한다 — 이 read는 정당한 잔존이다.
- `_check_missed_report_for`: 기동 시 당일 스케줄 시각이 지났는데 **개별 종목** 스냅샷이 없으면 그것만 재생성(전체 스킵이 아니라 부분 누락 복구).

### 7.3 실행로그 — `backend/services/job_runs.py`
`record(job_id, trigger)` 컨텍스트매니저. enter에서 `running` 행 INSERT(`RETURNING id`) + 해당 job_id 최신 `KEEP=20`건만 prune, exit에서 `success`/`failed` UPDATE. **계측은 관측 전용** — 쓰기 실패는 `logger.warning` + `run_id=None` 센티넬로 본문을 그대로 실행한다.

⚠️ 계측의 구조적 한계가 docstring에 명시돼 있다: `failed`는 본문이 예외를 **전파**할 때만 기록된다. 다수 잡 함수가 내부 예외를 `try/except`+warning으로 삼키고 정상 종료하므로 부분/전체 실패도 `success`로 남는다. 조회는 `recent(job_id, n)`·`recent_map(job_ids)`(윈도우 함수 `ROW_NUMBER() OVER (PARTITION BY job_id …)`), 실패 시 빈 리스트로 graceful degrade.

### 7.4 스케줄 편집 흐름
`GET|PUT /api/batches/{job_id}/schedule`(`backend/routers/batches.py`) → `storage.save_batch_schedule` → `scheduler.reload(job_id)` → `_reschedule_job`. `GET /api/batches`가 레지스트리 메타 + `job_runs.recent_map` + `next_run`을 합쳐 현황 허브에 노출한다. 프론트 편집기는 `frontend/src/components/BatchScheduleEditor.jsx`.

---

## 8. 데이터 흐름 — 요청 경로 vs 배치 경로

핵심 규약: **배치-백킹 뷰는 요청·기동 경로에서 외부 API를 라이브 호출하지 않는다.** 배치가 사전계산해 테이블/`market_cache`에 저장하고 요청은 저장값만 읽는다. 근거가 코드 docstring에 반복 명시돼 있다(`scheduler/jobs.py:_supply_score_work`, `services/recommendation/__init__.py`).

### 8.1 요청 경로

```
브라우저 → nginx(:80) → FastAPI 라우터
  → auth 의존성 (get_current_user | require_admin | *_or_api_key)
  → services.cache.get_*(user_id, loader)        ← 인메모리 TTL 히트면 종료
      → loader: storage / db.query / *_service.read_*  ← 저장값 read
  → sanitize (NaN/inf → None) → JSONResponse
```

`backend/services/cache.py` 인메모리 캐시 **10종** (`TTLCache(ttl, maxsize=200)` + 스냅샷 LRU):

| 이름 | 종류 | 키 | 무효화 |
|---|---|---|---|
| `_snapshots` | LRU `_MAX=50` | `TICKER/date` | `invalidate(ticker)` |
| `_list_cache` | TTL 60s | user_id | `invalidate_list()` |
| `_dashboard_cache` | TTL 300s | user_id | `invalidate_dashboard(user_id?)` |
| `_correlation_cache` | TTL 300s | user_id | `invalidate_correlation` |
| `_sector_cache` | TTL 300s | `user_id:market` | `invalidate_sector` |
| `_macro_cache` | TTL 300s | user_id | `invalidate_macro` |
| `_quote_cache` | TTL 60s | quote 키(`regular` 포함) | `invalidate_quote` |
| `_live_prices_cache` | TTL 15s | user_id | `invalidate_live_prices` |
| `_rebalance_cache` | TTL 300s | user_id | `invalidate_rebalance` |
| `_exposure_cache` | TTL 300s | user_id | `invalidate_exposure` |

두 개의 팬아웃 무효화기:
- `invalidate(ticker)` — 스냅샷 prefix 삭제 + list/dashboard/correlation/sector/macro/live_prices 전체 clear.
- `invalidate_portfolio_caches(user_id?)` — `routers.calendar.clear_cache(user_id)`(= `calendar_cache` DB 행 삭제) + list/dashboard/sector/macro/correlation/live_prices/rebalance/exposure. 종목 추가·삭제·승격 시 호출된다. `routers` import는 함수 안에서 지연 import(순환참조 회피).

### 8.2 시장지표의 2단 캐시 — `backend/services/market_indicators/`

`cache.py`가 공용 기계를 제공한다:
- `_cache`(모듈 전역 dict, 항목별 `expires`) + `_get_cache`/`_set_cache` — 인메모리 1단.
- `_mc_load(key)`/`_mc_save(key, data)`/`_mc_delete(key)`/`clear_cache(key)` — PostgreSQL `market_cache(key, data, fetched_at)` 2단(영구).
- `get_or_refresh(key, fetch_fn, ttl, force=False)` — 인메모리 → `_mc_load` → `fetch_fn()`. ⚠️ **`ttl`은 인메모리 수명만 지배하고 `_mc_load` 결과에는 걸리지 않는다** — 저장 행이 있으면 나이 불문 반환하고, 실제 재조회자는 `force=True`를 주는 배치뿐이다.
- `_merge_history(stored, new_pts)` — 날짜 키 dict merge 후 정렬. **`new_pts`가 빈 리스트면 `stored`를 그대로 돌려준다**(구조적 last-good 보존).
- `_yf_close_history(sym, stored, precision)` — 마지막 저장 날짜 이후만 yfinance 증분 조회 + 366일 트림 + `_filter_outliers`(중앙값 5배 밴드).

모듈별 담당:

| 모듈 | 갱신 경로 | 배치 |
|---|---|---|
| `fx.py`(`get_fx`·`get_vix`) | 요청경로 증분, 수동 last-good 폴백 | 없음 |
| `commodities.py`(`get_commodities`·`get_treasury`) | 요청경로 증분 | 없음 |
| `indices.py`(`get_indices`) | 요청경로 증분(+ `multpl.com` CAPE 크롤) | 없음 |
| `sentiment.py`(`get_fear_greed`) | 요청경로 증분, VIX식 수동 폴백 | 없음 |
| `kospi_futures.py`(`get_kospi_futures`) | 요청경로(KIS), 값-수준 가드 | 없음 |
| `earnings.py` | 배치 | `earnings_kr`/`earnings_us` |
| `econ.py` | 배치(FRED) | `monthly_us` |
| `exports.py` | 배치 | `monthly_kr` |
| `macro.py` | 배치(FRED) | `macro_signals_fetch` |
| `kospi_signal.py` | 배치 | `kospi_signal_fetch` |

`market_indicators.py` 라우터의 GET은 전부 얇다 — `get_*()` 호출 + `try/except → HTTPException(500)`. `POST /refresh-*`는 `require_admin` + `job_runs.record(id, "manual")`로 감싼 `_fetch_and_save_*` 호출이다.

### 8.3 배치 경로

```
APScheduler cron (backend/scheduler/_state.py::_scheduler)
  → _JOB_FUNCS[job_id]  (backend/scheduler/jobs.py)
      → with job_runs.record(job_id, "auto"):
          → 외부 fetch (yfinance / 키움 / KIS / DART / FRED / KOFIA / 관세청 / dataroma / Naver …)
          → 빈 결과 가드 (아래)
          → 저장: services.db.execute / execute_many / _mc_save / *_service.upsert_*
      → (일일 리포트만) cowork_trigger.fire(...)   ← job_runs 컨텍스트 밖, best-effort
```

**빈 결과 가드 — 두 형태.**
1. *소스-폴백(권장형)*: last-good을 fetch 계층에 실어 빈 결과가 필드에 닿기 전에 직전값으로 채운다. 예 — `fx.py:_fetch_fx`가 실패 시 `stored_history`를 담아 반환, `cache.py:_merge_history(prev, [])`가 prev 반환, `dividends.py`가 `fetch_dividend_schedule(...)`을 `replace_schedule` 진입 전에 평가.
2. *끝 가드*: 저장 직전 한 지점에서 판정. 실패 클래스 3종을 모두 물어야 한다 — (a) 예외 (b) 성공-but-빈응답(`rt_cd=0`/200 with 0 items) (c) 부분 페이로드(같은 payload의 일부 필드만 가드). 실례가 `exports.py:118-125`(예외 가드 *아래* 별도 `if not data.get("months")` + `stale` 마커) 와 `guru.py:_run_crawl`/`jobs.py:_run_guru_crawl`(`save_guru_managers`가 False 반환 시 "직전값 유지" 로깅)에 남아 있다.

delete-rewrite(replace) 저장은 fetch 실패 시 DELETE 자체를 스킵해야 한다(빈 결과 박제보다 파괴적) — `dividends.py:replace_schedule` 호출부가 그 형태다.

**병렬성 상한**: 배치 ThreadPool은 DB 풀 소진을 피하려 `max_workers ≤ 8`로 못박혀 있다(`jobs.py:_investor_trend_work`·`_short_sell_work`). `services/parallel.py:parallel_map`의 기본은 10, 캘린더 yfinance 병렬은 별도.

### 8.4 수동 트리거 경로
같은 배치 함수를 admin 엔드포인트가 다시 호출한다. 규약은 **동일 job_id로 `job_runs.record(id, "manual")`** — 그래서 현황 허브의 실행이력에 auto/manual이 한 줄에 섞인다. 오래 걸리는 것은 `BackgroundTasks` + `202 Accepted` + `ProgressTracker`(구루 크롤, 이름 백필, 배당/베타/수급스코어 리프레시, 레버리지 백필).

---

## 9. 저장 계층

### 9.1 PostgreSQL — 정본
스키마 파일 2개, **적용 순서가 강제**된다: `backend/auth_schema.sql`(`users`, `refresh_tokens`) → `backend/app_schema.sql`(나머지 30여 테이블). 라이브 증분은 `main.py:_migrate()`.

계열별 그룹:
- 사용자·권한: `users`, `refresh_tokens`, `user_menu_permissions`, `default_menu_permissions`, `user_events`
- 종목·포트폴리오: `tickers`(공유 마스터), `user_stocks`(user별 holding/watchlist), `snapshots`(ticker+date JSON)
- 리포트 부속: `raw_reports`, `analyst_reports`, `backlog_history`, `stock_disclosures`, `stock_dividends`, `stock_dividend_schedule`, `stock_beta`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`, `us_supply_snapshot`
- 컨센서스: `consensus_history`, `daily_consensus_mart`(as-of 정본, ADR-0008)
- 시장 시계열: `market_cache`(키-값 JSON), `market_rankings`, `market_investor_trend`, `market_short_sell`, `market_leverage_indicators`, `market_lending_balance`
- 운영: `schedules`(레거시 단일행), `guru_schedules`, `guru_managers`, `batch_schedules`(ADR-0007), `job_runs`, `digests`, `calendar_cache`

`backend/migrations/001_user_events.sql`·`002_backlog_history.sql`는 초기 수동 마이그레이션 잔존물 — 현재 정본 경로는 `_migrate()`다.

### 9.2 파일
| 경로 | 성격 |
|---|---|
| `backend/snapshots/` | 리포트 스냅샷 JSON 폴백(gitignored). `report_generator.SNAPSHOTS_DIR` |
| `backend/reports/` | 레거시 리포트 디렉터리. `routers/report.py:154`가 `(SNAPSHOTS_DIR, REPORTS_DIR)` 순으로 폴백 read |
| `backend/data/sp500_tickers.json`, `kospi_tickers.json` | **read-only 정적 시드.** `market_indicators/earnings.py:_read_seed`("이 경로에 write하는 코드는 없다")와 `recommendation/universe.py:_SP500_PATH`가 읽는다. 티커 캐시 자체는 `market_cache` 키 `sp500_tickers`·`kospi_tickers`로 옮겨졌다 |
| `backend/data/kr_exports.json` | `exports.py`가 `_mc_save`와 **함께** 쓰는 파일 미러 + 최후 폴백 read(`exports.py:128-131, 143-145`) — 현재 유일하게 코드가 write하는 `data/` 파일 |
| `backend/data/holdings.json`·`watchlist.json`·`stocks.json`·`guru_managers.json`·`guru_schedule.json`·`schedule.json`, `data/consensus/`·`data/calendar/`·`data/digest/` | 코드 참조 0건(grep 확인) — DB 이전 이후 남은 레거시 |

---

## 10. 프론트엔드 아키텍처

### 10.1 부트스트랩 체인
`frontend/index.html` → `frontend/src/main.jsx` → `App.jsx:App`

`App`이 인증 게이트를 담당한다: URL 쿼리 `oauth`/`error`/`token`/`refresh` 처리(OAuth 코드 → `GET /api/auth/oauth/token` 교환) → `localStorage`의 `access_token` 확인 → 없으면 `LoginPage`, 있으면 `ToastProvider > AuthProvider > BrowserRouter > AppShell`.

`AppShell`(같은 파일)이 셸 레이아웃을 그린다 — PC `Masthead`, 모바일 `.mobile-header`, `<main className="page-wrap">` 안에 `key={location.pathname}`의 `.anim-fade` 래퍼 + `<Routes>`, 하단 `MobileNav`.

HTTP는 `frontend/src/api.js` axios 인스턴스 하나: `baseURL = VITE_API_BASE_URL || ''`, 요청 인터셉터가 `Authorization: Bearer`를 붙이고, 응답 인터셉터가 401에서 토큰을 지우고 `/`로 보낸다. `utils/analytics.js`만 raw `fetch`를 쓴다.

### 10.2 허브-앤-탭 구성
라우트 정의는 `App.jsx`의 `<Routes>` 한 곳, 구 URL 리다이렉트는 `frontend/src/routes.js`의 `REDIRECTS`(ADR-0025) — `/`→`/reports`, `/research`→`/reports`, `/market`→`/market/indicators`, `/analysis`→`/portfolio`.

허브 4종이 서로 다른 방식으로 탭을 구성한다:

| 허브 | 파일 | 탭 전환 방식 |
|---|---|---|
| 리서치 셸 | `pages/ResearchShell.jsx` | **라우트 네비게이션**. 8개 라우트가 `<ResearchShell><Tab/></ResearchShell>`로 감싸진다 |
| 시장 허브 | `pages/MarketHub.jsx` → `pages/Market.jsx` | 라우트 2개(`/market/indicators`·`/market/flow`) → `Market`이 `tab` prop으로 섹션 분기 |
| 구루 | `pages/Guru.jsx` | **로컬 `useState`**. `managers`/`popularity`/`weighted`/`allocation` 4탭을 `GuruManagers`·`GuruStats(view=)`·`GuruAllocation`로 라우팅 |
| 포트폴리오 | `pages/Portfolio.jsx` | 로컬 `useState` 2탭(`dash`/`analysis`). 분석탭이 `SectorTab`·`MacroTab`·`Analytics`·`RebalanceTab`·`ExposureTab`를 품는다 |

### 10.3 ⚠️ 하위탭 목록이 3곳에 이원화돼 있다
탭을 추가·개명·삭제하면 세 곳을 함께 봐야 한다:

1. `frontend/src/pages/ResearchShell.jsx` — `RESEARCH_TABS`(reports/recommend/ranking/compare/analyst-reports) + `SCHEDULE_TABS`(calendar/dividends/digest). 모바일 seg 필.
2. `frontend/src/components/Masthead.jsx` — `SECTIONS`(5섹션: research/portfolio/market/schedule/guru). PC 마스트헤드 2행 카테고리 + 3행 서브바.
3. `frontend/src/components/MobileNav.jsx` — `RESEARCH_PATHS`·`SCHEDULE_PATHS` + `ALL_TABS`(하단 탭바 5개). **현재 `RESEARCH_PATHS`에 `/analyst-reports`가 빠져 있어** 심층 리포트 화면에서 하단 '리서치' 탭이 활성 표시되지 않는다.

권한 게이팅은 세 목록 모두 `useAuth().menuPermissions`로 필터한다(`Masthead`는 섹션 `perm`, `MobileNav`는 탭 `key`). `schedule` 섹션의 `perm`은 `research`를 공유한다.

### 10.4 컴포넌트 조직
| 디렉터리 | 성격 |
|---|---|
| `components/ui/` | 프리미티브 — `Badge`/`Button`/`Card`/`Stat`/`Input`/`Skeleton` + CSS 병치, `icons.jsx`(+`fmt` 포매터), 배지 3종(`GuruActivityBadge`·`InsiderBadge`·`SupplyBadge`), `index.js` 배럴 |
| `components/market/` | 시장 화면 섹션 16개(`*Section.jsx`) + `Market.css` + `marketUtils.jsx`(`krFmt` 등) |
| `components/reports/` | 리포트 상세·목록 부품. `ReportDetailTabs`·`ReportDetailHeader`·`StockCard`·`TickerListItem`·**`StockActions`**(액션버튼 단일 소유처, `layout="card"|"list"`)·차트 4종·섹션 8종 + `reportUtils.jsx` |
| `components/portfolio/` | `DashboardCard`, `FlashValue`, `PriceFreshness` + CSS |
| `components/sketches/` | 손그림 SVG(내비 아이콘 5 + 상태 일러스트 7) + `index.js` |
| `components/recommendations/` | `RecCard.jsx` |
| 루트 | 셸·전역 위젯 — `Masthead`, `MobileNav`, `MobileTopActions`, `GlobalSearch`, `StockSearchBox`, `StockModal`, `PromoteModal`, `Toast`(`ToastProvider`+`useToast`), `Glossary`, `InstallPrompt`, `PermissionManager`/`PermissionPanel`, `BatchScheduleEditor`, `LoadingSpinner` |

### 10.5 상태·훅
전역 상태는 Context 하나(`contexts/AuthContext.jsx` — `menuPermissions`·`role`·`loading`)뿐이고, 나머지는 페이지-로컬 `useState` + 커스텀 훅이다. 훅 15개(`hooks/`):

- 데이터: `usePortfolioData`(`fetchDashboard` 포함), `useReportList`, `useReportFilters`, `useStockManagement`, `useReportGeneration`
- UI/환경: `useIsMobile`, `useTheme`, `useBodyScrollLock`, `useCountUp`, `useReveal`, `usePriceFlash`, `useAuth`(AuthContext 재수출)

### 10.6 스타일
`src/index.css`가 4개를 import: `styles/tokens.css`(디자인 토큰, light 기본 + dark 변형, ADR-0026) → `styles/pc.css` → `styles/mobile.css` → `styles/guru.css`. 추가로 `styles/motion.css`, 컴포넌트별 병치 CSS(`ui/*.css`, `Masthead.css`, `market/Market.css`, `reports/ReportDetail.css`, `portfolio/*.css`, `Glossary.css`, `InstallPrompt.css`), 페이지 CSS 2개(`pages/Compare.css`, `pages/LoginPage.css`). TailwindCSS는 쓰지 않는다.

### 10.7 빌드·PWA — `frontend/vite.config.js`
- `VitePWA`(`registerType: 'autoUpdate'`, `cacheId: portfolion-<BUILD_DATE>`, `skipWaiting`+`clientsClaim`, `navigateFallback: null`). **runtimeCaching이 `/api/`(단 `/api/auth/` 제외)를 NetworkFirst로 가로챈다** — 그래서 Playwright `page.route` 응답 주입은 `serviceWorkers: 'block'` 컨텍스트가 필요하다.
- 커스텀 플러그인 `sw-cache-bust`가 `closeBundle`에서 `index.html`의 `registerSW.js`·`manifest.webmanifest`와 `registerSW.js`의 `/sw.js`에 `?<BUILD_DATE>` 쿼리를 붙인다. `configResolved`로 실제 `build.outDir`을 잡아 `--outDir` 빌드가 라이브 `dist`를 오염시키지 않게 한다.
- `manualChunks(id)` — **함수 형식만**(Vite 8 = rolldown). `recharts`/`d3-*`/`victory-vendor` → `charts`, 그 외 `node_modules` → `vendor`.
- `test`: vitest + jsdom + `src/test/setup.js`.

---

## 11. 테스트 구조

- **백엔드** — `backend/pytest.ini`(`testpaths=tests`, `pythonpath=.`), `backend/tests/` 128 테스트 파일 + `conftest.py` + `_routes.py` + `fixtures/`.
  `conftest.py`가 두 개의 autouse 가드를 건다: `_clear_quote_cache`(테스트 간 quote TTL 캐시 오염 차단), **`_block_real_db`**(`services.db._get_pool`을 raise로 몽키패치 — 로컬 `DATABASE_URL`이 라이브 도커 postgres를 가리켜 실제 오염 사고가 났던 경로). 또 `app.dependency_overrides[get_current_user]`를 모듈 로드 시 걸어 `main.app` 기반 테스트를 인증 통과시킨다 — **자체 `FastAPI()`를 만드는 테스트에는 걸리지 않는다**.
  규약 강제 테스트: `test_no_print.py`(앱 코드 `print(` 0), `test_no_bare_today.py`, `test_api_doc_sync.py`(라이브 `app.routes` ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md` 헤더 대조 + `KNOWN_UNDOCUMENTED` 베이스라인), `test_no_public_reads.py`(ADR-0029), `test_security_auth_gaps.py`(override 없는 fresh app으로 401/403 검증), `test_empty_result_*guards*.py`.
- **프론트** — vitest. 테스트가 두 곳에 산다: 대상 파일 **병치**(`pages/GuruAllocation.test.jsx`, `hooks/usePortfolioData.test.js`, `components/reports/Sections.test.jsx` 등)와 통합/라우팅 전용 `src/test/`(`route-redirects.test.jsx`, `masthead.test.jsx`, `smoke.test.js` 등 8개). jsdom에서 recharts는 렌더되지 않으므로 차트 테스트의 관측점은 주변 DOM이다.
- **라이브 UAT** — `scripts/` 110개 파일(Playwright `.mjs` 프로브/캡처, `.py` 감사 스크립트). 시각·레이아웃 검증은 여기가 유일한 게이트다.

---

## 12. 문서 계약

기능 표면을 바꿀 때 함께 갱신되는 문서가 코드 밖에 있다:
- `API_SPEC.md` — 전체 REST 레퍼런스(엔드포인트 *존재*는 `test_api_doc_sync.py`가 자동 검출, 요청/응답 스키마·인증 산문은 수동).
- `CLAUDE_COWORK_API.md` — 외부 Cowork enrich/backlog 워크플로우 전용 스코프.
- `README.md` — overview(화면 구성·env·스택·아키텍처·배치).
- `KIWOOM_API.md`, `KIS_API.md` — 외부 API 카탈로그·대체 로드맵.
- `.forge/adr/` — 결정 29건(`0001`~`0029`). 아키텍처 경계가 여기 박제돼 있다(0009/0011/0022 읽기전용 시세 경계, 0006 기동 마이그레이션, 0007 통합 배치 스케줄, 0012/0013 시장 분리, 0017 패키지 re-export, 0025/0026 프론트 IA, 0027 발행물 분리, 0028 이벤트 구동 트리거, 0029 공개 read 금지).
- `docs/ARCHITECTURE.md` 등 `docs/` 하위는 2026-05 시점 스냅샷으로 갱신이 멈춰 있다 — 이 문서가 현행이다.

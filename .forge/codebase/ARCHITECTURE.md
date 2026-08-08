---
last_mapped_commit: 47521121f10ac1c057fe9cf8ed5fc43ab5ca596c
mapped: 2026-07-31
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

**백엔드에 LLM 호출이 없다.** `backend/requirements.txt`에 anthropic/openai 계열이 없고(18개 의존성 전부 웹·데이터·인증 계열), AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API로 써넣는다(`CLAUDE_COWORK_API.md`). 유일한 LLM 접점은 `backend/services/cowork_trigger.py`의 트리거 POST 1개(ADR-0028)이며, `COWORK_ROUTINE_FIRE_URL`/`_TOKEN`이 없으면 휴면한다(`configured()`).

---

## 2. 런타임 토폴로지

- `docker-compose.yml` — 4 서비스: `postgres`(16-alpine, `pgdata` 볼륨, `backend/auth_schema.sql`→`backend/app_schema.sql` 순서로 `docker-entrypoint-initdb.d` 마운트, 5432 호스트 노출), `backend`(`backend/Dockerfile` 빌드, `backend/.env.docker` env_file), `nginx`(80/443), `certbot`(12시간 루프 `certbot renew`).
- `nginx/nginx.conf` — `/api/`·`/health` → `http://backend:8000` 프록시. 나머지는 `/usr/share/nginx/html`(= `frontend/dist` `:ro` 마운트) 정적 서빙 + `try_files $uri /index.html` SPA 폴백. 캐시 정책 3단: `index.html`·`sw.js`/`workbox-*.js` no-store, 해시 자산(js/css/img/woff2) `max-age=31536000 immutable`. 443 server 블록은 전체 주석 처리 상태(HTTPS 종단은 Cloudflare Tunnel).
- `deploy.sh` — 프론트 빌드 → 백엔드 이미지 빌드 → `portfolion-backend-1`/`portfolion-nginx-1` 컨테이너를 `docker run`으로 교체 → `curl /health`. `/tmp/portfolion-deploy.lock`으로 동시배포 차단(러너 + 폴러). **backend·nginx는 compose가 아니라 `docker run`으로 재생성**되므로 `docker compose ps`에 안 잡힌다.
- `.github/workflows/deploy.yml` — self-hosted 러너 배포 경로(주). 폴백 폴러는 `scripts/auto-deploy-poll.sh`(launchd 2분 주기).
- 로컬 개발: `start.sh`/`start.bat`(양 서버), Vite dev 프록시 `/api` → `localhost:8000`(`frontend/vite.config.js`).

---

## 3. 백엔드 진입점 — `backend/main.py` (296줄)

한 파일이 다섯 가지를 한다(순서가 의미 있음):

1. **로깅 배선** — `_configure_logging()`(`:18`)이 라우터 임포트 *전에* 1회 실행(`:30`). `basicConfig(level=INFO)` + `urllib3`/`yfinance`/`apscheduler`/`asyncio`를 WARNING으로 억제 + `uvicorn*` 로거 `propagate=False`(중복 emit 차단).
2. **기동 idempotent 마이그레이션** — `_migrate()`(`:60`, ADR-0006). `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`만 쓰고 각 블록이 개별 `try/except`+`logger.warning`이라 하나가 실패해도 기동은 계속된다. **라이브 DB는 이 함수만 타고 `app_schema.sql`은 신규 설치용**이라, 새 컬럼/테이블은 두 곳 모두 필요하다.
3. **미들웨어**(`:262`~) — `SessionMiddleware`(OAuth용, `SESSION_SECRET`), `EventTrackerMiddleware`(`backend/middleware/event_tracker.py`), `CORSMiddleware`(`localhost:3000`·`localhost:5173`·`FRONTEND_URL`).
4. **라우터 마운트**(`:273`~`:291`) — 19개(§4 표). `auth_router`가 첫째, `admin_router`가 마지막.
5. **검증 에러 핸들러**(`:253`) — `_validation_error_handler`가 `RequestValidationError`의 `detail`을 `services.utils.sanitize`로 통과시킨다. 입력 NaN을 거부하면 422 detail이 그 NaN을 echo하고 starlette `allow_nan=False`가 500으로 바꾸는 경로를 앱 전역에서 막는다.

`lifespan`(`:241`, asynccontextmanager): `_migrate()` → `sched.start()` → `_warm_market_cache()`(`:51`)를 데몬 스레드로 → (종료 시) `sched.stop()`.

`GET|HEAD /health`(`:294`)는 `main.py`에 직접 정의된 유일한 엔드포인트다.

---

## 4. 라우터 층 — `backend/routers/`

19개 라우터, 전부 `main.py`에서 `include_router`. 파일당 `router = APIRouter(prefix=..., tags=[...])` 하나. prefix 스타일이 두 가지로 갈린다.

| 파일 | prefix | 비고 |
|---|---|---|
| `auth.py` | `/api/auth` | 공개 엔드포인트 존재(ADR-0029 예외) |
| `portfolio.py` | `/api/portfolio` | |
| `watchlist.py` | `/api/watchlist` | |
| `stocks.py` | `/api/stocks` | 최대 파일(30KB), 대시보드 빌드 포함 |
| `guru.py` | `/api/guru` | `/stats/allocation`이 `?top=N` 코호트 절단 지원 |
| `market_indicators.py` | `/api/market` | ⚠️ `/api/market-indicators`는 존재하지 않는다 |
| `analysis.py` | `/api/analysis` | |
| `analytics.py` | `/api/analytics` | |
| `admin.py` | `/api/admin` | `ALL_MENUS` 정의처 |
| `events.py` | `/api/events` | `VALID_EVENTS` 화이트리스트 |
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

**라우터 등록 순서 함정**(코드 주석에 명시): `PUT /api/stocks/enrich/batch`(`routers/stocks.py:379`)는 `PUT /api/stocks/{ticker}/enrich`보다 **앞에** 있어야 `enrich`가 ticker 값으로 잡히지 않는다. `routers/report.py`에는 같은 클래스의 순서 주석이 두 군데 있다 — `/report/{ticker}/us-supply`(`:395` 주석, "5번째 재발 방지")와 `/report/{ticker}/backlog`(`:416` 주석)가 catch-all `/report/{ticker}/{date_str}`보다 먼저 등록돼야 한다.

---

## 5. 인증·권한

`backend/auth.py`가 FastAPI 의존성 4종을 제공한다(전부 HS256 JWT, `JWT_SECRET`):

| 의존성 | 정의 | 통과 조건 |
|---|---|---|
| `get_current_user` | `auth.py:18` | Bearer JWT → `payload["sub"]` |
| `get_current_user_or_api_key` | `:37` | `X-API-Key == COWORK_API_KEY` (→ 센티넬 `_API_KEY_USER_ID = "__api_key__"`) 또는 JWT |
| `require_admin` | `:61` | JWT + `users.role == 'admin'`. **API 키를 거부한다** |
| `require_admin_or_api_key` | `:68` | API 키 또는 admin JWT |

역할 조회는 `backend/services/auth_service.py`. 메뉴 권한은 `user_menu_permissions`/`default_menu_permissions` 테이블 + `backend/routers/admin.py`의 `ALL_MENUS`, 프론트에서는 `frontend/src/contexts/AuthContext.jsx`가 로그인 시 로드해 nav를 필터한다.

행동 로그는 두 경로:
- **미들웨어 자동 수집** — `backend/middleware/event_tracker.py`의 `_TRACKED` 7패턴(`stock_add`×2, `stock_delete`×2, `stock_promote`, `report_generate`, `guru_crawl`), 2xx일 때만 `asyncio.create_task`로 비동기 INSERT. JWT는 `_extract_user_id_from_header`로 직접 디코드한다(의존성 그래프 밖).
- **프론트 명시 호출** — `frontend/src/utils/analytics.js` → `POST /api/events`, `backend/routers/events.py`의 `VALID_EVENTS` 화이트리스트. nav 이벤트명은 `navSections.js`의 `item.evt`/`section.perm`에서 파생된다(§10.3).

---

## 6. 서비스 층 — `backend/services/`

서브패키지 6개 + 플랫 모듈 39개가 한 디렉터리에 섞여 있다.

### 6.1 인프라/공용
- `db.py` — `ThreadedConnectionPool(minconn=1, maxconn=20)`(`:21`) + `get_connection()` 컨텍스트매니저(자동 commit/rollback/putconn) + `query`/`execute`/`execute_many`. 풀 소진 시 psycopg2는 블록이 아니라 `PoolError`를 던지므로 `maxconn`이 최대 ThreadPool 동시성보다 커야 한다(주석에 근거 명시).
- `cache.py` — 인메모리 캐시 10종(§8.1).
- `utils.py` — `today_kst()`(KST 시장-날짜; bare `date.today()` 대체), `sanitize()`(NaN/inf→None 재귀), `is_valid_ticker`/`TICKER_RE`, `find_ticker*` 헬퍼.
- `errors.py` — `not_found`/`already_exists` HTTPException 팩토리.
- `parallel.py` — `parallel_map(func, items, max_workers=10)`.
- `progress.py` — `ProgressTracker`(구루 크롤 등 백그라운드 작업 진행률).
- `job_runs.py` — 배치 실행로그 컨텍스트매니저(§7.3).
- `batch_registry.py` — 배치 정적 메타데이터(§7.1, 18KB — services 중 2번째로 큼).
- `schedule_spec.py` — 스케줄 스펙 → APScheduler cron kwargs(`build_trigger_kwargs`).
- `storage/` — 앱 상태 저장소 파사드(§6.4).

### 6.2 외부 API 어댑터 (읽기전용 경계)
| 패키지 | 경계 ADR | 구성 |
|---|---|---|
| `services/market/` | — | `__init__.py`(`get_quote`·`get_quotes_batch`·`get_history_df`·`get_financials`·`get_annual_financials`·`get_analyst_data`·`resolve_name`), `kr.py`(31KB, 어댑터 최대), `us.py`, `format.py`(`_norm_sector`·`_yf_val` 등) |
| `services/kiwoom/` | ADR-0009/0010 | `client.py`(토큰 싱글톤·`request(api_id, body, category)`·`integrated_code(regular=)`), `quote.py`, `chart.py`, `investor.py`, `sector.py`, `shortsell.py` |
| `services/kis/` | ADR-0011/0022 | `client.py`(`/oauth2/tokenP`, 60s 재발급 가드), `quote.py`(국내+해외), `futures.py` |
| `services/market_indicators/` | — | 11모듈 + `cache.py`(§8.2) |

`services/scraper.py`(Finviz/BeautifulSoup), `services/guru_scraper.py`(dataroma)도 외부 소스 어댑터다.

### 6.3 도메인 서비스
분석·산출: `indicators.py`, `beta.py`, `exposure.py`, `rebalance.py`, `analysis_service.py`(SECTOR_ETFS·MACRO_TICKERS 상관), `supply_score.py`, `guru_stats.py`, `us_supply.py`, `us_sector_service.py`, `kr_sector_service.py`, `ranking_service.py`, `investor_service.py`, `short_sell_service.py`, `leverage_service.py`, `lending_service.py`, `dividends.py`, `consensus.py`(as-of 정본 조회, ADR-0008), `consensus_pipeline.py`, `insider_trades.py`, `disclosures.py`, `agm.py`, `backlog.py` + `backlog_parser.py`, `analyst_reports.py`(ADR-0027 발행물 store: `save_report`/`list_reports`/`get_report`/`delete_reports` + `build_data_block`/`per_band`), `digest_service.py`, `report_generator.py`(35KB, services 최대 — 스냅샷 생성/백필), `recommendation/`(§6.5), `auth_service.py`, `cowork_trigger.py`.

`*_service.py` 접미사는 일관 규칙이 아니다 — `dividends.py`/`beta.py`처럼 접미사 없는 도메인 모듈도 있다(`STRUCTURE.md §7.1` 참조).

### 6.4 저장소 파사드 — `backend/services/storage/`
ADR-0017의 "god file → 패키지 re-export" 패턴. `__init__.py`(50줄)가 4 서브모듈 + `services.db` 헬퍼(`get_connection`/`query`/`execute`)를 **전 심볼 명시 re-export**하므로 외부 소비처는 `storage.X` 모듈 속성으로만 접근한다(직접 심볼 import 0건, `__init__.py` 주석 명시).

| 서브모듈 | 담당 |
|---|---|
| `portfolio.py`(296줄) | `get_stocks`/`save_stocks`/`get_holdings`/`save_holdings`/`get_watchlist_tickers`/`save_watchlist_tickers`/`get_full_portfolio`/`get_all_stocks`/`get_global_portfolio`/`enrich_stock`/`set_target_weights`/`set_pinned` + `_ENRICH_KEYS`·`_ANALYST_KEYS`·`_JSON_TEXT_FIELDS`·`_parse_json_field` |
| `names.py`(78줄) | `refresh_snapshot_names`/`set_ticker_name`/`reconcile_snapshot_names`/`tickers_missing_name`/`update_ticker_meta`/`_invalidate_name_caches` — `tickers.name`(마스터)와 `snapshots.data.name`(박제) 이중 저장소 동기화 |
| `schedule.py`(68줄) | `get_schedule`/`get_guru_managers`/`save_guru_managers`/`get_guru_schedule`/`save_guru_schedule`/`get_batch_schedule`/`save_batch_schedule`/`get_all_batch_schedules` |
| `dates.py`(52줄) | `expected_report_date(market)`/`expected_report_dates()`/`_now_kst`/`_DAY_ABBR` + `_REPORT_BATCH_BY_MARKET = {"KR": "daily_report_kr", "US": "daily_report_us"}` |

### 6.5 추천 엔진 — `backend/services/recommendation/`
ADR-0015/0016/0021. `__init__.py`가 공개 API 7개를 re-export: `build_universe`(`universe.py`), `score_stock`/`derive_flags`(`scoring.py`), `run_recommendation_batch`(`funnel.py`), `replace_recommendations`/`read_recommendations`(`store.py`), `derive_holding_action`(`actions.py`). docstring에 배치-백킹 규약을 못박아 뒀다 — "배치가 점수를 사전계산해 `stock_recommendations`에 저장하고, `GET /api/recommendations`는 저장값만 읽는다".

`universe.py`는 `backend/data/sp500_tickers.json`을 `_SP500_PATH`로 **read만** 한다(write 경로 없음).

---

## 7. 배치 경로

### 7.1 레지스트리 — `backend/services/batch_registry.py`
`BATCHES` 리스트(현재 **29개 항목**) + `_BY_ID` 인덱스 + `get_batch(job_id)`. 각 항목 필드:

`id` · `label` · `category`(`report`|`market`|`guru`) · `schedule_desc` · `usage`(소비 UI) · `source`(fetch 출처) · `editable` · `trigger_kinds` · `manual_endpoint` · `scheduler_job_id` · `timezone` · `misfire_grace_time`(옵션) · `market`(`KR`|`US`|`공통`, 출처국 기준 — ADR-0013) · `default_schedule`.

`id`는 **세 곳에서 동일해야 하는 계약**이다: APScheduler job id ↔ `job_runs.record(id, …)` ↔ `batch_schedules.job_id`. `consensus`만 자체 잡이 없어 `scheduler_job_id: None`(일일 리포트에 내장) — 그래서 `_JOB_FUNCS`는 28엔트리다.

현재 id 29개:
`daily_report_kr` `daily_report_us` `consensus` `daily_digest` `backlog_fetch` `dividend_fetch` `beta_fetch` `disclosure_fetch` `agm_fetch` `insider_fetch` `earnings_kr` `earnings_us` `monthly_kr` `monthly_us` `macro_signals_fetch` `kospi_signal_fetch` `leverage_fetch` `lending_fetch` `kr_rankings_fetch` `us_rankings_fetch` `investor_trend_fetch` `short_sell_fetch` `supply_score_fetch` `kr_sector_fetch` `us_sector_fetch` `guru_crawl` `recommendation_kr` `recommendation_us` `us_supply_fetch`

시장 분리 쌍: `daily_report_kr`/`daily_report_us`(ADR-0012), `earnings_kr`/`earnings_us`, `monthly_kr`/`monthly_us`, `recommendation_kr`/`recommendation_us`, `kr_sector_fetch`/`us_sector_fetch`, `kr_rankings_fetch`/`us_rankings_fetch`(ADR-0013).

⚠️ 모듈 docstring이 "20개 배치"라고 적혀 있으나 실제는 29개다(스케일 서술만 stale, 구조는 정확).

### 7.2 스케줄러 패키지 — `backend/scheduler/`
**단일 `scheduler.py`가 아니라 루트 레벨 패키지**다(`services` 하위도 아님).

| 파일 | 역할 |
|---|---|
| `_state.py` | `_scheduler`(APScheduler 인스턴스)·`_DIGEST_JOB_ID`·`_VALID_DAYS` — leaf 모듈로 두어 부분초기화 순환을 피한다 |
| `jobs.py` | 잡 함수 전부 + `_JOB_FUNCS` 딕셔너리(job_id → 함수, **28엔트리**) + `_in_market`(KR = `market=='KR'`, US = 그 외 전부) + `_seed_*_if_empty` 3종 |
| `schedule.py` | `_build_trigger`·`_reschedule_job`·`_seed_spec_for`·`_seed_batch_schedules`·`_check_missed_report(_for)` |
| `__init__.py` | 배선 + `start()`/`stop()`/`reload(job_id)` 공개 API. 잡 함수·스케줄 심볼을 **private까지 명시 re-export**(`import *`가 underscore를 건너뛰므로) |

`start()`(`__init__.py:63`) 순서: `_seed_batch_schedules()` → `BATCHES` 중 `editable`마다 `_reschedule_job()` → `_check_missed_report()` → `_seed_rankings_if_empty()` → `_seed_kr_sector_if_empty()` → `_seed_us_sector_if_empty()` → `_scheduler.start()`.

- `_reschedule_job`: `batch_schedules` 스펙을 읽어 잡 재등록. `enabled: false`면 제거만. `misfire_grace_time`이 레지스트리에 없으면 **인자 자체를 뺀다**(None을 넘기면 APScheduler가 '유예 무제한'으로 해석).
- `_seed_batch_schedules`: 행이 없을 때만 시드(idempotent). `_seed_spec_for`가 은퇴 id(`daily_report`·`earnings_refresh`·`monthly_refresh`)와 레거시 store(`schedules`·`guru_schedules`)에서 스펙을 승계한다 — 이 read는 정당한 잔존이다.
- `_check_missed_report_for`: 기동 시 당일 스케줄 시각이 지났는데 **개별 종목** 스냅샷이 없으면 그것만 재생성(전체 스킵이 아니라 부분 누락 복구).

### 7.3 실행로그 — `backend/services/job_runs.py`
`record(job_id, trigger)` 컨텍스트매니저(`:16`). enter에서 `running` 행 INSERT(`RETURNING id`) + 해당 job_id 최신 `KEEP=20`건만 prune, exit에서 `success`/`failed` UPDATE. **계측은 관측 전용** — 쓰기 실패는 `logger.warning` + `run_id=None` 센티넬로 본문을 그대로 실행한다(ADR-0001).

⚠️ 계측의 구조적 한계가 docstring에 명시돼 있다: `failed`는 본문이 예외를 **전파**할 때만 기록된다. 다수 잡 함수가 내부 예외를 `try/except`+warning으로 삼키고 정상 종료하므로 부분/전체 실패도, **빈 결과 가드가 저장을 스킵한 경우도** `success`로 남는다. 그 눈멂을 보완하려고 프론트가 수동 실행 응답 본문을 화면에 표시한다(§10.6).

조회는 `recent(job_id, n)`·`recent_map(job_ids)`(윈도우 함수 `ROW_NUMBER() OVER (PARTITION BY job_id …)`), 실패 시 빈 리스트로 graceful degrade.

### 7.4 스케줄 편집 흐름
`GET|PUT /api/batches/{job_id}/schedule`(`backend/routers/batches.py`) → `storage.save_batch_schedule` → `scheduler.reload(job_id)` → `_reschedule_job`(ADR-0007). `GET /api/batches`가 레지스트리 메타 + `job_runs.recent_map` + `next_run`을 합쳐 현황 허브에 노출한다. 프론트 편집기는 `frontend/src/components/BatchScheduleEditor.jsx`, 수동 실행 버튼은 `frontend/src/pages/Settings.jsx`의 `ManualRunButton`(named export).

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

`backend/services/cache.py` 인메모리 캐시 **10종** (`TTLCache(ttl)` + 스냅샷 LRU):

| 이름 | 종류 | 키 | 무효화 |
|---|---|---|---|
| `_snapshots`(`:32`) | LRU `_MAX=50` | `TICKER/date` | `invalidate(ticker)` |
| `_list_cache`(`:33`) | TTL 60s | user_id | `invalidate_list()` |
| `_dashboard_cache`(`:34`) | TTL 300s | user_id | `invalidate_dashboard(user_id?)` |
| `_correlation_cache`(`:35`) | TTL 300s | user_id | `invalidate_correlation` |
| `_sector_cache`(`:88`) | TTL 300s | `user_id:market` | `invalidate_sector` |
| `_macro_cache`(`:89`) | TTL 300s | user_id | `invalidate_macro` |
| `_quote_cache`(`:110`) | TTL 60s | quote 키(`regular` 포함) | `invalidate_quote` |
| `_live_prices_cache`(`:124`) | TTL 15s | user_id | `invalidate_live_prices` |
| `_rebalance_cache`(`:136`) | TTL 300s | user_id | `invalidate_rebalance` |
| `_exposure_cache`(`:137`) | TTL 300s | user_id | `invalidate_exposure` |

두 개의 팬아웃 무효화기:
- `invalidate(ticker)`(`:52`) — 스냅샷 prefix 삭제 + list/dashboard/correlation/sector/macro/live_prices 전체 clear.
- `invalidate_portfolio_caches(user_id?)`(`:156`) — `routers.calendar.clear_cache(user_id)`(= `calendar_cache` DB 행 삭제) + list/dashboard/sector/macro/correlation/live_prices/rebalance/exposure. 종목 추가·삭제·승격 시 호출된다. `routers` import는 함수 안에서 지연 import(순환참조 회피).

### 8.2 시장지표의 2단 캐시 — `backend/services/market_indicators/`

`cache.py`가 공용 기계를 제공한다:
- `_cache`(모듈 전역 dict, 항목별 `expires`, `:15`) + `_get_cache`/`_set_cache` — 인메모리 1단.
- `_mc_load(key)`/`_mc_save(key, data)`/`_mc_delete(key)`/`clear_cache(key)` — PostgreSQL `market_cache(key, data, fetched_at)` 2단(영구).
- `get_or_refresh(key, fetch_fn, ttl, force=False)`(`:110`) — 인메모리 → `_mc_load` → `fetch_fn()`. ⚠️ **`ttl`은 인메모리 수명만 지배하고 `_mc_load` 결과에는 걸리지 않는다** — 저장 행이 있으면 나이 불문 반환하고, 실제 재조회자는 `force=True`를 주는 배치뿐이다.
- `_merge_history(stored, new_pts)`(`:69`) — 날짜 키 dict merge 후 정렬. **`new_pts`가 빈 리스트면 `stored`를 그대로 돌려준다**(구조적 last-good 보존).
- `_filter_outliers(pts, max_ratio=5.0)`(`:75`) — 중앙값 5배 밴드.
- `_yf_close_history(sym, stored, precision)`(`:85`) — 마지막 저장 날짜 이후만 yfinance 증분 조회 + 366일 트림 + outlier 필터.

모듈별 담당(`__init__.py`가 공개 함수 + `_fetch_and_save_*`를 명시 re-export):

| 모듈 | 공개 함수 | 갱신 경로 | 배치 |
|---|---|---|---|
| `fx.py` | `get_fx`·`get_vix` | 요청경로 증분, 수동 last-good 폴백 | 없음 |
| `commodities.py` | `get_commodities`·`get_treasury` | 요청경로 증분 | 없음 |
| `indices.py` | `get_indices` | 요청경로 증분(+ `multpl.com` CAPE 크롤) | 없음 |
| `sentiment.py` | `get_fear_greed` | 요청경로 증분, VIX식 수동 폴백 | 없음 |
| `kospi_futures.py` | `get_kospi_futures` | 요청경로(KIS), 값-수준 가드 | 없음 |
| `earnings.py` | `get_m7_earnings`·`get_kr_top2_earnings` | 배치 | `earnings_kr`/`earnings_us` |
| `econ.py` | `get_econ_indicators` | 배치(FRED) | `monthly_us` |
| `exports.py` | `get_kr_exports` | 배치 | `monthly_kr` |
| `macro.py` | `get_macro_signals` | 배치(FRED) | `macro_signals_fetch` |
| `kospi_signal.py` | `get_kospi_signal`·`refresh_kospi_signal` | 배치 | `kospi_signal_fetch` |

`market_indicators.py` 라우터의 GET은 전부 얇다 — `get_*()` 호출 + `try/except → HTTPException(500)`. `POST /refresh-*`는 `require_admin` + `job_runs.record(id, "manual")`로 감싼 `_fetch_and_save_*` 호출이다.

`earnings.py`는 `backend/data/sp500_tickers.json`·`kospi_tickers.json`을 `_SP500_SEED`/`_KOSPI_SEED`로 **read-only 시드**로만 읽고, 티커 캐시 자체는 `market_cache` 키 `sp500_tickers`·`kospi_tickers`에 둔다(파일 write 경로 0).

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
1. *소스-폴백(권장형)*: last-good을 fetch 계층에 실어 빈 결과가 필드에 닿기 전에 직전값으로 채운다. 예 — `fx.py:_fetch_fx`가 실패 시 `stored_history`를 담아 반환, `market_indicators/cache.py:_merge_history(prev, [])`가 prev 반환, `dividends.py`가 `fetch_dividend_schedule(...)`을 `replace_schedule` 진입 전에 평가.
2. *끝 가드*: 저장 직전 한 지점에서 판정. 실패 클래스 3종을 모두 물어야 한다 — (a) 예외 (b) 성공-but-빈응답(`rt_cd=0`/200 with 0 items) (c) 부분 페이로드(같은 payload의 일부 필드만 가드). 실례가 `market_indicators/exports.py`(예외 가드 *아래* 별도 `months` 빈 검사 + `stale` 마커)와 `services/kr_sector_service.py`(`sectors`와 `index` 각각), `routers/guru.py:_run_crawl`/`scheduler/jobs.py:_run_guru_crawl`(`save_guru_managers`가 False 반환 시 "직전값 유지" 로깅)에 남아 있다. 회귀 가드는 `backend/tests/test_empty_result_overwrite_guards.py`·`test_empty_result_guards_exports_krsector.py`·`test_rankings_empty_guard.py`·`test_us_supply_empty_guard.py`.

delete-rewrite(replace) 저장은 fetch 실패 시 DELETE 자체를 스킵해야 한다(빈 결과 박제보다 파괴적) — `services/dividends.py:replace_schedule` 호출부가 그 형태다.

**이상치 가드(값 수준)**: 외부 소스가 파싱에 *성공*하는 오값을 주는 경로엔 배수 밴드 가드가 붙는다 — `services/guru_stats.py:_VALUE_EST_BAND`(dataroma 신고값 vs `weight_pct×portfolio_value` 추정값 5배 밴드), `services/report_generator.py:_guard_peer_multiples`/`_PEER_MULTIPLE_BAND=5`(피어 `per`·`pbr`·`psr`·`ev_ebitda`를 "값 있는 peer 전체 + 자사" 중앙값과 대조, 표본 3개 미만·중앙값 ≤0이면 판정 생략 — ADR-0030). `_peer_median`은 프론트 `components/reports/reportUtils.jsx:computePeerPremiums`와 **같은 중앙값 정의**를 쓴다(짝수면 중간 두 값 평균).

**병렬성 상한**: 배치 ThreadPool은 DB 풀 소진을 피하려 `max_workers ≤ 8`로 못박혀 있다(`scheduler/jobs.py`의 `_investor_trend_work`·`_short_sell_work`). `services/parallel.py:parallel_map`의 기본은 10, 캘린더 yfinance 병렬은 별도(최대 30).

### 8.4 수동 트리거 경로
같은 배치 함수를 admin 엔드포인트가 다시 호출한다. 규약은 **동일 job_id로 `job_runs.record(id, "manual")`** — 그래서 현황 허브의 실행이력에 auto/manual이 한 줄에 섞인다. 오래 걸리는 것은 `BackgroundTasks` + `202 Accepted` + `ProgressTracker`(구루 크롤, 이름 백필, 배당/베타/수급스코어 리프레시, 레버리지 백필, `POST /api/report/backlog/refresh-all`).

---

## 9. 저장 계층

### 9.1 PostgreSQL — 정본
스키마 파일 2개, **적용 순서가 강제**된다(compose initdb 마운트 `01-auth.sql` → `02-app.sql`): `backend/auth_schema.sql`(`users`, `refresh_tokens`) → `backend/app_schema.sql`(32 테이블). 라이브 증분은 `backend/main.py:_migrate()`.

계열별 그룹:
- 사용자·권한: `users`, `refresh_tokens`, `user_menu_permissions`, `default_menu_permissions`, `user_events`
- 종목·포트폴리오: `tickers`(공유 마스터), `user_stocks`(user별 holding/watchlist), `snapshots`(ticker+date JSON)
- 리포트 부속: `raw_reports`, `analyst_reports`, `backlog_history`, `stock_disclosures`, `stock_dividends`, `stock_dividend_schedule`, `stock_beta`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`, `us_supply_snapshot`
- 컨센서스: `consensus_history`, `daily_consensus_mart`(as-of 정본, ADR-0008)
- 시장 시계열: `market_cache`(키-값 JSON), `market_rankings`, `market_investor_trend`, `market_short_sell`, `market_leverage_indicators`, `market_lending_balance`
- 운영: `schedules`(레거시 단일행), `guru_schedules`, `guru_managers`, `batch_schedules`(ADR-0007), `job_runs`(ADR-0001), `digests`, `calendar_cache`

`backend/migrations/001_user_events.sql`·`002_backlog_history.sql`는 초기 수동 마이그레이션 잔존물 — 현재 정본 경로는 `_migrate()`다.

### 9.2 파일
| 경로 | 성격 |
|---|---|
| `backend/snapshots/` | 리포트 스냅샷 JSON 폴백(gitignored). `services/report_generator.py:SNAPSHOTS_DIR` |
| `backend/reports/` | 레거시 리포트 디렉터리. `routers/report.py:_read_snapshot`(`:146`)이 DB → `(SNAPSHOTS_DIR, REPORTS_DIR)` 순으로 폴백 read |
| `backend/data/sp500_tickers.json`, `kospi_tickers.json` | **read-only 정적 시드.** read자 2곳(`market_indicators/earnings.py`, `recommendation/universe.py`), write자 0 |
| `backend/data/kr_exports.json` | `market_indicators/exports.py`가 `_mc_save`와 **함께** 쓰는 파일 미러 + 최후 폴백 read — 현재 유일하게 코드가 write하는 `data/` 파일 |
| `backend/data/holdings.json`·`watchlist.json`·`stocks.json`·`guru_managers.json`·`guru_schedule.json`·`schedule.json`, `data/consensus/`·`data/calendar/`·`data/digest/` | 코드 참조 0건(grep 확인) — DB 이전 이후 남은 레거시 |

---

## 10. 프론트엔드 아키텍처

### 10.1 부트스트랩 체인
`frontend/index.html` → `frontend/src/main.jsx`(`createRoot` + `styles/motion.css` import) → `frontend/src/App.jsx:App`

`App`은 이제 **얇다**(133줄) — 인증 부트스트랩과 bfcache 가드를 훅으로 뺐다:

```
App()
  ├─ useTheme()                     hooks/useTheme.js
  ├─ useAuthBootstrap()             hooks/useAuthBootstrap.js  → { session, setSession, authLoading }
  ├─ useBfcacheAuthGuard(!!session) hooks/useBfcacheAuthGuard.js
  ├─ authLoading  → null
  ├─ !session     → <LoginPage/>
  └─ session      → ToastProvider > AuthProvider > BrowserRouter > AppShell
```

- **`hooks/useAuthBootstrap.js`** — 첫 로드에서 세션을 해석한다. URL 쿼리 4종을 분기: `error`(→ `replaceState('/')` + 저장 토큰 유지), `oauth`(→ `GET /api/auth/oauth/token?code=` 교환 → 성공 시 `returnFromOAuth()`, 실패 시 저장 토큰 유지), `token`+`refresh`(직접 주입), 없으면 저장 토큰 해석. 규약이 주석에 못박혀 있다 — **"OAuth가 실패했다"는 "세션이 없다"를 뜻하지 않는다**(뒤로가기로 콜백 엔트리가 재실행되면 1회용 코드가 반드시 400이 되므로). 훅으로 뺀 이유도 주석에 있다: 이 코드베이스는 테스트에서 `App`을 import하지 않는 관례라 `App` 안에 있는 동안 이 분기들은 단위테스트가 원리적으로 닿지 못했다.
- **`hooks/useBfcacheAuthGuard.js`** — `pageshow.persisted`일 때 `localStorage.access_token` 유무와 렌더된 로그인 상태가 **어긋날 때만** `location.replace('/')`. 양방향(로그인 후 뒤로가기 / 로그아웃 후 뒤로가기)을 다룬다.
- **`utils/oauthHistory.js`** — `markOAuthStart()`(`sessionStorage.oauth_hist_len = history.length`, `LoginPage`가 IdP로 떠나기 직전 호출) / `returnFromOAuth()`(랜딩에서 `history.go(-delta)`). `MAX_REWIND = 20`을 넘거나 delta ≤ 0이면 `location.replace('/')`로 폴백. IdP 히스토리 엔트리는 크로스오리진이라 지울 수 없으므로 '앞으로 밀어낸다'.

세션을 없애는 경로 3곳이 모두 `location.replace`를 쓴다(히스토리 엔트리를 남기지 않아 뒤로가기 재진입을 차단) — `App.jsx:doLogout`은 `setSession(null)`, `api.js` 401 인터셉터와 `LoginPage.jsx` 로그인 성공은 `window.location.replace('/')`.

`AppShell`(같은 파일 `:60`)이 셸 레이아웃을 그린다 — PC `Masthead`, 모바일 `.mobile-header`(brand + `GlobalSearch variant="mobile"` + `MobileTopActions` + 테마/로그아웃), `<main className="page-wrap">` 안에 `key={location.pathname}`의 `.anim-fade` 래퍼 + `InstallPrompt` + `<Routes>`, 하단 `MobileNav`.

HTTP는 `frontend/src/api.js` axios 인스턴스 하나: `baseURL = VITE_API_BASE_URL || ''`, 요청 인터셉터가 `Authorization: Bearer`를 붙이고, 응답 인터셉터가 401에서 토큰을 지우고 `replace('/')`. `utils/analytics.js`와 `App.jsx:doLogout`·`LoginPage.jsx`만 raw `fetch`를 쓴다.

### 10.2 라우팅
라우트 정의는 `App.jsx`의 `<Routes>` 한 곳(17 라우트), 구 URL 리다이렉트는 `frontend/src/routes.js`의 `REDIRECTS` 4쌍(ADR-0025) — `/`→`/reports`, `/research`→`/reports`, `/market`→`/market/indicators`, `/analysis`→`/portfolio`.

허브 4종이 서로 다른 방식으로 탭을 구성한다:

| 허브 | 파일 | 탭 전환 방식 |
|---|---|---|
| 리서치 셸 | `pages/ResearchShell.jsx` | **라우트 네비게이션**. 9개 라우트(`/reports` `/recommend` `/ranking` `/compare` `/calendar` `/dividends` `/digest` `/analyst-reports` `/analyst-report/:ticker/:date`)가 `<ResearchShell><Tab/></ResearchShell>`로 감싸진다 |
| 시장 허브 | `pages/MarketHub.jsx` → `pages/Market.jsx` | 라우트 2개(`/market/indicators`·`/market/flow`) → `Market`이 `tab` prop으로 섹션 분기 |
| 구루 | `pages/Guru.jsx` | **로컬 `useState`**. `GuruManagers`·`GuruStats(view=)`·`GuruAllocation` |
| 포트폴리오 | `pages/Portfolio.jsx` | 로컬 `useState` 2탭(`dash`/`analysis`). 분석탭이 `SectorTab`·`MacroTab`·`Analytics`·`RebalanceTab`·`ExposureTab`를 품는다 |

`ReportsRoute`(`App.jsx:53`)는 `location.state.ticker` 딥링크를 `Reports`에 `initialTicker`로 넘기고 `navKey={location.key}`로 같은 라우트 재네비게이션도 반영한다.

### 10.3 nav IA 단일 소스 — `frontend/src/navSections.js`

**5섹션 IA의 정본이 파일 하나로 통일됐다**(ADR-0026, task#251). 이전에는 `Masthead`(`SECTIONS`)·`MobileNav`(`RESEARCH_PATHS`/`SCHEDULE_PATHS`/`ALL_TABS`)·`ResearchShell`(`RESEARCH_TABS`/`SCHEDULE_TABS`) 세 곳이 같은 목록을 수기 복제했고, 한 곳 누락이 실질 재발 경로였다.

export 4개:
- `NAV_SECTIONS` — 섹션 5개(`research` `portfolio` `market` `schedule` `guru`) × `{key, label, perm, items[]}`, item은 `{to, label, evt?, match?}`.
- `matchesItem(pathname, item)` = `pathname.startsWith(item.match ?? item.to)`
- `matchesSection(pathname, section)` = 섹션 items 중 하나라도 매치
- `sectionByKey(key)`

소비처 3곳이 **파생**만 한다(아이콘 셋이 서로 달라 각자 `ICONS[section.key]` 매핑을 갖는다):

| 소비처 | 파생물 | 아이콘 |
|---|---|---|
| `components/Masthead.jsx` | PC 2행 카테고리(`CategoryLink`) + 3행 서브바(`items.length >= 2`일 때만) | `components/sketches/`(`IconResearch` 등) |
| `components/MobileNav.jsx` | 하단 탭바(섹션당 링크 1개, `to = section.items[0].to`) | `components/ui/icons`(`SearchIcon` 등) |
| `pages/ResearchShell.jsx` | 모바일 seg 필 — `sectionByKey('research')`/`sectionByKey('schedule')` 중 현재 섹션 하위만 노출 | 없음 |

권한 게이팅은 세 곳 모두 `useAuth().menuPermissions.includes(section.perm)`. `schedule` 섹션의 `perm`은 `research`를 공유한다.

⚠️ 두 가지 미묘한 계약이 주석에 명시돼 있다:
- **`match: '/analyst-report'`(단수)** 하나가 목록 `/analyst-reports`와 상세 `/analyst-report/:ticker/:date`를 함께 덮는다(상세에서 부모 탭 강조 = 앱 관례, `/guru/:id`와 동일). 형제 항목끼리 접두사 관계가 생기면 세그먼트 경계 매칭으로 올려야 한다.
- **`MobileNav`의 이벤트명은 `section.perm`에서 파생한다**(`trackEvent('nav_' + section.perm)`). `section.key`를 쓰면 `schedule` 섹션이 `nav_schedule`을 쏴서 `backend/routers/events.py:VALID_EVENTS` 화이트리스트에서 조용히 탈락한다.

회귀 가드: `frontend/src/test/nav-active-matching.test.jsx`(3소비처 × 목록·상세), `frontend/src/test/masthead.test.jsx`.

### 10.4 컴포넌트 조직
| 디렉터리 | 성격 |
|---|---|
| `components/ui/` | 프리미티브 — `Badge`/`Button`/`Card`/`Input`/`Skeleton`/`Stat`(각 `.jsx`+`.css`), `icons.jsx`, 배지 3종(`GuruActivityBadge`·`InsiderBadge`·`SupplyBadge`), `index.js` 배럴(`Button` `Card`+`CardHeader` `Badge`+`MarketBadge`+`ChangeBadge` `Stat` + `icons` 전량) |
| `components/market/` | 시장 화면 섹션 **15개**(`*Section.jsx`) + `Market.css` + `marketUtils.jsx`(`krFmt` 등) |
| `components/reports/` | 리포트 상세·목록 부품 — `ReportDetailTabs`·`ReportDetailHeader`·`ReportFilters`·`StockCard`·`TickerListItem`·**`StockActions`**(액션버튼 단일 소유처, `layout="card"|"list"`)·`DetailTab`·`HistoryTab`·`Sections` / 차트 4종(`BacklogChart` `ConsensusChart` `FinancialsChart` `KeyResourceChart`) / 섹션 9종 / `reportUtils.jsx`(`computePeerPremiums` 등) / `ReportDetail.css` |
| `components/portfolio/` | `DashboardCard`+`.css`, `FlashValue.jsx`, `PriceFreshness.jsx`+`.css`, `PriceFlash.css` |
| `components/sketches/` | 손그림 SVG — 내비 아이콘 5(`IconResearch` `IconPortfolio` `IconMarket` `IconCalendarIncome` `IconGuru`) + 장식/상태 7(`SketchHero` `SketchEmpty` `SketchError` `SketchNotFound` `SketchArrowUp` `SketchCircleMark` `SketchUnderline`) + `index.js` |
| `components/recommendations/` | `RecCard.jsx` |
| 루트 | 셸·전역 위젯 — `Masthead`+`.css`, `MobileNav`, `MobileTopActions`, `GlobalSearch`, `StockSearchBox`, `StockModal`, `PromoteModal`, `Toast`(`ToastProvider`+`useToast`), `Glossary`+`.css`, `InstallPrompt`+`.css`, `PermissionManager`, `PermissionPanel`, `BatchScheduleEditor`, `LoadingSpinner` |

### 10.5 상태·훅
전역 상태는 Context 하나(`contexts/AuthContext.jsx` — `menuPermissions`·`role`·`loading`)뿐이고, 나머지는 페이지-로컬 `useState` + 커스텀 훅이다. 훅 **14개**(`hooks/`):

- 인증·부트스트랩: `useAuthBootstrap`, `useBfcacheAuthGuard`, `useAuth`(AuthContext 재수출)
- 데이터: `usePortfolioData`(`fetchDashboard` 포함), `useReportList`, `useReportFilters`, `useStockManagement`, `useReportGeneration`
- UI/환경: `useIsMobile`, `useTheme`, `useBodyScrollLock`, `useCountUp`, `useReveal`(`motion.css .reveal`과 짝), `usePriceFlash`

### 10.6 화면-레벨 규약 두 가지
- **정직한 표시** — `pages/Settings.jsx:ManualRunButton`이 수동 배치 실행의 **응답 본문을 화면에 표시**한다(`data-testid="run-result"`). `job_runs`가 예외 없는 스킵도 `success`로 기록하므로 "갱신됨"과 "저장 생략·직전값 유지"를 실행이력으로는 가를 수 없기 때문. `isWeak`(`false`/`0`)는 `--warn` 색으로, `ok` 키는 항상 true라 제외. 같은 사고로 `pages/GuruAllocation.jsx`는 error 상태를 빈 상태와 분리하고(`coverageSentence`가 코호트를 실제로 좁혔을 때만 커버리지 문장을 낸다) 추정값 개수(`estimated_count`)·데이터 기준(`periods`/`last_updated`)을 접이식 설명란으로 노출한다.
- **색 의미 분리** — `components/ui/Stat.css`의 값 색 variant는 `--up`/`--down` **가격 방향 전용**이다(`.stat__value--up`/`--down`). 통념색인 `success`/`danger` variant는 **의도적으로 없다** — 가격 방향에 쓰면 KR 관례에서 뜻이 뒤집힌다. 접미사를 문자열로 조립하는 컴포넌트(`stat__value--${valueColor}`)라 CSS에 없는 값을 넘기면 클래스만 붙고 색이 조용히 사라진다.

### 10.7 스타일
`src/index.css`가 4개를 import: `styles/tokens.css`(디자인 토큰, light 기본 + dark 변형, ADR-0026) → `styles/pc.css` → `styles/mobile.css` → `styles/guru.css`. `styles/motion.css`는 `main.jsx`가 별도 import. 추가로 컴포넌트별 병치 CSS(`ui/*.css`, `Masthead.css`, `market/Market.css`, `reports/ReportDetail.css`, `portfolio/*.css`, `Glossary.css`, `InstallPrompt.css`), 페이지 CSS 2개(`pages/Compare.css`, `pages/LoginPage.css`). `index.css`는 recharts outline 리셋도 담는다. TailwindCSS는 쓰지 않는다.

`styles/guru.css`에는 **되돌린 최적화 기록**이 남아 있다(`:158`) — 구루 투자금 탭 행에 `content-visibility`를 적용했다가 되돌렸다(초기 레이아웃을 스크롤로 이연할 뿐이고, `contain-intrinsic-size`는 content-box라 border-box 실측값을 넣으면 문서가 부푼다). 재시도 금지 주석.

### 10.8 빌드·PWA — `frontend/vite.config.js`
- `VitePWA`(`registerType: 'autoUpdate'`, `cacheId: portfolion-<BUILD_DATE>`, `skipWaiting`+`clientsClaim`, `navigateFallback: null`). **runtimeCaching이 `/api/`(단 `/api/auth/` 제외)를 NetworkFirst로 가로챈다** — 그래서 Playwright `page.route` 응답 주입은 `serviceWorkers: 'block'` 컨텍스트가 필요하다. 폰트 CDN 2종은 CacheFirst.
- 커스텀 플러그인 `sw-cache-bust`가 `closeBundle`에서 `index.html`의 `registerSW.js`·`manifest.webmanifest`와 `registerSW.js`의 `/sw.js`에 `?<BUILD_DATE>` 쿼리를 붙인다. `configResolved`로 실제 `build.outDir`을 잡아 `--outDir` 빌드가 라이브 `dist`를 오염시키지 않게 한다.
- `manualChunks(id)` — **함수 형식만**(Vite 8 = rolldown). `recharts`/`/d3-`/`victory-vendor` → `charts`, 그 외 `node_modules` → `vendor`.
- `test`: vitest + jsdom + `src/test/setup.js`. `server.proxy` `/api` → `localhost:8000`.
- 스택: react 19.2 / react-router-dom 7.14 / recharts 3.8 / axios 1.16 / vite 8.0 / vitest 4.1 / jsdom 29.

---

## 11. 테스트 구조

- **백엔드** — `backend/pytest.ini`(`testpaths=tests`, `pythonpath=.`), `backend/tests/` **128개 `test_*.py`** + `conftest.py` + `_routes.py` + `fixtures/`.
  `conftest.py`가 두 개의 autouse 가드를 건다: `_clear_quote_cache`(테스트 간 quote TTL 캐시 오염 차단), **`_block_real_db`**(`services.db._get_pool`을 raise로 몽키패치 — 로컬 `DATABASE_URL`이 라이브 도커 postgres를 가리켜 실제 오염 사고가 났던 경로). 또 `app.dependency_overrides[get_current_user]`를 모듈 로드 시 걸어 `main.app` 기반 테스트를 인증 통과시킨다 — **자체 `FastAPI()`를 만드는 테스트에는 걸리지 않는다**.
  규약 강제 테스트: `test_no_print.py`(앱 코드 `print(` 0), `test_no_bare_today.py`, `test_api_doc_sync.py`(라이브 `app.routes` ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md` 헤더 대조 + `KNOWN_UNDOCUMENTED` 베이스라인), `test_no_public_reads.py`(ADR-0029), `test_security_auth_gaps.py`(override 없는 fresh app으로 401/403 검증), `test_nan_serialization_guards.py`, 빈 결과 가드 4종.
- **프론트** — vitest, 테스트 파일 **30개**. 두 곳에 산다: 대상 파일 **병치**(`pages/GuruAllocation.test.jsx`, `pages/Settings.test.jsx`, `hooks/usePortfolioData.test.js`, `components/reports/Sections.test.jsx`, `utils/oauthHistory.test.js` 등 19개)와 통합/라우팅 전용 `src/test/`(11개 — `route-redirects` `masthead` `nav-active-matching` `auth-bootstrap` `back-to-login-guard` `global-search-tracked` `compare-race` `compare-sector-group` `recommendations-s3s4` `reports-deep-link-navkey` `smoke`). jsdom에서 recharts는 렌더되지 않으므로 차트 테스트의 관측점은 주변 DOM이다(ADR-0019).
- **라이브 UAT** — `scripts/` 약 117개 파일(Playwright `.mjs` 프로브/캡처, `.py` 감사·프로브 스크립트). 시각·레이아웃·색 검증은 여기가 유일한 게이트다(vitest는 클래스명만 보고 jsdom은 스타일시트를 적용하지 않는다). 자체 `package.json`/`node_modules`를 가진다.

---

## 12. 문서 계약

기능 표면을 바꿀 때 함께 갱신되는 문서가 코드 밖에 있다:
- `API_SPEC.md` — 전체 REST 레퍼런스(엔드포인트 *존재*는 `backend/tests/test_api_doc_sync.py`가 자동 검출, 요청/응답 스키마·인증 산문은 수동).
- `CLAUDE_COWORK_API.md` — 외부 Cowork enrich/backlog 워크플로우 전용 스코프. 사용자 대면 read 엔드포인트는 여기 넣지 않는다.
- `README.md` — overview(화면 구성·env·스택·아키텍처·배치).
- `KIWOOM_API.md`, `KIS_API.md` — 외부 API 카탈로그·대체 로드맵.
- `CLAUDE.md` — 프로젝트 지침 + 누적 함정(가토) 원장.
- `.forge/adr/` — 활성 결정 **30건**(`0001`~`0030`, `retired/`는 별도). 아키텍처 경계가 여기 박제돼 있다: 0001 실행로그, 0006 기동 마이그레이션, 0007 통합 배치 스케줄, 0008 컨센서스 as-of 정본, 0009/0010/0011/0022 읽기전용 시세 경계, 0012/0013 시장 분리, 0015/0016/0021 추천 엔진, 0017 패키지 re-export, 0019 프론트 테스트 하니스, 0020 시세 기준 이원화, 0023 배당 예상, 0024 멀티플 소스 일관, 0025/0026 프론트 IA, 0027 발행물 분리, 0028 이벤트 구동 트리거, 0029 공개 read 금지, 0030 피어 멀티플 기준 표본.
- `docs/` 하위(`ARCHITECTURE.md` `API.md` `TESTING.md` `CONFIGURATION.md` `DEVELOPMENT.md` `GETTING-STARTED.md`)는 2026-05 시점 스냅샷으로 갱신이 멈춰 있다 — 이 문서가 현행이다.

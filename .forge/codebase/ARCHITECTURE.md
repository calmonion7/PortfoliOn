---
last_mapped_commit: 7f3aec7d6aab5b2ed9837f9aada7405f9505ae6b
mapped: 2026-06-17
---
<!-- refreshed: 2026-06-17 -->
# Architecture

**Analysis Date:** 2026-06-17

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  Frontend — React 19 + Vite (port 5173 / nginx :80 dist 서빙)            │
│  `frontend/src/App.jsx` (BrowserRouter, 5 nav 탭 + admin)                │
├──────────────┬──────────────┬──────────────┬─────────────┬──────────────┤
│  Portfolio   │  Research     │  MarketHub    │  Guru       │  Settings    │
│ `pages/      │ `pages/       │ `pages/       │ `pages/     │ `pages/      │
│  Portfolio`  │  Research`    │  MarketHub`   │  Guru`      │  Settings`   │
│ (holdings·   │ (reports·     │ (=Market:     │             │              │
│  watch·dash· │  ranking·     │  시장지표·    │             │              │
│  analysis)   │  digest·cal)  │  수급지표)    │             │              │
└──────┬───────┴───────┬──────┴───────┬───────┴──────┬──────┴──────┬───────┘
       │ fetch /api/*   (Vite proxy → :8000 / nginx /api → backend:8000)    │
       ▼                ▼              ▼              ▼             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Backend — Python / FastAPI (port 8000)  `backend/main.py` (lifespan)    │
│  Routers `backend/routers/*.py` (18개, include_router 등록)               │
└──────────────────────────────┬────────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Services `backend/services/*.py` — 도메인 로직                          │
│  storage · market · report_generator · consensus(_pipeline) · cache ·    │
│  ranking_service · investor_service · short_sell_service · supply_score · │
│  kr_sector_service · leverage/lending/dividends/backlog/disclosures ·     │
│  market_indicators/ (패키지) · kiwoom/ · kis/ · digest · analysis ·       │
│  guru_scraper/stats · job_runs · batch_registry · schedule_spec          │
└──────────────┬────────────────────────────────────┬──────────────────────┘
               │ services.db (psycopg2 풀)            │ 외부 API
               ▼                                      ▼
┌──────────────────────────────────┐  ┌──────────────────────────────────┐
│  PostgreSQL 16 (Docker)           │  │  외부 데이터 소스                 │
│  `backend/auth_schema.sql`        │  │  키움·KIS·yfinance·Naver·FnGuide ·│
│  `backend/app_schema.sql`         │  │  DART·FRED·KOFIA·관세청·dataroma  │
│  (+ main._migrate idempotent DDL) │  │                                  │
└──────────────────────────────────┘  └──────────────────────────────────┘
               ▲
               │ APScheduler 배치(precompute) — `backend/scheduler.py`
               │ batch_registry.BATCHES 20+ 잡 → market_cache/테이블에 적재
```

## Pattern Overview

**Overall:** 레이어드 모놀리스 — Router → Service → DB/외부API. 백엔드는 FastAPI 단일 앱, 프론트는 SPA(React Router). 시간 비싼 외부 fetch는 APScheduler 배치가 사전계산해 PostgreSQL에 저장하고, 요청 경로는 저장값만 읽는다("batch precomputes → request reads stored values").

**Key Characteristics:**
- Router는 얇다(검증·인증·직렬화). 도메인 로직은 전부 `backend/services/`에.
- 백엔드에 LLM 호출 없음 — AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API로 작성(`CLAUDE_COWORK_API.md`).
- 외부 시세 소스는 폴백 체인(KR=키움→KIS→Naver, US=yfinance→KIS). 키 미설정이 안전 기본값(휴면).
- 인메모리 캐시(TTL/LRU) + PostgreSQL `market_cache` 영구 캐시의 2단 캐싱.
- 단일 서버측 자격증명(키움/KIS), 인프로세스 토큰 싱글톤.

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| FastAPI 앱/lifespan | 라우터 마운트, 미들웨어, 기동 마이그레이션·스케줄러 시작 | `backend/main.py` |
| 스케줄러 | APScheduler 잡 정의·등록·미스파이어 복구·기동 시드 | `backend/scheduler.py` |
| 배치 레지스트리 | 20+ 배치 정적 메타데이터(id·source·usage·schedule·market) | `backend/services/batch_registry.py` |
| 배치 실행로그 | job_id별 최근 20건 run 기록(관측 전용, graceful) | `backend/services/job_runs.py` |
| DB 접근 | psycopg2 ThreadedConnectionPool + query/execute 헬퍼 | `backend/services/db.py` |
| 영속 저장소 | 종목·스냅샷·스케줄·구루·캘린더 등 CRUD | `backend/services/storage.py` |
| 시세 서비스 | KR/US quote·financials·history (폴백 체인) | `backend/services/market.py` |
| 캐시 | 인메모리 TTL/LRU 캐시 8종 + 무효화 | `backend/services/cache.py` |
| 시장지표 패키지 | FX/VIX/원자재/국채/경제/실적/수출/매크로 | `backend/services/market_indicators/` |
| 키움 클라이언트 | KR 1차 시세·업종·수급·공매도 TR | `backend/services/kiwoom/` |
| KIS 클라이언트 | KR/US 백업 시세 | `backend/services/kis/` |
| 인증 | JWT 발급/검증, OAuth, role/permission | `backend/auth.py`, `backend/services/auth_service.py`, `backend/routers/auth.py` |

## Layers

**Routers (`backend/routers/`):**
- Purpose: HTTP 엔드포인트, 인증 게이팅, 요청/응답 직렬화.
- Location: `backend/routers/*.py` (18개)
- Depends on: `backend/services/`, `backend/auth.py`
- Used by: 프론트 `frontend/src/api.js` / 각 페이지 fetch
- 등록: `backend/main.py:132-148` `app.include_router(...)`
- prefix 매핑:
  - `/api/auth` — `auth.py`
  - `/api/portfolio` — `portfolio.py`
  - `/api/stocks` — `stocks.py`
  - `/api/watchlist` — `watchlist.py`
  - `/api` — `report.py`(report/consensus), `digest.py`, `rankings.py`, `investor.py`, `short_sell.py`, `calendar.py`, `batches.py`
  - `/api/market` — `market_indicators.py`
  - `/api/analysis` — `analysis.py`
  - `/api/analytics` — `analytics.py`
  - `/api/guru` — `guru.py`
  - `/api/events` — `events.py`
  - `/api/admin` — `admin.py`

**Services (`backend/services/`):**
- Purpose: 도메인 로직, 외부 API 연동, 캐싱.
- Location: `backend/services/*.py` + 서브패키지 `market_indicators/`, `kiwoom/`, `kis/`
- Depends on: `backend/services/db.py`, 외부 SDK(yfinance/requests)
- Used by: 라우터, 스케줄러 잡

**Persistence:**
- Purpose: 영구 저장(PostgreSQL) + 런타임 캐시(인메모리·로컬 JSON 파일).
- Location: `backend/services/db.py`(풀), `backend/services/storage.py`(CRUD), `backend/services/cache.py`(인메모리)
- 스키마: `backend/auth_schema.sql` → `backend/app_schema.sql` 순. 추가 컬럼/테이블은 `backend/main.py:_migrate()` idempotent DDL + `backend/migrations/*.sql`.

**Frontend (`frontend/src/`):**
- Purpose: SPA UI. React Router 라우팅 + 허브 내 탭 전환(로컬 state).
- Location: `frontend/src/pages/`(화면), `frontend/src/components/`(재사용), `frontend/src/hooks/`, `frontend/src/contexts/AuthContext.jsx`
- Depends on: `frontend/src/api.js`, recharts(차트)

## Router → Service 매핑

| Router | 주 Service |
|--------|-----------|
| `routers/portfolio.py` | `storage`, `market`, `cache`, `dividends` |
| `routers/stocks.py` | `storage`, `market`, `dividends`, `supply_score`, `cache` |
| `routers/report.py` | `report_generator`, `storage`, `consensus`, `backlog`, `disclosures`, `cache` |
| `routers/market_indicators.py` | `market_indicators/`(서브모듈), `leverage_service`, `lending_service` |
| `routers/analysis.py` | `analysis_service`, `kr_sector_service` |
| `routers/analytics.py` | `analysis_service`(상관관계), `cache` |
| `routers/rankings.py` | `ranking_service` |
| `routers/investor.py` | `investor_service` |
| `routers/short_sell.py` | `short_sell_service` |
| `routers/digest.py` | `digest_service` |
| `routers/guru.py` | `guru_scraper`, `guru_stats`, `storage` |
| `routers/batches.py` | `batch_registry`, `job_runs`, `storage`, `scheduler` |
| `routers/admin.py` | `auth_service`, `storage` |
| `routers/auth.py` | `auth_service`, `auth` |
| `routers/events.py` | `db`(user_events) |

## 시장지표 패키지 — `backend/services/market_indicators/`

`__init__.py`가 공개 API를 re-export(`get_*` 조회 + `_fetch_and_save_*` 배치 함수).

| 모듈 | 책임 | market_cache key |
|------|------|------------------|
| `fx.py` | FX(USDKRW 등) / VIX | `fx`, `vix` |
| `commodities.py` | 원자재 / 국채 수익률 | `commodities`, `treasury` |
| `earnings.py` | M7(US) / KR Top2 실적 | `m7`, `krtop2` |
| `econ.py` | FRED 경제지표 | `econ` |
| `exports.py` | KR 수출(관세청/UN Comtrade) | `krexports` |
| `macro.py` | FRED 매크로 신호 시계열 + 신호 판정 | `macro_signals` |
| `cache.py` | `_mc_load`/`_mc_save`로 PostgreSQL `market_cache` R/W | — |

각 서브모듈은 `_merge_history`/`_yf_close_history`로 yfinance incremental fetch(마지막 날짜 이후만 조회).

## 시세 폴백 체인 (`backend/services/market.py`)

**KR (`get_quote_kr`, market.py:163):** 키움 우선 → KIS 백업 → Naver 폴백.
- `_kr_basic_kiwoom`(ka10001) → 미설정/실패/빈 price면 None
- `_kr_basic_kis`(KIS 국내 현재가) → 백업
- `_kr_basic_naver` → 최종 폴백(상폐는 Naver 409로 검출)
- 일봉 종가는 `_kr_closes_kiwoom`(키움) 우선, 실패 시 yfinance.

**US (`_get_quote_uncached`, market.py:547):** yfinance 우선 → KIS 백업(`_us_quote_kis`).

**경계 근거:** 키움 = KR 전용·읽기전용(`.forge/adr/0009`). KIS = KR+US 읽기전용 백업(`.forge/adr/0011`). 둘 다 `configured()` False면 휴면(키 미설정이 안전 기본값).

**클라이언트 토대:**
- `kiwoom/client.py` — `KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`로 토큰 발급(인프로세스 싱글톤, 401 재발급), `request(api_id, body, category)` 직렬 throttle(`_MIN_INTERVAL=0.25`).
- `kis/client.py` — `KIS_APP_KEY`/`KIS_APP_SECRET`로 `/oauth2/tokenP`(싱글톤, 발급 1분당 1회 EGW00133 60초 가드), `request(tr_id, path, params)` 직렬 throttle(`_MIN_INTERVAL=0.05`).
- 키움 TR 모듈: `kiwoom/quote.py`(ka10001), `kiwoom/chart.py`(ka10081/82/83), `kiwoom/sector.py`(ka20006/ka20002), `kiwoom/investor.py`(수급), `kiwoom/shortsell.py`(ka10014).
- KIS: `kis/quote.py`(국내 `FHKST01010100`, 해외 `HHDFS00000300`/`HHDFS76240000`).

## 배치/스케줄러 시스템

**구성 3요소:**
1. `backend/scheduler.py` — AsyncIOScheduler. `_JOB_FUNCS`(job_id→함수, scheduler.py:383) + `start()`가 `batch_registry.BATCHES`를 순회하며 editable 잡을 `_reschedule_job`으로 등록. `lifespan`에서 `sched.start()`.
2. `backend/services/batch_registry.py` — `BATCHES` 리스트(정적 메타: id·label·category·source·usage·schedule·timezone·market·editable). `GET /api/batches`가 그대로 노출. job_id는 스케줄러 잡 id 및 `job_runs.record` 호출 id와 반드시 일치.
3. `backend/services/job_runs.py` — `record(job_id, trigger)` 컨텍스트매니저로 running→success/failed 기록(job_id별 최근 20건만 보관). 관측 전용 — 본문을 깨뜨리지 않음(graceful degrade).

**스케줄 스펙:** `backend/services/schedule_spec.py`(`build_trigger_kwargs`로 weekly/daily/monthly/interval → CronTrigger kwargs). 편집 가능 배치는 `batch_schedules` 테이블(storage.get/save_batch_schedule)에 저장, `scheduler.reload(job_id)`로 리스케줄.

**기동 복구·시드:** `scheduler.start()`가 `_seed_batch_schedules`(첫 배포 시 기본 스펙 시드) → `_check_missed_report`(시장별 당일 누락 리포트 즉시 생성) → `_seed_rankings_if_empty` → `_seed_kr_sector_if_empty`. 빈/all-None 결과는 캐시에 박제하지 않음(직전 양호값 유지).

**시장별 분리:** 일일 리포트는 `daily_report_kr`(20:30 KST)·`daily_report_us`(07:00 KST), 실적은 `earnings_kr`/`earnings_us`, 월간은 `monthly_kr`/`monthly_us`로 분리(`.forge/adr/0012`·`0013`).

## "Batch precomputes → request reads stored values" 패턴

배치-백킹 뷰(랭킹·KR 업종 모멘텀·수급·공매도·수급 스코어 등)는 외부 API를 *요청·기동 경로*에서 라이브 호출하지 않는다. 배치가 사전계산해 `market_cache` 또는 전용 테이블(`market_rankings`, `market_investor_trend`, `market_short_sell`, `stock_supply_score`, `market_leverage_indicators`, `market_lending_balance`)에 저장하고, GET 엔드포인트는 저장값만 읽는다.
- 예: `ranking_service.replace_market_rankings` ← `kr_rankings_fetch`/`us_rankings_fetch` 배치 → `GET /api/rankings`는 테이블 read.
- 예: `kr_sector_service.refresh()` ← `kr_sector_fetch` → `GET /api/analysis/sector?market=KR`는 `market_cache` read.
- 외부 fetch 실패는 조용히 삼키지 않고 로깅. 전부 None이면 save 생략.

## 캐싱 레이어

**인메모리 — `backend/services/cache.py` (8종):**
| 캐시 | 종류 | TTL/크기 |
|------|------|----------|
| `_snapshots` | LRU OrderedDict | maxsize 50 |
| `_list_cache` | TTLCache | 60s |
| `_dashboard_cache` | TTLCache(user별) | 300s |
| `_correlation_cache` | TTLCache(user별) | 300s |
| `_sector_cache` | TTLCache(user:market) | 300s |
| `_macro_cache` | TTLCache(user별) | 300s |
| `_quote_cache` | TTLCache(ticker) | 60s |
| `_live_prices_cache` | TTLCache(user별, 장중 폴링) | 15s |

종목 추가/수정/삭제 시 `invalidate(ticker)`가 list·dashboard·correlation·sector·macro·live_prices를 일괄 무효화.

**영구 — PostgreSQL `market_cache` 테이블:** 시장지표 8종(fx/vix/commodities/treasury/econ/m7/krtop2/krexports/macro_signals). `market_indicators/cache.py`의 `_mc_load`/`_mc_save`. 배치가 incremental 갱신, GET은 read-only.

**로컬 파일 캐시(gitignored):** `backend/data/calendar/YYYY-MM.json`, `backend/data/consensus/`(per-ticker), `backend/snapshots/`(legacy fallback).

## Data Flow

### 종목 추가 → 시세 표시

1. 프론트 `pages/Portfolio.jsx` → `POST /api/stocks` (`routers/stocks.py`)
2. `storage.save_stocks` (tickers·user_stocks upsert), `market.resolve_name`으로 실명 채움
3. `cache.invalidate(ticker)` (대시보드·상관·섹터·매크로·캘린더 무효화)
4. 대시보드 조회 시 `GET /api/stocks/dashboard` → `cache.get_dashboard(loader)` → `market.get_quotes_batch` + 저장 배당/FX/수급스코어 read

### 일일 리포트 배치 (시장별)

1. cron 트리거 → `scheduler._generate_kr`/`_generate_us` (`job_runs.record`로 감쌈)
2. 시장별 종목 partition(`_in_market`) → `report_generator.generate_report_with_retry(stock)` → `snapshots` 저장
3. `consensus_pipeline.run_daily`로 컨센서스 집계(`consensus_history`/`daily_consensus_mart`)
4. 요청 경로 `GET /api/report/list`·`/{ticker}/{date}`는 `cache.get_list`/`get_snapshot`으로 저장값 read

### 시장지표 조회

1. 프론트 `pages/Market.jsx`(시장지표/수급지표 2탭) → `GET /api/market/*` (`routers/market_indicators.py`)
2. `market_indicators.get_*`이 `market_cache`에서 read-only (라이브 외부 호출 0)
3. 갱신은 배치(`monthly_*`/`earnings_*`/`macro_signals_fetch`) 또는 admin `POST /api/market/refresh-*`

**State Management:** 백엔드 무상태(PostgreSQL + 인메모리 캐시). 프론트는 컴포넌트 로컬 state + `AuthContext`(세션·권한·role). 서버 상태 캐싱은 커스텀 훅(`hooks/usePortfolioData`, `useReportList`, `useReportGeneration`).

## Key Abstractions

**TTLCache (`cache.py`):** 만료 기반 메모이즈. `get(key, loader)` 패턴(미스 시 loader 실행).

**job_runs.record (`job_runs.py`):** 배치 실행 계측 컨텍스트매니저. running→success/failed 전이.

**batch_registry.BATCHES (`batch_registry.py`):** 배치 단일 진실원천. id가 스케줄러·job_runs·UI 표면을 가로질러 일치해야 함.

**커스텀 훅 (`frontend/src/hooks/`):** `usePortfolioData`, `useReportList`, `useReportGeneration`, `usePriceFlash`, `useTheme`, `useIsMobile`, `useAuth`.

## Entry Points

**백엔드 앱:** `backend/main.py` — `app = FastAPI(lifespan=...)`. lifespan에서 `_migrate()` + `sched.start()` + 캐시 워밍 스레드. uvicorn `main:app`으로 기동.

**스케줄러:** `backend/scheduler.py` — `start()`/`stop()`/`reload(job_id)`. lifespan이 호출.

**프론트 진입:** `frontend/src/main.jsx` → `<App/>` (`frontend/src/App.jsx`). BrowserRouter로 `/`(Portfolio)·`/research`·`/market`·`/guru`·`/settings`·`/admin-analytics`·`/dev/showcase` 라우팅.

**백필 스크립트:** `backend/run_backfill.py` (수동 실행).

## Architectural Constraints

- **Threading:** FastAPI(uvicorn) 단일 프로세스. 배치 내 병렬은 `ThreadPoolExecutor`(max_workers ≤ 8, DB 풀 maxconn=20 초과 방지). APScheduler는 `AsyncIOScheduler`(이벤트 루프 잡).
- **DB 풀:** `db.py` `ThreadedConnectionPool(minconn=1, maxconn=20)`. 소진 시 PoolError(블록 아님) — 워커 수를 풀보다 작게 둘 것.
- **Global state:** `db._pool`(싱글톤), 키움/KIS 토큰 싱글톤(`_token`), 인메모리 캐시 모듈 전역(`cache.py`).
- **순환참조 회피:** `storage`→`cache` 호출은 함수 내 지연 import. `cache.invalidate_portfolio_caches`도 `routers.calendar` 지연 import.
- **단일 자격증명:** 키움/KIS는 서버측 단일 키(per-user 아님). 읽기 전용(주문/계좌 미연동).

## Anti-Patterns

### 요청·기동 경로 라이브 외부 fetch

**What happens:** GET 엔드포인트나 기동 시드가 키움/외부 API를 직접 호출해 "요청 시 라이브 빌드"한다.
**Why it's wrong:** 요청당 N콜 직렬 = 수초 지연, 캐시 만료마다 느려짐(task#50).
**Do this instead:** 배치가 `market_cache`/테이블에 사전계산 저장, 요청은 저장값만 read. (`ranking_service`/`kr_sector_service` 참조)

### 빈/all-None 결과 캐시 박제

**What happens:** 외부 fetch가 전부 None을 반환했는데 그대로 캐시/테이블에 save.
**Why it's wrong:** 시드 가드가 "채워짐"으로 오판해 고착(task#48 all-None 박제).
**Do this instead:** 전부 None이면 save 생략·직전 양호값 유지. 실패 클래스(all-None)를 가드. (`scheduler._supply_score_work` 참조)

### silent except로 외부 실패 삼킴

**What happens:** `try/except: pass`로 외부 fetch 실패를 조용히 무시.
**Why it's wrong:** 진단 불가(task#48 `_fetch_one_sector`가 빈 종가 삼킴). 또한 `job_runs`가 success로 기록돼 허브가 오류를 숨김.
**Do this instead:** 예외를 로깅. 부분 실패도 가시화(`job_runs.record` 주석 참조).

### 비-additive 응답 reshape 후 단일 소비처만 수정

**What happens:** 엔드포인트 응답(배열→객체 등)을 바꾸고 한 fetcher만 갱신.
**Why it's wrong:** 다른 독립 fetcher가 옛 형태로 취급해 조용히 깨짐(task52 대시보드 배열→객체).
**Do this instead:** additive(필드 추가) 선호. reshape 시 `grep -rn '<경로>' frontend/src/`로 전 소비처 감사.

## Error Handling

**Strategy:** 라우터는 FastAPI HTTPException. 서비스는 도메인 예외(`services/errors.py`, `KiwoomError`/`KisError`) + 폴백 체인. 배치는 try/except로 잡 단위 격리(한 종목 실패가 배치 전체를 멈추지 않음).

**Patterns:**
- DB: `db.get_connection()` 컨텍스트매니저(commit/rollback 자동).
- 외부 시세: 폴백 체인(키움→KIS→Naver / yfinance→KIS), 미설정 시 휴면.
- NaN/Inf: `services/utils.py`로 직렬화 전 sanitize.

## Cross-Cutting Concerns

**Logging:** 표준 `logging`(`job_runs`) + `print("[Scheduler] ...")`(배치 진행).
**Validation:** FastAPI Pydantic + 라우터 명시 검증(ticker validation). bare list/dict는 `Body(...)` 명시 필수.
**Authentication:** JWT(HS256) — `backend/auth.py` 의존성. role(`user`/`admin`) + `user_menu_permissions` 메뉴 게이팅. `EventTrackerMiddleware`로 사용자 행동 로깅. 프론트 `AuthContext`가 로그인 시 권한 로드해 nav 필터링.

---

*Architecture analysis: 2026-06-17*

---
last_mapped_commit: c482aa6811262685f424cb8fb871e8121cf438c6
mapped: 2026-07-02
---

# Architecture

PortfoliOn은 2계층 앱이다: Python/FastAPI 백엔드(포트 8000)와 React 19 + Vite 프론트엔드(포트 5173, 배포 시 nginx 서빙). 영속 저장소는 Docker PostgreSQL이며 로컬 JSON 파일은 런타임 캐시다.

## 전체 패턴

- **백엔드**: `routers/`(HTTP 계층, FastAPI `APIRouter`) → `services/`(비즈니스 로직, 외부 fetch, 영속) → `services/db.py`(psycopg2 풀 위의 raw SQL). ORM 없음.
- **프론트엔드**: `pages/`(라우트 화면)가 `components/`를 조합; `hooks/`는 데이터 fetch/상태 로직; `contexts/AuthContext.jsx`는 인증·권한 상태; `api.js`는 공유 axios 인스턴스.

## 계층 (백엔드)

1. **기동·앱 배선** — `backend/main.py`가 FastAPI 앱 생성, 미들웨어 설치, 모든 라우터 `include_router`.
2. **라우터** (`backend/routers/`) — 표면당 모듈 1개; 각 `router = APIRouter(...)`. `Depends(get_current_user)` / `require_admin`으로 인증 게이팅 (`backend/auth.py`).
3. **서비스** (`backend/services/`) — 외부 소스 fetch, 계산, PostgreSQL 읽기/쓰기. 외부 호출은 서비스에만, 라우터엔 없다.
4. **영속** — `services/db.py`가 `query(sql, params) -> list[dict]`와 `execute(sql, params) -> int`를 모듈 전역 `ThreadedConnectionPool`(maxconn=20, RealDictCursor)로 제공.
5. **스케줄러** — `backend/scheduler/` 패키지가 APScheduler를 구동.

## 진입점

### `backend/main.py`

- `_migrate()` — idempotent 기동 DDL. 모두 try/except + print로 감싸 실패해도 기동을 막지 않는다. `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` 형식. 대상 테이블/컬럼: `backlog_history.segments`, `batch_schedules`, `market_short_sell`, `stock_disclosures`(+ `meeting_date`), `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`(+ `low_liquidity`, `exchange`, `name`), `us_supply_snapshot`(+ `insider_transactions`, `insider_net`).
- `lifespan` — `_migrate()` → `sched.start()` → daemon `threading.Thread(_warm_market_cache)`. 종료 시 `sched.stop()`.
- `_warm_market_cache()` — 경제지표 + KR 수출 캐시를 배경 스레드에서 선제 로드.
- 미들웨어: `SessionMiddleware`(SESSION_SECRET), `EventTrackerMiddleware`, `CORSMiddleware`(localhost:3000·5173·FRONTEND_URL).
- `/health` 라우트 (GET/HEAD).

### `backend/scheduler/` 패키지

단일 `scheduler.py` 아님 — 패키지다.

- `__init__.py` — 공개 API `start()` / `stop()` / `reload(job_id)`. `start()`는 배치 스케줄 시드(`_seed_batch_schedules`), 편집 가능 배치 reschedule(`_reschedule_job`), 누락 리포트 복구(`_check_missed_report`), 랭킹·KR섹터 빈 캐시 시드(`_seed_rankings_if_empty`, `_seed_kr_sector_if_empty`) 후 APScheduler 시작.
- `_state.py` — APScheduler 싱글톤·상수(leaf 모듈, 순환참조 방지).
- `jobs.py` — 잡 함수 전체(`_generate_kr/us`, `_run_guru_crawl`, `_refresh_*`, `_fetch_*`, `_supply_score_work`, `_recommendation_work`, `_fetch_us_supply`, `_fetch_kr_sector` 등) + `_JOB_FUNCS` dict(job_id → callable). 잡 바디는 `with job_runs.record(job_id, "auto"):` 감싸기. `_in_market(stock, market)` — KR = `market=="KR"`, US = 나머지 전부.
- `schedule.py` — CronTrigger 생성(`_build_trigger`), `_reschedule_job`(stored spec 로드 후 APScheduler 잡 교체), `_seed_spec_for`/`_seed_batch_schedules`(legacy `daily_report`·`earnings_refresh`·`monthly_refresh` 승계), `_check_missed_report`/`_check_missed_report_for`(기동 시 당일 누락 스냅샷 재생성).

### `backend/services/batch_registry.py`

`BATCHES` — 배치 메타 정적 목록(28개), `GET /api/batches`에 노출. 항목: `id`(scheduler job id·`job_runs.record` id와 동일 문자열 필수), `label`, `category`, `usage`, `source`(데이터 fetch 출처), `editable`, `trigger_kinds`, `manual_endpoint`, `timezone`, `market`(KR/US/공통), `default_schedule`. `consensus`는 `scheduler_job_id: None`(`daily_report_kr/us` 내부에서 실행). `get_batch(job_id)`로 조회.

## 배치-precompute → read 패턴

요청경로 외부 API 호출은 원칙적으로 없다. 외부 fetch는 배치(`scheduler/jobs.py`)가 수행하고 결과를 PostgreSQL에 저장; GET 엔드포인트는 저장값만 읽는다. 기동 시 빈 캐시는 `_seed_*_if_empty`가 한 번 적재.

예외: FX/VIX/원자재/지수는 요청경로 증분 fetch(TTL캐시 + DB 폴백) — 배치 없음.

## 추천 엔진 (`services/recommendation/`)

2단 깔때기, 배치 전용(`run_recommendation_batch`, ADR-0015/ADR-0021). 요청·기동 경로 외부 호출 0.

### Stage-1 `_screen_candidates` (funnel.py)

- (a) `market=="US"` 행: **전량 통과** — S&P500 자체가 시총 큐레이션이므로 별도 컷 불필요.
- (b) `tracked=True` 행: 시장·시총 무관 **무조건 통과** (ADR-0015 §2 계약 강제).
- (c) KR 비추적: 시총 내림차순 top_k(기본 100) 컷.
- (d) `guru_member=True` KR 비추적: 컷오프 밖이어도 추가 통과. 중복 없이 반환.

### Stage-2 `_enrich_one` (funnel.py)

- `_fetch_history` → `_momentum_factors`(return_pct / rsi / near_52w_high_pct / volume_surge_ratio).
- **US 후보만** `_backfill_us_consensus` — `daily_consensus_mart`에 오늘 정본이 없을 때만 yfinance 애널리스트 목표가 fetch → `consensus_pipeline.upsert_raw_reports` + `refresh_mart`. KR·정본 이미 있음·upsert 0건은 호출 0.
- `_consensus_upside` — `consensus.get_asof(ticker, today)` 목표가 대비 상승여력 % (df 재사용, 라이브 시세 호출 0).
- KR만: `_kr_supply`(investor_service 저장 시계열 5일 외인·기관 순매수) + `_kr_insider`(insider_trades 저장값 방향).
- US만: `guru_set` 신규매수 여부.

### 이름 carry `_resolve_name` (funnel.py)

우선순위: ① stored carry(이전 배치 `stock_recommendations.name`) → ② yfinance(US만) → ③ 기존 name 그대로. KR은 universe DB read 시 tickers 마스터 JOIN이 처리하므로 외부 fetch 불필요. 배치 시작 시 1회 `_load_stored_names()` read로 carry dict 구성 — 첫 배치 이후 yfinance 호출은 사실상 0.

### 저유동성 필터 (#68)

20일 평균 거래대금 < MIN_DOLLAR_VOLUME(US $1M / KR ₩10억) → `low_liquidity=True`. discovery에서 제외, 점수·저장은 유지.

## `GET /api/recommendations` 응답 구조

저장값 read-only(요청경로 외부 호출 0). `market` 쿼리 파라미터로 discovery 섹션만 해당 시장 필터 적용.

```
{"as_of": <date|null>,
 "discovery": [{ticker,name,market,score,flags,rank,exchange}, ...],   # tracked·low_liquidity 제외
 "watchlist": [{ticker,...,enriched}, ...],  # 호출자 관심종목 저장 점수 DESC
 "holdings": [{ticker,...,action,reasons,pnl_pct,weight_pct}, ...]}    # 보유종목 actions.derive_holding_action
```

`wl_tickers` 비면 watchlist read 생략(additive-read 가토 방지). `enriched` 필드 — 해당 ticker의 최신 스냅샷 유무.

## Research 허브 딥링크 (frontend)

`frontend/src/pages/Research.jsx`가 `location.state?.tab` / `location.state?.ticker`로 초기 탭·종목 수신. 같은 라우트('/') 재네비게이션은 재마운트 없으므로 `useEffect([location.state])`로 상태 갱신(task#131). `<Reports initialTicker={deepTicker} />`로 선택 종목 전달.

## Docker 4컨테이너 배포

| 컨테이너 | 역할 |
|---|---|
| `postgres` | PostgreSQL 16, `pgdata` 볼륨, init SQL(auth→app 순) |
| `backend` | FastAPI, `backend/.env.docker` env_file |
| `nginx` | `:80/:443`, `/api/*` → backend 프록시, `frontend/dist` `:ro` 마운트 |
| `certbot` | HTTPS 인증서 12시간 주기 갱신 |

cloudflared는 compose 밖 launchd로 운용. 프론트 변경은 `npm run build`만으로 즉시 라이브. 백엔드 변경은 GitHub Actions 러너 또는 폴러가 `deploy.sh`를 거쳐 컨테이너 재생성해야 반영.

## 리포트 스냅샷 모델

`report_generator.generate_report` — 종목·날짜 단위 시장 데이터 스냅샷 생성(LLM 없음; AI 분석 텍스트는 외부 Cowork enrich API). `snapshots/{ticker}/{date}.json` 파일 + `snapshots` 테이블 동시 upsert.

**시세 기준 이원화(ADR-0020)**: 리포트 스냅샷은 KRX 정규장 가격(`regular=True`), 라이브 대시보드는 NXT(`regular=False` 기본). 동일 KR 종목이 두 화면에서 ~1% 다른 현재가를 보이는 건 의도된 차이.

**KR 독립 피드 게이트(ADR-0020, task#101/#118)**: 저장 직전 Naver retry-once → KIS 폴백으로 독립 ref 확보. ref 전무면 **저장 스킵**(직전 양호 스냅샷 유지, wrong<missing). ref 있으면 2× 범위([0.5, 2.0]) 교차검증 — KRX 자기일관 글리치 방어.

## 주요 추상

- `services/storage/` — 포트폴리오·스냅샷·스케줄·이름 영속 퍼사드(패키지, flat re-export).
- `services/job_runs.py` `record()` — 배치 계측 context manager(graceful-degrade).
- `services/utils.py` `sanitize()` — NaN/inf → None 재귀 변환(starlette JSONResponse allow_nan=False 방어).
- `services/cache.py` — 인메모리 캐시 6종(snapshot LRU·list/dashboard/correlation/sector/macro TTL), 종목 변경 시 자동 무효화.
- `services/consensus_pipeline.py` — opinion 문자열→5점 표준화→`consensus_history`, `run_daily()`는 일배치 말미 호출.

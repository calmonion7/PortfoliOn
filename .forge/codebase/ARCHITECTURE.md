---
last_mapped_commit: 74f5ca940c42a3ee866a45ccccfe24ac701a04d9
mapped: 2026-06-27
---
<!-- refreshed: 2026-06-27 -->
# 아키텍처

**분석일:** 2026-06-27

## 시스템 개요

```text
┌─────────────────────────────────────────────────────────────────────┐
│                       프론트엔드 (React 19 + Vite)                     │
│   `frontend/src/main.jsx` → `frontend/src/App.jsx` (BrowserRouter)    │
├──────────────────┬──────────────────┬───────────────────────────────┤
│   pages/ (화면)   │  components/ (UI)  │  hooks/ · contexts/ · api.js   │
│ `Research.jsx`등  │ `reports/` `market/`│ `usePortfolioData.js` `api.js`│
└────────┬─────────┴────────┬──────────┴─────────────┬─────────────────┘
         │ axios `/api/*` (Bearer JWT) → nginx 프록시  │
         ▼                                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      백엔드 (Python / FastAPI :8000)                   │
│   `backend/main.py` (app · lifespan · 라우터 mount · 미들웨어)         │
├──────────────────────────────────────────────────────────────────────┤
│  routers/  — 18개 APIRouter (HTTP 경계, 인증 게이팅, Pydantic 검증)    │
│  `routers/stocks.py` `routers/report.py` `routers/portfolio.py` …      │
├──────────────────────────────────────────────────────────────────────┤
│  services/  — 도메인 로직 (storage · market · report_generator …)     │
│  market_indicators/ · kiwoom/ · kis/ · market/ · storage/ ·            │
│  recommendation/ 서브패키지                                            │
├──────────────────────────────────────────────────────────────────────┤
│  scheduler/  — APScheduler 잡 (배치) — `services/batch_registry.py`     │
└────────┬───────────────────────────────────────────┬──────────────────┘
         │ psycopg2 ThreadedConnectionPool            │ 외부 fetch
         ▼                                            ▼
┌──────────────────────────────┐   ┌──────────────────────────────────────┐
│  PostgreSQL 16 (Docker)       │   │  외부 소스: 키움/KIS/Naver/yfinance/   │
│  `services/db.py` 풀(max 20)  │   │  FnGuide/DART/FRED/KOFIA/dataroma …    │
│  스키마: auth_schema.sql ·    │   │  (services/market·kiwoom·kis 등 경유)  │
│         app_schema.sql        │   └──────────────────────────────────────┘
└──────────────────────────────┘
```

## 패턴 개요

**전체:** 계층형 모놀리식 — `routers/`(HTTP 경계) → `services/`(도메인 로직) → `services/db.py`(PostgreSQL 풀). 백그라운드 배치는 `scheduler/`(APScheduler)가 같은 프로세스 안에서 돌며 동일한 `services/`를 호출한다.

**핵심 특성:**
- 라우터는 얇다 — Pydantic 검증·인증 게이팅·응답 직렬화만. 도메인 로직은 전부 `services/`.
- 단일 FastAPI 프로세스 내 인-프로세스 스케줄러(`scheduler.start()`가 `lifespan`에서 기동, 별도 워커 프로세스 없음).
- "배치가 사전계산 → `market_cache`/전용 테이블에 저장 → 요청은 저장값만 read" 분리(랭킹·KR 업종 모멘텀·시장지표). 요청 경로에서 외부 API 라이브 호출 지양.
- 거대 모듈은 패키지 분리 + 루트 re-export로 표면 보존(ADR-0017): `services/storage/`, `services/market/`이 `__init__.py`에서 모든 심볼을 re-export해 `storage.X`/`market.X` 외부 참조를 유지.
- 인메모리 캐시 계층(`services/cache.py`)이 read-heavy 엔드포인트 앞에 위치, 종목 mutation 시 일괄 무효화.

## 컴포넌트 책임

| 컴포넌트 | 책임 | 파일 |
|----------|------|------|
| FastAPI app | 앱 엔트리·lifespan·라우터 mount·미들웨어 | `backend/main.py` |
| 인증 의존성 | JWT/API키 디코드, admin 게이트 | `backend/auth.py` |
| 라우터 | HTTP 경계·검증·인증·직렬화 | `backend/routers/*.py` |
| storage 패키지 | user_stocks·tickers·스냅샷·스케줄 영속화 | `backend/services/storage/` |
| db 헬퍼 | psycopg2 풀, `query`/`execute`/`get_connection` | `backend/services/db.py` |
| report_generator | 종목별 시장데이터 스냅샷 생성 (LLM 호출 없음) | `backend/services/report_generator.py` |
| market 패키지 | 시세·재무·일봉 (KR=키움→KIS→Naver, US=yfinance→KIS) | `backend/services/market/` |
| market_indicators | FX/VIX/원자재/국채/경제지표/실적/수출/매크로 | `backend/services/market_indicators/` |
| 캐시 | 스냅샷 LRU·list/dashboard/correlation/sector/macro/quote/live TTL | `backend/services/cache.py` |
| 스케줄러 | APScheduler 잡 등록·리스케줄·누락복구·시드 | `backend/scheduler/` |
| 배치 레지스트리 | 배치 정적 메타데이터(24개 항목) | `backend/services/batch_registry.py` |
| job_runs | 배치 실행 로그(graceful degrade 계측) | `backend/services/job_runs.py` |

## 계층

**라우터 계층:**
- 목적: HTTP 경계 — 요청 검증, 인증 게이팅, 응답 직렬화
- 위치: `backend/routers/`
- 포함: `APIRouter`(prefix `/api/...`), Pydantic 모델, `Depends(get_current_user)` 게이트
- 의존: `services/`, `auth.py`
- 사용처: `backend/main.py`의 `app.include_router(...)`

**서비스 계층:**
- 목적: 도메인 로직 (시세·리포트·컨센서스·수급·추천·구루 등)
- 위치: `backend/services/`
- 포함: 평탄 모듈(`consensus.py`, `dividends.py` 등) + 서브패키지(`storage/`, `market/`, `market_indicators/`, `kiwoom/`, `kis/`, `recommendation/`)
- 의존: `services/db.py`, 외부 API 클라이언트
- 사용처: 라우터 + 스케줄러 잡

**데이터 계층:**
- 목적: PostgreSQL 영속화 + 인메모리/파일 캐시
- 위치: `backend/services/db.py`(풀), `backend/services/storage/`(쿼리), `backend/services/cache.py`(인메모리)
- 포함: `ThreadedConnectionPool`(minconn 1, maxconn 20), `query`/`execute` 헬퍼
- 사용처: 모든 서비스

**스케줄러 계층:**
- 목적: 백그라운드 배치 — 시장지표·랭킹·수급·리포트 사전계산
- 위치: `backend/scheduler/` (서비스가 아니라 별도 패키지)
- 포함: `__init__.py`(start/stop/reload), `jobs.py`(잡 함수 + `_JOB_FUNCS`), `schedule.py`(트리거·시드·누락복구), `_state.py`(공유 `_scheduler`·상수)
- 사용처: `main.py` lifespan의 `sched.start()`/`sched.stop()`

## 데이터 흐름

### 주 요청 경로 (대시보드 조회)

1. 브라우저 axios `GET /api/stocks/dashboard` (Bearer JWT) (`frontend/src/api.js`)
2. nginx가 `/api/*`를 `backend:8000`으로 프록시 (`nginx/nginx.conf`)
3. `EventTrackerMiddleware`·`SessionMiddleware` 통과 (`backend/main.py:157-158`)
4. `routers/stocks.py`가 `Depends(get_current_user)`로 JWT 디코드 → user_id (`backend/auth.py:18`)
5. `cache.get_dashboard(user_id, loader)`로 TTL(300s) 캐시 조회 (`backend/services/cache.py:68`)
6. miss 시 `_build_all`이 `get_quotes_batch`(시세) + per-card enrichment(snapshot·consensus·배당·수급) (`backend/routers/stocks.py`)
7. `services.utils.sanitize`로 NaN/inf→None 정리 후 응답(starlette `allow_nan=False` 500 방지)

### 리포트 생성 경로 (배치/수동)

1. 스케줄러 잡 `daily_report_kr`/`daily_report_us` 또는 종목 추가 시 `BackgroundTasks` (`backend/scheduler/jobs.py`, `routers/portfolio.py:13`)
2. `report_generator.generate_report(stock, ...)` — 시장데이터 fetch(시세·일봉·재무·차트) (`backend/services/report_generator.py:49`)
3. KR은 `regular=True`로 KRX 정규장 종가, 독립 피드(Naver) 교차검증 게이트
4. 스냅샷 JSON을 `snapshots` 테이블 + `backend/snapshots/<ticker>/<date>.json`에 저장
5. `consensus_pipeline.run_daily/backfill`로 컨센서스 적재 (`backend/services/consensus_pipeline.py`)
6. `cache.invalidate(ticker)`로 관련 캐시 무효화 (`backend/services/cache.py:52`)

### 배치 사전계산 경로

1. APScheduler가 cron/interval 트리거로 `_JOB_FUNCS[job_id]` 실행 (`backend/scheduler/jobs.py`)
2. `job_runs.record(job_id, trigger)` 컨텍스트로 실행 로그 기록 (`backend/services/job_runs.py`)
3. 외부 fetch(키움/Naver/FRED/KOFIA 등) → `market_cache` 또는 전용 테이블 저장
4. 요청 경로는 저장값만 read (라이브 fetch 0)

**상태 관리:**
- 백엔드: PostgreSQL이 source of truth, 인메모리 캐시(`cache.py`)는 휘발 가속용
- 프론트: `contexts/AuthContext.jsx`(세션·메뉴 권한), `hooks/usePortfolioData.js`/`useReportList.js` 등 데이터 페칭 훅, localStorage(access/refresh 토큰)

## 핵심 추상화

**패키지 re-export (ADR-0017):**
- 목적: 거대 모듈을 leaf 파일로 분리하되 `module.X` 외부 참조 표면 보존
- 예시: `backend/services/storage/__init__.py`, `backend/services/market/__init__.py`, `backend/scheduler/__init__.py`
- 패턴: `__init__.py`가 서브모듈의 공개+참조 private 심볼을 명시 re-export(`import *`는 underscore 건너뜀)

**배치 레지스트리:**
- 목적: 배치 메타데이터(라벨·스케줄·출처·소비처·시장·trigger 종류)의 단일 정의
- 예시: `backend/services/batch_registry.py` (`BATCHES` 리스트, `get_batch(job_id)`)
- 패턴: job_id = 스케줄러 잡 id = `job_runs.record` id 삼위 일치

**시세 폴백 체인:**
- 목적: KR/US 시세를 다중 소스 폴백으로 견고화
- 예시: `backend/services/market/kr.py`(get_quote_kr: 키움→KIS→Naver), `backend/services/market/us.py`(yfinance→KIS)
- 패턴: 키 미설정이 안전 기본값(휴면), regular=False는 독립 피드 2-of-N 다수결

**TTL/LRU 캐시:**
- 목적: read-heavy 엔드포인트 앞 인메모리 가속
- 예시: `backend/services/cache.py`(`TTLCache` 클래스, 스냅샷 LRU `OrderedDict`)

## 엔트리 포인트

**백엔드 앱:**
- 위치: `backend/main.py`
- 트리거: `uvicorn main:app` (port 8000), Dockerfile/Procfile
- 책임: `lifespan`에서 `_migrate()`(idempotent DDL) → `sched.start()` → 캐시 워밍 스레드 기동, 18개 라우터 mount, CORS·Session·EventTracker 미들웨어, `/health`

**스케줄러:**
- 위치: `backend/scheduler/__init__.py` (`start()`/`stop()`/`reload()`)
- 트리거: `main.py` lifespan의 `sched.start()`
- 책임: `_seed_batch_schedules()`(idempotent 시드) → 편집 배치 리스케줄 → `_check_missed_report()`(누락 리포트 복구) → 랭킹·KR섹터 시드 → APScheduler 기동

**프론트엔드:**
- 위치: `frontend/src/main.jsx` → `frontend/src/App.jsx`
- 트리거: `vite`(dev) / nginx가 `frontend/dist` 서빙(prod)
- 책임: `createRoot` 렌더, `App.jsx`가 OAuth 콜백 처리·세션 확인·`BrowserRouter` 라우팅(`/` 리서치, `/portfolio`, `/market`, `/guru`, `/settings`, `/admin-analytics`)

## 스케줄러/배치 시스템

- **레지스트리:** `backend/services/batch_registry.py`의 `BATCHES`(24개 항목)가 각 배치의 id·label·category·schedule·source·usage·market·trigger_kinds·editable·default_schedule을 정의.
- **잡 함수:** `backend/scheduler/jobs.py`의 `_JOB_FUNCS` dict가 job_id→함수 매핑(`_generate_kr`/`_generate_us`/`_fetch_leverage`/`_fetch_kr_rankings`/`_fetch_recommendation_kr` 등).
- **스케줄 저장:** 편집 가능 배치는 `batch_schedules` 테이블(job_id PK, jsonb spec). `storage.get/save_batch_schedule`로 read/write.
- **트리거:** `backend/services/schedule_spec.py`의 `build_trigger_kwargs`가 spec(weekly/daily/monthly/interval)→APScheduler `CronTrigger` kwargs 변환.
- **시드/마이그레이션:** 기동 시 `_seed_batch_schedules()`가 행 없는 편집 배치를 시드(은퇴 id 승계 포함, `schedule.py:_seed_spec_for`).
- **누락 복구:** `_check_missed_report_for`가 당일 KR/US 스케줄이 지났는데 스냅샷 없는 종목만 즉시 재생성.
- **시장 분리:** 일일 리포트·실적·월간 지표가 `_kr`/`_us` 2배치로 분리(ADR-0012/0013).
- **계측:** `backend/services/job_runs.py`의 `record(job_id, trigger)` 컨텍스트가 `job_runs` 테이블에 running→success/failed 기록(job_id별 최근 20건만 보관). `GET /api/batches`가 레지스트리+실행이력 노출.

## 캐싱 계층

- **인메모리(`backend/services/cache.py`):** 스냅샷 LRU(`OrderedDict`, max 50) + TTLCache 7종 — list(60s)·dashboard(300s)·correlation(300s)·sector(300s)·macro(300s)·quote(60s)·live_prices(15s). 종목 mutation 시 `invalidate(ticker)`가 일괄 무효화.
- **PostgreSQL 영구 캐시:** `market_cache` 테이블(fx/vix/commodities/treasury/econ/m7/krtop2/krexports/macro_signals) — `services/market_indicators/cache.py`의 `_mc_load`/`_mc_save`. 증분 fetch(마지막 날짜 이후만).
- **파일 캐시(gitignored):** `backend/data/calendar/YYYY-MM.json`(월별 캘린더), `backend/data/consensus/`(per-ticker), `backend/snapshots/`(per-ticker/date JSON 폴백).

## 배포 토폴로지

- **인프라:** Mac 로컬 Docker — `docker-compose.yml` 정의(`postgres`·`backend`·`nginx`·`certbot`). 단 `deploy.sh`는 backend/nginx를 `docker run`으로 개별 교체(compose 아님).
- **nginx:** HTTP(80)/HTTPS(443) 서빙, `/api/*`·`/health` → `backend:8000` 프록시. `frontend/dist`를 `:ro` 볼륨마운트로 직접 서빙(`nginx/nginx.conf`). index.html·sw.js 캐시 금지, Vite 해시 자산은 장기 캐시.
- **backend:** `./backend` 빌드 FastAPI 컨테이너(port 8000), `backend/.env.docker` env_file.
- **postgres:** PostgreSQL 16-alpine, `pgdata` 볼륨, `auth_schema.sql`→`app_schema.sql` 순 init(`docker-entrypoint-initdb.d`).
- **certbot:** HTTPS 인증서 자동갱신(12h 루프).
- **Cloudflare Tunnel:** portfolion.taebro.com → localhost:80 (cloudflared는 compose 아닌 launchd).
- **자동 배포:** `git push origin main` → GitHub Actions self-hosted 러너(`.github/workflows/deploy.yml`: `git reset --hard origin/main` → `bash deploy.sh`) 주 경로 + 폴러(`scripts/auto-deploy-poll.sh`) 폴백. `deploy.sh`는 frontend build → backend 이미지 build → backend/nginx 컨테이너 교체 → `/health` 체크.

## 아키텍처 제약

- **스레딩:** 단일 FastAPI 프로세스 + 인-프로세스 APScheduler. 배치/리포트 생성은 `ThreadPoolExecutor`(calendar max 30, dashboard 10, analysis 11)로 외부 fetch 병렬화. DB 풀 maxconn 20을 ThreadPool 동시성보다 크게(소진 시 블록 아닌 `PoolError`).
- **전역 상태:** `services/db.py`의 `_pool`(스레드락 lazy 싱글톤), `scheduler/_state.py`의 `_scheduler`, `services/cache.py`의 모듈레벨 캐시 인스턴스, 키움/KIS 클라이언트의 인-프로세스 토큰 싱글톤.
- **순환 import 회피:** `storage`→`cache`는 함수 내 지연 import. 스케줄러는 leaf 모듈(`_state.py`)에서 공유 상태 import해 부분초기화 순환 회피.
- **LLM 부재:** 백엔드는 AI/Anthropic 호출 없음(`requirements.txt`에 anthropic 미포함). 분석 텍스트는 외부 Cowork가 enrich API로 작성.

## 안티패턴

### 비-additive 응답 reshape

**무엇이 일어나나:** 엔드포인트 응답을 배열→객체 등 비-additive로 바꾸면 그 엔드포인트를 fetch하는 독립 소비처(훅 외 직접 fetch)가 옛 형태로 깨진다.
**왜 문제인가:** 한 소비처만 고치면 다른 곳(`Analytics.jsx`가 훅과 별개로 `/api/stocks/dashboard` 직접 fetch)이 `res.data`를 옛 배열로 취급해 조용히 깨짐.
**대신 이렇게:** additive(필드 추가) 선호. reshape 불가피하면 `grep -rn '<경로>' frontend/src/`로 전수 감사를 DoD에 포함.

### 요청 경로 외부 API 라이브 호출

**무엇이 일어나나:** 배치-백킹 뷰(랭킹·KR 업종 모멘텀)를 요청/기동 경로에서 외부 API(키움)로 라이브 빌드.
**왜 문제인가:** 요청당 N콜 직렬=수초 지연, 캐시 만료마다 느려짐(task#50).
**대신 이렇게:** 배치가 사전계산해 `market_cache`/테이블 저장, 요청은 저장값만 read(`backend/services/kr_sector_service.py`·`ranking_service.py`).

### all-None 결과 캐시 박제

**무엇이 일어나나:** 외부 fetch 실패를 silent except로 삼키고 빈/all-None 결과를 캐시에 저장.
**왜 문제인가:** 시드 가드가 "채워짐"으로 오판해 고착(task#48 `_fetch_one_sector`).
**대신 이렇게:** 실패는 로깅, all-None이면 save 생략·직전 양호값 유지(`_seed_*_if_empty`).

## 에러 처리

**전략:** 외부 fetch 일시 실패는 graceful degrade(직전 양호값 유지 또는 부분 결과). NaN/inf는 소스 또는 출력에서 가드(`services/utils.sanitize`).

**패턴:**
- `get_connection()` 컨텍스트가 commit/rollback/putconn 자동 처리 (`backend/services/db.py:31`)
- 배치 잡은 내부 예외 try/except로 삼키고 정상 종료(부분 실패여도 job_runs success — 본문 로그 병행 확인 필요)
- 응답에 시세/합산 싣는 엔드포인트는 `sanitize` 또는 소스 `math.isfinite` 가드(starlette `allow_nan=False` 500 방지)
- 라우터는 `HTTPException`으로 4xx 반환, `services/errors.py` 공용 에러

## 횡단 관심사

**로깅:** `print`(스케줄러·배치) + `logging`(job_runs). 구조화 로거 미사용.
**검증:** 라우터 Pydantic 모델 + `field_validator`(ticker 정규화·검증, `services/utils.is_valid_ticker`).
**인증:** `backend/auth.py` — `get_current_user`(JWT Bearer HS256), `get_current_user_or_api_key`(X-API-Key Cowork), `require_admin`. 프론트는 axios 인터셉터가 Bearer 주입·401 시 로그아웃(`frontend/src/api.js`). 메뉴 권한은 `AuthContext`가 nav 필터링.

---

*아키텍처 분석: 2026-06-27*

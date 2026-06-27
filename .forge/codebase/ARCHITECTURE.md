---
last_mapped_commit: f1839804fa84342f9e30cc6dc919d5e5abba7b8d
mapped: 2026-06-28
---

# PortfoliOn 아키텍처

PortfoliOn은 백엔드(Python/FastAPI)와 프론트엔드(React 19 + Vite) 두 애플리케이션으로 구성된다. 백엔드는 라우터 → 서비스 → 저장소/DB 계층으로, 프론트엔드는 페이지 → 컴포넌트 → 훅 계층으로 흐른다. 런타임 데이터는 Docker PostgreSQL에 저장하며 로컬 JSON 파일은 캐시 용도다.

## 1. 전체 패턴 (계층)

### 백엔드 계층
```
HTTP 요청
  → routers/*.py        (엔드포인트, 인증 Depends, 요청/응답 직렬화)
  → services/*.py       (도메인 로직, 외부 API 호출, 캐시)
  → services/storage/   (포트폴리오·종목·스케줄 등 DB 영속 + 도메인 변환)
  → services/db.py      (psycopg2 ThreadedConnectionPool, query/execute 헬퍼)
  → PostgreSQL
```

- 라우터는 `backend/routers/` 아래 한 파일이 하나의 도메인을 담당하며 `APIRouter`를 export한다(`portfolio.py`, `stocks.py`, `report.py` 등). `backend/main.py`가 모두 `app.include_router(...)`로 마운트한다.
- 서비스는 `backend/services/`에 위치. 외부 시세/공시/통계 API 호출, 캐싱, 점수 계산 등 도메인 로직이 여기 모인다.
- DB 접근의 단일 통로는 `backend/services/db.py`다. 모듈 전역 `ThreadedConnectionPool`(minconn=1, maxconn=20)을 lazy 초기화하고 `get_connection()`(contextmanager, commit/rollback 자동) · `query(sql, params)` · `execute(...)`를 제공한다. 풀 소진 시 블록이 아니라 `PoolError`를 던진다(`calendar` ThreadPool 15·`analysis` 11 동시성보다 크게 maxconn=20).
- 저장소 계층은 `backend/services/storage/` 패키지로, `db.py`를 호출해 포트폴리오/종목/이름/날짜/스케줄을 영속하고 도메인 형태로 변환한다.

### 프론트엔드 계층
```
페이지 (frontend/src/pages/*.jsx)        — 라우트 단위 화면, 데이터 페칭 오케스트레이션
  → 훅 (frontend/src/hooks/*.js)          — 데이터 페칭·상태·뮤테이션 캡슐화
  → 컴포넌트 (frontend/src/components/)    — 표시 단위 (도메인별 하위 디렉터리 + ui/ 프리미티브)
  → api.js (axios 인스턴스)               — HTTP, 토큰 주입, 401 처리
  → 백엔드 /api/*
```

- HTTP 클라이언트는 `frontend/src/api.js`(axios 인스턴스). 요청 인터셉터가 `localStorage`의 `access_token`을 Bearer로 주입하고, 응답 인터셉터가 401 시 토큰을 비우고 `/`로 리다이렉트한다. `baseURL`은 `import.meta.env.VITE_API_BASE_URL || ''`(미설정 시 상대경로 → Vite 프록시/nginx).
- 페이지는 훅을 통해 데이터를 받고, 도메인 컴포넌트(`components/reports/`, `components/market/`, `components/portfolio/`, `components/recommendations/`)와 UI 프리미티브(`components/ui/`)로 렌더한다.

## 2. 요청/데이터 흐름

대표 흐름은 두 갈래다.

- **요청 경로 (라이브 조회)**: 프론트 페이지/훅이 `/api/*` 호출 → 라우터 → 서비스가 캐시(메모리 또는 DB `market_cache`/테이블)에서 읽거나 필요 시 외부 API 호출 → 응답. 배치-백킹 뷰(랭킹·KR 업종 모멘텀·시장지표 등)는 요청 경로에서 외부 API를 라이브 호출하지 않고 저장값만 읽는 것이 규약이다.
- **배치 경로 (사전계산·영속)**: APScheduler 잡(또는 admin 수동 엔드포인트)이 외부 소스를 fetch → 서비스가 가공 → DB 테이블/`market_cache`에 저장 → `services/job_runs.py`가 실행 이력 기록.

응답 직렬화 주의: starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 NaN/inf가 있으면 직렬화 단계에서 500이 난다. 시세/합산을 응답에 싣는 엔드포인트는 소스 isfinite 가드 또는 `services/utils.py`의 `sanitize`로 NaN/inf → None 처리한다.

## 3. 앱 진입점

### 백엔드 — `backend/main.py`
- `load_dotenv()` 후 `FastAPI(title=..., lifespan=lifespan)` 생성.
- 미들웨어: `SessionMiddleware`(SESSION_SECRET), `EventTrackerMiddleware`(`backend/middleware/event_tracker.py`, 사용자 행동 로깅), `CORSMiddleware`(허용 origin: `localhost:3000`, `localhost:5173`, `FRONTEND_URL`).
- `lifespan` 컨텍스트가 기동 시 ① `_migrate()`(idempotent DDL — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`로 `backlog_history.segments`, `batch_schedules`, `market_short_sell`, `stock_disclosures`, `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations` 등 보장), ② `scheduler.start()`, ③ 캘린더·시장 캐시 워밍 스레드(daemon)를 띄운다. 종료 시 `scheduler.stop()`.
- 라우터 18종을 `include_router`로 마운트(`auth`, `portfolio`, `report`, `watchlist`, `stocks`, `guru`, `calendar`, `digest`, `market_indicators`, `analytics`, `analysis`, `events`, `rankings`, `investor`, `short_sell`, `batches`, `recommendations`, `admin`). `/health`는 GET/HEAD 헬스체크.

### 스케줄러 — `backend/scheduler/` (패키지)
구 단일 `scheduler.py`는 패키지로 분리됨. 구성:
- `__init__.py` — 공개 표면(`start()`, `stop()`, `reload(job_id)`)과 잡 함수·스케줄 헬퍼를 명시적으로 re-export(`import *`가 underscore 심볼을 건너뛰므로 private 잡 함수까지 명시 re-export). 외부는 `import scheduler as sched`로 모듈 속성 접근.
- `_state.py` — 공유 상태/상수(leaf 모듈, 순환참조 회피): `_scheduler = AsyncIOScheduler()`, `_DIGEST_JOB_ID`, `_VALID_DAYS`.
- `jobs.py` — 실제 잡 함수들(`_generate_kr`/`_generate_us`, `_fetch_backlog`, `_fetch_recommendation_kr/us`, `_fetch_kr_sector` 등)과 잡 id→함수 매핑 `_JOB_FUNCS`, 기동 시드(`_seed_rankings_if_empty`, `_seed_kr_sector_if_empty`).
- `schedule.py` — 트리거 빌드(`_build_trigger`, cron) · 리스케줄(`_reschedule_job`) · 스케줄 시드/마이그레이션(`_seed_batch_schedules`, `_seed_spec_for`) · 누락 리포트 복구(`_check_missed_report`, 시장별 KR/US 당일 미생성 검출 후 재생성).

`start()`는 `_seed_batch_schedules()` → editable 배치 전부 `_reschedule_job` → `_check_missed_report()` → 시드 가드 → `_scheduler.start()` 순으로 동작한다.

### 프론트엔드 — `frontend/src/main.jsx` · `frontend/src/App.jsx`
- `main.jsx`가 `tokens.css`·`index.css`를 로드하고 `<App/>`을 `createRoot`로 마운트(`StrictMode`).
- `App.jsx`가 라우팅·인증 게이트의 중심. `ToastProvider` → `AuthProvider`(`frontend/src/contexts/AuthContext.jsx`) → `BrowserRouter` 순으로 감싼다.
- 인증: `localStorage`의 `access_token` 기반. OAuth 콜백(`?oauth=`/`?token=&refresh=`) 파싱 → 토큰 저장. 세션 없으면 `<LoginPage/>` 렌더.
- 라우트(`<Routes>`): `/`·`/research` → `Research`, `/portfolio` → `Portfolio`, `/market` → `MarketHub`, `/guru` → `Guru`, `/settings` → `Settings`, `/admin-analytics` → `AdminAnalytics`, `/dev/showcase` → `Showcase`, `/analysis` → `/portfolio` 리다이렉트.
- nav 탭은 `AuthContext`의 `menuPermissions`로 필터링하고 admin이면 "행동"(analytics) 탭 추가. 모바일은 `MobileNav`, PWA 설치 유도는 `InstallPrompt`.

## 4. 배치/스케줄러 모델

- 배치 메타데이터의 정본은 `backend/services/batch_registry.py`의 `BATCHES`(현재 24개 항목). 각 항목은 `id`(= APScheduler 잡 id = `job_runs.record` 호출 id, 셋이 반드시 일치), `label`, `category`, `usage`(소비 UI), `source`(데이터 fetch 출처), `editable`, `trigger_kinds`, `market`(`KR`/`US`/`공통`, 출처국 기준), `default_schedule`, `timezone`, `misfire_grace_time` 등을 가진다.
- 배치 id 목록: `daily_report_kr`, `daily_report_us`, `consensus`(자체 잡 없이 daily_report에 내장), `daily_digest`, `backlog_fetch`, `dividend_fetch`, `disclosure_fetch`, `insider_fetch`, `earnings_kr`/`earnings_us`, `monthly_kr`/`monthly_us`, `macro_signals_fetch`, `leverage_fetch`, `lending_fetch`, `kr_rankings_fetch`, `us_rankings_fetch`, `investor_trend_fetch`, `short_sell_fetch`, `supply_score_fetch`, `kr_sector_fetch`, `guru_crawl`, `recommendation_kr`, `recommendation_us`.
- 일일 리포트는 시장별로 `daily_report_kr`(KST 20:30, NXT 마감 이후) · `daily_report_us`(KST 07:00)로 분리. 실적·월간 지표도 `earnings_kr/us`, `monthly_kr/us`로 분리(ADR-0012·0013).
- 스케줄은 `batch_schedules` 테이블에 잡별 행으로 저장하고 `scheduler/schedule.py:_reschedule_job`이 그 스펙으로 cron 트리거를 다시 건다. 트리거 빌드는 `services/schedule_spec.py:build_trigger_kwargs` 경유.
- `GET /api/batches`(`routers/batches.py`)가 레지스트리·다음 실행 시각·실행 이력을 노출. 배치 현황 편집 UI는 `frontend/src/components/BatchScheduleEditor.jsx`·`frontend/src/pages/Settings.jsx`.
- 실행 이력은 `services/job_runs.py`가 `job_runs` 테이블에 auto/manual/backfill lane으로 기록.

## 5. 배포 토폴로지

- **인프라**: Mac 로컬 Docker Compose 4-컨테이너(`docker-compose.yml`).
  - `postgres`(postgres:16-alpine, `pgdata` 볼륨)
  - `backend`(`./backend` 빌드, FastAPI, 포트 8000)
  - `nginx`(nginx:alpine, HTTP:80 서빙, `/api/*` → `backend:8000` 프록시, `frontend/dist`를 `:ro` 볼륨마운트로 직접 서빙)
  - `certbot`(certbot/certbot, HTTPS 인증서 자동 갱신)
- **프론트 서빙**: nginx가 `frontend/dist`를 직접 서빙하므로 `cd frontend && npm run build`가 즉시 라이브. 백엔드 변경은 배포(폴러/러너) 후 라이브.
- **공개 경로**: Cloudflare Tunnel(`cloudflared`, compose 컨테이너가 아니라 launchd 실행)이 `portfolion.taebro.com` → `localhost:80`.
- **자동실행**: launchd가 cloudflared + docker compose를 기동.
- **환경변수**: `backend/.env.docker`(POSTGRES_PASSWORD, JWT_SECRET, SESSION_SECRET, OAuth, FRED_API_KEY, KOFIA_API_KEY, DART_API_KEY, KIWOOM/KIS 키 등), 루트 `.env`(docker-compose 보간용).
- **배포 메커니즘**: `git push origin main` 시 자동 배포. 주 경로 = self-hosted GitHub Actions 러너(`runs-on: self-hosted`), 폴백 = 폴러(`scripts/auto-deploy-poll.sh`, 2분마다 `LOCAL != origin/main`이면 `git reset --hard origin/main` 후 `deploy.sh`). 정식 재생성 스크립트는 `deploy.sh`.

## 6. 주요 추상화

- **패키지 재export로 god-file 분리(ADR-0017)**: 큰 단일 모듈을 패키지로 쪼개되 공개 표면을 보존한다. `backend/services/storage/`·`backend/services/market/`·`backend/services/recommendation/`의 `__init__.py`가 서브모듈의 공개+외부참조 private 심볼을 패키지 루트로 명시 re-export해, `from services import storage; storage.X` 같은 모듈-속성 접근과 직접 import를 둘 다 보존한다.
- **시세 추상화**: `services/market/__init__.py`가 `get_quote(...)`를 진입점으로 시장별(KR/US) 분기. KR은 키움 → KIS → Naver 폴백 체인(`services/market/kr.py`), US는 yfinance → KIS(`services/market/us.py`). 외부 SDK 클라이언트는 `services/kiwoom/`·`services/kis/` 패키지에 분리.
- **시장지표 패키지**: `services/market_indicators/`가 FX/VIX/원자재/국채/경제지표/실적/수출/매크로신호를 서브모듈로 나누고 `cache.py`가 PostgreSQL `market_cache` 읽기/쓰기를 담당.
- **추천 엔진(ADR-0015)**: `services/recommendation/`가 universe→scoring→funnel→store→actions로 단계 분리, 배치가 점수를 사전계산해 `stock_recommendations`에 저장하고 요청은 저장값만 읽음.
- **인메모리 캐시**: `services/cache.py`가 snapshot(LRU 200)·list(TTL 5s)·dashboard/correlation/sector/macro(TTL 300s) 6종 캐시를 관리, 종목 변경 시 자동 무효화.

## 7. 최근 구조 변경

- `backend/services/charts.py`는 **제거됨**(현재 파일 없음).
- `backend/scheduler/`는 **패키지**가 됨(`__init__.py`, `_state.py`, `jobs.py`, `schedule.py`). 구 단일 `scheduler.py`는 더 이상 없다.
- `backend/services/market/`는 **패키지**가 됨(`__init__.py`, `format.py`, `kr.py`, `us.py`). 구 단일 `market.py`는 없다.
- `backend/services/storage/`·`backend/services/recommendation/`도 패키지(ADR-0017 패턴).

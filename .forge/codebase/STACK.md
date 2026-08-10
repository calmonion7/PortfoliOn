---
last_mapped_commit: 20dd46eb829b05025af793b010dfe4efe2925a7d
mapped: 2026-08-10
---

# STACK — 언어·런타임·프레임워크·의존성·설정

이 문서는 **구현 사실**만 담는다(도메인 용어 정의는 `.forge/CONTEXT.md` 소관).
외부 API·DB·인증 제공자·웹훅의 상세는 자매 문서 `.forge/codebase/INTEGRATIONS.md`.

---

## 0. 한눈에

| 층 | 스택 | 정본 파일 |
|---|---|---|
| 백엔드 | Python 3.12(컨테이너) / FastAPI + uvicorn + APScheduler | `backend/requirements.txt`, `backend/Dockerfile`, `backend/main.py` |
| 백엔드 로컬 | Python **3.9.6** venv (`backend/.venv/`) — 컨테이너와 다름 | (gitignored) |
| 프론트 | React 19 + Vite 8(rolldown) + plain CSS + react-router 7 + recharts 3 | `frontend/package.json`, `frontend/vite.config.js` |
| DB | PostgreSQL 16 (Docker `postgres:16-alpine`) | `docker-compose.yml`, `backend/app_schema.sql`, `backend/auth_schema.sql` |
| 웹서버 | nginx:alpine (정적 서빙 + `/api/` 프록시) | `nginx/nginx.conf` |
| 인증서 | certbot/certbot 컨테이너 (12h 루프 renew) | `docker-compose.yml` |
| 배포 | GitHub Actions self-hosted 러너(주) + launchd 폴러(폴백) → `deploy.sh` | `.github/workflows/*.yml`, `deploy.sh`, `scripts/auto-deploy-poll.sh` |
| 백엔드 테스트 | pytest (`backend/tests/`, 테스트 파일 138개) | `backend/pytest.ini`, `backend/tests/conftest.py` |
| 프론트 테스트 | vitest + jsdom + @testing-library (테스트 파일 63개) | `frontend/vite.config.js`의 `test` 블록, `frontend/src/test/setup.js` |
| 라이브 UAT | Playwright (별도 워크스페이스) | `scripts/package.json`, `scripts/uat*.mjs` |

측정 시점 규모: 백엔드 `services/`+`routers/`+`scheduler/` 약 18,600줄, 프론트 `src/` .jsx/.js 200+ 파일.

---

## 1. 백엔드 — Python / FastAPI

### 1.1 런타임

- **컨테이너**: `backend/Dockerfile` = `FROM python:3.12-slim` → `pip install -r requirements.txt` → `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]`.
- **로컬 개발/테스트**: `backend/.venv/` = **Python 3.9.6**. 이 비대칭이 하드 제약 두 개를 만든다.
  - **PEP604 union(`X | None`)을 런타임 평가 어노테이션에 쓰면 로컬에서 `TypeError`** — Pydantic 모델·FastAPI 시그니처는 `Optional[X]`를 쓴다. (모듈 상단 `from __future__ import annotations`가 있는 파일은 *함수 어노테이션*이 지연 평가되므로 `int | None`이 통과하지만, Pydantic 필드처럼 실제로 평가되는 자리에서는 여전히 깨진다. 실제로 `services/db.py`·`services/kiwoom/client.py` 등은 `from __future__ import annotations` 아래에서 `X | None`을 쓰고 있다.)
  - **`lxml`은 `requirements.txt`에 있고 이미지엔 설치되지만 로컬 venv엔 없다** — 로컬 pytest가 게이트이므로 HTML 파싱은 `BeautifulSoup(html, "html.parser")`로 통일돼 있다(`services/market_indicators/indices.py`의 `_parse_multpl_cape`, `services/market/kr.py`).
- **`backend/Procfile`** (`web: uvicorn main:app --host 0.0.0.0 --port $PORT`)은 과거 PaaS 배포 잔재 — 현재 배포 경로(`deploy.sh` → `docker run`)에서 쓰이지 않는다.

### 1.2 의존성 (`backend/requirements.txt`)

| 패키지 | 제약 | 어디서 쓰나 |
|---|---|---|
| `fastapi` | `>=0.104.0` | 앱·라우터 전부. ⚠️ **배포 이미지는 0.138.x대** — `app.include_router()`가 `_IncludedRouter`로 감싸 `app.routes`가 평탄하지 않다(로컬 구버전과 다름). 라우트 열거 코드는 `routes`와 `original_router`를 **양쪽 재귀 하강**해야 한다(`scripts/audit_unauth_endpoints.py`의 `_walk`) |
| `uvicorn[standard]` | `>=0.24.0` | ASGI 서버 |
| `apscheduler` | `>=3.10.4` | `backend/scheduler/` — `BackgroundScheduler` + `CronTrigger` |
| `yfinance` | `>=0.2.40` | 시세·재무·수급·지수·랭킹. 임포트 모듈 19개(§1.6 표) |
| `pandas` | `>=2.1.0` | 시계열·재무 DataFrame, `services/indicators.py` |
| `numpy` | `>=1.26.0` | `services/indicators.py`, `services/analysis_service.py`(상관·베타) |
| `requests` | `>=2.31.0` | 외부 HTTP **주 클라이언트**(26개 모듈) |
| `beautifulsoup4` | `>=4.12.0` | HTML 파싱 6곳(`scraper`, `backlog_parser`, `guru_scraper`, `market/kr`, `market_indicators/earnings`, `market_indicators/indices`) |
| `lxml` | `>=4.9.0` | 이미지에만 존재 — 위 제약대로 **코드는 의존하지 않는다** |
| `httpx` | `>=0.25.0` | **OAuth 토큰 교환 전용** — `backend/routers/auth.py`의 `oauth_google_callback`/`oauth_github_callback`이 `httpx.AsyncClient`를 쓰는 유일한 소비처 |
| `pytest` | `>=7.4.0` | 테스트 |
| `exchange_calendars` | `>=4.5` | `backend/routers/calendar.py`가 `import exchange_calendars as xcals`로 휴장일 계산 |
| `psycopg2-binary` | `>=2.9.0` | `services/db.py`의 `ThreadedConnectionPool`·`RealDictCursor`·`execute_batch` |
| `authlib` | `>=1.3.0` | ⚠️ **선언만 되어 있고 임포트 0건** — OAuth는 `httpx` + 수동 state HMAC으로 직접 구현돼 있다(`routers/auth.py`의 `_make_state`/`_verify_state`) |
| `python-jose[cryptography]` | `>=3.3.0` | JWT — `backend/auth.py`, `services/auth_service.py`, `middleware/event_tracker.py` |
| `bcrypt` | `>=4.0.0` | `services/auth_service.py`의 `hash_password`/`verify_password` |
| `itsdangerous` | `>=2.0.0` | starlette `SessionMiddleware`의 전이 의존(직접 임포트 없음) |
| `python-dotenv` | (무제약) | `main.py` 최상단 `load_dotenv()` |

`anthropic` 패키지는 **없다** — 백엔드에 LLM 호출이 없다(AI 텍스트는 외부 Cowork 클라이언트가 enrich API로 써 넣는다; `INTEGRATIONS.md` §9).

### 1.3 앱 엔트리 (`backend/main.py`, 325줄)

임포트 순서 자체가 계약이다: `load_dotenv()` → `_configure_logging()` → 그 다음에야 `scheduler`·`routers` 임포트.

1. **`_configure_logging()`** — `logging.basicConfig(level=INFO, format="%(levelname)s %(name)s: %(message)s")` + `urllib3`/`yfinance`/`apscheduler`/`asyncio`를 WARNING으로 억제 + `uvicorn`/`uvicorn.error`/`uvicorn.access`의 `propagate=False`(root 핸들러 중복 emit 차단). 이 배선이 없으면 root lastResort가 WARNING+만 내보내 `logger.info`가 `docker logs`에 안 뜬다.
2. **`_migrate()`** — 기동 시 idempotent DDL(ADR-0006). `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`를 개별 `try/except`로 감싸 하나가 실패해도 나머지가 진행된다(실패는 `logger.warning(f"[Migrate] ...")`). **`app_schema.sql`은 신규 설치용이고 라이브 DB는 이 경로만 탄다** — 컬럼 추가는 두 파일 쌍이 DoD.
3. **`lifespan`** — `_migrate()` → `sched.start()` → `threading.Thread(target=_warm_market_cache, daemon=True).start()` → yield → `sched.stop()`.
4. **예외 핸들러** — `RequestValidationError`를 가로채 `sanitize(jsonable_encoder(exc.errors()))`로 감싼 422를 반환. starlette `JSONResponse`가 `allow_nan=False`라, 입력 NaN을 그대로 echo하면 422가 **500**으로 터지는 것을 앱 전역에서 막는다.
5. **미들웨어 스택**(추가 순서) — `SessionMiddleware(secret_key=os.environ["SESSION_SECRET"])`, `EventTrackerMiddleware`, `CORSMiddleware`. CORS origin은 `http://localhost:3000`·`http://localhost:5173`·`FRONTEND_URL`(빈 값은 필터링).
6. **라우터 20개 등록** — `auth`가 첫 번째, `admin`이 마지막.
7. **`/health`** — `@app.api_route("/health", methods=["GET","HEAD"])` → `{"status":"ok"}`. nginx에 별도 `location /health` 프록시가 있다.

⚠️ `os.environ["SESSION_SECRET"]`은 모듈 로드 시점에 평가되므로 **미설정이면 임포트 단계에서 죽는다**(fail-fast).

### 1.4 패키지 레이아웃

```
backend/
  main.py                앱 엔트리(위)
  auth.py                FastAPI 인증 의존성 4종(§1.5)
  Dockerfile / Procfile / requirements.txt / pytest.ini
  auth_schema.sql        users, refresh_tokens (app_schema보다 먼저 실행)
  app_schema.sql         앱 테이블 전체
  migrations/            001_user_events.sql, 002_backlog_history.sql (수기 참조용)
  middleware/
    event_tracker.py     EventTrackerMiddleware
  routers/               20개 (§1.7)
  scheduler/             패키지 — __init__.py(배선)·jobs.py(534줄)·schedule.py·_state.py
  services/              도메인 서비스 (§1.6)
  tests/                 pytest 138 파일 + fixtures/ + conftest.py + _routes.py
  data/                  정적 참조 데이터(읽기 전용 시드) + 런타임 JSON 잔재
  snapshots/ reports/    gitignored 런타임 산출물
```

`services/` 하위 **서브패키지 6개**: `market/`(`__init__`·`format`·`kr`·`us`), `market_indicators/`(11모듈), `kiwoom/`(6모듈), `kis/`(4모듈), `storage/`(`portfolio`·`names`·`schedule`·`dates`), `recommendation/`(`universe`·`funnel`·`scoring`·`actions`·`store`).

**패키지 분리는 re-export로 공개 표면을 보존한다**(ADR-0017) — `services/market/__init__.py`와 `services/storage/__init__.py`가 서브모듈의 public+외부참조 private 심볼(`_naver_get`, `_kr_basic_kis`, `_yf_sym`, `_ANALYST_KEYS` …)까지 패키지 루트로 끌어올린다. 그래서 `from services import market; market._kr_basic_naver(...)` 같은 모듈 속성 접근과 테스트의 monkeypatch 경로가 분리 전후로 동일하다.

### 1.5 인증 배선 (`backend/auth.py`)

의존성 4종이 전부이고, 라우터는 이 중 하나를 `Depends`로 문다.

| 의존성 | 허용 자격 | 반환 |
|---|---|---|
| `get_current_user` | JWT Bearer만 | `payload["sub"]` |
| `get_current_user_or_api_key` | `X-API-Key` 헤더(=`COWORK_API_KEY`) **또는** JWT | API 키면 sentinel `"__api_key__"` |
| `require_admin` | JWT + `users.role == 'admin'` — **API 키를 거부한다** | user_id |
| `require_admin_or_api_key` | API 키 통과, 아니면 admin JWT 요구 | user_id 또는 sentinel |

- JWT는 `python-jose`, 알고리즘 **HS256**, 시크릿 `JWT_SECRET`. `HTTPBearer(auto_error=False)`라 미인증은 핸들러에서 401을 던진다.
- 토큰 수명은 `services/auth_service.py`: access `timedelta(hours=1)`, refresh `timedelta(days=30)`.
- `X-API-Key`가 **존재하면** 값이 틀릴 때 즉시 401 — JWT로 폴백하지 않는다.

### 1.6 서비스 계층 (`backend/services/`)

인프라·공통:

| 모듈 | 역할 |
|---|---|
| `db.py` | psycopg2 `ThreadedConnectionPool(minconn=1, maxconn=20)` 싱글톤(+`threading.Lock` 이중검사). `get_connection()` 컨텍스트매니저(성공 시 commit·예외 시 rollback·항상 putconn), `query`(RealDictCursor→dict 리스트), `execute`(rowcount), `execute_many`(`execute_batch`, 빈 리스트는 no-op). `maxconn=20`은 최대 ThreadPool 동시성(calendar 15·analysis 11)보다 크게 잡은 값 — psycopg2 풀은 소진 시 블록이 아니라 `PoolError`를 던진다 |
| `cache.py` | 인메모리 캐시 전용 모듈. `TTLCache(ttl, maxsize=200)` 클래스 + 스냅샷 LRU(`OrderedDict`, `_MAX=50`). 인스턴스: list 60s · dashboard 300s · correlation 300s · sector 300s · macro 300s · quote 60s · live_prices 15s · rebalance 300s · exposure 300s. `invalidate_portfolio_caches(user_id)`가 묶음 무효화 |
| `utils.py` | `today_kst()`(컨테이너가 UTC라 bare `date.today()` 금지), `sanitize()`(NaN/inf 재귀 제거 — **float뿐 아니라 `Decimal`도 검사**), `is_valid_ticker()`(`^[A-Za-z0-9.\-]{1,15}$`), `find_ticker*` 헬퍼 |
| `parallel.py` | `parallel_map(func, items, max_workers=10)` — `ThreadPoolExecutor`, 빈 리스트는 즉시 `[]` |
| `progress.py` | `ProgressTracker` — `threading.Lock` 보호 dict(`running/done/total/current/failed`), 장기 크롤 진행률 |
| `errors.py` | `not_found()`/`already_exists()` `HTTPException` 팩토리 |
| `job_runs.py` | 배치 실행로그. `record(job_id, trigger)` 컨텍스트매니저가 **`Run` 핸들을 yield**(`.run_id` + `.set_status()`). 상태 어휘 `running\|success\|partial\|skipped\|failed`, 본문이 예외를 전파하면 `failed`가 지정을 이긴다. job_id별 최근 `KEEP=20`건 보관 |
| `batch_registry.py` | `BATCHES` 정적 리스트 **29개** — `id`/`label`/`category`/`schedule_desc`/`usage`/`source`/`market`/`editable`/`trigger_kinds`/`manual_endpoint`/`scheduler_job_id`/`timezone`/`default_schedule`. `job_id`는 스케줄러 잡 id 및 `job_runs.record` 인자와 반드시 일치 |
| `schedule_spec.py` | 스케줄 스펙 dict → APScheduler `CronTrigger` kwargs |
| `storage/` | 포트폴리오·종목명·스케줄·기대일자 (DB 접근) |

도메인/데이터 서비스(외부 연동은 `INTEGRATIONS.md`에서 상세):

`market/`(시세·재무 파사드) · `market_indicators/`(시장지표 11종) · `kiwoom/`·`kis/`(증권사 REST) · `report_generator.py`(757줄, 스냅샷 생성) · `consensus.py`·`consensus_pipeline.py` · `indicators.py`(RSI/EMA/베타 등 numpy·pandas) · `analysis_service.py`(섹터 ETF 11종·매크로 4종 상관) · `kr_sector_service.py`·`us_sector_service.py` · `ranking_service.py` · `investor_service.py`·`short_sell_service.py`·`supply_score.py`·`us_supply.py` · `backlog.py`+`backlog_parser.py` · `disclosures.py`·`agm.py`·`insider_trades.py`·`dividends.py`·`beta.py` · `leverage_service.py`·`lending_service.py` · `guru_scraper.py`·`guru_stats.py` · `digest_service.py` · `recommendation/` · `analyst_reports.py`·`tech_reports.py` · `exposure.py`·`rebalance.py` · `scraper.py` · `cowork_trigger.py` · `auth_service.py`.

**yfinance를 임포트하는 19개 모듈**: `services/{scraper, beta, consensus_pipeline, report_generator, dividends, us_supply, analysis_service, ranking_service}`, `services/recommendation/funnel.py`, `services/market/{kr, us, __init__}`, `services/market_indicators/{cache, kospi_signal, earnings}`, `routers/{stocks, calendar, analytics, report}`.

### 1.7 라우터 (`backend/routers/`, 20개)

| 파일 | prefix | 비고 |
|---|---|---|
| `auth.py` | `/api/auth` | 유일하게 인증 없이 여는 표면(ADR-0029) |
| `portfolio.py` | `/api/portfolio` | |
| `watchlist.py` | `/api/watchlist` | |
| `stocks.py` | `/api/stocks` | 675줄. `PUT /enrich/batch`를 `PUT /{ticker}/enrich`보다 **먼저** 등록해야 `enrich`가 티커로 라우팅되지 않는다 |
| `report.py` | `/api` | 592줄 |
| `guru.py` | `/api/guru` | |
| `calendar.py` | `/api` | |
| `digest.py` | `/api` | |
| `market_indicators.py` | `/api/market` | **prefix는 이것 하나** — `/api/market-indicators`는 존재하지 않는다 |
| `analytics.py` | `/api/analytics` | |
| `analysis.py` | `/api/analysis` | |
| `events.py` | `/api/events` | |
| `rankings.py` | `/api` | |
| `investor.py` | `/api` | |
| `short_sell.py` | `/api` | |
| `batches.py` | `/api` | |
| `recommendations.py` | `/api/recommendations` | |
| `analyst_reports.py` | `/api/analyst-reports` | |
| `tech_reports.py` | `/api/tech-reports` | |
| `admin.py` | `/api/admin` | |

문서 정본은 `API_SPEC.md`(전체) / `CLAUDE_COWORK_API.md`(Cowork 스코프). `backend/tests/test_api_doc_sync.py`가 라이브 `app.routes` ↔ 두 문서의 `### \`METHOD /path\`` 헤더를 대조해 **엔드포인트 존재 drift만** 자동 검출한다(요청/응답 스키마·인증 산문은 미검증).

### 1.8 스케줄러 (`backend/scheduler/`)

- **패키지**(단일 `scheduler.py` 아님): `_state.py`(공유 `_scheduler` 인스턴스·상수 — leaf 모듈로 두어 부분초기화 순환 회피) / `jobs.py`(잡 함수 + `_JOB_FUNCS` 매핑) / `schedule.py`(트리거 빌드·리스케줄·시드·누락복구) / `__init__.py`(전부 re-export + `start()`/`stop()`/`reload()`).
- `start()` 순서: `_seed_batch_schedules()` → `editable` 배치 전부 `_reschedule_job` → `_check_missed_report()` → `_seed_rankings_if_empty()` → `_seed_kr_sector_if_empty()` → `_seed_us_sector_if_empty()` → `_scheduler.start()`.
- 트리거는 `CronTrigger(**build_trigger_kwargs(spec), timezone=entry["timezone"])`, 대부분 `Asia/Seoul`.
- `misfire_grace_time`은 **명시된 배치에만** 전달한다 — `None`을 넘기면 APScheduler가 '유예 무제한'으로 해석해 거동이 바뀌므로 미지정 시 인자 자체를 뺀다(현재 `daily_report_kr/us`만 `82800`).
- 스케줄 저장소는 `batch_schedules` 테이블(job_id PK, jsonb) — `_seed_spec_for`가 레거시 `schedules`/`guru_schedules`에서 승계 마이그레이션.

**등록 배치 29종**(id | market | 기본 스케줄):

`daily_report_kr`|KR|설정 · `daily_report_us`|US|설정 · `consensus`|공통|리포트에 내장(스케줄러 잡 없음) · `daily_digest`|공통|매일 08:00 · `backlog_fetch`|KR|일 04:00 · `dividend_fetch`|공통|일 05:00 · `beta_fetch`|공통|일 05:30 · `disclosure_fetch`|KR|매일 07:30 · `agm_fetch`|KR|매일 08:00 · `insider_fetch`|KR|매일 07:45 · `earnings_kr`/`earnings_us`|일 03:00 · `monthly_kr`/`monthly_us`|매월 1일 02:00 · `macro_signals_fetch`|US|매일 06:00 · `kospi_signal_fetch`|KR|평일 08:30 · `leverage_fetch`|KR|매일 07:00 · `lending_fetch`|KR|매월 5일 08:00 · `kr_rankings_fetch`|KR|장중 10분 · `us_rankings_fetch`|US|장중 10분 · `investor_trend_fetch`|KR|매일 18:00 · `short_sell_fetch`|KR|매일 18:30 · `supply_score_fetch`|KR|매일 19:00 · `kr_sector_fetch`|KR|매일 16:00 · `us_sector_fetch`|US|매일 07:20 · `guru_crawl`|공통|설정 · `recommendation_kr`|KR|매일 20:30 · `recommendation_us`|US|매일 07:00 · `us_supply_fetch`|US|일 06:00.

### 1.9 환경변수 (이름만)

- `.env`(루트, docker-compose 보간용): `FRED_API_KEY`, `KITA_API_KEY`.
- `backend/.env.docker`(gitignored, 컨테이너 `env_file`): `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `FRED_API_KEY`, `KITA_API_KEY`, `KOFIA_API_KEY`, `DART_API_KEY`, `FRONTEND_URL`, `COWORK_API_KEY`, `KIWOOM_BASE_URL`, `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY`, `KIS_APP_KEY`, `KIS_APP_SECRET`, `COWORK_ROUTINE_FIRE_URL`, `COWORK_ROUTINE_FIRE_TOKEN`.
- 코드가 읽지만 `.env.docker` 목록에 **없는** 키: `TELEGRAM_BOT_TOKEN`·`TELEGRAM_CHAT_ID`(`services/digest_service.py`의 `send_telegram` — 미설정이면 조용히 스킵), `KIS_BASE_URL`(기본값 있음), `POSTGRES_PASSWORD`(compose용).
- `.env.docker`에 있지만 백엔드가 **쓰지 않는** 키: `ANTHROPIC_API_KEY`(백엔드에 LLM 호출 없음).
- 소비 빈도 상위: `FRONTEND_URL`(9) · `DART_API_KEY`(7) · `FRED_API_KEY`(4) · `JWT_SECRET`(3).
- **읽는 방식이 두 가지**이고 의미가 다르다 — `os.environ["X"]`(없으면 KeyError=fail-fast: `SESSION_SECRET`, `DATABASE_URL`, `JWT_SECRET`, OAuth 시크릿) vs `os.getenv("X", "")`/`os.environ.get`(미설정 시 **휴면**: 키움·KIS·DART·FRED·KOFIA·Cowork fire). 후자는 "키 미설정이 안전 기본값"이라는 설계 — 코드를 먼저 머지해도 무해하다.
- 클라이언트 모듈은 env를 **호출 시점에** 읽는다(`_creds()`/`_base_url()` 함수) — 테스트에서 monkeypatch 가능하게 하려는 의도(키움/KIS 클라이언트가 동일 패턴으로 동결).

### 1.10 백엔드 테스트 스택

- `backend/pytest.ini`: `testpaths = tests`, `pythonpath = .`. 실행 `cd backend && .venv/bin/python -m pytest`.
- `tests/conftest.py`:
  - `sys.path`에 backend 루트 삽입, `main.app`에 `app.dependency_overrides[get_current_user] = lambda: "test-user-id"`를 **모듈 레벨**로 건다.
  - `client` fixture = `TestClient(app)`.
  - autouse `_clear_quote_cache` — 테스트 간 quote TTL 캐시 교차오염 차단.
  - autouse **`_block_real_db`** — `services.db._get_pool`을 raise로 monkeypatch. 로컬 `DATABASE_URL`이 라이브 Docker postgres를 가리켜 테스트가 prod 데이터를 덮은 사고(005930 스냅샷 클로버) 이후 도입. **가드가 raise하면 그 테스트가 실 DB에 닿고 있다는 뜻이므로 가드를 풀지 말고 mock을 추가**한다.
- 다수 라우터 테스트는 conftest의 `client`가 아니라 **모듈 상단에서 `FastAPI()`를 직접 만들어** `app.dependency_overrides`로 auth를 우회한다(`test_stocks_router.py`, `test_consensus_router.py` 등) — conftest는 `main.app`의 `get_current_user`만 override하므로 이 자체-app 테스트엔 안 걸린다.
- 특수 테스트: `test_api_doc_sync.py`(문서 drift), `test_no_print.py`(앱 코드 `print(` 0건 단언), `tests/_routes.py`(라우트 열거 헬퍼), `tests/fixtures/`.

### 1.11 로깅 규약

- 모듈 `logger = logging.getLogger(__name__)`로 통일, **`print` 신규 금지**(`tests/test_no_print.py`가 단언).
- 포맷 `logger.x(f"[Component] <무엇> (<ids>): {e}")` — formatter에 이름 프리픽스가 없어 메시지 안의 `[Component]` 마커가 유일한 grep 앵커다. PascalCase·개념당 1스펠링(`[Cache]`, `[Migrate]`, `[FX]`, `[Index]`, `[Commodities]`, `[Econ]`, `[KospiFutures]`, `[UsSector]`, `[ShortSell]`, `[InvestorTrend]`, `[CoworkTrigger]`, `[Report]`, `[Consensus]`, `[Scheduler]` …).
- 레벨: `warning`=graceful 담화(외부 fetch 실패·폴백) / `error`=예상치 못함·데이터 손실(아껴 씀) / `info`=배치·라이프사이클.

---

## 2. 프론트엔드 — React 19 / Vite 8

### 2.1 의존성 (`frontend/package.json`)

**runtime**: `react` ^19.2.5 · `react-dom` ^19.2.5 · `react-router-dom` ^7.14.2 · `axios` ^1.16.0 · `recharts` ^3.8.1. **그게 전부다** — UI 프레임워크·CSS-in-JS·상태관리 라이브러리 없음(**plain CSS**, TailwindCSS 아님).

**dev**: `vite` ^8.0.10 · `@vitejs/plugin-react` ^6 · `vite-plugin-pwa` ^1.3.0 · `vitest` ^4.1.9 · `jsdom` ^29 · `@testing-library/react` ^16.3.2 · `@testing-library/jest-dom` ^6 · `eslint` ^10 + `@eslint/js` + `eslint-plugin-react-hooks` ^7 + `eslint-plugin-react-refresh` + `globals` · `@types/react*`.

스크립트: `dev`(vite) · `build`(vite build) · `test`(vitest run) · `lint`(eslint .) · `preview`.

### 2.2 `frontend/vite.config.js`

- **플러그인 3종**
  1. `react()`
  2. `VitePWA({...})` — `registerType: 'autoUpdate'`, `injectRegister: 'auto'`. workbox: `cacheId: 'portfolion-<BUILD_DATE>'`(모듈 로드 시각 `YYYYMMDDHHmmss`), `globPatterns: ['**/*.{js,css,svg,png,woff2}']`, `skipWaiting: true`, `clientsClaim: true`, `navigateFallback: null`. `runtimeCaching` 3건: Google Fonts(CacheFirst 1년) · jsdelivr CDN(CacheFirst 1년) · **`/api/` (NetworkFirst, `networkTimeoutSeconds: 10`, maxEntries 50, maxAge 5분) — 단 `/api/auth/`는 정규식으로 명시 제외**. manifest: name `PortfoliOn`, `display: standalone`, `theme_color`/`background_color` `#f6f6f4`, `lang: 'ko'`.
  3. **커스텀 `sw-cache-bust`**(`apply: 'build'`, `closeBundle` post) — `dist/index.html`의 `registerSW.js`·`manifest.webmanifest`와 `registerSW.js` 안의 `/sw.js`에 `?<BUILD_DATE>` 쿼리를 붙인다. `configResolved`에서 **실제 `config.build.outDir`를 캡처**한다 — `dist` 하드코딩이던 시절 `--outDir` throwaway 빌드가 라이브 `dist/index.html`을 매 빌드 오염시켰다.
- **`test`**: `{ environment: 'jsdom', globals: true, setupFiles: './src/test/setup.js' }` — 별도 vitest 설정 파일 없이 vite config에 얹혀 있다.
- **`build.rollupOptions.output.manualChunks`**: Vite 8 = **rolldown 번들러라 함수 형식만** 받는다(객체형은 `Expected Function but received Object`로 빌드 실패). 현재 분기 — `node_modules` 아니면 undefined, `recharts`/`/d3-`/`victory-vendor` → `'charts'`, 나머지 → `'vendor'`.
- **`server`**: port 5173, `/api` → `http://localhost:8000` 프록시(`changeOrigin`), `watch: { usePolling: true, interval: 500 }`.

### 2.3 `frontend/index.html` — 첫 페인트 계약

`<head>` 안의 **순서 자체가 계약**이다:
1. 인라인 `<style>`로 `html{background:#f6f6f4}` / `html[data-theme="dark"]{background:#171310}` — `data-theme`만 세우고 배경을 안 칠하면 번들 CSS 로드 전까지 브라우저 기본 흰색이라 플래시가 남는다.
2. **테마 부트스트랩 동기 스크립트** — `localStorage.theme==='dark'`면 `<html data-theme="dark">` + `meta[theme-color]` 교체. `<!-- theme-boot:start/end -->` 마커로 감싸여 있고 **`src/themeBoot.js`와 바이트 동일**해야 한다(테스트가 지킨다: `theme-boot-twin.test.js`, `theme-boot-exec.test.js`, `theme-boot-handoff.test.jsx`).
3. **폰트 `<link rel="stylesheet">`는 반드시 그 뒤** — 동기 스크립트는 자기보다 앞선 미완료 스타일시트가 로드될 때까지 실행이 차단되는데, 이 링크들은 외부 CDN이라 지연이 크다.
4. OAuth 스플래시 `<style>` + `#root` 안의 `#oauth-splash`(마커 `<!-- oauth-splash:start/end -->`, `src/oauthSplash.js`와 쌍 — `oauth-splash-twin.test.js`). `<script>`가 `/[?&](oauth|error)=/.test(location.search)`일 때만 `hidden`을 푼다.
   ⚠️ **React `createRoot().render()`가 첫 커밋에서 `#root`의 정적 자식을 지운다** — 스플래시 제거 코드가 따로 없는 이유이자, 인계 구간(그 순간 `authLoading`이 아직 true면 빈 화면)이 실재하는 이유.
5. 외부 CDN 4곳: `fonts.googleapis.com`/`fonts.gstatic.com` preconnect + Inter·Noto Serif KR 스타일시트, `cdn.jsdelivr.net` preconnect + Pretendard v1.3.9 스타일시트.

### 2.4 `frontend/src/` 레이아웃

```
src/
  main.jsx        createRoot + StrictMode. CSS 임포트 순서: styles/tokens.css → styles/motion.css → index.css
  App.jsx         BrowserRouter + AuthProvider + ToastProvider, 라우트 정의, doLogout
  api.js          axios 인스턴스(§2.5)
  routes.js       REDIRECTS 구URL→신규 라우트 맵(ADR-0025) — App.jsx와 route-redirects 테스트가 공유
  navSections.js  nav IA 5섹션 단일 소스 — NAV_SECTIONS + matchesSection/matchesItem
  themeBoot.js / oauthSplash.js   index.html 인라인 코드의 트윈(테스트가 동일성 단언)
  utils.js utils.test.js
  index.css App.css
  styles/         tokens.css · motion.css · pc.css · mobile.css · guru.css
  contexts/       AuthContext.jsx
  hooks/          20개 (§2.6)
  pages/          43 파일
  components/     최상위 + market/ portfolio/ reports/ recommendations/ tech/ sketches/ ui/
  utils/          analytics.js diag.js guruName.js marketHours.js oauthHistory.js priceFlash.js pwa.js
  glossary/       terms.js match.js
  test/           24개 통합/회귀 테스트 + setup.js
  assets/
```

- **`navSections.js`가 nav 단일 소스** — 소비처 3곳이 파생한다: `components/Masthead.jsx`(PC 카테고리+서브바), `components/MobileNav.jsx`(모바일 하단 탭바), `pages/ResearchShell.jsx`(모바일 seg). 아이콘 매핑은 소비처마다 달라(`components/sketches` vs `components/ui/icons`) 공유 모듈엔 순수 경로·라벨 데이터만 둔다. 회귀 가드 `src/test/nav-active-matching.test.jsx`.
- **`components/ui/`가 디자인 시스템 프리미티브**: `Badge`·`Button`·`Card`·`Input`·`Stat`·`Skeleton`·`icons.jsx` + 도메인 배지 3종(`GuruActivityBadge`·`InsiderBadge`·`SupplyBadge`), 배럴 `index.js`.
- 라우트(`App.jsx`): `/reports` `/recommend` `/ranking` `/compare` `/calendar` `/dividends` `/digest` `/analyst-reports` `/analyst-report/:ticker/:date` `/tech-reports` `/tech-report/:slug`(이상 `<ResearchShell>` 래핑) · `/portfolio` · `/market/indicators` `/market/flow` · `/guru` `/guru/:id` · `/settings` · `/admin-analytics` · `/dev/showcase`.

### 2.5 API 클라이언트 (`frontend/src/api.js`)

- `axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '' })` — **프론트가 읽는 유일한 Vite 환경변수**(코드 내 4곳). 미설정 시 상대경로(nginx 동일 오리진).
- 요청 인터셉터: `localStorage.access_token` → `Authorization: Bearer`.
- 응답 인터셉터: **401이면 두 토큰을 지우고 `window.location.replace('/')`** — `replace`라 만료 시점 딥링크 엔트리를 히스토리에 남기지 않는다(재로그인 후 뒤로가기 재진입 차단).
- axios를 거치지 않는 fetch도 있다: `App.jsx`의 `doLogout`(`/api/auth/logout`), `utils/analytics.js`의 `trackEvent`(`/api/events`, 토큰 없으면 no-op·실패는 `.catch(() => {})`로 삼킴).

### 2.6 훅 (`frontend/src/hooks/`, 20개)

인증·부팅: `useAuth` · `useAuthBootstrap`(OAuth 코드교환 + `history.replaceState`로 search 제거 + 부팅 구간 계측 `bootTimings()`) · `useBfcacheAuthGuard`(뒤로가기 캐시 복원 시 세션 in-place 뒤집기, ADR-0035) · `useSwUpdateReload`.
데이터: `usePortfolioData` · `useTrackedStocks` · `useReportList` · `useReportFilters` · `useReportGeneration` · `useStockManagement`.
UI: `useTheme` · `useIsMobile` · `useBodyScrollLock` · `useCountUp` · `usePriceFlash` · `useReveal`.

**`useSwUpdateReload`**는 이 스택 조합의 구멍을 메운다 — `vite-plugin-pwa`의 `autoUpdate`+`skipWaiting`+`clientsClaim`은 새 SW가 열린 탭을 즉시 claim하지만 **앱을 리로드하진 않아** 열린 탭이 무기한 옛 번들을 실행한다. 훅이 라우트 전환·탭 재활성 시점에 그 창을 닫는다. 마운트 시점 `navigator.serviceWorker.controller` 유무(`hadController`)로 "첫 SW 설치"와 "진짜 갱신"을 가른다(안 가르면 첫 방문마다 리로드).

### 2.7 프론트 테스트 스택

- vitest + jsdom + `@testing-library/react`, `setupFiles`는 `@testing-library/jest-dom` 임포트 한 줄.
- 테스트 파일 63개 — 컴포넌트 옆 co-located(`*.test.jsx`)와 `src/test/`(24개 크로스컷 회귀)로 나뉜다.
- **jsdom 한계가 테스트 설계를 규정한다**: `ResponsiveContainer`가 0크기라 **recharts는 렌더되지 않는다** → 차트 테스트는 SVG가 아니라 주변 DOM(범례 텍스트·캡션·분기)을 단언한다. 레이아웃 수치·색 적용·잘림은 원리적으로 볼 수 없다 → 라이브 Playwright 프로브가 그 축의 게이트(§3.4).

### 2.8 ESLint (`frontend/eslint.config.js`)

flat config. `globalIgnores(['dist'])` + `**/*.{js,jsx}`에 `js.configs.recommended` · `reactHooks.configs.flat.recommended` · `reactRefresh.configs.vite`. `languageOptions.globals = globals.browser`, `parserOptions.ecmaFeatures.jsx`. **`console.*`에 대한 lint 가드는 없다**(규약만 존재).

---

## 3. 인프라 · 배포

### 3.1 컨테이너 (`docker-compose.yml`, version "3.9")

| 서비스 | 이미지/빌드 | 포트 | 볼륨 |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | `5432:5432`(호스트 노출) | `pgdata` + `auth_schema.sql`→`/docker-entrypoint-initdb.d/01-auth.sql`, `app_schema.sql`→`02-app.sql` |
| `backend` | `build: ./backend` | (미노출, 내부 8000) | — · `env_file: ./backend/.env.docker` · `depends_on: postgres(service_healthy)` |
| `nginx` | `nginx:alpine` | `80:80`, `443:443` | `./frontend/dist`→`/usr/share/nginx/html:ro`, `./nginx/nginx.conf:ro`, `./certbot/conf:ro`, `./certbot/www:ro` |
| `certbot` | `certbot/certbot` | — | `./certbot/conf`, `./certbot/www` · entrypoint = `certbot renew` + `sleep 12h` 무한 루프 |

`postgres` healthcheck는 `pg_isready -U portfolion`(5s 간격·10회). `postgres`/`backend`/`nginx`는 `restart: unless-stopped`.

⚠️ **compose 정의와 실제 런타임이 갈린다** — `deploy.sh`는 backend/nginx를 compose가 아니라 **`docker run`으로 직접 교체**한다(§3.3). 그래서 `docker compose ps`에 backend가 안 잡히고, uptime 확인은 `docker ps`로 해야 한다.

**Cloudflare Tunnel**(`portfolion.taebro.com` → localhost:80)은 compose 서비스가 아니라 launchd로 돈다.

### 3.2 nginx (`nginx/nginx.conf`)

단일 `server { listen 80 }`(443 블록은 통째 주석 처리). location 우선순위 순:
- `/.well-known/acme-challenge/` → `root /var/www/certbot`
- `/health` → `proxy_pass http://backend:8000`
- `/api/` → `proxy_pass http://backend:8000` + `Host`/`X-Real-IP`/`X-Forwarded-For`/`X-Forwarded-Proto`
- `= /index.html` → **캐시 금지**(`no-cache, no-store, must-revalidate` + Pragma + Expires 0)
- `~* ^/(sw\.js|workbox-[^/]+\.js)$` → **캐시 금지**(해시 없는 파일명)
- `~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$` → `public, max-age=31536000, immutable`(Vite 해시 파일명)
- `/` → `try_files $uri /index.html`(SPA 폴백)

### 3.3 배포 파이프라인

**주 경로** `.github/workflows/deploy.yml`: `on: push: branches: [main]` → `runs-on: self-hosted` → `cd /Users/calmonion/Project/PortfoliOn && git fetch origin && git reset --hard origin/main && bash deploy.sh`.

**폴백** `scripts/auto-deploy-poll.sh`(launchd, 2분 주기): 락 파일이 있으면 skip → `git fetch origin main` → `LOCAL == REMOTE`면 조용히 exit 0 → **다르면(앞서든 뒤처지든) `git reset --hard origin/main` 후 `deploy.sh`**. → 메인 체크아웃에서 커밋 안 한 tracked 편집과 push 안 한 로컬 커밋은 다음 폴(≤2분)에 날아간다. `.forge/` 등 untracked는 `reset --hard` 대상이 아니라 안전.

**`deploy.sh`** (`set -e`, 4단계):
0. `/tmp/portfolion-deploy.lock` 존재 시 exit 1(러너↔폴러 동시 배포 방지), `trap`으로 해제. `DOCKER_CONFIG`를 임시 dir로 바꿔 macOS keychain 접근을 우회.
1. `cd frontend && npm install --silent && npm run build --silent` → `frontend/dist/`
2. `docker build -t portfolion-backend ./backend --quiet`
3. `docker stop/rm portfolion-backend-1` → `docker run -d --name portfolion-backend-1 --network portfolion_default --network-alias backend --restart unless-stopped --env-file ./backend/.env.docker portfolion-backend`
4. `docker stop/rm portfolion-nginx-1` → `docker run -d ... -p 80:80 -p 443:443 -v <repo>/nginx/nginx.conf:ro -v <repo>/frontend/dist:/usr/share/nginx/html:ro nginx:alpine`
5. `sleep 2 && curl -s http://localhost/health`

**비대칭이 중요하다**: nginx가 `frontend/dist`를 직접 마운트하므로 **로컬 `npm run build`는 배포 없이도 즉시 라이브**인 반면, 백엔드는 러너/폴러가 재배포해야 반영된다 → 그 사이 "새 프론트 ↔ 옛 백엔드" 창이 실재한다. 같은 이유로 **프론트 빌드는 그 자체가 배포 행위**다.

### 3.4 도구 워크스페이스 (`scripts/`, 141개 엔트리)

- **`scripts/package.json`** = `{ "name": "portfolion-screenshots", "private": true, "dependencies": { "playwright": "^1.50.0" } }`. `scripts/node_modules/`는 gitignored이고 `playwright`/`playwright-core`만 들어 있다. **프론트 워크스페이스에는 Playwright가 없다** — 라이브 UAT는 이 별도 워크스페이스에서 돈다.
- `uat*.mjs` 라이브 프로브 다수(현재 `uat289-*`까지), `probe*.mjs`/`probe*.py`, `smoke23x-auth.mjs`, `capture-*.js`, `screenshot.js`.
- 하니스 관례: **컨텍스트를 `serviceWorkers: 'block'`으로** 만든다(SW가 `/api/*`를 NetworkFirst로 가로채 `page.route` 응답 주입을 무력화하므로). 예외는 SW 설치 여부 자체가 측정축인 프로브(`uat288-oauth-boot-timing.mjs`가 `'allow'`를 쓰고 그 이유를 헤더 주석에 명시).
- 파이썬 도구: `audit_unauth_endpoints.py`(FastAPI 라우트 재귀 열거), `kospi_signal_backtest.py`, `contrast_probe.py`, `repair-005930-snapshots.py`.
- **`scripts/cowork-fire-listener.py`** — 표준 라이브러리 `http.server`만 쓰는 로컬 리스너. `127.0.0.1:8787` 바인드(컨테이너에서는 `host.docker.internal:8787`), `Authorization: Bearer <COWORK_ROUTINE_FIRE_TOKEN>` 검증, `scripts/cowork-routine-prompt.md`를 읽어 `{{COWORK_API_KEY}}`를 `.env.docker` 값으로 치환한 뒤 **stdin으로** `claude -p --model opus --allowedTools Bash,WebSearch,WebFetch,Read,Write`에 넘긴다(argv에 키가 보이지 않게). 실행 cwd는 `tempfile.mkdtemp`로 **원자 생성**한 빈 디렉터리(레포 컨텍스트 차단 + 같은 초 2회 fire의 로그 truncate 방지). launchd 서비스 `com.portfolion.cowork-fire-listener`.
- **launchd 서비스들**(레포 밖 설정, 코드가 전제함): `com.portfolion.auto-deploy-poll`, `actions.runner.calmonion7-PortfoliOn.macbook-portfolion`, cloudflared, cowork-fire-listener. `claude -p`처럼 keychain OAuth를 쓰는 서비스는 plist `EnvironmentVariables`에 `HOME`/`USER`/`LOGNAME`이 필요하다.

### 3.5 `.gitignore`가 규정하는 경계

`backend/.env.docker`·`.env`·`certbot/conf/`(시크릿) · `backend/.venv/`·`frontend/node_modules/`·`scripts/node_modules/` · **`frontend/dist/`**(빌드 산출물이지만 nginx가 서빙하는 실체) · `backend/snapshots/`·`backend/reports/`·`backend/data/calendar/`·`backend/data/consensus/` + `backend/data/{holdings,watchlist,stocks,schedule,guru_managers,guru_schedule,kr_exports}.json`(런타임 산출) · `screenshots/`·`.worktrees/`·`.claude/settings.local.json`.

⚠️ `backend/data/`는 **추적되는 정적 시드**(`sp500_tickers.json`·`kospi_tickers.json`)와 **무시되는 런타임 JSON**이 한 디렉터리에 섞여 있다. 시드 두 개는 read-only이며, 7일 티커 캐시는 파일이 아니라 `market_cache` 테이블(`sp500_tickers`·`kospi_tickers` 키)에 있다.

---

## 4. 설정 파일 인벤토리

| 파일 | 무엇을 정하나 |
|---|---|
| `backend/requirements.txt` | 파이썬 의존성(§1.2) |
| `backend/Dockerfile` | 컨테이너 파이썬 3.12 + uvicorn 커맨드 |
| `backend/pytest.ini` | `testpaths`/`pythonpath` |
| `backend/auth_schema.sql` → `backend/app_schema.sql` | DB 스키마(실행 순서 고정) |
| `backend/migrations/*.sql` | 수기 참조 마이그레이션(라이브 적용은 `main._migrate`) |
| `frontend/package.json` | JS 의존성·스크립트 |
| `frontend/vite.config.js` | 빌드·PWA·vitest·프록시·청크(§2.2) |
| `frontend/eslint.config.js` | lint |
| `frontend/index.html` | 첫 페인트 계약(§2.3) |
| `frontend/vercel.json` | 과거 Vercel 잔재(현 배포 경로에서 미사용) |
| `docker-compose.yml` / `nginx/nginx.conf` / `deploy.sh` | 인프라(§3) |
| `.github/workflows/deploy.yml` | CI 배포 |
| `scripts/package.json` | Playwright 워크스페이스 |
| `start.sh`/`start.bat`/`stop.sh`/`stop.bat` | 로컬 개발 편의(백엔드+프론트 동시 기동) |
| `API_SPEC.md` / `CLAUDE_COWORK_API.md` / `README.md` | 문서 정본(코드 변경 시 동기 갱신이 DoD) |
| `KIWOOM_API.md` / `KIS_API.md` | 증권사 API 카탈로그·대체 로드맵 |

---

## 5. 스택이 만드는 제약 (요약)

1. **로컬 3.9 vs 컨테이너 3.12** — 런타임 평가 어노테이션에 PEP604 금지, `lxml` 로컬 부재.
2. **로컬 vs 배포 FastAPI 버전차** — `app.routes`가 평탄하지 않을 수 있어 라우트 열거는 `original_router` 재귀 필요. "라이브 게이트"를 자칭하는 스크립트는 배포 환경에서도 돌려 **숫자가 실제로 나오는지** 확인해야 완성이다(0/빈 결과를 성공으로 읽는 게이트는 게이트가 아니다).
3. **Vite 8 = rolldown** — `manualChunks`는 함수만.
4. **jsdom엔 레이아웃·스타일시트·`getComputedTextLength`가 없다** — recharts 미렌더, 색/치수/잘림 미검출. 그 축은 Playwright 라이브 프로브가 유일한 게이트이고, SVG 텍스트 실측을 쓰는 코드는 **추정 폴백을 반드시 남겨야** 단위 테스트가 깨지지 않는다.
5. **SW가 `/api/*`를 가로챈다** — 응답 주입 UAT는 `serviceWorkers: 'block'` 필수. `/api/auth/*`만 예외적으로 SW 라우트에서 제외돼 있다.
6. **nginx가 `frontend/dist` 직마운트** — 프론트 빌드 = 배포. 라이브를 재는 프로브가 도는 동안 빌드하면 그 프로브의 측정 대상이 바뀐다.
7. **2분 폴러의 `reset --hard`** — tracked 편집·미푸시 커밋이 소실될 수 있으므로 commit과 push를 묶는다.
8. **psycopg2 풀은 소진 시 블록이 아니라 예외** — ThreadPool 동시성을 `maxconn=20` 아래로 유지해야 한다.
9. **starlette `allow_nan=False`** — 응답에 NaN/inf가 있으면 500. 입력측은 `main.py`의 검증 핸들러가, 출력측은 `services.utils.sanitize`와 소스 `math.isfinite` 가드가 막는다.

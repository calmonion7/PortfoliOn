---
last_mapped_commit: c72a7c9e0a5d11a7cf5ccbe8f6e370220a3d19b5
mapped: 2026-08-22
---

# ARCHITECTURE — PortfoliOn

패턴·레이어·데이터 흐름·추상화·진입점. 디렉터리 배치는 `STRUCTURE.md`, 도메인 용어는 `.forge/CONTEXT.md`.

---

## 1. 시스템 지형도

```
                        Cloudflare Tunnel (launchd, compose 밖)
                                    │  portfolion.taebro.com
                                    ▼
        ┌──────────────────────── nginx :80/:443 ─────────────────────────┐
        │  /api/*, /health  → proxy_pass http://backend:8000              │
        │  그 외            → root /usr/share/nginx/html (frontend/dist)  │
        └──────────────────────────────────────────────────────────────────┘
                    │                                   │
       정적 SPA 번들 │                                   │ REST(JSON)
                    ▼                                   ▼
        frontend/dist (Vite 빌드)             backend  FastAPI :8000
        · React 19 SPA + Service Worker        · routers/  (HTTP 표면)
        · localStorage JWT                     · services/ (도메인·외부소스·저장)
                                               · scheduler/ (APScheduler 배치)
                                                        │
                                                        ▼
                                            postgres:16  (pgdata 볼륨)
                                            · 관계 테이블 + market_cache KV
```

컨테이너 4개(`docker-compose.yml`): `postgres` · `backend` · `nginx` · `certbot`.
`cloudflared`는 compose 밖 launchd 프로세스다.

핵심 비대칭 — **프론트는 `frontend/dist` 볼륨 마운트라 빌드 즉시 라이브**, 백엔드는 이미지
재빌드+컨테이너 교체(`deploy.sh`)가 있어야 라이브다. 이 창에서 "새 프론트 ↔ 옛 백엔드"가
실제로 돈다.

---

## 2. 백엔드

### 2.1 진입점과 부팅 시퀀스

`backend/main.py` 하나가 앱 전체를 조립한다. 순서가 의미를 갖는다:

1. `load_dotenv()` — 모듈 최상단, 다른 import보다 앞.
2. `_configure_logging()` — **import보다 먼저 호출**된다. `basicConfig(level=INFO)` +
   `urllib3`/`yfinance`/`apscheduler`/`asyncio`를 WARNING으로 억제 + `uvicorn*` 로거의
   `propagate=False`(중복 emit 차단). 이게 없으면 root lastResort가 WARNING+만 내보내
   `logger.info`가 `docker logs`에 안 뜬다.
3. 라우터·미들웨어 import.
4. `lifespan` (asynccontextmanager):
   - `_migrate()` — 기동 idempotent DDL (ADR-0006). `CREATE TABLE IF NOT EXISTS` /
     `ALTER TABLE … ADD COLUMN IF NOT EXISTS`를 `try/except` 블록으로 하나씩 감싸,
     한 문장이 실패해도 나머지·기동이 진행된다.
   - `sched.start()` — 배치 배선(§3.2).
   - `threading.Thread(target=_warm_market_cache, daemon=True)` — `get_econ_indicators()`·
     `get_kr_exports()` 워밍. 데몬 스레드라 비블로킹.
   - (shutdown) `sched.stop()`.
5. `app = FastAPI(lifespan=lifespan)`.
6. `RequestValidationError` 커스텀 핸들러 — 422 detail을 `services.utils.sanitize`로 통과시킨다.
   starlette `JSONResponse`는 `allow_nan=False`라, 입력 NaN을 그대로 echo하면 422가 **500**이 된다.
   엔드포인트별이 아니라 **앱 전역** 가드다.
7. `Exception` 전역 핸들러(`_unhandled_exception_handler`) — 미포착 예외를 스택·내부 메시지 없는
   고정 JSON 500(`{"detail": "Internal Server Error"}`)으로 바꾸고 원인은 서버 로그에만 남긴다
   (`wrong < missing`의 응답판). 세 성질이 계약이다: ⓐ `HTTPException`·`RequestValidationError`는
   **삼키지 않는다**(starlette는 `Exception`/500 키만 `ServerErrorMiddleware`로 보내므로 404·401·403의
   상태·본문 계약이 보존된다) ⓑ 본문을 `sanitize`로 감싼다(핸들러 본문에 NaN이 섞이면 **핸들러
   자신이 500**을 낸다 — 지금은 정적 문자열이라 no-op이지만 래퍼를 빼면 그 상태가 열린다)
   ⓒ `ServerErrorMiddleware`가 호출 뒤에도 재raise하므로 uvicorn 스택 로그와 TestClient의 예외
   전파는 그대로다.
8. **`SESSION_SECRET` fail-fast** — `os.environ.get(...) or ""`가 빈 문자열이면 `RuntimeError`로
   기동을 거부한다. bare `os.environ[...]`는 키 *부재*만 KeyError로 잡고 **빈 값은 통과**시키는데,
   그러면 컨테이너·헬스체크는 정상이고(access/refresh는 `JWT_SECRET`이라 무영향)
   `routers/auth.py::_hmac_secret`만 터져 **신규·재로그인만 전면 불가**한 무음 고장이 된다.
   부재와 빈 값을 같은 기동 실패로 수렴시킨다.
9. 미들웨어 3종(등록 역순으로 실행): `CORSMiddleware` → `EventTrackerMiddleware` → `SessionMiddleware`.
10. `include_router` × 20 — `admin_router`가 마지막.
11. `@app.api_route("/health", methods=["GET","HEAD"])`.

`_migrate`가 만드는 테이블(= `app_schema.sql`에는 있지만 라이브 DB는 이 경로로만 받는 것):
`batch_schedules` · `market_short_sell` · `stock_disclosures` · `stock_dividends` ·
`stock_dividend_schedule` · `stock_beta` · `stock_supply_score` · `stock_insider_trades` ·
`stock_recommendations` · `us_supply_snapshot` · `analyst_reports` · `tech_reports`,
그리고 `backlog_history.segments` · `user_stocks.{target_price,stop_price,target_weight,pinned}` ·
`tickers.{key_resource,competitor_edge,market_outlook,analyst_target}` ·
`stock_disclosures.meeting_date` ·
`tech_reports.{key_points,milestones,variants,watch_items,composition}` 컬럼.

`_migrate`는 **컬럼 추가만** 하는 자리가 아니다 — `tech_reports`에 두 종류의 파괴적 단계가 함께 있다:
- **이력 폐기(ADR-0038)** — slug당 최신 1행만 남기고 과거 행을 `DELETE … USING`으로 지운 뒤
  `UNIQUE(slug)` 인덱스를 만든다. 이 인덱스가 없으면 라우터의 `ON CONFLICT (slug)`가 런타임 500이
  되므로 결과를 loud하게 로깅한다.
- **은퇴 slug 삭제(ADR-0039)** — `data-center` **그 slug만** 지운다. 「`TECH_TOPICS` 밖 전부 삭제」
  같은 일반형을 쓰면 나중에 누가 slug를 일시적으로 빼는 순간 그 발행물이 조용히 사라진다.

> 신규 컬럼은 `app_schema.sql`(신규 설치용) + `main.py::_migrate`(라이브용) **쌍**으로 넣어야 한다.
> `tech_reports` 블록에 그 이유가 주석으로 박혀 있다("라이브 DB는 이미 CREATE TABLE을 지났으므로 이 ALTER만 탄다").

### 2.2 레이어와 의존 방향

```
routers/*.py          HTTP 표면 — 인증 Depends, 요청/응답 스키마(pydantic), BackgroundTasks
    │  (단방향)
    ▼
services/*.py         도메인 로직 · 외부소스 어댑터 · 저장 계층
    │
    ▼
services/db.py        psycopg2 ThreadedConnectionPool (minconn=1, maxconn=20)
```

- 라우터는 서로를 import하지 않는다. 유일한 예외가 `services/cache.py:invalidate_portfolio_caches`가
  `routers.calendar.clear_cache`를 **함수 안에서 지연 import**하는 것(순환참조 회피).
- `scheduler/`는 `services/`를 쓰지만 `routers/`를 쓰지 않는다. 반대로 라우터의 수동 트리거는
  서비스 함수를 직접 호출한다 — 즉 **자동/수동 두 경로가 같은 서비스 함수에서 만난다**
  (`scheduler/jobs.py:_run_guru_crawl`과 `routers/guru.py:_run_crawl`이 대표적인 쌍둥이).
- 무거운 import(yfinance·pandas·서비스)는 상당수 **함수 내부 지연 import**다. 기동 시간과
  순환참조를 동시에 다루는 이 저장소의 관례다.

### 2.3 라우터 지도

| 모듈 | prefix | 성격 |
|---|---|---|
| `routers/auth.py` | `/api/auth` | 로컬 로그인·리프레시·OAuth(구글/깃허브)·`/me`. 유일하게 무인증 표면이 정당하다(ADR-0029) |
| `routers/portfolio.py` | `/api/portfolio` | 보유 CRUD·라이브 시세·리밸런싱·노출·배당·핀 |
| `routers/watchlist.py` | `/api/watchlist` | 관심 CRUD·보유 승격 |
| `routers/stocks.py` | `/api/stocks` | 검색·비교·대시보드·enrich(Cowork)·이름/배당/베타/수급 백필 |
| `routers/report.py` | `/api` | 스냅샷 리포트 목록·상세·히스토리, 생성/백필, 컨센서스, 수주잔고·공시·내부자·US수급 |
| `routers/analyst_reports.py` | `/api/analyst-reports` | 심층 리포트 발행/조회(ADR-0027) |
| `routers/tech_reports.py` | `/api/tech-reports` | 주요기술 리포트(비-티커 리소스, ADR-0033/0034/0038/0042~0045). 발행 계약이 pydantic 모델 **22종**으로 이 파일에 있고, 경량 인덱스 `GET /index`는 고정 경로라 `/{slug}`보다 **먼저** 등록된다 |
| `routers/recommendations.py` | `/api/recommendations` | 추천 점수 read + refresh |
| `routers/rankings.py` | `/api` | `/rankings`, `/rankings/refresh` |
| `routers/investor.py` | `/api` | 수급 추이·스크리닝 |
| `routers/short_sell.py` | `/api` | 공매도 추이 |
| `routers/market_indicators.py` | `/api/market` | 시장지표 **16종** read(GET) + admin refresh + 수급(레버리지·대차) |
| `routers/analysis.py` | `/api/analysis` | 섹터 모멘텀(US/KR)·매크로 상관 |
| `routers/analytics.py` | `/api/analytics` | 보유 종목 간 상관관계 |
| `routers/calendar.py` | `/api` | 월별 캘린더 이벤트 + 캐시 무효화 |
| `routers/digest.py` | `/api` | 일일 다이제스트 |
| `routers/guru.py` | `/api/guru` | 매니저·통계(인기/가중/투자금)·크롤 |
| `routers/batches.py` | `/api` | 배치 현황·스케줄 편집·FOMC 커버리지 |
| `routers/events.py` | `/api/events` | 사용자 행동 이벤트 수집 |
| `routers/admin.py` | `/api/admin` | 사용자·권한·기본권한·삭제·analytics·심층리포트 대상·Cowork fire |

> `market_indicators.py`의 prefix는 **`/api/market` 하나뿐**이다(`/api/market-indicators`는 없다).

### 2.4 인증·권한

`backend/auth.py`가 4개의 FastAPI 의존성을 노출한다:

| 의존성 | 통과 조건 | 용도 |
|---|---|---|
| `get_current_user` | JWT Bearer(HS256, `JWT_SECRET`) | 일반 사용자 read/write |
| `get_current_user_or_api_key` | JWT **또는** `X-API-Key == COWORK_API_KEY` | Cowork가 읽는 표면 |
| `require_admin` | JWT + `users.role == 'admin'` — **API 키를 거부한다** | 사람 admin 전용 |
| `require_admin_or_api_key` | API 키 **또는** admin JWT | Cowork가 쓰는 admin 표면 |

API 키 인증은 sentinel user_id `"__api_key__"`(`_API_KEY_USER_ID`)를 반환한다 — user-scoped
저장소를 타는 핸들러에 그대로 넘기면 안 되는 값이다.

**메뉴 권한**은 인증과 별개 축이다. `routers/admin.py`의 `ALL_MENUS =
["portfolio","research","market","guru","settings"]`가 정본이고, `user_menu_permissions` /
`default_menu_permissions` 테이블에 저장되며, 프론트 `AuthContext`가 `/api/auth/me`로 받아
nav를 필터한다. **서버 게이팅이 아니라 표시 제어**다.

`middleware/event_tracker.py:EventTrackerMiddleware`는 화이트리스트된 (method, path) 조합을
`_match_route`로 잡아 `user_events`에 기록한다. Authorization 헤더에서 user_id를 직접 디코드하므로
의존성 그래프 밖이다.

### 2.5 서비스 레이어의 4가지 성격

`backend/services/`는 한 덩어리로 보이지만 실제로는 네 부류다.

**(a) 외부소스 어댑터** — 바깥 API의 방언을 이 앱의 dict로 바꾸는 것만 한다.
`services/kiwoom/`(client·quote·chart·investor·sector·shortsell) ·
`services/kis/`(client·quote·futures) · `services/market/`(kr·us·format) ·
`services/scraper.py`(Finviz·뉴스) · `services/guru_scraper.py`(dataroma).
공통 형태: `client.py`가 토큰 싱글톤 + `_throttle()` + 401 재발급 재시도를 갖고,
`configured()`가 False면 **조용히 휴면**(키 미설정이 안전 기본값).

**(b) 도메인 계산** — 외부 호출 없이 입력을 판정·집계한다.
`indicators.py`(RSI/EMA/HV/매물대) · `supply_score.py` · `recommendation/scoring.py` ·
`guru_stats.py` · `rebalance.py` · `exposure.py` · `analysis_service.py` · `beta.py`.

**(c) 저장·캐시 계층** — DB 읽기/쓰기와 무효화.
`db.py` · `storage/`(포트폴리오·이름·스케줄·날짜) · `cache.py`(인메모리) ·
`market_indicators/cache.py`(`market_cache` KV) · `job_runs.py` · `recommendation/store.py`.

**(d) 파이프라인** — 위 셋을 엮어 한 배치/한 요청을 완성한다.
`report_generator.py` · `consensus_pipeline.py` · `recommendation/funnel.py` ·
`digest_service.py` · `dividends.py` · `disclosures.py` · `agm.py` · `insider_trades.py` ·
`us_supply.py` · `backlog.py`(+`backlog_parser.py`) · `ranking_service.py` ·
`investor_service.py` · `short_sell_service.py` · `kr_sector_service.py` · `us_sector_service.py` ·
`leverage_service.py` · `lending_service.py`.

### 2.6 패키지 재수출 패턴 (ADR-0017)

god-file을 쪼갤 때 **소비처를 건드리지 않는다**는 제약을 지키는 방식이 굳어져 있다 —
디렉터리로 쪼개고 `__init__.py`가 옛 표면을 전부 re-export한다.

| 패키지 | `__init__.py`의 역할 |
|---|---|
| `services/storage/` | `portfolio`·`names`·`schedule`·`dates` + `services.db`의 `query/execute/get_connection`까지 re-export(구 단일 파일이 모듈 속성으로 노출하던 표면 보존) |
| `services/market/` | `format`·`kr`·`us`를 흡수하고 `get_quote`/`get_quotes_batch`/`get_history_df`/`get_financials`/`resolve_name` 등 통합 API를 직접 정의 |
| `services/market_indicators/` | 서브모듈 14개의 public + `_fetch_and_save_*` private까지 명시 `__all__` |
| `services/recommendation/` | `universe`·`funnel`·`scoring`·`actions`·`store` |
| `scheduler/` | `_state`·`jobs`·`schedule`을 re-export. **`import *`가 underscore를 건너뛰므로 private 심볼을 명시 나열**한다(테스트가 `scheduler._generate_kr` 식으로 모듈 속성 조회) |

부작용 하나 — 테스트/외부가 `모듈.심볼`로 patch하므로, 심볼을 옮기거나 지우면
patch 경로가 조용히 깨진다.

---

## 3. 중심 패턴 — 배치가 쓰고, 요청은 읽는다

이 저장소의 지배적 데이터 흐름이다. 성능(요청당 외부 호출 0)과 안정성(외부 장애가 화면을
안 깨뜨림)을 동시에 얻는 대신, **"저장된 값이 곧 진실"**이라는 대가를 진다.

```
외부 API ──fetch──▶ 파이프라인 서비스 ──저장──▶ PostgreSQL / market_cache
 (키움·KIS·yfinance·        ▲                          │
  Naver·DART·FRED·          │                          │ read only
  KOFIA·dataroma)      APScheduler                     ▼
                       (scheduler/)              routers/*.py ──▶ 프론트
                                                       ▲
                                                 인메모리 TTL 캐시
                                                 (services/cache.py)
```

### 3.1 배치 레지스트리 — 정적 메타데이터

`services/batch_registry.py`의 `BATCHES` 리스트가 **배치의 정본 목록**이다(현재 33개 항목 — `market` 기준 KR 16 · US 11 · 공통 6).
항목 하나의 필드:

| 필드 | 의미 |
|---|---|
| `id` | 스케줄러 잡 id **겸** `job_runs.record(id, …)` 호출 id. 두 곳이 반드시 같아야 한다 |
| `label` / `category` / `schedule_desc` | 배치 현황 화면 표시용 |
| `usage` | 그 데이터를 **소비**하는 UI 위치 |
| `source` | 그 데이터를 **fetch**하는 출처 (`usage`와 방향이 반대) |
| `editable` | 스케줄 편집 가능 여부. False면 스케줄러 잡 자체가 없다(`consensus`) |
| `trigger_kinds` / `manual_endpoint` | 수동 실행 표면 |
| `timezone` | 배치 고정 속성(편집 불가). `us_rankings_fetch`만 `America/New_York` |
| `misfire_grace_time` | 미지정이면 APScheduler 기본(1초). `daily_report_kr/us`만 82800 |
| `market` | `KR`/`US`/`공통` — **출처국 기준** 분류(ADR-0013) |
| `default_schedule` | 첫 기동 시드용 스펙 |

`get_batch(job_id)`가 `_BY_ID` 딕셔너리 조회.

### 3.2 스케줄러 배선

`scheduler/` 패키지가 세 조각으로 나뉜다:

- `_state.py` — `_scheduler`(BackgroundScheduler)·`_DIGEST_JOB_ID`·`_VALID_DAYS`. leaf 모듈이라
  부분초기화 순환을 피한다.
- `jobs.py` — 잡 함수 전부 + `_JOB_FUNCS` (job_id → 함수) 맵.
- `schedule.py` — 트리거 생성·리스케줄·시드·누락복구.

`scheduler.start()`가 하는 일(순서 그대로):

1. `_seed_batch_schedules()` — `editable` 배치 중 `batch_schedules` 행이 없는 것만 시드.
   `_seed_spec_for(job_id)`가 마이그레이션 규칙을 담는다(구 `daily_report`/`schedules` →
   `daily_report_kr/us`, 구 `guru_schedules` → `guru_crawl`, 은퇴한 `earnings_refresh`/
   `monthly_refresh` → 시장별 형제로 승계).
   시드 스펙이 검증을 통과하지 못하면(레거시 verbatim 승계가 통합 스펙 이전 형태일 때)
   레지스트리 기본값으로 폴백하되 **`enabled`는 승계**한다 — 기본값이 전부 `enabled: True`라
   통째 교체하면 사용자가 꺼 둔 배치가 조용히 켜진다. 예외 폭은 `Exception`이다
   (`validate_schedule_spec`은 `ValueError` 외에 `TypeError`도 낸다: `days:[['mon']]`).
2. `editable` 배치마다 `_reschedule_job(id)` — 저장 스펙이 `enabled`면
   `_build_trigger(spec, tz)`로 CronTrigger를 만들어 `_JOB_FUNCS[id]`를 등록.
   **판정 게이트는 그 `_build_trigger` 성공 여부다**(빌드 + CronTrigger 생성) — 실패하면
   그 잡만 건너뛰고 ERROR를 남긴다(예외를 전파하면 행 하나 때문에 앱이 뜨지 않는다).
   판정은 `remove_job` **앞에** 둬서 reload 실패가 이미 도는 잡을 죽이지 않는다.
   `validate_schedule_spec`은 **경고용으로만** 호출한다 — PUT 경계용 validator라 더 엄격해서
   게이트로 쓰면 `time:'7:00'`·`enabled:1`·`day_of_month:'15'`·`every_minutes:3`처럼
   **종전에 정상 등록·실행되던** 스펙이 조용히 미등록돼 그 배치가 영구히 안 돈다.
   `misfire_grace_time`은 **None이면 인자를 빼서** 넘긴다(None을 넘기면 APScheduler가
   '유예 무제한'으로 해석해 거동이 바뀐다).
3. `_check_missed_report()` — KR/US 각각, 오늘 스케줄 시각이 지났는데 **그 종목의 오늘
   스냅샷이 없으면** 그 종목만 즉시 생성(부분 누락 복구). ⚠️ 이 단계는 2단계의 잡 가드를
   **공유하지 않는다** — `_check_missed_report_for`가 같은 저장 스펙을 독립적으로 다시 읽으므로
   자체 `_parse_hhmm` 판정 + 시장 단위 try/except를 갖는다(없으면 깨진 `daily_report_*` 행이
   2단계를 통과한 뒤 5단계 전에 앱을 죽인다).
4. `_seed_rankings_if_empty()` / `_seed_kr_sector_if_empty()` / `_seed_us_sector_if_empty()` —
   저장소가 비어 있으면(장외 시간 배포 등) 즉시 1회 적재.
5. `_scheduler.start()`.

스펙 → 트리거 변환은 `services/schedule_spec.py`(`validate_schedule_spec`·
`build_trigger_kwargs`·`describe_schedule`)가 담당한다. 스펙 타입은
`daily`/`weekly`/`monthly`/`interval` 넷.

### 3.3 잡 함수의 공통 형태

```python
def _fetch_X():
    from services.X import fetch_all_X          # 지연 import
    with job_runs.record("X_fetch", "auto"):    # 계측
        try:
            r = fetch_all_X()
            logger.info(f"[Scheduler] … : {r}")
        except Exception as e:
            logger.warning(f"[Scheduler] … failed: {e}")
```

⚠️ 이 형태는 **예외를 삼키고 정상 종료**하므로 `job_runs`가 스스로는 `failed`를 알 수 없다.
빈 결과 가드를 제대로 넣으면 `_fetch_and_save_*`는 **설계상 절대 raise하지 않으므로**, 그 둘을
그대로 붙이면 외부 소스가 며칠 죽어도 매 실행이 `success`로 기록된다(= 배치현황이 영원히 초록).
`services/job_runs.py`의 docstring이 아직 배선되지 않은 잡 목록을 명시적으로 나열해 둔다.

그것을 고친 통로가 `Run.set_status()`다 — `record()`가 yield하는 핸들로 본문이
`running|success|partial|skipped|failed`를 직접 말한다. 전파된 예외는 지정 상태를 이긴다.
**배선 원칙은 3항이다**: ⓐ `_fetch_and_save_*`가 실패 상태를 **반환값에 실어** 노출한다
(`_status`: `"partial"`/`"skipped"`) — 그 메타는 `_mc_save` **뒤에 새 dict로** 붙여야 한다
(`merged`를 mutate하면 저장 캐시가 오염된다) ⓑ **auto(`scheduler/jobs.py`)·manual(라우터) 두 레인
모두** `with job_runs.record(...) as run:`으로 받아 상태를 명시한다 ⓒ admin 응답도
`ok = (status == "success")`로 「갱신됨」과 「생략」을 구분한다.

`set_status` 배선 현황(`grep -rn 'set_status' backend --include='*.py'`):
`business_formation_fetch` · `labor_surveys_fetch` · `trimmed_inflation_fetch`(각각 auto+manual
**참조 구현 3쌍** — `market_indicators/{formation,labor,inflation}.py` + `scheduler/jobs.py` +
`routers/market_indicators.py`) · `guru_crawl` · `us_sector_fetch` · `monthly_us` · `fx_fetch` ·
`kospi_signal_fetch` · `earnings_kr/us` · `kr/us_rankings_fetch` · `recommendation_kr/us`.
**나머지 형제 잡은 미배선 부채다** — 새 배치를 만들 때 템플릿은 위 3쌍 중에서 고를 것
(미배선 형제를 베끼면 이 결함이 그대로 복제된다).

`job_runs.record`는 **관측 전용**이라 본문을 절대 깨뜨리지 않는다 — enter INSERT가 실패하면
`run_id=None` 센티넬로 본문을 그대로 실행하고, 종료 UPDATE 실패도 삼킨다. job_id별 최근 20건
(`KEEP`)만 보관하며 초과분은 insert 시 즉시 prune(별도 정리 크론 없음).

병렬 잡(`_investor_trend_work`·`_short_sell_work`)은 `ThreadPoolExecutor(max_workers ≤ 8)`로
제한한다 — 워커가 DB 풀(maxconn=20)을 점유하므로 초과 시 psycopg2가 블록이 아니라
`PoolError`를 던진다.

### 3.4 저장소 3종

| 저장소 | 위치 | 성격 |
|---|---|---|
| 관계 테이블 | PostgreSQL | 정본. 티커·사용자 종목·스냅샷·시계열·발행물 |
| `market_cache` (KV) | PostgreSQL 단일 테이블 | 시장지표 영구 캐시. `key`(text) → `data`(jsonb) + `fetched_at` |
| 인메모리 TTL | 프로세스 메모리 | 요청 경로 반복 계산 억제. 컨테이너 재기동에 소멸 |

`market_cache` 키(현재 **20개**): `fx` · `vix` · `commodities` · `treasury` · `econ_indicators` ·
`kr_exports` · `m7_earnings` · `kr_top2_earnings` · `macro_signals` · `business_formation` ·
`labor_surveys` · `trimmed_inflation` · `kospi_signal` · `kospi_futures` · `indices` ·
`fear_greed` · `kr_sector_momentum` · `us_sector_momentum` · `sp500_tickers` · `kospi_tickers`.
(키 목록·명명 규약의 정본은 `STRUCTURE.md` §7.)

`services/market_indicators/cache.py`가 그 접근 계층이다:
- `_mc_load(key)` → `{"data", "fetched_at"}` 또는 None (예외는 warning 후 None)
- `_mc_save(key, data)` → `INSERT … ON CONFLICT (key) DO UPDATE`
- `_get_cache`/`_set_cache` — 프로세스 로컬 만료 딕셔너리
- `get_or_refresh(key, fetch_fn, ttl, force=False)` — **캐시/저장값이 있으면 fetch를 스킵**할 뿐,
  fetch 실패 시 직전값으로 폴백하지 않는다. 그리고 `ttl`은 인메모리 수명만 지배한다 —
  `_mc_load`가 행을 주면 나이 불문 그대로 반환하므로, 실질 재조회자는 `force=True`를 주는
  배치뿐이다.
- `_merge_history(stored, new_pts)` — 날짜 키 병합. **`new_pts`가 비면 stored를 그대로 반환**한다
  (증분 fetch의 구조적 안전판).
- `_yf_close_history(sym, stored)` — 저장 마지막 날짜 다음날부터만 yfinance 조회(증분).
  366일 트림 + `_filter_outliers`(중앙값 대비 5배 밖 제거).

인메모리 캐시(`services/cache.py`)는 `TTLCache` 클래스 + 스냅샷 LRU(`OrderedDict`, `_MAX=50`):

| 캐시 | TTL | 키 |
|---|---|---|
| `_snapshots` | LRU 50 | `TICKER/date` |
| `_list_cache` | 60s | user_id |
| `_dashboard_cache` | 300s | user_id |
| `_correlation_cache` | 300s | user_id |
| `_sector_cache` | 300s | `user_id:market` |
| `_macro_cache` | 300s | user_id |
| `_quote_cache` | 60s | quote 키(`regular` 포함) |
| `_live_prices_cache` | 15s | user_id |
| `_rebalance_cache` | 300s | user_id |
| `_exposure_cache` | 300s | user_id |

무효화 진입점 둘: `invalidate(ticker)`(스냅샷 갱신용)과
`invalidate_portfolio_caches(user_id)`(종목 추가/수정/삭제/승격용 — DB `calendar_cache` 행 삭제까지 포함).

### 3.5 요청 경로가 라이브 fetch를 하는 예외

원칙은 "요청은 저장값만 읽는다"지만, **배치가 없는 지표**는 요청 경로에서 증분 fetch한다:
`fx` · `vix` · `commodities` · `treasury` · `indices` · `fear_greed` · `kospi_futures`.
공통 형태 = 인메모리 TTL → `_mc_load` → 라이브 fetch → `_mc_save` + 실패 시 직전값 폴백.

`services/market_indicators/fx.py`의 VIX 처리가 그 수동 폴백의 참조 구현이다
(`get_or_refresh`는 fetch 실패를 전파하므로 취약한 소스엔 쓰지 않는다).

반대쪽 순수형이 FRED 3종(`business_formation` · `labor_surveys` · `trimmed_inflation`)이다 —
`get_*()`가 `_mc_load` 한 번만 하고 **요청 경로에 외부 호출이 0**이며, 파생값(이동평균·전년비·
최신/직전 비교)도 저장 시계열에서 그 자리에서 계산한다. 새 지표를 만들 때 이쪽이 기본형이고
위 예외 목록은 「배치를 붙일 수 없었던 것」의 목록으로 읽어야 한다.

### 3.6 빈 결과 가드 — 이 저장소의 반복 주제

배치가 실패하고도 "성공"으로 보이면 직전 양호값을 파괴한다. 그래서 저장 지점마다 가드가 있고,
**가드의 위치**로 안전성이 갈린다.

- **구조적으로 안전한 형태(소스-폴백)** — 빈 결과가 필드에 도달하기 전에 이미 직전값으로 채워둔다.
  `fx._fetch_fx`(실패 시 `stored_history`를 담아 반환) · `cache._merge_history(prev, [])` →
  prev 반환 · `dividends`가 `replace_schedule` **진입 전에** fetch를 평가하는 것.
- **취약한 형태(끝 가드)** — 저장 직전 한 지점에서 판정. 그러면 실패 클래스 3종
  (예외 / 성공-but-빈응답 / 부분 페이로드)을 모두 물어야 한다.
- **파괴적 변형** — `DELETE + INSERT`(replace) 갱신은 빈 결과를 삼키면 저장 생략이 아니라
  **직전값 DELETE**가 된다. fetch 실패를 전파해 호출측이 replace 자체를 스킵해야 한다.
- **집합 성격별 처방** — 고정 명명 집합(M7 7종목 등)은 완전성 요구,
  유동 대규모 집합은 커버리지 임계(`earnings.py:_REST_MIN_COVERAGE = 0.5`),
  독립 항목(원자재 심볼·업종)은 실패분만 개별 백필.
  `storage/schedule.py::save_guru_managers`가 `{saved, fresh, stale, dropped, held}` 통계를
  반환해 호출측이 `partial`/`skipped`를 말할 수 있게 하는 것이 그 구현이다.
- **관측 가능성이 가드의 일부다** — 가드가 저장을 생략했다는 사실이 `job_runs`·admin 응답에
  드러나지 않으면 데이터는 지켰어도 아무도 그것을 모른다(§3.3의 `set_status` 3항).
  `market_indicators/{formation,labor,inflation}.py`가 그 참조 구현이다: `_SERIES` 맵 →
  `_fetch_series`(계열 단위 실패 허용) → `_fetch_and_save_*`가 `_status`를 실어 반환 →
  auto·manual 두 레인이 `run.set_status(...)`로 중계.

---

## 4. 리포트 파이프라인

### 4.1 스냅샷 생성 (`services/report_generator.py`)

`generate_report(stock)`이 종목 1개의 그날 스냅샷을 만들어 `snapshots` 테이블(+ `backend/snapshots/`
파일 폴백)에 박제한다. 구성:

- 시세·일봉·주봉·월봉 → `services/market` 통합 API
- 기술지표 → `services/indicators.py`(RSI 14봉·EMA·52주·HV·매물대), `_rsi_block`
- 재무 → `market.get_financials` / `get_annual_financials`
- 컨센서스 → `market.get_analyst_data` + `services/scraper.py`
- 경쟁사 상대가치 → `_comp_valuation`, `_infer_comp_market`
- 피어 멀티플 이상치 가드 → `_guard_peer_multiples` / `_self_multiple_outliers`
  (`_PEER_MULTIPLE_METRICS = ("per","pbr","psr","ev_ebitda")`, `_PEER_MULTIPLE_BAND = 5`, ADR-0030)

`generate_report_with_retry(stock, retries=1)`가 배치가 부르는 진입점.
`backfill_ticker(stock, days=60)`은 과거 날짜용(현재가 대조 불가라 박제-시 게이트 미적용).

KR은 **박제-시 독립피드 게이트**가 붙는다 — KRX 계열(키움 quote + 일봉)이 서로 합의해도
같은 피드라 교차검증이 안 되므로, 저장 직전 독립 ref(Naver retry-once → KIS 폴백)로
2배([0.5, 2.0]) 교차검증해 어긋나면 그 종목 박제를 **스킵**한다(직전 스냅샷 유지).
ref가 전무하면 역시 스킵 + loud 로그.

리포트 스냅샷 writer는 `regular=True`(KRX 정규장)로 opt-in한다. 대시보드·라이브는
기본 `regular=False`(키움 `_AL` = NXT 통합 SOR 코드). 같은 종목이 리포트와 대시보드에서
~1% 다른 현재가를 보이는 건 의도된 기준 차다(ADR-0020).

### 4.2 컨센서스 (`services/consensus_pipeline.py` + `services/consensus.py`)

`consensus_pipeline`이 원문을 모아 정규화·집계한다:
`_fetch_kr_raw`(Naver) / `_fetch_kr_fnguide` / `_fetch_us_raw`(yfinance upgrades_downgrades) →
`upsert_raw_reports` → `raw_reports` 테이블 → `_MART_SQL` → `daily_consensus_mart`.
opinion 문자열은 `_score`(5점 표준화)로 변환된다.
`run_daily(stocks)`가 `daily_report_kr/us` 배치에 내장돼 실행되고(별도 크론 없음),
`backfill(stocks, days=180, force)`가 수동 백필.

`services/consensus.py`가 **읽기 정본**이다 — `get_asof(ticker, date)` / `apply_asof(summary, …)` /
`get_asof_batch(pairs)`. 목표가·의견수는 스냅샷 JSON이 아니라 이 마트의 as-of 값으로 덮는다
(ADR-0008). 대시보드·목록·상세가 전부 같은 헬퍼를 쓴다.

`get_asof_batch`의 `_values_placeholder`는 VALUES 행 나열을 만드는데, 바깥 괄호로 감싸면
N행이 아니라 record 1행이 되는 함정이 있어 형태를 테스트가 못박는다.

### 4.3 AI 분석은 백엔드 밖

백엔드에 LLM 호출이 없다(`requirements.txt`에 anthropic 없음). 분석 텍스트는 외부 Cowork
클라이언트가 enrich API로 쓴다:
- `PUT /api/stocks/enrich/batch` — **반드시 `PUT /api/stocks/{ticker}/enrich`보다 먼저 등록**해야
  FastAPI가 `enrich`를 ticker 값으로 라우팅하지 않는다.
- `tickers.enriched_at`이 "AI 분석 존재"의 정본 — 스냅샷 `data` JSON에는 없다.
- 발행물은 별도 리소스: `analyst_reports`(ADR-0027) · `tech_reports`(ADR-0033/0034).

트리거는 이벤트 구동(ADR-0028): 일일 리포트 배치가 끝나면 `scheduler/jobs.py:_generate_all`이
`job_runs` 컨텍스트 **밖**에서 `cowork_trigger.fire(cowork_trigger.daily_text(market))`를 쏘고,
`scripts/cowork-fire-listener.py`(launchd, `127.0.0.1:8787`)가 받아 headless `claude -p`를 실행한다.
백엔드 컨테이너는 `host.docker.internal:8787`로 도달한다.

> ⚠️ `claude -p`는 **완료 시 1회 출력**하므로 진행 중 `run.log`는 원리적으로 비어 있다.
> 0바이트 로그를 실패로 읽고 재fire하면 같은 slug에 중복 발행을 쏜다. 판정은 3분할하라 —
> 생존은 프로세스(`ps`), 완료는 결과 상태(DB 행·`published_date`), 실패 원인은 로그(끝난 뒤에만).

### 4.4 발행물 리소스 — 스냅샷과 다른 저장 모델

스냅샷(§4.1)이 **배치가 날짜별로 박제**하는 것이라면, 발행물은 **외부 Cowork가 쓰기 API로 넣는**
별도 리소스다. 둘의 카디널리티 모델이 다르다.

| | `snapshots` | `analyst_reports` (ADR-0027) | `tech_reports` (ADR-0033/0038) |
|---|---|---|---|
| 키 | `(ticker, date)` | `(ticker, published_date)` | **`slug` 단독 — UNIQUE** |
| 이력 | 날짜별 누적 | 판별 누적 | **없음. 재발행이 그 행을 덮는다** |
| 생산자 | 일일 배치 | Cowork `POST` | Cowork `POST /{slug}` |

`tech_reports`가 이력을 버린 것이 그 뒤 설계를 지배한다(ADR-0038). 이력이 없으므로
`latest_all()`에 `DISTINCT ON`이 불필요하고, 대신 **부분 발행이 직전 판을 지우는 위험**이 생겨
`services/tech_reports.py`에 보존 계약이 붙는다:

- `_PRESERVABLE`(`key_points` · `milestones` · `variants` · `watch_items` · `composition`) —
  **키를 생략하면 보존, 명시적 `null`이면 삭제.** `_upsert_sql(omitted)`가 생략된 보존 대상만
  `DO UPDATE SET`에서 빼는 방식이라, 파라미터는 바인딩되지만 쓰이지 않는다.
- 본문 4필드(`description`·`players`·`challenges`·`related`)는 **일부러 보존 대상이 아니다** —
  그쪽 생략은 부분 갱신이 아니라 잘못된 발행이므로 숨기지 않고 드러낸다.
- `INSERT` 컬럼 목록은 full 유지(신규 slug엔 보존할 직전 판이 없다).
- 컬럼명은 `_UPDATE_COLUMNS`/`_PRESERVABLE` **allowlist에서만** 오고 요청 값이 컬럼명 자리에
  닿는 경로가 없다. `omitted`에 문자열 1개를 넘기면 문자 순회로 skip이 비어 **보존이 조용히
  전량 덮어쓰기로 강하**하므로 `TypeError`로 막는다.
- JSONB nullable 필드는 `_json_or_null`을 반드시 통과한다 — `json.dumps(None)`은 문자열
  `"null"`이라 jsonb 캐스트에서 SQL NULL이 아니라 **JSON null 스칼라**가 되고, 그러면 같은
  컬럼에 두 종류의 NULL 표현이 공존해 `IS NULL` 질의와 문서 서술이 어긋난다.

읽기 표면은 셋이다 — `GET ""`(목록) · `GET /index`(경량 인덱스, 포트폴리오 기술 노출·종목 상세
칩이 소비) · `GET /{slug}`(본문). `/index`는 고정 경로라 `/{slug}`보다 **먼저** 등록된다.

---

## 5. 외부 소스와 폴백 체인

| 도메인 | 체인 | 구현 |
|---|---|---|
| KR 현재가 | 키움 → KIS → Naver | `services/market/kr.py:get_quote_kr` |
| US 현재가 | yfinance → KIS | `services/market/__init__.py:_get_quote_uncached` + `us.py:_us_quote_kis` |
| KR 일봉 | 키움 ka10081 | `services/kiwoom/chart.py` |
| KR 재무 | Naver + DART | `kr.py:get_financials_kr` / `get_annual_financials_kr` |
| US 재무 | yfinance `get_*` **메서드** | `us.py:get_annual_financials_us` |
| KR 공시·주총·내부자·수주잔고·배당 | DART | `disclosures.py`·`agm.py`·`insider_trades.py`·`backlog.py`·`dividends.py` |
| 경제·매크로 | FRED | `market_indicators/econ.py`·`macro.py` |
| 신용/대차 | KOFIA·금융위 | `leverage_service.py`·`lending_service.py` |
| KR 수출 | 관세청 → UN Comtrade | `market_indicators/exports.py` |
| 구루 | dataroma | `guru_scraper.py` |
| CAPE | multpl.com 크롤 | `market_indicators/indices.py` |
| F&G | CNN | `market_indicators/sentiment.py` |

**KR 현재가 다수결**(`kr.py`) — 라이브(`regular=False`)는 독립 피드 2-of-N 합의를 요구한다:
`_kr_pick_basic` → `_corroborated_pick`(±2배 이내 합의) → 우선순위 최상위 반환.
평소엔 키움 NXT + 키움 KRX 2콜로 끝나고(lazy), **불일치할 때만** KIS·Naver를 추가 호출해
outlier를 폐기한다. 전 피드 합의 불가/단일 피드만 있으면 `_kr_pick_degenerate_lazy`가
prev_close ±30%로 자가검증한다. 스냅샷 경로(`regular=True`)는 `_kr_pick_regular`로 별도.

**단위 정규화 함정** — 키움은 부호포함 문자열·시총 억원 단위를 준다(`_num`·`_to_won`).
yfinance 퍼센트 필드는 0~1 **소수분수**다. DART `fnlttSinglAcntAll`은 `fs_div`가 요청 필수값이고
응답 행에 echo하지 않는다. 정규화는 전부 `services/market/format.py`(`_n`·`_to_won`·`_safe_ratio`·
`_safe_pct`·`_yf_val`·`_yf_sym`·`_fmt_price`·`_fmt_market_cap`)와 각 어댑터의 `_num`에 모여 있다.

---

## 6. 프론트엔드

### 6.1 부팅 순서

```
index.html
  ├─ <style> html{background:#f6f1e7} …          ← 인라인 배경(폰트 <link>보다 앞)
  ├─ <script> theme-boot                          ← localStorage.theme==='dark' → data-theme
  ├─ <style> .oauth-splash …                      ← 번들 CSS 전에 떠야 함
  ├─ #root > #oauth-splash[hidden]                ← 정적 스플래시 마크업
  └─ <script> /[?&](oauth|error)=/ → splash.hidden=false
        ▼
main.jsx  purgeApiCache()                       ← caches.delete('api-cache') (ADR-0036), await 없음
          createRoot(#root).render(<StrictMode><App/></StrictMode>)   ← #root의 정적 자식을 지운다
        ▼
App.jsx
  ├─ useTheme()
  ├─ useAuthBootstrap()            → { session, setSession, authLoading }
  ├─ isOAuthLanding (마운트 시 1회 고정)
  ├─ useBfcacheAuthGuard(!!session, setSession)
  ├─ ?diag=1        → <DiagLog/>                    (인증 분기보다 앞)
  ├─ authLoading    → isOAuthLanding ? SPLASH_HTML : null
  ├─ !session       → <LoginPage/>
  └─ ToastProvider > AuthProvider > BrowserRouter > AppShell
```

**정적 스플래시 ↔ React 인계**가 이 부팅의 취약점이다. `createRoot().render()`가 첫 커밋에서
`#root`의 기존 자식을 지우므로, 그 순간 `authLoading`이 아직 true면 `App`이 null을 반환해
덮개가 걷힌 자리에 blank가 생긴다. 그래서 `SPLASH_HTML`을 React 쪽에서 다시 그린다.

**보안·정합상 쌍둥이 코드가 둘** 있고 둘 다 "바이트 동일"이 계약이다(테스트가 지킨다):
`frontend/src/themeBoot.js:THEME_BOOT_JS` ↔ `index.html`의 `theme-boot:start~end`,
`frontend/src/oauthSplash.js:SPLASH_HTML` ↔ `index.html`의 `oauth-splash:start~end`.

### 6.2 인증 부트스트랩 (`hooks/useAuthBootstrap.js`)

URL 쿼리 3분기 — `error=` / `oauth=`(코드 교환 fetch) / 없음(stored).
**세 분기 모두 `resolveStored()`를 부른다**: "OAuth가 실패했다"는 "세션이 없다"를 뜻하지 않는다
(뒤로가기로 콜백 엔트리가 재실행되면 1회용 코드가 400을 내는 게 지배적 상황).
성공/실패 모두 `returnFromOAuth()`(`utils/oauthHistory.js`)로 IdP 히스토리 엔트리를 대칭으로 되감는다.
네 번째 분기였던 `token`+`refresh`(URL 쿼리 토큰을 그대로 `localStorage`에 심던 것)는 **task#290에서 삭제**됐다 —
백엔드에 생산자가 없는데 세션 고정 취약점만 만들던 레거시다(B47이 아니라 B44).

`bootTimings()`가 Navigation Timing에서 `0→req→resp→di→js` 구간을 뽑아 `logDiag('doc', …)`로
남긴다(`utils/diag.js` — localStorage 링버퍼 50건). `?diag=1`로 `components/DiagLog.jsx`가 읽는다.
계측은 전부 try로 감싸 앱을 죽이지 않는다.

### 6.3 라우팅과 IA 단일 소스

`frontend/src/navSections.js`의 `NAV_SECTIONS`가 nav IA 5섹션의 **단일 소스**다
(`research` · `portfolio` · `market` · `schedule` · `guru`). 각 섹션은
`{key, label, perm, items:[{to, label, evt?, match?}]}` 형태이고,
매칭 헬퍼 `matchesItem`/`matchesSection`(판정 = `pathname.startsWith(item.match ?? item.to)`) ·
`sectionByKey`를 함께 export한다.

세 소비처가 여기서 **파생**한다 — `components/Masthead.jsx`(PC 카테고리 + 서브바) ·
`components/MobileNav.jsx`(모바일 하단 탭바) · `pages/ResearchShell.jsx`(모바일 seg).
아이콘은 소비처마다 셋이 달라(`sketches` vs `ui/icons`) 각자 `ICONS[section.key]`로 매핑하므로,
공유 모듈에는 **순수 경로·라벨 데이터만** 둔다. 권한 필터는 세 곳 모두 `section.perm`을 쓴다.

라우트 정의는 `App.jsx`의 `<Routes>`에 있고, 구 URL → 신규 매핑은 `frontend/src/routes.js`의
`REDIRECTS`가 별도 export한다(테스트가 공유).

⚠️ `routes.js`(파일)와 `routes/`(디렉터리)는 **다른 것**이다. 후자는 **라우트 단위 권한 게이트**를
담는 자리로, 현재 `routes/AnalystReportsRoute.jsx` 하나다 — `/analyst-reports`가 사용자 대면
목록에서 **admin 발행 관리 화면**으로 성격이 바뀌었으므로(ADR-0047) 비-admin은 `/reports`로
`Navigate replace`한다. 두 성질이 계약이다: ⓐ `loading`이면 `null`을 반환한다(권한 확정 전에
리다이렉트하면 admin도 튕긴다) ⓑ `App.jsx`가 아니라 독립 파일인 이유는 이 게이트를 단독
마운트해 「admin은 튕기지 않는다」 대조군을 재기 위해서다(`App`은 로그인 시 셸 전체를 렌더한다).

기술 리포트 계열 라우트가 셋으로 늘었다 — `/tech-reports`(목록) · `/tech-report/:slug`(본문) ·
`/tech-anatomy/:slug`(기술 해부 3축, ADR-0042). 셋 다 `ResearchShell` 안이다.

셸 구조:
```
.app-pc
 ├─ <Masthead/>                         (PC 전용 표시)
 └─ .app-main
     ├─ header.mobile-header            (브랜드 + GlobalSearch + MobileTopActions + 테마/로그아웃)
     ├─ main.page-wrap
     │    └─ div[key=pathname].anim-fade    ← 라우트 전환 페이드(transform 없는 opacity만)
     │         ├─ <InstallPrompt/>
     │         └─ <Routes/>
     └─ <MobileNav/>
```

`ResearchShell`은 리서치·일정·인컴 두 섹션의 얇은 래퍼다 — 모바일은 appbar + seg 필,
PC는 마스트헤드가 nav를 담당하므로 `children`만 렌더한다(ADR-0026).

허브형 페이지는 라우트가 아니라 **탭 컴포넌트를 import**한다:
- `pages/Portfolio.jsx` ← `SectorTab` · `MacroTab` · `Analytics` · `RebalanceTab` · `ExposureTab`
- `pages/MarketHub.jsx` ← `Market`
- `pages/Guru.jsx` ← `GuruManagers` · `GuruStats` · `GuruAllocation`
- `pages/Settings.jsx` ← `BatchScheduleEditor` · `ReportManualGen` · `GuruCrawlNow` ·
  `ConsensusSettings` · `LeverageBackfillSettings` · `PermissionManager` · `DiagLog`

### 6.4 데이터 접근과 상태

`frontend/src/api.js` — axios 인스턴스 하나. request 인터셉터가 `localStorage.access_token`을
Bearer로 붙이고, response 인터셉터가 **401이면 토큰 2개를 지우고 `window.location.replace('/')`**
(replace라 만료 시점 딥링크 엔트리를 남기지 않는다).

상태는 컨텍스트 2개 + 훅으로 관리한다(전역 스토어 없음):
- `contexts/AuthContext.jsx` — `/api/auth/me`로 `role`·`menu_permissions` 로드, 실패 시
  `role='user'` + 빈 권한으로 graceful degrade.
- `components/Toast.jsx` — `ToastProvider`.
- 데이터 훅: `usePortfolioData`(목록 + `/portfolio/prices` 폴링 + 대시보드) ·
  `useTrackedStocks` · `useReportList` · `useReportFilters` · `useReportGeneration` ·
  `useStockManagement` · `useTechIndex`.
- 환경 훅: `useAuth` · `useTheme` · `useIsMobile` · `useBodyScrollLock` · `useReveal` ·
  `useCountUp` · `usePriceFlash` · `useSwUpdateReload` · `useBfcacheAuthGuard` ·
  `useAuthBootstrap` · `useActiveChapter`.

`useTechIndex`(`GET /api/tech-reports/index`, ADR-0043)가 이 저장소의 **실패-vs-빈결과 3상태**
참조 구현이다. 소비처가 둘(포트폴리오 「기술 노출」 카드 · 종목 상세 헤더 기술 칩)이고 둘 다 같은
경량 목록만 필요하므로 **모듈 레벨 캐시로 한 번만 받아 공유**하고 in-flight promise를 합친다.
⚠️ 조회 실패를 `[]`로 붕괴시키지 않는다 — 빈 배열의 의미가 셋(**아직 안 옴 / 받았는데 0건 /
조회 실패**)이라 `ready`·`failed`를 함께 준다. 셋을 합치면 실패가 「기술 노출이 없습니다」라는
**거짓 진술**로 렌더된다(`wrong < missing` 위반). 실패는 캐시하지 않아 다음 마운트가 재시도한다.
소비처의 계약은 「`failed`면 카드를 아예 그리지 않는다」다.

`useActiveChapter`는 장(chapter) scroll-spy다. `useReveal`을 재사용할 수 없다(그것은 첫 교차에서
`disconnect`하는 1회성 훅이다). 판정을 「지금 교차 중인 섹션」이 아니라 **「상단 경계를 마지막으로
지난 섹션」**으로 두어 짧은 마지막 장이 하이라이트를 못 받는 고전적 결함을 피하고, IO는 「다시
계산할 때」 트리거로만 쓰고 판정은 매번 **전 섹션 좌표를 한 번에** 읽어 한 섹션의 진동이 활성값을
바꾸지 않게 한다(잔여 떨림은 히스테리시스가 흡수).

레이스 가드 규약(관용구 정본은 `CONVENTIONS.md` §9.4) — 같은 상태를 쓰는 비동기 호출이 2개 이상
겹칠 수 있으면 낡은 응답의 착지를 막는다. 형태가 **둘**이고 고르는 기준이 있다:

- **세대번호(`genRef`)** — 같은 마운트 안에서 필터·탭·페이지가 목록을 갈아끼울 때.
  `pages/Ranking.jsx::fetchPage`(reset이 세대를 올린다) · `pages/ExposureTab.jsx`(마운트 자동 조회
  ↔ `saveCandidate` 후 재조회) · `hooks/useTrackedStocks.js` · `components/reports/ConsensusChart.jsx`.
- **`cancelled` 플래그 + cleanup** — 이펙트 의존성(주로 `ticker`·비교 날짜)이 바뀔 때.
  `HistoryTab.jsx` · `DetailTab.jsx::BacklogSection` + 형제 섹션 8종(UsInsider · InsiderTrades ·
  UsSupply · LatestDisclosures · ShortSell · Supply · InvestorTrend · GuruHolders).

세 가지 함정: ⓐ **뮤텍스(`if (loadingRef.current) return`)는 레이스 가드가 아니다** — 리셋 호출을
no-op시켜 오히려 옛 응답이 화면을 소유하게 만든다 ⓑ `.then`뿐 아니라 **`.finally`도 게이트**해야
한다(낡은 응답이 로딩 플래그를 열면 다음 트리거와 겹친다) ⓒ 취소 플래그는 「늦은 착지」만 막고
**「보존」은 막지 않는다** — 옛 값이 *이미* 착지한 뒤 prop만 갈리면 경합 없이 결정적으로 옛 데이터가
새 화면에 남으므로, 조회 시작 전에 `null`(미조회)로 되돌려야 한다(`[]`는 「0건」이라는 사실 주장이라
쓰지 않는다 — §6.4의 3상태 규율).

⚠️ 가드를 한 함수에 넣을 때는 **같은 훅·모듈의 형제 비동기 진입점을 전수 세라** — 같은 결함이
이웃에 그대로 남는다. 그리고 부모의 `key={ticker}` 재마운트가 지금 덮고 있는 경로도 있는데,
그 `key`는 스테일 전략으로 선언된 적이 없어 탭 상태 보존 리팩터 한 번에 사라진다.

### 6.5 스타일 시스템

TailwindCSS 없음. 순수 CSS를 계층으로 쌓는다:

```
index.css
 ├─ @import styles/tokens.css     ← 디자인 토큰(:root + [data-theme=dark]), 에디토리얼 아이덴티티
 ├─ @import styles/pc.css
 ├─ @import styles/mobile.css
 └─ @import styles/guru.css
styles/motion.css                 ← main.jsx가 직접 import
컴포넌트별 CSS                     ← ui/{Badge,Button,Card,Input,Skeleton,Stat}.css,
                                     Masthead.css, Glossary.css, InstallPrompt.css,
                                     portfolio/*, tech/*, reports/ReportDetail.css, pages/*.css
```

색 관례 — 가격 방향은 `.badge--up`(상승=버밀리온) / `.badge--down`(하락=프러시안) **전용 변형**
(`ChangeBadge`가 사용), 의미 상태는 `.badge--success`/`--danger`/`--warning`이 통념대로 동작한다.
두 축을 교차 사용하지 않는다.

차트는 recharts 3. dual Y-axis 패턴(`yAxisId="left"` 금액 / `"right"` 비중 %)과
`marketUtils.jsx:krFmt`(입력은 '억원' 단위 가정) 헬퍼를 시장 섹션들이 공유한다.

### 6.6 PWA / Service Worker

`vite-plugin-pwa`(`registerType: 'autoUpdate'`, `skipWaiting`, `clientsClaim`).
런타임 캐싱은 **2종뿐이다** — 구글 폰트 CacheFirst(`google-fonts`) · jsdelivr CacheFirst(`cdn-fonts`).
`cacheId`에 빌드 타임스탬프가 들어간다.

**`/api/*` 런타임 캐시는 제거됐다(ADR-0036).** 이유는 성능이 아니라 사용자 경계다 — Workbox는
**URL만으로 캐시 키를 잡고** `api.js`가 붙이는 `Authorization` 헤더는 키에 들어가지 않으며 `Vary`
처리도 없다. 즉 같은 URL이면 어느 사용자의 응답이든 같은 한 항목이라, A 로그아웃 → 같은 브라우저
B 로그인 창에서 **신원은 B인데 데이터는 A**가 서빙될 수 있었다(`/api/auth/*`만 제외돼 있었던 것이
최악의 조합을 만들었다). 부수로 무표시 stale 시세도 만들었다(폴백이 최대 5분 된 가격을 주는데
`PriceFreshness`가 읽는 `lastUpdated`는 **클라이언트 수신 시각**이라 "방금"으로 표시된다).

규칙 제거만으로는 이미 기기에 저장된 저장소가 남는다(`cleanupOutdatedCaches`는 precache만 다룬다).
그래서 `src/apiCachePurge.js::purgeApiCache`가 `caches.delete('api-cache')`를 **한 키만** 지우고,
호출 지점이 **둘**이다 — `main.jsx`(부팅 1회) + `App.jsx::doLogout`. 후자가 필요한 이유는
`doLogout`이 **SPA 전용**(리로드 없음)이라 「A 로그아웃 → 같은 문서에서 B 로그인」이 부팅을
재실행하지 않기 때문이다. 새 SW가 활성화된 뒤에는 채우는 자가 없어 no-op이고, **옛 SW가 살아 있는
전환 창 한정 보험**이다. `caches` 부재(jsdom)·`delete` 거절 모두 던지지 않되 `console.warn`으로
관측 가능하게 남긴다.

커스텀 vite 플러그인 `sw-cache-bust`가 `closeBundle`에서 `index.html`의 `registerSW.js`·
`manifest.webmanifest`와 `registerSW.js`의 `sw.js`에 `?<BUILD_DATE>`를 붙인다.
`configResolved`에서 실제 `outDir`을 잡으므로 `--outDir` throwaway 빌드가 라이브 `dist`를 오염시키지 않는다.

nginx가 `index.html`·`sw.js`·`workbox-*.js`는 no-store, 해시 붙은 정적자산은 1년 immutable로 준다.

> SW는 여전히 등록되고 fetch 핸들러가 모든 요청을 통과시키므로, Playwright `page.route` 응답 주입
> 기반 UAT는 계속 컨텍스트를 `serviceWorkers: 'block'`으로 만들어야 한다(`/api/*` **캐싱**이
> 사라진 것과 SW가 요청 경로에 **있는** 것은 별개다 — 현재 프로브 51개가 이 옵션을 쓴다).

번들 분할은 `vite.config.js`의 `manualChunks(id)` — Vite 8(rolldown)은 **함수 형식만** 받는다.
`recharts`/`d3-*`/`victory-vendor` → `charts`, 나머지 node_modules → `vendor`.

---

## 7. 횡단 관심사

### 7.1 직렬화 안전 (NaN/inf)

starlette `JSONResponse`는 `allow_nan=False`라 응답 dict의 NaN/inf가 **500**이 된다.
방어가 3층으로 깔려 있다:

1. **소스 가드** — `math.isfinite` 체크(`routers/stocks.py:_usdkrw_rate`,
   `services/rebalance.py:_finite_float`, `services/us_supply.py:_finite`).
2. **출력 sanitize** — `services/utils.py:sanitize`가 응답 dict의 비유한값을 None으로.
   `_build_all`(대시보드) 등 시세·합산을 싣는 엔드포인트가 감싼다.
3. **입력 가드** — pydantic float 필드에 `Field(allow_inf_nan=False)`
   (`routers/portfolio.py:set_rebalance_targets`가 예) + `main.py`의 전역
   `RequestValidationError` 핸들러(422 detail도 sanitize).

선택 필드는 `Optional[X] = Field(None, …)`로 쓴다 — `x: float = Field(None)`이면
키 생략은 통과하고 **명시적 `null`만 422**가 되는 비대칭이 생긴다.
로컬 `.venv`가 Python 3.9라 런타임 평가 어노테이션에 PEP604 `X | None`을 쓸 수 없다.

### 7.2 로깅

모듈 `logger`로 통일(`print` 신규 금지 — `tests/test_no_print.py`가 단언).
포맷 `logger.x(f"[Component] <무엇> (<ids>): {e}")`. formatter 프리픽스가 없으므로
메시지 안의 `[Component]` 마커가 유일한 grep 앵커다.
레벨 — warning=graceful 담화 / error=예상 밖·데이터 손실 / info=배치·라이프사이클.
프론트는 `console.warn`(graceful) / `console.error`(예상 밖), 마커는 소스 모듈·훅 실명
(`[usePortfolioData]` 등). 자동 가드는 없다.

### 7.3 시간대

컨테이너에 TZ env가 없어 `date.today()` = UTC다. 시장-날짜 판정은 반드시
`services/utils.py:today_kst()` 또는 `ZoneInfo("Asia/Seoul")`를 쓴다
(`tests/test_no_bare_today.py`가 bare `date.today()` 사용을 막는다).
키움 일봉 인덱스는 tz-naive, yfinance는 tz-aware라 `pd.concat`로 정렬하려면
한쪽을 `tz_localize(None)`해야 한다.

### 7.4 에러 표면

`services/errors.py`가 `not_found(ticker, context)` / `already_exists(…)` 두 헬퍼로
HTTPException 문구를 통일한다. 그 밖의 라우터는 대체로 `try/except → HTTPException(500, str(e))`.

그 그물을 빠져나간 것은 `main.py::_unhandled_exception_handler`가 받는다(§2.1의 7번) — 핸들러가
없으면 starlette 기본 경로가 `text/plain` raw 500을 내고, 디버그 설정·프레임워크 버전에 따라 내부
메시지나 스택 흔적이 응답으로 샐 수 있다(그리고 JSON을 기대하는 클라이언트가 파싱에 실패한다).
즉 라우터별 `except`는 **문구 통일**용이고 전역 핸들러는 **누출 차단**용이라 층이 다르다.

대시보드(`routers/stocks.py:get_dashboard`)는 **"holdings=N → 항상 N카드"**를 불변식으로 삼는다 —
일괄시세 실패는 `{}`로, per-card enrichment throw는 `_minimal_card` 폴백으로 흡수해
전체 500을 내지 않는다. 대신 per-card 예외가 마스킹되므로 진단은 `'최소카드 폴백'` 로그가 유일한 단서다.

### 7.5 장시간 작업의 진행상태 — 사용자별 격리

`services/progress.py`가 두 계층이다.

`ProgressTracker`는 `{running, done, total, current, failed}` + 인스턴스별 `extra` 필드를 갖고,
`try_start()`가 이중 실행을 거부하며 **무활동 상한(15분)을 넘긴 `running=True`를 고착으로 보고
회수**한다. 그 회수 경로가 필요한 이유가 구조적이다 — starlette는 응답 body를 flush한 **뒤**
`await self.background()`를 호출하므로, flush 중 클라이언트가 끊기면 백그라운드 태스크가 시작조차
못 하고 아무도 `finish()`를 부르지 않는다(= 그 사용자가 프로세스 재시작 전까지 영구 409).
판정 기준은 경과시간이 아니라 **무활동 시간**이라(`set`/`increment`가 활동을 갱신) 오래 걸리는
정상 생성은 회수되지 않는다.

`ProgressRegistry`는 그 트래커를 **키(=사용자)별로** 보관한다. 전역 싱글턴 하나면 두 사용자의
작업이 서로의 진행상태를 덮어 진행률이 남의 종목을 가리키고 겹친 두 실행의 `increment`가 합산돼
`done > total`이 된다. 메모리 상한 `_MAX = 64`이고 초과 시 **유휴 트래커만** 오래된 것부터
축출한다(진행 중 트래커를 버리면 그 사용자의 진행률이 0으로 되돌아가 프론트 폴링이 완료를 영원히
못 본다 — 전부 진행 중이면 상한을 잠시 넘기는 편을 택한다). 고착 트래커는 유휴로 취급해
슬롯을 영구 잠식하지 못하게 한다. `peek(key)`는 **등록 없이** 상태만 읽고 없으면 초기 상태를
반환하므로(응답 shape 동일) 폴링만 하는 호출자가 트래커를 만들지 않는다.

현재 사용처 — `routers/report.py`가 사용자별 레지스트리 1개(리포트 생성) + 전역 트래커 3개
(백필·컨센서스 등), `routers/guru.py`가 전역 트래커 1개(`extra`로 `result`를 얹음). 즉
**사용자 스코프 작업만 레지스트리를 쓰고 관리자 전역 배치는 단일 트래커로 남긴다.**

---

## 8. 테스트·검증 아키텍처

세 층이 서로 다른 것을 본다. **어느 층도 다른 층이 보는 것을 못 본다**는 게 설계 전제다.

| 층 | 도구 | 위치 | 보는 것 / 원리적 사각 |
|---|---|---|---|
| 백엔드 단위·통합 | pytest | `backend/tests/` — `test_*.py` **172** | 로직·SQL 형태·응답 shape / 라이브 스키마·외부 실데이터 |
| 프론트 단위 | vitest + jsdom | `frontend/src/**/*.test.{js,jsx}` — **83** | 마크업·분기·유틸 / 레이아웃 수치·색 적용·recharts 렌더 |
| 라이브 UAT | Playwright + CDP | `scripts/uat*.mjs` **124** + `probe*` 13 · `smoke*` 3 · `loopcheck*` 3 | 실제 배포 화면의 기하·색·성능 / 로컬에서만 도는 것 |

**pytest 규약**
- `tests/conftest.py`가 `app.dependency_overrides[get_current_user]`를 전역 세팅하고,
  autouse fixture 둘을 건다 — `_clear_quote_cache`(테스트 간 quote TTL 오염 차단)와
  **`_block_real_db`**(`services.db._get_pool`을 raise로 교체). 로컬 `DATABASE_URL`이
  라이브 도커 postgres를 가리키므로, 이 가드 없이는 테스트가 prod 데이터를 덮는다.
- 다수 테스트가 conftest의 `client` 대신 **모듈 상단에서 `FastAPI()`를 직접 만들어**
  `app.dependency_overrides`로 auth를 우회한다(`test_stocks_router.py` 등). conftest는
  `main.app`의 `get_current_user`만 override하므로 그 앱들엔 안 걸린다.
- 계약 테스트: `test_api_doc_sync.py`(라이브 `app.routes` ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md`의
  `### \`METHOD /path\`` 헤더 대조, `KNOWN_UNDOCUMENTED` 베이스라인) · `test_no_print.py` ·
  `test_no_bare_today.py` · `test_no_public_reads.py` · `test_security_auth_gaps.py`
  (override 없는 fresh app으로 401/403 확인) · `test_batches_router.py`/`test_scheduler_seed.py` 등의
  배치 id exact-set 단언.
- `tests/_routes.py`가 라우트 열거 헬퍼. ⚠️ 배포 이미지의 FastAPI 0.138은 `include_router` 결과를
  `_IncludedRouter`로 감싸 `original_router`만 노출하므로, 라우트 트리를 도는 코드는
  `routes`와 `original_router` **양쪽을 재귀 하강**해야 한다(로컬 138개 / 컨테이너 0개로 갈린다).

**vitest 규약** — `vite.config.js`의 `test` 블록(`environment: 'jsdom'`, `globals: true`,
`setupFiles: './src/test/setup.js'` → `@testing-library/jest-dom`).
테스트는 `App`을 import하지 않는 관례다(로그인 시 셸 전체를 렌더하므로 모킹 비용이 크다) —
그래서 인증 분기를 `useAuthBootstrap` 훅으로 뺐다. jsdom엔 레이아웃이 없어 recharts는
렌더되지 않고 `getComputedTextLength`도 없다(추정 폴백을 반드시 남긴다).

**라이브 프로브** — `scripts/`에 `uat*.mjs` 124개. `scripts/package.json`의 유일한 의존성이
playwright다. 프로브 자체의 신뢰성 규약(커버리지 카운터, 축별 `*-domain` sentinel,
조건부 단언 금지, 판정 범위 한정, 대조군, 대상 identity 단언)이 이 저장소의 축적된 규율이며,
**정본은 `.claude/skills/live-uat-probes/` 스킬**로 분리됐다(`CLAUDE.md`에는 핵심 2줄만 남았다).
그 스킬은 호출식이라 세션 시작 시 자동 로드되지 않는다 — 프로브를 저작·수정하거나 시각을 바꾸는
변경을 검증할 때 **명시적으로 호출**해야 한다. 병렬 실행 오염 사례사는 형제 스킬
`.claude/skills/subagent-orchestration/`에 있다.

fg-loop 계열 스크립트 3종(`loopcheck-*.mjs`)이 정지조건 체크용으로 따로 있고,
`check-uat311-ratchet.sh` + `uat311-baseline-tags.txt`가 **래칫**(단언 총계·PASS 수가 baseline
이하로 내려가지 않음)을 재는 자리다 — 「exit 0」만 보면 축이 조용히 사라지는 커버리지 붕괴를
못 잡기 때문에 도입된 층이다.

---

## 9. 배포 파이프라인

```
git push origin main
   ├─▶ (주) GitHub Actions self-hosted 러너
   │     .github/workflows/deploy.yml → fetch + reset --hard origin/main + bash deploy.sh
   │     러너 디렉터리: ~/actions-runner-portfolion (레포 전용)
   └─▶ (폴백) launchd com.portfolion.auto-deploy-poll, 2분 주기
         scripts/auto-deploy-poll.sh → LOCAL != origin/main 이면(양방향)
                                        reset --hard origin/main + deploy.sh
```

두 경로 모두 `/tmp/portfolion-deploy.lock` 파일락으로 동시 배포를 막는다.

`deploy.sh` 4단계: ① `frontend` npm install + build → `frontend/dist`
② `docker build -t portfolion-backend ./backend` ③ backend 컨테이너 stop/rm/run
(`--env-file ./backend/.env.docker`, `--network portfolion_default --network-alias backend`)
④ nginx 컨테이너 stop/rm/run(`nginx.conf` + `frontend/dist` 마운트) → `curl /health`.

> backend·nginx는 `docker run`으로 교체되므로 `docker compose ps`에 안 잡힌다(`docker ps`로 봐야 한다).

**폴러의 부작용** — `reset --hard`는 커밋 안 한 tracked 편집뿐 아니라 push 안 한 로컬 커밋도
되돌린다. `.forge/` 등 untracked는 안전하다.

**배포 후 창** — 컨테이너가 `Up`이고 로그도 활발한데 포트 8000이 수 분간 열리지 않을 수 있다
(기동 배치와 겹치는 경우 실측 ~5분). 라이브 스모크는 포트 바인딩을 폴링한 뒤 실행한다:
`docker exec <c> python -c "import socket;print(socket.socket().connect_ex(('127.0.0.1',8000)))"`.

---

## 10. 확장 지점 — 무엇을 건드리면 무엇이 따라오는가

**새 배치 추가** (참조 구현: `market_indicators/{formation,labor,inflation}.py` 3쌍)
1. `services/`에 fetch/저장 함수 (빈 결과 가드는 소스-폴백 형태로, 실패 상태는 `_status`로 반환)
2. `services/batch_registry.py::BATCHES`에 항목(`id`·`market`·`source`·`usage`·`default_schedule`)
3. `scheduler/jobs.py`에 잡 함수 + `_JOB_FUNCS` 등록 + `scheduler/__init__.py` re-export 목록
4. 수동 트리거가 필요하면 라우터에 `manual_endpoint` + 같은 id로 `job_runs.record(id, "manual")`
   — **auto·manual 두 레인 모두** `as run:`으로 받아 `run.set_status(...)`를 명시할 것(§3.3)
5. 배치 id count/set을 하드코딩하는 테스트가 **4파일 안 8지점**이다
   (`test_scheduler_seed`·`test_batch_market_split`·`test_batches_router`·`test_macro_signals_batch`).
   ⚠️ grep으로 다 찾지 못한다 — `set(...) ==` 형태 2곳과 `test_batch_market_split`의
   `_MARKET_BY_ID` 매핑 dict·시장별 개수 dict가 리터럴 패턴에 걸리지 않는다.
   **그 4파일은 열어서 직접 읽고, 게이트는 전체 스위트로 삼는다.**

**새 엔드포인트 추가**
1. 라우터 함수 + 인증 `Depends`
2. `API_SPEC.md` 갱신(없으면 `test_api_doc_sync.py` 실패). Cowork 소비 대상일 때만
   `CLAUDE_COWORK_API.md`도
3. 기능 표면이 바뀌면 `README.md` 해당 절
4. auth 의존성을 추가·변경했다면 **전체 스위트를 먼저 돌리고 실제로 깨지는 자체-app 테스트만** 수정

**새 DB 컬럼**
`app_schema.sql`(신규 설치) + `main.py::_migrate`의 `ADD COLUMN IF NOT EXISTS`(라이브) **쌍**.

**주요기술 발행물에 새 구조 필드**
1. `routers/tech_reports.py`에 pydantic 모델 + `TechReportIn` 필드. **가장 닮은 형제의
   `model_validator`를 전부 열거해** 각각 "이 필드에도 필요한가"를 물을 것(중복 이름·교차필드
   정합성은 타입 검증을 통과하므로 어느 자동 게이트도 못 잡는다).
2. `services/tech_reports.py`의 `_UPDATE_COLUMNS`와 — 보존 대상이면 — `_PRESERVABLE`
   (§4.4의 보존 계약). 두 상수가 컬럼명의 유일한 출처이므로 여기 빠지면 저장이 조용히 누락된다.
3. `app_schema.sql` + `main.py::_migrate` 쌍(위 항목).
4. 프론트 렌더러(`components/tech/`) + `API_SPEC.md`·`CLAUDE_COWORK_API.md`.
   ⚠️ Cowork 문서는 한 엔드포인트를 **워크플로우 절과 엔드포인트 절 두 곳**에 적는다 —
   method+path를 파일 전체에서 grep해 히트 수를 세고 전부 갱신할 것.

**새 nav 탭**
`navSections.js` 한 곳만. 세 소비처는 파생한다. 상세 라우트가 있으면 `match`(접두) 지정.
`App.jsx`의 `<Routes>`에 라우트 추가는 별개다.

**응답 shape 변경**
비-additive(배열→객체 등)면 `grep -rn '<엔드포인트 경로>' frontend/src/`로 독립 fetcher까지 전수 갱신.
additive여도 `mock.call_args`(마지막 호출)를 단언하는 기존 테스트가 오염되므로
`call_args_list[i].kwargs`로 마이그레이션한다.

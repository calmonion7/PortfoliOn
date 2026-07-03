---
last_mapped_commit: 9de05a1ee9f11c92f58807adeff3dcc2cab63550
mapped: 2026-07-03
---

# ARCHITECTURE — PortfoliOn

## 전체 패턴

**FastAPI 라우터 → 서비스 → Docker PostgreSQL** 3계층 백엔드 + **React 19 SPA**(Vite, plain CSS) 프론트.

- 라우터(`backend/routers/*.py`)는 HTTP/auth/직렬화만 담당하고 로직은 서비스(`backend/services/`)에 위임.
- 저장소는 Docker PostgreSQL이 정본(스키마: `backend/auth_schema.sql` → `backend/app_schema.sql` 순서). 로컬 JSON(`backend/data/`)은 런타임 캐시/정적 참조용.
- 백엔드에 LLM 호출 없음 — AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API(`CLAUDE_COWORK_API.md`)로 기록.

## 진입점

### `backend/main.py`
- `lifespan`에서 `_migrate()`(main.py:39) 실행 — **기동 idempotent 마이그레이션**(`ADD COLUMN IF NOT EXISTS`/`CREATE TABLE IF NOT EXISTS`, ADR-0006). 신규 컬럼은 `app_schema.sql`(신규 설치용)과 `_migrate`(라이브 DB용) **쌍으로** 추가해야 배포에 반영된다.
- 라우터 마운트(main.py:172~189): auth, portfolio, report, watchlist, stocks, guru, calendar, digest, market_indicators, analytics, analysis, events, rankings, investor, short_sell, batches, recommendations, admin.
- lifespan에서 스케줄러 기동(`scheduler.start()`), CORS(`localhost:3000`/`5173`/`FRONTEND_URL`).

### `frontend/src/main.jsx` → `frontend/src/App.jsx`
- react-router 라우트: `/`=Research(홈 허브), `/portfolio`, `/market`=MarketHub, `/guru`, `/settings`, `/admin-analytics`, `/dev/showcase`. `/analysis`는 `/portfolio`로 리다이렉트.
- `frontend/src/contexts/AuthContext.jsx`가 로그인 시 메뉴 권한(`user_menu_permissions`)을 로드해 nav 필터링.

## 스케줄러 패키지 — `backend/scheduler/` (services 아님, 루트 레벨 패키지)

- `backend/scheduler/__init__.py` — 잡 배선. `jobs.py`의 잡 함수들과 `_JOB_FUNCS`를 명시 re-export(underscore 포함), `start()`가 `_seed_batch_schedules()` → editable 배치 전부 `_reschedule_job` → `_check_missed_report()` → 시드 3종(`_seed_rankings_if_empty`/`_seed_kr_sector_if_empty`/`_seed_us_sector_if_empty`) → `_scheduler.start()`.
- `backend/scheduler/jobs.py` — 잡 함수 본체(`_generate_kr/us`, `_run_digest`, `_fetch_*` 다수, `_fetch_us_sector` 포함)와 `_JOB_FUNCS` dict(jobs.py:452).
- `backend/scheduler/schedule.py` — `_build_trigger`/`_reschedule_job`/`_seed_batch_schedules`/`_check_missed_report(_for)`.
- `backend/scheduler/_state.py` — `AsyncIOScheduler` 싱글톤 + 공유 상수(leaf 모듈, 순환 import 회피).
- **배치 메타데이터 정본 = `backend/services/batch_registry.py`** — `BATCHES` 26종(id·label·market KR/US/공통·schedule_desc·source·usage·manual_endpoint·default_schedule). `GET /api/batches`(`backend/routers/batches.py`)가 그대로 노출. 실행 이력은 `backend/services/job_runs.py`의 `record(job_id, ...)` — **auto/manual/backfill 전 lane이 시장별 id로 record**(daily_report_kr/us 등, task#138에서 per-market 기록 정비).
- 스케줄 저장은 통합 `batch_schedules` 테이블(ADR-0007) + `backend/services/schedule_spec.py`.

## 데이터 플로우 — 배치-백킹 뷰 원칙

**외부 API(키움/yfinance/DART/FRED 등)를 요청·기동 경로에서 라이브 호출하지 않는다.** 배치가 사전계산해 `market_cache`/전용 테이블에 저장하고, 요청은 저장값만 읽는다.

```
APScheduler 배치(scheduler/jobs.py) → 서비스 refresh() → market_cache / 전용 테이블
                                                              ↓
GET 엔드포인트(routers/) → 서비스 load()/get() → 저장값 read only
```

배치-백킹 예:
- KR 업종 모멘텀: `kr_sector_fetch`(매일 16:00) → `backend/services/kr_sector_service.py` → `market_cache`.
- **US 섹터 모멘텀(신규, task#136)**: `us_sector_fetch`(매일 07:20) → `backend/services/us_sector_service.py`(key `us_sector_momentum`) → `analysis_service`의 US 섹터 요청경로가 저장값 read. all-None이면 save 생략(직전 양호값 보존). 수동 `POST /api/analysis/sector/refresh-us`.
- 매크로 신호: `macro_signals_fetch`(매일 06:00) → `backend/services/market_indicators/macro.py`(key `macro_signals`).
- 랭킹: `kr_rankings_fetch`/`us_rankings_fetch`(장중 10분) → `backend/services/ranking_service.py` — **빈 결과 wipe 가드**(fetch 빈/불완전이면 `RuntimeError`로 replace 스킵, ranking_service.py:143, `test_rankings_empty_guard.py`).
- 다이제스트: `daily_digest`(08:00) → `backend/services/digest_service.py` — **시세는 `get_quotes_batch` 1콜 배치, FX는 저장값**(`_get_usdkrw`가 `market_cache` key `fx`의 usdkrw read, 없을 때만 `_fetch_usdkrw_current` 폴백, isfinite 가드; digest_service.py:22). 요청경로 라이브 외부호출 제거(task#136).
- 예외(요청경로 증분 fetch 허용): fx/vix/commodities/treasury/indices — `backend/services/market_indicators/`의 "fx 패턴"(TTL캐시→`_mc_load`→라이브 incremental fetch→`_mc_save`+폴백), 스케줄 배치 없음.
- 기동 시 빈 캐시 적재는 `_seed_*_if_empty` 패턴(`scheduler/jobs.py`) — 채워져 있으면 no-op.

## 캐싱 계층

1. **인메모리** — `backend/services/cache.py`의 `TTLCache`: snapshot(LRU 200), list(60s), dashboard(300s), correlation(300s), sector(300s), macro(300s), quote(60s), live_prices(15s). 종목 변경 시 `invalidate_portfolio_caches()`가 dashboard·correlation·sector·macro·live_prices 일괄 무효화(`test_cache_live_prices_invalidation.py`).
2. **PostgreSQL `market_cache`** — 영구 시장지표 캐시(fx/vix/commodities/treasury/econ/m7/krtop2/krexports/macro_signals/kr·us_sector_momentum 등). 읽기/쓰기는 `backend/services/market_indicators/cache.py`의 `_mc_load`/`_mc_save`.
3. **파일 캐시**(gitignored) — `backend/data/calendar/YYYY-MM.json`(종목 변경 시 자동 무효화), `backend/data/consensus/`(per-ticker), `backend/snapshots/`.

## DB 접근 — `backend/services/db.py`

`ThreadedConnectionPool` 싱글톤 + `query()`/`execute()`/**`execute_many()`**(db.py:60, N+1 제거용 배치 helper — `test_db_execute_many.py`). 배치 upsert에서 사용(`test_upsert_disclosures_batch.py`/`test_upsert_trend_batch.py`). 주의: uuid 컬럼은 `ANY(%s::uuid[])` 명시 캐스트, VALUES는 행별 나열(바깥 괄호 금지) — CLAUDE.md task#135 가토.

## 시세 소스 체인

### KR — `backend/services/market/kr.py`
- 체인: **키움(`backend/services/kiwoom/quote.py` ka10001) → KIS(`backend/services/kis/quote.py`) → Naver**(`_kr_basic_naver`).
- **2-of-N 다수결**(`_kr_pick_basic`/`_corroborated_pick`, task#98): regular=False(라이브)는 ① 키움 NXT(`_AL`)+키움 KRX 2콜 합의 → NXT 반환(lazy, KIS/Naver 미호출), ② 불일치면 KIS·Naver escalate 최대 4피드 다수결(실패 피드는 격리·로깅, `test_kr_quote_escalation_isolation.py`), ③ 합의 불가면 degenerate `_kr_pick_degenerate_lazy`(±30% self-check) — **escalation이 이미 받은 KIS/Naver 결과를 degenerate에 전달·재사용**(중복 HTTP 2콜 제거, task#137; kr.py:166·217, `test_kr_quote_degenerate_reuse.py`).
- **regular/NXT 이원화**(ADR-0020): `backend/services/kiwoom/client.py`의 `integrated_code(stk_cd, regular=False)` 단일 분기점 — 리포트 스냅샷 writer(`backend/services/report_generator.py`)만 `regular=True`(KRX 정규장), 대시보드/RSI/종목추가는 NXT 기본. 리포트 박제 직전엔 독립피드(Naver retry-once→KIS) 2x 교차검증 게이트(ref 전무 시 박제 스킵, task#118, `test_report_price_gate.py`).
- 재무: Naver + DART `fnlttSinglAcntAll`(account_id 매칭, `get_annual_financials_kr`).

### US — `backend/services/market/us.py`
- 체인: **yfinance 1차 → KIS 백업**(`market/__init__.py`의 `_get_quote_uncached` US 분기, ADR-0011). KIS는 키 미설정 시 휴면(`kis/client.py` `configured()` False → 기존 동작 무변화).
- 재무는 yfinance `get_*` 메서드(무공백 index 라벨) 사용 — 프로퍼티(공백 라벨)와 혼용 금지.

### 공통 — `backend/services/market/__init__.py`
패키지 re-export(ADR-0017 god-file 분할): `get_quote`(TTL 캐시, 캐시 키에 regular 포함), `get_quotes_batch`(yf.download/ka10081 일괄 — 대시보드/다이제스트 핫패스), `get_history_df`, `get_financials`, `get_analyst_data`, `resolve_name`.

## 배포 토폴로지

- **Docker 4-컨테이너**(`docker-compose.yml`): `postgres`(16-alpine, pgdata 볼륨) / `backend`(FastAPI :8000, `backend/Dockerfile`) / `nginx`(:80, `/api/*`→backend:8000 프록시, **`./frontend/dist`를 :ro 볼륨마운트 직접 서빙** — 로컬 `npm run build` 즉시 라이브) / `certbot`(인증서 갱신).
- **Cloudflare Tunnel**: portfolion.taebro.com → localhost:80 (cloudflared는 launchd 실행, compose 밖).
- **자동 배포**: `git push origin main` → self-hosted GH Actions 러너(주, `~/actions-runner-portfolion`, `.github/workflows/deploy.yml`) + 폴러 폴백(`scripts/auto-deploy-poll.sh`, launchd 2분마다 — `LOCAL != origin/main`이면 **양방향 `git reset --hard origin/main`** 후 `deploy.sh`). → **commit만 하고 push 안 하면 로컬 커밋이 다음 폴에 소실**. ad-hoc `docker compose build/up` 금지, 백엔드 이상 시 정식 `bash deploy.sh` 1회.
- 환경변수: `backend/.env.docker`(POSTGRES_PASSWORD, JWT_SECRET, SESSION_SECRET, OAuth, FRED_API_KEY, KOFIA_API_KEY, DART_API_KEY, KIWOOM_APP_KEY/KIWOOM_SECRET_KEY, KIS_APP_KEY/KIS_APP_SECRET, KITA_API_KEY), 루트 `.env`(compose 보간).

## 인증/권한

- `backend/services/auth_service.py` + `backend/routers/auth.py` — HS256 JWT(access+refresh, `refresh_tokens` 테이블), Google OAuth. role `user`/`admin`.
- 메뉴 권한: `user_menu_permissions`/`default_menu_permissions` 테이블, `backend/routers/admin.py`의 `ALL_MENUS`.
- 테스트 주의: 자체-app 테스트는 `app.dependency_overrides`로 auth 우회 — 엔드포인트에 auth Depends 추가 시 그 경로 호출 테스트 전수 grep(CLAUDE.md task#108).

## 응답 안전망

- starlette `allow_nan=False` → 시세/합산을 싣는 응답은 `backend/services/utils.py`의 `sanitize`(NaN/inf→None) 또는 소스 `math.isfinite` 가드 필수(`test_nan_serialization_guards.py`).
- 대시보드 `_build_all`(`backend/routers/stocks.py`): "holdings=N → 항상 N카드" 불변식 — per-card `_safe`→`_minimal_card` 폴백 + 전체 sanitize + `get_quotes_batch` try/except.

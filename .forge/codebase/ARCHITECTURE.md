---
last_mapped_commit: e815fb8e452f74713f9082fafeeb9e7d60334d0e
mapped: 2026-07-26
---

# ARCHITECTURE

PortfoliOn = FastAPI 백엔드(:8000) + React 19/Vite 프론트(:5173) 2-티어. 저장소는 Docker PostgreSQL 16,
배포는 Mac 로컬 Docker(nginx·backend·postgres·certbot) + Cloudflare Tunnel.

```
브라우저 ─ nginx(:80) ─┬─ /api/* ──────────► backend:8000 (FastAPI)
                       └─ / (정적) ────────► frontend/dist (:ro 볼륨마운트)
backend ─ services ─ services/db.py(psycopg2 pool) ─► postgres:5432
backend ─ APScheduler(in-process) ─ 배치 ─► 외부 API(키움/KIS/yfinance/DART/FRED/…) ─► DB 저장
backend ─ cowork_trigger.fire(HTTP POST) ─► 로컬 리스너 ─► `claude -p` ─(API key)─► /api/* 쓰기
```

## 1. 백엔드 3계층: router → service → db

| 계층 | 위치 | 역할 |
|---|---|---|
| HTTP 표면 | `backend/routers/*.py` (19개, 3,768줄) | 요청 검증(Pydantic)·인증 `Depends`·응답 `sanitize`. 얇게 유지 |
| 도메인 로직 | `backend/services/*.py` + 6개 서브패키지 (12,759줄) | 외부 fetch·파싱·계산·저장. 라우터가 여기를 호출 |
| 데이터 접근 | `backend/services/db.py` (69줄) | `query`/`execute`/`execute_many`/`get_connection`. **모든** SQL이 여기를 통과 |

`services/db.py` — `ThreadedConnectionPool(minconn=1, maxconn=20)` 싱글톤(`_lock` double-checked).
`get_connection()`은 contextmanager로 정상 종료 시 commit·예외 시 rollback·항상 putconn.
psycopg2 풀은 소진 시 블록이 아니라 `PoolError`를 던지므로 maxconn은 최대 ThreadPool 동시성보다 크게 둔다.

### 엔트리포인트 — `backend/main.py` (296줄)

| 라인 | 요소 | 내용 |
|---|---|---|
| 18–30 | `_configure_logging()` | 루트 로거 1회 배선. **모듈 최상단 즉시 호출**(30) — config 부재 시 lastResort가 WARNING+만 내보내 `logger.info`가 docker logs에서 사라지는 문제 해소. urllib3/yfinance/apscheduler/asyncio→WARNING, uvicorn 3종 `propagate=False` |
| 32–45 | import | `import scheduler as sched` + 라우터 19개 + `EventTrackerMiddleware` |
| 51–57 | `_warm_market_cache()` | FRED 경제지표·KR 수출 선적재(전부 삼킴) |
| 60–238 | `_migrate()` | 기동 idempotent DDL(ADR-0006). 전부 `CREATE TABLE IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`, 블록별 try/except+warning. `app_schema.sql`과 **쌍**으로 유지(라이브 DB는 이 경로만 탄다) |
| 241–247 | `lifespan()` | `_migrate()` → `sched.start()` → `_warm_market_cache()`를 daemon 스레드로 → (shutdown) `sched.stop()` |
| 253–259 | `_validation_error_handler` | 422 detail의 NaN/inf를 `sanitize`로 null화(요청 본문 echo가 직렬화 500이 되는 것 차단) |
| 262–271 | 미들웨어 | `SessionMiddleware`(OAuth) → `EventTrackerMiddleware` → `CORSMiddleware`(localhost:3000/5173 + `FRONTEND_URL`) |
| 273–291 | `include_router` × 19 | auth·portfolio·report·watchlist·stocks·guru·calendar·digest·market_indicators·analytics·analysis·events·rankings·investor·short_sell·batches·recommendations·**analyst_reports**·admin |
| 294–296 | `/health` | GET·HEAD (nginx·deploy.sh 스모크가 호출) |

### 서비스 그룹

| 그룹 | 파일 |
|---|---|
| 저장/스키마 | `services/db.py`, `services/storage/`(포트폴리오·이름·스케줄·날짜) |
| 시세·재무 | `services/market/`(`kr.py` 664줄·`us.py`·`format.py`), `services/kiwoom/`(6), `services/kis/`(3) |
| 시장지표 | `services/market_indicators/`(11 모듈, `cache.py`가 `market_cache` I/O) |
| 리포트 생산 | `services/report_generator.py`(630), `consensus.py`, `consensus_pipeline.py`, `indicators.py` |
| 발행물 | `services/analyst_reports.py`(172) — 판단은 요청 본문, 숫자는 스냅샷 발췌 |
| KR 공시·재무 | `backlog.py`+`backlog_parser.py`, `disclosures.py`, `agm.py`, `insider_trades.py` |
| 수급 | `investor_service.py`, `short_sell_service.py`, `supply_score.py`, `leverage_service.py`, `lending_service.py`, `us_supply.py` |
| 분석·추천 | `analysis_service.py`, `kr_sector_service.py`, `us_sector_service.py`, `recommendation/`(5), `rebalance.py`, `exposure.py`, `beta.py`, `dividends.py` |
| 인프라 유틸 | `cache.py`, `job_runs.py`, `batch_registry.py`, `schedule_spec.py`, `parallel.py`, `progress.py`, `errors.py`, `utils.py`(`sanitize`·`today_kst`·`TICKER_RE`), `cowork_trigger.py`, `auth_service.py` |

**God-file 분해는 패키지 re-export(ADR-0017)**: `storage`/`market`/`market_indicators`/`recommendation`은 서브모듈로 쪼개고
`__init__.py`가 공개+외부참조 private 심볼을 전부 루트로 re-export한다 — 소비처가 `storage.X`처럼 **모듈 속성**으로 조회하므로
심볼이 패키지 루트에 없으면 조용히 깨진다. `scheduler/__init__.py`도 같은 규약(underscore 심볼까지 명시 re-export).

## 2. 요청/데이터 흐름

**읽기(사용자 대면)** — 라우터 → (인메모리 캐시 확인) → service → `db.query`(저장값) → `sanitize` → JSON.
요청 경로에서 외부 API를 부르는 것은 예외적으로 시장지표 일부(fx/vix/commodities/indices/kospi_futures/sentiment)와
rebalance/exposure(라이브 시세)뿐이며, 그마저 TTL 캐시 + `market_cache` last-good 폴백으로 감싼다.

**쓰기(사용자)** — 라우터 → `storage.*`(user_stocks/tickers UPSERT) → `cache.invalidate_portfolio_caches(user_id)`
(list·dashboard·sector·macro·correlation·live_prices·rebalance·exposure 인메모리 + `calendar_cache` DB 행 삭제).

**배치(생산)** — APScheduler → `scheduler/jobs.py` 잡 함수 → `job_runs.record(id, "auto")` 컨텍스트 →
service fetch(외부 API) → DB 저장. 실패는 잡 안에서 로깅으로 흡수하는 경우가 많다.

**AI 분석 쓰기** — 외부 클라이언트(Cowork/루틴)가 `X-API-Key`로 `PUT /api/stocks/{ticker}/enrich`·
`POST /api/analyst-reports/{ticker}` 호출 → `tickers` enrich 컬럼 / `analyst_reports` 행.

## 3. 스케줄러 / 배치 아키텍처

`backend/scheduler/` — **루트 레벨 패키지**(services 아님). 단일 `scheduler.py` 파일이 아니다.

| 파일 | 내용 |
|---|---|
| `scheduler/_state.py` (7) | `_scheduler = AsyncIOScheduler()`, `_DIGEST_JOB_ID`, `_VALID_DAYS` — leaf 모듈(부분초기화 순환 회피) |
| `scheduler/jobs.py` (512) | 잡 함수 전체 + `_JOB_FUNCS` dict(**28 엔트리**: job_id → 함수) + 워커(`_investor_trend_work`·`_short_sell_work`·`_supply_score_work`·`_recommendation_work`) + 기동 시드(`_seed_rankings_if_empty`·`_seed_kr_sector_if_empty`·`_seed_us_sector_if_empty`) |
| `scheduler/schedule.py` (145) | `_build_trigger`(`schedule_spec.build_trigger_kwargs`+CronTrigger), `_reschedule_job`, `_seed_spec_for`/`_seed_batch_schedules`(기동 마이그레이션), `_check_missed_report(_for)` |
| `scheduler/__init__.py` (81) | 심볼 re-export + `start()`/`stop()`/`reload(job_id)` |

`start()` 순서: `_seed_batch_schedules()` → editable 배치 전부 `_reschedule_job` → `_check_missed_report()`
→ 랭킹/KR섹터/US섹터 빈-캐시 시드 → `_scheduler.start()`.

**`services/batch_registry.py` = 배치의 단일 정본**(`BATCHES` 리스트, **29 엔트리**). 각 엔트리 필드:
`id`(스케줄러 잡 id·`job_runs.record` id와 동일해야 함) / `label` / `category`(report·market·guru) /
`usage`(소비 UI) / `source`(fetch 출처) / `editable` / `trigger_kinds` / `manual_endpoint` /
`scheduler_job_id` / `timezone` / `misfire_grace_time` / `market`(KR·US·공통, ADR-0013) / `default_schedule`.
`consensus`만 자체 잡이 없다(daily_report_kr/us에 내장 → `_JOB_FUNCS` 28 vs BATCHES 29).

- **스케줄 저장** = `batch_schedules` 테이블(`job_id` PK, `data` jsonb) — 통합 스펙(ADR-0007).
  `daily_report_kr/us`·`guru_crawl`·`earnings_*`·`monthly_*`는 은퇴한 id의 옛 행을 승계(`_seed_spec_for`).
- **스케줄 편집** = `GET/PUT /api/batches/{job_id}/schedule` → `storage.save_batch_schedule` → `sched.reload(job_id)`.
- **실행 이력** = `services/job_runs.py`: `record()` contextmanager가 `job_runs`에 running INSERT →
  job_id별 최신 20건 prune → 종료 시 success/failed UPDATE. **계측은 관측 전용이라 실패해도 본문을 깨지 않는다**
  (INSERT 실패 시 `run_id=None`으로 무계측 실행). 다수 잡이 내부 예외를 삼키므로 **success ≠ 내부 오류 없음**.
- **misfire**: `misfire_grace_time` 미지정이면 인자를 아예 빼서 기본값(1초)을 쓴다 — `None`을 넘기면
  APScheduler가 '유예 무제한'으로 해석해 거동이 바뀐다(daily_report_kr/us만 82800 명시).
- **누락 복구**: `_check_missed_report_for(job_id, market)`가 기동 시 "오늘 스케줄 지났고 이 시장 종목의
  오늘 스냅샷이 없는 것"만 골라 재생성(부분 누락 복구 — 예전엔 하나라도 있으면 전체 스킵).
- **동시성 가드**: 배치 워커 ThreadPool은 `max_workers ≤ 8`(DB 풀 초과 PoolError 방지).

## 4. 캐싱 레이어

### (a) 인메모리 — `backend/services/cache.py` (166줄)

프로세스 로컬. `TTLCache(ttl, maxsize=200)` + 스냅샷용 LRU `OrderedDict`.

| 캐시 | 종류 | 키 | 무효화 |
|---|---|---|---|
| `_snapshots` | LRU `_MAX=50` | `TICKER/date` | `invalidate(ticker)` |
| `_list_cache` | TTL 60s | user_id | `invalidate_list()` |
| `_dashboard_cache` | TTL 300s | user_id | `invalidate_dashboard(user_id=None)` |
| `_correlation_cache` | TTL 300s | user_id | `invalidate_correlation` |
| `_sector_cache` | TTL 300s | `user_id:market` | `invalidate_sector` |
| `_macro_cache` | TTL 300s | user_id | `invalidate_macro` |
| `_quote_cache` | TTL 60s | quote 키(`regular` 포함) | `invalidate_quote` |
| `_live_prices_cache` | TTL 15s | user_id | `invalidate_live_prices` — 장중 15초 폴링의 레이트리밋 상한 |
| `_rebalance_cache` | TTL 300s | user_id | `invalidate_rebalance` |
| `_exposure_cache` | TTL 300s | user_id | `invalidate_exposure` |

집합 무효화 2종: `invalidate(ticker)`(스냅샷 prefix + 위 대부분) /
`invalidate_portfolio_caches(user_id)`(+ `routers.calendar.clear_cache(user_id)`로 `calendar_cache` DB 행 삭제 —
storage→cache는 함수 내 지연 import로 순환참조 회피).

### (b) 영속 — PostgreSQL `market_cache` (`backend/services/market_indicators/cache.py`)

`key`(PK) / `data`(jsonb) / `fetched_at`. 헬퍼: `_mc_load`/`_mc_save`/`_mc_delete`/`clear_cache`(메모리+DB) +
그 위에 자체 인메모리 `_cache`(`_get_cache`/`_set_cache`, TTL).

- `get_or_refresh(key, fetch_fn, ttl, force)`: 메모리 → `_mc_load` → 없으면 `fetch_fn()`(저장까지 fetch_fn 책임).
  **"fetch 실패 시 직전 저장값 폴백"은 하지 않는다**(실패 전파). 취약 소스는 `fx.py` VIX식 수동 폴백을 쓴다.
- `_merge_history`(date 병합)·`_yf_close_history`(마지막 날짜 이후만 증분 fetch, 366일 트림)·`_filter_outliers`(중위 ±5x).

### (c) 파일 (잔존)

`backend/snapshots/`(per-ticker/date JSON — report_generator 쓰기, report/stocks 라우터 읽기 폴백),
`backend/reports/`(레거시 read-only), `backend/data/digest/`(digest 파일 폴백),
`backend/data/{sp500,kospi}_tickers.json`(정적 유니버스), `backend/data/kr_exports.json`(수출 파일 캐시).
`backend/data/{consensus,calendar}/`와 `holdings.json`/`stocks.json`/`watchlist.json`/`schedule.json`/`guru_*.json`은
**코드에서 참조되지 않는 잔존물**(grep 0건).

## 5. 배치-백킹 뷰 원칙

> 배치가 사전계산해 테이블/`market_cache`에 저장 → **요청은 저장값만 읽는다**(요청·기동 경로 외부 fetch 0).

적용 표면: 랭킹(`market_rankings`), KR/US 섹터 모멘텀(`market_cache`), 수급 추이(`market_investor_trend`),
공매도(`market_short_sell`), 수급 스코어(`stock_supply_score`), 추천(`stock_recommendations`),
배당(`stock_dividends`/`stock_dividend_schedule`), 베타(`stock_beta`), 공시·주총(`stock_disclosures`),
내부자(`stock_insider_trades`), US 수급(`us_supply_snapshot`), 발행물 데이터 블록(스냅샷 발췌).

수반 규칙(코드에 주석으로 박제됨):
- 외부 fetch 실패를 **조용히 삼키지 말 것**(silent except → 진단 불가).
- **빈/all-None 결과를 캐시에 박제 금지** — 전부 None이면 save 생략, 직전 양호값 유지(`wrong < missing`).
- delete-rewrite(replace) 갱신은 fetch 실패 시 **delete까지 스킵**(빈 결과가 직전 값을 파괴하지 않게).
- 기동 시 빈 캐시는 `_seed_*_if_empty`로 1회 적재(첫 cron 전 빈 화면 방지).

## 6. 인증 / 권한 흐름

**토큰** — `services/auth_service.py`: HS256 JWT access(`_ACCESS_EXPIRE = 1h`, payload `sub`=user_id) +
opaque refresh(`_REFRESH_EXPIRE = 30d`, `refresh_tokens` 테이블). OAuth(Google·GitHub)는
`SessionMiddleware` + 임시 `_oauth_codes`(코드 교환 `GET /api/auth/oauth/token`).

**의존성 4종** — `backend/auth.py`:

| Dep | 통과 조건 | 반환 |
|---|---|---|
| `get_current_user` | Bearer JWT | user_id |
| `get_current_user_or_api_key` | Bearer JWT **또는** `X-API-Key == COWORK_API_KEY` | user_id 또는 `"__api_key__"` |
| `require_admin` | JWT + `users.role == 'admin'` | user_id |
| `require_admin_or_api_key` | API key **또는** admin JWT | user_id/센티넬 |

**메뉴 권한** — `user_menu_permissions`(user_id+menu+enabled). `ALL_MENUS = ["portfolio","research","market","guru","settings"]`
(`routers/admin.py:10`). `GET /api/auth/me`가 role + `menu_permissions`(admin은 `ALL_MENUS` 전체) 반환 →
프론트 `contexts/AuthContext.jsx`가 로드 → `components/Masthead.jsx`(PC 5섹션)·`components/MobileNav.jsx`(모바일 5탭)가
`menuPermissions.includes(perm)`로 필터. 신규 사용자 기본값은 `default_menu_permissions`
(`auth_service` 45–52, 권한 행이 이미 있으면 스킵). 관리: `PUT /api/admin/users/{id}/permissions`,
`POST /api/admin/users/bulk-permissions`, `PUT /api/admin/default-permissions`.

**행동 로그** — `backend/middleware/event_tracker.py`가 `_TRACKED`(method+path 정규식 7종: stock_add/delete/promote,
report_generate, guru_crawl)를 매칭해 `user_events`에 비동기 기록. 명시 수집은 `POST /api/events`(`VALID_EVENTS` 화이트리스트).

## 7. 외부 AI 경계 — 백엔드에 LLM 호출 없음

- `backend/requirements.txt`에 `anthropic` 없음. 백엔드 리포트 생성(`report_generator`)은 **시장 데이터 스냅샷**만 만든다.
- AI 텍스트(enrich 필드·애널리스트 리포트 판단)는 **외부 클라이언트가 API로 써넣는다**(`CLAUDE_COWORK_API.md`).
- 유일한 접점은 **트리거 POST 1개**(`services/cowork_trigger.py`, 44줄) — LLM 호출이 아니다.

**이벤트 구동 루틴 파이프라인 (ADR-0028, 2026-07-25 당일 개정)**

```
scheduler/jobs.py::_generate_all(market, job_id)
  └ job_runs.record(...) 안에서 전 종목 스냅샷 생성 + consensus_pipeline.run_daily
  └ (job_runs 컨텍스트 밖) cowork_trigger.fire(f"{market} 일일 리포트 배치 완료 — …")   ← best-effort
        │ POST $COWORK_ROUTINE_FIRE_URL  Bearer $COWORK_ROUTINE_FIRE_TOKEN  {"text": …}
        ▼
scripts/cowork-fire-listener.py  (launchd com.portfolion.cowork-fire-listener, 127.0.0.1:8787)
  └ 프롬프트 = scripts/cowork-routine-prompt.md ({{COWORK_API_KEY}} 치환) + 트리거 text
  └ headless `claude -p` (빈 스크래치 디렉터리에서 실행 — 레포 컨텍스트/편집 차단)
        │ X-API-Key
        ▼
PUT /api/stocks/{ticker}/enrich   ·   POST /api/analyst-reports/{ticker}
```

- `cowork_trigger.configured()`는 `COWORK_ROUTINE_FIRE_URL`+`COWORK_ROUTINE_FIRE_TOKEN` 둘 다 있을 때만 True —
  **미설정이면 휴면**(dormant-safe). 실패는 로깅만(배치 본문 무해).
- 수동 발사: `POST /api/admin/cowork/fire`(`require_admin_or_api_key`). 대상 지정: `PUT /api/admin/analyst-targets/{ticker}`
  → `tickers.analyst_target`.
- 가드레일은 프롬프트 파일에 명시(enrich rolling 최대 5종목/회, 발행은 7일+ 경과·유의미 변화 종목 회당 최대 2).
- **ADR-0028 본문 §1의 "실행 주체 = claude.ai 클라우드 루틴"은 같은 날 개정으로 폐기**됐다 —
  클라우드 샌드박스가 외부 egress 불가로 실측 확인. 코드의 정답은 로컬 리스너다.

**발행물(analyst_reports) 하이브리드 생산 (ADR-0027)**
- 판단·서사(rating/title/적정주가 밴드/valuation_method/points/risks)는 요청 본문(`PublishBody`,
  `allow_inf_nan=False`로 NaN 토큰 422 차단, points 2~3개, metric 칩 최대 4).
- 숫자 데이터 블록은 서버가 **최신 스냅샷 발췌**로 첨부(`svc.build_data_block`: price·consensus·
  financials_annual 3개년+forward·competitors 멀티플·`per_band`). 스냅샷 없으면 발행 409.
- 불변 누적: `UNIQUE(ticker, published_date)` upsert(같은 날 재발행만 교체). 예외는 admin 종목 단위 삭제
  `DELETE /api/analyst-reports/{ticker}`(`require_admin` — API key 제외). 판 단위 삭제는 없다.
- 목록 정체성 분기: `GET /api/analyst-reports` = `DISTINCT ON (ticker)` **종목당 최신 1건**,
  `GET /api/analyst-reports/{ticker}` = 그 종목 **전 판**(문서 페이지 이력 링크용).

## 8. 프론트엔드 아키텍처

- 엔트리: `frontend/src/main.jsx` → `frontend/src/App.jsx`(174줄).
  `App`이 OAuth 콜백 처리(`?oauth=`/`?token=&refresh=`)·localStorage 토큰 세션 판정 →
  미로그인이면 `pages/LoginPage.jsx`, 로그인이면 `ToastProvider > AuthProvider > BrowserRouter > AppShell`.
- `AppShell`(App.jsx:57–108): `Masthead`(PC nav) + 모바일 header + `<Routes>` + `MobileNav`.
  라우트 전환 페이드는 `key={location.pathname}` + `.anim-fade`(transform 금지 — fixed 자손 containing block 함정).
- 리다이렉트 맵은 `frontend/src/routes.js`의 `REDIRECTS`(App.jsx와 `test/route-redirects.test.jsx`가 공유).
- 셸 2종: `pages/ResearchShell.jsx`(리서치 5탭 + 일정·인컴 3탭, 모바일만 seg 필 — PC는 마스트헤드가 nav),
  `pages/MarketHub.jsx`(시장지표/수급지표 2탭 → `pages/Market.jsx`).
- HTTP: `frontend/src/api.js` — axios 인스턴스, request 인터셉터가 `Authorization: Bearer`,
  response 인터셉터가 401에 토큰 삭제 + `/`로 이동.
- 데이터 훅 = 페이지와 fetch의 경계층(`frontend/src/hooks/`): `usePortfolioData`(portfolio·prices·dashboard·fx·digest),
  `useReportList`, `useReportGeneration`, `useReportFilters`, `useStockManagement`, `usePriceFlash`,
  `useIsMobile`/`useTheme`/`useReveal`/`useCountUp`/`useBodyScrollLock`.
- 상태 공유는 Context 1개(`contexts/AuthContext.jsx`: role·menuPermissions·loading)뿐 — 그 외는 로컬 state·훅.
- 용어집: `frontend/src/glossary/{terms.js,match.js}` + `components/Glossary.jsx`(`GlossaryTerm`/`GlossaryText`),
  market 섹션 12개 + reports 컴포넌트 8개 + `pages/AnalystReport.jsx`·`pages/Analytics.jsx`에 배선.
- PWA: `vite.config.js`의 `VitePWA`(autoUpdate, `navigateFallback: null` — OAuth 콜백 가로채기 방지) +
  자체 `sw-cache-bust` 플러그인(`config.build.outDir` 사용 — `dist` 하드코딩 금지).
- 청크: Vite 8 = rolldown → `manualChunks`는 **함수 형식만**(`charts`=recharts/d3/victory-vendor, `vendor`=나머지).

## 9. 배포 흐름

`git push origin main` → ① self-hosted GH Actions 러너(`.github/workflows/deploy.yml`, `runs-on: self-hosted`)가
`git reset --hard origin/main` + `bash deploy.sh`(주 경로) / ② 폴러 `scripts/auto-deploy-poll.sh`(2분,
`LOCAL != origin/main`이면 reset+배포)가 폴백.

`deploy.sh`: `/tmp/portfolion-deploy.lock` 동시배포 가드 → ① `frontend && npm install && npm run build` →
② `docker build -t portfolion-backend ./backend` → ③ `portfolion-backend-1` stop/rm/run(`--env-file backend/.env.docker`,
`--network portfolion_default`) → ④ `portfolion-nginx-1` stop/rm/run(nginx.conf + `frontend/dist` 마운트) → `/health` 스모크.

nginx(`nginx/nginx.conf`): `/health`·`/api/` → `http://backend:8000`; `/index.html`·`sw.js`·정적 자산·SPA fallback은
`/usr/share/nginx/html`. 프론트는 `frontend/dist` 직접 마운트라 로컬 `npm run build`가 **즉시 라이브**;
백엔드 변경은 재배포 후에야 반영.

## 10. 문서·코드 불일치 (코드가 정답)

| 주장(문서) | 실제 코드 |
|---|---|
| `CLAUDE.md`: cache.py "인메모리 6종, snapshot LRU 200, list TTL 5s" | **10종**, `_MAX = 50`, list TTL **60s** (+quote 60s·live_prices 15s·rebalance/exposure 300s) — `services/cache.py` |
| `services/batch_registry.py` docstring: "20개 배치" | `BATCHES` **29 엔트리**(`_JOB_FUNCS` 28 — consensus는 자체 잡 없음) |
| `scheduler/jobs.py` 주석 ×2: "DB 풀(maxconn=10) 초과 방지" | `services/db.py`는 `maxconn=20`(주석만 stale, 워커 ≤8 가드는 유효) |
| `CLAUDE.md`: `backend/data/consensus/` = per-ticker 컨센서스 캐시 | 코드 참조 0건(`services/consensus.py`는 DB 전용) — 디스크 잔존물 |
| `CLAUDE.md` 프론트 페이지 목록(Research 허브가 홈 `/`, Sidebar) | `/`는 `/reports`로 리다이렉트, 허브는 `ResearchShell`+`Masthead`(ADR-0026이 ADR-0025 사이드바 대체), 신규 `/analyst-reports`·`/analyst-report/:ticker/:date`·`/compare`·`/dividends`·`/recommend` |
| `ADR-0028` §1 "실행 주체 = claude.ai 루틴" | 개정판대로 **로컬 launchd 리스너 + `claude -p`**(`scripts/cowork-fire-listener.py`) |
| `ADR-0027` 본문 "발행은 Cowork 온디맨드, 자동 발행 없음"·"발행 후 불변" | 개정 2건이 적용된 코드: 루틴 자동 발행 허용, admin 종목 단위 삭제 존재 |

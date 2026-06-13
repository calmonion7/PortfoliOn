---
last_mapped_commit: 27346baec719306d5c2be8f259cc448ca4f64f4a
mapped: 2026-06-13
---

# ARCHITECTURE

PortfoliOn은 단일 사용자가 아닌 다중 사용자 종목 포트폴리오/리포트 관리 SPA다. 백엔드는 Python/FastAPI 단일 프로세스(`backend/`), 프론트엔드는 React 18 + Vite SPA(`frontend/`), 데이터 저장소는 Docker PostgreSQL이다. 배포는 nginx + backend + postgres + Cloudflare Tunnel의 Mac 로컬 Docker 4-컨테이너 구성이다.

## 전체 패턴

3-계층 백엔드(라우터 → 서비스 → DB)에 APScheduler 기반 백그라운드 배치가 직교로 붙는다. 외부 데이터(yfinance, Naver/FnGuide, FRED, DART, KOFIA, 공공데이터포털)를 수집·정규화해 PostgreSQL에 적재하고, 프론트는 `/api/*` REST를 통해 읽는다. 리포트 생성·AI 인리치(enrich)·컨센서스 집계가 핵심 도메인 파이프라인이다.

## 백엔드 계층

### 앱 진입점 — `backend/main.py`

- `load_dotenv()` 후 FastAPI 앱을 생성한다. `app = FastAPI(title="Stock Portfolio Manager", lifespan=lifespan)`.
- `lifespan` (`@asynccontextmanager`): 기동 시 `_migrate()` → `sched.start()` → 캘린더/시장 캐시 워밍을 데몬 스레드로 시작, 종료 시 `sched.stop()`.
- `_migrate()`: idempotent 기동 마이그레이션. `ALTER TABLE backlog_history ADD COLUMN IF NOT EXISTS segments JSONB`, `CREATE TABLE IF NOT EXISTS batch_schedules (...)`. DDL은 모두 `IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`라 배포 시 자동 적용된다.
- 미들웨어 순서(등록 역순으로 실행): `SessionMiddleware`(OAuth state용, `SESSION_SECRET`), `EventTrackerMiddleware`(`backend/middleware/event_tracker.py` — 응답 후 화이트리스트 라우트를 `user_events`에 비동기 기록), `CORSMiddleware`(`localhost:3000`/`5173`/`FRONTEND_URL`).
- 라우터 마운트: `auth, portfolio, report, watchlist, stocks, guru, calendar, digest, market_indicators, analytics, analysis, events, rankings, investor, batches, admin` 순서로 `app.include_router(...)`.
- `GET/HEAD /health` 헬스체크.

### 라우터 계층 — `backend/routers/`

각 모듈은 `router = APIRouter(prefix=..., tags=[...])`를 노출하고, 인증은 `Depends(get_current_user)` / `Depends(require_admin)` / `Depends(get_current_user_or_api_key)`(`backend/auth.py`)로 게이팅한다.

| 라우터 | prefix | 책임 |
|--------|--------|------|
| `auth.py` | `/api/auth` | 회원가입/로그인/리프레시/로그아웃, `GET /me`(role·menu_permissions 반환), Google/GitHub OAuth 콜백 + `oauth/token` 교환 |
| `portfolio.py` | `/api/portfolio` | 보유 종목 CRUD, `GET /prices`(실시간 시세), 추가/수정/삭제 시 캐시 무효화 |
| `watchlist.py` | `/api/watchlist` | 관심 종목 CRUD, `POST /{ticker}/promote`(관심→보유 승격) |
| `stocks.py` | `/api/stocks` | 종목 검색, 뉴스, `PUT /enrich/batch`·`PUT /{ticker}/enrich`(AI 분석 필드 주입; batch가 먼저 등록되어야 함), `GET /dashboard` |
| `report.py` | `/api` | 리포트 생성(`/report/generate`, `/report/generate/{ticker}`), 목록(`/report/list`), 종목 히스토리(`/report/{ticker}/history`), 단건 스냅샷(`/report/{ticker}/{date_str}`), 컨센서스 배치/조회/백필, 수주잔고(`/report/{ticker}/backlog`, `/report/backlog/pending`, `/report/backlog/refresh-all`) — 가장 큰 라우터(472L) |
| `guru.py` | `/api/guru` | 구루 운용역 데이터·통계(popularity/top3/weighted), 크롤 트리거(`POST /crawl`) |
| `calendar.py` | `/api` | `GET /calendar`(파일 캐시 기반 이벤트), `DELETE /calendar/cache` |
| `digest.py` | `/api` | 일일 다이제스트 조회/생성/전체생성 |
| `market_indicators.py` | `/api/market` | FX/VIX/원자재/국채/M7·KRTop2 실적/경제지표/KR수출, 레버리지·대차잔고 조회·동기화, refresh 트리거 |
| `analytics.py` | `/api/analytics` | 보유 종목 간 90일 수익률 상관관계 |
| `analysis.py` | `/api/analysis` | `GET /sector`(섹터 모멘텀), `GET /macro-correlation` |
| `events.py` | `/api/events` | `POST ""` 사용자 행동 이벤트 수집(VALID_EVENTS 화이트리스트) |
| `rankings.py` | `/api` | `GET /rankings`(거래대금·거래량·등락률 랭킹), `POST /rankings/refresh` |
| `investor.py` | `/api` | `GET /investor/screening`(외국인/기관/개인 수급), `GET /stocks/{ticker}/investor-trend`, `POST /investor/refresh` |
| `batches.py` | `/api` | `GET /batches`(배치 현황 허브), 편집 가능한 배치 스케줄 조회/수정 |
| `admin.py` | `/api/admin` | 사용자 목록·메뉴 권한 관리, 기본 권한, 사용자 삭제, 행동 분석 집계(`/analytics/*`) |

### 서비스 계층 — `backend/services/`

| 서비스 | 책임 |
|--------|------|
| `db.py` | `ThreadedConnectionPool`(minconn 1, maxconn 10, `DATABASE_URL`). `get_connection()`(commit/rollback 컨텍스트), `query()`(SELECT→dict 리스트), `execute()`(INSERT/UPDATE/DELETE→rowcount). 모든 DB 접근의 단일 게이트웨이 |
| `storage.py` | 종목/스케줄/구루/배치스케줄 영속화 래퍼(PostgreSQL). user_id별 `user_stocks`(holding/watchlist), `tickers` 마스터, `enrich_stock()`, `get_batch_schedule()`/`save_batch_schedule()`(`batch_schedules` 테이블) |
| `market.py` | 시세·재무·애널리스트 데이터 수집(yfinance + Naver/FnGuide). KR/US 분기. `get_quote`, `get_financials`, `get_analyst_data`, `_yf_sym`(심볼 변환) |
| `consensus.py` | 목표가·의견수 정본 조회(ADR-0008). `get_asof`(daily_consensus_mart as-of → consensus_history 폴백), `apply_asof`(summary 정합), `get_history`(mart → consensus_history 폴백) |
| `consensus_pipeline.py` | 컨센서스 수집·집계. `_SCORE_MAP`(opinion→5점), `_fetch_kr_raw`/`_fetch_us_raw`, `upsert_raw_reports`(→`raw_reports`), `refresh_mart`(→`daily_consensus_mart`), `run_daily`, `backfill`, `get_mart_history` |
| `report_generator.py` | 리포트(스냅샷) 생성. `generate_report`(ThreadPoolExecutor로 quote/fin/analyst/rsi/finviz/news/경쟁사 병렬 fetch → summary 조립 → 파일+`snapshots` 테이블 저장), `generate_report_with_retry`, `backfill_ticker` |
| `scraper.py` | Finviz 컨센서스 스크래핑, KR/US 뉴스 수집 |
| `cache.py` | 인메모리 캐시 6종(`TTLCache`): snapshot(LRU 200), list(5s), dashboard(300s), correlation(300s), sector(300s), macro(300s). 종목 변경 시 무효화 |
| `digest_service.py` | 일일 다이제스트 생성 + 텔레그램 발송 |
| `batch_registry.py` | `BATCHES` 리스트 — 12개 배치의 정적 메타데이터(id/label/category/editable/scheduler_job_id/default_schedule). `get_batch(job_id)` 조회. 스케줄러·현황 허브가 공유하는 단일 진실원 |
| `job_runs.py` | 배치 실행 기록(`job_runs` 테이블). `record(job_id, trigger)` 컨텍스트매니저(시작·완료·실패 기록), `recent`/`recent_map` |
| `schedule_spec.py` | 통합 스케줄 스펙 검증·CronTrigger kwargs 변환(`build_trigger_kwargs`)·사람용 문구(`describe_schedule`) |
| `auth_service.py` | 비밀번호 해시·검증, 사용자 조회/생성, OAuth upsert, JWT 발급/검증, 리프레시 토큰 소비, 기본 권한 적용 |
| `guru_scraper.py` / `guru_stats.py` | 구루 운용역 크롤링 / popularity·top3·weighted 통계 계산 |
| `analysis_service.py` | 섹터 모멘텀(SECTOR_ETFs), 매크로 상관관계(MACRO_TICKERS) |
| `leverage_service.py` / `lending_service.py` | KOFIA 신용잔고·반대매매(→`market_leverage_indicators`) / 금융위 대차잔고(→`market_lending_balance`) |
| `backlog.py` | 수주잔고 수집(DART `document.xml` 파싱·검산·억원 정규화). `fetch_and_save_backlog`, `fetch_all_backlog`, `get_pending_backlog`, `save_llm_backlog`(Cowork) |
| `ranking_service.py` / `investor_service.py` | KR/US 거래 랭킹 수집·저장(`market_rankings`) / 종목별 수급 추이(`market_investor_trend`) |
| `indicators.py` / `charts.py` | RSI·볼륨프로파일·지지저항 계산 / 매출·RSI 차트 PNG 생성 |
| `errors.py` / `utils.py` / `parallel.py` / `progress.py` | 공통 HTTPException 헬퍼 / NaN·Inf sanitize·ticker 조회 / `parallel_map` / `ProgressTracker`(배치 진행률) |

### market_indicators 서브패키지 — `backend/services/market_indicators/`

`__init__.py`가 서브모듈 함수를 재노출한다. `cache.py`(`_mc_load`/`_mc_save`로 `market_cache` 테이블 읽기·쓰기, `clear_cache`), `fx.py`(FX/VIX), `commodities.py`(원자재/국채), `earnings.py`(M7/KR Top2), `econ.py`(FRED 경제지표), `exports.py`(KR 수출). 각 서브모듈은 `_merge_history`/`_yf_close_history`로 yfinance incremental fetch(마지막 날짜 이후만 조회)를 수행한다.

### 스케줄러 — `backend/scheduler.py`

`AsyncIOScheduler` 단일 인스턴스. `_JOB_FUNCS` 딕셔너리가 job_id→함수를 매핑한다:

- `daily_report` → `_generate_all`: 전 사용자 종목에 대해 `generate_report_with_retry` + `_pipeline.run_daily`
- `guru_crawl` → `_run_guru_crawl`
- `daily_digest` → `_run_digest`
- `earnings_refresh` → `_refresh_earnings`
- `monthly_refresh` → `_refresh_monthly`(경제지표 + KR 수출)
- `leverage_fetch` → `_fetch_leverage`
- `lending_fetch` → `_fetch_lending`
- `kr_rankings_fetch` → `_fetch_kr_rankings`
- `us_rankings_fetch` → `_fetch_us_rankings`
- `investor_trend_fetch` → `_fetch_investor_trend`(`_investor_trend_work`: KR 랭킹 종목 전진 적립 + 종목당 1청크 후진 백필, ThreadPoolExecutor max 8)
- `backlog_fetch` → `_fetch_backlog`

`start()`: `_seed_batch_schedules()`(편집 배치에 `batch_schedules` 행 없으면 시드) → 편집 배치를 `_reschedule_job`으로 등록 → `_check_missed_report`(당일 스케줄이 지났는데 스냅샷 누락 시 즉시 생성) → `_seed_rankings_if_empty` → `_scheduler.start()`. `reload(job_id)`로 설정 변경 시 리스케줄. 모든 잡은 `job_runs.record(...)`로 실행 기록을 남긴다.

## 핵심 데이터 흐름

### 리포트 생성 (`report_generator.generate_report`)

1. 종목 dict(ticker/market/exchange/competitors)에서 `_yf_sym`으로 yfinance 심볼 산출.
2. `ThreadPoolExecutor(max_workers=8)`로 quote/financials/annual/analyst/RSI/finviz/news/경쟁사 시세를 병렬 fetch(yfinance `_t.history`/`_t.info`는 thread-unsafe라 executor 외부 직렬 호출).
3. RSI 블록·볼륨프로파일·20일 고점 대비 낙폭·PER/PBR 계산, 종목의 AI enrich 필드(moat/growth_plan/risks/insights 등)를 병합해 `summary` dict 조립.
4. `_sanitize`(NaN/Inf 제거) 후 `backend/snapshots/{ticker}/{date}.json` 파일 + `snapshots` 테이블(`ON CONFLICT (ticker,date) DO UPDATE`)에 저장.
5. 스케줄러는 생성 후 `_pipeline.run_daily(stocks)`로 컨센서스 마트를 갱신.

### 컨센서스 → daily_consensus_mart 파이프라인 (`consensus_pipeline`)

1. **수집**: `upsert_raw_reports(ticker, market, days)`가 KR(FnGuide 우선, Naver Research 폴백) / US 원천 리포트를 `_score`로 5점 표준화해 `raw_reports` 테이블에 UPSERT.
2. **집계**: `refresh_mart(ticker, base_date)`가 `raw_reports`를 base_date 기준으로 집계해 `daily_consensus_mart`(avg_target_price/high/low, avg_opinion_score, analyst_count, buy/hold/sell_count)에 UPSERT. KR은 추가로 `get_analyst_data_kr`의 target_mean으로 avg_target_price를 덮어쓴다.
3. **일별/백필**: `run_daily`(스케줄러), `backfill`(최초·재적재, raw 최이른 날짜~오늘 마트 재계산).
4. **읽기 정본(ADR-0008)**: 목표가·의견수는 `consensus.get_asof`/`apply_asof`(mart as-of-date → `consensus_history` 폴백)가 단일 정본. 리포트 목록·단건·히스토리(`get_mart_history`) 모두 이 경로를 사용한다.

## 프론트엔드

React 18 + Vite SPA, 순수 CSS(TailwindCSS 없음).

- **진입점**: `frontend/src/main.jsx` → `App.jsx`. `App`이 OAuth 콜백 토큰 교환 + localStorage 세션 부트스트랩 후, 세션 없으면 `<LoginPage>`, 있으면 `ToastProvider → AuthProvider → BrowserRouter` 트리를 렌더.
- **라우팅**: `App.jsx`의 `<Routes>` — `/`(Portfolio), `/research`(Research 허브), `/market`(MarketHub), `/guru`, `/settings`, `/admin-analytics`, `/dev/showcase`, `/analysis`→`/` 리다이렉트. `TopNav`는 `useAuth()`의 `menuPermissions`로 nav를 필터링하고 role==='admin'일 때 '행동' 탭 추가.
- **허브 패턴**: `Research`는 리포트/랭킹/다이제스트/캘린더 탭(`Reports`/`Ranking`/`Digest`/`Calendar`), `MarketHub`는 `Market`, `Portfolio`는 보유/관심/대시보드/분석 탭(분석 하위탭: 섹터/매크로/상관관계 = `SectorTab`/`MacroTab`/`Analytics`).
- **API 클라이언트**: `frontend/src/api.js` — axios 인스턴스(`baseURL = VITE_API_BASE_URL || ''`). 요청 인터셉터가 localStorage `access_token`을 `Authorization: Bearer`로 주입, 응답 401 시 토큰 제거 후 `/`로 리다이렉트.
- **AuthContext**: `frontend/src/contexts/AuthContext.jsx` — 로그인 시 `GET /api/auth/me`로 `role`·`menu_permissions` 로드, nav 필터링에 사용.
- **컴포넌트 그룹**: `components/reports/`(리포트 상세 탭·차트·컨센서스), `components/market/`(시장지표 섹션), `components/ui/`(Badge/Button/Card/Stat/icons), `components/portfolio/`(DashboardCard).

## 요청 흐름 nginx → backend

- 외부 트래픽: Cloudflare Tunnel(`portfolion.taebro.com`) → `localhost:80`(nginx).
- `nginx/nginx.conf`(listen 80): `/api/` 및 `/health`는 `proxy_pass http://backend:8000`(X-Forwarded-* 헤더 전달). `index.html`·서비스워커는 캐시 금지, Vite 해시 정적 자산은 장기 immutable 캐시, 나머지는 `try_files $uri /index.html`(SPA 폴백). 프론트는 `./frontend/dist`를 nginx가 직접 서빙.
- 로컬 개발: Vite dev 서버(5173)가 `/api`를 `http://localhost:8000`으로 프록시(`frontend/vite.config.js`).

## 데이터 모델 (스냅샷/마트 개요)

- **저장소**: Docker PostgreSQL이 기본. `auth_schema.sql`(users, refresh_tokens) → `app_schema.sql`(앱 테이블) 순서로 적용. 로컬 JSON 파일은 런타임 캐시/정적 참조 데이터용.
- **snapshots**: per-ticker, per-date 리포트 JSON(`ticker, date, data`). 종목 데이터·시세·재무·컨센서스 등의 그날 동결 스냅샷.
- **raw_reports**: 종목별 원천 애널리스트 리포트(opinion 5점 표준화 포함). 컨센서스 수집 단계의 적재 테이블.
- **daily_consensus_mart**: ticker+base_date 집계 마트(목표가 avg/high/low, 의견점수, 애널리스트·buy/hold/sell 수). 목표가·의견수 표시의 정본(ADR-0008), `consensus_history`는 레거시 폴백.
- 기타 도메인 테이블: tickers, user_stocks, schedules/guru_schedules/batch_schedules, digests, calendar_cache, market_cache, user_menu_permissions/default_menu_permissions, user_events, market_leverage_indicators, market_lending_balance, backlog_history, market_rankings, market_investor_trend, job_runs.

---
last_mapped_commit: f835958b49b4a4d7ce30254fd610ed6362462311
mapped: 2026-06-22
---

# ARCHITECTURE

PortfoliOn은 Python/FastAPI 백엔드(포트 8000)와 React 19 + Vite 프론트엔드(포트 5173)를 PostgreSQL 16 위에 올린 분리형(2-tier) 애플리케이션이다. 배포는 Mac 로컬 Docker 4-컨테이너(nginx · backend · postgres · certbot)이며 nginx가 정적 프론트 번들을 서빙하고 `/api/*`를 backend로 프록시한다.

## Backend overall pattern

전형적인 layered FastAPI 구조다.

- **App entry** — `backend/main.py`. `FastAPI(...)` 인스턴스를 만들고 미들웨어(SessionMiddleware, `backend/middleware/event_tracker.py`의 `EventTrackerMiddleware`, CORSMiddleware)를 등록한 뒤 17개 라우터를 `app.include_router(...)`로 마운트한다. `lifespan` 컨텍스트(`backend/main.py:145`)에서 `_migrate()`(기동 시 idempotent `CREATE TABLE IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS` DDL), `scheduler.start()`, 그리고 캘린더·시장지표 캐시 워밍 스레드를 띄운다. `/health` 라우트는 entry 파일에 직접 정의.
- **Routers (HTTP 표면)** — `backend/routers/`. 각 파일이 `APIRouter(prefix="/api", ...)`를 export. 라우터는 인증 게이팅(`backend/auth.py`의 `get_current_user`/`require_admin`/`get_current_user_or_api_key` Depends)과 요청/응답 직렬화만 담당하고, 실제 로직은 services로 위임한다. 라우터 목록: `portfolio.py` · `watchlist.py` · `stocks.py` · `report.py` · `guru.py` · `calendar.py` · `digest.py` · `analytics.py` · `analysis.py` · `auth.py` · `admin.py` · `events.py` · `rankings.py` · `investor.py` · `short_sell.py` · `batches.py` · `recommendations.py` · `market_indicators.py`.
- **Services (비즈니스 로직)** — `backend/services/`. 외부 API 연동, 계산, 영속화가 여기 모인다. 핵심: `storage/`(포트폴리오/스케줄 CRUD), `market/`(시세·재무·차트 소스 체인), `report_generator.py`(스냅샷 생성), `indicators.py`(RSI/매물대), `consensus.py`·`consensus_pipeline.py`(컨센서스 수집/집계), `kiwoom/`·`kis/`(KR/US 시세 백업 소스), `market_indicators/`(거시·시장지표), `recommendation/`(추천 스코어링), `cache.py`(인메모리 캐시), `db.py`(DB 풀), `job_runs.py`(배치 실행 기록), `batch_registry.py`(배치 정적 메타).
- **Scheduler** — `backend/scheduler/` 패키지. `__init__.py`가 `start()`/`stop()`/`reload(job_id)`를 export하고 APScheduler `BackgroundScheduler`(`scheduler/_state.py`의 `_scheduler`)를 구동한다. 배치 함수는 `scheduler/jobs.py`, 트리거/시드/누락복구는 `scheduler/schedule.py`.
- **DB 접근** — `backend/services/db.py`. psycopg2 `ThreadedConnectionPool`(minconn=1, maxconn=20, `DATABASE_URL`)을 lazy 싱글톤으로 만들고 `query(sql, params)`(SELECT→dict 리스트)·`execute(sql, params)`(쓰기→rowcount)·`get_connection()` 컨텍스트매니저를 노출. 모든 services가 이 세 함수만 import해 raw SQL을 직접 쓴다(ORM 없음).

### 인증

`backend/auth.py` — HS256 JWT Bearer(`JWT_SECRET`)를 `jose.jwt.decode`로 검증해 `payload["sub"]`(user_id) 반환. `get_current_user_or_api_key`는 `X-API-Key` 헤더(`COWORK_API_KEY`)로 외부 Cowork 클라이언트도 인증(sentinel user_id `__api_key__`). `require_admin`은 user role을 `users` 테이블에서 조회해 admin만 통과.

### 패키지화된 services (ADR-0017 표면 보존 패턴)

`storage`, `market`, `market_indicators`는 원래 단일 파일이었다가 패키지로 분리됐다. 각 `__init__.py`가 서브모듈의 공개·내부참조 심볼을 전부 루트로 re-export해 `storage.X` / `market.X` 모듈-속성 접근을 보존한다(`backend/services/storage/__init__.py`, `backend/services/market/__init__.py`, `backend/services/market_indicators/__init__.py`).

## Frontend overall pattern

Vite 빌드 React SPA. 라우팅은 `react-router-dom` `BrowserRouter`(`frontend/src/App.jsx`).

- **Entry** — `frontend/src/main.jsx` → `App.jsx`. `App`이 OAuth/토큰 부트스트랩(URL 쿼리 `oauth`/`token`/`refresh` 처리, localStorage 토큰), `ToastProvider` → `AuthProvider` → `BrowserRouter` 트리를 구성. 로그인 안 됐으면 `LoginPage`만 렌더.
- **HTTP 클라이언트** — `frontend/src/api.js`. axios 인스턴스(baseURL `VITE_API_BASE_URL`, 미설정 시 상대경로). request 인터셉터가 localStorage `access_token`을 `Authorization: Bearer`로 주입, response 인터셉터가 401 시 토큰 제거 후 `/`로 리다이렉트.
- **인증 컨텍스트** — `frontend/src/contexts/AuthContext.jsx`. 로그인 시 `GET /api/auth/me`로 `role`·`menu_permissions`를 로드해 컨텍스트로 제공. `App.jsx`의 `TopNav`가 이 값으로 nav 탭(리서치/포트폴리오/시장/구루/설정 + admin 전용 행동)을 필터링.
- **Pages & Hubs** — `frontend/src/pages/`(23개 .jsx). 화면은 두 허브로 묶인다: **Research**(홈 `/`, `Research.jsx`)가 Reports·Recommendations·Ranking·Digest·Calendar를 탭으로 합성, **MarketHub**(`/market`, `MarketHub.jsx`)가 `Market.jsx`(시장지표/수급지표)를 감싼다. 각 탭은 독립 페이지 컴포넌트(`Reports.jsx`, `Ranking.jsx`, `Calendar.jsx`, `Digest.jsx`, `Recommendations.jsx`, `Market.jsx`)로 존재한다. 그 외 라우트: `/portfolio`(Portfolio), `/guru`(Guru), `/settings`(Settings), `/admin-analytics`(AdminAnalytics).
- **Components** — `frontend/src/components/`. 도메인별 하위 디렉터리(`portfolio/`, `reports/`, `market/`, `recommendations/`, `ui/`)와 공용(StockModal, PromoteModal, MobileNav, Toast 등).
- **Hooks** — `frontend/src/hooks/`. 데이터 fetch/상태 훅(`usePortfolioData`, `useReportList`, `useReportFilters`, `useStockManagement`, `useReportGeneration`, `usePriceFlash` 등)과 UI 훅(`useTheme`, `useIsMobile`).
- **모바일/PC 분기** — 다수 페이지가 `useIsMobile`로 모바일 전용 레이아웃(seg 탭/appbar)과 PC 레이아웃을 분기.

## 데이터 흐름: request → quote → snapshot

1. **종목 등록** — 프론트(`StockModal`)가 `POST /api/portfolio` 또는 `/api/watchlist`로 종목을 보내면 `storage`(`backend/services/storage/portfolio.py`의 `save_holdings`/`save_stocks`)가 공유 마스터 `tickers`와 사용자별 `user_stocks`를 UPSERT. 표시명은 `market.resolve_name`이 시세 quote의 실명으로 채운다.
2. **라이브 시세 (대시보드 핫패스)** — 프론트 `usePortfolioData`가 `GET /api/portfolio`(종목 목록) 직후 `GET /api/portfolio/prices`를 호출. 백엔드는 `market.get_quotes_batch`(`backend/services/market/__init__.py:139`)로 US는 `yf.download` 1콜, KR은 `_kr_closes_kiwoom` 종가 시리즈로 price/변동률을 산출(이 핫패스는 발산 가드를 안 탄다).
3. **리포트 스냅샷 생성** — 스케줄러(또는 admin 수동 트리거)가 `report_generator.generate_report(stock)`(`backend/services/report_generator.py:49`)를 호출. 내부에서 `ThreadPoolExecutor`로 `market.get_quote`(현재가, KR은 `regular=True`=KRX 정규장), `get_financials`/`get_annual_financials`, `get_analyst_data`, `indicators.get_timeframe_rsi`, `scraper`(Finviz·뉴스), 경쟁사 quote를 병렬 수집해 단일 `summary` dict로 조립한다. `services.utils.sanitize`로 NaN/inf를 제거한 뒤 (a) `snapshots/{ticker}/{date}.json` 파일과 (b) PostgreSQL `snapshots` 테이블(`INSERT ... ON CONFLICT DO UPDATE`) 양쪽에 저장.
4. **리포트 조회** — 프론트 Reports 탭이 `GET /api/report/list`(슬림 요약, `report.py:_slim_summary`)와 상세 엔드포인트를 호출. 백엔드는 `cache.get_snapshot`(LRU)·`cache.get_list`(TTL)로 응답. 종목 추가/수정/삭제 시 `cache.invalidate(ticker)`가 snapshot LRU + dashboard/correlation/sector/macro 캐시를 무효화.
5. **컨센서스** — `consensus_pipeline.run_daily(stocks)`가 일일 리포트 배치에 내장(별도 잡 없음)되어 raw opinion을 5점 점수로 표준화→`consensus_history`/`daily_consensus_mart`에 적재. 목표가 정본은 `daily_consensus_mart`로 일원화.

## 배치 / 스케줄러 흐름

- **레지스트리** — `backend/services/batch_registry.py`의 `BATCHES` 리스트가 모든 배치(약 20개)의 정적 메타(`id`, `label`, `editable`, `default_schedule`, `market`(KR/US/공통), `source`, `usage`, `timezone`, `misfire_grace_time`)를 보유. `GET /api/batches`(`routers/batches.py`)가 이를 실행 이력(`job_runs`)과 합쳐 현황 허브에 노출.
- **기동 시퀀스** — `scheduler.start()`(`backend/scheduler/__init__.py:57`)가 ① `_seed_batch_schedules()`(편집 배치에 `batch_schedules` 행이 없으면 시드, 레거시 `schedules`/`guru_schedules`에서 거동 승계) ② 편집 가능한 각 배치를 `_reschedule_job(id)`로 등록 ③ `_check_missed_report()`(기동 시 당일 스케줄이 지났는데 스냅샷이 빠진 종목 즉시 재생성) ④ `_seed_rankings_if_empty()`·`_seed_kr_sector_if_empty()`(빈 캐시 적재) ⑤ `_scheduler.start()`.
- **잡 정의** — `backend/scheduler/jobs.py`. `_JOB_FUNCS` 매핑이 job_id→함수. 각 잡은 `with job_runs.record(job_id, "auto"):` 블록으로 실행 이력을 남긴다(`backend/services/job_runs.py`).
- **시장별 분리** — 일일 리포트는 `daily_report_kr`(KST 20:30, NXT 마감 후)·`daily_report_us`(KST 07:00)로 분리(`_generate_kr`/`_generate_us`, ADR-0012). 실적은 `earnings_kr`/`earnings_us`, 월간 지표는 `monthly_kr`(KR 수출)/`monthly_us`(FRED)로 분리(ADR-0013). 그 외 배치: `daily_digest`, `guru_crawl`, `macro_signals_fetch`, `leverage_fetch`, `lending_fetch`, `backlog_fetch`, `disclosure_fetch`, `insider_fetch`, `dividend_fetch`, `kr_rankings`/`us_rankings`, `investor_trend`, `short_sell`, `supply_score`, `recommendation_kr`/`recommendation_us`, `kr_sector_fetch`.
- **트리거** — `scheduler/schedule.py`의 `_build_trigger`가 `services.schedule_spec.build_trigger_kwargs`로 weekly cron 스펙을 APScheduler `CronTrigger`로 변환. 스케줄 변경 시 `reload(job_id)`로 리스케줄.
- **배치-백킹 뷰 원칙** — 랭킹·KR 업종 모멘텀 등은 배치가 사전계산해 `market_cache`/전용 테이블에 저장하고 요청은 저장값만 읽는다(요청 경로에서 외부 API 라이브 호출 금지).

## 시장 데이터 소스 체인

진입점은 `backend/services/market/__init__.py`이며 시장별로 분기한다.

### KR 시세 체인 (키움 → KIS → Naver)

`get_quote_kr`(`backend/services/market/kr.py:218`)가 소스를 선택한다. `regular` 플래그로 두 기준이 갈린다(ADR-0020):

- **리포트 스냅샷 (`regular=True`, KRX 정규장)** — `_kr_pick_regular`: 키움(KRX 평문코드)→KIS→Naver 첫 유효 소스 + `_price_sane`(전일종가 ±30% · 키움 일봉 종가 2배 교차검증) 가드.
- **라이브 대시보드 (`regular=False`, NXT `_AL`)** — `_kr_pick_basic`: 키움 NXT(`_AL`)와 키움 KRX 2피드의 `_corroborated_pick`(2-of-N 다수결); 불일치 시 KIS·Naver를 escalate해 최대 4피드 다수결로 outlier(글리치) 폐기(task#98).

개별 소스 어댑터: `_kr_basic_kiwoom`(키움 ka10001, `regular`로 KRX/NXT), `_kr_basic_kis`(KIS 국내 현재가), `_kr_basic_naver`(Naver `m.stock.naver.com/api/stock`). 섹터/업종은 키움에 TR이 없어 yfinance로 보완. 키움 코드 선택 단일 분기점은 `kiwoom/client.py`의 `integrated_code(stk_cd, regular)`(기본 `_AL`, `regular=True`면 평문 KRX).

### US 시세 체인 (yfinance → KIS)

`_get_quote_uncached`(`backend/services/market/__init__.py:65`)가 US는 `yf.Ticker(...).info`/`.history`로 1차 조회, 실패하거나 시세가 비면 `_us_quote_kis`(`backend/services/market/us.py`)로 KIS 백업 폴백(ADR-0011). 근거: yfinance가 전체 US 티커·섹터/시총/배치 1콜을 주는 반면 KIS US는 가격 위주라 백업이 적정.

### 키움 / KIS 클라이언트

- **키움** — `backend/services/kiwoom/`. `client.py`(`KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY` 토큰 인프로세스 싱글톤, `request(api_id, body, category)` 직렬 throttle, 401 재시도), `quote.py`(ka10001 현재가), `chart.py`(ka10081/82/83 일·주·월봉), `sector.py`(ka20006/ka20002 업종 모멘텀), `investor.py`(수급), `shortsell.py`(공매도). KR 전용·읽기전용(ADR-0009).
- **KIS** — `backend/services/kis/`. `client.py`(`KIS_APP_KEY`/`KIS_APP_SECRET`/`KIS_BASE_URL` 토큰, 발급 1분 1회 EGW00133 가드, `rt_cd≠"0"`→예외), `quote.py`(`get_quote_kr` 국내 `FHKST01010100`, `get_quote_us` 해외 EXCD probe). KR+US 읽기전용 백업(ADR-0011).
- 두 클라이언트 모두 `configured()`가 False(키 미설정)면 휴면 — 키 없이도 무해하게 폴백한다.

### 차트 / 지표 / 기타 소스

- `get_history_df`(`market/__init__.py:195`) — OHLCV DataFrame. KR은 키움(`chart.history_df`) 우선, 실패 시 yfinance 폴백. 리포트 스냅샷은 `regular=True`(KRX 정규장).
- `indicators.py` — RSI 계산(`calc_rsi`/`calc_rsi_target_price`)과 매물대(`get_volume_profile`).
- `market_indicators/` — FX/VIX(`fx.py`), 원자재/국채(`commodities.py`), 실적(`earnings.py`), FRED 경제지표(`econ.py`), KR 수출(`exports.py`), FRED 매크로 신호(`macro.py`). 모두 `cache.py`의 `_mc_load`/`_mc_save`로 PostgreSQL `market_cache`에 증분 저장하고 요청은 저장값만 읽는다.
- 보조 외부 소스: FnGuide(`kr.py`의 시총·애널리스트), Finviz(`scraper.py` US 컨센서스), DART(`backlog.py`/`disclosures.py`/`insider_trades.py`/`dividends.py`, `DART_API_KEY`), KOFIA/공공데이터(`leverage_service.py`/`lending_service.py`, `KOFIA_API_KEY`).

## 캐시 계층

- **인메모리** — `backend/services/cache.py`. snapshot LRU, list(TTL 60s), dashboard(TTL 300s), correlation(TTL 300s) 등. `market/__init__.py`의 `get_quote`는 `cache.get_quote_cached`로 종목·`regular` 키 단위 TTL 캐시(레이트리밋 방어). 종목 변경 시 `cache.invalidate`가 연쇄 무효화.
- **PostgreSQL 영속 캐시** — `market_cache`(시장지표), `calendar_cache`, 사전계산 테이블(`market_rankings`, `market_investor_trend`, `stock_recommendations`, `daily_consensus_mart` 등).
- **로컬 파일 캐시(gitignored)** — `backend/data/consensus/`(per-ticker), `backend/data/calendar/`(월별), `backend/snapshots/`(스냅샷 JSON, DB와 dual-write).

## 핵심 추상화 요약

- `services.db.query`/`execute` — 모든 DB 접근의 단일 통로(raw SQL, ORM 없음).
- `services.storage` — 포트폴리오/스케줄 영속화 파사드.
- `services.market.get_quote`/`get_quotes_batch`/`get_history_df` — 시장 데이터 진입점(소스 체인 은닉).
- `services.report_generator.generate_report` — 스냅샷 조립(병렬 fetch → sanitize → dual-write).
- `services.batch_registry.BATCHES` + `services.job_runs.record` + `scheduler` — 배치 메타·실행·스케줄 삼각 구조.
- 프론트: `api.js`(axios) + `AuthContext`(권한) + 허브 페이지(탭 합성) + hooks(데이터 fetch).

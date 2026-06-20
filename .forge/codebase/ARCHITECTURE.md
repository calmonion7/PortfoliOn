---
last_mapped_commit: 53b30e71425b810f8ce3edc33b2767b1be2e242c
mapped: 2026-06-20
---

# ARCHITECTURE

PortfoliOn은 Python/FastAPI 백엔드(`backend/`, 포트 8000)와 React 19 + Vite 프론트엔드(`frontend/`, 포트 5173)로 구성된 단일 레포 풀스택 앱이다. 저장소는 Docker PostgreSQL 16, 외부 시세는 키움/KIS/yfinance/Naver, 배포는 Mac 로컬 Docker 4-컨테이너(nginx·backend·postgres·certbot) + Cloudflare Tunnel.

## 전체 패턴

요청 흐름은 **routers → services → db** 3-레이어 단방향이다.

- `backend/routers/*.py` — HTTP 표면(엔드포인트). 인증 게이팅, 요청/응답 스키마 처리. 비즈니스 로직은 services에 위임. 모든 라우터는 `APIRouter(prefix="/api", ...)`를 쓴다.
- `backend/services/*.py` (+ 서브패키지) — 도메인 로직, 외부 API 연동, 캐싱, 영속화.
- `backend/services/db.py` — psycopg2 `ThreadedConnectionPool`(minconn=1, maxconn=20) 위의 얇은 헬퍼. `query(sql, params)`(SELECT→dict 리스트), `execute(sql, params)`(INSERT/UPDATE/DELETE→rowcount), `get_connection()`(컨텍스트 매니저, 정상 시 commit·예외 시 rollback). 모든 SQL은 이 3개 함수만 통과한다. `DATABASE_URL` env로 연결.

프론트는 **hub 페이지 → 탭(개별 페이지) → 컴포넌트** 구조. 라우팅은 `react-router-dom` 5개 nav(리서치/포트폴리오/시장/구루/설정)이고, 각 hub가 내부에서 탭 상태로 하위 페이지를 스위칭한다.

## 엔트리 포인트

- `backend/main.py` — FastAPI 앱 생성. `lifespan`에서 ① `_migrate()`(기동 시 idempotent `CREATE TABLE IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS` DDL — 배포가 자동 적용; `backlog_history.segments`, `batch_schedules`, `market_short_sell`, `stock_disclosures`, `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations` 등) ② `sched.start()`(스케줄러 기동) ③ 캘린더/시장 캐시 워밍 데몬 스레드. 미들웨어: `SessionMiddleware`(OAuth용), `EventTrackerMiddleware`(`backend/middleware/event_tracker.py`, 사용자 행동 로그), `CORSMiddleware`. 17개 라우터를 `include_router`로 마운트하고 `/health` 엔드포인트 제공.
- `backend/scheduler/` — APScheduler 패키지(`__init__.py`의 `start()`/`stop()`/`reload(job_id)`). 기동 시 `_seed_batch_schedules()` → `batch_registry.BATCHES` 중 `editable` 잡을 `_reschedule_job` → `_check_missed_report()`(시장별 미생성 리포트 복구) → `_seed_rankings_if_empty()`/`_seed_kr_sector_if_empty()`(빈 캐시 시드) → `_scheduler.start()`.
- `frontend/src/main.jsx` — `createRoot`로 `<App/>` 렌더(StrictMode). `styles/tokens.css` + `index.css` 로드.
- `frontend/src/App.jsx` — `BrowserRouter` + `Routes`. `AuthProvider`/`ToastProvider`로 감싸고, OAuth 콜백(`?oauth=`/`?token=`/`?refresh=`) 처리, `localStorage` access/refresh 토큰 관리, 미인증 시 `LoginPage` 렌더. 5개 nav 탭은 `menuPermissions`로 필터(admin은 `행동` 탭 추가).

## 레이어별 책임

### 라우터 (`backend/routers/`)
17개 라우터: `auth`, `portfolio`, `report`, `watchlist`, `stocks`, `guru`, `calendar`, `digest`, `market_indicators`, `analytics`, `analysis`, `events`, `rankings`, `investor`, `short_sell`, `batches`, `recommendations`, `admin`. 라우팅 순서 주의 — `PUT /api/stocks/enrich/batch`는 `PUT /api/stocks/{ticker}/enrich`보다 **먼저** 등록(FastAPI가 `enrich`를 ticker로 오인 방지). `GET /api/report/{ticker}/backlog` 같은 구체 경로는 catch-all보다 앞.

### 서비스 (`backend/services/`)
도메인별 모듈 + 서브패키지(아래 캐싱·시세·배치 절 참조). `errors.py`(예외), `utils.py`(NaN/Inf sanitize), `parallel.py`(ThreadPool 헬퍼), `progress.py`(진행률), `schedule_spec.py`(스케줄 직렬화), `job_runs.py`(배치 실행 이력 `job_runs.record(id, lane)`).

### 저장 (`backend/services/storage/`)
`storage`는 패키지(ADR-0017)다. `__init__.py`가 하위 모듈(`portfolio.py`·`names.py`·`schedule.py`·`dates.py`)의 전 심볼을 re-export — 외부는 `storage.X` 모듈 속성으로 조회하므로 루트에 전부 존재해야 한다. `db`의 `get_connection`/`query`/`execute`도 표면 보존을 위해 re-export.

## 데이터 모델 — 스냅샷/리포트

- `snapshots` 테이블(공유, per-ticker·per-date JSON) — 일일 리포트 배치(`report_generator`)가 시장 데이터 스냅샷을 박제. **백엔드에 LLM 호출 없음**(`requirements.txt`에 anthropic 없음) — AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API로 작성(`CLAUDE_COWORK_API.md`).
- `backend/snapshots/`(파일, gitignored, per-ticker/date) + `backend/reports/`(legacy read-only) — JSON 폴백.
- `raw_reports` — 종목별 원본 AI 리포트 텍스트.

## 캐싱 레이어 (`backend/services/cache.py`)

인메모리 캐시 다종(`TTLCache`/LRU `OrderedDict`):
- `_snapshots`(LRU, max 50) — snapshot
- `_list_cache`(TTL 60s) — 리포트 목록
- `_dashboard_cache`(TTL 300s) — per-user 대시보드
- `_correlation_cache`/`_sector_cache`/`_macro_cache`(TTL 300s) — 분석탭(sector는 `user_id:market` 키)
- `_quote_cache`(TTL 60s) — 시세
- `_live_prices_cache`(TTL 15s) — 장중 자동폴링 `/api/portfolio/prices`(다중 탭/사용자가 단일 키움 자격증명 레이트리밋을 안 치게 상한)

종목 추가/수정/삭제 시 `invalidate(ticker)`가 snapshot·list·dashboard·correlation·sector·macro·live_prices를 일괄 무효화. storage→cache는 순환참조 회피용 지연 import.

## 배치 precompute → 요청 read 경계 (핵심 규칙)

배치-백킹 뷰(랭킹·KR 업종 모멘텀·추천·수급·시장지표 등)는 외부 API(키움 등)를 **요청/기동 경로에서 라이브 호출하지 않는다**. 배치가 사전계산해 `market_cache`/전용 테이블에 저장하고, **요청은 저장값만 읽는다**. 근거: 요청당 N콜 직렬은 수초 지연, 캐시 만료마다 재호출. 가드 원칙(CLAUDE.md): ① 외부 fetch 실패를 silent except로 삼키지 말고 로깅 ② 빈/all-None 결과를 캐시에 박제 금지(직전 양호값 유지) ③ 의심 트리거가 아니라 실패 클래스(all-None)를 가드. 기동 시 빈 캐시 적재는 `_seed_*_if_empty` 패턴.

- `market_cache` 테이블 — fx/vix/commodities/treasury/econ/m7/krtop2/krexports/macro_signals/랭킹/KR섹터 영구 캐시. `market_indicators/cache.py`의 `_mc_load`/`_mc_save`로 읽기/쓰기, 각 서브모듈이 `_merge_history`/`_yf_close_history`로 yfinance incremental fetch(마지막 날짜 이후만).
- 시계열/파생 전용 테이블 — `market_leverage_indicators`(신용잔고), `market_lending_balance`(대차잔고), `market_short_sell`(공매도), `consensus_history`/`daily_consensus_mart`(컨센서스), `stock_recommendations`(추천 점수), `stock_disclosures`/`stock_insider_trades`/`stock_dividends`/`backlog_history`(DART 파생), `stock_supply_score`(수급 점수).

## 배치 레지스트리 (`backend/services/batch_registry.py`)

`BATCHES` 리스트가 현황 허브가 노출하는 ~20개 배치의 정적 메타데이터(id·label·category·schedule_desc·usage·source·editable·market·default_schedule 등). `id`는 스케줄러 잡 id 및 `job_runs.record(id, ...)` 호출 id와 **반드시 일치**. `GET /api/batches`가 이 메타를 그대로 노출. 일일 리포트는 시장별 분리: `daily_report_kr`(20:30 KST)·`daily_report_us`(07:00 KST). 실적/월간도 분리: `earnings_kr`/`earnings_us`, `monthly_kr`/`monthly_us`. `market` 속성은 출처국 기준(FRED=US). `source`=fetch 출처, `usage`=소비 UI(반대 방향). 스케줄러 잡 함수는 `scheduler/jobs.py`의 `_JOB_FUNCS`에 등록.

## 종목명 dual-source 모델

종목명은 두 출처가 공존:
- `tickers.name` — 공유 마스터, 종목관리 목록이 live로 읽음.
- `snapshots.data.name` — 리포트 생성 시 박제, 리서치 목록·상세가 읽음.

이름 변경 시 **둘 다** 갱신해야 목록↔상세 일치(`storage.refresh_snapshot_names` 단건 / `reconcile_snapshot_names` 전체). DB만 바꾸면 list 캐시·snapshot LRU 탓에 미반영 → `cache.invalidate`+`invalidate_list()` 필수. 실명은 `market.resolve_name`이 quote(KR 키움 stk_nm/Naver·US yfinance shortName)에서 채움. 클로버 방지 가드: tickers UPSERT는 들어온 name이 NULL/빈값/티커와 같으면 기존 `tickers.name` 보존.

## 시세 소스 체인 (`backend/services/market/`)

- KR: 키움 → KIS → Naver(`market.get_quote_kr`, `_kr_basic_kiwoom`/`_kr_basic_kis`/`_kr_basic_naver`). 키움 1차(ADR-0009), KIS 백업(ADR-0011).
- US: yfinance → KIS(`market._get_quote_uncached` US 분기, `_us_quote_kis`). yfinance 1차(전 티커·섹터/시총/히스토리·배치 1콜), KIS 백업.
- 배치 시세: `get_quotes_batch`(yf.download/ka10081 일괄 1콜).
- 외부 시세 키 미설정은 안전 기본값(휴면) — 코드 머지 무해, 키 주입 시 활성.

## 프론트 hub 구조

- **리서치** (`/`, `pages/Research.jsx`) — 홈 hub. 탭: 리포트(`Reports`)·추천(`Recommendations`)·랭킹(`Ranking`)·캘린더(`Calendar`)·다이제스트(`Digest`). 리포트 탭이 보유/관심 종목 관리(라이브 P&L·편집·삭제·승격·추가)를 흡수.
- **포트폴리오** (`/portfolio`, `pages/Portfolio.jsx`) — 대시보드·분석 전용. 탭: 대시보드(`DashboardGrid`)·분석. 분석은 하위탭 섹터(`SectorTab`)·매크로(`MacroTab`)·상관관계(`Analytics`).
- **시장** (`/market`, `pages/MarketHub.jsx`) — `Market` 래핑. 시장지표·수급지표 2탭.
- **구루** (`/guru`, `pages/Guru.jsx`), **설정** (`/settings`, `pages/Settings.jsx`), **행동** (`/admin-analytics`, `pages/AdminAnalytics.jsx`, admin 전용). `/dev/showcase`는 컴포넌트 카탈로그(`Showcase.jsx`).

상태/데이터: `contexts/AuthContext.jsx`(로그인·menuPermissions·role), `hooks/`(usePortfolioData·useReportList·useReportGeneration·usePriceFlash·useIsMobile·useTheme·useAuth), `api.js`(axios 인스턴스 — Bearer 토큰 요청 인터셉터, 401 시 토큰 제거 후 `/` 리다이렉트). `utils/analytics.js`의 `trackEvent`가 행동 로그 전송.

## 데이터 흐름 요약

1. **읽기(목록·대시보드·시장지표·랭킹)**: 프론트 `api` → 라우터 → cache(인메모리) → storage/db(`market_cache`/테이블 저장값). 외부 API 라이브 호출 없음.
2. **시세(장중)**: `/api/portfolio/prices` → `_live_prices_cache`(15s) → `market.get_quotes_batch`(키움/yfinance 일괄).
3. **쓰기(종목 추가/enrich)**: 라우터 → storage(tickers/user_stocks UPSERT) → `cache.invalidate`.
4. **배치(precompute)**: APScheduler 잡(`scheduler/jobs.py`) → 외부 API fetch → 테이블/`market_cache` 저장 → `job_runs.record`로 실행 이력.
5. **리포트 생성**: `daily_report_kr/us` 배치 → `report_generator`(시장 데이터 스냅샷) → `snapshots` 테이블 + `consensus_pipeline.run_daily`. AI 텍스트는 외부 Cowork enrich.

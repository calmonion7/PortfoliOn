---
last_mapped_commit: a78576f706579812552909d53642d1ceccb6ff3a
mapped: 2026-06-20
---

# ARCHITECTURE

PortfoliOn은 Python/FastAPI 백엔드(포트 8000) + React 19/Vite 프론트(포트 5173) 2-tier 웹앱이다. 기본 저장소는 Docker PostgreSQL 16이며, 로컬 JSON 파일은 런타임 캐시 용도다.

## Overall pattern — 계층

요청 흐름은 **router → service → storage/db** 단방향이다.

- **router** (`backend/routers/`): FastAPI `APIRouter`. HTTP 입출력·인증 게이팅만 담당, 비즈니스 로직은 service로 위임. 모든 라우터는 `prefix="/api"`를 쓴다 (예: `backend/routers/report.py`의 `router = APIRouter(prefix="/api", tags=["report"])`).
- **service** (`backend/services/`): 도메인 로직·외부 API 연동·집계. LLM 호출 없음(하단 boundary 참조).
- **storage/db** (`backend/services/storage/`, `backend/services/db.py`): 영속 계층. `db.py`가 psycopg2 `ThreadedConnectionPool`(minconn=1, maxconn=20)을 싱글톤으로 들고, `query(sql, params)`(SELECT→dict 리스트)·`execute(sql, params)`(INSERT/UPDATE/DELETE→rowcount)·`get_connection()`(commit/rollback contextmanager)을 노출한다. `storage` 패키지는 이 위에 포트폴리오·이름·스케줄·날짜 도메인 함수를 얹는다.

## Entry points

### `backend/main.py`
앱 진입점. `lifespan` asynccontextmanager에서 ① `_migrate()`(idempotent `ADD COLUMN IF NOT EXISTS`/`CREATE TABLE IF NOT EXISTS` DDL — `backlog_history.segments`, `batch_schedules`, `market_short_sell`, `stock_disclosures`, `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations` 등을 기동 시 자동 적용) → ② `scheduler.start()` → ③ 캘린더/시장 캐시 워밍 백그라운드 스레드를 띄운다. 미들웨어는 `SessionMiddleware`(`SESSION_SECRET`) + `EventTrackerMiddleware`(`backend/middleware/event_tracker.py`) + `CORSMiddleware`(origins: `localhost:3000`, `localhost:5173`, `FRONTEND_URL`). 18개 라우터를 `include_router`로 마운트하고 `/health` 엔드포인트를 직접 정의한다.

`main.py`가 마운트하는 라우터: auth, portfolio, report, watchlist, stocks, guru, calendar, digest, market_indicators, analytics, analysis, events, rankings, investor, short_sell, batches, recommendations, admin.

### `backend/scheduler/` (패키지 — 구 `scheduler.py`에서 분리)
APScheduler `AsyncIOScheduler` 기반 배치 스케줄러. `import scheduler as sched`로 `main.py`가 사용. 패키지 구성:
- `backend/scheduler/__init__.py` — 공개 표면(`start`/`stop`/`reload`)과 모든 잡 함수·스케줄 헬퍼를 re-export. `start()`는 `_seed_batch_schedules()` → 편집 가능 배치 리스케줄 → `_check_missed_report()`(누락 리포트 복구) → `_seed_rankings_if_empty()`/`_seed_kr_sector_if_empty()`(빈 캐시 기동 시드) → `_scheduler.start()` 순서로 부팅.
- `backend/scheduler/_state.py` — 공유 상태/상수(`_scheduler` 인스턴스, `_DIGEST_JOB_ID`, `_VALID_DAYS`, `_DAY_MAP`). leaf 모듈로 두어 부분초기화 순환을 회피한다.
- `backend/scheduler/jobs.py` — 모든 잡 함수(`_generate_kr`/`_generate_us`, `_run_guru_crawl`, `_refresh_monthly_us`/`_kr`, `_refresh_earnings_us`/`_kr`, `_refresh_macro_signals`, `_run_digest`, `_fetch_leverage`/`_lending`/`_backlog`/`_disclosures`/`_insider`/`_dividends`, `_fetch_kr_rankings`/`_us_rankings`, `_fetch_investor_trend`, `_fetch_short_sell`, `_fetch_supply_score`, `_fetch_recommendation_kr`/`_us`, `_fetch_kr_sector` 등)와 잡 id→함수 매핑 `_JOB_FUNCS`, 시드 함수.
- `backend/scheduler/schedule.py` — 크론 트리거 빌드(`_build_trigger`), 리스케줄(`_reschedule_job`), 시드/누락복구(`_seed_batch_schedules`, `_check_missed_report*`). 스케줄 스펙은 `services/schedule_spec.py`의 `build_trigger_kwargs`로 변환.

## 핵심 데이터 모델 — snapshot / enrich / Cowork

종목 리포트는 **시장 데이터 스냅샷**과 **AI 분석 텍스트**가 분리된 dual-write 모델이다.

- **스냅샷(시장 데이터)**: `backend/services/report_generator.py`의 `generate_report(stock)`이 yfinance/키움/Naver 등에서 시세·재무·차트·지표를 모아 per-ticker·per-date JSON을 만들어 `snapshots` 테이블(`INSERT INTO snapshots (ticker, date, data)`)에 저장한다. 백엔드 리포트 생성은 시장 데이터 박제만 한다.
- **enrich(AI 텍스트)**: 외부 Claude Cowork 클라이언트가 enrich API(`CLAUDE_COWORK_API.md`)로 분석 텍스트(`moat`, `growth_plan`, `risks`, `recent_disclosures`, `insights` 등 `_ANALYST_KEYS`)를 `tickers` 마스터 행에 써넣는다. `storage/portfolio.py`의 `enrich_stock`이 진입점, `_JSON_TEXT_FIELDS`는 text 컬럼에 JSON 객체로 저장된 값을 `_parse_json_field`로 역파싱한다. enrich 시각은 `tickers.enriched_at`에 기록되어 리포트 상세에서 "마지막 업데이트" 표시에 쓰인다.
- 리포트 상세 조회(`GET /api/report/{ticker}/{date_str}`)는 snapshot(시장)과 `tickers`(enrich)를 합쳐 응답한다.

## Requests vs batches — precompute-then-read

배치-백킹 데이터(랭킹·KR 업종 모멘텀·추천·시장지표 등)는 **배치가 외부 API를 호출해 사전계산 → `market_cache`/전용 테이블에 저장**하고, **요청 경로는 저장값만 읽는다**(요청당 라이브 외부 호출 0). 요청·기동 경로에서 외부 API(키움 등)를 라이브로 부르지 않는 것이 규칙이다.

- 시장지표: `backend/services/market_indicators/`가 yfinance/FRED incremental fetch → `market_cache`(PostgreSQL) 영구 저장. `GET /api/market/*`는 저장값만 반환.
- 추천 엔진: `backend/services/recommendation/`(2단 깔때기·점진 유니버스·정량 플래그, LLM 0)이 배치로 점수를 사전계산해 `stock_recommendations`에 저장, `GET /api/recommendations`는 저장값만 읽는다.
- KR 업종 모멘텀: `kr_sector_service.py`가 키움 조회 TR로 전 업종 모멘텀을 배치 사전계산 → `market_cache`.
- 기동 시 빈 캐시는 `_seed_rankings_if_empty`/`_seed_kr_sector_if_empty`로 적재. 빈/all-None 결과는 캐시에 박제하지 않는다(직전 양호값 유지).

실시간성이 필요한 시세(포트폴리오 대시보드/가격)는 예외적으로 요청 경로에서 조회하되, `services/cache.py`의 짧은 TTL 캐시로 외부 rate-limit을 막는다.

## Cache layers — `backend/services/cache.py`

인메모리 캐시. `TTLCache`(ttl·maxsize) + 스냅샷 LRU(`OrderedDict`, `_MAX=50`)로 구성:

| 캐시 | 종류 | 무효화 |
|------|------|--------|
| snapshot (`_snapshots`) | LRU 50 | `invalidate(ticker)` |
| list (`_list_cache`) | TTL 60s | `invalidate_list()` |
| dashboard (`_dashboard_cache`) | TTL 300s, user별 | `invalidate_dashboard()` |
| correlation (`_correlation_cache`) | TTL 300s, user별 | `invalidate_correlation()` |
| sector (`_sector_cache`) | TTL 300s, `user_id:market` 키 | `invalidate_sector()` |
| macro (`_macro_cache`) | TTL 300s, user별 | `invalidate_macro()` |
| quote (`_quote_cache`) | TTL 60s, `ticker/market/exchange` 키 | `invalidate_quote()` |
| live_prices (`_live_prices_cache`) | TTL 15s, user별 (장중 폴링) | `invalidate_live_prices()` |

종목 추가/수정/삭제 시 `invalidate(ticker)`가 snapshot LRU + list + dashboard + correlation + sector + macro + live_prices를 일괄 무효화한다. `storage → cache`는 지연 import로 순환참조를 회피한다.

## Dual-source name model

종목 표시명은 두 곳에 저장된다:
- `tickers.name` — 공유 마스터. 종목관리 목록이 live로 읽음.
- `snapshots.data.name` — 리포트 생성 시 박제. 리서치 목록·상세가 읽음.

이름 변경 시 둘 다 갱신해야 목록↔상세가 일치한다. `backend/services/storage/names.py`가 동기화 담당: `refresh_snapshot_names`(단건 — `jsonb_set`으로 snapshot data.name 갱신), `set_ticker_name`(tickers.name + snapshot 동시), `reconcile_snapshot_names`(전체). DB만 바꾸면 list 캐시(60s TTL)·snapshot LRU 탓에 화면 미반영되므로 `_invalidate_name_caches`가 `cache.invalidate(ticker)` + `invalidate_list()`를 부른다. 추가/관심/승격 시 실명은 `market.resolve_name`이 quote(KR=키움 stk_nm/Naver, US=yfinance shortName)에서 채운다.

## No-LLM-in-backend boundary

백엔드에는 LLM/Anthropic 호출이 없다(`requirements.txt`에 anthropic 미포함). `report_generator`는 시장 데이터 스냅샷만 만든다. AI 분석 텍스트는 전적으로 외부 Claude Cowork 클라이언트가 enrich API로 작성·기록한다. `ANTHROPIC_API_KEY`는 환경에 남아있으나 백엔드에서 미사용.

## 시세 소스 체인 — `backend/services/market/` (패키지, 구 `market.py`)

`backend/services/market/__init__.py`가 `get_quote`/`get_quotes_batch`/`get_history_df`/`get_financials`/`get_analyst_data`/`resolve_name` 공개 표면을 들고, 서브모듈로 분리:
- `backend/services/market/format.py` — 정규화/포매팅 헬퍼(`_norm_sector`, `_to_won`, `_yf_sym`, `_fmt_market_cap` 등).
- `backend/services/market/kr.py` — KR 시세. `get_quote_kr`이 **키움 → KIS → Naver** 폴백 체인(`_kr_basic_kiwoom`/`_kr_basic_kis`/`_kr_basic_naver`).
- `backend/services/market/us.py` — US 시세. `_get_quote_uncached`의 US 분기가 **yfinance → KIS** 폴백.

외부 시세 어댑터는 `backend/services/kiwoom/`(KR 읽기전용 1차), `backend/services/kis/`(KR+US 읽기전용 백업)에 분리. 키 미설정 시 `configured()`가 False면 휴면(기존 동작 무변화).

## 배치 레지스트리 — `backend/services/batch_registry.py`

`BATCHES`는 배치 현황 허브가 노출하는 20개 배치의 정적 메타데이터(`id`, `label`, `category`, `schedule_desc`, `usage`(소비 UI), `source`(fetch 출처), `market`(KR/US/공통), `scheduler_job_id`, `default_schedule` 등). `job_id`는 스케줄러 잡 id 및 `services/job_runs.py`의 `record(id, lane)` 호출 id와 반드시 일치한다. `GET /api/batches`(`routers/batches.py`)가 이 메타와 실행이력을 합쳐 노출한다.

## NaN/inf 가드 (직렬화 경계)

starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 NaN/inf가 있으면 직렬화 500이 난다. PostgreSQL `json` 컬럼도 NaN을 거부한다. 외부 시세(yfinance Close NaN, FX NaN 등)에서 흘러든 NaN은 소스에서 `math.isfinite` 등으로 가드한다.

## Frontend 진입/흐름

`frontend/src/main.jsx` → `App.jsx`. `App.jsx`는 `BrowserRouter` + `ToastProvider` + `AuthProvider`(`contexts/AuthContext.jsx`)로 감싸고, OAuth 콜백 처리·localStorage 토큰 관리를 한다. 라우트: 홈 `/`(Research 허브), `/portfolio`(Portfolio), `/research`(Research 백워드 호환), `/market`(MarketHub 허브), `/guru`(Guru), `/settings`(Settings), `/admin-analytics`(AdminAnalytics, admin 전용), `/analysis`→`/portfolio` 리다이렉트. nav 순서(`TopNav` `allItems`·`MobileNav` `ALL_TABS` 동일): 리서치(`/`, key `research`, end:true)→포트폴리오(`/portfolio`, key `portfolio`)→시장→구루→설정. nav는 `AuthContext`의 `menuPermissions`로 필터링된다(필터 key는 `research`/`portfolio`/…). API 호출은 `VITE_API_BASE_URL`(미설정 시 상대경로) prefix + `/api/*`(로컬은 Vite proxy → :8000).

### 종목관리-리서치 통합 (task#76, ADR-0018)
홈을 Research 허브로 바꾸면서 **종목 관리(추가/편집/삭제/승격)가 리서치 리포트 탭으로 흡수**됐다(프론트 라우팅·페이지 역할 재배치만, 백엔드/API/DB/테스트 무변경).
- `frontend/src/pages/Reports.jsx`(Research 허브의 리포트 탭)가 **내 종목 단일 척추**. `useReportList`에 더해 `usePortfolioData()`도 호출해, 보유 카드에 라이브 P&L(수량·평단·손익)을 프론트에서 머지 표시한다(`pnlOf` 헬퍼, ticker `.upper()` 정규화, `category==='holdings'` 게이트). 종목 관리 핸들러·`StockModal`·`PromoteModal`·추가 FAB가 여기로 이동(전엔 Portfolio.jsx). 카드 본문 클릭=리포트 상세(`openDetail`), 액션 아이콘은 `stopPropagation`.
- `frontend/src/pages/Portfolio.jsx`는 보유/관심 목록·테이블·관리 모달·FAB가 제거되어 **대시보드·분석(섹터/매크로/상관관계) 집계 전용**으로 슬림화(기본 탭 `dash`). 상단 KPI 집계(`stocks` 기반 totalValue/totalPnl)·hero는 유지.
- 데이터 흐름 함의: `usePortfolioData`(보유 수량·평단·현재가·15초 폴링)를 이제 **Portfolio와 Reports 두 페이지가 공유**(동시 표시 안 됨). P&L은 프론트 머지라 백엔드 무변경.

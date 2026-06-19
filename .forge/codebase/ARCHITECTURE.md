---
last_mapped_commit: 163c29cbd89d9b1d2aa5a101670e9fa34ceb21c4
mapped: 2026-06-19
---

# ARCHITECTURE

PortfoliOn 백엔드(Python/FastAPI)와 프론트엔드(React 19 + Vite)로 구성된 2-티어 웹앱. 운영은 Mac 로컬 Docker 4-컨테이너(postgres / backend / nginx / certbot)이며 영속 저장소는 PostgreSQL 16이다.

## 엔트리 포인트

- **백엔드 앱 엔트리**: `backend/main.py` — `FastAPI(lifespan=...)` 인스턴스를 만들고 미들웨어·라우터를 마운트한다. uvicorn으로 기동(`python -m uvicorn main:app --reload --port 8000`).
- **백엔드 lifespan(`backend/main.py` `lifespan`)**: 기동 시 ① `_migrate()`(idempotent DDL, `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`로 테이블·컬럼 보강), ② `sched.start()`(APScheduler), ③ 백그라운드 스레드 2개(`_warm_calendar_cache`, `_warm_market_cache`)를 띄운다. 종료 시 `sched.stop()`.
- **프론트 엔트리**: `frontend/src/main.jsx` → `frontend/src/App.jsx`. Vite dev 서버(port 5173), 운영은 `frontend/dist`를 nginx가 직접 서빙.
- **시작 스크립트**: 루트 `start.sh`(macOS/Linux)·`start.bat`(Windows) — 백엔드·프론트 두 서버를 함께 띄운다. `stop.sh`/`stop.bat`로 종료.
- **컨테이너 구성**: `docker-compose.yml` — postgres(스키마 `backend/auth_schema.sql`→`backend/app_schema.sql` 순으로 init-db 마운트), backend(`backend/Dockerfile`, env `backend/.env.docker`), nginx(80/443, `frontend/dist`·`nginx/nginx.conf` 볼륨), certbot.
- **헬스체크**: `backend/main.py` `/health` (GET·HEAD).

## 레이어 구조 (백엔드)

요청 흐름은 **router → service → storage/db + cache** 의 단방향 의존이다.

1. **Router 레이어** (`backend/routers/`): FastAPI `APIRouter`. HTTP 엔드포인트 정의, 인증 의존성 주입, 요청 검증, 서비스 호출, 응답 조립. `backend/main.py`가 18개 라우터를 `include_router`로 마운트(`auth`, `portfolio`, `report`, `watchlist`, `stocks`, `guru`, `calendar`, `digest`, `market_indicators`, `analytics`, `analysis`, `events`, `rankings`, `investor`, `short_sell`, `batches`, `recommendations`, `admin`).
2. **Service 레이어** (`backend/services/`): 비즈니스 로직. 외부 시세/데이터 fetch, 계산, 캐싱 정책을 담는다. 라우터에서 `from services import ...`로 호출.
3. **Storage/DB 레이어**:
   - `backend/services/db.py` — psycopg2 `ThreadedConnectionPool`(minconn=1, **maxconn=20**) 싱글톤. `query(sql, params)`(SELECT→dict 리스트), `execute(sql, params)`(INSERT/UPDATE/DELETE→rowcount), `get_connection()`(commit/rollback 컨텍스트). maxconn=20은 calendar(15)·analysis(11) ThreadPool 동시성보다 크게 잡아 PoolError 회피.
   - `backend/services/storage.py` — 도메인 영속 계층(424줄). `user_stocks`(보유/관심)·`tickers`(공유 마스터)·스케줄·구루·배치 스케줄 read/write. `get_full_portfolio`·`get_all_stocks`·`enrich_stock`·`get_batch_schedule`/`save_batch_schedule` 등.
4. **인증** (`backend/auth.py`): FastAPI `Depends` 게이트. `get_current_user`(JWT Bearer → user_id), `get_current_user_or_api_key`(Cowork API 키 허용), `require_admin`(role 검증), `require_admin_or_api_key`. `backend/services/auth_service.py`가 토큰 발급·검증 로직.

### 미들웨어 (`backend/main.py` 마운트 순)

- `SessionMiddleware`(starlette, `SESSION_SECRET` — OAuth 세션).
- `EventTrackerMiddleware`(`backend/middleware/event_tracker.py`) — 사용자 행동 이벤트 수집.
- `CORSMiddleware` — origins: `localhost:3000`, `localhost:5173`, env `FRONTEND_URL`.

## 데이터 흐름

### 영속 + 캐시 3계층

요청 응답은 PostgreSQL(영속) + 인메모리 캐시(`backend/services/cache.py`) + 파일 캐시(`backend/data/`)를 조합한다.

- **인메모리 캐시** (`backend/services/cache.py`): `TTLCache` 클래스(TTL+maxsize) 기반 다종 캐시 — snapshot LRU(`OrderedDict`, max 50), list(TTL 60s), dashboard(300s), correlation(300s), sector(300s, 키 `user_id:market`), macro(300s), quote(60s), live_prices(15s). `invalidate(ticker)`가 종목 변경 시 snapshot·list·dashboard·correlation·sector·macro·live_prices를 연쇄 무효화. `invalidate_portfolio_caches()`는 calendar 파일 캐시까지 비운다.
- **파일 캐시** (`backend/data/`, gitignore): `calendar/`(월별 이벤트), `consensus/`(per-ticker), 그 외 정적 참조(`sp500_tickers.json`, `kospi_tickers.json`).

### 외부 시세 fetch 체인 (`backend/services/market.py`, 797줄)

마켓별로 소스 폴백 체인이 다르다.

- **KR 현재가** `get_quote_kr` → `_kr_basic_kiwoom` → `_kr_basic_kis` → `_kr_basic_naver` (키움 우선 → KIS 백업 → Naver). 부호·시총 억원 정규화 필수.
- **KR OHLCV** `get_history_df` / `_kr_closes_kiwoom` — 키움(ka10081/82/83) 우선, 실패 시 yfinance.
- **US 현재가** `_get_quote_uncached` US 분기 → yfinance(`yf.download`) 우선 → `_us_quote_kis`(KIS 백업).
- **배치 시세** `get_quotes_batch` — yfinance `yf.download` 1콜 일괄 + KR은 `_kr_closes_kiwoom`.
- `get_quote`는 `_quote_cache`(60s TTL)로 종목당 호출을 상한(rate-limit 방어).
- `resolve_name` — 종목명을 quote(KR 키움 stk_nm/Naver, US yfinance shortName)에서 채운다.
- 외부 시세 연동 패키지: `backend/services/kiwoom/`(KR 읽기전용, client/quote/chart/investor/sector/shortsell), `backend/services/kis/`(KR+US 읽기전용 백업, client/quote). 둘 다 `configured()` False면 휴면(키 미설정이 안전 기본값).

### 배치-백킹 뷰 패턴 (핵심 추상화)

외부 API를 무겁게 호출하는 뷰(랭킹·KR 업종 모멘텀·수급 스코어·추천 발굴 등)는 **배치가 사전계산해 테이블/`market_cache`에 저장하고, 요청·기동 경로는 저장값만 read**한다. 요청 경로 라이브 외부 호출 0이 원칙. 산출 실패(전부 None)면 save를 생략해 직전 양호값을 유지(all-None 박제 금지).

예: `backend/services/ranking_service.py`(market_rankings), `backend/services/kr_sector_service.py`(market_cache), `backend/services/supply_score.py`(stock_supply_score), `backend/services/recommendation/`(stock_recommendations).

## 스케줄러 + 배치 레지스트리 (핵심 추상화)

- **`backend/scheduler.py`** (루트 레벨, services 아님): `AsyncIOScheduler`(APScheduler). `_JOB_FUNCS` dict가 job_id → 실행 함수를 매핑(24개). 각 잡 함수는 `with job_runs.record(job_id, "auto"):` 컨텍스트로 실행 이력을 남기고 try/except로 실패를 로깅(silent except 금지).
  - `start()`: `_seed_batch_schedules()`(idempotent 마이그레이션) → 편집 배치 `_reschedule_job` → `_check_missed_report`(시장별 누락 리포트 복구) → `_seed_rankings_if_empty` → `_seed_kr_sector_if_empty` → 스케줄러 start.
  - 트리거는 `backend/services/schedule_spec.py` `build_trigger_kwargs`로 spec(weekly/daily) → `CronTrigger` 변환.
- **`backend/services/batch_registry.py`** (395줄): `BATCHES` 리스트 — 24개 배치의 정적 메타데이터(`id`, `label`, `category`, `usage`, `source`, `editable`, `trigger_kinds`, `manual_endpoint`, `scheduler_job_id`, `timezone`, `market`, `default_schedule`). `id`는 스케줄러 잡 id 및 `job_runs.record` 호출 id와 반드시 일치.
- **`backend/services/job_runs.py`**: `record(job_id, trigger)` 컨텍스트매니저(실행 시작/끝/에러 기록), `recent(job_id, n)`·`recent_map(job_ids)`(현황 조회).
- **`backend/routers/batches.py`**: `GET /api/batches`가 레지스트리 + `_next_run`(다음 실행 시각) + `job_runs.recent`(최근 실행로그) + 편집 배치 스케줄을 합쳐 현황 노출. `GET/PUT /api/batches/{job_id}/schedule`로 편집 배치 스케줄 조회/저장(저장 후 `scheduler.reload`).

### 시장별 배치 분리 패턴

일일 리포트·실적·월간 지표는 출처국 기준으로 KR/US 2배치로 분리: `daily_report_kr`(20:30 KST)/`daily_report_us`(07:00 KST), `earnings_kr`/`earnings_us`, `monthly_kr`/`monthly_us`. 추천도 `recommendation_kr`/`recommendation_us`로 분리. 시장 분류는 `scheduler._in_market`(KR=`market=="KR"`, US=그 외 전부).

## 추천/발굴 엔진 (`backend/services/recommendation/`)

2단 깔때기 + 정량 점수(백엔드 LLM 0). 패키지 `__init__.py`가 공개 API를 re-export.

- `universe.py` `build_universe` — 발굴 유니버스(KR 시총 상위 N + US S&P500 + 전 유저 추적종목 + US 구루 보유 합집합·dedup·ETF 제외).
- `funnel.py` `run_recommendation_batch(market)` — Stage-1(싼 시총·구루 멤버십 스크린, top-K=100) → Stage-2(후보 한정 OHLC 모멘텀·컨센서스 상승여력·KR 수급/지분공시·US 구루 신규매수 enrich) → `scoring.score_stock` → `store.replace_recommendations`. 저유동성 필터(`_is_low_liquidity`), all-None 가드(`_has_signal`).
- `scoring.py` `score_stock`/`derive_flags` — 밸류 0.35·모멘텀 0.35·스마트머니 0.30 투명 가중으로 0~100 합성(`FACTOR_WEIGHTS`), 결측은 가용분만으로 graceful degrade. 순수 함수(DB/네트워크 무의존). 플래그는 `{label, kind}` 페어만 내보내고 색은 프론트 결정.
- `actions.py` `derive_holding_action(score, weight_pct, pnl_pct)` — 보유 종목 추매/익절/홀딩 행동·한국어 사유 도출(순수 함수, 임계 상수 `HI_SCORE`/`LO_SCORE`/`ADD_WEIGHT_CAP`/`TAKE_PROFIT_PNL`).
- `store.py` `replace_recommendations`/`read_recommendations` — `stock_recommendations` 테이블 통째 교체 write / 필터 read(markets·exclude_tickers·only_tickers·limit·exclude_low_liquidity).
- 소비처 `backend/routers/recommendations.py` `GET /api/recommendations` — 저장값만 read해 3섹션(discovery=글로벌−추적종목, watchlist=관심종목, holdings=보유 액션)으로 분기. additive read(watchlist→holdings 순차)로 `_latest_snapshots`·`_usdkrw_rate`(저장값) 재사용해 요청경로 외부 호출 0.

## 리포트 생성 (`backend/services/report_generator.py`, 357줄)

`generate_report(stock)` — 시장 데이터 스냅샷(시세·재무·차트·RSI)을 만들어 `snapshots` 테이블에 per-ticker/per-date JSON으로 저장. **백엔드에 LLM/Anthropic 호출 없음** — AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API(`CLAUDE_COWORK_API.md`)로 채운다. `generate_report_with_retry`(외부 fetch 일시 실패 재시도), `backfill_ticker`(과거일 백필). 컨센서스는 `consensus_pipeline.run_daily`로 daily_report 배치에 내장.

## 프론트엔드 구조

- **엔트리/라우팅** (`frontend/src/App.jsx`): `BrowserRouter` + 5개 최상위 라우트 — `/`(Portfolio), `/research`(Research 허브), `/market`(MarketHub), `/guru`(Guru), `/settings`(Settings) + admin `/admin-analytics`, dev `/dev/showcase`. nav 탭은 `AuthContext`의 `menuPermissions`로 필터링.
- **인증 컨텍스트** (`frontend/src/contexts/AuthContext.jsx`): 로그인 시 `GET /api/auth/me`로 `role`·`menu_permissions`를 로드. `useAuth()` 훅으로 nav 필터링·admin 게이팅.
- **API 클라이언트** (`frontend/src/api.js`): axios 인스턴스. 요청 인터셉터로 `Authorization: Bearer <access_token>`(localStorage) 주입, 응답 401 시 토큰 제거 후 `/`로 리다이렉트. baseURL은 `VITE_API_BASE_URL`(미설정 시 상대경로).
- **데이터 흐름**: page → hook(`frontend/src/hooks/`, 예: `usePortfolioData`·`useReportList`·`useReportGeneration`) → `api` → 백엔드. 예: `frontend/src/pages/Portfolio.jsx`가 `usePortfolioData` 훅으로 대시보드를 읽고 `SectorTab`/`MacroTab`/`Analytics` 서브탭을 합성.
- **허브 패턴**: Research·MarketHub 페이지가 내부 탭으로 개별 페이지(Reports·Ranking·Calendar·Digest·Recommendations / Market·Analytics)를 합성. 추천(`Recommendations.jsx`)은 Research 허브의 `recommendations` 탭으로 마운트(App.jsx 직접 라우트 아님).
- **컴포넌트 그룹** (`frontend/src/components/`): 도메인별 서브디렉터리 — `market/`(시장지표 섹션), `reports/`(리포트 상세 탭/차트), `portfolio/`(대시보드 카드·시세 플래시), `recommendations/`(RecCard), `ui/`(Badge/Button/Card/Stat/icons — 디자인 시스템 프리미티브).
- **PWA**: `frontend/vite.config.js`가 `vite-plugin-pwa`로 서비스워커·매니페스트 생성. manualChunks는 **함수 형식**(Vite 8 rolldown 제약)으로 charts(recharts+d3)·markdown·vendor 청크 분할.

## 데이터 소비 계약 패턴 (구현 사실)

- **dual-source 종목명**: `tickers.name`(공유 마스터, 종목관리 목록이 live read) vs `snapshots.data.name`(리포트 생성 시 박제, 리서치 목록·상세가 read). 변경 시 둘 다 갱신(`storage.refresh_snapshot_names`/`reconcile_snapshot_names`) + 캐시 무효화 필요.
- **additive read 패턴**: 엔드포인트에 read/외부호출을 추가할 때 응답 shape뿐 아니라 호출 시퀀스도 늘어난다. 빈 입력이면 추가 read를 생략(`if <조건>:`)해 기존 동작·테스트를 보존(`GET /api/recommendations`의 watchlist→holdings 순차 read 사례).
- **NaN/Inf 가드**: starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 NaN/inf가 있으면 직렬화 500. 소스에서 `math.isfinite` 체크로 가드(예: `funnel._avg_dollar_volume`).

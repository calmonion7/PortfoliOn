---
last_mapped_commit: a5fb8bc8fbb92ec9155e7bc20ba681388786bfcd
mapped: 2026-07-07
---

# CONVENTIONS — 코드 스타일·명명·패턴·에러 처리

PortfoliOn 코드베이스의 실제 구현 관례. 도메인 용어 정의가 아니라 "코드가 실제로 이렇게 짜여 있다"는 사실 기록.

---

## 1. 백엔드 (Python / FastAPI)

### 1.1 Router / Service 분리

- **Router** (`backend/routers/`): HTTP 표면만. `APIRouter(prefix=..., tags=[...])`로 라우트 정의, 요청 검증, 인증 `Depends`, 응답 직렬화. 비즈니스 로직은 service에 위임.
- **Service** (`backend/services/`): DB·외부 API·계산 로직. Router가 `from services import storage`, `from services.exposure import compute_exposure`처럼 import해 조합.
- 대표 예: `backend/routers/portfolio.py`가 `from services.exposure import compute_exposure`를 import하고 `get_exposure`(`/api/portfolio/exposure`, `portfolio.py:102`)가 holdings·quotes·fx·sector_map·beta_map을 모아 `compute_exposure`에 넘겨 계산 자체는 순수 함수에 위임한다.
- DB 접근은 `backend/services/db.py`의 `query`/`execute`(+`execute_many`)를 통해서만. Router에서 raw connection을 직접 열지 않는다.
- **패키지형 service** (God-file 분할, ADR-0017): 커진 service는 re-export로 쪼갠다. `backend/services/market_indicators/`(cache/fx/commodities/earnings/econ/macro/indices/`sentiment`), `backend/services/kiwoom/`, `backend/services/kis/`. `backend/scheduler/`도 단일 파일 아닌 패키지(`__init__.py` 잡 배선·`_JOB_FUNCS` + `jobs.py` + `schedule.py` + `_state.py`).

### 1.2 순수 계산 service — 부수효과 없는 함수로 추출

- 계산 로직은 DB/외부호출과 분리된 순수 함수로 뽑는다. 대표 예 `backend/services/exposure.py`의 `compute_exposure(holdings, quotes, fx, sector_map, beta_map=...)` — 입력 dict/스칼라만 받아 통화·섹터 그룹핑, 집중도(top3/top5/max_single), 경고 플래그, 포트 베타 가중평균을 계산해 dict 반환. DB·시세 fetch는 호출부(router)가 하고 함수는 순수. 그래서 `backend/tests/test_exposure.py`가 mock 없이 리터럴 입력만으로 전 분기를 단언한다.
- 새 파생 지표를 붙일 땐 이 패턴 선호 — router는 데이터 수집만, service 함수는 순수 변환.

### 1.3 NaN/inf → JSON 500 가드 (starlette `allow_nan=False`)

- **핵심 함정**: starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 `NaN`/`inf`가 있으면 직렬화에서 **500**(`Out of range float values are not JSON compliant`). 반면 파이썬 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백은 통과 → DB저장 실패/파일성공/응답실패로 증상이 엇갈린다.
- **가드 헬퍼**: `backend/services/utils.py`의 `sanitize(obj)` — float가 `math.isnan`/`math.isinf`이면 `None`, dict/list는 재귀. 시세/합산을 응답에 싣는 엔드포인트에서 반환 직전 감싸는 안전망.
- `sanitize`를 쓰는 곳(현재): `routers/stocks.py`, `routers/report.py`, `routers/recommendations.py`, `routers/portfolio.py`, `services/report_generator.py`, `services/lending_service.py`, `services/leverage_service.py`, `services/market_indicators/indices.py`, `services/market_indicators/sentiment.py`.
- **소스 가드가 출력 sanitize보다 깨끗**: 외부 시세에서 흘러든 NaN은 소스에서 `math.isfinite`로 걸러 "값 없음"(None) 처리 선호. `_usdkrw_rate`가 비유한 FX를 `None`으로 반환하는 식. `if fx is None` 가드는 `NaN != None`이라 NaN을 통과시키므로 반드시 `math.isfinite` 병행. `sentiment._fetch_fear_greed`도 score가 `math.isnan`이면 `None` 반환(`test_fear_greed.py:47`).

### 1.4 Graceful degradation — 부분 실패가 전체를 깨뜨리지 않게

- **`_minimal_card` 폴백** (`backend/routers/stocks.py`): `GET /api/stocks/dashboard`의 `_build_all`은 카드당 `_safe`로 감싸 per-card enrichment throw를 잡아 그 카드만 `_minimal_card`로 폴백하고 전체 500-to-empty를 막는다. 불변식 "holdings=N → 항상 N카드"(task#102). 폴백 시 `print(..., file=sys.stderr)`로 로그 — 근본원인이 마스킹되므로 로그가 유일 단서.
- **`job_runs.record` 계측** (`backend/services/job_runs.py`): 배치 실행로그는 관측 전용 — 본문(배치)을 절대 안 깨뜨린다. `@contextmanager`이며 `record(job_id, trigger)` 형태(trigger = `auto`/`manual`/`backfill` 등 lane 문자열). INSERT 실패 시 `run_id=None` 센티넬로 본문 계속, 종료 UPDATE 실패도 삼킨다. **주의**: `failed`는 본문이 예외를 *전파*할 때만 기록 — 다수 잡이 내부 예외를 삼켜 정상 종료하므로 `success`를 '내부 오류 없음'으로 과신 금물. 읽기(`recent`/`recent_map`)는 예외 시 `[]`로 degrade.
- **외부 fetch는 조용히 삼키지 말 것**: silent `except: pass`는 진단 불가(task#48). 최소한 진단 로그 or 좁은 예외. 배치-백킹 캐시는 **빈/all-None 결과를 캐시에 박제 금지**(전부 None이면 save 생략·직전 양호값 유지).
- **캐시-우선 → fetch → 저장 → stored 폴백 → None 4단계**: 요청경로 외부지표의 표준 골격. `services/market_indicators/sentiment.py`의 `get_fear_greed()`가 전형 — ① 인메모리 TTL(`_get_cache`) → ② 라이브 `_fetch_fear_greed()` 성공 시 `_mc_save`(PostgreSQL)+`_set_cache(ttl=3600)` → ③ fetch 실패면 `_mc_load` 저장값 폴백 → ④ 저장값도 없으면 `None`. `test_fear_greed.py`가 네 갈래를 각각 단언.
- **결측은 skip, 크래시 아님 (`wrong < missing`)**: 배치 수집기는 종목별 결측을 저장 skip으로 처리하고 배치는 계속. `services/beta.py`의 `fetch_all_betas`는 `{"total","ok","failed"}`를 반환하는데 결측(beta=None)은 `ok`에 카운트(정상 처리, 저장만 skip)하고 예외난 종목만 `failed`(`test_beta.py:186`·`:206`). 이 `{total,ok,failed}` 반환 shape은 수집 배치의 공통 관례.

### 1.5 외부 fetch 배치의 미러링 패턴 (dividends → beta)

- 신규 종목별 지표 수집 배치는 기존 배치를 미러링한다. `services/beta.py`(task#150)는 `services/dividends.py` 구조를 그대로 복제: 시장별 분기 수집(US=yfinance `info["beta"]`, 없으면 `beta3Year` 폴백 — `fetch_us_beta`; KR=`calc_beta` vs `^KS11` — `fetch_kr_beta`) → `stock_beta` 테이블 `ON CONFLICT (ticker) DO UPDATE` upsert(`upsert_beta`) → 조회(`get_beta`) → `_migrate`에 DDL → `batch_registry`에 `beta_fetch` 엔트리(weekly·공통·report·auto+manual) + `scheduler._JOB_FUNCS` 등록 + `/api/stocks/beta/refresh` 수동 엔드포인트.
- **falsy 유효값 주의**: `beta=0.0`은 유효값인데 falsy라 `beta or beta3Year`로 폴백하면 조용히 치환된다 → `is None` 체크로 분기(`test_beta.py:42` `test_us_beta_zero_is_kept`).

### 1.6 공유 후처리 헬퍼 (scraper `_dedup_sort_limit`)

- 여러 소스(KR Naver / US yfinance)에서 온 리스트를 동일 규칙으로 후처리할 땐 공유 헬퍼로 뽑는다. `services/scraper.py`의 `_dedup_sort_limit(items, limit)` — `link` 기준 dedup + `published_at` 내림차순 정렬 + limit 컷. `get_news`(US·yfinance)와 `get_news_kr`(Naver) 둘 다 자기 파싱 후 이 헬퍼로 마무리. `get_news(ticker, market=..., limit=10)`이 `market=="KR"`이면 `get_news_kr`로 디스패치(`test_scraper.py:104`).

### 1.7 Lazy import로 순환참조 회피

- 상호 참조 service는 함수 내부에서 지연 import. 실제 주석 예: `services/analysis_service.py`(`us_sector_service` 지연 import), `services/us_sector_service.py`. storage→cache 무효화도 함수 내 지연 import(`cache.invalidate`를 storage에서 호출할 때).

### 1.8 Decimal vs float 산술 함정 (DB NUMERIC)

- DB `NUMERIC` 컬럼(`avg_cost`, `quantity` 등)은 psycopg가 **`Decimal`**로 준다. 외부 시세·`stock_dividends`는 **float**. `float / Decimal` 혼합 산술은 `TypeError`.
- 실사례: `_build_card`의 `yield_on_cost = annual_div / avg_cost` 등에서 배당 있는 모든 카드가 throw → `_minimal_card` 폴백 → enrichment 통째 blank(500도 안 나서 은밀). 수정은 계산 양변 `float()` 정규화.
- 순수 계산 함수도 동일 방어: `compute_exposure`는 `quantity`/`fx`가 `Decimal`이어도 안전(`test_exposure.py:154` `test_decimal_quantity_and_fx_do_not_raise_type_error`). **회귀 테스트 fixture도 `Decimal`을 써야** fixture-pass-live-fail을 막는다.

### 1.9 tz-naive ↔ tz-aware 정렬은 strip 필수

- 키움 일봉(tz-naive) ↔ yfinance(`^KS11` 등, tz-aware) `pd.concat(axis=1)`은 `TypeError`. 정렬 전 한쪽을 `tz_localize(None)`으로 벗긴다. `services/beta.py`의 `_ks11_returns`가 `^KS11` 히스토리를 받아 tz strip 후 반환(`test_beta.py:61` `test_ks11_returns_strips_tz`), `report_generator`의 KR beta 경로도 daily_df tz strip 통일(86b714e). broad `except`가 이 오류를 삼키면 계산이 조용히 None이 되니 좁은 예외/진단 로그.

### 1.10 종목명·enriched_at dual-source

- 종목명은 **두 저장소**: `tickers.name`(공유 마스터, 종목관리 목록이 live read) vs `snapshots.data.name`(리포트 생성 시 박제, 리서치 목록·상세가 read). 이름 변경 시 둘 다 갱신(`storage.refresh_snapshot_names` 단건 / `reconcile_snapshot_names` 전체) + `cache.invalidate(ticker)`+`invalidate_list()`.
- 유사 함정: **`enriched_at`(AI 분석 존재 여부) 정본은 `tickers` 테이블 컬럼 — 스냅샷 `data` JSON엔 없다**. 신규 판정/표시 필드의 정본 저장 위치를 가정하지 말고 기존 소비처를 grep으로 확정(스냅샷에서 읽도록 가정하면 fixture green·라이브 항상 False).

### 1.11 배치 레지스트리 관례

- `backend/services/batch_registry.py`의 `BATCHES`가 모든 배치의 단일 소스 — **현재 28개 엔트리**(`test_batch_market_split.py:53`·`test_macro_signals_batch.py:37`·`test_batches_router.py:45`가 `== 28` 단언). 각 엔트리: `id`·`market`(`KR`/`US`/`공통`)·`category`·`source`(fetch 출처)·`usage`(소비 UI)·`editable`·`trigger_kinds`·`manual_endpoint`·`scheduler_job_id`·`default_schedule`. `get_batch(id)`로 조회. `GET /api/batches`가 그대로 노출.
- **fetch 소스를 바꾸면 `source`도 갱신(DoD)**. `source`=어디서 끌어오나, `usage`=어디서 쓰나(반대 방향).
- **배치 id 은퇴/추가 시 전수 grep**: id 제거 시 ① 데이터 read ② 표시 문자열 ③ `job_runs.record(id, ...)` 모든 lane(auto/manual/backfill) ④ 그 id를 단언하는 테스트 모두 갱신. id 추가 시 exact-count(`== 28`)/exact-set(`EXPECTED_IDS`) 단언이 여러 파일에 흩어져 있어 전수 갱신(§ TESTING 1.6).

### 1.12 신규 DB 컬럼/테이블 배포 관례 (DoD)

- **신규 컬럼/테이블은 `app_schema.sql`만으론 배포에 반영 안 됨** — `backend/main.py`의 `_migrate`에 `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`를 **쌍으로** 추가 필수. 스키마 파일은 신규 설치용, 라이브 DB는 기동 idempotent 마이그레이션(ADR-0006)만 탄다. `stock_beta` 테이블도 `_migrate`가 DDL 발행(`test_beta.py:152` `test_migrate_creates_stock_beta`).

### 1.13 SQL 배치화 함정 (query-mock 테스트가 못 잡음)

- **uuid `= ANY(%s)`**: 파이썬 str 리스트를 넘기면 text[]가 돼 `operator does not exist: uuid = text` 라이브 즉사. `ANY(%s::uuid[])` 명시 캐스트. 단건 `WHERE user_id = %s`는 str이 암묵 캐스트돼 동작하던 것이 배열화에서 깨진다.
- **VALUES 나열**: 바깥 괄호로 감싸면(`VALUES ((a,b),(c,d))`) N행이 아니라 record 1행 → `AS v(...)` 매핑 에러. 행별 `(a,b), (c,d)` 나열만. `consensus._values_placeholder`가 형태 고정.
- **upsert dedup**: 재수집이 행을 늘리지 않게 종목별 테이블은 `ON CONFLICT (ticker) DO UPDATE`(`stock_beta`·`stock_dividends` 등).

---

## 2. 프론트엔드 (React 19 + Vite 8)

### 2.1 스타일 — plain CSS + design tokens (TailwindCSS 없음)

- 스타일 정본: `frontend/src/styles/tokens.css`의 CSS 커스텀 프로퍼티. 컴포넌트별 `.css` 파일이 토큰을 참조.
- **KR 색 관례**: `--up`=빨강(상승)·`--down`=파랑(하락). 서구 관례(녹=상승)와 반대.
- **의미 상태 색은 별도 토큰**(`--color-success` 녹 등)으로 가격 방향색과 분리.

### 2.2 Badge variant 주의 (색 반전 함정)

- `frontend/src/components/ui/Badge.css`에서 **`.badge--success`=빨강**, **`.badge--danger`=파랑**(variant 이름이 KR 가격색으로 매핑). 가격 방향이 아닌 의미 상태 배지(수급 밴드 등)에 `success`/`danger`를 쓰면 색이 반전 → 의미 배지는 `frontend/src/components/ui/SupplyBadge.jsx`처럼 전용 색을 명시. UI 리뷰는 variant 이름 통념이 아니라 `Badge.css`의 실제 토큰값을 대조.

### 2.3 단일 공유 컴포넌트 패턴

- 중복 렌더링 블록은 단일 컴포넌트로 통합. 대표 예: `frontend/src/components/reports/StockActions.jsx` — 카드(`StockCard`)와 사이드바(`TickerListItem`) 양쪽의 액션버튼(수정·승격·삭제·전체삭제)을 통합, `layout="card"|"list"` prop으로 분기(task#103). **액션버튼/게이트 변경은 여기 한 곳만**.
- **가시성 게이트는 `is_mine`으로**(category 아님): `info.is_mine === false`(타인 종목)면 전체삭제(`/api/admin`)만. category로만 게이트하면 admin `scope=all` 목록에서 타인 종목의 user-scoped 핸들러가 404로 조용히 깨진다.

### 2.4 Context provider (Toast·Auth)

- `frontend/src/components/Toast.jsx`: `createContext` 기반 `ToastProvider`(앱 루트 래핑) + `useToast`(consumer 훅). `frontend/src/contexts/`의 `AuthContext`가 로그인 시 메뉴 권한을 로드해 nav 필터링.

### 2.5 훅 추출 + 콜로케이트 테스트

- 로직은 커스텀 훅으로 추출(`frontend/src/hooks/usePortfolioData.js`, `useStockManagement.js`, `useReportFilters.js`)하고 테스트를 소스 옆에 콜로케이트(`*.test.js`).

### 2.6 엔드포인트 응답 shape 변경 시 소비처 전수 grep

- 배열→객체 등 비-additive reshape 시 `grep -rn '<엔드포인트 경로>' frontend/src/`로 독립 fetcher까지 전수 갱신(예: `Analytics.jsx`가 훅과 별개로 `/api/stocks/dashboard`를 직접 fetch). 가능하면 additive(필드 추가) 선호.

### 2.7 Vite 8 (rolldown) 청크 분할 + Vitest 설정

- `frontend/vite.config.js`의 `build.rollupOptions.output.manualChunks`는 **함수 형식만** 받는다(rollup식 객체형 쓰면 `Expected Function but received Object`로 빌드 파손). id substring으로 분기 — `recharts`/`/d3-`/`victory-vendor`→`charts`, 나머지 `node_modules`→`vendor`(`vite.config.js:97`).
- Vitest 설정도 별도 파일 없이 `vite.config.js`의 `test` 블록(`environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.js'`).

---

## 3. 문서 동기화 (Doc-sync DoD)

- **API 변경 시 명세서 2개 함께 갱신**: 엔드포인트 추가/삭제·요청/응답 스키마·인증 게이팅 변경은 `API_SPEC.md`(전체 REST 레퍼런스)와 `CLAUDE_COWORK_API.md`(외부 Cowork API)를 **항상 함께**(DoD).
- 엔드포인트 *존재* drift(method+path)는 `backend/tests/test_api_doc_sync.py`가 자동검출(라이브 `app.routes` ↔ 두 문서의 `` ### `METHOD /path` `` 헤더 대조). 요청/응답 스키마·인증 게이팅 동기는 여전히 **수동 DoD**.
- **기능 표면 변경 시 `README.md` 해당 절도 같은 PR에서 갱신(DoD)**: ① 화면 구성 ② 환경변수 ③ 기술 스택 ④ 아키텍처(router/service/table) ⑤ 배치 중 하나라도 추가·삭제·개명 시. README는 overview 레벨 — 엔드포인트/스키마 세부는 `API_SPEC.md`/`CLAUDE_COWORK_API.md`에만(역할 분담).

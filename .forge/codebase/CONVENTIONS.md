---
last_mapped_commit: 739c39c3f628376219789fb8b7850076941dc69c
mapped: 2026-07-04
---

# CONVENTIONS — 코드 스타일·명명·패턴·에러 처리

PortfoliOn 코드베이스의 실제 구현 관례를 정리한 문서. 도메인 용어 정의가 아니라 "코드가 실제로 이렇게 짜여 있다"는 사실 기록.

---

## 1. 백엔드 (Python / FastAPI)

### 1.1 Router / Service 분리

- **Router** (`backend/routers/`): HTTP 표면만 담당. `APIRouter`로 라우트 정의, 요청 검증, 인증 `Depends`, 응답 직렬화. 비즈니스 로직은 service에 위임.
- **Service** (`backend/services/`): DB·외부 API·계산 로직. Router가 `from services import storage`처럼 import해 호출.
- 대표 예: `backend/routers/stocks.py`가 `from services import storage`, `from services.db import query`, `from services.utils import sanitize`를 import해 조합한다.
- DB 접근은 `backend/services/db.py`의 `query`/`execute`를 통해서만. Router에서 raw connection을 직접 열지 않는다.
- 패키지형 service: 커진 service는 재-export로 God-file을 분할한다(ADR-0017). 예: `backend/services/market_indicators/`(cache/fx/commodities/earnings/econ/macro/indices), `backend/services/kiwoom/`, `backend/services/kis/`. `backend/scheduler/`도 단일 파일이 아니라 패키지(`__init__.py` 잡 배선 + `jobs.py` + `schedule.py` + `_state.py`).

### 1.2 NaN/inf → JSON 500 가드 (starlette `allow_nan=False`)

- **핵심 함정**: starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 `NaN`/`inf`가 있으면 직렬화에서 **500**(`Out of range float values are not JSON compliant`)이 난다. 반면 파이썬 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백은 통과 → DB저장 실패/파일성공/응답실패로 증상이 엇갈린다.
- **가드 헬퍼**: `backend/services/utils.py`의 `sanitize(obj)` — float가 `math.isnan`/`math.isinf`이면 `None`으로, dict/list는 재귀. 시세/합산을 응답에 싣는 엔드포인트에서 반환 직전 감싸는 안전망.
- `sanitize`를 실제로 쓰는 곳: `backend/routers/stocks.py`, `backend/routers/report.py`, `backend/routers/recommendations.py`, `backend/services/lending_service.py`, `backend/services/market_indicators/indices.py`, `backend/services/report_generator.py`, `backend/services/leverage_service.py`.
- **소스 가드가 출력 sanitize보다 깨끗**: 외부 시세에서 흘러든 NaN은 소스에서 `math.isfinite` 체크로 걸러 "시세 없음" 처리하는 것을 선호(`_usdkrw_rate`가 비유한 FX를 `None`으로 반환하는 식). `if fx is None` 가드는 `NaN != None`이라 NaN을 통과시키므로 반드시 `math.isfinite` 병행.

### 1.3 Graceful degradation — 부분 실패가 전체를 깨뜨리지 않게

- **`_minimal_card` 폴백** (`backend/routers/stocks.py:470`): `GET /api/stocks/dashboard`의 `_build_all`(`stocks.py:490`)은 카드당 `_safe`(`stocks.py:500`)로 감싸 per-card enrichment(snapshot/consensus/배당 등) throw를 잡아 그 카드만 `_minimal_card`로 폴백하고 전체 500-to-empty를 막는다. 불변식: "holdings=N → 항상 N카드"(task#102). 폴백 시 `print(..., file=sys.stderr)`로 `[dashboard] {ticker} 카드 빌드 실패 — 최소카드 폴백` 로그를 남긴다(근본원인이 마스킹되므로 로그가 유일 단서).
- **`job_runs.record` 계측** (`backend/services/job_runs.py`): 배치 실행로그는 관측 전용 — 본문(배치)을 절대 깨뜨리지 않는다. INSERT 실패 시 경고만 남기고 `run_id=None` 센티넬로 본문을 그대로 실행. 종료 UPDATE 실패도 삼킨다. **주의**: `failed`는 본문이 예외를 *전파*할 때만 기록 — 다수 스케줄러 잡이 내부 예외를 try/except로 삼켜 정상 종료하므로 `success`를 '내부 오류 없음'으로 과신하면 안 된다(잡 본문 로그 병행 확인). `record`는 `@contextmanager`이며 `trigger` 인자(auto/manual 등 lane 문자열)를 받아 기록. 읽기는 `recent`/`recent_map`이 예외 시 `[]`로 graceful degrade.
- **외부 fetch는 조용히 삼키지 말 것**: silent `except: pass`는 진단 불가(task#48 사례). 최소한 진단 로그를 남기거나 좁은 예외만 잡는다. 특히 배치-백킹 캐시는 **빈/all-None 결과를 캐시에 박제 금지**(전부 None이면 save 생략·직전 양호값 유지 — `_seed_*_if_empty` 시드 가드가 오판하지 않게).

### 1.4 Lazy import로 순환참조 회피

- 상호 참조하는 service는 함수 내부에서 지연 import한다. 실제 주석 예: `backend/services/analysis_service.py:58` (`us_sector_service`가 `analysis_service`를 지연 import하므로 여기도 지연 import), `backend/services/us_sector_service.py:20`.
- storage→cache 무효화도 함수 내 지연 import로 순환참조를 회피(`cache.invalidate`를 storage에서 호출할 때).

### 1.5 Decimal vs float 산술 함정 (DB NUMERIC)

- DB `NUMERIC` 컬럼(`avg_cost`, `quantity` 등)은 psycopg가 **`Decimal`**로 준다. 반면 외부 시세·`stock_dividends` 등은 **float**. `float / Decimal` 혼합 산술은 `TypeError`.
- 실사례: `_build_card`의 `yield_on_cost = annual_div / avg_cost`, `expected_income = annual_div * qty`에서 배당 있는 모든 카드가 throw → `_minimal_card` 폴백 → enrichment 통째 blank(500도 안 나서 은밀). 수정은 계산 양변 `float()` 정규화. **DB NUMERIC 컬럼을 float/외부값과 산술하는 경로는 어디든 동일 위험** — 회귀 테스트 fixture도 `Decimal`을 써야(float만 쓰면 fixture-pass-live-fail).

### 1.6 종목명 dual-source

- 종목명은 **두 저장소**에 있다: `tickers.name`(공유 마스터, 종목관리 목록이 live로 read) vs `snapshots.data.name`(리포트 생성 시 박제, 리서치 목록·상세가 read).
- 이름 변경 시 **둘 다** 갱신해야 목록↔상세 일치. `storage.refresh_snapshot_names`(단건) / `reconcile_snapshot_names`(전체). DB만 바꾸면 `cache.get_list`·스냅샷 LRU 탓에 미반영 → `cache.invalidate(ticker)` + `invalidate_list()` 필수.
- 유사 함정: **`enriched_at`(AI 분석 존재 여부) 정본은 `tickers` 테이블 컬럼 — 스냅샷 `data` JSON엔 없다**. 신규 판정/표시 필드의 정본 저장 위치를 가정하지 말고 기존 소비처를 grep으로 확정할 것(스냅샷에서 읽도록 가정하면 fixture green·라이브 항상 False = '이중 저장소 혼동' 가족).

### 1.7 배치 레지스트리 관례

- `backend/services/batch_registry.py`의 `BATCHES`가 모든 배치의 단일 소스. 각 엔트리는 `id`·`market`(`KR`/`US`/`공통`)·`source`(fetch 출처, 예 `["키움","KIS","Naver"]`)·`usage`(소비 UI)·`editable` 등의 속성. `GET /api/batches`가 그대로 노출.
- **fetch 소스를 바꾸면 `source`도 갱신(DoD)**. `source`=어디서 끌어오나, `usage`=어디서 쓰나 (반대 방향).
- **배치 id 은퇴/추가 시 전수 grep**: id를 빼면 ① 데이터 read ② 표시 문자열 ③ `job_runs.record(id, ...)` 모든 lane(auto/manual/backfill) ④ 그 id를 단언하는 테스트를 모두 갱신. id 추가 시엔 exact-count/exact-set 테스트 단언이 여러 파일에 흩어져 있어(§ TESTING 참조) 전수 갱신 필요.

### 1.8 신규 DB 컬럼 배포 관례 (DoD)

- **신규 컬럼은 `app_schema.sql`만으론 배포에 반영 안 됨** — `backend/main.py`의 `_migrate`에 `ADD COLUMN IF NOT EXISTS`를 **쌍으로** 추가 필수. 스키마 파일은 신규 설치용, 라이브 DB는 기동 idempotent 마이그레이션(ADR-0006)만 탄다. 한쪽만 고치면 배포 직후 그 컬럼을 쓰는 INSERT/SELECT가 컬럼 부재로 깨진다.

### 1.9 SQL 배치화 함정 (query-mock 테스트가 못 잡음)

- **uuid `= ANY(%s)`**: 파이썬 str 리스트를 넘기면 text[]가 돼 `operator does not exist: uuid = text` 라이브 즉사. `ANY(%s::uuid[])` 명시 캐스트. 단건 `WHERE user_id = %s`는 str이 암묵 캐스트돼 동작하던 것이 배열화에서 깨진다.
- **VALUES 나열**: 바깥 괄호로 감싸면(`VALUES ((a,b),(c,d))`) N행이 아니라 record 1행 → `AS v(...)` 매핑 에러. 행별 `(a,b), (c,d)` 나열만. `consensus._values_placeholder`가 형태 고정.

---

## 2. 프론트엔드 (React 19 + Vite 8)

### 2.1 스타일 — plain CSS + design tokens (TailwindCSS 없음)

- 스타일 정본: `frontend/src/styles/tokens.css`의 CSS 커스텀 프로퍼티. 컴포넌트별 `.css` 파일이 토큰을 참조.
- **KR 색 관례**: `--up`=빨강(`#d83a3a`, 상승), `--down`=파랑(`#2864e8`, 하락). `tokens.css:25-30`에 정의. 서구 관례(녹=상승)와 반대.
- **의미 상태 색은 별도 토큰**: `--color-success`(#2e7d32 녹), `--color-error`(#d32f2f), `--color-info`, `--semantic-buy`/`--semantic-sell`, `--corr-pos`/`--corr-neg` 등이 `tokens.css:42-55`에 별도 정의(가격 방향색과 분리).

### 2.2 Badge variant 주의 (색 반전 함정)

- `frontend/src/components/ui/Badge.css`에서 **`.badge--success`=빨강**(`--up-soft`/`--up`), **`.badge--danger`=파랑**(`--down-soft`/`--down`). 즉 variant 이름이 KR 가격색으로 매핑돼 있다.
- **가격 방향이 아닌 의미 상태 배지(수급 밴드 등)에 `success`/`danger`를 쓰면 색이 반전**(우호=빨/경계=파). 의미 배지는 `frontend/src/components/ui/SupplyBadge.jsx`처럼 전용 색을 명시할 것.
- `.badge--warning`은 `--warn-soft`/`--warn`(주황)으로 정의됨. `.badge--info`는 `--accent-tint`/`--accent`. `.badge--market-kr`/`--market-us`는 하드코딩 녹/하늘색.
- UI 리뷰는 variant 이름 통념(success=녹)이 아니라 `Badge.css`의 실제 토큰값을 대조할 것.

### 2.3 단일 공유 컴포넌트 패턴

- 중복 렌더링 블록은 단일 컴포넌트로 통합. 대표 예: `frontend/src/components/reports/StockActions.jsx` — 카드(그리드, `StockCard`)와 사이드바(`TickerListItem`) 양쪽의 액션버튼(수정·승격·삭제·전체삭제)이 byte-identical로 중복돼 있던 것을 통합(task#103). `layout="card"|"list"` prop으로 렌더 분기. **액션버튼/게이트 변경은 여기 한 곳만**.
- **가시성 게이트는 `is_mine`으로** (category 아님): `info.is_mine === false`(타인 종목)면 전체삭제(`/api/admin`)만, 본인 종목이면 수정·승격·삭제. category로만 게이트하면 admin `scope=all` 목록에서 타인 종목의 user-scoped 핸들러가 404로 조용히 깨진다.

### 2.4 Toast provider

- `frontend/src/components/Toast.jsx`: `createContext` 기반. `ToastProvider`(앱 루트 래핑) + `useToast`(consumer 훅). 토스트 알림 단일 채널.

### 2.5 훅 추출 + 콜로케이트 테스트

- 로직은 커스텀 훅으로 추출(`frontend/src/hooks/usePortfolioData.js`, `useStockManagement.js`, `useReportFilters.js`)하고 테스트를 소스 옆에 콜로케이트(`*.test.js`).

### 2.6 엔드포인트 응답 shape 변경 시 소비처 전수 grep

- 배열→객체 등 비-additive reshape 시 `grep -rn '<엔드포인트 경로>' frontend/src/`로 독립 fetcher까지 전수 갱신. 한 소비처만 고치면 다른 곳(예: `Analytics.jsx`가 훅과 별개로 `/api/stocks/dashboard`를 직접 fetch)이 옛 형태로 취급해 조용히 깨진다. 가능하면 additive(필드 추가) 선호.

### 2.7 Vite 8 (rolldown) 청크 분할

- `frontend/vite.config.js`의 `build.rollupOptions.output.manualChunks`는 **함수 형식만** 받는다(rollup식 객체형 쓰면 `Expected Function but received Object`로 빌드 파손). id substring으로 분기 — 현재 `recharts`/`/d3-`/`victory-vendor`→`charts`, 나머지 `node_modules`→`vendor`.
- Vitest 설정도 별도 파일 없이 `vite.config.js`의 `test` 블록(`environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.js'`).

---

## 3. 문서 동기화 (Doc-sync DoD)

- **API 변경 시 명세서 2개 함께 갱신**: 엔드포인트 추가/삭제·요청/응답 스키마·인증 게이팅 변경은 `API_SPEC.md`(전체 REST 레퍼런스)와 `CLAUDE_COWORK_API.md`(외부 Cowork API)를 **항상 함께** 업데이트(DoD).
- 엔드포인트 *존재* drift(method+path)는 `backend/tests/test_api_doc_sync.py`가 자동검출(라이브 `app.routes` ↔ 두 문서의 `` ### `METHOD /path` `` 헤더 대조). 요청/응답 스키마·인증 게이팅 동기는 여전히 **수동 DoD**(테스트는 존재만 검증).
- **기능 표면 변경 시 `README.md` 해당 절도 같은 PR에서 갱신(DoD)**: ① 화면 구성 ② 환경변수 ③ 기술 스택 ④ 아키텍처(router/service/table) ⑤ 배치 중 하나라도 추가·삭제·개명 시. README는 overview 레벨 — 엔드포인트/스키마 세부는 `API_SPEC.md`/`CLAUDE_COWORK_API.md`에만(역할 분담).

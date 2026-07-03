---
last_mapped_commit: 9de05a1ee9f11c92f58807adeff3dcc2cab63550
mapped: 2026-07-03
---

# 코딩 컨벤션

## 언어·주석 스타일

- **주석·docstring은 한국어**가 기본. 인라인 `#` 주석, `"""docstring"""` 모두 한국어로 쓴다.
  - 예: `backend/services/db.py` — `"""배치 INSERT/UPDATE/DELETE — 단일 커넥션에서 execute_batch 실행. 빈 params_list는 no-op(커넥션 미획득)."""`
  - 예: `backend/services/report_generator.py` — `"""yfinance info 값을 유한 float으로 변환. 'Infinity'/NaN/None → None."""`
- docstring에서 결측 처리를 `→ None` 화살표로 명시하는 관례 (`결측/예외→None`).
- 섹션 구분자는 `# ---` 스타일 (예: `backend/services/market_indicators/indices.py`의 `# --- S1: index levels ---`). 테스트 파일은 `# ── test N: 설명 ──` 박스 구분선도 쓴다(`backend/tests/test_consensus_asof_batch.py`).

## 네이밍

- **공개 함수**: `snake_case` 동사-명사 — `get_quote`, `generate_report`, `fetch_trend`, `resolve_name`, `backfill_ticker`, `execute_many`.
- **비공개 헬퍼**: `_` 접두 — `_fin_num`, `_mc_load`, `_mc_save`, `_values_placeholder`, `_rsi_block`.
- **상수/매핑**: ALL_CAPS — `_SCORE_MAP`, `_INDEX_SYMBOLS`, `SNAPSHOTS_DIR`, `TICKER_RE` (모듈 비공개면 `_` 접두 유지).
- **모듈 비공개 싱글톤**: `_cache`, `_pool`, `_KST`.
- **불리언 헬퍼**: `is_valid_ticker`, `ticker_exists_in`.
- 섹션별 fetch 함수는 `(key, value_or_None)` 튜플 반환 패턴 (`indices.py` 등 market_indicators).

## 라우터/서비스 분리 + 모듈 레벨 I/O (mock 가능 구조)

- **라우터(`backend/routers/`)는 HTTP 계층만, 로직은 서비스(`backend/services/`)** — 라우터는 서비스를 **모듈 레벨 이름으로 import** (`from services import storage`, `from services import market` — `backend/routers/stocks.py`). 테스트가 `patch("routers.stocks.storage.get_full_portfolio", ...)` 형태의 정규화된 경로로 patch할 수 있게 유지한다.
- 서비스 내부의 외부 I/O(yfinance/키움/DART 호출)는 **모듈 레벨 함수로 분리**해 `patch.object(service_module, "function_name", ...)`로 mock — 예: `backend/tests/test_nan_serialization_guards.py`의 `patch.object(analysis_service.yf, "Ticker", _ConstTicker)`.
- 함수를 클로저/람다 안에 숨기거나 함수 안에서 재바인딩하면 이 patch 관례가 깨지니 피할 것. **역으로 모듈에서 심볼을 제거/개명할 땐 그 심볼을 patch하는 테스트를 파일 불문 전수 grep**(task#136 — `services.digest_service.yf` 제거가 다른 파일의 patch를 `ModuleNotFoundError`로 깨뜨림).

## HTTP 에러

- 공통 404/400은 `backend/services/errors.py`의 팩토리 사용 — `raise not_found(ticker, "watchlist")` / `raise already_exists(ticker, ...)` (둘 다 `HTTPException` 반환).

## 에러 처리

### 외부 fetch 실패 로깅 — silent except 금지, print→logger 이행 완료 단계

- 표준 패턴: `except Exception as e:` → `logger.warning(f"[Module] 설명 실패: {e}")` → `return None`(또는 폴백 진행).
- 로거는 모듈 레벨 `logger = logging.getLogger(__name__)` (서비스·라우터 35개 모듈).
- 메시지 포맷: **`[대문자모듈명]` 접두 + 한국어 설명 + `: {e}`**.
  - `logger.warning(f"[Consensus] _fetch_kr_raw Naver 요청 실패 {ticker}: {e}")` (`backend/services/consensus_pipeline.py` — task#138에서 print 6곳 → logger 이행)
  - `logger.warning(f"[Cache] _mc_load key={key} 실패: {e}")`
- **무음 `except Exception: pass` 금지** — 기능이 예외 없이 조용히 꺼져 진단 불가(task#48 사례). task#127·128에서 백엔드 28파일, task#129에서 프론트 7건(`console.warn`) 일괄 로깅화. 잔존 무음 except는 `backend/services/job_runs.py`(계측 인프라의 의도적 삼킴)·`guru_scraper.py` 일부뿐이며 레거시/부채로 취급.
- **print→logger 이행 현황(task#138 기준)**: logger 호출 ~110곳 vs 잔존 `print()` ~49곳. 잔존 print는 대부분 배치 stdout 진단이 필요한 loud 로그(`backend/services/report_generator.py`의 `print(f"[Report] {ticker} ... 박제 스킵")` 등)로 의도적. **신규 코드는 logger가 기본**, 리포트 배치의 박제-게이트류 진단만 print 병용.

### graceful 결측 (wrong < missing)

- 외부 소스 실패·결측은 예외 전파 대신 **None/빈 리스트 반환** → 호출자가 `if result is None:`으로 저장값 폴백 또는 필드 생략.
- 추출 실패에 '안전한 기본값'을 채우지 말 것 — 오저장(×100 등)보다 누락(pending/None)이 낫다.
- 빈/all-None 결과는 캐시에 박제 금지(직전 양호값 유지). SQL 집계도 동일 — 마트 UPSERT에 `HAVING COUNT(*)>0` 가드로 0-덮어쓰기 방지(task#138, `daily_consensus_mart`).

### NaN/isfinite 가드

- 외부 값을 **처음 소비하는 지점에서 `math.isfinite(v)` 가드** — starlette `JSONResponse`는 `allow_nan=False`라 NaN/inf가 응답에 남으면 500.
  - `backend/services/report_generator.py` `_fin_num`: `f = float(v); return f if math.isfinite(f) else None`
  - `backend/services/market_indicators/indices.py`: `if not math.isfinite(change_pct): change_pct = None`
- NaN은 `is None` 가드를 통과하므로(NaN≠None) None 체크만으로는 불충분.

### sanitize 안전망

- 정의: `backend/services/utils.py`의 `sanitize(obj)` — dict/list 재귀 순회로 NaN/inf float → None 치환.
- 사용처: `backend/routers/stocks.py`(대시보드 응답 전체), `backend/services/report_generator.py`(`_sanitize`로 import, 스냅샷 저장 전), `backend/routers/recommendations.py`(응답 전체).
- 관례: **소스 지점 `isfinite` 가드가 1차, `sanitize`는 라우터 응답 최외곽의 최후 안전망**. 시세/합산 float를 응답에 싣는 엔드포인트는 둘 중 하나 필수.

## DB 접근 패턴 (`backend/services/db.py`)

- psycopg2 `ThreadedConnectionPool(minconn=1, maxconn=20)` 싱글톤(`_pool` + double-checked `_lock`) — maxconn은 최대 ThreadPool 동시성(calendar 15·analysis 11)보다 크게(풀 소진 시 블록이 아니라 `PoolError` throw).
- `get_connection()` 컨텍스트매니저: 성공 시 `commit`, 예외 시 `rollback` 후 re-raise, finally `putconn`.
- 헬퍼 3종만 사용(raw 커넥션 직접 다루지 말 것):
  - `query(sql, params) -> list[dict]` — SELECT, `RealDictCursor`.
  - `execute(sql, params) -> int` — 단건 INSERT/UPDATE/DELETE, rowcount 반환.
  - `execute_many(sql, params_list) -> None` — **배치 쓰기(task#135 신설)**, `psycopg2.extras.execute_batch`로 단일 커넥션 처리, 빈 리스트는 no-op(커넥션 미획득). **루프 안 행별 `execute` N+1 금지** — 호출처: `services/disclosures.py`, `services/short_sell_service.py`, `services/investor_service.py`, `services/insider_trades.py`.
- **SQL 함정 2종(task#135, query-mock이 못 잡음)**: ① uuid 컬럼에 파이썬 str 리스트를 `= ANY(%s)`로 넘기면 라이브 즉사 — `ANY(%s::uuid[])` 명시 캐스트. ② `VALUES` 행 나열에 바깥 괄호 금지 — `(a,b), (c,d)` 형태만(`services/consensus.py`의 `_values_placeholder`가 정본, `tests/test_consensus_asof_batch.py::test_values_placeholder_shape`가 형태 고정). 신규/개작 SQL은 배포 후 라이브 스모크가 DoD.
- DB NUMERIC 컬럼(avg_cost·quantity 등)은 psycopg2가 **Decimal**로 반환 — float와 산술 전 `float()` 정규화 필수(`float/Decimal` TypeError, 대시보드 배당 사례).
- 신규 컬럼은 `backend/app_schema.sql`(신규 설치용) + `backend/main.py`의 `_migrate`(`ADD COLUMN IF NOT EXISTS`, 라이브 DB용) **쌍으로** 추가(task#130, ADR-0006).

## 프론트엔드 (React 19 + Vite, plain CSS)

- **함수 컴포넌트 + hooks만** — 클래스 컴포넌트 없음. 페이지는 `frontend/src/pages/`, 재사용 컴포넌트는 `frontend/src/components/`(도메인별 하위폴더 `reports/`·`market/`·`portfolio/`), 훅은 `frontend/src/hooks/`.
- **TailwindCSS 미사용 — plain CSS 파일 co-locate** (`Badge.jsx` + `Badge.css`). 디자인 토큰은 `frontend/src/styles/tokens.css`.
- **ui/ 프리미티브 우선 재사용**: `frontend/src/components/ui/` — `Badge`, `Button`, `Card`, `Stat`, `Input`, `Skeleton`, `icons.jsx`, `InsiderBadge`, `SupplyBadge` (`index.js` 배럴 export). 새 카드/배지/버튼을 ad-hoc으로 만들지 말 것.
- **KR 가격색 토큰 함정**: `--up`=빨강(상승)·`--down`=파랑(하락) — 그래서 `.badge--success`=빨강·`.badge--danger`=파랑(`ui/Badge.css`). **가격 방향이 아닌 의미 상태 배지에 success/danger 변형 금지**(Western 통념과 색 반전) — `ui/SupplyBadge.jsx`처럼 전용 색을 명시. `warning` 변형은 `--color-warning` 미정의로 깨져 있어 사용 불가.
- API 호출은 `frontend/src/api.js` 클라이언트 경유(`api.get/post/...`) — 테스트가 `vi.mock('../api')`로 잡는 전제.
- 실패 은폐 금지: catch에서 최소 `console.warn` (task#129), 데이터 있으면 빈상태 대신 Skeleton, 재시도는 bounded(최대 3, task#102).

## 커밋 메시지

- 형식: **`type: 한국어 요약 — 상세 (task#N)`**. type은 `feat`/`fix`/`perf`/`docs`/`chore` 등 conventional prefix, 요약은 한국어, forge 태스크 번호를 `(task#N)` suffix로.
  - 예: `perf: DB 배치화 — execute_many 헬퍼 + N+1/행별 execute 8곳 제거 (task#135)`
- 본문은 `-` 불릿으로 변경 항목 나열(한국어). 트레일러: `Co-Authored-By: Claude ...` + `Claude-Session: ...`.
- **commit만으론 불충분 — 반드시 `git push origin main`과 묶어서**(2분 폴러가 push 안 한 로컬 커밋을 `reset --hard`로 소실시킴, CLAUDE.md 배포 절 참조).

## 문서 동기화 DoD

- **API 변경 → `API_SPEC.md` + `CLAUDE_COWORK_API.md` 항상 함께 갱신.** 엔드포인트 존재 drift는 `backend/tests/test_api_doc_sync.py`가 자동 검출(라이브 `app.routes` ↔ 문서의 `` ### `METHOD /path` `` 헤더 대조)하지만, 요청/응답 스키마·인증 게이팅 동기는 수동 DoD.
- **기능 표면(화면·env 키·스택·아키텍처·배치) 변경 → `README.md` 해당 절도 같은 PR에서 갱신.** README는 overview 레벨 — 엔드포인트 세부는 중복하지 않는다.
- 배치 fetch 소스 변경 → `backend/services/batch_registry.py`의 그 배치 `source`도 갱신(`source`=fetch 출처, `usage`=소비 UI).

## 기타

- KR 종목 series를 yfinance tz-aware series와 정렬할 땐 한쪽 인덱스 `tz_localize(None)` 필수.
- HTML 파싱은 `BeautifulSoup(html, "html.parser")` (stdlib) — 로컬 `.venv`엔 lxml 부재.
- yfinance 퍼센트 필드는 소수분수(0.0098=0.98%) — 표시 시 ×100, 문서/fixture 예시값도 분수 스케일로.

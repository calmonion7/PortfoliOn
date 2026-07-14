---
last_mapped_commit: 8e37e2ca03c09e76a31dd227d4c252f19246a11a
mapped: 2026-07-14
---

# CONVENTIONS

PortfoliOn 코드 스타일·명명·패턴·에러 처리 규약. 도메인 용어 정의는 CONTEXT.md 소관 — 여기는 "코드가 어떻게 쓰이는가"만.

## 1. Backend Python 스타일

- **파일 상단 `from __future__ import annotations`** 를 새 모듈에 관용적으로 붙인다(`backend/services/utils.py`, `backend/services/dividends.py`). 문자열 반환형(`"dict | None"`)도 종종 쓴다.
- **타입 힌트 + 반환형 명시**: `def is_valid_ticker(ticker: str) -> bool`, `def _dart_key() -> str`. 함수 시그니처에 힌트를 다는 게 표준.
- **모듈 docstring + 함수 docstring(한국어)**: 서비스 모듈 상단에 소스·정규화·분기 규칙을 한국어 docstring으로 요약(`dividends.py:1-12`). 함수 docstring도 한국어로 "무엇을·어떤 조건에" 형태.
- **private 심볼은 `_` 접두**: `_get_corp_code_map`, `_dart_key`, `_build_all`, `_migrate`. 모듈 내부 헬퍼·상수(`_DART_BASE`, `_REPRT_ANNUAL`, `_KST`)에 일관 적용.
- **섹션 배너 주석**: `# ── US: yfinance ──────────` 형태의 구분선으로 큰 함수 묶음을 나눈다(`dividends.py:41`).
- **KST 날짜는 `services.utils.today_kst()`** — 컨테이너가 UTC라 bare `date.today()` 금지. `datetime.now(ZoneInfo("Asia/Seoul")).date()` 패턴을 헬퍼로 통일(`utils.py:11-13`).
- **DB 접근은 `services.db`의 `query`/`execute`/`execute_many`/`get_connection`을 통한다**(`from services.db import execute, query, get_connection`). 라우터·서비스는 커넥션 풀을 직접 만지지 않는다.
- 티커 정규화 헬퍼는 `services.utils`에 집약(`is_valid_ticker`·`find_ticker`·`find_ticker_index`·`ticker_exists_in`) — 대소문자·strip을 이 계층에서 흡수.

## 2. Frontend React/JS 스타일

- **세미콜론 없는 스타일**: import·문장 끝에 세미콜론을 쓰지 않는다(`frontend/src/hooks/usePortfolioData.js:1`, 테스트 파일 동일). 신규 코드도 이 스타일에 맞춘다.
- **plain CSS(TailwindCSS 없음)**: 색·간격 등은 CSS 커스텀 프로퍼티(토큰)로. `frontend/src/styles/tokens.css`가 정본(§9).
- **hook 규약**: 커스텀 훅은 `useXxx.js`(`frontend/src/hooks/`), 상태는 `useState`, 이펙트 콜백은 `useCallback`으로 감싼다(`usePortfolioData.js`). API 호출은 항상 `frontend/src/api` 모듈(axios 래퍼)을 import해 쓴다(직접 `fetch` 금지 관례).
- **인라인 한국어 주석으로 미묘한 순서·게이트 설명**: 상태 갱신 순서, 폴링 틱 게이트 등 함정을 주석으로 명시(`usePortfolioData.js:16-17,25`).

## 3. NaN/inf sanitize discipline

- **starlette `JSONResponse`는 `allow_nan=False`** — 응답 dict에 `NaN`/`inf`가 있으면 직렬화에서 **500**(`Out of range float values are not JSON compliant`).
- **`services.utils.sanitize(obj)`** 가 안전망: dict/list를 재귀 순회하며 비유한 float(`math.isnan`/`math.isinf`)를 `None`으로 치환(`utils.py:36-43`).
- **시세·합산을 응답에 싣는 엔드포인트는 반환을 `sanitize(...)`로 감싼다**. 실사용처: `routers/portfolio.py`(rebalance·exposure), `routers/recommendations.py:210`, `routers/stocks.py:313,645`(dashboard), `routers/report.py`(alias `_sanitize`).
- **가드는 가능하면 소스에서**: 외부 시세가 NaN이면(`math.isfinite` 체크) "시세 없음"으로 먼저 처리하는 게 출력 일괄 sanitize보다 깨끗(예: `_usdkrw_rate`의 `math.isfinite` 가드). `if fx is None` 류 가드는 NaN을 통과시키므로(NaN≠None) `isfinite`를 써야 한다.
- **폴백이 다르게 가린다**: PostgreSQL `json` 컬럼은 NaN을 거부(저장 실패)하지만 파이썬 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백은 통과 → DB 실패·파일 성공·응답 500으로 증상이 엇갈린다.

## 4. 로깅 방출 규약 (Logging)

**전체 정본은 이 절.** 백엔드는 자동 가드(테스트)까지 있고, 프론트는 관례+리뷰 의존.

### 4.1 Backend

- **모듈 `logger`로 통일, `print` 신규 금지**: 각 모듈 상단 `logger = logging.getLogger(__name__)`(`services/*.py` 전반). 앱 코드 `print(` = 0.
- **자동 가드 `backend/tests/test_no_print.py`**: `ast`로 `print()` 호출 노드를 탐지, 대상은 `main.py`·`routers`·`services`·`scheduler`·`middleware`(`tests/`·`scripts/`·`data/` 제외). 신규 `print`가 새어들면 즉시 실패.
- **루트 로거 1회 배선 — `main.py:_configure_logging()`**(`main.py:16-28`): 기동 시 `logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")` + 노이즈 라이브러리(urllib3/yfinance/apscheduler/asyncio)를 `WARNING`으로 억제 + uvicorn 로거 `propagate=False`(중복 emit 방지). **이 config가 없으면 root lastResort=WARNING이라 `logger.info`가 docker logs에 안 뜬다.**
- **레벨 의미**: `warning`=graceful 담화(예상된 실패 폴백), `error`=예상치 못함·데이터 손실(아껴 쓴다), `info`=배치/라이프사이클.
- **메시지 포맷**: `logger.x(f"[Component] <무엇> (<ids>): {e}")`. `[Component]`는 PascalCase, **개념당 1스펠링**(formatter 프리픽스가 없어 메시지 내 `[마커]`가 유일한 grep 앵커). 실사용 마커: `[Sector]`·`[Correlation]`·`[AGM]`·`[Backlog]`·`[Beta]`·`[Dividends]` 등.

### 4.2 Frontend

- **`console.warn`/`console.error`만 진단에 쓴다** — `console.log`는 방출용 아님. `.warn`=graceful(폴백 있는 실패), `.error`=예상외·폴백 없는 실패.
- **마커는 소스 모듈/훅명 실명**(백엔드 개념명과 다름): `[usePortfolioData]`·`[useReportList]`·`[PermissionPanel]`·`[Analytics]`·`[AdminAnalytics]`·`[ReportManualGen]`. `frontend/src` 전체 `console.warn/error`는 모두 `[모듈/훅명]` 마커로 시작(무마커 grep 0).
- **자동 가드 없음(인수된 갭)**: `vite build`·`deploy.sh`·CI 어디에도 lint가 안 걸려 eslint `no-console`을 넣어도 죽은 가드다. §4.2는 **관례+리뷰 의존**으로만 강제된다. 강제하려면 "규칙 추가"가 아니라 lint를 build/deploy/CI에 **먼저 배선**하는 게 선행 조건.

## 5. 마이그레이션 페어링 (schema + `_migrate`)

- **신규 DB 컬럼은 `app_schema.sql`만으론 배포에 반영 안 된다** — 스키마 파일은 신규 설치용, 라이브 DB는 기동 idempotent 마이그레이션만 탄다.
- **`main.py:_migrate()`에 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`를 쌍으로 추가 필수**(`main.py:57-`, 실사용 다수: `backlog_history.segments`·`stock_disclosures.meeting_date`·`stock_recommendations.{low_liquidity,exchange,name}`·`user_stocks.{target_price,...}`·`tickers.key_resource` 등). `_migrate`는 `execute(...)` DDL 나열이며 기동 시 1회 실행(`main.py:207`).
- **완료 기준(DoD)**: 컬럼 추가 슬라이스는 `app_schema.sql` + `_migrate` 두 파일 쌍을 명시. 한쪽만 고치면 배포 직후 그 컬럼 INSERT/SELECT가 컬럼 부재로 깨진다. 리뷰도 변경 파일 밖 배선 계층(`_migrate`·`include_router`·`batch_registry`)까지 본다.

## 6. API 문서 동기화 (doc-sync)

- **정본 2개**: `API_SPEC.md`(전체 REST 레퍼런스) + `CLAUDE_COWORK_API.md`(외부 Cowork enrich/backlog 워크플로우 전용).
- **자동 가드 `backend/tests/test_api_doc_sync.py`**: 라이브 `app.routes`(데코레이터 파싱 아님) ↔ 두 문서의 ```### `METHOD /path` ``` 헤더를 대조. `_norm`으로 path param 철자·쿼리스트링·끝 슬래시를 정규화. 미문서화 baseline `KNOWN_UNDOCUMENTED = frozenset()`(task#100에서 0으로 동결) — 새 엔드포인트를 `API_SPEC.md`에 안 적으면 `test_api_spec_documents_all_live_endpoints`가 실패. 삭제 누락은 `test_*_has_no_stale_endpoints`가 검출.
- **테스트는 존재(method+path)만 검증** — 요청/응답 스키마·인증 게이팅 동기는 여전히 수동 DoD(prose 파싱 안 함).
- **"2문서 모두"는 Cowork 관련 엔드포인트에 한한다**: 사용자 대면 read 엔드포인트(`/api/portfolio/*`·admin 배치 refresh 등)는 `API_SPEC.md`에만. 신규 엔드포인트가 Cowork 소비 대상인지 먼저 판별해 DoD를 좁힌다(기계적 "둘 다"는 과함).

## 7. README 동기 DoD

- **기능 표면을 바꾸면 `README.md` 해당 절도 같은 PR에서 갱신**. 표면 = ① 화면 구성(nav 탭/화면 기능) ② 환경변수(env/데이터 소스 키) ③ 기술 스택 ④ 아키텍처(router/service/table) ⑤ 배치.
- README는 **overview 레벨** — 엔드포인트/요청·응답 스키마 세부는 여기 중복하지 말고 `API_SPEC.md`/`CLAUDE_COWORK_API.md`에만(§6와 역할 분담).

## 8. Additive 변경 가토 (response / mock / auth)

- **비-additive reshape(배열→객체 등)는 그 엔드포인트를 fetch하는 *모든* 프론트 소비처를 전수 grep**: `grep -rn '<경로>' frontend/src/`. 훅과 별개로 직접 fetch하는 페이지(예: `Analytics.jsx`가 `/api/stocks/dashboard`를 독립 fetch)가 옛 형태로 조용히 깨진다. 가능하면 **additive(필드 추가)**를 선호.
- **read/외부호출을 additive로 추가하면 `mock.call_args`(마지막 호출) 단언 테스트가 오염**된다 — 호출 시퀀스가 늘어 마지막 호출이 바뀐다. 대응: ① 기존 단언을 호출별 `call_args_list[i].kwargs`로 마이그레이션, ② 신규 호출은 `if <조건>:`로 입력 비면 생략해 기존 테스트 보존, ③ 신규 테스트가 `call_count`로 시퀀스를 못박음.
- **auth `Depends`(get_current_user/require_admin/require_admin_or_api_key) 추가는 자체-app 테스트를 401/403로 깨뜨린다** — 다수 테스트가 conftest `client`가 아니라 모듈 상단에서 `FastAPI()`를 직접 만들어 `app.dependency_overrides[...]`로 auth를 우회한다(§TESTING 참고). 의존성 추가 시 그 경로를 호출하는 자체-app 테스트를 전수 grep해 override를 추가. 무인증 거부(401/403)는 override 없는 fresh app으로 별도 검증.

## 9. KR 색 토큰 (`--up`=red / `--down`=blue)

- `frontend/src/styles/tokens.css`: **`--up`=빨강(상승)·`--down`=파랑(하락)** — KR 관례(Western과 반대). light `#d9364c`/`#2f6fe0`, dark `#f6465d`/`#4a8cff`(`tokens.css:47-50,149-152`).
- **의미 상태 배지에 `success`/`danger` 변형 쓰지 말 것**: `.badge--success`=빨강·`.badge--danger`=파랑(가격 토큰에 물려 있어)이라 Western 통념(녹=좋음/빨=경고)과 반전된다. 의미 배지는 `ui/SupplyBadge.jsx`처럼 전용 색을 명시(가격 토큰 미사용). `warning` 변형은 토큰 미정의로 현재 깨져 있어 쓸 수 없다.
- UI 리뷰는 variant 이름의 통념이 아니라 토큰 실제값을 대조한다.

## 10. Dual-source 패턴 (name / enriched_at)

- **종목명 dual-source**: `tickers.name`(공유 마스터, 종목관리 목록이 live로 읽음) vs `snapshots.data.name`(리포트 생성 시 박제, 리서치 목록·상세가 읽음). 이름 변경 시 **둘 다** 갱신해야 목록↔상세가 일치(`storage.refresh_snapshot_names` 단건 / `reconcile_snapshot_names` 전체). DB만 바꾸면 `cache.get_list`·스냅샷 LRU 탓에 화면 미반영 → `cache.invalidate(ticker)`+`invalidate_list()` 필수.
- **`enriched_at`(AI 분석 존재) 정본은 `tickers` 테이블 컬럼 — 스냅샷 `data` JSON엔 없다**. 신규 판정/표시 필드를 붙일 땐 정본 저장 위치를 가정하지 말고 기존 소비처(`report.py` 등)를 grep으로 확정하고, 테스트가 실구조(테이블·컬럼)를 단언할 것. 스냅샷 JSON에서 읽도록 가정하면 fixture는 green인데 라이브는 항상 False(fixture-pass-live-fail의 저장소 혼동판).

## 11. 심볼/배치 id 변경 시 grep 규율

- **모듈에서 심볼(import·함수)을 제거/개명하면 그 심볼을 patch하는 테스트를 파일 불문 전수 grep**(`grep -rn "모듈경로.심볼" backend/tests/`) — mock 타깃은 "그 기능의 주 테스트 파일"에만 있지 않다.
- **배치 id를 `batch_registry.BATCHES`에서 빼면 모든 표면 전수 grep**: 데이터 read·표시 문자열·`job_runs.record(id,...)` 모든 lane(auto/manual/backfill)·그 id를 단언하는 테스트.
- **id를 추가할 때도 테스트의 count/set 하드코딩 단언을 전수 grep**: `grep -rn "BATCHES) ==\|len(data) ==\|EXPECTED_IDS" backend/tests/`. exact-count/exact-set 단언이 여러 파일(`test_macro_signals_batch.py`·`test_batch_market_split.py`·`test_batches_router.py`)에 흩어져 있어(현재 `== 29`) 한 파일만 고치면 나머지가 스위트에서 깨진다.
- `batch_registry`의 `source`(데이터 fetch 출처)와 `usage`(소비 UI)는 반대 방향 — fetch 소스를 바꾸면 `source`도 갱신(DoD).

---
last_mapped_commit: 91bac67ddb3ca7277a850fa6840a0fce0f7344cf
mapped: 2026-07-30
---

# CONVENTIONS — 코드 규약 지도

이 문서는 **구현 사실**만 담는다(도메인 용어 정의는 `CONTEXT.md` 소관). 각 규약은 가능하면
**그 규약을 강제하는 파일**과 함께 적는다. 자동 가드가 없는 규약은 그렇게 명기한다.
테스트/가드의 실행 방법·모킹 패턴은 형제 문서 `.forge/codebase/TESTING.md`를 본다.

섹션 번호는 안정적이다 — 코드·계획 문서가 `CONVENTIONS §4`(로깅), `§4.1`(방출 메커니즘),
`§4.3`(마커 포맷)을 직접 인용한다(`backend/tests/test_no_print.py:1,35`, `backend/main.py:22`).
번호를 재배열하지 말 것.

---

## §1 핵심 원칙

### 1.1 표면 보존 리팩터 (ADR-0017)
거대 파일을 패키지로 쪼갤 때 `__init__.py`가 **공개 + 외부참조 private 심볼 전체**를
re-export해 호출 표면을 보존한다. 근거·규칙 6항은 `.forge/adr/0017-god-file-split-via-package-reexport.md:15-37`.
핵심 제약 2가지: **`from .sub import *` 금지**(underscore private을 건너뛴다 — `:37`),
**서브모듈은 패키지 루트가 아니라 leaf 모듈에서 공유 헬퍼를 import**(부분 초기화 순환 회피).

### 1.2 additive 우선
엔드포인트 응답을 배열→객체처럼 **비-additive**로 바꾸면 프론트 소비처를 전수 감사해야 한다
(`grep -rn '<경로>' frontend/src/`). 가능하면 필드 추가로 처리한다. additive 추가도
공짜가 아니다 — 호출 *시퀀스*가 늘어나 `mock.call_args`(마지막 호출)를 단언하는 기존
테스트를 오염시킨다(TESTING.md §4.2).

### 1.3 wrong < missing — 빈 결과가 직전 양호값을 덮지 않는다
외부 fetch가 빈 결과를 주면 **저장을 생략하고 직전값을 유지**한다. 틀린 값이 남는 것보다
없는 게 낫다. **기본형은 "저장 직전 한 지점의 끝 가드"가 아니라 소스-폴백**이다:

- 소스-폴백(구조적으로 안전) — `backend/services/market_indicators/fx.py:36-40`(fetch 실패 시
  `stored_history`를 담아 반환), `backend/services/market_indicators/cache.py:69-72`
  (`_merge_history(prev, [])`가 prev를 그대로 반환), `backend/services/dividends.py:388-392`
  (`replace_schedule` **진입 전에** fetch를 평가).
- 끝 가드를 쓸 수밖에 없으면 **실패 클래스 3종을 모두** 물어야 한다:
  (a) **예외**(try/except) (b) **성공-but-빈응답**(`rt_cd=0`·HTTP 200 with 0 items — 예외 가드를
  그냥 통과한다) (c) **부분 페이로드**(한 payload의 일부 필드만 가드하면 나머지가 새어나간다 —
  `backend/services/kr_sector_service.py`가 `sectors`만 보고 같은 payload의 `index`를 빠뜨린 사례.
  대응은 `index = build_sector_index() or load_sector_index()`처럼 필드별 직전값 보존).
- **delete-rewrite(replace) 저장은 파괴적 변형**이다 — fetch 실패를 빈 결과로 삼키면 저장 생략이
  아니라 `DELETE`로 직전값을 지운다. fetch 함수가 예외를 전파해 호출측이 replace를 통째
  스킵하게 하고, delete+insert는 단일 트랜잭션으로 묶는다
  (`backend/services/recommendation/store.py:19-58`).
- 저장을 스킵했으면 **admin 응답·로그가 "갱신됨"과 "생략·직전값 유지"를 구분**해야 관측이 성립한다
  (`stale` 마커 + `saved` 플래그 — `backend/services/market_indicators/exports.py`,
  `backend/routers/market_indicators.py` refresh-monthly). `job_runs`는 본문이 예외를 전파할 때만
  `failed`를 기록하므로 스킵을 초록으로 남긴다(`backend/services/job_runs.py:17-31` docstring).

회귀 가드: `backend/tests/test_empty_result_overwrite_guards.py`,
`backend/tests/test_empty_result_guards_exports_krsector.py`,
`backend/tests/test_rankings_empty_guard.py`, `backend/tests/test_us_supply_empty_guard.py`,
`backend/tests/test_fx_partial_failure.py`.

### 1.4 graceful degradation — 부가기능은 본문을 깨뜨리지 않는다
계측·캐시·부가 read는 실패해도 주 경로를 중단시키지 않는다. 대표 구현:

- `backend/services/job_runs.py` — DB 접촉 전부를 개별 try/except로 감싸고 `run_id=None`을
  센티널로 쓴다(`:19` *"계측은 관측 전용 — 본문(배치)을 절대 깨뜨리지 않는다"*).
- `backend/main.py:60-238` `_migrate()` — 테이블 단위로 try/except, 실패는
  `logger.warning(f"[Migrate] ...")`만 하고 기동을 계속한다.
- `backend/routers/stocks.py` `_build_all` — 카드당 `_safe` 래핑으로 per-card 실패가 전체 500이
  되지 않게 한다(`_minimal_card` 폴백).

단, **graceful이 "조용히"여서는 안 된다** — §4.2의 warning 레벨로 반드시 담화를 남긴다.
broad `except Exception: pass`는 기능이 조용히 꺼지는 원인이며, 현재 잔존은
`backend/middleware/event_tracker.py:48-49,70-71` 등 소수다.

---

## §2 백엔드 모듈·패키지 구조

### 2.1 `__init__.py` re-export 3스타일
| 스타일 | 예 | 특징 |
|---|---|---|
| A. 표면 보존 re-export(`__all__` 없음) | `backend/services/market/__init__.py:8-39`, `backend/services/storage/__init__.py:1-44`, `backend/scheduler/__init__.py:3-60` | 헤더 주석에 ADR 인용. private 심볼까지 명시 named import. `scheduler/__init__.py:11-50`은 38개 private 잡 함수 + `_JOB_FUNCS`를 열거 |
| B. `__all__` 선언형 | `backend/services/market_indicators/__init__.py:13-25`, `backend/services/recommendation/__init__.py:16-24` | 백엔드 전체에서 `__all__`을 쓰는 파일은 이 2개뿐 |
| C. re-export 없음(경계 문서용 1줄) | `backend/services/kiwoom/__init__.py:1`, `backend/services/kis/__init__.py:1` | 소비처가 서브모듈을 직접 import하며 함수 내부 지연 import + 짧은 alias(`from services.kiwoom import client, quote as kq` — `backend/services/market/kr.py:74`) |

`backend/services/__init__.py`·`routers/__init__.py`·`middleware/__init__.py`는 0바이트다.
leaf 공유 상태는 별도 모듈로 뺀다 — `backend/scheduler/_state.py:5`(스케줄러 싱글톤),
`backend/services/market/format.py:1-14`(`_SECTOR_NORM`/`_norm_sector`).

### 2.2 지연 import
무겁거나 순환 위험이 있는 의존은 **함수 안에서** import한다
(`backend/routers/report.py:115,331,342,...`, `backend/main.py:53,63,257-258`,
`backend/scheduler/jobs.py:18,39,55,...`, `backend/services/market_indicators/cache.py:44,86`).
→ 테스트 patch 타깃이 달라진다(TESTING.md §4.2).

### 2.3 모듈 레벨 import + dotted 호출 (patch 가능성 확보)
라우터는 `from services import storage`처럼 모듈을 잡고 `storage.get_holdings(...)`로 부른다
(`backend/routers/portfolio.py:6-13`, `backend/routers/watchlist.py:4-7`). alias는
`_svc`/`_pipeline` 접미로 통일(`market as market_svc`, `cache as cache_svc`,
`consensus_pipeline as _pipeline`). 그래서 테스트가
`patch("routers.portfolio.storage.get_holdings")`로 끊을 수 있다.

### 2.4 ADR·task 역참조 주석
코드 주석에 `ADR-0008`(`backend/routers/report.py:464`), `.forge/adr/0015`
(`backend/services/recommendation/__init__.py:1`), `task#NNN`, `CONCERNS §N`
(`backend/services/db.py:24`, `backend/main.py:256`)을 직접 인용하는 것이 관례다.
새 결정 코드에도 근거 포인터를 남긴다.

---

## §3 명명·타입 규약

### 3.1 식별자는 영문 snake_case, 주석·docstring은 한국어
AST 집계로 docstring 420개 중 **409개가 한글**이다. 영문 docstring 11개는 순수 계산/파싱
헬퍼에 남아 있다(`backend/services/indicators.py:47,105,121`,
`backend/services/market/format.py:35,49`, `backend/routers/calendar.py:146,173`).
docstring은 1줄 요약형(`backend/services/db.py:45` `"""단일 SELECT — 결과를 dict 리스트로 반환."""`)
또는 규약·함정을 길게 적는 형(`backend/services/job_runs.py:17-31`) 둘 다 쓰인다.

### 3.2 접두 관례
| 접두 | 뜻 | 예 |
|---|---|---|
| `_` | 모듈 private(함수·상수·싱글톤) | `_slim_summary`(`backend/routers/report.py:35`), `_BY_ID`(`backend/services/batch_registry.py:468`), `_pool`/`_lock`(`backend/services/db.py:12-13`) |
| `_get_cache`/`_set_cache` | 인메모리 캐시 | `backend/services/market_indicators/cache.py:18,25` |
| `_mc_load`/`_mc_save`/`_mc_delete` | PostgreSQL `market_cache` I/O | `backend/services/market_indicators/cache.py:33,43,56` (타 패키지도 이 private을 import — `backend/services/kr_sector_service.py:15`) |
| `_fetch_*` | 외부 데이터 획득 | `backend/services/market_indicators/fx.py:12,23` 등. **주의**: `backend/scheduler/jobs.py:149,159,...`에선 같은 접두가 *스케줄러 잡 래퍼*를 뜻한다 |
| `_run_*` | 라우터의 백그라운드 태스크 진입점 | `backend/routers/report.py:69,124,...` |
| `_refresh_*` / `_seed_*` / `_upsert_*` | 스케줄 갱신 잡 / 기동 시드 / DB 쓰기 | `backend/scheduler/jobs.py:71-121,487`, `backend/services/leverage_service.py:125` |

화이트리스트 집합은 `frozenset`으로 둔다(`backend/services/storage/portfolio.py:5-6`,
`backend/tests/test_no_public_reads.py:28`).

### 3.3 타입 어노테이션 — 로컬 3.9.6 / 배포 3.12 발산이 하드 제약
- 배포 이미지는 `backend/Dockerfile:1` `python:3.12-slim`, 로컬 검증 인터프리터는
  `backend/.venv/bin/python` = **3.9.6**. `backend/requirements.txt`엔 버전 핀이 없다.
- **런타임 평가되는 어노테이션에 PEP604 `X | None`을 쓰려면 그 파일에
  `from __future__ import annotations`가 있어야 한다.** 현재 앱 파일 107개 중 67개가 이 import를
  갖고 있고, PEP604 `| None`은 149곳에 쓰인다. 없는 파일(모든 라우터, `main.py`, `auth.py`,
  `backend/services/storage/*.py` 등)에서는 `Optional[X]`(60곳) 또는 **문자열 인용 어노테이션**
  으로 우회한다(`backend/routers/stocks.py:242,483,600,607`이 유일한 4곳).
- 결론: **Pydantic 모델·FastAPI 시그니처에 unquoted `X | None`을 넣기 전에 그 파일의
  `__future__` import를 확인**할 것. 자동 가드는 없고 로컬 pytest가 사실상의 게이트다.
- `list[dict]`류 PEP585 builtin 제네릭은 3.9에서 합법이라 `__future__` 없이도 쓰인다.

---

## §4 로깅 방출 규약

> **버그를 드러내기 위한 로그 패턴.** 이 절을 코드·계획이 `CONVENTIONS §4`로 인용한다.

### 4.1 방출 메커니즘 — 모듈 `logger` 통일, `print` 금지
- 앱 코드는 `logger = logging.getLogger(__name__)`을 모듈 상단에 둔다(**57개 파일**).
  `print()`는 신규 금지이며 현재 0건이다.
- **강제 가드**: `backend/tests/test_no_print.py` — `main.py`·`routers`·`services`·`scheduler`·
  `middleware`를 AST로 훑어 `print()` 호출 노드를 잡는다(문자열/주석/`pprint` 오탐 없음).
  `tests/`·`scripts/`·`data/`는 대상 외.
- 이름 편차 1건: `backend/services/job_runs.py:10`은 `log = logging.getLogger(__name__)`이고
  그 6곳만 lazy `%s` 포매팅 + `exc_info=True`를 쓴다(`:39,50,62,72,84,101`).
- **`print`→`logger` 전환 스윕은 `capsys`로 stdout/stderr를 검사하던 테스트를 깨뜨린다.**
  전환 전에 `grep -rn capsys backend/tests/`로 그 테스트를 찾아 **`caplog` 마이그레이션을
  슬라이스에 미리 넣을 것**(사후 수복 6건 발생 이력). 현재 `caplog` 사용 6파일, `capsys` 1파일.

### 4.2 레벨 의미
| 레벨 | 언제 | 비고 |
|---|---|---|
| `logger.info` | 배치·라이프사이클 | config 없으면 root lastResort가 WARNING+만 내보내 docker logs에 **안 뜬다** → §4.4 |
| `logger.warning` | graceful degradation의 담화(폴백·스킵·부분 실패) | 가장 흔한 레벨 |
| `logger.error` | 예상치 못함·데이터 손실 | 아껴 쓴다 |

### 4.3 포맷·마커
표준형: `logger.x(f"[Component] <무엇> (<ids>): {e}")`.
예: `backend/services/market_indicators/cache.py:39`
`logger.warning(f"[Cache] _mc_load key={key} 실패: {e}")`.

- 마커는 **PascalCase**, **개념당 1스펠링**. formatter에 컴포넌트 프리픽스가 없으므로
  메시지 안의 마커가 **유일한 grep 앵커**다.
- 현황: 문자열 리터럴로 시작하는 logger 호출 **287개가 전부 `[Marker]`로 시작**(위반 0).
  공백 포함·소문자 마커도 0.
- 남은 편차는 "개념당 1스펠링" 쪽이다(기능 결함 아님, 신규 코드에서 재생산 금지):
  시세 계열 `[Quote]`/`[KRQuote]`/`[KiwoomQuote]`/`[KISQuote]`/`[BatchQuote]`/`[KiwoomCloses]`/
  `[BatchClose]`, 애널리스트 계열 `[Analyst]`/`[AnalystData]`/`[AnalystReport]`,
  섹터 `[Sector]`/`[KrSector]`/`[UsSector]`, 추천 `[Recommendations]`/`[Funnel]`/`[Universe]`.
  `Service` 접미가 붙은 유일 사례는 `[LeverageService]`(`backend/services/leverage_service.py:252`).
  `[Scheduler]`는 74건으로 최다인데 모듈 단위 마커라 잡 개별 식별은 메시지 본문에만 있다.

### 4.4 노이즈 제어 — 루트 로거 1회 배선
`backend/main.py:18-30` `_configure_logging()`가 **라우터 import보다 먼저**(`:32` 이전) 호출된다.
`basicConfig(level=INFO, format="%(levelname)s %(name)s: %(message)s")`(`:23`) +
`urllib3`/`yfinance`/`apscheduler`/`asyncio`를 WARNING으로 억제(`:24-25`) +
`uvicorn*.propagate = False`로 root 핸들러 중복 emit 차단(`:26-27`).

### 4.5 프론트 로깅 (`console.*`)
- 마커는 **소스 모듈/훅명 실명**이다(백엔드의 개념명과 다르다) → 훅은 camelCase
  (`[usePortfolioData]`, `[useReportList]`), 컴포넌트·페이지는 PascalCase(`[GuruAllocation]` 등).
- 레벨: `console.warn` = graceful(부가 fetch 실패, 섹션만 숨김 — `frontend/src/pages/Reports.jsx:110`
  주석이 그 판단을 적어둔다), `console.error` = 예상외·주 로드/사용자 mutation 실패.
- 현황: `frontend/src`(테스트 제외) `console.warn` 13 + `console.error` 13 = **26건이 전부 마커
  보유**, `console.log`/`info`/`debug` 0건. 메시지는 한국어.
  두 하위 스타일이 공존한다 — 훅·`AdminAnalytics`는 `(<엔드포인트>) 조회 실패`,
  Guru/Analyst 페이지는 콜론 접미 + 경로 없음.
- **자동 가드 없음.** `frontend/eslint.config.js`에는 `rules` 블록이 아예 없고 `no-console`도
  미설정이며, lint는 CI/훅에 연결돼 있지 않다(§9.8). 관례 + 리뷰 의존.
- 로그를 아예 안 남기는 침묵 catch는 규약 위반은 아니지만 알아둘 것:
  `frontend/src/App.jsx:40,146-149`, `frontend/src/utils/analytics.js:11`,
  `frontend/src/hooks/useReportGeneration.js:23`, `frontend/src/contexts/AuthContext.jsx:23-26`,
  각 market 섹션의 `.catch(() => setError(true))`.

---

## §5 에러 처리·직렬화 방어 (백엔드)

### 5.1 예외 팩토리와 `HTTPException`
- `backend/services/errors.py:4,9` — `not_found(ticker, context="")`(404),
  `already_exists(...)`(400). **return**이므로 호출측이 `raise errors.x(...)`.
  소비처는 `backend/routers/watchlist.py`·`portfolio.py` 2개뿐이고 나머지는 인라인 raise다.
- 항상 키워드형 `raise HTTPException(status_code=..., detail=...)`.
  `status.HTTP_401_UNAUTHORIZED` 심볼형은 `backend/auth.py:22,32,47,58`만 쓴다.
- **detail 언어가 혼재**한다(단일 규칙 없음): 개발자향은 영문(`"Admin only"`,
  `"market must be KR or US"`), 사용자향은 한국어(`"리포트를 먼저 생성하세요"`,
  `"어드민 계정은 삭제할 수 없습니다"`). `backend/routers/stocks.py:286,288`처럼 인접 줄에서
  영문·한국어가 섞이는 곳도 있다.
- `backend/routers/market_indicators.py`는 모든 GET이
  `except Exception as e: raise HTTPException(500, detail=str(e))` 복붙 패턴이라 원문 예외가
  클라이언트로 새어나간다(알려진 성질).
- `ValueError` → 400 번역은 라우터 경계에서 한다(`backend/routers/batches.py:86-87`).

### 5.2 NaN/inf 3중 방어 (출력·입력·전역)
starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 NaN/inf가 있으면 **500**이 난다.

1. **소스 가드** — `math.isfinite` 후 None으로 떨구는 지역 헬퍼가 ~45곳
   (`backend/services/beta.py:27`, `report_generator.py:35,82`, `indicators.py:32,61,131`,
   `market/format.py:46,58` …). 규약을 docstring에 적어둔 예:
   `backend/services/recommendation/funnel.py:151`.
2. **출력 sanitize** — `backend/services/utils.py:36` `sanitize(obj)`가 float NaN/inf를 재귀적으로
   None화한다. 응답 경계(`backend/routers/stocks.py:317,673`, `portfolio.py:131,164,208`,
   `report.py:43,152,157`, `analyst_reports.py:67,85,105,118`)와 **저장 직전**
   (`backend/services/report_generator.py:439-446,615-622`,
   `market_indicators/sentiment.py:70`, `indices.py:138`, `kospi_futures.py:50`)에 함께 쓴다.
3. **입력 가드** — Pydantic float은 기본 `allow_inf_nan=True`이므로 raw JSON의 `NaN` 토큰이
   통과하고, NaN 비교는 항상 False라 범위 검증도 못 잡는다.
   → `Field(..., allow_inf_nan=False)`를 명시한다(`backend/routers/analyst_reports.py:42-43`,
   근거 주석 `:40-41`). 거부하면 FastAPI 기본 422 detail이 입력 NaN을 echo해 다시 500이 되므로
   **전역 핸들러**가 막는다: `backend/main.py:253-259` `RequestValidationError` →
   `JSONResponse(422, {"detail": sanitize(jsonable_encoder(exc.errors()))})`.
   등록된 예외 핸들러는 이것뿐이다.

가드 회귀: `backend/tests/test_nan_serialization_guards.py`.

### 5.3 "best-effort, 절대 호출자를 깨지 않는다" 관용구
`try: ... except Exception as e: logger.warning(...); return <empty>`가 서비스 계층 지배형이다
(`backend/routers/stocks.py:79-84,358-360`, `backend/services/market_indicators/cache.py:38-40,52-53,59-60`,
`backend/services/job_runs.py:38-39,49-50`). §1.4와 함께 읽을 것.

---

## §6 라우터·API 규약

- 파일당 라우터 1개, 모듈 상단에 `router = APIRouter(prefix=..., tags=[...])`(19개).
  prefix는 도메인형(`/api/stocks`)과 bare `"/api"`형(`backend/routers/report.py:22`,
  `calendar.py:55`, `batches.py:13` …)이 공존한다. 등록은 `backend/main.py:273-291`의 평탄한
  `app.include_router(...)` 목록.
- **인증은 항상 파라미터 단위 `Depends(...)`** — 라우트 수준 `dependencies=[...]`는 0건.
  `Depends(get_current_user)` 72 / `require_admin` 42 / `get_current_user_or_api_key` 10 /
  `require_admin_or_api_key` 6. 결과를 안 쓰면 `_: str = Depends(...)`(58곳), 쓰면
  `user_id`/`admin_id`. 정의는 `backend/auth.py:18,37,61,68`, API 키 센티널은 `:15`.
  `require_admin`은 API 키를 **거부**한다(키로 호출 시 401).
  **강제 가드**: `backend/tests/test_no_public_reads.py`(무인증 `/api` == `ALLOWED_PUBLIC` 9개, 양방향 exact).
- **`response_model=`은 코드베이스 전체에서 0건** — 핸들러는 plain dict/list를 반환한다.
  Pydantic `BaseModel`은 **요청 본문에만** 쓴다. bare `list`/`dict` 본문은 `Body(...)` 필수
  (`backend/routers/batches.py:77`, `report.py:582`, `portfolio.py:168,325`).
  ticker 정규화는 `@field_validator` + `@classmethod`(`backend/routers/watchlist.py:42-48`,
  `portfolio.py:51-57` — 두 곳에 동일 검증자가 중복).
  쓰기는 `status_code=202`(백그라운드 잡, 18곳)·`201`(생성, 4곳)을 명시한다.
- **라우트 순서: 정적 하위경로를 `{param}` catch-all보다 먼저 등록한다.**
  `backend/routers/report.py`가 `/report/{ticker}/{date_str}`(`:458`) 앞에 5개를 두고 각각
  경고 주석을 달아뒀다(`:395,416,425,433,442` — *"5번째 재발 방지"*).
  `backend/routers/analyst_reports.py:3-4`는 이 함정을 **새 prefix를 만든 이유**로 기록한다(ADR-0027).
  같은 위험이 `backend/routers/stocks.py`의 `PUT /enrich/batch`(`:379`) → `PUT /{ticker}/enrich`(`:394`),
  `/search`(`:155`)·`/compare`(`:281`) → `/{ticker}/news`(`:320`)에도 있지만 **주석은 없다**.
  자동 가드 없음.

---

## §7 DB·SQL 규약

- 진입점은 `backend/services/db.py` 3개: `query(sql, params=None) -> list[dict]`(`:44`,
  `RealDictCursor`), `execute(sql, params=None) -> int`(`:52`, rowcount),
  `execute_many(sql, params_list)`(`:60`, 빈 리스트 no-op → `execute_batch`).
  풀은 `ThreadedConnectionPool(minconn=1, maxconn=20)`(`:16-28`) — 주석 `:23-24`가 워커 수보다
  크게 잡는 이유(소진 시 블록이 아니라 `PoolError`)를 적어둔다.
- **플레이스홀더는 `%s` + 튜플 전용.** 배열은 `= ANY(%s)`(psycopg2가 리스트를 PG 배열로 적응).
  **uuid 컬럼에 파이썬 `str` 리스트를 넘길 때는 `ANY(%s::uuid[])` 명시 캐스트 필수** —
  단건 `= %s`는 암묵 캐스트로 동작하지만 배열화하면 `operator does not exist: uuid = text`로
  라이브 즉사한다. 현재 캐스트 사용처는 `backend/routers/admin.py:32` 1곳.
- **동적 SQL은 구조만 문자열 조립**(값은 절대 아님) — `backend/services/consensus.py:81-85`
  `_values_placeholder`. docstring이 함정을 못박는다: **바깥 괄호를 추가로 감싸면
  `VALUES ((a,b),(c,d))`가 N행이 아니라 record 1행이 돼 `AS v(ticker, d)` 매핑이 깨진다.**
  형태 가드: `backend/tests/test_consensus_asof_batch.py:111` `test_values_placeholder_shape`.
- UPSERT는 `ON CONFLICT (...) DO UPDATE SET x = EXCLUDED.x` / `DO NOTHING`.
  **덮어쓰기 방지 조건은 SQL 안에** 둔다 — `backend/services/storage/portfolio.py:58`
  (`name=CASE WHEN EXCLUDED.name IS NULL OR EXCLUDED.name = EXCLUDED.ticker THEN tickers.name ELSE EXCLUDED.name END`),
  `:63`(`is_etf=tickers.is_etf OR EXCLUDED.is_etf`).
- 다중 문장 트랜잭션은 헬퍼를 우회해 `with get_connection() as conn: with conn.cursor() as cur:`
  로 직접 쓴다(`backend/services/recommendation/store.py:25-58`, `storage/portfolio.py:49-85`).
- JSONB 파라미터는 호출측 `json.dumps(...)` + SQL `%s::jsonb`(`store.py:33,51-52`).
- **신규 컬럼은 `backend/app_schema.sql`만으론 배포에 반영되지 않는다** — 라이브 DB는 기동
  idempotent 마이그레이션만 탄다. `backend/main.py:60-238` `_migrate()`에
  `ADD COLUMN IF NOT EXISTS`를 **쌍으로** 추가하는 것이 DoD다. `_migrate()` 구조 관례:
  논리 테이블당 try/except 1블록 + 블록마다 `from services.db import execute` 지역 import(18회) +
  실패는 `logger.warning(f"[Migrate] ...")`만. 예외: `job_runs`는 `_migrate` 대응이 없고
  `backend/app_schema.sql:358-363`이 수동 적용을 지시한다. 자동 가드 없음(수동 DoD).

---

## §8 배치·스케줄러 규약

- 정적 메타 테이블 `backend/services/batch_registry.py:13-466`에 **29개** 엔트리.
  필수 필드 11개(`id`, `label`, `category`, `schedule_desc`, `usage`, `source`, `editable`,
  `trigger_kinds`, `manual_endpoint`, `scheduler_job_id`, `market`) + `timezone`·
  `default_schedule` 28개 + `misfire_grace_time` 6개. `category` ∈ {report, market, guru},
  `market` ∈ {KR, US, 공통}. 모듈 docstring `:2-10`이 불변식을 적어둔다(단 "20개 배치"는 stale).
- **`source`(fetch 출처) ↔ `usage`(소비 UI)는 반대 방향**이다. 배치의 fetch 체인을 바꾸면
  `source`도 같이 고치는 것이 DoD — `GET /api/batches`가 그대로 노출하므로 안 고치면 배치 현황이
  틀린 출처를 보인다. 가드: `backend/tests/test_batches_router.py:52-65`가 `source` **비어있지 않음**만
  단언한다(정확성은 검증 못 함).
- `job_id` == 스케줄러 잡 id == `job_runs.record(id, ...)` 호출 id.
  `with job_runs.record("<batch_id>", "auto"|"manual"):`로 본문 전체를 감싼다
  (auto: `backend/scheduler/jobs.py:19,57,73,...` / manual: `backend/routers/report.py:72,343,...`).
  혼합 배치의 시장 라우팅 예: `backend/routers/report.py:70-72`.
- **배치 id를 은퇴시키면 4표면을 전수 grep**: ① 스케줄 소비처 read ② 표시 문자열
  ③ **`job_runs.record` 모든 lane(auto·manual·backfill)** ④ 그 id를 단언하는 테스트.
  단 옛 id를 *읽는* 시드 마이그레이션은 정당한 잔존이다.
- **id를 추가할 때는 count/set 하드코딩 단언 4곳을 함께 고친다** —
  `backend/tests/test_batches_router.py:26,45-46`(`EXPECTED_IDS` + `== 29`),
  `backend/tests/test_batch_market_split.py:54`(`== 29`),
  `backend/tests/test_macro_signals_batch.py:37`(`== 29`),
  `backend/tests/test_scheduler_seed.py:82`(`editable` 파생).
- 잡 함수 배선: `backend/scheduler/jobs.py:485-514` `_JOB_FUNCS`(28개 = BATCHES − `consensus`),
  소비는 `backend/scheduler/schedule.py:36`. **`editable: True`인데 `_JOB_FUNCS` 키가 없으면
  기동 시 `KeyError`**다.
- `misfire_grace_time`은 `None`을 넘기지 말고 **인자를 생략**한다 — APScheduler가 None을
  "유예 무제한"으로 해석해 거동이 바뀐다(`backend/scheduler/schedule.py:30-31` 주석).
- 스펙 검증·설명은 `backend/services/schedule_spec.py`(4타입, `validate_schedule_spec`가
  `ValueError`, int 필드에 `isinstance(x, bool)` 거부까지).
- **배치-백킹 뷰는 요청·기동 경로에서 외부 API를 라이브 호출하지 않는다** — 배치가 사전계산해
  `market_cache`/테이블에 저장하고 요청은 저장값만 읽는다. 기동 시 빈 캐시 적재는
  `_seed_*_if_empty` 패턴(`backend/scheduler/__init__.py:63-72`).

---

## §9 프론트엔드 규약

### 9.1 파일·명명
- 컴포넌트 PascalCase `.jsx`, 파일당 `export default function X()` 1개.
  훅은 `useXxx.js`(never `.jsx`) 기본 export. 예외는 1줄 re-export shim
  `frontend/src/hooks/useAuth.js:1`.
- JSX를 담은 유틸은 `.jsx` — `frontend/src/components/market/marketUtils.jsx`,
  `frontend/src/components/reports/reportUtils.jsx`(**`.js` 파일은 없다**; 소비처 20곳 중 19곳이
  확장자를 명시한다).
- 배럴은 사실상 사문화: `frontend/src/components/ui/index.js`를 import하는 파일은
  `frontend/src/pages/Showcase.jsx:2` 하나이고, 나머지 ~70곳은 프리미티브 파일을 직접 import한다.
  `Input`·`Skeleton`·도메인 배지 3종은 배럴에 없다.
- 동명 컴포넌트 충돌 주의: `frontend/src/components/ui/Badge.jsx:25`의 `MarketBadge({market, exchange})`와
  `frontend/src/components/ui/icons.jsx:108`의 `MarketBadge({mkt, exchange})`가 별개다.
- 프리미티브는 자기 CSS를 **1행에서** import한다(`frontend/src/components/ui/Badge.jsx:1` 등).
  전역 로드 순서는 `frontend/src/main.jsx:3-5` + `frontend/src/index.css:1-4`로 나뉘어 있다.
- TypeScript 0파일, `propTypes` 0건 — props는 인라인 주석으로만 문서화한다.

### 9.2 스타일·디자인 토큰
- plain CSS(Tailwind·CSS-in-JS 없음). 토큰 정본은 `frontend/src/styles/tokens.css`
  (헤더 `:1-5`가 ADR-0026 에디토리얼 아이덴티티와 "light가 기본" 원칙을 적어둔다).
  폰트 `:8-10`, 타입 스케일 `:13-22`, 표면/텍스트 `:25-34`, 액센트 `:36-39`, 버튼 필 `:43-45`,
  **가격 방향 `:48-52`(`--up` #b3372b 상승, `--down` #2b5c9e 하락)**,
  데이터 팔레트 `:55-59`, `--warn` `:61-62`, **의미 상태 `:65-78`**, radius `:87-91`,
  spacing `:93-98`(4px step), shadow `:100-103`, `--transition-fast` `:105`.
  전역 유틸 클래스·`:focus-visible`도 같은 파일 `:204-259`에 있다.
- **테마는 `<html data-theme="dark">` 속성 하나**로 갈린다(`tokens.css:123-201`).
  토글은 `frontend/src/hooks/useTheme.js:5-18`(+`<meta theme-color>` 동기, localStorage 영속).
  컨텍스트 없이 props로 내린다(`frontend/src/App.jsx:62,72,113`).
  `prefers-color-scheme` 미디어쿼리는 쓰지 않는다.
- **가격 배지와 의미 배지는 전용 변형으로 분리돼 있다 — 교차 사용 금지.**
  `frontend/src/components/ui/Badge.css`: `.badge--up`(`:43-47`)/`.badge--down`(`:49-53`)은
  `--up`/`--down` 바인딩이며 `ChangeBadge` 전용,
  `.badge--success`(`:29-33`)/`.badge--danger`(`:35-39`)/`.badge--warning`(`:55-58`)은
  `--color-success`/`--color-error`/`--warn`으로 **통념(Western)대로** 동작한다.
  불변식이 `Badge.css:41-42` 주석과 `frontend/src/components/ui/Badge.jsx:37`에 명시돼 있다.
  **공용 배지 variant의 색 의미를 바꿀 때는 소비처 전수 grep 선행** — vitest·빌드는 색 의미에
  블라인드다(§TESTING.md §9).
  주의: `frontend/src/components/ui/Stat.css:16-17`은 `.stat__value--success`를 `var(--up)`,
  `--danger`를 `var(--down)`에 묶어 Badge와 **반대 명명**을 쓴다.
- 클래스 명명은 `ui/`에선 BEM-ish(`.badge`, `.badge__icon`, `.badge--up`), 전역 스타일시트에선
  평탄 kebab + `.is-active` 상태 클래스(`frontend/src/styles/pc.css:86`).
  **선택자 충돌 주의**: `pc.css:57,91`의 전역 `.btn`/`.card`가 `ui/Button.css`·`ui/Card.css`와
  같은 선택자이며, `pc.css:66-73`의 단일 대시 `.btn-primary`가 `Button.css`의 `.btn--primary`와 공존한다.
- **인라인 스타일이 물량으로 우세**하다(`style={{` 1491 vs `className=` 976).
  단, 인라인 안의 색도 항상 `var(--token)` 참조이고 하드코딩 hex는 쓰지 않는다
  (`frontend/src/components/market/VixSection.jsx:23`). 재사용 인라인 객체는 모듈 상수로
  호이스팅해 export한다(`marketUtils.jsx:19,21,30,37`, `reportUtils.jsx:6,7`).
- 모션은 `frontend/src/styles/motion.css`. 두 개의 긴 주석(`:12-17`)이 하드 제약을 담는다 —
  transform `fill: both`가 `position: fixed` 자손을 깨뜨리고, opacity `both`가 모달 z-index를
  가둔다. `prefers-reduced-motion` 블록 `:62`.

### 9.3 데이터 fetch
- 공용 axios 클라이언트 `frontend/src/api.js`(27줄, 75파일이 import):
  `baseURL: import.meta.env.VITE_API_BASE_URL || ''`(`:3-5`), 요청 인터셉터가 Bearer 토큰 부착
  (`:7-13`), 응답 인터셉터가 **401에서 토큰 삭제 + `window.location.href='/'` 하드 리다이렉트**(`:15-25`).
  호출은 `/api` prefix를 포함한 전체 경로로 한다(`api.get('/api/market/vix')`).
- `VITE_API_BASE_URL`은 4곳에서만 읽고 전부 `|| ''` 폴백이다(`api.js:4`, `App.jsx:36,133`,
  `LoginPage.jsx:8`).
- **raw `fetch`는 인증·애널리틱스에만** 쓴다(`App.jsx:36,134`, `LoginPage.jsx:25,43`,
  `frontend/src/utils/analytics.js:4`) — `api.js`의 401 인터셉터가 로그인 중 리다이렉트를
  일으키기 때문이다.
- 에러 처리 3계층: ① fire-and-forget `.catch(() => {})` ② 지역 error state → 전용 에러 UI
  (`frontend/src/components/market/VixSection.jsx:12-20`의 loading/error/data 3분기가
  `market/*Section.jsx` 표준형) ③ 마커 붙인 `console.warn`/`console.error`(§4.5).
  **토스트는 사용자 개시 mutation용**이고 배경 fetch엔 쓰지 않는다.
- 토스트: `frontend/src/components/Toast.jsx` — `ToastProvider`(`:6`) + `showToast(msg, type)`
  (`:8-12`, 최근 3개만 유지·3초 자동 소멸), 타입 `success|error|warning`(`:26-28` 토큰 색),
  컨테이너는 `position:fixed; bottom:150; zIndex:9999; pointerEvents:none`(`:17-23`,
  `:18-19` 주석이 150인 이유를 적어둔다). `useToast()`(`:42-44`)는 **null 가드가 없다**.
  훅 안에서 재파생하지 않고 **부모가 `showToast`를 인자로 내려준다**
  (`frontend/src/hooks/useStockManagement.js:5-7`).
- 로딩 UI 기본은 `ui/Skeleton`(19파일). `LoadingSpinner`는 Guru/Ranking 4곳의 레거시 경로.

### 9.4 훅·컨텍스트
- `frontend/src/hooks/` 14개. 복합 훅은 **args 객체 구조분해**로 받고
  (`useReportFilters.js:7`, `useStockManagement.js:7`, `useReportGeneration.js:5`),
  **파생 훅은 재fetch하지 않는다**(헤더 주석이 명시 — `useReportFilters.js:4`,
  `useStockManagement.js:5-6`). 타이머·옵저버는 항상 cleanup(`usePriceFlash.js:27`,
  `useStockManagement.js:14`, `useReveal.js:24`). 훅 본문 위에 한국어 의도 + task 번호를 적는다.
- 컨텍스트는 2개뿐: `frontend/src/contexts/AuthContext.jsx`(`{role, menuPermissions, loading}`,
  실패 시 `role:'user'`로 degrade하며 **로그 없음** `:23-26`)와 `components/Toast.jsx`.
  중첩 순서는 `frontend/src/App.jsx:167-175` ToastProvider → AuthProvider → BrowserRouter.
  Redux/Zustand/React Query 없음 — 서버 상태는 훅/페이지의 `useState`에 있다.

### 9.5 라우팅·탭 이원화
- 라우트는 `frontend/src/App.jsx:82-103`. **리다이렉트는 공유 상수로 추출**돼 있다:
  `frontend/src/routes.js:2-7` `REDIRECTS`를 `App.jsx:83-85`와
  `frontend/src/test/route-redirects.test.jsx:4`가 함께 읽는다(손복사 중복 제거 목적).
  `*`(404) 라우트는 없다. 인증 게이트는 라우트가 아니라 라우터 앞 분기(`App.jsx:164-165`).
- **리서치 하위탭 목록이 두 곳에 있다 — 탭 추가·개명·삭제는 항상 쌍으로.**
  모바일 seg nav: `frontend/src/pages/ResearchShell.jsx:10-16` `RESEARCH_TABS`(+`SCHEDULE_TABS` `:17-22`).
  PC 마스트헤드: `frontend/src/components/Masthead.jsx:11-45` `SECTIONS`
  (`SECTIONS.research.items`가 `RESEARCH_TABS`와 현재 **동일**, `SECTIONS.schedule.items`가
  `SCHEDULE_TABS`와 동일). 한쪽만 고치면 다른 뷰포트에서 새 탭에 진입할 수 없다.
  점검: `grep -rn "RESEARCH_TABS\|SECTIONS" frontend/src/`.
  **두 목록의 등가성을 단언하는 테스트는 없다**(자동 가드 없음).
- 내비는 `NavLink` + `className={({isActive}) => ...}` 콜백, 애널리틱스는
  `onClick={() => t.evt && trackEvent(t.evt)}`(`ResearchShell.jsx:41`).
  권한 필터는 `Masthead.jsx:73`(`menuPermissions.includes(s.perm)`), 서브바는 `items.length >= 2`일 때만(`:75`).

### 9.6 차트 (recharts)
- 표준형: `ResponsiveContainer width="100%"` + **고정 숫자 height** →
  `CartesianGrid stroke="var(--border)"` → 축 `tick={{fontSize:10, fill:'var(--text-3)'}}` +
  명시 `width`(레이아웃 안정화) → `Tooltip contentStyle`에 토큰 → 밀집 계열은 `dot={false}`.
  기준 예: `frontend/src/components/market/VixSection.jsx:47-58`.
  모든 색은 `var(--data-1..5)` 등 토큰. focus outline은 `frontend/src/index.css:6-10`에서 전역 억제.
- **dual Y축은 좌=금액(억/조원·십억달러), 우=비중 %**(점선, `--data-3`)로 고정
  (`KrExportsSection.jsx:114,125`, `KrTop2Section.jsx:97,108`, `M7EarningsSection.jsx:94,104`,
  `LeverageSection.jsx:93,122`, `reports/ShortSellSection.jsx:88,93`, `ConsensusChart.jsx:413,439`,
  `FinancialsChart.jsx:371,391`).
- 용어 범례 어댑터: `frontend/src/components/Glossary.jsx:104` `GlossaryRechartsLegend`를
  `<Legend content={<GlossaryRechartsLegend />} />`로 끼운다.
- 공용 헬퍼: `frontend/src/components/market/marketUtils.jsx` — `krFmt`(`:6`, **입력 '억원' 단위
  가정**, 10,000억↑ 조), `isEstimated`(`:12`), `SectionCard`(`:50`), `SectionCardLoading`(`:96`),
  `SectionCardError`(`:108`), `LoadingBox`(`:120`), `ErrorBox`(`:124`), `EmptyNote`(`:134`).
  `frontend/src/components/reports/reportUtils.jsx` — `TH`/`TD`(`:6,7`), `fmtN`(`:9`),
  `rsiColor`(`:10`), `fmtGap`(`:17`), `computePeerPremiums`(`:30`), `computeRevenueCagr`(`:58`),
  `overallWeather`(`:81`), `MetricCard`(`:104`), `SectionTitle`(`:112`, 13파일 재사용),
  `GapCell`(`:123`), `TargetTooltip`(`:132`).
  기타 `frontend/src/utils.js:1` `fmtPrice`, `frontend/src/components/ui/icons.jsx:4,9,74,97,119`.
- recharts + `d3-*` + `victory-vendor`는 `charts` 청크로 분리(`frontend/vite.config.js`
  `manualChunks`). **Vite 8(rolldown)은 `manualChunks`를 함수로만 받는다** — 객체형은 빌드 실패.

### 9.7 레이아웃 수치는 추정하지 않는다
`minmax`·열 수·폭 임계값을 정하는 변경은 배포 전에 `getBoundingClientRect()` 실측 1회를 근거로
삼는다. 열 수를 **줄이면** 남는 열이 넓어져 반대 뷰포트의 밀도가 내려가고, **늘리면** 좁은 트랙에서
label이 접혀 오히려 카드가 커지는 역전 지점이 있다. 완료기준은 대리지표(열 수)가 아니라 목표
자체(카드 높이·label 줄수)로 쓴다. 검증 방법은 TESTING.md §8·§9.

### 9.8 Lint
`frontend/eslint.config.js`(flat, 23줄) 전체가 `globalIgnores(['dist'])` +
`js.configs.recommended` / `reactHooks.configs.flat.recommended` / `reactRefresh.configs.vite`
3프리셋 + `languageOptions`뿐이다. **`rules` 블록이 없고 `no-console`도 미설정**이며
`eslint-plugin-react`·`jsx-a11y`는 설치돼 있지 않다. 억제는 4건(모두 `exhaustive-deps`:
`Glossary.jsx:30,54`, `Reports.jsx:136`, `ReportManualGen.jsx:36`).
**lint는 어디에도 연결돼 있지 않다** — `.github/workflows/deploy.yml`은 lint/test/build 잡이 없고,
`deploy.sh:25`는 `npm install && npm run build`만 돌리며, `.husky/`·비-sample git hook도 없다.

### 9.9 i18n·접근성
- i18n 라이브러리·로케일 파일 없음. **UI 텍스트는 전부 한국어 인라인**이다.
  단 enum 값은 locale-독립 저장값으로 두고 label/색만 표시용으로 매핑한다
  (`frontend/src/components/ui/SupplyBadge.jsx:2-3`, `InsiderBadge.jsx:2`).
  `frontend/index.html:2`는 `<html lang="en">`인데 PWA manifest는 `lang: 'ko'`(불일치, 알려진 성질).
- `aria-*`는 희소하고 편중돼 있다 — 지배 관례는 장식 SVG의 `aria-hidden`
  (`frontend/src/components/ui/icons.jsx` 22개 아이콘 전부, `Skeleton.jsx:13,57`,
  `GuruDetail.jsx:369`의 0×0 측정용 SVG). `aria-label` 9곳(전부 한국어), `aria-expanded` 2곳,
  `role` 2곳. **모달은 `role="dialog"`·포커스 트랩 없이 `useBodyScrollLock`만 쓴다**
  (`StockModal.jsx`, `PromoteModal.jsx`, `GlobalSearch.jsx`).
- 툴팁 기본 수단은 `title` 속성(`aria-describedby` 0건)이며, market 섹션마다 3~4개씩 있다.
  **`title`은 Playwright 셀렉터로도 load-bearing**하다(TESTING.md §8).
  풍부한 대안은 용어 팝오버 `frontend/src/components/Glossary.jsx`
  (`GlossaryTerm` `:71`, `GlossaryText` `:93`, 매칭 규칙은 `frontend/src/glossary/terms.js:1-3`).
- 포커스 링은 `frontend/src/styles/tokens.css:239`에 중앙화. reduced-motion은 3곳에서 존중
  (`motion.css:62`, `useCountUp.js:16`, `useReveal.js:12`).

---

## §10 문서 동기 의무 (코드 변경에 딸린 DoD)

| 트리거 | 갱신 대상 | 강제 수단 |
|---|---|---|
| 엔드포인트 추가·삭제·개명 | `API_SPEC.md`(전체 REST 레퍼런스, 현재 `### \`METHOD /path\`` 헤더 140개) | **자동** — `backend/tests/test_api_doc_sync.py`가 라이브 `app.routes` ↔ 문서 헤더를 exact-match 대조. `KNOWN_UNDOCUMENTED`는 현재 **빈 frozenset**(`:50`)이라 미문서 엔드포인트 1개도 허용되지 않는다 |
| Cowork(외부 enrich/backlog 워크플로우) 대상 엔드포인트 | `CLAUDE_COWORK_API.md`(현재 헤더 9개) | **부분 자동** — stale(문서에 있는데 라이브에 없음)만 검출(`:72-75`). "2문서 모두"는 **Cowork 스코프에 한한다** — 사용자 대면 read·admin refresh는 `API_SPEC.md`만 |
| 요청/응답 스키마·인증 게이팅 산문 | 위 두 문서의 본문 | **없음(수동 DoD)** — doc-sync는 엔드포인트 *존재*만 본다. 인증 게이팅을 바꾸는 슬라이스는 착수 시 `grep -n '\*\*Auth:\*\* 불필요' API_SPEC.md`를 먼저 돌릴 것(현재 잔존 1건 — `auth.py` 공개 엔드포인트) |
| 기능 표면(화면 구성·환경변수·기술 스택·아키텍처·배치) | `README.md` 해당 절 | 없음(수동) |
| 배치 fetch 소스 변경 | `backend/services/batch_registry.py`의 `source` | 존재만 자동(`test_batches_router.py:52`) |
| 신규 DB 컬럼 | `backend/app_schema.sql` **+** `backend/main.py:_migrate()` 쌍 | 없음(수동) |
| 규약·함정 학습 | 루트 `CLAUDE.md` Gotchas + 이 문서 | 없음(수동) |

`.forge/codebase/`는 **구현 사실** 전용이다. 도메인 용어 정의는 `CONTEXT.md`, 결정 기록은
`.forge/adr/`에 둔다(이 문서에 중복 서술하지 말 것).

---

## §11 규약을 강제하는 자동 가드 (요약)

| 가드 | 무엇을 막는가 |
|---|---|
| `backend/tests/test_no_print.py` | 앱 코드의 신규 `print()` (§4.1) |
| `backend/tests/test_no_bare_today.py` | bare `date.today()`/`datetime.today()` — 컨테이너 UTC라 00~09 KST에 하루 어긋난다. `services.utils.today_kst()` 사용 |
| `backend/tests/test_no_public_reads.py` | 무인증 `/api` 엔드포인트 신규 추가 + 허용목록 stale (ADR-0029, §6) |
| `backend/tests/test_api_doc_sync.py` | 문서 없는 신규 엔드포인트 / 삭제 누락 (§10) |
| `backend/tests/test_batches_router.py` 외 3파일 | 배치 id/개수 드리프트, `source` 누락 (§8) |
| `backend/tests/test_nan_serialization_guards.py` | NaN/inf 응답 오염 → 직렬화 500 (§5.2) |
| `backend/tests/test_consensus_asof_batch.py::test_values_placeholder_shape` | `VALUES` 괄호 감싸기 회귀 (§7) |
| `backend/tests/conftest.py` `_block_real_db` | 테스트의 실 DB 접촉 (TESTING.md §3) |
| `backend/tests/_routes.py` `walk_routes` | FastAPI 버전차로 라우트 열거가 조용히 0개가 되는 것 |

**자동 가드가 없는 규약**(리뷰·수동 검증 의존): 프론트 로깅 마커(§4.5),
라우트 순서(§6), `_migrate` 쌍(§7), 탭 이원화 등가성(§9.5), 배지 색 의미(§9.2),
레이아웃 수치(§9.7), README·스키마 산문 동기(§10).

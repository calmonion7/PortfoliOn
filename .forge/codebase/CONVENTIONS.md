---
last_mapped_commit: 47521121f10ac1c057fe9cf8ed5fc43ab5ca596c
mapped: 2026-07-31
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
테스트를 오염시킨다(TESTING.md §4.2). 요청 본문의 additive 필드도 마찬가지로
"구 판 호환"을 명시한다(`backend/routers/analyst_reports.py:36`
`metrics: List[PointMetric] = Field(default_factory=list, max_length=4)  # additive — 구 판 호환`).

### 1.3 wrong < missing — 빈 결과가 직전 양호값을 덮지 않는다
외부 fetch가 빈 결과를 주면 **저장을 생략하고 직전값을 유지**한다. 틀린 값이 남는 것보다
없는 게 낫다. **기본형은 "저장 직전 한 지점의 끝 가드"가 아니라 소스-폴백**이다:

- 소스-폴백(구조적으로 안전) — `backend/services/market_indicators/fx.py:36-40`(fetch 실패 시
  `stored_history`를 담아 반환), `backend/services/market_indicators/cache.py:69-72`
  (`:69` `_merge_history(prev, [])`가 prev를 그대로 반환), `backend/services/dividends.py:389`
  (`replace_schedule(ticker, fetch_dividend_schedule(...))` — **진입 전에** fetch를 평가하므로
  fetch가 던지면 replace 자체가 안 돌아간다. 근거 docstring `:232-233`).
- 끝 가드를 쓸 수밖에 없으면 **실패 클래스 3종을 모두** 물어야 한다:
  (a) **예외**(try/except) (b) **성공-but-빈응답**(`rt_cd=0`·HTTP 200 with 0 items — 예외 가드를
  그냥 통과한다) (c) **부분 페이로드**(한 payload의 일부 필드만 가드하면 나머지가 새어나간다 —
  `backend/services/kr_sector_service.py`가 `sectors`만 보고 같은 payload의 `index`를 빠뜨린 사례.
  대응은 `index = build_sector_index() or load_sector_index()`처럼 필드별 직전값 보존).
- **delete-rewrite(replace) 저장은 파괴적 변형**이다 — fetch 실패를 빈 결과로 삼키면 저장 생략이
  아니라 `DELETE`로 직전값을 지운다. fetch 함수가 예외를 전파해 호출측이 replace를 통째
  스킵하게 하고, delete+insert는 단일 트랜잭션으로 묶는다
  (`backend/services/recommendation/store.py:15-58` `replace_recommendations`).
- 저장을 스킵했으면 **admin 응답·로그가 "갱신됨"과 "생략·직전값 유지"를 구분**해야 관측이 성립한다
  (`stale` 마커 + `saved` 플래그 — `backend/services/market_indicators/exports.py`,
  `backend/routers/market_indicators.py` refresh-monthly). `job_runs`는 본문이 예외를 전파할 때만
  `failed`를 기록하므로 스킵을 초록으로 남긴다(`backend/services/job_runs.py:17-31` docstring).
  **그 응답을 화면에 흘려야** 사용자가 구분할 수 있다 — `frontend/src/pages/Settings.jsx:83`
  `ManualRunButton`이 응답 dict를 `key: value`로 렌더하고 `saved=false`·`0`을 `--warn`으로 약하게
  표시한다(`ok`는 항상 true라 숨긴다). 회귀 가드 `frontend/src/pages/Settings.test.jsx`.

회귀 가드: `backend/tests/test_empty_result_overwrite_guards.py`,
`backend/tests/test_empty_result_guards_exports_krsector.py`,
`backend/tests/test_rankings_empty_guard.py`, `backend/tests/test_us_supply_empty_guard.py`,
`backend/tests/test_fx_partial_failure.py`.

### 1.3.1 `wrong < missing`은 면제부가 아니다
이 교리는 "**틀린 값** vs **없는 값**"의 선택 규칙이고, "**정상값을 지우기** vs 보여주기"에는
적용되지 않는다. 지표가 통째 사라지면 규칙상 합격이어도 사용자 가치로는 손실이다.
실사례: 피어 멀티플 이상치 가드가 leave-one-out 표본을 쓰던 판(task#248)에서
peer 3개일 때 정상 peer가 결측돼 **PBR 비교 칩이 통째 사라졌다**. 그 한계는 셀프 리뷰가
"과보수적일 뿐 틀리지 않다 · 실측 005930은 peer 4개라 해당 없음"으로 자진 기록해두고 미뤘고,
경쟁사 목록에서 1종목이 빠지자 4일 뒤 라이브에서 발동했다(task#249로 재수정, ADR-0030).

실천 3가지:
- 심각도는 `wrong<missing` 합격 여부가 아니라 **"그 케이스에서 사용자가 무엇을 잃는가"** 로 판정.
- 트리거가 **사용자가 바꿀 수 있는 데이터**(경쟁사 목록·보유 종목 등)면 "지금 실측엔 해당 없음"을
  면제 근거로 쓰지 않는다.
- 한계를 테스트로 못박을 때 **"의도된 트레이드오프"인지 "미룬 결함"인지 이름·주석에 구분**해 남긴다
  (`backend/tests/test_report_valuation_multiples.py:319-327`이 판정축 교체 경위를 그렇게 적어둔다).

### 1.4 graceful degradation — 부가기능은 본문을 깨뜨리지 않는다
계측·캐시·부가 read는 실패해도 주 경로를 중단시키지 않는다. 대표 구현:

- `backend/services/job_runs.py` — DB 접촉 전부를 개별 try/except로 감싸고 `run_id=None`을
  센티널로 쓴다(`:19` *"계측은 관측 전용 — 본문(배치)을 절대 깨뜨리지 않는다"*).
- `backend/main.py:60-238` `_migrate()` — 테이블 단위로 try/except, 실패는
  `logger.warning(f"[Migrate] ...")`만 하고 기동을 계속한다(마커 `[Migrate]` 18건).
- `backend/routers/stocks.py` `_build_all` — 카드당 `_safe` 래핑으로 per-card 실패가 전체 500이
  되지 않게 한다(`_minimal_card` 폴백).

단, **graceful이 "조용히"여서는 안 된다** — §4.2의 warning 레벨로 반드시 담화를 남긴다.
broad `except Exception: pass`는 기능이 조용히 꺼지는 원인이며, 현재 잔존은
`backend/middleware/event_tracker.py:48-49,70-71` 등 소수다.

### 1.5 중복 제거·단일 소스화 전에 "겸직 필드"를 센다
필드를 합치는 리팩터에서는 각 필드의 소비처를 grep해 **역할 수**를 먼저 센다.
`frontend/src/components/MobileNav.jsx`의 `key`는 **권한 필터**(`menuPermissions.includes`) 겸
**이벤트명 소스**(`trackEvent('nav_' + key)`)로 두 역할을 겸직 중이었고, 공유 모듈에서
자연스러워 보이는 `section.key`로 파생했다면 이벤트명이 바뀌어 백엔드
`backend/routers/events.py`의 `VALID_EVENTS` 화이트리스트에서 **조용히 탈락**했을 것이다
(요청은 성공하고 이벤트만 사라진다). 실제 구현은 `section.perm`으로 파생해 5탭 전부
기존 이벤트명을 바이트 동일하게 유지했다. **vitest·빌드·라이브 프로브 어느 것도 이걸 안 잡는다**
— 이벤트명을 단언하는 테스트가 없고 화면은 정상으로 보인다. 파생 소스는 "이름이 비슷한 것"이
아니라 **소비처가 요구하는 값**으로 고른다. 같은 가족: `batch_registry`의 `source`(§8) vs
`usage`, `tickers.name` vs `snapshots.data.name` dual-source.

---

## §2 백엔드 모듈·패키지 구조

### 2.1 `__init__.py` re-export 3스타일
| 스타일 | 예 | 특징 |
|---|---|---|
| A. 표면 보존 re-export(`__all__` 없음) | `backend/services/market/__init__.py:8-39`, `backend/services/storage/__init__.py:1-44`, `backend/scheduler/__init__.py:3-60` | 헤더 주석에 ADR 인용. private 심볼까지 명시 named import. `scheduler/__init__.py:10-50`은 private 잡 함수 + `_JOB_FUNCS`를 열거 |
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
새 결정 코드에도 근거 포인터를 남긴다. **"다시 시도하지 말 것"류 되돌림 기록도 코드에 남긴다** —
`frontend/src/styles/guru.css:158-163`이 `content-visibility` 도입→되돌림 실측 수치와 함께
재시도 금지를 적어둔다.

---

## §3 명명·타입 규약

### 3.1 식별자는 영문 snake_case, 주석·docstring은 한국어
AST 집계로 docstring 423개 중 **412개가 한글**이다. 영문 docstring 11개는 순수 계산/파싱
헬퍼에 남아 있다(`backend/services/indicators.py`, `backend/services/market/format.py`,
`backend/routers/calendar.py`). docstring은 1줄 요약형
(`backend/services/db.py:45` `"""단일 SELECT — 결과를 dict 리스트로 반환."""`)
또는 규약·함정을 길게 적는 형(`backend/services/job_runs.py:17-31`,
`backend/services/report_generator.py:157-179`) 둘 다 쓰인다. 후자는 **판정축과
"왜 다른 설계를 안 썼는가"** 를 함께 적는 것이 관례다.

### 3.2 접두 관례
| 접두 | 뜻 | 예 |
|---|---|---|
| `_` | 모듈 private(함수·상수·싱글톤) | `_slim_summary`(`backend/routers/report.py:35`), `_BY_ID`(`backend/services/batch_registry.py`), `_pool`/`_lock`(`backend/services/db.py:12-13`) |
| `_get_cache`/`_set_cache` | 인메모리 캐시 | `backend/services/market_indicators/cache.py:18,25` |
| `_mc_load`/`_mc_save`/`_mc_delete` | PostgreSQL `market_cache` I/O | `backend/services/market_indicators/cache.py:33,43,56` (타 패키지도 이 private을 import — `backend/services/kr_sector_service.py:15`) |
| `_fetch_*` | 외부 데이터 획득 | `backend/services/market_indicators/fx.py:12,23` 등. **주의**: `backend/scheduler/jobs.py`에선 같은 접두가 *스케줄러 잡 래퍼*를 뜻한다 |
| `_run_*` | 라우터의 백그라운드 태스크 진입점 | `backend/routers/report.py:69,124,...` |
| `_refresh_*` / `_seed_*` / `_upsert_*` | 스케줄 갱신 잡 / 기동 시드 / DB 쓰기 | `backend/scheduler/jobs.py`, `backend/services/leverage_service.py:125` |
| `_guard_*` | 저장·응답 직전 이상치 배제 | `backend/services/report_generator.py:156` `_guard_peer_multiples` |
| `_<NAME>_BAND` | 이상치 판정용 대칭 배수 밴드(절대 임계값 추정 금지) | `backend/services/report_generator.py:144` `_PEER_MULTIPLE_BAND = 5`, `backend/services/guru_stats.py:9` `_VALUE_EST_BAND = 5` |

화이트리스트 집합은 `frozenset`으로 둔다(`backend/services/storage/portfolio.py:5-6`,
`backend/tests/test_no_public_reads.py:28`).

### 3.3 타입 어노테이션 — 로컬 3.9.6 / 배포 3.12 발산이 하드 제약
- 배포 이미지는 `backend/Dockerfile:1` `python:3.12-slim`, 로컬 검증 인터프리터는
  `backend/.venv/bin/python` = **3.9.6**. `backend/requirements.txt`엔 버전 핀이 없다
  (`fastapi>=0.104.0`; 로컬 설치본은 0.128.8).
- **런타임 평가되는 어노테이션에 PEP604 `X | None`을 쓰려면 그 파일에
  `from __future__ import annotations`가 있어야 한다.** 현재 앱 파일 107개 중 **67개**가 이 import를
  갖고 있고, PEP604 `| None`은 **123곳**에 쓰인다. 없는 파일(모든 라우터, `main.py`, `auth.py`,
  `backend/services/storage/*.py` 등)에서는 `Optional[X]`(**62곳**) 또는 **문자열 인용 어노테이션**
  으로 우회한다(`backend/routers/stocks.py:242,483,600,607`).
- 결론: **Pydantic 모델·FastAPI 시그니처에 unquoted `X | None`을 넣기 전에 그 파일의
  `__future__` import를 확인**할 것. 자동 가드는 없고 로컬 pytest가 사실상의 게이트다.
- `list[dict]`류 PEP585 builtin 제네릭은 3.9에서 합법이라 `__future__` 없이도 쓰인다.
- **선택 필드는 `x: float = Field(None)`이 아니라 반드시 `Optional[float] = Field(None, ...)`**
  — 상세는 §5.4.

---

## §4 로깅 방출 규약

> **버그를 드러내기 위한 로그 패턴.** 이 절을 코드·계획이 `CONVENTIONS §4`로 인용한다.

### 4.1 방출 메커니즘 — 모듈 `logger` 통일, `print` 금지
- 앱 코드는 `logger = logging.getLogger(__name__)`을 모듈 상단에 둔다(**57개 파일**).
  `print()`는 신규 금지이며 현재 0건이다.
- **강제 가드**: `backend/tests/test_no_print.py` — `main.py`·`routers`·`services`·`scheduler`·
  `middleware`를 AST로 훑어 `print()` 호출 노드를 잡는다(문자열/주석/`pprint` 오탐 없음).
  `tests/`·`scripts/`·`data/`는 대상 외. 실패 메시지가 `CONVENTIONS §4`를 인용한다.
- 이름 편차 1건: `backend/services/job_runs.py:10`은 `log = logging.getLogger(__name__)`이고
  그 6곳만 lazy `%s` 포매팅 + `exc_info=True`를 쓴다.
- **`print`→`logger` 전환 스윕은 `capsys`로 stdout/stderr를 검사하던 테스트를 깨뜨린다.**
  전환 전에 `grep -rn capsys backend/tests/`로 그 테스트를 찾아 **`caplog` 마이그레이션을
  슬라이스에 미리 넣을 것**(사후 수복 6건 발생 이력). 현재 `caplog` 사용 7파일, `capsys` 1파일.
- `scripts/*.py`(프로브·리스너)는 앱 코드가 아니므로 `print`가 허용된다.

### 4.2 레벨 의미
| 레벨 | 언제 | 비고 |
|---|---|---|
| `logger.info` | 배치·라이프사이클 | config 없으면 root lastResort가 WARNING+만 내보내 docker logs에 **안 뜬다** → §4.4 |
| `logger.warning` | graceful degradation의 담화(폴백·스킵·부분 실패·이상치 결측) | 가장 흔한 레벨 |
| `logger.error` | 예상치 못함·데이터 손실 | 아껴 쓴다 |

값을 결측 처리하는 가드는 **어느 행·어느 필드를 왜 버렸는지**까지 남긴다 —
`backend/services/report_generator.py:198-201`
`logger.warning(f"[Valuation] 피어 멀티플 이상치 — 결측 처리 ({ticker} {metric}: value=… median=… ratio=…)")`.
이 로그가 "조용히 사라진 지표"의 유일한 사후 단서다.

### 4.3 포맷·마커
표준형: `logger.x(f"[Component] <무엇> (<ids>): {e}")`.
예: `backend/services/market_indicators/cache.py:39`
`logger.warning(f"[Cache] _mc_load key={key} 실패: {e}")`.

- 마커는 **PascalCase**, **개념당 1스펠링**. formatter에 컴포넌트 프리픽스가 없으므로
  메시지 안의 마커가 **유일한 grep 앵커**다.
- 현황: 문자열 리터럴로 시작하는 logger 호출 **287개가 전부 `[Marker]`로 시작**(위반 0).
  공백 포함·소문자 마커도 0. 마커 종류는 68개.
- 남은 편차는 "개념당 1스펠링" 쪽이다(기능 결함 아님, 신규 코드에서 재생산 금지):
  시세 계열 `[Quote]`/`[KRQuote]`/`[KiwoomQuote]`/`[KISQuote]`/`[BatchQuote]`/`[KiwoomCloses]`/
  `[BatchClose]`, 애널리스트 계열 `[Analyst]`/`[AnalystData]`/`[AnalystReport]`,
  섹터 `[Sector]`/`[KrSector]`/`[UsSector]`, 추천 `[Recommendations]`/`[Funnel]`/`[Universe]`.
  `Service` 접미가 붙은 유일 사례는 `[LeverageService]`(`backend/services/leverage_service.py:252`).
  `[Scheduler]`는 74건으로 최다인데 모듈 단위 마커라 잡 개별 식별은 메시지 본문에만 있다.

### 4.4 노이즈 제어 — 루트 로거 1회 배선
`backend/main.py:18-30` `_configure_logging()`가 **라우터 import보다 먼저**(`:32` 이전) 호출된다.
`basicConfig(level=INFO, format="%(levelname)s %(name)s: %(message)s")`(`:23`) +
`urllib3`/`yfinance`/`apscheduler`/`asyncio`를 WARNING으로 억제 +
`uvicorn*.propagate = False`로 root 핸들러 중복 emit 차단(`:26-27`).

### 4.5 프론트 로깅 (`console.*`)
- 마커는 **소스 모듈/훅명 실명**이다(백엔드의 개념명과 다르다) → 훅은 camelCase
  (`[usePortfolioData]`, `[useReportList]`), 컴포넌트·페이지는 PascalCase
  (`[GuruAllocation]`, `[AnalystReports]`, `[PermissionPanel]` 등).
- 레벨: `console.warn` = graceful(부가 fetch 실패, 섹션만 숨김 — `frontend/src/pages/Reports.jsx:110`
  주석이 그 판단을 적어둔다), `console.error` = 예상외·주 로드/사용자 mutation 실패.
- 현황: `frontend/src`(테스트 제외) `console.warn` 13 + `console.error` 13 = **26건이 전부 마커
  보유**, `console.log`/`info`/`debug` 0건. 메시지는 한국어.
  두 하위 스타일이 공존한다 — 훅·`AdminAnalytics`는 `(<엔드포인트>) 조회 실패`,
  Guru/Analyst 페이지는 콜론 접미 + 경로 없음.
- **자동 가드 없음.** `frontend/eslint.config.js`(23줄)에는 `rules` 블록이 아예 없고 `no-console`도
  미설정이며, lint는 CI/훅에 연결돼 있지 않다(§9.8). 관례 + 리뷰 의존.
- 로그를 아예 안 남기는 침묵 catch는 규약 위반은 아니지만 알아둘 것:
  `frontend/src/App.jsx:42`(로그아웃 fetch), `frontend/src/utils/analytics.js:11`,
  `frontend/src/hooks/useAuthBootstrap.js:54`, `frontend/src/hooks/useReportGeneration.js:23`,
  `frontend/src/contexts/AuthContext.jsx:23-26`, 각 market/report 섹션의
  `.catch(() => setError(true))`.

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
- `backend/routers/market_indicators.py`는 GET 27곳이
  `except Exception as e: raise HTTPException(status_code=500, detail=str(e))` 복붙 패턴이라
  원문 예외가 클라이언트로 새어나간다(알려진 성질).
- `ValueError` → 400 번역은 라우터 경계에서 한다(`backend/routers/batches.py:86-87`).

### 5.2 NaN/inf 3중 방어 (출력·입력·전역)
starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 NaN/inf가 있으면 **500**이 난다.

1. **소스 가드** — `math.isfinite` 후 None으로 떨구는 지역 헬퍼가 ~45곳
   (`backend/services/beta.py:27`, `report_generator.py`(`_fin_num`), `indicators.py:32,61,131`,
   `market/format.py:46,58` …). 규약을 docstring에 적어둔 예:
   `backend/services/recommendation/funnel.py:151`.
2. **출력 sanitize** — `backend/services/utils.py:36` `sanitize(obj)`가 float NaN/inf를 재귀적으로
   None화한다. 소비처 24곳 — 응답 경계(`backend/routers/stocks.py`, `portfolio.py`, `report.py`,
   `analyst_reports.py`)와 **저장 직전**(`backend/services/report_generator.py`,
   `market_indicators/sentiment.py`, `indices.py`, `kospi_futures.py`)에 함께 쓴다.
3. **입력 가드** — Pydantic float은 기본 `allow_inf_nan=True`이므로 raw JSON의 `NaN` 토큰이
   통과하고, NaN 비교는 항상 False라 범위 검증도 못 잡는다.
   → `Field(..., allow_inf_nan=False)`를 명시한다(`backend/routers/analyst_reports.py:31,44,45`,
   근거 주석 `:42-43`). 거부하면 FastAPI 기본 422 detail이 입력 NaN을 echo해 다시 500이 되므로
   **전역 핸들러**가 막는다: `backend/main.py:253-259` `RequestValidationError` →
   `JSONResponse(422, {"detail": sanitize(jsonable_encoder(exc.errors()))})`.
   등록된 예외 핸들러는 이것뿐이다.

가드 회귀: `backend/tests/test_nan_serialization_guards.py`.
프론트 짝: 문자열 `"nan"`·빈 문자열이 LLM enrich로 들어오면 `Number('')===0`이라 `0`으로
오표시되므로 표시 계층에도 가드가 필요하다(`frontend/src/components/reports/MarketOutlookSection.jsx`,
회귀 `MarketOutlookSection.test.jsx`).

### 5.3 "best-effort, 절대 호출자를 깨지 않는다" 관용구
`try: ... except Exception as e: logger.warning(...); return <empty>`가 서비스 계층 지배형이다
(`backend/routers/stocks.py:79-84,358-360`, `backend/services/market_indicators/cache.py:38-40,52-53,59-60`,
`backend/services/job_runs.py:38-39,49-50`). §1.4와 함께 읽을 것.

### 5.4 선택 필드는 `Optional[X] = Field(None)` — 생략/명시적 null의 비대칭
pydantic v2는 **`validate_default=False`가 기본**이라 기본값 `None`은 검증을 타지 않지만,
클라이언트가 **명시적으로 보낸 `null`** 은 선언 타입(`float`)의 검증을 타서 `float_type` 422가 된다.
그래서 `x: float = Field(None)`은 **키 생략은 통과하고 `"x": null`만 죽는** 비대칭을 만들고,
그 필드가 중첩 배열 안에 있으면 **요소 하나 때문에 요청 전체가 422**로 막힌다
(발행물 지표 칩 → 발행 전체 차단, task#250). 현재 형태:
`backend/routers/analyst_reports.py:31` `change_pct: Optional[float] = Field(None, allow_inf_nan=False)`
(주석 `:29-30`이 이유를 적어둔다).

- `Optional`로 바꿔도 `allow_inf_nan=False`의 NaN 차단은 유지된다(로컬 3.9 + 컨테이너 3.12 양쪽 실측).
- 회귀 테스트는 **명시적 null 케이스**와 **NaN 거부 핀**을 쌍으로 둔다. 후자는 red-first가
  원리적으로 불가하니(수정 전에도 통과) `allow_inf_nan=False`를 일시 제거해 실제로 실패하는지
  이빨 검증하고 원복한다.
- 동종 패턴 탐지: `grep -rn "= Field(None\|= Field(default=None" backend/routers/ backend/services/`.

---

## §6 라우터·API 규약

- 파일당 라우터 1개, 모듈 상단에 `router = APIRouter(prefix=..., tags=[...])`(19개).
  prefix는 도메인형(`/api/stocks`)과 bare `"/api"`형(`backend/routers/report.py:22`,
  `calendar.py:55`, `batches.py:13` …)이 공존한다. 등록은 `backend/main.py:273-291`의 평탄한
  `app.include_router(...)` 목록(19개, prefix 인자 미사용).
- **인증은 항상 파라미터 단위 `Depends(...)`** — 라우트 수준 `dependencies=[...]`는 0건.
  `Depends(get_current_user)` 72 / `require_admin` 42 / `get_current_user_or_api_key` 10 /
  `require_admin_or_api_key` 6. 결과를 안 쓰면 `_: str = Depends(...)`, 쓰면
  `user_id`/`admin_id`. 정의는 `backend/auth.py:18,37,61,68`.
  `require_admin`은 API 키를 **거부**한다(키로 호출 시 401).
  **강제 가드**: `backend/tests/test_no_public_reads.py`(무인증 `/api` == `ALLOWED_PUBLIC` 9개,
  양방향 exact-match, ADR-0029).
- **`response_model=`은 코드베이스 전체에서 0건** — 핸들러는 plain dict/list를 반환한다.
  Pydantic `BaseModel`은 **요청 본문에만** 쓴다. bare `list`/`dict` 본문은 `Body(...)` 필수
  (`backend/routers/batches.py:77`, `report.py:582`, `portfolio.py:168`).
  ticker 정규화는 `@field_validator` + `@classmethod`(`backend/routers/watchlist.py:42-48`,
  `portfolio.py:51-57` — 두 곳에 동일 검증자가 중복). 상호 필드 검증도 같은 데코레이터로
  (`backend/routers/analyst_reports.py:50` `fair_value_high`가 low보다 큰지 — NaN 배제가 선행돼야
  의미가 있다, §5.2).
  쓰기는 `status_code=202`(백그라운드 잡, 18곳)·`201`(생성, 4곳)을 명시한다.
- **라우트 순서: 정적 하위경로를 `{param}` catch-all보다 먼저 등록한다.**
  `backend/routers/report.py`가 `/report/{ticker}/{date_str}` 앞에 5개를 두고 각각
  경고 주석을 달아뒀다(`:395,416,425,433,442` — *"5번째 재발 방지"*).
  `backend/routers/analyst_reports.py:3-4`는 이 함정을 **새 prefix를 만든 이유**로 기록한다(ADR-0027).
  같은 위험이 `backend/routers/stocks.py`의 `PUT /enrich/batch` → `PUT /{ticker}/enrich`,
  `/search`·`/compare` → `/{ticker}/news`에도 있지만 **주석은 없다**. 자동 가드 없음.

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
  idempotent 마이그레이션만 탄다(ADR-0006). `backend/main.py:60-238` `_migrate()`에
  `ADD COLUMN IF NOT EXISTS`를 **쌍으로** 추가하는 것이 DoD다. `_migrate()` 구조 관례:
  논리 테이블당 try/except 1블록 + 블록마다 `from services.db import execute` 지역 import(18회) +
  실패는 `logger.warning(f"[Migrate] ...")`만. 예외: `job_runs`는 `_migrate` 대응이 없고
  `backend/app_schema.sql`이 수동 적용을 지시한다(ADR-0001). 자동 가드 없음(수동 DoD).

---

## §8 배치·스케줄러 규약

- 정적 메타 테이블 `backend/services/batch_registry.py`의 `BATCHES`에 **29개** 엔트리.
  필수 필드 11개(`id`, `label`, `category`, `schedule_desc`, `usage`, `source`, `editable`,
  `trigger_kinds`, `manual_endpoint`, `scheduler_job_id`, `market`) + `timezone`·
  `default_schedule` + `misfire_grace_time`. `category` ∈ {report, market, guru},
  `market` ∈ {KR, US, 공통}(출처국 기준 — ADR-0013). 모듈 docstring `:2-10`이 불변식을
  적어두지만 "**20개 배치**"는 stale이다(실제 29).
- **`source`(fetch 출처) ↔ `usage`(소비 UI)는 반대 방향**이다. 배치의 fetch 체인을 바꾸면
  `source`도 같이 고치는 것이 DoD — `GET /api/batches`가 그대로 노출하므로 안 고치면 배치 현황이
  틀린 출처를 보인다. 가드: `backend/tests/test_batches_router.py:52-65`가 `source` **비어있지 않음**만
  단언한다(정확성은 검증 못 함).
- `job_id` == 스케줄러 잡 id == `job_runs.record(id, ...)` 호출 id.
  `with job_runs.record("<batch_id>", "auto"|"manual"):`로 본문 전체를 감싼다
  (auto: `backend/scheduler/jobs.py` / manual: `backend/routers/report.py:72,343,...`).
- **배치 id를 은퇴시키면 4표면을 전수 grep**: ① 스케줄 소비처 read ② 표시 문자열
  ③ **`job_runs.record` 모든 lane(auto·manual·backfill)** ④ 그 id를 단언하는 테스트.
  단 옛 id를 *읽는* 시드 마이그레이션은 정당한 잔존이다.
- **id를 추가할 때는 count/set 하드코딩 단언 4곳을 함께 고친다** —
  `backend/tests/test_batches_router.py`(`EXPECTED_IDS` + `== 29`),
  `backend/tests/test_batch_market_split.py:54`, `backend/tests/test_macro_signals_batch.py:37`,
  `backend/tests/test_scheduler_seed.py:82`(`editable` 파생).
  탐색: `grep -rn "BATCHES) ==\|len(data) ==\|EXPECTED_IDS" backend/tests/`.
- 잡 함수 배선: `backend/scheduler/jobs.py:485` `_JOB_FUNCS`(**28개** = BATCHES − `consensus`),
  소비는 `backend/scheduler/schedule.py:36`. **`editable: True`인데 `_JOB_FUNCS` 키가 없으면
  기동 시 `KeyError`**다.
- `misfire_grace_time`은 `None`을 넘기지 말고 **인자를 생략**한다 — APScheduler가 None을
  "유예 무제한"으로 해석해 거동이 바뀐다(`backend/scheduler/schedule.py:30-31` 주석).
- 스펙 검증·설명은 `backend/services/schedule_spec.py`(4타입, `validate_schedule_spec`가
  `ValueError`, int 필드에 `isinstance(x, bool)` 거부까지).
- **배치-백킹 뷰는 요청·기동 경로에서 외부 API를 라이브 호출하지 않는다** — 배치가 사전계산해
  `market_cache`/테이블에 저장하고 요청은 저장값만 읽는다. 기동 시 빈 캐시 적재는
  `_seed_*_if_empty` 패턴(`backend/scheduler/__init__.py:63-72`).
- KR 시장-날짜 판정은 `datetime.now(ZoneInfo("Asia/Seoul")).date()` 또는
  `services.utils.today_kst()` — bare `date.today()` 금지(컨테이너 UTC).
  **강제 가드**: `backend/tests/test_no_bare_today.py`(AST 스윕).

---

## §9 프론트엔드 규약

### 9.1 파일·명명
- 컴포넌트 PascalCase `.jsx`, 파일당 `export default function X()` 1개.
  훅은 `useXxx.js`(never `.jsx`) 기본 export. 예외는 1줄 re-export shim
  `frontend/src/hooks/useAuth.js:1`.
- **테스트 접근을 위한 named export가 관례다** — 페이지 파일이 default 컴포넌트와 함께
  순수 헬퍼·하위 컴포넌트를 named export한다(`frontend/src/pages/Settings.jsx:83`
  `ManualRunButton`, `frontend/src/pages/AnalystReport.jsx:16,42,54,94,115,212`,
  `frontend/src/pages/GuruDetail.jsx:32,65,73,84`, `frontend/src/pages/Compare.jsx:27`,
  `frontend/src/pages/GuruStats.jsx:11`). 이 코드베이스는 **테스트에서 `App`을 import하지 않는
  관례**(로그인 셸 전체를 렌더해 모킹 비용이 크다)라, App 안에 있는 분기는 단위테스트가
  원리적으로 닿지 못한다 → 그래서 인증 부트스트랩을 훅으로 뺐다
  (`frontend/src/hooks/useAuthBootstrap.js:4-7` 주석이 그 판단을 적어둔다).
  **테스트 가능성이 배치를 결정한다.**
- JSX를 담은 유틸은 `.jsx` — `frontend/src/components/market/marketUtils.jsx`,
  `frontend/src/components/reports/reportUtils.jsx`(**`.js` 파일은 없다**).
- 배럴은 사실상 사문화: `frontend/src/components/ui/index.js`를 import하는 파일은
  `frontend/src/pages/Showcase.jsx` 하나이고, 나머지 ~70곳은 프리미티브 파일을 직접 import한다.
- 동명 컴포넌트 충돌 주의: `frontend/src/components/ui/Badge.jsx:25`의 `MarketBadge({market, exchange})`와
  `frontend/src/components/ui/icons.jsx:108`의 `MarketBadge({mkt, exchange})`가 별개다.
- 프리미티브는 자기 CSS를 **1행에서** import한다(`frontend/src/components/ui/Badge.jsx:1`,
  `Stat.jsx:1` 등). 전역 로드 순서는 `frontend/src/main.jsx:3-5`(tokens → motion → index) +
  `frontend/src/index.css:1-4`(tokens → pc → mobile → guru)로 나뉘어 있다.
- TypeScript 0파일, `propTypes` 0건 — props는 인라인 주석으로만 문서화한다.
- `data-testid`는 소수 표면에만 둔다(`frontend/src/pages/Settings.jsx:118`,
  `frontend/src/pages/GuruDetail.jsx:270,278,287,309,338,344`). **테스트·프로브 앵커이므로
  스타일 변경 시 유지**하라는 주석이 붙어 있다(`GuruDetail.jsx:286`).

### 9.2 스타일·디자인 토큰
- plain CSS(Tailwind·CSS-in-JS 없음). 토큰 정본은 `frontend/src/styles/tokens.css`(261줄,
  헤더 `:1-5`가 ADR-0026 에디토리얼 아이덴티티와 "light가 기본" 원칙을 적어둔다).
  폰트 `:8-10`, 타입 스케일 `:13-22`, 표면/텍스트 `:25-34`, 액센트 `:36-39`, 버튼 필 `:43-45`,
  **가격 방향 `:48-52`(`--up` #b3372b 상승, `--down` #2b5c9e 하락)**,
  데이터 팔레트 `:55-59`, `--warn` `:61`, **의미 상태 `:65-78`**, radius·spacing(4px step)·
  shadow·`--transition-fast`. 전역 유틸 클래스·`:focus-visible`도 같은 파일 하단에 있다.
- **테마는 `<html data-theme="dark">` 속성 하나**로 갈린다(`tokens.css:123-201`에 다크 오버라이드).
  토글은 `frontend/src/hooks/useTheme.js:5-18`(+`<meta theme-color>` 동기, localStorage 영속).
  컨텍스트 없이 props로 내린다(`frontend/src/App.jsx:64,74,127`).
  `prefers-color-scheme` 미디어쿼리는 쓰지 않는다.
- **가격 색과 의미 색은 전용 변형으로 분리돼 있다 — 교차 사용 금지.**
  - `frontend/src/components/ui/Badge.css`: `.badge--up`(`:43`)/`.badge--down`(`:49`)은
    `--up`/`--down` 바인딩이며 `ChangeBadge` 전용(`Badge.jsx:35-37`, 주석이 "KR 가격색 관례 —
    의미색(success/danger) 아님"을 명시), `.badge--success`(`:29`)/`.badge--danger`(`:35`)/
    `.badge--warning`(`:55`)은 `--color-success`/`--color-error`/`--warn`으로 **통념(Western)대로**
    동작한다.
  - `frontend/src/components/ui/Stat.css`도 같은 규칙으로 정렬됐다 — **`.stat__value--up`/
    `--down`만 존재하고 의미 상태 variant는 두지 않는다**(주석 `:16-17`이 이유를 적어둔다).
    과거에는 `.stat__value--success` = `var(--up)`로 Badge와 반대 명명을 썼고, 그 어긋남이
    task#254의 "색이 조용히 사라지는" 결함을 만들었다(아래).
- **⚠️ 접미사 문자열 조립 컴포넌트는 CSS에 없는 값을 받아도 죽지 않는다.**
  `frontend/src/components/ui/Stat.jsx:14` `stat__value--${valueColor}`는 어떤 문자열이든
  클래스를 만든다 → 소비처가 `'up'`을 넘기는데 CSS엔 `--success`만 있으면 **색이 무채색으로
  사라지고 아무 게이트에도 안 걸린다**(vitest는 클래스명을 단언하니 수정 전에도 통과, jsdom은
  스타일시트를 적용하지 않고, 빌드는 미사용 CSS 클래스를 모른다). variant 이름을 바꿀 때는
  **CSS 규칙과 소비처를 같은 커밋에서 대조**하라. 현재 `ui/Stat` 소비처는 2곳
  (`frontend/src/pages/AnalystReport.jsx:332`, `frontend/src/pages/Showcase.jsx:75`)이라
  화이트리스트는 YAGNI로 두었다. 판정축은 라이브 `getComputedStyle().color`
  (`scripts/uat254-analyst-upside-color.mjs`, TESTING.md §7).
  ※ 같은 이름 `valueColor`가 `frontend/src/components/reports/reportUtils.jsx:104` `MetricCard`와
  `frontend/src/components/reports/DetailTab.jsx:582` `StatRow`에서는 **CSS var 문자열**
  (`"var(--up)"`)을 받는다 — 두 계약이 다르니 혼용 금지.
- **공용 배지/색 variant의 의미를 바꿀 때는 소비처 전수 grep 선행** — vitest·빌드는 색 의미에
  블라인드다(TESTING.md §9).
- 클래스 명명은 `ui/`에선 BEM-ish(`.badge`, `.badge__icon`, `.badge--up`), 전역 스타일시트에선
  평탄 kebab + `.is-active` 상태 클래스.
  **선택자 충돌 주의**: `frontend/src/styles/pc.css`의 전역 `.btn`/`.card`가
  `ui/Button.css`·`ui/Card.css`와 같은 선택자이며, 단일 대시 `.btn-primary`가 `Button.css`의
  `.btn--primary`와 공존한다.
- **인라인 스타일이 물량으로 우세**하다(`style={{` 1495 vs `className=` 987).
  단, 인라인 안의 색도 항상 `var(--token)` 참조이고 하드코딩 hex는 쓰지 않는다.
  재사용 인라인 객체는 모듈 상수로 호이스팅해 export한다
  (`marketUtils.jsx:19,21,30,37`, `reportUtils.jsx:6,7`).
- 모션은 `frontend/src/styles/motion.css`. 긴 주석(`:12-17`)이 하드 제약을 담는다 —
  transform `fill: both`가 `position: fixed` 자손을 깨뜨리고, opacity `both`가 모달 z-index를
  가둔다(그래서 라우트 전환은 transform 없는 `.anim-fade`만 쓴다 — `App.jsx:81-82` 주석).
  `prefers-reduced-motion` 블록 `:62`.

### 9.3 데이터 fetch
- 공용 axios 클라이언트 `frontend/src/api.js`(28줄, **77파일**이 import):
  `baseURL: import.meta.env.VITE_API_BASE_URL || ''`, 요청 인터셉터가 Bearer 토큰 부착,
  응답 인터셉터가 **401에서 토큰 삭제 + `window.location.replace('/')`**(`:21`).
  `href`가 아니라 **`replace`** 인 것이 load-bearing이다 — 만료 시점 딥링크 엔트리를 남기지 않아
  재로그인 후 뒤로가기 재진입을 막는다(주석 `:20`, 회귀
  `frontend/src/test/back-to-login-guard.test.jsx:118`).
  호출은 `/api` prefix를 포함한 전체 경로로 한다(`api.get('/api/market/vix')`).
- **raw `fetch`는 인증·애널리틱스에만** 쓴다(`frontend/src/App.jsx:38` 로그아웃,
  `frontend/src/pages/LoginPage.jsx:26,45`, `frontend/src/hooks/useAuthBootstrap.js:41`,
  `frontend/src/utils/analytics.js:4`) — `api.js`의 401 인터셉터가 로그인 중 리다이렉트를
  일으키기 때문이다. `VITE_API_BASE_URL`을 읽는 곳은 이들 + `api.js`이고 전부 `|| ''` 폴백이다.
- 에러 처리 3계층: ① fire-and-forget `.catch(() => {})` ② 지역 error state → 전용 에러 UI
  (`frontend/src/components/market/VixSection.jsx:12-20`의 loading/error/data 3분기가
  `market/*Section.jsx` 표준형) ③ 마커 붙인 `console.warn`/`console.error`(§4.5).
  **토스트는 사용자 개시 mutation용**이고 배경 fetch엔 쓰지 않는다.
- **에러 정직성**: `.then().finally()`로 로딩만 내리면 rejection이 잡히지 않아
  `loading=false·data=null`이 되고 **빈 상태 문구(=행동 지시)** 가 뜬다. 실패는 실패로 표시하고
  빈 상태와 구별해야 한다(회귀 `frontend/src/pages/GuruAllocation.test.jsx:201-217`).
- 토스트: `frontend/src/components/Toast.jsx` — `ToastProvider`(`:5`) + `showToast(msg, type)`
  (`:8-12`, `prev.slice(-2)`로 최근 3개만 유지·3초 자동 소멸), 타입 `success|error|warning`
  (`:26-28` 토큰 색), 컨테이너는 `position:fixed; bottom:150; zIndex:9999; pointerEvents:none`
  (`:17-23`, `:18-19` 주석이 150인 이유 = 플로팅 버튼 띠 회피를 적어둔다).
  `useToast()`(`:42-44`)는 **null 가드가 없다**.
  훅 안에서 재파생하지 않고 **부모가 `showToast`를 인자로 내려준다**
  (`frontend/src/hooks/useStockManagement.js:5-7`).
- 로딩 UI 기본은 `ui/Skeleton`(19파일). `LoadingSpinner`는 Guru/Ranking 4곳의 레거시 경로.
- **스코프/필터 전환 fetch는 경합을 막는다** — 늦게 도착한 이전 요청 응답이 최신 선택을 덮지
  않게 하고, 전환 실패 시 표시 중인 데이터를 지우지 않는다(회귀
  `frontend/src/pages/GuruAllocation.test.jsx:230-282`).

### 9.4 훅·컨텍스트
- `frontend/src/hooks/` **14개**. 복합 훅은 **args 객체 구조분해**로 받고
  (`useReportFilters.js:7`, `useStockManagement.js:7`, `useReportGeneration.js:5`),
  **파생 훅은 재fetch하지 않는다**(헤더 주석이 명시 — `useReportFilters.js:4`,
  `useStockManagement.js:5-6`). 타이머·옵저버는 항상 cleanup(`usePriceFlash.js:27`,
  `useStockManagement.js:14`, `useReveal.js:24`, `useBfcacheAuthGuard.js`).
  훅 본문 위에 한국어 의도 + task 번호를 적는다.
- 인증 관련 훅 2개가 App에서 분리돼 있다:
  `frontend/src/hooks/useAuthBootstrap.js`(첫 로드 세션 해석 — URL의 OAuth 결과 → localStorage;
  **에러·소진 코드·네트워크 실패도 "세션 없음"을 뜻하지 않는다**가 핵심 규약, `:13-17` 주석),
  `frontend/src/hooks/useBfcacheAuthGuard.js`(`pageshow.persisted`에서 토큰↔화면 불일치면
  `location.replace('/')`).
- 컨텍스트는 2개뿐: `frontend/src/contexts/AuthContext.jsx`(`{role, menuPermissions, loading}`,
  실패 시 `role:'user'`로 degrade하며 **로그 없음** `:23-26`)와 `components/Toast.jsx`.
  중첩 순서는 `frontend/src/App.jsx:124-130` ToastProvider → AuthProvider → BrowserRouter.
  Redux/Zustand/React Query 없음 — 서버 상태는 훅/페이지의 `useState`에 있다.

### 9.5 라우팅 — nav IA는 `navSections.js` 단일 소스
- 라우트는 `frontend/src/App.jsx:84-105`. **리다이렉트는 공유 상수로 추출**돼 있다:
  `frontend/src/routes.js:2-7` `REDIRECTS`를 `App.jsx:85-87`와
  `frontend/src/test/route-redirects.test.jsx:4`가 함께 읽는다.
  `*`(404) 라우트는 없다. 인증 게이트는 라우트가 아니라 라우터 앞 분기(`App.jsx:120-121`).
- **마스트헤드 IA 5섹션의 경로·라벨 목록은 `frontend/src/navSections.js` 단일 소스다 —
  탭 추가·개명·삭제는 거기 한 곳만 고친다.** export는 `NAV_SECTIONS`(섹션 5개 ×
  `items[{to, label, evt, match?}]`) + 매칭 헬퍼 `matchesItem`/`matchesSection`(`:48,50`,
  판정 = `pathname.startsWith(item.match ?? item.to)`) + `sectionByKey`(`:52`).
  세 소비처가 **파생**한다 — `frontend/src/components/Masthead.jsx:7,46,47,94`(PC 카테고리+서브바),
  `frontend/src/components/MobileNav.jsx:5,21,29`(모바일 하단 탭바),
  `frontend/src/pages/ResearchShell.jsx:5,11,12,17,33`(모바일 seg).
  아이콘 셋은 소비처마다 다르므로(`sketches` vs `ui/icons`) 각자 `ICONS[section.key]`로 매핑하고
  **공유 모듈엔 순수 경로·라벨 데이터만** 둔다(`navSections.js:5-6` 주석).
- 경위: 예전엔 같은 IA가 **세 곳에 수기 복제**돼 있었고 그중 한 곳 누락이 실질 재발 경로였다
  (탭 추가 시 PC 진입 불가 task#215 / 심층 리포트 상세에서 서브바·탭바·seg가 모두 "지금 어디인가"를
  잃음 task#251). 단일 소스화가 그 경로를 구조적으로 제거했다.
- **단수/복수 접두사 주의**: `'/analyst-reports'.startsWith('/analyst-report')`가 true라
  `items`에 `match: '/analyst-report'`(단수) 하나를 달아 목록·상세를 함께 덮는다 —
  상세에서 부모 탭을 강조하는 게 앱 관례다(`/guru/:id`와 동일). 형제 항목끼리 접두사 관계가
  생기면 그때 세그먼트 경계 매칭으로 올린다(`navSections.js:8-11` 천장 기록).
- **회귀 가드(신설)**: `frontend/src/test/nav-active-matching.test.jsx` — 3소비처 × 목록·상세
  6케이스로 active 표시를 단언한다. 주석 `:23`이 "jsdom은 여기서 블라인드가 아니다 — 레이아웃이
  아니라 className 존재 여부를 본다"를 명시한다.
- 내비는 `NavLink`/`Link` + `is-active` 클래스, 애널리틱스는 `trackEvent(item.evt)`
  (`ResearchShell.jsx`, `MobileNav.jsx`). 권한 필터는 `menuPermissions.includes(section.perm)`,
  PC 서브바는 `items.length >= 2`일 때만 렌더.
  **이벤트명은 `section.perm`에서 파생**한다(§1.5의 겸직 필드 주의).

### 9.6 차트 (recharts)
- 표준형: `ResponsiveContainer width="100%"` + **고정 숫자 height** →
  `CartesianGrid stroke="var(--border)"` → 축 `tick={{fontSize:10, fill:'var(--text-3)'}}` +
  명시 `width`(레이아웃 안정화) → `Tooltip contentStyle`에 토큰 → 밀집 계열은 `dot={false}`.
  기준 예: `frontend/src/components/market/VixSection.jsx:47-58`.
  모든 색은 `var(--data-1..5)` 등 토큰. focus outline은 `frontend/src/index.css:6-11`에서 전역 억제.
- **recharts 반지름은 `min(폭, 높이)/2`로 캡된다** — 도넛을 키우려면 폭만 넓혀선 안 되고
  `height`도 같이 올려야 한다. 그리고 **크기를 바꾸면 라벨 자동 임계값이 내려가 라벨 수가
  늘어나므로**(outerR 130→164에서 라벨 370→497개) 새로 등장하는 라벨의 넘침을 전수 재검증한다.
- **dual Y축은 좌=금액(억/조원·십억달러), 우=비중 %**(점선, `--data-3`)로 고정
  (`KrExportsSection.jsx`, `KrTop2Section.jsx`, `M7EarningsSection.jsx`, `LeverageSection.jsx`,
  `reports/ShortSellSection.jsx`, `ConsensusChart.jsx`, `FinancialsChart.jsx`).
- 용어 범례 어댑터: `frontend/src/components/Glossary.jsx:104` `GlossaryRechartsLegend`를
  `<Legend content={<GlossaryRechartsLegend />} />`로 끼운다.
- 공용 헬퍼: `frontend/src/components/market/marketUtils.jsx` — `krFmt`(`:6`, **입력 '억원' 단위
  가정**, 10,000억↑ 조), `isEstimated`(`:12`), `SECTION_*_STYLE`(`:19-37`), `SectionCard`(`:50`),
  `SectionCardLoading`(`:96`), `SectionCardError`(`:108`), `LoadingBox`(`:120`), `ErrorBox`(`:124`),
  `EmptyNote`(`:134`).
  `frontend/src/components/reports/reportUtils.jsx` — `TH`/`TD`(`:6,7`), `fmtN`(`:9`),
  `rsiColor`(`:10`), `fmtGap`(`:17`), `computePeerPremiums`(`:30`), `computeRevenueCagr`(`:58`),
  `overallWeather`(`:81`), `MetricCard`(`:104`), `SectionTitle`(`:112`), `GapCell`(`:123`),
  `TargetTooltip`(`:132`).
  **중앙값 정의는 프론트·백엔드가 같아야 한다** — `computePeerPremiums`(짝수면 중간 두 값 평균)와
  `backend/services/report_generator.py:148` `_peer_median`이 서로를 docstring에서 참조한다.
  두 곳이 다른 정의를 쓰면 화면 기준과 가드 기준이 어긋난다.
- recharts + `d3-*` + `victory-vendor`는 `charts` 청크로 분리(`frontend/vite.config.js:100-107`
  `manualChunks`). **Vite 8(rolldown)은 `manualChunks`를 함수로만 받는다** — 객체형은 빌드 실패
  (주석 `:102`).

### 9.7 레이아웃·시각은 추정하지 않는다 — 5개의 독립 판정축
`minmax`·열 수·폭 임계값을 정하는 변경은 배포 전에 `getBoundingClientRect()` 실측 1회를 근거로
삼는다. **가용폭을 "카드 폭 − 패딩"으로 추정하면 flex 형제가 먹는 폭을 놓친다**(295px 추정 vs
237px 실측). 열 수를 **줄이면** 남는 열이 넓어져 반대 뷰포트의 밀도가 내려가고, **늘리면** 좁은
트랙에서 label이 접혀 오히려 카드가 커지는 역전 지점이 있다. 완료기준은 대리지표(열 수)가 아니라
목표 자체(카드 높이·label 줄수)로 쓴다.

시각 결함은 **서로 잡히지 않는 5개 축**으로 갈린다 — 하나만 재면 나머지 4개에서 ALL PASS한다:

| # | 결함 클래스 | 왜 다른 축이 못 잡나 | 판정축 |
|---|---|---|---|
| 1 | **넘침** — 박스가 컨테이너를 벗어남 | — | `getBoundingClientRect()` 교차 |
| 2 | **잘림** — `text-overflow: ellipsis`·`line-clamp` | 박스를 넘는 게 아니라 **박스 안에서 내용을 지운다** | `scrollWidth > clientWidth`(세로면 `scrollHeight`) |
| 3 | **접힘** — flex가 자식을 압축해 텍스트가 여러 줄로 | 박스는 컨테이너 안에 머물고 **높이만** 2배가 된다. `right`가 부모와 *정확히* 일치하면(330.0 vs 330.0) "딱 맞았다"가 아니라 "압축됐다"는 신호 | 텍스트 노드에 `Range`를 걸어 `range.getClientRects().length === 1` |
| 4 | **간격** — 요소 *간* 거리가 의미를 왜곡(붙어야 할 게 떨어지고, 떨어져야 할 게 붙음) | 축 1~3은 전부 "단일 요소가 *자기* 상자 안에 있는가"를 묻는다 | 쌍의 `left − right` 거리 단언(예: `칩.left − 캡션.right ≤ 24px`) |
| 5 | **미적용 스타일** — 클래스는 붙었는데 CSS 규칙이 없어 색이 사라짐 | 축 1~4는 전부 *기하*를 잰다 | 라이브 `getComputedStyle(el).color` vs `:root` 토큰 실측값 |

구현 쪽 짝:
- 축2 — **ellipsis는 문자열 *끝*을 먹으므로 중요한 수치를 끝에 두지 않는다.** 줄어도 되는 것(이름)만
  ellipsis 상자에 넣고, 줄면 안 되는 것(수치)은 `flex-shrink: 0` 형제 span으로 고정한다.
- 축3 — **`flex-wrap: wrap`(컨테이너) + `white-space: nowrap`(자식)**: 폭이 모자라면 줄바꿈으로
  흐르되 텍스트 자체는 접히지 않는다.
- 축4 — 정렬을 `margin-left: auto`·`space-between` 같은 "남는 공간" 규칙에 맡기지 않는다.
  같은 규칙이 310px에선 "우측 정렬"이고 1400px에선 "1,000px 유기"다. 인접해야 할 쌍은 `gap`으로
  직접 묶고, 분리해야 할 쌍은 **그 요소 앞에만** margin을 준다(컨테이너 gap을 키우면 무관한 쌍까지
  늘어져 스캔선이 흐려진다).
- 축5 — §9.2의 접미사 조립 주의.

검증 방법·프로브 규약은 TESTING.md §7·§9. **육안으로 잡은 결함은 반드시 축으로 승격**시켜
다음번엔 육안에 기대지 않는다.

### 9.8 Lint
`frontend/eslint.config.js`(flat, 23줄) 전체가 `globalIgnores(['dist'])` +
`js.configs.recommended` / `reactHooks.configs.flat.recommended` / `reactRefresh.configs.vite`
3프리셋 + `languageOptions`뿐이다. **`rules` 블록이 없고 `no-console`도 미설정**이며
`eslint-plugin-react`·`jsx-a11y`는 설치돼 있지 않다. 억제는 소수(모두 `exhaustive-deps`).
`npm run lint` 스크립트는 있으나 **lint는 어디에도 연결돼 있지 않다** —
`.github/workflows/deploy.yml`(16줄)은 lint/test/build 잡이 없고, `deploy.sh`는 프론트
`npm install && npm run build`만 돌리며, `.husky/`·비-sample git hook도 없다.

### 9.9 i18n·접근성
- i18n 라이브러리·로케일 파일 없음. **UI 텍스트는 전부 한국어 인라인**이다.
  단 enum 값은 locale-독립 저장값으로 두고 label/색만 표시용으로 매핑한다
  (`frontend/src/components/ui/SupplyBadge.jsx:2-3`, `InsiderBadge.jsx:2`).
  `frontend/index.html:2`는 `<html lang="en">`인데 PWA manifest는 `lang: 'ko'`(불일치, 알려진 성질).
- `aria-*`는 희소하고 편중돼 있다 — 지배 관례는 장식 SVG의 `aria-hidden`
  (`frontend/src/components/ui/icons.jsx` 아이콘 전부, `Skeleton.jsx`,
  `GuruDetail.jsx:369`의 0×0 문자폭 측정용 SVG). `aria-label`은 한국어, `aria-expanded`·`role`은
  각 2곳. **모달은 `role="dialog"`·포커스 트랩 없이 `useBodyScrollLock`만 쓴다**
  (`StockModal.jsx`, `PromoteModal.jsx`, `GlobalSearch.jsx`).
- 툴팁 기본 수단은 `title` 속성(`aria-describedby` 0건)이며, market 섹션마다 3~4개씩 있다.
  **`title`은 Playwright 셀렉터로도 load-bearing**하다(TESTING.md §7).
  풍부한 대안은 용어 팝오버 `frontend/src/components/Glossary.jsx`
  (`GlossaryTerm`, `GlossaryText`, 매칭 규칙은 `frontend/src/glossary/terms.js:1-3`).
- 포커스 링은 `frontend/src/styles/tokens.css`에 중앙화. reduced-motion은 3곳에서 존중
  (`motion.css:62`, `useCountUp.js:16`, `useReveal.js:12`).

---

## §10 문서 동기 의무 (코드 변경에 딸린 DoD)

| 트리거 | 갱신 대상 | 강제 수단 |
|---|---|---|
| 엔드포인트 추가·삭제·개명 | `API_SPEC.md`(전체 REST 레퍼런스, 현재 `### \`METHOD /path\`` 헤더 **140개**) | **자동** — `backend/tests/test_api_doc_sync.py`가 라이브 `app.routes` ↔ 문서 헤더를 exact-match 대조. `KNOWN_UNDOCUMENTED`는 현재 **빈 frozenset**(`:50`)이라 미문서 엔드포인트 1개도 허용되지 않는다 |
| Cowork(외부 enrich/backlog 워크플로우) 대상 엔드포인트 | `CLAUDE_COWORK_API.md`(현재 헤더 **9개**) | **부분 자동** — stale(문서에 있는데 라이브에 없음)만 검출. "2문서 모두"는 **Cowork 스코프에 한한다** — 사용자 대면 read·admin refresh는 `API_SPEC.md`만 |
| 요청/응답 스키마·인증 게이팅 산문 | 위 두 문서의 본문 | **없음(수동 DoD)** — doc-sync는 엔드포인트 *존재*만 본다. 인증 게이팅을 바꾸는 슬라이스는 착수 시 `grep -n '\*\*Auth:\*\* 불필요' API_SPEC.md`를 먼저 돌릴 것(현재 잔존 **1건** — `auth.py` 공개 엔드포인트, ADR-0029) |
| 기능 표면(화면 구성·환경변수·기술 스택·아키텍처·배치) | `README.md` 해당 절 | 없음(수동). overview 레벨만 — 엔드포인트/스키마 세부는 `API_SPEC.md`에만 |
| 배치 fetch 소스 변경 | `backend/services/batch_registry.py`의 `source` | 존재만 자동(`test_batches_router.py:52-65`) |
| 신규 DB 컬럼 | `backend/app_schema.sql` **+** `backend/main.py:_migrate()` 쌍 | 없음(수동) |
| nav 탭 추가·개명·삭제 | `frontend/src/navSections.js`만 | 부분 자동 — `frontend/src/test/nav-active-matching.test.jsx`가 active 매칭을 단언(§9.5) |
| 규약·함정 학습 | 루트 `CLAUDE.md` Gotchas + 이 문서 | 없음(수동) |

`.forge/codebase/`는 **구현 사실** 전용이다. 도메인 용어 정의는 `CONTEXT.md`, 결정 기록은
`.forge/adr/`에 둔다(이 문서에 중복 서술하지 말 것).

---

## §11 규약을 강제하는 자동 가드 (요약)

| 가드 | 무엇을 막는가 |
|---|---|
| `backend/tests/test_no_print.py` | 앱 코드의 신규 `print()` (§4.1) |
| `backend/tests/test_no_bare_today.py` | bare `date.today()`/`datetime.today()` — 컨테이너 UTC라 00~09 KST에 하루 어긋난다. `services.utils.today_kst()` 사용 (§8) |
| `backend/tests/test_no_public_reads.py` | 무인증 `/api` 엔드포인트 신규 추가 + 허용목록 stale (ADR-0029, §6) |
| `backend/tests/test_api_doc_sync.py` | 문서 없는 신규 엔드포인트 / 삭제 누락 (§10) |
| `backend/tests/test_batches_router.py` 외 3파일 | 배치 id/개수 드리프트, `source` 누락 (§8) |
| `backend/tests/test_nan_serialization_guards.py` | NaN/inf 응답 오염 → 직렬화 500 (§5.2) |
| `backend/tests/test_consensus_asof_batch.py::test_values_placeholder_shape` | `VALUES` 괄호 감싸기 회귀 (§7) |
| `backend/tests/conftest.py` `_block_real_db` | 테스트의 실 DB 접촉 (TESTING.md §3) |
| `backend/tests/_routes.py` `walk_routes` | FastAPI 버전차로 라우트 열거가 조용히 0개가 되는 것 |
| `backend/tests/test_cowork_fire_listener.py` | fire 리스너의 workdir 충돌 + API 키 argv 노출 |
| `frontend/src/test/nav-active-matching.test.jsx` | nav 단일 소스의 active 매칭 회귀 (§9.5) |
| `frontend/src/test/route-redirects.test.jsx` | `routes.js` `REDIRECTS`와 라우트 배선 드리프트 |
| `frontend/src/test/back-to-login-guard.test.jsx` | 전체이동 진입점의 히스토리 취급(replace vs push) 회귀 (§9.3) |
| `scripts/uat254-analyst-upside-color.mjs` | 클래스는 붙었는데 CSS 규칙이 없어 색이 사라지는 것 (§9.2·§9.7 축5) |

**자동 가드가 없는 규약**(리뷰·수동 검증 의존): 프론트 로깅 마커(§4.5),
라우트 순서(§6), `_migrate` 쌍(§7), 배지/`Stat` 색 의미(§9.2), 레이아웃 수치(§9.7),
겸직 필드 파생(§1.5), 프론트 이벤트명 화이트리스트 정합, README·스키마 산문 동기(§10).

---
last_mapped_commit: 47521121f10ac1c057fe9cf8ed5fc43ab5ca596c
mapped: 2026-07-31
---

# TESTING — 테스트·검증 지도

**구현 사실**만 담는다. 코드 스타일·로깅·문서 동기 규약은 형제 문서
`.forge/codebase/CONVENTIONS.md`를 본다(이 문서는 그 §4·§9.7·§11을 자주 인용한다).

---

## §1 프레임워크·실행

| 계층 | 도구 | 실행 | 규모 |
|---|---|---|---|
| 백엔드 | pytest 8.4.2 | `cd backend && .venv/bin/python -m pytest` | `backend/tests/test_*.py` **128파일 / 테스트 함수 1406개** |
| 프론트 | vitest 4 (jsdom 29) | `cd frontend && npm test` (= `vitest run`) | `frontend/src/**/*.test.{js,jsx}` **30파일** |
| 라이브 UAT | Playwright 1.50 (`scripts/package.json`) | `node scripts/uatNNN-*.mjs` | `scripts/*.mjs` **98개** (+ `*.js` 8, `*.py` 7) |
| 라이브 감사 | 순수 python | `cd backend && .venv/bin/python ../scripts/audit_unauth_endpoints.py` | `scripts/audit_unauth_endpoints.py` |
| 라이브 데이터 프로브 | 로컬 `backend/.venv` python | `backend/.venv/bin/python scripts/probe248-peer-multiples.py` | `scripts/probe248-peer-multiples.py`, `scripts/probe239-guru-activity.py` |

- pytest 설정은 `backend/pytest.ini` 2줄이 전부다: `testpaths = tests`, `pythonpath = .`.
  마커 정의·플러그인 설정 없음. `@pytest.mark.parametrize`가 8곳, 커스텀 마커는 없고
  모듈 레벨 `pytestmark`는 1곳뿐이다(`backend/tests/test_cowork_fire_listener.py:17`
  `pytest.mark.skipif(not LISTENER.exists(), ...)`).
- vitest 설정은 `frontend/vite.config.js:94-98`의 `test` 블록: `environment: 'jsdom'`,
  `globals: true`, `setupFiles: './src/test/setup.js'`.
  `frontend/src/test/setup.js`는 `import '@testing-library/jest-dom'` 1줄이다.
- **CI에 테스트가 없다.** `.github/workflows/deploy.yml`(16줄)은 `git reset --hard origin/main`
  후 `bash deploy.sh` 한 스텝뿐이고, `deploy.sh`는 프론트 `npm install && npm run build`만
  돌린다. lint/pytest/vitest 잡도, PR 트리거 워크플로도, `.husky/`·비-sample git hook도 없다.
  → **모든 게이트는 로컬 수동 실행**이며, 그래서 "배포 전에 전체 스위트를 돌렸는가"가 실질 DoD다.
- 로컬 인터프리터는 **Python 3.9.6**, 배포 컨테이너는 3.12(CONVENTIONS §3.3).
  로컬에 `lxml`이 없어 HTML 파싱 테스트는 `BeautifulSoup(html, "html.parser")`를 쓴다.
- **프론트 라이브 UAT는 빌드에 의존한다.** nginx가 `frontend/dist`를 직접 서빙하므로
  `npm run build` 전에는 라이브에 옛 번들이 떠 있다 → **프론트 프로브를 포함하는 계획은
  commit+push → build → 프로브 순서**여야 완료기준이 원리적으로 달성 가능하다.
  거꾸로 이 성질은 무기가 되기도 한다 — vitest로 원리적 검출이 불가한 결함(§9-11)에서는
  **빌드 전에 프로브를 돌려 라이브 red-first**를 확보할 수 있다(`scripts/uat254-analyst-upside-color.mjs`가
  빌드 전 8 FAIL을 냈다).

---

## §2 테스트 파일 배치

### 백엔드 — `backend/tests/` 평탄 구조
- 명명 `test_<주제>.py`. 주제는 라우터(`test_stocks_router.py`), 서비스(`test_dividends.py`),
  회귀 클러스터(`test_empty_result_overwrite_guards.py`), 규약 가드(`test_no_print.py`),
  운영 스크립트(`test_cowork_fire_listener.py`)로 섞인다.
- `backend/tests/__init__.py`는 빈 파일(패키지화 목적 — `from tests._routes import ...`를 위해).
- 공유 헬퍼는 `backend/tests/_routes.py`의 `walk_routes(routes)` 하나뿐이다(§5.4).
- 실데이터 fixture는 `backend/tests/fixtures/backlog/*.html` **11개**(실 DART `document.xml` 표
  HTML). 소비처는 `backend/tests/test_backlog_extract.py:16`(`FIX` 상수)와
  `backend/tests/test_backlog.py:413`.
- `tmp_path`로 파일 경로를 격리하는 파일 **9개**: `test_calendar_router.py`,
  `test_cowork_fire_listener.py`, `test_digest_service.py`, `test_disclosure_endpoint_digest.py`,
  `test_empty_result_guards_exports_krsector.py`, `test_market_indicators.py`,
  `test_report_generator.py`, `test_report_price_gate.py`, `test_report_router.py`.

### 프론트 — 콜로케이션 + 교차관심사 디렉터리 2원 구조
- 콜로케이션(**19개**): 소스 옆 `Foo.test.jsx`. 예 `frontend/src/pages/GuruAllocation.test.jsx`,
  `frontend/src/pages/Settings.test.jsx`, `frontend/src/hooks/useReportFilters.test.js`,
  `frontend/src/components/reports/MarketOutlookSection.test.jsx`,
  `frontend/src/utils/oauthHistory.test.js`.
- 교차관심사(**11개**): `frontend/src/test/`에 **kebab-case** —
  `auth-bootstrap.test.jsx`, `back-to-login-guard.test.jsx`, `compare-race.test.jsx`,
  `compare-sector-group.test.jsx`, `global-search-tracked.test.jsx`, `masthead.test.jsx`,
  `nav-active-matching.test.jsx`, `recommendations-s3s4.test.jsx`,
  `reports-deep-link-navkey.test.jsx`, `route-redirects.test.jsx`,
  `smoke.test.js`(러너 동작 확인용 스모크).
- 확장자 규칙: JSX를 렌더하면 `.test.jsx`, 순수 로직이면 `.test.js`
  (`frontend/src/components/reports/reportUtils.test.js`, `frontend/src/utils/oauthHistory.test.js`).
- **`App`은 테스트에서 import하지 않는다**(로그인 셸 전체를 렌더해 모킹 비용이 크다).
  그래서 App에 있던 인증 분기를 훅으로 빼서 테스트 가능하게 만들었다
  (`frontend/src/hooks/useAuthBootstrap.js` ← `frontend/src/test/auth-bootstrap.test.jsx`) —
  **테스트 가능성이 코드 배치를 결정한다**(CONVENTIONS §9.1).

### 라이브 프로브 — `scripts/`
- 명명 `uat<taskNo>-<주제>.mjs`(예 `scripts/uat247-guru-cohort.mjs`,
  `scripts/uat255-guru-alloc-perf.mjs`), 인증 스모크는 `smoke<taskNo>-auth.mjs`,
  이름 없는 상시 프로브는 `uat-<주제>.mjs`(`scripts/uat-guru-row-ux.mjs`).
  출력 스크린샷은 리포지토리 루트 `screenshots-uat<taskNo>/`(**64개 디렉터리, 전부 untracked**).
- 파이썬/CJS 프로브도 있다 — `scripts/probe248-peer-multiples.py`(로컬 `.venv`로 서비스 함수를
  직접 import해 외부 소스 실값을 대조), `scripts/probe239-guru-activity.py`,
  `scripts/contrast_probe.py`, `scripts/check-permissions.js`, `scripts/screenshot.js`.
- 대상은 **라이브 배포** `https://portfolion.taebro.com`(93개 프로브가 이 도메인을 때린다).

---

## §3 `conftest.py` 가드 픽스처

`backend/tests/conftest.py`(38줄)가 전부다. 세 가지를 한다.

1. **전역 인증 우회** — `:10` `app.dependency_overrides[get_current_user] = lambda: "test-user-id"`.
   대상은 `main.app` **하나뿐**이다(§4.1의 self-app 함정의 원인).
   `:13-15` `client` 픽스처가 `TestClient(app)`를 준다.
2. **`_clear_quote_cache`(autouse)** — `:18-23`. `get_quote`가 종목 단위 TTL 캐시를 쓰므로
   매 테스트 전에 `cache_svc.invalidate_quote()`로 교차 오염을 끊는다.
3. **`_block_real_db`(autouse)** — `:26-37`. `services.db._get_pool`을
   `RuntimeError("tests must not touch the real DB — mock services.db.query/execute")`로
   monkeypatch한다. 주석 `:28-31`이 사고 경위를 남긴다 — 로컬 `DATABASE_URL`이 도커 postgres
   (=라이브 DB)를 가리켜 `generate_report` end-to-end 테스트의 INSERT가 **prod `snapshots`를
   fixture 값으로 덮었고**, admin 삭제 테스트가 prod `calendar_cache`를 전부 DELETE했다.

**함의**
- DB를 타는 테스트는 **반드시** `services.db`의 `query`/`execute`(또는 그 상위)를 mock한다.
  가드가 raise하면 그 테스트가 실 DB에 닿고 있다는 뜻이니 **가드를 풀지 말고 mock을 추가**한다.
- 오염은 *선택적*이었다 — 가짜 티커(`TEST`)는 FK로 실패해 무해해 *보이고* 실존 티커만 오염됐다.
  라이브 값이 지나치게 라운드(정확히 `70000.0`, 정확히 400조)면 **피드 글리치보다 테스트 오염을
  먼저 의심**한다(ADR-0020 amendment).
- **가드는 DB만 막고 파일 write는 막지 않는다.** 파일 캐시를 건드리는 테스트는 `tmp_path`로
  경로를 돌린다 — 모범 사례가
  `backend/tests/test_empty_result_guards_exports_krsector.py`의 `exports_mod` 픽스처
  (`_DATA_DIR`·`_EXPORTS_CACHE`를 `tmp_path`로 monkeypatch + `KITA_API_KEY` 제거).
  과거 전체 스위트가 `backend/data/sp500_tickers.json`·`kospi_tickers.json`을 오염시켰는데
  (`_block_real_db`로 `_mc_load`가 None → 캐시 미스 → 라이브 스크레이프 → 파일 write),
  그 티커 캐시는 `market_cache`(키 `sp500_tickers`/`kospi_tickers`)로 이전됐고 파일은
  **read-only 시드**로 격하됐다(`backend/services/market_indicators/earnings.py` — `_SP500_SEED`/
  `_KOSPI_SEED`는 `open()` read, 저장은 `_mc_save`).
  **그래도 전체 스위트 실행 후 `git status`로 부수효과를 확인하는 습관은 유지**할 것(다른 write
  경로가 생길 수 있고, 파일 mtime을 TTL 기준으로 쓰면 덮어쓴 직후 신선해져 증상이 스스로 숨는다).
- 운영 스크립트 테스트도 실 환경을 건드리지 않는다 —
  `backend/tests/test_cowork_fire_listener.py:47-63`이 `subprocess.Popen`·`RUN_DIR`·`_env_value`·
  `time.strftime`을 전부 monkeypatch하고 가짜 키(`FAKE_KEY`)를 쓴다. 하이픈 파일명 스크립트는
  `importlib.util.spec_from_file_location`으로 로드한다(`:20-25`).

---

## §4 백엔드 모킹 패턴과 함정

### 4.1 self-app 패턴이 지배형 — conftest `client`는 거의 안 쓴다
- 모듈 상단에서 `FastAPI()`를 직접 만들고 라우터를 include한 뒤 override를 심는 파일이 **38개**,
  conftest `client` 픽스처를 쓰는 파일은 **2개**뿐이다
  (`backend/tests/test_macro_signals_batch.py`, `backend/tests/test_recommendation_batch.py`).
  `main.app`을 import하는 파일은 4개(`conftest.py`, `test_analyst_reports.py`,
  `test_api_doc_sync.py`, `test_no_public_reads.py`).
- override 집계(라인 수 / 파일 수): `get_current_user` 39 / 30, `require_admin` 22 / 19,
  `get_current_user_or_api_key` 11 / 9, `require_admin_or_api_key` 7 / 5.
- 표준형(`backend/tests/test_batches_router.py:8-18`)은 **일반 앱 + admin 앱 2개**를 만들어
  비-admin 403 경로까지 같은 파일에서 검증하고, 무인증 검증용 세 번째 앱(`:115` `no_auth_app`)도
  같은 파일에 둔다. 4개 인증 의존성을 전부 override한 예는
  `backend/tests/test_report_router.py:24-30`.
  테스트별로 override를 붙였다 떼는 형태도 있다 —
  `backend/tests/test_analyst_reports.py:191,226` `dependency_overrides.pop(require_admin_or_api_key, None)`.
- 무인증 거부(401/403)는 **override 없는 fresh app**으로 별도 검증한다 —
  `backend/tests/test_security_auth_gaps.py:22-27`의 `_client(*routers)` 헬퍼
  (docstring `:4-5`가 "conftest override는 `main.app` 한정이라 여기 fresh app엔 안 걸린다"를 명시).
  admin 게이트 검증 다른 형태: `backend/tests/test_batches_router.py:231-236`이
  `require_admin`을 override하지 않은 앱에서 `auth.auth_service.get_user_by_id`를 patch해 403을 본다.
  비-admin 전용 앱을 따로 만드는 예: `backend/tests/test_guru_router.py:160`.
- **함정**: 엔드포인트에 auth `Depends`를 추가하면 그 경로를 호출하는 self-app 테스트가
  401/403으로 깨진다. **다만 선제적으로 전수 override를 추가하지 말 것** — 형제 read가 먼저
  인증돼 있으면 그 앱이 이미 override를 등록해 둔 경우가 많다(계획이 4·5·14파일을 지목했는데
  실제 변경은 3·0·0파일이었던 3연속 사례). **순서: 의존성을 붙인 뒤 전체 스위트를 먼저 돌리고
  실제로 깨지는 것만 고친다.** grep은 "어디를 볼지"를 좁히는 용도이고 게이트는 스위트다.
- **보완항 — 스위트는 *안 깨지는* 오류를 못 잡는다.** 판정축·계산식을 바꾸면 결과가 같아
  **통과하는 테스트의 주석·docstring이 거짓**이 된다(피어 멀티플 기준 표본을 leave-one-out에서
  "peer 전체+자사"로 바꿨을 때 `median(10,11,12)=11`을 주석에 박아둔 테스트가 초록으로 통과했다).
  전수 확인 대상은 "깨지는 테스트"가 아니라 **"그 축을 *서술하는* 테스트"** 이고,
  `git grep`으로 축의 **옛 표현**(`나머지 peer`·주석에 박힌 `median(` 산식)을 훑어야 잡힌다.
  → 스위트는 *깨지는 것*, grep은 *안 깨지면서 거짓이 된 것*. 둘을 함께 돌린다.

### 4.2 patch 타깃은 "실제 조회 경로"
- `unittest.mock.patch`를 쓰는 파일 82개, `monkeypatch`를 쓰는 파일 51개(혼용 흔함).
- **지연 import된 심볼은 원 모듈을 patch한다.**
  `backend/tests/test_us_supply_empty_guard.py:13-15` 주석:
  *"`fetch_all_us_supply`는 함수 내부에서 `from services.db import query as db_query`로 지연
  import하므로 `services.db.query`를 patch해야 한다(`svc.query`가 아님)."*
- **`importlib.reload` 패턴 테스트는 모듈 자체 정의 심볼 patch를 무효화한다.**
  `backend/tests/test_market.py`·`backend/tests/test_report_generator.py`가 reload를 쓰므로,
  이 파일들에서는 하위 모듈 속성(`services.db.execute`, `_naver_get` 등)을 patch해야 한다.
- **모듈에서 심볼을 제거·개명하면 그 심볼을 patch하는 테스트를 *파일 불문* 전수 grep**
  (`grep -rn "모듈경로.심볼" backend/tests/`). mock 타깃은 그 기능의 주 테스트 파일에만 있지 않다
  (`digest_service`에서 `yf` import를 제거했을 때 `test_disclosure_endpoint_digest.py`가
  `services.digest_service.yf.Ticker`를 patch하고 있어 `ModuleNotFoundError`로 파손).
- **additive read/외부호출 추가는 `mock.call_args`(마지막 호출) 단언을 조용히 오염시킨다.**
  대응: ① 기존 단언을 **호출별 `call_args_list[i].kwargs`**로 마이그레이션
  ② 신규 호출은 입력이 비면 `if` 로 생략해 기존 테스트를 보존 ③ 신규 테스트가 `call_count`로
  시퀀스를 못박는다.

### 4.3 "red 조건"을 call_count로 관측한다 — 빈 결과 가드 계열
빈 결과 가드는 "옛 구현이 *실제로* 저장 함수를 호출했다"를 관측해야 red가 성립한다.
그래서 이 계열은 반환값이 아니라 **저장 mock의 `call_count`/`call_args`**를 단언한다.

| 파일 | 덮는 것 |
|---|---|
| `backend/tests/test_empty_result_overwrite_guards.py` | 5곳 — 구루 매니저(`save_guru_managers` + `routers.guru._run_crawl` + `scheduler.jobs._run_guru_crawl`), 원자재·국채(요청경로), M7·KR Top2 실적(배치 force 경로). `mock_exec.assert_not_called()` / `mock_save.call_count == 1` |
| `backend/tests/test_empty_result_guards_exports_krsector.py` | 2곳 — KR 수출(예외만 가드해 "성공-but-빈응답"이 통과했던 케이스: `stale` 마커·파일캐시 미생성까지 단언), KR 업종 역인덱스(같은 payload의 `index`가 빠졌던 케이스: `save.call_args[0]`으로 `sectors`는 신규·`index`는 직전값임을 단언) + admin 응답의 `saved` 플래그 정직성 |
| `backend/tests/test_rankings_empty_guard.py` | 빈 quotes/비-dict 응답 → `RuntimeError` 전파 |
| `backend/tests/test_us_supply_empty_guard.py` | yfinance `t.info == {}` "성공-but-빈응답"이 upsert를 타지 않는지 |
| `backend/tests/test_fx_partial_failure.py`, `backend/tests/test_public_api_empty_items.py`, `backend/tests/test_kospi_futures.py` | 부분 실패·빈 items·KIS 빈 output 폴백 |

**중요**: 이 경로를 실제로 치려면 **예외 `side_effect`가 아니라 "값이 None/빈인 반환"을 모킹**해야
한다(예외 가드는 이미 통과하는 경로다).

### 4.4 `caplog`·autouse 스텁
- 로그 단언은 `caplog`(**7파일**). 관용구:
  `with caplog.at_level(logging.WARNING): ...` → `assert any("빈 결과" in r.message for r in caplog.records)`
  (`backend/tests/test_empty_result_overwrite_guards.py`, `..._exports_krsector.py`).
  경고 **중복 방출**도 단언 대상이다 —
  `backend/tests/test_guru_stats.py::test_compute_allocation_does_not_duplicate_warning_across_full_and_cohort_scan`,
  `backend/tests/test_report_valuation_multiples.py:495`
  `test_guard_peer_multiples_warns_once_per_dropped_field(caplog)`.
  `capsys`는 1파일만 남아 있다 — **`print`→`logger` 전환 스윕 때 `capsys` 테스트를 미리 찾아
  마이그레이션할 것**(CONVENTIONS §4.1).
- 백그라운드 워커의 `job_runs.record` 계측이 테스트 DB를 건드리지 않게 autouse로 no-op
  컨텍스트매니저를 심는 패턴: `backend/tests/test_report_router.py:12-21`.

### 4.5 스케줄러·라우트 열거 테스트
- `backend/tests/test_batches_router.py:38-41` 관용구: `job_runs.recent`·
  `storage.get_batch_schedule`을 patch하고 `patch.object(__import__("scheduler"), "_scheduler")`로
  APScheduler 싱글톤을 MagicMock으로 갈아끼운다.
- 날짜 의존 분기는 실행일 무관하게 결정적으로 만든다 —
  `backend/tests/test_batches_router.py:239-268`이 `_FOMC_DATES`를
  `date.today() ± timedelta`로 patch해 양 브랜치를 못박는다(주석 `:239-241`이 "라이브로는 소진
  임박 상태를 만들 수 없으므로"를 명시).

### 4.6 이빨 검증 — red-first가 원리적으로 불가한 단언
`allow_inf_nan=False`(NaN 거부)나 `Optional[float]`(명시적 null 허용)처럼 **수정 전에도 통과하는**
단언은 red-first를 만들 수 없다. 그때는 **가드를 일시 제거해 실제로 실패하는지 확인하고 원복**해
그 테스트가 무엇이든 잡는다는 것을 증명한다(CONVENTIONS §5.4). 라이브 프로브의 대응 관용구는
"토큰이 서로 다름"류 이빨 단언이다(§7.3 ⓘ).

---

## §5 규약을 강제하는 테스트 (개별)

### 5.1 `backend/tests/test_no_print.py` — 앱 코드 zero-print
`main.py`·`routers`·`services`·`scheduler`·`middleware`를 `rglob("*.py")`로 훑어 **AST로
`print()` 호출 노드만** 탐지한다 → 문자열·주석·`pprint` 오탐 없음.
`tests/`·`scripts/`·`data/`는 대상 외(`:6`). 실패 메시지가 `CONVENTIONS §4`를 인용한다.

### 5.2 `backend/tests/test_no_bare_today.py` — bare `today()` 금지
같은 AST 스윕 형태로 `.today()` 속성 호출을 잡는다. 컨테이너가 UTC라 00~09 KST에
하루 어긋나므로 앱 코드는 `services.utils.today_kst()`(`backend/services/utils.py:11`)를 쓴다.
docstring/주석에서 규약을 설명하는 문구는 오탐 없음.

### 5.3 `backend/tests/test_no_public_reads.py` — ADR-0029 인증 게이트
- 라이브 `app` 배선을 본다(AST/데코레이터 파싱 아님): 엔드포인트 함수 파라미터 default가
  `Depends(...)`이고 그 dependency가 4개 인증 의존성 중 하나인지 + 라우트 수준
  `dependencies=[...]`도 함께 검사(`:41-56`). 핸들러를 실행하지 않아 DB에 닿지 않는다.
- `ALLOWED_PUBLIC`(`:28-38`)은 `auth.py` 공개 **9개**(register/login/refresh/logout + OAuth 5개).
  **양방향 exact-match** — 새 무인증이 생기면 실패(`:84`), 목록에 있는데 인증이 걸렸거나
  사라져도 실패(`:93`).
- **`test_route_walk_is_not_silently_empty`(`:72-81`)가 이 파일의 핵심 안전장치**다:
  `/api` 라우트가 100개 초과인지 단언해 "라우트 0개를 세며 조용히 통과"를 차단한다
  (감사 스크립트가 실제로 그렇게 거짓 통과했다 — §5.4).

### 5.4 `backend/tests/_routes.py` — 버전차 흡수 헬퍼
`walk_routes(routes)`가 `routes`·`original_router`를 **재귀 하강**해 `.path`를 가진 라우트만
yield한다. 이유(docstring `:1-10`): 로컬 `.venv`(FastAPI **0.128.8**)는 `include_router`로 들어온
라우트를 `app.routes`에 평탄하게 넣지만, 배포 이미지(0.138+)는 `_IncludedRouter`로 감싸
`.path`도 `.routes`도 노출하지 않고 `original_router`만 준다. 평탄 순회는 **후자에서 0개를 센다**.
`backend/requirements.txt`가 핀 없는 `fastapi>=0.104.0`이라 이 발산은 계속된다.
→ **라우트를 열거하는 테스트/스크립트는 전부 이 헬퍼(또는 동형 `_walk`)를 거쳐야 한다.**
현재 소비처: `test_no_public_reads.py:17`, `test_api_doc_sync.py:11`,
`scripts/audit_unauth_endpoints.py:61-73`(자체 `_walk` 복제).

### 5.5 `backend/tests/test_api_doc_sync.py` — API 문서 drift
라이브 ground-truth = `walk_routes(app.routes)`, 문서 canonical = `### \`METHOD /path\`` 헤더
정규식(`:19`). 경로 정규화(`_norm`)로 path param 철자(`{ticker}`→`{}`)·쿼리스트링·끝 슬래시 차이를 무시.
FastAPI util 경로(`/openapi.json`·`/docs`·`/redoc`·`/docs/oauth2-redirect`)는 제외.
3개 단언: ① 라이브 − `API_SPEC.md` == `KNOWN_UNDOCUMENTED`(현재 **빈 frozenset** `:50`)
② `API_SPEC.md` − 라이브 == ∅ ③ `CLAUDE_COWORK_API.md` − 라이브 == ∅.
현재 `API_SPEC.md` 헤더 140개 / `CLAUDE_COWORK_API.md` 9개.
**검출 범위는 엔드포인트 *존재*뿐** — 스키마·인증 게이팅 산문은 못 본다(§9-7).

### 5.6 배치 레지스트리 count/set 단언 4곳
`backend/tests/test_batches_router.py:26-34`(`EXPECTED_IDS` 29개 집합) + `:45-46`(`len(data) == 29`),
`backend/tests/test_batch_market_split.py:54`(`len(batch_registry.BATCHES) == 29`),
`backend/tests/test_macro_signals_batch.py:37`(동일),
`backend/tests/test_scheduler_seed.py:82`(`editable` 목록 파생).
`backend/tests/test_batches_router.py:52-65`는 전 배치가 비어있지 않은 `source: list[str]`를
갖는지도 단언한다. **배치를 추가·은퇴시키면 이 4파일을 함께 고쳐야 스위트가 green이 된다**
(`grep -rn "BATCHES) ==\|len(data) ==\|EXPECTED_IDS" backend/tests/`).

### 5.7 그 외 규약 가드
- `backend/tests/test_nan_serialization_guards.py` — 제로분산 corr NaN → `json.dumps(result,
  allow_nan=False)` 통과 + 엔드포인트 응답 직렬화.
- `backend/tests/test_consensus_asof_batch.py:111` `test_values_placeholder_shape` — `VALUES`
  행 나열 형태 고정(바깥 괄호 금지).
- `backend/tests/test_db_execute_many.py` — 단일 커넥션 획득 + `execute_batch` 1회.
- `backend/tests/test_ticker_validation.py`, `test_schedule_spec.py` — 입력 검증 규약.
- `backend/tests/test_analyst_reports.py` — 발행 본문 검증(명시적 `null` 허용 + NaN/Infinity 거부).
- `backend/tests/test_cowork_fire_listener.py` — 운영 스크립트 가드(같은 초 2회 fire의 workdir
  분리 · 실행 중 `run.log` 미truncate · **API 키가 argv에 없고 stdin으로 전달**).
- `backend/tests/test_report_valuation_multiples.py:319-559` — 피어 멀티플 이상치 가드
  (기준 표본 = peer 전체 + 자사, 표본 <3이면 생략, 자사는 판정 제외·표본 포함 — ADR-0030).
  판정축 교체 경위를 주석 `:319-327`이 남긴다.

---

## §6 프론트 vitest 패턴

관용구는 `frontend/src/pages/GuruAllocation.test.jsx`(373줄, 최다 케이스)와
`frontend/src/test/masthead.test.jsx`·`back-to-login-guard.test.jsx`가 가장 잘 보여준다.

1. **api 모듈을 통째 vi.mock** — `vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))`
   (`GuruAllocation.test.jsx:5`), 그 후 `api.get.mockImplementation((url) => ...)`로 URL별 분기.
2. **jsdom 결손 우회** — `matchMedia`가 없으므로 `vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))`
   로 뷰포트를 고정한다(`GuruAllocation.test.jsx:7` / 모바일 고정은
   `nav-active-matching.test.jsx:13`의 `() => true`). 주석이 이유를 적어둔다.
3. **토스트는 spy로 가로챈다** — `vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: showToastSpy }) }))`
   (`GuruAllocation.test.jsx:10`), 단언은
   `expect(showToastSpy).toHaveBeenCalledWith(expect.any(String), 'error')`.
   컴포넌트가 실제 `ToastProvider`를 필요로 하면 대신 감싼다
   (`masthead.test.jsx:19-21` — 주석이 "Masthead가 흡수한 GlobalSearch가 `useToast()`를 쓴다"는
   이유를 적어둔다, `nav-active-matching.test.jsx:31`).
4. **라우터 컨텍스트는 `MemoryRouter initialEntries={[path]}`로 주입**한다
   (`nav-active-matching.test.jsx:29-35`의 `renderAt(path, ui)` 헬퍼가 표준형).
5. **컨텍스트는 훅 모듈 mock으로 주입** — `vi.mock('../contexts/AuthContext', () => ({ useAuth: () => authMock() }))`
   + 테스트별 `authMock.mockReturnValue({ menuPermissions, role, loading })`
   (`masthead.test.jsx:5,7,28,40,46` — 권한 조합·admin·loading 3분기).
6. **`location`은 객체째 `vi.stubGlobal('location', {...})`로 갈아끼운다.**
   jsdom에서 `location.replace`는 non-writable이라 `spyOn`이 `TypeError: Cannot redefine property`로
   막히지만 `window.location` 자체는 configurable이다
   (`frontend/src/test/back-to-login-guard.test.jsx:20-31` 주석 + `auth-bootstrap.test.jsx:18-25`의
   `atUrl(search)` 헬퍼). 정리는 `afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })`
   + `localStorage.clear()`/`sessionStorage.clear()`.
7. **훅은 `renderHook`으로 직접 검증**한다(`@testing-library/react`) —
   `frontend/src/test/auth-bootstrap.test.jsx`(5분기 × 토큰 유무),
   `back-to-login-guard.test.jsx:45-86`(bfcache 가드 4분기 + 언마운트 정리).
   비동기 훅은 `await waitFor(() => expect(result.current.authLoading).toBe(false))` 헬퍼로 정착시킨다.
8. **브라우저 이벤트는 합성해서 넣는다** — `pageshow.persisted`처럼 생성자가 노출하지 않는 속성은
   `Object.defineProperty(e, 'persisted', { value })` 후 `window.dispatchEvent(e)`
   (`back-to-login-guard.test.jsx:39-43`).
   ⚠️ 이건 **분기 검증**이고 실제 bfcache 복원 실측이 아니다(§7.4 ⑤).
9. **axios 인터셉터는 핸들러를 직접 꺼내 단언한다** —
   `api.interceptors.response.handlers[0].rejected({ response: { status: 401 } })`
   (`back-to-login-guard.test.jsx:120-131`). 401/비-401 양쪽을 함께 못박는다.
10. **관측점은 클래스 셀렉터 + 개수, 또는 role/testid**다 —
    `container.querySelectorAll('.guru-stat-row').length`, `screen.getByRole('link', { name })`,
    `screen.getByTestId('run-result')`(`Settings.test.jsx`). 비동기 진입은
    `await screen.findByText('TCK1')`. 텍스트가 지표마다 반복되면 `getByText`가 다중 매치로
    깨지므로 `getAllByText(...).length`를 쓴다. 아이콘 `<title>`이 라벨과 같은 텍스트를 낼 때는
    `{ selector: 'span' }`으로 좁힌다(`masthead.test.jsx:31-32` — **같은 표면의 새 프로브/테스트를
    짤 때 그 옆 주석부터 읽을 것**. 카테고리 링크를 `textContent` 완전일치로 잡았다가 sketches
    아이콘 `<title>`이 같은 라벨을 내는 함정에 빠진 프로브가 있었는데, 그 함정은 이 테스트가
    이미 경고해 뒀다).
11. **드리프트 방지용 공유 상수를 테스트가 직접 import한다** —
    `frontend/src/test/route-redirects.test.jsx:4`가 `frontend/src/routes.js`의 `REDIRECTS`를 읽고,
    `nav-active-matching.test.jsx`는 세 소비처를 실제로 렌더해 `navSections.js` 파생을 검증한다.
12. **에러 정직성 단언** — fetch reject 시 "불러오지 못했습니다"가 뜨고
    빈 상태 문구("크롤링을 먼저 실행")는 **뜨지 않는지**를 함께 단언한다
    (`GuruAllocation.test.jsx:201-217`). `.then().finally()`가 rejection을 잡지 않아
    `loading=false·data=null`이 되고 그 결과 *잘못된 행동 지시*가 떴던 버그의 회귀 가드다.
13. **경합·부분 실패도 케이스로 둔다** — 스코프를 빠르게 연속 클릭했을 때 늦게 도착한 이전 응답이
    최신 선택을 덮지 않는지, 전환 실패가 표시 중 데이터를 지우지 않는지
    (`GuruAllocation.test.jsx:230-282`).
14. **"하드코딩이면 통과할 단언"을 피한다** — 동적 수치는 응답 값을 바꿔가며 문구가 따라 바뀌는지
    본다(`GuruAllocation.test.jsx:304` *"하드코딩이면 값을 바꿔도 문구가 안 바뀐다"*).
15. `beforeEach(() => vi.clearAllMocks())`가 표준. 테스트 파일 안 `console.*` 호출은 0건이다.
16. **jsdom이 블라인드가 아닌 경우를 명시한다** — `nav-active-matching.test.jsx:23`
    *"jsdom은 여기서 블라인드가 아니다 — 레이아웃이 아니라 className 존재 여부를 본다"*.
    반대로 레이아웃·색을 보는 단언은 vitest에 두지 않는다(§9).

---

## §7 라이브 UAT 프로브 (Playwright)

### 7.1 표준 하니스
현재 기준형은 `scripts/uat254-analyst-upside-color.mjs`(짧고 규약을 다 갖춤)와
`scripts/uat247-guru-cohort.mjs`(커버리지·다축 판정)다.

- 대상은 **라이브 배포** `https://portfolion.taebro.com`.
- 인증: `POST /api/auth/login`으로 `test@portfolion.com` / `test1234` 토큰을 받아
  `page.evaluate`로 `localStorage`에 `access_token`·`refresh_token`(+`theme`)을 심고 재진입한다
  (95개 프로브가 이 계정을 쓴다). **테스트 계정은 비-admin**이다(§7.5).
- **API ground-truth를 프로브가 직접 fetch해 DOM과 대조**한다.
  응답 봉투는 추정하지 않고 1콜 찍어 확인한다 — `GET /api/analyst-reports`는
  `{reports: [{ticker, published_date, …}]}`이며 `uat254`는 그 사실을 주석에 남긴다(`:17`).
- 브라우저 안 측정기를 `page.evaluate`로 넘긴다 — `getBoundingClientRect()`·`scrollWidth`·
  `Range.getClientRects()`·`getComputedStyle()` 기반(§7.3).
- 결과는 `results`/`checks` 배열 + `P(ok, tag, msg)` 또는 `assert(view, name, got, want, id)`
  헬퍼에 모으고, 끝에서 PASS/FAIL 줄을 전부 출력한 뒤 커버리지 → `ALL PASS N/N`을 찍고
  `process.exit(failed.length ? 1 : 0)`.
- 두 뷰포트를 같은 루프로 돈다 — PC `{width:1440,height:900~1000}` / 모바일 `devices['iPhone 13']`
  (23개 프로브). 좁은 폭 전용 뷰(350px)를 추가하는 것도 관례다(`uat247`).
  **한 면을 고치는 변경은 반대 뷰포트도 캡처**한다.
- `page.on('pageerror')`로 콘솔 에러를 수집해 함께 보고한다.
- 안정화는 `page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0)
  .catch(() => {})` + `waitForTimeout` 조합.
- **백엔드 로그도 판정축이 된다** — `execSync("docker logs --since 30m portfolion-backend-1 | grep '\\[GuruStats\\]'")`
  로 신규 경고 0건을 단언한다(`uat247` 말미). CONVENTIONS §4.3의 마커가 이 grep 앵커다.
- 마지막에 `page.screenshot`으로 **육안 확인용 캡처**를 `screenshots-uat<NNN>/`에 남기고,
  기계 판독용 `result.json`도 함께 쓴다.

### 7.2 하니스 함정
- **Service Worker가 `/api/*`를 가로채므로 `page.route` 응답 인터셉트가 안 먹는다.**
  응답 주입 기반 UAT는 컨텍스트를 `serviceWorkers: 'block'`으로 만든다(**14개 프로브**가 이 옵션을 쓴다).
- **`route.fulfill`로 302를 반환하면 그 리다이렉트의 후속 요청은 인터셉트되지 않는다.**
  가짜 IdP 대조군에서 리다이렉트가 만든 요청이 라우팅을 타지 않아 DNS 실패로 끝났다.
  해법: 302 대신 **`location.replace`로 떠나는 HTML**을 fulfill한다(replace라 히스토리 엔트리를
  늘리지 않아 302와 의미가 같다) — `scripts/uat252-oauth-history.mjs:123-128` 주석.
  직접 `goto`와 스크립트 `location.replace`는 정상 인터셉트된다(대조 실험으로 확정).
- **크로스오리진 프로브는 "지금 어느 오리진의 저장소를 읽는가"가 판정과 독립이다.**
  `page.evaluate`의 storage 접근은 현재 문서 오리진에 묶이므로, 내비게이션 뒤에 로그를 읽으면
  착지한 IdP·센티넬 오리진의 sessionStorage를 읽는다(우리 오리진의 `history.go` 기록은 거기 없다).
  → **착지 직후 우리 오리진에서** 읽도록 옮긴다(`uat252-oauth-history.mjs:173` 주석).
- **recharts 커스텀 `label`은 `.recharts-pie-labels` 밖에 있고, recharts는 내용 없는
  `.recharts-pie-label-text` placeholder를 남긴다.** 그 셀렉터로 잡으면 실제 라벨 0개 + 빈 노드만
  걸려 헛수치가 나온다. 안전한 관용구는 **`.recharts-surface text` + 내용 있는 것만 필터**.
- 구루 목록 기본 정렬이 `종목수 ↑`라 `.guru-card` first에는 배지가 없다 →
  `filter({ has: span[title] })`로 고른다(`title` 속성이 셀렉터로 load-bearing).
- **성능 프로브는 회귀 게이트가 아니다.** 수치가 머신·부하·네트워크 의존이라 리터럴 임계값을
  봉인하면 다음 사람이 무관한 이유로 FAIL을 본다 — `scripts/uat255-guru-alloc-perf.mjs:3-5`가
  "CI에 걸지 말 것 · 임계값은 1회용 판정선"을 명시한다.

### 7.3 프로브 신뢰성 규칙 — `ALL PASS`가 "아무것도 안 본 것"과 구별되게
실패만 기록하는 프로브의 `ALL PASS`는 무의미하다. 누적된 규칙:

ⓐ **커버리지를 출력한다** — 계열별 검사 수 카운터.
  구현: `const cov = {}; const bump = (k, n=1) => cov[k] = (cov[k]||0)+n;` →
  말미에 `overflow:1372 · line-visible:1179 · mobile-row:38` 형태 + 합계·단언 수
  (`scripts/uat247-guru-cohort.mjs`, `scripts/uat-guru-row-ux.mjs`, `scripts/uat255-guru-alloc-perf.mjs`).
  (`ALL PASS — 단언 1건`을 찍은 사고가 있었다.)

ⓑ **조건부 단언을 쓰지 않는다 — `if (조건) assert(...)`는 그 자체가 무음 스킵 장치다.**
  값 렌더가 늦은 표본에서 그 단언이 집계에서 빠져 총계가 `40→39`로 줄고 FAIL이 났다.
  처방은 사후 비교가 아니라 **사전 차단**: 단언을 **무조건화**하고 미검출을 sentinel 기대값으로
  FAIL시켜 **총계를 구조적으로 고정**한다 —
  `const want = sign === 'up' ? up : sign === 'down' ? down : 'SIGN_MISSING'`
  (`scripts/uat254-analyst-upside-color.mjs`),
  `assertMs`의 `MEASURE_FAIL(...)` sentinel(`scripts/uat255-guru-alloc-perf.mjs:52-56`).
  + **id 명시 1회 재시도** 후에도 없으면 FAIL(`uat254`의 `sign 미검출 → 1회 재시도`).
  그리고 **총계가 재실행 간 조용히 줄면 통과가 아니라 측정 실패**다(활동 줄 `1179→1159` =
  매니저 1명분 드리프트가 무음 스킵의 유일한 단서였다).

ⓒ **판정 범위를 좁힌다** — `document.querySelectorAll('a[href="/guru"]')`처럼 문서 전체를 세면
  전역 내비·마스트헤드가 섞여 정상 구현이 거짓 FAIL한다. 범위를 `main.page-wrap` 본문으로 한정하고,
  FAIL이면 완화 전에 부모 체인을 덤프해 정체를 실측한다.

ⓓ **육안 확인은 거짓 *경보*도 낸다** — 되돌리기 전에 `elementFromPoint` 등으로 기각한다
  (둥근 모서리·투명 영역·`pointerEvents:none` 때문에 **bbox 교차 ≠ 클릭 차단**).
  형제 표면(`/reports`의 `.fab` 등)과 대조하면 신규 회귀와 기존 성질이 갈린다.
  캡처 전 `scrollIntoView` — 대상이 프레임 밖이면 육안 확인이 무의미하다.

ⓔ **0건을 대상 탓으로 귀속하기 전에 대조군으로 관측가능성을 증명한다.**
  대조군 없이는 "앱이 안 그런다"와 "프로브가 못 본다"가 **구별되지 않으며** 정반대 결론
  (가드 불필요 vs 검증 불가)으로 이어진다. 새 현상을 재는 프로브는 **그 현상이 반드시 일어나는
  대조군에서 먼저 1건 이상 관측**되는지 확인하고, 안 되면 그 프로브로 게이트를 세우지 않는다.
  부수: **대조군 자체의 대상도 검증**할 것(포트 보간이 깨져 엉뚱한 오리진을 재고도 그럴듯한
  결론이 나왔다) — 대조 페이지의 고유 마커를 단언한다.
  **대조군은 새로 짓기 전에 앱의 폴백 경로를 볼 것** — 기준값 하나를 지우면 '도입 전 동작'이
  재현돼 판별력 실증이 공짜가 된다(`uat252`: 되감기 arm=센티넬 착지 / 대조군=IdP 착지).
  **처방만 무효화하는 대조군**도 가능하다 — `page.addStyleTag`로 `content-visibility: visible
  !important`를 주입하고 `CONTROL=1` 플래그로 분기해 **같은 실행·같은 프로브·같은 부하**에서
  before를 얻는다(`scripts/uat255-guru-alloc-perf.mjs:37-40,187-190`).
  그 대조군이 원래 baseline을 재현하는지(596 vs 588/582)로 대조군 자체를 검증한다.

ⓕ **`OR`로 묶은 단언은 *어느 항으로* 통과했는지 출력한다.** `has-content`를
  `차트텍스트>0 || 행/노드>0`으로 묶으면 약한 항 하나로 통과하므로, PASS 메시지에 각 항의
  실측치를 싣지 않으면 그 단언이 무엇을 봤는지 알 수 없다.

ⓖ **메커니즘이 발동하지 않아도 *목표*는 게이트되게 판정을 2축으로 쪼갠다.**
  ① **목표 단언**("뒤로가기 후 로그인 화면이 안 보인다")은 메커니즘 발동 여부와 무관하게 항상 검사
  ② **메커니즘이 실제로 참여했는지**(`persisted && isTrusted`, `history.go` 호출 수·delta)는
  **커버리지로 별도 보고**. 라벨링과 게이팅을 같은 축에 두지 않는다
  (`scripts/uat252-oauth-history.mjs:205,218`, `scripts/uat253-oauth-error-session.mjs:140-147`).
  합성 이벤트를 쓸 때는 **계측기가 자기 자극을 세지 않도록 `isTrusted`로 배제**한다 —
  안 하면 "실제 복원 후에도 PASS"라는 **없는 증거**가 만들어진다.

ⓗ **출력은 넓게, 단언은 목표에만.** 완료기준이 지목한 대상만 찍지 말고 *같은 계열 전체*를
  before/after로 출력한다 — 피어 멀티플 프로브가 4지표(`per`·`pbr`·`psr`·`ev_ebitda`) 칩을 모두
  찍은 덕에 계획에 없던 `psr` 칩 이동(정상 결과)의 설명 근거가 남았다.
  계열 전체 출력은 단언을 늘리지 않으므로 정당한 변화에 거짓 실패하지 않는다.
  대리지표(heap·문서높이·DOM 노드·프레임 간격)는 **출력만** 하고 단언에서 뺀다
  (`scripts/uat255-guru-alloc-perf.mjs:28-29`).

ⓘ **판정 축이 대상과 독립이면 *틀린 대상 위에서도* ALL PASS한다 — "대상이 맞는가"를 별도 축으로
  단언한다.** nav 복구를 검증하는데 발행일 필드명을 추정해 URL이 `/undefined`가 됐고
  **404 페이지에서 nav 단언 6건이 전부 PASS**했다(nav는 콘텐츠와 독립이라 404 위에서도 정상 렌더).
  실천: ① URL을 구성하는 필드가 없으면 **즉시 exit**(추정 폴백 금지) ② 대상 페이지의 **고유 마커**
  (종목명·티커·발행일)를 함께 단언 ③ 응답 봉투·필드명은 1콜 찍어 확인.
  구현 예 `scripts/uat254-analyst-upside-color.mjs` — 「대상 유효성」 3단언을 판정축보다 **먼저**
  두고, 대상 부재 시 `process.exit(1)`하며, **이빨 단언**
  (`--up`/`--down`/`--text`가 서로 다름 → `new Set([...]).size === 3`)까지 붙인다.

ⓙ **하나의 측정치는 대개 여러 비용의 *합*이다 — 형제 축의 PASS를 내부 성분의 알리바이로 쓰지 않는다.**
  「스코프 전환 588ms」를 마운트·diff(JS)로 통째 귀속했는데, CDP `Performance.getMetrics` 누적
  차분(`ScriptDuration`·`RecalcStyleDuration`·`LayoutDuration`)으로 쪼개니
  **Script 109ms vs RecalcStyle 120 + Layout 155**로 지배 비용이 초기 레이아웃이었다.
  형제 축「스크롤 중 longtask」는 *이미 마운트된* 행의 재페인트만 재므로 그 비용에 원리적으로
  블라인드였다. **합산 축에 처방을 붙이기 전에 그 축 내부를 별도 계측기로 분해**한다
  (`scripts/uat255-guru-alloc-perf.mjs:191-204`).

ⓚ **before/after는 *같은 자*로 재야 한다 — 고정 *시간* 측정은 대상이 바뀌면 작업량이 달라진다.**
  "3초 스크롤"이 처방 전엔 32,545px를 ~81프레임에 주파하고 239프레임을 바닥에서 공회전했는데
  처방 후엔 3초 내내 실제로 스크롤해서, `longtask 78→117ms`가 회귀인지 작업량 증가인지 구별되지
  않았다. 축을 **"한 번 끝까지"**(scrollY가 3프레임 연속 안 늘면 종료)로 바꾸고
  `elapsed`·`hitBottom`을 출력에 실어 조건을 드러낸다(`uat255:122,152-153,284`).

**기준 상자도 추정하지 않는다.** 비교 상대(토스트·탭바·헤더·부모 content box)의 좌표도
`getBoundingClientRect()`로 얻거나 실제 스타일을 재현해 측정한다(토스트 영역을 "중앙 ±130px"로
가정해 거짓 FAIL을 낸 사례 — 실측하니 교차 0이었다). 부모 content box는
`right − paddingRight − borderRightWidth`로 직접 계산한다(`scripts/uat-guru-row-ux.mjs:95`).

**판정 단언은 리터럴이 아니라 불변식으로 쓴다** — `cols === 3`이 아니라
`cols === (chips <= 3 ? chips : 2)`(`scripts/uat225-polish.mjs`),
`pbr == 84.11`이 아니라 "밴드 밖인가"(`scripts/probe248-peer-multiples.py:5-6`),
`delta === 3`이 아니라 "back 착지가 센티넬인가"(`uat252`).
`auto-fill` 다열에서 "값 right가 행마다 동일"은 정상 구현도 FAIL이므로 **열 그룹(row.left)으로
묶어** 잰다.

**CJK를 라틴 문자폭으로 재지 않는다.** 문자폭 추정은 한글 전각(~10px)을 14% 과소평가한다 —
런타임 실측(숨은 0×0 SVG `<text>` + `getComputedTextLength()`)으로 대체하되,
**jsdom엔 그 API가 없으니 추정 폴백을 반드시 남긴다**(`frontend/src/pages/GuruDetail.jsx`;
폴백을 지우면 기존 단위테스트가 통째 깨진다).

### 7.4 API/구성 감사 프로브 + 도구 한계
- `scripts/audit_unauth_endpoints.py` — `test_no_public_reads.py`와 동형 로직의 스크립트판.
  종료코드 0/1. **처음에 평탄 `app.routes`를 순회해 컨테이너에서 `전체 0 / 무인증 0`을 내며 거짓
  통과처럼 보였고**, 그래서 `_walk`(`:61-73`)를 갖게 됐다.
  → **"라이브 게이트"를 자칭하는 스크립트는 배포 환경에서도 돌려 *숫자가 실제로 나오는지*
  확인해야 완성**이다(0/빈 결과를 성공으로 읽는 게이트는 게이트가 아니다).
- **컨테이너 안 라이브 프로브**는 `docker exec -i portfolion-backend-1 python - < probe.py` 형태로
  돌린다("다른 지표는 다 나오는데 하나만 빔" 같은 외부데이터 증상은 코드 버그로 단정하기 전에
  히스토리 행수·fetch 성공 여부를 이렇게 먼저 가른다).
  **in-container 자체 호출**은 게이팅된 엔드포인트 검증 수단이기도 하다 — 컨테이너가 자기 env의
  `COWORK_API_KEY`를 읽어 `127.0.0.1:8000`을 때리면 **시크릿이 세션에 노출되지 않는다**.
  프로덕션 흔적을 남기지 않으려면 **무쓰기 게이트**와 짝짓는다(검증 순서가 `pydantic → 핸들러`라
  스냅샷 없는 티커로 POST하면 422/409로 갈리고 어느 쪽도 DB에 쓰지 않는다). 검증 후 대상 테이블
  count로 무쓰기를 실제로 단언한다.
- **로컬 `.venv` 파이썬 프로브**는 서비스 함수를 직접 import해 외부 소스 실값을 대조한다
  (`scripts/probe248-peer-multiples.py` — prod 컨테이너·DB 무접촉·읽기전용,
  `from services import report_generator as rg` + `_PEER_MULTIPLE_BAND` 직독).
  fixture는 로직만 고정하고 "외부 소스가 *실제로* 어떤 숫자를 주는지"는 이 축이 본다(§9-6).
- **Playwright로는 bfcache를 검증할 수 없다 — chromium·webkit·firefox 전부**(대조군으로 확정).
  세 엔진 모두 의도적으로 적격인 대조 페이지에서조차 `pageshow.persisted`가 true가 되지 않는다.
  chromium은 CDP로 물어보면 **`BackForwardCacheDisabledForDelegate`**(자동화 델리게이트가 끔) +
  `BrowsingInstanceNotSwapped`를 답한다 → `--disable-back-forward-cache`를 `ignoreDefaultArgs`로
  빼도 뚫리지 않고, `--enable-features=BackForwardCache` 추가도 무의미하다.
  → **bfcache 완료기준을 라이브 프로브로 잡지 않는다.** 대안 셋: ⓐ 합성 `pageshow`로 가드 분기를
  검증하고 *복원 실측이 아님*을 라벨로 명시 ⓑ 단위테스트로 분기 고정
  (`frontend/src/test/back-to-login-guard.test.jsx`) ⓒ 실기기 수동 확인.
  `scripts/uat252-oauth-history.mjs:220`이 이 한계를 프로브 출력에 직접 적어둔다.

### 7.5 admin 전용 표면은 라이브 UAT가 원리적으로 불가
UAT 계정이 비-admin이라 admin 화면·`require_admin` 엔드포인트는 Playwright로 열 수 없다
(4회 반복해 계획을 되돌린 이력). 착수 전에 넷 중 하나를 고르고 DoD에 적는다:
① 게이트를 `require_admin_or_api_key`로 열어 **API 키로 positive 검증**(Cowork-facing 쓰기
컨벤션과 맞을 때만 — `require_admin`은 API 키를 **거부**하므로 게이트를 실제로 바꿔야 하고
self-app 테스트엔 그 의존성별 override를 따로 넣어야 한다)
② vitest + 기능경로 API로 닫고 **버튼 렌더는 사용자 화면 확인으로 이월**(`run.md`에 남긴다)
③ admin 크레덴셜을 사용자에게서 받는다
④ **in-container 자체 호출**(§7.4) — 무쓰기 게이트와 짝지어 검증.

---

## §8 검증 계층의 역할 분담

| 확인 대상 | 게이트 |
|---|---|
| 함수·분기 로직, SQL 구조, 응답 shape, 입력 검증 | pytest (query mock) |
| 컴포넌트 렌더·상태 전이·에러 정직성·훅 분기·className 존재 | vitest (jsdom) |
| 레이아웃 수치·겹침·정렬 | 라이브 Playwright (`getBoundingClientRect`) |
| 잘림(ellipsis) | 라이브 (`scrollWidth > clientWidth`) |
| 접힘(flex 압축) | 라이브 (`Range.getClientRects().length`) |
| 요소 *간* 거리(그룹핑 의미) | 라이브 (쌍의 `left − right` 단언) |
| 색 의미·미적용 스타일 | 라이브 (`getComputedStyle().color` vs `:root` 토큰 실측) |
| "보기에 깨졌는가"(축이 아직 없는 것) | **스크린샷 육안 확인 1장** — 잡으면 즉시 축으로 승격 |
| 렌더 비용 내부 성분 | CDP `Performance.getMetrics` 누적 차분 + `CONTROL=1` 대조군 |
| 라이브 SQL 타입·외부소스 실데이터 파싱·박제 값 | 배포 후 엔드포인트 라이브 스모크 / 컨테이너 프로브 / 로컬 `.venv` 데이터 프로브 |
| 인증 게이팅·문서 존재·배치 id·print/today 규약 | 규약 가드 테스트 (§5) |
| 배치 스킵 vs 갱신 구분 | 배치 로그 grep(`docker logs \| grep '[Marker]'`) + admin 응답 표시 |

---

## §9 테스트 스위트가 **원리적으로** 못 보는 것

각 항목에 "무엇이 보완하는가"를 함께 적는다.

1. **recharts는 jsdom에서 렌더되지 않는다.** `ResponsiveContainer`가 0크기라 축·틱·마커·막대·
   조각이 전혀 나오지 않으므로 `"2026(E)"` 같은 **틱 텍스트 단언은 구조적으로 불가능**하다.
   코드베이스가 이 사실을 테스트 주석으로 남겨뒀다 —
   `frontend/src/pages/AnalystReport.test.jsx:59`, `frontend/src/pages/GuruDetail.test.jsx:204,238`.
   → vitest에서는 범례 텍스트·캡션·데이터 유무 분기·표 부재만 단언하고,
   **겹침·위치·색 대조는 라이브 프로브**가 게이트다.
   부수: 데이터가 비어 차트가 아예 안 그려지는 표본에서 조기 return하면 그 표본의 KPI 단언까지
   사라지므로, 프로브는 공통 측정치를 먼저 모으고 분기한다.
2. **jsdom은 레이아웃을 계산하지 않는다.** 2줄→1줄 여부, 좌우 배치·폭(CSS 미디어쿼리),
   `position: fixed` 좌표가 전부 블라인드다(`frontend/src/pages/GuruDetail.test.jsx:87,267,285`가
   그 한계를 주석으로 명시하고 "라이브 실측이 게이트"라고 적어둔다).
   `getComputedTextLength`도 jsdom에 없으므로 **문자폭 실측 코드에는 추정 폴백을 반드시 남긴다**.
   → 라이브 `getBoundingClientRect()` 프로브.
3. **색 의미·미적용 스타일은 vitest·빌드 모두 블라인드**다. jsdom은 스타일시트를 적용하지 않고,
   vitest는 클래스명을 단언하니 **수정 전에도 통과**하며(그래서 red-first가 vitest에선 원리적으로
   불가), 빌드는 미사용 CSS 클래스를 모른다. 두 실사례: ① 공용 배지 variant의 의미색 교체가
   가격 배지를 서구식으로 **반전**시킨 회귀 ② `ui/Stat`가 `'up'`을 받는데 CSS엔 `--success`만 있어
   상승여력이 **항상 무채색**이던 결함. → **소비처 전수 grep + 라이브
   `getComputedStyle().color`**(`scripts/uat254-analyst-upside-color.mjs`) + 스팟 시각 재캡처.
4. **`text-overflow: ellipsis`·`line-clamp` 잘림은 `overflow` 검사에 원리적으로 안 잡힌다** —
   박스를 넘는 게 아니라 박스 안에서 내용을 지우기 때문이다(프로브 26단언 ALL PASS인데 PC
   메타줄이 상위50 중 38행에서 수치를 통째로 잃은 사례).
   → **`scrollWidth > clientWidth`(세로면 `scrollHeight > clientHeight`)를 별도 축으로** 잰다
   (`scripts/uat247-guru-cohort.mjs:136-141`, `scripts/uat241-guru-allocation.mjs:45-48`의
   `numClipped` — 주석 `:45`가 "ellipsis는 박스를 넘지 않으므로 overflow 검사에 안 잡힌다"를 적어둔다).
   구현 쪽 짝: 줄어도 되는 것만 ellipsis 상자에 넣고, 줄면 안 되는 수치는 `flex-shrink: 0`
   형제 span으로 고정한다.
5. **flex 압축으로 인한 "넘치지 않는 줄바꿈"도 안 잡힌다** — 폭이 모자라면 flex는 자식을 압축하고
   텍스트는 여러 줄로 접히므로 박스는 컨테이너 안에 머문다(120단언 ALL PASS인데 350px에서
   버튼 4개가 전부 `10/명`·`전/체`로 접혔다). `right`가 부모와 *정확히* 일치하면 "딱 맞았다"가
   아니라 "압축됐다"는 신호다.
   → **텍스트 노드에 `Range`를 걸어 `range.getClientRects().length === 1`**
   (`scripts/uat247-guru-cohort.mjs:107-115`).
6. **요소 *간* 거리는 위 3축 어디에도 안 잡힌다** — 축 1·4·5는 전부 "단일 요소가 *자기* 상자 안에
   있는가"를 묻는다. 111단언 ALL PASS·커버리지 1773인데 육안이 2건을 잡았다(칩이 캡션과
   1,000px 넘게 떨어져 한 그룹으로 안 읽힘 / 값과 액션이 12px로 붙어 한 덩어리로 읽힘).
   → 쌍의 거리를 단언한다(`scripts/uat-guru-row-ux.mjs:254-256`
   `칩.left − 캡션.right ≤ 24px`). 원인은 대개 `margin-left:auto`·`space-between`처럼
   "남는 공간"에 의존하는 정렬이다(CONVENTIONS §9.7 축4).
7. **query-mock SQL 테스트는 라이브 SQL 타입/문법 오류를 못 잡는다.** pytest green 상태의
   배포-즉사 버그 2종이 실제로 났다 — uuid 컬럼에 `= ANY(%s)`로 str 리스트(→`uuid = text`),
   `VALUES`를 바깥 괄호로 감싸 record 1행화. → **신규/단건→배치 개작 SQL은 배포 후
   해당 엔드포인트 라이브 스모크를 DoD에 포함**(형태만 고정하는 가드는
   `test_consensus_asof_batch.py::test_values_placeholder_shape`).
8. **외부소스 파싱은 fixture로 통과하고 실데이터에서 실패한다**(fixture-pass-live-fail).
   yfinance `get_income_stmt()`(무공백 라벨) vs `.income_stmt`(공백 라벨) 불일치는 예외 없이
   조용히 None을 반환하고, DART `account_id` 매칭·`fs_div` 요청/응답 규칙, Naver row 구조,
   yfinance 퍼센트 필드의 *소수분수* 스케일도 같은 부류다. mock은 응답을 그대로 돌려주므로
   라벨 불일치·스케일 트랩을 못 본다.
   → **라이브 1종목 추출 대조를 DoD에 넣는다**(`scripts/probe248-peer-multiples.py`가 그 형태).
   프로브도 fetch 200만 보지 말고 **응답 봉투 파싱**까지 확인해야 완성이다(KIS 선물
   `output` vs `output1/2/3`을 잘못 읽고 "코드/파라미터 오류"로 오진한 사례).
9. **문서 산문 drift는 자동 검출되지 않는다.** `test_api_doc_sync.py`는 method+path *존재*만
   본다 → 요청/응답 스키마, `**Auth:**` 표기, README 절은 수동 DoD다(CONVENTIONS §10).
10. **환경 발산이 결과를 뒤집는다.** 로컬 `.venv` 3.9.6 / FastAPI 0.128.8 vs 배포 3.12 /
    FastAPI 0.138+, `lxml` 로컬 부재. 라우트 열거는 `walk_routes`로 흡수했지만(§5.4),
    **패키지 유무·버전차는 계속 새 발산을 만든다** — 라이브 게이트 스크립트는 배포 환경에서도 돌린다.
11. **`allow_inf_nan=False`처럼 "수정 전에도 통과하는" 단언은 red-first가 불가능하다.**
    → 가드를 일시 제거해 실제 실패를 확인하고 원복하는 **이빨 검증**(§4.6), 또는 프론트라면
    빌드 전에 라이브 프로브를 돌려 red를 확보한다(§1).
12. **프론트 이벤트명·탭 파생·라우트 순서·`_migrate` 쌍에는 자동 가드가 없다**
    (CONVENTIONS §11 하단 목록). 특히 `trackEvent` 이름을 단언하는 테스트가 없어서
    겸직 필드에서 파생을 잘못 고르면 **요청은 성공하고 이벤트만 백엔드 화이트리스트에서 탈락**한다
    (CONVENTIONS §1.5).
13. **CI가 없으므로 "테스트를 돌렸다"가 구조적으로 보장되지 않는다**(§1). 배포는 push 즉시
    일어나고 테스트는 그 경로에 없다.
14. **완료기준 자체가 축을 빠뜨릴 수 있다.** 프로브 ALL PASS 30건인데 화면이 깨져 있던 사례의
    원인은 ⓐ 라벨 **중심** 반지름만 재 접선 방향 넘침이 판정에 없었고 ⓑ 문자폭을 라틴 기준으로
    추정한 것이었다. 실천: 완료기준을 쓸 때 **"이 단언이 통과하면서도 깨질 수 있는 방식"을 한 줄
    적어보고**, 박스가 곡면/사선 영역 안인지 볼 때는 **중심이 아니라 네 모서리**를 재고,
    **대리지표(열 수·컨테이너 넘침)가 아니라 목표 자체(카드 높이·필 행이 정상으로 보이는 것)**를
    기준으로 쓴다. 그리고 **시각 변경은 프로브 PASS 후에도 스크린샷 1장 육안 확인**을 완료기준에
    넣는다 — **육안이 프로브를 이긴 4회는 전부 시각·레이아웃을 *바꾸는* 변경**이었고,
    백엔드 가드만 바꾼 변경에서는 프로브와 육안이 일치했다.
15. **적대적 리뷰 0건은 게이트가 아니다.** 6렌즈·effort high로 0건을 받은 변경에서
    "슬라이스 범위 임의 축소(계획 미준수)"를 리뷰가 놓치고 메인 세션의 표적 검증이 잡았다.
    CSS 이전·토큰 제거·범위 축소가 섞인 변경이면 리뷰와 **별개로** 표적 검증을 돌린다.
    축소 여부는 슬라이스 문구가 아니라 **DoD의 *목적*으로 판정**한다.
16. **폴백 경로만 UAT하고 실데이터 경로를 이월하면 두 경로의 필드 집합 차이가 결함을 숨긴다**
    (폴백 `top10`엔 한글명이 있고 실경로 `holdings`엔 없어 "범례는 한글·목록은 영문"으로 회귀).
    이월할 땐 두 경로의 소스 필드 차이를 미리 대조한다.

---

## §10 실행 시 주의사항

- **전체 스위트 실행 후 `git status`로 부수효과를 확인**한다(§3). 추적 파일이 modified로 뜨면
  그 write 경로를 찾아 `tmp_path`로 격리하거나 read-only로 격하한다.
- 메인 체크아웃에서는 2분 폴러가 `LOCAL != origin/main`이면 `git reset --hard origin/main`을
  돌린다 — **커밋 안 한 tracked 편집과 push 안 한 로컬 커밋이 소실**된다.
  테스트/문서 변경도 `commit && git push origin main`을 묶어 즉시 반영한다.
  `.forge/`·`screenshots-*` 등 untracked는 reset 대상이 아니라 안전하다.
  ⚠️ 단, 커밋 소실을 `git log -1`로 판정하지 말 것 — 폴이 끼면 잠깐 되돌아 보였다가 자기복구된다.
  판정은 `git rev-parse HEAD` vs `origin/main` + `gh run list`로 한다.
- **프론트 라이브 프로브는 `npm run build` 이후에 돌린다**(§1). 순서를 뒤집으면 옛 번들을 잰다.
- 배포 직후 백엔드는 `Up`이고 로그도 활발한데 API가 수 분간 무응답일 수 있다 — 라이브 스모크는
  포트 바인딩을 폴링한 뒤 실행한다
  (`docker exec <c> python -c "import socket;print(socket.socket().connect_ex(('127.0.0.1',8000)))"`가
  `0`이 될 때까지).
- `pytest`는 실 DB에 닿지 않지만(§3) **라이브 배포 API를 때리는 프로브는 실데이터를 바꿀 수 있다** —
  프로브는 read + 자기 계정 토글 수준으로 유지하고, admin 쓰기는 §7.5의 경로를 쓴다.
- 성능 프로브(`scripts/uat255-guru-alloc-perf.mjs`)는 회귀 게이트가 아니다 — CI/DoD에 임계값을
  봉인하지 말고 "이번에 착수할지"를 가르는 1회용 계산 도구로만 쓴다.

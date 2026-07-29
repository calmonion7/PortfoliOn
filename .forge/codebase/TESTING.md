---
last_mapped_commit: 4bb49ff0402c150884f2fa9c80dfed8dff1945d5
mapped: 2026-07-29
---

# TESTING — PortfoliOn 테스트 지형

**구현된 사실**만 기록한다(용어 정의는 `CONTEXT.md`, 부채·버그 목록은 `CONCERNS.md` 영역).
규약 자체는 `CONVENTIONS.md`, 여기는 "무엇으로 어떻게 검증하고, 무엇을 못 잡는가".

---

## 1. 프레임워크와 실행 커맨드

| 레이어 | 스택 | 실행 |
|--------|------|------|
| 백엔드 | pytest (설정 `backend/pytest.ini`: `testpaths = tests`, `pythonpath = .`) | `cd backend && .venv/bin/python -m pytest` |
| 프론트 | vitest 4 + `@testing-library/react` 16 + `@testing-library/jest-dom` + jsdom 29 | `cd frontend && npm test` (= `vitest run`) |
| 프론트 lint | eslint 10 flat config (`frontend/eslint.config.js`: js recommended + react-hooks + react-refresh) | `cd frontend && npm run lint` |
| 빌드 게이트 | Vite 8(rolldown) | `cd frontend && npm run build` |
| 라이브 UAT | Playwright(`scripts/package.json`, `scripts/node_modules`) | `node scripts/uat240-guru-activity.mjs` |
| 백엔드 라이브 프로브 | 로컬 `.venv`로 실서비스 모듈 직접 호출 | `backend/.venv/bin/python scripts/probe239-guru-activity.py` |

- vitest 설정은 별도 파일이 아니라 `frontend/vite.config.js`의 `test` 블록: `environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.js'`(내용은 `import '@testing-library/jest-dom'` 한 줄).
- 백엔드 로컬 인터프리터는 **Python 3.9.6**(`backend/.venv`), 프로덕션 컨테이너는 3.12. `lxml`은 컨테이너에만 있으므로 테스트가 타는 코드의 HTML 파싱은 `BeautifulSoup(html, "html.parser")`.
- 파이썬 린터/포매터·커버리지 도구·CI 테스트 잡은 연결돼 있지 않다(배포 워크플로우는 `deploy.yml`만). 게이트는 사람이 돌리는 위 커맨드다.
- 규모(현재): 백엔드 테스트 파일 125개·`def test_*` 약 1,334개 / 프론트 테스트 파일 24개·케이스 약 199개.

---

## 2. 파일 구조와 네이밍

### 2.1 백엔드 (`backend/tests/`)
- 평평한 단일 디렉터리, `test_<대상>.py`. 대상 축이 섞여 있다:
  - 라우터 계약 — `test_stocks_router.py`, `test_watchlist_router.py`, `test_report_router.py`, `test_batches_router.py`
  - 서비스 로직 — `test_dividends.py`, `test_guru_scraper.py`, `test_indicators.py`, `test_storage.py`
  - 배치·스케줄러 — `test_scheduler_seed.py`, `test_batch_market_split.py`, `test_batch_resilience.py`, `test_job_runs_instrumentation.py`
  - 외부소스 어댑터 — `test_kiwoom_quote.py`, `test_kis_futures.py`, `test_market_kr.py`, `test_financials_kr_cashflow.py`
  - 버그별 회귀 슬라이스 — `test_report_price_gate.py`, `test_kr_quote_degenerate_reuse.py`, `test_rankings_empty_guard.py`, `test_cache_live_prices_invalidation.py`
  - 메타 가드(§5) — `test_no_print.py`, `test_no_bare_today.py`, `test_api_doc_sync.py`, `test_no_public_reads.py`
- 공유 자산: `backend/tests/conftest.py`(fixture·autouse 가드), `backend/tests/_routes.py`(라우트 트리 평탄화 헬퍼), `backend/tests/fixtures/`(현재 `backlog/` 실공시 HTML).
- 테스트 함수명은 영문 서술형 `test_<대상>_<조건>_<기대>`(`test_enrich_single_stock_returns_404_when_not_found`), 모듈 docstring·주석은 한국어 + `task#NNN`/ADR 인용.
- 픽스처 데이터는 모듈 상단 상수(`SAMPLE_PORTFOLIO`)로 두는 관례.

### 2.2 프론트 (`frontend/src/`)
- 단위·컴포넌트 테스트는 **co-located**: `src/hooks/usePortfolioData.test.js`, `src/components/reports/Sections.test.jsx`, `src/pages/AnalystReport.test.jsx`, `src/utils/guruName.test.js`.
- 페이지를 가로지르는 시나리오는 `src/test/<슬라이스>.test.jsx`: `route-redirects`, `masthead`, `compare-race`, `compare-sector-group`, `recommendations-s3s4`, `global-search-tracked`, `reports-deep-link-navkey`, `smoke`.
- `describe`는 한국어 서술 + 슬라이스 표기(`// S1 — #39: ...`) 관례.

---

## 3. 백엔드 모킹 관례

### 3.1 실 DB 차단 (autouse, 필수 전제)
`backend/tests/conftest.py`에 autouse fixture 2개가 있다.
- `_block_real_db` — `services.db._get_pool`을 raise로 monkeypatch. 로컬 `DATABASE_URL`이 도커(=라이브) postgres를 가리키므로, 이 가드가 없으면 end-to-end 테스트가 **프로덕션 테이블에 커밋**한다. 가드가 `RuntimeError("tests must not touch the real DB — mock services.db.query/execute")`를 던지면 **가드를 풀지 말고 mock을 추가**한다.
- `_clear_quote_cache` — 매 테스트 전 `services.cache.invalidate_quote()`(TTL 캐시 교차 오염 방지).

DB를 타는 테스트는 **소비 지점의 이름을 patch**한다(정의 모듈이 아니라, 그 모듈이 import한 이름):
`patch("services.consensus.query")`, `patch("routers.report.query")`, `patch("routers.stocks.query")`, `patch("services.digest_service.execute")`, `patch("services.storage.portfolio.query")`, `patch("routers.calendar.execute")`. 63개 파일이 이 방식으로 DB를 가린다.

### 3.2 앱/클라이언트 두 갈래
- **conftest `client` fixture** — `main.app` + `app.dependency_overrides[get_current_user] = lambda: "test-user-id"`(import 시점에 전역 설정). `main.app` 전체 배선이 필요한 테스트용.
- **자체-app 패턴(다수)** — 테스트 모듈 상단에서 라우터만 실어 독립 app을 만든다:
  ```python
  app = FastAPI(); app.include_router(router)
  app.dependency_overrides[get_current_user] = lambda: "test-user-id"
  app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
  app.dependency_overrides[require_admin_or_api_key] = lambda: "test-user-id"
  client = TestClient(app)
  ```
  (`backend/tests/test_stocks_router.py:1-15`. `dependency_overrides`를 쓰는 테스트 파일 30+개.)
  conftest override는 `main.app` 한정이라 여기엔 안 걸린다 → 엔드포인트에 auth 의존성을 추가/변경하면 그 경로를 호출하는 자체-app의 override를 보강해야 한다. **단 선제적으로 전수 추가하지 말고, 의존성을 붙인 뒤 스위트를 돌려 실제로 깨지는 것만 고친다**(형제 read가 이미 등록해 둔 경우가 많다).
- **무인증 거부 검증** — override 없는 fresh app으로 실제 auth 의존성을 태운다: `backend/tests/test_security_auth_gaps.py`의 `_client(*routers)` 헬퍼.

### 3.3 외부 소스·시퀀스
- `unittest.mock.patch`(문자열 타깃) / `patch.object` / `MagicMock`. 자주 쓰는 타깃: `services.market.kr._naver_get`, `services.kiwoom.client.configured`, `services.kiwoom.client.request`, `services.digest_service.get_quotes_batch`, `routers.*.storage.*`, `auth.auth_service.get_user_by_id`.
- yfinance는 pandas DataFrame을 반환하는 가짜 Ticker 클래스로 대체(`test_nan_serialization_guards.py:_ConstTicker` — 제로분산 종가로 NaN corr 유발).
- **호출 시퀀스 단언은 `call_args_list[i].kwargs` + `call_count`** — 마지막 호출만 보는 `call_args`는 엔드포인트에 read를 additive로 추가하면 조용히 오염된다(`test_recommendation_endpoint.py`, `test_market_kr.py` 등 10+파일이 `call_args_list` 사용).
- `importlib.reload(module)` 패턴(`test_market.py` 다수)은 **모듈이 자기 자신에 정의한 심볼의 patch를 무효화**한다 → 하위 모듈 속성(`services.db.execute`, `services.market.kr._naver_get`)을 patch할 것.
- 모듈에서 심볼(import·함수)을 제거/개명하면 `grep -rn "<모듈경로>.<심볼>" backend/tests/`로 patch 타깃을 전수 확인(주 테스트 파일이 아닌 곳에서 patch하고 있다).
- 라우트를 열거하는 테스트/스크립트는 반드시 `backend/tests/_routes.py:walk_routes()`를 경유한다 — FastAPI 0.138+는 `include_router` 라우트를 `_IncludedRouter`로 감싸 `.routes`/`.path`를 노출하지 않으므로 평탄 순회가 **0개를 세며 조용히 통과**한다(로컬 `.venv`는 평탄, `requirements.txt`가 `fastapi>=0.104.0` 무핀이라 발산 지속).

---

## 4. 프론트 모킹 관례

- **axios 인스턴스를 모듈째 모킹**한 뒤 URL 스위치:
  ```js
  vi.mock('../api', () => ({ default: { get: vi.fn(), delete: vi.fn() } }))
  api.get.mockImplementation((url) => url === '/api/portfolio' ? Promise.resolve({...}) : ...)
  ```
  (`src/hooks/usePortfolioData.test.js`. `vi.mock('../api')`가 13곳.)
- 그 밖의 모킹 타깃: `../components/Toast`(4), `../hooks/useIsMobile`(3), `react-router-dom`(2), `../contexts/AuthContext`(2), `../hooks/usePortfolioData`·`useReportList`·`useStockManagement`, `../utils/analytics`.
- 훅은 `renderHook` + `waitFor`(+ 필요 시 `act`), 컴포넌트는 `render` + `screen.*`. `beforeEach(() => vi.clearAllMocks())`가 관례.
- 라우팅이 필요한 렌더는 `MemoryRouter`로 감싼다(`src/test/masthead.test.jsx`는 `ToastProvider > MemoryRouter` 중첩 헬퍼).
- 같은 라벨이 지표당 1회씩 반복되는 차트 대체 UI는 `getAllByText(...).length`로 단언(`src/pages/AnalystReport.test.jsx:56` `length).toBe(5)` — `getByText`는 다중 매치로 깨진다).

---

## 5. 규약을 강제하는 메타 테스트

| 파일 | 무엇을 못박는가 |
|------|-----------------|
| `backend/tests/test_no_print.py` | 앱 코드(`main.py`·`routers`·`services`·`scheduler`·`middleware`)의 `print()` 호출 0건 — ast 파싱(문자열/주석 오탐 없음) |
| `backend/tests/test_no_bare_today.py` | bare `.today()` 호출 0건 → `services.utils.today_kst()` 강제 (ast) |
| `backend/tests/test_api_doc_sync.py` | 라이브 라우트 ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md`의 `### \`METHOD /path\`` 헤더. 양방향(미문서화 = `KNOWN_UNDOCUMENTED`(현재 빈 집합) exact-match, stale 문서화 0) |
| `backend/tests/test_no_public_reads.py` | 무인증 `/api` 엔드포인트 == `ALLOWED_PUBLIC` 9개(auth.py 로그인·OAuth)로 **양방향 exact-match**. 함수 시그니처 `Depends` + 라우트 `dependencies=[]` 둘 다 검사(ADR-0029) |
| `backend/tests/test_security_auth_gaps.py` | 엔드포인트별 401/403(override 없는 fresh app) + refresh 토큰 1회용 |
| `backend/tests/test_batches_router.py` (`EXPECTED_IDS`, `len(data) == 29`)<br>`test_batch_market_split.py`·`test_macro_signals_batch.py` (`len(batch_registry.BATCHES) == 29`)<br>`test_scheduler_seed.py` | 배치 id 집합·개수·시장 분류. **배치를 추가/은퇴하면 이 4파일을 함께 갱신**해야 스위트가 통과한다 |
| `backend/tests/test_nan_serialization_guards.py` | 응답 payload가 `json.dumps(..., allow_nan=False)`로 직렬화 가능(= starlette 500 없음) |
| `backend/tests/test_db_execute_many.py`, `test_consensus_backfill_atomic.py`, `test_rec_store_atomic.py` | 배치 SQL 형태(`VALUES` placeholder), delete+insert 원자성 |
| `backend/tests/test_rankings_empty_guard.py`, `test_us_supply_empty_guard.py`, `test_public_api_empty_items.py`, `test_fx_partial_failure.py` | "빈/all-None 결과를 캐시에 박제 금지" + 부분 실패 시 직전값 유지 |
| `backend/tests/test_ticker_validation.py` | 티커 형식 검증 게이트 |

`scripts/audit_unauth_endpoints.py`는 같은 ADR-0029 게이트를 스크립트로도 제공한다(종료코드 0/1, `sys.path`에 `backend` 삽입, 재귀 `_walk`).

---

## 6. 커버리지 성격

- 커버리지 측정 도구·임계값 게이트가 없다. 실질 커버는 세 군데에 몰려 있다:
  1. **라우터 계약** — 상태코드·응답 형태·인증 게이팅(storage/query를 mock한 상태).
  2. **서비스 분기** — 폴백·가드·빈 결과 처리(외부 fetch를 mock).
  3. **회귀 고정** — 버그마다 슬라이스 테스트 파일 1개를 남기는 관례(파일명이 증상/게이트를 서술).
- 외부 IO(yfinance·키움·KIS·DART·Naver·FRED·DB)는 **전부 모킹**이라, 스위트가 검증하는 것은 "우리 코드의 분기"이고 실데이터 정합은 아니다 → fixture green ≠ 라이브 동작(§7).
- 스위트는 실 DB에 닿지 않으므로 안전하지만, **전체 실행 후 `git status`로 추적 파일 부수효과를 확인**하는 습관이 관례로 남아 있다.

---

## 7. 테스트가 구조적으로 못 잡는 표면

pytest/vitest로는 원리적으로 검증 불가한 영역 — 여기는 라이브 프로브(§8)나 육안 확인이 게이트다.

1. **jsdom에서 recharts가 렌더되지 않는다** — `ResponsiveContainer`가 0크기라 축·틱·막대·파이 조각·라벨이 전혀 생성되지 않는다. 그래서 `"2026(E)"` 같은 **틱 텍스트 단언은 불가능**. vitest에서는 범례 텍스트·캡션·데이터 유무 분기·표 부재만 단언한다.
2. **색의 *의미*** — 공용 배지 variant(`badge--success`/`--danger` vs `--up`/`--down`)를 교체해도 vitest·빌드는 통과한다. 가격 방향과 의미 상태의 교차 사용은 시각 확인만 잡는다.
3. **레이아웃 수치** — 가용폭, 그리드 열 수, 카드 높이, 라벨 줄바꿈, 요소 겹침. jsdom엔 레이아웃 엔진이 없다. `minmax`/열 수/폭 임계값을 정하는 변경은 `getBoundingClientRect()` 실측이 근거여야 한다.
4. **외부소스 실데이터 파싱** — 응답을 모킹하면 라벨/봉투 불일치가 안 잡힌다: yfinance `get_income_stmt()` 메서드(무공백 `OperatingCashFlow`) vs `.cash_flow` 프로퍼티(공백 `Operating Cash Flow`), DART `fnlttSinglAcntAll`의 `fs_div` 요청·`account_id` 매칭, KIS 선물옵션의 `output1/2/3` 분할 봉투, Naver 행 구조. → 외부소스 파싱 슬라이스는 **라이브 1종목 추출 대조**를 DoD에.
5. **신규/개작 SQL** — query mock은 uuid 캐스트 누락(`= ANY(%s)` → `uuid = text`)·`VALUES` 괄호 형태 오류를 그대로 통과시킨다. → 배포 후 해당 엔드포인트 라이브 스모크.
6. **환경 발산** — 로컬 `.venv`(3.9.6, lxml 없음, FastAPI 구버전) vs 컨테이너(3.12, lxml 있음, FastAPI 0.138+ `_IncludedRouter`). 로컬 green이 컨테이너 동작을 보증하지 않고, 반대로 라우트 열거 스크립트는 컨테이너에서 0을 세며 "통과"할 수 있다(**0/빈 결과를 성공으로 읽는 게이트는 게이트가 아니다**).
7. **admin 전용 표면** — 라이브 UAT 계정 `test@portfolion.com`은 비admin이라 admin 화면·`require_admin` 엔드포인트를 Playwright로 열 수 없다. 계획 단계에서 셋 중 하나를 고르고 DoD에 적는다: ① 게이트를 `require_admin_or_api_key`로 열어 API 키 검증(`require_admin`은 API 키를 거부) ② vitest + 기능경로 API로 닫고 버튼 렌더는 사용자 화면 확인으로 이월 ③ admin 크레덴셜 수령.
8. **프론트 `console.*` 규약** — 자동 가드 없음(eslint 미연결).
9. **문서 산문** — doc-sync 테스트는 엔드포인트 *존재*만 본다. 요청/응답 스키마와 `**Auth:**` 표기의 drift는 잡히지 않는다.

---

## 8. 라이브 프로브 관례 (`scripts/`)

`scripts/`에는 106개 엔트리(대부분 UAT 프로브)가 누적돼 있다. 이것이 §7 표면의 유일한 게이트다.

### 8.1 명명·산출물
- Playwright: `scripts/uat<태스크#>-<주제>.mjs`(`uat237-guru-donut.mjs`, `uat240-guru-activity.mjs`). 스모크는 `scripts/smoke<태스크#>-auth.mjs`.
- 백엔드 라이브: `scripts/probe<태스크#>-<주제>.py`(로컬 `.venv`로 서비스 모듈 직접 호출, prod 컨테이너·DB 무접촉).
- 스크린샷은 리포지토리 루트 `screenshots-uat<번호>/`(gitignore 대상 아님 — untracked로 쌓여 있다).
- 상단 주석/docstring에 **무엇을 왜 재는지 + 인용하는 회고 번호**를 적는 것이 관례.

### 8.2 표준 골격 (`scripts/uat240-guru-activity.mjs`)
1. `const BASE = 'https://portfolion.taebro.com'` — 라이브를 본다.
2. `fetch(`${BASE}/api/auth/login`)`으로 테스트 계정(`test@portfolion.com`, 비admin — 자격증명은 기존 프로브 스크립트에 있다) 토큰을 받고, 기대값 계산용 API도 같은 토큰으로 호출.
3. `seed(page)` — 루트로 이동 후 `page.evaluate`에서 `localStorage`에 `access_token`/`refresh_token`/`theme` 주입.
4. `settle(page)` — `.skeleton-block`이 0이 될 때까지 `waitForFunction` + 고정 대기.
5. `chromium.launch()` + PC 컨텍스트와 `devices['iPhone 14 Pro']` 컨텍스트 **양쪽**을 돈다.
6. `page.evaluate(readRows)` 안에서 `getBoundingClientRect()`로 실측(넘침·폭·높이·반지름·각도).
7. `results` 배열에 `pass(tag,msg)`/`fail(tag,msg)` 누적 + `checks` 카운터로 **검사 건수를 명시**(실패만 세면 "단언 1건 ALL PASS"가 아무것도 안 본 것과 구별되지 않는다).
8. 육안 확인용 스크린샷 저장 → `console.log('ALL PASS/FAIL — 단언 N건, 실패 M건')` → `process.exit(fails.length ? 1 : 0)`.

### 8.3 판정 규칙 (회고 누적, 위반 시 거짓 PASS/FAIL)
- **리터럴이 아니라 불변식을 단언**한다(`cols === 3` ✗ / `cols === (chips <= 3 ? chips : 2)` ○) — 정상 데이터 변화에 거짓 실패하지 않도록.
- **비교 대상(기준 상자)도 실측**한다 — 토스트·탭바·헤더의 좌표를 가정하면 정상 구현을 FAIL로 되돌린다. 실제 스타일을 재현한 노드를 심어 재거나 `getBoundingClientRect()`로 얻는다.
- 박스가 곡면/사선 영역 안인지 볼 때는 **중심이 아니라 네 모서리**를 잰다.
- **CJK 문자폭을 라틴 상수로 추정하지 않는다** — 숨은 SVG `<text>`(0×0·`aria-hidden`)에 문자열을 넣고 `getComputedTextLength()`로 마운트당 1회 실측·캐시. 단 **jsdom엔 그 API가 없으니 프로덕션 코드에 추정 폴백을 남긴다**(안 남기면 단위테스트가 통째로 깨진다).
- 표본이 렌더되지 않아도 **조기 return 금지** — 공통 측정치를 먼저 모은 뒤 분기하고, 스킵은 로그로 남긴다(무음 스킵 금지).
- **프로브 PASS 후에도 스크린샷 1장 육안 확인**을 완료기준에 넣는다(프로브 축이 모자라면 ALL PASS가 무의미하다).
- recharts 커스텀 `label`은 `.recharts-pie-labels`/`.recharts-pie-label-text`로 안 잡힌다(빈 placeholder만 걸린다) → **`.recharts-surface text` + 내용 있는 노드 필터**.
- 차트 크기/열 수를 바꾸면 라벨 수·밀도가 함께 변하므로 **baseline 대비 증가도 원인을 확인**하고, 반대 뷰포트(PC↔모바일)를 같이 캡처한다.
- 셀렉터는 `data-testid` 우선(프로브가 재는 요소에만 부여, 현재 8종·4파일).
- 라우트를 열거하는 감사 스크립트는 **배포 환경에서도 돌려 숫자가 실제로 나오는지** 확인한다(`walk_routes`/`_walk` 재귀 하강).

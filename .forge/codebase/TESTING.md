---
last_mapped_commit: a4994f84832f6215ac127c5ef0a645861ab2f857
mapped: 2026-07-28
---

# TESTING

PortfoliOn 테스트 실행·구조·모킹 관용구·가드 테스트·블라인드 스팟·UAT 규약. **구현 사실만** 다룬다.

---

## 1. 백엔드 — pytest

| 항목 | 값 |
|---|---|
| 실행 | `cd backend && .venv/bin/python -m pytest` |
| 설정 | `backend/pytest.ini` — `testpaths = tests`, `pythonpath = .` (별도 pyproject/tox 없음) |
| 위치 | `backend/tests/` — **128개** `test_*.py`, 테스트 함수 **약 1317개**(거의 전부 모듈 레벨 `def test_`; `class Test...` 그룹화는 `test_public_api_empty_items.py` 1파일만) |
| fixture 데이터 | `backend/tests/fixtures/` |
| 공유 설정 | `backend/tests/conftest.py` + `backend/tests/_routes.py`(라우트 순회 헬퍼) |
| 런타임 | 로컬 `.venv` = Python 3.9.6 → `CONVENTIONS.md` §1 어노테이션 제약이 사실상 여기서 강제된다 |

로컬 pytest 통과가 배포 게이트다. count/set 하드코딩 단언이 여러 파일에 흩어져 있어(§5) 배치 id 추가/삭제 시 전 파일 전수 grep이 필요하다.

## 2. conftest — autouse 가드 2종

`backend/tests/conftest.py`(38줄 전부):

1. `sys.path.insert(0, backend/)` — `main`·`auth`·`services` 절대 import 가능하게.
2. **모듈 로드 시 전역 override**: `app.dependency_overrides[get_current_user] = lambda: "test-user-id"` (대상은 `main.app` **한정**).
3. `client` fixture — `TestClient(main.app)`.
4. `_clear_quote_cache`(autouse) — 매 테스트 전 `cache.invalidate_quote()`로 `get_quote` 종목 단위 TTL 캐시를 비워 교차 오염 방지.
5. **`_block_real_db`(autouse, task#169)** — `monkeypatch.setattr(services.db, "_get_pool", ...)`로 `_get_pool`이 `RuntimeError("tests must not touch the real DB — mock services.db.query/execute")`를 던지게 한다.

### `_block_real_db`가 뜻하는 것

- 로컬 `DATABASE_URL`이 도커 postgres(=**라이브** DB, 5432 노출)를 가리킨다. 가드 전엔 `generate_report` end-to-end 테스트의 스냅샷 INSERT가 prod `snapshots`에 그대로 커밋됐고(fixture price로 실 스냅샷 클로버), admin 삭제 테스트가 prod `calendar_cache`를 전체 DELETE했다.
- 오염이 **선택적**이라 격리된 것처럼 보였다 — 가짜 티커(`TEST`)는 FK로 실패해 무해해 *보이고* 실존 티커만 오염된다(fixture-pass-live-fail의 **역방향**: fixture-writes-live).
- **DB를 타는 테스트는 반드시 `services.db`의 `query`/`execute`(또는 그 상위 서비스 심볼)를 mock한다.** 가드가 raise하면 그 테스트가 실 DB에 닿고 있다는 뜻 — **가드를 풀지 말고 mock을 추가**한다.
- 라이브 값이 지나치게 라운드(정확히 70000.0 등)로 보이면 외부 피드 글리치보다 **테스트 오염을 먼저 의심**한다(ADR-0020 amendment).
- **이 가드는 DB write만 막는다 — 추적 대상 정적 파일 write는 별도 경로다(현재는 해소됨).** `services/market_indicators/earnings.py`의 티커 7일 캐시가 한때 `backend/data/sp500_tickers.json`/`kospi_tickers.json`을 캐시로 겸용해, `_block_real_db`가 DB를 막으면 `_mc_load`가 None→캐시 미스→라이브 스크레이프→그 추적 파일에 write하는 부수효과가 있었다(전체 스위트 실행 후 `git status`에 modified로 떴다). task#234에서 캐시를 `market_cache`로 옮겨 이 write 경로는 없어졌지만, **일반 원칙은 남는다**: 전체 스위트 실행 후 `git status`로 의도치 않은 파일 변경이 없는지 확인하는 습관을 들일 것 — DB write를 막는 가드가 파일 write까지 보장하지는 않는다.

## 3. self-app 패턴 — 라우터별 격리 앱

**37개 테스트 파일**이 conftest의 `client`가 아니라 모듈 상단에서 앱을 직접 만든다:

```python
app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_current_user] = lambda: "test-user-id"
client = TestClient(app)
```

- **conftest는 `main.app`의 `get_current_user`만 override**하므로 self-app 테스트엔 **안 걸린다**.
- 게이트가 여럿인 라우터는 게이트별로 override를 다 깐다 — `backend/tests/test_analyst_reports.py:16-23`:

```python
app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"   # 조회
app.dependency_overrides[require_admin_or_api_key]   = lambda: "test-admin-id"   # 발행
app.dependency_overrides[require_admin]              = lambda: "test-admin-id"   # 삭제
```

- **엔드포인트에 auth `Depends`를 추가/변경하면 그 경로를 호출하는 self-app 테스트를 전수 grep해 새 의존성 override를 추가**해야 한다(안 하면 401/403으로 조용히 깨짐). 후보 파일: `grep -rln "app = FastAPI()" backend/tests/`. **단 선제적으로 다 고치지 말 것** — 의존성을 붙인 뒤 전체 스위트를 먼저 돌리고 실제로 깨지는 파일만 고친다. ADR-0029 3부작(task#230·231·232)에서 계획이 지목한 감사 대상은 4·5·14파일이었지만 실제 변경은 3·0·0파일이었다 — 형제 read가 먼저 인증돼 있으면 그 테스트 앱이 이미 override를 등록해 둔 경우가 많다.
- 예외: `main.app`의 커스텀 예외 핸들러까지 태워야 하는 케이스는 self-app이 아니라 `main.app`을 쓰고 override를 try/finally로 넣고 뺀다(`test_analyst_reports.py` — 422 detail의 NaN echo 직렬화 500 방지 검증).

### 3.1 무인증 401 / 비admin 403 검증

둘 다 **override 없는 fresh app**으로 실제 의존성을 태운다. 두 갈래가 있다:

| 케이스 | 패턴 | 참조 |
|---|---|---|
| 무인증 401(개별 시나리오, HTTP 라운드트립 필요) | `FastAPI()` + `include_router` 만, override 0, `TestClient`로 실제 호출 | `backend/tests/test_security_auth_gaps.py`(`_client(*routers)` 헬퍼) |
| 무인증 401(전체 `/api` 회귀 게이트, ADR-0029) | `TestClient` 없이 **라우트 메타데이터만 검사** — 핸들러를 실행하지 않아 DB에 닿지 않는다 | `backend/tests/test_no_public_reads.py` |
| 비admin 403 | 하위 게이트만 override(`get_current_user`/`get_current_user_or_api_key`)한 뒤 `patch("auth.auth_service.get_user_by_id", return_value={"role": "user"})`로 role 검사를 실제로 태움 | `test_analyst_reports.py`, `test_report_router.py` |
| 게이트가 부수효과 앞에서 막는지 | 403 단언 + `mock_exec.assert_not_called()` | `test_analyst_reports.py` |

## 4. 모킹 관용구

- 라이브러리: `unittest.mock`의 `patch`/`patch.object`/`MagicMock` + pytest `monkeypatch`.
- **import site 기준 patch** — 서비스가 import한 심볼을 patch한다: `patch("services.storage.portfolio.query", return_value=[...])`, `patch.object(svc, "latest_snapshot", return_value=(...))`, `monkeypatch.setattr(svc.yf, "Ticker", ...)`, `monkeypatch.setattr(db, "query", fake_query)`.
- **SQL 형태 단언**: `mock_exec.call_args.args`에서 `(sql, params)`를 꺼내 substring/끝맺음을 단언한다. 쿼리 mock 상태에서 SQL 의도를 못박는 유일한 수단이다 — `test_analyst_reports.py`:

```python
sql = mock_q.call_args.args[0]
assert "DISTINCT ON (ticker)" in sql
assert "ORDER BY ticker, published_date DESC" in sql
assert sql.rstrip().endswith("ORDER BY published_date DESC, ticker")
# 이력 소비처는 반대 방향으로 단언
assert "DISTINCT ON" not in mock_q.call_args.args[0]
# upsert / delete
assert "ON CONFLICT (ticker, published_date) DO UPDATE" in sql
assert params == ("TST",)
```

- **additive read/외부호출 추가는 `mock.call_args`(마지막 호출) 단언을 조용히 오염시킨다** — additive는 호출 시퀀스도 늘린다. 대응: ① 기존 단언을 호출별 `mock.call_args_list[i].kwargs`로 마이그레이션(`test_recommendation_endpoint.py`·`test_market_kr.py`·`test_storage.py`·`test_batch_resilience.py` 등 다수 파일이 이미 이 형태), ② 신규 호출은 `if <조건>:`로 입력이 비면 생략해 기존 테스트 보존, ③ 신규 테스트가 `mock.call_count`로 시퀀스를 못박음.
- **심볼을 제거/개명하면 그 심볼을 patch하는 테스트를 파일 불문 전수 grep**: `grep -rn "모듈경로.심볼" backend/tests/`. mock 타깃은 "주 테스트 파일"에만 있지 않다(`digest_service`의 `yf` import 제거 시 `test_disclosure_endpoint_digest.py`가 `services.digest_service.yf.Ticker`를 patch하고 있어 `ModuleNotFoundError`로 파손한 전례).
- **`importlib.reload` 패턴 주의**(`test_report_generator.py`·`test_report_price_gate.py`·`test_market.py`) — reload는 모듈 자체 정의 심볼 patch를 무효화한다. **하위 모듈 속성**(`services.db.execute`·`_naver_get` 등)을 patch할 것.
- **라이브 파라미터화**(`@pytest.mark.parametrize`)로 다수 경로를 한 번에 검증하는 스타일이 흔하다(`test_security_auth_gaps.py`의 `_READ_GATES_230/231/232` 리스트 → 401 일괄 단언).

## 5. 주요 가드 테스트

| 파일 | 무엇을 못박는가 |
|---|---|
| `backend/tests/_routes.py` | (가드 자체가 아니라 공유 헬퍼) `walk_routes(routes)` — `routes`·`original_router`를 재귀 하강해 `.path`를 가진 라우트만 yield. 로컬 `.venv`(0.128.x)는 `app.routes`에 라우트가 평탄하게 들어오지만 배포 이미지(FastAPI 0.138+)는 `include_router`로 들어온 라우트를 `_IncludedRouter`로 감싸 `.path`/`.routes`를 노출하지 않고 `original_router`만 준다 — 평탄 순회는 배포 이미지에서 **라우트 0개를 세며 조용히 통과**한다(감사 스크립트가 실제로 이렇게 거짓 통과했던 전례, task#232). `test_api_doc_sync.py`·`test_no_public_reads.py`가 공유 사용 |
| `backend/tests/test_api_doc_sync.py` | 라이브 `main.app.routes`(`walk_routes` 경유) ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md`의 ``### `METHOD /path``` 헤더 대조. `test_api_spec_documents_all_live_endpoints`(라이브 − API_SPEC == `KNOWN_UNDOCUMENTED`, 현재 `frozenset()` → 새 엔드포인트 미문서화면 즉시 실패), `test_api_spec_has_no_stale_endpoints`, `test_cowork_api_has_no_stale_endpoints`. path param은 `{}`로 정규화. **존재만 검증** — 스키마/인증 게이팅은 수동 DoD |
| `backend/tests/test_no_public_reads.py` | ADR-0029 회귀 게이트(task#233) — `/api/*` 라우트를 `walk_routes`로 순회해 **핸들러를 실행하지 않고** 함수 시그니처의 `Depends(...)` 기본값 + 라우트 레벨 `dependencies=[...]`를 검사, `AUTH_DEPS`(`get_current_user`·`get_current_user_or_api_key`·`require_admin`·`require_admin_or_api_key`) 중 하나가 없으면 무인증으로 분류. `test_no_unauthenticated_endpoints_beyond_allowlist`(무인증 − `ALLOWED_PUBLIC` == ∅, 새 무인증 즉시 실패) + `test_allowlist_has_no_stale_entries`(반대 방향, 인증이 걸렸거나 사라진 허용목록 항목 정리 유도) — `test_no_public_reads.py`의 `ALLOWED_PUBLIC` = `test_api_doc_sync.py`의 `KNOWN_UNDOCUMENTED`와 동형인 exact-match 양방향 정책. `ALLOWED_PUBLIC`은 현재 `auth.py`의 로그인/OAuth 9개뿐(ADR-0029 개정 없이 추가 금지). 별도 `test_route_walk_is_not_silently_empty`가 `/api` 라우트 100개 초과를 단언해 위 `_IncludedRouter` 함정으로 순회가 깨지면(0개로 거짓 통과) 즉시 드러나게 한다 |
| `backend/tests/test_security_auth_gaps.py` | 개별 시나리오형 401/403(HTTP 라운드트립 필요한 것들) — 무인증 mutation 엔드포인트 401(`_client` 헬퍼) + `_READ_GATES_230/231/232` 파라미터화 리스트로 구루·랭킹·수급·공매도·시장지표·리포트 read 다수를 401 일괄 검증 + `X-API-Key` positive/negative(`test_report_detail_accepts_api_key_232`) + refresh token 1회용 회전 |
| `backend/tests/test_no_print.py` | 앱 코드(`main.py`·`routers`·`services`·`scheduler`·`middleware`)의 `print()` 호출 = 0 (ast 기반) |
| `backend/tests/test_no_bare_today.py` | 앱 코드의 bare `.today()` 호출 = 0 → `services.utils.today_kst()` 강제 (ast 기반) |
| `test_batches_router.py` / `test_batch_market_split.py` / `test_macro_signals_batch.py` | `BATCHES` **개수 29**와 `EXPECTED_IDS` 전체 집합 — 배치 id 추가/삭제 시 3파일 전부 깨진다. 한 파일만 고치면 나머지가 배포 전 스위트에서 실패 |
| `backend/tests/test_nan_serialization_guards.py` | NaN/inf가 응답에 섞여 starlette `allow_nan=False` 500을 내지 않음(`json.dumps(result, allow_nan=False)` 직접 단언) |
| `backend/tests/test_rankings_empty_guard.py` | 빈 외부 응답이 캐시를 wipe하지 않음(`RuntimeError` 전파 단언) |
| `backend/tests/test_public_api_empty_items.py` | 공공데이터포털 `{"items": ""}` 빈응답 → `AttributeError` 대신 `[]` |
| `test_consensus_asof_batch.py` `test_values_placeholder_shape` | 배치 `VALUES` 플레이스홀더가 record 1행이 아니라 N행 형태인지 |

## 6. 프론트 — Vitest

| 항목 | 값 |
|---|---|
| 실행 | `cd frontend && npm run test` (`"test": "vitest run"`) |
| 설정 | 별도 파일 없음 — `frontend/vite.config.js`의 `test` 블록(`environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.js'`) → Vite alias/플러그인 재사용 |
| setup | `frontend/src/test/setup.js` = `import '@testing-library/jest-dom'` 한 줄 |
| 라이브러리 | `@testing-library/react` + `@testing-library/jest-dom`, `vitest` |
| lint | `npm run lint`(eslint 10, flat config `eslint.config.js` — `js.configs.recommended` + `eslint-plugin-react-hooks`(flat recommended) + `eslint-plugin-react-refresh`(vite 프리셋), `globalIgnores(['dist'])`). Prettier 등 별도 포매터 없음. 테스트와 별개 스위트이며 `console.*` 규약은 미연결 |
| 규모 | **22개** 테스트 파일, `it()` 블록 약 **146개** |
| 위치 | 소스 콜로케이트(`*.test.js`/`*.test.jsx`) + `frontend/src/test/`(통합/스모크) |

파일 분포(주요):

- 페이지: `src/pages/AnalystReports.test.jsx`(6), `src/pages/AnalystReport.test.jsx`(17), `src/pages/GuruManagers.test.jsx`(9), `src/pages/GuruDetail.test.jsx`(5), `src/pages/GuruStats.test.jsx`(3)
- 훅: `src/hooks/useStockManagement.test.js`(21), `useReportFilters.test.js`(17), `usePortfolioData.test.js`(5)
- 컴포넌트: `src/components/reports/reportUtils.test.js`(12), `KeyResourceChart.test.js`(6), `Sections.test.jsx`(3), `MarketOutlookSection.test.jsx`(3), `src/components/PermissionPanel.test.jsx`(1)
- 도메인 유틸: `src/glossary/match.test.js`(12)
- 통합/스모크(`src/test/`): `recommendations-s3s4.test.jsx`(15), `route-redirects.test.jsx`(4), `masthead.test.jsx`(3), `compare-race.test.jsx`(2), `compare-sector-group.test.jsx`·`global-search-tracked.test.jsx`·`reports-deep-link-navkey.test.jsx`·`smoke.test.js`(각 1)

### 6.1 프론트 관용구

- **api 싱글톤 모듈 mock**: `vi.mock('../api', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }))` → `api.get.mockImplementation((url) => url === '/api/...' ? ... : ...)`로 경로 분기.
- **컨텍스트/토스트 mock**: `vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ role: mockRole }) }))` + 모듈 스코프 `let mockRole`로 admin/user 분기(권한 게이팅 테스트).
- 라우팅: `MemoryRouter`(+ `initialEntries` / `Routes`+`Route`로 path param 주입).
- 호출 단언: `await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/admin/analyst-targets/035420', { enabled: false }))`.
- `window.confirm`은 `vi.spyOn(window, 'confirm').mockReturnValue(true|false)` + `mockRestore()` — 확인/취소 양쪽 단언.
- 권한 음성 단언: `expect(screen.queryByTitle('발행물 삭제 (이력 포함)')).toBeNull()`, "비admin은 그 엔드포인트 자체를 안 부름"까지 단언(`expect(api.get.mock.calls.every(([u]) => u === '/api/analyst-reports')).toBe(true)`).
- **jsdom은 0크기 컨테이너라 recharts 축/틱/막대가 렌더되지 않는다**(`ResponsiveContainer`가 0×0) → `"2026(E)"` 같은 틱 텍스트 단언은 구조적으로 불가능. 차트 컴포넌트는 두 방향으로 우회한다: ① 차트에서 순수 헬퍼 함수(그룹핑·데이터 변환 등)를 뽑아 그 함수만 단위테스트(`KeyResourceChart.test.js`가 `groupMetricsByUnit`/`splitMetricsForRender`/`buildChartData`를 직접 import), ② 범례·캡션 텍스트나 행 개수로 우회(`AnalystReport.test.jsx`: `getAllByText('SK하이닉스').length === 5`(지표당 1행), `container.querySelector('table') === null`(표→차트 교체 확인)). 라벨 겹침·정렬 같은 시각 속성은 vitest로 검증 불가 — §8 참조.
- `beforeEach(() => vi.clearAllMocks())`가 표준.

## 7. Playwright UAT 규약 (수동 라이브 검증)

vitest·pytest가 못 잡는 시각/라이브 회귀는 `scripts/` 아래 **일회용 UAT 스크립트**로 검증한다(테스트 스위트 아님 — 실행은 사람이 트리거, 결과물은 gitignored).

| 항목 | 규약 |
|---|---|
| 위치·명명 | `scripts/uat<번호>-<슬러그>.mjs`(초기 몇 개는 `.js`). 번호 = forge task 번호 |
| 의존성 | `scripts/package.json` — `playwright ^1.50.0`만 |
| 대상 | 라이브 `https://portfolion.taebro.com` (로컬 dev 아님) |
| 인증 | `POST /api/auth/login`으로 `test@portfolion.com` / `test1234` 토큰을 받아 `page.evaluate`로 `localStorage`에 `access_token`/`refresh_token` 주입 |
| 계정 한계 | 테스트 계정은 **비admin** — admin 전용 UI(대상 관리·토글·삭제 버튼 등)는 Playwright로 원리적으로 검증 불가. 계획 단계에서 대안을 미리 고를 것: ① 게이트를 `require_admin_or_api_key`로 열어 API 키로 positive 검증 ② vitest + 기능경로 API로 닫고 버튼 렌더는 이월 ③ admin 크레덴셜을 사용자에게서 받음 |
| 뷰포트 | 데스크톱(`1440×1000`) + 모바일(`devices['iPhone 13']`) 2회 실행 |
| 안정화 | `waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0)` + 고정 `waitForTimeout` |
| 콘솔 수집 | `page.on('console', m => m.type()==='error' && ...)` + `page.on('pageerror', ...)`를 결과에 동봉 |
| 산출물 | 스크린샷 `screenshots-uat<번호>/<label>-NN-<screen>.png`(리포 루트, untracked) + `console.log(JSON.stringify(results, null, 2))`로 구조화 판정 |

## 8. 알려진 블라인드 스팟 — 라이브 대조 DoD

단위 테스트(mock/fixture) 통과가 라이브 정합을 보장하지 않는 계열. 아래 슬라이스는 **배포 후 라이브 스모크/시각 캡처를 DoD에 포함**한다.

| 계열 | 왜 못 잡는가 | 필요한 검증 |
|---|---|---|
| **recharts 렌더**(축·틱·마커·바) | jsdom에서 `ResponsiveContainer`가 0크기라 차트가 전혀 렌더되지 않음 | 순수 헬퍼 단위테스트로 데이터 변환만 검증(§6.1) + 라이브 Playwright `getBoundingClientRect()` 교차 검사로 시각 속성 확인 |
| **신규/개작 SQL** (단건→배치 `ANY` 배열화, `VALUES` 조인, uuid 캐스트) | query-mock은 SQL 문자열만 보고 실행하지 않음 — `uuid = text` 연산자 부재나 record 형태 오류는 라이브에서만 터짐 | 배포 후 해당 엔드포인트 라이브 스모크. 최소한 SQL 형태 substring 단언(§4)으로 의도를 못박음 |
| **외부소스 파싱** (yfinance index 라벨, Naver row, DART `account_id`, KIS `output` vs `output1/2/3`) | fixture가 라벨/봉투 불일치를 재현하지 않음 → 예외 없이 조용히 None | 라이브 1종목 추출 대조. 프로브는 fetch 200뿐 아니라 **응답 봉투 파싱까지** 확인 |
| **tz 정렬** (키움 naive ↔ yfinance aware) | fixture가 라이브 지수를 모킹하지 않고 broad `except`가 삼킴 | 회귀 테스트가 실구조(tz·Decimal·테이블/컬럼)를 단언 |
| **프론트 % 스케일** (yfinance 소수분수 ×100) | 단위 테스트가 렌더 %를 단언하지 않음 | 필드별 스케일 확인 + API_SPEC 예시값/fixture도 분수 스케일로 |
| **배지 색 의미·시각 회귀·레이아웃 수치** | vitest·빌드 모두 **블라인드**(토큰 교체가 가격색을 반전시킨 차단급 회귀가 스위트를 통과함; jsdom은 레이아웃도 계산 안 함) | Playwright 스팟 재캡처(§7)가 유일한 포착 수단. 프로브의 비교 기준 상자(토스트·탭바 등)도 가정하지 말고 실제 스타일을 재현해 실측할 것 |
| **외부데이터 "하나만 빈" 증상** | 코드 버그로 오진하기 쉬움(히스토리 부족 vs fetch 실패) | 라이브 프로브 선행: `docker exec -i portfolion-backend-1 python -`로 행수·값 직접 확인 |
| **DB 저장 위치 혼동** (테이블 컬럼 vs 스냅샷 JSON) | 잘못된 저장소를 읽어도 fixture는 green, 라이브는 항상 False | 그 필드를 이미 읽는 기존 소비처를 grep으로 확정, 테스트가 실구조를 단언 |
| **admin 전용 화면** | 라이브 UAT 계정이 비admin이라 Playwright로 원리적으로 도달 불가 | §7 세 가지 대안 중 계획 단계에서 하나를 선택 |

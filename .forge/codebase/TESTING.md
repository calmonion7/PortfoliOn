---
last_mapped_commit: a5fb8bc8fbb92ec9155e7bc20ba681388786bfcd
mapped: 2026-07-07
---

# TESTING — 프레임워크·구조·모킹·커버리지

PortfoliOn 테스트 하니스의 실제 구현 사실. 무엇이 커버되고 무엇이 안 되는지, 그리고 반복되는 함정.

---

## 1. 백엔드 — pytest

- 러너: `cd backend && .venv/bin/python -m pytest` (macOS). Windows는 `.venv/Scripts/python`. 현재 **1165 passed**.
- 설정: `backend/pytest.ini` — `testpaths = tests`, `pythonpath = .`.
- 테스트 위치: `backend/tests/` — **111개 `test_*.py` 파일**. `backend/tests/__init__.py` 존재. 픽스처 데이터는 `backend/tests/fixtures/`(현재 `backlog/`).
- 공통 픽스처: `backend/tests/conftest.py` — `sys.path`에 `backend/` 삽입, `from main import app` 후 **`app.dependency_overrides[get_current_user] = lambda: "test-user-id"`**로 인증 우회, `client` 픽스처(`TestClient(app)`), autouse `_clear_quote_cache`(테스트 간 quote TTL 캐시 교차오염 방지 — `cache_svc.invalidate_quote()`).

### 1.1 두 가지 앱 패턴 — conftest `client` vs self-app

두 방식이 공존하며 인증 처리가 다르다:

- **conftest `client`**: `main.app`을 그대로 쓰고 `get_current_user`만 override. 통합에 가깝다.
- **self-app** (더 흔함 — `app = FastAPI()`를 모듈 상단에서 직접 만드는 파일이 **34개**): 라우터만 include하고 필요한 auth 의존성을 각자 override. 예 `backend/tests/test_stocks_router.py`:
  ```python
  app = FastAPI()
  app.include_router(router)
  app.dependency_overrides[get_current_user] = lambda: "test-user-id"
  app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
  app.dependency_overrides[require_admin_or_api_key] = lambda: "test-user-id"
  client = TestClient(app)
  ```
  `test_recommendation_endpoint.py`(+`require_admin` override), `test_consensus_router.py` 등 동일. `dependency_overrides`를 쓰는 파일은 **32개**.
- **함정 — auth `Depends` 추가 시 self-app 테스트가 401/403로 깨진다**: conftest는 `main.app`의 `get_current_user`만 override하므로 self-app 테스트엔 안 걸린다. 엔드포인트에 auth 의존성을 추가/변경하면 그 경로를 호출하는 **self-app 테스트를 전수 grep해 새 의존성 override 추가**.
- **무인증 거부(401/403)는 override 없는 fresh app으로 별도 검증**: `backend/tests/test_security_auth_gaps.py` — `_client(*routers)` 헬퍼가 override 없는 `FastAPI()`를 만들어 `.status_code == 401`을 단언.

### 1.2 모킹 관례 — 두 스타일 공존

두 모킹 방식이 함께 쓰인다:

- **`unittest.mock`의 `patch`/`MagicMock`** (69개 파일): 대상은 **모듈 경로 문자열**로. 예 `patch("routers.stocks.storage.enrich_stock", ...)`, `patch("services.market_indicators.sentiment.requests.get", return_value=...)`(`test_fear_greed.py`), `patch("services.scraper.yf.Ticker", return_value=mock_ticker)`(`test_scraper.py`). `MagicMock`으로 응답 스텁(`resp.json.return_value = payload`, `resp.raise_for_status.return_value = None`).
- **pytest `monkeypatch.setattr`** (43개 파일): service 심볼을 함수 단위로 갈아끼운다. 예 `test_beta.py` — `monkeypatch.setattr(svc.yf, "Ticker", lambda sym: _FakeYfTicker(...))`, `monkeypatch.setattr(svc, "query", lambda sql, params=None: [...])`, `monkeypatch.setattr(svc, "upsert_beta", lambda t, b, s: upserts.append(...))`. `@contextmanager`로 `job_runs.record`를 가짜로 갈아 `(job_id, trigger)` 기록을 단언(`test_beta.py:243`·`:261`).
- **순수 함수는 mock 불필요**: `test_exposure.py`는 mock 전무 — 리터럴 dict 입력만으로 `compute_exposure`의 전 분기(통화/섹터 그룹핑·집중도·경고 임계 경계값·베타 커버리지·Decimal 혼산)를 `pytest.approx`로 단언.
- **함정 — 심볼 제거/개명 시 patch 대상 전수 grep**: mock 타깃은 "그 기능 주 테스트 파일"에만 있지 않다. `services.digest_service.yf` import 제거 시 **다른 파일**(`test_disclosure_endpoint_digest.py`)이 `services.digest_service.yf.Ticker`를 patch하고 있어 `ModuleNotFoundError`로 파손(task#136). 심볼 제거/개명 시 `grep -rn "모듈경로.심볼" backend/tests/` 전수.

### 1.3 4-표면 배치 검증 패턴

신규 배치는 한 테스트 파일에서 4표면을 함께 단언한다(`test_beta.py`가 전형, `test_macro_signals_batch.py` 유사):

1. **수집 함수** — 시장별 분기·결측 skip·예외 continue. `fetch_all_betas`가 `{"total","ok","failed"}` 반환(결측은 `ok`, 예외만 `failed`); KR 없으면 `^KS11` fetch 스킵(불필요 라이브 호출 회피, `test_beta.py:192`).
2. **저장소** — upsert `ON CONFLICT (ticker) DO UPDATE` dedup + 조회 None graceful + `_migrate` DDL 발행(`test_migrate_creates_stock_beta`).
3. **레지스트리** — `batch_registry.get_batch("beta_fetch")`가 `market`·`category`·`editable`·`trigger_kinds`(`{auto,manual}`)·`manual_endpoint`·`scheduler_job_id`·`default_schedule`을 갖는지.
4. **배선** — `scheduler._JOB_FUNCS`에 등록, 자동 잡 본문이 `job_runs.record(id,"auto")`, 수동 엔드포인트 백그라운드 작업이 `record(id,"manual")` 기록.

### 1.4 additive-mock `call_args_list` 함정

- 엔드포인트에 read/외부호출을 additive로 *추가*하면 `mock.call_args`(마지막 호출)를 단언하던 기존 테스트가 조용히 오염(응답 shape뿐 아니라 *호출 시퀀스*도 늘어남).
- 대응 3종(실사례 `test_recommendation_endpoint.py`): ① 호출별 `call_args_list[i].kwargs`로 마이그레이션(인덱스로 해당 호출 명시), ② 신규 호출은 `if <조건>:`로 입력 비면 생략해 기존 테스트 보존, ③ 신규 테스트가 `call_count`로 시퀀스 못박음.
- `call_args_list`/`call_count`를 쓰는 파일: `test_recommendation_endpoint.py`, `test_recommendation_funnel.py`, `test_insider_digest_batch.py`, `test_market_kr.py`, `test_portfolio_router.py`, `test_watchlist_router.py`, `test_consensus_asof_batch.py`, `test_job_runs.py`, `test_batch_resilience.py`, `test_kr_quote_degenerate_reuse.py` 등. `test_scraper.py`도 `get_news_kr.assert_called_once_with("005930", 10)`로 디스패치 검증.

### 1.5 doc-sync 테스트 (`test_api_doc_sync.py`)

- 엔드포인트 *존재* drift 자동검출. `_live()`가 `main.app`의 `app.routes`를 ground-truth로(데코레이터 파싱 아님), `_doc_endpoints(filename)`가 두 문서의 `` ### `METHOD /path` `` 헤더를 파싱해 대조. `_norm`이 path param `{ticker}`→`{}`·쿼리·끝슬래시 정규화.
- **`KNOWN_UNDOCUMENTED` 베이스라인**: 현재 `frozenset()`(전수 문서화 완료). exact-match 단언이라 문서 없이 새 엔드포인트 추가 시 집합이 커져 즉시 실패. 문서화하면 여기서 빠져야 통과(self-maintaining).
- 3 테스트: `test_api_spec_documents_all_live_endpoints`, `test_api_spec_has_no_stale_endpoints`, `test_cowork_api_has_no_stale_endpoints`.
- **한계**: 존재(method+path)만 검증. 요청/응답 스키마·인증 게이팅 prose는 파싱 안 함 → 수동 DoD.

### 1.6 exact-count / exact-set 배치 단언이 여러 파일에 흩어짐

`batch_registry.BATCHES` id를 추가하면 하드코딩 count/set 단언이 여러 파일에서 동시에 깨진다. 한 파일만 고치면 나머지가 스위트에서 깨진다(task#136). **현재 값은 28**:
- `backend/tests/test_batch_market_split.py:53` — `assert len(batch_registry.BATCHES) == 28`(+ `_MARKET_BY_ID` 시장 분류 매핑, + `test_old_split_ids_absent` 옛 id 부재 단언).
- `backend/tests/test_macro_signals_batch.py:37` — `assert len(batch_registry.BATCHES) == 28`.
- `backend/tests/test_batches_router.py` — `EXPECTED_IDS` 집합 + `:45` `assert len(data) == 28` + `:46` `assert {b["id"] for b in data} == EXPECTED_IDS`.
- `backend/tests/test_scheduler_seed.py` — 기동 시드 마이그레이션 단언(editable id 필터 등).
- 전수 grep: `grep -rn "BATCHES) ==\|len(data) ==\|EXPECTED_IDS" backend/tests/`.
- 옛 id를 단언하던 테스트는 깨진 동작을 고정하므로 id 은퇴 시 함께 grep 대상.

### 1.7 query-mock 테스트가 라이브 결함을 못 잡음 (fixture-pass-live-fail 가족)

pytest green(query/응답 mock)이면서 배포-즉사인 결함 클래스. 라이브에서만 드러난다:

- **SQL 배치화**: uuid `= ANY(%s)` → `uuid = text` 라이브 즉사(`ANY(%s::uuid[])` 필요); `VALUES ((...))` 괄호 감싸기 → record 1행 매핑 에러. 둘 다 query mock 통과(task#135). `test_consensus_pipeline.py`의 `test_values_placeholder_shape`가 VALUES 형태를 못박음.
- **외부소스 파싱 라벨 불일치**: yfinance get_* 메서드 vs 프로퍼티의 index 라벨 규칙 차이, KR Naver row·DART `account_id` 매칭 — 응답 mock은 라벨 불일치를 못 잡고 라이브에서만 실패(task#111/#117).
- **tz-naive↔tz-aware 정렬**: 키움 daily_df(naive)↔yfinance(aware) `pd.concat` `TypeError`가 broad except에 삼켜져 조용히 None. fixture/단위테스트는 `^KS11` 라이브 미모킹이라 미포착(task#116). `test_beta.py:61`이 `_ks11_returns`의 tz strip을 단언하지만 이건 함수 단위 검증이고, 실제 `pd.concat` 정합은 여전히 라이브 스모크가 최종 관문.
- **Decimal vs float**: fixture가 float만 쓰면 통과, 라이브 DB NUMERIC=Decimal이면 `TypeError`. `test_exposure.py`가 명시적으로 `Decimal` fixture로 방어.
- **권고 DoD**: 신규/개작 SQL·외부소스 파싱 슬라이스는 mock 테스트 외에 **배포 후 해당 엔드포인트/1종목 라이브 스모크**를 완료기준에 포함.

### 1.8 최근 추가 테스트 파일

- `backend/tests/test_exposure.py` — `services.exposure.compute_exposure` 순수 단위(mock 무). 통화/섹터 그룹핑·기타 버킷·top-N 정렬·집중도(top3/top5/max_single)·단일종목 26 vs 25 임계 경계·섹터 41 vs 40 임계 경계·빈 holdings graceful·fx None/0→no_fx·Decimal 혼산·포트 베타(전체/부분 커버리지 재정규화/빈 map None/미전달 None) 단언.
- `backend/tests/test_beta.py` — `services.beta` 4표면(monkeypatch 스타일). US `beta`→`beta3Year` 폴백·`beta=0.0` 보존·예외 graceful, KR `_ks11_returns` tz strip/빈/예외, `fetch_kr_beta`(ks11 없으면 daily fetch 스킵), upsert dedup·`get_beta` None, `_migrate` DDL, `fetch_all_betas` 시장 분기·KR 없으면 `^KS11` 스킵·에러 continue, 레지스트리·스케줄러·수동 record.
- `backend/tests/test_fear_greed.py` — `services.market_indicators.sentiment` (unittest.mock, 네트워크 무). `_fetch_fear_greed` CNN JSON 파싱(score 반올림·rating·history 날짜 변환)·NaN 가드·요청 예외 None, `get_fear_greed` 4단계(메모리 캐시 hit → fetch 성공 저장 → fetch 실패 stored 폴백 → 무저장 None).
- `backend/tests/test_scraper.py` — `services.scraper` (unittest.mock). `_dedup_sort_limit`(link dedup·published_at 내림차순·limit 컷), `get_news_kr`(Naver 파싱+후처리), `get_news`(yfinance US 경로 + `market=="KR"` 디스패치).

### 1.9 주요 백엔드 테스트 파일 (도메인별)

- 인증/보안: `test_auth.py`, `test_auth_me.py`, `test_security_auth_gaps.py`, `test_oauth_codes_sweep.py`.
- 라우터: `test_stocks_router.py`(최대), `test_report_router.py`, `test_portfolio_router.py`, `test_watchlist_router.py`, `test_consensus_router.py`, `test_analysis_router.py`, `test_admin_router.py`, `test_admin_users_perms_batch.py`, `test_analytics_router.py`, `test_events_router.py`, `test_guru_router.py`, `test_investor_router.py`, `test_rankings_router.py`, `test_digest_router.py`, `test_calendar_router.py`, `test_batches_router.py`.
- 추천 엔진: `test_recommendation_endpoint.py`, `test_recommendation_funnel.py`, `test_recommendation_scoring.py`, `test_recommendation_universe.py`, `test_recommendation_store.py`, `test_recommendation_batch.py`, `test_recommendation_actions.py`.
- 포트폴리오/파생: `test_exposure.py`, `test_beta.py`, `test_rebalance.py`, `test_supply_score.py`, `test_us_supply.py`.
- 시세/시장: `test_market.py`, `test_market_kr.py`, `test_market_indicators.py`, `test_market_us_kis.py`, `test_market_history_routing.py`, `test_market_split_report.py`, `test_market_cache.py`, `test_indices.py`, `test_fear_greed.py`, `test_macro_signals.py`/`test_macro_signals_batch.py`.
- 키움/KIS: `test_kiwoom_quote.py`, `test_kiwoom_chart.py`, `test_kiwoom_sector.py`, `test_kiwoom_investor.py`, `test_kis_client.py`, `test_kis_quote.py`.
- KR 시세 다수결/게이트: `test_kr_quote_degenerate_reuse.py`, `test_kr_quote_escalation_isolation.py`, `test_report_price_gate.py`.
- 배치/스케줄러: `test_batch_endpoints.py`, `test_batch_market_split.py`, `test_batch_resilience.py`, `test_scheduler_seed.py`, `test_scheduler_rankings.py`, `test_scheduler_investor.py`, `test_scheduler_kr_sector_seed.py`, `test_scheduler_us_sector_seed.py`, `test_job_runs.py`, `test_job_runs_instrumentation.py`, `test_report_jobruns_market.py`, `test_schedule_spec.py`.
- 데이터/파싱: `test_backlog.py`, `test_backlog_extract.py`, `test_scraper.py`, `test_disclosures.py`, `test_disclosure_batch.py`, `test_disclosure_endpoint_digest.py`, `test_agm_batch.py`/`test_agm_parser.py`, `test_dividends.py`, `test_financials_kr.py`/`test_financials_kr_cashflow.py`/`test_financials_us_cashflow.py`/`test_financials_us_ratios.py`, `test_insider_trades.py`/`test_us_insider.py`, `test_investor_service.py`/`test_investor_service_kiwoom.py`, `test_upsert_disclosures_batch.py`/`test_upsert_trend_batch.py`.
- 계산/유틸: `test_indicators.py`, `test_consensus_asof.py`/`test_consensus_asof_batch.py`/`test_consensus_pipeline.py`/`test_consensus_backfill_atomic.py`, `test_ranking_service.py`, `test_storage.py`, `test_cache.py`/`test_cache_live_prices_invalidation.py`, `test_ticker_validation.py`, `test_db_execute_many.py`, `test_nan_serialization_guards.py`, `test_event_tracker.py`.
- 빈-결과 가드/폴백: `test_rankings_empty_guard.py`, `test_public_api_empty_items.py`, `test_backfill_names_skip.py`, `test_kr_sector_batch.py`/`test_kr_sector_mapping.py`/`test_kr_sector_momentum.py`, `test_us_sector_batch.py`.

---

## 2. 프론트엔드 — Vitest (ADR-0019)

- 러너: `cd frontend && npm run test` → `vitest run`. `frontend/package.json` devDependency: `vitest ^4.1.9`, `@testing-library/react ^16.3.2`, `@testing-library/jest-dom ^6.9.1`, `jsdom ^29.1.1`.
- 설정: 별도 파일 없이 `frontend/vite.config.js`의 `test` 블록 — `environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.js'`(Vite 설정/플러그인/alias 재사용). `setup.js`는 `import '@testing-library/jest-dom'` 한 줄.
- 테스트는 소스 옆 콜로케이트(`*.test.js(x)`).
- **모킹**: `vi.mock('../api', ...)` + `vi.fn()`. 예 `usePortfolioData.test.js` — `api.get.mockImplementation((url) => ...)`로 URL별 응답 스텁, `renderHook`/`act`/`waitFor`(@testing-library/react), `beforeEach(vi.clearAllMocks())`.
- **도입 범위(ADR-0019)**: R4 추출 대상 훅으로 한정(characterization 테스트로 "추출 전후 동일 입력→동일 출력" 보장). 프론트 전체 테스트 백필은 별건 — 대부분 컴포넌트/페이지는 미커버.
- 프론트 테스트 파일 5개: `frontend/src/hooks/usePortfolioData.test.js`, `frontend/src/hooks/useStockManagement.test.js`, `frontend/src/hooks/useReportFilters.test.js`, `frontend/src/test/recommendations-s3s4.test.jsx`, `frontend/src/test/smoke.test.js`.

---

## 3. 커버되는 것 / 안 되는 것

- **커버**: 백엔드 라우터 HTTP 계약(status·shape), service 로직·순수 계산 함수(mock/리터럴), 배치 4표면 정합, 배치 레지스트리 count/set 정합, 엔드포인트 존재 drift(doc-sync), 프론트 추출 훅 로직.
- **커버 안 됨 / 라이브에서만 드러남**: ① 라이브 SQL 정합(§1.7) ② 외부소스(yfinance/DART/키움/Naver/CNN) 실데이터 파싱·라벨·tz 정렬 ③ 프론트 % 스케일 렌더(yfinance 소수분수 ×100), UI 색 반전, 대부분의 컴포넌트/페이지 렌더 ④ auth prose·스키마 세부 doc-sync.
- **수동 UAT 보완**: 프론트 검증은 `scripts/`의 Playwright 디바이스 에뮬레이션(테스트계정 test@portfolion.com). 라이브 진단은 컨테이너 프로브(`docker exec -i portfolion-backend-1 python -`)로 히스토리/시세 실값 확인.

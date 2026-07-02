---
last_mapped_commit: c482aa6811262685f424cb8fb871e8121cf438c6
mapped: 2026-07-02
---

# 테스트 패턴

## 백엔드 — pytest

- 위치: `backend/tests/` (85개 파일, **~1010 테스트** collected). 실행: `cd backend && .venv/bin/python -m pytest`.
- `backend/tests/conftest.py`: ① `sys.path`에 `backend/` 추가, ② `main.app`에 `app.dependency_overrides[get_current_user] = lambda: "test-user-id"` 전역 오버라이드, ③ `client` fixture = `TestClient(app)`, ④ autouse `_clear_quote_cache` — 매 테스트 전 `cache_svc.invalidate_quote()`로 quote TTL 캐시 교차오염 방지.

### 앱 구성 2패턴

1. **conftest `client`** (main.app 기반): auth는 `get_current_user`만 오버라이드됨.
2. **자체-app** (예: `backend/tests/test_stocks_router.py`, `test_recommendation_endpoint.py`): 모듈 상단에서 `FastAPI()` 생성 → `include_router` → 필요한 auth 의존성 전부 직접 오버라이드(`get_current_user_or_api_key`, `require_admin_or_api_key`, `require_admin` 등). **엔드포인트에 auth Depends를 추가하면 그 경로를 부르는 자체-app 테스트를 전수 grep해 오버라이드 추가**(task#108).
3. **무인증 거부 검증**: `backend/tests/test_security_auth_gaps.py` — 오버라이드 없는 fresh app으로 401/403 단언.

### mock 관례

- 라우터 경로 patch: `patch("routers.stocks.storage.get_full_portfolio", ...)`; 서비스 객체 patch: `patch.object(analysis_service.yf, "Ticker", ...)` (`test_nan_serialization_guards.py`).
- **다중 호출 시퀀스는 `call_args_list[i].kwargs` + `call_count`로 못박기** — `mock.call_args`는 *마지막* 호출이라 additive 호출 추가 시 조용히 오염됨(task#66·67). `backend/tests/test_recommendation_endpoint.py`:
  ```python
  discovery_kwargs = mock_read.call_args_list[0].kwargs   # 호출 인덱스 명시
  assert mock_read.call_count == 2                        # 시퀀스 고정
  ```
  `backend/tests/test_market_kr.py`: `regulars = [c.kwargs.get("regular") for c in kb.call_args_list]`.
- **fixture-pass-live-fail 주의**: 외부소스 파싱(yfinance 라벨·DART account_id·Naver row)은 mock fixture가 라벨 불일치를 못 잡음 — 라이브 1종목 추출 대조를 DoD에 포함(task#111·116·117). DB NUMERIC 재현 fixture는 float 아닌 **Decimal**로.
- API 문서 drift: `backend/tests/test_api_doc_sync.py`가 라이브 routes ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md` 헤더 대조(존재만, task#99).

### TDD 규율

- 버그 수정은 **재현 테스트 먼저 red 확인 후** 수정으로 green. 은퇴한 배치 id 등 깨진 동작을 단언하던 기존 테스트도 grep해 함께 갱신(green이 회귀를 못 잡는 함정).

## 프론트 — vitest

- 위치: `frontend/src/test/`(페이지 레벨 — `recommendations-s3s4.test.jsx`, `smoke.test.js`) + `frontend/src/hooks/`(훅 co-locate — `useStockManagement.test.js`, `useReportFilters.test.js`). 현재 **4파일 41 테스트**.
- 실행: `cd frontend && npm run test` (`vitest run`). 설정은 `frontend/vite.config.js`의 `test:` 키 — `environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test/setup.js'`(`@testing-library/jest-dom` 로드).
- mock: `vi.mock('../api', () => ({ default: { get: vi.fn(), ... } }))` → `api.get.mockImplementation(...)` / `api.get.mock.calls.find(...)`. 훅 테스트는 `renderHook`+`act`(@testing-library/react).
- 렌더된 % 표시는 단위테스트가 스케일 트랩(소수분수 ×100)을 못 잡음 — % 필드별 스케일 검증 필요(task#122·123).

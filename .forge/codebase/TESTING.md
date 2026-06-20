---
last_mapped_commit: 91173837359c5f157349a51501f72efa7342c3fa
mapped: 2026-06-20
---

# TESTING

PortfoliOn의 테스트 구조와 실행법. **백엔드만 자동화 단위/통합 테스트(pytest)를 가진다. 프론트엔드에는 단위 테스트 러너가 없으며, UI는 Playwright 기반 UAT로 수동 검증한다.**

---

## Backend — pytest

### 레이아웃
- 테스트는 전부 `backend/tests/test_*.py`에 모여 있다(현재 75개 파일). 파일명은 대상 모듈/라우터를 따른다 — `test_dividends.py`, `test_analytics_router.py`, `test_market_kr.py`, `test_batch_registry`/`test_batch_endpoints.py`, `test_recommendation_*.py` 등.
- 설정: `backend/pytest.ini` — `testpaths = tests`, `pythonpath = .`(테스트가 `from main import app`, `from services import ...`를 프로젝트 루트 기준으로 import).
- 공용 픽스처: `backend/tests/conftest.py`
  - `sys.path`에 프로젝트 루트 추가.
  - **`app.dependency_overrides[get_current_user] = lambda: "test-user-id"`** — 인증을 모듈 로드 시점에 전역 오버라이드해, 라우터 테스트가 토큰 없이 `"test-user-id"`로 동작한다.
  - `client` 픽스처 = `TestClient(app)`(FastAPI `from main import app`).
  - `_clear_quote_cache` autouse 픽스처 — 매 테스트 전 `cache_svc.invalidate_quote()`로 종목 단위 TTL 캐시 교차 오염 방지.

### 실행
```bash
cd backend && .venv/bin/python -m pytest          # 전체
cd backend && .venv/bin/python -m pytest tests/test_dividends.py   # 단일 파일
```
- macOS는 `backend/.venv/bin/python`, Windows는 `backend/.venv/Scripts/python`.
- **로컬 `.venv` ≠ Docker 의존성** — `lxml`은 `requirements.txt`·Docker엔 있으나 로컬 `.venv`엔 없다. 로컬 pytest로 검증할 HTML 파싱은 `BeautifulSoup(html, "html.parser")`(stdlib)를 쓸 것(CLAUDE.md gotcha).

### 테스트 작성 패턴 (실제 코드에서 관찰)
- **격리는 `monkeypatch.setattr`로 의존성 교체**가 1차(`test_dividends.py`): 외부 호출(`svc.yf.Ticker`, `svc.requests.get`)·DB 헬퍼(`svc.execute`, `svc.query`)·다른 service 함수를 람다/페이크로 치환. 호출 인자 캡처는 `cap = {}` 딕셔너리에 기록하는 관용.
- 라우터 테스트는 두 방식 공존:
  - 전역 `conftest`의 `app`/`client` 사용.
  - 또는 파일 안에서 `app = FastAPI(); app.include_router(router); app.dependency_overrides[get_current_user] = lambda: "test-user-id"; client = TestClient(app)`로 라우터만 마운트(`test_analytics_router.py`).
- 모킹은 `unittest.mock`의 `patch`/`MagicMock`도 사용(`test_analytics_router.py`가 `patch("routers.analytics.yf.Ticker", ...)`, `MagicMock().history.return_value = pd.DataFrame(...)`). pandas/numpy로 시세 시계열 페이크 생성.
- **페이크 응답 헬퍼 클래스**를 테스트 파일 안에 작게 둔다 — `_FakeJsonResp(payload)`(`.json()` 반환), `_FakeYfTicker(info)` 등.
- 캐시를 경유하는 라우터는 캐시를 패스스루로 패치 — `patch("routers.analytics.cache_svc.get_correlation", side_effect=lambda user_id, loader: loader())`로 캐시를 건너뛰고 빌더를 직접 실행.
- docstring(한국어)으로 각 테스트의 검증 의도를 한 줄 명시. graceful 경계(무배당→`None`, status≠000→`None`, 예외→`None`)를 음성 케이스로 다수 커버.
- **배치/스케줄러 계약 테스트** 다수: `batch_registry.get_batch(id)`의 필드(`market`/`category`/`trigger_kinds`/`manual_endpoint`/`scheduler_job_id`/`default_schedule`)를 단언, `scheduler._JOB_FUNCS`에 잡 등록 여부, `job_runs.record(id, trigger)`가 auto/manual lane에서 호출되는지를 `@contextmanager` 페이크로 검증(`test_dividends.py` S3 블록). 배치 id 은퇴 시 이 단언들도 grep 대상(CLAUDE.md gotcha).
- additive로 read/호출을 추가하면 `mock.call_args`(마지막 호출) 단언이 오염되므로 `call_args_list[i].kwargs`/`call_count`로 마이그레이션(CLAUDE.md gotcha task#66·67).

---

## Frontend — 자동 단위 테스트 없음, Playwright UAT로 수동 검증

### 단위 테스트 러너 부재 (사실)
- `frontend/package.json`의 `scripts`는 `dev`/`build`/`lint`(eslint)/`preview`뿐 — **`test` 스크립트가 없다.**
- devDependencies에 **Vitest·Jest·@testing-library가 없다.** `frontend/`에 테스트 러너 설정 파일도 없다(`vite.config.js`·`eslint.config.js`만 존재).
- 즉 프론트엔드 컴포넌트/훅에 대한 자동화 단위 테스트는 존재하지 않는다. 정적 검사는 ESLint(`npm run lint`)가 전부.

### Playwright 기반 UAT (UI 검증 방식)
- Playwright는 `scripts/node_modules`에 설치돼 있다(`scripts/package.json` → `playwright ^1.50.0`; `playwright`/`playwright-core`). 프로젝트 표준 테스트 러너가 아니라 **`scripts/` 안의 일회성 UAT 스크립트**로 운용한다(`scripts/uat-79.js`, `uat-80.js`, `uat-81.js`, `capture-ux.js`, `capture-report-detail.js`, `screenshot.js` 등).
- 실행: `scripts/`에서 `NODE_PATH="$(pwd)/node_modules" node <script>` (CommonJS `require('playwright')`). ESM 스크립트에선 NODE_PATH가 안 먹어 playwright를 절대경로 default import로 로드.
- **테스트 계정**: `test@portfolion.com` / `test1234` — 라이브 사이트 로그인용. 스크립트는 `POST /api/auth/login`으로 토큰을 받아 `localStorage.access_token`/`refresh_token`에 주입한 뒤 페이지를 방문(유효 토큰 주입은 401 없이 인증; 만료/가짜 토큰만 401 reload 루프).
- **검증 대상 URL**: 관찰된 UAT 스크립트는 라이브 도메인 `https://portfolion.taebro.com`을 친다. 대안으로 **localhost:80 프로덕션 nginx**(로컬 `npm run build`가 즉시 라이브 — nginx가 `frontend/dist`를 `:ro` 마운트로 서빙)를 시스템 Chrome CDP(`chromium.connectOverCDP('http://127.0.0.1:PORT')`, `localhost`는 IPv6로 풀려 거부되니 반드시 `127.0.0.1`)로 검증하는 패턴도 사용. dev 서버(5173)는 보통 미가동이며, 호출 순서/카운터 의존 UAT는 StrictMode 이중호출 때문에 dev 대신 `vite preview`(production 번들)로 검증.
- **디바이스/모바일 에뮬레이션**: `newContext({ viewport, isMobile, hasTouch, deviceScaleFactor })` 또는 `devices['iPhone 13']`로 iOS/Android 뷰포트·UA를 흉내. 인앱 브라우저는 UA에 `KAKAOTALK/...` 덧붙임, PWA standalone은 `addInitScript`로 `matchMedia('(display-mode: standalone)')` 오버라이드.
- **격리 하니스**(인증·API·SW 없이 결정적): `frontend/uat.html` + 임시 `uat-main.jsx`로 대상 컴포넌트 + 실제 CSS만 마운트해 전용 포트 `vite --port 5199 --strictPort`로 띄우거나, `frontend/` 안 임시 `.mjs`에서 vite `createServer`(middlewareMode) + `ssrLoadModule` + `renderToStaticMarkup`로 SSR 렌더해 결정적 표시를 단언. 검증 후 임시 파일·dev 서버는 반드시 제거.
- **셀렉터 주의**: 같은 컨트롤이 여러 곳 렌더되면(숨은 사본) `:visible` 필터 필수. nav "탭 N개" 단언은 메뉴 권한 필터링에 막히니 개수보다 순서/키 매핑을 단언. 테스트 계정은 관심 20·보유 0이라 보유 전용 기능은 라이브 렌더로 확인 불가(빈 화면을 회귀로 오인 금지).
- 순수 OS 동작(iOS '홈 화면에 추가' 실제 클릭 등)은 에뮬레이션 불가. 그 외 렌더·분기·게이팅·localStorage 지속은 자동 검증 가능. 최종 확인은 사용자 본인 계정·실기기로 보강.
- 출처: 사용자 메모리 `reference-frontend-uat.md`(프론트 UAT 방법론), 각 UAT 스크립트.

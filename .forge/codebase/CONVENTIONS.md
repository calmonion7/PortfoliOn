---
last_mapped_commit: 7f3aec7d6aab5b2ed9837f9aada7405f9505ae6b
mapped: 2026-06-17
---

# 코딩 컨벤션

**분석 일자:** 2026-06-17

PortfoliOn은 Python/FastAPI 백엔드(`backend/`)와 React 19/Vite 프론트엔드(`frontend/`)로 구성된다. 자동 포매터(black/prettier)는 **설정되어 있지 않다** — 컨벤션은 코드를 통한 암묵적 합의다.

---

## 백엔드 (Python / FastAPI)

### Router ↔ Service 분리

- `backend/routers/` — FastAPI `APIRouter` 정의. HTTP 계약(경로·요청/응답·인증)만 다룬다. 비즈니스 로직은 service로 위임.
- `backend/services/` — 순수 로직(저장·외부 API·계산). FastAPI 의존성 없이 import 가능해야 테스트하기 쉽다.
- router는 service를 모듈로 import해 호출한다 (`from services import storage, errors, market as market_svc`). 모듈 alias는 `_svc` 접미사가 관용 (`cache as cache_svc`, `market as market_svc`).
- `main.py`가 모든 router를 mount하고 scheduler를 기동한다.

router 정의 패턴 (`backend/routers/portfolio.py:10`):

```python
router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])

@router.get("")
def get_portfolio(user_id: str = Depends(get_current_user)):
    return storage.get_full_portfolio(user_id)
```

### 인증 의존성

- 일반 사용자 엔드포인트: `user_id: str = Depends(get_current_user)` (`backend/auth.py:18`).
- 외부 Cowork(API 키) 허용 엔드포인트: `Depends(get_current_user_or_api_key)` (`backend/auth.py:37`). 리포트 enrich/조회 계열이 사용.
- admin 전용: `Depends(require_admin)` / `Depends(require_admin_or_api_key)`.
- 테스트에서는 `app.dependency_overrides[get_current_user] = lambda: "test-user-id"`로 우회 (`backend/tests/conftest.py:10`).

### Pydantic 모델 & FastAPI Body(...) 규칙 (중요)

- 요청 바디는 `pydantic.BaseModel` 서브클래스로 정의하는 것이 1차 패턴. 클래스명은 `...Body` 접미사 관용 (`EnrichBody`, `EventBody`, `PermissionsBody` — `backend/routers/`).
- **bare `list`/`dict` 바디는 반드시 `Body(...)`로 명시**해야 한다. 안 그러면 FastAPI가 쿼리 파라미터로 해석해 재기동 시 기동 불가 버그가 난다.
  - 예: `def put_backlog(ticker: str, entries: list = Body(...), ...)` (`backend/routers/report.py:473`)
  - 예: `schedule: dict = Body(...)` (`backend/routers/batches.py:64`)
- 필드 검증은 `@field_validator` + `@classmethod`. 티커는 strip·upper 후 `is_valid_ticker`로 검증 (`backend/routers/portfolio.py:41`).

### 라우트 등록 순서 함정

- 구체 경로를 path-param 경로보다 **먼저** 등록할 것. `PUT /api/stocks/enrich/batch`는 `PUT /api/stocks/{ticker}/enrich`보다 위에 둬야 한다 — 안 그러면 `enrich`가 ticker 값으로 라우팅된다.

### 입력 정규화 & 검증 유틸 (`backend/services/utils.py`)

- `is_valid_ticker(ticker)` — strip·upper 후 정규식 `^[A-Za-z0-9.\-]{1,15}$` 검증.
- `find_ticker_index` / `ticker_exists_in` / `find_ticker` — 티커 비교는 항상 `.upper()` 정규화 후 수행 (대소문자 무시).
- **티커는 저장 시 `.upper()`로 일관 박제** (`stock.ticker.upper()`).

### NaN/Inf Sanitize

- `sanitize(obj)` (`backend/services/utils.py:29`) — float `NaN`/`Inf`를 `None`으로 재귀 치환(dict/list 깊이 우선). yfinance/pandas 산출물을 JSON 응답으로 내보내기 전 통과시켜 JSON 직렬화 실패를 막는다.

### 에러 처리

- 표준 에러 팩토리는 `backend/services/errors.py`에 둔다: `not_found(ticker, context="")` → 404, `already_exists(...)` → 400.
- router에서는 `raise errors.not_found(ticker)` / `raise errors.already_exists(...)` 사용.
- 도메인 검증 실패는 `raise HTTPException(status_code=422, detail="...")` (사용자 노출 메시지는 한국어 가능, 예: `"상장폐지 종목입니다..."`).
- 외부 fetch 실패는 **조용히 삼키지 말고** `print(f"[...] ... failed for {ticker}: {e}")`로 로깅 (`backend/routers/portfolio.py:21`). silent except는 진단 불가 회귀를 만든다 (CLAUDE.md gotcha).
- 로깅은 표준 `logging` 모듈(일부 service)과 `print()` prefix 태그(`[AutoReport]` 등)가 혼재. 신규 코드는 주변 파일 관례를 따를 것.

### 순환 참조 회피 — 함수 내 지연 import

- 모듈 최상단 import가 순환을 만들면 **함수 내부에서 지연 import**한다.
  - 예: `storage` → `cache`는 `storage.py:268` 함수 안에서 `from services import cache as cache_svc`로 import (모듈 top-level 아님).
- 테스트도 같은 패턴을 쓴다 — 모듈 import를 테스트 함수/`with patch(...)` 블록 안으로 넣어 mock이 먼저 걸리게 한다 (`backend/tests/test_market_kr.py:20`의 `from services import market`).

### DB 접근 (`backend/services/db.py`)

- `psycopg2` `ThreadedConnectionPool` 싱글톤(lazy init, `_lock` 가드). `maxconn=20`은 최대 ThreadPool 동시성(calendar 15·analysis 11)보다 크게 설정.
- 헬퍼: `query(sql, params) -> list[dict]`(SELECT, `RealDictCursor`), `execute(sql, params) -> int`(I/U/D, rowcount). `get_connection()` 컨텍스트매니저가 commit/rollback/putconn 자동.
- **파라미터는 항상 `%s` 플레이스홀더 + params 튜플** — SQL 문자열 보간 금지.
- DB 스키마는 `auth_schema.sql` → `app_schema.sql` 순서. 증분 변경은 `backend/migrations/NNN_*.sql`(기동 시 자동 적용 패턴).

### 캐시 무효화 규약

- 종목 추가/수정/삭제 시 `cache_svc.invalidate_portfolio_caches()` (dashboard·correlation·sector·macro) 호출.
- 종목명/스냅샷 변경 시 `cache.invalidate(ticker)` + `invalidate_list()` 필수 (LRU·list TTL 캐시 때문).

### 파일/심볼 네이밍

- 파일·모듈: `snake_case` (`report_generator.py`, `consensus_pipeline.py`, `leverage_service.py`).
- 함수·변수: `snake_case`. 내부 전용 헬퍼는 `_` 접두사 (`_generate_with_consensus`, `_parse_susu_table`, `_mc_load`).
- 상수: `UPPER_SNAKE` (`TICKER_RE`, `VALID_EVENTS`, `ALL_MENUS`, `BATCHES`, `SECTOR_ETFS`).
- 일부 모듈은 `from __future__ import annotations` + 타입힌트(`Optional[int]`, `list[dict]`) 사용.

### 패키지화된 service

- 큰 도메인은 디렉터리 패키지로 분리: `backend/services/market_indicators/`(fx/commodities/earnings/econ/exports/macro/cache), `backend/services/kiwoom/`(client/quote/sector), `backend/services/kis/`(client/quote).
- 외부 API 클라이언트는 `client.py`(토큰·request 래퍼) + `quote.py`/`sector.py`(TR별 정규화)로 분리. 토큰은 인프로세스 싱글톤, return code≠0 → 예외.
- **외부 API는 요청·기동 경로에서 라이브 호출 금지** — 배치가 사전계산해 `market_cache`/테이블에 저장하고 요청은 저장값만 읽는다. 빈/all-None 결과는 캐시에 박제하지 말 것(직전 양호값 유지).

---

## 프론트엔드 (React 19 / Vite)

### 스타일링 — plain CSS + 디자인 토큰 (TailwindCSS 없음)

- TailwindCSS를 **쓰지 않는다**. 컴포넌트마다 같은 이름의 `.css` 파일을 짝으로 두고 import (`Badge.jsx` ↔ `Badge.css`).
- 모든 색·간격·반경·그림자는 `frontend/src/styles/tokens.css`의 CSS 변수(`var(--...)`)로 참조. 하드코딩 색상 지양.
- 토큰: 색(`--bg`, `--text`, `--accent`, `--up`, `--down`, `--neutral`, `--warn`), 간격(`--space-1`~`--space-6`), 반경(`--radius-sm`~`--radius-xl`), 그림자(`--shadow*`). 다크 테마는 `[data-theme="dark"]` 셀렉터로 같은 변수를 오버라이드.
- BEM 비슷한 클래스 네이밍: `.badge`, `.badge--success`, `.badge__icon`.

### KR 색 관례 함정 (중요)

- 이 앱은 **한국 시장 색 관례**를 따른다: `--up` = 빨강(상승), `--down` = 파랑(하락) (`tokens.css:26-29`).
- 그 결과 `Badge.css`에서 `.badge--success` = `--up`(빨강), `.badge--danger` = `--down`(파랑)이 된다 (`frontend/src/components/ui/Badge.css`).
- `ChangeBadge`(가격/등락률 표시)는 이 관례가 맞다: 양수 → `success`(빨강·▲), 음수 → `danger`(파랑·▼) (`Badge.jsx:33`).
- **가격 방향이 아닌 "의미 상태" 배지(수급 밴드 등)에 `success`/`danger`를 쓰지 말 것** — 색이 KR 가격색으로 박혀 Western(녹=좋음/빨=경고) 의도와 반전된다. 의미 배지는 `frontend/src/components/ui/SupplyBadge.jsx`처럼 **전용 색을 inline `style`로 명시**(가격 토큰 미사용): 우호=초록·중립=회색·경계=주황.
- `.badge--warning` 변형은 `--color-warning`/`--warning-tint` 미정의로 **현재 깨져 있어** caution 색으로 쓸 수 없다. UI 리뷰는 variant 이름의 통념(success=녹)이 아니라 토큰 실제값을 대조할 것.

### 공용 UI 컴포넌트 (`frontend/src/components/ui/`)

- 재사용 프리미티브: `Badge.jsx`, `Button.jsx`, `Card.jsx`, `Stat.jsx`, `icons.jsx`. `index.js`로 barrel export.
- 컴포넌트는 default export 함수 컴포넌트 + `variant`/`size`/`className`/`...props` 패턴 (`Badge.jsx:13`).
- 클래스 조합은 배열 `.join(' ')` 관용; variant→class 매핑은 lookup 객체(`variantClass`).
- 도메인 특화 배지(`SupplyBadge`, `MarketBadge`, `ChangeBadge`)는 공용 `Badge`를 감싸 만든다.

### 컴포넌트 디렉터리 구조

- `frontend/src/pages/` — 라우트 단위 화면(`Portfolio`, `Settings`, `Research`, `MarketHub` 등).
- `frontend/src/components/` — 도메인별 하위 폴더: `ui/`(프리미티브), `portfolio/`, `reports/`, `market/`. 단일 컴포넌트는 루트(`StockModal.jsx`, `Toast.jsx`).
- `frontend/src/hooks/` — 커스텀 훅(`use` 접두사, `usePortfolioData.js`, `useReportList.js`, `useTheme.js` 등).
- `frontend/src/contexts/` — React Context(`AuthContext.jsx`).
- `frontend/src/utils/` — 비-React 헬퍼(`api.js`는 아님, `analytics.js`/`marketHours.js`/`pwa.js`).

### API 클라이언트 (`frontend/src/api.js`)

- 단일 axios 인스턴스를 default export. `baseURL = import.meta.env.VITE_API_BASE_URL || ''`(미설정 시 상대경로 → Vite proxy/nginx).
- request 인터셉터가 `localStorage`의 `access_token`을 `Authorization: Bearer` 헤더로 주입.
- response 인터셉터가 401 시 토큰 제거 + `window.location.href = '/'`로 로그아웃.
- 컴포넌트/훅은 `import api from '../api'` 후 `api.get('/api/...')`. fetch 직접 호출은 `analytics.js` 같은 토큰 비의존 경로 예외.

### 데이터 페칭 훅 패턴

- `useState` + `useCallback` + `useEffect` 조합. 비동기 fetcher는 `useCallback`으로 감싸 의존성 안정화 (`usePortfolioData.js`).
- 에러는 `.catch(() => {})` 또는 `try/finally`로 silent 처리(로딩 플래그는 `finally`에서 해제)가 관용.
- 응답 형태가 객체면 옵셔널 체이닝 + 기본값(`res.data?.holdings || []`).

### 엔드포인트 응답 reshape 함정

- 엔드포인트 응답을 **비-additive로(배열→객체 등)** 바꾸면 그 엔드포인트를 fetch하는 *모든* 프론트 소비처를 `grep -rn '<경로>' frontend/src/`로 전수 갱신할 것. 훅과 별개로 직접 fetch하는 페이지(예: `Analytics.jsx`)가 조용히 깨진다. 가능하면 additive(필드 추가)를 선호.

### Vite 빌드 함정

- Vite 8 = rolldown 번들러. `vite.config.js`의 `build.rollupOptions.output.manualChunks`는 **함수 형식만** 받는다(객체형 쓰면 빌드 깨짐). `manualChunks(id)`에서 `node_modules` 경로 substring으로 분기.

### 린트 (`frontend/eslint.config.js`)

- flat config. `@eslint/js` recommended + `eslint-plugin-react-hooks`(flat recommended) + `eslint-plugin-react-refresh`(vite). `dist` 무시.
- prettier 설정 없음. `npm run lint`로 eslint 실행.

---

## 문서 동기화 규약 (DoD)

코드 변경 시 함께 갱신해야 하는 문서 — 빠뜨리면 소비자가 stale 명세로 호출/오인한다.

- **API 변경 → 명세서 2개 동시 갱신**: 엔드포인트 추가/삭제·요청/응답 스키마·인증 게이팅 변경 시 `API_SPEC.md`(전체 REST 레퍼런스)와 `CLAUDE_COWORK_API.md`(외부 Cowork API)를 **항상 함께** 업데이트.
- **기능 표면 변경 → `README.md` 해당 절 갱신**: ① 화면 구성(nav/화면) ② 환경변수 ③ 기술 스택 ④ 아키텍처(router/service/table) ⑤ 배치 — 중 하나라도 추가·삭제·개명 시. README는 overview 레벨이라 엔드포인트 세부는 중복하지 말고 `API_SPEC.md`/`CLAUDE_COWORK_API.md`에만 둔다.
- **배치 변경 → `batch_registry.BATCHES` 동기화**: fetch 소스 변경 시 `source` 갱신, 배치 id 은퇴 시 그 id를 쓰는 모든 표면(read·`schedule_desc`·`job_runs.record` 전 lane·단언 테스트) 전수 grep.
- **로컬·프로덕션 의존성 차이**: HTML 파싱 시 `lxml`(로컬 `.venv`에 없음) 대신 stdlib `BeautifulSoup(html, "html.parser")`를 쓸 것 — 자세한 내용은 TESTING.md 참조.

---

*컨벤션 분석: 2026-06-17*

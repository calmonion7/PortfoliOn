---
last_mapped_commit: 91173837359c5f157349a51501f72efa7342c3fa
mapped: 2026-06-20
---

# CONVENTIONS

PortfoliOn 코드베이스의 코드 스타일·네이밍·에러 처리·캐시 무효화 관례를 실제 파일에서 추린 구현 사실 모음이다. 백엔드는 Python/FastAPI(`backend/`), 프론트는 React 19 + Vite + plain CSS(`frontend/`).

---

## Backend (Python / FastAPI)

### 모듈 구조
- 라우터는 `backend/routers/*.py`, 비즈니스 로직은 `backend/services/*.py`로 분리한다. 라우터는 얇게(파라미터 검증·인증·캐시 게이팅), 실제 fetch/계산은 service에 둔다. 예: `backend/routers/analytics.py`의 `get_correlation`이 service·cache·parallel을 조합.
- 큰 서비스는 **패키지로 분리**한다 — `backend/services/storage/`(portfolio·names·schedule·dates), `backend/services/market/`(kr·us·format), `backend/services/market_indicators/`, `backend/services/kiwoom/`, `backend/services/kis/`, `backend/services/recommendation/`.
- 패키지로 분리해도 **외부 소비처가 `storage.X` 모듈 속성으로 조회**하므로, `__init__.py`에서 공개·내부(`_`접두) 심볼을 전부 re-export해 표면을 보존한다(`backend/services/storage/__init__.py` 주석 명시, ADR-0017). `from services.db import ...`로 구 단일 파일이 노출하던 DB 헬퍼까지 re-export.
- 파일 상단에 종종 `# backend/services/db.py` 형태의 경로 주석을 둔다.

### import / 순환참조 회피 (lazy import)
- 모듈-레벨 import가 순환참조를 만드는 경우 **함수 내부 지연 import**로 푼다. 대표 사례:
  - `backend/services/storage/names.py`의 `_invalidate_name_caches` — `from services import cache as cache_svc`를 함수 안에서 import(storage↔cache 순환 회피, 주석에 명시).
  - `backend/services/cache.py`의 `invalidate_portfolio_caches` — `from routers import calendar as calendar_router`를 함수 안에서.
  - `backend/services/digest_service.py`, `backend/services/indicators.py`, `backend/services/investor_service.py`, `backend/services/short_sell_service.py` 등도 `from services.kiwoom import ...` / `from services import ...`를 호출 시점에 지연 import.
- 모듈 별칭은 `cache as cache_svc`, `market as mkt` 등 짧은 별칭을 관용적으로 쓴다.
- 타입 힌트가 있는 모듈은 파일 첫 줄에 `from __future__ import annotations`(예: `backend/services/utils.py`, `backend/services/db.py`).

### 타입 힌트 / 시그니처
- 함수 시그니처에 타입 힌트를 단다(`def query(sql: str, params=None) -> list[dict]`). `Optional[int]`, `dict | None` 둘 다 등장.
- FastAPI 라우터는 `APIRouter(prefix="/api/...", tags=[...])`로 prefix·tag를 선언하고, 인증은 `user_id: str = Depends(get_current_user)`로 주입(`from auth import get_current_user`).
- 요청 바디는 pydantic `BaseModel` 서브클래스로 정의(`backend/routers/events.py`의 `EventBody`). bare list/dict 바디는 `Body(...)`로 명시(CLAUDE.md gotcha).
- 라우트 등록 순서 주의: 구체 경로(`/enrich/batch`)를 path-param 경로(`/{ticker}/enrich`)보다 먼저 등록(CLAUDE.md gotcha).

### NaN / inf sanitize
- starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 NaN/inf가 있으면 직렬화 500이 난다. 두 가지 관용 패턴:
  - 공용 재귀 sanitizer `backend/services/utils.py`의 `sanitize(obj)` — float NaN/inf를 `None`으로, dict/list는 재귀 처리.
  - **소스에서 로컬 가드** — `backend/routers/analytics.py`의 내부 `_safe(v)`처럼 `math.isnan/isinf` 체크 후 `None` 반환. CLAUDE.md는 출력 일괄 sanitize보다 소스 가드를 선호한다고 명시.

### 에러 처리
- HTTP 에러는 `backend/services/errors.py`의 팩토리(`not_found(ticker, context)`, `already_exists(...)`)로 `HTTPException`을 생성해 메시지 형식을 통일.
- 외부 API(yfinance·DART·requests) 호출은 **`try/except`로 감싸 graceful 처리**한다 — 실패 시 `None`/빈 결과 반환이 관례(`backend/routers/analytics.py`의 `_fetch_closes`가 예외 시 `(None, None)`). 단, 배치의 fetch 실패는 "조용히 삼키지 말고 로깅"하고 **빈/all-None 결과를 캐시에 박제 금지**(CLAUDE.md gotcha, task#48~50).
- 백그라운드 best-effort 쓰기(이벤트 로깅 등)는 `except: pass`로 무시(`backend/routers/events.py`의 `_persist`).

### DB 접근
- `backend/services/db.py`가 단일 진입점: psycopg2 `ThreadedConnectionPool`(minconn=1, maxconn=20 — ThreadPool 동시성보다 크게) 싱글톤 + `threading.Lock` 이중검사 초기화.
- `@contextmanager get_connection()`이 commit/rollback/putconn 라이프사이클 관리. 단발 쿼리는 헬퍼 `query(sql, params) -> list[dict]`(RealDictCursor), `execute(sql, params) -> int`(rowcount).
- SQL은 `%s` 파라미터 바인딩, UPSERT는 `INSERT ... ON CONFLICT (...) DO UPDATE` 관용. ticker는 저장 전 `.upper()` 정규화.

### 네이밍
- 모듈/함수/변수는 `snake_case`, 클래스는 `PascalCase`(`TTLCache`), 상수/화이트리스트는 `UPPER_SNAKE`(`VALID_EVENTS`, `TICKER_RE`).
- 모듈-내부 전용 심볼은 `_` 접두(`_get_pool`, `_fetch_closes`, `_safe`, `_mc_load`).
- 주석·docstring은 한국어. docstring은 `"""..."""`, 한 줄 요약 + 필요 시 근거(task#·ADR 번호) 인용.

---

## Frontend (React 19 + Vite, plain CSS)

### 컴포넌트 / 모듈
- 컴포넌트·페이지·훅은 **default export 함수 컴포넌트**(`export default function Badge(...)`, `export default function usePortfolioData()`). 부수 export(`MarketBadge`, `ChangeBadge`)는 named export로 같은 파일에 둔다.
- `frontend/src/components/ui/`가 디자인 시스템 프리미티브(Button·Card·Badge·Stat·Input·Skeleton·icons). `frontend/src/components/ui/index.js`가 배럴 re-export.
- 페이지는 `frontend/src/pages/`, 도메인 컴포넌트는 `frontend/src/components/<domain>/`(portfolio·reports·market·recommendations), 커스텀 훅은 `frontend/src/hooks/`, 순수 헬퍼는 `frontend/src/utils/`(+ 루트 `frontend/src/utils.js`의 `fmtPrice`).
- 프레젠테이션 컴포넌트는 **props로 데이터를 받는다**(closure 대신) — `DashboardCard({ item, tick })`, `Badge({ variant, size, ... })`처럼 props 구조분해 + 기본값. 데이터 fetch·폴링·상태는 훅(`usePortfolioData`)으로 끌어올린다.

### 스타일 (plain CSS + 토큰)
- **TailwindCSS 없음.** 컴포넌트별 CSS 파일을 같은 폴더에 두고 import(`import './Badge.css'`). 전역 토큰은 `frontend/src/styles/tokens.css`의 CSS 변수(`:root` + `[data-theme="dark"]`), 화면 CSS는 `frontend/src/styles/pc.css`·`frontend/src/styles/mobile.css`.
- `className`으로 BEM-스타일 클래스(`dashcard__stat dashcard__stat--full`)를 조합하는 게 1차. 동적 클래스는 배열 `.filter(Boolean).join(' ')` 관용(`frontend/src/components/ui/Button.jsx`, `frontend/src/components/ui/Badge.jsx`).
- **inline `style`은 토큰화되지 않은 1회성 색/표시에만** 보조로 사용(`SupplyBadge`가 밴드별 전용 색을 `style={{ background, color, borderColor }}`로 명시).

### KR 색 관례 (중요)
- 이 앱은 **`--up`=빨강(상승)·`--down`=파랑(하락)** (`frontend/src/styles/tokens.css`). 따라서 `frontend/src/components/ui/Badge.css`의 `.badge--success`=빨강·`.badge--danger`=파랑이다.
- 가격 방향 배지(`ChangeBadge`)는 `value >= 0 ? 'success'(빨강/상승) : 'danger'(파랑/하락)`로 KR 관례를 따른다.
- **의미 상태 배지(수급 밴드 등)에 `success`/`danger` 변형을 쓰면 안 된다** — KR 가격색으로 박혀 Western(녹=좋음/빨=경고) 의도와 반전된다. 의미 배지는 `frontend/src/components/ui/SupplyBadge.jsx`처럼 **전용 색을 inline style로 명시**한다(우호=초록·중립=회색·경계=주황). `tokens.css`에 `--color-success`/`--semantic-buy` 등 가격색과 분리된 semantic 토큰이 따로 정의돼 있다. (CLAUDE.md gotcha, 라이브 UAT 포착 b288f394)
- 가격/수치는 `tnum`(tabular-nums) 클래스 + `fmtPrice`(KR=`₩`+천단위, US=`$`+소수2자리)로 표시. 결측·NaN은 `'—'`로 통일(`frontend/src/utils.js`의 `fmtPrice`).

### 데이터 페칭 / API
- `frontend/src/api.js`가 axios 인스턴스 단일 진입점: `baseURL`은 `VITE_API_BASE_URL || ''`(상대경로 폴백), request interceptor가 `localStorage.access_token`을 Bearer로 주입, response interceptor가 401 시 토큰 제거 후 `/`로 리다이렉트.
- 훅은 `useState` + `useCallback`(fetch 함수) + `useEffect`(트리거) 패턴. fetch 실패는 `.catch(() => {})` / `try/catch`로 silent 처리해 UI를 깨지 않게 한다(`frontend/src/hooks/usePortfolioData.js`).
- 비-additive 응답 변경(배열→객체 등) 시 **모든 프론트 소비처를 grep으로 전수 갱신**(CLAUDE.md gotcha task52). additive(필드 추가) 선호.

### Vite 번들러 주의
- Vite 8 = rolldown 번들러. `frontend/vite.config.js`의 `build.rollupOptions.output.manualChunks`는 **함수 형식만** 받는다(객체형 쓰면 빌드 깨짐, CLAUDE.md gotcha task28).
- 차트는 `recharts`, 마크다운은 `react-markdown` + `remark-gfm`, 라우팅은 `react-router-dom` v7.

---

## Cache invalidation (`backend/services/cache.py`)

- 인메모리 캐시 6종+: snapshot LRU(`OrderedDict`, max 50), `TTLCache` 인스턴스들 — list(60s), dashboard(300s), correlation(300s), sector(300s), macro(300s), quote(60s), live_prices(15s).
- `TTLCache`는 `get(key, loader)` 패턴 — 미스/만료 시 `loader()` 호출해 채운다. 라우터는 `cache_svc.get_correlation(user_id, _build)`처럼 빌더 클로저를 넘긴다.
- 무효화 함수는 `invalidate_*(key=None)` — 인자 없으면 전체 clear, 있으면 해당 키만(`_store.pop`).
- **종목 추가/수정/삭제 시 `cache.invalidate(ticker)`가 fan-out 무효화**: snapshot LRU + list + dashboard(전 유저) + correlation + sector + macro + live_prices를 모두 비운다. 캐시 키에 `market`을 섞는 경우(`get_sector`의 `f"{user_id}:{market}"`)는 전체 clear로 양쪽 키 무효화.
- 이름 변경 시 DB만 바꾸면 화면 미반영 → `backend/services/storage/names.py`가 `cache.invalidate(ticker)` + `invalidate_list()`를 호출(지연 import로 순환 회피).
- **배치-백킹 뷰(랭킹·KR 업종 모멘텀 등)는 요청 경로에서 외부 API 라이브 호출 금지** — 배치가 `market_cache`/테이블에 사전계산 저장하고 요청은 저장값만 읽는다(CLAUDE.md gotcha task#50).

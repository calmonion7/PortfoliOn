---
last_mapped_commit: 27346baec719306d5c2be8f259cc448ca4f64f4a
mapped: 2026-06-13
---

# CONVENTIONS

PortfoliOn 코드베이스의 코드 스타일·네이밍·반복 패턴·에러 처리 규약. 모든 예시는 실제 파일·라인을 인용한다.

## 백엔드 (Python / FastAPI)

### 라우터 구조

각 라우터는 `APIRouter(prefix=..., tags=[...])`로 자기 prefix를 소유한다.

- `backend/routers/stocks.py:48` — `router = APIRouter(prefix="/api/stocks", tags=["stocks"])`
- `backend/routers/portfolio.py:12` — `router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])`
- `backend/routers/report.py:23` — `router = APIRouter(prefix="/api", tags=["report"])` (report·backlog는 `/api` 직하)
- `backend/routers/batches.py:9` — `router = APIRouter(prefix="/api", tags=["batches"])`

핸들러는 `@router.get/post/put` 데코레이터 + 함수. 상태코드는 데코레이터 인자로 명시한다(`@router.post("", status_code=201)` — `portfolio.py:81`; `status_code=202`는 백그라운드 작업 시작, `report.py:74`).

### 인증 의존성 (`backend/auth.py`)

인증은 모두 FastAPI `Depends(...)`로 주입한다. 정의는 `backend/auth.py`:

- `get_current_user` (`auth.py:18`) — HTTP Bearer JWT(HS256, `JWT_SECRET`) 검증 후 `payload["sub"]`(user_id) 반환. 실패 시 401.
- `get_current_user_or_api_key` (`auth.py:37`) — `X-API-Key` 헤더(`COWORK_API_KEY`)이면 sentinel `_API_KEY_USER_ID = "__api_key__"`(`auth.py:15`) 반환, 아니면 JWT. Cowork 외부 API 진입점에 사용.
- `require_admin` (`auth.py:61`) — `get_current_user`에 의존, `auth_service.get_user_by_id`로 `role == "admin"` 확인, 아니면 403. 리포트 생성·Guru 크롤·배치 스케줄 수정 등 관리자 전용 엔드포인트에 사용(`admin.py`, `batches.py`, `investor.py`, `guru.py`, `digest.py`, `rankings.py`, `report.py`, `market_indicators.py`).
- `require_admin_or_api_key` (`auth.py:68`) — API 키이면 통과, 아니면 admin JWT 요구.

사용 예: `def get_portfolio(user_id: str = Depends(get_current_user))` (`portfolio.py:60`), `def backfill_all(..., user_id: str = Depends(require_admin))` (`report.py:75`).

라우터는 이 심볼들을 `from auth import get_current_user, require_admin, get_current_user_or_api_key, ...`로 임포트한다(`report.py:20`, `stocks.py:16`). `_API_KEY_USER_ID`도 동일 모듈에서 임포트한다.

### FastAPI `Body(...)` 규칙 (중요 함정)

PUT/POST에서 **bare `list`/`dict` 본문 파라미터는 반드시 `Body(...)`로 명시**해야 한다. 누락 시 FastAPI가 query 파라미터로 해석해 기동이 깨진다.

- `report.py:462` — `def put_backlog(ticker: str, entries: list = Body(...), ...)`
- `batches.py:64` — `schedule: dict = Body(...)`

구조화된 본문은 `pydantic.BaseModel`로 받는다(`stocks.py:89` `EnrichBody`, `portfolio.py:46` `Stock`, `admin.py:35` `PermissionsBody`).

### 서비스 레이어 분리

라우터는 얇게 유지하고 로직은 `backend/services/*`에 둔다. 라우터는 `from services import storage, market, consensus as consensus_svc, ...` 형태로 임포트한다(`stocks.py:12-15`, `portfolio.py:5-9`). 별칭 관례: `consensus as consensus_svc`, `cache as cache_svc`, `market as market_svc`, `consensus_pipeline as _pipeline`.

서비스 서브패키지: `backend/services/market_indicators/`(fx/commodities/earnings/econ/exports/cache 모듈 분할).

### DB 헬퍼 (`backend/services/db.py`)

PostgreSQL 접근은 모듈 단일 진입점 두 함수로 통일한다:

- `query(sql, params=None) -> list[dict]` (`db.py:42`) — SELECT, `RealDictCursor`로 dict 리스트 반환.
- `execute(sql, params=None) -> int` (`db.py:50`) — INSERT/UPDATE/DELETE, 영향 행 수 반환.

둘 다 `get_connection()` 컨텍스트매니저(`db.py:29`)를 쓴다 — 성공 시 `commit`, 예외 시 `rollback`, 끝나면 `putconn`. 풀은 `ThreadedConnectionPool(minconn=1, maxconn=10, dsn=os.environ["DATABASE_URL"])`(`db.py:21`)로 lazy 싱글턴(`_get_pool`, double-checked lock).

라우터/서비스는 `from services.db import query, execute`(`report.py:19`) 또는 별칭 `from services.db import query as db_query`(`portfolio.py:9`)로 임포트한다. SQL은 문자열, 파라미터는 항상 `%s` 플레이스홀더 + 튜플(`stocks.py:25-28`) — f-string 보간 금지.

### NaN/Inf sanitize 유틸 (`backend/services/utils.py`)

`sanitize(obj)` (`utils.py:21`) — `float`의 NaN/Inf를 `None`으로, dict/list는 재귀 처리. JSON 직렬화 전 필수 통과. 별칭 임포트 관례 `from services.utils import sanitize as _sanitize`(`report.py:16`, `report_generator.py:12`).

- 응답 직전: `return _sanitize(rows[0]["data"])` (`report.py:157`), `_slim_summary` 끝에서 `return _sanitize(s)` (`report.py:58`).
- DB 저장 직전: `report_generator.py:177` `sanitized = _sanitize(summary)` 후 `json.dumps(sanitized, ensure_ascii=False, indent=2)`.

같은 모듈의 티커 검색 헬퍼: `find_ticker_index` / `ticker_exists_in` / `find_ticker` (`utils.py:6-18`) — 전부 대문자 정규화 후 비교. `portfolio.py:89`에서 `ticker_exists_in(holdings, stock.ticker)`로 사용.

### 컨센서스 as-of 공유 헬퍼 (`backend/services/consensus.py`)

목표가·의견수 표시 정본은 `daily_consensus_mart`(ADR-0008). 표시 경로는 이 모듈의 공유 헬퍼를 거친다:

- `get_asof(ticker, date)` (`consensus.py:5`) — `daily_consensus_mart`에서 `base_date <= date` 최신행, 없으면 `consensus_history`(`date <= date`) 폴백, 둘 다 없으면 `None`.
- `apply_asof(summary, ticker, date)` (`consensus.py:25`) — summary를 **복사**(원본 불변)해 정본으로 정합. 행이 있으면 `buy/hold/sell`은 항상 덮어쓰고, `target_*`은 **non-null일 때만** 덮어써 snapshot 동결값을 보존. 행이 없으면 그대로 반환.
- `get_history(ticker)` (`consensus.py:42`) — 마트 우선, 없으면 `consensus_history` 폴백.

사용처: `report.py:228` `summary = consensus_svc.apply_asof(summary, ticker, dates[0])`, `report.py:349`, `stocks.py:235`.

### 에러 헬퍼 (`backend/services/errors.py`)

표준 404/400을 팩토리로 통일한다:

- `not_found(ticker, context="")` (`errors.py:4`) → 404 `"{ticker} not found in {context}"`.
- `already_exists(ticker, context="")` (`errors.py:9`) → 400 `"{ticker} already exists ..."`.

`raise errors.already_exists(stock.ticker)` (`portfolio.py:90`), `raise errors.not_found(ticker, "watchlist")` (`watchlist.py:130`). 그 외 일회성 에러는 `HTTPException(status_code=..., detail=...)` 직접 raise(`portfolio.py:86`, `batches.py:57`).

### 한국어 커밋 메시지 규약

`<type>: <한국어 요약>` Conventional Commits 형식. `git log --oneline -20` 기준 사용 타입: `fix:`, `feat:`, `refactor:`, `docs:`. 요약은 한국어, 필요 시 `—`로 부연. 예:

- `fix: 배치 허브 컨센서스 사용처에 목표가(상세·목록·대시보드) 반영`
- `feat: iOS PWA 설치 안내 배너 (모바일·로그인 후)`
- `refactor: 컨센서스 쓰기 경로를 daily_consensus_mart로 일원화`
- `docs: API 명세서 2개 backlog 동기화 + 동기 갱신 규칙`

### 기타 관례

- 파일 상단 `from __future__ import annotations`(`db.py:2`, `consensus.py:1`, `report.py:1`, `utils.py:1`).
- 모듈 프라이빗은 `_` 접두(`_latest_snapshot`, `_slim_summary`, `_pool`, `_KST`).
- KST 타임존: `_KST = ZoneInfo("Asia/Seoul")`(`report.py:6`), `datetime.now(tz=_KST)`.
- 외부 호출(yfinance·requests)·파일 폴백은 `try/except Exception:`으로 감싸고 빈 결과/`None` 반환 또는 `pass`(`stocks.py:31`, `stocks.py:85`, `portfolio.py:74`).
- 병렬화는 `services.parallel.parallel_map`(`portfolio.py:78`) 또는 `ThreadPoolExecutor`.

## 프론트엔드 (React 18 / Vite, plain CSS)

### 컴포넌트 스타일

함수형 컴포넌트 + 훅만 사용(`useState`/`useEffect`/`useRef`/`useCallback`). 페이지는 `export default function ComponentName()`(`ConsensusSettings.jsx:6`). cleanup은 effect 반환으로(`ConsensusSettings.jsx:13` `useEffect(() => () => clearInterval(pollRef.current), [])`).

### 인라인 스타일 + CSS 변수 (Tailwind 없음)

스타일은 인라인 `style={{...}}` 객체 또는 `className`(plain CSS 클래스)로 준다. **TailwindCSS를 쓰지 않는다.** 색·간격·반경은 모두 CSS 변수 토큰을 참조한다 — `frontend/src/styles/tokens.css`에 정의(`--bg`, `--text`/`--text-2`/`--text-3`, `--border`, `--accent-soft`, `--up`/`--down`(한국식: 빨강=상승/파랑=하락), `--radius`, `--shadow-sm` 등).

예(`ConsensusSettings.jsx`): `color: 'var(--text-3)'`(`:43`), `background: 'var(--accent-soft)'`(`:48`), `boxShadow: days === d ? 'var(--shadow-sm)' : 'none'`(`:55`), `color: 'var(--up)'`(`:89`). 공용 클래스: `className="btn btn-primary"`(`:65`), `className="list-card"`(`:41`).

### `api.js` 사용 (`frontend/src/api.js`)

HTTP는 전부 단일 axios 인스턴스를 통한다 — `import api from '../api'`(`ConsensusSettings.jsx:2`, `AuthContext.jsx:2`).

- `baseURL = import.meta.env.VITE_API_BASE_URL || ''`(`api.js:4`) — 미설정 시 상대경로(Vite 프록시).
- 요청 인터셉터(`api.js:7`)가 `localStorage`의 `access_token`을 `Authorization: Bearer`로 자동 첨부.
- 응답 인터셉터(`api.js:15`)가 401이면 토큰 제거 후 `/`로 강제 이동.
- 호출: `await api.post('/api/consensus/batch?...')`, `await api.get('/api/consensus/batch/progress')`(`ConsensusSettings.jsx:20-23`). 에러는 `err?.response?.data?.detail` 패턴으로 추출(`:32`).

### Toast 패턴 (`frontend/src/components/Toast.jsx`)

`ToastProvider`(`Toast.jsx:5`)가 컨텍스트를 제공, 컴포넌트는 `const { showToast } = useToast()`(`Toast.jsx:40`)로 소비. `showToast(message, type)`의 `type`은 `'success'`(기본)/`'error'`/`'warning'`. 토스트는 3초 후 자동 제거, 최근 3개만 유지. 사용처: `Portfolio.jsx`, `Calendar.jsx`, `Ranking.jsx`, `Reports.jsx`, `reports/ConsensusChart.jsx`.

### AuthContext 패턴 (`frontend/src/contexts/AuthContext.jsx`)

`AuthProvider`(`AuthContext.jsx:6`)가 로그인 시 `api.get('/api/auth/me')`로 `role`·`menu_permissions`를 로드해 컨텍스트로 제공. 실패 시 `role='user'`/빈 권한으로 폴백(`:23`). 소비는 `const { role, menuPermissions, loading } = useAuth()`(`AuthContext.jsx:37`). `useAuth`는 `App.jsx`·`MobileNav.jsx`(nav 필터링)·`StockModal.jsx`·`Settings.jsx` 등에서 사용. `frontend/src/hooks/useAuth.js`도 존재.

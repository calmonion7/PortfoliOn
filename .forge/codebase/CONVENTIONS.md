---
last_mapped_commit: 6d95dcb9610a1b3c68075b0f587169989f6d8e10
mapped: 2026-06-19
---

# CONVENTIONS

PortfoliOn의 코드 스타일·네이밍·구조·에러처리 관례. 실제 소스에서 추출한 패턴만 기록한다(도메인 용어 정의는 제외).

## Backend — 언어/스타일

- Python 3, FastAPI. 들여쓰기 4-space, 문자열은 큰따옴표 우세.
- 새 모듈 상단에 `from __future__ import annotations`를 자주 둠 (`backend/services/db.py`, `backend/services/utils.py`, `backend/services/market/__init__.py`).
- 타입힌트 적극 사용: `list[dict]`, `dict | None`, `Optional[int]`, `str | None` (PEP 604 union 혼용).
- 주석/docstring은 **한국어**가 기본 (`backend/services/market/__init__.py`의 함수 docstring, `db.py`의 `query`/`execute` 설명 등). 코드 식별자(함수·변수명)는 영어.
- 내부 전용 심볼은 leading underscore (`_get_quote_uncached`, `_closes_from_download`, `_pct`, `_ANALYST_KEYS`).
- 모듈 상수는 UPPER_SNAKE 또는 leading-underscore + UPPER (`TICKER_RE`, `_HISTORY_CFG`, `_ANALYST_KEYS`, `_JSON_TEXT_FIELDS`). 불변 집합은 `frozenset({...})` 사용 (`backend/services/storage/portfolio.py`).

## Backend — 라우터 구조

대표 예시 `backend/routers/watchlist.py`:

- 라우터당 `router = APIRouter(prefix="/api/<name>", tags=["<name>"])` 단일 인스턴스. 핸들러는 `@router.get("")`, `@router.post("", status_code=201)`, `@router.delete("/{ticker}")` 형태.
- 인증은 의존성 주입: `user_id: str = Depends(get_current_user)` (admin 전용은 `Depends(require_admin)`). `auth.py`에서 import. 외부 Cowork용은 `get_current_user_or_api_key` (`backend/routers/report.py`).
- 요청 본문은 Pydantic `BaseModel` 서브클래스로 정의. 필드 제약은 `Field(..., gt=0)`, 커스텀 검증은 `@field_validator(...)` + `@classmethod` (ticker는 `is_valid_ticker`로 검증 후 `strip().upper()` 정규화 — `WatchlistStock._validate_ticker`).
- **FastAPI Body(...) 관례 (중요)**: PUT/POST 핸들러가 BaseModel이 아닌 **bare `list`/`dict`** 파라미터를 받을 때는 반드시 `Body(...)`로 명시한다 — 안 하면 FastAPI가 쿼리 파라미터로 오인해 기동 불가. 예: `entries: list = Body(...)` (`backend/routers/report.py:494`), `schedule: dict = Body(...)` (`backend/routers/batches.py:64`). 그 외 구조화 본문은 `class XxxBody(BaseModel)`로 모델화 (`EnrichBody`, `EventBody`, `PermissionsBody`).
- 에러는 헬퍼로 통일: `backend/services/errors.py`의 `errors.not_found(ticker, context)` (404), `errors.already_exists(ticker, context)` (400). 직접 `raise HTTPException(status_code=..., detail=...)`도 사용 (422 상장폐지 등).
- 라우트 등록 순서 주의: 더 구체적/상수 경로를 path-param 경로보다 **먼저** 등록 (`PUT /api/stocks/enrich/batch`를 `PUT /api/stocks/{ticker}/enrich`보다 앞에 — 안 하면 `enrich`가 ticker로 라우팅됨).
- 백그라운드 작업은 `BackgroundTasks` 주입 + `background_tasks.add_task(fn, arg)` (리포트 자동 생성 — `watchlist.py`의 `_generate_with_consensus`).
- 라우터→서비스는 모듈 단위 import 후 `storage.X`, `market_svc.X`처럼 **모듈 속성 접근** (`from services import storage, errors, cache as cache_svc`; `from services import market as market_svc`). 캐시 무효화는 mutation 후 명시 호출 (`cache_svc.invalidate(ticker)`, `cache_svc.invalidate_portfolio_caches()`, `calendar_router.clear_cache()`).

## Backend — 서비스 구조

- `backend/services/` 아래 도메인별 모듈. 큰 모듈은 **패키지로 분리**되는 추세 (ADR-0017): `storage.py`→`services/storage/`, `market.py`→`services/market/`, `scheduler.py`(루트), `market_indicators/`, `kiwoom/`, `kis/`, `recommendation/`.
- **패키지 분리 시 표면 보존 규약**: 분리된 패키지의 `__init__.py`가 서브모듈의 공개 + 외부참조 private 심볼을 **전부 re-export**한다. 외부 소비처가 `storage.X`/`market.X` 모듈 속성으로 접근하므로 모든 심볼이 패키지 루트에 존재해야 함 (`backend/services/storage/__init__.py`, `backend/services/market/__init__.py` 상단 주석 참고). 분리 후에도 `from services import storage`/`from services import market` 호출 형태 불변.
- DB 접근은 `backend/services/db.py`의 3-함수 표면:
  - `query(sql, params) -> list[dict]` — SELECT (RealDictCursor).
  - `execute(sql, params) -> int` — INSERT/UPDATE/DELETE, rowcount 반환.
  - `get_connection()` — contextmanager, 성공 시 commit/예외 시 rollback/항상 putconn. psycopg2 `ThreadedConnectionPool` (maxconn=20, ThreadPool 동시성보다 크게).
  - 파라미터화 쿼리(`%s` placeholder)만 사용 — 문자열 포매팅 금지.
  - UPSERT는 `INSERT ... ON CONFLICT (key) DO UPDATE SET col=EXCLUDED.col` 패턴 (`storage/portfolio.py` save_stocks). 플래그 보존은 `is_etf=tickers.is_etf OR EXCLUDED.is_etf`처럼 기존값 OR.
- JSON 필드: text 컬럼에 JSON으로 저장한 값은 `_parse_json_field`로 역파싱, 저장 시 `json.dumps(...)`. 리스트 컬럼은 결측 시 `[]`, 텍스트는 `""`로 기본화.
- 외부 시세 소스 라우팅: market별 분기(`if market == "KR": ...` / else yfinance). 폴백 체인은 try/except로 단계 하강 (US: yfinance→KIS→error dict; KR: 키움→KIS→Naver — `backend/services/market/__init__.py`, `kr.py`). 외부 호출 실패는 graceful default 반환 (`get_analyst_data`는 예외 시 `{target_mean: None, buy: 0, ...}`).
- 순환참조 회피: 서비스→캐시 등 양방향 의존은 **함수 내부 지연 import** (`get_quote` 안에서 `from services import cache as cache_svc`).
- 병렬화는 `backend/services/parallel.py`의 `parallel_map(func, items, max_workers)` (ThreadPoolExecutor, 빈 입력 빠른 반환). DB 풀(maxconn=20)보다 워커 수가 크지 않게 운용 (calendar 15, analysis 11).

## Backend — NaN/Inf 위생 (핵심 패턴)

- `backend/services/utils.py`의 `sanitize(obj)` — dict/list 재귀 순회하며 `float`이 `nan`/`inf`면 `None`으로 치환. 응답 직렬화 전 출력 정화용.
- **왜 필요한가**: starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 NaN/inf가 있으면 직렬화에서 500(`Out of range float values are not JSON compliant`). 폴백이 증상을 가린다 — PostgreSQL은 `json` 컬럼의 NaN을 거부(저장 실패)하지만 파이썬 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백은 통과 → DB저장 실패+파일 성공+응답 직렬화 실패로 진단이 엇갈림.
- **권장**: 일괄 sanitize보다 **소스에서 가드**(`math.isfinite` 체크 후 "시세 없음" 처리)가 깨끗하다. 외부 시세(yfinance `Close`=NaN, FX/usdkrw=NaN)에서 흘러든 NaN이 합산값(`total_value` 등)을 오염시키는 게 전형 패턴.
- ticker 유효성: `utils.is_valid_ticker` (`TICKER_RE = ^[A-Za-z0-9.\-]{1,15}$`, strip·upper 후 매칭). 리스트 내 ticker 조회는 `find_ticker_index`/`ticker_exists_in`/`find_ticker` (대소문자 무시).

## Backend — additive-vs-reshape API 규율

- **응답 shape는 additive(필드 추가) 선호**, 비-additive reshape(배열→객체 등)는 회피. reshape가 불가피하면 그 엔드포인트를 fetch하는 **모든** 프론트 소비처를 전수 grep (`grep -rn '<경로>' frontend/src/`)해 갱신 (예: `Analytics.jsx`가 훅과 별개로 직접 fetch하는 케이스). 한 곳만 고치면 다른 곳이 옛 shape로 조용히 깨짐.
- **read/외부호출의 additive 추가는 호출 *시퀀스*도 늘린다**: 기존 테스트가 `mock.call_args`(마지막 호출)로 단일 호출을 단언하면 두 번째 호출이 끼는 순간 거짓통과/오류. 대응 — ① 신규 호출은 `if <조건>:`로 입력 비면 생략해 기존 동작 보존, ② 기존 단언은 `call_args_list[i].kwargs`(인덱스 명시)로 마이그레이션, ③ 신규 테스트는 `call_count`로 시퀀스 못박음. (테스트 패턴은 `TESTING.md` 참고.)
- 응답 shape 교체 시 외부 Cowork 파서 영향 주의 (`GET /api/report/list`의 `last_scheduled_date`가 문자열→`{"KR":..,"US":..}` 객체로 변경된 사례 — ADR-0012).
- API 변경 시 명세 2종(`API_SPEC.md` + `CLAUDE_COWORK_API.md`)을 항상 함께 갱신(DoD). 기능 표면 변경 시 `README.md` 해당 절도 같은 PR에서 갱신(DoD).

## Frontend — 스택/스타일

- React 19 + Vite 8 (rolldown 번들러), JSX. 함수형 컴포넌트 + 훅. `frontend/package.json` deps: axios, react-router-dom 7, recharts 3, react-markdown, remark-gfm. 테스트/Tailwind 의존성 없음.
- **plain CSS (No TailwindCSS)** — 컴포넌트별 `.css` 파일을 import (`import './Badge.css'`). 디자인 토큰은 `frontend/src/styles/tokens.css`의 CSS 변수(`:root` + `[data-theme="dark"]`).
- 컴포넌트 파일은 `PascalCase.jsx`, 같은 폴더에 동명 `.css`. 컴포넌트는 default export, 보조 컴포넌트는 named export (`Badge.jsx`의 `MarketBadge`/`ChangeBadge`).
- 들여쓰기 2-space, 세미콜론 생략 스타일. props는 구조분해 + 기본값 (`{ variant = 'neutral', size = 'sm', ... }`).
- API 호출은 `frontend/src/api.js`의 axios 인스턴스 (`import api from '../api'`). request 인터셉터가 `localStorage` access_token을 Bearer로 첨부, response 인터셉터가 401 시 토큰 삭제 후 `/`로 리다이렉트. `baseURL`은 `import.meta.env.VITE_API_BASE_URL || ''` (미설정 시 상대경로 → Vite proxy/nginx).
- Vite 8 = rolldown: `vite.config.js`의 `build.rollupOptions.output.manualChunks`는 **함수 형식만** 받음(객체형 쓰면 빌드 깨짐). `manualChunks(id)`에서 `node_modules` 경로 substring으로 분기.

## Frontend — 색 토큰 관례 (KR 한국식, 핵심 게이트)

- 한국 시장 색: **`--up` = 빨강(상승)**, **`--down` = 파랑(하락)** (`tokens.css`). 서양(녹=좋음/빨=경고)과 반대.
- **Badge variant gotcha**: `ui/Badge.css`에서 `.badge--success` = `--up`(빨강), `.badge--danger` = `--down`(파랑)이다(가격 방향용). `ChangeBadge`는 가격용이라 `value >= 0 ? 'success' : 'danger'`가 의도대로 동작(상승=빨).
- **의미 상태 배지(수급 밴드 등 가격 방향이 아닌 것)에 `success`/`danger`를 쓰면 안 됨** — 색이 KR 가격색으로 박혀 의도와 반전된다(수급 우호=빨/경계=파 버그 사례). 의미 배지는 전용 색을 명시(가격 토큰 미사용). UI 리뷰는 variant 이름 통념이 아니라 토큰 실제값을 대조할 것.
- `badge--warning`은 `--warn`/`--warn-soft`로 매핑돼 있으나(`Badge.css`), `badge--info`는 `--accent-tint`를 참조 — 토큰 정의 여부 확인 필요(미정의 변형은 깨짐). 차트 단위 포매팅은 `frontend/src/components/market/marketUtils.jsx`의 `krFmt`(억/조, 입력은 '억원' 단위 가정 — raw 원/주를 넘기면 오표기).

## Frontend — 훅 관례

- 커스텀 훅은 `frontend/src/hooks/`에 `useXxx.js` (`useAuth`, `useIsMobile`, `usePortfolioData`, `usePriceFlash`, `useReportGeneration`, `useReportList`, `useTheme`).
- 패턴(`useReportList.js`): `useState`로 상태, `useEffect`로 fetch 트리거, `useCallback`으로 fetcher 메모이즈, 데이터 가공 함수는 훅 내부 closure로 두고 파생값과 함께 단일 객체로 반환. 응답 shape 양립 처리(`data.stocks ?? data`)로 additive 변경 흡수.
- Context는 `frontend/src/contexts/` (예: AuthContext가 로그인 시 메뉴 권한 로드해 nav 필터).

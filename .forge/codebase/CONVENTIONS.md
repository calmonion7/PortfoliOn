---
last_mapped_commit: 1bbea86804f93c6f544092809ff8ed13977e5975
mapped: 2026-06-06
---

# 코딩 컨벤션

PortfoliOn 코드베이스의 실제 코드 스타일·네이밍·패턴을 정리한다. 모든 사실은 실제 파일에서 확인한 것이다.

## 언어 및 주석 정책

- 코드 식별자(변수·함수·클래스명)는 영어, **주석과 사용자 노출 문자열은 대부분 한국어**다.
- 예: `backend/services/db.py`의 `query()`/`execute()` docstring이 `"""단일 SELECT — 결과를 dict 리스트로 반환."""` 처럼 한국어다.
- 사용자 노출 에러 메시지도 한국어다. `backend/routers/portfolio.py:86`의 `detail="상장폐지 종목입니다. 등록할 수 없습니다."`, `backend/routers/market_indicators.py:132`의 `detail="이미 백필이 실행 중입니다."`.
- 주석 밀도는 낮은 편이다. 함수 docstring은 "왜/무엇"을 한 줄로 설명할 때만 붙고, 인라인 주석은 비자명한 결정(스레드 안전성, 보존 로직 등)에만 단다. 예: `backend/services/report_generator.py:48`의 `# _t.history / _t.info는 thread-safe하지 않으므로 executor 외부에서 직렬 호출`, `backend/routers/portfolio.py:161`의 `# 편집 가능 필드(name, competitors)만 갱신 — 구조화 분석(moat/growth_plan 등)은 보존`.

---

## 백엔드 (Python / FastAPI)

### 파일 헤더 및 import

- 일부 파일은 경로 주석으로 시작한다: `backend/services/db.py:1`의 `# backend/services/db.py`, `backend/routers/events.py:1`의 `# backend/routers/events.py`. 일관되게 적용되지는 않는다.
- 미래 어노테이션을 쓰는 파일이 있다: `backend/services/utils.py:1`, `backend/services/db.py:2`의 `from __future__ import annotations`. 이 파일들은 PEP 604 union 문법(`ThreadedConnectionPool | None`, `list[dict]`)을 사용한다.
- 서비스/라우터 import는 `from services import storage, errors, report_generator` 형태로 모듈 단위 import 후 `storage.get_holdings(...)`처럼 점 표기로 호출하는 것이 지배적이다 (`backend/routers/portfolio.py:5-9`). 이 패턴은 테스트에서 `patch("routers.portfolio.storage.get_holdings", ...)`로 모킹하기 쉽게 만든다.
- 무거운/순환 의존 import는 함수 내부에서 지연 import 한다. 예: `backend/routers/report.py:446`의 `from services.backlog import get_backlog as _get_backlog`, `backend/services/cache.py:108`의 `from routers import calendar as calendar_router`, `backend/services/analysis_service.py:51`의 `from services.market import _norm_sector`.

### 라우터 구조

라우터는 모두 동일한 골격을 따른다 (`backend/routers/` 전체).

- 모듈 상단에서 `router = APIRouter(prefix="/api/<domain>", tags=["<domain>"])`로 라우터 생성. 예: `backend/routers/portfolio.py:12`, `backend/routers/events.py:17`, `backend/routers/market_indicators.py:21`(prefix `/api/market`).
- 요청 바디는 모듈 레벨 Pydantic `BaseModel` 서브클래스로 정의하고, 기본값을 직접 명시한다. 예: `backend/routers/portfolio.py:46`의 `class Stock(BaseModel)` (`competitors: List[str] = []`, `market: str = "US"`), `backend/routers/events.py:20`의 `class EventBody(BaseModel)` (`properties: dict = {}`), `backend/routers/stocks.py:88`의 `class EnrichBody(BaseModel)`.
- 인증은 의존성 주입으로 일괄 처리한다: `user_id: str = Depends(get_current_user)` (`backend/routers/portfolio.py:60`). admin 전용 엔드포인트는 `Depends(require_admin)` (`backend/routers/market_indicators.py:128`), API 키 허용 엔드포인트는 `Depends(get_current_user_or_api_key)` (`backend/routers/report.py:451`). 인증 의존성은 `backend/auth.py`에 정의돼 있다.
- `main.py`는 각 라우터를 `app.include_router(...)`로 등록한다 (`backend/main.py:73-87`). 앱 lifespan에서 스케줄러 시작/종료와 캐시 워밍 스레드를 띄운다 (`backend/main.py:51-57`).

#### FastAPI `Body(...)` 규칙 (중요)

bare `list`/`dict`를 바디로 받을 때는 반드시 `Body(...)`로 명시해야 한다. Pydantic 모델 없이 받는 유일한 예가 이 규칙을 보여준다:

```python
# backend/routers/report.py:451
@router.put("/report/{ticker}/backlog")
def put_backlog(ticker: str, entries: list = Body(...), user_id: str = Depends(get_current_user_or_api_key)):
```

`= Body(...)`를 빠뜨리면 FastAPI가 query 파라미터로 해석해 기동/요청이 깨진다. 대부분의 엔드포인트는 이를 피하려 Pydantic 모델을 쓰지만, schedule처럼 자유형 dict를 받는 경우엔 `def update_schedule(schedule: dict)`로 모델 파라미터 자체가 바디로 인식되게 한다 (`backend/routers/report.py:470`).

#### 라우터 등록 순서 주의

`PUT /api/stocks/enrich/batch`는 `PUT /api/stocks/{ticker}/enrich`보다 **먼저** 등록해야 `enrich`가 ticker 값으로 라우팅되지 않는다 (`backend/routers/stocks.py`, CLAUDE.md Gotchas 명시).

### 에러 처리

- 공통 HTTP 에러는 `backend/services/errors.py`의 팩토리 함수로 생성한다: `errors.not_found(ticker)` (404), `errors.already_exists(ticker)` (400). 사용 예: `backend/routers/portfolio.py:90,148`.
- 일회성 에러는 라우터에서 직접 `raise HTTPException(status_code=..., detail="...")`로 던진다 (`backend/routers/portfolio.py:86,174`).
- 외부 데이터 조회 엔드포인트(yfinance/외부 API)는 `try/except Exception as e: raise HTTPException(status_code=500, detail=str(e))`로 감싸는 패턴이 일관적이다. `backend/routers/market_indicators.py`의 거의 모든 GET 핸들러가 이 형태다 (예: `:24-29`).
- 베스트-에포트(실패해도 무시) 경로는 `try/except`로 삼키고 진행한다. 예: `backend/routers/events.py:31`의 `_persist`는 `except Exception: pass`, `backend/routers/portfolio.py:74`의 가격 조회 `_fetch`도 예외를 삼키고 빈 dict 반환. 백그라운드 작업 실패는 `print(f"[AutoReport] consensus backfill failed ...")`로 로깅한다 (`backend/routers/portfolio.py:38`).
- 스냅샷 조회는 DB 우선, 실패 시 파일시스템 폴백한다 (`backend/routers/stocks.py:21-44`, `_latest_snapshot`).

### NaN/Inf 직렬화 방어

JSON 직렬화 전 NaN/Inf를 `None`으로 치환하는 것이 표준이다.

- `backend/services/utils.py`의 `sanitize(obj)`가 dict/list를 재귀 순회하며 `math.isnan`/`math.isinf` float을 `None`으로 바꾼다.
- 보통 `from services.utils import sanitize as _sanitize`로 별칭 import 후 응답/저장 직전에 적용한다. 사용처: `backend/routers/report.py:57,154,159`, `backend/services/report_generator.py:165,322`.
- yfinance의 개별 숫자 필드는 `_fin_num(v)` (`backend/services/report_generator.py:18`)로 `math.isfinite` 검사 후 비유한값을 `None`으로 만든다.

### 서비스 계층 패턴

- DB 접근은 전부 `backend/services/db.py`를 거친다. `ThreadedConnectionPool`(minconn=1, maxconn=10) 싱글톤 + `@contextmanager get_connection()`이 커밋/롤백/반환을 책임진다. 단순 조회는 `query(sql, params) -> list[dict]`(RealDictCursor), 변경은 `execute(sql, params) -> int`(rowcount). 다중 statement 트랜잭션은 `with get_connection() as conn:` 직접 사용 (`backend/services/storage.py:49`).
- SQL은 파라미터화 쿼리(`%s` placeholder + 튜플)만 사용한다. 문자열 포매팅으로 값 삽입하는 곳은 없다. UPSERT는 `INSERT ... ON CONFLICT ... DO UPDATE/NOTHING` 패턴 (`backend/services/storage.py:57,79`).
- text 컬럼에 JSON 객체를 저장하는 필드(`moat`, `growth_plan`, `risks`, `recent_disclosures`, `insights`)는 `json.dumps`로 저장하고 `_parse_json_field`로 역파싱한다 (`backend/services/storage.py:5-21,38-45`).
- 병렬 I/O는 `backend/services/parallel.py`의 `parallel_map(func, items, max_workers=10)`(내부 `ThreadPoolExecutor`)을 쓴다. 사용처: `backend/routers/portfolio.py:78`, `backend/services/analysis_service.py:52`. ThreadPool worker 수는 DB 풀 크기(10)를 넘지 않도록 맞춘다(MEMORY 교훈).
- 진행 상태 추적은 `backend/services/progress.py`의 `ProgressTracker`(`threading.Lock`로 보호되는 dict 상태)를 사용한다.
- 인메모리 캐시는 `backend/services/cache.py`의 `TTLCache` 클래스 + 모듈 레벨 싱글톤 인스턴스들(`_dashboard_cache`, `_correlation_cache`, `_sector_cache`, `_macro_cache` 등 TTL 300s)과 LRU `OrderedDict` `_snapshots`(max 50)로 구현. 무효화 헬퍼(`invalidate_dashboard`, `invalidate_portfolio_caches` 등)를 종목 변경 시 호출한다.

### 네이밍 컨벤션 (Python)

- 함수/변수: `snake_case`. 모듈 프라이빗은 선행 언더스코어: `_last_scheduled_date`, `_generate_with_consensus` (`backend/routers/portfolio.py:17,30`), `_fetch_etf`, `_calc_return` (`backend/services/analysis_service.py`).
- 모듈 레벨 상수: `UPPER_SNAKE` 또는 선행 언더스코어 상수. 예: `VALID_EVENTS` (`backend/routers/events.py:8`), `SECTOR_ETFS`/`MACRO_TICKERS` (`backend/services/analysis_service.py:7,21`), `_DAY_MAP` (`backend/routers/portfolio.py:14`), `_ANALYST_KEYS = frozenset({...})` (`backend/services/storage.py:5`).
- 화이트리스트/집합은 `frozenset`로 정의하는 경향(`storage.py:5-6`).

---

## 프론트엔드 (React 18 + Vite, plain CSS)

빌드 도구는 Vite다 (`frontend/package.json`). React 의존성은 `^19.2.5`로 명시돼 있다(package.json 기준). **TailwindCSS·styled-components·CSS Modules를 쓰지 않는다** — `grep`으로 `tailwind`/`styled-components`/`*.module.css` 매칭 0건 확인.

### 스타일링 방식

두 가지를 혼용한다.

1. **CSS 토큰 + BEM 유사 클래스** — 재사용 UI 컴포넌트(`frontend/src/components/ui/`)는 같은 디렉터리의 `.css` 파일을 `import './Card.css'`로 불러오고, `card`, `card--p-md`, `card__header` 같은 BEM 스타일 클래스를 쓴다 (`frontend/src/components/ui/Card.jsx`, `Card.css`). 디자인 토큰은 `frontend/src/styles/tokens.css`의 CSS 변수(`--bg-elev`, `--border`, `--text-3`, `--up`(상승=red)/`--down`(하락=blue), `--radius-md`, `--space-3` 등)로 정의되고 `var(...)`로 참조한다.
2. **인라인 `style={{}}`** — 페이지/일회성 레이아웃은 인라인 스타일을 대량으로 쓴다 (`style={{ ... }}` 약 740회, `pages/` + `components/` 기준). 예: `frontend/src/pages/Portfolio.jsx:18,20`. 색상/간격은 인라인에서도 토큰을 참조한다(`color: 'var(--text-3)'`).

전역/레이아웃 CSS는 `frontend/src/App.css`, `index.css`, `styles/pc.css`, `styles/mobile.css`에 있다.

### 컴포넌트 작성 패턴

- 함수형 컴포넌트만 사용. `export default function Portfolio()` (페이지) 또는 화살표 함수 보조 컴포넌트 `const DashboardGrid = ({ cards, loading }) => {...}` (`frontend/src/pages/Portfolio.jsx:16,26`).
- 재사용 UI 컴포넌트는 `props` 디스트럭처링 + 기본값 + `...props` 스프레드 패턴. `Card`는 `padding='md'`, `as: As='div'`, `className=''`을 받고 클래스 배열을 `.filter(Boolean).join(' ')`로 합성한다 (`frontend/src/components/ui/Card.jsx`). 같은 파일에 `CardHeader` 보조 컴포넌트를 named export.
- UI 컴포넌트 배럴은 `frontend/src/components/ui/index.js`로 묶는다. 아이콘은 `frontend/src/components/ui/icons.jsx`에 모여 named import.

### 상태 관리

- 전역 라이브러리(Redux/Zustand) 없음. **Context + 커스텀 훅** 조합이다.
- 인증/권한은 `frontend/src/contexts/AuthContext.jsx`의 `AuthProvider`가 `/api/auth/me`를 받아 `role`/`menuPermissions`/`loading`을 제공하고, `useAuth()`로 소비한다. 라우팅/내비게이션은 `menuPermissions`로 필터링한다 (`frontend/src/App.jsx:34-46`).
- 토스트는 `frontend/src/components/Toast.jsx`의 `ToastProvider` + `useToast()` 훅.
- 데이터 페칭/로컬 상태는 페이지별 `useState`/`useEffect`/`useCallback` 또는 도메인 커스텀 훅으로 캡슐화한다. `frontend/src/hooks/usePortfolioData.js`는 stocks/watchlist/dashboard/fx 등 다중 상태와 `fetchAll`/`fetchDashboard`(`useCallback`)을 반환한다. 그 외 `useReportGeneration`, `useReportList`, `useTheme`, `useIsMobile`(matchMedia 기반) 훅이 있다(`frontend/src/hooks/`).
- 폼/모달은 컨테이너의 로컬 `useState`로 열림 상태·편집 대상을 관리한다 (`frontend/src/pages/Portfolio.jsx:29-36`).

### API 호출

- 중앙 axios 인스턴스 `frontend/src/api.js`. `baseURL`은 `import.meta.env.VITE_API_BASE_URL || ''`(미설정 시 상대경로 → Vite 프록시).
- 요청 인터셉터가 `localStorage`의 `access_token`을 `Authorization: Bearer`로 자동 첨부. 응답 인터셉터가 401 시 토큰 제거 후 `window.location.href = '/'`로 리다이렉트한다 (`frontend/src/api.js:7-25`).
- 호출은 `api.get/post/put/delete('/api/...')` 형태. 에러는 `err.response?.data?.detail`에서 한국어 메시지를 꺼내 토스트로 보여준다 (`frontend/src/pages/Portfolio.jsx:77`).
- 사용자 행동 이벤트는 `frontend/src/utils/analytics.js`의 `trackEvent(eventName, properties)`로 `fetch('/api/events', ...)` 발송(토큰 없으면 no-op, 실패는 `.catch(() => {})`로 무시). 백엔드는 `VALID_EVENTS` 화이트리스트로 검증한다 (`backend/routers/events.py:8`).

### 네이밍 컨벤션 (JS/JSX)

- 컴포넌트/페이지 파일·컴포넌트명: `PascalCase` (`Portfolio.jsx`, `DashboardCard.jsx`, `StockModal.jsx`).
- 훅: `useXxx` camelCase 파일 (`usePortfolioData.js`, `useIsMobile.js`).
- 변수/함수: `camelCase` (`fetchAll`, `pollReportGeneration`, `handleSave`).
- 세미콜론 미사용, 작은따옴표 문자열, 2-스페이스 들여쓰기가 일관적이다. 린트는 ESLint(`npm run lint`, `eslint-plugin-react-hooks`/`-react-refresh` 사용, `frontend/package.json`).

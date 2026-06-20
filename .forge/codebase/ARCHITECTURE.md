---
last_mapped_commit: 91173837359c5f157349a51501f72efa7342c3fa
mapped: 2026-06-20
---

# Architecture

PortfoliOn은 Python/FastAPI 백엔드(포트 8000)와 React 19 + Vite 프론트엔드(포트 5173)로 구성된 2-tier 웹 애플리케이션이다. 단일 저장소(`/Users/calmonion/Project/PortfoliOn`)에 `backend/`와 `frontend/`를 같이 두고, 운영은 Mac 로컬 Docker 4-컨테이너(nginx / backend / postgres / certbot)로 한다. 데이터 저장소는 Docker PostgreSQL이며 로컬 JSON 파일은 런타임 캐시 용도다.

## Overall Pattern

- **Backend — Router/Service 레이어링**: HTTP 표면은 `backend/routers/`의 `APIRouter`들이 담당하고, 도메인 로직·외부 API 호출·DB 접근은 `backend/services/`로 위임한다. 라우터는 요청 파싱·인증 게이팅·응답 정리(`services.utils.sanitize`)를 하고, 서비스가 실제 일을 한다.
- **Frontend — Pages/Hooks/Components**: `frontend/src/pages/`가 화면(라우트/탭), `frontend/src/hooks/`가 데이터 패칭·상태 로직, `frontend/src/components/`가 표현(presentational) 컴포넌트를 맡는 분리 구조다.
- **Hub-Tab UI**: 상단 nav는 5개 항목(리서치/포트폴리오/시장/구루/설정)이며, 일부는 내부에 탭을 가진 "허브" 페이지다. `Research`(홈 `/`)가 리포트·추천·랭킹·다이제스트·캘린더 탭을, `MarketHub`(`/market`)가 시장지표·수급지표 탭을 묶는다. 허브는 탭별 페이지 컴포넌트를 조건부 렌더링한다.

## Layers

### Backend

1. **Entry point** — `backend/main.py`: `FastAPI` 앱을 생성하고 미들웨어(`SessionMiddleware`, `EventTrackerMiddleware`, `CORSMiddleware`)와 모든 라우터를 `include_router`로 마운트한다. `lifespan`에서 idempotent DDL 마이그레이션(`_migrate`)을 실행하고 스케줄러를 기동(`sched.start()`)하며, 백그라운드 스레드로 캘린더/시장 캐시를 워밍한다.
2. **Routers** (`backend/routers/`) — HTTP 엔드포인트. 인증은 `backend/auth.py`의 `get_current_user`/`require_admin`/`*_or_api_key` 의존성으로 게이팅. 라우터 목록: `auth`, `portfolio`, `report`, `watchlist`, `stocks`, `guru`, `calendar`, `digest`, `market_indicators`, `analytics`, `analysis`, `events`, `rankings`, `investor`, `short_sell`, `batches`, `recommendations`, `admin`.
3. **Services** (`backend/services/`) — 도메인 로직. 외부 시세(yfinance/Naver/키움/KIS), DART 파싱, 컨센서스 파이프라인, 캐시, 스케줄 메타 등. 일부는 서브패키지로 분리됨: `storage/`(포트폴리오·이름·스케줄·날짜), `market/`(US/KR 시세 + 포맷), `market_indicators/`(FX/VIX/원자재/국채/실적/경제/수출/매크로), `kiwoom/`·`kis/`(KR/백업 시세 소스), `recommendation/`(추천 스코어링·퍼널·유니버스·액션·store).
4. **Data access** (`backend/services/db.py`) — `psycopg2` `ThreadedConnectionPool`(minconn 1 / maxconn 20) 기반 `get_connection`/`query`/`execute` 헬퍼. `storage` 패키지 루트가 이를 re-export해 `storage.query` 등으로도 노출(표면 보존).
5. **Scheduler** (`backend/scheduler/`) — APScheduler 패키지(`__init__.py`, `jobs.py`, `schedule.py`, `_state.py`). 배치 작업을 등록·실행하고 결과를 `services.job_runs`에 기록한다.

### Frontend

1. **Entry point** — `frontend/src/main.jsx`: `createRoot`로 `<App/>`를 마운트하고 `styles/tokens.css`·`index.css`를 로드.
2. **App shell** (`frontend/src/App.jsx`): `ToastProvider` → `AuthProvider` → `BrowserRouter` 중첩. OAuth 콜백/토큰 부트스트랩, 세션 로드, `TopNav`(메뉴 권한·role로 필터링), 라우트 정의, `MobileNav`/`InstallPrompt`.
3. **Pages** (`frontend/src/pages/`) — 라우트 화면 및 허브 탭 컴포넌트.
4. **Hooks** (`frontend/src/hooks/`) — `useAuth`, `useTheme`, `useIsMobile`, `usePortfolioData`, `useReportList`, `useReportGeneration`, `usePriceFlash`. 데이터 패칭·파생 상태를 캡슐화해 페이지에 제공.
5. **Contexts** (`frontend/src/contexts/`) — `AuthContext.jsx`(세션·role·메뉴 권한).
6. **Components** (`frontend/src/components/`) — 표현 컴포넌트. 도메인별 하위 디렉터리(`reports/`, `market/`, `portfolio/`, `recommendations/`)와 공용 `ui/` 디자인 시스템.
7. **API client** (`frontend/src/api.js`) — fetch 래퍼. 토큰 첨부·`VITE_API_BASE_URL` 처리(미설정 시 상대경로, Vite가 `/api/*`를 `localhost:8000`으로 프록시).

## Data Flow

### 일반 요청 경로

```
브라우저 (page/hook)
  → frontend/src/api.js (fetch, Bearer 토큰)
  → nginx /api/* 프록시 (운영) | Vite proxy (로컬)
  → FastAPI 라우터 (인증 의존성 + 파싱)
  → 서비스 (도메인 로직)
  → 인메모리 캐시(services/cache.py) 또는 PostgreSQL(services/db.py)
  → 응답 sanitize(NaN/Inf 가드) → JSON
```

`services/cache.py`는 6종 인메모리 캐시(snapshot LRU 200, list TTL 5s, dashboard/correlation/sector/macro TTL 300s)를 운용한다. 종목 추가/수정/삭제 시 dashboard·correlation·sector·macro 캐시가 자동 무효화된다.

### 배치 precompute 경로 (요청은 저장값만 읽음)

외부 API 직렬 호출이 느린 지표(KR 업종 모멘텀·랭킹·수급·시장지표·추천 스코어·배당·공시·수주잔고 등)는 **요청 경로에서 라이브 호출하지 않는다**. 스케줄러 배치가 사전계산해 `market_cache` 또는 전용 테이블(`market_leverage_indicators`, `stock_recommendations`, `stock_dividends` 등)에 저장하고, 요청은 저장값만 읽는다.

```
APScheduler 배치 (backend/scheduler/)
  → 서비스가 외부 API 호출 (yfinance/Naver/키움/KIS/FRED/DART/KOFIA)
  → market_cache 또는 전용 테이블에 저장 (all-None 결과는 박제 금지)
  → services/job_runs.record(id, ...) 로 실행이력 기록
[이후]
GET 요청 → 라우터 → 저장값 read (외부 호출 0)
```

배치 메타데이터(라벨·스케줄·source·usage·market 분류)는 `services/batch_registry.py`의 정적 `BATCHES` 리스트에 정의되고 `GET /api/batches`로 노출된다.

## Key Abstractions

- **`storage` 패키지 (facade)** — `backend/services/storage/__init__.py`가 하위 모듈(`portfolio`, `names`, `schedule`, `dates`)과 `db` 헬퍼의 심볼을 전부 re-export한다. 외부 소비처가 `storage.X` 모듈 속성으로 접근하므로 패키지 루트에 모든 심볼이 존재해야 한다(ADR-0017).
- **이중 시세 소스 체인** — KR은 `get_quote_kr`이 키움→KIS→Naver 폴백, US는 `get_quote_us`가 yfinance→KIS 폴백. 키 미설정이 안전 기본값(휴면).
- **컨센서스 파이프라인** — `consensus_pipeline.py`가 opinion 문자열을 5점 표준 점수로 변환해 `consensus_history`에 저장하는 공통 경로.
- **응답 sanitize** — `services/utils.sanitize`가 NaN/Inf를 가드(starlette `JSONResponse`는 `allow_nan=False`라 미가드 시 500).
- **인증 게이팅** — `backend/auth.py`의 JWT(HS256) 의존성 + admin-only 엔드포인트. 메뉴 권한은 `user_menu_permissions`로 사용자별 nav 제어.
- **Frontend ui/ 디자인 시스템** — `components/ui/`(Badge/Button/Card/Stat/Input/Skeleton/icons + index.js)와 `styles/tokens.css` CSS 변수. KR 색 관례(`--up`=빨강 상승, `--down`=파랑 하락).

## Entry Points

- **Backend**: `backend/main.py` (`app = FastAPI(...)`, uvicorn 진입). 기동: `cd backend && python -m uvicorn main:app --reload --port 8000`.
- **Frontend**: `frontend/src/main.jsx` → `frontend/src/App.jsx`. 기동: `cd frontend && npm run dev`.
- **양쪽 동시**: 루트 `start.sh`(macOS/Linux) / `start.bat`(Windows).

## Notable Recent Refactor

커밋 `91173837`에서 `frontend/src/pages/Reports.jsx`(804줄 god-file)를 447줄로 줄이면서 4개의 인라인 렌더 함수를 표현 컴포넌트로 추출했다: `StockCard.jsx`, `TickerListItem.jsx`, `ReportFilters.jsx`, `ReportDetailHeader.jsx`(모두 `frontend/src/components/reports/`). 로직·상태·핸들러·훅(`useReportList`/`useReportGeneration`/`usePortfolioData` 등)은 `Reports.jsx`에 그대로 남아, 페이지는 데이터·핸들러를 보유하고 추출된 컴포넌트는 props로 받아 그리는 presentational 역할만 한다.

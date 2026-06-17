---
last_mapped_commit: 7f3aec7d6aab5b2ed9837f9aada7405f9505ae6b
mapped: 2026-06-17
---
# Codebase Structure

**Analysis Date:** 2026-06-17

## Directory Layout

```
PortfoliOn/
├── backend/                 # Python/FastAPI 백엔드 (port 8000)
│   ├── main.py              # 앱 진입, 라우터 마운트, lifespan(_migrate + scheduler)
│   ├── scheduler.py         # APScheduler 잡 정의·등록 (services 아님, 루트 레벨)
│   ├── auth.py              # JWT 발급/검증 의존성
│   ├── run_backfill.py      # 수동 백필 스크립트
│   ├── auth_schema.sql      # PostgreSQL 인증 스키마 (users, refresh_tokens) — 먼저 실행
│   ├── app_schema.sql       # PostgreSQL 앱 스키마 (tickers, snapshots, market_cache 등)
│   ├── supabase_schema.sql  # (레거시) Supabase 스키마
│   ├── requirements.txt     # Python 의존성
│   ├── Dockerfile           # 백엔드 컨테이너 이미지
│   ├── routers/             # HTTP 엔드포인트 (18개)
│   ├── services/            # 도메인 로직 + 외부 API 연동
│   │   ├── market_indicators/  # 시장지표 패키지
│   │   ├── kiwoom/          # 키움 REST API (KR 1차 시세)
│   │   └── kis/             # 한국투자증권 REST API (KR/US 백업 시세)
│   ├── middleware/          # EventTrackerMiddleware
│   ├── migrations/          # 일회성 SQL 마이그레이션
│   ├── tests/               # pytest (test_*.py 70+)
│   ├── data/                # 정적 참조 데이터 + 로컬 캐시(일부 gitignored)
│   ├── snapshots/           # per-ticker/date 리포트 JSON (gitignored, legacy fallback)
│   └── reports/             # 레거시 리포트 디렉터리 (gitignored, read-only)
├── frontend/                # React 19 + Vite (port 5173)
│   ├── index.html           # Vite 진입 HTML
│   ├── vite.config.js       # Vite 설정 (proxy /api → :8000, rolldown manualChunks)
│   ├── eslint.config.js     # ESLint flat config
│   ├── package.json         # npm 의존성·스크립트
│   ├── public/              # favicon.svg, icons.svg
│   └── src/
│       ├── main.jsx         # React 진입
│       ├── App.jsx          # BrowserRouter + TopNav (5탭 + admin)
│       ├── api.js           # fetch 래퍼 (VITE_API_BASE_URL)
│       ├── pages/           # 화면 (허브·탭·설정·로그인)
│       ├── components/      # 재사용 컴포넌트
│       │   ├── market/      # 시장지표 섹션
│       │   ├── portfolio/   # DashboardCard 등
│       │   ├── reports/     # 리포트 차트·탭
│       │   └── ui/          # Badge/Button/Card/Stat/icons
│       ├── contexts/        # AuthContext
│       ├── hooks/           # 커스텀 훅
│       ├── styles/          # tokens.css, pc.css, mobile.css
│       └── utils/           # analytics, marketHours, priceFlash, pwa
├── nginx/nginx.conf         # HTTP(80) 서빙 + /api → backend:8000 프록시
├── docker-compose.yml       # 4-컨테이너 (nginx, backend, postgres, certbot)
├── scripts/                 # 배포/유틸 스크립트 (auto-deploy-poll 등)
├── docs/                    # 보조 문서 (ARCHITECTURE/API/TESTING 등)
├── API_SPEC.md              # 전체 REST API 레퍼런스 (소스 오브 트루스)
├── CLAUDE_COWORK_API.md     # 외부 Cowork(Claude) API
├── KIWOOM_API.md            # 키움 API 카탈로그
├── KIS_API.md               # KIS API 카탈로그
├── README.md                # 프로젝트 개요 (화면·env·스택·아키텍처·배치)
└── CLAUDE.md                # 프로젝트 컨텍스트 + 행동 가이드
```

## Directory Purposes

**`backend/routers/`:**
- Purpose: FastAPI 라우터(HTTP 엔드포인트). 라우터당 도메인 1개.
- Key files: `portfolio.py`, `stocks.py`, `watchlist.py`, `report.py`, `market_indicators.py`, `analysis.py`, `analytics.py`, `rankings.py`, `investor.py`, `short_sell.py`, `digest.py`, `calendar.py`, `guru.py`, `events.py`, `batches.py`, `admin.py`, `auth.py`
- 마운트: `backend/main.py:132-148`

**`backend/services/`:**
- Purpose: 도메인 로직·외부 API·캐싱.
- Key files: `storage.py`, `market.py`, `cache.py`, `db.py`, `report_generator.py`, `consensus.py`, `consensus_pipeline.py`, `ranking_service.py`, `investor_service.py`, `short_sell_service.py`, `supply_score.py`, `kr_sector_service.py`, `leverage_service.py`, `lending_service.py`, `dividends.py`, `backlog.py`, `disclosures.py`, `analysis_service.py`, `digest_service.py`, `guru_scraper.py`, `guru_stats.py`, `job_runs.py`, `batch_registry.py`, `schedule_spec.py`, `auth_service.py`, `indicators.py`, `charts.py`, `scraper.py`, `parallel.py`, `progress.py`, `errors.py`, `utils.py`

**`backend/services/market_indicators/`:**
- Purpose: 시장지표 서브패키지. `__init__.py`가 공개 API re-export.
- Key files: `cache.py`(market_cache R/W), `fx.py`, `commodities.py`, `earnings.py`, `econ.py`, `exports.py`, `macro.py`

**`backend/services/kiwoom/`:**
- Purpose: 키움 REST API (KR 전용·읽기전용 1차 시세, `.forge/adr/0009`).
- Key files: `client.py`(토큰·request), `quote.py`(ka10001), `chart.py`(ka10081/82/83), `sector.py`(ka20006/ka20002), `investor.py`(수급), `shortsell.py`(ka10014)

**`backend/services/kis/`:**
- Purpose: 한국투자증권 REST API (KR+US 읽기전용 백업, `.forge/adr/0011`).
- Key files: `client.py`(토큰·request), `quote.py`(국내 FHKST01010100, 해외 HHDFS00000300/76240000)

**`backend/data/`:**
- Purpose: 정적 참조 데이터(committed) + 로컬 런타임 캐시(gitignored).
- Committed: `sp500_tickers.json`, `kospi_tickers.json`, `digest/2026-05-24.json`(샘플)
- Gitignored 하위: `calendar/`(YYYY-MM.json), `consensus/`(per-ticker)

**`frontend/src/pages/`:**
- Purpose: React 화면. 허브 페이지 + 허브 내 탭 컴포넌트 + 설정/관리 화면.

**`frontend/src/components/`:**
- Purpose: 재사용 컴포넌트. 하위 `market/`·`portfolio/`·`reports/`·`ui/`로 도메인 분리.

## Key File Locations

**Entry Points:**
- `backend/main.py`: FastAPI 앱(`app`), lifespan(마이그레이션·스케줄러)
- `backend/scheduler.py`: APScheduler `start/stop/reload`
- `frontend/src/main.jsx`: React 마운트
- `frontend/src/App.jsx`: 라우팅·TopNav

**Configuration:**
- `docker-compose.yml`: 4-컨테이너 정의
- `nginx/nginx.conf`: 정적 서빙 + API 프록시
- `frontend/vite.config.js`: dev proxy + 빌드(rolldown manualChunks는 함수형만)
- `backend/.env.docker`(gitignored): 백엔드 시크릿(POSTGRES_PASSWORD/JWT_SECRET/OAuth/FRED_API_KEY/KOFIA_API_KEY/키움·KIS 키)
- `.env`(루트, gitignored): docker-compose 보간용

**Core Logic:**
- `backend/services/storage.py`: 영속 CRUD
- `backend/services/market.py`: 시세 폴백 체인
- `backend/services/cache.py`: 인메모리 캐시 8종
- `backend/services/batch_registry.py`: 배치 메타데이터

**SQL Schema / Migrations:**
- `backend/auth_schema.sql` → `backend/app_schema.sql` (실행 순서)
- `backend/migrations/001_user_events.sql`, `backend/migrations/002_backlog_history.sql`
- 기동 idempotent DDL: `backend/main.py:_migrate()` (ADD COLUMN/CREATE TABLE IF NOT EXISTS)

**API 명세 (소스 오브 트루스):**
- `API_SPEC.md`: 전체 REST 레퍼런스
- `CLAUDE_COWORK_API.md`: 외부 Cowork API
- API 변경 시 두 문서 함께 갱신(DoD).

**Testing:**
- `backend/tests/test_*.py`, `backend/tests/conftest.py`

## Naming Conventions

**Routers:**
- `<domain>.py` (단수 도메인명), `router = APIRouter(prefix="/api/<domain>", tags=[...])`.
- prefix는 도메인별(`/api/stocks`) 또는 공유 `/api`(report/digest/rankings/investor/short_sell/calendar/batches).

**Services:**
- 도메인 서비스는 `<domain>_service.py`(ranking_service, investor_service, short_sell_service, lending_service, leverage_service, analysis_service, digest_service, auth_service, kr_sector_service, consensus_pipeline).
- 단일 책임 모듈은 명사형(`storage.py`, `market.py`, `cache.py`, `db.py`, `dividends.py`, `backlog.py`, `disclosures.py`, `supply_score.py`).
- 배치 함수: `_fetch_*`/`_refresh_*`/`_generate_*`(scheduler), 조회/저장: `get_*`/`_fetch_and_save_*`(market_indicators).
- 외부 API 클라이언트는 서브패키지(`kiwoom/`, `kis/`)에 `client.py` + TR별 모듈.

**Frontend Components:**
- `PascalCase.jsx`(컴포넌트), 동반 CSS `PascalCase.css`.
- 페이지 = `pages/<Name>.jsx`. 허브 내 탭 컴포넌트도 `pages/`(SectorTab, MacroTab).
- 재사용은 도메인 하위 폴더(`components/market/`, `components/reports/`, `components/ui/`).
- 훅 = `hooks/use<Name>.js(x)`. 컨텍스트 = `contexts/<Name>Context.jsx`.

**Tests:**
- `backend/tests/test_<module>.py` (pytest).

## Where to Add New Code

**New API 엔드포인트:**
- 기존 도메인: 해당 `backend/routers/<domain>.py`에 추가.
- 새 도메인: `backend/routers/<domain>.py` 생성 + `backend/main.py`에 `include_router` 등록 + `API_SPEC.md`/`CLAUDE_COWORK_API.md` 갱신.
- 도메인 로직은 `backend/services/`에(라우터는 얇게).

**New Service:**
- `backend/services/<domain>_service.py` 또는 명사형 모듈. DB 접근은 `from services.db import query, execute`.

**New 외부 시세/지표:**
- 시장지표는 `backend/services/market_indicators/<name>.py` + `__init__.py` re-export + `market_cache` key.
- 키움 TR은 `backend/services/kiwoom/<name>.py`, KIS는 `backend/services/kis/`.

**New 배치:**
- `backend/scheduler.py`에 `_fetch_*` 함수 + `_JOB_FUNCS` 엔트리.
- `backend/services/batch_registry.py` `BATCHES`에 메타(id·source·usage·market·schedule) 추가 — job_id는 스케줄러·`job_runs.record`·UI와 일치.

**New 프론트 화면:**
- 허브 내 탭: `frontend/src/pages/<Name>.jsx` + 해당 허브에서 조건부 렌더.
- 새 nav 탭: `pages/<Name>.jsx` + `App.jsx` `<Route>` + `TopNav allItems` + `admin.py ALL_MENUS` 권한 키.
- 재사용 UI: `components/ui/`(원시) 또는 도메인 폴더.

**New Test:**
- `backend/tests/test_<module>.py`. 로컬 pytest: `cd backend && .venv/bin/python -m pytest`.

**Tests:**
- 위치: `backend/tests/` (co-located 아님, 별도 디렉터리)
- 실행: `cd backend && .venv/bin/python -m pytest`

## Special Directories

**`backend/snapshots/`:**
- Purpose: per-ticker/date 리포트 JSON (legacy fallback).
- Generated: Yes / Committed: No (gitignored)

**`backend/data/calendar/`, `backend/data/consensus/`:**
- Purpose: 월별 캘린더 / per-ticker 컨센서스 로컬 파일 캐시.
- Generated: Yes / Committed: No (gitignored)

**`backend/reports/`:**
- Purpose: 레거시 리포트(read-only fallback).
- Generated: Yes / Committed: No (gitignored)

**`backend/data/` (정적):**
- `sp500_tickers.json`, `kospi_tickers.json` — 정적 참조 티커 목록.
- Committed: Yes

**`frontend/dist/`:**
- Purpose: 빌드 산출물. nginx가 `:ro` 볼륨마운트로 직접 서빙(로컬 `npm run build`가 즉시 라이브).
- Generated: Yes / Committed: No

**`.forge/`:**
- Purpose: 작업 계획·ADR·완료 기록·코드맵(이 문서). untracked(자동 배포 폴러 `reset --hard` 대상 아님).

---

*Structure analysis: 2026-06-17*

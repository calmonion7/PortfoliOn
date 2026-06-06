---
last_mapped_commit: 1bbea86804f93c6f544092809ff8ed13977e5975
mapped: 2026-06-06
---

# STRUCTURE

## 루트 레이아웃

```
/Users/calmonion/Project/PortfoliOn/
├── backend/            FastAPI 백엔드 (Python)
├── frontend/           React + Vite SPA
├── nginx/nginx.conf    nginx 프록시/정적 서빙 설정
├── certbot/            Let's Encrypt 인증서 디렉터리
├── docker-compose.yml  4-컨테이너 정의 (postgres/backend/nginx/certbot)
├── deploy.sh           배포 스크립트
├── start.sh / start.bat / stop.sh / stop.bat  로컬 양쪽 서버 기동/종료
├── API_SPEC.md         REST API 레퍼런스(엔드포인트의 source of truth)
├── CLAUDE_COWORK_API.md 외부 Claude AI용 API 문서
├── CLAUDE.md           프로젝트 가이드라인/컨텍스트
├── README.md
├── docs/               문서
├── scripts/            보조 스크립트 (Node) — screenshot.js, check-permissions.js 등
└── supabase/           레거시(Supabase 잔존, 사용 안 함)
```

## 백엔드 (`backend/`)

```
backend/
├── main.py                 앱 진입점 — 미들웨어 + 15개 라우터 마운트 + lifespan
├── scheduler.py            APScheduler 설정 (루트 레벨, services 아님)
├── auth.py                 JWT/API키 인증 의존성 (get_current_user, require_admin 등)
├── run_backfill.py         스냅샷 백필 실행 스크립트
├── Dockerfile              python:3.12-slim + uvicorn
├── Procfile                프로세스 정의
├── requirements.txt        Python 의존성
├── pytest.ini              pytest 설정
├── auth_schema.sql         인증 스키마 (users, refresh_tokens) — app_schema보다 먼저 실행
├── app_schema.sql          앱 스키마 (아래 표 참조)
├── supabase_schema.sql     레거시 Supabase 스키마 (사용 안 함)
├── .env / .env.docker / .env.docker.example  환경변수
├── routers/                HTTP 라우터 (얇은 어댑터)
├── services/               도메인 로직 + 외부 API + 영속성
├── middleware/             요청 미들웨어
├── migrations/             SQL 마이그레이션
├── data/                   정적 참조 데이터 + 런타임 JSON 캐시
├── snapshots/              생성된 리포트 스냅샷 (gitignored, per-ticker/date)
├── reports/                레거시 리포트 디렉터리 (read-only JSON/MD 폴백)
└── tests/                  pytest 스위트
```

### `backend/routers/` (라우터 → 서비스 위임)

각 파일은 `APIRouter(prefix=...)`를 정의한다. 마운트는 `backend/main.py`에서 수행.

| 파일 | prefix |
|------|--------|
| `auth.py` | `/api/auth` |
| `portfolio.py` | `/api/portfolio` |
| `watchlist.py` | `/api/watchlist` |
| `stocks.py` | `/api/stocks` (enrich/batch 라우트는 `{ticker}/enrich`보다 먼저 등록해야 함) |
| `report.py` | `/api` |
| `guru.py` | `/api/guru` |
| `calendar.py` | `/api` (파일 캐시 사용) |
| `digest.py` | `/api` |
| `market_indicators.py` | `/api/market` |
| `analytics.py` | `/api/analytics` |
| `analysis.py` | `/api/analysis` |
| `events.py` | `/api/events` |
| `rankings.py` | `/api` |
| `investor.py` | `/api` |
| `admin.py` | `/api/admin` |

### `backend/services/` (도메인 로직 계층)

영속성 기반:
- `db.py` — `ThreadedConnectionPool`(maxconn=10) + `query()`/`execute()`/`get_connection()`
- `storage.py` — 앱 도메인 테이블 CRUD (tickers/user_stocks/schedules/guru_*)
- `cache.py` — 인메모리 캐시 6종 (snapshot LRU 50, list 60s, dashboard/correlation/sector/macro 각 300s)

데이터 수집/가공:
- `market.py` — yfinance + Naver 시세/기본정보
- `charts.py` — 차트 생성
- `indicators.py` — RSI 등 기술지표
- `report_generator.py` — `generate_report()` / `backfill_ticker()`
- `scraper.py`, `guru_scraper.py`, `guru_stats.py` — 크롤링/집계
- `consensus.py`, `consensus_pipeline.py` — 컨센서스 수집 + 점수 표준화 파이프라인(`run_daily`)
- `digest_service.py` — 일일 다이제스트 생성/텔레그램 전송
- `leverage_service.py` — KOFIA 신용잔고/반대매매 → `market_leverage_indicators`
- `lending_service.py` — 금융위 대차잔고 → `market_lending_balance`
- `ranking_service.py` — KR/US 시장 랭킹 → `market_rankings`
- `investor_service.py` — 수급 추이 → `market_investor_trend` (`fetch_trend`/`upsert_trend`/`oldest_date`)
- `analysis_service.py` — 섹터 모멘텀(SECTOR_ETFs), 매크로 상관관계(MACRO_TICKERS)
- `backlog.py` — 수주잔고 파싱

공통 유틸:
- `utils.py` — NaN/Inf sanitize
- `errors.py`, `parallel.py`, `progress.py`, `auth_service.py`

#### `backend/services/market_indicators/` (서브패키지)

```
market_indicators/
├── __init__.py      퍼사드 — 서브모듈 공개 함수 재노출 (get_fx, get_vix, get_commodities ...)
├── cache.py         인메모리 + PostgreSQL market_cache 읽기/쓰기 (_mc_load/_mc_save/get_or_refresh, _yf_close_history)
├── fx.py            FX / VIX
├── commodities.py   원자재 / 국채(treasury)
├── earnings.py      M7 / KR Top2 실적 (get_* + _fetch_and_save_*)
├── econ.py          FRED 경제지표 (FRED_API_KEY)
└── exports.py       KR 수출 (관세청 KITA_API_KEY, 미설정 시 UN Comtrade 폴백)
```

### `backend/middleware/`

- `event_tracker.py` — `EventTrackerMiddleware`. `_TRACKED` 라우트 목록에 대해 2xx 시 JWT에서 user_id 추출 후 `user_events`에 비동기 기록.

### `backend/migrations/`

- `001_user_events.sql`, `002_backlog_history.sql` — 수동 적용 SQL 마이그레이션.

### `backend/data/`

정적 참조 데이터:
- `sp500_tickers.json`, `kospi_tickers.json` — 종목 마스터 참조

런타임/레거시 JSON (대부분 gitignored, DB로 이전됨):
- `data/calendar/YYYY-MM.json` — 월별 캘린더 이벤트 파일 캐시 (gitignored)
- `data/consensus/` — per-ticker 컨센서스 캐시 (gitignored)
- `data/digest/`, `data/guru_managers.json`, `data/guru_schedule.json`, `data/holdings.json`, `data/schedule.json`, `data/stocks.json`, `data/watchlist.json`, `data/kr_exports.json` — 레거시 파일 잔존

### `backend/tests/`

`conftest.py` + 라우터별/서비스별 pytest (`test_<router>_router.py`, `test_<service>.py`, `test_scheduler_*.py` 등). 실행: `cd backend && .venv/bin/python -m pytest`.

## 스키마 파일

적용 순서: `auth_schema.sql` → `app_schema.sql` (docker-compose가 `01-auth.sql`/`02-app.sql`로 마운트해 init 시 자동 실행).

`backend/auth_schema.sql` 테이블:
- `users` (이메일/OAuth, role: user|admin)
- `refresh_tokens`

`backend/app_schema.sql` 테이블:
- `tickers`, `snapshots`, `user_stocks`, `schedules`
- `guru_managers`, `guru_schedules`
- `digests`, `consensus_history`, `calendar_cache`, `market_cache`
- `user_menu_permissions`, `default_menu_permissions`
- `raw_reports`, `daily_consensus_mart`, `user_events`
- `market_leverage_indicators`, `market_lending_balance`(IF NOT EXISTS)
- `backlog_history`, `market_rankings`, `market_investor_trend`(IF NOT EXISTS)

## 프론트엔드 (`frontend/src/`)

```
frontend/src/
├── main.jsx              React 진입점
├── App.jsx               최상위 — OAuth 처리, 라우팅, TopNav/MobileNav
├── api.js                axios 인스턴스 (Bearer 부착, 401 처리)
├── utils.js              범용 유틸
├── App.css / index.css   전역 스타일
├── contexts/
│   └── AuthContext.jsx   role + menu_permissions 로드 (GET /api/auth/me)
├── hooks/
│   ├── useAuth.js
│   ├── useIsMobile.js
│   ├── usePortfolioData.js
│   ├── useReportGeneration.js
│   ├── useReportList.js
│   └── useTheme.js
├── utils/
│   └── analytics.js      trackEvent (POST /api/events)
├── styles/
│   ├── tokens.css        디자인 토큰
│   ├── pc.css
│   └── mobile.css
├── assets/               hero.png, react.svg, vite.svg
├── pages/                라우트/탭 단위 페이지
└── components/           재사용 컴포넌트 (서브폴더 분류)
```

### `frontend/src/pages/`

허브 페이지(최상위 라우트):
- `Portfolio.jsx` (`/`) — 종목관리 + 분석탭(섹터/매크로/상관관계 통합)
- `Research.jsx` (`/research`) — 리포트·캘린더·다이제스트 탭 허브
- `MarketHub.jsx` (`/market`) — 시장지표·분석 탭 허브
- `Guru.jsx` (`/guru`), `Settings.jsx` (`/settings`)
- `AdminAnalytics.jsx` (`/admin-analytics`, admin 전용), `Showcase.jsx` (`/dev/showcase`)
- `LoginPage.jsx` — 미인증 시 렌더

허브 내 탭/하위 페이지:
- `Reports.jsx`, `Calendar.jsx`, `Digest.jsx` (Research 탭)
- `Market.jsx`, `Analytics.jsx`, `Ranking.jsx` (MarketHub/시장 탭)
- `SectorTab.jsx`, `MacroTab.jsx` (Portfolio 분석탭으로 통합됨)
- 설정류: `ConsensusSettings.jsx`, `ReportSchedule.jsx`, `GuruCrawlSettings.jsx`, `GuruManagers.jsx`, `GuruStats.jsx`, `LeverageBackfillSettings.jsx`

### `frontend/src/components/` (서브폴더로 분류)

루트 레벨 컴포넌트:
- `StockModal.jsx`, `PromoteModal.jsx`
- `PermissionManager.jsx`, `PermissionPanel.jsx`
- `LoadingSpinner.jsx`, `MobileNav.jsx`, `Toast.jsx`(ToastProvider)

`components/market/` — 시장지표 섹션:
- `FxSection.jsx`, `VixSection.jsx`, `CommoditiesSection.jsx`, `TreasurySection.jsx`
- `EconIndicatorsSection.jsx`, `M7EarningsSection.jsx`, `KrTop2Section.jsx`, `KrExportsSection.jsx`
- `LeverageSection.jsx`, `LendingSection.jsx`
- `marketUtils.jsx` (`krFmt` 등 억/조 포매팅 헬퍼)

`components/reports/` — 리포트 상세:
- `DetailTab.jsx`, `HistoryTab.jsx`, `Sections.jsx`
- `ConsensusChart.jsx`, `FinancialsChart.jsx`, `BacklogChart.jsx`, `InvestorTrendSection.jsx`
- `reportUtils.jsx`

`components/portfolio/`:
- `DashboardCard.jsx` + `DashboardCard.css`

`components/ui/` — 디자인 시스템 프리미티브:
- `Badge.jsx`/`.css`, `Button.jsx`/`.css`, `Card.jsx`/`.css`, `Stat.jsx`/`.css`
- `icons.jsx`, `index.js`(배럴 export)

## 명명 규칙

- **백엔드**: 라우터는 `routers/<도메인>.py`, 서비스는 `services/<도메인>_service.py` 또는 `services/<도메인>.py`. 비공개/내부 함수는 `_` 접두사(`_mc_load`, `_fetch_and_save_*`, `_reschedule`). 스케줄러 작업 함수는 `_<verb>_<noun>` 패턴(`_fetch_leverage`, `_run_digest`).
- **프론트엔드**: 컴포넌트/페이지는 PascalCase `.jsx`. 훅은 `use<Name>.js`. 동일 컴포넌트의 스타일은 같은 이름 `.css`(`DashboardCard.jsx`+`DashboardCard.css`). 섹션 컴포넌트는 `<Domain>Section.jsx`.
- **스키마**: 마이그레이션은 `NNN_<설명>.sql`(zero-padded 번호).
- **테스트**: `test_<대상>.py`, 라우터 테스트는 `test_<도메인>_router.py`.

## 어디서 무엇을 찾는가

- REST 엔드포인트 정의/계약: `API_SPEC.md`, 실제 핸들러는 `backend/routers/`
- 외부 Claude Cowork API: `CLAUDE_COWORK_API.md` + `auth.py`의 `get_current_user_or_api_key`
- DB 스키마(테이블 정의): `backend/auth_schema.sql`, `backend/app_schema.sql`
- DB 접근/풀: `backend/services/db.py`
- 캐시 무효화 로직: `backend/services/cache.py`(앱), `backend/services/market_indicators/cache.py`(시장지표)
- 스케줄 작업/cron: `backend/scheduler.py`
- 인증/권한 게이트: `backend/auth.py`(의존성), `backend/services/auth_service.py`(role 조회), `frontend/src/contexts/AuthContext.jsx`(프론트 메뉴 필터)
- 사용자 행동 추적: `backend/middleware/event_tracker.py` + `backend/routers/events.py` + `frontend/src/utils/analytics.js`
- 프론트 API 클라이언트/토큰 처리: `frontend/src/api.js`
- nginx/배포 토폴로지: `nginx/nginx.conf`, `docker-compose.yml`, `backend/Dockerfile`

---
last_mapped_commit: c482aa6811262685f424cb8fb871e8121cf438c6
mapped: 2026-07-02
---

# Structure

레포 루트: `/Users/calmonion/Project/PortfoliOn`. 최상위 두 앱: `backend/`(Python/FastAPI)와 `frontend/`(React 19 + Vite). 문서·계약은 루트에.

## 최상위

- `backend/` — FastAPI 앱, 서비스, 스케줄러, 스키마, 테스트.
- `frontend/` — Vite React 앱.
- `API_SPEC.md` — 전체 REST API 레퍼런스(엔드포인트 정본).
- `CLAUDE_COWORK_API.md` — 외부 Cowork enrich API.
- `KIWOOM_API.md`, `KIS_API.md` — 브로커 API 카탈로그·로드맵.
- `README.md`, `CLAUDE.md` — 개요 + 프로젝트 지침.
- `start.sh` / `start.bat` / `stop.bat`, `deploy.sh`, `docker-compose.yml` — 실행·배포.
- `.forge/` — forge 상태(ADR은 `.forge/adr/`, 레트로는 `.forge/retro/`, 코드베이스 지도는 `.forge/codebase/`).

## 백엔드 레이아웃 (`backend/`)

- `main.py` — 앱 기동: `_migrate()`(idempotent 기동 DDL), `lifespan`(migrate→`sched.start()`→`_warm_market_cache` 데몬 스레드), 미들웨어·라우터 배선, `/health`.
- `auth.py` — `get_current_user`, `require_admin`, `require_admin_or_api_key` 의존성.
- `auth_schema.sql` — PostgreSQL 인증 스키마(`users`, `refresh_tokens`). `app_schema.sql` 보다 먼저 실행.
- `app_schema.sql` — PostgreSQL 앱 스키마(tickers, user_stocks, snapshots, schedules, guru_*, digests, consensus_history, calendar_cache, market_cache, user_menu_permissions, user_events, market_leverage_indicators, market_lending_balance 등). 신규 테이블은 `main.py:_migrate()`가 idempotent 추가.
- `Dockerfile`, `requirements.txt`, `pytest.ini`, `.env.docker`(+ `.example`), `run_backfill.py`.
- `.venv/` — 로컬 Python 가상환경(macOS: `.venv/bin/python`). `lxml`은 로컬 venv 부재(Docker엔 있음) — 로컬 pytest 대상 코드는 `BeautifulSoup(html, "html.parser")` 사용.

### `backend/routers/` (HTTP 표면당 모듈 1개)

`admin.py`, `analysis.py`, `analytics.py`, `auth.py`, `batches.py`, `calendar.py`, `digest.py`, `events.py`, `guru.py`, `investor.py`, `market_indicators.py`, `portfolio.py`, `rankings.py`, `recommendations.py`, `report.py`, `short_sell.py`, `stocks.py`, `watchlist.py`.

각 모듈이 `router = APIRouter(...)` 정의; `main.py`가 전부 `include_router`.

### `backend/services/` (단일 모듈 + 패키지 혼합)

**패키지:**
- `market/` — `__init__.py`(re-export + `get_quote`/`resolve_name`), `format.py`(심볼·값·가격 헬퍼), `kr.py`(KR 시세 체인 키움→KIS→Naver), `us.py`(US 시세 yfinance→KIS, 연간 재무).
- `market_indicators/` — `cache.py`(PostgreSQL `market_cache` r/w), `fx.py`, `commodities.py`, `earnings.py`, `econ.py`(FRED), `exports.py`, `macro.py`, `indices.py`(지수 레벨 + S&P500 CAPE).
- `kiwoom/` — `client.py`, `quote.py`, `chart.py`, `investor.py`, `sector.py`, `shortsell.py`.
- `kis/` — `client.py`, `quote.py`.
- `storage/` — `__init__.py`(flat re-export), `portfolio.py`, `names.py`, `schedule.py`, `dates.py`.
- `recommendation/` — `__init__.py`, `universe.py`, `scoring.py`, `funnel.py`, `store.py`, `actions.py`.

**주요 단일 모듈:**
`agm.py`, `backlog.py` + `backlog_parser.py`, `disclosures.py`, `dividends.py`, `supply_score.py`, `insider_trades.py`, `us_supply.py`, `short_sell_service.py`, `investor_service.py`, `ranking_service.py`, `kr_sector_service.py`, `leverage_service.py`, `lending_service.py`, `consensus.py`, `consensus_pipeline.py`, `report_generator.py`, `digest_service.py`, `analysis_service.py`, `guru_scraper.py`, `guru_stats.py`, `scraper.py`, `indicators.py`, `batch_registry.py`, `job_runs.py`, `schedule_spec.py`, `cache.py`, `db.py`, `utils.py`, `errors.py`, `parallel.py`, `progress.py`, `auth_service.py`.

### `backend/scheduler/` 패키지 (단일 `scheduler.py` 아님)

- `__init__.py` — 공개 `start()`/`stop()`/`reload()`, 잡 함수·`_JOB_FUNCS`·스케줄 헬퍼 re-export.
- `_state.py` — APScheduler 싱글톤·상수(leaf 모듈).
- `jobs.py` — 잡 바디 함수 전체 + `_JOB_FUNCS` 맵.
- `schedule.py` — 트리거 생성, reschedule, 스케줄 시드·마이그레이션, 누락 리포트 복구.

### 기타 백엔드 디렉터리

- `middleware/` — `event_tracker.py`(`EventTrackerMiddleware`).
- `migrations/` — 원샷 SQL(001·002). 라이브 idempotent 마이그레이션은 `main.py:_migrate()`에.
- `data/` — 정적 참조 데이터(`sp500_tickers.json`, `kospi_tickers.json`) + 로컬 파일 캐시(`calendar/`, `consensus/`, gitignored).
- `snapshots/` — 종목별 생성 JSON(gitignored).
- `reports/` — 레거시 읽기전용 JSON 폴백.
- `tests/` — pytest 스위트(`test_*.py`, 70개 이상).

## 프론트엔드 레이아웃 (`frontend/src/`)

- `main.jsx` — React 진입점(`createRoot`, `<App/>` 마운트).
- `App.jsx` — 라우터·nav·인증 부트스트랩(OAuth code 교환, `menuPermissions` 기반 nav 필터). 라우트: `/`+`/research`→Research, `/portfolio`→Portfolio, `/market`→MarketHub, `/guru`→Guru, `/settings`→Settings, `/admin-analytics`→AdminAnalytics, `/dev/showcase`→Showcase, `/analysis`→redirect to `/portfolio`.
- `api.js` — Bearer-token 인터셉터·401 토큰 클리어 공유 axios 인스턴스. `utils.js` — 기타 헬퍼.

### `pages/` (라우트 화면)

허브: `Research.jsx`(홈 `/`, 리포트·추천·랭킹·다이제스트·캘린더 탭), `MarketHub.jsx`(시장지표·수급지표 탭).

독립 페이지(허브 내 탭용): `Reports.jsx`, `Recommendations.jsx`, `Ranking.jsx`, `Calendar.jsx`, `Digest.jsx`, `Analytics.jsx`.

전용 페이지: `Portfolio.jsx`, `Guru.jsx` + `GuruCrawlNow.jsx` + `GuruManagers.jsx` + `GuruStats.jsx`, `Settings.jsx`, `ConsensusSettings.jsx`, `LeverageBackfillSettings.jsx`, `LoginPage.jsx`, `AdminAnalytics.jsx`, `Showcase.jsx`, `SectorTab.jsx`, `MacroTab.jsx`, `ReportManualGen.jsx`, `Market.jsx`.

`Research.jsx`는 `location.state?.tab` / `location.state?.ticker`로 딥링크를 수신해 `<Reports initialTicker={deepTicker} />`에 전달.

### `components/`

최상위: `StockModal.jsx`, `PromoteModal.jsx`, `PermissionManager.jsx`, `PermissionPanel.jsx`, `LoadingSpinner.jsx`, `MobileNav.jsx`, `Toast.jsx`, `InstallPrompt.jsx`, `BatchScheduleEditor.jsx`.

- `reports/` — 리포트 목록·상세 위젯: `ReportDetailTabs.jsx`(탭 셸), `ReportDetailHeader.jsx`, `DetailTab.jsx`, `HistoryTab.jsx`, `Sections.jsx`, `ReportFilters.jsx`, `reportUtils.jsx`, `StockActions.jsx`(액션 버튼 단일 컴포넌트, `layout="card"|"list"`), `StockCard.jsx`, `TickerListItem.jsx`, `ConsensusChart.jsx`, `FinancialsChart.jsx`, `BacklogChart.jsx`, `SupplySection.jsx`, `ShortSellSection.jsx`, `InvestorTrendSection.jsx`, `LatestDisclosuresSection.jsx`, `InsiderTradesSection.jsx`. US 전용(기술·수급 하위탭): `UsSupplySection.jsx`, `UsInsiderSection.jsx`, `GuruHoldersSection.jsx`.
- `market/` — 시장지표 섹션 위젯: `FxSection`, `VixSection`, `CommoditiesSection`, `TreasurySection`, `EconIndicatorsSection`, `M7EarningsSection`, `KrTop2Section`, `KrExportsSection`, `LeverageSection`, `LendingSection`, `MacroSignalsSection`, `IndexSection`, `marketUtils.jsx`.
- `portfolio/` — `DashboardCard.jsx`, `FlashValue.jsx`, `PriceFreshness.jsx`.
- `recommendations/` — `RecCard.jsx`.
- `ui/` — 프리미티브: `Badge`, `Button`, `Card`, `Stat`, `Input`, `Skeleton`, `icons.jsx`, `index.js`, `InsiderBadge.jsx`, `SupplyBadge.jsx`(가격 방향 토큰 `success`/`danger` 미사용 — 전용 색 명시).

### `hooks/`

`useAuth.js`, `useTheme.js`, `useIsMobile.js`, `usePortfolioData.js`, `usePriceFlash.js`, `useReportFilters.js`(+ 테스트), `useReportGeneration.js`, `useReportList.js`, `useStockManagement.js`(+ 테스트).

### 기타 프론트엔드

- `contexts/` — `AuthContext.jsx`(auth + `menuPermissions` + `role`).
- `utils/` — `analytics.js`, `marketHours.js`, `priceFlash.js`, `pwa.js`.
- `styles/` — `tokens.css`(CSS 커스텀 프로퍼티; KR 색 관례 `--up`=빨강/`--down`=파랑), `pc.css`, `mobile.css`.
- `test/` — Vitest 하니스: `setup.js`, `smoke.test.js`, `recommendations-s3s4.test.jsx`.

## 테스트

**백엔드**: `backend/tests/`에 pytest 스위트(70개 이상). `conftest.py`가 `main.app` 기반 TestClient + `get_current_user` override 제공. 자체-app 테스트(`test_stocks_router.py` 등)는 `FastAPI()` 직접 생성 → 새 auth 의존성 추가 시 해당 테스트에도 override 추가 필수.

**프론트엔드**: Vitest(`vite.config.js` `test:` 섹션, `setupFiles: './src/test/setup.js'`). `hooks/useStockManagement.test.js`, `hooks/useReportFilters.test.js`, `test/smoke.test.js`, `test/recommendations-s3s4.test.jsx`.

API 명세 드리프트 자동 검출: `tests/test_api_doc_sync.py` — 라이브 `app.routes` ↔ `API_SPEC.md`·`CLAUDE_COWORK_API.md` `### \`METHOD /path\`` 헤더 대조(존재 여부만; prose 파싱 없음).

## 네이밍 관례

- **백엔드**: `snake_case` 모듈·함수; private 헬퍼 `_` 접두사. 스케줄러 잡 바디는 `_fetch_<x>` / `_refresh_<x>` / `_generate_<x>`; 공개 job id는 `batch_registry.BATCHES`, `_JOB_FUNCS`, `job_runs.record` 세 곳에서 동일 문자열 필수.
- **패키지 분리(ADR-0017)**: "god-file을 패키지로 분리" 시 `__init__.py`가 기존 flat 공개 표면(underscore 심볼 포함)을 re-export해 소비처 import를 무변경 유지.
- **프론트엔드**: `PascalCase.jsx` 컴포넌트·페이지, `camelCase.js` 훅·유틸; 훅 `use` 접두사. Plain CSS(Tailwind 없음); CSS는 컴포넌트 동위에 `*.css`. 도메인 섹션 위젯은 `<Domain>Section.jsx`.
- **SQL**: 테이블 `snake_case`; idempotent DDL은 `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`.

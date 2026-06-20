---
last_mapped_commit: 91173837359c5f157349a51501f72efa7342c3fa
mapped: 2026-06-20
---

# Structure

저장소 루트는 `/Users/calmonion/Project/PortfoliOn`이다. 핵심은 `backend/`(Python/FastAPI)와 `frontend/`(React 19 + Vite) 두 디렉터리이며, 운영 인프라 파일(docker-compose, nginx, 배포 스크립트), 명세서(`API_SPEC.md`, `CLAUDE_COWORK_API.md`, `KIWOOM_API.md`, `KIS_API.md`), 그리고 forge 상태(`.forge/`)가 루트에 함께 있다.

## Top-Level Layout

```
PortfoliOn/
├── backend/            # Python/FastAPI 앱
├── frontend/           # React 19 + Vite SPA
├── .forge/             # forge 워크플로우 상태 (codebase 맵·adr·backlog·retro 등)
├── scripts/            # 배포/폴러 스크립트 (auto-deploy-poll.sh 등)
├── API_SPEC.md         # 전체 REST API 레퍼런스 (엔드포인트 source of truth)
├── CLAUDE_COWORK_API.md# 외부 Cowork(분석 read/write) API
├── KIWOOM_API.md / KIS_API.md  # 외부 시세 API 카탈로그
├── README.md / CLAUDE.md
├── start.sh / start.bat / stop.bat
└── docker-compose / nginx 설정
```

## Backend Layout (`backend/`)

```
backend/
├── main.py             # 앱 entry: 미들웨어·라우터 마운트·lifespan(_migrate + 스케줄러 start)
├── auth.py             # JWT 인증 의존성 (get_current_user / require_admin / *_or_api_key)
├── auth_schema.sql     # 인증 스키마 (users, refresh_tokens) — app_schema 보다 먼저 실행
├── app_schema.sql      # 앱 스키마 (tickers, user_stocks, snapshots, market_cache 등)
├── supabase_schema.sql # legacy (Supabase 시절 스키마)
├── requirements.txt / pytest.ini / Dockerfile / Procfile
├── run_backfill.py     # 백필 진입 스크립트
├── routers/            # APIRouter 모듈 (HTTP 표면)
├── services/           # 도메인 로직 (외부 API·DB·캐시·파싱)
├── scheduler/          # APScheduler 패키지 (__init__/jobs/schedule/_state)
├── middleware/         # event_tracker (사용자 행동 로깅 미들웨어)
├── migrations/         # 마이그레이션 자산
├── tests/              # pytest 테스트
├── data/               # 정적 참조 데이터 (sp500/kospi 티커) + 로컬 캐시 (calendar/consensus)
├── snapshots/          # 생성된 JSON 스냅샷 (gitignored)
├── reports/            # legacy 리포트 (read-only JSON fallback)
└── .venv/              # 로컬 가상환경 (macOS: .venv/bin/python)
```

### `backend/routers/`

`admin.py`, `analysis.py`, `analytics.py`, `auth.py`, `batches.py`, `calendar.py`, `digest.py`, `events.py`, `guru.py`, `investor.py`, `market_indicators.py`, `portfolio.py`, `rankings.py`, `recommendations.py`, `report.py`, `short_sell.py`, `stocks.py`, `watchlist.py` (+ `__init__.py`).

### `backend/services/`

평면 모듈: `analysis_service.py`, `auth_service.py`, `backlog.py`, `backlog_parser.py`, `batch_registry.py`, `cache.py`, `charts.py`, `consensus.py`, `consensus_pipeline.py`, `db.py`, `digest_service.py`, `disclosures.py`, `dividends.py`, `errors.py`, `guru_scraper.py`, `guru_stats.py`, `indicators.py`, `insider_trades.py`, `investor_service.py`, `job_runs.py`, `kr_sector_service.py`, `lending_service.py`, `leverage_service.py`, `parallel.py`, `progress.py`, `ranking_service.py`, `report_generator.py`, `schedule_spec.py`, `scraper.py`, `short_sell_service.py`, `supply_score.py`, `utils.py`.

서브패키지:
- `storage/` — `__init__.py`(re-export facade), `portfolio.py`, `names.py`, `schedule.py`, `dates.py`
- `market/` — `__init__.py`, `us.py`, `kr.py`, `format.py`
- `market_indicators/` — `__init__.py`, `cache.py`, `fx.py`, `commodities.py`, `earnings.py`, `econ.py`, `exports.py`, `macro.py`
- `kiwoom/` — `__init__.py`, `client.py`, `quote.py`, `sector.py`, `investor.py`, `chart.py`, `shortsell.py`
- `kis/` — `__init__.py`, `client.py`, `quote.py`
- `recommendation/` — `__init__.py`, `scoring.py`, `funnel.py`, `universe.py`, `actions.py`, `store.py`

## Frontend Layout (`frontend/src/`)

```
frontend/src/
├── main.jsx            # entry: createRoot → App, tokens.css/index.css 로드
├── App.jsx             # 셸: Provider 중첩·TopNav·라우트·MobileNav
├── api.js              # fetch 래퍼 (토큰·VITE_API_BASE_URL)
├── utils.js            # 공용 유틸 (가격 포맷 등)
├── index.css / App.css
├── pages/
├── components/
├── hooks/
├── contexts/
├── styles/             # tokens.css, pc.css, mobile.css
├── utils/              # analytics.js, marketHours.js, priceFlash.js, pwa.js
└── assets/
```

### `frontend/src/pages/`

라우트/허브: `Research.jsx`(홈 `/`, 탭 호스트), `Portfolio.jsx`, `MarketHub.jsx`(`Market`), `Guru.jsx`, `Settings.jsx`, `LoginPage.jsx`, `AdminAnalytics.jsx`, `Showcase.jsx`.
허브 내 탭 페이지: `Reports.jsx`, `Recommendations.jsx`, `Ranking.jsx`, `Digest.jsx`, `Calendar.jsx`, `Market.jsx`, `Analytics.jsx`, `SectorTab.jsx`, `MacroTab.jsx`.
구루/설정 보조: `GuruCrawlNow.jsx`, `GuruManagers.jsx`, `GuruStats.jsx`, `ConsensusSettings.jsx`, `LeverageBackfillSettings.jsx`, `ReportManualGen.jsx`.

### `frontend/src/hooks/`

`useAuth.js`, `useTheme.js`, `useIsMobile.js`, `usePortfolioData.js`, `useReportList.js`, `useReportGeneration.js`, `usePriceFlash.js`.

### `frontend/src/contexts/`

`AuthContext.jsx` (세션·role·메뉴 권한 — 로그인 시 권한 로드해 nav 필터링).

### `frontend/src/components/`

루트 컴포넌트: `StockModal.jsx`, `PromoteModal.jsx`, `PermissionManager.jsx`, `PermissionPanel.jsx`, `LoadingSpinner.jsx`, `MobileNav.jsx`, `Toast.jsx`(ToastProvider), `InstallPrompt.jsx`, `BatchScheduleEditor.jsx`.

하위 디렉터리:

- **`components/reports/`** — 리포트 탭/상세 컴포넌트 패밀리:
  - `DetailTab.jsx` — 리포트 상세 본문(차트·섹션 조립)
  - `Sections.jsx` — 상세 내 섹션 블록 모음
  - `ReportDetailTabs.jsx` — 상세 4탭 컨테이너 (요약/심층분석/리포트/히스토리)
  - `ConsensusChart.jsx`, `FinancialsChart.jsx`, `BacklogChart.jsx` — 차트
  - `HistoryTab.jsx` — 히스토리 탭
  - 도메인 섹션: `InsiderTradesSection.jsx`, `InvestorTrendSection.jsx`, `LatestDisclosuresSection.jsx`, `ShortSellSection.jsx`, `SupplySection.jsx`
  - `reportUtils.jsx` — 공용 헬퍼/포맷
  - **신규 추출 (커밋 `91173837`, Reports.jsx god-file 분리)** — 모두 presentational(상태·핸들러는 `Reports.jsx`에 잔존, props로 전달):
    - `StockCard.jsx` (190줄) — 보유/관심 종목 카드
    - `TickerListItem.jsx` (113줄) — 리포트 목록 행
    - `ReportFilters.jsx` (63줄) — 목록 필터 UI
    - `ReportDetailHeader.jsx` (94줄) — 상세 헤더

- **`components/market/`** — 시장지표/수급지표 섹션: `FxSection.jsx`, `VixSection.jsx`, `CommoditiesSection.jsx`, `TreasurySection.jsx`, `EconIndicatorsSection.jsx`, `M7EarningsSection.jsx`, `KrTop2Section.jsx`, `KrExportsSection.jsx`, `LeverageSection.jsx`, `LendingSection.jsx`, `MacroSignalsSection.jsx`, `marketUtils.jsx`.

- **`components/portfolio/`** — `DashboardCard.jsx`(+ `.css`), `FlashValue.jsx`, `PriceFreshness.jsx`(+ `.css`), `PriceFlash.css`.

- **`components/recommendations/`** — 추천 탭 컴포넌트.

- **`components/ui/`** — 공용 디자인 시스템: `Badge`, `Button`, `Card`, `Stat`, `Input`, `Skeleton`(각 `.jsx` + `.css`), `icons.jsx`, `InsiderBadge.jsx`, `SupplyBadge.jsx`, `index.js`(배럴 export).

## Data Store

Docker PostgreSQL이 기본 저장소. 스키마는 `backend/auth_schema.sql` → `backend/app_schema.sql` 순서로 실행. 주요 테이블: `users`, `refresh_tokens`, `tickers`, `user_stocks`, `snapshots`, `schedules`, `guru_schedules`, `guru_managers`, `digests`, `consensus_history`, `calendar_cache`, `market_cache`, `user_menu_permissions`, `user_events`, `market_leverage_indicators`, `market_lending_balance`, `default_menu_permissions`, `raw_reports`, `daily_consensus_mart`. 기동 시 `main.py:_migrate`가 추가 테이블/컬럼을 idempotent DDL(`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`)로 적용한다: `backlog_history.segments`, `batch_schedules`, `market_short_sell`, `stock_disclosures`, `stock_dividends`, `stock_supply_score`, `stock_insider_trades`, `stock_recommendations`.

로컬 파일 캐시(gitignored): `backend/data/consensus/`(per-ticker 컨센서스), `backend/data/calendar/`(월별 캘린더 `YYYY-MM.json`), `backend/snapshots/`(per-ticker/date 스냅샷).

## Naming Conventions

- **Backend**: 모듈은 snake_case. 라우터 파일명 = 도메인(`report.py`), 서비스 파일명 = 도메인 + `_service` 또는 도메인명. 외부 API 연동은 벤더 서브패키지(`kiwoom/`, `kis/`). FastAPI 라우트는 모두 `/api` prefix(`APIRouter(prefix="/api")`). 라우트 등록 순서 주의(구체 경로를 catch-all/`{ticker}` 보다 먼저).
- **Frontend**: 컴포넌트·페이지 파일은 PascalCase `.jsx`, 훅은 camelCase `use*.js`, 컨텍스트는 `*Context.jsx`. 컴포넌트별 CSS는 동명 `.css` 동거. 도메인별 컴포넌트는 `components/<domain>/`, 공용 프리미티브는 `components/ui/`(+ `index.js` 배럴). 비-컴포넌트 헬퍼는 `frontend/src/utils/` 또는 동거 `*Utils.jsx`.
- **Docs/state**: 명세서는 루트 대문자 `*.md`(`API_SPEC.md` 등). forge 상태/맵은 `.forge/`(codebase 맵 6~7문서: `ARCHITECTURE.md`, `STRUCTURE.md`, `STACK.md`, `CONVENTIONS.md`, `INTEGRATIONS.md`, `CONCERNS.md`, `TESTING.md`).

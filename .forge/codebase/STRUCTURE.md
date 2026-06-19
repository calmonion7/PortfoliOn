---
last_mapped_commit: 163c29cbd89d9b1d2aa5a101670e9fa34ceb21c4
mapped: 2026-06-19
---

# STRUCTURE

리포지토리 루트 `/Users/calmonion/Project/PortfoliOn`. 백엔드(`backend/`)·프론트엔드(`frontend/`)·운영(`docker-compose.yml`, `nginx/`, `certbot/`, `scripts/`)·문서(루트 `*.md`, `docs/`)·계획(`.forge/`, `.planning/`)로 나뉜다.

## 최상위 레이아웃

```
PortfoliOn/
├── backend/              # Python/FastAPI 앱 (port 8000)
├── frontend/             # React 19 + Vite (port 5173)
├── docker-compose.yml    # 4-컨테이너 운영 정의
├── nginx/                # nginx.conf (HTTP/HTTPS 서빙 + /api 프록시)
├── certbot/              # HTTPS 인증서 (conf/, www/)
├── scripts/              # 운영 스크립트 (auto-deploy-poll, ddns, screenshot 등)
├── supabase/             # 레거시 Supabase CLI 캐시 (.temp/ 만, 스키마 없음)
├── docs/                 # 사람용 문서 (ARCHITECTURE/API/DEVELOPMENT/TESTING 등)
├── .forge/               # forge 워크플로우 상태 (계획·ADR·retro·codebase)
├── .planning/            # GSD 계획 디렉터리
├── start.sh / start.bat  # 두 서버 동시 기동
├── stop.sh / stop.bat
├── deploy.sh
├── API_SPEC.md           # 전체 REST API 레퍼런스 (정본)
├── CLAUDE_COWORK_API.md  # 외부 Cowork API 명세
├── KIWOOM_API.md / KIS_API.md  # 외부 시세 API 카탈로그
├── CLAUDE.md / README.md
```

## 백엔드 (`backend/`)

```
backend/
├── main.py               # 앱 엔트리: 라우터 마운트 + lifespan(migrate/scheduler/warm)
├── scheduler.py          # APScheduler 잡 정의 (_JOB_FUNCS 24개) — 루트 레벨, services 아님
├── auth.py               # FastAPI 인증 Depends (get_current_user / require_admin 등)
├── routers/              # 엔드포인트별 APIRouter (18개)
├── services/             # 비즈니스 로직 + 외부 연동
├── middleware/           # event_tracker.py (사용자 행동 수집)
├── migrations/           # 수동 적용 SQL (001_user_events, 002_backlog_history)
├── tests/                # pytest (router·service·scheduler 단위/통합)
├── data/                 # 정적 참조(sp500/kospi tickers) + 파일 캐시(런타임, gitignore)
├── snapshots/            # per-ticker/date 리포트 JSON (gitignore)
├── reports/              # 레거시 리포트 (read-only 폴백)
├── auth_schema.sql       # PostgreSQL 인증 스키마 (users, refresh_tokens) — 먼저 실행
├── app_schema.sql        # PostgreSQL 앱 스키마 (tickers, user_stocks, snapshots ...)
├── supabase_schema.sql   # 레거시 스키마
├── requirements.txt      # 의존성 (anthropic 없음 — 백엔드 LLM 호출 0)
├── Dockerfile / Procfile / pytest.ini
└── .venv/                # 로컬 가상환경 (bin/python)
```

### `backend/routers/` (18개)

엔드포인트별로 분리. 한 라우터 = 한 `APIRouter(prefix=..., tags=[...])`, `backend/main.py`가 `include_router`로 마운트.

`auth.py`, `portfolio.py`, `report.py`(504줄, 최대), `watchlist.py`, `stocks.py`(450줄), `guru.py`, `calendar.py`, `digest.py`, `market_indicators.py`, `analytics.py`, `analysis.py`, `events.py`, `rankings.py`, `investor.py`, `short_sell.py`, `batches.py`, `recommendations.py`(180줄), `admin.py`.

### `backend/services/` (비즈니스 로직)

단일 파일 서비스 + 외부 연동 서브패키지.

**단일 파일** (대표): `storage.py`(도메인 영속 계층), `market.py`(797줄, 시세 fetch 체인), `db.py`(psycopg2 풀), `cache.py`(인메모리 캐시 다종), `report_generator.py`(스냅샷 생성), `consensus.py`/`consensus_pipeline.py`, `batch_registry.py`(배치 메타), `job_runs.py`(실행 이력), `schedule_spec.py`(트리거 변환), `scraper.py`, `guru_scraper.py`/`guru_stats.py`, `digest_service.py`, `analysis_service.py`, `auth_service.py`, `indicators.py`(RSI 등), `charts.py`, `ranking_service.py`, `investor_service.py`, `short_sell_service.py`, `supply_score.py`, `kr_sector_service.py`, `leverage_service.py`, `lending_service.py`, `dividends.py`, `disclosures.py`, `insider_trades.py`, `backlog.py`(753줄), `parallel.py`, `progress.py`, `errors.py`, `utils.py`.

**서브패키지**:
- `market_indicators/` — 시장지표 패키지: `cache.py`(`market_cache` 읽기/쓰기 `_mc_load`/`_mc_save`), `fx.py`(FX/VIX), `commodities.py`(원자재/국채), `earnings.py`(M7/KR Top2), `econ.py`(FRED 경제지표), `exports.py`(KR 수출), `macro.py`(FRED 매크로 신호).
- `kiwoom/` — 키움 REST(KR 읽기전용 1차 시세): `client.py`(토큰·request), `quote.py`, `chart.py`, `investor.py`, `sector.py`, `shortsell.py`.
- `kis/` — 한국투자증권 REST(KR+US 읽기전용 백업): `client.py`, `quote.py`.
- `recommendation/` — 추천/발굴 엔진: `__init__.py`(공개 API re-export), `universe.py`(유니버스), `funnel.py`(2단 깔때기 배치), `scoring.py`(점수·플래그 순수 로직), `actions.py`(보유 액션 순수 로직), `store.py`(stock_recommendations read/write).

### `backend/tests/`

pytest. `testpaths = tests`, `pythonpath = .`(`backend/pytest.ini`). `conftest.py`가 `TestClient(app)` + `get_current_user` 의존성 오버라이드(`"test-user-id"`) + quote 캐시 autouse 클리어. 파일 네이밍 `test_<대상>.py`로 라우터(`test_*_router.py`)·서비스·스케줄러(`test_scheduler_*.py`)·추천(`test_recommendation_*.py` 6종) 단위/통합. fixture는 `tests/fixtures/`(backlog HTML 등).

## 프론트엔드 (`frontend/`)

```
frontend/
├── index.html
├── vite.config.js        # PWA 플러그인 + manualChunks(함수형) + dev 프록시 /api→:8000
├── eslint.config.js
├── vercel.json           # 레거시
├── package.json / package-lock.json
├── public/               # favicon 등 정적 자산
├── dist/                 # 빌드 산출 (nginx가 서빙)
└── src/
    ├── main.jsx          # React 엔트리
    ├── App.jsx           # BrowserRouter + TopNav + 라우트
    ├── api.js            # axios 인스턴스 (Bearer 주입, 401 처리)
    ├── pages/            # 화면 (23개)
    ├── components/       # 컴포넌트 (도메인별 서브디렉터리)
    ├── contexts/         # AuthContext.jsx
    ├── hooks/            # 커스텀 훅
    ├── utils/            # analytics, marketHours, priceFlash, pwa
    ├── styles/           # tokens.css 등 디자인 토큰
    ├── assets/
    ├── App.css / index.css / utils.js
```

### `frontend/src/pages/` (23개)

최상위 화면 + 허브 내 탭 컴포넌트가 같은 디렉터리에 평면 배치.

- **최상위 라우트 화면**: `Portfolio.jsx`, `Research.jsx`(허브), `MarketHub.jsx`(허브), `Guru.jsx`, `Settings.jsx`, `LoginPage.jsx`, `AdminAnalytics.jsx`, `Showcase.jsx`.
- **Portfolio 분석 탭**: `SectorTab.jsx`, `MacroTab.jsx`, `Analytics.jsx`.
- **Research 허브 탭**: `Reports.jsx`, `Ranking.jsx`, `Calendar.jsx`, `Digest.jsx`, `Recommendations.jsx`.
- **MarketHub 탭**: `Market.jsx`, (Analytics 공유).
- **Guru 하위/설정**: `GuruManagers.jsx`, `GuruStats.jsx`, `GuruCrawlNow.jsx`, `ConsensusSettings.jsx`, `ReportManualGen.jsx`, `LeverageBackfillSettings.jsx`.

### `frontend/src/components/` (도메인별 그룹)

- 평면(공용): `StockModal.jsx`, `PromoteModal.jsx`, `PermissionManager.jsx`, `PermissionPanel.jsx`, `LoadingSpinner.jsx`, `MobileNav.jsx`, `Toast.jsx`, `InstallPrompt.jsx`, `BatchScheduleEditor.jsx`.
- `market/` — 시장지표 섹션 11종(FxSection·VixSection·CommoditiesSection·TreasurySection·EconIndicatorsSection·M7EarningsSection·KrTop2Section·KrExportsSection·LeverageSection·LendingSection·MacroSignalsSection) + `marketUtils.jsx`.
- `reports/` — 리포트 상세 탭/차트(ReportDetailTabs·DetailTab·HistoryTab·Sections·ConsensusChart·FinancialsChart·BacklogChart·InsiderTradesSection·InvestorTrendSection·LatestDisclosuresSection·ShortSellSection·SupplySection) + `reportUtils.jsx`.
- `portfolio/` — `DashboardCard.jsx`, `FlashValue.jsx`, `PriceFreshness.jsx` (+ 동명 .css).
- `recommendations/` — `RecCard.jsx`.
- `ui/` — 디자인 시스템 프리미티브: `Badge.jsx`/`Button.jsx`/`Card.jsx`/`Stat.jsx`(+ .css), `icons.jsx`, `InsiderBadge.jsx`, `SupplyBadge.jsx`, `index.js`(배럴).

### `frontend/src/hooks/`

`useAuth.js`, `useTheme.js`, `useIsMobile.js`, `usePortfolioData.js`, `usePriceFlash.js`, `useReportGeneration.js`, `useReportList.js`.

## 운영/스크립트

- `scripts/` — `auto-deploy-poll.sh`(2분 폴러, launchd가 실행), `ddns_update.sh`, `start-docker-compose.sh`, `screenshot.js`/`check-permissions.js`(node, `package.json`·`node_modules` 동반).
- `nginx/nginx.conf` — HTTP(80) 서빙, `/api/*` → `backend:8000` 프록시, `frontend/dist` 직접 서빙.
- `supabase/` — 레거시. `.temp/`(CLI 캐시)만 있고 스키마 파일 없음(영속 저장소는 Docker PostgreSQL로 이관됨).

## `.forge/` (forge 워크플로우 상태)

```
.forge/
├── CONTEXT.md            # 도메인 용어/결정 ledger (정의의 정본)
├── adr/                  # ADR 0001~0016 (아키텍처 결정 기록)
├── backlog/              # 미실행 계획
├── codebase/             # 코드베이스 맵 (이 문서 포함)
├── done/ / executed/     # 봉인·실행 완료 작업
├── quick/                # quick-lane 로그
└── retro/                # 회고 로그
```

`.forge/codebase/`는 구현 사실만 기록(도메인 용어 *정의*는 `CONTEXT.md` 담당).

## 네이밍 관례 (관찰된 패턴)

- **백엔드 router vs service 분리**: 라우터는 HTTP 표면만, 비즈니스 로직은 서비스로. 라우터에서 `from services import <svc>`.
- **배치 id 일치 규약**: 배치 id 1개가 `batch_registry.BATCHES[].id` ≡ `scheduler._JOB_FUNCS` 키 ≡ `job_runs.record(id, ...)` 인자로 동일 문자열 사용(시장별: `daily_report_kr`/`_us`, `earnings_kr`/`_us`, `recommendation_kr`/`_us`).
- **순수 함수 분리**: 추천 `scoring.py`·`actions.py`는 DB/네트워크 무의존 순수 함수(테스트 용이). 외부/DB I/O는 모듈 함수로 분리해 테스트에서 `patch.object`로 mock(`universe.py`/`funnel.py` 패턴).
- **테이블 네이밍**: `stock_*`(per-ticker 공유: stock_recommendations·stock_supply_score·stock_disclosures·stock_dividends·stock_insider_trades), `market_*`(시계열: market_cache·market_rankings·market_leverage_indicators·market_lending_balance·market_short_sell·market_investor_trend), `user_*`(per-user: user_stocks·user_events·user_menu_permissions).
- **idempotent 기동 마이그레이션**: `backend/main.py` `_migrate()`가 `ADD COLUMN IF NOT EXISTS`/`CREATE TABLE IF NOT EXISTS`로 배포 시 자동 적용(ADR-0006).
- **프론트 컴포넌트 동반 CSS**: plain CSS, 컴포넌트별 `<Name>.jsx` + `<Name>.css` 동명 페어(TailwindCSS 미사용).
- **프론트 페이지 평면 + 허브 합성**: 허브(Research/MarketHub)가 내부 탭으로 개별 페이지 컴포넌트를 합성, 디렉터리는 평면 유지.

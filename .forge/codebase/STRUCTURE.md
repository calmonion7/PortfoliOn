---
last_mapped_commit: 44629f27cfb796dbd2120b7002a99e3d82f7c725
mapped: 2026-07-24
---

# STRUCTURE

디렉터리 레이아웃·핵심 파일 위치·명명 규칙. 실제 경로는 backtick.

## 리포지토리 루트

```
backend/          FastAPI 앱 (Python)
frontend/         React 19 + Vite 앱
.forge/           forge 상태·ADR·CONTEXT·codebase 지도
scripts/          UAT/스크린샷/폴러 스크립트 (auto-deploy-poll.sh 등)
deploy.sh · start.sh · start.bat · stop.bat
API_SPEC.md · CLAUDE_COWORK_API.md · KIWOOM_API.md · KIS_API.md
README.md · CLAUDE.md
docker-compose.yml · nginx.conf 류(배포)
```

## backend/

```
main.py               앱 진입 (lifespan·_migrate·_configure_logging·라우터 마운트)
auth.py               인증 의존성 (get_current_user·require_admin 등)
Dockerfile · Procfile · requirements.txt · pytest.ini
app_schema.sql        앱 스키마 (신규 설치용)
auth_schema.sql       인증 스키마 (app_schema.sql보다 먼저 실행)
supabase_schema.sql   레거시 (Supabase 시절)
run_backfill.py       백필 실행 스크립트

routers/              HTTP 라우터 19개 (auth·portfolio·report·watchlist·stocks·
                      guru·calendar·digest·market_indicators·analytics·analysis·
                      events·rankings·investor·short_sell·batches·recommendations·admin)

services/             도메인 로직
  db.py               PostgreSQL (ThreadedConnectionPool, query/execute/get_connection)
  cache.py            인메모리 캐시 6종 (TTLCache/LRU)
  batch_registry.py   배치 메타 정본 (BATCHES 리스트)
  job_runs.py         배치 실행로그 (job_id별 최근 20건)
  report_generator.py 시장 데이터 스냅샷 생성 (LLM 없음)
  consensus.py · consensus_pipeline.py   목표가·의견수 as-of / opinion 표준화
  utils.py            NaN/inf sanitize · today_kst
  storage/            앱 데이터 CRUD 패키지 (__init__ re-export + portfolio·names·schedule·dates)
  market/             시세/재무 패키지 (__init__ re-export + format·kr·us)
  market_indicators/  시장지표 패키지 (cache·fx·commodities·earnings·econ·exports·
                      macro·indices·kospi_signal·kospi_futures·sentiment)
  kiwoom/             키움 REST (client·quote·chart·sector·investor·shortsell)
  kis/                한투 REST (client·quote·futures)
  recommendation/     추천 엔진 (universe·scoring·funnel·store·actions)
  (단일 모듈) dividends·backlog·backlog_parser·disclosures·agm·insider_trades·beta·
             leverage_service·lending_service·short_sell_service·investor_service·
             ranking_service·kr_sector_service·us_sector_service·us_supply·supply_score·
             exposure·rebalance·guru_scraper·guru_stats·scraper·indicators·analysis_service·
             auth_service·digest_service·errors·parallel·progress·schedule_spec

scheduler/            APScheduler 패키지 (__init__·jobs·schedule·_state) — 루트 레벨 패키지
middleware/           event_tracker.py (사용자 행동 로그)
migrations/           001_user_events.sql · 002_backlog_history.sql (수동 참조용)
data/                 정적 참조(sp500_tickers.json·kospi_tickers.json) + 로컬 캐시(consensus/·calendar/·digest/·*.json)
snapshots/            생성 JSON 스냅샷 (gitignored, per-ticker/date)
reports/              레거시 리포트 (read-only fallback)
tests/                pytest 124개 파일 (conftest.py·fixtures/) — _block_real_db autouse 가드
scripts/              백엔드 스크립트
```

명명 규칙(백엔드):
- 라우터 파일 = 도메인명(`stocks.py`·`report.py`), `router = APIRouter(prefix="/api/...")`.
- 배치 잡: `batch_registry.BATCHES`의 `id` = 스케줄러 잡 id = `job_runs.record(id,...)` id (3표면 일치).
- 시장별 분리 배치는 `_kr`/`_us` 접미사(`daily_report_kr`·`earnings_us`·`monthly_kr`).
- 패키지 `__init__.py`는 서브모듈 심볼을 루트로 re-export(외부는 `pkg.X` 모듈속성 조회, ADR-0017).
- private 헬퍼는 `_` 접두(`_migrate`·`_mc_load`·`_build_all`·`_fetch_*`).
- 로그 마커 `[Component]` PascalCase(`[Migrate]`·`[Scheduler]`).

## frontend/

```
src/
  main.jsx            엔트리 (tokens.css·motion.css import)
  App.jsx             BrowserRouter·AppShell·라우트 정의·OAuth 부트스트랩
  routes.js           REDIRECTS 리다이렉트 맵 (구 URL→신규, ADR-0025)
  api.js              axios 인스턴스 (Bearer 자동 주입·401 처리)
  utils.js · utils/   analytics.js·marketHours.js·priceFlash.js·pwa.js
  index.css · App.css

  pages/              화면 (허브: ResearchShell·MarketHub·Portfolio / 탭: Reports·
                      Recommendations·Ranking·Compare·Calendar·Dividends·Digest·Market·
                      Guru·Settings·AdminAnalytics·Showcase·LoginPage / 서브탭:
                      SectorTab·MacroTab·ExposureTab·RebalanceTab·GuruManagers·GuruStats·
                      GuruCrawlNow·ConsensusSettings·ReportManualGen·LeverageBackfillSettings)

  components/
    ui/               디자인 프리미티브 (Badge·Button·Card·Stat·Input·Skeleton·
                      InsiderBadge·SupplyBadge·icons.jsx·index.js)
    reports/          리포트 상세/카드 (ReportDetail*·DetailTab·HistoryTab·Sections·
                      StockCard·StockActions·TickerListItem·ReportFilters·*Section·reportUtils)
    market/           시장지표 섹션 (Fx·Vix·Commodities·Treasury·Econ·M7Earnings·KrTop2·
                      KrExports·Leverage·Lending·Index·MacroSignals·KospiSignal·
                      KospiFutures·FearGreed Section·marketUtils.jsx·Market.css)
    portfolio/        DashboardCard·FlashValue·PriceFreshness (+css)
    recommendations/  RecCard.jsx
    sketches/         에디토리얼 SVG (Icon*·Sketch*·index.js)
    (공용) Masthead·MobileNav·MobileTopActions·GlobalSearch·StockModal·PromoteModal·
           StockSearchBox·Toast·InstallPrompt·PermissionManager·PermissionPanel·
           BatchScheduleEditor·Glossary·LoadingSpinner

  hooks/              usePortfolioData·useStockManagement·useReportList·useReportFilters·
                      useReportGeneration·useTheme·useIsMobile·useReveal·useCountUp·
                      usePriceFlash·useBodyScrollLock·useAuth (+ *.test.js)
  contexts/           AuthContext.jsx (AuthProvider·useAuth)
  glossary/           주식 용어집 정본 (terms.js·match.js·match.test.js) — task#198
  styles/             tokens.css(디자인 토큰·ADR-0026)·motion.css(모션 유틸)·
                      pc.css(PC 전용)·mobile.css(모바일 전용)
  test/               vitest 셋업·통합 테스트 (setup.js·*.test.jsx)
  assets/             hero.png·react.svg·vite.svg
```

명명 규칙(프론트):
- 컴포넌트 = PascalCase `.jsx`, 병렬 스타일은 동명 `.css`(`Card.jsx`+`Card.css`).
- 훅 = `use` 접두 camelCase `.js`, 병렬 테스트 `*.test.js`.
- 도메인 컴포넌트는 서브폴더(`ui/`·`reports/`·`market/`·`portfolio/`·`recommendations/`·`sketches/`)로 그룹, `index.js`로 배럴 export(ui·sketches).
- 스타일 3파일 계층: `tokens.css`(변수 정본) → `pc.css`/`mobile.css`가 소비. `motion.css`는 별도 import.
- 라우트 nav 정의 정본: 사이드바=`components/Masthead.jsx`의 `SECTIONS`, 리다이렉트=`routes.js`의 `REDIRECTS`.

## 핵심 위치 빠른 참조

- 앱 진입/마이그레이션/로깅: `backend/main.py`
- 스케줄러 잡·시드: `backend/scheduler/jobs.py`, 트리거·리스케줄: `backend/scheduler/schedule.py`
- 배치 메타 정본: `backend/services/batch_registry.py`
- DB 접근 단일화: `backend/services/db.py`
- 프론트 라우팅: `frontend/src/App.jsx` + `frontend/src/routes.js`
- nav 권한 게이트: `frontend/src/contexts/AuthContext.jsx` + `frontend/src/components/Masthead.jsx`
- 디자인 토큰: `frontend/src/styles/tokens.css`
- API 명세: `API_SPEC.md`(전체) · `CLAUDE_COWORK_API.md`(외부 Cowork)

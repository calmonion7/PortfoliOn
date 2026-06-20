---
last_mapped_commit: 53b30e71425b810f8ce3edc33b2767b1be2e242c
mapped: 2026-06-20
---

# STRUCTURE

디스크 상의 실제 현재 트리(HEAD `53b30e71`). 경로는 `ls`/`glob`로 확인한 값이다.

## Top level

```
backend/        FastAPI 백엔드 (포트 8000)
frontend/       React 19 + Vite 프론트 (포트 5173)
scripts/        배포/UAT/스크린샷 유틸 (auto-deploy-poll.sh, capture-*.js, uat-*.js, start-docker-compose.sh 등)
.forge/         forge 상태·ADR·retro·codebase 맵
API_SPEC.md            전체 REST API 레퍼런스 (엔드포인트 source of truth)
CLAUDE_COWORK_API.md   외부 Cowork API (Claude AI 분석 read/write)
KIWOOM_API.md / KIS_API.md   키움/KIS API 카탈로그·로드맵
README.md / CLAUDE.md  overview / 프로젝트 컨텍스트·가이드라인
```

## 백엔드 (`backend/`)

### 엔트리·인프라
- `main.py` — FastAPI 앱 엔트리. `lifespan`에서 `_migrate()`(기동 idempotent DDL) + 스케줄러 기동 + 캐시 워밍, 17개 라우터 마운트.
- `auth.py` — 인증 의존성/헬퍼(라우터 아님, 루트 레벨).
- `auth_schema.sql` → `app_schema.sql` — PostgreSQL 스키마(인증 먼저, 앱 나중).
- `supabase_schema.sql` — legacy(미사용).
- `Dockerfile`, `Procfile`, `requirements.txt`, `pytest.ini`.
- `.env`(docker-compose 보간), `.env.docker`(런타임 시크릿), `.env.docker.example`.
- `run_backfill.py` — 컨센서스 백필 스크립트.
- `middleware/` — `event_tracker.py`(`EventTrackerMiddleware`, 사용자 행동 로그).
- `migrations/` — 수동 SQL 마이그레이션(`001_user_events.sql`, `002_backlog_history.sql`). 기동 idempotent DDL은 `main.py:_migrate()`에 별도 존재.
- `scripts/` — (현재 비어 있음).

### 라우터 (`backend/routers/`) — 새 엔드포인트는 여기
`APIRouter(prefix="/api")` 단위 파일. 도메인별 1파일:
```
auth.py  portfolio.py  report.py  watchlist.py  stocks.py
guru.py  calendar.py  digest.py  market_indicators.py  analytics.py
analysis.py  events.py  rankings.py  investor.py  short_sell.py
batches.py  recommendations.py  admin.py
```
- `market_indicators.py` — FX/VIX/원자재/국채/경제지표/실적/수출/매크로신호/레버리지/대차.
- `analysis.py` — 섹터 모멘텀(`/api/analysis/sector`), 매크로 상관(`/api/analysis/macro-correlation`).
- `analytics.py` — 보유 종목 상관관계(`/api/analytics/correlation`).
- `batches.py` — 배치 현황(`GET /api/batches`, batch_registry 노출).
- `recommendations.py` — 종목 추천(`stock_recommendations` 읽기).

### 서비스 (`backend/services/`) — 새 도메인 로직은 여기
플랫 모듈 + 4개 서브패키지. 명명: `<도메인>.py` 또는 `<도메인>_service.py`(혼재).
```
storage/        패키지 (ADR-0017) — portfolio.py, names.py, schedule.py, dates.py / __init__.py가 전 심볼 re-export
market/         시세 — format.py, kr.py, us.py / __init__.py (get_quote, resolve_name, get_quotes_batch, get_history_df, get_financials, get_analyst_data)
market_indicators/  시장지표 — cache.py(_mc_load/_mc_save), fx.py, commodities.py, earnings.py, econ.py, exports.py, macro.py
kiwoom/         키움 REST — client.py, quote.py, sector.py, chart.py, investor.py, shortsell.py
kis/            KIS REST — client.py, quote.py
recommendation/ 추천 — scoring.py, universe.py, store.py, funnel.py, actions.py
```
플랫 서비스:
```
db.py                psycopg2 풀 + query/execute/get_connection
cache.py             인메모리 캐시(TTL/LRU)
batch_registry.py    BATCHES 정적 메타데이터
job_runs.py          배치 실행 이력 record()
report_generator.py  일일 리포트 스냅샷 생성
consensus.py / consensus_pipeline.py  컨센서스 수집·표준화
kr_sector_service.py KR 업종 모멘텀 사전계산 → market_cache
ranking_service.py   거래대금/거래량/등락률 랭킹
investor_service.py  외국인/기관/개인 수급
short_sell_service.py / supply_score.py  공매도·수급 점수
leverage_service.py  KOFIA 신용잔고
lending_service.py   대차잔고
backlog.py / backlog_parser.py  DART 수주잔고
disclosures.py       DART 공시 피드
insider_trades.py    DART 내부자 거래
dividends.py         배당 (US yfinance / KR DART)
analysis_service.py  섹터 ETF·매크로 상관
guru_scraper.py / guru_stats.py  구루 크롤·통계
digest_service.py    일일 다이제스트
indicators.py / charts.py  지표·차트
scraper.py           스크래핑 공통
schedule_spec.py     스케줄 직렬화
auth_service.py      인증 비즈니스
errors.py utils.py parallel.py progress.py  공통 유틸
```

### 스케줄러 (`backend/scheduler/`) — 새 배치 잡은 여기
APScheduler 패키지(루트 `scheduler/` 아님, `backend/scheduler/`):
```
__init__.py   start()/stop()/reload() + 전 심볼 re-export
_state.py     _scheduler 인스턴스·상수(_DAY_MAP 등)
jobs.py       잡 함수(_generate_kr/us, _fetch_*, _seed_*) + _JOB_FUNCS 매핑
schedule.py   트리거 빌드·재스케줄·시드·미생성 복구
```
새 배치 추가 절차: `jobs.py`에 잡 함수 + `_JOB_FUNCS` 등록 → `batch_registry.BATCHES`에 메타 항목 추가(id 일치) → 잡 내부에서 `job_runs.record(id, lane)`.

### 데이터·테스트
- `data/` — 정적 참조(`sp500_tickers.json`, `kospi_tickers.json`) + 런타임 파일 캐시(gitignored: `calendar/`, `consensus/`, `digest/`, legacy `holdings.json`/`stocks.json`/`watchlist.json` 등).
- `snapshots/` — per-ticker/date JSON(gitignored). `reports/` — legacy read-only.
- `tests/` — pytest, `test_<대상>.py` 1:1 매핑(라우터·서비스·배치별). `conftest.py`(픽스처), `fixtures/`(예: `backlog/` HTML 픽스처). 새 테스트는 `test_<모듈명>.py`.

## 프론트 (`frontend/src/`)

### 엔트리·인프라
```
main.jsx        createRoot → <App/>, tokens.css + index.css 로드
App.jsx         BrowserRouter, 라우트 정의, 인증/OAuth 게이트, TopNav
api.js          axios 인스턴스(Bearer 인터셉터, 401 핸들링)
utils.js        공통 유틸 (루트 레벨, utils/ 폴더와 별개)
App.css / index.css  앱·전역 스타일
```

### pages (`frontend/src/pages/`) — 새 화면은 여기
hub와 hub 내부 탭(개별 페이지)이 같은 폴더에 평면 배치:
```
Research.jsx     홈 hub(/), 탭: Reports·Recommendations·Ranking·Calendar·Digest
Portfolio.jsx    /portfolio, 탭: 대시보드·분석(SectorTab/MacroTab/Analytics)
MarketHub.jsx    /market, Market 래핑(시장지표·수급지표 2탭)
Guru.jsx         /guru hub (+ GuruManagers, GuruStats, GuruCrawlNow)
Settings.jsx     /settings (+ ConsensusSettings, LeverageBackfillSettings, ReportManualGen)
AdminAnalytics.jsx  /admin-analytics (admin 전용)
Showcase.jsx     /dev/showcase (컴포넌트 카탈로그)
LoginPage.jsx    미인증 화면
```
hub 내부 탭용 개별 페이지: `Reports.jsx`, `Recommendations.jsx`, `Ranking.jsx`, `Calendar.jsx`, `Digest.jsx`, `Market.jsx`, `Analytics.jsx`, `SectorTab.jsx`, `MacroTab.jsx`.

### components (`frontend/src/components/`) — 새 컴포넌트는 여기
루트(공통): `StockModal.jsx`, `PromoteModal.jsx`, `PermissionManager.jsx`, `PermissionPanel.jsx`, `LoadingSpinner.jsx`, `MobileNav.jsx`, `Toast.jsx`(ToastProvider), `InstallPrompt.jsx`(PWA), `BatchScheduleEditor.jsx`.

도메인별 서브폴더:
```
ui/             디자인 프리미티브 — Badge, Button, Card, Stat, Input(각 .jsx+.css), icons.jsx, index.js,
                Skeleton.jsx/.css(로딩 플레이스홀더, 최근 추가), InsiderBadge.jsx, SupplyBadge.jsx(의미 배지는 전용 색)
market/         시장지표 섹션 — FxSection, VixSection, CommoditiesSection, TreasurySection,
                EconIndicatorsSection, M7EarningsSection, KrTop2Section, KrExportsSection,
                LeverageSection, LendingSection, MacroSignalsSection, marketUtils.jsx(krFmt 등)
reports/        리포트 상세 — ReportDetailTabs, DetailTab, HistoryTab, Sections, ConsensusChart,
                FinancialsChart, BacklogChart, InvestorTrendSection, ShortSellSection, SupplySection,
                LatestDisclosuresSection, InsiderTradesSection, reportUtils.jsx
portfolio/      DashboardCard(.jsx+.css), FlashValue.jsx, PriceFreshness(.jsx+.css), PriceFlash.css
recommendations/ RecCard.jsx (추천 카드, 최근 추가)
```

### 상태·스타일·유틸
```
contexts/AuthContext.jsx   로그인·menuPermissions·role 제공
hooks/                     useAuth, usePortfolioData, useReportList, useReportGeneration,
                           usePriceFlash, useIsMobile, useTheme
styles/                    tokens.css(--up=빨강·--down=파랑 KR 색 관례), pc.css, mobile.css
utils/                     analytics.js(trackEvent), marketHours.js, priceFlash.js, pwa.js
assets/                    hero.png, react.svg, vite.svg
```
`public/` — `favicon.svg`, `icons.svg`.

## 명명 규칙 요약

- 백엔드 라우터: `backend/routers/<도메인>.py`, 내부 `router = APIRouter(prefix="/api")`.
- 백엔드 서비스: `backend/services/<도메인>.py` 또는 `<도메인>_service.py`(혼재). 다파일 도메인은 서브패키지 + `__init__.py` re-export.
- 백엔드 테스트: `backend/tests/test_<모듈명>.py`.
- 프론트 페이지: `frontend/src/pages/<PascalCase>.jsx`.
- 프론트 컴포넌트: `frontend/src/components/[도메인폴더/]<PascalCase>.jsx`, 스타일 동반 시 같은 이름 `.css`.
- 프론트 훅: `frontend/src/hooks/use<Name>.js`.
- 배치 id: `<도메인>[_kr|_us]`(시장 분리), `batch_registry.BATCHES`·스케줄러 잡·`job_runs.record` 3곳 id 일치.

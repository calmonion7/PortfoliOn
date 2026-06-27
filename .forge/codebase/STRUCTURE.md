---
last_mapped_commit: f1839804fa84342f9e30cc6dc919d5e5abba7b8d
mapped: 2026-06-28
---

# PortfoliOn 디렉터리 구조

프로젝트 루트: `/Users/calmonion/Project/PortfoliOn`. 코드를 찾을 때 어디를 보면 되는지에 대한 지도다.

## 1. 최상위 레이아웃

```
backend/                  FastAPI 백엔드
frontend/                 React + Vite 프론트엔드
nginx/                    nginx 설정
certbot/                  HTTPS 인증서 (certbot 컨테이너)
scripts/                  배포 폴러 등 운영 스크립트 (auto-deploy-poll.sh)
docs/                     문서
screenshots/              스크린샷
supabase/                 레거시 (Supabase 마이그레이션 잔재)
docker-compose.yml        4-컨테이너 구성 (postgres/backend/nginx/certbot)
deploy.sh                 정식 배포 스크립트
start.sh / start.bat      양 서버 기동 (macOS / Windows)
stop.sh / stop.bat        서버 종료
API_SPEC.md               전체 REST API 레퍼런스 (엔드포인트 정본)
CLAUDE_COWORK_API.md      외부 Cowork API 명세
KIWOOM_API.md / KIS_API.md  증권사 API 카탈로그
README.md                 프로젝트 개요
```

## 2. 백엔드 (`backend/`)

### 진입·설정 파일
- `backend/main.py` — 앱 진입점. FastAPI 생성, 미들웨어, `lifespan`(기동 마이그레이션·스케줄러 시작·캐시 워밍), 라우터 마운트, `/health`.
- `backend/auth.py` — 인증 의존성(`get_current_user`, `require_admin`, `require_admin_or_api_key` 등).
- `backend/Dockerfile` — backend 컨테이너 이미지.
- `backend/requirements.txt` — Python 의존성(주의: `lxml`은 여기 있으나 로컬 `.venv`엔 없음).
- `backend/pytest.ini` — pytest 설정.
- `backend/run_backfill.py` — 백필 실행 스크립트.

### 스키마·마이그레이션
- `backend/auth_schema.sql` — 인증 스키마(users, refresh_tokens). app_schema보다 먼저 실행.
- `backend/app_schema.sql` — 앱 스키마(tickers, user_stocks, snapshots, schedules, market_cache 등).
- `backend/migrations/` — 추가 마이그레이션 SQL(`001_user_events.sql`, `002_backlog_history.sql`). 기동 시 idempotent DDL은 `main.py:_migrate()`에도 인라인.

### 라우터 (`backend/routers/`)
도메인당 한 파일, 각각 `router = APIRouter()`를 export. `main.py`가 마운트.
```
auth.py            인증/OAuth
portfolio.py       보유 종목 (/api/portfolio)
watchlist.py       관심 종목 (/api/watchlist)
stocks.py          종목 대시보드·enrich·배당 (/api/stocks)
report.py          리포트 목록/상세·수주잔고·공시 (/api/report)
guru.py            구루 크롤/통계 (/api/guru)
calendar.py        실적 캘린더 (파일 캐시, /api/calendar)
digest.py          일일 다이제스트 (/api/digest)
market_indicators.py  시장지표 (/api/market, /api/market-indicators)
analytics.py       상관관계 (/api/analytics)
analysis.py        섹터·매크로 상관 (/api/analysis)
events.py          사용자 행동 이벤트 (/api/events)
rankings.py        거래대금/거래량 랭킹 (/api/rankings)
investor.py        투자자별 수급 (/api/investor)
short_sell.py      공매도 (/api/short-sell)
batches.py         배치 현황 (/api/batches)
recommendations.py 종목 추천 (/api/recommendations)
admin.py           admin 전용 (/api/admin)
```

### 서비스 (`backend/services/`)
도메인 로직·외부 API·캐시. 단일 파일 서비스와 패키지 서비스가 섞여 있다.

단일 파일 서비스(발췌):
```
db.py                 PostgreSQL ThreadedConnectionPool + query/execute (DB 단일 통로)
cache.py              인메모리 캐시 6종 (snapshot/list/dashboard/correlation/sector/macro)
utils.py              NaN/inf sanitize 등 유틸
errors.py             에러 정의
parallel.py           ThreadPool 병렬 헬퍼
progress.py           진행률
report_generator.py   리포트(시장 데이터 스냅샷) 생성 — 백엔드에 LLM 호출 없음
consensus.py / consensus_pipeline.py  컨센서스 수집·표준화 파이프라인
scraper.py            스크래핑
guru_scraper.py / guru_stats.py  구루 크롤·통계
digest_service.py     일일 다이제스트 생성
analysis_service.py   섹터 ETF·매크로 상관 (SECTOR_ETFS, MACRO_TICKERS)
auth_service.py       인증 로직
backlog.py / backlog_parser.py  수주잔고 DART document.xml 파싱
disclosures.py        DART 공시 피드
dividends.py          배당 수집 (US yfinance / KR DART)
insider_trades.py     내부자 거래
investor_service.py   투자자별 수급
ranking_service.py    거래대금/거래량 랭킹
short_sell_service.py 공매도
supply_score.py       수급 점수
leverage_service.py   KOFIA 신용잔고/반대매매/시총
lending_service.py    내외국인 대차잔고
kr_sector_service.py  KR 업종 모멘텀 사전계산 (market_cache 저장)
job_runs.py           배치 실행 이력 기록 (job_runs 테이블)
batch_registry.py     배치 메타데이터 정본 (BATCHES, 24개)
schedule_spec.py      cron 트리거 kwargs 빌드
```

패키지 서비스:
- `backend/services/storage/` — 영속·도메인 변환. `__init__.py`(re-export), `portfolio.py`(종목/보유/관심 CRUD·enrich), `names.py`(종목명 dual-source 동기화), `dates.py`(기대 리포트 날짜), `schedule.py`(배치 스케줄 저장).
- `backend/services/market/` — 시세·재무. `__init__.py`(`get_quote` 진입점·패키지 re-export), `format.py`(가격/시총/섹터 정규화 헬퍼), `kr.py`(KR 시세 키움→KIS→Naver 체인, KR 재무 DART), `us.py`(US 재무 yfinance, KIS US 폴백). 구 단일 `market.py`는 패키지로 대체됨.
- `backend/services/market_indicators/` — 시장지표. `cache.py`(PostgreSQL `market_cache` 읽기/쓰기 `_mc_load`/`_mc_save`), `fx.py`(FX/VIX), `commodities.py`(원자재/국채), `earnings.py`(M7/KR Top2 실적), `econ.py`(FRED 경제지표), `exports.py`(KR 수출), `macro.py`(FRED 매크로 신호).
- `backend/services/kiwoom/` — 키움 REST API(KR 읽기전용 시세 소스). `client.py`(토큰·요청·`integrated_code`), `quote.py`(현재가), `chart.py`(일봉), `sector.py`(업종 모멘텀), `investor.py`(수급), `shortsell.py`(공매도).
- `backend/services/kis/` — 한국투자증권 REST API(KR+US 백업 시세). `client.py`(토큰·요청), `quote.py`(국내/해외 현재가).
- `backend/services/recommendation/` — 추천 엔진(ADR-0015). `universe.py`(유니버스 빌드), `scoring.py`(점수·플래그), `funnel.py`(배치 실행), `store.py`(`stock_recommendations` 읽기/쓰기), `actions.py`(보유 액션 도출).

### 기타 백엔드 디렉터리
- `backend/middleware/` — `event_tracker.py`(사용자 행동 로깅 미들웨어).
- `backend/data/` — 정적 참조 데이터(`sp500_tickers.json`, `kospi_tickers.json`)와 파일 캐시(`calendar/YYYY-MM.json`, `consensus/` per-ticker, gitignored).
- `backend/snapshots/` — 생성된 JSON 스냅샷(gitignored).
- `backend/reports/` — 레거시 리포트 디렉터리(티커별 폴더, read-only JSON 폴백).
- `backend/tests/` — pytest(`test_stocks_router.py`, `test_consensus_router.py`, `test_security_auth_gaps.py`, `test_api_doc_sync.py` 등). 다수가 conftest `client` 대신 모듈 상단에서 `FastAPI()`를 직접 만들어 `app.dependency_overrides`로 auth 우회.

## 3. 프론트엔드 (`frontend/`)

### `frontend/src/` 진입·설정
- `main.jsx` — React 마운트(StrictMode), `tokens.css`·`index.css` 로드.
- `App.jsx` — 라우팅(`BrowserRouter`/`Routes`)·인증 게이트·TopNav/MobileNav.
- `api.js` — axios 인스턴스(토큰 주입, 401 처리). 비훅 코드의 HTTP 단일 통로.
- `utils.js` / `utils/` — 공통 유틸. `utils/analytics.js`(trackEvent), `utils/marketHours.js`, `utils/priceFlash.js`, `utils/pwa.js`.
- `App.css` / `index.css` — 전역 스타일.

### 페이지 (`frontend/src/pages/`)
라우트 단위 화면. 허브 페이지가 하위 탭을 품는 구조.
```
Research.jsx          홈 "/" — 리포트·랭킹·다이제스트·캘린더 허브 (종목 관리 흡수)
Portfolio.jsx         "/portfolio" — 대시보드·분석(섹터/매크로/상관관계 탭)
MarketHub.jsx         "/market" — 시장지표·수급지표
Market.jsx            시장지표 화면 (허브 내 탭용)
Guru.jsx              "/guru" — 구루
Settings.jsx          "/settings" — 설정·배치 허브
AdminAnalytics.jsx    "/admin-analytics" — admin 사용자 행동 분석
LoginPage.jsx         로그인
Showcase.jsx          "/dev/showcase" — UI 쇼케이스
Reports.jsx, Ranking.jsx, Calendar.jsx, Digest.jsx, Analytics.jsx, Recommendations.jsx  허브 내 탭 화면
SectorTab.jsx, MacroTab.jsx  Portfolio 분석 하위 탭
ConsensusSettings.jsx, LeverageBackfillSettings.jsx  설정 하위 화면
GuruCrawlNow.jsx, GuruManagers.jsx, GuruStats.jsx, ReportManualGen.jsx  Guru/리포트 보조 화면
```

### 컴포넌트 (`frontend/src/components/`)
도메인별 하위 디렉터리 + 루트 공용 컴포넌트.
```
루트:   StockModal.jsx, PromoteModal.jsx, PermissionManager.jsx, PermissionPanel.jsx,
        LoadingSpinner.jsx, MobileNav.jsx, Toast.jsx(ToastProvider),
        BatchScheduleEditor.jsx, InstallPrompt.jsx

portfolio/  DashboardCard.jsx, FlashValue.jsx, PriceFreshness.jsx (+ .css)
reports/    StockCard.jsx, TickerListItem.jsx, StockActions.jsx(액션버튼 통합),
            DetailTab.jsx, HistoryTab.jsx, Sections.jsx, ReportDetailHeader.jsx,
            ReportDetailTabs.jsx, ReportFilters.jsx, reportUtils.jsx,
            ConsensusChart.jsx, FinancialsChart.jsx, BacklogChart.jsx,
            InsiderTradesSection.jsx, InvestorTrendSection.jsx,
            LatestDisclosuresSection.jsx, ShortSellSection.jsx, SupplySection.jsx
market/     FxSection, VixSection, CommoditiesSection, TreasurySection,
            EconIndicatorsSection, M7EarningsSection, KrTop2Section,
            KrExportsSection, LeverageSection, LendingSection,
            MacroSignalsSection, marketUtils.jsx
recommendations/  RecCard.jsx
ui/         Badge, Button, Card, Stat, Input, Skeleton, InsiderBadge,
            SupplyBadge, icons.jsx, index.js (프리미티브)
```

### 훅·컨텍스트·스타일·테스트
- `frontend/src/hooks/` — `useAuth.js`, `usePortfolioData.js`, `useStockManagement.js`, `useReportList.js`, `useReportFilters.js`, `useReportGeneration.js`, `useTheme.js`, `useIsMobile.js`, `usePriceFlash.js`(+ `.test.js` 일부).
- `frontend/src/contexts/` — `AuthContext.jsx`(로그인 시 권한 로드, nav 필터링).
- `frontend/src/styles/` — `tokens.css`(색 토큰 — KR 관례: `--up`=빨강/`--down`=파랑), `pc.css`, `mobile.css`.
- `frontend/src/test/` — `setup.js`, `smoke.test.js`(Vitest 하니스).
- `frontend/src/assets/` — 정적 에셋.

## 4. 파일·명명 규약 (코드 위치 찾기)

- **백엔드 라우터**: 도메인명 = 파일명 = 마운트 순서(`backend/routers/<domain>.py`). 엔드포인트 정본은 `API_SPEC.md`.
- **백엔드 서비스**: 도메인 로직은 `backend/services/<domain>_service.py` 또는 `<domain>.py`. 크게 자란 모듈은 동명 패키지(`storage/`, `market/`, `recommendation/`)로 분리하되 `__init__.py`가 표면을 re-export(ADR-0017) — `import` 위치는 패키지 루트로 유지된다.
- **외부 증권사 API**: `backend/services/kiwoom/`(키움) · `backend/services/kis/`(KIS), 각각 `client.py`(토큰/요청) + 기능별 모듈(`quote.py` 등).
- **시장지표**: `backend/services/market_indicators/<지표군>.py`, DB 캐시는 `cache.py` 경유.
- **배치**: 새 배치는 `backend/services/batch_registry.py`의 `BATCHES`에 등록 + `backend/scheduler/jobs.py`에 잡 함수 + `_JOB_FUNCS` 매핑. `id`는 레지스트리·스케줄러 잡·`job_runs.record` 셋이 일치해야 함.
- **프론트 페이지**: `frontend/src/pages/<PascalCase>.jsx`, 라우트는 `App.jsx`에 등록.
- **프론트 컴포넌트**: 도메인별 하위 디렉터리(`components/<domain>/`), UI 프리미티브는 `components/ui/`. 일부 컴포넌트는 동명 `.css` 파일을 짝으로 둠.
- **프론트 훅**: `frontend/src/hooks/use<Name>.js`, 테스트는 동명 `.test.js`.
- **테스트**: 백엔드 `backend/tests/test_*.py`(pytest), 프론트 `*.test.js`(Vitest, `frontend/src/test/` + 훅 옆).

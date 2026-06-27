---
last_mapped_commit: 74f5ca940c42a3ee866a45ccccfe24ac701a04d9
mapped: 2026-06-27
---
# 코드베이스 구조

**분석일:** 2026-06-27

## 디렉터리 레이아웃

```
PortfoliOn/
├── backend/                     # Python/FastAPI 백엔드
│   ├── main.py                  # 앱 엔트리(lifespan·라우터 mount·미들웨어)
│   ├── auth.py                  # 인증 의존성(JWT·API키·admin 게이트)
│   ├── routers/                 # 18개 APIRouter (HTTP 경계)
│   ├── services/                # 도메인 로직
│   │   ├── storage/             # user_stocks·tickers·스냅샷·스케줄 영속화
│   │   ├── market/              # 시세·재무·일봉 (KR/US 폴백 체인)
│   │   ├── market_indicators/   # FX/VIX/원자재/국채/경제지표/실적/수출/매크로
│   │   ├── kiwoom/              # 키움 REST(KR 1차 시세·차트·수급·섹터·공매도)
│   │   ├── kis/                 # 한국투자증권 REST(KR/US 백업 시세)
│   │   └── recommendation/      # 추천 점수 funnel·scoring·universe·store
│   ├── scheduler/               # APScheduler 잡(배치)
│   ├── middleware/              # event_tracker 미들웨어
│   ├── migrations/              # SQL 마이그레이션(수동 적용용)
│   ├── tests/                   # pytest 테스트(79개 파일)
│   ├── data/                    # 정적 참조 + 파일 캐시(gitignored)
│   ├── snapshots/               # per-ticker/date 스냅샷 JSON(gitignored)
│   ├── reports/                 # legacy 리포트(read-only 폴백)
│   ├── app_schema.sql           # 앱 스키마
│   ├── auth_schema.sql          # 인증 스키마(app보다 먼저 실행)
│   ├── requirements.txt         # Python 의존성
│   └── Dockerfile               # 백엔드 이미지
├── frontend/                    # React 19 + Vite
│   ├── src/
│   │   ├── main.jsx             # 렌더 엔트리
│   │   ├── App.jsx              # 라우팅·세션·OAuth 콜백
│   │   ├── api.js               # axios 인스턴스(Bearer·401 인터셉터)
│   │   ├── pages/               # 화면 컴포넌트
│   │   ├── components/          # 재사용 UI(reports/·market/·ui/·portfolio/·recommendations/)
│   │   ├── hooks/               # 데이터 페칭·상태 훅
│   │   ├── contexts/           # AuthContext
│   │   ├── utils/               # analytics·marketHours·pwa·priceFlash
│   │   ├── styles/              # tokens.css·pc.css·mobile.css
│   │   └── test/                # vitest setup·smoke
│   ├── vite.config.js           # Vite + PWA 설정
│   └── package.json
├── nginx/nginx.conf             # nginx 서빙·프록시 설정
├── docker-compose.yml           # 4컨테이너(postgres·backend·nginx·certbot)
├── deploy.sh                    # 배포 스크립트(frontend build→backend/nginx 교체)
├── scripts/                     # auto-deploy-poll·UAT(Playwright)·screenshot
├── .github/workflows/deploy.yml # self-hosted 러너 배포
├── API_SPEC.md                  # 전체 REST API 레퍼런스
├── CLAUDE_COWORK_API.md         # 외부 Cowork API
├── KIWOOM_API.md / KIS_API.md   # 외부 API 카탈로그
└── README.md
```

## 디렉터리 목적

**`backend/routers/`:**
- 목적: HTTP 경계 — APIRouter(prefix `/api/...`), Pydantic 검증, 인증 게이팅
- 포함: 도메인별 1파일(`stocks.py`·`report.py`·`portfolio.py`·`watchlist.py`·`market_indicators.py`·`analysis.py`·`analytics.py`·`auth.py`·`admin.py`·`guru.py`·`calendar.py`·`digest.py`·`events.py`·`rankings.py`·`investor.py`·`short_sell.py`·`batches.py`·`recommendations.py`)
- 핵심 파일: `routers/report.py`(505L, 최대)·`routers/stocks.py`(496L)

**`backend/services/`:**
- 목적: 도메인 로직
- 포함: 평탄 모듈(`consensus.py`·`consensus_pipeline.py`·`dividends.py`·`disclosures.py`·`insider_trades.py`·`backlog.py`·`backlog_parser.py`·`leverage_service.py`·`lending_service.py`·`investor_service.py`·`short_sell_service.py`·`supply_score.py`·`ranking_service.py`·`kr_sector_service.py`·`analysis_service.py`·`auth_service.py`·`guru_scraper.py`·`guru_stats.py`·`digest_service.py`·`indicators.py`·`charts.py`·`scraper.py`·`schedule_spec.py`·`job_runs.py`·`batch_registry.py`·`parallel.py`·`progress.py`·`utils.py`·`errors.py`) + 서브패키지
- 핵심 파일: `services/db.py`(풀)·`services/cache.py`(인메모리 캐시)·`services/storage/`·`services/report_generator.py`

**`backend/services/market_indicators/`:**
- 목적: 시장 지표 수집·캐시
- 포함: `cache.py`(`market_cache` read/write)·`fx.py`·`commodities.py`·`earnings.py`·`econ.py`·`exports.py`·`macro.py`

**`backend/services/kiwoom/`:**
- 목적: 키움 REST 연동(KR 읽기전용 1차 시세)
- 포함: `client.py`(토큰·request)·`quote.py`·`chart.py`·`investor.py`·`sector.py`·`shortsell.py`

**`backend/services/kis/`:**
- 목적: 한국투자증권 REST 연동(KR/US 백업 시세)
- 포함: `client.py`(토큰·request)·`quote.py`

**`backend/services/market/`:**
- 목적: 시세·재무·일봉 진입점(폴백 체인)
- 포함: `__init__.py`(re-export + `get_quote`)·`kr.py`·`us.py`·`format.py`

**`backend/services/storage/`:**
- 목적: PostgreSQL 영속화(ADR-0017 패키지 분리)
- 포함: `__init__.py`(re-export)·`portfolio.py`(user_stocks·tickers·enrich)·`names.py`(종목명 동기화)·`schedule.py`(batch_schedules·guru)·`dates.py`(expected_report_date)

**`backend/scheduler/`:**
- 목적: APScheduler 배치(services 아닌 루트 레벨 패키지)
- 포함: `__init__.py`(start/stop/reload)·`jobs.py`(잡 함수·`_JOB_FUNCS`)·`schedule.py`(트리거·시드·누락복구)·`_state.py`(공유 상태)

**`frontend/src/pages/`:**
- 목적: 라우트 화면 + 허브 탭
- 포함: 허브(`Research.jsx`=홈 `/`, `MarketHub.jsx`, `Portfolio.jsx`), 탭/하위화면(`Reports.jsx`·`Ranking.jsx`·`Calendar.jsx`·`Digest.jsx`·`Market.jsx`·`Analytics.jsx`·`Recommendations.jsx`·`SectorTab.jsx`·`MacroTab.jsx`), 설정(`Settings.jsx`·`ConsensusSettings.jsx`·`LeverageBackfillSettings.jsx`), 구루(`Guru.jsx`·`GuruManagers.jsx`·`GuruStats.jsx`·`GuruCrawlNow.jsx`), 기타(`LoginPage.jsx`·`AdminAnalytics.jsx`·`Showcase.jsx`·`ReportManualGen.jsx`)

**`frontend/src/components/`:**
- 목적: 재사용 UI
- 포함: 루트(`StockModal.jsx`·`PromoteModal.jsx`·`MobileNav.jsx`·`Toast.jsx`·`InstallPrompt.jsx`·`PermissionManager.jsx`·`PermissionPanel.jsx`·`BatchScheduleEditor.jsx`·`LoadingSpinner.jsx`) + 서브폴더
- `reports/`: 리포트 상세/목록(`StockActions.jsx`·`StockCard.jsx`·`TickerListItem.jsx`·`DetailTab.jsx`·`HistoryTab.jsx`·`ConsensusChart.jsx`·`FinancialsChart.jsx`·`BacklogChart.jsx`·`Sections.jsx`·각종 Section·`reportUtils.jsx`)
- `market/`: 시장지표 섹션(`FxSection`·`VixSection`·`CommoditiesSection`·`TreasurySection`·`EconIndicatorsSection`·`M7EarningsSection`·`KrTop2Section`·`KrExportsSection`·`LeverageSection`·`LendingSection`·`MacroSignalsSection`·`marketUtils.jsx`)
- `ui/`: 디자인 시스템(`Badge`·`Button`·`Card`·`Stat`·`Input`·`Skeleton`·`icons.jsx`·`InsiderBadge`·`SupplyBadge`·`index.js`)
- `portfolio/`: 대시보드(`DashboardCard`·`FlashValue`·`PriceFreshness`)
- `recommendations/`: `RecCard.jsx`

## 핵심 파일 위치

**엔트리 포인트:**
- `backend/main.py`: FastAPI 앱·lifespan·라우터 mount
- `backend/scheduler/__init__.py`: 스케줄러 start/stop
- `frontend/src/main.jsx` → `frontend/src/App.jsx`: 프론트 렌더·라우팅

**설정:**
- `backend/.env.docker`: 백엔드 시크릿(존재만 — 내용 비참조)
- `.env`(루트): docker-compose 보간용
- `frontend/vite.config.js`: Vite·PWA·청크
- `nginx/nginx.conf`: 서빙·프록시
- `docker-compose.yml` / `deploy.sh`: 배포
- `backend/pytest.ini`: pytest 설정

**핵심 로직:**
- `backend/services/db.py`: PostgreSQL 풀(`query`/`execute`/`get_connection`)
- `backend/services/storage/`: 영속화 진입점
- `backend/services/report_generator.py`: 스냅샷 생성
- `backend/services/cache.py`: 인메모리 캐시
- `backend/services/batch_registry.py`: 배치 메타데이터
- `backend/auth.py`: 인증 의존성

**테스트:**
- `backend/tests/*.py`: pytest(79개 파일, `test_<주제>.py`)
- `backend/tests/conftest.py`: `client` fixture·`get_current_user` override·quote 캐시 클리어
- `backend/tests/fixtures/`: 테스트 픽스처
- `frontend/src/test/setup.js`·`smoke.test.js` + `*.test.js`(`hooks/useReportFilters.test.js`·`useStockManagement.test.js`): vitest

**스키마:**
- `backend/auth_schema.sql`: users·refresh_tokens (먼저 실행)
- `backend/app_schema.sql`: tickers·user_stocks·snapshots·schedules·market_cache 등
- `backend/migrations/*.sql`: 추가 마이그레이션(`main.py:_migrate()`도 기동 시 idempotent DDL)

## 명명 규칙

**백엔드 파일:**
- 라우터: `routers/<도메인>.py` (snake_case)
- 서비스: `services/<도메인>_service.py` 또는 `services/<도메인>.py`
- 외부 API 서브패키지: `services/<provider>/{client,quote,...}.py`
- 테스트: `tests/test_<주제>.py`
- private 헬퍼: `_` 접두(`_build_all`·`_JOB_FUNCS`·`_mc_load`)

**프론트엔드 파일:**
- 컴포넌트/페이지: PascalCase `.jsx` (`StockActions.jsx`·`Research.jsx`)
- 훅: camelCase `use*.js` (`usePortfolioData.js`)
- 유틸: camelCase `.js` (`marketHours.js`)
- 스타일: 컴포넌트 동명 `.css`(co-located, `DashboardCard.css`) 또는 `styles/`(전역 토큰)

**배치 id:**
- `<도메인>_<market>` 또는 `<도메인>_<동작>` (`daily_report_kr`·`leverage_fetch`·`recommendation_us`)
- job_id = 스케줄러 잡 id = `job_runs.record` id 일치 필수

## 신규 코드 추가 위치

**새 API 엔드포인트:**
- 라우터: 해당 도메인 `backend/routers/<도메인>.py`에 추가, 없으면 새 파일 + `main.py`에 `include_router`
- 도메인 로직: `backend/services/`에 두고 라우터는 얇게
- 문서: `API_SPEC.md` + (Cowork면 `CLAUDE_COWORK_API.md`) 동기 갱신(DoD), 엔드포인트 존재 drift는 `tests/test_api_doc_sync.py`가 자동검출

**새 서비스 로직:**
- 단일 모듈: `backend/services/<이름>.py` 또는 `<이름>_service.py`
- 거대해지면 ADR-0017 패턴(서브패키지 + `__init__.py` re-export)

**새 배치:**
- `backend/services/batch_registry.py`의 `BATCHES`에 항목 추가
- `backend/scheduler/jobs.py`에 잡 함수 + `_JOB_FUNCS` 등록
- `job_runs.record(job_id, trigger)`로 계측

**새 외부 API 연동:**
- `backend/services/<provider>/` 서브패키지(`client.py` 토큰·request + 기능 모듈)
- 키 미설정이 안전 기본값(휴면)이 되도록

**새 시장지표:**
- `backend/services/market_indicators/<지표>.py`, `cache.py`의 `_mc_load`/`_mc_save`로 `market_cache` 영속
- 프론트 섹션: `frontend/src/components/market/<Name>Section.jsx`

**새 프론트 화면:**
- 페이지: `frontend/src/pages/<Name>.jsx`, `App.jsx` Routes 등록(권한 필요 시 `menuPermissions`/`admin.py:ALL_MENUS`)
- 재사용 컴포넌트: 도메인별 `frontend/src/components/<group>/`
- 데이터 페칭: `frontend/src/hooks/use*.js`

**새 테스트:**
- 백엔드: `backend/tests/test_<주제>.py` (`conftest.py`의 `client` fixture 활용)
- 프론트: `frontend/src/**/*.test.js` (vitest)

**공유 액션 버튼(중요):**
- 리포트 종목 액션(수정·승격·삭제)은 단일 컴포넌트 `frontend/src/components/reports/StockActions.jsx`(`layout="card"|"list"`)로 통합(task#103). `StockCard.jsx`(그리드)·`TickerListItem.jsx`(사이드바)가 공유하므로 액션버튼/게이트 변경은 여기 한 곳만. 가시성은 category 아닌 `is_mine`으로 게이트.

## 특수 디렉터리

**`backend/snapshots/`:**
- 목적: per-ticker/date 스냅샷 JSON
- 생성: Yes (report_generator)
- 커밋: No (gitignored, DB가 source of truth, 파일은 폴백)

**`backend/data/`:**
- 목적: 정적 참조(`sp500_tickers.json`·`kospi_tickers.json`) + 런타임 파일 캐시(`calendar/`·`consensus/`·`digest/`)
- 생성: 정적은 커밋, 캐시는 런타임 생성
- 커밋: 정적만 (캐시·legacy JSON은 gitignored)

**`backend/reports/`:**
- 목적: legacy 리포트(구 스냅샷 JSON 폴백)
- 생성: No
- 커밋: read-only

**`scripts/`(루트):**
- 목적: 배포 폴러(`auto-deploy-poll.sh`)·UAT Playwright(`uat-*.js`)·screenshot
- 생성: No
- 커밋: Yes (단 `node_modules`는 제외)

**`.claude/worktrees/`:**
- 목적: forge 워크트리(분리 작업 공간)
- 커밋: No (gitignored)

---

*구조 분석: 2026-06-27*

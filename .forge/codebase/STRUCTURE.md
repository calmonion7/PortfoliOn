---
last_mapped_commit: 9de05a1ee9f11c92f58807adeff3dcc2cab63550
mapped: 2026-07-03
---

# STRUCTURE — PortfoliOn 디렉터리 지도

## 루트

```
PortfoliOn/
├── backend/               # FastAPI (port 8000)
├── frontend/              # React 19 + Vite (port 5173)
├── nginx/                 # nginx 설정 (HTTP 80, /api/* 프록시)
├── certbot/               # 인증서 갱신 컨테이너 자원
├── scripts/               # auto-deploy-poll.sh 등 운영 스크립트
├── docker-compose.yml     # postgres / backend / nginx / certbot 4-컨테이너
├── deploy.sh              # 정식 배포 스크립트 (러너·폴러가 호출)
├── API_SPEC.md            # 전체 REST 레퍼런스 (엔드포인트 정본)
├── CLAUDE_COWORK_API.md   # 외부 Cowork용 enrich API 명세
├── KIWOOM_API.md / KIS_API.md  # 증권사 API 카탈로그·대체 로드맵
├── start.sh / start.bat / stop.sh / stop.bat
└── .forge/                # forge 상태·ADR·회고 (untracked, 폴러 reset 안전)
```

## backend/

```
backend/
├── main.py                # 앱 진입점 — lifespan에서 _migrate()(기동 idempotent 마이그레이션) + 라우터 마운트 + scheduler.start()
├── auth_schema.sql        # 인증 스키마 (users, refresh_tokens) — 반드시 먼저 실행
├── app_schema.sql         # 앱 스키마 (tickers, user_stocks, snapshots, market_cache 등) — auth 다음
├── Dockerfile / requirements.txt
├── .venv/                 # 로컬 파이썬 (macOS: .venv/bin/python) — Docker 의존성과 다름(lxml 없음)
├── .env.docker            # 배포 환경변수 (gitignored)
├── data/                  # 정적 참조(sp500_tickers.json, kospi_tickers.json) + 파일 캐시(calendar/, consensus/, gitignored)
├── snapshots/             # per-ticker/date 리포트 JSON (gitignored)
└── reports/               # legacy 리포트 (read-only 폴백)
```

### backend/routers/ — HTTP 계층 (20개)

`admin.py`(사용자·권한·ALL_MENUS) · `analysis.py`(섹터 모멘텀 US/KR·매크로 상관) · `analytics.py`(상관관계) · `auth.py` · `batches.py`(GET /api/batches 배치 현황) · `calendar.py`(파일 캐시 기반) · `digest.py` · `events.py`(user_events 수집) · `guru.py` · `investor.py`(수급 추이) · `market_indicators.py` · `portfolio.py` · `rankings.py` · `recommendations.py` · `report.py`(리포트 목록/상세/backlog/disclosures/agm/insider) · `short_sell.py` · `stocks.py`(대시보드 `_build_all`·enrich — `enrich/batch`를 `{ticker}/enrich`보다 먼저 등록) · `watchlist.py`

### backend/services/ — 로직 계층

단일 모듈:
- `db.py` — 커넥션 풀 + `query`/`execute`/`execute_many`(배치 helper)
- `cache.py` — 인메모리 TTLCache 8종(snapshot/list/dashboard/correlation/sector/macro/quote/live_prices)
- `batch_registry.py` — `BATCHES` 26종 정적 메타(정본), `job_runs.py` — 배치 실행 이력 record
- `schedule_spec.py` — batch_schedules 스펙 파싱/검증
- `report_generator.py` — 리포트 스냅샷 생성(시장 데이터만, LLM 없음; KR은 regular=True + 독립피드 박제 게이트)
- `digest_service.py` — 일일 다이제스트(get_quotes_batch 1콜 + 저장 FX)
- `ranking_service.py`(빈 결과 wipe 가드) · `kr_sector_service.py` · `us_sector_service.py`(us_sector_fetch 배치 백킹) · `analysis_service.py`(SECTOR_ETFS·MACRO_TICKERS·`_fetch_etf`)
- `backlog.py`/`backlog_parser.py`(DART document.xml 수주잔고) · `disclosures.py` · `agm.py` · `insider_trades.py` · `dividends.py` · `consensus.py`/`consensus_pipeline.py`
- `investor_service.py` · `short_sell_service.py` · `supply_score.py` · `us_supply.py` · `leverage_service.py` · `lending_service.py`(KOFIA/금융위)
- `guru_scraper.py`/`guru_stats.py` · `scraper.py` · `indicators.py`(RSI/EMA 등) · `auth_service.py`
- `utils.py`(NaN/Inf sanitize) · `errors.py` · `parallel.py`(parallel_map) · `progress.py`

패키지:
- `market/` — `__init__.py`(re-export·`get_quote`/`get_quotes_batch`/`get_history_df`, ADR-0017), `kr.py`(키움→KIS→Naver 체인·2-of-N 다수결·degenerate 재사용·DART 재무), `us.py`(yfinance→KIS), `format.py`(`_yf_val` 등 공용 포맷)
- `market_indicators/` — `cache.py`(`_mc_load`/`_mc_save` market_cache I/O), `fx.py`, `commodities.py`, `earnings.py`(M7/KR Top2), `econ.py`(FRED), `exports.py`(KR 수출), `macro.py`(FRED 매크로 신호), `indices.py`(지수 레벨+Shiller CAPE)
- `kiwoom/` — `client.py`(토큰·`request`·`integrated_code` regular 분기점), `quote.py`(ka10001), `chart.py`(ka10081 일봉), `sector.py`, `investor.py`, `shortsell.py`
- `kis/` — `client.py`(tokenP·60s 재발급 가드·`configured()`), `quote.py`(KR FHKST01010100 + US HHDFS*)
- `storage/` — `portfolio.py`(user_stocks/tickers CRUD·클로버 방지 UPSERT), `names.py`(refresh/reconcile_snapshot_names), `dates.py`(expected_report_date), `schedule.py`
- `recommendation/` — `funnel.py`·`scoring.py`·`universe.py`·`store.py`·`actions.py` (추천 엔진, ADR-0015/0016)

### backend/scheduler/ — APScheduler 패키지 (services 아님, 루트 레벨)

- `__init__.py` — 잡 배선·re-export·`start()/stop()/reload()`
- `jobs.py` — 잡 함수(`_generate_kr/us`, `_fetch_*`, `_seed_*_if_empty`) + `_JOB_FUNCS`
- `schedule.py` — 트리거 빌드·리스케줄·스케줄 시드·누락 리포트 복구
- `_state.py` — AsyncIOScheduler 싱글톤 + 상수 (leaf)

### backend/tests/ — pytest (~110 파일)

- `conftest.py` — `main.app` 기반 client(auth override). 다수 테스트는 자체 `FastAPI()` app + `dependency_overrides`(auth Depends 추가 시 전수 grep 필요).
- 명명: `test_<모듈|기능>.py` (예: `test_kr_quote_degenerate_reuse.py`, `test_rankings_empty_guard.py`, `test_db_execute_many.py`, `test_report_jobruns_market.py`).
- 배치 id 단언이 4파일에 분산: `test_scheduler_seed.py`·`test_batch_market_split.py`·`test_batches_router.py`·`test_macro_signals_batch.py` — 배치 추가/은퇴 시 전부 갱신.
- `test_api_doc_sync.py` — 라이브 routes ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md` 엔드포인트 존재 drift 자동검출.
- `fixtures/` — 파싱 fixture (단, 외부소스 파싱은 fixture-pass-live-fail 가족 — 라이브 대조 DoD).

## frontend/src/

```
frontend/src/
├── main.jsx               # SPA 진입점
├── App.jsx                # 라우팅 + nav (권한 필터)
├── api.js                 # API 클라이언트
├── contexts/AuthContext.jsx
├── hooks/                 # usePortfolioData, useReportList, useReportFilters, useStockManagement, useTheme, usePriceFlash 등 (+ *.test.js — vitest, ADR-0019)
├── utils/                 # analytics.js, marketHours.js, priceFlash.js, pwa.js
├── styles/tokens.css      # KR 색 관례: --up=빨강(상승)·--down=파랑(하락)
├── pages/
└── components/
```

### pages/ — 허브 2종 + 탭용 개별 페이지

- **허브**: `Research.jsx`(홈 `/` — 리포트·랭킹·추천·다이제스트·캘린더 탭; 리포트 탭이 종목 관리 흡수), `MarketHub.jsx`(`/market` — 시장지표·수급지표 2탭)
- **독립 페이지**: `Portfolio.jsx`(`/portfolio` 대시보드+분석 탭), `Settings.jsx`, `Guru.jsx`(+`GuruCrawlSettings`→`GuruCrawlNow.jsx`·`GuruManagers.jsx`·`GuruStats.jsx`), `LoginPage.jsx`, `AdminAnalytics.jsx`, `Showcase.jsx`(`/dev/showcase`)
- **허브 내 탭용**: `Reports.jsx`, `Ranking.jsx`, `Recommendations.jsx`, `Calendar.jsx`, `Digest.jsx`, `Market.jsx`, `Analytics.jsx`, `SectorTab.jsx`/`MacroTab.jsx`(Portfolio 분석 탭), `ConsensusSettings.jsx`, `LeverageBackfillSettings.jsx`, `ReportManualGen.jsx`

### components/

- 루트: `StockModal.jsx`, `PromoteModal.jsx`, `BatchScheduleEditor.jsx`, `PermissionManager.jsx`/`PermissionPanel.jsx`, `MobileNav.jsx`, `Toast.jsx`(ToastProvider), `LoadingSpinner.jsx`, `InstallPrompt.jsx`(PWA)
- `reports/` — 리포트 상세/목록: `ReportDetailTabs.jsx`·`ReportDetailHeader.jsx`·`DetailTab.jsx`·`HistoryTab.jsx`·`Sections.jsx`·`ConsensusChart.jsx`·`FinancialsChart.jsx`·`BacklogChart.jsx`·`SupplySection.jsx`·`ShortSellSection.jsx`·`InvestorTrendSection.jsx`·`InsiderTradesSection.jsx`·`UsInsiderSection.jsx`·`UsSupplySection.jsx`·`GuruHoldersSection.jsx`·`LatestDisclosuresSection.jsx`·`ReportFilters.jsx`·`reportUtils.jsx` — **액션 버튼은 단일 `StockActions.jsx`**(`layout="card"|"list"`, `StockCard.jsx`·`TickerListItem.jsx` 양쪽 사용, is_mine 게이트)
- `market/` — 시장지표 섹션: `FxSection`·`VixSection`·`CommoditiesSection`·`TreasurySection`·`IndexSection`·`EconIndicatorsSection`·`MacroSignalsSection`·`M7EarningsSection`·`KrTop2Section`·`KrExportsSection`·`LeverageSection`·`LendingSection`·`marketUtils.jsx`(krFmt — 입력 '억원' 단위 가정)
- `portfolio/` — `DashboardCard.jsx`, `FlashValue.jsx`, `PriceFreshness.jsx`
- `recommendations/` — 추천 탭 컴포넌트
- `ui/` — 디자인 시스템: `Badge`·`Button`·`Card`·`Input`·`Stat`·`Skeleton`·`icons.jsx`·`SupplyBadge.jsx`(의미 배지 전용색)·`InsiderBadge.jsx`·`index.js`

## 명명 관례

- 백엔드: 모듈 private 함수 `_underscore`, 배치 잡 함수 `_fetch_<대상>`/`_generate_<시장>`, 배치 id `<대상>_fetch` 또는 `<기능>_<kr|us>`(시장 분리), market_cache key는 snake_case(`us_sector_momentum` 등).
- 프론트: 컴포넌트 PascalCase `.jsx`, 훅 `use*.js`, 섹션 컴포넌트 `<대상>Section.jsx`, CSS는 컴포넌트 동명 `.css`(plain CSS, Tailwind 없음).
- 테스트: 백엔드 `backend/tests/test_*.py`, 프론트 co-located `*.test.js(x)`(vitest).
- 스키마 실행 순서: `auth_schema.sql` → `app_schema.sql`. `supabase_schema.sql`은 legacy 잔존.

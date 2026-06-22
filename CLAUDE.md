# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes, followed by PortfoliOn project context.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# PortfoliOn — Project Context

## Commands

```bash
# Start both servers (Windows)
start.bat

# Start both servers (macOS/Linux)
./start.sh

# Backend only (from project root)
cd backend && python -m uvicorn main:app --reload --port 8000

# Frontend only
cd frontend && npm run dev

# Backend tests
cd backend && .venv/bin/python -m pytest
```

## Architecture

**Backend** — Python/FastAPI (port 8000)

- `backend/main.py` — app entry, mounts routers + scheduler
- `backend/routers/` — portfolio, watchlist, stocks, report, guru, calendar, digest, market_indicators, analytics, analysis, auth, admin, events
- `backend/services/` — storage, market (yfinance+Naver API), charts, indicators, report_generator, scraper, consensus, consensus_pipeline, cache, guru_scraper, guru_stats, digest_service, leverage_service, lending_service, analysis_service, auth_service, utils (NaN/Inf sanitize), db, errors, parallel, progress
- `backend/services/market_indicators/` — 시장 지표 패키지: `cache.py` (PostgreSQL market_cache 읽기/쓰기), `fx.py` (FX/VIX), `commodities.py` (원자재/국채), `earnings.py` (M7/KR Top2), `econ.py` (FRED 경제지표), `exports.py` (KR 수출), `macro.py` (FRED 매크로 신호 — 금리차/HY/M2/기준금리 + 신호 판정)
- `backend/scheduler.py` — APScheduler 설정 (services 아님, 루트 레벨)
- `backend/data/` — 정적 참조 데이터만 (sp500_tickers.json, kospi_tickers.json); 런타임 데이터는 Docker PostgreSQL
- `backend/data/calendar/` — calendar file cache (YYYY-MM.json, gitignored, auto-invalidated on stock mutations)
- `backend/data/consensus/` — per-ticker 컨센서스 JSON 캐시 (gitignored, 로컬 파일 기반)
- `backend/snapshots/` — generated JSON snapshots (gitignored, per-ticker/date)
- `backend/reports/` — legacy report directory (read-only, JSON fallback for old snapshots)

**Frontend** — React 19 + Vite (port 5173), plain CSS (no TailwindCSS)

- `frontend/src/pages/` — Portfolio (`/portfolio`, 대시보드·분석 전용 — 종목 관리는 리서치로 이동), Settings, Guru (+ GuruCrawlSettings, GuruManagers, GuruStats, ReportSchedule), ConsensusSettings, LoginPage, Showcase, AdminAnalytics (admin 전용 사용자 행동 분석, `/admin-analytics`), LeverageBackfillSettings (수급지표 백필); 허브 2종: Research (홈 `/`, 리포트·랭킹·다이제스트·캘린더; 리포트 탭이 보유/관심 종목 관리=라이브 P&L·편집·삭제·승격·추가 흡수), MarketHub (=Market, 시장지표·수급지표 2탭); 탭 컴포넌트: SectorTab, MacroTab (섹터·매크로는 Portfolio 분석탭으로 통합됨); 개별 페이지(허브 내 탭용): Reports, Ranking, Calendar, Digest, Market, Analytics
- `frontend/src/components/` — StockModal, PromoteModal, PermissionManager, PermissionPanel, LoadingSpinner, MobileNav, Toast (ToastProvider), portfolio/ (DashboardCard), reports/ (ConsensusChart, DetailTab, FinancialsChart, HistoryTab, Sections, reportUtils), market/ (FxSection, VixSection, CommoditiesSection, TreasurySection, EconIndicatorsSection, M7EarningsSection, KrTop2Section, KrExportsSection, LeverageSection, LendingSection, marketUtils.jsx), ui/ (Badge, Button, Card, Stat, icons)

## Deployment

- **인프라**: Mac 로컬 Docker 4-컨테이너 (Render/Vercel/Supabase 제거)
- **nginx**: HTTP(80) 서빙, /api/* → backend:8000 프록시
- **프론트 서빙**: nginx가 `./frontend/dist`를 `:ro` 볼륨마운트로 직접 서빙. 로컬 `cd frontend && npm run build`가 **즉시 라이브**(서빙 번들 해시=로컬 빌드 해시로 검증 가능). `git push`는 폴러 재배포/영속용이며, **백엔드 변경은 폴러 재배포 후에야 라이브** 반영된다(프론트만 먼저 빌드하면 백엔드 의존 기능이 미동작).
- **backend**: FastAPI 컨테이너 (port 8000)
- **postgres**: PostgreSQL 16 컨테이너, pgdata 볼륨
- **certbot**: HTTPS 인증서 자동 갱신 컨테이너 (certbot/certbot) — docker compose 4번째 컨테이너
- **Cloudflare Tunnel**: portfolion.taebro.com → localhost:80 (cloudflared는 compose 컨테이너가 아니라 launchd로 실행)
- **launchd 자동실행**: cloudflared + docker compose
- **환경변수**: `backend/.env.docker` (POSTGRES_PASSWORD, JWT_SECRET, SESSION_SECRET, OAuth, FRED_API_KEY, KOFIA_API_KEY), `.env` (루트, docker-compose 보간용)
- **배포**: `git push origin main` 시 자동 배포됨(GitHub Actions 러너 + 폴러 폴백). `docker compose build` / `docker compose up` 같은 *ad-hoc* 재빌드는 하지 말 것.
- **배포 메커니즘 주의 (검증된 사실 + 미확정 영역, task#104)**: 배포 경로는 **GitHub Actions 러너(주) + 폴러(폴백)**다. 폴러(`scripts/auto-deploy-poll.sh`)는 `origin/main`이 **로컬 HEAD보다 앞설 때만** `deploy.sh`를 돌리므로, **이 배포 체크아웃 안에서 직접 commit→push하면(`LOCAL==origin/main`) 폴러는 안 돈다** — 그 경우 배포는 *러너*가 처리한다(이게 정상 동작하면 push로 배포됨). **백엔드가 옛 코드/이상 동작으로 보이면**: ① 도커 재기동 churn(컨테이너 uptime 제각각·certbot 등 일부 미기동)을 **먼저** 의심하고(`docker ps`로 uptime 확인 — backend는 `docker run`이라 `docker compose ps`엔 안 잡힘), ② 필요 시 정식 스크립트 **`bash deploy.sh` 1회**로 백엔드 컨테이너 재생성(working tree rebuild+stop/rm/run — 금지된 ad-hoc `docker compose`가 아님). 프론트는 nginx가 `frontend/dist` 직접 서빙이라 `npm run build`로 즉시 라이브(배포 무관). ※ task#104에서 "in-checkout push는 절대 배포 안 됨"으로 단정했으나 그건 폴러 로그만 보고 러너를 놓친 과잉결론 — 러너 동작 여부는 미확정이니 단정 말 것.
- **⚠️ 자동 배포 폴러 (작업 시 주의)**: launchd `com.portfolion.auto-deploy-poll`이 2분마다 `scripts/auto-deploy-poll.sh`를 돌려 `origin/main`이 로컬 HEAD보다 앞서면 `git reset --hard origin/main` 후 배포한다. → 메인 체크아웃에서 **커밋 안 한(또는 push 안 해 로컬이 origin보다 앞선) tracked 편집은 다음 폴(≤2분)에 소실**된다. 코드 변경은 **commit과 `git push origin main`을 묶어 즉시** 반영할 것. `.forge/` 등 untracked 파일은 `reset --hard` 대상이 아니라 안전.

## Key Files

- `API_SPEC.md` — full REST API reference (source of truth for endpoints)
- `CLAUDE_COWORK_API.md` — external API for Claude AI to read/write stock analysis
- `backend/auth_schema.sql` — Docker PostgreSQL 인증 스키마 (users, refresh_tokens); 반드시 app_schema.sql보다 먼저 실행
- `backend/app_schema.sql` — Docker PostgreSQL 앱 스키마 (tickers, user_stocks, snapshots, schedules, guru_managers, guru_schedules, digests, consensus_history, calendar_cache, market_cache, user_menu_permissions, user_events, market_leverage_indicators, market_lending_balance)
- `backend/.venv/` — Python virtual environment (macOS: `backend/.venv/bin/python`, Windows: `backend/.venv/Scripts/python`)

## Data Model

Docker PostgreSQL이 기본 저장소. 로컬 JSON 파일은 런타임 캐시 용도.

스키마: `auth_schema.sql` → `app_schema.sql` 순서로 실행.

| 테이블 | 내용 |
|--------|------|
| `users` | 이메일/OAuth 계정, role (`user`\|`admin`) |
| `refresh_tokens` | JWT 리프레시 토큰 |
| `tickers` | 공유 종목 마스터 (ticker, name, market, moat 등) |
| `user_stocks` | user_id별 보유/관심 종목 (`type: "holding"\|"watchlist"`) |
| `snapshots` | per-ticker, per-date 리포트 JSON (공유) |
| `schedules` | 리포트 자동 생성 스케줄 (전역 단일 행) |
| `guru_schedules` | 구루 크롤링 스케줄 (전역 단일 행) |
| `guru_managers` | 구루 운용역 데이터 캐시 (전역 단일 행) |
| `digests` | user_id+date 기준 일일 다이제스트 |
| `consensus_history` | ticker+date 기준 컨센서스 히스토리 |
| `calendar_cache` | user_id+month 기준 캘린더 이벤트 캐시 |
| `market_cache` | 시장지표 영구 캐시 (fx/vix/commodities/treasury/econ/m7/krtop2/krexports) |
| `user_menu_permissions` | user_id+menu 기준 메뉴 접근 권한 |
| `user_events` | user_id+event_name+properties 사용자 행동 로그 |
| `market_leverage_indicators` | 신용잔고·반대매매·시총 시계열 (base_date 기준) |
| `market_lending_balance` | 내외국인 대차잔고 시계열 (base_date 기준) |
| `default_menu_permissions` | 신규 사용자 기본 메뉴 권한 (menu별 allowed 기본값) |
| `raw_reports` | 종목별 원본 AI 리포트 텍스트 |
| `daily_consensus_mart` | 컨센서스 일일 집계 마트 (ticker+date 기준) |

로컬 파일 캐시 (gitignored):
- `backend/data/consensus/` — per-ticker 컨센서스 (Naver/yfinance, 로컬 파일 기반)
- `backend/data/calendar/` — 월별 캘린더 이벤트

## Gotchas

- **API 변경 시 명세서 2개 모두 갱신**: 엔드포인트 추가/삭제·요청/응답 스키마·인증 게이팅을 바꾸면 `API_SPEC.md`(전체 REST 레퍼런스)와 `CLAUDE_COWORK_API.md`(외부 Cowork API)를 **항상 함께** 업데이트(DoD에 포함). 한쪽만 고치면 다른 쪽이 stale돼 Cowork/소비자가 잘못된 명세로 호출한다. **엔드포인트 *존재* drift(method+path 추가/삭제/개명)는 `backend/tests/test_api_doc_sync.py`가 자동검출**(라이브 `app.routes` ↔ 두 문서 `### \`METHOD /path\`` 헤더 대조, task#99) — 새 엔드포인트를 `API_SPEC.md`에 안 적으면 테스트 실패. 미문서화 기존 23개는 `KNOWN_UNDOCUMENTED` exact-match 베이스라인으로 동결(문서화하면 거기서 빼야 통과). 단 **요청/응답 스키마·인증 게이팅 동기는 여전히 수동 DoD**(테스트는 존재만 검증, prose 파싱 안 함).
- **기능 표면을 바꾸면 `README.md` 해당 절도 같은 PR에서 갱신(DoD)**: README가 문서화하는 표면 — ① 화면 구성(nav 탭/화면 기능) ② 환경변수(env/데이터 소스 키) ③ 기술 스택(라이브러리/외부 연동) ④ 아키텍처(router/service/table) ⑤ 배치 — 중 하나라도 추가·삭제·개명되어 기존 절이 stale해지는 변경은 README의 그 절을 함께 손본다. README는 **overview 레벨**이라 엔드포인트/요청·응답 스키마 세부는 여기 중복하지 말고 `API_SPEC.md`/`CLAUDE_COWORK_API.md`에만 둘 것(위 doc-sync 규칙과 역할 분담). 안 지키면 README가 드리프트해 신규 합류자·외부 소비자가 옛 화면구성/키/스택으로 오인한다(task#47 README 전수 재조정이 누적 드리프트를 한 번에 청소한 사례).
- `PUT /api/stocks/enrich/batch` must be registered **before** `PUT /api/stocks/{ticker}/enrich` in the router to avoid FastAPI routing `enrich` as a ticker value.
- **엔드포인트 응답을 비-additive로(배열→객체 등) 바꾸면 그 엔드포인트를 fetch하는 *모든* 프론트 소비처를 전수 grep**: `grep -rn '<엔드포인트 경로>' frontend/src/`로 독립 fetcher까지 찾아 전부 갱신할 것. 한 소비처만 고치면 다른 곳(예: `Analytics.jsx`가 훅과 별개로 `/api/stocks/dashboard`를 직접 fetch)이 `res.data`를 옛 형태(배열)로 취급해 조용히 깨진다(task52: 대시보드 배열→`{holdings,totals}` 변경 시 상관관계 탭이 항상 "보유종목 없음" — 워크플로우·적대적 리뷰 둘 다 놓치고 메인 세션 grep이 포착). 가능하면 **additive(필드 추가)**를 선호하고, reshape가 불가피하면 소비처 전수 감사를 DoD에 포함. (배치 id 4표면 grep의 프론트-계약판.)
- **엔드포인트에 read/외부호출을 additive로 *추가*하면 `mock.call_args`(마지막 호출)를 단언하는 기존 테스트가 조용히 오염된다** — additive는 응답 *shape*뿐 아니라 *호출 시퀀스*도 늘린다. 기존 테스트가 단일 호출을 전제로 마지막 호출 인자(`exclude_tickers`/`limit` 등)를 `mock.call_args`로 단언하면, 두 번째·세 번째 호출이 끼는 순간 마지막 호출이 신규 호출로 바뀌어 거짓통과/오류가 난다. 대응: ① 기존 단언은 **호출별 `call_args_list[i].kwargs`**로 마이그레이션(인덱스로 해당 호출 명시), ② 신규 호출은 **`if <조건>:`로 입력 비면 생략**(예: 빈 watchlist/holdings면 추가 read 안 함)해 기존 테스트를 보존, ③ 신규 테스트가 **`call_count`로 시퀀스를 못박음**. (위 비-additive reshape 가토의 *테스트판 사촌* — 깨지는 건 응답이 아니라 모킹된 호출 시퀀스. `GET /api/recommendations`에 watchlist→holdings read를 순차 additive 추가하며 두 번 재현·검증, task#66·67.)
- CORS origins: `localhost:3000`, `localhost:5173`, `FRONTEND_URL` env var (`backend/main.py`). 배포 시 `FRONTEND_URL`을 `.env.docker`에 설정.
- `start.bat` runs both servers in hidden PowerShell windows; use `stop.bat` to kill them.
- 백엔드 리포트 생성(`report_generator`)은 시장 데이터 스냅샷만 만든다 — **백엔드에 LLM/Anthropic 호출 없음**(`requirements.txt`에 anthropic 없음). AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API(`CLAUDE_COWORK_API.md`)로 작성한다. `ANTHROPIC_API_KEY`는 `.env.docker`에 남아있으나 현재 백엔드에서 미사용.
- Vite proxies `/api/*` to `http://localhost:8000` (로컬). 배포 환경에서는 `VITE_API_BASE_URL`로 nginx 직접 호출 (미설정 시 상대경로 사용).
- **Vite 8 = rolldown 번들러**: 청크 분할 시 `vite.config.js`의 `build.rollupOptions.output.manualChunks`는 **함수 형식만** 받는다 — rollup식 객체형(`{name: [pkgs]}`)을 쓰면 `Expected Function but received Object`로 빌드가 깨진다. `manualChunks(id)`에서 id substring(`node_modules` 경로)으로 분기하고, 거대 의존성(recharts+d3 등)은 트랜지티브까지 매처에 포함해야 의도한 청크가 생성된다. (task 28 retro)
- `backend/routers/calendar.py` uses file-based cache (`backend/data/calendar/YYYY-MM.json`). Cache is auto-cleared on stock add/remove/promote. To manually clear: use `DELETE /api/calendar/cache?month=YYYY-MM` or click ↺ in the UI. yfinance calls are parallelized (ThreadPoolExecutor, max 30).
- `backend/services/cache.py` — 인메모리 캐시 6종: snapshot (LRU 200), list (TTL 5s), dashboard (TTL 300s), correlation (TTL 300s), sector (TTL 300s), macro (TTL 300s). 종목 추가/수정/삭제 시 dashboard·correlation·sector·macro 캐시 자동 무효화. 수동 무효화: `DELETE /api/stocks/dashboard/cache`.
- **대시보드 빌드는 "holdings=N → 항상 N카드" 불변식 — 500-to-empty 금지(task#102)**: `GET /api/stocks/dashboard`의 `_build_all`(`routers/stocks.py`)은 `get_quotes_batch`(try/except→{}) + 카드당 `_safe`(throw→`_minimal_card`)로 감싸 **일괄시세·per-card enrichment(snapshot/consensus/배당/수급/내부자) 실패에도 전체 500을 안 낸다**. 콜드 첫 호출에 **10-워커 ThreadPool×카드당 다중 DB read가 풀 경합(PoolError, CONCERNS §4)/throw → 500 → 프론트 `usePortfolioData.fetchDashboard` catch가 silent로 삼킴 → 빈 그리드**였고, 헤더(`/api/portfolio`=단일 쿼리·ThreadPool 없음)는 N 정상이라 "헤더 N·그리드 빈"이 됐다(첫 로딩만, 재네비=풀 warm면 정상). 프론트도 방어: `Portfolio.jsx` `DashboardGrid`는 `stocks>0`이면 빈상태 대신 Skeleton(헤더↔그리드 모순 제거), self-heal은 one-shot이 아니라 **bounded 재시도(최대 3)** — 첫 콜드 실패에 한 방 헛쓰고 재마운트 전까지 stuck하던 회귀 차단. **헤더 N인데 그리드 빈** 증상을 보면 dashboard 빌드 throw(풀 경합 등)와 **프론트 silent catch**를 의심할 것. (풀 sizing 자체 튜닝은 별도 후속 — 이 가드는 증상 차단.) **단, 실제 근본은 per-card throw가 아니라 `_portfolio_totals` NaN→직렬화 500이었다(task#104)**: `_usdkrw_rate()`가 저장 FX의 비유한값(nan)을 그대로 반환→`if fx is None` 가드를 통과(NaN≠None)→US 카드 totals=NaN→starlette `allow_nan=False` 직렬화 500. cold·warm 무관 결정적 500(per-card 가드 *위* 단계라 task#102가 못 막음). 수정: ① `_usdkrw_rate`에 `math.isfinite` 가드(비유한→None, US totals graceful 제외) ② `_build_all` 반환을 `services.utils.sanitize`로 감싸 NaN/inf→None(출처 불문 직렬화 500 안전망, CONCERNS §3). 외부시세서 흘러든 NaN은 응답 dict 어디든 들어갈 수 있으니 **시세/합산을 응답에 싣는 엔드포인트는 sanitize 또는 소스 isfinite 가드 필수**.
- **종목명은 dual-source** — `tickers.name`(공유 마스터, 종목관리 목록이 live로 읽음) vs `snapshots.data.name`(리포트 생성 시 박제, 리서치 목록·상세가 읽음). 이름 변경 시 **둘 다** 갱신해야 목록↔상세가 일치한다(`storage.refresh_snapshot_names` 단건 / `reconcile_snapshot_names` 전체 동기화). DB만 바꾸면 리포트 목록 캐시(`cache.get_list`)·스냅샷 LRU 탓에 화면 미반영 → `cache.invalidate(ticker)`+`invalidate_list()` 필수(storage→cache는 함수 내 지연 import로 순환참조 회피). 추가/관심/승격 시 실명은 `market.resolve_name`이 quote(KR 키움 stk_nm/Naver·US yfinance shortName)에서 채운다(이름칸 비거나 티커면). 백필: `POST /api/stocks/names/backfill`(admin) — 단, 시세 일시실패 시 그 종목을 **재시도 없이 조용히 스킵**(`updated:0`)하므로 결과 0이면 재실행할 것(task#77; 응답 `skipped` 목록으로 어느 종목이 빠졌는지 확인 가능 + 서버에 skip 진단 로그, task#88). **클로버 방지 가드**(task#77): `save_holdings`/`save_stocks`의 tickers UPSERT는 들어온 name이 NULL/빈값/티커와 같으면 기존 `tickers.name`을 보존(`name=CASE WHEN EXCLUDED.name IS NULL OR EXCLUDED.name = EXCLUDED.ticker THEN tickers.name ELSE EXCLUDED.name END`)하고, 일일 배치(`report_generator`)는 `resolve_name`으로 ticker형 이름이면 quote 실명을 박제해, "고쳐도 다음날 또 종목번호"로 되돌아오는 재발을 막는다. (task 41 retro)
- `backend/routers/analytics.py` + `GET /api/analytics/correlation` — 보유 종목 간 90일 수익률 상관관계 계산. correlation 캐시에 저장, 종목 변경 시 자동 무효화.
- **admin `scope=all` 리포트 목록은 비소유 종목(`is_mine=false`)에도 `category`("holdings"/"watchlist")를 무조건 붙인다** (`report.py:_mk_entry`, 글로벌 포트폴리오 멤버십 기준) — 그래서 category로만 게이트된 관리/액션 버튼(수정·승격·삭제)이 **남의 종목(리서치 "그외" 탭)에도 노출**되는데, 그 핸들러는 호출자 본인 user_stocks만 검사하는 user-scoped 엔드포인트(`/api/watchlist|portfolio/{ticker}`)라 **404로 조용히 깨진다**(증상="관심 목록에 없다"). 대응: ① **액션 버튼 가시성은 category가 아니라 `is_mine`으로 게이트**(`is_mine===false`면 삭제만 — 수정/승격은 타인 데이터라 무의미), ② 관리자의 교차-사용자 동작은 `/api/admin/*` 전용(`require_admin`, ticker 단위 전 사용자 `user_stocks` 삭제, 스냅샷은 고아로 유지)으로 분리, ③ 액션 버튼 블록은 **단일 `StockActions` 컴포넌트**(`frontend/src/components/reports/StockActions.jsx`, `layout="card"|"list"`)로 통합됨(task#103) — `StockCard`(그리드)·`TickerListItem`(사이드바) 양쪽이 이걸 쓰므로 **액션버튼/게이트 변경은 거기 한 곳만**(과거엔 두 렌더러에 byte-identical 중복이라 "항상 둘 다 수정" 푸트건이었고, 그게 task#97 그외탭 삭제 404의 재발 토양이었다). (그외 탭 삭제 404 task#97 → 버튼 중복 제거 task#103)
- `backend/routers/digest.py` + `backend/services/digest_service.py` — 일일 다이제스트 생성/조회. 매일 08:00 KST 자동 생성 (`scheduler.py`).
- **응답에 NaN/inf 가능 float를 싣는 엔드포인트는 NaN/inf를 가드할 것** — starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 `NaN`/`inf`가 있으면 직렬화에서 **500**(`Out of range float values are not JSON compliant`)이 난다. 특히 위험한 건 폴백이 *다르게* 가린다는 점: PostgreSQL은 `json` 컬럼에 NaN을 거부(저장 실패)하지만 **파이썬 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백은 통과**해, DB저장 실패→파일 성공→응답 직렬화 실패로 증상이 엇갈려 진단이 늦어진다. 외부 시세(yfinance `Close`가 NaN, FX/usdkrw가 NaN 등)에서 흘러든 NaN이 합산값(`total_value` 등)을 오염시키는 게 전형. 가드는 **소스에서**(예: `math.isfinite` 체크 후 "시세 없음" 처리) 하는 게 출력 일괄 sanitize보다 깨끗하다. (다이제스트 생성 500 사례 8cd70a42.)
- `backend/routers/market_indicators.py` + `backend/services/market_indicators/` — 시장 지표: FX/VIX/원자재/국채 (yfinance incremental fetch + PostgreSQL `market_cache` 영구 저장), 경제지표 (FRED API, `FRED_API_KEY` 필요), M7/KR Top2 earnings (주 1회 갱신), KR Exports (월 1회 갱신).
- `backend/services/market_indicators/macro.py` + `GET /api/market/macro-signals` — FRED 매크로 신호 4종 시계열(`T10Y2Y` 10Y-2Y 금리차·`BAMLH0A0HYM2` HY OAS·`M2SL` M2·`DFF` 기준금리)을 `market_cache`(key `macro_signals`)에 증분 저장하고, `evaluate_signals`로 신호 플래그(`inverted`=최신 금리차<0, `credit_stress`=최신 HY≥5.0%)를 박제한다. GET은 저장값만 반환(요청경로 라이브 FRED 0). `macro_signals_fetch` 일배치(매일 06:00 KST, `market="US"` — FRED 출처) + 수동 `POST /api/market/refresh-macro-signals`(admin). `FRED_API_KEY` 미설정 시 수집 실패(저장값 무변경). 프론트는 시장지표 탭 `LeverageSection` 등과 같은 `frontend/src/components/market/`에서 표시.
- **매크로 신호(FRED 거시 시계열, 시장지표 탭, `macro.py`/`GET /api/market/macro-signals`) ≠ 매크로 상관(MacroTab/`analysis_service.py`, 보유 종목-매크로 자산 90일 수익률 상관, `GET /api/analysis/macro-correlation`)** — 둘 다 "매크로"지만 전자는 FRED 거시지표 자체의 절대 신호, 후자는 내 보유 종목과 TLT/UUP/USO/^VIX의 상관계수 행렬. 서로 다른 서비스·엔드포인트·화면이니 혼동 금지.
- `KITA_API_KEY` 환경변수는 실제로 **관세청(Korea Customs Service)** API 키임 (`apis.data.go.kr/1220000/Itemtrade`). 키 미설정 시 UN Comtrade 공개 API로 자동 폴백.
- `services/market_indicators/` 패키지 — `cache.py`가 `_mc_load`/`_mc_save`로 PostgreSQL `market_cache` 읽기/쓰기. 각 서브모듈이 `_merge_history`/`_yf_close_history`로 yfinance incremental fetch (마지막 날짜 이후만 조회).
- `frontend/src/components/market/` 의 수익/수출 차트(`M7EarningsSection`, `KrTop2Section`, `KrExportsSection`)는 모두 dual Y-axis 구조: 좌측(`yAxisId="left"`) — 억/조 원 또는 십억달러, 우측(`yAxisId="right"`) — 비중 %. `krFmt` 헬퍼(`marketUtils.jsx`)는 억/조 단위 포매팅 (임계값: 10,000억 = 1조). **입력은 '억원' 단위 가정** — 원은 `/1e8` 변환 후 넘기고, 주(count) 등 다른 단위 값엔 부적합(전용 포매터 사용). raw 원/주를 그대로 넘기면 1e8배 오표기(공매도 차트 "35조경원" 사례, f9594f2b).
- **KR 색 관례 토큰 — 의미 배지에 `success`/`danger` 변형 쓰지 말 것**: 이 앱은 `--up`=빨강(상승)·`--down`=파랑(하락, `frontend/src/styles/tokens.css`)이라 `.badge--success`=빨강·`.badge--danger`=파랑이다(`ui/Badge.css`). 가격 방향이 아닌 **의미 상태 배지(수급 밴드 등)에 success/danger를 쓰면 색이 KR 가격색으로 박혀 Western(녹=좋음/빨=경고) 의도와 반전**된다(수급 배지 우호=빨·경계=파 버그, 라이브 UAT 포착 b288f394). 의미 배지는 `ui/SupplyBadge.jsx`처럼 **전용 색을 명시**할 것(가격 토큰 미사용). UI 리뷰도 variant 이름의 통념(success=녹/danger=빨)이 아니라 토큰 실제값을 대조해야 한다. (`warning` 변형은 `--color-warning`/`--warning-tint` 미정의로 현재 깨져 있어 caution 색으로 쓸 수 없음.)
- **Admin 역할 설정**: `UPDATE users SET role = 'admin' WHERE email = '...'` (Docker postgres 직접). admin만 리포트 생성·Guru 크롤 가능.
- **user_menu_permissions**: 사용자별 메뉴 표시 제어. `PUT /api/admin/users/:id/permissions`로 관리. 프론트 `AuthContext`가 로그인 시 로드해 nav 필터링. 허용 메뉴 목록은 `admin.py`의 `ALL_MENUS`에 정의.
- `backend/routers/analysis.py` + `GET /api/analysis/sector` (섹터 모멘텀; `?market=US`(기본)=yfinance SECTOR_ETFS, `?market=KR`=키움 KRX 업종 모멘텀 `kr_sector_service.load_momentum()`+보유 KR 종목→업종 매핑), `GET /api/analysis/macro-correlation` (보유 종목-매크로 상관관계). `analysis_service.py`에서 SECTOR_ETFs(XLK 등 11종), MACRO_TICKERS(TLT/UUP/USO/^VIX) 사용. KR 모멘텀 수동 갱신: `POST /api/analysis/sector/refresh-kr`(admin, `kr_sector_fetch` 본문).
- `backend/routers/events.py` + `POST /api/events` — 사용자 행동 이벤트 수집 (`user_events` 테이블). `VALID_EVENTS` 집합으로 화이트리스트 검증. admin은 `GET /api/admin/analytics`로 집계 조회.
- `backend/services/leverage_service.py` — 공공데이터포털 KOFIA 통계 API (`KOFIA_API_KEY` 필요)로 신용잔고·반대매매·시총 조회 → `market_leverage_indicators` 테이블 저장. `KOFIA_API_KEY` 미설정 시 요청 실패.
- `backend/services/consensus_pipeline.py` — opinion 문자열을 5점 표준화 점수(`_SCORE_MAP`)로 변환 후 `consensus_history` 테이블에 저장하는 공통 파이프라인.
- `backend/services/lending_service.py` — 금융위원회 공공데이터 API (`GetStocLendBorrInfoService_V2`)로 내외국인 대차잔고 조회 → `market_lending_balance` 테이블 저장. `KOFIA_API_KEY` 사용 (leverage_service와 동일 키). 엔드포인트: `GET /api/market-indicators/lending`, `POST /api/market-indicators/lending/sync` (admin).
- `backend/services/dividends.py` — 보유·관심 종목 배당(연 주당배당·배당수익률) 수집 → `stock_dividends` 테이블(ticker PK upsert). 시장별 분기: US=yfinance `t.info`(dividendRate/dividendYield), KR=DART `alotMatter.json`(보통주 '주당 현금배당금(원)'·'현금배당수익률(%)' 당기값, `DART_API_KEY` 필요). 무배당/결측은 None graceful(저장 안 함). `GET /api/stocks/dashboard`가 저장값만 읽어(라이브 호출 0) per-holding `yield_on_cost`·`expected_annual_income`과 포트 `totals`(KRW 환산, 저장 FX `usdkrw`만 사용)를 계산. 배치 `dividend_fetch`(공통, 매주 일 05:00) / 수동 `POST /api/stocks/dividends/refresh`(admin).
- **로컬 `.venv` ≠ Docker 의존성**: `lxml`은 `requirements.txt`에 있고 Docker 이미지엔 설치되지만 **로컬 `backend/.venv`엔 없다**. 로컬 pytest로 검증할 코드/테스트에서 HTML 파싱은 `BeautifulSoup(html, "lxml")` 대신 stdlib `BeautifulSoup(html, "html.parser")`를 쓸 것(로컬·프로덕션 모두 동작). 로컬에서만 필요하면 `.venv`에 직접 설치.
- `backend/services/backlog.py` — 수주잔고(Order Backlog) 수집. DART엔 수주잔고 전용 구조화 API가 없어 **공시서류원본파일 `/api/document.xml`**(ZIP→전 멤버 디코드)로 원문을 받는다. **수주상황 표(유형1: 기납품+수주잔고 컬럼)는 헤더 컬럼 매핑(`_expand_grid` rowspan/colspan 전개)으로 수주잔고 금액을 뽑아 `수주총액−기납품≈잔고`(또는 `기초+신규−기납품≈기말`) 상대 1% 검산을 통과하면 `source='dart'`·amount(억원 정규화)로 자동 저장**한다. 검산 실패·다중엔티티(`회사` 컬럼/종속회사)·외화(USD천 등)·무합계 다중행은 `source='pending'`(amount=None)으로 두고 Cowork(`PUT /api/report/{ticker}/backlog`)가 채운다. KR 전용·`DART_API_KEY` 필수. 전 종목 배치는 `backlog_fetch`(주간 일 04:00) / 수동 `POST /api/report/backlog/refresh-all`(admin). 근거: `.forge/adr/0002`·`0003`.
- `backend/services/disclosures.py` — DART 공시 피드. corp_code별 `list.json`을 핵심유형(A정기·B주요사항·C발행·D지분)으로 호출해 보유+관심 KR 종목의 원시 공시 목록을 `stock_disclosures` 테이블에 `rcept_no` dedup upsert. 조회 `GET /api/report/{ticker}/disclosures`(최신순), 다이제스트 `disclosures` 필드(`_recent_disclosures`, 최근 N일), 전 종목 배치 `disclosure_fetch`(매일 07:30 KST, KR) / 수동 `POST /api/report/disclosures/refresh`(admin). KR 전용·`DART_API_KEY` 필수, DART status 013(무데이터)은 graceful 빈 리스트. corp_code 매핑은 `backlog._get_corp_code_map` 재사용. **list.json은 응답에 `pblntf_ty`를 echo하지 않는다(라이브 확인) — "단일 호출 후 응답필드 필터" 불가하므로 핵심유형 A·B·C·D를 각각 개별 호출해 질의 유형값을 항목에 stamp한다(종목당 4콜, 직렬 배치라 무리 없음).** **공시 피드(`stock_disclosures`, 자동 DART 목록) ≠ `recent_disclosures`(Cowork 애널리스트 코멘터리, `tickers.recent_disclosures`/enrich) — 별도 store라 disclosures 서비스는 `recent_disclosures`를 절대 덮지 않는다.**
- **수주잔고/데이터 파싱 변경은 배포 후 전 종목 재적재 UAT 필수**. fixture 단위 테스트가 전부 통과해도 운영 재적재가 fixture에 없던 실데이터 케이스(외화 `(단위 : USD천)`, 단위 캡션 줄바꿈 분리, 연결 전 분기의 회사컬럼 표 등)를 잡아낸다. 특히 **단위 캡션 파싱 실패 시 '안전한 기본값(억원)' 폴백은 ×100 대형 오저장**을 만드니, 추출 실패는 기본값이 아니라 pending(누락)으로 처리할 것('wrong < missing').
- `backend/services/kiwoom/` — 키움 REST API 연동(**KR 읽기전용 시세 소스로만**; 계좌·주문 미연동, US는 yfinance 유지 — 경계 ADR-0009). `client.py`가 `KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`(`.env.docker`, gitignore)로 토큰 발급(인프로세스 싱글톤, 401시 재발급 재시도) + `request(api_id, body, category)`(`POST /api/dostk/{category}`, 헤더 `api-id`/`authorization`, return_code≠0→예외, 직렬 throttle). `quote.py` ka10001 → `market.get_quote_kr`이 **키움 우선 + Naver 폴백**(키움 미설정/실패/빈 price면 Naver). 값은 부호포함 문자열·시총 억원 단위라 정규화 필수(mac×1e8, cur_prc 절대값). `sector.py`(ka20006 업종일봉 종가 series + ka20002 업종별주가 종목매핑, KRX KOSPI 업종 모멘텀, 조회 TR만 — ADR-0009 경계 내) → `kr_sector_service.py`가 전 업종 모멘텀 사전계산해 `market_cache`에 저장하고 `kr_sector_fetch` 일배치(매일 16:00 KST)·수동 `POST /api/analysis/sector/refresh-kr`로 갱신. 전체 API 카탈로그·대체 로드맵: 루트 `KIWOOM_API.md`. 실시간 WS(0B/0D)·KR 차트/수급/랭킹 대체는 후속 Phase(미착수).
- `backend/services/kis/` — 한국투자증권(KIS) REST API 연동(**KR+US 읽기전용 *백업* 시세 소스**; 키움/yfinance 1차 실패 시 폴백, 주문·계좌 미연동 — 경계 ADR-0011). `client.py`가 `KIS_APP_KEY`/`KIS_APP_SECRET`/`KIS_BASE_URL`(`.env.docker`, 기본 실전 `:9443`)로 `/oauth2/tokenP` 토큰 발급(인프로세스 싱글톤, **발급 1분당 1회 EGW00133 방어로 강제 재발급 60s 가드** + 401 재발급 재시도) + `request(tr_id, path, params)`(GET `/uapi/...`, 헤더 `tr_id`/`appkey`/`appsecret`/`custtype=P`, `rt_cd≠"0"`→예외, 직렬 throttle). `quote.py` 국내 `FHKST01010100`(현재가 `stck_prpr`·기준가 `stck_sdpr`·등락율 `prdy_ctrt`·시총 `hts_avls` 억원→원 정규화, 종목명 없음→None). `market.get_quote_kr` 체인이 **키움→KIS→Naver**(`_kr_basic_kis`). **키 미설정이 안전 기본값**(`configured()` False면 휴면, 기존 동작 무변화) — 코드 먼저 머지해도 무해, 사용자가 포털 발급키를 `.env.docker`에 직접 주입하면 활성화. `quote.py` 해외 `get_quote_us`(price `HHDFS00000300` + dailyprice `HHDFS76240000`, EXCD NAS→NYS→AMS probe)로 `market._get_quote_uncached` US 분기가 **yfinance→KIS** 폴백. **US 1차=yfinance·KIS=백업 근거**: yfinance가 전체 US 티커·섹터/시총/히스토리·배치 1콜(`yf.download`)을 주는 반면 KIS US는 가격만·주요지수 구성종목 위주(15분 지연)라 백업이 적정 — 단 KIS는 공식 인증 API라 Yahoo 장애 시 이중화(가격 정확도는 라이브 대조서 동일). (KR은 반대로 키움 1차 — ADR-0009/0011.) 실시간 WS는 후속 Phase. 전체 카탈로그·대체 로드맵: 루트 `KIS_API.md`.
- **KR 리포트의 시세 소스(`get_quote_kr`)와 일봉 차트 소스(`get_history_df`)는 다른 TR이라 스케일이 어긋날 수 있다 — 매물대/RSI가 "깨져" 보이면 표시 버그가 아니라 박제된 price 값 자체를 의심.** 리포트 상세의 현재가 마커는 `get_quote_kr`(키움 ka10001 `_AL`→KIS→Naver), 매물대/RSI는 `get_history_df`(키움 ka10081 일봉)에서 온다. 한쪽만 액면/병합 조정되면 둘이 최대 5배까지 어긋나, 같은 차트에 마커가 매물대 밴드 밖으로 찍혀 깨진 듯 보인다(005930이 ~70k=실값 354k의 1/5로 박제된 사례). 방어: `get_quote_kr(regular=False)`(NXT 라이브)는 **독립 피드 2-of-N 다수결**(`_kr_pick_basic`/`_corroborated_pick`, `services/market/kr.py`, task#98) — 어떤 현재가 피드가 *다른 독립 피드 ≥1개*와 ±2x([0.5,2.0]) 이내로 **합의(corroborate)**해야 신뢰하고, trusted 중 우선순위 최상위(키움 NXT→KIS→Naver→키움 KRX)를 반환한다. lazy escalation으로 평소엔 ① 키움 NXT+키움 KRX 2콜 합의 → NXT 반환(KIS/Naver 미호출, 비용 무변), ② **불일치(어느 한 피드 글리치)면** KIS(설정 시)·Naver를 추가 호출해 최대 4피드 다수결로 합의값을 고르고 outlier(글리치)를 폐기한다. **표는 참조 종류가 아니라 독립 현재가 피드** — prev_close/일봉(ref_close)은 NXT와 같은 피드라 별도 표 아님(ref_close는 가드에서 빠지고 변동률 계산용으로만 남음). 어떤 단일 피드 글리치도 다수를 못 이기므로 **KRX-poison(KRX 단일 글리치)과 NXT 자기일관 `_AL` 전체오염(quote·prev·일봉ref 동시오염, task#96)을 둘 다 해소**한다(task#96 잔존이던 KRX 단일 앵커 false-reject 제거). 키움 부재/단일(불일치 아닌 outage)·전 피드 합의 불가는 **degenerate**: 우선순위 첫 피드를 자기 prev_close ±30%로만 자가검증(`_kr_pick_degenerate_lazy`, lazy short-circuit·기존 단일피드 보호 보존, wrong<missing). **후속 후보**: regular=True(리포트 스냅샷)는 다수결 미적용(KRX 자기일관 글리치는 task#94 "KRX 안정" 근거로 이론적 + 일배치 +500~2000콜/일 실비용) — `_kr_pick_regular`로 기존 ①prev±30%+②일봉2x 유지. 대시보드 핫패스(`get_quotes_batch`/`_changes_from_closes`)는 이 가드를 안 타며(ephemeral 용인) 무변경. 참조/피드 부재 시 해당 검증만 생략. 진단 시 네이버 공개 API(`m.stock.naver.com/api/stock/{code}/basic`)로 creds 없이 실값 대조 + 컨테이너에서 KRX(`005930`) vs SOR(`005930_AL`) 원값 직접 비교(`docker exec -i portfolion-backend-1 python - < probe.py`). **근본원인(task#94)**: 005930 ~70k는 영속 버그가 아니라 **NXT `_AL`(SOR 통합코드) 순간 이상체결**이 일배치에 박제된 *일시적* 값 — 영속 소스 버그로 단정해 소스부터 고치려 들지 말 것. 부수: 키움 `_AL`은 평시에도 NXT 시간외가(KRX 정규장과 ~1% 차)를 반환. (task#93·94)
- **시세 기준 이원화 — 리포트 스냅샷=KRX 정규장 / 라이브 대시보드=NXT(task#95, ADR-0020)**: 키움 코드선택 단일 분기점 `client.integrated_code(stk_cd, regular=False)`에 `regular` 플래그가 있다 — 기본 False=`_AL`(NXT 시간외), `regular=True`=평문 KRX 코드(정규장 종가). 시세 체인(`get_quote`→…→`get_basic_info`)·차트 체인(`get_history_df`→…→`fetch_bars`)으로 전파되고, **리포트 스냅샷 writer만 `regular=True`로 opt-in**(`report_generator` 당일/백필 daily_df·get_quote·경쟁사, `report.py:refresh_analyst`). RSI(weekly/monthly_df·`indicators`)·대시보드(`get_quotes_batch`)·종목추가·`resolve_name`은 NXT 기본 유지. `get_quote` TTL 캐시 키에 `regular` 포함(정규장/NXT quote 충돌 방지). → 같은 종목이 리포트(354k)와 대시보드(350.5k)에 ~1% 다른 현재가를 보일 수 있는 건 의도된 기준 차. **이게 리포트의 NXT `_AL` 글리치 노출을 없앤다**(리포트는 `_AL` 안 탐) — 위 다수결 발산 가드는 이제 대시보드(NXT) 백스톱. **자기일관적 `_AL` 전체오염(quote·prev_close·일봉ref가 다 같은 오스케일)도 다수결이 잡는다**(NXT≠KRX 불일치 → Naver escalate → NXT outlier 폐기, task#98 — 단일 피드 self-check ±30%/±2x로는 통과하던 케이스). **단, regular=True가 리포트의 *근본해결은 아니다*** — KRX 두 TR(quote ka10001·일봉 ka10081)이 같은 배치 시점에 함께 일시 글리치하는 **KRX 자기일관 오염**엔 면역이 아니다(같은 KRX 피드라 서로 합의해 동일피드 교차검증·`_price_sane` 블라인드, 005930 리포트 또 70k 사례 task#101). 이건 **박제-시 독립피드 게이트**(`report_generator.generate_report`, KR만)가 막는다 — 저장 직전 KRX와 독립인 **네이버 현재가**로 `price`·일봉 기준종가를 2x 교차검증해 어긋나면 그 종목 박제를 **스킵**(직전 양호 스냅샷 유지, wrong<missing). 네이버 부재 시 검증 생략, `backfill_ticker`(과거 날짜)는 현재가 대조 불가라 미적용. 다수결(regular=False)과 같은 원리(독립 피드 교차검증)의 리포트판. 또 **"fix 배포는 이미 박제된 스냅샷을 소급 치료하지 않는다"** — 배포 전 일배치가 박제한 stale 70k는 *재생성*해야 KRX로 덮인다(재생성 전 프로브로 라이브 소스 깨끗 확인 → transient 글리치 재박제 방지).
- **배치-백킹 뷰(랭킹·KR 업종 모멘텀 등)는 외부 API(키움)를 *요청·기동 경로*에서 라이브 호출하지 말 것** — 배치가 사전계산해 `market_cache`/테이블에 저장하고 **요청은 저장값만 읽는다**(요청당 N콜 직렬=수초 지연; 보유→업종 인덱스처럼 "요청 시 라이브 빌드"가 끼면 캐시 만료마다 느려짐 — task#50). 외부 fetch는 ① **실패를 조용히 삼키지 말고 로깅**(silent except는 진단 불가 — task#48 `_fetch_one_sector`가 빈 종가를 삼켜 all-None 박제) ② **빈/all-None 결과를 캐시에 박제 금지**(전부 None이면 save 생략·직전 양호값 유지; 안 그러면 시드 가드가 "채워짐"으로 오판해 고착). **의심 트리거(예: base_dt)가 아니라 *실패 클래스(all-None)*를 가드**해야 근본원인 미상이어도 재발을 막는다. (task#48 위반→#49 기동시드가 노출·증폭→#50 확립 3-타석.) 기동 시 빈 캐시 적재는 `_seed_*_if_empty`(랭킹·kr_sector) 패턴.
- **일일 리포트 배치 시장별 분리**: 단일 `daily_report`가 `daily_report_kr`(기본 20:30 KST, NXT 마감 이후)·`daily_report_us`(기본 07:00 KST, 겨울 DST 안전)로 분리됨. 각 배치는 자기 시장 종목만 생성(파티션: KR=`market=="KR"`, US=`market!="KR"`로 비-KR 전부 US). "미생성" 판정은 시장별·시각인지 기대날짜(`storage.expected_report_date(market)` / `expected_report_dates()`)로 계산. `GET /api/report/list`의 `last_scheduled_date`는 단일 문자열→객체 `{"KR":..,"US":..}`로 형태 교체(외부 Cowork 파싱 영향). 근거: ADR-0012.
- **배치 시장 분류 + 실적/월간 시장별 분리**: `batch_registry.BATCHES`의 모든 배치가 `market` 속성(`KR`/`US`/`공통`)을 가지며 `GET /api/batches` 응답에 그대로 노출된다. 분류는 출처국 기준이라 FRED 경제지표(`monthly_us`)는 해외(US)로 둔다. 실적·월간 지표도 daily_report처럼 시장 분리: `earnings_kr`(KR Top2)/`earnings_us`(M7), `monthly_kr`(KR 수출)/`monthly_us`(FRED 경제지표). 수동 갱신은 `POST /api/market/refresh-earnings?market=KR|US`·`refresh-monthly?market=KR|US`로 호출하면 해당 시장만 갱신하고 시장별 id로 `job_runs.record`한다(고아 `refresh-econ`은 `monthly_us`로 흡수). 근거: ADR-0013.
- **배치의 fetch 소스를 바꾸면(예: KR 랭킹 Naver→키움) `batch_registry`의 그 배치 `source`도 갱신할 것(DoD) — 안 하면 배치 현황이 틀린 출처를 표시한다. `source`=데이터 fetch 출처(예: `["키움","KIS","Naver"]`)이지 `usage`(소비 UI, 예: `["리포트 탭"]`)와 반대 방향**: `source`는 배치가 데이터를 어디서 끌어오는지, `usage`는 그 데이터를 어디서 쓰는지다. `GET /api/batches`가 둘 다 그대로 노출하므로 코드의 fetch 체인만 바꾸고 `source`를 안 고치면 현황 카드가 stale 출처를 보인다.
- **배치 id를 `batch_registry.BATCHES`에서 빼면 그 id를 쓰는 *모든* 표면을 전수 grep**: ① 데이터 read(스케줄 소비처), ② 표시 문자열(`schedule_desc` 등), ③ **`job_runs.record(id, ...)` 모든 lane — auto뿐 아니라 manual·backfill 경로까지**, ④ 그 id를 단언하는 테스트. 한 곳이라도 옛 id로 남으면 stale read(과거)·**배치 현황 실행이력에서 사라지는 회귀**(이번: 수동생성/백필이 은퇴한 `daily_report`로 record → 카드에서 증발, daily_report-market-split task15·17·45 재발)·고아 run 누적이 생긴다. 특히 옛 id를 단언하던 테스트는 깨진 동작을 고정해 TDD green이 회귀를 못 잡으니(이번엔 적대적 리뷰가 포착), id 은퇴 시 테스트도 grep 대상. 단, 옛 id를 *읽는* 시드 마이그레이션(옛 스케줄 행→신규 id 승계)은 정당한 잔존이다 — "잔존 0"은 stale *consumption*(소비처가 옛 id로 read/record) 기준이지, 옛 store를 읽어 신규 id로 옮기는 마이그레이션 read는 청소하면 스케줄 승계가 깨진다(task46 earnings/monthly 분리).

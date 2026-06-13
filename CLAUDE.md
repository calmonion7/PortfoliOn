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
- `backend/services/market_indicators/` — 시장 지표 패키지: `cache.py` (PostgreSQL market_cache 읽기/쓰기), `fx.py` (FX/VIX), `commodities.py` (원자재/국채), `earnings.py` (M7/KR Top2), `econ.py` (FRED 경제지표), `exports.py` (KR 수출)
- `backend/scheduler.py` — APScheduler 설정 (services 아님, 루트 레벨)
- `backend/data/` — 정적 참조 데이터만 (sp500_tickers.json, kospi_tickers.json); 런타임 데이터는 Docker PostgreSQL
- `backend/data/calendar/` — calendar file cache (YYYY-MM.json, gitignored, auto-invalidated on stock mutations)
- `backend/data/consensus/` — per-ticker 컨센서스 JSON 캐시 (gitignored, 로컬 파일 기반)
- `backend/snapshots/` — generated JSON snapshots (gitignored, per-ticker/date)
- `backend/reports/` — legacy report directory (read-only, JSON fallback for old snapshots)

**Frontend** — React 19 + Vite (port 5173), plain CSS (no TailwindCSS)

- `frontend/src/pages/` — Portfolio, Settings, Guru (+ GuruCrawlSettings, GuruManagers, GuruStats, ReportSchedule), ConsensusSettings, LoginPage, Showcase, AdminAnalytics (admin 전용 사용자 행동 분석, `/admin-analytics`), LeverageBackfillSettings (수급지표 백필); 허브 2종: Research (리포트·캘린더·다이제스트), MarketHub (시장지표·분석); 탭 컴포넌트: SectorTab, MacroTab (섹터·매크로는 Portfolio 분석탭으로 통합됨); 개별 페이지(허브 내 탭용): Reports, Calendar, Digest, Market, Analytics
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
- **배포**: `git push origin main` 시 자동 배포됨. `docker compose build` / `docker compose up` 수동 재빌드 절대 하지 말 것.
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

- **API 변경 시 명세서 2개 모두 갱신**: 엔드포인트 추가/삭제·요청/응답 스키마·인증 게이팅을 바꾸면 `API_SPEC.md`(전체 REST 레퍼런스)와 `CLAUDE_COWORK_API.md`(외부 Cowork API)를 **항상 함께** 업데이트(DoD에 포함). 한쪽만 고치면 다른 쪽이 stale돼 Cowork/소비자가 잘못된 명세로 호출한다.
- `PUT /api/stocks/enrich/batch` must be registered **before** `PUT /api/stocks/{ticker}/enrich` in the router to avoid FastAPI routing `enrich` as a ticker value.
- CORS origins: `localhost:3000`, `localhost:5173`, `FRONTEND_URL` env var (`backend/main.py`). 배포 시 `FRONTEND_URL`을 `.env.docker`에 설정.
- `start.bat` runs both servers in hidden PowerShell windows; use `stop.bat` to kill them.
- 백엔드 리포트 생성(`report_generator`)은 시장 데이터 스냅샷만 만든다 — **백엔드에 LLM/Anthropic 호출 없음**(`requirements.txt`에 anthropic 없음). AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API(`CLAUDE_COWORK_API.md`)로 작성한다. `ANTHROPIC_API_KEY`는 `.env.docker`에 남아있으나 현재 백엔드에서 미사용.
- Vite proxies `/api/*` to `http://localhost:8000` (로컬). 배포 환경에서는 `VITE_API_BASE_URL`로 nginx 직접 호출 (미설정 시 상대경로 사용).
- **Vite 8 = rolldown 번들러**: 청크 분할 시 `vite.config.js`의 `build.rollupOptions.output.manualChunks`는 **함수 형식만** 받는다 — rollup식 객체형(`{name: [pkgs]}`)을 쓰면 `Expected Function but received Object`로 빌드가 깨진다. `manualChunks(id)`에서 id substring(`node_modules` 경로)으로 분기하고, 거대 의존성(recharts+d3 등)은 트랜지티브까지 매처에 포함해야 의도한 청크가 생성된다. (task 28 retro)
- `backend/routers/calendar.py` uses file-based cache (`backend/data/calendar/YYYY-MM.json`). Cache is auto-cleared on stock add/remove/promote. To manually clear: use `DELETE /api/calendar/cache?month=YYYY-MM` or click ↺ in the UI. yfinance calls are parallelized (ThreadPoolExecutor, max 30).
- `backend/services/cache.py` — 인메모리 캐시 6종: snapshot (LRU 200), list (TTL 5s), dashboard (TTL 300s), correlation (TTL 300s), sector (TTL 300s), macro (TTL 300s). 종목 추가/수정/삭제 시 dashboard·correlation·sector·macro 캐시 자동 무효화. 수동 무효화: `DELETE /api/stocks/dashboard/cache`.
- `backend/routers/analytics.py` + `GET /api/analytics/correlation` — 보유 종목 간 90일 수익률 상관관계 계산. correlation 캐시에 저장, 종목 변경 시 자동 무효화.
- `backend/routers/digest.py` + `backend/services/digest_service.py` — 일일 다이제스트 생성/조회. 매일 08:00 KST 자동 생성 (`scheduler.py`).
- `backend/routers/market_indicators.py` + `backend/services/market_indicators/` — 시장 지표: FX/VIX/원자재/국채 (yfinance incremental fetch + PostgreSQL `market_cache` 영구 저장), 경제지표 (FRED API, `FRED_API_KEY` 필요), M7/KR Top2 earnings (주 1회 갱신), KR Exports (월 1회 갱신).
- `KITA_API_KEY` 환경변수는 실제로 **관세청(Korea Customs Service)** API 키임 (`apis.data.go.kr/1220000/Itemtrade`). 키 미설정 시 UN Comtrade 공개 API로 자동 폴백.
- `services/market_indicators/` 패키지 — `cache.py`가 `_mc_load`/`_mc_save`로 PostgreSQL `market_cache` 읽기/쓰기. 각 서브모듈이 `_merge_history`/`_yf_close_history`로 yfinance incremental fetch (마지막 날짜 이후만 조회).
- `frontend/src/components/market/` 의 수익/수출 차트(`M7EarningsSection`, `KrTop2Section`, `KrExportsSection`)는 모두 dual Y-axis 구조: 좌측(`yAxisId="left"`) — 억/조 원 또는 십억달러, 우측(`yAxisId="right"`) — 비중 %. `krFmt` 헬퍼(`marketUtils.jsx`)는 억/조 단위 포매팅 (임계값: 10,000억 = 1조).
- **Admin 역할 설정**: `UPDATE users SET role = 'admin' WHERE email = '...'` (Docker postgres 직접). admin만 리포트 생성·Guru 크롤 가능.
- **user_menu_permissions**: 사용자별 메뉴 표시 제어. `PUT /api/admin/users/:id/permissions`로 관리. 프론트 `AuthContext`가 로그인 시 로드해 nav 필터링. 허용 메뉴 목록은 `admin.py`의 `ALL_MENUS`에 정의.
- `backend/routers/analysis.py` + `GET /api/analysis/sector` (섹터 모멘텀), `GET /api/analysis/macro-correlation` (보유 종목-매크로 상관관계). `analysis_service.py`에서 SECTOR_ETFs(XLK 등 11종), MACRO_TICKERS(TLT/UUP/USO/^VIX) 사용.
- `backend/routers/events.py` + `POST /api/events` — 사용자 행동 이벤트 수집 (`user_events` 테이블). `VALID_EVENTS` 집합으로 화이트리스트 검증. admin은 `GET /api/admin/analytics`로 집계 조회.
- `backend/services/leverage_service.py` — 공공데이터포털 KOFIA 통계 API (`KOFIA_API_KEY` 필요)로 신용잔고·반대매매·시총 조회 → `market_leverage_indicators` 테이블 저장. `KOFIA_API_KEY` 미설정 시 요청 실패.
- `backend/services/consensus_pipeline.py` — opinion 문자열을 5점 표준화 점수(`_SCORE_MAP`)로 변환 후 `consensus_history` 테이블에 저장하는 공통 파이프라인.
- `backend/services/lending_service.py` — 금융위원회 공공데이터 API (`GetStocLendBorrInfoService_V2`)로 내외국인 대차잔고 조회 → `market_lending_balance` 테이블 저장. `KOFIA_API_KEY` 사용 (leverage_service와 동일 키). 엔드포인트: `GET /api/market-indicators/lending`, `POST /api/market-indicators/lending/sync` (admin).
- **로컬 `.venv` ≠ Docker 의존성**: `lxml`은 `requirements.txt`에 있고 Docker 이미지엔 설치되지만 **로컬 `backend/.venv`엔 없다**. 로컬 pytest로 검증할 코드/테스트에서 HTML 파싱은 `BeautifulSoup(html, "lxml")` 대신 stdlib `BeautifulSoup(html, "html.parser")`를 쓸 것(로컬·프로덕션 모두 동작). 로컬에서만 필요하면 `.venv`에 직접 설치.
- `backend/services/backlog.py` — 수주잔고(Order Backlog) 수집. DART엔 수주잔고 전용 구조화 API가 없어 **공시서류원본파일 `/api/document.xml`**(ZIP→전 멤버 디코드)로 원문을 받는다. **수주상황 표(유형1: 기납품+수주잔고 컬럼)는 헤더 컬럼 매핑(`_expand_grid` rowspan/colspan 전개)으로 수주잔고 금액을 뽑아 `수주총액−기납품≈잔고`(또는 `기초+신규−기납품≈기말`) 상대 1% 검산을 통과하면 `source='dart'`·amount(억원 정규화)로 자동 저장**한다. 검산 실패·다중엔티티(`회사` 컬럼/종속회사)·외화(USD천 등)·무합계 다중행은 `source='pending'`(amount=None)으로 두고 Cowork(`PUT /api/report/{ticker}/backlog`)가 채운다. KR 전용·`DART_API_KEY` 필수. 전 종목 배치는 `backlog_fetch`(주간 일 04:00) / 수동 `POST /api/report/backlog/refresh-all`(admin). 근거: `.forge/adr/0002`·`0003`.
- **수주잔고/데이터 파싱 변경은 배포 후 전 종목 재적재 UAT 필수**. fixture 단위 테스트가 전부 통과해도 운영 재적재가 fixture에 없던 실데이터 케이스(외화 `(단위 : USD천)`, 단위 캡션 줄바꿈 분리, 연결 전 분기의 회사컬럼 표 등)를 잡아낸다. 특히 **단위 캡션 파싱 실패 시 '안전한 기본값(억원)' 폴백은 ×100 대형 오저장**을 만드니, 추출 실패는 기본값이 아니라 pending(누락)으로 처리할 것('wrong < missing').
- `backend/services/kiwoom/` — 키움 REST API 연동(**KR 읽기전용 시세 소스로만**; 계좌·주문 미연동, US는 yfinance 유지 — 경계 ADR-0009). `client.py`가 `KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`(`.env.docker`, gitignore)로 토큰 발급(인프로세스 싱글톤, 401시 재발급 재시도) + `request(api_id, body, category)`(`POST /api/dostk/{category}`, 헤더 `api-id`/`authorization`, return_code≠0→예외, 직렬 throttle). `quote.py` ka10001 → `market.get_quote_kr`이 **키움 우선 + Naver 폴백**(키움 미설정/실패/빈 price면 Naver). 값은 부호포함 문자열·시총 억원 단위라 정규화 필수(mac×1e8, cur_prc 절대값). 전체 API 카탈로그·대체 로드맵: 루트 `KIWOOM_API.md`. 실시간 WS(0B/0D)·KR 차트/수급/랭킹 대체는 후속 Phase(미착수).
